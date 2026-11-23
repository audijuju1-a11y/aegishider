#!/usr/bin/env node
/**
 * Licence signing-key rotation (A-14).
 *
 * Generates an Ed25519 key pair, registers the public half in `signing_keys` as
 * `active`, demotes the previous active keys to `deprecated` (they still verify
 * leases that were already issued), and writes the private half to a file that is
 * deleted after it is copied into the Worker secret.
 *
 *   node scripts/rotate-signing-key.mjs --key-id ag-2026-11 --out signing-key.txt
 *   node scripts/rotate-signing-key.mjs --key-id ag-2026-11 --local
 *   node scripts/rotate-signing-key.mjs --key-id ag-2026-11 --dry-run
 *
 * The private key is never printed. Set AG_WRANGLER_JS to a local wrangler entrypoint
 * to run without Node/npx (see scripts/lib/wrangler-d1.mjs).
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { d1Execute, d1Rows } from "./lib/wrangler-d1.mjs";

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : (args[index + 1] ?? null);
};
const keyId = (valueOf("--key-id") ?? "").trim();
const out = valueOf("--out");
const local = args.includes("--local");
const dryRun = args.includes("--dry-run");
const database = process.env.AG_DB_NAME ?? "bhcp-db";

if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId)) {
  console.error(
    "usage: node scripts/rotate-signing-key.mjs --key-id <id> [--out <file>] [--local] [--dry-run]",
  );
  process.exit(2);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateBase64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const publicBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

if (dryRun) {
  console.log(`dry run: generated Ed25519 key pair ${keyId}`);
  console.log(`public key (SPKI base64): ${publicBase64}`);
  console.log("no database write, no private key file");
  process.exit(0);
}

const escapedKeyId = keyId.replace(/'/g, "''");
const execute = (sql) => d1Execute(database, local, sql);

const existing = d1Rows(
  execute(`SELECT key_id, public_key, status FROM signing_keys WHERE key_id = '${escapedKeyId}'`),
);
if (existing.length > 0) {
  console.error(`key_id ${keyId} already exists; refusing to overwrite a published key`);
  process.exit(1);
}

execute(
  `INSERT INTO signing_keys (key_id, algorithm, public_key, status, created_at)
   VALUES ('${escapedKeyId}', 'Ed25519', '${publicBase64}', 'active', ${Date.now()})`,
);
execute(
  `UPDATE signing_keys SET status = 'deprecated'
    WHERE key_id != '${escapedKeyId}' AND status = 'active'`,
);

const target = out ?? `signing-key-${keyId}.txt`;
if (existsSync(target)) {
  console.error(`refusing to overwrite ${target}; remove it or pass another --out path`);
  process.exit(1);
}
writeFileSync(target, privateBase64, { mode: 0o600 });

console.log(`rotated signing key in ${database} (${local ? "local" : "remote"})`);
console.log(`  key_id:     ${keyId}`);
console.log(`  public key: ${publicBase64}`);
console.log(`  private key written to: ${target} (chmod 0600 where supported)`);
console.log("next: set LICENSE_SIGNING_KEY, LICENSE_PUBLIC_KEY and LICENSE_SIGNING_KEY_ID,");
console.log("      deploy, then delete the private-key file.");
console.log("Old keys stay `deprecated` and keep verifying existing leases; retire them");
console.log("only after LEASE_TTL_HOURS has passed.");
