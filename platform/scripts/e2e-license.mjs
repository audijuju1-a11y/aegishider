#!/usr/bin/env node
/**
 * End-to-end licensing smoke test against a running local platform.
 * Simulates the Minecraft plugin: register -> portal claim -> signed lease ->
 * heartbeat -> events, then verifies the issued lease signature locally.
 *
 *   node scripts/e2e-license.mjs [baseUrl]
 */
import crypto from "node:crypto";

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const cookies = new Map();

function capture(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(";")[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
function cookieHeader() {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}
async function req(path, options = {}) {
  const res = await fetch(base + path, {
    ...options,
    redirect: "manual",
    headers: { ...(options.headers || {}), ...(cookies.size ? { cookie: cookieHeader() } : {}) },
  });
  capture(res);
  return res;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
async function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const installationUuid = crypto.randomUUID();
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
const publicKeyB64 = spki.toString("base64");
const fingerprint = crypto.createHash("sha256").update(spki).digest("hex");

// 1. Admin session + CSRF cookie
await req("/auth/login");
const csrf = cookies.get("bh_csrf");
assert(csrf, "missing csrf cookie");
const adminLogin = await req("/auth/dev-admin");
assert(adminLogin.status === 303 || adminLogin.status === 302, `dev-admin failed ${adminLogin.status}`);
assert(cookies.get("bh_session"), "missing admin session cookie");

// 2. Issue a license through the admin form
const issue = await req("/admin/licenses", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: csrf,
    email: "admin@local.test",
    product_id: "prod_aegishider",
    plan_id: "plan_bh_standard",
    activation_limit: "2",
    expires_at: "",
  }).toString(),
});
assert(issue.status === 303, `issue license failed ${issue.status}`);
const licenseLocation = issue.headers.get("location");
assert(licenseLocation && licenseLocation.includes("/admin/licenses/"), "missing license redirect");
const licenseId = licenseLocation.split("/admin/licenses/")[1].split("?")[0];

// 3. Register an installation (unsigned)
const registerBody = JSON.stringify({
  product: "aegishider",
  installation_uuid: installationUuid,
  public_key: publicKeyB64,
  fingerprint_sha256: fingerprint,
  plugin_version: "3.3.0",
  minecraft_version: "1.21.4",
  platform: "Paper",
  java_version: "21",
});
const register = await req("/api/v1/installations/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: registerBody,
});
const registerJson = await register.json();
assert(register.status === 201, `register failed ${register.status} ${JSON.stringify(registerJson)}`);
const { activation_code: activationCode, installation_id: installationId } = registerJson.data;

// 4. Claim activation through the customer portal
const claim = await req("/app/activations", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    _csrf: csrf,
    code: activationCode,
    license_id: licenseId,
  }).toString(),
});
assert(claim.status === 303, `activation claim failed ${claim.status}`);

// 5. Signed lease
const leaseBody = JSON.stringify({ plugin_version: "3.3.0" });
const leasePath = "/api/v1/installations/lease";
const leaseTimestamp = Math.floor(Date.now() / 1000);
const leaseNonce = b64url(crypto.randomBytes(32));
const leaseCanonical = ["POST", leasePath, installationUuid, String(leaseTimestamp), leaseNonce, await sha256Hex(leaseBody)].join("\n");
const leaseSignature = crypto.sign(null, Buffer.from(leaseCanonical), privateKey).toString("base64");
const lease = await req(leasePath, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-bh-installation": installationUuid,
    "x-bh-timestamp": String(leaseTimestamp),
    "x-bh-nonce": leaseNonce,
    "x-bh-signature": leaseSignature,
  },
  body: leaseBody,
});
const leaseJson = await lease.json();
assert(lease.status === 200, `lease failed ${lease.status} ${JSON.stringify(leaseJson)}`);
const [payloadB64, signatureB64] = leaseJson.data.lease.split(".");
const payloadBytes = Buffer.from(payloadB64, "base64url");
const payload = JSON.parse(payloadBytes.toString("utf8"));
assert(payload.installation_uuid === installationUuid, "lease installation mismatch");
assert(payload.license_id === licenseId, "lease license mismatch");
const key = leaseJson.data.keys.find((entry) => entry.key_id === leaseJson.data.key_id) ?? leaseJson.data.keys[0];
const verified = crypto.verify(
  null,
  payloadBytes,
  crypto.createPublicKey({ key: Buffer.from(key.public_key, "base64"), format: "der", type: "spki" }),
  Buffer.from(signatureB64, "base64url"),
);
assert(verified, "lease signature did not verify");

