import { SafeHtml, html, raw, join, escapeHtml } from "../lib/html";
import { t, statusLabel, type Lang } from "../lib/i18n";
import { primaryMembership, type SessionUser } from "../auth/session";
import { formatDateTime, timeAgo } from "../lib/time";
import type { ProductView } from "../services/catalog";
import { formatPrice } from "../services/catalog";

const ICONS = [
  "download", "arrow", "menu", "sun", "moon", "check", "x", "copy", "chevron",
  "lock", "clock", "box", "eye", "gauge", "terminal", "book", "sliders", "user",
  "shield", "warning", "layers", "spark", "key", "server", "card", "users",
  "chart", "audit", "settings", "search", "plus", "external", "logout", "mail",
  "activity", "package", "refresh", "ban", "edit",
];

const PATHS: Record<string, string> = {
  download: '<path d="M12 3v11m0 0 4.2-4.2M12 14l-4.2-4.2"/><path d="M4 16.5v1.8A2.7 2.7 0 0 0 6.7 21h10.6a2.7 2.7 0 0 0 2.7-2.7v-1.8"/>',
  arrow: '<path d="M4 12h15m0 0-6-6m6 6-6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.8A1.8 1.8 0 0 0 13.2 4H6.8A2.8 2.8 0 0 0 4 6.8v6.4A1.8 1.8 0 0 0 5.8 15"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="2.4"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14v2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
  box: '<path d="M4 8.5 12 4l8 4.5v9L12 22l-8-4.5v-9Z"/><path d="M4 8.5 12 13l8-4.5M12 13v9"/>',
  eye: '<path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="3.1"/>',
  gauge: '<path d="M4 18a9 9 0 0 1 16 0"/><path d="m12 14 4-4"/><path d="M12 18h.01"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c.8-3.4 3.6-5.2 7-5.2s6.2 1.8 7 5.2"/>',
  shield: '<path d="M12 3 5 5.8v5.4c0 4 2.9 7.6 7 9.8 4.1-2.2 7-5.8 7-9.8V5.8L12 3Z"/><path d="m9 11.7 2 2 4-4.2"/>',
  warning: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4.5"/><path d="M12 17.6h.01"/>',
  layers: '<path d="m12 3 8.5 4.7L12 12.4 3.5 7.7 12 3Z"/><path d="m4.4 12.2 7.6 4.2 7.6-4.2"/><path d="m4.4 16.4 7.6 4.2 7.6-4.2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="m11 11 8 8m-3-3 2-2m-5 0 2-2"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M3 10h18M7 15h3"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.7-3 3.2-4.6 6-4.6s5.3 1.6 6 4.6"/><path d="M16 5.6a3.2 3.2 0 0 1 0 6.2"/><path d="M18 20c-.3-1.6-1-2.9-2-3.8"/>',
  chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 4-6"/>',
  audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="m9 13 1.5 1.5L14 11"/><path d="M9 17h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 4h6v6"/><path d="m20 4-8 8"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="m4 7 8 6 8-6"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
};

export function icon(name: string, className = ""): SafeHtml {
  const path = PATHS[name] ?? PATHS.spark!;
  return raw(
    `<svg class="ico ${escapeHtml(className)}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`,
  );
}

