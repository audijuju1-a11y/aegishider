import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { isProduction } from "../env";
import { publicPage, redirectTo, safeInternalPath } from "./helpers";
import { authMessagePage, loginPage, recoverPage, registerPage } from "../views/auth";
import {
  clearSessionCookie,
  clientIp,
  hashIp,
  readForm,
  formValue,
  SESSION_COOKIE,
  setSessionCookie,
} from "../lib/http";
import {
  createSession,
  findOrCreateAccount,
  findUserByEmail,
  loadSession,
  revokeSession,
  sessionTtlDays,
} from "../auth/session";
import {
  passwordHashForEmail,
  setUserPassword,
  validatePassword,
  verifyPassword,
} from "../auth/password";
import { markEmailVerified } from "../auth/otp";
import { verifyTurnstile } from "../auth/turnstile";
import { consumeRecoveryCode, issueRecoveryCodes } from "../auth/recovery";
import { verifyTotp } from "../auth/totp";
import { enforceRateLimit } from "../lib/rate-limit";
import { recordSecurityEvent } from "../services/audit";
import { now } from "../lib/time";
import { first } from "../lib/db";
import { timingSafeEqual } from "../lib/core";

export const authRoutes = new Hono<AppEnv>();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loginErrorPage(c: Parameters<typeof publicPage>[0], next: string, message: string, status = 400): Response {
  return publicPage(c, {
    title: "เข้าสู่ระบบ",
    description: "เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน",
    body: loginPage({
      csrf: c.get("csrfToken") ?? "",
      next,
      siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
      error: message,
    }),
    noIndex: true,
    status,
  });
}

/* -------------------------------------------------------------------------- */
/* Password login                                                             */
/* -------------------------------------------------------------------------- */

authRoutes.get("/login", (c) => {
  if (c.get("user")) return c.redirect("/app", 303);
  const next = safeInternalPath(c.req.query("next"), "/app");
  return publicPage(c, {
    title: "เข้าสู่ระบบ",
    description: "เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน",
    body: loginPage({
      csrf: c.get("csrfToken") ?? "",
      next,
      siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
    }),
    noIndex: true,
  });
});

