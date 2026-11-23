import { describe, expect, it } from "vitest";
import {
  ITERATIONS,
  generateTemporaryPassword,
  hashPassword,
} from "../../scripts/lib/password-hash.mjs";
import { verifyPassword } from "../src/auth/password";

/**
 * The operator reset script lives outside the Worker bundle, so its hash must be checked
 * against the Worker's verifier rather than trusted by inspection.
 */
describe("operator password reset hash", () => {
  it("emits the Worker's format and verifies with verifyPassword", async () => {
    const password = generateTemporaryPassword();
    const hash = await hashPassword(password);
    const parts = hash.split("$");

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
    expect(Number(parts[1])).toBe(ITERATIONS);
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword(`${password}x`, hash)).toBe(false);
  });

  it("generates passwords that satisfy the login policy", () => {
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(10);
    expect(password).toMatch(/[A-Za-z]/);
    expect(password).toMatch(/[0-9]/);
  });
});
