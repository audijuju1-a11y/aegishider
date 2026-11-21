import { describe, expect, it } from "vitest";
import { hashPassword, validatePassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const stored = await hashPassword("Aegishider2026");
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword("Aegishider2026", stored)).toBe(true);
    expect(await verifyPassword("Aegishider2025", stored)).toBe(false);
  });

  it("rejects malformed or weak parameters", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100$aaaa$bbbb")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100000$aaaa$bbbb")).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(validatePassword("short1")).not.toBeNull();
    expect(validatePassword("onlyletters")).not.toBeNull();
    expect(validatePassword("1234567890")).not.toBeNull();
    expect(validatePassword("Aegishider2026")).toBeNull();
    expect(validatePassword("a".repeat(201) + "1")).not.toBeNull();
  });
});
