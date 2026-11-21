import { z } from "zod";
import type { Env, TelemetryQueueMessage } from "../env";
import { newId } from "../lib/core";
import { DAY, MINUTE, now, startOfBucket } from "../lib/time";
import { affected, all, first, run } from "../lib/db";
import { log, logError } from "../lib/logger";
import { recordSecurityEventOnce, setSetting } from "./audit";

/* -------------------------------------------------------------------------- */
/* Schemas — strict, bounded, no arbitrary nested data                        */
/* -------------------------------------------------------------------------- */

const shortText = z.string().trim().min(1).max(32);

export const heartbeatSchema = z
  .object({
    schema_version: z.literal(1),
    plugin_version: shortText,
    minecraft_version: shortText,
    platform: shortText,
    java_version: shortText,
    // Self-reported release identity. The server compares this against the published
    // release records; an unlisted SHA is recorded as an integrity event.
    jar_sha256: z.string().trim().max(64).regex(/^[0-9a-f]{0,64}$/i).optional(),
    build_target: z.string().trim().max(32).optional(),
    enabled_modules: z.array(z.string().trim().max(40)).max(20).default([]),
    metrics: z
      .object({
        // Paper can report a floating-point overshoot such as 20.000000000000004;
        // accepting a wider bound keeps a valid heartbeat from failing validation.
        tps: z.number().min(0).max(100),
        mspt_p50: z.number().min(0).max(10_000).nullish(),
        mspt_p95: z.number().min(0).max(10_000).nullish(),
        mspt_p99: z.number().min(0).max(10_000).nullish(),
        plugin_ms_avg: z.number().min(0).max(10_000).nullish(),
        errors: z.number().int().min(0).max(1_000_000_000).optional(),
        players_online: z.number().int().min(0).max(100_000).optional(),
      })
      .strict(),
    occurred_at: z.number().int().positive().optional(),
  })
  .strict();

export const platformEventSchema = z
  .object({
    event_id: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "event_id must be a UUID"),
    type: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/, "invalid event type"),
    severity: z.enum(["info", "warning", "error", "critical"]),
    occurred_at: z.number().int().positive(),
    message: z.string().trim().min(1).max(500),
    attributes: z
      .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
      .refine((value) => Object.keys(value).length <= 20, "too many attributes")
      .optional(),
  })
  .strict();

export const eventsBatchSchema = z
  .object({
    events: z.array(platformEventSchema).min(1).max(50),
  })
  .strict();

export type HeartbeatPayload = z.infer<typeof heartbeatSchema>;
export type PlatformEvent = z.infer<typeof platformEventSchema>;
export type EventsBatch = z.infer<typeof eventsBatchSchema>;