export function iconSprite(): SafeHtml {
  const symbols = ICONS.map(
    (name) => `<symbol id="i-${name}" viewBox="0 0 24 24">${PATHS[name] ?? ""}</symbol>`,
  ).join("");
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${symbols}</svg>`,
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

const PUBLIC_NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "หน้าแรก" },
  { href: "/plugins", label: "ผลิตภัณฑ์" },
  { href: "/developers", label: "นักพัฒนา" },
  { href: "/docs", label: "เอกสาร" },
  { href: "/changelog", label: "อัปเดต" },
  { href: "/status", label: "สถานะ" },
  { href: "/support", label: "ช่วยเหลือ" },
];

export interface LayoutOptions {
  title: string;
  description?: string;
  user: SessionUser | null;
  path: string;
  lang: Lang;
  csrf: string;
  body: SafeHtml;
  flash?: SafeHtml | null;
  noIndex?: boolean;
  noFooter?: boolean;
  /** Public origin (APP_URL) used for absolute social-preview URLs. */
  baseUrl?: string;
}

function brandMarkup(href: string): SafeHtml {
  return html`<a class="brand" href="${href}" aria-label="Aegishider Control Platform">
    <span class="brand-mark" aria-hidden="true">
      <img src="/assets/img/logo-192.png" width="192" height="192" alt="" loading="eager" decoding="async">
    </span>
    <span class="brand-text"><strong>Aegishider</strong><span class="brand-ver">CONTROL</span></span>
  </a>`;
}

function headerMarkup(opts: LayoutOptions): SafeHtml {
  return html`<header class="site-header" id="siteHeader">
    <div class="shell header-inner">
      ${brandMarkup("/")}
      <nav class="site-nav" id="siteNav" aria-label="${t(opts.lang, "nav.main")}">
        ${PUBLIC_NAV.map((item) => {
          const active = opts.path === item.href || (item.href !== "/" && opts.path.startsWith(`${item.href}/`));
          return html`<a href="${item.href}" ${active ? raw('aria-current="page"') : raw("")}>${item.label}</a>`;
        })}
      </nav>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="themeToggle" type="button" aria-label="${t(opts.lang, "common.theme")}">
          ${icon("sun")}
        </button>
        ${opts.user
          ? html`${opts.user.role !== "customer" ? html`<a class="btn btn-ghost btn-sm" href="/admin">${t(opts.lang, "nav.admin")}</a>` : raw("")}
              <a class="user-chip" href="/app" title="${opts.user.email}">${icon("user")}<b>${opts.user.displayName ?? opts.user.email}</b></a>
              <form method="post" action="/auth/logout" class="inline-form">
                <input type="hidden" name="_csrf" value="${opts.csrf}">
                <button class="btn btn-ghost btn-sm" type="submit">${icon("logout")}<span class="sr-only">${t(opts.lang, "nav.logout")}</span></button>
              </form>`
          : html`<a class="btn btn-ghost btn-sm" href="/auth/login">${t(opts.lang, "nav.login")}</a>
              <a class="btn btn-primary btn-sm header-cta" href="/auth/register">เริ่มต้นฟรี</a>`}
        <button class="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="siteNav" aria-label="${t(opts.lang, "nav.openMenu")}">
          ${icon("menu")}
        </button>
      </div>
    </div>
  </header>`;
}

function footerMarkup(_lang: Lang): SafeHtml {
  return html`<footer class="site-footer">
    <div class="shell">
      <div class="footer-grid">
        <div class="footer-brand">
          ${brandMarkup("/")}
          <p>แพลตฟอร์มฟรีสำหรับจัดการไลเซนส์ปลั๊กอิน Minecraft — ตรวจสอบได้ทุกขั้นตอน ไม่มีระบบชำระเงิน และไม่เปิดเผยข้อมูลเซิร์ฟเวอร์ลูกค้าต่อสาธารณะ</p>
        </div>
        <div class="footer-col">
          <h3>ผลิตภัณฑ์</h3>
          <a href="/plugins">ผลิตภัณฑ์ทั้งหมด</a>
          <a href="/plugins/aegishider">Aegishider</a>
          <a href="/pricing">ราคา</a>
          <a href="/changelog">บันทึกการอัปเดต</a>
        </div>
        <div class="footer-col">
          <h3>นักพัฒนา</h3>
          <a href="/developers">Developer API</a>
          <a href="/docs">เอกสาร</a>
          <a href="/docs/api">API</a>
          <a href="/docs/licensing">ไลเซนส์</a>
          <a href="/docs/compatibility">ความเข้ากันได้</a>
          <a href="/docs/release-verification">ตรวจสอบรีลีส</a>
          <a href="/docs/test-evidence">ผลทดสอบ</a>
          <a href="/docs/security">ความปลอดภัย</a>
          <a href="/status">สถานะระบบ</a>
        </div>
        <div class="footer-col">
          <h3>ช่วยเหลือ</h3>
          <a href="/support">ศูนย์ช่วยเหลือ</a>
          <a href="/contact">ติดต่อเรา</a>
          <a href="/legal/terms">ข้อกำหนดการใช้งาน</a>
          <a href="/legal/privacy">นโยบายความเป็นส่วนตัว</a>
        </div>
      </div>
      <p class="footer-notes">Aegishider ไม่ได้สังกัด Mojang Studios หรือ Microsoft · Minecraft คือเครื่องหมายการค้าของ Mojang Studios · FastUtil (Apache-2.0) ถูก bundle ในไจาร์ · PacketEvents (GPL-3.0) เป็นปลั๊กอินภายนอก</p>
      <div class="footer-bottom">
        <span>© 2026 Aegishider · สร้างโดย AudiSMP</span>
        <span>แพลตฟอร์มคลาวด์ · ตรวจสอบย้อนกลับได้</span>
      </div>
    </div>
  </footer>`;
}

export function layout(opts: LayoutOptions): SafeHtml {
  const desc = opts.description ?? "แพลตฟอร์มจัดการไลเซนส์และติดตามเซิร์ฟเวอร์ปลั๊กอิน Minecraft";
  const origin = (opts.baseUrl ?? "").replace(/\/$/, "");
  const ogImage = `${origin}/assets/img/logo-512.png`;
  return html`<!doctype html>
<html lang="${opts.lang}" data-theme="dark" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title} · Aegishider Control Platform</title>
  <meta name="description" content="${desc}">
  <meta name="color-scheme" content="dark light">
  ${opts.noIndex ? raw('<meta name="robots" content="noindex,nofollow">') : raw("")}
  <meta property="og:title" content="${opts.title} · Aegishider">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="website">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/logo-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/img/logo-180.png">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:image" content="${ogImage}">
  <script src="/assets/js/theme.js"></script>
  <link rel="stylesheet" href="/assets/css/fonts.css">
  <link rel="stylesheet" href="/assets/css/platform.css">
  <link rel="stylesheet" href="/assets/css/premium.css">
  <script defer src="/assets/js/app.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">ข้ามไปยังเนื้อหา</a>
  ${iconSprite()}
  ${headerMarkup(opts)}
  <main id="main">
    ${opts.flash ?? raw("")}
    ${opts.body}
  </main>
  ${opts.noFooter ? raw("") : footerMarkup(opts.lang)}
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

