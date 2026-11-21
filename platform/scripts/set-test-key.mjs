#!/usr/bin/env node
/** Writes a fresh Ed25519 test key pair into vitest.config.ts (test-only, never used in production). */
import fs from "node:fs";
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateB64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const publicB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const file = "vitest.config.ts";
let text = fs.readFileSync(file, "utf8");
text = text.replace(/LICENSE_SIGNING_KEY:\s*"[^"]*"/, `LICENSE_SIGNING_KEY: "${privateB64}"`);
if (/LICENSE_PUBLIC_KEY:\s*"[^"]*"/.test(text)) {
  text = text.replace(/LICENSE_PUBLIC_KEY:\s*"[^"]*"/, `LICENSE_PUBLIC_KEY: "${publicB64}"`);
} else {
  text = text.replace(
    /(LICENSE_SIGNING_KEY_ID:\s*"[^"]*")/,
    `$1,\n            LICENSE_PUBLIC_KEY: "${publicB64}"`,
  );
}
fs.writeFileSync(file, text, "utf8");
console.log("test key pair written to vitest.config.ts");
