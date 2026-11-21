import type { Env } from "../env";
import { DAY, MINUTE, now } from "../lib/time";
import { newId, randomToken, sha256Hex } from "../lib/core";
import { all, first, run } from "../lib/db";

export interface OrgMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: "owner" | "member" | "read_only";
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  locale: string;
  memberships: OrgMembership[];
}

export interface LoadedSession {
  user: SessionUser;
  sessionId: string;
  expiresAt: number;
  lastSeenAt: number;
}

interface SessionRow {
  session_id: string;
  last_seen_at: number;
  session_expires_at: number;
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  locale: string;
}

export function sessionTtlDays(env: Env): number {
  const parsed = Number.parseInt(env.SESSION_TTL_DAYS ?? "14", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : 14;
}

export async function findUserByEmail(env: Env, email: string): Promise<SessionUser | null> {
  const row = await first<{ id: string; email: string; display_name: string | null; role: string; locale: string }>(
    env.DB,
    `SELECT id, email, display_name, role, locale FROM users WHERE email = ? AND status != 'deleted'`,
    email.toLowerCase(),
  );
  if (!row) return null;
  return { ...toUser(row), memberships: await loadMemberships(env, row.id) };
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  locale: string;
}

function toUser(row: UserRow): Omit<SessionUser, "memberships"> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    locale: row.locale,
  };
}

async function loadMemberships(env: Env, userId: string): Promise<OrgMembership[]> {
  const rows = await all<{ org_id: string; org_name: string; org_slug: string; role: OrgMembership["role"] }>(
    env.DB,
    `SELECT m.org_id, m.role, o.name AS org_name, o.slug AS org_slug
       FROM organization_members m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND o.status = 'active'
      ORDER BY m.created_at ASC`,
    userId,
  );
  return rows.map((row) => ({
    orgId: row.org_id,
    orgName: row.org_name,
    orgSlug: row.org_slug,
    role: row.role,
  }));
}

export async function createSession(
  env: Env,
  userId: string,
  meta: { ipHash: string | null; userAgent: string | null },
): Promise<{ token: string; sessionId: string; expiresAt: number }> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const sessionId = newId("ses");
  const createdAt = now();
  const expiresAt = createdAt + sessionTtlDays(env) * DAY;
  await run(
    env.DB,
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId,
    userId,
    tokenHash,
    createdAt,
    createdAt,
    expiresAt,
    meta.ipHash,
    meta.userAgent ? meta.userAgent.slice(0, 300) : null,
  );
  await run(env.DB, `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`, createdAt, createdAt, userId);
  return { token, sessionId, expiresAt };
}

export async function loadSession(env: Env, token: string): Promise<LoadedSession | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256Hex(token);
  const row = await first<SessionRow>(
    env.DB,
    `SELECT s.id AS session_id, s.last_seen_at, s.expires_at AS session_expires_at,
            u.id, u.email, u.display_name, u.role, u.locale
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND u.status = 'active'`,
    tokenHash,
    now(),
  );
  if (!row) return null;
  const memberships = await loadMemberships(env, row.id);
  return {
    sessionId: row.session_id,
    expiresAt: row.session_expires_at,
    lastSeenAt: row.last_seen_at,
    user: { ...toUser(row), memberships },
  };
}

export async function touchSession(env: Env, sessionId: string, lastSeenAt: number): Promise<void> {
  if (now() - lastSeenAt < 10 * MINUTE) return;
  await run(env.DB, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, now(), sessionId);
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await run(env.DB, `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now(), sessionId);
}

export async function revokeOtherSessions(env: Env, userId: string, keepSessionId: string): Promise<void> {
  await run(
    env.DB,
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    now(),
    userId,
    keepSessionId,
  );
}

export interface SessionListRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  ip_hash: string | null;
  user_agent: string | null;
}

export async function listSessions(env: Env, userId: string): Promise<SessionListRow[]> {
  return all<SessionListRow>(
    env.DB,
    `SELECT id, created_at, last_seen_at, expires_at, revoked_at, ip_hash, user_agent
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    userId,
  );
}

/* ------------------------------------------------------------------ accounts */

export async function findOrCreateAccount(
  env: Env,
  rawEmail: string,
): Promise<{ user: SessionUser; created: boolean }> {
  const email = rawEmail.trim().toLowerCase();
  const existing = await findUserByEmail(env, email);
  if (existing) return { user: existing, created: false };

  const userId = newId("usr");
  const orgId = newId("org");
  const orgSlug = `org-${userId.slice(-8).toLowerCase()}`;
  const timestamp = now();
  const localPart = email.split("@")[0] ?? "member";
  const displayName = localPart.slice(0, 60);
  const orgName = `${localPart.slice(0, 40)} workspace`.trim();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, display_name, role, status, locale, created_at, updated_at)
         VALUES (?, ?, ?, 'customer', 'active', 'th', ?, ?)`,
      ).bind(userId, email, displayName, timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO organizations (id, name, slug, owner_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      ).bind(orgId, orgName, orgSlug, userId, timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
      ).bind(orgId, userId, timestamp),
    ]);
  } catch {
    // Concurrent first login: unique email constraint won; load the winner.
    const raced = await findUserByEmail(env, email);
    if (raced) return { user: raced, created: false };
    throw new Error("ไม่สามารถสร้างบัญชีได้");
  }

  return {
    created: true,
    user: {
      id: userId,
      email,
      displayName,
      role: "customer",
      locale: "th",
      memberships: [{ orgId, orgName, orgSlug, role: "owner" }],
    },
  };
}

/* -------------------------------------------------------------- email tokens */

export async function createEmailToken(
  env: Env,
  userId: string,
  purpose: "login" | "verify_email" | "security",
  ttlMinutes: number,
  ipHash: string | null,
): Promise<string> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await run(
    env.DB,
    `INSERT INTO email_tokens (id, user_id, token_hash, purpose, expires_at, created_at, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newId("emt"),
    userId,
    hash,
    purpose,
    now() + ttlMinutes * MINUTE,
    now(),
    ipHash,
  );
  return token;
}

export async function consumeEmailToken(
  env: Env,
  rawToken: string,
  purpose: "login" | "verify_email" | "security",
): Promise<string | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const hash = await sha256Hex(rawToken);
  const row = await first<{ user_id: string }>(
    env.DB,
    `UPDATE email_tokens SET consumed_at = ?
      WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
      RETURNING user_id`,
    now(),
    hash,
    purpose,
    now(),
  );
  if (!row) return null;
  await run(env.DB, `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?`, now(), row.user_id);
  return row.user_id;
}

export async function getUserById(env: Env, userId: string): Promise<SessionUser | null> {
  const row = await first<UserRow>(
    env.DB,
    `SELECT id, email, display_name, role, locale FROM users WHERE id = ? AND status != 'deleted'`,
    userId,
  );
  if (!row) return null;
  return { ...toUser(row), memberships: await loadMemberships(env, row.id) };
}
