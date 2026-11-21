#!/usr/bin/env node
/**
 * Generates an Ed25519 signing key pair for license leases.
 *
 *   node scripts/generate-signing-key.mjs            # prints env vars
 *   node scripts/generate-signing-key.mjs --json     # machine-readable
 *
 * The private key goes into a Cloudflare secret (LICENSE_SIGNING_KEY) or
 * .dev.vars for local development. Never commit it.
 */
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ privateKey: pkcs8, publicKey: spki }, null, 2));
} else {
  console.log("# Ed25519 license signing key — keep the private key secret");
  console.log(`LICENSE_SIGNING_KEY=${pkcs8}`);
  console.log(`LICENSE_SIGNING_KEY_ID=dev-key-1`);
  console.log(`# public key (register this in signing_keys, or let the worker derive it)`);
  console.log(`# PUBLIC_KEY=${spki}`);
}
