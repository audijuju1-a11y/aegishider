import { Hono } from "hono";
import type { AppEnv } from "../env";
import { appPage } from "./helpers";
import { requireUser } from "../auth/guards";
import { html, type SafeHtml } from "../lib/html";
import {
  getPortalOverview,
  getServerDetail,
  listOwnedProducts,
  listUserNotifications,
  markNotificationsRead,
} from "../services/portal";
import {
  claimActivation,
  getLicenseForUser,
  getLicenseRow,
  listInstallationsForUser,
  listLicenseActivations,
  listLicensesForUser,
  releaseActivation,
} from "../services/licensing";
import {
  activationsPage,
  accountPage,
  licenseDetailPage,
  licensesPage,
  overviewPage,
  productsPage,
  securityPage,
  serverDetailPage,
  serversPage,
  supportPage as portalSupportPage,
  ticketPage,
} from "../views/portal";
import {
  addCustomerMessage,
  createTicket,
  getTicketForUser,
  listTicketsForUser,
} from "../services/support";
import { listProducts } from "../services/catalog";
import { all, first } from "../lib/db";
import { clientIp, formValue, readForm } from "../lib/http";
import { AppError, badRequest, forbidden } from "../lib/errors";
import { verifyTurnstile } from "../auth/turnstile";
import { revokeOtherSessions, revokeSession, listSessions } from "../auth/session";
import { errorPage } from "../views/marketing";
import { ensureFreeLicenseForUser } from "../services/licensing";
import {
  passwordHashForUser,
  setUserPassword,
  validatePassword,
  verifyPassword,
} from "../auth/password";

export const portalRoutes = new Hono<AppEnv>();

function failRedirect(c: Parameters<typeof appPage>[0], path: string, error: unknown): Response {
  if (error instanceof AppError) {
    const code =
      error.status === 403 ? "forbidden"
        : error.status === 409 ? "wrong-state"
          : error.status === 429 ? "rate-limited"
            : "invalid";
    return c.redirect(`${path}?err=${code}`, 303);
  }
  throw error;
}

/* -------------------------------------------------------------------------- */
/* Overview / products / licenses                                             */
/* -------------------------------------------------------------------------- */

portalRoutes.get("/", async (c) => {
  const user = requireUser(c);
  // No writes on a plain page view: the free licence is provisioned on the licences page
  // and by the activation flow (GET /app used to write D1 on every visit).
  const overview = await getPortalOverview(c.env, user);
  return appPage(c, {
    title: "ภาพรวม",
    subtitle: user.memberships[0]?.orgName ?? "องค์กรของฉัน",
    active: "/app",
    body: overviewPage(overview),
  });
});

portalRoutes.get("/products", async (c) => {
  const user = requireUser(c);
  const owned = await listOwnedProducts(c.env, user);
  return appPage(c, {
    title: "ผลิตภัณฑ์ของฉัน",
    subtitle: "ผลิตภัณฑ์ที่มีไลเซนส์ในองค์กรนี้",
    active: "/app/products",
    body: productsPage(owned),
  });
});

portalRoutes.get("/licenses", async (c) => {
  const user = requireUser(c);
  await ensureFreeLicenseForUser(c.env, user, "aegishider");
  const licenses = await listLicensesForUser(c.env, user.id);
  // Raw keys are a one-time display and never shown to read-only members.
  const canSeeRawKeys = user.memberships.some((membership) => membership.role !== "read_only");
  const rawKeys: Record<string, string> = {};
  if (canSeeRawKeys) {
    await Promise.all(
      licenses.map(async (license) => {
        const rawKey = await c.env.CACHE.get(`newlic:${license.id}`);
        if (rawKey) {
          rawKeys[license.id] = rawKey;
          await c.env.CACHE.delete(`newlic:${license.id}`);
        }
      }),
    );
  }
  return appPage(c, {
    title: "ไลเซนส์",
    subtitle: "ไลเซนส์ฟรีทั้งหมดที่องค์กรของคุณถืออยู่",
    active: "/app/licenses",
    body: licensesPage(licenses, c.get("csrfToken") ?? "", rawKeys),
  });
});

