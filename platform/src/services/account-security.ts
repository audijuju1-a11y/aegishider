import type { Env } from "../env";
import { all, first, run } from "../lib/db";
import { now } from "../lib/time";

/**
 * Account security reads/writes used by `/app/security` and the TOTP routes.
 *
 * A-05 keeps SQL out of the route layer: handlers call these functions instead of
 * touching `env.DB` directly. Extend this module (or add a sibling repository) rather
 * than reintroducing SQL in `routes/portal.ts`; `scripts/check-architecture.mjs`
 * enforces the ratchet in CI.
 */

export interface SecurityEventRow {
  id: string;
  event_type: string;
  severity: string;
  details: string;
  created_at: number;
  ip_hash: string | null;
}

export interface TotpState {
  totp_secret: string | null;
  totp_enabled_at: number | null;
}

export async function listSecurityEventsForUser(
  env: Env,
  userId: string,
): Promise<SecurityEventRow[]> {
  return all<SecurityEventRow>(
    env.DB,
    `SELECT id, event_type, severity, details, created_at, ip_hash FROM security_events
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    userId,
  );
}

export async function totpStateForUser(env: Env, userId: string): Promise<TotpState | null> {
  return first<TotpState>(
    env.DB,
    `SELECT totp_secret, totp_enabled_at FROM users WHERE id = ?`,
    userId,
  );
}

export async function enableTotpForUser(
  env: Env,
  userId: string,
  secret: string,
  counter: number,
): Promise<void> {
  const timestamp = now();
  await run(
    env.DB,
    `UPDATE users SET totp_secret = ?, totp_enabled_at = ?, totp_last_counter = ?, updated_at = ?
      WHERE id = ?`,
    secret,
    timestamp,
    counter,
    timestamp,
    userId,
  );
}

export async function disableTotpForUser(env: Env, userId: string): Promise<void> {
  await run(
    env.DB,
    `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL,
        updated_at = ? WHERE id = ?`,
    now(),
    userId,
  );
}

export async function sessionBelongsToUser(
  env: Env,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const row = await first<{ id: string }>(
    env.DB,
    `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
    sessionId,
    userId,
  );
  return row !== null;
}
