import type { Env } from "../env";
import { all, batch, first } from "../lib/db";
import { MINUTE, now, startOfBucket } from "../lib/time";
import { drainLogRecords } from "../lib/logger";
import { deadLetterSummary } from "./dlq";

/** Cron that evaluates the rules; must match wrangler.jsonc. */
export const ALERT_CRON = "*/5 * * * *";

const WINDOW_MS = 5 * MINUTE;
const BUCKET_MS = MINUTE;
const SINK_TIMEOUT_MS = 3000;

/**
 * A single 5xx must not fire the rule, and a quiet hour must not look like an
 * outage: the ratio only counts once the window has at least 20 requests.
 */
const MINIMUM_REQUESTS = 20;
const MAX_ERROR_RATE = 0.01;

export type AlertKey = "http.5xx_rate" | "queue.dlq_depth";
export type AlertStatus = "ok" | "firing";

export interface AlertResult {
  key: AlertKey;
  status: AlertStatus;
  value: number;
  threshold: number;
  message: string;
  /** True only when the status differs from the previous evaluation. */
  changed: boolean;
}

export interface AlertStateRow {
  key: string;
  status: AlertStatus;
  value: number;
  threshold: number;
  message: string;
  fired_at: number | null;
  resolved_at: number | null;
  updated_at: number;
}

