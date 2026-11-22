import { Hono } from "hono";
import type { AppEnv } from "../env";
import { isProduction } from "../env";
import { appPage } from "./helpers";
import { can, isStaff, requirePermission, requireUser } from "../auth/guards";
import { findUserByEmail } from "../auth/session";
import { verifyAccessJwt } from "../auth/access";
import { forbidden, badRequest } from "../lib/errors";
import { formValue, readForm, readMultipart } from "../lib/http";
import { sha256Hex } from "../lib/core";
import { all, first } from "../lib/db";
import { now, safeJsonParse } from "../lib/time";
import {
  getAdminAnalytics,
  getAdminInstallation,
  getAdminLicense,
  getAdminSecurityEvents,
  getAdminStats,
  getCustomer,
  getSettings,
  listAdminInstallations,
  listAdminLicenses,
  listAllPlansWithProduct,
  listAuditEvents,
  listCustomers,
  setUserRole,
  setUserStatus,
} from "../services/admin";
import { listActivationGuards } from "../services/activation-guard";
import {
  createProduct,
  createPlan,
  createRelease,
  getPlanById,
  getProductById,
  getProductPlans,
  listAllReleases,
  listProducts,
  updateProduct,
} from "../services/catalog";
import {
  extendLicense,
  getLicenseRow,
  issueLicense,
  listLicenseActivations,
  setActivationLimit,
  setLicenseStatus,
} from "../services/licensing";
import {
  addStaffMessage,
  getTicketAdmin,
  listTicketsAdmin,
  setTicketStatus,
} from "../services/support";
import { getLatestHeartbeat, listInstallationEvents, listRollups, telemetryHealth } from "../services/telemetry";
import { deadLetterSummary, listDeadLetters, resolveDeadLetter } from "../services/dlq";
import { listAlertStates } from "../services/observability";
import { recordAudit, setSetting } from "../services/audit";
import { emailProvider } from "../auth/email";
import {
  adminAuditPage,
  adminCustomersPage,
  adminCustomerDetailPage,
  adminDashboardPage,
  adminIssueLicensePage,
  adminLicenseDetailPage,
  adminLicensesPage,
  adminProductFormPage,
  adminProductsPage,
  adminReleasesPage,
  adminSecurityPage,
  adminServerDetailPage,
  adminServersPage,
  adminSettingsPage,
  adminSupportPage,
  adminTelemetryPage,
  adminTicketPage,
} from "../views/admin";
import { adminContentPage } from "../views/admin-content";
import { getSiteContent, saveSiteContent, type SiteContent } from "../lib/site-content";
import { errorPage } from "../views/marketing";

type Ctx = Parameters<typeof appPage>[0];

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  // Email+password sessions are the default admin login. Cloudflare Access is optional:
  // when it is configured and an assertion is present, that identity is verified first.
  let user = c.get("user") ?? null;
  const assertion = c.req.header("cf-access-jwt-assertion");
  const accessConfigured = Boolean(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD);
  if (isProduction(c.env) && accessConfigured && assertion) {
    const access = await verifyAccessJwt(c.env, assertion);
    if (!access) throw forbidden("ต้องยืนยันตัวตนผ่าน Cloudflare Access");
    user = await findUserByEmail(c.env, access.email);
    if (!user || !isStaff(user)) throw forbidden("บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้ดูแล");
    c.set("user", user);
  }
  if (!user) {
    return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
  }
  if (!isStaff(user)) throw forbidden("บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้ดูแล");
  await next();
});

function guard(c: Ctx, permission: Parameters<typeof can>[1]): void {
  requirePermission(c, permission);
}

function ipHashOf(c: Ctx): string | null {
  return c.get("ipHash") ?? null;
}

function audit(
  c: Ctx,
  action: string,
  targetType: string,
  targetId: string | null,
  before: unknown,
  after: unknown,
  reason: string | null,
): Promise<void> {
  const user = requireUser(c);
  return recordAudit(c.env, {
    actorUserId: user.id,
    actorEmail: user.email,
    action,
    targetType,
    targetId,
    before,
    after,
    reason,
    requestId: c.get("requestId"),
    ipHash: ipHashOf(c),
  });
}

