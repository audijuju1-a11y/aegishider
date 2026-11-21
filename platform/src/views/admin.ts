import { SafeHtml, html, raw } from "../lib/html";
import { formatDate, formatDateTime, timeAgo, jsonArray } from "../lib/time";
import type {
  AdminAnalytics,
  AdminInstallationRow,
  AdminLicenseRow,
  AdminStats,
  CustomerRow,
} from "../services/admin";
import type { GuardSummary } from "../services/activation-guard";
import type { RollupRow } from "../services/telemetry";
import type { AlertStateRow } from "../services/observability";
import type { ProductRow, PlanRow, ReleaseRow } from "../services/catalog";
import type { TicketMessageRow, TicketView } from "../services/support";
import {
  badge,
  csrfInput,
  detailList,
  emptyState,
  formatWhen,
  icon,
  stat,
} from "./ui";

function table(headers: string[], rows: SafeHtml[], empty = "ยังไม่มีข้อมูล"): SafeHtml {
  if (rows.length === 0) return emptyState(empty);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr>${headers.map((header) => html`<th>${header}</th>`)}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function money(cents: number, currency = "THB"): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

function sparkBars(series: number[], labels: string[], color: string): SafeHtml {
  const width = 320;
  const height = 72;
  const pad = 4;
  const max = Math.max(1, ...series);
  const slot = (width - pad * 2) / Math.max(1, series.length);
  const barWidth = Math.max(2, slot - 3);
  return html`<svg viewBox="0 0 ${width} ${height}" role="img" style="width:100%;height:auto;display:block">
    ${series.map((value, index) => {
      const barHeight = Math.max(1, Math.round((value / max) * (height - 18)));
      const x = pad + index * slot;
      const y = height - 12 - barHeight;
      return html`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${color}" opacity="${value === 0 ? 0.18 : 0.9}"></rect>`;
    })}
    ${labels.map((label, index) => index % 3 === 0
      ? html`<text x="${pad + index * slot}" y="${height - 2}" font-size="7" fill="currentColor" opacity=".55">${label}</text>`
      : raw(""))}
  </svg>`;
}

function miniChart(title: string, series: number[], labels: string[], color: string, hint: string): SafeHtml {
  return html`<div>
    <div class="spread" style="align-items:baseline"><b style="font-size:.82rem">${title}</b><span class="mono" style="font-size:.55rem">${hint}</span></div>
    <div style="margin-top:.45rem;color:var(--text-2)">${sparkBars(series, labels, color)}</div>
  </div>`;
}

export function adminDashboardPage(
  stats: AdminStats,
  securityEvents: Array<{ id: string; event_type: string; severity: string; user_email: string | null; installation_name: string | null; created_at: number }>,
  auditEvents: Array<{ id: string; actor_email: string; action: string; target_type: string; created_at: number; reason: string | null }>,
  analytics: AdminAnalytics,
  guards: GuardSummary[],
): SafeHtml {
  const labels = analytics.days.map((day) => day.label);
  const activationsTotal = analytics.days.reduce((sum, day) => sum + day.activations, 0);
  const telemetryTotal = analytics.days.reduce((sum, day) => sum + day.telemetry, 0);
  return html`
    <div class="stat-grid">
      ${stat("ลูกค้า", stats.customers, `ไลเซนส์ฟรี ${stats.freeLicenses} ใบ`)}
      ${stat("ไลเซนส์ใช้งาน", stats.activeLicenses, `จากทั้งหมด ${stats.totalLicenses} ใบ`)}
      ${stat("เซิร์ฟเวอร์ออนไลน์", stats.activeInstallations, `จากทั้งหมด ${stats.totalInstallations} เครื่อง`)}
      ${stat("ตรวจพบ 24 ชม.", stats.detections24h, `critical ${stats.criticalEvents24h} รายการ`)}
      ${stat("IP ถูกล็อก", stats.lockedIps, `รหัสผิด 24 ชม. ${stats.failedActivations24h} ครั้ง`)}
      ${stat("ตั๋วที่เปิดอยู่", stats.openTickets, "open + pending")}
      ${stat("Telemetry ค้าง", stats.pendingTelemetry, stats.lastTelemetryAt ? `ประมวลผลล่าสุด ${timeAgo(stats.lastTelemetryAt)}` : "ยังไม่มีข้อมูล")}
      ${stat("Alert ที่ทำงาน", stats.alertsFiring, "ตรวจทุก 5 นาที · จาก /admin/security")}
      ${stat("5xx (5 นาที)", `${(stats.http5xxRate5m * 100).toFixed(2)}%`, `จาก ${stats.httpRequests5m} คำขอ · เกณฑ์ 1%`)}
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>ข้อมูลเชิงลึก 14 วัน</h3><span class="mono" style="font-size:.55rem">activations ${activationsTotal} · events ${telemetryTotal}</span></div>
      <div class="card-body grid-2">
        ${miniChart("การเปิดใช้งานไลเซนส์", analytics.days.map((day) => day.activations), labels, "var(--accent)", `รวม ${activationsTotal}`)}
        ${miniChart("Telemetry ที่รับเข้า", analytics.days.map((day) => day.telemetry), labels, "#38bdf8", `รวม ${telemetryTotal}`)}
        ${miniChart("การแจ้งเตือนความปลอดภัย", analytics.days.map((day) => day.security), labels, "#f59e0b", `critical ${analytics.days.reduce((sum, day) => sum + day.critical, 0)}`)}
        ${miniChart("ผู้ใช้ใหม่", analytics.days.map((day) => day.users), labels, "#a78bfa", `รวม ${analytics.days.reduce((sum, day) => sum + day.users, 0)}`)}
      </div>
    </div>

    <div class="grid-2" style="margin-top:1rem">
      <div class="card">
        <div class="card-head"><h3>การตรวจพบตามประเภท</h3><a class="btn btn-ghost btn-sm" href="/admin/security">ศูนย์ความปลอดภัย</a></div>
        <div class="card-body" style="padding:0">
          ${table(["เหตุการณ์", "ระดับ", "จำนวน"], analytics.detectionsByType.map((row) => html`<tr>
            <td><code>${row.event_type}</code></td>
            <td>${badge(row.severity)}</td>
            <td class="num">${row.count}</td>
          </tr>`), "ยังไม่มีการตรวจพบใน 14 วัน")}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>เซิร์ฟเวอร์ที่ส่งข้อมูลมากสุด</h3><a class="btn btn-ghost btn-sm" href="/admin/servers">ทั้งหมด</a></div>
        <div class="card-body" style="padding:0">
          ${table(["เซิร์ฟเวอร์", "events"], analytics.topServers.map((row) => html`<tr>
            <td>${row.name}</td>
            <td class="num">${row.events}</td>
          </tr>`), "ยังไม่มีข้อมูล Telemetry")}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>IP ที่กำลังถูกล็อก / พยายามรหัสผิด</h3><a class="btn btn-ghost btn-sm" href="/admin/security">จัดการ</a></div>
      <div class="card-body" style="padding:0">
        ${table(["IP hash", "ผิดสะสม", "ล็อกถึง", "ปลั๊กอิน", "ชื่อเซิร์ฟเวอร์ที่เห็น"], guards.slice(0, 8).map((guard) => html`<tr>
          <td><code>${guard.ip_hash.slice(0, 16)}…</code></td>
          <td class="num">${guard.failures}</td>
          <td class="muted">${guard.locked_until && guard.locked_until > Date.now() ? formatWhen(guard.locked_until) : "—"}</td>
          <td class="muted">${guard.plugin_slugs.join(", ") || "—"}</td>
          <td class="muted">${guard.server_names.join(", ") || "—"}</td>
        </tr>`), "ยังไม่มีการพยายามรหัสผิด")}
      </div>
    </div>

    <div class="grid-2" style="margin-top:1rem">
      <div class="card">
        <div class="card-head"><h3>เหตุการณ์ความปลอดภัยล่าสุด</h3><a class="btn btn-ghost btn-sm" href="/admin/security">ทั้งหมด</a></div>
        <div class="card-body" style="padding:0">
          ${table(["เวลา", "เหตุการณ์", "ระดับ"], securityEvents.slice(0, 8).map((event) => html`<tr>
            <td class="muted">${timeAgo(event.created_at)}</td>
            <td><code>${event.event_type}</code><div class="muted" style="font-size:.68rem">${event.user_email ?? event.installation_name ?? "—"}</div></td>
            <td>${badge(event.severity)}</td>
          </tr>`), "ยังไม่มีเหตุการณ์")}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>การกระทำของผู้ดูแลล่าสุด</h3><a class="btn btn-ghost btn-sm" href="/admin/audit">ทั้งหมด</a></div>
        <div class="card-body" style="padding:0">
          ${table(["เวลา", "ผู้กระทำ", "การกระทำ"], auditEvents.slice(0, 8).map((event) => html`<tr>
            <td class="muted">${timeAgo(event.created_at)}</td>
            <td class="muted">${event.actor_email}</td>
            <td><code>${event.action}</code><div class="muted" style="font-size:.68rem">${event.target_type}${event.reason ? ` · ${event.reason}` : ""}</div></td>
          </tr>`), "ยังไม่มีการกระทำ")}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>ทางลัด</h3></div>
      <div class="card-body row">
        <a class="btn btn-primary btn-sm" href="/admin/licenses/new">${icon("key")} ออกไลเซนส์</a>
        <a class="btn btn-soft btn-sm" href="/admin/products/new">${icon("plus")} เพิ่มผลิตภัณฑ์</a>
        <a class="btn btn-soft btn-sm" href="/admin/releases">${icon("package")} จัดการรีลีส</a>
        <a class="btn btn-soft btn-sm" href="/admin/security">${icon("shield")} ศูนย์ความปลอดภัย</a>
        <a class="btn btn-soft btn-sm" href="/admin/settings">${icon("settings")} ตั้งค่า</a>
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

