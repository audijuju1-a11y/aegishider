import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  CSRF,
  extractSetCookies,
  formRequest,
  issueLicenseFor,
  request,
  resetDatabase,
  seedInstallation,
  seedProduct,
  seedUser,
  sessionCookie,
  signedPost,
} from "./helpers";
import {
  base64urlEncode,
  bytesToBase64,
  ed25519Sign,
  ed25519Verify,
  generateEd25519KeyPair,
  importEd25519PublicKey,
  publicKeyFingerprint,
  sha256Hex,
} from "../src/lib/core";
import { processTelemetryMessage } from "../src/services/telemetry";
import { handleQueue } from "../src/queue";
import { now } from "../src/lib/time";
import {
  ALERT_CRON,
  evaluateAlerts,
  listAlertStates,
  postSink,
} from "../src/services/observability";
import { handleScheduled } from "../src/scheduled";

function b64urlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

beforeEach(async () => {
  await resetDatabase();
});

describe("public marketing", () => {
  it("renders the catalogue, product page and docs", async () => {
    await seedProduct();
    const plugins = await request("/plugins");
    expect(plugins.status).toBe(200);
    expect(await plugins.text()).toContain("Test Product");

    const product = await request("/plugins/test-product");
    expect(product.status).toBe(200);
    const productHtml = await product.text();
    expect(productHtml).toContain("คำโปรยทดสอบ");

    expect((await request("/docs/getting-started")).status).toBe(200);
    expect((await request("/status")).status).toBe(200);
    expect((await request("/plugins/does-not-exist")).status).toBe(404);
  });

  it("returns public API products and signing keys", async () => {
    await seedProduct();
    const products = await request("/api/v1/products");
    expect(products.status).toBe(200);
    const payload = (await products.json()) as { data: { products: Array<{ slug: string }> } };
    expect(payload.data.products.some((item) => item.slug === "test-product")).toBe(true);

    const keys = await request("/api/v1/license/keys");
    expect(keys.status).toBe(200);
    const keyPayload = (await keys.json()) as { data: { keys: Array<{ key_id: string; public_key: string }> } };
    expect(keyPayload.data.keys.length).toBeGreaterThan(0);
  });
});

