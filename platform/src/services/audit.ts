import type { Env } from "../env";
import { newId } from "../lib/core";
import { now } from "../lib/time";
import { run } from "../lib/db";
import { logError } from "../lib/logger";

export interface AuditInput {
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
}

function summary(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return null;
  }
}

/** Immutable admin audit trail. Never updated or deleted by application code. */
export async function recordAudit(env: Env, input: AuditInput): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO admin_audit_events
        (id, actor_user_id, actor_email, action, target_type, target_id, before_summary, after_summary, reason, request_id, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("aud"),
      input.actorUserId,
      input.actorEmail,
      input.action,
      input.targetType,
      input.targetId,
      summary(input.before),
      summary(input.after),
      input.reason ? input.reason.slice(0, 500) : null,
      input.requestId ?? null,
      input.ipHash ?? null,
      now(),
    );
  } catch (error) {
    // Auditing must never take down the request path, but it must not disappear silently:
    // fall back to the security_events trail with the same actor and target.
    logError("audit.write_failed", error, { action: input.action });
    await recordSecurityEvent(env, {
      eventType: `audit.write_failed:${input.action}`.slice(0, 80),
      severity: "error",
      userId: input.actorUserId,
      ipHash: input.ipHash ?? null,
      details: {
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason ?? null,
      },
    });
  }
}

export interface SecurityEventInput {
  eventType: string;
  severity: "info" | "warning" | "error" | "critical";
  installationId?: string | null;
  userId?: string | null;
  ipHash?: string | null;
  details?: Record<string, unknown>;
}

export async function recordSecurityEvent(env: Env, input: SecurityEventInput): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO security_events (id, installation_id, user_id, event_type, severity, ip_hash, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("sec"),
      input.installationId ?? null,
      input.userId ?? null,
      input.eventType.slice(0, 80),
      input.severity,
      input.ipHash ?? null,
      JSON.stringify(input.details ?? {}).slice(0, 2000),
      now(),
    );
  } catch (error) {
    logError("security_event.write_failed", error, { eventType: input.eventType });
  }
}

/** Used by the queue consumer: deterministic id makes retries idempotent. */
export async function recordSecurityEventOnce(
  env: Env,
  id: string,
  input: SecurityEventInput,
): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT OR IGNORE INTO security_events (id, installation_id, user_id, event_type, severity, ip_hash, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.installationId ?? null,
      input.userId ?? null,
      input.eventType.slice(0, 80),
      input.severity,
      input.ipHash ?? null,
      JSON.stringify(input.details ?? {}).slice(0, 2000),
      now(),
    );
  } catch (error) {
    logError("security_event.write_failed", error, { eventType: input.eventType });
  }
}

export async function notifyUser(
  env: Env,
  input: { userId: string; orgId?: string | null; type: string; title: string; body?: string },
): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO notifications (id, user_id, org_id, type, title, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId("ntf"),
      input.userId,
      input.orgId ?? null,
      input.type.slice(0, 60),
      input.title.slice(0, 200),
      (input.body ?? "").slice(0, 1000),
      now(),
    );
  } catch (error) {
    logError("notification.write_failed", error);
  }
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    now(),
  );
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT value FROM system_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}