export function adminCustomersPage(rows: CustomerRow[], q: string): SafeHtml {
  return html`
    <form class="search-bar" method="get" action="/admin/customers">
      <input class="input" type="search" name="q" value="${q}" placeholder="ค้นหาอีเมลหรือชื่อ…">
      <button class="btn btn-soft" type="submit">${icon("search")} ค้นหา</button>
    </form>
    ${table(
      ["ลูกค้า", "องค์กร", "ไลเซนส์", "เซิร์ฟเวอร์", "สถานะ", "สมัครเมื่อ"],
      rows.map((row) => html`<tr>
        <td><a href="/admin/customers/${row.id}"><b>${row.display_name ?? row.email}</b></a><div class="muted" style="font-size:.7rem">${row.email}</div></td>
        <td class="muted">${row.org_names ?? "—"}</td>
        <td class="num">${row.license_count}</td>
        <td class="num">${row.server_count}</td>
        <td>${badge(row.status)} ${row.role !== "customer" ? html`<span class="badge">${row.role}</span>` : raw("")}</td>
        <td class="muted">${formatDate(row.created_at)}</td>
      </tr>`),
      "ยังไม่มีลูกค้า",
    )}`;
}

export function adminCustomerDetailPage(
  data: {
    user: { id: string; email: string; display_name: string | null; role: string; status: string; created_at: number; last_login_at: number | null };
    orgs: Array<{ id: string; name: string; role: string; created_at: number }>;
    sessions: number;
    licenses: number;
    installations: number;
  },
  licenses: AdminLicenseRow[],
  servers: AdminInstallationRow[],
  csrf: string,
): SafeHtml {
  return html`
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h3>ข้อมูลลูกค้า</h3>${badge(data.user.status)}</div>
        <div class="card-body">
          ${detailList([
            { label: "อีเมล", value: data.user.email },
            { label: "ชื่อ", value: data.user.display_name ?? "—" },
            { label: "บทบาท", value: data.user.role },
            { label: "สมัครเมื่อ", value: formatDate(data.user.created_at) },
            { label: "เข้าสู่ระบบล่าสุด", value: data.user.last_login_at ? formatWhen(data.user.last_login_at) : "ไม่เคย" },
            { label: "เซสชันที่ใช้งาน", value: String(data.sessions) },
          ])}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>องค์กร</h3></div>
        <div class="card-body">
          ${data.orgs.length === 0
            ? html`<p class="muted" style="font-size:.82rem">ไม่มีองค์กร</p>`
            : html`<div class="stack" style="gap:.5rem">${data.orgs.map((org) => html`<div class="spread card card-pad" style="box-shadow:none">
                <div><b style="font-size:.85rem">${org.name}</b><div class="mono" style="font-size:.5rem">${org.id}</div></div>
                <span class="badge">${org.role}</span>
              </div>`)}</div>`}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>การจัดการบัญชี</h3></div>
      <div class="card-body">
        <div class="row">
          <form method="post" action="/admin/customers/${data.user.id}/status" class="row" data-confirm="ยืนยันการเปลี่ยนสถานะบัญชี?">
            ${csrfInput(csrf)}
            <select class="select" name="status" style="width:auto">
              <option value="active" ${data.user.status === "active" ? raw("selected") : raw("")}>ใช้งาน</option>
              <option value="suspended" ${data.user.status === "suspended" ? raw("selected") : raw("")}>ระงับ</option>
              <option value="deleted" ${data.user.status === "deleted" ? raw("selected") : raw("")}>ลบ (soft delete)</option>
            </select>
            <input class="input" name="reason" placeholder="เหตุผล (บันทึกใน audit)" style="width:220px" required>
            <button class="btn btn-soft btn-sm" type="submit">บันทึกสถานะ</button>
          </form>
          <form method="post" action="/admin/customers/${data.user.id}/role" class="row" data-confirm="ยืนยันการเปลี่ยนบทบาท?">
            ${csrfInput(csrf)}
            <select class="select" name="role" style="width:auto">
              ${["customer", "support", "product_manager", "security_analyst", "read_only_admin", "admin", "super_admin"].map((role) => html`<option value="${role}" ${data.user.role === role ? raw("selected") : raw("")}>${role}</option>`)}
            </select>
            <button class="btn btn-soft btn-sm" type="submit">เปลี่ยนบทบาท</button>
          </form>
        </div>
      </div>
    </div>

    <div style="margin-top:1rem">
      <h3 style="font-size:1rem;margin-bottom:.6rem">ไลเซนส์ (${licenses.length})</h3>
      ${table(["ผลิตภัณฑ์", "คำนำหน้า", "สถานะ", "เซิร์ฟเวอร์"], licenses.map((license) => html`<tr>
        <td><a href="/admin/licenses/${license.id}">${license.product_name}</a></td>
        <td><code>${license.key_prefix}…</code></td>
        <td>${badge(license.status)}</td>
        <td class="num">${license.active_activations}/${license.activation_limit}</td>
      </tr>`), "ยังไม่มีไลเซนส์")}
    </div>

    <div style="margin-top:1rem">
      <h3 style="font-size:1rem;margin-bottom:.6rem">เซิร์ฟเวอร์ (${servers.length})</h3>
      ${table(["เซิร์ฟเวอร์", "สถานะ", "Heartbeat"], servers.map((server) => html`<tr>
        <td><a href="/admin/servers/${server.id}">${server.display_name ?? server.installation_uuid.slice(0, 8)}</a></td>
        <td>${badge(server.status)}</td>
        <td class="muted">${server.last_heartbeat_at ? timeAgo(server.last_heartbeat_at) : "ไม่เคย"}</td>
      </tr>`), "ยังไม่มีเซิร์ฟเวอร์")}
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Licenses                                                                   */
/* -------------------------------------------------------------------------- */

export function adminLicensesPage(rows: AdminLicenseRow[], q: string, status: string): SafeHtml {
  return html`
    <form class="search-bar" method="get" action="/admin/licenses">
      <input class="input" type="search" name="q" value="${q}" placeholder="ค้นหา prefix / อีเมล / ผลิตภัณฑ์…">
      <select class="select" name="status" style="width:auto">
        <option value="">ทุกสถานะ</option>
        ${["active", "pending", "suspended", "expired", "revoked"].map((value) => html`<option value="${value}" ${status === value ? raw("selected") : raw("")}>${value}</option>`)}
      </select>
      <button class="btn btn-soft" type="submit">${icon("search")} กรอง</button>
      <a class="btn btn-primary" href="/admin/licenses/new">${icon("plus")} ออกไลเซนส์</a>
    </form>
    ${table(
      ["ผลิตภัณฑ์", "ลูกค้า", "คำนำหน้า", "สถานะ", "เซิร์ฟเวอร์", "หมดอายุ", ""],
      rows.map((row) => html`<tr>
        <td><a href="/admin/licenses/${row.id}"><b>${row.product_name}</b></a><div class="muted" style="font-size:.68rem">${row.plan_name ?? "—"}</div></td>
        <td class="muted">${row.customer_email}<div style="font-size:.68rem">${row.org_name}</div></td>
        <td><code>${row.key_prefix}…</code></td>
        <td>${badge(row.status)}</td>
        <td class="num">${row.active_activations}/${row.activation_limit}</td>
        <td class="muted">${row.expires_at ? formatDate(row.expires_at) : "ถาวร"}</td>
        <td><a class="btn btn-ghost btn-sm" href="/admin/licenses/${row.id}">เปิด</a></td>
      </tr>`),
      "ยังไม่มีไลเซนส์",
    )}`;
}

export function adminIssueLicensePage(
  products: ProductRow[],
  plans: Array<{ id: string; code: string; name: string; product_id: string; product_name: string; price_cents: number; currency: string; activation_limit: number }>,
  csrf: string,
): SafeHtml {
  return html`<div class="card" style="max-width:760px">
    <div class="card-head"><h3>ออกไลเซนส์ใหม่</h3></div>
    <div class="card-body">
      <form class="form" method="post" action="/admin/licenses" data-lock>
        ${csrfInput(csrf)}
        <div class="field"><label for="email">อีเมลลูกค้า (ต้องมีบัญชีอยู่แล้ว)</label><input class="input" id="email" name="email" type="email" required></div>
        <div class="field"><label for="product_id">ผลิตภัณฑ์</label>
          <select class="select" id="product_id" name="product_id" required>
            ${products.map((product) => html`<option value="${product.id}">${product.name} (${product.slug})</option>`)}
          </select>
        </div>
        <div class="field"><label for="plan_id">แพ็กเกจ (ถ้ามี)</label>
          <select class="select" id="plan_id" name="plan_id">
            <option value="">— ไม่ระบุแพ็กเกจ —</option>
            ${plans.map((plan) => html`<option value="${plan.id}">${plan.product_name} · ${plan.name} · ${money(plan.price_cents, plan.currency)}</option>`)}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label for="activation_limit">จำนวนเซิร์ฟเวอร์</label><input class="input" id="activation_limit" name="activation_limit" type="number" min="1" max="1000" value="1" required></div>
          <div class="field"><label for="expires_at">วันหมดอายุ (เว้นว่าง = ถาวร)</label><input class="input" id="expires_at" name="expires_at" type="date"></div>
        </div>
        <button class="btn btn-primary" type="submit">${icon("key")} ออกไลเซนส์</button>
        <p class="muted" style="font-size:.7rem">license key แบบเต็มจะแสดงครั้งเดียวหลังสร้าง — เก็บไว้อย่างปลอดภัย</p>
      </form>
    </div>
  </div>`;
}

export function adminLicenseDetailPage(
  license: AdminLicenseRow,
  activations: Array<{ id: string; installation_id: string; display_name: string | null; status: string; activated_at: number; last_seen_at: number | null }>,
  csrf: string,
  rawKey: string | null,
): SafeHtml {
  const status = license.status as "active" | "suspended" | "revoked" | "expired";
  return html`
    ${rawKey
      ? html`<div class="alert alert--success" style="margin-bottom:1rem">${icon("key")}<div>
          <b>license key ใหม่ (แสดงครั้งเดียว):</b>
          <div class="copy-row" style="margin-top:.4rem"><code>${rawKey}</code><button class="btn btn-ghost btn-sm" type="button" data-copy="${rawKey}">คัดลอก</button></div>
        </div></div>`
      : raw("")}

    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h3>ไลเซนส์</h3>${badge(license.status)}</div>
        <div class="card-body">
          ${detailList([
            { label: "ผลิตภัณฑ์", value: license.product_name },
            { label: "แพ็กเกจ", value: license.plan_name ?? "—" },
            { label: "ลูกค้า", value: license.customer_email },
            { label: "องค์กร", value: license.org_name },
            { label: "คำนำหน้า", value: html`<code>${license.key_prefix}…</code>` },
            { label: "จำนวนเซิร์ฟเวอร์", value: `${license.active_activations} / ${license.activation_limit}` },
            { label: "ออกเมื่อ", value: formatDate(license.created_at) },
            { label: "หมดอายุ", value: license.expires_at ? formatDate(license.expires_at) : "ถาวร" },
          ])}
          <div class="row" style="margin-top:.8rem">${jsonArray<string>(license.entitlements).map((entitlement) => html`<span class="badge">${entitlement}</span>`)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>การจัดการ</h3></div>
        <div class="card-body">
          <div class="stack" style="gap:.8rem">
            <form method="post" action="/admin/licenses/${license.id}/status" class="row" data-confirm="ยืนยันการเปลี่ยนสถานะไลเซนส์?">
              ${csrfInput(csrf)}
              <select class="select" name="status" style="width:auto">
                <option value="active" ${status === "active" ? raw("selected") : raw("")}>ใช้งาน</option>
                <option value="suspended" ${status === "suspended" ? raw("selected") : raw("")}>ระงับ</option>
                <option value="revoked" ${status === "revoked" ? raw("selected") : raw("")}>เพิกถอน</option>
              </select>
              <input class="input" name="reason" placeholder="เหตุผล" required style="width:200px">
              <button class="btn btn-soft btn-sm" type="submit">บันทึก</button>
            </form>
            <form method="post" action="/admin/licenses/${license.id}/extend" class="row">
              ${csrfInput(csrf)}
              <input class="input" type="date" name="expires_at" style="width:auto">
              <button class="btn btn-soft btn-sm" type="submit">ตั้งวันหมดอายุ</button>
            </form>
            <form method="post" action="/admin/licenses/${license.id}/limit" class="row">
              ${csrfInput(csrf)}
              <input class="input" type="number" name="activation_limit" min="1" max="1000" value="${license.activation_limit}" style="width:120px">
              <button class="btn btn-soft btn-sm" type="submit">ปรับจำนวนเซิร์ฟเวอร์</button>
            </form>
          </div>
        </div>
      </div>
    </div>

    <div style="margin-top:1rem">
      <h3 style="font-size:1rem;margin-bottom:.6rem">การเปิดใช้งาน</h3>
      ${table(["เครื่อง", "สถานะ", "เปิดเมื่อ", "เห็นล่าสุด", ""], activations.map((activation) => html`<tr>
        <td><a href="/admin/servers/${activation.installation_id}">${activation.display_name ?? activation.installation_id.slice(0, 8)}</a></td>
        <td>${badge(activation.status)}</td>
        <td class="muted">${formatDate(activation.activated_at)}</td>
        <td class="muted">${activation.last_seen_at ? timeAgo(activation.last_seen_at) : "—"}</td>
        <td>${activation.status === "active" ? html`<form method="post" action="/admin/licenses/${license.id}/reset" class="inline-form" data-confirm="รีเซ็ตการเปิดใช้งานนี้?">
          ${csrfInput(csrf)}<input type="hidden" name="activation_id" value="${activation.id}"><button class="btn btn-danger btn-sm" type="submit">รีเซ็ต</button>
        </form>` : raw("")}</td>
      </tr>`), "ยังไม่มีการเปิดใช้งาน")}
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Products / releases                                                        */
/* -------------------------------------------------------------------------- */

export function adminProductsPage(products: ProductRow[]): SafeHtml {
  return html`
    <div class="row" style="justify-content:flex-end;margin-bottom:.8rem">
      <a class="btn btn-primary btn-sm" href="/admin/products/new">${icon("plus")} เพิ่มผลิตภัณฑ์</a>
    </div>
    ${table(
      ["ผลิตภัณฑ์", "สถานะ", "ราคา", "หมวด", "อัปเดต", ""],
      products.map((product) => html`<tr>
        <td><b>${product.name}</b><div class="mono" style="font-size:.55rem">/plugins/${product.slug}</div></td>
        <td>${badge(product.status)}${product.featured ? html`<span class="badge badge--info">featured</span>` : raw("")}</td>
        <td class="num">${product.price_cents > 0 ? money(product.price_cents, product.currency) : "ติดต่อ"}</td>
        <td class="muted">${product.category}</td>
        <td class="muted">${formatDate(product.updated_at)}</td>
        <td><a class="btn btn-ghost btn-sm" href="/admin/products/${product.id}">แก้ไข</a></td>
      </tr>`),
      "ยังไม่มีผลิตภัณฑ์",
    )}`;
}

export function adminProductFormPage(
  product: ProductRow | null,
  plans: PlanRow[],
  csrf: string,
): SafeHtml {
  const value = (key: keyof ProductRow, fallback = "") =>
    product ? String(product[key] ?? "") : fallback;
  return html`
    <div class="card">
      <div class="card-head"><h3>${product ? "แก้ไขผลิตภัณฑ์" : "เพิ่มผลิตภัณฑ์"}</h3>${product ? badge(product.status) : raw("")}</div>
      <div class="card-body">
        <form class="form" method="post" action="${product ? `/admin/products/${product.id}` : "/admin/products"}" data-lock>
          ${csrfInput(csrf)}
          <div class="field-row">
            <div class="field"><label>ชื่อ</label><input class="input" name="name" required maxlength="120" value="${value("name")}"></div>
            <div class="field"><label>slug</label><input class="input" name="slug" required maxlength="60" pattern="[a-z0-9-]+" value="${value("slug")}"></div>
          </div>
          <div class="field"><label>คำโปรย (tagline)</label><input class="input" name="tagline" required maxlength="200" value="${value("tagline")}"></div>
          <div class="field"><label>คำอธิบาย</label><textarea class="textarea" name="description" required maxlength="8000" style="min-height:180px">${value("description")}</textarea></div>
          <div class="field-row">
            <div class="field"><label>หมวดหมู่</label><input class="input" name="category" maxlength="40" value="${value("category", "security")}"></div>
            <div class="field"><label>สถานะ</label>
              <select class="select" name="status">
                ${["draft", "published", "coming_soon", "archived"].map((status) => html`<option value="${status}" ${value("status") === status ? raw("selected") : raw("")}>${status}</option>`)}
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label>ราคา (สตางค์, 0 = ฟรี)</label><input class="input" name="price_cents" type="number" min="0" value="${value("price_cents", "0")}"></div>
            <div class="field"><label>สกุลเงิน</label><input class="input" name="currency" maxlength="3" value="${value("currency", "THB")}"></div>
          </div>
          <div class="field"><label>ความเข้ากันได้ (JSON)</label><textarea class="textarea" name="compatibility" style="min-height:90px">${value("compatibility", "{}")}</textarea></div>
          <div class="field"><label>ฟีเจอร์ (JSON array)</label><textarea class="textarea" name="features" style="min-height:110px">${value("features", "[]")}</textarea></div>
          <div class="field-row">
            <div class="field"><label>ลิงก์เอกสาร</label><input class="input" name="docs_url" value="${value("docs_url")}"></div>
            <div class="field"><label>ลิงก์ซื้อ</label><input class="input" name="purchase_url" value="${value("purchase_url")}"></div>
          </div>
          <label class="check"><input type="checkbox" name="featured" value="1" ${product?.featured ? raw("checked") : raw("")}> แสดงเป็นผลิตภัณฑ์แนะนำ</label>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${product ? "บันทึก" : "สร้างผลิตภัณฑ์"}</button>
            ${product ? html`<a class="btn btn-ghost" href="/plugins/${product.slug}" target="_blank" rel="noopener">ดูหน้าเว็บ</a>` : raw("")}
          </div>
        </form>
      </div>
    </div>

    ${product
      ? html`<div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>แพ็กเกจ</h3></div>
          <div class="card-body">
            ${plans.length === 0 ? html`<p class="muted" style="font-size:.82rem;margin-bottom:.8rem">ยังไม่มีแพ็กเกจ</p>` : html`<div class="table-wrap" style="margin-bottom:.8rem"><table class="table">
              <thead><tr><th>ชื่อ</th><th>Code</th><th>ราคา</th><th>เซิร์ฟเวอร์</th><th>รอบ</th></tr></thead>
              <tbody>${plans.map((plan) => html`<tr>
                <td>${plan.name}</td><td><code>${plan.code}</code></td>
                <td class="num">${money(plan.price_cents)}</td><td class="num">${plan.activation_limit}</td><td class="muted">${plan.billing_interval}</td>
              </tr>`)}</tbody>
            </table></div>`}
            <form class="form" method="post" action="/admin/products/${product.id}/plans" data-lock>
              ${csrfInput(csrf)}
              <div class="field-row">
                <div class="field"><label>ชื่อแพ็กเกจ</label><input class="input" name="name" required maxlength="80"></div>
                <div class="field"><label>Code</label><input class="input" name="code" required maxlength="40" pattern="[a-z0-9_-]+"></div>
              </div>
              <div class="field-row">
                <div class="field"><label>ราคา (สตางค์)</label><input class="input" name="price_cents" type="number" min="0" value="0"></div>
                <div class="field"><label>จำนวนเซิร์ฟเวอร์</label><input class="input" name="activation_limit" type="number" min="1" max="1000" value="1"></div>
                <div class="field"><label>รอบบิล</label><select class="select" name="billing_interval"><option value="one_time">ซื้อครั้งเดียว</option><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option></select></div>
              </div>
              <div class="field"><label>Entitlements (JSON array)</label><input class="input" name="entitlements" value='["aegishider:block-protection"]'></div>
              <button class="btn btn-soft" type="submit">${icon("plus")} เพิ่มแพ็กเกจ</button>
            </form>
          </div>
        </div>`
      : raw("")}`;
}

export function adminReleasesPage(
  releases: Array<ReleaseRow & { product_name: string }>,
  products: ProductRow[],
  csrf: string,
): SafeHtml {
  return html`
    <div class="grid-2" style="align-items:start">
      <div>
        <h3 style="font-size:1rem;margin-bottom:.6rem">รีลีสทั้งหมด</h3>
        ${table(["เวอร์ชัน", "ผลิตภัณฑ์", "ช่อง", "สถานะ", "เผยแพร่", "ไฟล์"], releases.map((release) => html`<tr>
          <td><code>${release.version}</code></td>
          <td>${release.product_name}</td>
          <td class="muted">${release.channel}</td>
          <td>${badge(release.status)}</td>
          <td class="muted">${formatDate(release.released_at)}</td>
          <td>
            <form method="post" action="/admin/releases/${release.id}/status" class="inline-form">
              ${csrfInput(csrf)}
              <input type="hidden" name="status" value="${release.status === "published" ? "draft" : "published"}">
              <button class="btn btn-soft btn-sm" type="submit">${release.status === "published" ? "ถอนเผยแพร่" : "เผยแพร่"}</button>
            </form>
            <form method="post" action="/admin/releases/${release.id}/file" enctype="multipart/form-data" class="inline-form">
              ${csrfInput(csrf)}
              <input class="input" type="file" name="artifact" accept=".jar,application/java-archive" required style="max-width:150px;font-size:.65rem;padding:.3rem">
              <button class="btn btn-soft btn-sm" type="submit">${icon("download")} อัปโหลด</button>
            </form>
          </td>
        </tr>`), "ยังไม่มีรีลีส")}
      </div>
      <div class="card">
        <div class="card-head"><h3>เพิ่มรีลีส</h3></div>
        <div class="card-body">
          <form class="form" method="post" action="/admin/releases" data-lock>
            ${csrfInput(csrf)}
            <div class="field"><label>ผลิตภัณฑ์</label><select class="select" name="product_id" required>
              ${products.map((product) => html`<option value="${product.id}">${product.name}</option>`)}
            </select></div>
            <div class="field-row">
              <div class="field"><label>เวอร์ชัน</label><input class="input" name="version" required maxlength="32" placeholder="3.3.0"></div>
              <div class="field"><label>ช่อง</label><select class="select" name="channel"><option value="stable">stable</option><option value="beta">beta</option><option value="preview">preview</option></select></div>
            </div>
            <div class="field"><label>สถานะ</label><select class="select" name="status"><option value="draft">draft (ยังไม่เผยแพร่)</option><option value="published">published</option></select></div>
            <div class="field"><label>หมายเหตุ (Markdown)</label><textarea class="textarea" name="notes" required maxlength="8000"></textarea></div>
            <div class="field-row">
              <div class="field"><label>Minecraft (คั่นด้วย ,)</label><input class="input" name="minecraft" placeholder="1.21.11"></div>
              <div class="field"><label>Java (คั่นด้วย ,)</label><input class="input" name="java" placeholder="21"></div>
            </div>
            <div class="field"><label>แพลตฟอร์ม (คั่นด้วย ,)</label><input class="input" name="platforms" placeholder="Paper"></div>
            <div class="field"><label>Artifact URL</label><input class="input" name="artifact_url" placeholder="/download/Aegishider-4.0.0-mc1.21.11.jar"></div>
            <div class="field"><label>SHA-256</label><input class="input" name="artifact_sha256" maxlength="64"></div>
            <button class="btn btn-primary" type="submit">${icon("package")} สร้างรีลีส</button>
          </form>
        </div>
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Servers / orders / support                                                 */
/* -------------------------------------------------------------------------- */

export function adminServersPage(rows: AdminInstallationRow[], q: string): SafeHtml {
  return html`
    <form class="search-bar" method="get" action="/admin/servers">
      <input class="input" type="search" name="q" value="${q}" placeholder="ค้นหาชื่อ / UUID / fingerprint…">
      <button class="btn btn-soft" type="submit">${icon("search")} ค้นหา</button>
    </form>
    ${table(
      ["เซิร์ฟเวอร์", "ลูกค้า", "ผลิตภัณฑ์", "สถานะ", "เวอร์ชัน", "Heartbeat"],
      rows.map((row) => html`<tr>
        <td><a href="/admin/servers/${row.id}"><b>${row.display_name ?? row.installation_uuid.slice(0, 8)}</b></a><div class="mono" style="font-size:.5rem">${row.fingerprint_sha256.slice(0, 16)}…</div></td>
        <td class="muted">${row.customer_email ?? "—"}<div style="font-size:.68rem">${row.org_name ?? ""}</div></td>
        <td class="muted">${row.product_name}</td>
        <td>${badge(row.status)}</td>
        <td class="muted">${row.plugin_version ?? "—"}</td>
        <td class="muted">${row.last_heartbeat_at ? timeAgo(row.last_heartbeat_at) : "ไม่เคย"}</td>
      </tr>`),
      "ไม่พบเซิร์ฟเวอร์",
    )}`;
}

type HealthRecord = Record<string, unknown>;
type HealthAlert = { level: "error" | "warning" | "info"; text: string };

function asRecord(value: unknown): HealthRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as HealthRecord)
    : null;
}

function numberField(record: HealthRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: HealthRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function boolField(record: HealthRecord | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function fmtNumber(value: number | null, digits = 1, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function fmtInteger(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${Math.round(value)}${suffix}`;
}

function fmtUptime(seconds: number | null): string {
  if (seconds === null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function parseHeartbeat(heartbeat: { payload: string } | null): HealthRecord | null {
  if (!heartbeat) return null;
  try {
    return asRecord(JSON.parse(heartbeat.payload));
  } catch {
    return null;
  }
}

function buildHealthAlerts(
  installation: AdminInstallationRow,
  heartbeat: { received_at: number } | null,
  server: HealthRecord | null,
  aegishider: HealthRecord | null,
): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  const now = Date.now();
  if (!heartbeat) {
    alerts.push({ level: "error", text: "ยังไม่มี heartbeat — ตรวจสอบว่า telemetry เปิดและ lease ยังใช้งานได้" });
  } else if (now - heartbeat.received_at > 10 * 60_000) {
    alerts.push({ level: "warning", text: `Heartbeat ล่าสุด ${timeAgo(heartbeat.received_at)} — อาจไม่ส่งหรือเซิร์ฟเวอร์ออฟไลน์` });
  }
  const tps = numberField(server, "tps_1m");
  if (tps !== null && tps < 10) alerts.push({ level: "error", text: `TPS 1 นาทีต่ำมาก: ${fmtNumber(tps, 2)}` });
  else if (tps !== null && tps < 15) alerts.push({ level: "warning", text: `TPS 1 นาทีต่ำ: ${fmtNumber(tps, 2)}` });
  const mspt = numberField(server, "mspt_avg");
  if (mspt !== null && mspt > 100) alerts.push({ level: "error", text: `MSPT สูงมาก: ${fmtNumber(mspt, 1, " ms")}` });
  else if (mspt !== null && mspt > 50) alerts.push({ level: "warning", text: `MSPT สูง: ${fmtNumber(mspt, 1, " ms")}` });
  const heapUsed = numberField(server, "heap_used_mb");
  const heapMax = numberField(server, "heap_max_mb");
  if (heapUsed !== null && heapMax !== null && heapMax > 0) {
    const ratio = heapUsed / heapMax;
    if (ratio > 0.95) alerts.push({ level: "error", text: `Heap ใกล้เต็ม: ${(ratio * 100).toFixed(0)}%` });
    else if (ratio > 0.9) alerts.push({ level: "warning", text: `Heap ใช้งานสูง: ${(ratio * 100).toFixed(0)}%` });
  }
  const cpu = numberField(server, "process_cpu_load");
  if (cpu !== null && cpu > 85) alerts.push({ level: "warning", text: `Process CPU สูง: ${fmtNumber(cpu, 0, "%")}` });
  const diskUsable = numberField(server, "disk_usable_mb");
  const diskTotal = numberField(server, "disk_total_mb");
  if (diskUsable !== null && diskTotal !== null && diskTotal > 0 && diskUsable / diskTotal < 0.1) {
    alerts.push({ level: "warning", text: `พื้นที่ดิสก์เหลือน้อย: ${(diskUsable / diskTotal * 100).toFixed(0)}%` });
  }
  const gateway = stringField(aegishider, "gateway_state");
  if (gateway && gateway !== "ACTIVE") alerts.push({ level: "error", text: `Packet gateway ไม่ทำงาน: ${gateway}` });
  const protection = stringField(aegishider, "protection");
  if (protection && protection !== "ACTIVE") alerts.push({ level: "warning", text: `Protection ไม่ได้ ACTIVE: ${protection}` });
  const licenseState = stringField(aegishider, "license_state");
  if (licenseState && !licenseState.startsWith("ACTIVE")) {
    alerts.push({ level: "warning", text: `สถานะไลเซนส์: ${licenseState}` });
  }
  if (installation.status !== "active") {
    alerts.push({ level: "warning", text: `installation status: ${installation.status}` });
  }
  return alerts;
}

export function adminServerDetailPage(
  installation: AdminInstallationRow,
  heartbeat: { received_at: number; payload: string } | null,
  events: Array<{ id: string; event_type: string; severity: string; occurred_at: number; payload: string }>,
  rollups: RollupRow[] = [],
): SafeHtml {
  const payload = parseHeartbeat(heartbeat);
  const server = asRecord(payload?.server);
  const aegishider = asRecord(payload?.aegishider);
  const alerts = buildHealthAlerts(installation, heartbeat, server, aegishider);
  const worlds = Array.isArray(server?.worlds)
    ? (server?.worlds as unknown[]).map(asRecord).filter((row): row is HealthRecord => row !== null)
    : [];
  const recent = [...rollups].reverse();
  const labels = recent.map((row) =>
    new Date(row.bucket_start).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }));
  const tps = numberField(server, "tps_1m");
  const mspt = numberField(server, "mspt_avg");
  const players = numberField(server, "players_online");
  const maxPlayers = numberField(server, "max_players");
  const ping = numberField(server, "avg_ping_ms");
  const uptime = numberField(server, "uptime_seconds");
  const heapUsed = numberField(server, "heap_used_mb");
  const heapMax = numberField(server, "heap_max_mb");
  const cpu = numberField(server, "process_cpu_load");
  const entities = numberField(server, "entity_count");
  const chunks = numberField(server, "chunk_count");
  const gatewayState = stringField(aegishider, "gateway_state");
  const protection = stringField(aegishider, "protection");

  return html`
    <div class="stat-grid">
      ${stat("TPS 1m", fmtNumber(tps, 2), "เป้าหมาย ≥ 19.5")}
      ${stat("MSPT เฉลี่ย", fmtNumber(mspt, 1, " ms"), "เป้าหมาย ≤ 50 ms")}
      ${stat("ผู้เล่น", players !== null ? `${Math.round(players)}${maxPlayers !== null ? ` / ${Math.round(maxPlayers)}` : ""}` : "—", "ออนไลน์ / สูงสุด")}
      ${stat("Ping เฉลี่ย", fmtNumber(ping, 0, " ms"), "ผู้เล่นออนไลน์")}
      ${stat("Uptime", fmtUptime(uptime), "JVM runtime")}
      ${stat("Heap", heapUsed !== null && heapMax !== null && heapMax > 0 ? `${heapUsed} / ${heapMax} MB` : fmtInteger(heapUsed, " MB"), "used / max")}
      ${stat("CPU process", fmtNumber(cpu, 0, "%"), "ของ process")}
      ${stat("Entities / Chunks", `${fmtInteger(entities)} / ${fmtInteger(chunks)}`, "โหลดอยู่")}
    </div>

    ${alerts.length
      ? html`<div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>การแจ้งเตือนสุขภาพ</h3><span class="mono" style="font-size:.55rem">${alerts.length} รายการ</span></div>
          <div class="card-body stack" style="gap:.45rem">
            ${alerts.map((alert) => html`<div class="alert ${alert.level === "error" ? "alert--error" : "alert--info"}" style="margin:0">${alert.text}</div>`)}
          </div>
        </div>`
      : html`<div class="card" style="margin-top:1rem"><div class="card-head"><h3>การแจ้งเตือนสุขภาพ</h3></div><div class="card-body"><p class="muted" style="font-size:.8rem">ไม่พบความผิดปกติจากข้อมูล heartbeat ล่าสุด</p></div></div>`}

    <div class="grid-2" style="margin-top:1rem;align-items:start">
      <div class="card">
        <div class="card-head"><h3>ข้อมูล installation</h3>${badge(installation.status)}</div>
        <div class="card-body">
          ${detailList([
            { label: "UUID", value: html`<code>${installation.installation_uuid}</code>` },
            { label: "Fingerprint", value: html`<code style="font-size:.62rem">${installation.fingerprint_sha256}</code>` },
            { label: "ผลิตภัณฑ์", value: installation.product_name },
            { label: "ลูกค้า", value: installation.customer_email ?? "—" },
            { label: "องค์กร", value: installation.org_name ?? "—" },
            { label: "ไลเซนส์", value: installation.license_prefix ? `${installation.license_prefix}… (${installation.license_status})` : "—" },
            { label: "เวอร์ชัน", value: `${installation.plugin_version ?? "—"} · ${installation.minecraft_version ?? "—"}` },
            { label: "Heartbeat", value: heartbeat ? `${timeAgo(heartbeat.received_at)} · ${formatWhen(heartbeat.received_at)}` : "ไม่เคย" },
          ])}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>ภาพรวมเซิร์ฟเวอร์</h3></div>
        <div class="card-body">
          ${server
            ? detailList([
                { label: "Server", value: stringField(server, "server_version") ?? "—" },
                { label: "Java / OS", value: `${stringField(server, "java_version") ?? "—"} · ${stringField(server, "os_name") ?? "—"}` },
                { label: "Java vendor", value: stringField(server, "java_vendor") ?? "—" },
                { label: "Plugins", value: `${fmtInteger(numberField(server, "plugin_count"))} · PacketEvents ${stringField(server, "packet_events_version") ?? "?"}` },
                { label: "Worlds", value: fmtInteger(numberField(server, "world_count")) },
                { label: "Gateway / Protection", value: `${gatewayState ?? "—"} · ${protection ?? "—"}` },
                { label: "License state", value: `${stringField(aegishider, "license_state") ?? "—"} · ${stringField(aegishider, "lease_source") ?? "—"}` },
              ])
            : html`<p class="muted" style="font-size:.8rem;line-height:1.7">Heartbeat นี้ยังไม่มีข้อมูล server health เชิงลึก — อัปเดตปลั๊กอินเป็น 4.0.3 ขึ้นไปเพื่อส่ง TPS/MSPT/CPU/Heap/Worlds/Entities และสถานะ protection</p>`}
        </div>
      </div>
    </div>

    ${server
      ? html`<div class="grid-2" style="margin-top:1rem;align-items:start">
          <div class="card">
            <div class="card-head"><h3>ทรัพยากรเซิร์ฟเวอร์</h3></div>
            <div class="card-body">
              ${detailList([
                { label: "Heap used / committed / max", value: `${fmtInteger(heapUsed, " MB")} / ${fmtInteger(numberField(server, "heap_committed_mb"), " MB")} / ${fmtInteger(heapMax, " MB")}` },
                { label: "Process / System CPU", value: `${fmtNumber(cpu, 1, "%")} / ${fmtNumber(numberField(server, "system_cpu_load"), 1, "%")}` },
                { label: "Load average / processors", value: `${fmtNumber(numberField(server, "system_load_average"), 2)} / ${fmtInteger(numberField(server, "available_processors"))}` },
                { label: "Threads live / daemon / peak", value: `${fmtInteger(numberField(server, "threads_live"))} / ${fmtInteger(numberField(server, "threads_daemon"))} / ${fmtInteger(numberField(server, "threads_peak"))}` },
                { label: "GC count / time", value: `${fmtInteger(numberField(server, "gc_count"))} · ${fmtInteger(numberField(server, "gc_time_ms"), " ms")}` },
                { label: "Disk usable / total", value: `${fmtInteger(numberField(server, "disk_usable_mb"), " MB")} / ${fmtInteger(numberField(server, "disk_total_mb"), " MB")}` },
                { label: "OS arch", value: stringField(server, "os_arch") ?? "—" },
              ])}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>Aegishider health</h3></div>
            <div class="card-body">
              ${detailList([
                { label: "Protection / gateway", value: `${protection ?? "—"} · ${gatewayState ?? "—"}` },
                { label: "Block / item protection", value: `${boolField(aegishider, "block_protection") === true ? "ACTIVE" : "INACTIVE"} / ${boolField(aegishider, "item_protection") === true ? "ACTIVE" : "INACTIVE"}` },
                { label: "Protected blocks / sensitive chunks", value: `${fmtInteger(numberField(aegishider, "protected_blocks"))} / ${fmtInteger(numberField(aegishider, "sensitive_chunks"))}` },
                { label: "Tracked entities / revealed pairs", value: `${fmtInteger(numberField(aegishider, "tracked_entities"))} / ${fmtInteger(numberField(aegishider, "revealed_pairs"))}` },
                { label: "Plugin tick p50 / p95 / p99", value: `${fmtInteger(numberField(aegishider, "plugin_tick_p50_us"), " µs")} / ${fmtInteger(numberField(aegishider, "plugin_tick_p95_us"), " µs")} / ${fmtInteger(numberField(aegishider, "plugin_tick_p99_us"), " µs")}` },
                { label: "Tick overruns / errors", value: `${fmtInteger(numberField(aegishider, "tick_overruns"))} / ${fmtInteger(numberField(aegishider, "internal_errors"))}` },
                { label: "Raycasts / deferred", value: `${fmtInteger(numberField(aegishider, "raycasts"))} / ${fmtInteger(numberField(aegishider, "ray_deferred"))}` },
                { label: "Async queue / capacity", value: `${fmtInteger(numberField(aegishider, "async_queue"))} / ${fmtInteger(numberField(aegishider, "async_queue_capacity"))}` },
                { label: "Sessions / config warnings", value: `${fmtInteger(numberField(aegishider, "online_sessions"))} / ${fmtInteger(numberField(aegishider, "config_warnings"))}` },
              ])}
            </div>
          </div>
        </div>` 
      : raw("")}

    ${worlds.length
      ? html`<div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>โลกที่โหลดอยู่</h3><span class="mono" style="font-size:.55rem">${worlds.length} worlds</span></div>
          <div class="card-body" style="padding:0">
            ${table(["โลก", "Environment", "ผู้เล่น", "Chunks", "Entities"], worlds.map((world) => html`<tr>
              <td><code>${stringField(world, "name") ?? "—"}</code></td>
              <td class="muted">${stringField(world, "environment") ?? "—"}</td>
              <td class="num">${fmtInteger(numberField(world, "players"))}</td>
              <td class="num">${fmtInteger(numberField(world, "chunks"))}</td>
              <td class="num">${fmtInteger(numberField(world, "entities"))}</td>
            </tr>`), "ไม่มีข้อมูลโลก")}
          </div>
        </div>`
      : raw("")}

    ${recent.length
      ? html`<div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>แนวโน้ม 5 นาที</h3><span class="mono" style="font-size:.55rem">${recent.length} buckets</span></div>
          <div class="card-body grid-2">
            ${miniChart("TPS เฉลี่ย", recent.map((row) => row.tps_avg ?? 0), labels, "var(--accent)", "จาก telemetry rollups")}
            ${miniChart("ผู้เล่นออนไลน์", recent.map((row) => row.players_online ?? 0), labels, "#38bdf8", "aggregate")}
            ${miniChart("Heap used (MB)", recent.map((row) => row.heap_used_mb ?? 0), labels, "#a78bfa", "process heap")}
            ${miniChart("Process CPU (%)", recent.map((row) => row.process_cpu_load ?? 0), labels, "#f59e0b", "0–100")}
          </div>
        </div>`
      : raw("")}

    <div class="grid-2" style="margin-top:1rem;align-items:start">
      <div class="card">
        <div class="card-head"><h3>Heartbeat ล่าสุด</h3></div>
        <div class="card-body">
          ${payload
            ? html`<details>
                <summary class="muted" style="cursor:pointer;font-size:.78rem">แสดง JSON ทั้งหมด</summary>
                <pre class="code-block" style="margin-top:.7rem">${JSON.stringify(payload, null, 2)}</pre>
              </details>`
            : html`<p class="muted" style="font-size:.82rem">ยังไม่มี heartbeat</p>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>เหตุการณ์ล่าสุด</h3></div>
        <div class="card-body" style="padding:0">
          ${table(["เวลา", "ประเภท", "ระดับ"], events.slice(0, 15).map((event) => html`<tr>
            <td class="muted">${formatWhen(event.occurred_at)}</td>
            <td><code>${event.event_type}</code></td>
            <td>${badge(event.severity)}</td>
          </tr>`), "ยังไม่มีเหตุการณ์")}
        </div>
      </div>
    </div>`;
}

export function adminSupportPage(tickets: TicketView[]): SafeHtml {
  return table(
    ["หัวข้อ", "ลูกค้า", "ผลิตภัณฑ์", "ความสำคัญ", "สถานะ", "อัปเดต"],
    tickets.map((ticket) => html`<tr>
      <td><a href="/admin/support/${ticket.id}"><b>${ticket.subject}</b></a></td>
      <td class="muted">${ticket.customer_email}</td>
      <td class="muted">${ticket.product_name ?? "ทั่วไป"}</td>
      <td>${badge(ticket.priority)}</td>
      <td>${badge(ticket.status)}</td>
      <td class="muted">${timeAgo(ticket.updated_at)}</td>
    </tr>`),
    "ไม่มีตั๋ว",
  );
}

export function adminTicketPage(
  ticket: TicketView,
  messages: TicketMessageRow[],
  csrf: string,
): SafeHtml {
  return html`
    <div class="card">
      <div class="card-head"><div><h3>${ticket.subject}</h3><p class="muted" style="font-size:.72rem;margin-top:.2rem">${ticket.customer_email} · ${ticket.product_name ?? "ทั่วไป"}</p></div>${badge(ticket.status)}</div>
      <div class="card-body">
        <div class="stack" style="gap:.8rem">
          ${messages.map((message) => html`<div class="card card-pad" style="box-shadow:none;background:var(--surface-2)">
            <div class="spread"><b style="font-size:.78rem">${message.author_role}${message.internal ? " · ภายใน" : ""}</b><span class="mono" style="font-size:.5rem">${formatWhen(message.created_at)}</span></div>
            <p class="text-2" style="font-size:.82rem;line-height:1.7;margin-top:.35rem;white-space:pre-wrap">${message.body}</p>
          </div>`)}
        </div>
        <form class="form" method="post" action="/admin/support/${ticket.id}" style="margin-top:1rem" data-lock>
          ${csrfInput(csrf)}
          <div class="field"><label>ตอบกลับ</label><textarea class="textarea" name="body" required maxlength="5000"></textarea></div>
          <div class="field-row">
            <label class="check"><input type="checkbox" name="internal" value="1"> บันทึกเป็นหมายเหตุภายใน</label>
            <select class="select" name="status">
              <option value="">— ไม่เปลี่ยนสถานะ —</option>
              ${["open", "pending", "resolved", "closed"].map((status) => html`<option value="${status}">${status}</option>`)}
            </select>
          </div>
          <button class="btn btn-primary" type="submit">ส่ง</button>
        </form>
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Security / audit / telemetry / settings                                    */
/* -------------------------------------------------------------------------- */

export function adminSecurityPage(
  events: Array<{ id: string; event_type: string; severity: string; installation_name: string | null; user_email: string | null; details: string; created_at: number; ip_hash: string | null }>,
  guards: GuardSummary[] = [],
  deadLetters: Array<{ id: string; queue: string; message_id: string; kind: string | null; event_id: string | null; installation_id: string | null; attempts: number; payload: string; failed_at: number }> = [],
  dlq: { open: number; last24h: number; oldestFailedAt: number | null } = { open: 0, last24h: 0, oldestFailedAt: null },
  csrf = "",
  alerts: AlertStateRow[] = [],
): SafeHtml {
  return html`
    <div class="card" style="margin-bottom:1rem">
      <div class="card-head">
        <h3>การแจ้งเตือนอัตโนมัติ</h3>
        <span class="mono" style="font-size:.55rem">ตรวจทุก 5 นาที · 5xx &gt; 1% · DLQ &gt; 0</span>
      </div>
      <div class="card-body" style="padding:0">
        ${table(
          ["สถานะ", "ตัวชี้วัด", "ค่า", "เกณฑ์", "ข้อความ", "อัปเดต"],
          alerts.map((alert) => html`<tr>
            <td>${alert.status === "firing" ? badge("critical") : badge("info")}</td>
            <td><code>${alert.key}</code></td>
            <td class="num">${alert.key === "http.5xx_rate" ? `${(alert.value * 100).toFixed(2)}%` : alert.value}</td>
            <td class="num">${alert.key === "http.5xx_rate" ? `${(alert.threshold * 100).toFixed(0)}%` : alert.threshold}</td>
            <td class="muted">${alert.message}</td>
            <td class="muted">${formatWhen(alert.updated_at)}</td>
          </tr>`),
          "ยังไม่มีการประเมิน — รอ cron รอบถัดไป (ทุก 5 นาที)",
        )}
      </div>
    </div>
    <div class="card" style="margin-bottom:1rem">
      <div class="card-head">
        <h3>Dead letter queue</h3>
        <span class="mono" style="font-size:.55rem">${dlq.open} ค้าง · ${dlq.last24h} ใน 24 ชม.${dlq.oldestFailedAt ? ` · เก่าสุด ${timeAgo(dlq.oldestFailedAt)}` : ""}</span>
      </div>
      <div class="card-body" style="padding:0">
        ${table(
          ["เวลา", "เหตุการณ์", "เซิร์ฟเวอร์", "ลอง", "payload", ""],
          deadLetters.map((row) => html`<tr>
            <td class="muted">${formatWhen(row.failed_at)}</td>
            <td><code>${row.event_id ?? row.message_id}</code><div class="muted" style="font-size:.68rem">${row.kind ?? row.queue}</div></td>
            <td class="muted"><code>${row.installation_id?.slice(0, 16) ?? "—"}</code></td>
            <td class="num">${row.attempts}</td>
            <td><details><summary class="muted" style="font-size:.7rem;cursor:pointer">ดู</summary><pre class="code-block" style="max-width:420px">${row.payload}</pre></details></td>
            <td><form method="post" action="/admin/security/dlq/${row.id}/resolve" class="inline-form" data-confirm="ทำเครื่องหมายว่าข้อความนี้จัดการแล้ว?">
              ${csrfInput(csrf)}<button class="btn btn-ghost btn-sm" type="submit">จัดการแล้ว</button>
            </form></td>
          </tr>`),
          "ไม่มีข้อความตกค้างใน DLQ",
        )}
      </div>
    </div>
    <div class="card" style="margin-bottom:1rem">
      <div class="card-head"><h3>การป้องกันการเดารหัสเปิดใช้งาน</h3><span class="mono" style="font-size:.55rem">ล็อก 5 นาทีเมื่อผิด 5 ครั้ง · 10 นาทีเมื่อผิด 10 ครั้ง · เพิ่มขึ้นเรื่อย ๆ</span></div>
      <div class="card-body" style="padding:0">
        ${table(
          ["IP hash", "ผิดสะสม", "level", "ล็อกถึง", "ปลั๊กอิน", "ชื่อเซิร์ฟเวอร์ที่เห็นจาก IP นี้"],
          guards.map((guard) => html`<tr>
            <td><code>${guard.ip_hash.slice(0, 16)}…</code></td>
            <td class="num">${guard.failures}</td>
            <td class="num">${guard.lock_level}</td>
            <td class="muted">${guard.locked_until && guard.locked_until > Date.now() ? formatWhen(guard.locked_until) : "—"}</td>
            <td class="muted">${guard.plugin_slugs.join(", ") || "—"}</td>
            <td class="muted">${guard.server_names.join(", ") || "—"}</td>
          </tr>`),
          "ยังไม่มีการพยายามรหัสผิด",
        )}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>เหตุการณ์ความปลอดภัย</h3></div>
      <div class="card-body" style="padding:0">
        ${table(
          ["เวลา", "เหตุการณ์", "ระดับ", "ที่มา", "IP hash"],
          events.map((event) => html`<tr>
            <td class="muted">${formatWhen(event.created_at)}</td>
            <td><code>${event.event_type}</code><div class="muted" style="font-size:.68rem">${event.details.slice(0, 120)}</div></td>
            <td>${badge(event.severity)}</td>
            <td class="muted">${event.user_email ?? event.installation_name ?? "—"}</td>
            <td><code>${event.ip_hash?.slice(0, 12) ?? "—"}</code></td>
          </tr>`),
          "ยังไม่มีเหตุการณ์ความปลอดภัย",
        )}
      </div>
    </div>`;
}

export function adminAuditPage(
  events: Array<{ id: string; actor_email: string; action: string; target_type: string; target_id: string | null; reason: string | null; created_at: number; before_summary: string | null; after_summary: string | null }>,
): SafeHtml {
  return table(
    ["เวลา", "ผู้กระทำ", "การกระทำ", "เป้าหมาย", "เหตุผล", "ก่อน/หลัง"],
    events.map((event) => html`<tr>
      <td class="muted">${formatWhen(event.created_at)}</td>
      <td class="muted">${event.actor_email}</td>
      <td><code>${event.action}</code></td>
      <td class="muted">${event.target_type}${event.target_id ? html`<div class="mono" style="font-size:.5rem">${event.target_id}</div>` : raw("")}</td>
      <td class="muted">${event.reason ?? "—"}</td>
      <td><details><summary class="muted" style="font-size:.7rem;cursor:pointer">ดู</summary><pre class="code-block" style="max-width:320px">${event.before_summary ?? "null"}\n→ ${event.after_summary ?? "null"}</pre></details></td>
    </tr>`),
    "ยังไม่มีบันทึกการตรวจสอบ",
  );
}

export function adminTelemetryPage(
  health: { lastProcessedAt: number; processedBatches: number; pendingEvents: number; latestHeartbeatAt: number | null },
  recent: Array<{ id: string; installation_name: string | null; event_type: string; severity: string; received_at: number; processed_at: number | null }>,
): SafeHtml {
  return html`
    <div class="stat-grid">
      ${stat("Batch ที่ประมวลผล", health.processedBatches, "นับจาก consumer")}
      ${stat("ประมวลผลล่าสุด", health.lastProcessedAt ? timeAgo(health.lastProcessedAt) : "ยังไม่มี", health.lastProcessedAt ? formatDateTime(health.lastProcessedAt) : "—")}
      ${stat("ค้างประมวลผล", health.pendingEvents, "events ที่ยังไม่ processed")}
      ${stat("Heartbeat ล่าสุด", health.latestHeartbeatAt ? timeAgo(health.latestHeartbeatAt) : "ยังไม่มี", "จากทุก installation")}
    </div>
    <div style="margin-top:1rem">
      <h3 style="font-size:1rem;margin-bottom:.6rem">Events ล่าสุด</h3>
      ${table(["เวลา", "เซิร์ฟเวอร์", "ประเภท", "ระดับ", "ประมวลผล"], recent.map((event) => html`<tr>
        <td class="muted">${timeAgo(event.received_at)}</td>
        <td class="muted">${event.installation_name ?? "—"}</td>
        <td><code>${event.event_type}</code></td>
        <td>${badge(event.severity)}</td>
        <td>${event.processed_at ? html`<span class="badge badge--active">แล้ว</span>` : html`<span class="badge badge--pending">รอ</span>`}</td>
      </tr>`), "ยังไม่มี event")}
    </div>`;
}

export function adminSettingsPage(
  settings: Record<string, string>,
  envInfo: Array<{ label: string; value: string }>,
  csrf: string,
): SafeHtml {
  return html`
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h3>ตั้งค่าแพลตฟอร์ม</h3></div>
        <div class="card-body">
          <form class="form" method="post" action="/admin/settings" data-lock>
            ${csrfInput(csrf)}
            <div class="field"><label>อีเมลสนับสนุน</label><input class="input" name="support_email" value="${settings["platform.support_email"] ?? ""}" maxlength="200"></div>
            <div class="field"><label>เปิดรับลงทะเบียน</label>
              <select class="select" name="registration_open">
                <option value="true" ${settings["platform.registration_open"] === "true" ? raw("selected") : raw("")}>เปิด</option>
                <option value="false" ${settings["platform.registration_open"] === "false" ? raw("selected") : raw("")}>ปิด</option>
              </select>
            </div>
            <div class="field"><label>Retention ของ telemetry (วัน)</label><input class="input" name="retention_days" type="number" min="1" max="3650" value="${settings["telemetry.retention_days"] ?? "90"}"></div>
            <button class="btn btn-primary" type="submit">บันทึก</button>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>ค่าจาก environment</h3></div>
        <div class="card-body">
          ${detailList(envInfo.map((item) => ({ label: item.label, value: item.value })))}
          <p class="muted" style="font-size:.7rem;margin-top:1rem">ค่าเหล่านี้มาจาก secrets/vars ของ Worker — แก้ไขผ่าน Wrangler หรือ Dashboard เท่านั้น</p>
        </div>
      </div>
    </div>`;
}
