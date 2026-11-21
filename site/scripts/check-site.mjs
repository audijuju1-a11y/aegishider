#!/usr/bin/env node
/**
 * Static-site sanity check: the landing page has no build step, so verify instead that every
 * local `href`/`src`/CSS `url(...)` reference resolves to a real file under `site/public`.
 * Run from the repository root (CI) or from `site/`.
 */
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const FILE_PATTERN = /\.(?:html|css)$/i;
const REFERENCE = /(?:href|src)\s*=\s*"([^"]+)"|url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
const SKIP_PREFIXES = ["http:", "https:", "//", "mailto:", "tel:", "data:", "#", "javascript:"];

async function walk(directory) {
  const entries = await readdirSafe(directory);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) files.push(...(await walk(fullPath)));
    else if (FILE_PATTERN.test(entry)) files.push(fullPath);
  }
  return files;
}

async function readdirSafe(directory) {
  const { readdir } = await import("node:fs/promises");
  return readdir(directory);
}

function resolveReference(reference, fromFile) {
  const target = reference.split(/[?#]/)[0].trim();
  if (!target) return null;
  if (SKIP_PREFIXES.some((prefix) => target.startsWith(prefix))) return null;
  if (target.includes("{{") || target.includes("%7B")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  // `url(%23n)` is a same-document anchor, not a file.
  if (!decoded || decoded.startsWith("#")) return null;
  // Relative references resolve against the referring file, not the site root.
  return decoded.startsWith("/")
    ? path.join(publicRoot, decoded)
    : path.resolve(path.dirname(fromFile), decoded);
}

const failures = [];
const files = await walk(publicRoot);

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(REFERENCE)) {
    const reference = match[1] ?? match[2];
    if (!reference) continue;
    const resolved = resolveReference(reference, file);
    if (!resolved) continue;
    const candidates = [resolved, path.join(resolved, "index.html")];
    if (!candidates.some((candidate) => existsSync(candidate))) {
      failures.push(`${path.relative(publicRoot, file)} → ${reference}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local references (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`site: ${files.length} files checked, all local references resolve`);
