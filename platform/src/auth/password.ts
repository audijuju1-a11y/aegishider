import type { Env } from "../env";
import { base64urlDecode, base64urlEncode } from "../lib/core";
import { first } from "../lib/db";
import { now } from "../lib/time";

/**
 * PBKDF2-SHA256 password hashing (WebCrypto). Stored format:
 * pbkdf2-sha256$<iterations>$<saltB64url>$<hashB64url>
 */

// Cloudflare Workers rejects PBKDF2 iteration counts above 100000.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const MIN_ITERATIONS = 50_000;
const MAX_ITERATIONS = 100_000;

export function validatePassword(password: string): string | null {
  if (password.length < 10) return "รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร";
  if (password.length > 200) return "รหัสผ่านยาวเกินไป (สูงสุด 200 ตัวอักษร)";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
  }
  return null;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${base64urlEncode(salt)}$${base64urlEncode(hash)}`;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64urlDecode(parts[2]!);
    expected = base64urlDecode(parts[3]!);
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = await derive(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

export async function passwordHashForEmail(env: Env, email: string): Promise<string | null> {
  const row = await first<{ password_hash: string | null }>(
    env.DB,
    `SELECT password_hash FROM users WHERE email = ? AND status = 'active'`,
    email.trim().toLowerCase(),
  );
  return row?.password_hash ?? null;
}

export async function passwordHashForUser(env: Env, userId: string): Promise<string | null> {
  const row = await first<{ password_hash: string | null }>(
    env.DB,
    `SELECT password_hash FROM users WHERE id = ?`,
    userId,
  );
  return row?.password_hash ?? null;
}

export async function setUserPassword(env: Env, userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(hash, now(), now(), userId)
    .run();
}
