import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  CSRF,
  formRequest,
  issueLicenseFor,
  request,
  resetDatabase,
  seedProduct,
  seedUser,
  sessionCookie,
} from "./helpers";
import { setUserPassword } from "../src/auth/password";

beforeEach(async () => {
  await resetDatabase();
  await env.DB.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ('platform.registration_open', 'true', 0)
     ON CONFLICT(key) DO UPDATE SET value = 'true'`,
  ).run();
});

describe("registration switch", () => {
  it("stops public sign-ups when an administrator closes registration", async () => {
    await env.DB.prepare(
      `UPDATE system_settings SET value = 'false' WHERE key = 'platform.registration_open'`,
    ).run();

    const page = await request("/auth/register");
    expect(page.status).toBe(403);
    expect(await page.text()).toContain("ปิดรับสมัครชั่วคราว");

    const submitted = await formRequest(
      "/auth/register",
      {
        email: "closed@example.com",
        password: "Aegishider2026",
        password_confirm: "Aegishider2026",
        next: "/app",
      },
      `bh_csrf=${CSRF}`,
    );
    expect(submitted.status).toBe(403);

    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users`).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});

describe("security-action re-authentication", () => {
  it("requires the current password to rotate recovery codes and start TOTP", async () => {
    const user = await seedUser({ email: "reauth@example.com" });
    await setUserPassword(env, user.id, "Aegishider2026");
    const cookie = await sessionCookie(user.id);

    const missing = await formRequest("/app/security/recovery-codes", {}, cookie);
    expect(missing.status).toBe(303);
    expect(missing.headers.get("location")).toContain("err=bad-password");

    const wrong = await formRequest(
      "/app/security/recovery-codes",
      { password: "WrongPass2026" },
      cookie,
    );
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get("location")).toContain("err=bad-password");

    const rotated = await formRequest(
      "/app/security/recovery-codes",
      { password: "Aegishider2026" },
      cookie,
    );
    expect(rotated.status).toBe(303);
    expect(rotated.headers.get("location")).toContain("ok=recovery-codes");

    const totpStart = await formRequest(
      "/app/security/totp/start",
      { password: "Aegishider2026" },
      cookie,
    );
    expect(totpStart.status).toBe(303);
    expect(totpStart.headers.get("location")).toContain("ok=totp-started");
  });
});

describe("product build selector", () => {
  it("selects the recommended 1.21.11 build and exposes SHA copy metadata", async () => {
    await seedProduct();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO product_releases (id, product_id, version, channel, status, notes,
          supported_minecraft, supported_java, supported_platforms, artifact_url, artifact_sha256,
          released_at, created_at) VALUES ('rel_base', 'prod_test', '4.0.5', 'stable', 'published', 'base',
          '["1.21.1"]', '["21"]', '["Paper"]', '/release/rel_base/download', ?, ?, ?)`,
      ).bind("a".repeat(64), now + 1000, now),
      env.DB.prepare(
        `INSERT INTO product_releases (id, product_id, version, channel, status, notes,
          supported_minecraft, supported_java, supported_platforms, artifact_url, artifact_sha256,
          released_at, created_at) VALUES ('rel_recommended', 'prod_test', '4.0.5+mc1.21.11', 'stable', 'published', 'recommended',
          '["1.21.11"]', '["21"]', '["Paper"]', '/release/rel_recommended/download', ?, ?, ?)`,
      ).bind("b".repeat(64), now, now),
    ]);

    const page = await request("/plugins/test-product");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("data-build-select");
    expect(html).toContain('value="rel_recommended"');
    expect(html).toContain('data-range="1.21.11"');
    expect(html).toContain(`data-copy="${"b".repeat(64)}"`);
    expect(html).toContain("วิธีตรวจสอบ SHA-256");
  });
});

describe("one-time licence key display", () => {
  it("keeps the key available from the list page and consumes it on the detail page", async () => {
    await seedProduct();
    const user = await seedUser({ email: "key-display@example.com" });
    const cookie = await sessionCookie(user.id);
    const licenseId = await issueLicenseFor(user);
    await env.CACHE.put(`newlic:${licenseId}`, "AG-SECRET-KEY", { expirationTtl: 600 });

    const list = await request("/app/licenses", { headers: { cookie } });
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("มีรหัสเต็มในหน้ารายละเอียด");
    expect(await env.CACHE.get(`newlic:${licenseId}`)).toBe("AG-SECRET-KEY");

    const detail = await request(`/app/licenses/${licenseId}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("AG-SECRET-KEY");
    expect(await env.CACHE.get(`newlic:${licenseId}`)).toBeNull();
  });
});
