/** Small, dependency-free primitives shared by every subsystem. */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64urlEncode(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32): string {
  return base64urlEncode(randomBytes(bytes));
}

/** Timestamp-prefixed, sortable, unguessable identifier. */
export function newId(prefix: string): string {
  const now = Date.now();
  let time = "";
  let value = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[value % 32] + time;
    value = Math.floor(value / 32);
  }
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  let suffix = "";
  for (const byte of random) suffix += CROCKFORD[byte % 32];
  return `${prefix}_${time}${suffix}`;
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// 16 characters x log2(32) = 80 bits. The old 8-character code carried only
// 40 bits, which is low enough to be worth grinding when combined with leaked
// installation UUIDs. 80 bits makes online guessing hopeless even before the
// escalating lockout kicks in.
export function newActivationCode(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}

export function normalizeActivationCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// 8 groups x 6 characters x 5 bits = 240 bits of entropy. Long enough that a
// blind guess is impossible and short enough to paste into a ticket.
const LICENSE_KEY_GROUPS = 8;
const LICENSE_KEY_GROUP_LENGTH = 6;

export function newLicenseKey(productPrefix: string): string {
  const groups: string[] = [];
  for (let g = 0; g < LICENSE_KEY_GROUPS; g++) {
    const bytes = randomBytes(LICENSE_KEY_GROUP_LENGTH);
    let chunk = "";
    for (let i = 0; i < LICENSE_KEY_GROUP_LENGTH; i++) {
      chunk += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    groups.push(chunk);
  }
  return `${productPrefix.toUpperCase()}-${groups.join("-")}`;
}

export function normalizeLicenseKey(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function licenseKeyPrefix(key: string): string {
  return normalizeLicenseKey(key).slice(0, 10);
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison for secrets of equal meaning. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Ed25519 (WebCrypto). PKCS#8 for private keys, SPKI for public keys.         */
/* -------------------------------------------------------------------------- */

export interface Ed25519KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  privateKeyBase64: string;
  publicKeyBase64: string;
}

export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  const spki = (await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer;
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    privateKeyBase64: bytesToBase64(new Uint8Array(pkcs8)),
    publicKeyBase64: bytesToBase64(new Uint8Array(spki)),
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function importEd25519PrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(pkcs8Base64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

export async function importEd25519PublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(spkiBase64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

export async function ed25519Sign(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, data);
  return new Uint8Array(signature);
}

export async function ed25519Verify(
  publicKey: CryptoKey,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, data);
  } catch {
    return false;
  }
}

/** SPKI public key -> SHA-256 fingerprint (hex, lowercase). */
export async function publicKeyFingerprint(spkiBase64: string): Promise<string> {
  return sha256Hex(base64ToBytes(spkiBase64));
}