function notFoundPage(c: Ctx, title: string, message: string): Response {
  return appPage(c, {
    title,
    active: "/admin",
    admin: true,
    status: 404,
    body: errorPage(title, message),
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/", async (c) => {
  guard(c, "customers.read");
  const [stats, security, auditRows, analytics, guards] = await Promise.all([
    getAdminStats(c.env),
    getAdminSecurityEvents(c.env, 10),
    listAuditEvents(c.env, { limit: 10 }),
    getAdminAnalytics(c.env),
    listActivationGuards(c.env, 25),
  ]);
  return appPage(c, {
    title: "แดชบอร์ดผู้ดูแล",
    subtitle: "ภาพรวมทั้งแพลตฟอร์มจากฐานข้อมูลจริง",
    active: "/admin",
    admin: true,
    body: adminDashboardPage(stats, security, auditRows, analytics, guards),
  });
});

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/customers", async (c) => {
  guard(c, "customers.read");
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const rows = await listCustomers(c.env, { q: q || undefined, limit: 100 });
  return appPage(c, {
    title: "ลูกค้า",
    subtitle: "บัญชีและองค์กรทั้งหมด",
    active: "/admin/customers",
    admin: true,
    body: adminCustomersPage(rows, q),
  });
});

adminRoutes.get("/customers/:id", async (c) => {
  guard(c, "customers.read");
  const data = await getCustomer(c.env, c.req.param("id"));
  if (!data) return notFoundPage(c, "ไม่พบลูกค้า", "บัญชีนี้อาจถูกลบหรือไม่มีอยู่");
  const licenses = await listAdminLicenses(c.env, { q: data.user.email, limit: 50 });
  // Filter in SQL by the customer's email/organisation; filtering a global LIMIT 100
  // page in memory silently hid servers for every customer outside that page.
  const servers = await listAdminInstallations(c.env, { q: data.user.email, limit: 200 });
  return appPage(c, {
    title: data.user.email,
    subtitle: "รายละเอียดลูกค้า",
    active: "/admin/customers",
    admin: true,
    body: adminCustomerDetailPage(
      data,
      licenses.filter((license) => license.customer_email === data.user.email),
      servers,
      c.get("csrfToken") ?? "",
    ),
  });
});

adminRoutes.post("/customers/:id/status", async (c) => {
  guard(c, "customers.write");
  const values = await readForm(c);
  const user = requireUser(c);
  const targetId = c.req.param("id");
  if (targetId === user.id) return c.redirect(`/admin/customers/${targetId}?err=forbidden`, 303);
  const status = formValue(values, "status", 20) as "active" | "suspended" | "deleted";
  if (!["active", "suspended", "deleted"].includes(status)) throw badRequest("สถานะไม่ถูกต้อง");
  const before = await first<{ status: string }>(c.env.DB, `SELECT status FROM users WHERE id = ?`, targetId);
  if (status !== "active") {
    // Never disable the last active administrator: nobody could reach the console again.
    const target = await first<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, targetId);
    if (target && ["admin", "super_admin"].includes(target.role)) {
      const remaining = await first<{ count: number }>(
        c.env.DB,
        `SELECT COUNT(*) AS count FROM users WHERE status = 'active' AND role IN ('admin','super_admin') AND id <> ?`,
        targetId,
      );
      if ((remaining?.count ?? 0) === 0) {
        return c.redirect(`/admin/customers/${targetId}?err=forbidden`, 303);
      }
    }
  }
  await setUserStatus(c.env, targetId, status);
  await audit(c, "customer.status", "user", targetId, before, { status }, formValue(values, "reason", 300) || null);
  return c.redirect(`/admin/customers/${targetId}?ok=saved`, 303);
});

