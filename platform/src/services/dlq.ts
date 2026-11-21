import type { Env, TelemetryQueueMessage } from "../env";
import { affected, all, first, run } from "../lib/db";
import { DAY, now } from "../lib/time";
import { log } from "../lib/logger";

/** Must match the `dead_letter_queue` name in wrangler.jsonc. */
export const DLQ_QUEUE = "bhcp-telemetry-dlq";

const MAX_PAYLOAD_CHARS = 4000;

export interface DeadLetterRow {
  id: string;
  queue: string;
  message_id: string;
  kind: string | null;
  event_id: string | null;
  installation_id: string | null;
  attempts: number;
  last_error: string | null;
  payload: string;
  failed_at: number;
  resolved_at: number | null;
}

export interface DeadLetterSummary {
  open: number;
  last24h: number;
  oldestFailedAt: number | null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Best-effort read of the original telemetry envelope inside a poison message. */
function originalMessage(body: unknown): TelemetryQueueMessage | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Partial<TelemetryQueueMessage>;
  if (typeof candidate.id !== "string") return null;
  if (candidate.kind !== "heartbeat" && candidate.kind !== "event") return null;
  return {
    kind: candidate.kind,
    id: candidate.id,
    installationId: typeof candidate.installationId === "string" ? candidate.installationId : "",
    receivedAt: typeof candidate.receivedAt === "number" ? candidate.receivedAt : 0,
  };
}

/**
 * Persists a message that exhausted its retries. The original error is not
 * forwarded by Cloudflare, so the body and delivery attempt count are the
 * evidence an operator gets. Re-delivery of the same message id reopens the row
 * instead of duplicating it.
 */
export async function recordDeadLetter(
  env: Env,
  queue: string,
  message: { id: string; attempts?: number; body: unknown },
): Promise<void> {
  const timestamp = now();
  const original = originalMessage(message.body);
  let payload: string;
  try {
    payload = truncate(JSON.stringify(message.body ?? null), MAX_PAYLOAD_CHARS);
  } catch {
    payload = "\"<unserialisable body>\"";
  }

  await run(
    env.DB,
    `INSERT INTO telemetry_dlq
       (id, queue, message_id, kind, event_id, installation_id, attempts, last_error,
        payload, failed_at, resolved_at, resolved_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       attempts = telemetry_dlq.attempts + 1,
       resolved_at = NULL,
       resolved_by = NULL,
       updated_at = excluded.updated_at`,
    `dlq_${message.id}`,
    queue,
    message.id,
    original?.kind ?? null,
    original?.id ?? null,
    original?.installationId || null,
    Math.max(0, Math.trunc(message.attempts ?? 0)),
    payload,
    timestamp,
    timestamp,
    timestamp,
  );

  log("warn", "queue.dlq_persisted", {
    queue,
    messageId: message.id,
    eventId: original?.id ?? null,
  });
}

export async function listDeadLetters(env: Env, limit = 50): Promise<DeadLetterRow[]> {
  const bounded = Math.min(Math.max(limit, 1), 200);
  return all<DeadLetterRow>(
    env.DB,
    `SELECT id, queue, message_id, kind, event_id, installation_id, attempts,
            last_error, payload, failed_at, resolved_at
       FROM telemetry_dlq WHERE resolved_at IS NULL
      ORDER BY failed_at DESC LIMIT ?`,
    bounded,
  );
}

export async function deadLetterSummary(env: Env): Promise<DeadLetterSummary> {
  const row = await first<{ open: number; last24h: number | null; oldest: number | null }>(
    env.DB,
    `SELECT COUNT(*) AS open,
            SUM(CASE WHEN failed_at > ? THEN 1 ELSE 0 END) AS last24h,
            MIN(failed_at) AS oldest
       FROM telemetry_dlq WHERE resolved_at IS NULL`,
    now() - DAY,
  );
  return {
    open: row?.open ?? 0,
    last24h: row?.last24h ?? 0,
    oldestFailedAt: row?.oldest ?? null,
  };
}

/** Marks a message handled; returns false when it was already resolved. */
export async function resolveDeadLetter(
  env: Env,
  id: string,
  resolvedBy: string,
): Promise<boolean> {
  const result = await run(
    env.DB,
    `UPDATE telemetry_dlq SET resolved_at = ?, resolved_by = ?, updated_at = ?
      WHERE id = ? AND resolved_at IS NULL`,
    now(),
    resolvedBy,
    now(),
    id,
  );
  return affected(result) === 1;
}
