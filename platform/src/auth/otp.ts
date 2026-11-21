import type { Env } from "../env";
import { hmacSha256Hex, newId, timingSafeEqual } from "../lib/core";
import { first, run } from "../lib/db";
import { now } from "../lib/time";
import { logError } from "../lib/logger";

const OTP_PURPOSE = "login";

export interface IssuedOtp {
  code: string;
  expiresAt: number;
}

function pepper(env: Env): string {
  // A dedicated OTP pepper is preferable; the license pepper is an acceptable
  // fallback because it is already a required production secret.
  const value = (env as Env & { OTP_PEPPER?: string }).OTP_PEPPER ?? env.LICENSE_KEY_PEPPER;
  if (!value || value.length < 16) {
    throw new Error("OTP pepper is not configured");
  }
  return value;
}

async function hashOtp(env: Env, email: string, code: string): Promise<string> {
  return hmacSha256Hex(pepper(env), `otp|${OTP_PURPOSE}|${email.toLowerCase()}|${code}`);
}

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return (bytes[0]! % 1_000_000).toString().padStart(6, "0");
}

export async function issueLoginOtp(env: Env, rawEmail: string): Promise<IssuedOtp> {
  const email = rawEmail.trim().toLowerCase();
  const timestamp = now();
  const ttlMinutes = Math.max(5, Math.min(30, Number(env.EMAIL_OTP_TTL_MINUTES ?? 10) || 10));
  const expiresAt = timestamp + ttlMinutes * 60_000;
  const code = generateCode();
  const codeHash = await hashOtp(env, email, code);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE email_otp SET consumed_at = ? WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
    ).bind(timestamp, email, OTP_PURPOSE),
    env.DB.prepare(
      `INSERT INTO email_otp (id, email, user_id, code_hash, purpose, attempts, max_attempts,
         expires_at, created_at)
       VALUES (?, ?, NULL, ?, ?, 0, 5, ?, ?)`,
    ).bind(newId("otp"), email, codeHash, OTP_PURPOSE, expiresAt, timestamp),
  ]);
  return { code, expiresAt };
}

export type OtpVerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "missing" | "expired" | "invalid" | "locked" };

export async function verifyLoginOtp(env: Env, rawEmail: string, rawCode: string): Promise<OtpVerifyResult> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\D/g, "").slice(0, 6);
  if (!email || code.length !== 6) return { ok: false, reason: "missing" };
  const row = await first<{ id: string; code_hash: string; attempts: number; max_attempts: number }>(
    env.DB,
    `SELECT id, code_hash, attempts, max_attempts FROM email_otp
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    email,
    OTP_PURPOSE,
    now(),
  );
  if (!row) return { ok: false, reason: "expired" };
  if (row.attempts >= row.max_attempts) {
    await run(env.DB, `UPDATE email_otp SET consumed_at = ? WHERE id = ?`, now(), row.id);
    return { ok: false, reason: "locked" };
  }
  const candidate = await hashOtp(env, email, code);
  const matches = timingSafeEqual(candidate, row.code_hash);
  if (!matches) {
    await run(env.DB, `UPDATE email_otp SET attempts = attempts + 1 WHERE id = ?`, row.id);
    return { ok: false, reason: "invalid" };
  }
  const consumed = await run(
    env.DB,
    `UPDATE email_otp SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
    now(),
    row.id,
  );
  if ((consumed.meta.changes ?? 0) !== 1) return { ok: false, reason: "invalid" };
  return { ok: true, email };
}

/**
 * Removes a password that was set before the address was proven. Without this an attacker
 * who registered victim@example.com with their own password keeps access to the account
 * after the real owner verifies the address through an email link or OTP.
 *
 * Token consumption already stamps email_verified_at, so "set before verification" is
 * expressed as password_updated_at <= email_verified_at; a password the owner sets later
 * from /app/account is newer and is preserved.
 */
export async function clearUnverifiedPassword(env: Env, userId: string): Promise<void> {
  try {
    await run(
      env.DB,
      `UPDATE users SET password_hash = NULL, password_updated_at = NULL, updated_at = ?
        WHERE id = ?
          AND password_hash IS NOT NULL
          AND (email_verified_at IS NULL OR password_updated_at IS NULL OR password_updated_at <= email_verified_at)`,
      now(),
      userId,
    );
  } catch (error) {
    logError("otp.clear_unverified_password_failed", error, { userId });
  }
}

export async function markEmailVerified(env: Env, userId: string): Promise<void> {
  try {
    await run(
      env.DB,
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
      now(),
      now(),
      userId,
    );
  } catch (error) {
    logError("otp.verify_email_failed", error, { userId });
  }
}