export function alert(kind: "success" | "error" | "info", message: string | SafeHtml): SafeHtml {
  const body = message instanceof SafeHtml ? message : escapeHtml(message);
  const iconName = kind === "success" ? "check" : kind === "error" ? "warning" : "spark";
  return html`<div class="alert alert--${kind}" role="${kind === "error" ? "alert" : "status"}" data-auto-dismiss>
    ${icon(iconName)}<div>${body}</div>
  </div>`;
}

const NOTICES: Record<string, { kind: "success" | "error" | "info"; text: string }> = {
  saved: { kind: "success", text: "บันทึกเรียบร้อยแล้ว" },
  created: { kind: "success", text: "สร้างรายการเรียบร้อยแล้ว" },
  updated: { kind: "success", text: "อัปเดตข้อมูลเรียบร้อยแล้ว" },
  deleted: { kind: "success", text: "ลบรายการเรียบร้อยแล้ว" },
  revoked: { kind: "success", text: "เพิกถอนไลเซนส์แล้ว" },
  activated: { kind: "success", text: "เปิดใช้งานเซิร์ฟเวอร์เรียบร้อยแล้ว" },
  "password-updated": { kind: "success", text: "ตั้ง/เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" },
  reset: { kind: "success", text: "รีเซ็ตการเปิดใช้งานแล้ว" },
  sent: { kind: "success", text: "ส่งข้อมูลเรียบร้อยแล้ว" },
  "logged-out": { kind: "info", text: "ออกจากระบบแล้ว" },
  "check-email": { kind: "success", text: "หากอีเมลนี้มีในระบบ เราได้ส่งลิงก์เข้าใช้งานไปแล้ว" },
  "password-reset": { kind: "success", text: "ตั้งรหัสผ่านใหม่เรียบร้อย กรุณาเข้าสู่ระบบ" },
  "recovery-codes": { kind: "success", text: "รหัสกู้คืนพร้อมใช้งานแล้ว — บันทึกก่อนออกจากหน้า" },
  "recovery-saved": { kind: "info", text: "ซ่อนรหัสกู้คืนแล้ว — สร้างชุดใหม่ได้ทุกเมื่อ" },
  "totp-enabled": { kind: "success", text: "เปิดใช้งาน 2FA เรียบร้อยแล้ว" },
  "totp-disabled": { kind: "info", text: "ปิด 2FA แล้ว" },
  "totp-started": { kind: "info", text: "สแกนคีย์แล้วกรอกรหัสเพื่อยืนยัน" },
  invalid: { kind: "error", text: "ข้อมูลไม่ถูกต้องหรือหมดอายุแล้ว" },
  forbidden: { kind: "error", text: "คุณไม่มีสิทธิ์ทำรายการนี้" },
  "not-found": { kind: "error", text: "ไม่พบข้อมูลที่ต้องการ" },
  "rate-limited": { kind: "error", text: "ทำรายการบ่อยเกินไป กรุณารอสักครู่" },
  email: { kind: "error", text: "ไม่สามารถส่งอีเมลได้ กรุณาติดต่อผู้ดูแลระบบ" },
  config: { kind: "error", text: "ระบบยังไม่ได้ตั้งค่าสำหรับการทำรายการนี้" },
  replay: { kind: "error", text: "คำขอนี้ถูกใช้ไปแล้ว" },
  "already-paid": { kind: "error", text: "รายการนี้ชำระเงินแล้ว" },
  "wrong-state": { kind: "error", text: "สถานะปัจจุบันไม่อนุญาตให้ทำรายการนี้" },
  "csrf": { kind: "error", text: "หน้าเว็บหมดอายุ กรุณารีเฟรชแล้วลองใหม่" },
};

