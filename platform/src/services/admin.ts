import type { Env } from "../env";
import { all, first, run } from "../lib/db";
import { now } from "../lib/time";
import { telemetryHealth } from "./telemetry";
import { listAlertStates, requestRate } from "./observability";
import type { LicenseRow } from "./licensing";

export interface AdminStats {
  customers: number;
  activeLicenses: number;
  totalLicenses: number;
  activeInstallations: number;
  totalInstallations: number;
  openTickets: number;
  pendingTelemetry: number;
  lastTelemetryAt: number;
  lockedIps: number;
  failedActivations24h: number;
  detections24h: number;
  criticalEvents24h: number;
  freeLicenses: number;
  /** 5xx ratio over the last five minutes (feeds the alert card). */
  http5xxRate5m: number;
  httpRequests5m: number;
  alertsFiring: number;
}

export async function getAdminStats(env: Env): Promise<AdminStats> {
  const dayAgo = now() - 24 * 60 * 60 * 1000;
  const [
    customers,
    activeLicenses,
    totalLicenses,
    activeInstalls,
    totalInstalls,
    openTickets,
    lockedIps,
    failedActivations,
    detections,
    criticalEvents,
    freeLicenses,
  ] = await Promise.all([
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM users WHERE status != 'deleted'`),
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM licenses WHERE status = 'active'`),
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM licenses`),
    first<{ count: number }>(
      env.DB,
      `SELECT COUNT(*) AS count FROM installations WHERE last_heartbeat_at > ? AND status = 'active'`,
      dayAgo,
    ),
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM installations`),
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM support_tickets WHERE status IN ('open','pending')`),
    first<{ count: number }>(
      env.DB,
      `SELECT COUNT(*) AS count FROM activation_guard WHERE locked_until IS NOT NULL AND locked_until > ?`,
      now(),
    ),
    first<{ count: number }>(
      env.DB,
      `SELECT COUNT(*) AS count FROM security_events WHERE event_type = 'activation.failed' AND created_at > ?`,
      dayAgo,
    ),
    first<{ count: number }>(
      env.DB,
      `SELECT COUNT(*) AS count FROM security_events WHERE severity IN ('warning','error','critical') AND created_at > ?`,
      dayAgo,
    ),
    first<{ count: number }>(
      env.DB,
      `SELECT COUNT(*) AS count FROM security_events WHERE severity = 'critical' AND created_at > ?`,
      dayAgo,
    ),
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM licenses WHERE plan_id IS NULL`),
  ]);
  const [health, rate, alertStates] = await Promise.all([
    telemetryHealth(env),
    requestRate(env),
    listAlertStates(env),
  ]);
  return {
    customers: customers?.count ?? 0,
    activeLicenses: activeLicenses?.count ?? 0,
    totalLicenses: totalLicenses?.count ?? 0,
    activeInstallations: activeInstalls?.count ?? 0,
    totalInstallations: totalInstalls?.count ?? 0,
    openTickets: openTickets?.count ?? 0,
    pendingTelemetry: health.pendingEvents,
    lastTelemetryAt: health.lastProcessedAt,
    lockedIps: lockedIps?.count ?? 0,
    failedActivations24h: failedActivations?.count ?? 0,
    detections24h: detections?.count ?? 0,
    criticalEvents24h: criticalEvents?.count ?? 0,
    freeLicenses: freeLicenses?.count ?? 0,
    http5xxRate5m: rate.rate,
    httpRequests5m: rate.total,
    alertsFiring: alertStates.filter((alert) => alert.status === "firing").length,
  };
}

export interface AdminAnalyticsDay {
  day: string;
  label: string;
  activations: number;
  users: number;
  telemetry: number;
  security: number;
  critical: number;
}

export interface AdminAnalytics {
  days: AdminAnalyticsDay[];
  detectionsByType: Array<{ event_type: string; severity: string; count: number }>;
  topServers: Array<{ name: string; events: number }>;
}

/** Dashboard day buckets are Bangkok days (UTC+7, no DST), matching the labels in the UI. */
const ANALYTICS_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const ANALYTICS_TZ_SQL = "+7 hours";

