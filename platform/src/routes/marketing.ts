import { Hono } from "hono";
import type { AppEnv } from "../env";
import { isProduction } from "../env";
import { langOf, publicPage } from "./helpers";
import {
  changelogPage,
  contactPage,
  docsIndex,
  docPage,
  errorPage,
  legalPage,
  marketingHome,
  pluginsIndex,
  pricingPage,
  productDetail,
  statusPage,
  supportPage,
} from "../views/marketing";
import {
  getProductView,
  listAllReleases,
  listProductSummaries,
} from "../services/catalog";
import { listLicensesForUser } from "../services/licensing";
import { docs, getDoc } from "../content/docs";
import { getStatusReport } from "../services/status";
import { createContactMessage } from "../services/support";
import { first } from "../lib/db";
import { clientIp, hashIp, readForm, formValue } from "../lib/http";
import { enforceRateLimit } from "../lib/rate-limit";
import { verifyTurnstile } from "../auth/turnstile";
import { getSiteContent } from "../lib/site-content";
import { logError } from "../lib/logger";
import { aboutPage, developersPage } from "../views/marketing";

export const marketingRoutes = new Hono<AppEnv>();

marketingRoutes.get("/", async (c) => {
  const [products, content] = await Promise.all([
    listProductSummaries(c.env, { statuses: ["published"], limit: 6 }),
    getSiteContent(c.env),
  ]);
  return publicPage(c, {
    title: "แพลตฟอร์มปลั๊กอิน Minecraft ฟรี",
    description: "พอร์ทัลเจ้าของเซิร์ฟเวอร์และคอนโซลผู้ดูแล พร้อมไลเซนส์ Ed25519, telemetry และไฟล์ปลั๊กอินฟรี",
    body: marketingHome(products, langOf(c), content),
  });
});

marketingRoutes.get("/plugins", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const category = (c.req.query("category") ?? "").trim().slice(0, 40);
  const products = await listProductSummaries(c.env, {
    statuses: ["published", "coming_soon"],
    query: q || undefined,
    category: category || undefined,
    limit: 50,
  });
  return publicPage(c, {
    title: "ผลิตภัณฑ์",
    description: "ปลั๊กอิน Minecraft ที่พร้อมใช้งาน ฟรี พร้อมไฟล์ดาวน์โหลดและไลเซนส์จริง",
    body: pluginsIndex(products, { q, category, lang: langOf(c) }),
  });
});

marketingRoutes.get("/release/:id/download", async (c) => {
  // Public artifact download: rate-limited per hashed IP so it cannot be used as free bandwidth.
  await enforceRateLimit(c.env, `download:${await hashIp(c.env, clientIp(c))}`, 120, 3600);
  const release = await first<{ version: string; artifact_r2_key: string | null; status: string }>(
    c.env.DB,
    `SELECT version, artifact_r2_key, status FROM product_releases WHERE id = ?`,
    c.req.param("id"),
  );
  if (!release || release.status !== "published" || !release.artifact_r2_key) {
    return c.text("not found", 404);
  }
  const object = await c.env.ARCHIVE.get(release.artifact_r2_key);
  if (!object) return c.text("not found", 404);
  return new Response(object.body, {
    headers: {
      "content-type": "application/java-archive",
      "content-disposition": `attachment; filename="Aegishider-${release.version.replace(/[^A-Za-z0-9._-]/g, "")}.jar"`,
      "x-content-type-options": "nosniff",
      "content-length": object.size.toString(),
      etag: object.httpEtag,
      "cache-control": "public, max-age=300",
    },
  });
});

marketingRoutes.get("/favicon.ico", (c) => c.redirect("/assets/img/logo-32.png", 301));