describe("authentication", () => {
  function csrfFrom(response: Response): { cookie: string; token: string } {
    const cookies = extractSetCookies(response).map((value) => value.split(";")[0]);
    const csrfCookie = cookies.find((value) => value.startsWith("bh_csrf="));
    expect(csrfCookie).toBeTruthy();
    return { cookie: csrfCookie!, token: csrfCookie!.split("=")[1]! };
  }

  it("registers with email + password and signs in immediately", async () => {
    await seedProduct();
    const registerPage = await request("/auth/register");
    const csrf = csrfFrom(registerPage);
    const email = "owner-password@example.com";
    const password = "Aegishider2026";

    const registered = await request("/auth/register", {
      method: "POST",
      headers: { cookie: csrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: csrf.token,
        email,
        password,
        password_confirm: password,
        next: "/app",
      }).toString(),
    });
    expect(registered.status).toBe(303);
    const session = extractSetCookies(registered)
      .map((value) => value.split(";")[0])
      .find((value) => value.startsWith("bh_session="));
    expect(session).toBeTruthy();
    expect((await request("/app", { headers: { cookie: `${session}; ${csrf.cookie}` } })).status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT password_hash, email_verified_at FROM users WHERE email = ?`,
    ).bind(email).first<{ password_hash: string | null; email_verified_at: number | null }>();
    expect(row?.password_hash).not.toBeNull();
    expect(row?.email_verified_at).not.toBeNull();

    const loginPage = await request("/auth/login");
    const loginCsrf = csrfFrom(loginPage);
    const wrong = await request("/auth/login", {
      method: "POST",
      headers: { cookie: loginCsrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: loginCsrf.token, email, password: "WrongPass2026", next: "/app" }).toString(),
    });
    expect(wrong.status).toBe(400);

    const correct = await request("/auth/login", {
      method: "POST",
      headers: { cookie: loginCsrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: loginCsrf.token, email, password, next: "/app" }).toString(),
    });
    expect(correct.status).toBe(303);
    expect(extractSetCookies(correct).some((value) => value.startsWith("bh_session="))).toBe(true);

    const duplicate = await request("/auth/register", {
      method: "POST",
      headers: { cookie: csrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: csrf.token,
        email,
        password,
        password_confirm: password,
        next: "/app",
      }).toString(),
    });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.text()).toContain("มีบัญชีแล้ว");
  });

  it("completes a passwordless, never-verified placeholder account", async () => {
    await seedProduct();
    const email = "placeholder@example.com";
    const password = "Placeholder2026";
    const user = await seedUser({ email });
    await env.DB.prepare(
      `UPDATE users SET email_verified_at = NULL, password_hash = NULL, password_updated_at = NULL WHERE id = ?`,
    ).bind(user.id).run();

    const registerPage = await request("/auth/register");
    const csrf = csrfFrom(registerPage);
    const registered = await request("/auth/register", {
      method: "POST",
      headers: { cookie: csrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: csrf.token,
        email,
        password,
        password_confirm: password,
        next: "/app",
      }).toString(),
    });
    expect(registered.status).toBe(303);
    const row = await env.DB.prepare(
      `SELECT password_hash, email_verified_at FROM users WHERE id = ?`,
    ).bind(user.id).first<{ password_hash: string | null; email_verified_at: number | null }>();
    expect(row?.password_hash).not.toBeNull();
    expect(row?.email_verified_at).not.toBeNull();
  });

  it("rejects non-form content types with 415 instead of 500", async () => {
    const json = await request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.co", password: "whatever1" }),
    });
    expect(json.status).toBe(415);
    const text = await request("/auth/login", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(text.status).toBe(415);
  });

  it("retires email-link and OTP login routes", async () => {
    const loginPage = await request("/auth/login");
    const csrf = csrfFrom(loginPage);
    const get = await request("/auth/email");
    expect([302, 303]).toContain(get.status);
    const post = await request("/auth/email", {
      method: "POST",
      headers: { cookie: csrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf.token, email: "link-user@example.com", next: "/app" }).toString(),
    });
    expect([302, 303]).toContain(post.status);
    const otp = await request("/auth/verify-otp", {
      method: "POST",
      headers: { cookie: csrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf.token, email: "link-user@example.com", code: "123456", next: "/app" }).toString(),
    });
    expect([302, 303]).toContain(otp.status);
    const verify = await request("/auth/verify?token=retired");
    expect([302, 303]).toContain(verify.status);
  });

  it("lets a signed-in legacy account set a password and then use it", async () => {
    await seedProduct();
    const user = await seedUser({ email: "legacy@example.com" });
    const cookie = await sessionCookie(user.id);
    const account = await request("/app/account", { headers: { cookie } });
    expect(account.status).toBe(200);
    expect(await account.text()).toContain("ตั้งรหัสผ่าน");

    const changed = await formRequest(
      "/app/account/password",
      { new_password: "Aegishider2026", confirm_password: "Aegishider2026" },
      cookie,
    );
    expect(changed.status).toBe(303);

    const loginPage = await request("/auth/login");
    const csrf = csrfFrom(loginPage);
    const login = await request("/auth/login", {
      method: "POST",
      headers: { cookie: csrf.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf.token, email: "legacy@example.com", password: "Aegishider2026", next: "/app" }).toString(),
    });
    expect(login.status).toBe(303);
  });
});

describe("licensing and signed requests", () => {
  it("issues a verifiable lease, accepts heartbeat and rejects tampered signatures", async () => {
    await seedProduct();
    const user = await seedUser({ email: "licensee@example.com" });
    const licenseId = await issueLicenseFor(user);
    const installation = await seedInstallation({ user, licenseId });

    const leaseBody = JSON.stringify({ plugin_version: "3.3.0" });
    const leaseResponse = await signedPost("/api/v1/installations/lease", leaseBody, installation);
    expect(leaseResponse.status).toBe(200);
    const leasePayload = (await leaseResponse.json()) as {
      data: { lease: string; key_id: string; keys: Array<{ key_id: string; public_key: string }> };
    };
    const [payloadB64, signatureB64] = leasePayload.data.lease.split(".");
    const payloadBytes = b64urlBytes(payloadB64);
    const signature = b64urlBytes(signatureB64);
    const publicKey = leasePayload.data.keys.find((key) => key.key_id === leasePayload.data.key_id);
    expect(publicKey).toBeTruthy();
    const cryptoKey = await importEd25519PublicKey(publicKey!.public_key);
    expect(await ed25519Verify(cryptoKey, signature, payloadBytes)).toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    expect(claims.installation_uuid).toBe(installation.installationUuid);
    expect(claims.license_id).toBe(licenseId);

    const heartbeatBody = JSON.stringify({
      schema_version: 1,
      plugin_version: "3.3.0",
      minecraft_version: "1.21.4",
      platform: "Paper",
      java_version: "21",
      enabled_modules: ["block-protection"],
      metrics: { tps: 19.9, mspt_p50: 0.2, mspt_p95: 0.8, mspt_p99: 2.9, plugin_ms_avg: 0.2, errors: 0, players_online: 5 },
      occurred_at: Math.floor(Date.now() / 1000),
    });
    const heartbeat = await signedPost("/api/v1/installations/heartbeat", heartbeatBody, installation);
    expect(heartbeat.status).toBe(202);
    const heartbeatPayload = (await heartbeat.json()) as { data: { event_id: string; received_at: number } };
    const latest = await env.DB.prepare(`SELECT payload FROM heartbeat_latest WHERE installation_id = ?`)
      .bind(installation.installationId)
      .first<{ payload: string }>();
    expect(latest?.payload).toContain("\"tps\":19.9");

    await processTelemetryMessage(env, {
      kind: "heartbeat",
      id: heartbeatPayload.data.event_id,
      installationId: installation.installationId,
      receivedAt: heartbeatPayload.data.received_at,
    });
    const rollups = await env.DB.prepare(`SELECT COUNT(*) AS count FROM telemetry_rollups WHERE installation_id = ?`)
      .bind(installation.installationId)
      .first<{ count: number }>();
    expect(rollups?.count).toBe(1);
    const archived = await env.ARCHIVE.list({ prefix: "telemetry/" });
    expect(archived.objects.length).toBeGreaterThan(0);

    // Tampered signature must fail closed
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = "dGFtcGVyZWQtbm9uY2UtMTIzNDU2Nzg5MDEyMzQ1Ng";
    const canonical = ["POST", "/api/v1/installations/lease", installation.installationUuid, String(timestamp), nonce, await sha256Hex(leaseBody)].join("\n");
    const signatureBytes = await ed25519Sign(installation.privateKey, new TextEncoder().encode(canonical));
    // Flip one byte of the decoded signature: rewriting the first base64 character can
    // leave the bytes unchanged when the original first byte already started with 00xxxxxx.
    signatureBytes[0] ^= 0x01;
    const tampered = bytesToBase64(signatureBytes);
    const rejected = await request("/api/v1/installations/lease", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bh-installation": installation.installationUuid,
        "x-bh-timestamp": String(timestamp),
        "x-bh-nonce": nonce,
        "x-bh-signature": tampered,
      },
      body: leaseBody,
    });
    expect(rejected.status).toBe(401);
  });

  it("denies a lease when the license is revoked", async () => {
    await seedProduct();
    const user = await seedUser({ email: "revoked@example.com" });
    const licenseId = await issueLicenseFor(user);
    const installation = await seedInstallation({ user, licenseId });
    await env.DB.prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE id = ?`).bind(now(), licenseId).run();
    const response = await signedPost("/api/v1/installations/lease", "{}", installation);
    expect(response.status).toBe(403);
  });

  it("accepts the Aegishider x-ag signed header set", async () => {
    await seedProduct();
    const user = await seedUser({ email: "ag-headers@example.com" });
    const licenseId = await issueLicenseFor(user);
    const installation = await seedInstallation({ user, licenseId });
    const response = await signedPost(
      "/api/v1/installations/lease",
      JSON.stringify({ plugin_version: "4.0.0" }),
      installation,
      "x-ag",
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { lease: string; key_id: string } };
    expect(payload.data.lease).toContain(".");
    expect(payload.data.key_id).toBeTruthy();
  });

  it("records a multi-IP clone signal for one installation", async () => {
    await seedProduct();
    const user = await seedUser({ email: "clone@example.com" });
    const licenseId = await issueLicenseFor(user);
    const installation = await seedInstallation({ user, licenseId });
    const body = JSON.stringify({
      schema_version: 1,
      plugin_version: "4.0.0",
      minecraft_version: "1.21.4",
      platform: "Paper",
      java_version: "21",
      enabled_modules: [],
      metrics: { tps: 19.9, errors: 0, players_online: 1 },
    });
    const first = await signedPost("/api/v1/installations/heartbeat", body, installation, "x-ag", {
      "cf-connecting-ip": "203.0.113.10",
    });
    expect(first.status).toBe(202);
    const second = await signedPost("/api/v1/installations/heartbeat", body, installation, "x-ag", {
      "cf-connecting-ip": "203.0.113.11",
    });
    expect(second.status).toBe(202);
    const event = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM security_events
        WHERE installation_id = ? AND event_type = 'security.multi_ip'`,
    ).bind(installation.installationId).first<{ count: number }>();
    expect(event?.count).toBe(1);
  });

  it("rejects a mixed x-ag/x-bh signed header set", async () => {
    await seedProduct();
    const user = await seedUser({ email: "mixed-headers@example.com" });
    const licenseId = await issueLicenseFor(user);
    const installation = await seedInstallation({ user, licenseId });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = "bWl4ZWQtaGVhZGVyLW5vbmNlLTEyMzQ1Njc4OTAxMjM0";
    const body = JSON.stringify({ plugin_version: "4.0.0" });
    const canonical = ["POST", "/api/v1/installations/lease", installation.installationUuid, String(timestamp), nonce, await sha256Hex(body)].join("\n");
    const signature = await ed25519Sign(installation.privateKey, new TextEncoder().encode(canonical));
    const response = await request("/api/v1/installations/lease", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ag-installation": installation.installationUuid,
        "x-ag-timestamp": String(timestamp),
        "x-ag-nonce": nonce,
        "x-bh-signature": bytesToBase64(signature),
      },
      body,
    });
    expect(response.status).toBe(401);
  });
});

describe("tenant isolation and admin", () => {
  it("redirects anonymous /admin to the password login", async () => {
    const response = await request("/admin");
    expect([302, 303]).toContain(response.status);
    expect(response.headers.get("location") ?? "").toContain("/auth/login");
  });

  it("keeps customer data scoped to the owning organization", async () => {
    await seedProduct();
    const alice = await seedUser({ email: "alice@example.com" });
    const bob = await seedUser({ email: "bob@example.com" });
    const licenseId = await issueLicenseFor(alice);
    const installation = await seedInstallation({ user: alice, licenseId });
    const aliceSession = await sessionCookie(alice.id);
    const bobSession = await sessionCookie(bob.id);

    expect((await request("/app/licenses", { headers: { cookie: aliceSession } })).status).toBe(200);
    const bobLicense = await request(`/app/licenses/${licenseId}`, { headers: { cookie: bobSession } });
    expect(bobLicense.status).toBe(404);
    const bobServer = await request(`/app/servers/${installation.installationId}`, { headers: { cookie: bobSession } });
    expect(bobServer.status).toBe(404);
    expect((await request("/admin", { headers: { cookie: bobSession } })).status).toBe(403);
  });

  it("lets staff manage products and records an audit trail", async () => {
    await seedProduct();
    const admin = await seedUser({ email: "staff@example.com", role: "super_admin" });
    const cookie = await sessionCookie(admin.id);
    expect((await request("/admin", { headers: { cookie } })).status).toBe(200);

    const created = await formRequest(
      "/admin/products",
      {
        name: "Second Product",
        slug: "second-product",
        tagline: "สินค้าที่สอง",
        description: "รายละเอียด",
        category: "security",
        status: "published",
        price_cents: "0",
        currency: "THB",
        compatibility: '{"minecraft":["1.21.4"]}',
        features: "[]",
        docs_url: "",
        purchase_url: "",
      },
      cookie,
    );
    expect(created.status).toBe(303);
    const publicPage = await request("/plugins/second-product");
    expect(publicPage.status).toBe(200);

    const audit = await env.DB.prepare(`SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'product.create'`).first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });

});

describe("telemetry events", () => {
  it("stores signed events idempotently and creates a security event for errors", async () => {
    await seedProduct();
    const user = await seedUser({ email: "events@example.com" });
    const licenseId = await issueLicenseFor(user);
    const installation = await seedInstallation({ user, licenseId });
    const eventId = crypto.randomUUID();
    const eventBody = JSON.stringify({
      events: [
        {
          event_id: eventId,
          type: "runtime.error",
          severity: "error",
          occurred_at: Math.floor(Date.now() / 1000),
          message: "packet handler failed safely",
          attributes: { module: "packet" },
        },
      ],
    });
    const first = await signedPost("/api/v1/installations/events", eventBody, installation);
    expect(first.status).toBe(202);
    const duplicate = await signedPost("/api/v1/installations/events", eventBody, installation);
    expect(duplicate.status).toBe(202);
    const duplicatePayload = (await duplicate.json()) as { data: { accepted: number; duplicates: number } };
    expect(duplicatePayload.data.accepted).toBe(0);
    expect(duplicatePayload.data.duplicates).toBe(1);

    const stored = await env.DB.prepare(`SELECT id, severity FROM telemetry_events WHERE id = ?`).bind(eventId).first<{ id: string; severity: string }>();
    expect(stored?.severity).toBe("error");

    await processTelemetryMessage(env, {
      kind: "event",
      id: eventId,
      installationId: installation.installationId,
      receivedAt: now(),
    });
    const security = await env.DB.prepare(`SELECT COUNT(*) AS count FROM security_events WHERE id = ?`).bind(`sec_${eventId}`).first<{ count: number }>();
    expect(security?.count).toBe(1);
  });
});

describe("free licensing and activation guard", () => {
  it("registers a server name, issues a 16-character code and auto-provisions a 240-bit free licence", async () => {
    await seedProduct();
    const user = await seedUser({ email: "owner@example.com" });
    const cookie = await sessionCookie(user.id);
    const keyPair = await generateEd25519KeyPair();
    const installationUuid = crypto.randomUUID();
    const fingerprint = await publicKeyFingerprint(keyPair.publicKeyBase64);

    const registered = await request("/api/v1/installations/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product: "test-product",
        installation_uuid: installationUuid,
        public_key: keyPair.publicKeyBase64,
        fingerprint_sha256: fingerprint,
        plugin_version: "3.6.1",
        minecraft_version: "1.21.4",
        platform: "Paper",
        server_name: "Siam SMP",
        java_version: "21",
      }),
    });
    expect(registered.status).toBe(201);
    const registration = (await registered.json()) as {
      data: { activation_code: string; installation_id: string };
    };
    expect(registration.data.activation_code).toMatch(/^[2-9A-HJ-NP-Z]{16}$/);

    const installation = await env.DB.prepare(
      `SELECT server_name, display_name FROM installations WHERE id = ?`,
    )
      .bind(registration.data.installation_id)
      .first<{ server_name: string | null; display_name: string | null }>();
    expect(installation?.server_name).toBe("Siam SMP");
    expect(installation?.display_name).toBe("Siam SMP");

    // The owner has no licence yet: claiming the code must create one for free
    // and return a long random key.
    const claimed = await formRequest(
      "/app/activations",
      { code: registration.data.activation_code },
      cookie,
    );
    expect(claimed.status).toBe(303);

    const licence = await env.DB.prepare(
      `SELECT id, key_prefix, plan_id, expires_at FROM licenses LIMIT 1`,
    ).first<{ id: string; key_prefix: string; plan_id: string | null; expires_at: number | null }>();
    expect(licence).toBeTruthy();
    expect(licence?.plan_id).toBeNull();
    expect(licence?.expires_at).toBeNull();
    expect(licence?.key_prefix).toHaveLength(10);

    const rawKey = await env.CACHE.get(`newlic:${licence!.id}`);
    expect(rawKey).toBeTruthy();
    expect(rawKey).toMatch(/^AG-([2-9A-HJ-NP-Z]{6}-){7}[2-9A-HJ-NP-Z]{6}$/);
    expect(rawKey!.replace(/-/g, "").length).toBe(50);

    const activation = await env.DB.prepare(
      `SELECT status, license_id FROM activations WHERE installation_id = ?`,
    )
      .bind(registration.data.installation_id)
      .first<{ status: string; license_id: string }>();
    expect(activation?.status).toBe("active");
    expect(activation?.license_id).toBe(licence!.id);

    const page = await request("/app/licenses", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("ฟรี 100%");
  });

  it("keeps one open pairing code and re-activates an installation after a reset", async () => {
    await seedProduct();
    const user = await seedUser({ email: "reactivate@example.com" });
    const cookie = await sessionCookie(user.id);
    const keyPair = await generateEd25519KeyPair();
    const installationUuid = crypto.randomUUID();
    const fingerprint = await publicKeyFingerprint(keyPair.publicKeyBase64);

    // The plugin signs registration; a re-registration is only accepted with that signature.
    const register = async () => {
      const body = JSON.stringify({
        product: "test-product",
        installation_uuid: installationUuid,
        public_key: keyPair.publicKeyBase64,
        fingerprint_sha256: fingerprint,
        plugin_version: "3.6.1",
        minecraft_version: "1.21.4",
        platform: "Paper",
        server_name: "Reset SMP",
        java_version: "21",
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
      const canonical = [
        "POST",
        "/api/v1/installations/register",
        installationUuid,
        String(timestamp),
        nonce,
        await sha256Hex(body),
      ].join("\n");
      const signature = await ed25519Sign(keyPair.privateKey, new TextEncoder().encode(canonical));
      const response = await request("/api/v1/installations/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bh-installation": installationUuid,
          "x-bh-timestamp": String(timestamp),
          "x-bh-nonce": nonce,
          "x-bh-signature": bytesToBase64(signature),
        },
        body,
      });
      expect(response.status).toBe(201);
      return (await response.json()) as {
        data: { activation_code: string; installation_id: string };
      };
    };

    // Re-registration supersedes the previous pairing code instead of leaving both usable.
    const first = await register();
    const second = await register();
    expect(second.data.installation_id).toBe(first.data.installation_id);
    const openChallenges = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM activation_challenges
        WHERE installation_id = ? AND consumed_at IS NULL`,
    )
      .bind(first.data.installation_id)
      .first<{ count: number }>();
    expect(openChallenges?.count).toBe(1);

    expect((await formRequest("/app/activations", { code: second.data.activation_code }, cookie)).status).toBe(303);
    const licence = await env.DB.prepare(`SELECT id FROM licenses LIMIT 1`).first<{ id: string }>();
    const activation = await env.DB.prepare(
      `SELECT id FROM activations WHERE installation_id = ? AND status = 'active'`,
    )
      .bind(first.data.installation_id)
      .first<{ id: string }>();
    expect(activation).toBeTruthy();

    const reset = await formRequest(
      `/app/licenses/${licence!.id}/reset`,
      { activation_id: activation!.id },
      cookie,
    );
    expect(reset.status).toBe(303);

    // Re-claiming after a reset must revive the released row: the old code threw a
    // UNIQUE(license_id, installation_id) conflict and left the server unactivatable.
    const third = await register();
    expect((await formRequest("/app/activations", { code: third.data.activation_code }, cookie)).status).toBe(303);
    const revived = await env.DB.prepare(
      `SELECT status, license_id FROM activations WHERE installation_id = ?`,
    )
      .bind(first.data.installation_id)
      .first<{ status: string; license_id: string }>();
    expect(revived?.status).toBe("active");
    expect(revived?.license_id).toBe(licence!.id);
  });

  it("escalates activation lockouts: 5 failures -> 5 minutes, 10 failures -> 10 minutes", async () => {
    const code = await import("../src/services/activation-guard");
    const ip = "test-ip-hash-guard";
    await code.noteActivationRegistration(env, ip, {
      pluginSlug: "test-product",
      serverName: "SMP-A",
      installationId: "ins_a",
    });
    for (let attempt = 1; attempt <= 5; attempt++) {
      await code.recordActivationFailure(env, ip, {});
    }
    let guard = await env.DB.prepare(`SELECT * FROM activation_guard WHERE ip_hash = ?`)
      .bind(ip)
      .first<{ failures: number; locked_until: number }>();
    expect(guard?.failures).toBe(5);
    expect((guard?.locked_until ?? 0) - now()).toBeGreaterThan(4 * 60 * 1000);
    await expect(code.assertActivationAllowed(env, ip)).rejects.toMatchObject({ status: 429 });

    // Simulate the lock expiring, then five more failures must double the lock.
    await env.DB.prepare(`UPDATE activation_guard SET locked_until = ? WHERE ip_hash = ?`)
      .bind(now() - 1000, ip)
      .run();
    for (let attempt = 6; attempt <= 10; attempt++) {
      await code.recordActivationFailure(env, ip, {});
    }
    guard = await env.DB.prepare(`SELECT failures, locked_until FROM activation_guard WHERE ip_hash = ?`)
      .bind(ip)
      .first<{ failures: number; locked_until: number }>();
    expect(guard?.failures).toBe(10);
    expect((guard?.locked_until ?? 0) - now()).toBeGreaterThan(9 * 60 * 1000);

    await code.noteActivationRegistration(env, ip, { serverName: "SMP-B", installationId: "ins_b" });
    const guards = await code.listActivationGuards(env);
    expect(guards[0]?.server_names).toEqual(["SMP-A", "SMP-B"]);
  });
});