function sanitize(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function safeOccurredAt(value: number | undefined): number {
  const timestamp = value ?? now();
  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  if (!Number.isFinite(ms) || ms < now() - 7 * DAY || ms > now() + DAY) return now();
  return ms;
}

/* -------------------------------------------------------------------------- */
/* Ingest                                                                     */
/* -------------------------------------------------------------------------- */

export async function recordHeartbeat(
  env: Env,
  installation: { id: string; product_id: string },
  payload: HeartbeatPayload,
  ipHash: string | null = null,
): Promise<{ eventId: string; receivedAt: number }> {
  const receivedAt = now();
  const occurredAt = safeOccurredAt(payload.occurred_at);
  const eventId = newId("tev");
  const stored = {
    ...payload,
    plugin_version: sanitize(payload.plugin_version),
    minecraft_version: sanitize(payload.minecraft_version),
    platform: sanitize(payload.platform),
    java_version: sanitize(payload.java_version),
    enabled_modules: payload.enabled_modules.map(sanitize).slice(0, 20),
  };

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE installations SET
         plugin_version = ?, minecraft_version = ?, platform = ?, java_version = ?,
         last_heartbeat_at = ?, updated_at = ?,
         status = CASE WHEN status = 'stale' THEN 'active' ELSE status END
       WHERE id = ? AND status NOT IN ('revoked','suspended')`,
    ).bind(
      stored.plugin_version,
      stored.minecraft_version,
      stored.platform,
      stored.java_version,
      receivedAt,
      receivedAt,
      installation.id,
    ),
    env.DB.prepare(
      `INSERT INTO heartbeat_latest (installation_id, received_at, payload, schema_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(installation_id) DO UPDATE SET received_at = excluded.received_at,
         payload = excluded.payload, schema_version = excluded.schema_version`,
    ).bind(installation.id, receivedAt, JSON.stringify(stored), payload.schema_version),
    env.DB.prepare(
      `INSERT INTO telemetry_events (id, installation_id, event_type, severity, occurred_at, received_at, schema_version, payload)
       VALUES (?, ?, 'heartbeat', 'info', ?, ?, ?, ?)`,
    ).bind(eventId, installation.id, occurredAt, receivedAt, payload.schema_version, JSON.stringify(stored)),
  ]);

  // Clone signal: the same installation UUID heartbeating from several hashed IPs is
  // either a copied server directory or a shared license. Alert only; IPv6 rotation and
  // mobile networks legitimately change addresses, so this never auto-suspends.
  if (ipHash) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO installation_ips (installation_id, ip_hash, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(installation_id, ip_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      ).bind(installation.id, ipHash, receivedAt, receivedAt),
      env.DB.prepare(
        `DELETE FROM installation_ips WHERE installation_id = ? AND last_seen_at < ?`,
      ).bind(installation.id, receivedAt - 7 * DAY),
    ]);
    const distinct = await first<{ count: number }>(
      env.DB,
      `SELECT COUNT(*) AS count FROM installation_ips
        WHERE installation_id = ? AND last_seen_at >= ?`,
      installation.id,
      receivedAt - 30 * MINUTE,
    );
    if ((distinct?.count ?? 0) >= 2) {
      await recordSecurityEventOnce(env,
        `clone-${installation.id}-${startOfBucket(receivedAt, 60 * MINUTE)}`, {
          installationId: installation.id,
          ipHash,
          eventType: "security.multi_ip",
          severity: "warning",
          details: {
            distinct_ip_hashes: distinct?.count ?? 0,
            window_minutes: 30,
          },
        });
    }
  }

  // Server-side release verification: the plugin reports the hash of the running jar
  // on every heartbeat. A jar that is not one of the published builds is never trusted
  // just because the client says so.
  const jarSha = (payload.jar_sha256 ?? "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(jarSha)) {
    const release = await first<{ id: string }>(
      env.DB,
      `SELECT id FROM product_releases
        WHERE product_id = ? AND artifact_sha256 = ? AND status = 'published'
        LIMIT 1`,
      installation.product_id,
      jarSha,
    );
    if (!release) {
      await recordSecurityEventOnce(env, `integrity-${installation.id}-${jarSha.slice(0, 16)}`, {
        installationId: installation.id,
        eventType: "integrity.unlisted_build",
        severity: "warning",
        details: {
          jar_sha256: jarSha,
          build_target: payload.build_target ?? "",
          reported_plugin_version: payload.plugin_version,
        },
      });
      log("warn", "integrity.unlisted_build", {
        installationId: installation.id,
        jarSha: jarSha.slice(0, 16),
      });
    }
  }

  await env.TELEMETRY_QUEUE.send({
    kind: "heartbeat",
    id: eventId,
    installationId: installation.id,
    receivedAt,
  } satisfies TelemetryQueueMessage);

  return { eventId, receivedAt };
}

export async function recordEvents(
  env: Env,
  installation: { id: string },
  events: PlatformEvent[],
): Promise<{ accepted: number; duplicates: number }> {
  const receivedAt = now();
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    const result = await run(
      env.DB,
      `INSERT OR IGNORE INTO telemetry_events
         (id, installation_id, event_type, severity, occurred_at, received_at, schema_version, payload)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      event.event_id,
      installation.id,
      event.type,
      event.severity,
      safeOccurredAt(event.occurred_at),
      receivedAt,
      JSON.stringify({
        message: sanitize(event.message),
        attributes: event.attributes ?? {},
      }),
    );
    if (affected(result) === 1) {
      accepted++;
      await env.TELEMETRY_QUEUE.send({
        kind: "event",
        id: event.event_id,
        installationId: installation.id,
        receivedAt,
      } satisfies TelemetryQueueMessage);
    } else {
      duplicates++;
    }
  }
  return { accepted, duplicates };
}