authRoutes.post("/login", async (c) => {
  const values = await readForm(c);
  const email = formValue(values, "email", 200).trim().toLowerCase();
  const password = formValue(values, "password", 200);
  const next = safeInternalPath(values["next"], "/app");
  const ip = clientIp(c);
  const ipHash = await hashIp(c.env, ip);
  const emailHash = await hashIp(c.env, `email:${email}`);

  if (!emailPattern.test(email)) return loginErrorPage(c, next, "อีเมลไม่ถูกต้อง");
  if (!password) return loginErrorPage(c, next, "กรุณากรอกรหัสผ่าน");
  await enforceRateLimit(c.env, `pwlogin:ip:${ipHash}`, 10, 900);
  await enforceRateLimit(c.env, `pwlogin:email:${emailHash}`, 5, 900);
  await verifyTurnstile(c.env, values["cf-turnstile-response"], ip, "login");

  const stored = await passwordHashForEmail(c.env, email);
  const ok = stored ? await verifyPassword(password, stored) : false;
  if (!ok) {
    await recordSecurityEvent(c.env, {
      eventType: "auth.login_failed",
      severity: "warning",
      ipHash,
      details: { method: "password", reason: stored ? "bad_password" : "no_password" },
    });
    return loginErrorPage(c, next, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }

  const user = await findUserByEmail(c.env, email);
  if (!user) return loginErrorPage(c, next, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");

  // Optional TOTP second factor. A code that was already accepted is rejected through
  // `totp_last_counter`, so a captured code cannot be replayed on the next login.
  const security = await first<{
    totp_secret: string | null;
    totp_enabled_at: number | null;
    totp_last_counter: number | null;
  }>(
    c.env.DB,
    `SELECT totp_secret, totp_enabled_at, totp_last_counter FROM users WHERE id = ?`,
    user.id,
  );
  if (security?.totp_enabled_at) {
    const result = await verifyTotp(security.totp_secret ?? "", values["totp"] ?? "", security.totp_last_counter);
    if (!result.ok) {
      await recordSecurityEvent(c.env, {
        eventType: "auth.login_totp_failed",
        severity: "warning",
        userId: user.id,
        ipHash,
        details: { method: "totp" },
      });
      return loginErrorPage(c, next, "รหัส 2FA ไม่ถูกต้องหรือถูกใช้ไปแล้ว");
    }
    await c.env.DB.prepare(`UPDATE users SET totp_last_counter = ? WHERE id = ?`)
      .bind(result.counter, user.id)
      .run();
  }
  // Password-only deployment: a correct password is the credential. Normalise the
  // legacy verification timestamp so older rows do not stay "unverified" forever.
  await c.env.DB.prepare(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), last_login_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(now(), now(), now(), user.id).run();
  const session = await createSession(c.env, user.id, {
    ipHash,
    userAgent: c.req.header("user-agent") ?? null,
  });
  setSessionCookie(c, session.token, sessionTtlDays(c.env) * 86400);
  await recordSecurityEvent(c.env, {
    eventType: "auth.login",
    severity: "info",
    userId: user.id,
    ipHash,
    details: { method: "password" },
  });
  return c.redirect(next, 303);
});

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

authRoutes.get("/register", (c) => {
  if (c.get("user")) return c.redirect("/app", 303);
  const next = safeInternalPath(c.req.query("next"), "/app");
  return publicPage(c, {
    title: "สมัครบัญชี",
    description: "สมัครบัญชีฟรีด้วยอีเมล แล้วตั้งรหัสผ่านหลังยืนยันอีเมล",
    body: registerPage({
      csrf: c.get("csrfToken") ?? "",
      next,
      siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
    }),
    noIndex: true,
  });
});

authRoutes.post("/register", async (c) => {
  const values = await readForm(c);
  const email = formValue(values, "email", 200).trim().toLowerCase();
  const password = formValue(values, "password", 200);
  const confirm = formValue(values, "password_confirm", 200);
  const next = safeInternalPath(values["next"], "/app");
  const ip = clientIp(c);
  const ipHash = await hashIp(c.env, ip);
  const renderError = (message: string) =>
    publicPage(c, {
      title: "สมัครบัญชี",
      description: "สมัครบัญชีฟรีด้วยอีเมลและรหัสผ่าน",
      body: registerPage({
        csrf: c.get("csrfToken") ?? "",
        next,
        siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
        error: message,
      }),
      noIndex: true,
      status: 400,
    });

  if (!emailPattern.test(email)) return renderError("อีเมลไม่ถูกต้อง");
  const passwordError = validatePassword(password);
  if (passwordError) return renderError(passwordError);
  if (password !== confirm) return renderError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
  await enforceRateLimit(c.env, `signup:ip:${ipHash}`, 5, 3600);
  await verifyTurnstile(c.env, values["cf-turnstile-response"], ip, "register");

  const existing = await findUserByEmail(c.env, email);
  let userId: string;
  if (existing) {
    const row = await first<{ password_hash: string | null; email_verified_at: number | null }>(
      c.env.DB,
      `SELECT password_hash, email_verified_at FROM users WHERE id = ?`,
      existing.id,
    );
    if (row?.password_hash) {
      return renderError("อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ");
    }
    if (row?.email_verified_at != null) {
      return renderError("บัญชีนี้ยังไม่มีรหัสผ่าน กรุณาให้ผู้ดูแลตั้งรหัสผ่านให้");
    }
    // A passwordless, never-verified placeholder (legacy email-only signup) is completed
    // by its first password registration. This is the only claim path.
    userId = existing.id;
  } else {
    const account = await findOrCreateAccount(c.env, email);
    if (!account.created) {
      return renderError("อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ");
    }
    userId = account.user.id;
  }

  await setUserPassword(c.env, userId, password);
  await markEmailVerified(c.env, userId);
  // No transactional email: issue recovery codes and show them until the user acknowledges
  // them (or 15 minutes pass). Registration always lands on the security page for this.
  const recoveryCodes = await issueRecoveryCodes(c.env, userId);
  await c.env.CACHE.put(`recovery-new:${userId}`, JSON.stringify(recoveryCodes), { expirationTtl: 900 });
  const session = await createSession(c.env, userId, {
    ipHash,
    userAgent: c.req.header("user-agent") ?? null,
  });
  setSessionCookie(c, session.token, sessionTtlDays(c.env) * 86400);
  await recordSecurityEvent(c.env, {
    eventType: "auth.register",
    severity: "info",
    userId,
    ipHash,
    details: { method: "password" },
  });
  return c.redirect("/app/security?ok=recovery-codes", 303);
});

/* -------------------------------------------------------------------------- */
/* Account recovery (no email provider)                                       */
/* -------------------------------------------------------------------------- */

authRoutes.get("/recover", (c) => {
  if (c.get("user")) return c.redirect("/app/security", 303);
  return publicPage(c, {
    title: "กู้คืนบัญชี",
    description: "ใช้รหัสกู้คืนบัญชีเพื่อตั้งรหัสผ่านใหม่",
    body: recoverPage({ csrf: c.get("csrfToken") ?? "", siteKey: c.env.TURNSTILE_SITE_KEY ?? "" }),
    noIndex: true,
  });
});

authRoutes.post("/recover", async (c) => {
  const values = await readForm(c);
  const email = formValue(values, "email", 200).trim().toLowerCase();
  const code = formValue(values, "code", 32);
  const password = formValue(values, "password", 200);
  const confirm = formValue(values, "password_confirm", 200);
  const ip = clientIp(c);
  const ipHash = await hashIp(c.env, ip);
  const emailHash = await hashIp(c.env, `email:${email}`);

  const renderError = (message: string) =>
    publicPage(c, {
      title: "กู้คืนบัญชี",
      description: "ใช้รหัสกู้คืนบัญชีเพื่อตั้งรหัสผ่านใหม่",
      body: recoverPage({
        csrf: c.get("csrfToken") ?? "",
        siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
        error: message,
      }),
      noIndex: true,
      status: 400,
    });

  if (!emailPattern.test(email)) return renderError("อีเมลไม่ถูกต้อง");
  const passwordError = validatePassword(password);
  if (passwordError) return renderError(passwordError);
  if (password !== confirm) return renderError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
  await enforceRateLimit(c.env, `recover:ip:${ipHash}`, 10, 900);
  await enforceRateLimit(c.env, `recover:email:${emailHash}`, 5, 900);
  await verifyTurnstile(c.env, values["cf-turnstile-response"], ip, "recover");

  const user = await findUserByEmail(c.env, email);
  const consumed = user ? await consumeRecoveryCode(c.env, user.id, code) : false;
  if (!user || !consumed) {
    await recordSecurityEvent(c.env, {
      eventType: "auth.recovery_failed",
      severity: "warning",
      ipHash,
      details: { reason: user ? "bad_code" : "unknown_email" },
    });
    return renderError("อีเมลหรือรหัสกู้คืนไม่ถูกต้อง");
  }

  await setUserPassword(c.env, user.id, password);
  await markEmailVerified(c.env, user.id);
  // A recovered account starts clean: old sessions are revoked and a lost TOTP device
  // is removed, otherwise recovery could not restore access.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL, updated_at = ? WHERE id = ?`,
    ).bind(now(), user.id),
    c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now(), user.id),
  ]);
  const rotated = await issueRecoveryCodes(c.env, user.id);
  await c.env.CACHE.put(`recovery-new:${user.id}`, JSON.stringify(rotated), { expirationTtl: 900 });
  await recordSecurityEvent(c.env, {
    eventType: "auth.password_recovered",
    severity: "warning",
    userId: user.id,
    ipHash,
    details: { method: "recovery_code" },
  });
  return c.redirect("/auth/login?ok=password-reset", 303);
});