portalRoutes.get("/licenses/:id", async (c) => {
  const user = requireUser(c);
  const license = await getLicenseForUser(c.env, user.id, c.req.param("id"));
  if (!license) {
    return appPage(c, {
      title: "ไม่พบไลเซนส์",
      active: "/app/licenses",
      status: 404,
      body: errorPage("ไม่พบไลเซนส์นี้", "ไลเซนส์อาจถูกย้ายหรือไม่ได้อยู่ในองค์กรของคุณ"),
    });
  }
  const membership = user.memberships.find((item) => item.orgId === license.org_id);
  const canSeeRawKey = Boolean(membership && membership.role !== "read_only");
  const [activations, rawKey] = await Promise.all([
    listLicenseActivations(c.env, license.id),
    canSeeRawKey ? c.env.CACHE.get(`newlic:${license.id}`) : Promise.resolve(null),
  ]);
  if (rawKey) await c.env.CACHE.delete(`newlic:${license.id}`);
  return appPage(c, {
    title: `${license.product_name} · ${license.key_prefix}…`,
    subtitle: license.plan_name ?? "ไลเซนส์ฟรี",
    active: "/app/licenses",
    body: licenseDetailPage(license, activations, c.get("csrfToken") ?? "", rawKey),
  });
});

portalRoutes.post("/licenses/:id/reset", async (c) => {
  const user = requireUser(c);
  const licenseId = c.req.param("id");
  const values = await readForm(c);
  const activationId = formValue(values, "activation_id", 80);
  if (!activationId) throw badRequest("ไม่พบการเปิดใช้งาน");
  try {
    await releaseActivation(c.env, user, licenseId, activationId);
  } catch (error) {
    return failRedirect(c, `/app/licenses/${licenseId}`, error);
  }
  return c.redirect(`/app/licenses/${licenseId}?ok=reset`, 303);
});

/* -------------------------------------------------------------------------- */
/* Servers                                                                    */
/* -------------------------------------------------------------------------- */

portalRoutes.get("/servers", async (c) => {
  const user = requireUser(c);
  const servers = await listInstallationsForUser(c.env, user.id);
  return appPage(c, {
    title: "เซิร์ฟเวอร์",
    subtitle: "เซิร์ฟเวอร์ที่เชื่อมกับไลเซนส์ของคุณ",
    active: "/app/servers",
    body: serversPage(servers),
    actions: htmlLink("/app/activations", "เชื่อมเซิร์ฟเวอร์"),
  });
});

portalRoutes.get("/servers/:id", async (c) => {
  const user = requireUser(c);
  const tabRaw = c.req.query("tab");
  const tab = tabRaw === "performance" || tabRaw === "events" ? tabRaw : "overview";
  const detail = await getServerDetail(c.env, user.id, c.req.param("id"), {
    severity: c.req.query("severity") ?? undefined,
    type: c.req.query("type") ?? undefined,
  });
  if (!detail) {
    return appPage(c, {
      title: "ไม่พบเซิร์ฟเวอร์",
      active: "/app/servers",
      status: 404,
      body: errorPage("ไม่พบเซิร์ฟเวอร์นี้", "เซิร์ฟเวอร์อาจถูกถอดออกหรือไม่ได้อยู่ในองค์กรของคุณ"),
    });
  }
  const license = detail.installation.license_id
    ? await getLicenseRow(c.env, detail.installation.license_id)
    : null;
  const visible = license && user.memberships.some((membership) => membership.orgId === license.org_id) ? license : null;
  return appPage(c, {
    title: detail.installation.display_name ?? "เซิร์ฟเวอร์",
    subtitle: `${detail.installation.product_name} · ${detail.installation.installation_uuid.slice(0, 8)}`,
    active: "/app/servers",
    body: serverDetailPage(detail, tab, visible),
  });
});

/* -------------------------------------------------------------------------- */
/* Activations                                                                */
/* -------------------------------------------------------------------------- */

