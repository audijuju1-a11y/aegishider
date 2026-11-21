import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";

const turnstileSecret = process.argv[2] ?? "";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const secrets = {
  LICENSE_KEY_PEPPER: randomBytes(32).toString("hex"),
  LICENSE_SIGNING_KEY: pkcs8,
  LICENSE_PUBLIC_KEY: spki,
  LICENSE_SIGNING_KEY_ID: "prod-1",
  OTP_PEPPER: randomBytes(32).toString("hex"),
  TURNSTILE_SECRET: turnstileSecret,
};

// Written to the OS temp directory, never inside the repository: this file holds the
// licence signing private key, and a single `git add .` would publish it.
const target = path.join(os.tmpdir(), `aegishider-prod-secrets-${process.pid}.json`);
fs.writeFileSync(target, JSON.stringify(secrets, null, 2), { mode: 0o600 });
console.log("wrote", target, "with", Object.keys(secrets).length, "secrets");
console.log("Upload them to Worker secrets, then delete the file.");