/* -------------------------------------------------------------------------- */
/* Queue consumer                                                             */
/* -------------------------------------------------------------------------- */

interface EventRow {
  id: string;
  installation_id: string;
  event_type: string;
  severity: string;
  occurred_at: number;
  received_at: number;
  schema_version: number;
  payload: string;
  processed_at: number | null;
}

async function gzip(text: string): Promise<Uint8Array | null> {
  try {
    if (typeof CompressionStream === "undefined") return null;
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export async function processTelemetryMessage(env: Env, message: TelemetryQueueMessage): Promise<void> {
  const event = await first<EventRow>(
    env.DB,
    `SELECT * FROM telemetry_events WHERE id = ? AND installation_id = ?`,
    message.id,
    message.installationId,
  );
  if (!event || event.processed_at !== null) return;

  const date = new Date(event.received_at);
  const key = [
    "telemetry",
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    event.installation_id,
    `${event.id}.json`,
  ].join("/");

  // Heartbeats arrive every three minutes; keeping every one as an R2 object made raw
  // archival dominate the bill. Keep the first heartbeat of each hour and rely on D1
  // rollups/heartbeat_latest for the rest.
  let archive = true;
  if (message.kind === "heartbeat") {
    const hourKey = `hb-archive:${event.installation_id}:${Math.floor(event.received_at / (60 * MINUTE))}`;
    try {
      if (await env.CACHE.get(hourKey)) {
        archive = false;
      } else {
        await env.CACHE.put(hourKey, "1", { expirationTtl: 2 * 60 * 60 });
      }
    } catch {
      archive = true;
    }
  }

  if (archive) {
    try {
      const body = JSON.stringify({
        event_id: event.id,
        kind: message.kind,
        installation_id: event.installation_id,
        type: event.event_type,
        severity: event.severity,
        occurred_at: event.occurred_at,
        received_at: event.received_at,
        schema_version: event.schema_version,
        payload: JSON.parse(event.payload) as unknown,
      });
      const compressed = await gzip(body);
      await env.ARCHIVE.put(key, compressed ?? body, {
        httpMetadata: {
          contentType: "application/json",
          contentEncoding: compressed ? "gzip" : undefined,
        },
        customMetadata: { installation: event.installation_id, event: event.id },
      });
    } catch (error) {
      logError("telemetry.archive_failed", error, { eventId: event.id });
      throw error;
    }
  }

  const marked = await run(
    env.DB,
    `UPDATE telemetry_events SET processed_at = ? WHERE id = ? AND processed_at IS NULL`,
    now(),
    event.id,
  );
  if (affected(marked) !== 1) return;

  if (event.event_type === "heartbeat") {
    try {
      const payload = JSON.parse(event.payload) as HeartbeatPayload;
      const bucket = startOfBucket(event.occurred_at, 5 * MINUTE);
      await run(
        env.DB,
        `INSERT INTO telemetry_rollups
          (installation_id, bucket_start, samples, tps_avg, mspt_p50, mspt_p95, mspt_p99, plugin_ms_avg, errors, payload, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(installation_id, bucket_start) DO UPDATE SET
           samples = samples + 1,
           tps_avg = ((COALESCE(tps_avg, 0) * samples) + COALESCE(excluded.tps_avg, 0)) / (samples + 1),
           mspt_p50 = COALESCE(excluded.mspt_p50, mspt_p50),
           mspt_p95 = COALESCE(excluded.mspt_p95, mspt_p95),
           mspt_p99 = COALESCE(excluded.mspt_p99, mspt_p99),
           plugin_ms_avg = COALESCE(excluded.plugin_ms_avg, plugin_ms_avg),
           errors = errors + excluded.errors,
           updated_at = excluded.updated_at`,
        event.installation_id,
        bucket,
        payload.metrics.tps,
        payload.metrics.mspt_p50 ?? null,
        payload.metrics.mspt_p95 ?? null,
        payload.metrics.mspt_p99 ?? null,
        payload.metrics.plugin_ms_avg ?? null,
        payload.metrics.errors ?? 0,
        JSON.stringify({ sample_tps: payload.metrics.tps }),
        now(),
      );
    } catch (error) {
      logError("telemetry.rollup_failed", error, { eventId: event.id });
      throw error;
    }
  }

  const severity = event.severity as "info" | "warning" | "error" | "critical";
  if (severity === "error" || severity === "critical" || event.event_type.startsWith("security.")) {
    const payload = JSON.parse(event.payload) as { message?: string; attributes?: unknown };
    await recordSecurityEventOnce(env, `sec_${event.id}`, {
      eventType: event.event_type,
      severity,
      installationId: event.installation_id,
      details: {
        message: payload.message ?? "",
        attributes: payload.attributes ?? {},
      },
    });
  }

  const processedAt = now();
  await setSetting(env, "telemetry.last_processed_at", String(processedAt));
  const batches = await first<{ value: string }>(
    env.DB,
    `SELECT value FROM system_settings WHERE key = 'telemetry.processed_batches'`,
  );
  const next = (Number.parseInt(batches?.value ?? "0", 10) || 0) + 1;
  await setSetting(env, "telemetry.processed_batches", String(next));
  log("debug", "telemetry.processed", { eventId: event.id, kind: message.kind });
}

/* -------------------------------------------------------------------------- */
/* Queries for the portal / admin                                             */
/* -------------------------------------------------------------------------- */

export interface TelemetryEventRow {
  id: string;
  event_type: string;
  severity: string;
  occurred_at: number;
  received_at: number;
  payload: string;
  processed_at: number | null;
}

export async function listInstallationEvents(
  env: Env,
  installationId: string,
  options: { severity?: string; type?: string; limit?: number; offset?: number } = {},
): Promise<TelemetryEventRow[]> {
  const conditions = ["installation_id = ?"];
  const params: Array<string | number> = [installationId];
  if (options.severity) {
    conditions.push("severity = ?");
    params.push(options.severity);
  }
  if (options.type) {
    conditions.push("event_type LIKE ? ESCAPE '\\'");
    params.push(`${options.type}%`);
  }
  params.push(Math.min(options.limit ?? 50, 200), options.offset ?? 0);
  return all<TelemetryEventRow>(
    env.DB,
    `SELECT id, event_type, severity, occurred_at, received_at, payload, processed_at
       FROM telemetry_events WHERE ${conditions.join(" AND ")}
      ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export async function getLatestHeartbeat(
  env: Env,
  installationId: string,
): Promise<{ received_at: number; payload: string; schema_version: number } | null> {
  return first(
    env.DB,
    `SELECT received_at, payload, schema_version FROM heartbeat_latest WHERE installation_id = ?`,
    installationId,
  );
}

export async function listRollups(
  env: Env,
  installationId: string,
  limit = 48,
): Promise<Array<{ bucket_start: number; samples: number; tps_avg: number | null; mspt_p95: number | null; errors: number }>> {
  return all(
    env.DB,
    `SELECT bucket_start, samples, tps_avg, mspt_p95, errors FROM telemetry_rollups
      WHERE installation_id = ? ORDER BY bucket_start DESC LIMIT ?`,
    installationId,
    limit,
  );
}

export async function telemetryHealth(env: Env): Promise<{
  lastProcessedAt: number;
  processedBatches: number;
  pendingEvents: number;
  latestHeartbeatAt: number | null;
}> {
  const [lastProcessed, processed, pending, latest] = await Promise.all([
    first<{ value: string }>(env.DB, `SELECT value FROM system_settings WHERE key = 'telemetry.last_processed_at'`),
    first<{ value: string }>(env.DB, `SELECT value FROM system_settings WHERE key = 'telemetry.processed_batches'`),
    first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM telemetry_events WHERE processed_at IS NULL`),
    first<{ received_at: number }>(env.DB, `SELECT MAX(received_at) AS received_at FROM heartbeat_latest`),
  ]);
  return {
    lastProcessedAt: Number.parseInt(lastProcessed?.value ?? "0", 10) || 0,
    processedBatches: Number.parseInt(processed?.value ?? "0", 10) || 0,
    pendingEvents: pending?.count ?? 0,
    latestHeartbeatAt: latest?.received_at ?? null,
  };
}