portalRoutes.get("/activations", async (c) => {
  const user = requireUser(c);
  await ensureFreeLicenseForUser(c.env, user, "aegishider");
  const [servers, licenses] = await Promise.all([
    listInstallationsForUser(c.env, user.id),
    listLicensesForUser(c.env, user.id),
  ]);
  return appPage(c, {
    title: "การเปิดใช้งาน",
    subtitle: "เชื่อมเซิร์ฟเวอร์ใหม่ด้วยรหัสจากปลั๊กอิน — ฟรี 100%",
    active: "/app/activations",
    body: activationsPage(
      servers.filter((server) => server.status === "pending"),
      licenses,
      c.get("csrfToken") ?? "",
      c.env.TURNSTILE_SITE_KEY ?? "",
    ),
  });
});

portalRoutes.post("/activations", async (c) => {
  const user = requireUser(c);
  const values = await readForm(c);
  const code = formValue(values, "code", 32);
  const licenseId = formValue(values, "license_id", 80);
  await verifyTurnstile(c.env, values["cf-turnstile-response"], clientIp(c));
  try {
    await claimActivation(c.env, user, code, licenseId || undefined, c.get("ipHash") ?? null);
  } catch (error) {
    return failRedirect(c, "/app/activations", error);
  }
  return c.redirect("/app/servers?ok=activated", 303);
});

/* -------------------------------------------------------------------------- */
/* Free licenses                                                              */
/* -------------------------------------------------------------------------- */

portalRoutes.post("/licenses/free", async (c) => {
  const user = requireUser(c);
  const values = await readForm(c);
  const productSlug = formValue(values, "product_slug", 80) || "aegishider";
  try {
    const result = await ensureFreeLicenseForUser(c.env, user, productSlug);
    if (!result.license) return failRedirect(c, "/app/licenses", badRequest("ไม่พบผลิตภัณฑ์นี้"));
    return c.redirect(`/app/licenses/${result.license.id}?ok=created`, 303);
  } catch (error) {
    return failRedirect(c, "/app/licenses", error);
  }
});

/* -------------------------------------------------------------------------- */
/* Support                                                                    */
/* -------------------------------------------------------------------------- */

portalRoutes.get("/support", async (c) => {
  const user = requireUser(c);
  const [tickets, products] = await Promise.all([
    listTicketsForUser(c.env, user.id),
    listProducts(c.env, { statuses: ["published"], limit: 50 }),
  ]);
  return appPage(c, {
    title: "ช่วยเหลือ",
    subtitle: "เปิดตั๋วและติดตามการตอบกลับจากทีมงาน",
    active: "/app/support",
    body: portalSupportPage(
      tickets,
      products.map((product) => ({ id: product.id, name: product.name })),
      c.get("csrfToken") ?? "",
    ),
  });
});

portalRoutes.post("/support", async (c) => {
  const user = requireUser(c);
  const values = await readForm(c);
  const subject = formValue(values, "subject", 200);
  const message = formValue(values, "message", 5000);
  const productId = formValue(values, "product_id", 80);
  const priority = formValue(values, "priority", 20);
  try {
    const ticketId = await createTicket(c.env, user, {
      subject,
      message,
      productId: productId || null,
      priority,
    });
    return c.redirect(`/app/support/${ticketId}?ok=created`, 303);
  } catch (error) {
    return failRedirect(c, "/app/support", error);
  }
});

portalRoutes.get("/support/:id", async (c) => {
  const user = requireUser(c);
  const result = await getTicketForUser(c.env, user.id, c.req.param("id"));
  if (!result) {
    return appPage(c, {
      title: "ไม่พบตั๋ว",
      active: "/app/support",
      status: 404,
      body: errorPage("ไม่พบตั๋วนี้", "ตั๋วอาจถูกปิดหรือไม่ได้อยู่ในองค์กรของคุณ"),
    });
  }
  return appPage(c, {
    title: result.ticket.subject,
    subtitle: `สถานะ: ${result.ticket.status}`,
    active: "/app/support",
    body: ticketPage(result.ticket, result.messages, c.get("csrfToken") ?? ""),
  });
});

portalRoutes.post("/support/:id", async (c) => {
  const user = requireUser(c);
  const values = await readForm(c);
  const message = formValue(values, "message", 5000);
  try {
    await addCustomerMessage(c.env, user, c.req.param("id"), message);
  } catch (error) {
    return failRedirect(c, `/app/support/${c.req.param("id")}`, error);
  }
  return c.redirect(`/app/support/${c.req.param("id")}?ok=sent`, 303);
});

