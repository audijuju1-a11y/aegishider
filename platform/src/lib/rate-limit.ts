import type { Env } from "../env";
import { tooMany } from "./errors";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in D1. Increments atomically, so concurrent requests
 * cannot exceed the limit by racing. Keys must be hashed by the caller when they
 * contain PII.
 */
export async function consumeRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - Date.now()) / 1000)),
  };
}

/** Throws a 429 AppError when the limit is exhausted. */
export async function enforceRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await consumeRateLimit(env, key, limit, windowSeconds);
  if (!result.allowed) {
    const error = tooMany();
    throw Object.assign(error, {
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    });
  }
}
