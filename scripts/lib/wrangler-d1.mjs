/**
 * Runs `wrangler d1 execute` from operator scripts.
 *
 * - On Windows, `npx` must be invoked as `npx.cmd`; execFileSync does not go through a shell.
 * - `AG_WRANGLER_JS` points at a local wrangler entrypoint. The current runtime (Node or Bun)
 *   then executes it directly, which allows running the scripts without Node/npx installed.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function d1Execute(database, local, sql) {
  const target = local ? "--local" : "--remote";
  const wranglerJs = process.env.AG_WRANGLER_JS;
  const executable = wranglerJs
    ? process.execPath
    : process.platform === "win32"
      ? "npx.cmd"
      : "npx";
  const args = wranglerJs
    ? [resolve(wranglerJs), "d1", "execute", database, target, "--command", sql]
    : ["wrangler", "d1", "execute", database, target, "--command", sql];

  return execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Wrangler prints a banner and then a JSON array of `{ results, success, meta }`.
 * `meta.changes` is not always present, so callers use `RETURNING` and read rows here.
 */
export function d1Rows(stdout) {
  const start = stdout.lastIndexOf("\n[\n");
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(stdout.slice(start + 1));
    return Array.isArray(parsed) && Array.isArray(parsed[0]?.results) ? parsed[0].results : [];
  } catch {
    return [];
  }
}
