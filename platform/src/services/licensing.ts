import type { Env } from "../env";
import { configError } from "../lib/errors";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors";
import {
  base64ToBytes,
  base64urlEncode,
  base64urlDecode,
  ed25519Sign,
  ed25519Verify,
  hmacSha256Hex,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  newActivationCode,
  newId,
  newLicenseKey,
  normalizeActivationCode,
  normalizeLicenseKey,
  publicKeyFingerprint,
  sha256Hex,
  timingSafeEqual,
} from "../lib/core";
import { canonicalJson, HOUR, MINUTE, now, safeJsonParse } from "../lib/time";
import { affected, all, first, run } from "../lib/db";
import { recordSecurityEvent } from "./audit";
import {
  assertActivationAllowed,
  recordActivationFailure,
  resetActivationGuard,
} from "./activation-guard";
import type { SessionUser } from "../auth/session";

/* -------------------------------------------------------------------------- */
/* Signing keys                                                               */
/* -------------------------------------------------------------------------- */

export interface SigningContext {
  keyId: string;
  privateKey: CryptoKey;
  publicKeyBase64: string;
}

let signingCache: { fingerprint: string; context: SigningContext } | null = null;

export async function getSigningContext(env: Env): Promise<SigningContext> {
  const privateBase64 = env.LICENSE_SIGNING_KEY;
  const publicBase64 = env.LICENSE_PUBLIC_KEY;
  const keyId = env.LICENSE_SIGNING_KEY_ID || "default";
  if (!privateBase64 || !publicBase64) {
    throw configError("ยังไม่ได้ตั้งค่ากุญแจลงนามไลเซนส์ (LICENSE_SIGNING_KEY / LICENSE_PUBLIC_KEY)");
  }
  const fingerprint = await sha256Hex(`${keyId}:${privateBase64}:${publicBase64}`);
  if (signingCache && signingCache.fingerprint === fingerprint) return signingCache.context;
  let privateKey: CryptoKey;
  try {
    privateKey = await importEd25519PrivateKey(privateBase64);
    await importEd25519PublicKey(publicBase64);
  } catch {
    throw configError("กุญแจลงนามไลเซนส์ไม่ถูกต้อง");
  }
  const context: SigningContext = { keyId, privateKey, publicKeyBase64: publicBase64 };
  signingCache = { fingerprint, context };
  return context;
}

/** Registers the configured key in the public key registry (idempotent, no rotation). */
export async function ensureSigningKey(env: Env): Promise<SigningContext> {
  const context = await getSigningContext(env);
  const existing = await first<{ public_key: string; status: string }>(
    env.DB,
    `SELECT public_key, status FROM signing_keys WHERE key_id = ?`,
    context.keyId,
  );
  if (existing) {
    if (existing.public_key !== context.publicKeyBase64) {
      throw configError(
        `key_id ${context.keyId} มี public key อยู่แล้วแต่ไม่ตรงกับคีย์ปัจจุบัน — ห้ามใช้ key_id ซ้ำกับกุญแจใหม่`,
      );
    }
    if (existing.status === "revoked") throw configError("กุญแจลงนามนี้ถูกเพิกถอนแล้ว");
    return context;
  }
  await run(
    env.DB,
    `INSERT INTO signing_keys (key_id, algorithm, public_key, status, created_at)
     VALUES (?, 'Ed25519', ?, 'active', ?)`,
    context.keyId,
    context.publicKeyBase64,
    now(),
  );
  return context;
}

export interface PublicKeyRecord {
  key_id: string;
  public_key: string;
  status: string;
  created_at: number;
}

export async function activePublicKeys(env: Env): Promise<PublicKeyRecord[]> {
  return all<PublicKeyRecord>(
    env.DB,
    `SELECT key_id, public_key, status, created_at FROM signing_keys
      WHERE status != 'revoked' ORDER BY created_at DESC`,
  );
}

/* -------------------------------------------------------------------------- */
/* License keys                                                               */
/* -------------------------------------------------------------------------- */

export async function hashLicenseKey(env: Env, rawKey: string): Promise<string> {
  const pepper = env.LICENSE_KEY_PEPPER;
  if (!pepper) throw configError("ยังไม่ได้ตั้งค่า LICENSE_KEY_PEPPER");
  return hmacSha256Hex(pepper, `license:${normalizeLicenseKey(rawKey)}`);
}

export function licensePrefix(rawKey: string): string {
  return normalizeLicenseKey(rawKey).slice(0, 10);
}

export interface IssueLicenseInput {
  productId: string;
  planId: string | null;
  orgId: string;
  ownerUserId: string;
  activationLimit: number;
  expiresAt: number | null;
  createdBy: string | null;
  entitlements?: string[];
  reason?: string;
  /** Refuse to create a second active licence for the same org + product (free tier). */
  onlyIfNoActive?: boolean;
}

export interface IssuedLicense {
  id: string;
  rawKey: string;
  prefix: string;
  expiresAt: number | null;
}

