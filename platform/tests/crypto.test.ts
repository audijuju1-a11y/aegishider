import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  ed25519Sign,
  ed25519Verify,
  generateEd25519KeyPair,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  publicKeyFingerprint,
} from "../src/lib/core";
import { canonicalJson } from "../src/lib/time";

describe("crypto primitives", () => {
  it("generates a usable Ed25519 key pair", async () => {
    const pair = await generateEd25519KeyPair();
    const message = new TextEncoder().encode(canonicalJson({ b: 2, a: "สวัสดี" }));
    const signature = await ed25519Sign(pair.privateKey, message);
    const publicKey = await importEd25519PublicKey(pair.publicKeyBase64);
    expect(await ed25519Verify(publicKey, signature, message)).toBe(true);

    const tampered = new TextEncoder().encode(canonicalJson({ b: 3, a: "สวัสดี" }));
    expect(await ed25519Verify(publicKey, signature, tampered)).toBe(false);
  });

  it("round-trips PKCS#8 private keys", async () => {
    const pair = await generateEd25519KeyPair();
    const restored = await importEd25519PrivateKey(pair.privateKeyBase64);
    const message = new TextEncoder().encode("lease-payload");
    const signature = await ed25519Sign(restored, message);
    const publicKey = await importEd25519PublicKey(pair.publicKeyBase64);
    expect(await ed25519Verify(publicKey, signature, message)).toBe(true);
  });

  it("derives a stable fingerprint from the public key", async () => {
    const pair = await generateEd25519KeyPair();
    const first = await publicKeyFingerprint(pair.publicKeyBase64);
    const second = await publicKeyFingerprint(pair.publicKeyBase64);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("database schema", () => {
  it("applies migrations and has core tables", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='licenses'",
    ).first<{ name: string }>();
    expect(row?.name).toBe("licenses");
    const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
    expect(users?.count).toBe(0);
  });
});