adminRoutes.post("/customers/:id/role", async (c) => {
  guard(c, "settings.write");
  const values = await readForm(c);
  const user = requireUser(c);
  const targetId = c.req.param("id");
  if (targetId === user.id) return c.redirect(`/admin/customers/${targetId}?err=forbidden`, 303);
  const role = formValue(values, "role", 30);
  if (!["customer", "support", "product_manager", "security_analyst", "read_only_admin", "admin", "super_admin"].includes(role)) {
    throw badRequest("บทบาทไม่ถูกต้อง");
  }
  // Only a super_admin may grant or change administrator roles.
  if (["admin", "super_admin"].includes(role) && user.role !== "super_admin") {
    return c.redirect(`/admin/customers/${targetId}?err=forbidden`, 303);
  }
  const before = await first<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, targetId);
  if (before && ["admin", "super_admin"].includes(before.role) && !["admin", "super_admin"].includes(role)) {
    const remaining = await first<{ count: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS count FROM users WHERE status = 'active' AND role IN ('admin','super_admin') AND id <> ?`,
      targetId,
    );
    if ((remaining?.count ?? 0) === 0) {
      return c.redirect(`/admin/customers/${targetId}?err=forbidden`, 303);
    }
  }
  await setUserRole(c.env, targetId, role);
  await audit(c, "customer.role", "user", targetId, before, { role }, "role change");
  return c.redirect(`/admin/customers/${targetId}?ok=saved`, 303);
});

/* -------------------------------------------------------------------------- */
/* Licenses                                                                   */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/licenses", async (c) => {
  guard(c, "licenses.read");
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const status = (c.req.query("status") ?? "").trim().slice(0, 20);
  const rows = await listAdminLicenses(c.env, { q: q || undefined, status: status || undefined, limit: 100 });
  return appPage(c, {
    title: "ไลเซนส์",
    subtitle: "ออก ตรวจสอบ และเพิกถอนไลเซนส์",
    active: "/admin/licenses",
    admin: true,
    body: adminLicensesPage(rows, q, status),
  });
});

adminRoutes.get("/licenses/new", async (c) => {
  guard(c, "licenses.write");
  const [products, plans] = await Promise.all([
    listProducts(c.env, { statuses: [], limit: 100 }),
    listAllPlansWithProduct(c.env),
  ]);
  return appPage(c, {
    title: "ออกไลเซนส์",
    subtitle: "สร้างไลเซนส์ให้ลูกค้าที่มีบัญชีอยู่แล้ว",
    active: "/admin/licenses",
    admin: true,
    body: adminIssueLicensePage(products, plans, c.get("csrfToken") ?? ""),
  });
});

adminRoutes.post("/licenses", async (c) => {
  guard(c, "licenses.write");
  const values = await readForm(c);
  const email = formValue(values, "email", 200).toLowerCase();
  const productId = formValue(values, "product_id", 80);
  const planId = formValue(values, "plan_id", 80);
  const activationLimit = Math.max(1, Math.min(1000, Number.parseInt(formValue(values, "activation_limit", 8) || "1", 10) || 1));
  const expiresRaw = formValue(values, "expires_at", 20);
  const expiresAt = expiresRaw ? Date.parse(`${expiresRaw}T23:59:59Z`) : null;

  const customer = await findUserByEmail(c.env, email);
  if (!customer) return c.redirect("/admin/licenses/new?err=invalid", 303);
  const org = customer.memberships[0];
  if (!org) return c.redirect("/admin/licenses/new?err=invalid", 303);
  const product = await getProductById(c.env, productId);
  if (!product) return c.redirect("/admin/licenses/new?err=invalid", 303);
  if (planId) {
    const plan = await getPlanById(c.env, planId);
    if (!plan || plan.product_id !== productId) return c.redirect("/admin/licenses/new?err=invalid", 303);
  }

  const issued = await issueLicense(c.env, {
    productId,
    planId: planId || null,
    orgId: org.orgId,
    ownerUserId: customer.id,
    activationLimit,
    expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : null,
    createdBy: requireUser(c).id,
    reason: "admin issued",
  });
  if (!issued) return c.redirect("/admin/licenses/new?err=invalid", 303);
  await c.env.CACHE.put(`newlic:${issued.id}`, issued.rawKey, { expirationTtl: 600 });
  await audit(c, "license.issue", "license", issued.id, null, { product: product.slug, org: org.orgId }, "admin issued");
  return c.redirect(`/admin/licenses/${issued.id}?ok=created`, 303);
});

adminRoutes.get("/licenses/:id", async (c) => {
  guard(c, "licenses.read");
  const license = await getAdminLicense(c.env, c.req.param("id"));
  if (!license) return notFoundPage(c, "ไม่พบไลเซนส์", "ไลเซนส์นี้อาจถูกลบ");
  const activations = await listLicenseActivations(c.env, license.id);
  const rawKey = await c.env.CACHE.get(`newlic:${license.id}`);
  if (rawKey) await c.env.CACHE.delete(`newlic:${license.id}`);
  return appPage(c, {
    title: `${license.product_name} · ${license.key_prefix}…`,
    subtitle: `ลูกค้า ${license.customer_email}`,
    active: "/admin/licenses",
    admin: true,
    body: adminLicenseDetailPage(license, activations, c.get("csrfToken") ?? "", rawKey),
  });
});

adminRoutes.post("/licenses/:id/status", async (c) => {
  guard(c, "licenses.write");
  const values = await readForm(c);
  const licenseId = c.req.param("id");
  const status = formValue(values, "status", 20) as "active" | "suspended" | "revoked";
  if (!["active", "suspended", "revoked"].includes(status)) throw badRequest("สถานะไม่ถูกต้อง");
  const reason = formValue(values, "reason", 300);
  const before = await getLicenseRow(c.env, licenseId);
  await setLicenseStatus(c.env, licenseId, status, reason || "admin action");
  await audit(c, "license.status", "license", licenseId, before?.status ?? null, { status }, reason || null);
  return c.redirect(`/admin/licenses/${licenseId}?ok=saved`, 303);
});

adminRoutes.post("/licenses/:id/extend", async (c) => {
  guard(c, "licenses.write");
  const values = await readForm(c);
  const licenseId = c.req.param("id");
  const date = formValue(values, "expires_at", 20);
  const expiresAt = date ? Date.parse(`${date}T23:59:59Z`) : null;
  if (date && !Number.isFinite(expiresAt)) throw badRequest("วันที่ไม่ถูกต้อง");
  await extendLicense(c.env, licenseId, expiresAt);
  await audit(c, "license.extend", "license", licenseId, null, { expires_at: expiresAt }, null);
  return c.redirect(`/admin/licenses/${licenseId}?ok=saved`, 303);
});

adminRoutes.post("/licenses/:id/limit", async (c) => {
  guard(c, "licenses.write");
  const values = await readForm(c);
  const licenseId = c.req.param("id");
  const limit = Math.max(1, Math.min(1000, Number.parseInt(formValue(values, "activation_limit", 8) || "1", 10) || 1));
  await setActivationLimit(c.env, licenseId, limit);
  await audit(c, "license.limit", "license", licenseId, null, { activation_limit: limit }, null);
  return c.redirect(`/admin/licenses/${licenseId}?ok=saved`, 303);
});

adminRoutes.post("/licenses/:id/reset", async (c) => {
  guard(c, "licenses.write");
  const values = await readForm(c);
  const licenseId = c.req.param("id");
  const activationId = formValue(values, "activation_id", 80);
  const activation = await first<{ installation_id: string }>(
    c.env.DB,
    `SELECT installation_id FROM activations WHERE id = ? AND license_id = ?`,
    activationId,
    licenseId,
  );
  if (!activation) throw badRequest("ไม่พบการเปิดใช้งาน");
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE activations SET status = 'released', released_at = ? WHERE id = ?`).bind(timestamp, activationId),
    c.env.DB.prepare(`UPDATE installations SET status = 'pending', license_id = NULL, org_id = NULL, updated_at = ? WHERE id = ?`).bind(
      timestamp,
      activation.installation_id,
    ),
  ]);
  await audit(c, "license.reset_activation", "license", licenseId, { activation_id: activationId }, { status: "released" }, null);
  return c.redirect(`/admin/licenses/${licenseId}?ok=reset`, 303);
});

