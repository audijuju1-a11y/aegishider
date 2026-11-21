import type { Env } from "../env";
import { isProduction } from "../env";
import { configError, unavailable } from "../lib/errors";
import { bytesToBase64, newId } from "../lib/core";
import { now } from "../lib/time";
import { log, logError } from "../lib/logger";
import { run } from "../lib/db";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  template: string;
  userId?: string | null;
}

export function emailProvider(env: Env): string {
  return (env.EMAIL_PROVIDER ?? "console").trim().toLowerCase();
}

/** Providers are adapter-based so a different transactional service can be swapped in. */
export async function sendEmail(env: Env, options: EmailOptions): Promise<void> {
  const provider = emailProvider(env);
  const from = env.MAIL_FROM ?? "Aegishider <noreply@localhost>";
  const text = options.text;
  const html = options.html ?? renderEmailHtml(options.subject, text);
  let status: "sent" | "failed" | "suppressed" = "failed";
  let errorCode: string | null = null;

  try {
    if (provider === "none" || provider === "disabled" || provider === "off") {
      // Password-only deployments intentionally send no email. Callers still get a
      // successful, logged result so support/ticket actions never fail because of it.
      log("info", "email.disabled", { template: options.template, to: options.to });
      status = "suppressed";
      return;
    }
    if (provider === "console") {
      if (isProduction(env)) {
        throw configError("ยังไม่ได้ตั้งค่าผู้ให้บริการอีเมลสำหรับโปรดักชัน");
      }
      log("info", "email.console", {
        template: options.template,
        to: options.to,
        subject: options.subject,
        body: text,
      });
      await saveDevOutbox(env, options, text);
      status = "sent";
    } else if (provider === "mailchannels") {
      const domain = (from.match(/@([^>\s]+)/)?.[1] ?? "").trim();
      if (!domain) throw configError("MAIL_FROM ไม่ถูกต้อง");
      const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }], dkim_domain: domain, dkim_selector: "mailchannels" }],
          from: { email: from.match(/<([^>]+)>/)?.[1] ?? from, name: "Aegishider" },
          subject: options.subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html", value: html },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        errorCode = `mailchannels_${response.status}`;
        throw unavailable("ผู้ให้บริการอีเมลตอบกลับผิดพลาด");
      }
      status = "sent";
    } else if (provider === "gmail") {
      await sendViaGmail(env, options.to, options.subject, text, html);
      status = "sent";
    } else {
      throw configError(`ไม่รู้จักผู้ให้บริการอีเมล: ${provider}`);
    }
  } catch (error) {
    errorCode = errorCode ?? (error instanceof Error ? error.name : "email_error");
    logError("email.failed", error, { template: options.template, provider });
    throw error;
  } finally {
    try {
      await run(
        env.DB,
        `INSERT INTO email_log (id, user_id, template, recipient, provider, status, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        newId("eml"),
        options.userId ?? null,
        options.template,
        options.to.slice(0, 200),
        provider,
        status,
        errorCode,
        now(),
      );
    } catch (error) {
      logError("email.log_failed", error);
    }
  }
}

async function saveDevOutbox(env: Env, options: EmailOptions, text: string): Promise<void> {
  if (isProduction(env)) return;
  const record = {
    to: options.to,
    subject: options.subject,
    text,
    template: options.template,
    created_at: now(),
  };
  await env.CACHE.put("dev:email:last", JSON.stringify(record), { expirationTtl: 3600 });
  await env.CACHE.put(`dev:email:${now()}:${newId("x")}`, JSON.stringify(record), { expirationTtl: 3600 });
}

export interface LoginEmail {
  link: string;
  preview: boolean;
}

export async function sendLoginEmail(
  env: Env,
  to: string,
  token: string,
  next?: string,
  code = "",
  ttlMinutes = 10,
): Promise<LoginEmail> {
  const params = new URLSearchParams({ token });
  if (next) params.set("next", next);
  const link = `${env.APP_URL.replace(/\/$/, "")}/auth/verify?${params.toString()}`;
  const text = [
    "มีคำขอเข้าสู่ระบบ Aegishider Control Platform",
    "",
    `รหัส OTP: ${code}`,
    `รหัสนี้ใช้ได้ครั้งเดียวและหมดอายุใน ${ttlMinutes} นาที`,
    "",
    "หรือเปิดลิงก์นี้เพื่อเข้าสู่ระบบ:",
    link,
    "",
    "หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลนี้",
  ].join("\n");
  const logoUrl = `${env.APP_URL.replace(/\/$/, "")}/assets/img/logo-192.png`;
  const html = renderLoginEmailHtml(code, ttlMinutes, link, logoUrl);
  await sendEmail(env, {
    to,
    subject: code ? `Aegishider: รหัส OTP ${code} (หมดอายุใน ${ttlMinutes} นาที)` : `Aegishider: ลิงก์เข้าใช้งาน (หมดอายุใน ${ttlMinutes} นาที)`,
    text,
    html,
    template: "auth.login",
  });
  return { link, preview: emailProvider(env) === "console" && !isProduction(env) };
}

export function renderLoginEmailHtml(code: string, ttlMinutes: number, link: string, logoUrl = ""): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#18202a">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      ${logoUrl ? `<img src="${escape(logoUrl)}" width="48" height="48" alt="Aegishider" style="border-radius:12px;display:block">` : ""}
      <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8a6a22;font-weight:600">Aegishider · FREE PLATFORM</div>
    </div>
    <div style="background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:28px;margin-top:12px">
      <h1 style="font-size:20px;margin:0 0 12px">เข้าสู่ระบบ Aegishider</h1>
      <p style="font-size:14px;line-height:1.7;color:#3c4652;margin:0 0 18px">${code ? "กรอกรหัส OTP ด้านล่าง หรือกดปุ่มเพื่อเข้าสู่ระบบ" : "กดปุ่มด้านล่างเพื่อเข้าสู่ระบบ"} ลิงก์ใช้ได้ครั้งเดียวและหมดอายุใน ${ttlMinutes} นาที</p>
      ${code ? `<div style="font-family:ui-monospace,Consolas,monospace;font-size:32px;letter-spacing:.24em;font-weight:700;text-align:center;background:#faf6ec;border:1px solid #eadfc2;border-radius:10px;padding:16px;color:#1b1305">${escape(code)}</div>` : ""}
      <p style="margin:24px 0 0"><a href="${escape(link)}" style="background:#e2bd6d;color:#1b1305;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">เข้าสู่ระบบด้วยลิงก์</a></p>
    </div>
    <p style="font-size:11px;color:#7a8492;line-height:1.6;margin-top:16px">หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลนี้ · ไลเซนส์ฟรี 100% ใช้งานได้ถาวรจนกว่าจะมีการเปลี่ยนหรือยกเลิก · อีเมลนี้ส่งโดยระบบอัตโนมัติ<br>ไม่ได้รับอีเมลภายใน 2 นาที? ตรวจสอบ Spam หรือติดต่อทีมงานผ่านหน้า Support</p>
  </div></body></html>`;
}

let cachedGmailToken: { token: string; expiresAt: number } | null = null;

async function gmailAccessToken(env: Env): Promise<string> {
  if (cachedGmailToken && cachedGmailToken.expiresAt > Date.now() + 60_000) {
    return cachedGmailToken.token;
  }
  const clientId = env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = env.GMAIL_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw configError("ยังไม่ได้ตั้งค่า GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw unavailable(`Gmail OAuth ตอบกลับ ${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw unavailable("Gmail OAuth ไม่ได้ access token");
  cachedGmailToken = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
  return cachedGmailToken.token;
}

/**
 * Gmail API adapter (OAuth refresh token). A raw Gmail password / SMTP connection
 * is intentionally not accepted: Workers cannot do authenticated SMTP reliably and
 * storing an account password would be unsafe. Use a Google OAuth refresh token.
 */
async function sendViaGmail(env: Env, to: string, subject: string, text: string, html: string): Promise<void> {
  const token = await gmailAccessToken(env);
  const from = env.GMAIL_SENDER?.trim() || env.MAIL_FROM || "me";
  const boundary = `bh_${newId("mime")}`;
  const b64 = (value: string) => bytesToBase64(new TextEncoder().encode(value));
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      raw: bytesToBase64(new TextEncoder().encode(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw unavailable(`Gmail API ตอบกลับ ${response.status}`);
  }
}

export async function sendSecurityNotice(env: Env, to: string, title: string, body: string): Promise<void> {
  await sendEmail(env, {
    to,
    subject: `ความปลอดภัยบัญชี: ${title}`,
    text: `${title}\n\n${body}\n\nหากไม่ใช่คุณ กรุณาติดต่อ ${env.SUPPORT_EMAIL ?? "support"}`,
    html: renderEmailHtml(title, body),
    template: "account.security",
  });
}

export function renderEmailHtml(
  title: string,
  body: string,
  ctaLabel?: string,
  ctaUrl?: string,
): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cta =
    ctaLabel && ctaUrl
      ? `<p style="margin:28px 0"><a href="${escape(ctaUrl)}" style="background:#e2bd6d;color:#1b1305;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${escape(ctaLabel)}</a></p>`
      : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#18202a">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8a6a22;font-weight:600">Aegishider</div>
    <div style="background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:28px;margin-top:12px">
      <h1 style="font-size:20px;margin:0 0 14px">${escape(title)}</h1>
      <p style="font-size:14px;line-height:1.7;color:#3c4652;margin:0">${escape(body).replace(/\n/g, "<br>")}</p>
      ${cta}
    </div>
    <p style="font-size:11px;color:#7a8492;line-height:1.6;margin-top:16px">อีเมลนี้ส่งโดยระบบอัตโนมัติจาก Aegishider Control Platform</p>
  </div></body></html>`;
}
