import { SafeHtml, html, raw } from "../lib/html";
import type { Lang } from "../lib/i18n";
import { formatDate, formatDateTime } from "../lib/time";
import type { SiteContent } from "../lib/site-content";
import { DEFAULT_SITE_CONTENT } from "../lib/site-content";
import { renderMarkdown } from "../lib/markdown";
import { jsonArray } from "../lib/time";
import type { DocPage } from "../content/docs";
import { docsByCategory } from "../content/docs";
import type { ProductView, ReleaseRow } from "../services/catalog";
import type { StatusReport } from "../services/status";
import {
  badge,
  csrfInput,
  emptyState,
  icon,
  productCard,
  sectionHead,
} from "./ui";

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

export function turnstileWidget(siteKey: string): SafeHtml {
  if (!siteKey) return raw("");
  return html`<div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="dark"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
}

function movement(): SafeHtml {
  return html`<div class="hero-stage" aria-hidden="true">
    <div class="stage-glow"></div>
    <div class="stage-orbit stage-orbit--1"></div>
    <div class="stage-orbit stage-orbit--2"></div>
    <div class="stage-orbit stage-orbit--3"></div>
    <div class="stage-core">
      <div class="stage-core__ring"></div>
      <div class="stage-core__inner">
        <span class="mono">LICENSE ENGINE</span>
        <b>ED25519</b>
        <small>FAIL-CLOSED · V1</small>
      </div>
    </div>
    <div class="stage-card stage-card--1"><span class="mono">PRICING</span><b>ฟรี 100%</b><small>ไม่มีระบบชำระเงิน</small></div>
    <div class="stage-card stage-card--2"><span class="mono">TELEMETRY</span><b>Live</b><small>heartbeat 3 นาที</small></div>
    <div class="stage-card stage-card--3"><span class="mono">LICENSE</span><b>Active</b><small>offline grace 72 ชม.</small></div>
    <div class="stage-grid"></div>
  </div>`;
}

function bulletList(items: string[]): SafeHtml {
  return html`<ul class="stack" style="gap:.4rem">${items.map((item) => html`<li class="text-2" style="font-size:.84rem">${item}</li>`)}</ul>`;
}

function paragraphs(text: string): SafeHtml {
  return html`${text.split(/\n{2,}/).filter(Boolean).map((part) => html`<p>${part}</p>`)}`;
}

function releaseNotes(notes: string): SafeHtml {
  return html`<div class="prose" style="font-size:.82rem">${renderMarkdown(notes)}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Home                                                                       */
/* -------------------------------------------------------------------------- */

export function marketingHome(
  products: ProductView[],
  lang: Lang,
  content: SiteContent = DEFAULT_SITE_CONTENT,
): SafeHtml {
  const featured = products.slice(0, 3);
  return html`
  ${content.announcement
    ? html`<div class="announcement"><div class="shell">${content.announcement}</div></div>`
    : raw("")}
  <section class="hero">
    <div class="shell hero-grid">
      <div>
        <img class="hero-logo" src="/assets/img/logo-192.png" width="192" height="192" alt="Aegishider logo" decoding="async">
        <p class="eyebrow">${content.heroEyebrow}</p>
        <h1>${content.heroTitle}<br><em>${content.heroTitleAccent}</em></h1>
        <p class="hero-lead">${content.heroLead}</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="/plugins">${content.primaryCta} ${icon("arrow")}</a>
          <a class="btn btn-ghost btn-lg" href="/docs/getting-started">${content.secondaryCta}</a>
        </div>
        <p class="hero-note">ทำงานบน Cloudflare Workers · D1 · R2 · Queues — ไม่มีเซิร์ฟเวอร์ให้ดูแลเอง</p>
        <div class="hero-stats">
          <div class="hero-stat"><b>${products.length}</b><span>ผลิตภัณฑ์ที่พร้อมใช้ฟรี</span></div>
          <div class="hero-stat"><b>Ed25519</b><span>ลายเซ็นใบอนุญาต</span></div>
          <div class="hero-stat"><b>Fail-closed</b><span>ทุกเส้นทางที่ผิดพลาด</span></div>
        </div>
      </div>
      <div class="hero-visual">${movement()}</div>
    </div>
  </section>

  <div class="trust-strip">
    <div class="shell trust-strip__inner">
      <span class="trust-strip__label">สร้างบน</span>
      ${["Cloudflare Workers", "D1 · R2 · Queues", "ฟรี 100%", "Ed25519", "OTP Email"].map(
        (item) => html`<span class="trust-pill">${item}</span>`,
      )}
      <span class="trust-strip__right">ไม่ต้องดูแลเซิร์ฟเวอร์เอง</span>
    </div>
  </div>

  <section class="section">
    <div class="shell">
      ${sectionHead("ผลิตภัณฑ์", "ปลั๊กอินที่พร้อมใช้งานจริง", "ทุกผลิตภัณฑ์มีหน้าเฉพาะ เอกสาร และช่องทางรับไลเซนส์ฟรี — เพิ่มผลิตภัณฑ์ใหม่ได้จากคอนโซลผู้ดูแล", html`<a class="btn btn-ghost btn-sm" href="/plugins">ทั้งหมด ${icon("arrow")}</a>`)}
      ${featured.length > 0
        ? html`<div class="product-grid">${featured.map((product) => productCard(product, lang))}
            ${featured.length === 1
              ? html`<article class="product-card product-note">
                  <p class="eyebrow">FREE PLATFORM</p>
                  <h3>ฟรี 100% ทุกเซิร์ฟเวอร์</h3>
                  <p class="muted">สมัครบัญชี รับไลเซนส์ทันที ไม่มีระบบชำระเงิน ไม่มีกระเป๋าเงิน และไม่มีวันหมดอายุ</p>
                  <ul class="product-note__list">
                    <li>${icon("check")} ตรวจลายเซ็น Ed25519 ที่ฝั่งเซิร์ฟเวอร์</li>
                    <li>${icon("check")} รหัสเปิดใช้งาน 16 ตัว สุ่มลึก 80 บิต</li>
                    <li>${icon("check")} มี offline grace 72 ชม. เมื่อแพลตฟอร์มออฟไลน์</li>
                  </ul>
                  <a class="btn btn-soft btn-sm" href="/docs/licensing">อ่านเรื่องไลเซนส์ ${icon("arrow")}</a>
                </article>`
              : raw("")}
          </div>`
        : emptyState("ยังไม่มีผลิตภัณฑ์ที่เผยแพร่", html`<a class="btn btn-primary btn-sm" href="/admin">เปิดคอนโซลผู้ดูแล</a>`)}
    </div>
  </section>

  <section class="section section--alt" id="free">
    <div class="shell">
      ${sectionHead("ฟรี 100%", "ไม่มีระบบเสียเงิน — สมัครแล้วใช้ได้ทันที", "แพลตฟอร์มนี้ไม่มีกระเป๋าเงิน ไม่มีคำสั่งซื้อ และไม่มีการชำระเงิน ทุกฟีเจอร์สำหรับเจ้าของเซิร์ฟเวอร์เปิดให้ใช้ฟรีทั้งหมด")}
      <div class="grid-3">
        ${[
          { icon: "user", title: "สมัครบัญชีฟรี", text: "เข้าสู่ระบบด้วยอีเมล ไม่ต้องผูกบัตร ไม่ต้องเติมเงิน — บัญชีเดียวใช้ได้ทุกผลิตภัณฑ์" },
          { icon: "key", title: "ไลเซนส์ฟรีอัตโนมัติ", text: "รับไลเซนส์ทันทีที่สมัครหรือกดเปิดใช้งาน รหัสยาว 240 บิต สุ่มด้วย CSPRNG และเก็บในฐานข้อมูลเป็น hash" },
          { icon: "shield", title: "ป้องกันการเดารหัส", text: "ผิด 5 ครั้งล็อก 5 นาที ผิด 10 ครั้งล็อก 10 นาที และเพิ่มขึ้นเรื่อย ๆ พร้อมบันทึก IP, ปลั๊กอิน และชื่อเซิร์ฟเวอร์" },
        ].map((item) => html`<article class="feature-card">
          <div class="feature-icon">${icon(item.icon)}</div>
          <h3>${item.title}</h3>
          <p>${item.text}</p>
        </article>`)}
      </div>
      <div class="payment-flow">
        ${[
          ["01", "สมัครบัญชี", "ยืนยันอีเมลด้วย OTP หรือลิงก์ครั้งเดียว"],
          ["02", "รับไลเซนส์", "ระบบออกไลเซนส์ฟรีพร้อมรหัสยาวให้ทันที"],
          ["03", "เชื่อมเซิร์ฟเวอร์", "รัน /aegishider license link แล้วกรอกรหัสในพอร์ทัล"],
          ["04", "ติดตาม", "ดู heartbeat, TPS/MSPT และการตรวจพบเชิงลึกได้ฟรี"],
        ].map(
          (step) => html`<div class="payment-flow__step">
            <span class="mono">${step[0]}</span>
            <b>${step[1]}</b>
            <p>${step[2]}</p>
          </div>`,
        )}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      ${sectionHead("ทำไมต้องแพลตฟอร์มนี้", "ครบตั้งแต่สมัครจนถึงใบอนุญาต", "ไม่ใช่แค่หน้าเว็บสวย ๆ แต่เป็นระบบที่เชื่อมกันจริง ตั้งแต่การสมัคร การออกไลเซนส์ การเปิดใช้งาน ไปจนถึงการติดตามสุขภาพเซิร์ฟเวอร์")}
      <div class="grid-3">
        ${[
          { icon: "key", title: "ไลเซนส์ที่ตรวจสอบได้", text: "ออกใบอนุญาตด้วย Ed25519 เก็บเฉพาะ hash ของ license key และรองรับ offline grace เมื่อ Cloudflare ล่ม" },
          { icon: "users", title: "พอร์ทัลเจ้าของเซิร์ฟเวอร์", text: "เห็นไลเซนส์ เซิร์ฟเวอร์ การเปิดใช้งาน ข้อมูลเชิงลึก และเปิดตั๋วช่วยเหลือได้เอง — ฟรีทุกฟีเจอร์" },
          { icon: "shield", title: "คอนโซลผู้ดูแล", text: "จัดการลูกค้า ผลิตภัณฑ์ รีลีส ปลั๊กอิน และดู audit trail ทุกการกระทำสำคัญ" },
          { icon: "activity", title: "Telemetry ที่ไม่รุกล้ำ", text: "รับเฉพาะข้อมูลปฏิบัติการแบบรวม ไม่มีชื่อผู้เล่น IP หรือพิกัด และแยกข้อมูลตามองค์กร" },
          { icon: "package", title: "รองรับหลายผลิตภัณฑ์", text: "โครงสร้างข้อมูลออกแบบให้เพิ่มปลั๊กอินตัวใหม่ได้โดยไม่ต้องสร้างระบบไลเซนส์ใหม่" },
          { icon: "layers", title: "Cloudflare-native", text: "Workers + D1 + R2 + Queues ทำงานร่วมกัน พร้อมขยายตามจำนวนลูกค้าโดยไม่ต้องดูแลเซิร์ฟเวอร์" },
        ].map((item) => html`<article class="feature-card">
          <div class="feature-icon">${icon(item.icon)}</div>
          <h3>${item.title}</h3>
          <p>${item.text}</p>
        </article>`)}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="shell grid-2">
      <div>
        ${sectionHead("ขั้นตอน", "เริ่มใช้ในสามขั้น", "ไม่มีขั้นตอนซับซ้อน และทุกอย่างตรวจสอบย้อนกลับได้")}
        <div class="stack">
          ${[
            { n: "01", title: "สมัครและรับไลเซนส์", text: "เข้าสู่ระบบด้วยอีเมล ระบบออกไลเซนส์ฟรีพร้อมรหัสยาวให้อัตโนมัติ ไลเซนส์จะปรากฏในพอร์ทัลทันที" },
            { n: "02", title: "เชื่อมเซิร์ฟเวอร์", text: "รัน /aegishider license link บนเซิร์ฟเวอร์ แล้วนำรหัส 16 ตัวไปกรอกในพอร์ทัล" },
            { n: "03", title: "ติดตาม", text: "ดู heartbeat, TPS/MSPT การตรวจพบ และเหตุการณ์ล่าสุด — ฟรี ไม่มีวันหมดอายุ" },
          ].map((step) => html`<div class="card card-pad">
            <div class="row" style="gap:.7rem;align-items:flex-start">
              <span class="mono" style="color:var(--accent)">${step.n}</span>
              <div><h3 style="font-size:.95rem">${step.title}</h3><p class="muted" style="font-size:.82rem;line-height:1.7;margin-top:.3rem">${step.text}</p></div>
            </div>
          </div>`)}
        </div>
      </div>
      <div>
        ${sectionHead("ความปลอดภัย", "ออกแบบแบบ fail-closed", "ทุกจุดที่ตัดสินใจเรื่องสิทธิ์ใช้ค่าเริ่มต้นเป็นการปฏิเสธ และบันทึกสิ่งที่เกิดขึ้น")}
        <div class="card card-pad">
          ${bulletList([
            "ใบอนุญาตลงลายเซ็น Ed25519 และตรวจที่ฝั่งเซิร์ฟเวอร์",
            "License key เก็บเป็น HMAC-SHA256 ไม่เก็บ plaintext",
            "ทุกคำสั่งของเจ้าของเซิร์ฟเวอร์ถูกจำกัดด้วย org_id",
            "ผู้ดูแลต้องผ่าน Cloudflare Access และมีสิทธิ์ในฐานข้อมูล",
            "ผิดรหัสซ้ำ ๆ ถูกล็อกแบบทวีคูณและบันทึกหลักฐาน",
          ])}
          <div style="margin-top:1rem"><a class="btn btn-ghost btn-sm" href="/docs/security">อ่านรายละเอียดความปลอดภัย ${icon("arrow")}</a></div>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--alt">
    <div class="shell" style="text-align:center;max-width:760px">
      <p class="eyebrow" style="justify-content:center">เริ่มต้น</p>
      <h2 style="font-size:clamp(1.7rem,3vw,2.4rem)">พร้อมเริ่มใช้งานฟรีหรือยัง</h2>
      <p class="muted" style="margin-top:.8rem;line-height:1.8">สร้างบัญชี รับไลเซนส์ และเชื่อมเซิร์ฟเวอร์เครื่องแรกได้ภายในไม่กี่นาที</p>
      <div class="row" style="justify-content:center;margin-top:1.5rem">
        <a class="btn btn-primary" href="/auth/login">เข้าสู่ระบบ / เริ่มต้น</a>
        <a class="btn btn-ghost" href="/docs/getting-started">อ่านคู่มือ</a>
      </div>
    </div>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Plugins                                                                    */
/* -------------------------------------------------------------------------- */

export function pluginsIndex(
  products: ProductView[],
  options: { q: string; category: string; lang: Lang },
): SafeHtml {
  const categories = [...new Set(products.map((product) => product.category))];
  return html`<section class="section">
    <div class="shell">
      <p class="eyebrow">PRODUCTS</p>
      <h1 style="font-size:clamp(1.9rem,3.5vw,2.8rem)">ผลิตภัณฑ์ทั้งหมด</h1>
      <p class="muted" style="margin-top:.6rem;max-width:64ch">ปลั๊กอินที่เราพัฒนา พร้อมเอกสาร เงื่อนไขการใช้งาน และไลเซนส์ฟรีที่ชัดเจน</p>

      <form class="search-bar" method="get" action="/plugins" style="margin-top:1.6rem">
        <input class="input" type="search" name="q" value="${options.q}" placeholder="ค้นหาผลิตภัณฑ์…" aria-label="ค้นหา">
        <button class="btn btn-soft" type="submit">${icon("search")} ค้นหา</button>
      </form>
      <div class="filter-tabs">
        <a href="/plugins" class="${options.category === "" ? "is-active" : ""}">ทั้งหมด</a>
        ${categories.map((category) => html`<a href="/plugins?category=${encodeURIComponent(category)}" class="${options.category === category ? "is-active" : ""}">${category}</a>`)}
      </div>

      ${products.length > 0
        ? html`<div class="product-grid">${products.map((product) => productCard(product, options.lang))}</div>`
        : emptyState("ไม่พบผลิตภัณฑ์ที่ตรงกับเงื่อนไข")}
    </div>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Product detail                                                             */
/* -------------------------------------------------------------------------- */

export function productDetail(
  product: ProductView,
  options: {
    lang: Lang;
    csrf: string;
    owned: boolean;
    authed: boolean;
    siteKey: string;
  },
): SafeHtml {
  const latest = product.latestRelease;
  const purchaseDisabled = product.status !== "published";
  const compatibility = product.compatibilityData as Record<string, unknown>;
  const minecraft = Array.isArray(compatibility.minecraft) ? (compatibility.minecraft as string[]) : [];
  const servers = Array.isArray(compatibility.servers) ? (compatibility.servers as string[]) : [];
  const java = Array.isArray(compatibility.java) ? (compatibility.java as string[]) : [];
  const requires = Array.isArray(compatibility.requires) ? (compatibility.requires as string[]) : [];

  return html`<section class="section">
    <div class="shell">
      <nav class="breadcrumb" aria-label="breadcrumb"><a href="/plugins">ผลิตภัณฑ์</a><span>/</span><span>${product.name}</span></nav>
      <div class="grid-2" style="align-items:start;gap:2rem">
        <div>
          <div class="row" style="justify-content:space-between">
            <div class="row">
              <div class="product-thumb" style="margin:0">${product.name.slice(0, 2).toUpperCase()}</div>
              <div>
                <h1 style="font-size:clamp(1.9rem,3.5vw,2.6rem);line-height:1.2">${product.name}</h1>
                <div class="row" style="margin-top:.4rem">${badge(product.status, options.lang)}${latest ? html`<span class="badge badge--info badge--version">v${latest.version}</span>` : raw("")}</div>
              </div>
            </div>
          </div>
          <p class="text-2" style="margin-top:1.1rem;font-size:1.02rem;line-height:1.8">${product.tagline}</p>
          <div class="prose" style="margin-top:1.2rem">${paragraphs(product.description)}</div>

          ${product.featuresList.length > 0
            ? html`<div style="margin-top:2rem">
                <h2 style="font-size:1.2rem;margin-bottom:.8rem">ความสามารถหลัก</h2>
                <div class="grid-2">
                  ${product.featuresList.map((feature) => html`<article class="feature-card">
                    <div class="feature-icon">${icon("check")}</div>
                    <h3>${feature.title}</h3>
                    <p>${feature.description}</p>
                  </article>`)}
                </div>
              </div>`
            : raw("")}

          <div style="margin-top:1rem" class="card">
            <div class="card-head"><h3>เปิดใช้งานก่อนใช้งาน</h3></div>
            <div class="card-body">
              <p class="muted" style="max-width:70ch">ไจาร์ 4.0.4 ถูก gate ด้วยไลเซนส์: protection จะเริ่มทำงานหลังยืนยันเซิร์ฟเวอร์บนเว็บนี้แล้วเท่านั้น (ฟรี 100%)</p>
              <ol style="margin:.8rem 0 0;padding-left:1.2rem;display:grid;gap:.45rem;font-size:.82rem;color:var(--text-2)">
                <li>วางไจาร์และ <code>PacketEvents</code> ใน <code>plugins/</code> แล้วรีสตาร์ท</li>
                <li>รัน <code>/aegishider license link</code> — จะได้รหัส 16 ตัวและ URL</li>
                <li>เข้าสู่ระบบ/สมัครฟรี แล้วไปที่ <a href="/app/activations">การเปิดใช้งาน</a> ใส่รหัส</li>
                <li>รัน <code>/aegishider license refresh</code> แล้วตรวจ <code>/aegishider status</code> ว่า protection=ACTIVE</li>
              </ol>
              <p class="mono" style="margin-top:.8rem;font-size:.58rem;color:var(--muted-2)">DEFAULT enforcement=enforce · ฟรี 100% · เปลี่ยนเป็น warn หรือปิดได้ใน platform.yml</p>
            </div>
          </div>

          <div style="margin-top:2rem" id="evidence">
            <h2 style="font-size:1.2rem;margin-bottom:.6rem">ผลทดสอบจริง · A–F</h2>
            <p class="muted" style="margin-bottom:1rem;max-width:72ch">ไคลเอนต์จำลองสองตัวเชื่อมต่อ Paper แล้วถอดรหัส chunk และทะเบียน block entity ฝั่งไคลเอนต์ — ตารางด้านล่างคือผลจริงบนไบล์ที่ obfuscate แล้ว</p>
            <div class="card" style="margin-top:1rem">
              <div class="card-body">
                <table class="evidence-table">
                  <thead><tr><th>สถานการณ์</th><th>BaseHider 3.0.0</th><th>Aegishider 4.0.4</th></tr></thead>
                  <tbody>
                    <tr><th>A · ไอเท็มไกลหลังกำแพง</th><td class="bad">LEAK · 1 spawn/client</td><td class="good">HIDDEN · 0 spawn</td></tr>
                    <tr><th>B · ไอเท็มใกล้ 3 บล็อก</th><td class="good">VISIBLE</td><td class="good">VISIBLE · 12–35 ms</td></tr>
                    <tr><th>C · หีบใน chunk ที่ resend</th><td class="bad">LEAK · chest states=2</td><td class="good">HIDDEN · chest states=0</td></tr>
                    <tr><th>D · block entity 160/336 บล็อก</th><td class="bad">LEAK ทั้งสองระยะ</td><td class="good">HIDDEN ทั้งสองระยะ</td></tr>
                    <tr><th>E · ทะเบียน block entity ฝั่งไคลเอนต์</th><td class="bad">DIRTY · hidden BEs=6</td><td class="good">CLEAN · hidden BEs=0</td></tr>
                    <tr><th>F · cache replay (Bobby / DH)</th><td class="bad">CACHE LEAK · final=chest</td><td class="good">RE-HIDE · final=stone</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p class="mono" style="margin-top:.8rem;font-size:.58rem;letter-spacing:.04em;color:var(--muted-2)">PAPER 1.21.4 BUILD 232 · PACKETEVENTS 2.14.0 · 2 CLIENTS · 152 UNIT TESTS · SMOKE: 1.21.1 / 1.21.5 / 1.21.11 / 26.3</p>
          </div>

          <div style="margin-top:2rem" class="card">
            <div class="card-head"><h3>ความเข้ากันได้</h3></div>
            <div class="card-body">
              <dl class="detail-list">
                <div><dt>Minecraft</dt><dd>${minecraft.join(", ") || "—"}</dd></div>
                <div><dt>เซิร์ฟเวอร์</dt><dd>${servers.join(", ") || "—"}</dd></div>
                <div><dt>Java</dt><dd>${java.join(", ") || "—"}</dd></div>
                <div><dt>ต้องมีเพิ่ม</dt><dd>${requires.join(", ") || "—"}</dd></div>
              </dl>
            </div>
          </div>

          ${latest
            ? html`<div style="margin-top:1rem" class="card">
                <div class="card-head"><h3>รีลีสล่าสุด · ${latest.version}</h3><span class="mono">${formatDate(latest.released_at, options.lang)}</span></div>
                <div class="card-body">
                  ${releaseNotes(latest.notes)}
                  ${latest.artifact_url
                    ? html`<div class="row" style="margin-top:.9rem">
                        <a class="btn btn-soft btn-sm" href="${latest.artifact_url}" download>${icon("download")} ดาวน์โหลดไจาร์</a>
                        ${latest.artifact_sha256 ? html`<span class="mono" style="font-size:.52rem;word-break:break-all">SHA-256 ${latest.artifact_sha256}</span>` : raw("")}
                      </div>`
                    : raw("")}
                </div>
              </div>`
            : raw("")}

          ${product.releases.length > 1
            ? html`<div style="margin-top:1rem">
                <h2 style="font-size:1.1rem;margin-bottom:.6rem">ไบล์ตามเวอร์ชัน</h2>
                <div class="timeline">
                  ${product.releases.map((release) => html`<div class="timeline-item" style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
                    <div>
                      <time>${formatDate(release.released_at, options.lang)}</time>
                      <b>v${release.version}</b>
                      ${release.channel !== "stable" ? html`<span class="badge">${release.channel}</span>` : raw("")}
                      <div style="margin-top:.35rem;display:flex;flex-wrap:wrap;gap:.25rem">
                        ${jsonArray<string>(release.supported_minecraft).map((version) => html`<span class="badge">MC ${version}</span>`)}
                        ${jsonArray<string>(release.supported_java).map((version) => html`<span class="badge">Java ${version}</span>`)}
                      </div>
                    </div>
                    ${release.artifact_url
                      ? html`<a class="btn btn-soft btn-sm" href="${release.artifact_url}" download>${icon("download")} ดาวน์โหลด</a>`
                      : raw("")}
                  </div>`)}
                </div>
              </div>`
            : raw("")}
        </div>

        <aside class="stack" style="position:sticky;top:92px">
          <div class="card">
            <div class="card-head"><h3>รับไลเซนส์</h3>${badge(product.status, options.lang)}</div>
            <div class="card-body">
              <div class="product-price" style="border:0;padding:0;margin:0 0 .9rem">
                <div><b>ฟรี 100%</b><span>ไม่มีระบบชำระเงิน · ไม่มีวันหมดอายุ</span></div>
              </div>
              ${product.plans.length > 0
                ? html`<div class="plan-grid" style="grid-template-columns:1fr">
                    ${product.plans.slice(0, 1).map((plan) => html`<div class="plan">
                      <div class="spread"><h3>${plan.name}</h3><span class="mono">ฟรี</span></div>
                      <p class="muted" style="font-size:.72rem">ใช้ได้ 5 เซิร์ฟเวอร์พร้อมกัน · ไม่มีวันหมดอายุ</p>
                    </div>`)}
                  </div>`
                : raw("")}

              ${options.owned
                ? html`<div class="alert alert--success" style="margin-top:1rem">${icon("check")}<div>คุณมีไลเซนส์ของผลิตภัณฑ์นี้แล้ว</div></div>
                       <a class="btn btn-primary btn-block" style="margin-top:.8rem" href="/app/licenses">ไปที่ไลเซนส์ของฉัน</a>`
                : purchaseDisabled
                  ? html`<div class="alert alert--info" style="margin-top:1rem">${icon("clock")}<div>ผลิตภัณฑ์นี้ยังไม่เปิดให้รับไลเซนส์</div></div>`
                  : html`<form method="post" action="/app/licenses/free" class="form" style="margin-top:1rem" data-lock>
                      ${csrfInput(options.csrf)}
                      <input type="hidden" name="product_slug" value="${product.slug}">
                      ${options.authed
                        ? html`<button class="btn btn-primary btn-block" type="submit">${icon("key")} รับไลเซนส์ฟรี</button>
                               <p class="muted" style="font-size:.68rem;line-height:1.6">ระบบจะสร้างรหัสยาว 240 บิตให้ทันที และเก็บเฉพาะ hash ในฐานข้อมูล</p>`
                        : html`<a class="btn btn-primary btn-block" href="/auth/register?next=${encodeURIComponent(`/plugins/${product.slug}`)}">สมัครฟรีเพื่อรับไลเซนส์</a>`}
                    </form>`}
            </div>
          </div>

          <div class="card card-pad">
            <p class="mono" style="margin-bottom:.6rem">ลิงก์ที่เกี่ยวข้อง</p>
            <div class="stack" style="gap:.45rem">
              <a class="text-2" style="font-size:.84rem" href="/docs/aegishider">เอกสารการติดตั้ง ${icon("arrow")}</a>
              <a class="text-2" style="font-size:.84rem" href="/changelog/${product.slug}">บันทึกการอัปเดต ${icon("arrow")}</a>
              <a class="text-2" style="font-size:.84rem" href="/support">ขอความช่วยเหลือ ${icon("arrow")}</a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Pricing / changelog / status                                               */
/* -------------------------------------------------------------------------- */

export function pricingPage(products: ProductView[]): SafeHtml {
  return html`<section class="section">
    <div class="shell">
      <p class="eyebrow">FREE</p>
      <h1 style="font-size:clamp(1.9rem,3.5vw,2.8rem)">ฟรี 100%</h1>
      <p class="muted" style="margin-top:.6rem;max-width:64ch">ไม่มีระบบชำระเงิน ไม่มีกระเป๋าเงิน และไม่มีค่าบริการแอบแฝง — สมัครบัญชีแล้วรับไลเซนส์ได้ทันที</p>
      <div class="stack" style="margin-top:2rem;gap:1.5rem">
        ${products.map((product) => html`<div class="card">
          <div class="card-head">
            <div><h3><a href="/plugins/${product.slug}">${product.name}</a></h3><p class="muted" style="font-size:.74rem;margin-top:.2rem">${product.tagline}</p></div>
            <a class="btn btn-ghost btn-sm" href="/plugins/${product.slug}">รายละเอียด ${icon("arrow")}</a>
          </div>
          <div class="card-body">
            <div class="plan-grid">
              <div class="plan">
                <h3>Free</h3>
                <div class="price">ฟรี</div>
                <p class="muted" style="font-size:.7rem">ใช้ได้ 5 เซิร์ฟเวอร์พร้อมกัน · ไม่มีวันหมดอายุ</p>
                <ul>
                  <li>ป้องกันหีบและไอเท็มเต็มรูปแบบ</li>
                  <li>Telemetry และแดชบอร์ดเชิงลึก</li>
                  <li>แจ้งเตือนการตรวจพบและล็อก IP อัตโนมัติ</li>
                  <li>ไลเซนส์รหัสยาว 240 บิต ตรวจลายเซ็น Ed25519</li>
                </ul>
              </div>
            </div>
            <div class="row" style="margin-top:1rem">
              <a class="btn btn-primary" href="/auth/register?next=${encodeURIComponent(`/plugins/${product.slug}`)}">สมัครฟรี</a>
              <a class="btn btn-ghost" href="/docs/licensing">วิธีใช้งานไลเซนส์ ${icon("arrow")}</a>
            </div>
          </div>
        </div>`)}
      </div>
      <div class="alert alert--info" style="margin-top:1.5rem">${icon("shield")}<div>ทุกฟีเจอร์ฟรีสำหรับเจ้าของเซิร์ฟเวอร์ — ไลเซนส์ใช้งานได้ถาวรจนกว่าจะมีการเปลี่ยนหรือยกเลิก (ผู้ให้บริการอาจเปลี่ยน/เพิกถอนได้ทุกเมื่อ) และระบบป้องกันการเดารหัสทำงานอัตโนมัติ ผิด 5 ครั้งล็อก 5 นาที ผิด 10 ครั้งล็อก 10 นาที และเพิ่มขึ้นเรื่อย ๆ</div></div>
    </div>
  </section>`;
}

export function changelogPage(
  releases: Array<ReleaseRow & { product_name: string; product_slug: string }>,
  productName: string | null,
  lang: Lang,
): SafeHtml {
  return html`<section class="section">
    <div class="shell">
      <p class="eyebrow">CHANGELOG</p>
      <h1 style="font-size:clamp(1.9rem,3.5vw,2.8rem)">${productName ? `อัปเดต ${productName}` : "บันทึกการอัปเดต"}</h1>
      <p class="muted" style="margin-top:.6rem">ทุกเวอร์ชันที่เผยแพร่ พร้อมหมายเหตุและข้อมูลความเข้ากันได้</p>
      <div class="stack" style="margin-top:2rem">
        ${releases.length === 0 ? emptyState("ยังไม่มีรีลีสที่เผยแพร่") : releases.map((release) => html`<article class="card">
          <div class="card-head">
            <div class="row"><h3>${release.product_name} · v${release.version}</h3>${badge(release.channel === "stable" ? "published" : release.channel, lang)}</div>
            <span class="mono" style="font-size:.55rem">${formatDate(release.released_at, lang)}</span>
          </div>
          <div class="card-body">
            ${releaseNotes(release.notes)}
            <div class="row" style="margin-top:.8rem">
              ${jsonArray<string>(release.supported_minecraft).map((version) => html`<span class="badge">MC ${version}</span>`)}
              ${jsonArray<string>(release.supported_platforms).map((platform) => html`<span class="badge">${platform}</span>`)}
            </div>
          </div>
        </article>`)}
      </div>
    </div>
  </section>`;
}

export function statusPage(report: StatusReport, lang: Lang): SafeHtml {
  return html`<section class="section">
    <div class="shell">
      <p class="eyebrow">STATUS</p>
      <div class="spread" style="align-items:flex-start">
        <div>
          <h1 style="font-size:clamp(1.9rem,3.5vw,2.8rem)">สถานะระบบ</h1>
          <p class="muted" style="margin-top:.6rem">ข้อมูลสดจากฐานข้อมูลจริง — ไม่ใช่ค่าจำลอง</p>
        </div>
        <div>${badge(report.overall, lang)}</div>
      </div>

      <div class="stack" style="margin-top:2rem">
        ${report.components.map((component) => html`<div class="card">
          <div class="card-body spread">
            <div><div class="row"><b>${component.name}</b>${badge(component.status, lang)}</div><p class="muted" style="font-size:.76rem;margin-top:.3rem">${component.detail}</p></div>
          </div>
        </div>`)}
      </div>

      <div class="stat-grid" style="margin-top:1.5rem">
        <div class="stat"><div class="label">Installs ที่ใช้งาน 24 ชม.</div><div class="value">${report.metrics.activeInstallations24h}</div></div>
        <div class="stat"><div class="label">ผลิตภัณฑ์ที่เผยแพร่</div><div class="value">${report.metrics.publishedProducts}</div></div>
        <div class="stat"><div class="label">ไลเซนส์ที่ใช้งาน</div><div class="value">${report.metrics.activeLicenses}</div></div>
        <div class="stat"><div class="label">Telemetry ค้างประมวลผล</div><div class="value">${report.metrics.pendingTelemetry}</div></div>
      </div>
      <p class="muted" style="font-size:.7rem;margin-top:1rem">สร้างเมื่อ ${formatDateTime(report.generatedAt, lang)}</p>
    </div>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Docs                                                                       */
/* -------------------------------------------------------------------------- */

export function docsIndex(_lang: Lang): SafeHtml {
  return html`<section class="section">
    <div class="shell">
      <p class="eyebrow">DOCUMENTATION</p>
      <h1 style="font-size:clamp(1.9rem,3.5vw,2.8rem)">เอกสารการใช้งาน</h1>
      <p class="muted" style="margin-top:.6rem;max-width:64ch">คู่มือสำหรับลูกค้า นักพัฒนา และผู้ดูแลระบบ — เขียนจากสิ่งที่ระบบทำจริง</p>
      <div class="grid-2" style="margin-top:2rem">
        ${docsByCategory().map((group) => html`<div class="card card-pad">
          <h2 style="font-size:1rem;margin-bottom:.7rem">${group.category}</h2>
          <div class="stack" style="gap:.5rem">
            ${group.pages.map((page) => html`<a href="/docs/${page.slug}" class="card card-pad" style="padding:.8rem .9rem;display:block">
              <b style="font-size:.88rem">${page.title}</b>
              <span class="muted" style="display:block;font-size:.74rem;margin-top:.2rem">${page.summary}</span>
            </a>`)}
          </div>
        </div>`)}
      </div>
    </div>
  </section>`;
}

export function docPage(doc: DocPage, _lang: Lang): SafeHtml {
  const groups = docsByCategory();
  return html`<section class="section">
    <div class="shell docs-layout">
      <nav class="docs-nav" aria-label="เอกสาร">
        <a href="/docs" style="font-weight:500;color:var(--accent)">เอกสารทั้งหมด</a>
        ${groups.map((group) => html`<h3>${group.category}</h3>
          ${group.pages.map((page) => html`<a href="/docs/${page.slug}" ${page.slug === doc.slug ? raw('aria-current="page"') : raw("")}>${page.title}</a>`)}`)}
      </nav>
      <article>
        <div class="prose">${renderMarkdown(doc.markdown)}</div>
        <p class="mono" style="margin-top:1.5rem;font-size:.55rem">อัปเดต ${doc.updated} · Aegishider Control Platform</p>
      </article>
    </div>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Support / contact / about / legal                                          */
/* -------------------------------------------------------------------------- */

const SUPPORT_FAQ = [
  {
    q: "ต้องมีบัญชีไหมก่อนรับไลเซนส์?",
    a: "ต้องมีครับ ระบบใช้การเข้าสู่ระบบด้วยอีเมล (ไม่มีรหัสผ่าน) เพื่อผูกไลเซนส์กับองค์กรของคุณ — สมัครฟรีและได้ไลเซนส์ทันที",
  },
  {
    q: "มีค่าใช้จ่ายไหม?",
    a: "ไม่มีค่าใช้จ่าย ฟรี 100% ไฟล์ดาวน์โหลดอยู่ที่หน้าผลิตภัณฑ์ และไลเซนส์จะออกให้อัตโนมัติเมื่อสมัครหรือกดรับไลเซนส์",
  },
  {
    q: "ย้ายเซิร์ฟเวอร์ต้องทำอย่างไร?",
    a: "ไปที่พอร์ทัล → ไลเซนส์ → รีเซ็ตการเปิดใช้งานของเครื่องเดิม แล้วเชื่อมเครื่องใหม่ด้วยรหัสใหม่",
  },
  {
    q: "แพลตฟอร์มล่มจะกระทบเซิร์ฟเวอร์ไหม?",
    a: "ไม่กระทบทันที เพราะปลั๊กอินเก็บใบอนุญาตที่ลงลายเซ็นไว้ในเครื่องและมี offline grace ตามที่กำหนด",
  },
  {
    q: "ข้อมูลเซิร์ฟเวอร์ถูกเก็บอะไรบ้าง?",
    a: "เฉพาะข้อมูลปฏิบัติการแบบรวม เช่น เวอร์ชัน, TPS/MSPT, จำนวนผู้เล่นออนไลน์ และเหตุการณ์ผิดพลาด — ไม่มีชื่อผู้เล่นหรือพิกัด",
  },
];

export function supportPage(options: { siteKey: string; csrf: string; authed: boolean; lang: Lang }): SafeHtml {
  return html`<section class="section">
    <div class="shell grid-2" style="align-items:start;gap:2.5rem">
      <div>
        <p class="eyebrow">SUPPORT</p>
        <h1 style="font-size:clamp(1.9rem,3.5vw,2.8rem)">ศูนย์ช่วยเหลือ</h1>
        <p class="muted" style="margin-top:.6rem;line-height:1.8">อ่านคำตอบด้านล่าง หรือเปิดตั๋วถึงทีมงานได้จากพอร์ทัล</p>
        <div class="stack" style="margin-top:1.5rem">
          ${SUPPORT_FAQ.map((item) => html`<div class="card card-pad">
            <b style="font-size:.9rem">${item.q}</b>
            <p class="muted" style="font-size:.8rem;line-height:1.75;margin-top:.35rem">${item.a}</p>
          </div>`)}
        </div>
        <div class="row" style="margin-top:1.2rem">
          ${options.authed
            ? html`<a class="btn btn-primary" href="/app/support">เปิดตั๋วใหม่</a>`
            : html`<a class="btn btn-primary" href="/auth/login?next=/app/support">เข้าสู่ระบบเพื่อเปิดตั๋ว</a>`}
          <a class="btn btn-ghost" href="/docs">อ่านเอกสาร</a>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>ติดต่อทีมงาน</h3></div>
        <div class="card-body">
          <form class="form" method="post" action="/contact" data-lock>
            ${csrfInput(options.csrf)}
            <div class="field-row">
              <div class="field"><label for="name">ชื่อ</label><input class="input" id="name" name="name" required maxlength="120" autocomplete="name"></div>
              <div class="field"><label for="email">อีเมล</label><input class="input" id="email" name="email" type="email" required maxlength="200" autocomplete="email"></div>
            </div>
            <div class="field"><label for="topic">หัวข้อ</label>
              <select class="select" id="topic" name="topic">
                <option value="sales">สอบถามการใช้งาน/ไลเซนส์</option>
                <option value="technical">ปัญหาเทคนิค</option>
                <option value="billing">ปัญหาไลเซนส์/การเปิดใช้งาน</option>
                <option value="security">ความปลอดภัย</option>
                <option value="other">อื่น ๆ</option>
              </select>
            </div>
            <div class="field"><label for="message">รายละเอียด</label><textarea class="textarea" id="message" name="message" required maxlength="5000" placeholder="อธิบายสิ่งที่เกิดขึ้น พร้อมเวอร์ชันและข้อความผิดพลาด (ไม่ต้องแนบข้อมูลส่วนตัว)"></textarea></div>
            ${turnstileWidget(options.siteKey)}
            <button class="btn btn-primary" type="submit">${icon("mail")} ส่งข้อความ</button>
            <p class="muted" style="font-size:.68rem">การส่งข้อความถือว่าคุณยอมรับนโยบายความเป็นส่วนตัว</p>
          </form>
        </div>
      </div>
    </div>
  </section>`;
}

export function contactPage(options: { siteKey: string; csrf: string; lang: Lang }): SafeHtml {
  return html`<section class="section">
    <div class="shell narrow">
      <p class="eyebrow">CONTACT</p>
      <h1 style="font-size:clamp(1.9rem,3.5vw,2.6rem)">ติดต่อเรา</h1>
      <p class="muted" style="margin-top:.6rem;line-height:1.8">สอบถามการใช้งาน ปัญหาเทคนิค หรือเรื่องความปลอดภัย — เราอ่านทุกข้อความ</p>
      <div class="card" style="margin-top:1.5rem">
        <div class="card-body">
          <form class="form" method="post" action="/contact" data-lock>
            ${csrfInput(options.csrf)}
            <div class="field-row">
              <div class="field"><label for="name">ชื่อ</label><input class="input" id="name" name="name" required maxlength="120"></div>
              <div class="field"><label for="email">อีเมล</label><input class="input" id="email" name="email" type="email" required maxlength="200"></div>
            </div>
            <div class="field"><label for="topic">หัวข้อ</label>
              <select class="select" id="topic" name="topic">
                <option value="sales">สอบถามการใช้งาน/ไลเซนส์</option>
                <option value="technical">ปัญหาเทคนิค</option>
                <option value="billing">ปัญหาไลเซนส์/การเปิดใช้งาน</option>
                <option value="security">ความปลอดภัย</option>
                <option value="other">อื่น ๆ</option>
              </select>
            </div>
            <div class="field"><label for="message">รายละเอียด</label><textarea class="textarea" id="message" name="message" required maxlength="5000"></textarea></div>
            ${turnstileWidget(options.siteKey)}
            <button class="btn btn-primary" type="submit">${icon("mail")} ส่งข้อความ</button>
          </form>
        </div>
      </div>
    </div>
  </section>`;
}

export function aboutPage(_lang: Lang): SafeHtml {
  return html`<section class="section">
    <div class="shell narrow">
      <p class="eyebrow">ABOUT</p>
      <h1 style="font-size:clamp(1.9rem,3.5vw,2.6rem)">เกี่ยวกับ Aegishider</h1>
      <div class="prose" style="margin-top:1.2rem">
        <p>Aegishider เริ่มจากปลั๊กอินซ่อนหีบและไอเท็มสำหรับเซิร์ฟเวอร์ Paper ที่ยึดหลัก “ไม่แน่ใจ = ซ่อน” และขยายมาเป็นแพลตฟอร์มจัดการไลเซนส์สำหรับผลิตภัณฑ์หลายตัว</p>
        <p>เป้าหมายของแพลตฟอร์มคือทำให้การใช้งานปลั๊กอินเป็นเรื่องตรงไปตรงมา: เจ้าของเซิร์ฟเวอร์ใช้งานฟรี ผู้ดูแลเห็นสิ่งที่เกิดขึ้น และทุกฝ่ายตรวจสอบย้อนกลับได้</p>
        <h2>หลักที่ยึด</h2>
        <ul>
          <li>ไม่แสดงข้อมูลจำลองในโปรดักชัน</li>
          <li>ไม่เก็บข้อมูลส่วนตัวที่ไม่จำเป็น</li>
          <li>ค่าเริ่มต้นคือปฏิเสธ (fail-closed)</li>
          <li>ทุกการกระทำของผู้ดูแลมี audit trail</li>
        </ul>
        <h2>ติดต่อ</h2>
        <p>ใช้หน้า <a href="/contact">ติดต่อเรา</a> หรือเปิดตั๋วผ่านพอร์ทัล</p>
      </div>
    </div>
  </section>`;
}

export function legalPage(kind: "terms" | "privacy", _lang: Lang): SafeHtml {
  const title = kind === "terms" ? "ข้อกำหนดการใช้งาน" : "นโยบายความเป็นส่วนตัว";
  const body = kind === "terms"
    ? `
# ข้อกำหนดการใช้งาน

อัปเดตล่าสุด: พฤศจิกายน 2026

## 1. การใช้งานบริการ

คุณต้องมีสิทธิ์ตามกฎหมายในการใช้บริการนี้ และต้องไม่ใช้บริการเพื่อละเมิดกฎหมายหรือสิทธิ์ของผู้อื่น

## 2. ไลเซนส์

- ไลเซนส์อนุญาตให้ใช้งานผลิตภัณฑ์ตามจำนวนเซิร์ฟเวอร์ที่กำหนด
- ห้ามคัดลอก ดัดแปลง หรือแจกจ่ายไฟล์ที่ได้รับ เว้นแต่ได้รับอนุญาตเป็นลายลักษณ์อักษร
- ไลเซนส์และคีย์ที่ออกให้ใช้งานได้ต่อเนื่องและไม่มีวันหมดอายุตามปกติ จนกว่าจะมีการเปลี่ยนแปลงหรือเพิกถอน
- ผู้ให้บริการขอสงวนสิทธิ์เปลี่ยน แก้ไข ระงับ หรือเพิกถอนไลเซนส์/คีย์ได้ทุกเมื่อ โดยจะแจ้งผ่านหน้าเว็บหรือพอร์ทัล
- การเพิกถอนไลเซนส์อาจเกิดขึ้นเมื่อละเมิดข้อกำหนดหรือมีการใช้ในทางที่ผิด

## 3. ค่าใช้จ่าย

แพลตฟอร์มนี้ไม่มีระบบชำระเงิน ทุกฟีเจอร์และไลเซนส์เปิดให้เจ้าของเซิร์ฟเวอร์ใช้ฟรี 100%

## 4. ข้อจำกัดความรับผิด

บริการให้ “ตามสภาพที่เป็นอยู่” เราไม่รับประกันว่าปลั๊กอินจะเหมาะกับทุกเซิร์ฟเวอร์ และไม่รับผิดต่อความเสียหายทางอ้อม

## 5. การเปลี่ยนแปลง

เราอาจปรับปรุงข้อกำหนดและจะแจ้งการเปลี่ยนแปลงที่มีนัยสำคัญผ่านหน้าเว็บ
`
    : `
# นโยบายความเป็นส่วนตัว

อัปเดตล่าสุด: พฤศจิกายน 2026

## ข้อมูลที่เราเก็บ

- อีเมลและข้อมูลบัญชีที่จำเป็นต่อการเข้าสู่ระบบ
- ข้อมูลไลเซนส์และการเปิดใช้งาน
- ข้อมูลปฏิบัติการของเซิร์ฟเวอร์ที่เชื่อมต่อ (เวอร์ชัน, TPS/MSPT, จำนวนผู้เล่นออนไลน์, เหตุการณ์ผิดพลาด)
- บันทึกความปลอดภัย เช่น การเข้าสู่ระบบและ IP แบบ hash

## ข้อมูลที่เราไม่เก็บ

- ชื่อผู้เล่น, UUID ผู้เล่น, IP ผู้เล่น
- แชท, inventory, พิกัดโลก
- ไฟล์คอนฟิกหรือข้อมูลส่วนตัวบนเซิร์ฟเวอร์

## วัตถุประสงค์

ใช้เพื่อให้บริการ ตรวจสอบไลเซนส์ ปรับปรุงเสถียรภาพ และตอบสนองต่อเหตุการณ์ความปลอดภัย

## การเปิดเผยข้อมูล

เราไม่ขายข้อมูลส่วนบุคคล และเปิดเผยเฉพาะเมื่อกฎหมายกำหนดหรือเพื่อปกป้องสิทธิ์ของเรา

## การเก็บรักษา

ข้อมูล telemetry แบบ raw เก็บตามนโยบาย retention (เริ่มต้น 90 วัน) ข้อมูลบัญชีเก็บเท่าที่จำเป็น

## สิทธิ์ของคุณ

ขอเข้าถึง แก้ไข หรือลบข้อมูลบัญชีได้ผ่านช่องทางติดต่อ
`;
  return html`<section class="section">
    <div class="shell narrow">
      <div class="prose">${renderMarkdown(body)}</div>
      <p class="mono" style="margin-top:2rem;font-size:.55rem">${title} · Aegishider Control Platform</p>
    </div>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export function errorPage(title: string, message: string): SafeHtml {
  return html`<section class="section">
    <div class="shell narrow" style="text-align:center;padding-block:3rem">
      <p class="eyebrow" style="justify-content:center">ERROR</p>
      <h1 style="font-size:clamp(1.8rem,3.5vw,2.6rem)">${title}</h1>
      <p class="muted" style="margin-top:.7rem;line-height:1.8">${message}</p>
      <div class="row" style="justify-content:center;margin-top:1.5rem">
        <a class="btn btn-primary" href="/">กลับหน้าแรก</a>
        <a class="btn btn-ghost" href="/support">ติดต่อทีมงาน</a>
      </div>
    </div>
  </section>`;
}
