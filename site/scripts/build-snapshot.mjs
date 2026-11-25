#!/usr/bin/env node
/**
 * Rebuilds the Pages snapshot from the live platform so the homepage and 404 never
 * drift from the server-rendered originals. Run after deploying the Worker.
 *
 * PLATFORM_URL / PAGES_URL / SOFTWARE_VERSION can be overridden from the environment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://aegishider-platform.audijuju1.workers.dev").replace(/\/$/, "");
const PAGES_URL = (process.env.PAGES_URL ?? "https://aegishider.pages.dev").replace(/\/$/, "");
const SOFTWARE_VERSION =
  process.env.SOFTWARE_VERSION ??
  fs.readFileSync(new URL("../../aegishider-integrated/pom.xml", import.meta.url), "utf8")
    .match(/<version>([^<]+)<\/version>/)?.[1]?.trim() ??
  "unknown";

const sitePublic = fileURLToPath(new URL("../public/", import.meta.url));
const platformPublic = fileURLToPath(new URL("../../platform/public/", import.meta.url));

async function fetchPage(url, expectedStatus) {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned ${response.status}, expected ${expectedStatus}`);
  }
  return response.text();
}

function transform(html) {
  let out = html;
  // Application routes stay on the Worker; assets remain local so the strict CSP works.
  out = out.replace(/href="\/(?!assets\/|site\.webmanifest)([^"]*)"/g, (_match, route) => {
    if (route === "") return 'href="/"';
    return `href="${PLATFORM_URL}/${route}"`;
  });
  out = out.replaceAll(`${PLATFORM_URL}/assets/`, `${PAGES_URL}/assets/`);
  return out.replace(/[ \t]+$/gm, "");
}

function withHomeMeta(html) {
  // The platform now ships canonical/og:url/JSON-LD. Re-scope them to the Pages host
  // instead of emitting a second set of tags.
  let out = html
    .replace(/<link rel="canonical"[^>]*>\s*/g, "")
    .replace(/<meta property="og:url"[^>]*>\s*/g, "")
    .replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g,
      (_match, open, json, close) => `${open}${json.replaceAll(PLATFORM_URL, PAGES_URL)}${close}`);
  const head = [
    `<meta property="og:url" content="${PAGES_URL}/">`,
    `<link rel="canonical" href="${PAGES_URL}/">`,
  ].join("\n  ");
  out = out.replace("</head>", `  ${head}\n</head>`);
  return out;
}

function withSoftwareApplication(html, version) {
  // The home page carries a WebSite/Organization graph, but the mirror must also state
  // which plugin version it represents. Keep the block valid JSON-LD for crawlers.
  if (html.includes('"softwareVersion"')) return html;
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Aegishider",
    applicationCategory: "GameApplication",
    operatingSystem: "Paper 1.21.1–26.3 / Java 21+",
    softwareVersion: version,
    url: `${PAGES_URL}/`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "THB" },
  };
  return html.replace(
    "</head>",
    `  <script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`,
  );
}

const home = withSoftwareApplication(
  withHomeMeta(transform(await fetchPage(`${PLATFORM_URL}/`, 200))),
  SOFTWARE_VERSION,
);
const notFound = transform(await fetchPage(`${PLATFORM_URL}/__snapshot_404__`, 404));

fs.writeFileSync(path.join(sitePublic, "index.html"), home, "utf8");
fs.writeFileSync(path.join(sitePublic, "404.html"), notFound, "utf8");

for (const directory of ["assets", "downloads", ".well-known"]) {
  const target = path.join(sitePublic, directory);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(platformPublic, directory), target, { recursive: true });
}

console.log(`snapshot rebuilt from ${PLATFORM_URL} (${home.length} bytes home, ${notFound.length} bytes 404)`);