/* -------------------------------------------------------------------------- */
/* Email-link login (OTP temporarily disabled)                                */
/* -------------------------------------------------------------------------- */

authRoutes.get("/email", (c) => c.redirect("/auth/login", 303));

authRoutes.post("/email", (c) => c.redirect("/auth/login", 303));

authRoutes.post("/verify-otp", (c) => c.redirect("/auth/login", 303));

authRoutes.get("/verify", (c) => c.redirect("/auth/login", 303));

authRoutes.post("/verify", (c) => c.redirect("/auth/login", 303));

authRoutes.post("/logout", async (c) => {
  await readForm(c);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = await loadSession(c.env, token);
    if (session) {
      await revokeSession(c.env, session.sessionId);
      await recordSecurityEvent(c.env, {
        eventType: "auth.logout",
        severity: "info",
        userId: session.user.id,
        ipHash: await hashIp(c.env, clientIp(c)),
      });
    }
  }
  clearSessionCookie(c);
  return c.redirect("/?ok=logged-out", 303);
});

/**
 * Development-only bootstrap: signs in the first ADMIN_EMAILS address and grants
 * super_admin. Disabled entirely in production (404).
 */
authRoutes.get("/dev-admin", async (c) => {
  // Two independent switches: an explicit opt-in (DEV_BOOTSTRAP=1) plus a shared token
  // (DEV_ADMIN_TOKEN). Checking ENVIRONMENT alone meant a staging/preview deploy that
  // forgot ENVIRONMENT=production handed super_admin to anyone who opened the URL.
  const expected = c.env.DEV_ADMIN_TOKEN ?? "";
  const provided = c.req.header("x-dev-admin-token") ?? c.req.query("token") ?? "";
  const enabled =
    !isProduction(c.env) && c.env.DEV_BOOTSTRAP === "1" && expected.length >= 16 && provided.length > 0;
  if (!enabled || !timingSafeEqual(provided, expected)) {
    if (provided) {
      await recordSecurityEvent(c.env, {
        eventType: "auth.dev_admin_denied",
        severity: "warning",
        ipHash: await hashIp(c.env, clientIp(c)),
        details: { reason: enabled ? "bad_token" : "disabled" },
      });
    }
    return publicPage(c, {
      title: "ไม่พบหน้านี้",
      body: authMessagePage({ title: "ไม่พบหน้านี้", message: "หน้านี้ใช้ได้เฉพาะในโหมดพัฒนา" }),
      status: 404,
      noIndex: true,
    });
  }
  const email = (c.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)[0];
  if (!email) {
    return publicPage(c, {
      title: "ยังไม่ได้ตั้งค่า ADMIN_EMAILS",
      body: authMessagePage({
        title: "ยังไม่ได้ตั้งค่าผู้ดูแล",
        message: "เพิ่ม ADMIN_EMAILS ใน .dev.vars แล้วรีสตาร์ท dev server",
        ctaHref: "/",
        ctaLabel: "กลับหน้าแรก",
      }),
      status: 400,
      noIndex: true,
    });
  }
  const account = await findOrCreateAccount(c.env, email);
  await c.env.DB.prepare(`UPDATE users SET role = 'super_admin', updated_at = ? WHERE id = ?`)
    .bind(now(), account.user.id)
    .run();
  const session = await createSession(c.env, account.user.id, {
    ipHash: await hashIp(c.env, clientIp(c)),
    userAgent: c.req.header("user-agent") ?? null,
  });
  setSessionCookie(c, session.token, sessionTtlDays(c.env) * 86400);
  await recordSecurityEvent(c.env, {
    eventType: "auth.dev_admin_login",
    severity: "warning",
    userId: account.user.id,
    details: { email },
  });
  return c.redirect(safeInternalPath(c.req.query("next"), "/admin"), 303);
});

authRoutes.get("/", (c) => redirectTo(c, "/auth/login"));
