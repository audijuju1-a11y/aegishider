import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { isProduction } from "../env";
import { AppError, badRequest, configError, forbidden } from "./errors";
import { hmacSha256Hex } from "./core";

export const SESSION_COOKIE = "bh_session";
export const CSRF_COOKIE = "bh_csrf";
export const LANG_COOKIE = "bh_lang";

type Ctx = Context<AppEnv>;

export function isApiRequest(c: Ctx): boolean {
  return new URL(c.req.url).pathname.startsWith("/api/");
}

export function clientIp(c: Ctx): string {
  const forwarded = c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip");
  if (forwarded) return forwarded.trim();
  const chain = c.req.header("x-forwarded-for");
  if (chain) return chain.split(",")[0]!.trim();
  return "0.0.0.0";
}

/** Reads a text body with a hard size cap, so an unauthenticated caller cannot stream megabytes. */
export async function readBodyText(request: Request, limit: number): Promise<string> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > limit) {
    throw new AppError(413, "payload_too_large", "ข้อมูลใหญ่เกินกำหนด");
  }
  const text = await request.text();
  if (text.length > limit) throw new AppError(413, "payload_too_large", "ข้อมูลใหญ่เกินกำหนด");
  return text;
}

/**
 * HMAC hashed IP so analytics can rate-limit without storing raw addresses.
 * Uses its own pepper when configured (key separation from licence and OTP hashes) and
 * fails closed in production: a constant fallback pepper would make the hashes reversible
 * and would collide across deployments.
 */
export async function hashIp(env: Env, ip: string): Promise<string> {
  const pepper = env.IP_HASH_PEPPER ?? env.LICENSE_KEY_PEPPER;
  if (!pepper) {
    if (isProduction(env)) throw configError("ยังไม่ได้ตั้งค่า IP_HASH_PEPPER หรือ LICENSE_KEY_PEPPER");
    return (await hmacSha256Hex("dev-only-insecure-ip-pepper", `ip:${ip}`)).slice(0, 32);
  }
  const digest = await hmacSha256Hex(pepper, `ip:${ip}`);
  return digest.slice(0, 32);
}

export function setSessionCookie(c: Ctx, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProduction(c.env),
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(c: Ctx): void {
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProduction(c.env),
    path: "/",
    maxAge: 0,
  });
}

export function ensureCsrfCookie(c: Ctx): string {
  const existing = getCookie(c, CSRF_COOKIE);
  if (existing) {
    c.set("csrfToken", existing);
    return existing;
  }
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "Lax",
    secure: isProduction(c.env),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  c.set("csrfToken", token);
  return token;
}

export function csrfCookieValue(c: Ctx): string {
  return getCookie(c, CSRF_COOKIE) ?? "";
}

/** Origin + double-submit CSRF check for cookie-authenticated mutations. */
export function verifyCsrf(c: Ctx, submitted: string | undefined): void {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return;

  const appUrl = new URL(c.env.APP_URL);
  const requestUrl = new URL(c.req.url);
  // Only the configured origin is trusted. The Host header is attacker-controlled behind a
  // proxy, so it is accepted as an extra allowance in local development only.
  const allowedHosts = new Set([appUrl.host]);
  if (!isProduction(c.env)) allowedHosts.add(requestUrl.host);
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");
  if (origin) {
    try {
      if (!allowedHosts.has(new URL(origin).host)) throw forbidden("Origin ไม่ได้รับอนุญาต");
    } catch {
      throw forbidden("Origin ไม่ถูกต้อง");
    }
  } else if (referer) {
    try {
      if (!allowedHosts.has(new URL(referer).host)) throw forbidden("Referer ไม่ได้รับอนุญาต");
    } catch {
      throw forbidden("Referer ไม่ถูกต้อง");
    }
  } else if (isProduction(c.env)) {
    throw forbidden("คำขอต้องมาจากหน้าเว็บของระบบ");
  }

  const cookie = csrfCookieValue(c);
  if (!cookie || !submitted || cookie !== submitted) {
    throw forbidden("CSRF token ไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่");
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export type FormValues = Record<string, string>;

export async function readForm(c: Ctx, maxBytes = MAX_BODY_BYTES): Promise<FormValues> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError(413, "payload_too_large", "ข้อมูลมีขนาดใหญ่เกินกำหนด");
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new AppError(415, "unsupported_media_type", "แบบฟอร์มต้องส่งเป็น application/x-www-form-urlencoded");
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw badRequest("ข้อมูลแบบฟอร์มไม่ถูกต้อง");
  }
  const values: FormValues = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") throw badRequest("ไม่รองรับการอัปโหลดไฟล์");
    values[key] = value;
  }
  verifyCsrf(c, values["_csrf"]);
  return values;
}

/** Reads multipart form data (file uploads) while enforcing CSRF and size limits. */
export async function readMultipart(c: Ctx, maxBytes = 6 * 1024 * 1024): Promise<FormData> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError(413, "payload_too_large", "ข้อมูลมีขนาดใหญ่เกินกำหนด");
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    throw new AppError(415, "unsupported_media_type", "ต้องส่งไฟล์เป็น multipart/form-data");
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw badRequest("ข้อมูลแบบฟอร์มไม่ถูกต้อง");
  }
  verifyCsrf(c, String(form.get("_csrf") ?? ""));
  return form;
}

export function formValue(values: FormValues, key: string, maxLength = 500): string {
  const value = (values[key] ?? "").trim();
  if (value.length > maxLength) throw badRequest(`ข้อมูล ${key} ยาวเกินกำหนด`);
  return value;
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location } });
}

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function getQuery(c: Ctx, name: string, maxLength = 200): string {
  return (c.req.query(name) ?? "").trim().slice(0, maxLength);
}

export function pagination(c: Ctx, defaultPerPage = 20): { page: number; perPage: number; offset: number } {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(getQuery(c, "page"), 10) || 1));
  const perPage = Math.max(5, Math.min(100, Number.parseInt(getQuery(c, "per_page"), 10) || defaultPerPage));
  return { page, perPage, offset: (page - 1) * perPage };
}


