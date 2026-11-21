#!/usr/bin/env node
/**
 * Headless Chrome screenshot + console-error QA helper (no external deps).
 *
 *   node scripts/shot.mjs --url "http://127.0.0.1:4321/?p=0.7" --out shots/hero.png --w 1440 --h 900
 *   node scripts/shot.mjs --url "..." --out shots/page --scrolls 0,900,1800 --w 1440 --h 900
 *   node scripts/shot.mjs --url "http://127.0.0.1:4321/?static=1" --out shots/full --full --w 1440 --h 900
 *
 * Flags: --wait <ms>  --full  --scrolls a,b,c  --reduced (emulate prefers-reduced-motion, default on)
 *        --no-reduced  --mobile  --keep-open
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function parseArgs(argv) {
  const args = { "reduced": true };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const url = args.url || "http://127.0.0.1:4321/";
const width = Number(args.w || 1440);
const height = Number(args.h || 900);
const waitMs = Number(args.wait || 900);
const isMobile = Boolean(args.mobile);
const useReduced = args["no-reduced"] ? false : Boolean(args.reduced);
const scrolls = String(args.scrolls || "0")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n));
const outBase = args.out || "shots/shot";
const fullPage = Boolean(args.full);

const port = 9400 + Math.floor(Math.random() * 400);
const userDir = await fs.mkdtemp(path.join(os.tmpdir(), "bh-chrome-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--disable-gpu",
    "--window-size=" + width + "," + height,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true }
);

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function waitForTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await sleep(120);
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

const wsUrl = await waitForTarget();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
const errors = [];
const requests = new Map();
const failedRequests = [];

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    errors.push(
      "EXCEPTION: " + (d.exception?.description || d.text) + " @ " + (d.url || "") + ":" + d.lineNumber
    );
  }
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
    errors.push(
      "CONSOLE." + msg.params.type + ": " +
        msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")
    );
  }
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    errors.push("LOG: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
  }
  if (msg.method === "Network.requestWillBeSent") {
    requests.set(msg.params.requestId, msg.params.request.url);
  }
  if (msg.method === "Network.loadingFailed") {
    failedRequests.push(requests.get(msg.params.requestId) || msg.params.requestId);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }
    }, 30000);
  });
}

async function evalJs(expression, awaitPromise = false) {
  const out = await send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text);
  return out.result.value;
}

async function capture(file) {
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(shot.data, "base64"));
  console.log("saved", file);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
if (useReduced) {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
}
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: isMobile,
  screenWidth: width,
  screenHeight: height,
});
await send("Page.navigate", { url });
await sleep(waitMs);
try {
  await evalJs("document.fonts.ready.then(() => true)", true);
} catch {
  /* ignore */
}
await sleep(400);

const info = await evalJs(`JSON.stringify({
  title: document.title,
  layerCount: document.querySelectorAll('#assembly .layer').length,
  heroLayers: document.querySelectorAll('#heroAssembly .layer').length,
  atlasCards: document.querySelectorAll('.lcard').length,
  chips: document.querySelectorAll('.chip').length,
  heroAssemblyBox: (() => { const el = document.getElementById('heroAssembly'); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; })(),
  stageBox: (() => { const el = document.querySelector('.stage__scene'); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; })(),
  pageHeight: document.documentElement.scrollHeight,
  scrollY: window.scrollY
})`);
console.log("page:", info);
if (args.eval) {
  console.log("eval:", JSON.stringify(await evalJs(String(args.eval))));
}

if (fullPage) {
  const metrics = await send("Page.getLayoutMetrics");
  const contentHeight = Math.min(
    16000,
    Math.ceil(metrics.cssContentSize?.height || metrics.contentSize.height)
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: contentHeight,
    deviceScaleFactor: 1,
    mobile: isMobile,
    screenWidth: width,
    screenHeight: contentHeight,
  });
  await sleep(600);
  await capture(outBase.endsWith(".png") ? outBase : outBase + "-full.png");
} else {
  for (let i = 0; i < scrolls.length; i++) {
    const y = scrolls[i];
    await evalJs(`window.scrollTo({ top: ${y}, behavior: 'instant' }); true`);
    await sleep(500);
    const name =
      scrolls.length === 1 && outBase.endsWith(".png")
        ? outBase
        : outBase.replace(/\.png$/, "") + "-" + y + ".png";
    await capture(name);
  }
}

if (errors.length) {
  console.log("\nJS ERRORS (" + errors.length + "):");
  errors.slice(0, 30).forEach((e) => console.log(" -", e));
} else {
  console.log("\nJS errors: none");
}
if (failedRequests.length) {
  console.log("Failed requests:", [...new Set(failedRequests)].slice(0, 20));
}

ws.close();
chrome.kill();
try {
  await fs.rm(userDir, { recursive: true, force: true });
} catch {
  /* ignore */
}