describe("admin hierarchy and licence key visibility", () => {
  it("stops an admin from changing roles and hides raw keys from read-only members", async () => {
    await seedProduct();
    const admin = await seedUser({ email: "plain-admin@example.com", role: "admin" });
    const target = await seedUser({ email: "role-target@example.com" });
    const adminCookie = await sessionCookie(admin.id);

    // `admin` sits below `super_admin` and cannot touch settings.write (role changes).
    const roleChange = await formRequest(
      `/admin/customers/${target.id}/role`,
      { role: "super_admin" },
      adminCookie,
    );
    expect(roleChange.status).toBe(403);
    const unchanged = await env.DB.prepare(`SELECT role FROM users WHERE id = ?`)
      .bind(target.id)
      .first<{ role: string }>();
    expect(unchanged?.role).toBe("customer");

    // A read-only organisation member must not receive the one-time raw licence key.
    const readOnly = await seedUser({ email: "readonly@example.com" });
    await env.DB.prepare(`UPDATE organization_members SET role = 'read_only' WHERE user_id = ?`)
      .bind(readOnly.id)
      .run();
    const licenceId = await issueLicenseFor(readOnly);
    await env.CACHE.put(`newlic:${licenceId}`, "AG-SECRET-KEY", { expirationTtl: 600 });
    const page = await request("/app/licenses", { headers: { cookie: await sessionCookie(readOnly.id) } });
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain("AG-SECRET-KEY");
    expect(await env.CACHE.get(`newlic:${licenceId}`)).toBe("AG-SECRET-KEY");
  });
});

