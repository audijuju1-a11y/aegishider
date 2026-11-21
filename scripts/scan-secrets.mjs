#!/usr/bin/env node
/**
 * Dependency-free secret scan over tracked files (runs in CI before merge).
 * Catches committed credentials — provider tokens, private keys and literal secrets —
 * without needing a third-party action or network access.
 *
 * Legitimate fixture values live in the allowlisted paths below; add a narrow path
 * rather than weakening a pattern.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const ALLOWED_PATH_PREFIXES = [
  "platform/tests/",
  "platform/vitest.config.ts",
  "platform/.dev.vars.example",
  "docs/",
  "platform/docs/",
  ".github/",
  "scripts/scan-secrets.mjs",
];

const SKIP_EXTENSIONS = new Set([
  ".jar", ".class", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
  ".ttf", ".zip", ".gz", ".bin", ".ndjson", ".pdf", ".mp4", ".svg",
]);

const MAX_BYTES = 512 * 1024;

const PATTERNS = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "Stripe live key", pattern: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "SendGrid key", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{20,}/ },
  {
    name: "literal secret assignment",
    pattern:
      /\b(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|PEPPER)\w*\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']/,
  },
];

const PLACEHOLDER = /replace|example|sample|dummy|placeholder|your[-_]|change[-_]?me|xxx|test[-_]pepper|not-for-production/i;

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return output.split("\0").filter(Boolean);
}

const findings = [];

for (const file of trackedFiles()) {
  if (ALLOWED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
  if (SKIP_EXTENSIONS.has(file.slice(file.lastIndexOf(".")).toLowerCase())) continue;
  let info;
  try {
    info = statSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (!info.isFile() || info.size > MAX_BYTES) continue;

  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue; // binary

  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const { name, pattern } of PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (PLACEHOLDER.test(line)) continue;
      findings.push(`${file}:${index + 1}  ${name}  ${match[0].slice(0, 24)}…`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Potential secrets found (${findings.length}):`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error("\nRemove the value (rotate it if it was real) or allowlist the path in scripts/scan-secrets.mjs.");
  process.exit(1);
}

console.log("secret scan: no credentials found in tracked files");