export async function issueLicense(env: Env, input: IssueLicenseInput): Promise<IssuedLicense | null> {
  const product = await first<{ id: string; slug: string; status: string }>(
    env.DB,
    `SELECT id, slug, status FROM products WHERE id = ?`,
    input.productId,
  );
  if (!product) throw notFound("ไม่พบผลิตภัณฑ์");
  if (product.status === "archived") throw badRequest("ผลิตภัณฑ์นี้ถูกเก็บถาวรแล้ว");

  let entitlements = input.entitlements ?? [];
  if (input.planId) {
    const plan = await first<{ entitlements: string; active: number }>(
      env.DB,
      `SELECT entitlements, active FROM product_plans WHERE id = ? AND product_id = ?`,
      input.planId,
      input.productId,
    );
    if (!plan) throw badRequest("ไม่พบแพ็กเกจที่เลือก");
    if (!plan.active) throw badRequest("แพ็กเกจนี้ปิดใช้งานอยู่");
    entitlements = safeJsonParse<string[]>(plan.entitlements, []);
  }

  const activationLimit = Math.max(0, Math.min(1000, Math.trunc(input.activationLimit)));
  const licenseId = newId("lic");
  const createdAt = now();
  let rawKey = "";
  let keyHash = "";

  const uniqueActive = input.onlyIfNoActive === true;
  for (let attempt = 0; attempt < 4; attempt++) {
    rawKey = newLicenseKey("AG");
    keyHash = await hashLicenseKey(env, rawKey);
    try {
      const columns = `(
           id, product_id, plan_id, org_id, owner_user_id, key_prefix, key_hash, status,
           activation_limit, entitlements, issued_at, expires_at, created_by, created_at, updated_at
         )`;
      const values = [
        licenseId,
        input.productId,
        input.planId,
        input.orgId,
        input.ownerUserId,
        licensePrefix(rawKey),
        keyHash,
        activationLimit,
        JSON.stringify(entitlements),
        createdAt,
        input.expiresAt,
        input.createdBy,
        createdAt,
        createdAt,
      ] as const;
      // The guarded form re-checks "no active licence for this org+product" inside the
      // INSERT, so two concurrent free-licence requests cannot both create one.
      const statement = uniqueActive
        ? env.DB.prepare(
            `INSERT INTO licenses ${columns}
             SELECT ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM licenses
                 WHERE org_id = ? AND product_id = ? AND status = 'active'
                   AND (expires_at IS NULL OR expires_at > ?)
              )`,
          ).bind(...values, input.orgId, input.productId, createdAt)
        : env.DB.prepare(`INSERT INTO licenses ${columns} VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`).bind(
            ...values,
          );
      const result = await statement.run();
      if (affected(result) === 0) return null;
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }

  return { id: licenseId, rawKey, prefix: licensePrefix(rawKey), expiresAt: input.expiresAt };
}

export interface LicenseRow {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  plan_id: string | null;
  plan_name: string | null;
  org_id: string;
  owner_user_id: string;
  key_prefix: string;
  status: string;
  activation_limit: number;
  entitlements: string;
  issued_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  revoke_reason: string | null;
  created_at: number;
  updated_at: number;
  active_activations: number;
  installation_count: number;
}

const LICENSE_SELECT = `
  SELECT l.*, p.name AS product_name, p.slug AS product_slug, pl.name AS plan_name,
         (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.status = 'active') AS active_activations,
         (SELECT COUNT(*) FROM installations i WHERE i.license_id = l.id) AS installation_count
    FROM licenses l
    JOIN products p ON p.id = l.product_id
    LEFT JOIN product_plans pl ON pl.id = l.plan_id`;

export async function listLicensesForUser(env: Env, userId: string): Promise<LicenseRow[]> {
  return all<LicenseRow>(
    env.DB,
    `${LICENSE_SELECT}
      WHERE l.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)
      ORDER BY l.created_at DESC`,
    userId,
  );
}

export async function getLicenseForUser(
  env: Env,
  userId: string,
  licenseId: string,
): Promise<LicenseRow | null> {
  return first<LicenseRow>(
    env.DB,
    `${LICENSE_SELECT}
      WHERE l.id = ?
        AND l.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)`,
    licenseId,
    userId,
  );
}

export async function getLicenseRow(env: Env, licenseId: string): Promise<LicenseRow | null> {
  return first<LicenseRow>(env.DB, `${LICENSE_SELECT} WHERE l.id = ?`, licenseId);
}

export async function listLicenseActivations(env: Env, licenseId: string) {
  return all<{
    id: string;
    installation_id: string;
    installation_uuid: string;
    fingerprint_sha256: string;
    display_name: string | null;
    plugin_version: string | null;
    minecraft_version: string | null;
    platform: string | null;
    status: string;
    activated_at: number;
    last_seen_at: number | null;
    last_heartbeat_at: number | null;
  }>(
    env.DB,
    `SELECT a.id, a.installation_id, i.installation_uuid, i.fingerprint_sha256, i.display_name,
            i.plugin_version, i.minecraft_version, i.platform, a.status, a.activated_at,
            a.last_seen_at, i.last_heartbeat_at
       FROM activations a
       JOIN installations i ON i.id = a.installation_id
      WHERE a.license_id = ?
      ORDER BY a.activated_at DESC`,
    licenseId,
  );
}

export async function setLicenseStatus(
  env: Env,
  licenseId: string,
  status: "active" | "suspended" | "revoked" | "expired",
  reason: string | null,
): Promise<void> {
  const timestamp = now();
  await run(
    env.DB,
    `UPDATE licenses SET status = ?, updated_at = ?,
       revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END,
       revoke_reason = CASE WHEN ? = 'revoked' THEN ? ELSE revoke_reason END
     WHERE id = ?`,
    status,
    timestamp,
    status,
    timestamp,
    status,
    reason,
    licenseId,
  );
  if (status === "revoked" || status === "suspended") {
    await run(env.DB, `UPDATE activations SET status = 'revoked' WHERE license_id = ? AND status = 'active'`, licenseId);
    await run(
      env.DB,
      `UPDATE installations SET status = ?, updated_at = ? WHERE license_id = ?`,
      status === "revoked" ? "revoked" : "suspended",
      timestamp,
      licenseId,
    );
  }
}

export async function extendLicense(env: Env, licenseId: string, expiresAt: number | null): Promise<void> {
  await run(env.DB, `UPDATE licenses SET expires_at = ?, updated_at = ? WHERE id = ?`, expiresAt, now(), licenseId);
}

export async function setActivationLimit(env: Env, licenseId: string, limit: number): Promise<void> {
  await run(
    env.DB,
    `UPDATE licenses SET activation_limit = ?, updated_at = ? WHERE id = ?`,
    Math.max(0, Math.min(1000, Math.trunc(limit))),
    now(),
    licenseId,
  );
}

/* -------------------------------------------------------------------------- */
/* Installations                                                              */
/* -------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InstallationRow {
  id: string;
  license_id: string | null;
  org_id: string | null;
  product_id: string;
  product_name: string;
  product_slug: string;
  installation_uuid: string;
  public_key: string;
  fingerprint_sha256: string;
  display_name: string | null;
  plugin_version: string | null;
  minecraft_version: string | null;
  platform: string | null;
  java_version: string | null;
  status: string;
  first_seen_at: number;
  last_heartbeat_at: number | null;
  created_at: number;
  updated_at: number;
  license_status: string | null;
  license_expires_at: number | null;
  license_prefix: string | null;
  active_activation_id: string | null;
}

const INSTALLATION_SELECT = `
  SELECT i.*, p.name AS product_name, p.slug AS product_slug,
         l.status AS license_status, l.expires_at AS license_expires_at, l.key_prefix AS license_prefix,
         (SELECT a.id FROM activations a WHERE a.installation_id = i.id AND a.status = 'active' LIMIT 1) AS active_activation_id
    FROM installations i
    JOIN products p ON p.id = i.product_id
    LEFT JOIN licenses l ON l.id = i.license_id`;

export interface RegisterInstallationInput {
  productSlug: string;
  installationUuid: string;
  publicKey: string;
  fingerprint: string;
  pluginVersion: string;
  minecraftVersion: string;
  platform: string;
  serverName?: string | null;
  javaVersion: string;
}

export interface RegisteredInstallation {
  installationId: string;
  activationCode: string | null;
  activationExpiresAt: number | null;
  portalUrl: string;
  reused: boolean;
}

export async function registerInstallation(
  env: Env,
  input: RegisterInstallationInput,
  options: { signedReregistration?: boolean } = {},
): Promise<RegisteredInstallation> {
  if (!UUID_RE.test(input.installationUuid)) throw badRequest("installation_uuid ไม่ถูกต้อง");
  const product = await first<{ id: string; slug: string; status: string }>(
    env.DB,
    `SELECT id, slug, status FROM products WHERE slug = ?`,
    input.productSlug,
  );
  if (!product) throw notFound("ไม่พบผลิตภัณฑ์นี้");
  if (product.status !== "published" && product.status !== "coming_soon") {
    throw badRequest("ผลิตภัณฑ์นี้ยังไม่เปิดให้ลงทะเบียน");
  }

  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = base64ToBytes(input.publicKey);
    if (publicKeyBytes.length < 40 || publicKeyBytes.length > 200) throw new Error("length");
    await importEd25519PublicKey(input.publicKey);
  } catch {
    throw badRequest("public_key ไม่ใช่กุญแจ Ed25519 SPKI ที่ถูกต้อง");
  }
  const fingerprint = await publicKeyFingerprint(input.publicKey);
  if (fingerprint !== input.fingerprint.toLowerCase()) {
    throw badRequest("fingerprint_sha256 ไม่ตรงกับ public_key");
  }
  const blocked = await first<{ id: string }>(
    env.DB,
    `SELECT id FROM blacklist_entries
      WHERE fingerprint_sha256 = ? OR installation_uuid = ? LIMIT 1`,
    fingerprint,
    input.installationUuid,
  );
  if (blocked) throw forbidden("installation นี้ถูกขึ้นบัญชีดำ");

  const existing = await first<{ id: string; public_key: string; status: string }>(
    env.DB,
    `SELECT id, public_key, status FROM installations WHERE installation_uuid = ?`,
    input.installationUuid,
  );
  const normalizedServerName = input.serverName?.trim().slice(0, 64) || null;
  if (existing) {
    if (!timingSafeEqual(existing.public_key, input.publicKey)) {
      throw conflict("installation_uuid นี้ลงทะเบียนด้วยกุญแจอื่นแล้ว");
    }
    if (existing.status === "revoked") throw forbidden("installation นี้ถูกเพิกถอน");
    // installation_uuid and public_key are not secrets (they travel in every request and
    // appear in the portal). Without proof of possession anyone who saw them could obtain
    // a fresh pairing code and bind the victim's server to their own account.
    if (!options.signedReregistration) {
      throw unauthorized("การลงทะเบียนซ้ำต้องลงนามด้วยกุญแจของ installation เดิม");
    }
    if (normalizedServerName) {
      await run(
        env.DB,
        `UPDATE installations SET server_name = ?, display_name = ?, updated_at = ? WHERE id = ?`,
        normalizedServerName,
        normalizedServerName,
        now(),
        existing.id,
      );
    }
    // Re-registration: issue a fresh pairing code so the owner can link again.
    const challenge = await createActivationChallenge(env, existing.id);
    return {
      installationId: existing.id,
      activationCode: challenge.code,
      activationExpiresAt: challenge.expiresAt,
      portalUrl: `${env.APP_URL.replace(/\/$/, "")}/app/activations`,
      reused: true,
    };
  }

  const installationId = newId("ins");
  const timestamp = now();
  await run(
    env.DB,
    `INSERT INTO installations (
       id, product_id, installation_uuid, public_key, fingerprint_sha256, display_name,
       plugin_version, minecraft_version, platform, java_version, server_name, status,
       first_seen_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    installationId,
    product.id,
    input.installationUuid,
    input.publicKey,
    fingerprint,
    normalizedServerName ?? `Server ${input.installationUuid.slice(0, 8)}`,
    input.pluginVersion,
    input.minecraftVersion,
    input.platform,
    input.javaVersion,
    normalizedServerName,
    timestamp,
    timestamp,
    timestamp,
  );

  const challenge = await createActivationChallenge(env, installationId);
  await recordSecurityEvent(env, {
    eventType: "installation.registered",
    severity: "info",
    installationId,
    details: { product: product.slug, fingerprint: fingerprint.slice(0, 12) },
  });

  return {
    installationId,
    activationCode: challenge.code,
    activationExpiresAt: challenge.expiresAt,
    portalUrl: `${env.APP_URL.replace(/\/$/, "")}/app/activations`,
    reused: false,
  };
}

async function createActivationChallenge(
  env: Env,
  installationId: string,
): Promise<{ code: string; expiresAt: number }> {
  const pepper = env.LICENSE_KEY_PEPPER;
  if (!pepper) throw configError("ยังไม่ได้ตั้งค่า LICENSE_KEY_PEPPER");
  const code = newActivationCode(16);
  const codeHash = await hmacSha256Hex(pepper, `activation:${code}`);
  const timestamp = now();
  const expiresAt = timestamp + 24 * HOUR;
  // A new code supersedes every older unconsumed code for this installation, so exactly
  // one pairing code is valid at a time and abandoned codes cannot pile up.
  await run(
    env.DB,
    `UPDATE activation_challenges SET consumed_at = ? WHERE installation_id = ? AND consumed_at IS NULL`,
    timestamp,
    installationId,
  );
  await run(
    env.DB,
    `INSERT INTO activation_challenges (id, installation_id, code_hash, code_prefix, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    newId("chl"),
    installationId,
    codeHash,
    code.slice(0, 3),
    expiresAt,
    timestamp,
  );
  return { code, expiresAt };
}

export interface ClaimResult {
  installationId: string;
  licenseId: string;
  productSlug: string;
  licenseKey: string | null;
  freeLicenseCreated: boolean;
}

const FREE_ENTITLEMENTS: Record<string, string[]> = {
  aegishider: [
    "aegishider:block-protection",
    "aegishider:item-shield",
    "aegishider:diagnostics",
    "aegishider:telemetry",
  ],
};

/**
 * Free self-service licence. Every product is free; the key is generated with
 * 240 bits of entropy and shown to the owner once through the CACHE-backed
 * "new licence" slot (same mechanism as admin-issued licences).
 */
async function createFreeLicense(
  env: Env,
  user: SessionUser,
  productId: string,
  productSlug: string,
): Promise<LicenseRow | null> {
  const orgId = user.memberships[0]?.orgId;
  if (!orgId) throw badRequest("บัญชีนี้ยังไม่มีองค์กรสำหรับออกไลเซนส์");
  const issued = await issueLicense(env, {
    productId,
    planId: null,
    orgId,
    ownerUserId: user.id,
    activationLimit: 5,
    expiresAt: null,
    createdBy: user.id,
    entitlements: FREE_ENTITLEMENTS[productSlug] ?? ["free"],
    reason: "free self-service",
    onlyIfNoActive: true,
  });
  if (!issued) return null;
  // Shown once, soon after issue; a long-lived KV copy of the raw key is unnecessary risk.
  await env.CACHE.put(`newlic:${issued.id}`, issued.rawKey, { expirationTtl: 600 });
  const row = await getLicenseRow(env, issued.id);
  if (!row) throw notFound("ไม่พบไลเซนส์ที่สร้างใหม่");
  await recordSecurityEvent(env, {
    eventType: "license.free_issued",
    severity: "info",
    userId: user.id,
    details: { license_prefix: issued.prefix, product: productSlug },
  });
  return row;
}

/**
 * Idempotent: returns the user's active licence for the product, creating one
 * free of charge on first use (portal visit, activation click or signup).
 */
export async function ensureFreeLicenseForUser(
  env: Env,
  user: SessionUser,
  productSlug = "aegishider",
): Promise<{ license: LicenseRow | null; created: boolean }> {
  const product = await first<{ id: string; slug: string }>(
    env.DB,
    `SELECT id, slug FROM products WHERE slug = ? AND status IN ('published','coming_soon')`,
    productSlug,
  );
  if (!product) return { license: null, created: false };
  const existing = await findActiveLicenseForUser(env, product.id, user.id);
  if (existing) return { license: existing, created: false };
  const created = await createFreeLicense(env, user, product.id, product.slug);
  if (created) return { license: created, created: true };
  // A concurrent request created the free licence between the SELECT and the guarded INSERT.
  return { license: await findActiveLicenseForUser(env, product.id, user.id), created: false };
}

async function findActiveLicenseForUser(
  env: Env,
  productId: string,
  userId: string,
): Promise<LicenseRow | null> {
  return first<LicenseRow>(
    env.DB,
    `${LICENSE_SELECT}
      WHERE l.product_id = ?
        AND l.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)
        AND l.status = 'active'
        AND (l.expires_at IS NULL OR l.expires_at > ?)
      ORDER BY l.created_at DESC
      LIMIT 1`,
    productId,
    userId,
    now(),
  );
}

export async function claimActivation(
  env: Env,
  user: SessionUser,
  rawCode: string,
  licenseId?: string,
  ipHash?: string | null,
): Promise<ClaimResult> {
  await assertActivationAllowed(env, ipHash);
  try {
    const result = await claimActivationInner(env, user, rawCode, licenseId);
    await resetActivationGuard(env, ipHash);
    return result;
  } catch (error) {
    if (error instanceof AppError && error.status < 500) {
      const state = await recordActivationFailure(env, ipHash, {});
      await recordSecurityEvent(env, {
        eventType: "activation.failed",
        severity: state?.lockedUntil ? "warning" : "info",
        userId: user.id,
        ipHash: ipHash ?? null,
        details: {
          status: error.status,
          code: error.code,
          failures: state?.failures ?? null,
          locked_until: state?.lockedUntil ?? null,
        },
      });
    }
    throw error;
  }
}

async function claimActivationInner(
  env: Env,
  user: SessionUser,
  rawCode: string,
  licenseId?: string,
): Promise<ClaimResult> {
  const code = normalizeActivationCode(rawCode);
  if (code.length < 8 || code.length > 32) throw badRequest("รหัสเปิดใช้งานไม่ถูกต้อง");
  const pepper = env.LICENSE_KEY_PEPPER;
  if (!pepper) throw configError("ยังไม่ได้ตั้งค่า LICENSE_KEY_PEPPER");
  const codeHash = await hmacSha256Hex(pepper, `activation:${code}`);

  const challenge = await first<{
    id: string;
    installation_id: string;
    expires_at: number;
    consumed_at: number | null;
    attempts: number;
  }>(
    env.DB,
    `SELECT id, installation_id, expires_at, consumed_at, attempts
       FROM activation_challenges WHERE code_hash = ?`,
    codeHash,
  );
  if (!challenge) throw badRequest("รหัสเปิดใช้งานไม่ถูกต้องหรือหมดอายุแล้ว");
  if (challenge.consumed_at) throw badRequest("รหัสนี้ถูกใช้ไปแล้ว");
  if (challenge.expires_at < now()) throw badRequest("รหัสเปิดใช้งานหมดอายุแล้ว กรุณาสร้างรหัสใหม่จากปลั๊กอิน");
  if (challenge.attempts >= 10) throw badRequest("พยายามใช้รหัสนี้มากเกินไป กรุณาสร้างรหัสใหม่");

  await run(env.DB, `UPDATE activation_challenges SET attempts = attempts + 1 WHERE id = ?`, challenge.id);

  const installation = await first<{
    id: string;
    product_id: string;
    product_slug: string;
    status: string;
    license_id: string | null;
  }>(
    env.DB,
    `SELECT i.id, i.product_id, p.slug AS product_slug, i.status, i.license_id
       FROM installations i JOIN products p ON p.id = i.product_id
      WHERE i.id = ?`,
    challenge.installation_id,
  );
  if (!installation) throw notFound("ไม่พบการติดตั้งนี้");
  if (installation.status === "revoked") throw forbidden("installation นี้ถูกเพิกถอน");

  let candidates = await all<LicenseRow>(
    env.DB,
    `${LICENSE_SELECT}
      WHERE l.product_id = ?
        AND l.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)
        AND l.status = 'active'
        AND (l.expires_at IS NULL OR l.expires_at > ?)
      ORDER BY l.created_at DESC`,
    installation.product_id,
    user.id,
    now(),
  );
  let freeLicenseCreated = false;
  let licenseKey: string | null = null;
  if (candidates.length === 0) {
    // Free platform: clicking activate provisions a licence automatically with a
    // long random key; the owner never has to buy or wait for staff.
    const ensured = await ensureFreeLicenseForUser(env, user, installation.product_slug);
    if (ensured.license) {
      candidates = [ensured.license];
      freeLicenseCreated = ensured.created;
      licenseKey = ensured.created ? await env.CACHE.get(`newlic:${ensured.license.id}`) : null;
    }
  }
  if (candidates.length === 0) throw badRequest("คุณยังไม่มีไลเซนส์ที่ใช้งานได้สำหรับผลิตภัณฑ์นี้");
  const license = licenseId
    ? candidates.find((candidate) => candidate.id === licenseId)
    : candidates.find((candidate) => candidate.active_activations < candidate.activation_limit) ?? candidates[0];
  if (!license) throw forbidden("ไม่พบไลเซนส์ที่เลือก หรือไลเซนส์ไม่ใช่ของคุณ");
  if (license.active_activations >= license.activation_limit) {
    throw conflict("ไลเซนส์นี้ใช้เซิร์ฟเวอร์ครบจำนวนแล้ว กรุณารีเซ็ตการเปิดใช้งาน");
  }

  const timestamp = now();
  const activationId = newId("act");
  // Activation rows survive release (UNIQUE(license_id, installation_id)), so a released
  // installation must be revived with an UPSERT instead of a plain INSERT. The WHERE clause
  // re-checks the activation limit inside the same statement, which closes the
  // check-then-insert race that let concurrent claims exceed the limit.
  let activationResult: D1Result<unknown>;
  try {
    activationResult = await run(
      env.DB,
      `INSERT INTO activations (id, license_id, installation_id, status, activated_at, last_seen_at)
       SELECT ?, ?, ?, 'active', ?, ?
        WHERE (SELECT COUNT(*) FROM activations
                WHERE license_id = ? AND status = 'active' AND installation_id <> ?) < ?
       ON CONFLICT (license_id, installation_id) DO UPDATE SET
         status = 'active',
         activated_at = excluded.activated_at,
         last_seen_at = excluded.last_seen_at,
         released_at = NULL
       WHERE activations.status <> 'active'`,
      activationId,
      license.id,
      installation.id,
      timestamp,
      timestamp,
      license.id,
      installation.id,
      license.activation_limit,
    );
  } catch {
    throw conflict("ไม่สามารถเปิดใช้งานได้ อาจมีการใช้รหัสนี้ไปแล้ว");
  }
  if (affected(activationResult) === 0) {
    const alreadyActive = await first<{ id: string }>(
      env.DB,
      `SELECT id FROM activations WHERE license_id = ? AND installation_id = ? AND status = 'active'`,
      license.id,
      installation.id,
    );
    if (!alreadyActive) {
      throw conflict("ไลเซนส์นี้ใช้เซิร์ฟเวอร์ครบจำนวนแล้ว กรุณารีเซ็ตการเปิดใช้งาน");
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE installations SET license_id = ?, org_id = ?, status = 'active', updated_at = ? WHERE id = ?`,
    ).bind(license.id, license.org_id, timestamp, installation.id),
    env.DB.prepare(
      `UPDATE activation_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
    ).bind(timestamp, challenge.id),
  ]);

  await recordSecurityEvent(env, {
    eventType: "activation.claimed",
    severity: "info",
    installationId: installation.id,
    userId: user.id,
    details: { license_prefix: license.key_prefix, product: license.product_slug },
  });

  return {
    installationId: installation.id,
    licenseId: license.id,
    productSlug: license.product_slug,
    licenseKey,
    freeLicenseCreated,
  };
}

