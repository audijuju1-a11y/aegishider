#!/usr/bin/env node
/**
 * Architecture ratchet (A-05).
 *
 * A-05 moves SQL out of `platform/src/routes/` into services/repositories one domain
 * at a time. A big-bang rewrite is explicitly out of scope, so this check locks the
 * current baseline: a route file may never gain another `env.DB` reference, and no
 * route file may grow past the line limit. Lower a baseline when SQL moves out;
 * never raise one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = "platform/src/routes";
const MAX_ROUTE_LINES = 900;
// Measured 2026-11-23 after the portal security queries moved to
// services/account-security.ts. admin.ts and auth.ts are the next rounds.
const BASELINE = {
  admin: 15,
  api: 1,
  auth: 8,
  marketing: 1,
  portal: 0,
};

const files = readdirSync(ROUTES_DIR).filter((file) => file.endsWith(".ts"));
const failures = [];

for (const file of files) {
  const name = file.replace(/\.ts$/, "");
  const path = join(ROUTES_DIR, file);
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n").length;
  const dbReferences = (source.match(/\benv\.DB\b/g) ?? []).length;
  const allowed = BASELINE[name] ?? 0;

  if (dbReferences > allowed) {
    failures.push(
      `${path}: ${dbReferences} env.DB reference(s), baseline ${allowed} ` +
        "— move SQL into platform/src/services/ instead of adding it to a route",
    );
  }
  if (lines > MAX_ROUTE_LINES) {
    failures.push(`${path}: ${lines} lines, limit ${MAX_ROUTE_LINES}`);
  }
  console.log(
    `${path}: ${dbReferences} env.DB (baseline ${allowed}), ${lines} lines`,
  );
}

if (failures.length > 0) {
  console.error("\narchitecture check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("\narchitecture check: routes stay within the A-05 baseline");
