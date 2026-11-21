import fs from "node:fs";
const config = fs.readFileSync("C:/Users/audim_r0h5i/AppData/Roaming/xdg.config/.wrangler/config/default.toml", "utf8");
const token = config.match(/oauth_token = "([^"]+)"/)?.[1];
if (!token) throw new Error("no oauth token");
const response = await fetch("https://api.cloudflare.com/client/v4/accounts/79f2b029bbf37d1a7c651b98aedda5bd/challenges/widgets", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Aegishider Control Platform",
    domains: ["aegishider-platform.audijuju1.workers.dev"],
    mode: "managed",
  }),
});
console.log(response.status, await response.text());
