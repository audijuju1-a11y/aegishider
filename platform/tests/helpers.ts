import { env, SELF } from "cloudflare:test";
import {
  base64urlEncode,
  bytesToBase64,
  generateEd25519KeyPair,
  newId,
  publicKeyFingerprint,
  ed25519Sign,
  sha256Hex,
} from "../src/lib/core";
import { createSession } from "../src/auth/session";
import { now } from "../src/lib/time";

export const BASE_URL = "https://example.com";
export const CSRF = "test-csrf-token-0123456789abcdef";

export function request(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${BASE_URL}${path}`, { redirect: "manual", ...init });
}

/** Deletes all mutable rows in dependency order so each test starts clean. */
export async function resetDatabase(): Promise<void> {
  const tables = [
    "activation_guard", "payment_slips", "blacklist_entries",
    "email_otp", "payment_events", "wallet_transactions", "topup_orders", "wallets",
    "payment_webhook_events", "payment_orders", "admin_audit_events", "notifications",
    "support_messages", "support_tickets", "security_events", "telemetry_dlq", "telemetry_events",
    "telemetry_rollups", "heartbeat_latest", "license_leases", "activation_nonces",
    "activation_challenges", "activations", "installations", "licenses",
    "product_releases", "product_plans", "products", "email_tokens", "email_log",
    "sessions", "organization_members", "organizations", "users", "contact_messages",
    "job_runs", "rate_limits", "metric_counters", "alert_state", "alert_events",
    "recovery_codes",
  ];
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.batch([
    env.DB.prepare(`UPDATE system_settings SET value = '0' WHERE key LIKE 'telemetry.%'`),
    env.DB.prepare(`DELETE FROM system_settings WHERE key NOT IN ('telemetry.retention_days','telemetry.last_processed_at','telemetry.processed_batches','platform.registration_open')`),
  ]);
}

export async function seedProduct(): Promise<void> {
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO products (id, slug, name, tagline, description, category, status, featured,
        price_cents, currency, compatibility, features, created_at, updated_at, published_at)
       VALUES ('prod_test', 'test-product', 'Test Product', 'คำโปรยทดสอบ', 'คำอธิบายทดสอบ',
        'security', 'published', 1, 0, 'THB',
        '{"minecraft":["1.21.4"],"servers":["Paper"],"java":["21"]}',
        '[{"title":"ฟีเจอร์","description":"รายละเอียด"}]', ?, ?, ?)`,
    ).bind(timestamp, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO product_plans (id, product_id, code, name, price_cents, currency, billing_interval,
        entitlements, activation_limit, active, created_at, updated_at)
       VALUES ('plan_test', 'prod_test', 'standard', 'Standard', 0, 'THB', 'one_time',
        '["test:feature"]', 2, 1, ?, ?)`,
    ).bind(timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO product_releases (id, product_id, version, channel, status, notes,
        supported_minecraft, supported_java, supported_platforms, artifact_url, artifact_sha256, released_at, created_at)
       VALUES ('rel_test', 'prod_test', '1.0.0', 'stable', 'published', 'initial',
        '["1.21.4"]', '["21"]', '["Paper"]', '/download/Aegishider-3.6.1.jar', NULL, ?, ?)`,
    ).bind(timestamp, timestamp),
  ]);
}

export interface TestUser {
  id: string;
  email: string;
  role: string;
  orgId: string;
  slug: string;
}

export async function seedUser(options: {
  email: string;
  role?: string;
  status?: string;
}): Promise<TestUser> {
  const id = newId("usr");
  const orgId = newId("org");
  const slug = `org-${id.slice(-8).toLowerCase()}`;
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, display_name, role, status, locale, email_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'th', ?, ?, ?)`,
    ).bind(id, options.email.toLowerCase(), options.email.split("@")[0], options.role ?? "customer", options.status ?? "active", timestamp, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(orgId, `${options.email.split("@")[0]} org`, slug, id, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
    ).bind(orgId, id, timestamp),
  ]);
  return { id, email: options.email.toLowerCase(), role: options.role ?? "customer", orgId, slug };
}

export async function sessionCookie(userId: string): Promise<string> {
  const session = await createSession(env, userId, { ipHash: null, userAgent: "vitest" });
  return `bh_session=${session.token}; bh_csrf=${CSRF}`;
}

export function formRequest(
  path: string,
  values: Record<string, string>,
  cookie: string,
  method = "POST",
): Promise<Response> {
  return request(path, {
    method,
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ _csrf: CSRF, ...values }).toString(),
  });
}

export interface InstallationFixture {
  installationId: string;
  installationUuid: string;
  publicKeyBase64: string;
  privateKey: CryptoKey;
  licenseId: string;
  activationCode?: string;
}

export async function issueLicenseFor(user: TestUser, options: { activationLimit?: number } = {}): Promise<string> {
  const id = newId("lic");
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO licenses (id, product_id, plan_id, org_id, owner_user_id, key_prefix, key_hash,
      status, activation_limit, entitlements, issued_at, expires_at, created_at, updated_at)
     VALUES (?, 'prod_test', 'plan_test', ?, ?, 'TESTPREFIX', ?, 'active', ?, '["test:feature"]', ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      user.orgId,
      user.id,
      `hash_${id}`,
      options.activationLimit ?? 2,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  return id;
}

export async function seedInstallation(options: {
  user: TestUser;
  licenseId: string;
  status?: string;
  withActivation?: boolean;
}): Promise<InstallationFixture> {
  const keyPair = await generateEd25519KeyPair();
  const uuid = crypto.randomUUID();
  const fingerprint = await publicKeyFingerprint(keyPair.publicKeyBase64);
  const installationId = newId("ins");
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO installations (id, license_id, org_id, product_id, installation_uuid, public_key,
      fingerprint_sha256, display_name, plugin_version, minecraft_version, platform, java_version,
      status, first_seen_at, last_heartbeat_at, created_at, updated_at)
     VALUES (?, ?, ?, 'prod_test', ?, ?, ?, 'Test Server', '3.3.0', '1.21.4', 'Paper', '21',
      ?, ?, NULL, ?, ?)`,
  )
    .bind(
      installationId,
      options.licenseId,
      options.user.orgId,
      uuid,
      keyPair.publicKeyBase64,
      fingerprint,
      options.status ?? "active",
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  if (options.withActivation !== false) {
    await env.DB.prepare(
      `INSERT INTO activations (id, license_id, installation_id, status, activated_at, last_seen_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
      .bind(newId("act"), options.licenseId, installationId, timestamp, timestamp)
      .run();
  }
  return {
    installationId,
    installationUuid: uuid,
    publicKeyBase64: keyPair.publicKeyBase64,
    privateKey: keyPair.privateKey,
    licenseId: options.licenseId,
  };
}

export async function signedPost(
  path: string,
  body: string,
  installation: InstallationFixture,
  headerPrefix: "x-bh" | "x-ag" = "x-bh",
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const bodyHash = await sha256Hex(body);
  const canonical = ["POST", path, installation.installationUuid, String(timestamp), nonce, bodyHash].join("\n");
  const signature = await ed25519Sign(installation.privateKey, new TextEncoder().encode(canonical));
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [`${headerPrefix}-installation`]: installation.installationUuid,
      [`${headerPrefix}-timestamp`]: String(timestamp),
      [`${headerPrefix}-nonce`]: nonce,
      [`${headerPrefix}-signature`]: bytesToBase64(signature),
      ...extraHeaders,
    },
    body,
  });
}

export function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

export function html(response: Response): Promise<string> {
  return response.text();
}
