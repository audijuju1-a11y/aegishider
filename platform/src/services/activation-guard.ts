import type { Env } from "../env";
import { AppError } from "../lib/errors";
import { first, run } from "../lib/db";
import { now } from "../lib/time";

/**
 * Escalating online-guess protection for activation codes.
 *
 * Scope is the hashed source IP because a wrong code identifies nothing else:
 * the attacker may rotate installation UUIDs and server names freely. Server
 * names and plugin slugs seen from that IP are recorded so admins can see a
 * single source probing many servers. Counters reset after 24 hours without a
 * failure and on a successful claim.
 */

const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = 12;
const LOCK_LADDER: Array<{ minFailures: number; seconds: number }> = [
  { minFailures: 80, seconds: 4800 },
  { minFailures: 40, seconds: 2400 },
  { minFailures: 20, seconds: 1200 },
  { minFailures: 10, seconds: 600 },
  { minFailures: 5, seconds: 300 },
];

interface GuardRow {
  ip_hash: string;
  failures: number;
  lock_level: number;
  locked_until: number | null;
  first_failure_at: number | null;
  last_failure_at: number | null;
  plugin_slugs: string;
  server_names: string;
  installation_ids: string;
  updated_at: number;
}

export interface GuardFailureInput {
  pluginSlug?: string | null;
  serverName?: string | null;
  installationId?: string | null;
}

export interface GuardLockState {
  failures: number;
  lockLevel: number;
  lockedUntil: number | null;
  retryAfterSeconds: number;
}

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mergeList(existing: string | null | undefined, additions: Array<string | null | undefined>): string {
  const values = parseList(existing);
  for (const addition of additions) {
    const trimmed = addition?.trim().slice(0, 96);
    if (trimmed && !values.includes(trimmed)) values.push(trimmed);
  }
  return JSON.stringify(values.slice(-MAX_LISTED));
}

function lockSecondsFor(failures: number): number {
  for (const step of LOCK_LADDER) {
    if (failures >= step.minFailures) return step.seconds;
  }
  return 0;
}

/** Throws 429 with Retry-After while the IP is locked. */
export async function assertActivationAllowed(env: Env, ipHash: string | null | undefined): Promise<void> {
  if (!ipHash) return;
  const row = await first<GuardRow>(env.DB, `SELECT * FROM activation_guard WHERE ip_hash = ?`, ipHash);
  if (!row || !row.locked_until) return;
  const remaining = row.locked_until - now();
  if (remaining <= 0) return;
  const retryAfterSeconds = Math.ceil(remaining / 1000);
  throw new AppError(
    429,
    "activation_locked",
    `พยายามรหัสเปิดใช้งานผิดหลายครั้งเกินไป กรุณารอ ${Math.ceil(retryAfterSeconds / 60)} นาทีแล้วลองใหม่`,
    {
      headers: { "Retry-After": String(retryAfterSeconds) },
      details: {
        retry_after_seconds: retryAfterSeconds,
        failures: row.failures,
        server_names: parseList(row.server_names),
      },
    },
  );
}

/**
 * Records a failed code attempt and applies the escalating lock:
 * 5 failures -> 5 min, 10 -> 10 min, 20 -> 20 min, 40 -> 40 min, 80 -> 80 min.
 */
