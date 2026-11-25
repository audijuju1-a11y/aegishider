import { SafeHtml, html, raw } from "../lib/html";
import { csrfInput, icon, passwordToggle } from "./ui";
import { turnstileWidget } from "./marketing";

export function loginPage(options: {
  csrf: string;
  next: string;
  siteKey: string;
  error?: string | null;
}): SafeHtml {
  return html`<div class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow" style="margin-bottom:.6rem">SIGN IN</p>
      <h1>เข้าสู่ระบบ</h1>
      <p class="lead">ใช้อีเมลและรหัสผ่านที่สมัครไว้ — ไม่ต้องยืนยันอีเมล ไม่มีระบบชำระเงิน</p>
      ${options.error ? html`<div class="alert alert--error" style="margin-top:1rem">${icon("warning")}<div>${options.error}</div></div>` : raw("")}
      <form class="form" method="post" action="/auth/login" data-lock>
        ${csrfInput(options.csrf)}
        <input type="hidden" name="next" value="${options.next}">
        <div class="field">
          <label for="email">อีเมล</label>
          <input class="input" id="email" name="email" type="email" required maxlength="200" autocomplete="email" autofocus placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="password">รหัสผ่าน</label>
          <input class="input" id="password" name="password" type="password" required minlength="10" maxlength="200" autocomplete="current-password" placeholder="รหัสผ่านของคุณ">
        </div>
        ${passwordToggle()}
        <details class="field-more">
          <summary>เปิดใช้ 2FA อยู่? กรอกรหัสที่นี่</summary>
          <div class="field" style="margin-top:.6rem">
            <label for="totp">รหัส 2FA 6 หลัก</label>
            <input class="input" id="totp" name="totp" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="123456">
          </div>
        </details>
        ${turnstileWidget(options.siteKey, "login")}
        <button class="btn btn-primary btn-block" type="submit">${icon("lock")} เข้าสู่ระบบ</button>
      </form>
      <div class="auth-footer">
        ยังไม่มีบัญชี? <a href="/auth/register?next=${encodeURIComponent(options.next)}">สมัครฟรี</a>
      </div>
      <div class="auth-footer" style="margin-top:.6rem">
        ลืมรหัสผ่าน? <a href="/auth/recover">ใช้รหัสกู้คืนบัญชี</a>
      </div>
      <div class="auth-footer" style="margin-top:.6rem">
        การเข้าใช้งานถือว่าคุณยอมรับ <a href="/legal/terms">ข้อกำหนดการใช้งาน</a> และ <a href="/legal/privacy">นโยบายความเป็นส่วนตัว</a>
      </div>
    </div>
  </div>`;
}

export function registerPage(options: {
  csrf: string;
  next: string;
  siteKey: string;
  error?: string | null;
}): SafeHtml {
  return html`<div class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow" style="margin-bottom:.6rem">CREATE ACCOUNT</p>
      <h1>สมัครบัญชีฟรี</h1>
      <p class="lead">สมัครด้วยอีเมลและรหัสผ่าน — ฟรี 100% ไม่มีระบบชำระเงิน และได้รับไลเซนส์อัตโนมัติ<br><span class="muted">ใช้รหัสผ่านอย่างน้อย 10 ตัวอักษร มีทั้งตัวอักษรและตัวเลข</span></p>
      ${options.error ? html`<div class="alert alert--error" style="margin-top:1rem">${icon("warning")}<div>${options.error}</div></div>` : raw("")}
      <form class="form" method="post" action="/auth/register" data-lock>
        ${csrfInput(options.csrf)}
        <input type="hidden" name="next" value="${options.next}">
        <div class="field">
          <label for="email">อีเมล</label>
          <input class="input" id="email" name="email" type="email" required maxlength="200" autocomplete="email" autofocus placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="password">รหัสผ่าน</label>
          <input class="input" id="password" name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password" placeholder="อย่างน้อย 10 ตัวอักษร มีตัวเลข">
        </div>
        <div class="field">
          <label for="password_confirm">ยืนยันรหัสผ่าน</label>
          <input class="input" id="password_confirm" name="password_confirm" type="password" required minlength="10" maxlength="200" autocomplete="new-password" placeholder="กรอกรหัสผ่านอีกครั้ง">
        </div>
        ${passwordToggle()}
        ${turnstileWidget(options.siteKey, "register")}
        <button class="btn btn-primary btn-block" type="submit">${icon("lock")} สมัครบัญชี</button>
      </form>
      <p class="muted" style="font-size:.75rem;margin-top:.8rem;line-height:1.7">
        หลังสมัคร ระบบจะแสดงรหัสกู้คืนบัญชี 10 ชุดในหน้าความปลอดภัย จนกว่าคุณจะกดซ่อน (ไม่เกิน 15 นาที) — เก็บไว้ใช้เมื่อลืมรหัสผ่าน เพราะแพลตฟอร์มไม่ส่งอีเมล
      </p>
      <p class="muted" style="font-size:.75rem;margin-top:.5rem;line-height:1.7">
        การสมัครถือว่าคุณยอมรับ <a href="/legal/terms">ข้อกำหนดการใช้งาน</a> และ <a href="/legal/privacy">นโยบายความเป็นส่วนตัว</a>
      </p>
      <div class="auth-footer">
        มีบัญชีแล้ว? <a href="/auth/login?next=${encodeURIComponent(options.next)}">เข้าสู่ระบบ</a>
      </div>
    </div>
  </div>`;
}

