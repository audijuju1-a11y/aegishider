import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { render } from "../lib/html";
import type { SafeHtml } from "../lib/html";
import { layout, appShell, flashFromQuery } from "../views/ui";
import { resolveLang, type Lang } from "../lib/i18n";
import type { SessionUser } from "../auth/session";

type Ctx = Context<AppEnv>;

export function langOf(c: Ctx): Lang {
  return c.get("lang") ?? resolveLang(c.req.header("accept-language")?.includes("en") ? "en" : "th");
}

export function flashOf(c: Ctx): SafeHtml | null {
  return flashFromQuery(c.req.query("ok"), c.req.query("err"));
}

function htmlResponse(c: Ctx, body: SafeHtml, status: number): Response {
  c.status(status as Parameters<typeof c.status>[0]);
  return c.html(render(body));
}

export interface PageOptions {
  title: string;
  description?: string;
  body: SafeHtml;
  noIndex?: boolean;
  noFooter?: boolean;
  status?: number;
  jsonLd?: unknown;
}

export function publicPage(c: Ctx, options: PageOptions): Response {
  const user = c.get("user") ?? null;
  const html = layout({
    title: options.title,
    description: options.description,
    user,
    path: c.req.path,
    lang: langOf(c),
    csrf: c.get("csrfToken") ?? "",
    body: options.body,
    flash: flashOf(c),
    noIndex: options.noIndex,
    noFooter: options.noFooter,
    baseUrl: c.env.APP_URL,
    jsonLd: options.jsonLd,
  });
  return htmlResponse(c, html, options.status ?? 200);
}

export interface AppPageOptions {
  title: string;
  subtitle?: string;
  body: SafeHtml;
  active: string;
  actions?: SafeHtml;
  admin?: boolean;
  status?: number;
}

export function appPage(c: Ctx, options: AppPageOptions): Response {
  const user = c.get("user");
  if (!user) throw new Error("appPage requires an authenticated user");
  const body = appShell({
    user,
    path: c.req.path,
    active: options.active,
    title: options.title,
    subtitle: options.subtitle,
    actions: options.actions,
    body: options.body,
    admin: options.admin,
    lang: langOf(c),
  });
  const html = layout({
    title: options.title,
    user,
    path: c.req.path,
    lang: langOf(c),
    csrf: c.get("csrfToken") ?? "",
    body,
    flash: flashOf(c),
    noIndex: true,
    baseUrl: c.env.APP_URL,
  });
  return htmlResponse(c, html, options.status ?? 200);
}

export function redirectTo(c: Ctx, path: string, params: Record<string, string> = {}): Response {
  const url = new URL(path, c.env.APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return c.redirect(`${url.pathname}${url.search}`, 303);
}

export function safeInternalPath(value: string | undefined, fallback = "/app"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // Control characters can break the Location header or smuggle a second response.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value.startsWith("/auth/") || value.startsWith("/api/")) return fallback;
  return value;
}

export function authenticated(c: Ctx): SessionUser {
  const user = c.get("user");
  if (!user) throw new Error("authenticated() called without a user");
  return user;
}

export function siteName(env: Env): string {
  return env.APP_NAME || "Aegishider Control Platform";
}