export async function recordActivationFailure(
  env: Env,
  ipHash: string | null | undefined,
  input: GuardFailureInput,
): Promise<GuardLockState | null> {
  if (!ipHash) return null;
  const timestamp = now();
  const row = await first<GuardRow>(env.DB, `SELECT * FROM activation_guard WHERE ip_hash = ?`, ipHash);
  let failures = row?.failures ?? 0;
  let lockLevel = row?.lock_level ?? 0;
  const stale = row?.last_failure_at != null && timestamp - row.last_failure_at > RESET_AFTER_MS;
  if (!row || stale) {
    failures = 0;
    lockLevel = 0;
  }
  failures += 1;
  const lockSeconds = lockSecondsFor(failures);
  if (lockSeconds > 0) lockLevel += 1;
  const lockedUntil = lockSeconds > 0 ? timestamp + lockSeconds * 1000 : row?.locked_until ?? null;
  const pluginSlugs = mergeList(row?.plugin_slugs, [input.pluginSlug]);
  const serverNames = mergeList(row?.server_names, [input.serverName]);
  const installationIds = mergeList(row?.installation_ids, [input.installationId]);

  await run(
    env.DB,
    `INSERT INTO activation_guard
       (ip_hash, failures, lock_level, locked_until, first_failure_at, last_failure_at,
        plugin_slugs, server_names, installation_ids, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip_hash) DO UPDATE SET
       failures = excluded.failures,
       lock_level = excluded.lock_level,
       locked_until = excluded.locked_until,
       first_failure_at = COALESCE(activation_guard.first_failure_at, excluded.first_failure_at),
       last_failure_at = excluded.last_failure_at,
       plugin_slugs = excluded.plugin_slugs,
       server_names = excluded.server_names,
       installation_ids = excluded.installation_ids,
       updated_at = excluded.updated_at`,
    ipHash,
    failures,
    lockLevel,
    lockedUntil,
    row?.first_failure_at ?? timestamp,
    timestamp,
    pluginSlugs,
    serverNames,
    installationIds,
    timestamp,
  );
  return {
    failures,
    lockLevel,
    lockedUntil,
    retryAfterSeconds: lockedUntil && lockedUntil > timestamp ? Math.ceil((lockedUntil - timestamp) / 1000) : 0,
  };
}

/** Successful claim: clear the failure ladder for this IP. */
export async function resetActivationGuard(env: Env, ipHash: string | null | undefined): Promise<void> {
  if (!ipHash) return;
  await run(
    env.DB,
    `UPDATE activation_guard
        SET failures = 0, lock_level = 0, locked_until = NULL, first_failure_at = NULL,
            last_failure_at = NULL, updated_at = ?
      WHERE ip_hash = ?`,
    now(),
    ipHash,
  );
}

/**
 * Registration metadata for the IP: which plugins, installation UUIDs and
 * server names are being paired from this source. Never alters the lock state.
 */
export async function noteActivationRegistration(
  env: Env,
  ipHash: string | null | undefined,
  input: GuardFailureInput,
): Promise<void> {
  if (!ipHash) return;
  const timestamp = now();
  const row = await first<GuardRow>(env.DB, `SELECT * FROM activation_guard WHERE ip_hash = ?`, ipHash);
  if (!row) {
    await run(
      env.DB,
      `INSERT INTO activation_guard
         (ip_hash, failures, lock_level, locked_until, first_failure_at, last_failure_at,
          plugin_slugs, server_names, installation_ids, updated_at)
       VALUES (?, 0, 0, NULL, NULL, NULL, ?, ?, ?, ?)`,
      ipHash,
      mergeList(null, [input.pluginSlug]),
      mergeList(null, [input.serverName]),
      mergeList(null, [input.installationId]),
      timestamp,
    );
    return;
  }
  await run(
    env.DB,
    `UPDATE activation_guard
        SET plugin_slugs = ?, server_names = ?, installation_ids = ?, updated_at = ?
      WHERE ip_hash = ?`,
    mergeList(row.plugin_slugs, [input.pluginSlug]),
    mergeList(row.server_names, [input.serverName]),
    mergeList(row.installation_ids, [input.installationId]),
    timestamp,
    ipHash,
  );
}

export interface GuardSummary {
  ip_hash: string;
  failures: number;
  lock_level: number;
  locked_until: number | null;
  last_failure_at: number | null;
  plugin_slugs: string[];
  server_names: string[];
  installation_ids: string[];
}

export async function listActivationGuards(env: Env, limit = 25): Promise<GuardSummary[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM activation_guard WHERE failures > 0 ORDER BY COALESCE(locked_until, last_failure_at) DESC LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(limit, 100)))
    .all<GuardRow>();
  return (result.results ?? []).map((row) => ({
    ip_hash: row.ip_hash,
    failures: row.failures,
    lock_level: row.lock_level,
    locked_until: row.locked_until,
    last_failure_at: row.last_failure_at,
    plugin_slugs: parseList(row.plugin_slugs),
    server_names: parseList(row.server_names),
    installation_ids: parseList(row.installation_ids),
  }));
}
