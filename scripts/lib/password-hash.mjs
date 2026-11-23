/**
 * Password hashing shared by operator scripts.
 *
 * This must stay byte-for-byte compatible with the Worker's `platform/src/auth/password.ts`:
 *   pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>
 * 16-byte salt, 32-byte key, 100,000 iterations (Cloudflare Workers' PBKDF2 ceiling).
 * `platform/tests/password-script.test.ts` asserts that the Worker accepts this output.
 */
export const ITERATIONS = 100_000;

const SALT_BYTES = 16;
const KEY_BITS = 256;

// Ambiguous characters (0/O, 1/I/l) are excluded because operators read these passwords aloud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 20 random characters plus a digit-bearing suffix, so it satisfies the password policy. */
export function generateTemporaryPassword(length = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${out}7a`;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    KEY_BITS,
  );
  return `pbkdf2-sha256$${ITERATIONS}$${base64url(salt)}$${base64url(new Uint8Array(bits))}`;
}