marketingRoutes.get("/site.webmanifest", (c) => {
  c.header("Content-Type", "application/manifest+json; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(JSON.stringify({
    name: "Aegishider Control Platform",
    short_name: "Aegishider",
    description: "แพลตฟอร์มปลั๊กอิน Minecraft ฟรี พร้อมไลเซนส์ Ed25519 และ telemetry",
    start_url: "/",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    lang: "th",
    icons: [
      { src: "/assets/img/logo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/assets/img/logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  }));
});

marketingRoutes.get("/.well-known/security.txt", (c) => {
  const base = c.env.APP_URL.replace(/\/$/, "");
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body([
    `Contact: ${base}/contact`,
    `Policy: ${base}/docs/security`,
    "Preferred-Languages: th, en",
    `Canonical: ${base}/.well-known/security.txt`,
    "Expires: 2027-11-24T00:00:00.000Z",
    "",
  ].join("\n"));
});

marketingRoutes.get("/sitemap.xml", async (c) => {
  const products = await listProductSummaries(c.env, { statuses: ["published"], limit: 50 });
  const base = c.env.APP_URL.replace(/\/$/, "");
  const paths = [
    "/", "/plugins", "/pricing", "/changelog", "/docs", "/developers", "/status",
    "/support", "/contact", "/about", "/capabilities", "/legal/terms", "/legal/privacy",
    ...products.map((product) => `/plugins/${product.slug}`),
    ...docs.map((doc) => `/docs/${doc.slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${base}${path}</loc></url>`).join("\n")}
</urlset>`;
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(body);
});

marketingRoutes.get("/plugins/basehider", (c) => c.redirect("/plugins/aegishider", 301));
marketingRoutes.get("/plugins/aegishider/capabilities", (c) => c.redirect("/capabilities", 301));

marketingRoutes.get("/plugins/:slug", async (c) => {
  const product = await getProductView(c.env, c.req.param("slug"));
  if (!product) {
    return publicPage(c, {
      title: "ไม่พบผลิตภัณฑ์",
      body: errorPage("ไม่พบผลิตภัณฑ์นี้", "ลิงก์อาจเปลี่ยนหรือผลิตภัณฑ์ถูกเก็บถาวรแล้ว"),
      status: 404,
      noIndex: true,
    });
  }
  const user = c.get("user");
  const licenses = user ? await listLicensesForUser(c.env, user.id) : [];
  return publicPage(c, {
    title: product.name,
    description: product.seo_description ?? product.tagline,
    body: productDetail(product, {
      lang: langOf(c),
      csrf: c.get("csrfToken") ?? "",
      owned: licenses.some((license) => license.product_id === product.id),
      authed: Boolean(user),
      siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
    }),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: product.name,
      applicationCategory: "GameApplication",
      operatingSystem: "Paper Minecraft server",
      softwareVersion: product.latestRelease?.version.split("+")[0] ?? undefined,
      url: `${c.env.APP_URL.replace(/\/$/, "")}/plugins/${product.slug}`,
      description: product.seo_description ?? product.tagline,
      offers: { "@type": "Offer", price: "0", priceCurrency: "THB" },
    },
  });
});

marketingRoutes.get("/pricing", async (c) => {
  const [products, content] = await Promise.all([
    listProductSummaries(c.env, { statuses: ["published"], limit: 50 }),
    getSiteContent(c.env),
  ]);
  return publicPage(c, {
    title: "ราคา",
    description: "ทุกผลิตภัณฑ์ฟรี 100% ไม่มีระบบชำระเงิน",
    body: pricingPage(products, content.pricingNote),
  });
});

marketingRoutes.get("/docs", (c) => {
  return publicPage(c, {
    title: "เอกสาร",
    description: "คู่มือการใช้งาน การติดตั้ง ไลเซนส์ และ API",
    body: docsIndex(langOf(c)),
  });
});

marketingRoutes.get("/docs/:slug", (c) => {
  const doc = getDoc(c.req.param("slug"));
  if (!doc) {
    return publicPage(c, {
      title: "ไม่พบเอกสาร",
      body: errorPage("ไม่พบหน้านี้", "เอกสารที่ค้นหาอาจถูกย้ายหรือเปลี่ยนชื่อ"),
      status: 404,
      noIndex: true,
    });
  }
  return publicPage(c, {
    title: doc.title,
    description: doc.summary,
    body: docPage(doc, langOf(c)),
  });
});

marketingRoutes.get("/changelog", async (c) => {
  const releases = (await listAllReleases(c.env, 100)).filter((release) => release.status === "published");
  return publicPage(c, {
    title: "บันทึกการอัปเดต",
    description: "ประวัติการอัปเดตของผลิตภัณฑ์ทั้งหมด",
    body: changelogPage(releases, null, langOf(c)),
  });
});

marketingRoutes.get("/changelog/:slug", async (c) => {
  const slug = c.req.param("slug");
  const product = await getProductView(c.env, slug);
  if (!product) {
    return publicPage(c, {
      title: "ไม่พบผลิตภัณฑ์",
      body: errorPage("ไม่พบบันทึกการอัปเดต", "ไม่พบผลิตภัณฑ์ที่ระบุ"),
      status: 404,
      noIndex: true,
    });
  }
  const releases = product.releases.map((release) => ({
    ...release,
    product_name: product.name,
    product_slug: product.slug,
  }));
  return publicPage(c, {
    title: `อัปเดต ${product.name}`,
    description: `บันทึกการอัปเดตของ ${product.name}`,
    body: changelogPage(releases, product.name, langOf(c)),
  });
});

marketingRoutes.get("/status", async (c) => {
  const report = await getStatusReport(c.env);
  return publicPage(c, {
    title: "สถานะระบบ",
    description: "สถานะการทำงานของแพลตฟอร์มจากฐานข้อมูลจริง",
    body: statusPage(report, langOf(c)),
  });
});

marketingRoutes.get("/support", (c) => {
  return publicPage(c, {
    title: "ศูนย์ช่วยเหลือ",
    description: "คำถามที่พบบ่อยและช่องทางติดต่อทีมงาน",
    body: supportPage({
      siteKey: c.env.TURNSTILE_SITE_KEY ?? "",
      csrf: c.get("csrfToken") ?? "",
      authed: Boolean(c.get("user")),
      lang: langOf(c),
    }),
  });
});

marketingRoutes.get("/contact", (c) => {
  return publicPage(c, {
    title: "ติดต่อเรา",
    description: "ติดต่อทีมงาน Aegishider เรื่องการใช้งาน ปัญหาเทคนิค หรือความปลอดภัย",
    body: contactPage({ siteKey: c.env.TURNSTILE_SITE_KEY ?? "", csrf: c.get("csrfToken") ?? "", lang: langOf(c) }),
  });
});

marketingRoutes.post("/contact", async (c) => {
  const values = await readForm(c);
  const name = formValue(values, "name", 120);
  const email = formValue(values, "email", 200);
  const topic = formValue(values, "topic", 40);
  const message = formValue(values, "message", 5000);
  const ip = clientIp(c);
  const ipHash = await hashIp(c.env, ip);
  await enforceRateLimit(c.env, `contact:${ipHash}`, 5, 3600);
  await verifyTurnstile(c.env, values["cf-turnstile-response"], ip, "contact");
  try {
    await createContactMessage(c.env, { name, email, topic, message, ipHash });
  } catch (error) {
    logError("contact.failed", error);
    return c.redirect("/contact?err=invalid", 303);
  }
  return c.redirect("/support?ok=sent", 303);
});

marketingRoutes.get("/about", (c) => {
  return publicPage(c, {
    title: "เกี่ยวกับเรา",
    description: "เกี่ยวกับ Aegishider Control Platform",
    body: aboutPage(langOf(c)),
  });
});

marketingRoutes.get("/developers", (c) => {
  return publicPage(c, {
    title: "นักพัฒนา",
    description: "Aegishider Developer API — Ed25519 signed requests, licence leases, heartbeat and telemetry",
    body: developersPage(c.env.APP_URL),
  });
});

for (const kind of ["terms", "privacy"] as const) {
  marketingRoutes.get(`/legal/${kind}`, (c) => {
    return publicPage(c, {
      title: kind === "terms" ? "ข้อกำหนดการใช้งาน" : "นโยบายความเป็นส่วนตัว",
      description: kind === "terms" ? "ข้อกำหนดการใช้งานแพลตฟอร์ม" : "นโยบายความเป็นส่วนตัวของแพลตฟอร์ม",
      body: legalPage(kind, langOf(c)),
    });
  });
}

marketingRoutes.get("/legal", (c) => c.redirect("/legal/terms", 302));

/* Ensure every documented URL resolves, even if an editor removes a page. */
marketingRoutes.get("/docs-index", (c) => c.redirect("/docs", 301));
marketingRoutes.get("/products", (c) => c.redirect("/plugins", 301));

export const marketingMeta = {
  docsCount: docs.length,
  production: (env: AppEnv["Bindings"]) => isProduction(env),
};