/* -------------------------------------------------------------------------- */
/* Products / releases                                                        */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/products", async (c) => {
  guard(c, "products.read");
  const products = await listProducts(c.env, { statuses: [], limit: 100 });
  return appPage(c, {
    title: "สินค้า",
    subtitle: "ผลิตภัณฑ์ แพ็กเกจ และสถานะการเผยแพร่",
    active: "/admin/products",
    admin: true,
    body: adminProductsPage(products),
  });
});

adminRoutes.get("/products/new", (c) => {
  guard(c, "products.write");
  return appPage(c, {
    title: "เพิ่มผลิตภัณฑ์",
    active: "/admin/products",
    admin: true,
    body: adminProductFormPage(null, [], c.get("csrfToken") ?? ""),
  });
});

function productInputFromForm(values: Record<string, string>) {
  const slug = formValue(values, "slug", 60);
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) throw badRequest("slug ไม่ถูกต้อง");
  const status = formValue(values, "status", 20);
  if (!["draft", "published", "coming_soon", "archived"].includes(status)) throw badRequest("สถานะไม่ถูกต้อง");
  const features = safeJsonParse<unknown>(formValue(values, "features", 8000) || "[]", []);
  if (!Array.isArray(features)) throw badRequest("features ต้องเป็น JSON array");
  const compatibility = safeJsonParse<unknown>(formValue(values, "compatibility", 4000) || "{}", {});
  if (!compatibility || typeof compatibility !== "object" || Array.isArray(compatibility)) {
    throw badRequest("compatibility ต้องเป็น JSON object");
  }
  return {
    slug,
    name: formValue(values, "name", 120),
    tagline: formValue(values, "tagline", 200),
    description: formValue(values, "description", 8000),
    category: formValue(values, "category", 40) || "security",
    status,
    featured: values["featured"] === "1",
    priceCents: Math.max(0, Number.parseInt(formValue(values, "price_cents", 12) || "0", 10) || 0),
    currency: (formValue(values, "currency", 3) || "THB").toUpperCase(),
    docsUrl: formValue(values, "docs_url", 300) || null,
    purchaseUrl: formValue(values, "purchase_url", 300) || null,
    compatibility: JSON.stringify(compatibility),
    features: JSON.stringify(features),
    actorId: null as string | null,
  };
}

