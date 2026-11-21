import type { Env } from "./env";
import { DAY, now } from "./lib/time";
import { batch, run } from "./lib/db";
import { getSetting } from "./services/audit";
import { log, logError } from "./lib/logger";
import { ensureSigningKey } from "./services/licensing";
import { ALERT_CRON, evaluateAlerts, flushLogs, shipAlerts } from "./services/observability";

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  if (controller.cron === ALERT_CRON) {
    await handleAlertTick(env);
    return;
  }

  const startedAt = now();
  let status: "ok" | "warn" | "error" = "ok";
  const details: Record<string, number | string> = {};
  try {
    const retentionDays = Math.max(
      1,
      Math.min(3650, Number.parseInt((await getSetting(env, "telemetry.retention_days")) ?? "90", 10) || 90),
    );
    const retentionCutoff = now() - retentionDays * DAY;
    const timestamp = now();

    const results = await batch(env.DB, [
      env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`).bind(
        timestamp - DAY,
        timestamp - 30 * DAY,
      ),
      env.DB.prepare(`DELETE FROM email_tokens WHERE expires_at < ?`).bind(timestamp - DAY),
      env.DB.prepare(`DELETE FROM activation_nonces WHERE expires_at < ?`).bind(timestamp),
      env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).bind(timestamp - 2 * DAY),
      env.DB.prepare(`UPDATE licenses SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`).bind(
        timestamp,
        timestamp,
      ),
      env.DB.prepare(
        `UPDATE installations SET status = 'stale', updated_at = ?
          WHERE status = 'active' AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at < ?`,
      ).bind(timestamp, timestamp - 15 * 60 * 1000),
      env.DB.prepare(
        `DELETE FROM telemetry_events WHERE id IN (
           SELECT id FROM telemetry_events WHERE processed_at IS NOT NULL AND received_at < ? LIMIT 1000
         )`,
      ).bind(retentionCutoff),
      // Bounded retention for tables that previously grew without limit.
      env.DB.prepare(`DELETE FROM license_leases WHERE expires_at < ?`).bind(timestamp - 7 * DAY),
      env.DB.prepare(`DELETE FROM security_events WHERE created_at < ?`).bind(retentionCutoff),
      env.DB.prepare(`DELETE FROM job_runs WHERE COALESCE(finished_at, started_at) < ?`).bind(
        timestamp - 90 * DAY,
      ),
      env.DB.prepare(`DELETE FROM email_log WHERE created_at < ?`).bind(retentionCutoff),
      env.DB.prepare(`DELETE FROM heartbeat_latest WHERE received_at < ?`).bind(retentionCutoff),
      env.DB.prepare(
        `DELETE FROM activation_guard WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)`,
      ).bind(timestamp - 7 * DAY, timestamp),
      // Resolved DLQ rows are evidence history; unresolved rows stay until an operator acts.
      env.DB.prepare(`DELETE FROM telemetry_dlq WHERE resolved_at IS NOT NULL AND failed_at < ?`).bind(
        retentionCutoff,
      ),
      // Minute counters only feed the 5-minute ratio, so a week is plenty.
      env.DB.prepare(`DELETE FROM metric_counters WHERE bucket_start < ?`).bind(timestamp - 7 * DAY),
    ]);

    details.sessions = results[0]?.meta?.changes ?? 0;
    details.email_tokens = results[1]?.meta?.changes ?? 0;
    details.nonces = results[2]?.meta?.changes ?? 0;
    details.rate_limits = results[3]?.meta?.changes ?? 0;
    details.expired_licenses = results[4]?.meta?.changes ?? 0;
    details.stale_installations = results[5]?.meta?.changes ?? 0;
    details.telemetry_deleted = results[6]?.meta?.changes ?? 0;
    details.leases_deleted = results[7]?.meta?.changes ?? 0;
    details.security_events_deleted = results[8]?.meta?.changes ?? 0;
    details.job_runs_deleted = results[9]?.meta?.changes ?? 0;
    details.email_log_deleted = results[10]?.meta?.changes ?? 0;
    details.heartbeats_deleted = results[11]?.meta?.changes ?? 0;
    details.activation_guards_deleted = results[12]?.meta?.changes ?? 0;
    details.dlq_deleted = results[13]?.meta?.changes ?? 0;
    details.metrics_deleted = results[14]?.meta?.changes ?? 0;
    details.retention_days = retentionDays;

    try {
      const signing = await ensureSigningKey(env);
      details.signing_key_id = signing.keyId;
    } catch (error) {
      status = "warn";
      details.signing_key = error instanceof Error ? error.message : "unavailable";
    }

    await run(
      env.DB,
      `INSERT INTO job_runs (id, job, status, detail, started_at, finished_at, duration_ms)
       VALUES (?, 'scheduled.cleanup', ?, ?, ?, ?, ?)`,
      `job_${timestamp}`,
      status,
      JSON.stringify(details),
      startedAt,
      now(),
      now() - startedAt,
    );
    log("info", "scheduled.cleanup", { status, ...details });
  } catch (error) {
    status = "error";
    logError("scheduled.cleanup_failed", error);
    try {
      await run(
        env.DB,
        `INSERT INTO job_runs (id, job, status, detail, started_at, finished_at, duration_ms)
         VALUES (?, 'scheduled.cleanup', 'error', ?, ?, ?, ?)`,
        `job_${startedAt}`,
        error instanceof Error ? error.message.slice(0, 500) : "unknown",
        startedAt,
        now(),
        now() - startedAt,
      );
    } catch {
      /* database may be unavailable */
    }
  }
  await flushLogs(env);
}

/**
 * Every five minutes: evaluate both rules, forward only the transitions to the
 * sink and record the tick in job_runs so a broken alert path is visible.
 */
async function handleAlertTick(env: Env): Promise<void> {
  const startedAt = now();
  let status: "ok" | "warn" | "error" = "ok";
  let detail: Record<string, unknown>;
  try {
    const alerts = await evaluateAlerts(env);
    const delivered = await shipAlerts(env, alerts);
    const firing = alerts.filter((alert) => alert.status === "firing");
    status = firing.length > 0 ? "warn" : "ok";
    detail = { firing: firing.map((alert) => alert.key), delivered };
    log(status === "warn" ? "warn" : "info", "alert.tick", { status, ...detail });
  } catch (error) {
    status = "error";
    detail = { error: error instanceof Error ? error.message.slice(0, 500) : "unknown" };
    logError("alert.tick_failed", error);
  }
  try {
    await run(
      env.DB,
      `INSERT INTO job_runs (id, job, status, detail, started_at, finished_at, duration_ms)
       VALUES (?, 'scheduled.alerts', ?, ?, ?, ?, ?)`,
      `job_alerts_${startedAt}`,
      status,
      JSON.stringify(detail),
      startedAt,
      now(),
      now() - startedAt,
    );
  } catch {
    /* database may be unavailable */
  }
  await flushLogs(env);
}
