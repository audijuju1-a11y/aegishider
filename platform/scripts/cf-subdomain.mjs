import fs from "node:fs";
const config = fs.readFileSync("C:/Users/audim_r0h5i/AppData/Roaming/xdg.config/.wrangler/config/default.toml", "utf8");
const match = config.match(/oauth_token = "([^"]+)"/);
if (!match) throw new Error("no oauth token");
const response = await fetch("https://api.cloudflare.com/client/v4/accounts/79f2b029bbf37d1a7c651b98aedda5bd/workers/subdomain", {
  headers: { Authorization: `Bearer ${match[1]}` },
});
console.log(response.status, await response.text());
