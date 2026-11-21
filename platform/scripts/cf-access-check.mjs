import fs from "node:fs";
const config = fs.readFileSync("C:/Users/audim_r0h5i/AppData/Roaming/xdg.config/.wrangler/config/default.toml", "utf8");
const token = config.match(/oauth_token = "([^"]+)"/)?.[1];
if (!token) throw new Error("no oauth token");
const headers = { Authorization: `Bearer ${token}` };
for (const path of [
  "/accounts/79f2b029bbf37d1a7c651b98aedda5bd/access/organizations",
  "/accounts/79f2b029bbf37d1a7c651b98aedda5bd/access/apps",
]) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers });
  console.log(path, response.status, (await response.text()).slice(0, 800));
}