export function recoverPage(options: {
  csrf: string;
  siteKey: string;
  error?: string | null;
}): SafeHtml {
  return html`<div class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow" style="margin-bottom:.6rem">ACCOUNT RECOVERY</p>
      <h1>กู้คืนบัญชี</h1>
      <p class="lead">ใช้รหัสกู้คืนบัญชีที่บันทึกไว้ตอนสมัครหรือตั้งรหัสผ่าน — ระบบไม่ส่งลิงก์ทางอีเมล</p>
      ${options.error ? html`<div class="alert alert--error" style="margin-top:1rem">${icon("warning")}<div>${options.error}</div></div>` : raw("")}
      <form class="form" method="post" action="/auth/recover" data-lock>
        ${csrfInput(options.csrf)}
        <div class="field">
          <label for="email">อีเมล</label>
          <input class="input" id="email" name="email" type="email" required maxlength="200" autocomplete="email" autofocus placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="code">รหัสกู้คืน (รูปแบบ XXXX-XXXX-XXXX)</label>
          <input class="input" id="code" name="code" type="text" required maxlength="20" autocomplete="off" placeholder="ABCD-EFGH-JKLM" style="font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase">
        </div>
        <div class="field">
          <label for="password">รหัสผ่านใหม่</label>
          <input class="input" id="password" name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password" placeholder="อย่างน้อย 10 ตัวอักษร มีตัวอักษรและตัวเลข">
        </div>
        <div class="field">
          <label for="password_confirm">ยืนยันรหัสผ่านใหม่</label>
          <input class="input" id="password_confirm" name="password_confirm" type="password" required minlength="10" maxlength="200" autocomplete="new-password">
        </div>
        ${passwordToggle()}
        ${turnstileWidget(options.siteKey, "recover")}
        <button class="btn btn-primary btn-block" type="submit">${icon("key")} ตั้งรหัสผ่านใหม่</button>
      </form>
      <p class="muted" style="font-size:.75rem;margin-top:.8rem;line-height:1.7">
        การใช้รหัสกู้คืนจะออกจากระบบทุกเซสชันและปิด 2FA ของบัญชี จากนั้นระบบจะออกรหัสกู้คืนชุดใหม่ให้หลังเข้าสู่ระบบ
      </p>
      <div class="auth-footer">
        กลับไป <a href="/auth/login">เข้าสู่ระบบ</a>
      </div>
    </div>
  </div>`;
}

export function authMessagePage(options: {
  title: string;
  message: string;
  ctaHref?: string;
  ctaLabel?: string;
}): SafeHtml {
  return html`<div class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow" style="margin-bottom:.6rem">ACCOUNT</p>
      <h1>${options.title}</h1>
      <p class="lead">${options.message}</p>
      <div class="form" style="margin-top:1.4rem">
        <a class="btn btn-primary btn-block" href="${options.ctaHref ?? "/auth/login"}">${options.ctaLabel ?? "กลับไปหน้าเข้าสู่ระบบ"}</a>
      </div>
    </div>
  </div>`;
}
