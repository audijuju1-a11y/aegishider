/**
 * Runtime bindings. Mirrors wrangler.jsonc; secrets are optional so that local
 * development fails closed with a clear message instead of crashing at import.
 */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARCHIVE: R2Bucket;
  TELEMETRY_QUEUE: Queue<TelemetryQueueMessage>;
  ASSETS: Fetcher;

  ENVIRONMENT: string;
  APP_NAME: string;
  APP_URL: string;
  SESSION_TTL_DAYS: string;
  LEASE_TTL_HOURS: string;
  OFFLINE_GRACE_HOURS: string;

  LICENSE_KEY_PEPPER?: string;
  /** Optional dedicated pepper for hashed IPs; falls back to LICENSE_KEY_PEPPER. */
  IP_HASH_PEPPER?: string;
  LICENSE_SIGNING_KEY?: string;
  LICENSE_PUBLIC_KEY?: string;
  LICENSE_SIGNING_KEY_ID?: string;

  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  EMAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  SUPPORT_EMAIL?: string;
  ADMIN_EMAILS?: string;

  PAYMENT_WEBHOOK_SECRET?: string;
  PAYMENT_PROVIDER?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_API_VERSION?: string;
  PROMPTPAY_PHONE?: string;
  PROMPTPAY_NAME?: string;
  BANK_WEBHOOK_SECRET?: string;
  /** Development-only admin bootstrap. Both must be set for /auth/dev-admin to answer. */
  DEV_BOOTSTRAP?: string;
  DEV_ADMIN_TOKEN?: string;
  /** Optional HTTP sink for warn/error logs and alert transitions (empty = console only). */
  OBSERVABILITY_WEBHOOK_URL?: string;
  OBSERVABILITY_WEBHOOK_TOKEN?: string;
  EMAIL_OTP_TTL_MINUTES?: string;
  AUTH_OTP_ENABLED?: string;
  OTP_PEPPER?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER?: string;
}

export interface TelemetryQueueMessage {
  kind: "heartbeat" | "event";
  id: string;
  installationId: string;
  receivedAt: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    user: import("./auth/session").SessionUser | null;
    sessionId: string | null;
    lang: "th" | "en";
    csrfToken: string;
    ipHash: string;
  };
};

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}

export function isLocal(env: Env): boolean {
  return env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";
}

export function requireSecret(env: Env, name: keyof Env): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required secret: ${String(name)}`);
  }
  return value;
}
