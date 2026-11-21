import type { Env } from "../env";
import { configError, unauthorized } from "../lib/errors";
import { base64urlDecode } from "../lib/core";
import { log } from "../lib/logger";

interface AccessHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface AccessPayload {
  aud?: string | string[];
  email?: string;
  sub?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
}

interface Jwks {
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

const JWKS_TTL_SECONDS = 600;

async function loadJwks(env: Env): Promise<Jwks> {
  const team = env.ACCESS_TEAM_DOMAIN;
  if (!team) throw configError("ยังไม่ได้ตั้งค่า Cloudflare Access");
  const cacheKey = `access:jwks:${team}`;
  const cached = await env.CACHE.get(cacheKey, "json");
  if (cached) return cached as Jwks;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw configError("ไม่สามารถดึงกุญแจ Cloudflare Access ได้");
  const jwks = (await response.json()) as Jwks;
  await env.CACHE.put(cacheKey, JSON.stringify(jwks), { expirationTtl: JWKS_TTL_SECONDS });
  return jwks;
}

function decodeJson<T>(segment: string): T | null {
  try {
    const bytes = base64urlDecode(segment);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/**
 * Verifies a Cloudflare Access JWT (RS256) against the team JWKS and audience.
 * Returns the verified email or null when the assertion is not valid.
 */
export async function verifyAccessJwt(
  env: Env,
  assertion: string | undefined,
): Promise<{ email: string; sub: string } | null> {
  if (!assertion) return null;
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!team || !audience) throw configError("ยังไม่ได้ตั้งค่า Cloudflare Access (team domain / audience)");

  const parts = assertion.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJson<AccessHeader>(encodedHeader);
  const payload = decodeJson<AccessPayload>(encodedPayload);
  if (!header || !payload || header.alg !== "RS256") return null;

  const jwks = await loadJwks(env);
  const jwk = header.kid
    ? jwks.keys.find((key) => key.kid === header.kid)
    : jwks.keys.length === 1
      ? jwks.keys[0]
      : undefined;
  if (!jwk) return null;

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64urlDecode(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch (error) {
    log("warn", "access.verify_error", { error: error instanceof Error ? error.message : "unknown" });
    return null;
  }
  if (!verified) return null;

  const seconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < seconds - 60) return null;
  if (payload.nbf && payload.nbf > seconds + 60) return null;
  if (payload.iat && payload.iat > seconds + 300) return null;

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) return null;
  // Fail closed: an assertion without `iss` is rejected, not accepted by omission.
  const expectedIssuer = `https://${team}`;
  if (!payload.iss || payload.iss.replace(/\/$/, "") !== expectedIssuer.replace(/\/$/, "")) return null;

  const email = payload.email?.trim().toLowerCase();
  if (!email) return null;
  return { email, sub: payload.sub ?? "" };
}

/** Admin requests in production must carry a valid Access assertion. */
export async function requireAccessAssertion(env: Env, assertion: string | undefined): Promise<void> {
  const result = await verifyAccessJwt(env, assertion);
  if (!result) throw unauthorized("ต้องยืนยันตัวตนผ่าน Cloudflare Access ก่อนเข้าใช้งานส่วนผู้ดูแล");
}
