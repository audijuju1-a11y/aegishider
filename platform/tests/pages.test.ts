import { describe, expect, it } from "vitest";
import { request } from "./helpers";

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
