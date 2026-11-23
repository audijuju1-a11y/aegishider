import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { CSRF, extractSetCookies, formRequest, request, resetDatabase, seedUser, sessionCookie } from "./helpers";
import { consumeRecoveryCode, issueRecoveryCodes, recoveryCodeCount } from "../src/auth/recovery";
import { generateTotpSecret, totpCodeAt, verifyTotp } from "../src/auth/totp";

beforeEach(async () => {
  await resetDatabase();
});

describe("account recovery codes", () => {
  it("issues ten codes, consumes one, and refuses a replay", async () => {
    const user = await seedUser({ email: "recovery@example.com" });
    const codes = await issueRecoveryCodes(env, user.id);
    expect(codes).toHaveLength(10);
    expect(await recoveryCodeCount(env, user.id)).toBe(10);

    expect(await consumeRecoveryCode(env, user.id, codes[0]!)).toBe(true);
    expect(await consumeRecoveryCode(env, user.id, codes[0]!)).toBe(false);
    expect(await recoveryCodeCount(env, user.id)).toBe(9);
  });

  it("rotates the set and invalidates unused codes from the old set", async () => {
    const user = await seedUser({ email: "rotate@example.com" });
    const first = await issueRecoveryCodes(env, user.id);
    const second = await issueRecoveryCodes(env, user.id);

    expect(await consumeRecoveryCode(env, user.id, first[0]!)).toBe(false);
    expect(await consumeRecoveryCode(env, user.id, second[0]!)).toBe(true);
    expect(await recoveryCodeCount(env, user.id)).toBe(9);
  });

  it("resets the password through /auth/recover and logs in with it", async () => {
    const user = await seedUser({ email: "recover-flow@example.com" });
    const codes = await issueRecoveryCodes(env, user.id);

    const page = await request("/auth/recover");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("กู้คืนบัญชี");

    const recovered = await formRequest(
      "/auth/recover",
      {
        email: user.email,
        code: codes[0]!,
        password: "NewPassword123",
        password_confirm: "NewPassword123",
      },
      `bh_csrf=${CSRF}`,
    );
    expect(recovered.status).toBe(303);
    expect(recovered.headers.get("location")).toContain("/auth/login");

    const login = await formRequest(
      "/auth/login",
      { email: user.email, password: "NewPassword123", next: "/app" },
      `bh_csrf=${CSRF}`,
    );
    expect(login.status).toBe(303);
    expect(extractSetCookies(login).some((value) => value.startsWith("bh_session="))).toBe(true);
  });

  it("keeps codes visible across reloads until the user acknowledges them", async () => {
    const user = await seedUser({ email: "recovery-display@example.com" });
    const codes = await issueRecoveryCodes(env, user.id);
    const key = `recovery-new:${user.id}`;
    await env.CACHE.put(key, JSON.stringify(codes), { expirationTtl: 900 });
    const cookie = await sessionCookie(user.id);

    const first = await request("/app/security", { headers: { cookie } });
    expect(first.status).toBe(200);
    expect(await first.text()).toContain(codes[0]!);
    expect(await env.CACHE.get(key)).not.toBeNull();

    // A refresh must not silently consume the codes before the user saves them.
    const reloaded = await request("/app/security", { headers: { cookie } });
    expect(await reloaded.text()).toContain(codes[0]!);

    const acknowledged = await formRequest("/app/security/recovery-codes/ack", {}, cookie);
    expect(acknowledged.status).toBe(303);
    expect(await env.CACHE.get(key)).toBeNull();

    const after = await request("/app/security", { headers: { cookie } });
    expect(await after.text()).not.toContain(codes[0]!);
  });

  it("rejects malformed codes and another user's code", async () => {
    const owner = await seedUser({ email: "owner-recovery@example.com" });
    const other = await seedUser({ email: "other-recovery@example.com" });
    const codes = await issueRecoveryCodes(env, owner.id);

    expect(await consumeRecoveryCode(env, owner.id, "SHORT")).toBe(false);
    expect(await consumeRecoveryCode(env, other.id, codes[0]!)).toBe(false);
  });
});

describe("TOTP", () => {
  it("accepts the current code and rejects replay, wrong code and empty secret", async () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 1000 / 30);
    const code = await totpCodeAt(secret, counter);

    const first = await verifyTotp(secret, code);
    expect(first.ok).toBe(true);
    expect(first.counter).toBe(counter);

    // Replaying the same accepted step must fail once last_counter has advanced.
    expect((await verifyTotp(secret, code, first.counter)).ok).toBe(false);
    expect((await verifyTotp(secret, "000000", first.counter)).ok).toBe(false);
    expect((await verifyTotp("", code)).ok).toBe(false);
  });
});
