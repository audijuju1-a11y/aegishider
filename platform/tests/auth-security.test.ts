import { beforeEach, describe, expect, it } from "vitest";
import { CSRF, formRequest, resetDatabase, seedUser, sessionCookie } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("registration recovery-code handoff", () => {
  it("redirects to /app/security even when next points elsewhere", async () => {
    const email = "redirect-after-register@example.com";
    const response = await formRequest(
      "/auth/register",
      {
        email,
        password: "Aegishider2026",
        password_confirm: "Aegishider2026",
        next: "/app/licenses",
      },
      `bh_csrf=${CSRF}`,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/app/security?ok=recovery-codes");
  });
});

describe("TOTP disable rate limit", () => {
  it("allows five wrong-password attempts and blocks the sixth", async () => {
    const user = await seedUser({ email: "totp-disable-limit@example.com" });
    const cookie = await sessionCookie(user.id);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await formRequest(
        "/app/security/totp/disable",
        { password: "WrongPass2026" },
        cookie,
      );
      expect(response.status, `attempt ${attempt}`).toBe(303);
      expect(response.headers.get("location")).toContain("/app/security");
    }

    const blocked = await formRequest(
      "/app/security/totp/disable",
      { password: "WrongPass2026" },
      cookie,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});