adminRoutes.post("/products", async (c) => {
  guard(c, "products.write");
  const values = await readForm(c);
  const input = productInputFromForm(values);
  input.actorId = requireUser(c).id;
  const id = await createProduct(c.env, input);
  await audit(c, "product.create", "product", id, null, { slug: input.slug, status: input.status }, null);
  return c.redirect(`/admin/products/${id}?ok=created`, 303);
});

adminRoutes.get("/products/:id", async (c) => {
  guard(c, "products.read");
  const product = await getProductById(c.env, c.req.param("id"));
  if (!product) return notFoundPage(c, "ไม่พบผลิตภัณฑ์", "ผลิตภัณฑ์นี้อาจถูกลบ");
  const plans = await getProductPlans(c.env, product.id, true);
  return appPage(c, {
    title: product.name,
    subtitle: `/${product.slug}`,
    active: "/admin/products",
    admin: true,
    body: adminProductFormPage(product, plans, c.get("csrfToken") ?? ""),
  });
});

adminRoutes.post("/products/:id", async (c) => {
  guard(c, "products.write");
  const values = await readForm(c);
  const product = await getProductById(c.env, c.req.param("id"));
  if (!product) return notFoundPage(c, "ไม่พบผลิตภัณฑ์", "ผลิตภัณฑ์นี้อาจถูกลบ");
  const input = productInputFromForm(values);
  input.actorId = requireUser(c).id;
  await updateProduct(c.env, product.id, input);
  await audit(c, "product.update", "product", product.id, { status: product.status }, { status: input.status, price: input.priceCents }, null);
  return c.redirect(`/admin/products/${product.id}?ok=saved`, 303);
});

adminRoutes.post("/products/:id/plans", async (c) => {
  guard(c, "products.write");
  const values = await readForm(c);
  const productId = c.req.param("id");
  const product = await getProductById(c.env, productId);
  if (!product) return notFoundPage(c, "ไม่พบผลิตภัณฑ์", "ผลิตภัณฑ์นี้อาจถูกลบ");
  const code = formValue(values, "code", 40);
  if (!/^[a-z0-9_-]{2,40}$/.test(code)) throw badRequest("code ไม่ถูกต้อง");
  const entitlements = safeJsonParse<unknown>(formValue(values, "entitlements", 4000) || "[]", []);
  if (!Array.isArray(entitlements)) throw badRequest("entitlements ต้องเป็น JSON array");
  const planId = await createPlan(c.env, productId, {
    code,
    name: formValue(values, "name", 80),
    priceCents: Math.max(0, Number.parseInt(formValue(values, "price_cents", 12) || "0", 10) || 0),
    currency: product.currency,
    billingInterval: formValue(values, "billing_interval", 20) || "one_time",
    entitlements: JSON.stringify(entitlements),
    activationLimit: Math.max(1, Math.min(1000, Number.parseInt(formValue(values, "activation_limit", 8) || "1", 10) || 1)),
    active: true,
  });
  await audit(c, "plan.create", "product_plan", planId, null, { product: productId, code }, null);
  return c.redirect(`/admin/products/${productId}?ok=created`, 303);
});

adminRoutes.get("/releases", async (c) => {
  guard(c, "products.read");
  const [releases, products] = await Promise.all([
    listAllReleases(c.env, 100),
    listProducts(c.env, { statuses: [], limit: 100 }),
  ]);
  return appPage(c, {
    title: "รีลีส",
    subtitle: "เวอร์ชันและไฟล์ที่เผยแพร่",
    active: "/admin/releases",
    admin: true,
    body: adminReleasesPage(releases, products, c.get("csrfToken") ?? ""),
  });
});

