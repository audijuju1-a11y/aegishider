import { describe, expect, it } from "vitest";
import { request } from "./helpers";

describe("public documentation pages", () => {
  it("renders the compatibility, defaults, release, evidence and recovery guides", async () => {
    const pages: Array<[string, string[]]> = [
      ["/docs/compatibility", ["Compatibility Matrix", "mc1.21.5", "mc26.3"]],
      ["/docs/defaults", ["Default Configuration", "main-thread-budget-ms", "hide-below-y"]],
      ["/docs/release-verification", ["Release Verification", "ccd36e20", "sha256sum -c"]],
      ["/docs/test-evidence", ["ผลทดสอบ", "46", "PacketEvents"]],
      ["/docs/recovery-2fa", ["Recovery Codes", "TOTP", "/auth/recover"]],
    ];
    for (const [path, needles] of pages) {
      const response = await request(path);
      expect(response.status, path).toBe(200);
      const body = await response.text();
      for (const needle of needles) {
        expect(body, `${path} should contain ${needle}`).toContain(needle);
      }
    }
    const index = await request("/docs");
    expect(await index.text()).toContain("Compatibility Matrix");
  });
});

describe("public developer page", () => {
  it("renders the API guide without a session", async () => {
    const response = await request("/developers");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("/api/v1/installations/lease");
    expect(body).toContain("/api/v1/license/keys");
    expect(body).toContain("X-AG-Signature");
    expect(body).toContain("Ed25519");
  });
});
