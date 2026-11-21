#!/usr/bin/env node
/** Static landing-page QA: links, assets, anchors, duplicate ids, overflow, copy checks. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve("public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const base = "http://127.0.0.1:4321/";
let failures = 0;

function fail(message) {
  failures++;
  console.log("FAIL:", message);
}

/* ---------- assets / links ---------- */
const refs = new Set();
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (!value || value.startsWith("http") || value.startsWith("mailto:") || value.startsWith("data:")) continue;
  if (value.startsWith("#")) continue;
  refs.add(value.split("?")[0]);
}
for (const ref of refs) {
  const target = path.join(root, ref.replace(/^\//, ""));
  if (!fs.existsSync(target)) fail(`missing file for ${ref}`);
  const response = await fetch(base + ref.replace(/^\//, ""), { method: "GET" });
  if (!response.ok) fail(`${ref} -> HTTP ${response.status}`);
  await response.arrayBuffer();
}
console.log(`checked ${refs.size} file references`);

/* ---------- anchors ---------- */
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const duplicates = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const seen = new Set();
for (const id of duplicates) {
  if (seen.has(id)) fail(`duplicate id: ${id}`);
  seen.add(id);
}
for (const match of html.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.has(match[1])) fail(`missing anchor target: #${match[1]}`);
}
for (const match of html.matchAll(/<use href="#([^"]+)"/g)) {
  if (!ids.has(match[1])) fail(`missing svg symbol: #${match[1]}`);
}
console.log(`checked ${ids.size} ids and anchor targets`);

/* ---------- suspicious strings ---------- */
const bad = ["Ã", "â€", "信息", "technical", "TODO", "lorem ipsum", "undefined"];
for (const token of bad) {
  if (html.includes(token)) fail(`suspicious string in HTML: ${token}`);
}
for (const token of ["EXPLODED VIEW", "38 PARTS", "VISIBILITY GATE", "heroSpin"]) {
  if (html.includes(token)) fail(`legacy clockwork markup returned: ${token}`);
}
for (const stale of ["assets/js/layers.js", "assets/js/main.js", "assets/css/style.css"]) {
  if (fs.existsSync(path.join(root, stale))) fail(`legacy clockwork asset still present: ${stale}`);
}

/* ---------- canonical URL, absolute OG image, sitemap ---------- */
if (!/<link rel="canonical" href="https:\/\//.test(html)) fail("missing absolute canonical link");
const ogImage = html.match(/property="og:image" content="([^"]+)"/)?.[1] ?? "";
if (!ogImage.startsWith("https://")) fail("og:image must be an absolute HTTPS URL");
for (const file of ["sitemap.xml"]) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing ${file}`);
}

/* ---------- og image ---------- */
const ogPath = ogImage.replace(/^https:\/\/aegishider\.pages\.dev\//, "");
const og = path.join(root, ogPath);
if (!fs.existsSync(og)) fail(`missing og:image asset ${ogPath}`);
else {
  const bytes = fs.statSync(og).size;
  console.log(`og:image: ${ogPath} (${bytes} bytes)`);
  if (bytes > 400_000) fail("og:image larger than 400 KB");
}

/* ---------- required deployment files ---------- */
for (const file of ["_headers", "_redirects", "404.html", "robots.txt", "site.webmanifest", "wrangler.toml"]) {
  const target = file === "wrangler.toml" ? path.resolve("wrangler.toml") : path.join(root, file);
  if (!fs.existsSync(target)) fail(`missing deployment file: ${file}`);
}

console.log(failures === 0 ? "\nALL STATIC CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
