import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { badRequest, unauthorized } from "../lib/errors";
import { jsonResponse, clientIp, hashIp, readBodyText } from "../lib/http";
import { enforceRateLimit } from "../lib/rate-limit";
import { log } from "../lib/logger";
import {
  activePublicKeys,
  ensureSigningKey,
  getInstallationByUuid,
  issueLease,
  registerInstallation,
  verifySignedBody,
  verifySignedRequest,
} from "../services/licensing";
import { noteActivationRegistration } from "../services/activation-guard";
import {
  eventsBatchSchema,
  heartbeatSchema,
  recordEvents,
  recordHeartbeat,
} from "../services/telemetry";
import { listProductSummaries, getProductView } from "../services/catalog";
import { getStatusReport } from "../services/status";

export const apiRoutes = new Hono<AppEnv>();

function ok(data: unknown, status = 200): Response {
  return jsonResponse({ data }, status);
}

function parseBody<T>(text: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(text || "{}");
  } catch {
    throw badRequest("invalid JSON body");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    log("warn", "api.invalid_body", {
      issues,
      keys: value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : [],
    });
    throw badRequest("invalid request body", issues);
  }
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Public catalogue                                                           */
/* -------------------------------------------------------------------------- */

apiRoutes.get("/v1/products", async (c) => {
  const products = await listProductSummaries(c.env, { statuses: ["published"], limit: 50 });
  return ok({
    products: products.map((product) => ({
      slug: product.slug,
      name: product.name,
      tagline: product.tagline,
      status: product.status,
      price_cents: product.price_cents,
      currency: product.currency,
      compatibility: product.compatibilityData,
      latest_version: product.latestRelease?.version ?? null,
    })),
  });
});

apiRoutes.get("/v1/products/:slug", async (c) => {
  const product = await getProductView(c.env, c.req.param("slug"));
  if (!product) return jsonResponse({ error: { code: "not_found", message: "product not found" } }, 404);
  return ok({
    slug: product.slug,
    name: product.name,
    tagline: product.tagline,
    description: product.description,
    status: product.status,
    price_cents: product.price_cents,
    currency: product.currency,
    compatibility: product.compatibilityData,
    features: product.featuresList,
    releases: product.releases.map((release) => ({
      version: release.version,
      channel: release.channel,
      notes: release.notes,
      artifact_url: release.artifact_url,
      artifact_sha256: release.artifact_sha256,
      released_at: release.released_at,
    })),
  });
});

apiRoutes.get("/v1/license/keys", async (c) => {
  await ensureSigningKey(c.env);
  const keys = await activePublicKeys(c.env);
  return ok({ keys: keys.map((key) => ({ key_id: key.key_id, public_key: key.public_key })) });
});

apiRoutes.get("/v1/status", async (c) => {
  const report = await getStatusReport(c.env);
  return ok({
    overall: report.overall,
    components: report.components.map((component) => ({
      key: component.key,
      status: component.status,
      detail: component.detail,
    })),
    generated_at: report.generatedAt,
  });
});

/* -------------------------------------------------------------------------- */
/* Plugin API                                                                 */
/* -------------------------------------------------------------------------- */

const registerSchema = z
  .object({
    product: z.string().trim().min(1).max(60),
    installation_uuid: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    public_key: z.string().min(40).max(400),
    fingerprint_sha256: z.string().regex(/^[0-9a-f]{64}$/i),
    plugin_version: z.string().trim().max(32),
    minecraft_version: z.string().trim().max(32),
    platform: z.string().trim().max(32),
    server_name: z.string().trim().max(64).optional(),
    java_version: z.string().trim().max(32),
  })
  .strict();

apiRoutes.post("/v1/installations/register", async (c) => {
  const ip = clientIp(c);
  const ipHash = await hashIp(c.env, ip);
  await enforceRateLimit(c.env, `register:${ipHash}`, 20, 3600);
  // Bounded read: an unauthenticated caller must not be able to stream an arbitrary body.
  const raw = await readBodyText(c.req.raw, 16 * 1024);
  const payload = parseBody(raw, registerSchema);
  // Re-registration re-issues a pairing code, so the caller must prove it holds the key
  // that is already bound to this installation_uuid. The plugin signs registration requests.
  const existing = await getInstallationByUuid(c.env, payload.installation_uuid);
  if (existing) {
    const verified = await verifySignedBody(c.env, c.req.raw, raw);
    if (verified.installation.id !== existing.id) {
      throw unauthorized("ลายเซ็นไม่ได้มาจาก installation นี้");
    }
  }
  const result = await registerInstallation(c.env, {
    productSlug: payload.product,
    installationUuid: payload.installation_uuid,
    publicKey: payload.public_key,
    fingerprint: payload.fingerprint_sha256,
    pluginVersion: payload.plugin_version,
    minecraftVersion: payload.minecraft_version,
    platform: payload.platform,
    serverName: payload.server_name?.slice(0, 64) ?? null,
    javaVersion: payload.java_version,
  }, { signedReregistration: Boolean(existing) });
  await noteActivationRegistration(c.env, ipHash, {
    pluginSlug: payload.product,
    serverName: payload.server_name ?? null,
    installationId: result.installationId,
  });
  return ok(
    {
      installation_id: result.installationId,
      activation_code: result.activationCode,
      activation_expires_at: result.activationExpiresAt,
      portal_url: result.portalUrl,
      product: payload.product,
      reused: result.reused,
    },
    201,
  );
});

const leaseSchema = z.object({ plugin_version: z.string().max(32).optional() }).strict();

apiRoutes.post("/v1/installations/lease", async (c) => {
  const verified = await verifySignedRequest(c.env, c.req.raw);
  const body = parseBody(verified.bodyText, leaseSchema);
  await enforceRateLimit(c.env, `lease:${verified.installation.id}`, 60, 60);
  if (body.plugin_version) {
    await c.env.DB.prepare(`UPDATE installations SET plugin_version = ?, updated_at = ? WHERE id = ?`)
      .bind(body.plugin_version.slice(0, 32), Date.now(), verified.installation.id)
      .run();
  }
  const lease = await issueLease(c.env, verified.installation);
  return ok(lease);
});

apiRoutes.post("/v1/installations/heartbeat", async (c) => {
  const verified = await verifySignedRequest(c.env, c.req.raw);
  const payload = parseBody(verified.bodyText, heartbeatSchema);
  await enforceRateLimit(c.env, `heartbeat:${verified.installation.id}`, 120, 60);
  const result = await recordHeartbeat(c.env, verified.installation, payload, c.get("ipHash") ?? null);
  return ok({ received_at: result.receivedAt, event_id: result.eventId, server_time: Math.floor(Date.now() / 1000) }, 202);
});

apiRoutes.post("/v1/installations/events", async (c) => {
  const verified = await verifySignedRequest(c.env, c.req.raw);
  const payload = parseBody(verified.bodyText, eventsBatchSchema);
  await enforceRateLimit(c.env, `events:${verified.installation.id}`, 120, 60);
  const result = await recordEvents(c.env, verified.installation, payload.events);
  return ok({ accepted: result.accepted, duplicates: result.duplicates }, 202);
});

apiRoutes.get("/v1/health", () => ok({ status: "ok", time: Math.floor(Date.now() / 1000) }));
