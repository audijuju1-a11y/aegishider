#!/usr/bin/env node
/**
 * Operator password reset without an email provider (Wave 2).
 *
 * Generates a random temporary password, writes a PBKDF2-SHA256 hash in the same
 * format the Worker uses, and prints the password once. Every existing session is
 * revoked and TOTP is cleared, because the account owner lost their credential.
 *
 *   node scripts/reset-password.mjs you@example.com
 *   node scripts/reset-password.mjs you@example.com --local
 *
 * Set AG_WRANGLER_JS to a local wrangler entrypoint to run without Node/npx.
 */
import { generateTemporaryPassword, hashPassword } from "./lib/password-hash.mjs";
import { d1Execute, d1Rows } from "./lib/wrangler-d1.mjs";

const args = process.argv.slice(2);
const email = (args.find((value) => !value.startsWith("--")) ?? "").trim().toLowerCase();
const local = args.includes("--local");
const database = process.env.AG_DB_NAME ?? "bhcp-db";

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("usage: node scripts/reset-password.mjs <email> [--local]");
  process.exit(2);
}

const escaped = email.replace(/'/g, "''");
const wrangler = (sql) => d1Execute(database, local, sql);

const password = generateTemporaryPassword();
const hash = await hashPassword(password);
const now = Date.now();

const result = wrangler(
  `UPDATE users
      SET password_hash = '${hash}',
          password_updated_at = ${now},
          totp_secret = NULL,
          totp_enabled_at = NULL,
          totp_last_counter = NULL,
          updated_at = ${now}
    WHERE email = '${escaped}'
    RETURNING id`,
);

if (d1Rows(result).length === 0) {
  console.error(`no account for ${email}`);
  process.exit(1);
}

wrangler(
  `UPDATE sessions SET revoked_at = ${now}
    WHERE user_id = (SELECT id FROM users WHERE email = '${escaped}')
      AND revoked_at IS NULL`,
);

console.log(`temporary password for ${email}:`);
console.log(`  ${password}`);
console.log("Shown once. The user should change it at /app/account after signing in.");
