import type { Context } from "hono";
import type { AppEnv } from "../env";
import { forbidden, unauthorized } from "../lib/errors";
import { primaryMembership, type SessionUser } from "./session";

export type Permission =
  | "customers.read"
  | "customers.write"
  | "licenses.read"
  | "licenses.write"
  | "products.read"
  | "products.write"
  | "releases.write"
  | "orders.read"
  | "orders.write"
  | "support.read"
  | "support.write"
  | "servers.read"
  | "security.read"
  | "security.write"
  | "audit.read"
  | "telemetry.read"
  | "settings.read"
  | "settings.write";

const ALL_PERMISSIONS: Permission[] = [
  "customers.read",
  "customers.write",
  "licenses.read",
  "licenses.write",
  "products.read",
  "products.write",
  "releases.write",
  "orders.read",
  "orders.write",
  "support.read",
  "support.write",
  "servers.read",
  "security.read",
  "security.write",
  "audit.read",
  "telemetry.read",
  "settings.read",
  "settings.write",
];

const READ_ONLY: Permission[] = ALL_PERMISSIONS.filter((permission) => permission.endsWith(".read"));

// `admin` sits strictly below `super_admin`: it cannot change roles or platform settings,
// so an admin cannot promote themselves or anyone else to super_admin.
const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (permission) => permission !== "settings.write",
);

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  product_manager: [
    "products.read",
    "products.write",
    "releases.write",
    "licenses.read",
    "customers.read",
    "servers.read",
    "support.read",
    "telemetry.read",
  ],
  support: [
    "customers.read",
    "licenses.read",
    "servers.read",
    "support.read",
    "support.write",
    "orders.read",
    "telemetry.read",
  ],
  security_analyst: [
    "security.read",
    "audit.read",
    "servers.read",
    "customers.read",
    "licenses.read",
    "telemetry.read",
  ],
  read_only_admin: READ_ONLY,
  customer: [],
};

export const STAFF_ROLES = Object.keys(ROLE_PERMISSIONS).filter((role) => role !== "customer");

export function isStaff(user: SessionUser): boolean {
  return user.role !== "customer" && STAFF_ROLES.includes(user.role);
}

export function can(user: SessionUser, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[user.role] ?? []).includes(permission);
}

type Ctx = Context<AppEnv>;

export function currentUser(c: Ctx): SessionUser | null {
  return c.get("user");
}

export function requireUser(c: Ctx): SessionUser {
  const user = c.get("user");
  if (!user) throw unauthorized();
  return user;
}

export function requirePermission(c: Ctx, permission: Permission): SessionUser {
  const user = requireUser(c);
  if (!can(user, permission)) throw forbidden();
  return user;
}

export function requireStaff(c: Ctx): SessionUser {
  const user = requireUser(c);
  if (!isStaff(user)) throw forbidden("เฉพาะทีมงานเท่านั้น");
  return user;
}

export function primaryOrg(user: SessionUser) {
  return primaryMembership(user);
}

export function orgMembership(user: SessionUser, orgId: string) {
  return user.memberships.find((membership) => membership.orgId === orgId) ?? null;
}

/** Throws unless the user belongs to the organization (tenant isolation). */
export function requireOrgAccess(user: SessionUser, orgId: string): void {
  if (!orgMembership(user, orgId)) throw forbidden("คุณไม่มีสิทธิ์เข้าถึงข้อมูลขององค์กรนี้");
}

export function canWriteOrg(user: SessionUser, orgId: string): boolean {
  const membership = orgMembership(user, orgId);
  return membership?.role === "owner" || membership?.role === "member";
}

export function requireOrgWrite(user: SessionUser, orgId: string): void {
  requireOrgAccess(user, orgId);
  if (!canWriteOrg(user, orgId)) throw forbidden("บัญชีของคุณเป็นแบบอ่านอย่างเดียว");
}

/** Admin emails allowed to bootstrap the console in development. */
export function devAdminEmails(env: { DEV_ADMIN_EMAILS?: string }): string[] {
  return (env.DEV_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