describe("admin analytics", () => {
  it("renders the 14-day graphs, detection panels and lockout table", async () => {
    await seedProduct();
    const admin = await seedUser({ email: "admin-dash@example.com", role: "super_admin" });
    const cookie = await sessionCookie(admin.id);

    const dashboard = await request("/admin", { headers: { cookie } });
    expect(dashboard.status).toBe(200);
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain("ข้อมูลเชิงลึก 14 วัน");
    expect(dashboardHtml).toContain("IP ที่กำลังถูกล็อก");
    expect(dashboardHtml).toContain("การตรวจพบตามประเภท");

    const security = await request("/admin/security", { headers: { cookie } });
    expect(security.status).toBe(200);
    expect(await security.text()).toContain("การป้องกันการเดารหัสเปิดใช้งาน");
  });
});

describe("dead letter queue", () => {
  it("persists a poison message, acks it and lets an admin resolve it", async () => {
    await seedProduct();
    const admin = await seedUser({ email: "dlq-admin@example.com", role: "super_admin" });
    const cookie = await sessionCookie(admin.id);
    const messageId = "msg_dlq_test_1";
    const actions: string[] = [];
    const batch = {
      queue: "bhcp-telemetry-dlq",
      messages: [
        {
          id: messageId,
          timestamp: new Date(),
          body: { kind: "event", id: "evt_dlq_1", installationId: "ins_dlq_1", receivedAt: now() },
          attempts: 3,
          ack: () => actions.push("ack"),
          retry: () => actions.push("retry"),
        },
      ],
    } as unknown as MessageBatch<unknown>;

    await handleQueue(batch, env);
    expect(actions).toEqual(["ack"]);

    const row = await env.DB.prepare(
      `SELECT event_id, installation_id, attempts, resolved_at FROM telemetry_dlq WHERE id = ?`,
    )
      .bind(`dlq_${messageId}`)
      .first<{ event_id: string | null; installation_id: string | null; attempts: number; resolved_at: number | null }>();
    expect(row?.event_id).toBe("evt_dlq_1");
    expect(row?.installation_id).toBe("ins_dlq_1");
    expect(row?.attempts).toBe(3);
    expect(row?.resolved_at).toBeNull();

    const page = await request("/admin/security", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("evt_dlq_1");

    const resolved = await formRequest(`/admin/security/dlq/dlq_${messageId}/resolve`, {}, cookie);
    expect(resolved.status).toBe(303);
    const after = await env.DB.prepare(
      `SELECT resolved_at, resolved_by FROM telemetry_dlq WHERE id = ?`,
    )
      .bind(`dlq_${messageId}`)
      .first<{ resolved_at: number | null; resolved_by: string | null }>();
    expect(after?.resolved_at).not.toBeNull();
    expect(after?.resolved_by).toBe(admin.email);

    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'queue.dlq_resolve'`,
    ).first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });
});

describe("observability alerts", () => {
  it("fires and resolves the 5xx and DLQ alerts and shows them to admins", async () => {
    await seedProduct();
    const admin = await seedUser({ email: "obs-admin@example.com", role: "super_admin" });
    const cookie = await sessionCookie(admin.id);
    const timestamp = now();
    const bucket = Math.floor(timestamp / 60000) * 60000;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO metric_counters (bucket_start, total, errors, updated_at) VALUES (?, 200, 10, ?)`,
      ).bind(bucket, timestamp),
      env.DB.prepare(
        `INSERT INTO telemetry_dlq (id, queue, message_id, attempts, payload, failed_at, created_at, updated_at)
         VALUES ('dlq_alert_1', 'bhcp-telemetry-dlq', 'msg_alert_1', 3, '{}', ?, ?, ?)`,
      ).bind(timestamp, timestamp, timestamp),
    ]);

    const firing = await evaluateAlerts(env);
    expect(firing.find((alert) => alert.key === "http.5xx_rate")?.status).toBe("firing");
    expect(firing.find((alert) => alert.key === "queue.dlq_depth")?.status).toBe("firing");
    expect(firing.every((alert) => alert.changed)).toBe(true);

    const dashboard = await request("/admin", { headers: { cookie } });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain("5xx (5 นาที)");

    const security = await request("/admin/security", { headers: { cookie } });
    expect(security.status).toBe(200);
    expect(await security.text()).toContain("queue.dlq_depth");

    // Clearing both conditions resolves the alerts and records the transitions.
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM metric_counters`),
      env.DB.prepare(`UPDATE telemetry_dlq SET resolved_at = ?, resolved_by = 'test' WHERE id = 'dlq_alert_1'`).bind(
        now(),
      ),
    ]);
    const cleared = await evaluateAlerts(env);
    expect(cleared.every((alert) => alert.status === "ok")).toBe(true);
    const states = await listAlertStates(env);
    expect(states).toHaveLength(2);
    expect(states.every((row) => row.resolved_at !== null)).toBe(true);

    const events = await env.DB.prepare(`SELECT COUNT(*) AS count FROM alert_events`).first<{ count: number }>();
    expect(events?.count).toBe(4);
  });

  it("runs the alert tick from the five-minute cron and records the job", async () => {
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    await handleScheduled({ cron: ALERT_CRON } as ScheduledController, env, ctx);
    const job = await env.DB.prepare(`SELECT status FROM job_runs WHERE job = 'scheduled.alerts'`).first<{
      status: string;
    }>();
    expect(job?.status).toBe("ok");
    const states = await listAlertStates(env);
    expect(states.map((row) => row.key).sort()).toEqual(["http.5xx_rate", "queue.dlq_depth"]);
  });

  it("posts records to the configured HTTP sink with the bearer token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      const sinkEnv = {
        ...env,
        OBSERVABILITY_WEBHOOK_URL: "https://sink.example/ingest",
        OBSERVABILITY_WEBHOOK_TOKEN: "sink-token",
      } as typeof env;
      const delivered = await postSink(sinkEnv, [{ type: "alert", event: "alert.firing" }]);
      expect(delivered).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://sink.example/ingest");
      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sink-token");
      const body = JSON.parse(String(calls[0]?.init?.body)) as { records: Array<{ event: string }> };
      expect(body.records[0]?.event).toBe("alert.firing");
    } finally {
      globalThis.fetch = original;
    }
  });
});
