import { timingSafeEqual } from "../lib/core";

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s step) on WebCrypto — no dependencies.
 * `lastCounter` rejects a code that was already accepted (login replay).
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SECRET_BYTES = 20;
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index--) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export interface TotpResult {
  ok: boolean;
  counter: number;
}

/** HOTP for an explicit time step — used by tests and operator tooling. */
export async function totpCodeAt(secret: string, counter: number): Promise<string> {
  return hotp(base32Decode(secret), counter);
}

/** Accepts the current 30 s step and one step either side. */
export async function verifyTotp(
  secret: string,
  code: string,
  lastCounter?: number | null,
  nowMs = Date.now(),
): Promise<TotpResult> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return { ok: false, counter: 0 };
  const key = base32Decode(secret);
  if (key.length < 10) return { ok: false, counter: 0 };
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (lastCounter != null && step <= lastCounter) continue;
    const expected = await hotp(key, step);
    if (timingSafeEqual(expected, normalized)) return { ok: true, counter: step };
  }
  return { ok: false, counter: 0 };
}

export function otpauthUri(secret: string, email: string, issuer = "Aegishider"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