export function flashFromQuery(ok?: string, err?: string): SafeHtml | null {
  const key = err ?? ok;
  if (!key) return null;
  const notice = NOTICES[key];
  if (!notice) return null;
  return html`<div class="shell" style="padding-top:1rem">${alert(notice.kind, notice.text)}</div>`;
}

export function pageHead(title: string, lead?: string, actions?: SafeHtml): SafeHtml {
  return html`<div class="app-head">
    <div><h1>${title}</h1>${lead ? html`<p>${lead}</p>` : raw("")}</div>
    ${actions ?? raw("")}
  </div>`;
}

export function sectionHead(eyebrow: string, title: string, lead?: string, actions?: SafeHtml): SafeHtml {
  return html`<div class="section-head section-head--spread">
    <div>
      <p class="eyebrow">${eyebrow}</p>
      <h2>${title}</h2>
      ${lead ? html`<p>${lead}</p>` : raw("")}
    </div>
    ${actions ?? raw("")}
  </div>`;
}

export function badge(status: string, lang: Lang = "th"): SafeHtml {
  const cls = status.replace(/[^a-z0-9_]/g, "").toLowerCase();
  return html`<span class="badge badge--${cls}">${statusLabel(lang, status)}</span>`;
}

export function emptyState(message: string, action?: SafeHtml): SafeHtml {
  return html`<div class="empty">${message}${action ? html`<div style="margin-top:.8rem">${action}</div>` : raw("")}</div>`;
}

export function pagination(basePath: string, page: number, totalPages: number): SafeHtml {
  if (totalPages <= 1) return raw("");
  const joiner = basePath.includes("?") ? "&" : "?";
  return html`<div class="row" style="justify-content:space-between;margin-top:1rem">
    <span class="mono" style="font-size:.58rem">หน้า ${page} / ${totalPages}</span>
    <div class="row">
      ${page > 1 ? html`<a class="btn btn-ghost btn-sm" href="${basePath}${joiner}page=${page - 1}">ก่อนหน้า</a>` : raw("")}
      ${page < totalPages ? html`<a class="btn btn-ghost btn-sm" href="${basePath}${joiner}page=${page + 1}">ถัดไป</a>` : raw("")}
    </div>
  </div>`;
}

export function csrfInput(token: string): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${token}">`;
}

export function stat(label: string, value: string | number, note?: string): SafeHtml {
  return html`<div class="stat">
    <div class="label">${label}</div>
    <div class="value">${value}</div>
    ${note ? html`<div class="note">${note}</div>` : raw("")}
  </div>`;
}

export function detailList(items: Array<{ label: string; value: SafeHtml | string }>): SafeHtml {
  return html`<dl class="detail-list">
    ${items.map((item) => html`<div><dt>${item.label}</dt><dd>${item.value}</dd></div>`)}
  </dl>`;
}

export function productCard(product: ProductView, lang: Lang = "th"): SafeHtml {
  const status = product.status === "published" ? "published" : product.status === "coming_soon" ? "coming_soon" : "draft";
  const latest = product.latestRelease;
  const price = formatPrice(product.price_cents, product.currency);
  return html`<article class="product-card">
    <div class="product-card__top">
      <div class="product-thumb">${product.name.slice(0, 2).toUpperCase()}</div>
      <div class="row" style="justify-content:space-between">
        <h3><a href="/plugins/${product.slug}">${product.name}</a></h3>
        ${badge(status, lang)}
      </div>
      <p class="product-card__tag">${product.tagline}</p>
    </div>
    <div class="product-card__body">
      <div class="product-meta">
        ${(Array.isArray(product.compatibilityData.minecraft) ? (product.compatibilityData.minecraft as string[]) : []).slice(0, 3).map((version) => html`<span class="badge">MC ${version}</span>`)}
        ${latest ? html`<span class="badge badge--info badge--version">v${latest.version}</span>` : raw("")}
      </div>
      <div class="product-price">
        <div><b>${price}</b><span>ฟรี 100% · ไม่มีระบบชำระเงิน</span></div>
        <a class="product-card__link" href="/plugins/${product.slug}">${t(lang, "common.viewDetails")} ${icon("arrow")}</a>
      </div>
    </div>
  </article>`;
}