function analyticsDayKey(epochMs: number): string {
  return new Date(epochMs + ANALYTICS_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 14-day series for the dashboard charts plus detection breakdowns. */
export async function getAdminAnalytics(env: Env): Promise<AdminAnalytics> {
  const days = 14;
  const start = now() - days * 24 * 60 * 60 * 1000;
  const buckets = new Map<string, AdminAnalyticsDay>();
  for (let index = days - 1; index >= 0; index--) {
    const key = analyticsDayKey(now() - index * 24 * 60 * 60 * 1000);
    buckets.set(key, { day: key, label: key.slice(5), activations: 0, users: 0, telemetry: 0, security: 0, critical: 0 });
  }
  const merge = (
    rows: Array<{ day: string; count: number }>,
    field: "activations" | "users" | "telemetry" | "security" | "critical",
  ) => {
    for (const row of rows) {
      const bucket = buckets.get(row.day);
      if (bucket) bucket[field] = row.count;
    }
  };
  const [activations, users, telemetry, security, critical, detections, topServers] = await Promise.all([
    all<{ day: string; count: number }>(
      env.DB,
      `SELECT strftime('%Y-%m-%d', activated_at / 1000, 'unixepoch', '${ANALYTICS_TZ_SQL}') AS day, COUNT(*) AS count
         FROM activations WHERE activated_at > ? GROUP BY day`,
      start,
    ),
    all<{ day: string; count: number }>(
      env.DB,
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '${ANALYTICS_TZ_SQL}') AS day, COUNT(*) AS count
         FROM users WHERE created_at > ? GROUP BY day`,
      start,
    ),
    all<{ day: string; count: number }>(
      env.DB,
      `SELECT strftime('%Y-%m-%d', received_at / 1000, 'unixepoch', '${ANALYTICS_TZ_SQL}') AS day, COUNT(*) AS count
         FROM telemetry_events WHERE received_at > ? GROUP BY day`,
      start,
    ),
    all<{ day: string; count: number }>(
      env.DB,
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '${ANALYTICS_TZ_SQL}') AS day, COUNT(*) AS count
         FROM security_events WHERE created_at > ? GROUP BY day`,
      start,
    ),
    all<{ day: string; count: number }>(
      env.DB,
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '${ANALYTICS_TZ_SQL}') AS day, COUNT(*) AS count
         FROM security_events WHERE created_at > ? AND severity = 'critical' GROUP BY day`,
      start,
    ),
    all<{ event_type: string; severity: string; count: number }>(
      env.DB,
      `SELECT event_type, severity, COUNT(*) AS count
         FROM security_events WHERE created_at > ?
        GROUP BY event_type, severity ORDER BY count DESC LIMIT 8`,
      start,
    ),
    all<{ name: string; events: number }>(
      env.DB,
      `SELECT COALESCE(i.display_name, i.server_name, i.installation_uuid) AS name, COUNT(*) AS events
         FROM telemetry_events e JOIN installations i ON i.id = e.installation_id
        WHERE e.received_at > ?
        GROUP BY i.id ORDER BY events DESC LIMIT 8`,
      start,
    ),
  ]);
  merge(activations, "activations");
  merge(users, "users");
  merge(telemetry, "telemetry");
  merge(security, "security");
  merge(critical, "critical");
  return {
    days: [...buckets.values()],
    detectionsByType: detections,
    topServers,
  };
}

export interface CustomerRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: number;
  last_login_at: number | null;
  license_count: number;
  server_count: number;
  org_names: string | null;
}

export async function listCustomers(
  env: Env,
  options: { q?: string; limit?: number; offset?: number } = {},
): Promise<CustomerRow[]> {
  const params: Array<string | number> = [];
  let where = "WHERE u.status != 'deleted'";
  if (options.q) {
    where += " AND (u.email LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')";
    const like = `%${options.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  params.push(Math.min(options.limit ?? 50, 200), options.offset ?? 0);
  return all<CustomerRow>(
    env.DB,
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM licenses l WHERE l.org_id IN (SELECT org_id FROM organization_members m WHERE m.user_id = u.id)) AS license_count,
            (SELECT COUNT(*) FROM installations i WHERE i.org_id IN (SELECT org_id FROM organization_members m WHERE m.user_id = u.id)) AS server_count,
            (SELECT GROUP_CONCAT(o.name, ', ') FROM organizations o
              WHERE o.id IN (SELECT org_id FROM organization_members m WHERE m.user_id = u.id)) AS org_names
       FROM users u ${where}
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export async function getCustomer(env: Env, userId: string): Promise<{
  user: { id: string; email: string; display_name: string | null; role: string; status: string; created_at: number; last_login_at: number | null };
  orgs: Array<{ id: string; name: string; role: string; created_at: number }>;
  sessions: number;
  licenses: number;
  installations: number;
} | null> {
  const user = await first<{
    id: string; email: string; display_name: string | null; role: string; status: string; created_at: number; last_login_at: number | null;
  }>(env.DB, `SELECT id, email, display_name, role, status, created_at, last_login_at FROM users WHERE id = ?`, userId);
  if (!user) return null;
  const orgs = await all<{ id: string; name: string; role: string; created_at: number }>(
    env.DB,
    `SELECT o.id, o.name, m.role, m.created_at
       FROM organization_members m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? ORDER BY m.created_at ASC`,
    userId,
  );
  const sessions = await first<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    userId,
    now(),
  );
  const licenses = await first<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) AS count FROM licenses WHERE org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)`,
    userId,
  );
  const installations = await first<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) AS count FROM installations WHERE org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)`,
    userId,
  );
  return {
    user,
    orgs,
    sessions: sessions?.count ?? 0,
    licenses: licenses?.count ?? 0,
    installations: installations?.count ?? 0,
  };
}

export async function setUserStatus(env: Env, userId: string, status: "active" | "suspended" | "deleted"): Promise<void> {
  await run(env.DB, `UPDATE users SET status = ?, updated_at = ? WHERE id = ?`, status, now(), userId);
  if (status !== "active") {
    await run(env.DB, `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, now(), userId);
  }
}

export async function setUserRole(env: Env, userId: string, role: string): Promise<void> {
  await run(env.DB, `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`, role, now(), userId);
}

export interface AdminLicenseRow extends LicenseRow {
  customer_email: string;
  org_name: string;
}

const ADMIN_LICENSE_SELECT = `
  SELECT l.*, p.name AS product_name, p.slug AS product_slug, pl.name AS plan_name,
         u.email AS customer_email, o.name AS org_name,
         (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.status = 'active') AS active_activations,
         (SELECT COUNT(*) FROM installations i WHERE i.license_id = l.id) AS installation_count
    FROM licenses l
    JOIN products p ON p.id = l.product_id
    JOIN users u ON u.id = l.owner_user_id
    JOIN organizations o ON o.id = l.org_id
    LEFT JOIN product_plans pl ON pl.id = l.plan_id`;

export async function listAdminLicenses(
  env: Env,
  options: { status?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<AdminLicenseRow[]> {
  const params: Array<string | number> = [];
  const conditions: string[] = [];
  if (options.status) {
    conditions.push("l.status = ?");
    params.push(options.status);
  }
  if (options.q) {
    conditions.push("(l.key_prefix LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')");
    const like = `%${options.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  params.push(Math.min(options.limit ?? 50, 200), options.offset ?? 0);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return all<AdminLicenseRow>(
    env.DB,
    `${ADMIN_LICENSE_SELECT} ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export async function getAdminLicense(env: Env, licenseId: string): Promise<AdminLicenseRow | null> {
  return first<AdminLicenseRow>(env.DB, `${ADMIN_LICENSE_SELECT} WHERE l.id = ?`, licenseId);
}

export interface AdminInstallationRow {
  id: string;
  installation_uuid: string;
  display_name: string | null;
  status: string;
  product_name: string;
  product_slug: string;
  customer_email: string | null;
  org_name: string | null;
  license_prefix: string | null;
  license_status: string | null;
  plugin_version: string | null;
  minecraft_version: string | null;
  platform: string | null;
  java_version: string | null;
  fingerprint_sha256: string;
  last_heartbeat_at: number | null;
  first_seen_at: number;
}

export async function listAdminInstallations(
  env: Env,
  options: { status?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<AdminInstallationRow[]> {
  const params: Array<string | number> = [];
  const conditions: string[] = [];
  if (options.status) {
    conditions.push("i.status = ?");
    params.push(options.status);
  }
  if (options.q) {
    conditions.push(
      "(i.display_name LIKE ? ESCAPE '\\' OR i.installation_uuid LIKE ? ESCAPE '\\'" +
        " OR i.fingerprint_sha256 LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR o.name LIKE ? ESCAPE '\\')",
    );
    const like = `%${options.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like, like, like);
  }
  params.push(Math.min(options.limit ?? 50, 200), options.offset ?? 0);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return all<AdminInstallationRow>(
    env.DB,
    `SELECT i.id, i.installation_uuid, i.display_name, i.status, i.fingerprint_sha256,
            i.plugin_version, i.minecraft_version, i.platform, i.java_version,
            i.last_heartbeat_at, i.first_seen_at,
            p.name AS product_name, p.slug AS product_slug,
            l.key_prefix AS license_prefix, l.status AS license_status,
            u.email AS customer_email, o.name AS org_name
       FROM installations i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN licenses l ON l.id = i.license_id
       LEFT JOIN organizations o ON o.id = i.org_id
       LEFT JOIN users u ON u.id = o.owner_user_id
       ${where}
      ORDER BY COALESCE(i.last_heartbeat_at, i.first_seen_at) DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export async function getAdminInstallation(env: Env, installationId: string): Promise<AdminInstallationRow | null> {
  const rows = await all<AdminInstallationRow>(
    env.DB,
    `SELECT i.id, i.installation_uuid, i.display_name, i.status, i.fingerprint_sha256,
            i.plugin_version, i.minecraft_version, i.platform, i.java_version,
            i.last_heartbeat_at, i.first_seen_at,
            p.name AS product_name, p.slug AS product_slug,
            l.key_prefix AS license_prefix, l.status AS license_status,
            u.email AS customer_email, o.name AS org_name
       FROM installations i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN licenses l ON l.id = i.license_id
       LEFT JOIN organizations o ON o.id = i.org_id
       LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE i.id = ?`,
    installationId,
  );
  return rows[0] ?? null;
}

export async function listAllPlansWithProduct(env: Env) {
  return all<{ id: string; code: string; name: string; price_cents: number; currency: string; activation_limit: number; entitlements: string; product_id: string; product_name: string; product_slug: string }>(
    env.DB,
    `SELECT pl.*, p.name AS product_name, p.slug AS product_slug
       FROM product_plans pl JOIN products p ON p.id = pl.product_id
      WHERE pl.active = 1 ORDER BY p.name ASC, pl.price_cents ASC`,
  );
}

export async function listAuditEvents(
  env: Env,
  options: { limit?: number; offset?: number } = {},
): Promise<Array<{
  id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  created_at: number;
  before_summary: string | null;
  after_summary: string | null;
}>> {
  return all(
    env.DB,
    `SELECT id, actor_email, action, target_type, target_id, reason, created_at, before_summary, after_summary
       FROM admin_audit_events ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    Math.min(options.limit ?? 100, 200),
    options.offset ?? 0,
  );
}

export async function getAdminSecurityEvents(env: Env, limit = 100) {
  return all<{
    id: string;
    event_type: string;
    severity: string;
    installation_name: string | null;
    user_email: string | null;
    details: string;
    created_at: number;
    ip_hash: string | null;
  }>(
    env.DB,
    `SELECT s.id, s.event_type, s.severity, s.details, s.created_at, s.ip_hash,
            i.display_name AS installation_name, u.email AS user_email
       FROM security_events s
       LEFT JOIN installations i ON i.id = s.installation_id
       LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT ?`,
    limit,
  );
}

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(env.DB, `SELECT key, value FROM system_settings`);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
