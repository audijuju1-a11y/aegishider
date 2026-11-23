#!/usr/bin/env node
/**
 * Guards the single source of truth for the shipped plugin version (Wave 0 / P0-2).
 *
 * The version lives in `aegishider-integrated/pom.xml`; every other surface must match it:
 * plugin.yml, the release checksum file, the seed catalogue, the plugin README, the root
 * README link and the Pages mirror. Fails with the exact mismatch instead of silently
 * shipping 4.0.4 pages for a 4.0.5 jar.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const pom = read("aegishider-integrated/pom.xml");
const pomVersion = pom.match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
check(Boolean(pomVersion), "aegishider-integrated/pom.xml: no <version> element found");
const version = pomVersion ?? "unknown";

const pluginYml = read("aegishider-integrated/src/main/resources/plugin.yml");
const pluginVersion = pluginYml.match(/^version:\s*(\S+)\s*$/m)?.[1];
check(
  pluginVersion === version,
  `plugin.yml version "${pluginVersion}" does not match pom.xml "${version}"`,
);

const sumsName = `Aegishider-${version}-SHA256SUMS`;
const sumsPath = `docs/releases/${sumsName}`;
check(existsSync(join(root, sumsPath)), `missing ${sumsPath}`);
if (existsSync(join(root, sumsPath))) {
  const lines = read(sumsPath).trim().split(/\r?\n/).filter(Boolean);
  check(lines.length === 6, `${sumsPath}: expected 6 entries, found ${lines.length}`);
  for (const line of lines) {
    check(/^[0-9a-f]{64} \*Aegishider-/.test(line), `${sumsPath}: malformed line "${line}"`);
    check(line.includes(`-${version}-`), `${sumsPath}: entry is not ${version}: "${line}"`);
  }
}

const seed = read("platform/seed/seed.sql");
check(
  seed.includes(`'${version}', 'stable', 'published'`),
  `platform/seed/seed.sql: no published ${version} release record`,
);

const pluginReadme = read("aegishider-integrated/README.md");
check(
  (pluginReadme.split("\n")[0] ?? "").includes(version),
  `aegishider-integrated/README.md: heading does not name ${version}`,
);

const rootReadme = read("README.md");
check(rootReadme.includes(sumsName), `README.md: does not link ${sumsPath}`);

const siteIndex = read("site/public/index.html");
check(
  siteIndex.includes(`"softwareVersion":"${version}"`),
  `site/public/index.html: softwareVersion is not ${version}`,
);

const sumFiles = readdirSync(join(root, "docs/releases"))
  .filter((file) => file.endsWith("-SHA256SUMS"))
  .sort();
check(
  sumFiles.at(-1) === sumsName,
  `docs/releases: newest checksum file is ${sumFiles.at(-1)}, expected ${sumsName}`,
);

if (failures.length > 0) {
  console.error(`version consistency failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `version consistency: ${version} agrees across pom.xml, plugin.yml, checksums, seed, README and site`,
);
