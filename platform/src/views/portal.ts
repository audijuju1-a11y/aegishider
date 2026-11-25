import { SafeHtml, html, raw } from "../lib/html";
import { formatDate, formatDateTime, safeJsonParse, timeAgo, jsonArray } from "../lib/time";
import type { SessionUser, SessionListRow } from "../auth/session";
import type { InstallationRow, LicenseRow } from "../services/licensing";
import type { PortalOverview, ServerDetail, OwnedProduct } from "../services/portal";
import type { TicketMessageRow, TicketView } from "../services/support";
import {
  badge,
  csrfInput,
  detailList,
  emptyState,
  formatWhen,
  icon,
  passwordToggle,
  stat,
} from "./ui";
import { turnstileWidget } from "./marketing";

function entitlements(license: LicenseRow): string[] {
  return jsonArray<string>(license.entitlements);
}

function eventMessage(payload: string): string {
  const data = safeJsonParse<{ message?: string }>(payload, {});
  return data.message ?? "";
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export function overviewPage(overview: PortalOverview): SafeHtml {
  const activeServers = overview.servers.filter((server) => server.status === "active").length;
  return html`
    <div class="stat-grid">
      ${stat("ไลเซนส์", overview.licenses.length, `${overview.licenses.filter((license) => license.status === "active").length} ใบใช้งานอยู่`)}
      ${stat("เซิร์ฟเวอร์", overview.servers.length, `${activeServers} ออนไลน์ใน 24 ชม.`)}
      ${stat("รอเปิดใช้งาน", overview.pendingActivations, "รหัสที่ยังไม่ถูกใช้")}
      ${stat("แจ้งเตือน", overview.unreadNotifications, "รายการที่ยังไม่ได้อ่าน")}
    </div>

    <div class="grid-2" style="margin-top:1rem">
      <div class="card">
        <div class="card-head"><h3>เซิร์ฟเวอร์ล่าสุด</h3><a class="btn btn-ghost btn-sm" href="/app/servers">ทั้งหมด</a></div>
        <div class="card-body" style="padding:0">
          ${overview.servers.length === 0
            ? html`<div style="padding:1rem">${emptyState("ยังไม่มีเซิร์ฟเวอร์ที่เชื่อมต่อ", html`<a class="btn btn-primary btn-sm" href="/app/activations">เชื่อมเซิร์ฟเวอร์</a>`)}</div>`
            : html`<div class="table-wrap" style="border:0;border-radius:0">
                <table class="table">
                  <thead><tr><th>เซิร์ฟเวอร์</th><th>สถานะ</th><th>เห็นล่าสุด</th></tr></thead>
                  <tbody>${overview.servers.slice(0, 5).map((server) => html`<tr>
                    <td><a href="/app/servers/${server.id}"><b>${server.display_name ?? "เซิร์ฟเวอร์"}</b></a><div class="mono" style="font-size:.72rem">${server.product_name}</div></td>
                    <td>${badge(server.status)}</td>
                    <td class="muted">${server.last_heartbeat_at ? timeAgo(server.last_heartbeat_at) : "ยังไม่เคย"}</td>
                  </tr>`)}</tbody>
                </table>
              </div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>แจ้งเตือน</h3><a class="btn btn-ghost btn-sm" href="/app/security">ความปลอดภัย</a></div>
        <div class="card-body">
          ${overview.notifications.length === 0
            ? html`<p class="muted" style="font-size:.82rem">ยังไม่มีการแจ้งเตือน</p>`
            : html`<div class="stack" style="gap:.65rem">${overview.notifications.slice(0, 5).map((notification) => html`<div>
                <div class="row" style="gap:.4rem"><b style="font-size:.82rem">${notification.title}</b>${notification.read_at ? raw("") : html`<span class="badge badge--info">ใหม่</span>`}</div>
                <p class="muted" style="font-size:.74rem;margin-top:.15rem">${notification.body}</p>
                <span class="mono" style="font-size:.72rem">${timeAgo(notification.created_at)}</span>
              </div>`)}</div>`}
          ${overview.unreadNotifications > 0 ? html`<p class="mono" style="font-size:.72rem;margin-top:.8rem">ยังไม่อ่าน ${overview.unreadNotifications} รายการ</p>` : raw("")}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>เหตุการณ์ล่าสุด</h3><a class="btn btn-ghost btn-sm" href="/docs/telemetry">ข้อมูลที่ส่ง</a></div>
      <div class="card-body" style="padding:0">
        ${overview.recentEvents.length === 0
          ? html`<div style="padding:1rem">${emptyState("ยังไม่มีข้อมูลจากเซิร์ฟเวอร์ — เมื่อเซิร์ฟเวอร์ส่ง heartbeat จะแสดงที่นี่")}</div>`
          : html`<div class="table-wrap" style="border:0;border-radius:0"><table class="table">
              <thead><tr><th>เวลา</th><th>เซิร์ฟเวอร์</th><th>เหตุการณ์</th><th>ระดับ</th></tr></thead>
              <tbody>${overview.recentEvents.map((event) => html`<tr>
                <td class="muted">${timeAgo(event.occurred_at)}</td>
                <td>${event.installation_name ?? "—"}</td>
                <td><code>${event.event_type}</code><div class="muted" style="font-size:.75rem">${eventMessage(event.payload)}</div></td>
                <td>${badge(event.severity)}</td>
              </tr>`)}</tbody>
            </table></div>`}
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Products / licenses                                                        */
/* -------------------------------------------------------------------------- */

export function productsPage(owned: OwnedProduct[]): SafeHtml {
  return html`<div class="grid-2">
    ${owned.length === 0
      ? html`<div style="grid-column:1/-1">${emptyState("คุณยังไม่มีผลิตภัณฑ์ — ขอไลเซนส์ฟรีได้จากหน้าผลิตภัณฑ์", html`<a class="btn btn-primary btn-sm" href="/plugins">ดูผลิตภัณฑ์</a>`)}</div>`
      : owned.map((product) => html`<article class="card card-pad">
          <div class="spread">
            <div><h3 style="font-size:1rem"><a href="/plugins/${product.product_slug}">${product.product_name}</a></h3>
              <p class="muted" style="font-size:.76rem;margin-top:.25rem">${product.licenses} ไลเซนส์ · ${product.installations} เซิร์ฟเวอร์</p></div>
            ${icon("package")}
          </div>
          <div class="row" style="margin-top:.9rem">
            <a class="btn btn-soft btn-sm" href="/app/licenses">ดูไลเซนส์</a>
            <a class="btn btn-ghost btn-sm" href="/plugins/${product.product_slug}">หน้าผลิตภัณฑ์</a>
          </div>
        </article>`)}
  </div>`;
}

export function licensesPage(
  licenses: LicenseRow[],
  csrf: string = "",
  rawKeyAvailable: Record<string, boolean> = {},
): SafeHtml {
  if (licenses.length === 0) {
    return emptyState(
      "ยังไม่มีไลเซนส์ในบัญชีนี้",
      html`<form method="post" action="/app/licenses/free">${csrfInput(csrf)}<input type="hidden" name="product_slug" value="aegishider"><button class="btn btn-primary btn-sm" type="submit">รับไลเซนส์ฟรี</button></form>`,
    );
  }
  return html`<div class="card card-pad" style="margin-bottom:1rem">
      <div class="spread">
        <div><h3 style="font-size:1rem">ไลเซนส์ฟรี 100%</h3><p class="muted" style="font-size:.76rem;margin-top:.25rem">ทุกผลิตภัณฑ์ฟรี ไม่มีระบบชำระเงิน — สร้างไลเซนส์เพิ่มได้ทุกเมื่อ</p>
        <p class="muted" style="font-size:.72rem;margin-top:.35rem">คีย์ใช้งานได้ถาวรจนกว่าจะมีการเปลี่ยนหรือยกเลิก — ผู้ให้บริการอาจเปลี่ยนหรือเพิกถอนได้ทุกเมื่อ</p></div>
        <form method="post" action="/app/licenses/free">${csrfInput(csrf)}<input type="hidden" name="product_slug" value="aegishider"><button class="btn btn-soft btn-sm" type="submit">${icon("plus")} สร้างไลเซนส์ฟรี</button></form>
      </div>
    </div>
    <div class="table-wrap">
    <table class="table">
      <thead><tr><th>ผลิตภัณฑ์</th><th>ไลเซนส์</th><th>สถานะ</th><th>เซิร์ฟเวอร์</th><th>หมดอายุ</th><th></th></tr></thead>
      <tbody>${licenses.map((license) => html`<tr>
        <td><a href="/app/licenses/${license.id}"><b>${license.product_name}</b></a><div class="mono" style="font-size:.72rem">${license.plan_name ?? "ฟรี"}</div></td>
        <td><code>${license.key_prefix}…</code>${rawKeyAvailable[license.id] ? html`<div class="muted" style="font-size:.72rem">มีรหัสเต็มในหน้ารายละเอียด</div>` : raw("")}</td>
        <td>${badge(license.status)}</td>
        <td class="num">${license.active_activations} / ${license.activation_limit}</td>
        <td class="muted">${license.expires_at ? formatDate(license.expires_at) : "ไม่มีวันหมดอายุ"}</td>
        <td><a class="btn btn-ghost btn-sm" href="/app/licenses/${license.id}">เปิด</a></td>
      </tr>`)}</tbody>
    </table>
  </div>`;
}

export function licenseDetailPage(
  license: LicenseRow,
  activations: Array<{
    id: string;
    installation_id: string;
    display_name: string | null;
    plugin_version: string | null;
    minecraft_version: string | null;
    platform: string | null;
    status: string;
    activated_at: number;
    last_seen_at: number | null;
    last_heartbeat_at: number | null;
  }>,
  csrf: string,
  rawKey: string | null = null,
): SafeHtml {
  return html`
    <div class="card">
      <div class="card-head"><h3>ข้อมูลไลเซนส์</h3>${badge(license.status)}</div>
      <div class="card-body">
        ${detailList([
          { label: "ผลิตภัณฑ์", value: license.product_name },
          { label: "แพ็กเกจ", value: license.plan_name ?? "ฟรี" },
          { label: "คำนำหน้า", value: html`<code>${license.key_prefix}…</code>` },
          { label: "จำนวนเซิร์ฟเวอร์", value: `${license.active_activations} / ${license.activation_limit}` },
          { label: "ออกเมื่อ", value: formatDate(license.created_at) },
          { label: "หมดอายุ", value: license.expires_at ? formatDate(license.expires_at) : "ไม่มีวันหมดอายุ" },
        ])}
        <div class="row" style="margin-top:1rem">
          ${entitlements(license).map((entitlement) => html`<span class="badge">${entitlement}</span>`)}
        </div>
      </div>
    </div>

    <div class="alert alert--info" style="margin-top:1rem">${icon("lock")}<div><b>อายุการใช้งาน:</b> คีย์นี้ใช้งานได้ถาวรและไม่มีวันหมดอายุตามปกติ จนกว่าจะมีการเปลี่ยนหรือยกเลิก — ผู้ให้บริการอาจเปลี่ยนแปลงหรือเพิกถอนไลเซนส์ได้ทุกเมื่อตาม<a href="/legal/terms">ข้อกำหนดการใช้งาน</a></div></div>

    ${rawKey
      ? html`<div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>รหัสไลเซนส์เต็ม</h3><span class="badge badge--info">แสดงครั้งเดียว</span></div>
          <div class="card-body">
            <p class="muted" style="font-size:.78rem">รหัสนี้สุ่มจาก 240 บิต — ไม่สามารถเดาได้ คัดลอกเก็บไว้ในที่ปลอดภัย หน้านี้จะแสดงได้ครั้งเดียวภายใน 7 วันหลังสร้าง</p>
            <div class="token-box" style="margin-top:.8rem;word-break:break-all;display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;justify-content:space-between">
              <code>${rawKey}</code>
              <button class="btn btn-ghost btn-sm" type="button" data-copy="${rawKey}">${icon("copy")} คัดลอก</button>
            </div>
          </div>
        </div>`
      : html`<div class="alert alert--info" style="margin-top:1rem">${icon("lock")}<div>เพื่อความปลอดภัย ระบบแสดงรหัสเต็มได้ครั้งเดียวภายใน 7 วันหลังสร้าง — ใช้คำนำหน้าในการอ้างอิงกับทีมงาน</div></div>`}

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>เซิร์ฟเวอร์ที่เปิดใช้งาน</h3><span class="mono" style="font-size:.72rem">${activations.length} รายการ</span></div>
      <div class="card-body" style="padding:0">
        ${activations.length === 0
          ? html`<div style="padding:1rem">${emptyState("ยังไม่มีเซิร์ฟเวอร์ — ไปที่การเปิดใช้งานเพื่อเชื่อมเครื่องแรก", html`<a class="btn btn-primary btn-sm" href="/app/activations">เปิดใช้งาน</a>`)}</div>`
          : html`<div class="table-wrap" style="border:0"><table class="table">
              <thead><tr><th>เครื่อง</th><th>เวอร์ชัน</th><th>สถานะ</th><th>เห็นล่าสุด</th><th></th></tr></thead>
              <tbody>${activations.map((activation) => html`<tr>
                <td><a href="/app/servers/${activation.installation_id}"><b>${activation.display_name ?? activation.installation_id.slice(0, 10)}</b></a></td>
                <td class="muted">${activation.plugin_version ?? "—"}${activation.minecraft_version ? ` · MC ${activation.minecraft_version}` : ""}</td>
                <td>${badge(activation.status)}</td>
                <td class="muted">${activation.last_heartbeat_at ? timeAgo(activation.last_heartbeat_at) : "ยังไม่เคย"}</td>
                <td>
                  <form method="post" action="/app/licenses/${license.id}/reset" class="inline-form" data-confirm="ยืนยันการรีเซ็ตการเปิดใช้งานนี้? เครื่องจะต้องเชื่อมใหม่">
                    ${csrfInput(csrf)}
                    <input type="hidden" name="activation_id" value="${activation.id}">
                    <button class="btn btn-danger btn-sm" type="submit">รีเซ็ต</button>
                  </form>
                </td>
              </tr>`)}</tbody>
            </table></div>`}
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Servers                                                                    */
/* -------------------------------------------------------------------------- */

export function serversPage(servers: InstallationRow[]): SafeHtml {
  if (servers.length === 0) {
    return emptyState("ยังไม่มีเซิร์ฟเวอร์ที่เชื่อมต่อ", html`<a class="btn btn-primary btn-sm" href="/app/activations">เชื่อมเซิร์ฟเวอร์เครื่องแรก</a>`);
  }
  return html`<div class="table-wrap">
    <table class="table">
      <thead><tr><th>เซิร์ฟเวอร์</th><th>ผลิตภัณฑ์</th><th>สถานะ</th><th>เวอร์ชัน</th><th>Heartbeat</th><th></th></tr></thead>
      <tbody>${servers.map((server) => html`<tr>
        <td><a href="/app/servers/${server.id}"><b>${server.display_name ?? server.installation_uuid.slice(0, 8)}</b></a>
          <div class="mono" style="font-size:.72rem">${server.fingerprint_sha256.slice(0, 16)}…</div></td>
        <td>${server.product_name}</td>
        <td>${badge(server.status)}</td>
        <td class="muted">${server.plugin_version ?? "—"}${server.minecraft_version ? ` · ${server.minecraft_version}` : ""}</td>
        <td class="muted">${server.last_heartbeat_at ? timeAgo(server.last_heartbeat_at) : "ยังไม่เคย"}</td>
        <td><a class="btn btn-ghost btn-sm" href="/app/servers/${server.id}">เปิด</a></td>
      </tr>`)}</tbody>
    </table>
  </div>`;
}

export function serverDetailPage(
  detail: ServerDetail,
  tab: "overview" | "performance" | "events",
  license: LicenseRow | null,
): SafeHtml {
  const server = detail.installation;
  const heartbeat = detail.heartbeatData;
  const tabs = html`<div class="tabs">
    <a href="/app/servers/${server.id}" ${tab === "overview" ? raw('aria-current="page"') : raw("")}>ภาพรวม</a>
    <a href="/app/servers/${server.id}?tab=performance" ${tab === "performance" ? raw('aria-current="page"') : raw("")}>ประสิทธิภาพ</a>
    <a href="/app/servers/${server.id}?tab=events" ${tab === "events" ? raw('aria-current="page"') : raw("")}>เหตุการณ์</a>
  </div>`;

  const overview = html`
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>ข้อมูลเครื่อง</h3>${badge(server.status)}</div>
        <div class="card-body">
          ${detailList([
            { label: "ชื่อ", value: server.display_name ?? "—" },
            { label: "Installation ID", value: html`<code>${server.installation_uuid}</code>` },
            { label: "Fingerprint", value: html`<code style="font-size:.72rem">${server.fingerprint_sha256}</code>` },
            { label: "ผลิตภัณฑ์", value: server.product_name },
            { label: "ไลเซนส์", value: license ? html`<a href="/app/licenses/${license.id}"><code>${license.key_prefix}…</code></a>` : "—" },
            { label: "เชื่อมครั้งแรก", value: formatDate(server.first_seen_at) },
            { label: "Heartbeat ล่าสุด", value: server.last_heartbeat_at ? formatWhen(server.last_heartbeat_at) : "ยังไม่มี" },
          ])}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>ข้อมูลที่รายงาน</h3></div>
        <div class="card-body">
          ${heartbeat
            ? html`${detailList([
                { label: "ปลั๊กอิน", value: heartbeat.plugin_version ?? server.plugin_version ?? "—" },
                { label: "Minecraft", value: heartbeat.minecraft_version ?? server.minecraft_version ?? "—" },
                { label: "แพลตฟอร์ม", value: heartbeat.platform ?? server.platform ?? "—" },
                { label: "Java", value: heartbeat.java_version ?? server.java_version ?? "—" },
                { label: "ผู้เล่นออนไลน์", value: String(heartbeat.metrics?.players_online ?? "—") },
                { label: "TPS", value: heartbeat.metrics?.tps !== undefined ? String(heartbeat.metrics.tps) : "—" },
              ])}
              <div class="row" style="margin-top:.8rem">
                ${(heartbeat.enabled_modules ?? []).map((module) => html`<span class="badge">${module}</span>`)}
              </div>`
            : html`<p class="muted" style="font-size:.82rem">ยังไม่ได้รับ heartbeat จากเซิร์ฟเวอร์นี้ — ตรวจว่าเซิร์ฟเวอร์เชื่อมต่อ HTTPS ออกได้</p>`}
        </div>
      </div>
    </div>`;

  const performance = html`
    ${detail.rollups.length === 0
      ? emptyState("ยังไม่มีข้อมูลประสิทธิภาพ — จะแสดงหลังได้รับ heartbeat อย่างน้อยหนึ่งครั้ง")
      : html`<div class="stat-grid">
          ${stat("TPS ล่าสุด", detail.rollups[0]?.tps_avg?.toFixed(2) ?? "—", "ค่าเฉลี่ยในรอบ 5 นาที")}
          ${stat("MSPT p95", detail.rollups[0]?.mspt_p95?.toFixed(2) ?? "—", "มิลลิวินาที")}
          ${stat("ตัวอย่าง", detail.rollups.reduce((sum, row) => sum + row.samples, 0), "heartbeat ที่ประมวลผลแล้ว")}
          ${stat("ผิดพลาด", detail.rollups.reduce((sum, row) => sum + row.errors, 0), "รวมในข้อมูลที่มี")}
        </div>
        <div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>ประวัติ TPS</h3><span class="mono" style="font-size:.72rem">ล่าสุด ${Math.min(detail.rollups.length, 24)} รอบ</span></div>
          <div class="card-body">
            <div class="stack" style="gap:.45rem">
              ${detail.rollups.slice(0, 24).map((row) => html`<div class="row" style="gap:.6rem">
                <span class="mono" style="font-size:.72rem;width:9rem">${formatDateTime(row.bucket_start)}</span>
                <div class="meter" style="flex:1"><i style="width:${Math.max(0, Math.min(100, ((row.tps_avg ?? 0) / 20) * 100)).toFixed(1)}%"></i></div>
                <span class="mono" style="font-size:.72rem;width:3rem;text-align:right">${(row.tps_avg ?? 0).toFixed(1)}</span>
              </div>`)}
            </div>
          </div>
        </div>`}`;

  const events = html`
    <div class="card">
      <div class="card-head"><h3>เหตุการณ์ล่าสุด</h3><span class="mono" style="font-size:.72rem">${detail.events.length} รายการ</span></div>
      <div class="card-body" style="padding:0">
        ${detail.events.length === 0
          ? html`<div style="padding:1rem">${emptyState("ยังไม่มีเหตุการณ์ที่บันทึกไว้")}</div>`
          : html`<div class="table-wrap" style="border:0"><table class="table">
              <thead><tr><th>เวลา</th><th>ประเภท</th><th>ระดับ</th><th>ข้อความ</th></tr></thead>
              <tbody>${detail.events.map((event) => html`<tr>
                <td class="muted">${formatWhen(event.occurred_at)}</td>
                <td><code>${event.event_type}</code></td>
                <td>${badge(event.severity)}</td>
                <td class="muted">${eventMessage(event.payload)}</td>
              </tr>`)}</tbody>
            </table></div>`}
      </div>
    </div>`;

  return html`${tabs}${tab === "overview" ? overview : tab === "performance" ? performance : events}`;
}

/* -------------------------------------------------------------------------- */
/* Activations / billing / support / account                                  */
/* -------------------------------------------------------------------------- */

export function activationsPage(
  pending: InstallationRow[],
  licenses: LicenseRow[],
  csrf: string,
  turnstileSiteKey = "",
): SafeHtml {
  return html`
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>เชื่อมเซิร์ฟเวอร์ใหม่</h3></div>
        <div class="card-body">
          <p class="muted" style="font-size:.82rem;line-height:1.75">รัน <code>/aegishider license link</code> บนเซิร์ฟเวอร์ แล้วนำรหัส 16 ตัวที่ได้มากรอกด้านล่าง — ฟรี ไม่ต้องชำระเงิน</p>
          <form class="form" method="post" action="/app/activations" style="margin-top:1rem" data-lock>
            ${csrfInput(csrf)}
            <div class="field"><label for="code">รหัสเปิดใช้งาน</label>
              <input class="input" id="code" name="code" required minlength="8" maxlength="32" autocomplete="off" placeholder="A1B2C3D4E5F6G7H8" style="font-family:var(--mono);letter-spacing:.15em;text-transform:uppercase">
            </div>
            <div class="field"><label for="license_id">ใช้ไลเซนส์</label>
              <select class="select" id="license_id" name="license_id">
                <option value="">เลือกอัตโนมัติ (ไลเซนส์ที่มีที่ว่าง)</option>
                ${licenses.filter((license) => license.status === "active").map((license) => html`<option value="${license.id}">${license.product_name} · ${license.key_prefix}… (${license.active_activations}/${license.activation_limit})</option>`)}
              </select>
            </div>
            ${turnstileSiteKey ? turnstileWidget(turnstileSiteKey, "activate") : ""}
            <button class="btn btn-primary" type="submit">${icon("spark")} เปิดใช้งาน</button>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>รอเปิดใช้งาน</h3><span class="mono" style="font-size:.72rem">${pending.length} รายการ</span></div>
        <div class="card-body">
          ${pending.length === 0
            ? html`<p class="muted" style="font-size:.8rem">ไม่มีเซิร์ฟเวอร์ที่รอเปิดใช้งาน</p>`
            : html`<div class="stack" style="gap:.55rem">${pending.map((server) => html`<div class="card card-pad" style="box-shadow:none">
                <b style="font-size:.82rem">${server.display_name ?? server.installation_uuid.slice(0, 8)}</b>
                <p class="muted" style="font-size:.75rem;margin-top:.2rem">${server.product_name} · ${server.plugin_version ?? "ไม่ทราบเวอร์ชัน"}</p>
                <p class="mono" style="font-size:.72rem;margin-top:.3rem">${server.fingerprint_sha256.slice(0, 24)}…</p>
              </div>`)}</div>`}
        </div>
      </div>
    </div>`;
}

export function supportPage(
  tickets: TicketView[],
  products: Array<{ id: string; name: string }>,
  csrf: string,
): SafeHtml {
  return html`
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h3>ตั๋วของฉัน</h3><span class="mono" style="font-size:.72rem">${tickets.length} รายการ</span></div>
        <div class="card-body" style="padding:0">
          ${tickets.length === 0
            ? html`<div style="padding:1rem">${emptyState("ยังไม่มีตั๋วช่วยเหลือ")}</div>`
            : html`<div class="table-wrap" style="border:0"><table class="table">
                <thead><tr><th>หัวข้อ</th><th>สถานะ</th><th>อัปเดต</th></tr></thead>
                <tbody>${tickets.map((ticket) => html`<tr>
                  <td><a href="/app/support/${ticket.id}"><b>${ticket.subject}</b></a><div class="muted" style="font-size:.75rem">${ticket.product_name ?? "ทั่วไป"}</div></td>
                  <td>${badge(ticket.status)}</td>
                  <td class="muted">${timeAgo(ticket.updated_at)}</td>
                </tr>`)}</tbody>
              </table></div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>เปิดตั๋วใหม่</h3></div>
        <div class="card-body">
          <form class="form" method="post" action="/app/support" data-lock>
            ${csrfInput(csrf)}
            <div class="field"><label for="subject">หัวข้อ</label><input class="input" id="subject" name="subject" required minlength="3" maxlength="200"></div>
            <div class="field-row">
              <div class="field"><label for="product_id">ผลิตภัณฑ์</label>
                <select class="select" id="product_id" name="product_id">
                  <option value="">ทั่วไป</option>
                  ${products.map((product) => html`<option value="${product.id}">${product.name}</option>`)}
                </select>
              </div>
              <div class="field"><label for="priority">ความสำคัญ</label>
                <select class="select" id="priority" name="priority">
                  <option value="normal">ปกติ</option>
                  <option value="high">สูง</option>
                  <option value="urgent">เร่งด่วน</option>
                </select>
              </div>
            </div>
            <div class="field"><label for="message">รายละเอียด</label><textarea class="textarea" id="message" name="message" required minlength="5" maxlength="5000" placeholder="อธิบายสิ่งที่เกิดขึ้น พร้อมเวอร์ชันและข้อความผิดพลาด"></textarea></div>
            <button class="btn btn-primary" type="submit">${icon("terminal")} เปิดตั๋ว</button>
          </form>
        </div>
      </div>
    </div>`;
}

export function ticketPage(ticket: TicketView, messages: TicketMessageRow[], csrf: string): SafeHtml {
  return html`
    <div class="card">
      <div class="card-head"><div><h3>${ticket.subject}</h3><p class="muted" style="font-size:.74rem;margin-top:.2rem">${ticket.product_name ?? "ทั่วไป"} · เปิดเมื่อ ${formatDate(ticket.created_at)}</p></div>${badge(ticket.status)}</div>
      <div class="card-body">
        <div class="stack" style="gap:1rem">
          ${messages.map((message) => html`<div class="card card-pad" style="box-shadow:none;background:var(--surface-2)">
            <div class="spread"><b style="font-size:.8rem">${message.author_role === "staff" ? "ทีมงาน" : "คุณ"}</b><span class="mono" style="font-size:.72rem">${formatWhen(message.created_at)}</span></div>
            <p class="text-2" style="font-size:.84rem;line-height:1.75;margin-top:.4rem;white-space:pre-wrap">${message.body}</p>
          </div>`)}
        </div>
        ${ticket.status === "closed"
          ? html`<div class="alert alert--info" style="margin-top:1rem">${icon("lock")}<div>ตั๋วนี้ปิดแล้ว — เปิดตั๋วใหม่หากต้องการความช่วยเหลือเพิ่ม</div></div>`
          : html`<form class="form" method="post" action="/app/support/${ticket.id}" style="margin-top:1rem" data-lock>
              ${csrfInput(csrf)}
              <div class="field"><label for="message">ตอบกลับ</label><textarea class="textarea" id="message" name="message" required minlength="2" maxlength="5000"></textarea></div>
              <button class="btn btn-primary" type="submit">ส่งข้อความ</button>
            </form>`}
      </div>
    </div>`;
}

export function accountPage(user: SessionUser, hasPassword = false, csrf = ""): SafeHtml {
  return html`
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>บัญชี</h3></div>
        <div class="card-body">
          ${detailList([
            { label: "อีเมล", value: user.email },
            { label: "ชื่อที่แสดง", value: user.displayName ?? "—" },
            { label: "บทบาท", value: user.role },
            { label: "ภาษา", value: user.locale === "en" ? "English" : "ไทย" },
          ])}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>องค์กร</h3></div>
        <div class="card-body">
          ${user.memberships.length === 0
            ? html`<p class="muted" style="font-size:.82rem">ยังไม่มีองค์กร</p>`
            : html`<div class="stack" style="gap:.6rem">${user.memberships.map((membership) => html`<div class="card card-pad" style="box-shadow:none">
                <div class="spread"><b style="font-size:.85rem">${membership.orgName}</b><span class="badge">${membership.role}</span></div>
                <p class="mono" style="font-size:.72rem;margin-top:.25rem">${membership.orgSlug}</p>
              </div>`)}</div>`}
          <p class="muted" style="font-size:.72rem;margin-top:1rem">การจัดการสมาชิกในองค์กรยังไม่มีในเวอร์ชันนี้ — ติดต่อทีมงานหากต้องการเพิ่มผู้ใช้</p>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>${hasPassword ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่าน"}</h3>${hasPassword ? raw("") : html`<span class="badge badge--info">บัญชีเดิม</span>`}</div>
      <div class="card-body">
        <p class="muted" style="font-size:.78rem">${hasPassword ? "กรอกรหัสผ่านปัจจุบันและรหัสใหม่" : "บัญชีนี้ยังไม่มีรหัสผ่าน ตั้งรหัสเพื่อเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน"}</p>
        <form class="form" method="post" action="/app/account/password" data-lock style="margin-top:.8rem">
          ${csrfInput(csrf)}
          ${hasPassword ? html`<div class="field"><label for="current_password">รหัสผ่านปัจจุบัน</label><input class="input" id="current_password" name="current_password" type="password" required maxlength="200" autocomplete="current-password"></div>` : raw("")}
          <div class="field"><label for="new_password">รหัสผ่านใหม่</label><input class="input" id="new_password" name="new_password" type="password" required minlength="10" maxlength="200" autocomplete="new-password" placeholder="อย่างน้อย 10 ตัวอักษร มีตัวอักษรและตัวเลข"></div>
          <div class="field"><label for="confirm_password">ยืนยันรหัสผ่านใหม่</label><input class="input" id="confirm_password" name="confirm_password" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></div>
          ${passwordToggle()}
          <button class="btn btn-primary" type="submit">${icon("lock")} ${hasPassword ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่าน"}</button>
        </form>
      </div>
    </div>`;
}

export function securityPage(
  sessions: SessionListRow[],
  currentSessionId: string,
  securityEvents: Array<{ id: string; event_type: string; severity: string; details: string; created_at: number; ip_hash: string | null }>,
  csrf: string,
  recovery: {
    codes: string[] | null;
    remaining: number;
    hasPassword: boolean;
    totpEnabled: boolean;
    totpPending: { secret: string; uri: string } | null;
  },
): SafeHtml {
  return html`
    <div class="card">
      <div class="card-head"><div><h3>รหัสกู้คืนบัญชี</h3><p class="muted" style="font-size:.72rem;margin-top:.2rem">แพลตฟอร์มไม่ส่งอีเมล — รหัสนี้ใช้ตั้งรหัสผ่านใหม่เมื่อลืมรหัสผ่าน</p></div>
        <span class="badge">เหลือ ${recovery.remaining} ชุด</span>
      </div>
      <div class="card-body">
        ${recovery.codes && recovery.codes.length > 0
          ? html`<div class="alert alert--success" role="status">${icon("check")}<div>บันทึกรหัสก่อนออกจากหน้านี้ — ระบบจะแสดงรหัสจนกว่าคุณจะกดซ่อน หรือครบ 15 นาที</div></div>
              <pre class="mono" style="font-size:.85rem;line-height:1.9;letter-spacing:.08em;white-space:pre-wrap">${recovery.codes.join("\n")}</pre>
              <div class="row" style="margin-top:.8rem">
                <button class="btn btn-ghost btn-sm" type="button" data-copy="${recovery.codes.join("\n")}">${icon("copy")} คัดลอกทั้งหมด</button>
                <form method="post" action="/app/security/recovery-codes/ack" class="inline-form">
                  ${csrfInput(csrf)}<button class="btn btn-soft btn-sm" type="submit">${icon("check")} บันทึกครบแล้ว / ซ่อนรหัส</button>
                </form>
              </div>`
          : html`<p class="muted" style="font-size:.82rem;line-height:1.7">ใช้ได้ครั้งละหนึ่งรหัส · รหัสจะแสดงอีกครั้งเฉพาะเมื่อสร้างชุดใหม่</p>`}
        ${recovery.hasPassword
          ? html`<form method="post" action="/app/security/recovery-codes" class="form" style="margin-top:1rem;max-width:360px" data-confirm="สร้างรหัสชุดใหม่? รหัสเดิมที่ยังไม่ใช้จะถูกยกเลิก">
              ${csrfInput(csrf)}
              <div class="field"><label for="recovery-password">ยืนยันด้วยรหัสผ่านปัจจุบัน</label><input class="input" id="recovery-password" name="password" type="password" required maxlength="200" autocomplete="current-password"></div>
              ${passwordToggle()}
              <button class="btn btn-soft" type="submit">${icon("key")} สร้างชุดใหม่</button>
            </form>`
          : html`<div class="alert alert--info" style="margin-top:1rem">${icon("lock")}<div>ตั้งรหัสผ่านที่ <a href="/app/account">หน้าบัญชี</a> ก่อน เพื่อยืนยันตัวตนเมื่อสร้างรหัสกู้คืน</div></div>`}
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><div><h3>การยืนยันตัวตนสองขั้น (TOTP)</h3><p class="muted" style="font-size:.72rem;margin-top:.2rem">ใช้แอป Authenticator — ซอฟต์แวร์โอเพนซอร์ส ไม่ผูกกับอีเมล</p></div>
        ${recovery.totpEnabled
          ? html`<span class="badge badge--active">เปิดใช้งาน</span>`
          : html`<span class="badge">ปิด</span>`}
      </div>
      <div class="card-body">
        ${recovery.totpPending
          ? html`<p style="font-size:.82rem">เพิ่มบัญชีในแอป Authenticator ด้วยคีย์นี้ (หรือ URI ด้านล่าง) แล้วกรอกรหัส 6 หลักเพื่อยืนยัน</p>
              <pre class="mono" style="font-size:.85rem;white-space:pre-wrap">${recovery.totpPending.secret}</pre>
              <div class="row" style="margin-top:.5rem"><button class="btn btn-ghost btn-sm" type="button" data-copy="${recovery.totpPending.secret}">${icon("copy")} คัดลอกคีย์</button></div>
              <pre class="mono" style="font-size:.72rem;white-space:pre-wrap;word-break:break-all;text-transform:none">${recovery.totpPending.uri}</pre>
              <form method="post" action="/app/security/totp/enable" class="form" style="max-width:320px">
                ${csrfInput(csrf)}
                <div class="field"><label for="totp-enable">รหัส 6 หลัก</label><input class="input" id="totp-enable" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></div>
                <button class="btn btn-primary" type="submit">${icon("shield")} เปิดใช้งาน 2FA</button>
              </form>`
          : recovery.totpEnabled
            ? html`<form method="post" action="/app/security/totp/disable" class="form" style="max-width:320px" data-confirm="ปิด 2FA?">
                ${csrfInput(csrf)}
                <div class="field"><label for="totp-disable">ยืนยันด้วยรหัสผ่าน</label><input class="input" id="totp-disable" name="password" type="password" required maxlength="200" autocomplete="current-password"></div>
                ${passwordToggle()}
                <button class="btn btn-danger" type="submit">ปิด 2FA</button>
              </form>`
            : html`<form method="post" action="/app/security/totp/start" class="form" style="max-width:320px">
                ${csrfInput(csrf)}
                <div class="field"><label for="totp-start-password">ยืนยันด้วยรหัสผ่านปัจจุบัน</label><input class="input" id="totp-start-password" name="password" type="password" required maxlength="200" autocomplete="current-password"></div>
                ${passwordToggle()}
                <button class="btn btn-soft" type="submit">${icon("shield")} ตั้งค่า 2FA</button>
              </form>`}
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><div><h3>เซสชันที่ใช้งานอยู่</h3><p class="muted" style="font-size:.72rem;margin-top:.2rem">หากเห็นเซสชันที่ไม่รู้จัก ให้ออกจากเซสชันนั้นแล้วเปลี่ยนรหัสผ่านทันที</p></div>
        <form method="post" action="/app/security/revoke-others" data-confirm="ออกจากทุกเซสชันอื่น?">
          ${csrfInput(csrf)}<button class="btn btn-danger btn-sm" type="submit">ออกจากเซสชันอื่น</button>
        </form>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrap" style="border:0"><table class="table">
          <thead><tr><th>สร้าง</th><th>เห็นล่าสุด</th><th>อุปกรณ์</th><th>IP hash</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>${sessions.map((session) => html`<tr>
            <td class="muted">${formatDate(session.created_at)}</td>
            <td class="muted">${timeAgo(session.last_seen_at)}</td>
            <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${session.user_agent ?? "ไม่ทราบ"}</td>
            <td><code>${session.ip_hash?.slice(0, 12) ?? "—"}…</code></td>
            <td>${session.id === currentSessionId ? html`<span class="badge badge--active">เซสชันนี้</span>` : session.revoked_at ? badge("revoked", undefined) : badge("active", undefined)}</td>
            <td>${session.id === currentSessionId || session.revoked_at ? raw("") : html`<form method="post" action="/app/security/revoke-session" class="inline-form" data-confirm="ออกจากเซสชันนี้?">
              ${csrfInput(csrf)}<input type="hidden" name="session_id" value="${session.id}"><button class="btn btn-ghost btn-sm" type="submit">ออก</button>
            </form>`}</td>
          </tr>`)}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>ประวัติความปลอดภัย</h3></div>
      <div class="card-body" style="padding:0">
        ${securityEvents.length === 0
          ? html`<div style="padding:1rem">${emptyState("ยังไม่มีเหตุการณ์ความปลอดภัย")}</div>`
          : html`<div class="table-wrap" style="border:0"><table class="table">
              <thead><tr><th>เวลา</th><th>เหตุการณ์</th><th>ระดับ</th><th>IP hash</th></tr></thead>
              <tbody>${securityEvents.map((event) => html`<tr>
                <td class="muted">${formatWhen(event.created_at)}</td>
                <td><code>${event.event_type}</code></td>
                <td>${badge(event.severity)}</td>
                <td><code>${event.ip_hash?.slice(0, 12) ?? "—"}…</code></td>
              </tr>`)}</tbody>
            </table></div>`}
      </div>
    </div>`;
}