// 6. Signed heartbeat
const heartbeatBody = JSON.stringify({
  schema_version: 1,
  plugin_version: "3.3.0",
  minecraft_version: "1.21.4",
  platform: "Paper",
  java_version: "21",
  enabled_modules: ["block-protection", "item-shield"],
  metrics: {
    tps: 19.96,
    mspt_p50: 0.21,
    mspt_p95: 0.88,
    mspt_p99: 2.9,
    plugin_ms_avg: 0.19,
    errors: 0,
    players_online: 12,
  },
  occurred_at: Math.floor(Date.now() / 1000),
});
async function signedPost(path, body, uuid, privateKeyObj) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = b64url(crypto.randomBytes(32));
  const canonical = ["POST", path, uuid, String(timestamp), nonce, await sha256Hex(body)].join("\n");
  const signature = crypto.sign(null, Buffer.from(canonical), privateKeyObj).toString("base64");
  return req(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bh-installation": uuid,
      "x-bh-timestamp": String(timestamp),
      "x-bh-nonce": nonce,
      "x-bh-signature": signature,
    },
    body,
  });
}
const heartbeat = await signedPost("/api/v1/installations/heartbeat", heartbeatBody, installationUuid, privateKey);
assert(heartbeat.status === 202, `heartbeat failed ${heartbeat.status} ${await heartbeat.text()}`);

// 7. Signed events
const eventBody = JSON.stringify({
  events: [
    {
      event_id: crypto.randomUUID(),
      type: "runtime.startup",
      severity: "info",
      occurred_at: Math.floor(Date.now() / 1000),
      message: "Aegishider started with packet gateway active",
      attributes: { modules: "block-protection,item-shield" },
    },
  ],
});
const events = await signedPost("/api/v1/installations/events", eventBody, installationUuid, privateKey);
assert(events.status === 202, `events failed ${events.status} ${await events.text()}`);

// 8. Replay must be rejected
const replayBody = "{}";
const replayTimestamp = Math.floor(Date.now() / 1000);
const replayNonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const replayCanonical = ["POST", leasePath, installationUuid, String(replayTimestamp), replayNonce, await sha256Hex(replayBody)].join("\n");
const replaySignature = crypto.sign(null, Buffer.from(replayCanonical), privateKey).toString("base64");
const replayHeaders = {
  "content-type": "application/json",
  "x-bh-installation": installationUuid,
  "x-bh-timestamp": String(replayTimestamp),
  "x-bh-nonce": replayNonce,
  "x-bh-signature": replaySignature,
};
const first = await req(leasePath, { method: "POST", headers: replayHeaders, body: replayBody });
const second = await req(leasePath, { method: "POST", headers: replayHeaders, body: replayBody });
assert(first.status === 200, `first replay probe should succeed, got ${first.status}`);
assert(second.status === 409, `replay should be rejected, got ${second.status}`);

// 9. Portal shows the server
const serversPage = await req("/app/servers");
const serversHtml = await serversPage.text();
assert(serversPage.status === 200, "servers page failed");
assert(serversHtml.includes(installationUuid.slice(0, 8)), "server not visible in portal");

console.log(JSON.stringify({
  ok: true,
  installationId,
  installationUuid,
  licenseId,
  activationCode,
  leaseKeyId: leaseJson.data.key_id,
  leaseExpiresAt: payload.expires_at,
  heartbeatStatus: heartbeat.status,
  eventsStatus: events.status,
  replayStatus: second.status,
}, null, 2));