adminRoutes.post("/releases", async (c) => {
  guard(c, "releases.write");
  const values = await readForm(c);
  const productId = formValue(values, "product_id", 80);
  const product = await getProductById(c.env, productId);
  if (!product) return c.redirect("/admin/releases?err=invalid", 303);
  const version = formValue(values, "version", 32);
  if (!/^[0-9A-Za-z._-]{1,32}$/.test(version)) throw badRequest("เวอร์ชันไม่ถูกต้อง");
  const notes = formValue(values, "notes", 8000);
  const list = (value: string) => JSON.stringify(value.split(",").map((item) => item.trim()).filter(Boolean));
  // Draft lets staff upload the artifact and write notes before the release is public.
  const status = formValue(values, "status", 12) || "published";
  if (!["draft", "published"].includes(status)) throw badRequest("สถานะไม่ถูกต้อง");
  const releaseId = await createRelease(c.env, {
    productId,
    version,
    channel: formValue(values, "channel", 20) || "stable",
    status,
    notes,
    supportedMinecraft: list(formValue(values, "minecraft", 200)),
    supportedJava: list(formValue(values, "java", 200)),
    supportedPlatforms: list(formValue(values, "platforms", 200)),
    artifactUrl: formValue(values, "artifact_url", 300) || null,
    artifactSha256: formValue(values, "artifact_sha256", 64) || null,
  });
  await audit(c, "release.create", "product_release", releaseId, null, { product: productId, version, status }, null);
  return c.redirect("/admin/releases?ok=created", 303);
});

adminRoutes.post("/releases/:id/status", async (c) => {
  guard(c, "releases.write");
  const values = await readForm(c);
  const releaseId = c.req.param("id");
  const status = formValue(values, "status", 12);
  if (!["draft", "published"].includes(status)) throw badRequest("สถานะไม่ถูกต้อง");
  const before = await first<{ status: string; version: string }>(
    c.env.DB,
    `SELECT status, version FROM product_releases WHERE id = ?`,
    releaseId,
  );
  if (!before) throw badRequest("ไม่พบรีลีส");
  await c.env.DB.prepare(
    `UPDATE product_releases
        SET status = ?,
            released_at = CASE WHEN ? = 'published' THEN ? ELSE released_at END
      WHERE id = ?`,
  )
    .bind(status, status, now(), releaseId)
    .run();
  await audit(c, "release.status", "product_release", releaseId, before.status, { status }, "release status change");
  return c.redirect("/admin/releases?ok=saved", 303);
});

adminRoutes.post("/releases/:id/file", async (c) => {
  guard(c, "releases.write");
  const release = await first<{ id: string; version: string; product_id: string }>(
    c.env.DB,
    `SELECT id, version, product_id FROM product_releases WHERE id = ?`,
    c.req.param("id"),
  );
  if (!release) throw badRequest("ไม่พบรีลีส");
  const form = await readMultipart(c, 32 * 1024 * 1024);
  const file = form.get("artifact");
  if (!(file instanceof File)) throw badRequest("กรุณาแนบไฟล์ .jar");
  if (!file.name.toLowerCase().endsWith(".jar")) throw badRequest("อนุญาตเฉพาะไฟล์ .jar");
  if (file.size <= 0 || file.size > 30 * 1024 * 1024) throw badRequest("ไฟล์ต้องมีขนาดไม่เกิน 30 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw badRequest("ไฟล์ .jar ไม่ถูกต้อง");
  const sha256 = await sha256Hex(bytes);
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const key = `releases/${release.product_id}/${release.version}/${safeName}`;
  await c.env.ARCHIVE.put(key, bytes, {
    httpMetadata: { contentType: "application/java-archive" },
    customMetadata: { releaseId: release.id, version: release.version, sha256 },
  });
  await c.env.DB.prepare(
    `UPDATE product_releases SET artifact_r2_key = ?, artifact_url = ?, artifact_sha256 = ?,
       artifact_size_bytes = ? WHERE id = ?`,
  )
    .bind(key, `/release/${release.id}/download`, sha256, file.size, release.id)
    .run();
  await audit(c, "release.upload", "product_release", release.id, null, { version: release.version, sha256, size: file.size }, null);
  return c.redirect("/admin/releases?ok=updated", 303);
});

/* -------------------------------------------------------------------------- */
/* Servers                                                                    */
/* -------------------------------------------------------------------------- */
adminRoutes.get("/servers", async (c) => {
  guard(c, "servers.read");
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const rows = await listAdminInstallations(c.env, { q: q || undefined, limit: 100 });
  return appPage(c, {
    title: "เซิร์ฟเวอร์ทั้งหมด",
    subtitle: "การติดตั้งที่เชื่อมกับแพลตฟอร์ม",
    active: "/admin/servers",
    admin: true,
    body: adminServersPage(rows, q),
  });
});

adminRoutes.get("/servers/:id", async (c) => {
  guard(c, "servers.read");
  const installation = await getAdminInstallation(c.env, c.req.param("id"));
  if (!installation) return notFoundPage(c, "ไม่พบเซิร์ฟเวอร์", "installation นี้อาจถูกลบ");
  const [heartbeat, events, rollups] = await Promise.all([
    getLatestHeartbeat(c.env, installation.id),
    listInstallationEvents(c.env, installation.id, { limit: 30 }),
    listRollups(c.env, installation.id, 48),
  ]);
  return appPage(c, {
    title: installation.display_name ?? installation.installation_uuid.slice(0, 8),
    subtitle: installation.product_name,
    active: "/admin/servers",
    admin: true,
    body: adminServerDetailPage(installation, heartbeat, events, rollups),
  });
});

/* -------------------------------------------------------------------------- */
/* Website content                                                            */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/content", async (c) => {
  guard(c, "settings.read");
  return appPage(c, {
    title: "เนื้อหาเว็บ",
    subtitle: "ปรับข้อความหน้าแรกและข้อมูลติดต่อ",
    active: "/admin/content",
    admin: true,
    body: adminContentPage(await getSiteContent(c.env), c.get("csrfToken") ?? ""),
  });
});