export interface RequestRate {
  total: number;
  errors: number;
  rate: number;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * One upsert per request feeds the 5xx ratio. The middleware calls it through
 * waitUntil, so a slow D1 write never delays the response.
 */
export async function recordRequestOutcome(env: Env, status: number): Promise<void> {
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO metric_counters (bucket_start, total, errors, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(bucket_start) DO UPDATE SET
       total = metric_counters.total + 1,
       errors = metric_counters.errors + excluded.errors,
       updated_at = excluded.updated_at`,
  )
    .bind(startOfBucket(timestamp, BUCKET_MS), status >= 500 ? 1 : 0, timestamp)
    .run();
}

export async function requestRate(env: Env, at = now()): Promise<RequestRate> {
  const row = await first<{ total: number | null; errors: number | null }>(
    env.DB,
    `SELECT SUM(total) AS total, SUM(errors) AS errors
       FROM metric_counters WHERE bucket_start >= ?`,
    startOfBucket(at - WINDOW_MS, BUCKET_MS),
  );
  const total = Number(row?.total ?? 0);
  const errors = Number(row?.errors ?? 0);
  return { total, errors, rate: total > 0 ? errors / total : 0 };
}

export async function listAlertStates(env: Env): Promise<AlertStateRow[]> {
  return all<AlertStateRow>(
    env.DB,
    `SELECT key, status, value, threshold, message, fired_at, resolved_at, updated_at
       FROM alert_state ORDER BY key`,
  );
}

/**
 * Evaluates both rules and persists the current state. `alert_events` only grows
 * on a transition, so the history stays readable and the sink is not spammed
 * while a condition keeps firing.
 */
export async function evaluateAlerts(env: Env): Promise<AlertResult[]> {
  const [rate, dlq, previous] = await Promise.all([
    requestRate(env),
    deadLetterSummary(env),
    listAlertStates(env),
  ]);
  const before = new Map(previous.map((row) => [row.key, row]));

  const httpFiring = rate.total >= MINIMUM_REQUESTS && rate.rate > MAX_ERROR_RATE;
  const dlqFiring = dlq.open > 0;
  const results: AlertResult[] = [
    {
      key: "http.5xx_rate",
      status: httpFiring ? "firing" : "ok",
      value: rate.rate,
      threshold: MAX_ERROR_RATE,
      message: httpFiring
        ? `${rate.errors}/${rate.total} คำขอใน 5 นาทีเป็น 5xx (${percent(rate.rate)}) เกินเกณฑ์ ${percent(MAX_ERROR_RATE)}`
        : `5xx ${percent(rate.rate)} จาก ${rate.total} คำขอใน 5 นาที`,
      changed: false,
    },
    {
      key: "queue.dlq_depth",
      status: dlqFiring ? "firing" : "ok",
      value: dlq.open,
      threshold: 0,
      message: dlqFiring
        ? `DLQ มีข้อความค้าง ${dlq.open} รายการ; จัดการที่ /admin/security`
        : "ไม่มีข้อความค้างใน DLQ",
      changed: false,
    },
  ];

  await persistAlertStates(env, results, before);
  return results;
}

async function persistAlertStates(
  env: Env,
  results: AlertResult[],
  before: Map<string, AlertStateRow>,
): Promise<void> {
  const timestamp = now();
  const statements: D1PreparedStatement[] = [];

  for (const result of results) {
    const previous = before.get(result.key);
    const changed = (previous?.status ?? "ok") !== result.status;
    result.changed = changed;

    const firedAt =
      result.status === "firing" ? (previous?.status === "firing" ? previous.fired_at : timestamp) : null;
    const resolvedAt =
      result.status === "firing"
        ? null
        : previous?.status === "firing"
          ? timestamp
          : (previous?.resolved_at ?? null);

    statements.push(
      env.DB.prepare(
        `INSERT INTO alert_state (key, status, value, threshold, message, fired_at, resolved_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           status = excluded.status,
           value = excluded.value,
           threshold = excluded.threshold,
           message = excluded.message,
           fired_at = excluded.fired_at,
           resolved_at = excluded.resolved_at,
           updated_at = excluded.updated_at`,
      ).bind(
        result.key,
        result.status,
        result.value,
        result.threshold,
        result.message,
        firedAt,
        resolvedAt,
        timestamp,
      ),
    );

    if (changed) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO alert_events (id, key, status, value, threshold, message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          `alert_${timestamp}_${result.key.replace(/\W+/g, "_")}`,
          result.key,
          result.status,
          result.value,
          result.threshold,
          result.message,
          timestamp,
        ),
      );
    }
  }

  if (statements.length > 0) await batch(env.DB, statements);
}

/**
 * POSTs records to the configured sink. Uses console.error directly: routing a
 * failed delivery back through `log()` would make the sink feed itself.
 */
export async function postSink(env: Env, records: Array<Record<string, unknown>>): Promise<boolean> {
  const url = env.OBSERVABILITY_WEBHOOK_URL;
  if (!url || records.length === 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SINK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "aegishider-platform/1",
        ...(env.OBSERVABILITY_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${env.OBSERVABILITY_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        source: "aegishider-platform",
        environment: env.ENVIRONMENT,
        records,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(
        JSON.stringify({ level: "error", event: "observability.sink_rejected", status: response.status }),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "observability.sink_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Forwards status transitions only; returns how many were delivered. */
export async function shipAlerts(env: Env, alerts: AlertResult[]): Promise<number> {
  const changed = alerts.filter((alert) => alert.changed);
  if (changed.length === 0) return 0;
  const delivered = await postSink(
    env,
    changed.map((alert) => ({
      type: "alert",
      level: alert.status === "firing" ? "error" : "info",
      event: `alert.${alert.status}`,
      alert: alert.key,
      value: alert.value,
      threshold: alert.threshold,
      message: alert.message,
      ts: new Date().toISOString(),
    })),
  );
  return delivered ? changed.length : 0;
}

/**
 * Sends the warn/error records buffered during this request, cron run or queue
 * batch. The buffer is drained even when no sink is configured, so it cannot
 * grow without bound. Never rejects: a dead sink must not fail a request.
 */
export async function flushLogs(env: Env): Promise<void> {
  const records = drainLogRecords();
  if (records.length === 0 || !env.OBSERVABILITY_WEBHOOK_URL) return;
  await postSink(env, records as unknown as Array<Record<string, unknown>>);
}
