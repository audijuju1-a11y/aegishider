import fs from "node:fs";
const config = fs.readFileSync("C:/Users/audim_r0h5i/AppData/Roaming/xdg.config/.wrangler/config/default.toml", "utf8");
const token = config.match(/oauth_token = "([^"]+)"/)?.[1];
if (!token) throw new Error("no oauth token");
const accountId = "79f2b029bbf37d1a7c651b98aedda5bd";
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function call(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  console.log(method, path, response.status, JSON.stringify(json?.result ?? json?.errors ?? text).slice(0, 700));
  return { status: response.status, json };
}

let org = await call("GET", "/access/organizations");
if (org.status !== 200) {
  org = await call("POST", "/access/organizations", {
    name: "Aegishider",
    auth_domain: "aegishider-audijuju1",
  });
}
const teamDomain = org.json?.result?.auth_domain;
if (!teamDomain) {
  console.log("cannot determine team domain; stop");
  process.exit(0);
}
let apps = await call("GET", "/access/apps");
let app = (apps.json?.result ?? []).find((item) => item.domain?.includes("aegishider-platform"));
if (!app) {
  const created = await call("POST", "/access/apps", {
    name: "Aegishider Admin",
    domain: "aegishider-platform.audijuju1.workers.dev/admin",
    type: "self_hosted",
    session_duration: "24h",
  });
  app = created.json?.result;
}
if (!app) {
  console.log("app not created; stop");
  process.exit(0);
}
const policies = await call("GET", `/access/apps/${app.id}/policies`);
let policy = (policies.json?.result ?? [])[0];
if (!policy) {
  const ownerEmail = process.env.CF_ACCESS_EMAIL;
  if (!ownerEmail) {
    console.error("CF_ACCESS_EMAIL is required to create the owner policy");
    process.exit(1);
  }
  policy = (await call("POST", `/access/apps/${app.id}/policies`, {
    name: "Owner only",
    decision: "allow",
    include: [{ email: { email: ownerEmail } }],
  })).json?.result;
}
console.log("RESULT", JSON.stringify({ teamDomain, appId: app.id, aud: app.aud, policyId: policy?.id ?? null }));
