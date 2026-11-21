import { SafeHtml, html } from "../lib/html";
import type { SiteContent } from "../lib/site-content";
import { csrfInput, icon } from "./ui";

export function adminContentPage(content: SiteContent, csrf: string): SafeHtml {
  const field = (name: keyof SiteContent, label: string, textarea = false, hint = "") => html`
    <div class="field">
      <label for="content-${name}">${label}</label>
      ${textarea
        ? html`<textarea class="textarea" id="content-${name}" name="${name}" rows="4">${content[name]}</textarea>`
        : html`<input class="input" id="content-${name}" name="${name}" value="${content[name]}">`}
      ${hint ? html`<small class="muted" style="font-size:.68rem">${hint}</small>` : html``}
    </div>`;
  return html`
    <form class="form" method="post" action="/admin/content">
      ${csrfInput(csrf)}
      <div class="grid-2" style="align-items:start">
        <div class="card card-pad">
          <p class="eyebrow">HOME HERO</p>
          <h3 style="font-size:1.05rem;margin-bottom:.8rem">ข้อความหน้าแรก</h3>
          ${field("announcement", "ประกาศด้านบน (เว้นว่าง = ซ่อน)")}
          ${field("heroEyebrow", "Eyebrow")}
          ${field("heroTitle", "หัวข้อบรรทัดแรก")}
          ${field("heroTitleAccent", "หัวข้อบรรทัดที่สอง (สีทอง)")}
          ${field("heroLead", "คำอธิบาย", true)}
          <div class="field-row">
            ${field("primaryCta", "ปุ่มหลัก")}
            ${field("secondaryCta", "ปุ่มรอง")}
          </div>
        </div>
        <div class="card card-pad">
          <p class="eyebrow">SUPPORT & PRICING</p>
          <h3 style="font-size:1.05rem;margin-bottom:.8rem">ข้อมูลติดต่อและราคา</h3>
          ${field("supportEmail", "อีเมลซัพพอร์ต")}
          ${field("pricingNote", "หมายเหตุใต้ราคา", true)}
          <div class="alert alert--info" style="margin-top:1rem">${icon("shield")}<div>ข้อความทั้งหมดถูก escape ก่อนแสดงผล — ไม่สามารถ inject HTML/สคริปต์ได้</div></div>
          <button class="btn btn-primary btn-block" type="submit">${icon("check")} บันทึกเนื้อหาเว็บ</button>
        </div>
      </div>
    </form>`;
}