adminRoutes.post("/content", async (c) => {
  guard(c, "settings.write");
  const values = await readForm(c);
  const before = await getSiteContent(c.env);
  const content: SiteContent = {
    announcement: formValue(values, "announcement", 300),
    heroEyebrow: formValue(values, "heroEyebrow", 120),
    heroTitle: formValue(values, "heroTitle", 160),
    heroTitleAccent: formValue(values, "heroTitleAccent", 160),
    heroLead: formValue(values, "heroLead", 800),
    primaryCta: formValue(values, "primaryCta", 80),
    secondaryCta: formValue(values, "secondaryCta", 80),
    pricingNote: formValue(values, "pricingNote", 500),
  };
  await saveSiteContent(c.env, content);
  await audit(c, "site.content.update", "system_settings", "site.content", before, content, null);
  return c.redirect("/admin/content?ok=saved", 303);
});

/* -------------------------------------------------------------------------- */
/* Support                                                                    */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/support", async (c) => {
  guard(c, "support.read");
  const tickets = await listTicketsAdmin(c.env, { limit: 100 });
  return appPage(c, {
    title: "ตั๋วช่วยเหลือ",
    subtitle: "คำขอจากลูกค้าทั้งหมด",
    active: "/admin/support",
    admin: true,
    body: adminSupportPage(tickets),
  });
});

adminRoutes.get("/support/:id", async (c) => {
  guard(c, "support.read");
  const result = await getTicketAdmin(c.env, c.req.param("id"));
  if (!result) return notFoundPage(c, "ไม่พบตั๋ว", "ตั๋วนี้อาจถูกลบ");
  return appPage(c, {
    title: result.ticket.subject,
    subtitle: result.ticket.customer_email,
    active: "/admin/support",
    admin: true,
    body: adminTicketPage(result.ticket, result.messages, c.get("csrfToken") ?? ""),
  });
});

adminRoutes.post("/support/:id", async (c) => {
  guard(c, "support.write");
  const values = await readForm(c);
  const actor = requireUser(c);
  const body = formValue(values, "body", 5000);
  if (body) await addStaffMessage(c.env, { id: actor.id, email: actor.email }, c.req.param("id"), body, values["internal"] === "1");
  const status = formValue(values, "status", 20);
  if (status) {
    const ticketId = c.req.param("id");
    const before = await first<{ status: string }>(
      c.env.DB,
      `SELECT status FROM support_tickets WHERE id = ?`,
      ticketId,
    );
    await setTicketStatus(c.env, ticketId, status);
    await audit(c, "ticket.status", "support_ticket", ticketId, before?.status ?? null, { status }, body ? "staff reply" : null);
  }
  return c.redirect(`/admin/support/${c.req.param("id")}?ok=sent`, 303);
});

/* -------------------------------------------------------------------------- */
/* Security / audit / telemetry / settings                                    */
/* -------------------------------------------------------------------------- */

