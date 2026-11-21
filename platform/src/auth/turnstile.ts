import type { Env } from "../env";
import { isProduction } from "../env";
import { badRequest, configError, unavailable } from "../lib/errors";

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
}

const MAX_CHALLENGE_AGE_MS = 5 * 60 * 1000;

/**
 * Verifies a Cloudflare Turnstile token. In production the secret must be
 * configured; the request fails closed instead of silently skipping the check.
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  remoteIp: string | null,
): Promise<void> {
  if (!env.TURNSTILE_SECRET) {
    if (isProduction(env)) throw configError("ระบบยังไม่ได้ตั้งค่า Turnstile สำหรับโปรดักชัน");
    return;
  }
  if (!token) throw badRequest("กรุณายืนยันว่าคุณไม่ใช่บอท");

  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  let result: TurnstileResponse;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = (await response.json()) as TurnstileResponse;
  } catch {
    throw unavailable("ไม่สามารถตรวจสอบ Turnstile ได้ กรุณาลองใหม่");
  }
  if (!result.success) {
    throw badRequest("การยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่");
  }
  // A token solved on another hostname (same sitekey reuse) or an old token must not count.
  const expectedHost = new URL(env.APP_URL).hostname.toLowerCase();
  if (result.hostname && result.hostname.toLowerCase() !== expectedHost) {
    throw badRequest("การยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่");
  }
  if (result.challenge_ts) {
    const solvedAt = Date.parse(result.challenge_ts);
    if (!Number.isFinite(solvedAt) || Date.now() - solvedAt > MAX_CHALLENGE_AGE_MS) {
      throw badRequest("การยืนยันตัวตนหมดอายุ กรุณาลองใหม่");
    }
  }
}
