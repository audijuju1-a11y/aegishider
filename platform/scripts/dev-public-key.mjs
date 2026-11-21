#!/usr/bin/env node
/** Derives LICENSE_PUBLIC_KEY from LICENSE_SIGNING_KEY in .dev.vars (local only). */
import fs from "node:fs";
import { createPublicKey } from "node:crypto";

const file = ".dev.vars";
if (!fs.existsSync(file)) {
  console.log("no .dev.vars — copy .dev.vars.example first");
  process.exit(0);
}
let text = fs.readFileSync(file, "utf8");
const match = text.match(/^LICENSE_SIGNING_KEY=(.+)$/m);
if (!match) {
  console.log("no LICENSE_SIGNING_KEY in .dev.vars");
  process.exit(1);
}
if (/^LICENSE_PUBLIC_KEY=/m.test(text)) {
  console.log("LICENSE_PUBLIC_KEY already present");
  process.exit(0);
}
const publicKey = createPublicKey({ key: Buffer.from(match[1].trim(), "base64"), format: "der", type: "pkcs8" });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
text += `\nLICENSE_PUBLIC_KEY=${spki}\n`;
fs.writeFileSync(file, text, "utf8");
console.log("LICENSE_PUBLIC_KEY appended");
