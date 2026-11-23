import type { Env } from "../env";
import { hmacSha256Hex, newId, randomBytes } from "../lib/core";
import { first } from "../lib/db";
import { now } from "../lib/time";

/**
 * One-time account recovery codes. The platform has no transactional email, so a
 * forgotten password is recovered with a code the user saved when they set one up.
 * Only an HMAC of each code is stored; the plaintext lives in KV for a short window after
 * issuance and is shown until the user acknowledges it or the 15-minute TTL expires.
 */

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 12;
export const RECOVERY_CODE_COUNT = 10;

function pepper(env: Env): string {
  const value = env.LICENSE_KEY_PEPPER;
  if (!value) throw new Error("LICENSE_KEY_PEPPER is required for recovery codes");
  return value;
}

function normalize(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatRecoveryCode(raw: string): string {
  const code = normalize(raw);
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

async function codeHash(env: Env, raw: string): Promise<string> {
  return hmacSha256Hex(pepper(env), `recovery:${normalize(raw)}`);
}

/** Issues a fresh set and invalidates every unused code from earlier sets. */
export async function issueRecoveryCodes(env: Env, userId: string): Promise<string[]> {
  const codes: string[] = [];
  // Delete and insert in one batch so two concurrent rotations cannot interleave sets.
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`).bind(userId),
  ];
  const createdAt = now();
  for (let index = 0; index < RECOVERY_CODE_COUNT; index++) {
    const bytes = randomBytes(CODE_LENGTH);
    let raw = "";
    for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[bytes[i]! % ALPHABET.length];
    const formatted = formatRecoveryCode(raw);
    codes.push(formatted);
    statements.push(
      env.DB.prepare(
        `INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(newId("rcv"), userId, await codeHash(env, formatted), createdAt),
    );
  }
  await env.DB.batch(statements);
  return codes;
}

/** Consumes a code atomically; a second use of the same code returns false. */
export async function consumeRecoveryCode(env: Env, userId: string, raw: string): Promise<boolean> {
  if (normalize(raw).length !== CODE_LENGTH) return false;
  const hash = await codeHash(env, raw);
  const row = await first<{ id: string }>(
    env.DB,
    `UPDATE recovery_codes SET used_at = ?
      WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
      RETURNING id`,
    now(),
    userId,
    hash,
  );
  return Boolean(row);
}

export async function recoveryCodeCount(env: Env, userId: string): Promise<number> {
  const row = await first<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`,
    userId,
  );
  return row?.count ?? 0;
}