adminRoutes.get("/security", async (c) => {
  guard(c, "security.read");
  const [events, guards, deadLetters, dlq, alerts] = await Promise.all([
    getAdminSecurityEvents(c.env, 200),
    listActivationGuards(c.env, 50),
    listDeadLetters(c.env, 50),
    deadLetterSummary(c.env),
    listAlertStates(c.env),
  ]);
  return appPage(c, {
    title: "ศูนย์ความปลอดภัย",
    subtitle: "เหตุการณ์ความปลอดภัย การพยายามเข้าถึง และข้อความที่ตกค้างในคิว",
    active: "/admin/security",
    admin: true,
    body: adminSecurityPage(events, guards, deadLetters, dlq, c.get("csrfToken") ?? "", alerts),
  });
});

adminRoutes.post("/security/dlq/:id/resolve", async (c) => {
  guard(c, "security.write");
  const user = requireUser(c);
  const id = c.req.param("id").slice(0, 120);
  await readForm(c);
  if (await resolveDeadLetter(c.env, id, user.email)) {
    await audit(c, "queue.dlq_resolve", "telemetry_dlq", id, null, { resolved: true }, null);
  }
  return c.redirect("/admin/security?ok=dlq-resolved", 303);
});

adminRoutes.get("/audit", async (c) => {
  guard(c, "audit.read");
  const events = await listAuditEvents(c.env, { limit: 200 });
  return appPage(c, {
    title: "บันทึกการตรวจสอบ",
    subtitle: "ทุกการกระทำของผู้ดูแล",
    active: "/admin/audit",
    admin: true,
    body: adminAuditPage(events),
  });
});

adminRoutes.get("/telemetry", async (c) => {
  guard(c, "telemetry.read");
  const health = await telemetryHealth(c.env);
  const recent = await all<{
    id: string;
    installation_name: string | null;
    event_type: string;
    severity: string;
    received_at: number;
    processed_at: number | null;
  }>(
    c.env.DB,
    `SELECT e.id, i.display_name AS installation_name, e.event_type, e.severity, e.received_at, e.processed_at
       FROM telemetry_events e JOIN installations i ON i.id = e.installation_id
      ORDER BY e.received_at DESC LIMIT 50`,
  );
  return appPage(c, {
    title: "Telemetry",
    subtitle: "สุขภาพของท่อข้อมูลจากเซิร์ฟเวอร์ลูกค้า",
    active: "/admin/telemetry",
    admin: true,
    body: adminTelemetryPage(health, recent),
  });
});

adminRoutes.get("/settings", async (c) => {
  guard(c, "settings.read");
  const settings = await getSettings(c.env);
  const envInfo = [
    { label: "Environment", value: c.env.ENVIRONMENT },
    { label: "APP_URL", value: c.env.APP_URL },
    { label: "อีเมล", value: `${emailProvider(c.env)}` },
    { label: "Turnstile", value: c.env.TURNSTILE_SECRET ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า" },
    { label: "Admin login", value: "อีเมล+รหัสผ่าน (session) · Cloudflare Access " + (c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD ? "เปิดเสริม" : "ไม่บังคับ") },
    { label: "Lease TTL", value: `${c.env.LEASE_TTL_HOURS} ชั่วโมง` },
    { label: "Offline grace", value: `${c.env.OFFLINE_GRACE_HOURS} ชั่วโมง` },
    { label: "Signing key id", value: c.env.LICENSE_SIGNING_KEY_ID ?? "—" },
  ];
  return appPage(c, {
    title: "ตั้งค่า",
    subtitle: "ค่าที่แก้ได้จากฐานข้อมูล และค่าที่มาจาก environment",
    active: "/admin/settings",
    admin: true,
    body: adminSettingsPage(settings, envInfo, c.get("csrfToken") ?? ""),
  });
});

adminRoutes.post("/settings", async (c) => {
  guard(c, "settings.write");
  const values = await readForm(c);
  const updates: Array<[string, string]> = [
    ["platform.registration_open", formValue(values, "registration_open", 10) === "true" ? "true" : "false"],
    ["telemetry.retention_days", String(Math.max(1, Math.min(3650, Number.parseInt(formValue(values, "retention_days", 8) || "90", 10) || 90)))],
  ];
  for (const [key, value] of updates) await setSetting(c.env, key, value);
  await audit(c, "settings.update", "system_settings", null, null, Object.fromEntries(updates), null);
  return c.redirect("/admin/settings?ok=saved", 303);
});

adminRoutes.get("/queue", (c) => c.redirect("/admin/telemetry", 302));