export async function releaseActivation(
  env: Env,
  user: SessionUser,
  licenseId: string,
  activationId: string,
): Promise<{ installationId: string }> {
  const license = await getLicenseForUser(env, user.id, licenseId);
  if (!license) throw notFound("ไม่พบไลเซนส์");
  const membership = user.memberships.find((membership) => membership.orgId === license.org_id);
  if (!membership || membership.role === "read_only") throw forbidden("บัญชีของคุณเป็นแบบอ่านอย่างเดียว");

  const activation = await first<{ id: string; installation_id: string; status: string }>(
    env.DB,
    `SELECT id, installation_id, status FROM activations WHERE id = ? AND license_id = ?`,
    activationId,
    licenseId,
  );
  if (!activation) throw notFound("ไม่พบการเปิดใช้งานนี้");
  if (activation.status !== "active") throw badRequest("การเปิดใช้งานนี้ไม่ได้ทำงานอยู่");

  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE activations SET status = 'released', released_at = ? WHERE id = ?`).bind(
      timestamp,
      activation.id,
    ),
    env.DB.prepare(
      `UPDATE installations SET status = 'pending', license_id = NULL, org_id = NULL, updated_at = ? WHERE id = ?`,
    ).bind(timestamp, activation.installation_id),
  ]);
  await recordSecurityEvent(env, {
    eventType: "activation.released",
    severity: "info",
    installationId: activation.installation_id,
    userId: user.id,
    details: { license_prefix: license.key_prefix },
  });
  return { installationId: activation.installation_id };
}

export async function listInstallationsForUser(env: Env, userId: string): Promise<InstallationRow[]> {
  return all<InstallationRow>(
    env.DB,
    `${INSTALLATION_SELECT}
      WHERE i.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)
      ORDER BY COALESCE(i.last_heartbeat_at, i.created_at) DESC`,
    userId,
  );
}

export async function getInstallationForUser(
  env: Env,
  userId: string,
  installationId: string,
): Promise<InstallationRow | null> {
  return first<InstallationRow>(
    env.DB,
    `${INSTALLATION_SELECT}
      WHERE i.id = ?
        AND i.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)`,
    installationId,
    userId,
  );
}

export async function getInstallationRow(env: Env, installationId: string): Promise<InstallationRow | null> {
  return first<InstallationRow>(env.DB, `${INSTALLATION_SELECT} WHERE i.id = ?`, installationId);
}

export async function getInstallationByUuid(
  env: Env,
  installationUuid: string,
): Promise<InstallationRow | null> {
  return first<InstallationRow>(
    env.DB,
    `${INSTALLATION_SELECT} WHERE i.installation_uuid = ?`,
    installationUuid,
  );
}

/* -------------------------------------------------------------------------- */
/* Signed requests (installation -> platform)                                 */
/* -------------------------------------------------------------------------- */

export interface VerifiedRequest {
  installation: InstallationRow;
  bodyText: string;
}

export async function verifySignedRequest(env: Env, request: Request): Promise<VerifiedRequest> {
  return verifySignedBody(env, request, await request.text());
}

/**
 * Verifies a signed request against an already-read body. Registration needs this because
 * the body must be parsed first to know which installation it claims to be, and a
 * re-registration is only accepted when it carries a signature by that installation's key.
 */
export async function verifySignedBody(
  env: Env,
  request: Request,
  bodyText: string,
): Promise<VerifiedRequest> {
  // Aegishider ships the X-AG-* signed header set; older BaseHider builds and
  // tooling still send X-BH-*. Accept either complete set, never a mix, so the
  // two generations cannot drift apart again.
  const headerPrefix = request.headers.has("x-ag-installation") ? "x-ag" : "x-bh";
  const installationUuid = request.headers.get(`${headerPrefix}-installation`) ?? "";
  const timestampRaw = request.headers.get(`${headerPrefix}-timestamp`) ?? "";
  const nonce = request.headers.get(`${headerPrefix}-nonce`) ?? "";
  const signatureB64 = request.headers.get(`${headerPrefix}-signature`) ?? "";
  if (!installationUuid || !timestampRaw || !nonce || !signatureB64) {
    throw unauthorized("คำขอต้องลงนามด้วยกุญแจของ installation");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw badRequest("nonce ไม่ถูกต้อง");
  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) throw badRequest("timestamp ไม่ถูกต้อง");
  const skew = Math.abs(Math.floor(now() / 1000) - timestamp);
  if (skew > 300) throw unauthorized("timestamp คลาดเคลื่อนเกิน 5 นาที");

  const installation = await getInstallationByUuid(env, installationUuid);
  if (!installation) throw unauthorized("ไม่พบ installation นี้");
  if (installation.status === "revoked") throw forbidden("installation นี้ถูกเพิกถอน");
  // A suspended installation must not keep sending telemetry or renewing leases.
  if (installation.status === "suspended") throw forbidden("installation นี้ถูกระงับการใช้งาน");

  if (bodyText.length > 128 * 1024) throw new AppError(413, "payload_too_large", "ข้อมูลใหญ่เกินกำหนด");
  const bodyHash = await sha256Hex(new TextEncoder().encode(bodyText));
  const pathname = new URL(request.url).pathname;
  const canonical = [
    request.method.toUpperCase(),
    pathname,
    installationUuid,
    String(timestamp),
    nonce,
    bodyHash,
  ].join("\n");

  let signature: Uint8Array;
  try {
    signature = base64ToBytes(signatureB64);
  } catch {
    throw unauthorized("signature ไม่ถูกต้อง");
  }
  let valid = false;
  try {
    const publicKey = await importEd25519PublicKey(installation.public_key);
    valid = await ed25519Verify(publicKey, signature, new TextEncoder().encode(canonical));
  } catch {
    valid = false;
  }
  if (!valid) {
    await recordSecurityEvent(env, {
      eventType: "request.invalid_signature",
      severity: "warning",
      installationId: installation.id,
      details: { path: pathname },
    });
    throw unauthorized("ลายเซ็นของคำขอไม่ถูกต้อง");
  }

  const nonceResult = await run(
    env.DB,
    `INSERT INTO activation_nonces (nonce, installation_id, purpose, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(nonce) DO NOTHING`,
    nonce,
    installation.id,
    pathname,
    now(),
    now() + 10 * MINUTE,
  );
  if (affected(nonceResult) !== 1) throw conflict("คำขอนี้ถูกใช้ไปแล้ว (replay)");

  return { installation, bodyText };
}

/* -------------------------------------------------------------------------- */
/* Lease issuance                                                             */
/* -------------------------------------------------------------------------- */

export interface LeaseResponse {
  lease: string;
  key_id: string;
  expires_at: number;
  server_time: number;
  keys: Array<{ key_id: string; public_key: string }>;
  offline_grace_hours: number;
}

export async function issueLease(env: Env, installation: InstallationRow): Promise<LeaseResponse> {
  if (!installation.license_id) throw forbidden("installation นี้ยังไม่ได้ผูกกับไลเซนส์");
  if (installation.status !== "active") throw forbidden("installation นี้ยังไม่พร้อมใช้งาน");

  const license = await first<{
    id: string;
    status: string;
    expires_at: number | null;
    entitlements: string;
    product_id: string;
    org_id: string;
  }>(
    env.DB,
    `SELECT id, status, expires_at, entitlements, product_id, org_id FROM licenses WHERE id = ?`,
    installation.license_id,
  );
  if (!license) throw notFound("ไม่พบไลเซนส์");
  if (license.status !== "active") throw forbidden("ไลเซนส์ไม่ได้อยู่ในสถานะใช้งาน");
  if (license.expires_at !== null && license.expires_at < now()) {
    throw forbidden("ไลเซนส์หมดอายุแล้ว");
  }

  const activation = await first<{ id: string }>(
    env.DB,
    `SELECT id FROM activations WHERE license_id = ? AND installation_id = ? AND status = 'active'`,
    license.id,
    installation.id,
  );
  if (!activation) throw forbidden("ไม่พบการเปิดใช้งานที่ยังทำงานอยู่");

  const signing = await ensureSigningKey(env);
  const nowMs = now();
  const nowSec = Math.floor(nowMs / 1000);
  const ttlHours = Math.max(1, Math.min(168, Number.parseInt(env.LEASE_TTL_HOURS ?? "24", 10) || 24));
  const expiresAtSec = nowSec + ttlHours * 3600;
  const jti = newId("lease");
  const payload = canonicalJson({
    v: 1,
    jti,
    license_id: license.id,
    product: installation.product_slug,
    product_id: license.product_id,
    installation_id: installation.id,
    installation_uuid: installation.installation_uuid,
    entitlements: safeJsonParse<string[]>(license.entitlements, []),
    issued_at: nowSec,
    expires_at: expiresAtSec,
    key_id: signing.keyId,
  });
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = await ed25519Sign(signing.privateKey, payloadBytes);
  const lease = `${base64urlEncode(payloadBytes)}.${base64urlEncode(signature)}`;

  await run(
    env.DB,
    `INSERT INTO license_leases (id, license_id, installation_id, jti, key_id, issued_at, expires_at, payload, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("lea"),
    license.id,
    installation.id,
    jti,
    signing.keyId,
    nowSec,
    expiresAtSec,
    payload,
    base64urlEncode(signature),
    nowMs,
  );

  const keys = await activePublicKeys(env);
  const graceHours = Math.max(0, Math.min(720, Number.parseInt(env.OFFLINE_GRACE_HOURS ?? "72", 10) || 72));
  return {
    lease,
    key_id: signing.keyId,
    expires_at: expiresAtSec,
    server_time: nowSec,
    keys: keys.map((key) => ({ key_id: key.key_id, public_key: key.public_key })),
    offline_grace_hours: graceHours,
  };
}

/** Utility used by tests and admin tooling. */
export async function decodeLeasePayload(lease: string): Promise<Record<string, unknown>> {
  const [payload] = lease.split(".");
  if (!payload) throw badRequest("lease ไม่ถูกต้อง");
  const decoded = new TextDecoder().decode(base64urlDecode(payload));
  return safeJsonParse<Record<string, unknown>>(decoded, {});
}