/* -------------------------------------------------------------------------- */
/* Account / security                                                         */
/* -------------------------------------------------------------------------- */

portalRoutes.get("/account", async (c) => {
  const user = requireUser(c);
  const passwordHash = await passwordHashForUser(c.env, user.id);
  return appPage(c, {
    title: "บัญชี",
    subtitle: "ข้อมูลบัญชีและองค์กร",
    active: "/app/account",
    body: accountPage(user, Boolean(passwordHash), c.get("csrfToken") ?? ""),
  });
});

portalRoutes.post("/account/password", async (c) => {
  const user = requireUser(c);
  const values = await readForm(c);
  const current = formValue(values, "current_password", 200);
  const next = formValue(values, "new_password", 200);
  const confirm = formValue(values, "confirm_password", 200);
  const existing = await passwordHashForUser(c.env, user.id);
  if (existing && !(await verifyPassword(current, existing))) {
    return failRedirect(c, "/app/account", badRequest("รหัสผ่านปัจจุบันไม่ถูกต้อง"));
  }
  const problem = validatePassword(next);
  if (problem) return failRedirect(c, "/app/account", badRequest(problem));
  if (next !== confirm) return failRedirect(c, "/app/account", badRequest("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"));
  await setUserPassword(c.env, user.id, next);
  return c.redirect("/app/account?ok=password-updated", 303);
});

portalRoutes.get("/security", async (c) => {
  const user = requireUser(c);
  const sessions = await listSessions(c.env, user.id);
  const events = await all<{
    id: string;
    event_type: string;
    severity: string;
    details: string;
    created_at: number;
    ip_hash: string | null;
  }>(
    c.env.DB,
    `SELECT id, event_type, severity, details, created_at, ip_hash FROM security_events
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    user.id,
  );
  return appPage(c, {
    title: "ความปลอดภัย",
    subtitle: "เซสชันและประวัติการเข้าสู่ระบบ",
    active: "/app/security",
    body: securityPage(sessions, c.get("sessionId") ?? "", events, c.get("csrfToken") ?? ""),
  });
});

portalRoutes.post("/security/revoke-session", async (c) => {
  const user = requireUser(c);
  const values = await readForm(c);
  const sessionId = formValue(values, "session_id", 80);
  const owned = await first<{ id: string }>(
    c.env.DB,
    `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
    sessionId,
    user.id,
  );
  if (!owned) throw forbidden("ไม่พบเซสชันนี้ในบัญชีของคุณ");
  await revokeSession(c.env, sessionId);
  return c.redirect("/app/security?ok=revoked", 303);
});

portalRoutes.post("/security/revoke-others", async (c) => {
  const user = requireUser(c);
  await readForm(c);
  const current = c.get("sessionId");
  if (current) await revokeOtherSessions(c.env, user.id, current);
  return c.redirect("/app/security?ok=revoked", 303);
});

portalRoutes.get("/notifications", async (c) => {
  const user = requireUser(c);
  const notifications = await listUserNotifications(c.env, user.id);
  await markNotificationsRead(c.env, user.id);
  return appPage(c, {
    title: "การแจ้งเตือน",
    subtitle: "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด",
    active: "/app",
    body: htmlNotifications(notifications),
  });
});

function htmlNotifications(
  notifications: Array<{ id: string; title: string; body: string; read_at: number | null; created_at: number }>,
): SafeHtml {
  if (notifications.length === 0) {
    return html`<div class="empty">ยังไม่มีการแจ้งเตือน</div>`;
  }
  return html`<div class="card card-pad"><div class="stack" style="gap:.8rem">
    ${notifications.map((notification) => html`<div>
      <div class="spread"><b style="font-size:.85rem">${notification.title}</b><span class="mono" style="font-size:.52rem">${new Date(notification.created_at).toISOString().slice(0, 16).replace("T", " ")}</span></div>
      <p class="muted" style="font-size:.76rem;margin-top:.2rem">${notification.body}</p>
    </div>`)}
  </div></div>`;
}

function htmlLink(href: string, label: string): SafeHtml {
  return html`<a class="btn btn-primary btn-sm" href="${href}">${label}</a>`;
}