/* -------------------------------------------------------------------------- */
/* App shell (portal + admin)                                                 */
/* -------------------------------------------------------------------------- */

export interface AppNavItem { href: string; label: string; icon: string; }

export function appShell(opts: {
  user: SessionUser;
  path: string;
  active: string;
  title: string;
  subtitle?: string;
  actions?: SafeHtml;
  body: SafeHtml;
  admin?: boolean;
  lang?: Lang;
}): SafeHtml {
  const customerNav: AppNavItem[] = [
    { href: "/app", label: "ภาพรวม", icon: "gauge" },
    { href: "/app/products", label: "ผลิตภัณฑ์", icon: "box" },
    { href: "/app/licenses", label: "ไลเซนส์", icon: "key" },
    { href: "/app/servers", label: "เซิร์ฟเวอร์", icon: "server" },
    { href: "/app/activations", label: "การเปิดใช้งาน", icon: "spark" },
    { href: "/app/support", label: "ช่วยเหลือ", icon: "terminal" },
  ];
  const adminNav: AppNavItem[] = [
    { href: "/admin", label: "แดชบอร์ด", icon: "gauge" },
    { href: "/admin/customers", label: "ลูกค้า", icon: "users" },
    { href: "/admin/licenses", label: "ไลเซนส์", icon: "key" },
    { href: "/admin/products", label: "สินค้า", icon: "box" },
    { href: "/admin/releases", label: "รีลีส", icon: "package" },
    { href: "/admin/servers", label: "เซิร์ฟเวอร์", icon: "server" },
    { href: "/admin/content", label: "เนื้อหาเว็บ", icon: "edit" },
    { href: "/admin/support", label: "ตั๋วช่วยเหลือ", icon: "terminal" },
    { href: "/admin/security", label: "ศูนย์ความปลอดภัย", icon: "shield" },
    { href: "/admin/audit", label: "บันทึกการตรวจสอบ", icon: "audit" },
    { href: "/admin/telemetry", label: "Telemetry", icon: "activity" },
    { href: "/admin/settings", label: "ตั้งค่า", icon: "settings" },
  ];
  const nav = opts.admin ? adminNav : customerNav;
  return html`<div class="shell app-layout">
    <aside class="app-side">
      <div class="who">
        <b>${opts.user.displayName ?? opts.user.email}</b>
        <span>${opts.admin ? "ผู้ดูแลระบบ" : (primaryMembership(opts.user)?.orgName ?? "องค์กรของฉัน")}</span>
      </div>
      <nav class="app-nav" aria-label="${opts.admin ? "เมนูผู้ดูแล" : "เมนูพอร์ทัล"}">
        ${nav.map((item) => {
          const active = opts.active === item.href;
          return html`<a href="${item.href}" ${active ? raw('aria-current="page"') : raw("")}>${icon(item.icon)}<span>${item.label}</span></a>`;
        })}
        <div class="sep"></div>
        ${opts.admin
          ? html`<a href="/">${icon("external")}<span>กลับหน้าเว็บ</span></a>`
          : html`<a href="/app/account">${icon("user")}<span>บัญชี</span></a>
                   <a href="/app/security">${icon("shield")}<span>ความปลอดภัย</span></a>
                   <a href="/docs">${icon("book")}<span>เอกสาร</span></a>`}
      </nav>
    </aside>
    <div class="app-main">
      ${pageHead(opts.title, opts.subtitle, opts.actions)}
      ${opts.body}
    </div>
  </div>`;
}

export function formatWhen(ms: number | null | undefined, lang: Lang = "th"): string {
  if (!ms) return "—";
  return `${formatDateTime(ms, lang)} (${timeAgo(ms, lang)})`;
}

export function joinBadges(items: string[], lang: Lang = "th"): SafeHtml {
  return join(items.map((item) => badge(item, lang)), " ");
}
