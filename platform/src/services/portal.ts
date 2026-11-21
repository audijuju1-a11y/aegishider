import type { Env } from "../env";
import { all, first } from "../lib/db";
import { now, safeJsonParse } from "../lib/time";
import type { SessionUser } from "../auth/session";
import {
  listInstallationsForUser,
  listLicensesForUser,
  getInstallationForUser,
  type InstallationRow,
  type LicenseRow,
} from "./licensing";
import { getLatestHeartbeat, listInstallationEvents, listRollups } from "./telemetry";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  read_at: number | null;
  created_at: number;
}

export interface RecentEvent {
  id: string;
  installation_id: string;
  installation_name: string | null;
  event_type: string;
  severity: string;
  occurred_at: number;
  payload: string;
}

export interface PortalOverview {
  licenses: LicenseRow[];
  servers: InstallationRow[];
  pendingActivations: number;
  expiringSoon: number;
  recentEvents: RecentEvent[];
  notifications: NotificationRow[];
  unreadNotifications: number;
}

export async function getPortalOverview(env: Env, user: SessionUser): Promise<PortalOverview> {
  const [licenses, servers] = await Promise.all([
    listLicensesForUser(env, user.id),
    listInstallationsForUser(env, user.id),
  ]);
  const orgIds = user.memberships.map((membership) => membership.orgId);
  const eventRows =
    orgIds.length === 0
      ? []
      : await all<RecentEvent>(
          env.DB,
          `SELECT e.id, e.installation_id, i.display_name AS installation_name, e.event_type, e.severity, e.occurred_at, e.payload
             FROM telemetry_events e
             JOIN installations i ON i.id = e.installation_id
            WHERE i.org_id IN (${orgIds.map(() => "?").join(",")})
            ORDER BY e.occurred_at DESC LIMIT 8`,
          ...orgIds,
        );

  const notifications = await all<NotificationRow>(
    env.DB,
    `SELECT id, type, title, body, read_at, created_at FROM notifications
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
    user.id,
  );
  const unread = await first<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    user.id,
  );

  const soon = now() + 30 * 24 * 60 * 60 * 1000;
  return {
    licenses,
    servers,
    pendingActivations: servers.filter((server) => server.status === "pending").length,
    expiringSoon: licenses.filter(
      (license) => license.expires_at !== null && license.expires_at > now() && license.expires_at < soon,
    ).length,
    recentEvents: eventRows,
    notifications,
    unreadNotifications: unread?.count ?? 0,
  };
}

export interface ServerDetail {
  installation: InstallationRow;
  heartbeat: { received_at: number; payload: string; schema_version: number } | null;
  heartbeatData: {
    plugin_version?: string;
    minecraft_version?: string;
    platform?: string;
    java_version?: string;
    enabled_modules?: string[];
    metrics?: { tps?: number; players_online?: number; mspt_p95?: number; errors?: number };
  } | null;
  rollups: Array<{ bucket_start: number; samples: number; tps_avg: number | null; mspt_p95: number | null; errors: number }>;
  events: Array<{ id: string; event_type: string; severity: string; occurred_at: number; received_at: number; payload: string }>;
}

export async function getServerDetail(
  env: Env,
  userId: string,
  installationId: string,
  options: { severity?: string; type?: string } = {},
): Promise<ServerDetail | null> {
  const installation = await getInstallationForUser(env, userId, installationId);
  if (!installation) return null;
  const [heartbeat, rollups, events] = await Promise.all([
    getLatestHeartbeat(env, installationId),
    listRollups(env, installationId, 48),
    listInstallationEvents(env, installationId, {
      severity: options.severity,
      type: options.type,
      limit: 40,
    }),
  ]);
  const heartbeatData = heartbeat
    ? safeJsonParse<ServerDetail["heartbeatData"]>(heartbeat.payload, null)
    : null;
  return { installation, heartbeat, heartbeatData, rollups, events };
}

export async function listUserNotifications(env: Env, userId: string): Promise<NotificationRow[]> {
  return all<NotificationRow>(
    env.DB,
    `SELECT id, type, title, body, read_at, created_at FROM notifications
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    userId,
  );
}

export async function markNotificationsRead(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
  )
    .bind(now(), userId)
    .run();
}

export interface OwnedProduct {
  product_id: string;
  product_name: string;
  product_slug: string;
  licenses: number;
  installations: number;
}

export async function listOwnedProducts(env: Env, user: SessionUser): Promise<OwnedProduct[]> {
  const licenses = await listLicensesForUser(env, user.id);
  const map = new Map<string, OwnedProduct>();
  for (const license of licenses) {
    const current = map.get(license.product_id) ?? {
      product_id: license.product_id,
      product_name: license.product_name,
      product_slug: license.product_slug,
      licenses: 0,
      installations: 0,
    };
    current.licenses += 1;
    current.installations += license.installation_count;
    map.set(license.product_id, current);
  }
  return [...map.values()];
}
