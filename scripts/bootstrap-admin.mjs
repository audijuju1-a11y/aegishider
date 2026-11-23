#!/usr/bin/env node
/**
 * First-admin bootstrap (Wave 2 / A-02).
 *
 * The platform has no seed admin, so a fresh deployment could not reach /admin without
 * hand-written SQL. This script promotes an existing account (sign up once in the UI
 * first) and verifies the result. It is idempotent and never creates an account.
 *
 *   node scripts/bootstrap-admin.mjs you@example.com
 *   node scripts/bootstrap-admin.mjs you@example.com --local
 */
import { d1Execute, d1Rows } from "./lib/wrangler-d1.mjs";

const args = process.argv.slice(2);
const email = (args.find((value) => !value.startsWith("--")) ?? "").trim().toLowerCase();
const local = args.includes("--local");
const database = process.env.AG_DB_NAME ?? "bhcp-db";

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("usage: node scripts/bootstrap-admin.mjs <email> [--local]");
  process.exit(2);
}

const escaped = email.replace(/'/g, "''");
const wrangler = (sql) => d1Execute(database, local, sql);

console.log(`promoting ${email} in ${database} (${local ? "local" : "remote"})`);

const update = wrangler(
  `UPDATE users SET role = 'super_admin', status = 'active', updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000) WHERE email = '${escaped}' RETURNING id`,
);

if (d1Rows(update).length === 0) {
  console.error(
    `no account for ${email}. Sign up at /auth/register first, then run this command again.`,
  );
  process.exit(1);
}

const verify = wrangler(
  `SELECT email, role, status FROM users WHERE email = '${escaped}'`,
);
console.log(verify);
console.log(`done. Open /admin and sign in as ${email}.`);
