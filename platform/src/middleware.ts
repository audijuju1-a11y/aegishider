import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { isProduction } from "./env";
import { newId } from "./lib/core";
import { hashIp, clientIp } from "./lib/http";
import { loadSession, touchSession } from "./auth/session";
import { type Lang } from "./lib/i18n";
import { log } from "./lib/logger";
import { flushLogs, recordRequestOutcome } from "./services/observability";

type Ctx = Context<AppEnv>;

export async function requestContext(c: Ctx, next: Next): Promise<void> {
  const incoming = c.req.header("cf-ray");
  const requestId = incoming ? `cf_${incoming}` : newId("req");
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  const started = Date.now();
  await next();
  const elapsed = Date.now() - started;
  if (!c.req.path.startsWith("/assets/")) {
    log("info", "request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: elapsed,
      requestId,
    });
  }

  const counter = recordRequestOutcome(c.env, c.res.status).catch((error) => {
    log("warn", "metrics.record_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  const logs = flushLogs(c.env);
  const ctx = executionContext(c);
  if (!ctx) {
    void counter;
    void logs;
    return;
  }
  try {
    ctx.waitUntil(counter);
    ctx.waitUntil(logs);
  } catch {
    void counter;
    void logs;
  }
}

/** The getter throws when the app is invoked without a worker execution context. */
function executionContext(c: Ctx): Ctx["executionCtx"] | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export async function securityHeaders(c: Ctx, next: Next): Promise<void> {
  await next();
  const headers = c.res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://challenges.cloudflare.com",
      "script-src-attr 'none'",
      "frame-src https://challenges.cloudflare.com",
      "connect-src 'self' https://challenges.cloudflare.com",
      "font-src 'self'",
      "manifest-src 'self'",
    ].join("; "),
  );
  if (isProduction(c.env)) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (c.req.path.startsWith("/app") || c.req.path.startsWith("/admin")
      || c.req.path.startsWith("/auth")) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
}

export async function sessionMiddleware(c: Ctx, next: Next): Promise<void> {
  const token = getCookie(c, "bh_session");
  if (token) {
    const session = await loadSession(c.env, token);
    if (session) {
      c.set("user", session.user);
      c.set("sessionId", session.sessionId);
      try {
        c.executionCtx.waitUntil(touchSession(c.env, session.sessionId, session.lastSeenAt));
      } catch {
        await touchSession(c.env, session.sessionId, session.lastSeenAt);
      }
    }
  }
  await next();
}

export async function localeMiddleware(c: Ctx, next: Next): Promise<void> {
  const cookie = getCookie(c, "bh_lang");
  const lang: Lang = cookie === "en" ? "en" : "th";
  c.set("lang", lang);
  await next();
}

export async function csrfMiddleware(c: Ctx, next: Next): Promise<void> {
  const existing = getCookie(c, "bh_csrf");
  if (existing) {
    c.set("csrfToken", existing);
  } else if (!c.req.path.startsWith("/api/")) {
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    setCookie(c, "bh_csrf", token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isProduction(c.env),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    c.set("csrfToken", token);
  }
  await next();
}

export async function ipMiddleware(c: Ctx, next: Next): Promise<void> {
  c.set("ipHash", await hashIp(c.env, clientIp(c)));
  await next();
}

export function combinedMiddleware(c: Ctx, next: Next): Promise<void> {
  return requestContext(c, async () => {
    await securityHeaders(c, async () => {
      await localeMiddleware(c, async () => {
        await csrfMiddleware(c, async () => {
          await ipMiddleware(c, async () => {
            await sessionMiddleware(c, next);
          });
        });
      });
    });
  });
}
