#!/usr/bin/env node
/**
 * Claims an activation code for a test installation using the local admin console.
 * Used by the plugin-client smoke test.
 *
 *   node scripts/claim-activation.mjs <activationCode> [baseUrl]
 */
const base = (process.argv[3] || "http://127.0.0.1:8787").replace(/\/$/, "");
const code = process.argv[2];
if (!code) {
  console.error("usage: node scripts/claim-activation.mjs <activationCode> [baseUrl]");
  process.exit(2);
}

const cookies = new Map();
function capture(response) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(";")[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    redirect: "manual",
    headers: { ...(options.headers || {}), ...(cookies.size ? { cookie: cookieHeader() } : {}) },
  });
  capture(response);
  return response;
}
function cookieHeader() {
  return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
}

await request("/auth/login");
const csrf = cookies.get("bh_csrf");
if (!csrf) throw new Error("missing csrf cookie");
const login = await request("/auth/dev-admin");
if (login.status !== 303) throw new Error(`dev-admin failed ${login.status}`);

const issue = await request("/admin/licenses", {
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
if (issue.status !== 303) throw new Error(`issue license failed ${issue.status}`);
const licenseId = issue.headers.get("location").split("/admin/licenses/")[1].split("?")[0];

const claim = await request("/app/activations", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: csrf, code, license_id: licenseId }).toString(),
});
if (claim.status !== 303) throw new Error(`claim failed ${claim.status}: ${await claim.text()}`);
console.log(JSON.stringify({ ok: true, activationCode: code, licenseId }));
