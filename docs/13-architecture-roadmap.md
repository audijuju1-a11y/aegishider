# แผนปิดช่องว่างเชิงสถาปัตยกรรม (A-01 … A-15)

เอกสารนี้แปลงผลตรวจใน [`12-security-audit-2026-11.md`](12-security-audit-2026-11.md) หัวข้อ 7
เป็นลำดับงานที่ลงมือได้จริง พร้อมเกณฑ์ยอมรับ (acceptance) และคำสั่งตรวจสอบ
ทุกงานอ้างสถานะโค้ด ณ 2026-11-19 (หลังปิด B/H/M ครบ)

## หลักการจัดลำดับ

1. **ทำสิ่งที่ปลดล็อกงานอื่นก่อน** — repo ที่ยัง track build output และ CI ที่ไม่ตรวจ deploy
   ทำให้ทุกการแก้ถัดไปเชื่อถือไม่ได้ (A-11 → A-10)
2. **ปิดช่องที่ข้อมูลหาย/กู้ยากก่อน cosmetic** — DLQ ที่ไม่มีคนอ่าน (A-06), admin ที่ bootstrap ไม่ได้ (A-02)
3. **งาน refactor ใหญ่ (A-05) ทำเป็นรอบ ๆ หลังมี CI ที่ป้องกัน regression แล้วเท่านั้น**

## ภาพรวม 4 รอบ

| รอบ | รายการ | เวลาประเมิน | ความเสี่ยงถ้าไม่ทำ |
|---|---|---|---|
| 1. Repo truth & CI | A-11 (index), A-10, A-15, A-01 | 2–3 วัน | artefact เก่าถูกนำไปรัน, CI เขียวทั้งที่ deploy พัง |
| 2. Data loss & ops | A-06, A-09, A-13, A-04 | 3–4 วัน | telemetry หายเงียบ, incident ตรวจไม่ได้ |
| 3. Access & multi-tenancy | A-02, A-12, A-03, A-08 | 4–6 วัน | deploy ใหม่ /admin ใช้ไม่ได้, ข้อมูลข้าม org |
| 4. Long-term structure | A-14, A-05, A-07 | 1–2 สัปดาห์ | หมุนคีย์ไม่ได้, แก้โค้ดช้าลงเรื่อย ๆ |

> A-11 มีสองส่วน: **ลบออกจาก index** (ปลอดภัย ทำได้ทันที) และ **ล้างประวัติ git** (ต้องขออนุมัติ +
> ประสานทุกคนที่ clone เพราะต้อง force-push) — แผนนี้แยกสองส่วนชัดเจน

## สถานะล่าสุด (2026-11-19)

| รายการ | สถานะ |
|---|---|
| A-11 ลบ build output ออกจาก index | **เสร็จ** — `git rm --cached` `bench/`, `.tools/`, `dist/`, `aegishider-integrated/target/`, `site/.qa/` (≈2.2k ไฟล์) + `.gitignore` ฝั่ง root |
| A-11 ล้างประวัติ git | **รออนุมัติ** — ต้อง force-push และให้ทุกคน clone ใหม่ |
| A-10 CI | **เสร็จ** — เพิ่ม `wrangler deploy --dry-run`, job `site` (`site/scripts/check-site.mjs`), job `secrets` (`scripts/scan-secrets.mjs`) |
| A-15 dead code | **เสร็จ** — ลบ 11 ฟังก์ชันที่ไม่มีผู้เรียก (`readJson`, `safeNextPath`, `pageCount`, `escapeLike`, `noStore`, `publicKeyDocument`, `requireInstallation`, `countInstallationEvents`, `listContactMessages`, `ticketMessagesMeta`, `getRecentSecurityEvents`) |
| A-06 DLQ consumer | **เสร็จ** — consumer ที่สอง `bhcp-telemetry-dlq` เขียนลงตาราง `telemetry_dlq` (migration 0007) + ack, การ์ดเปิด/ปิดใน `/admin/security` (สิทธิ์ใหม่ `security.write`), retention ของแถวที่ resolved |
| A-09 observability | **เสร็จ** — sink HTTP (`OBSERVABILITY_WEBHOOK_URL`/`_TOKEN`) รับ warn/error log และ alert transition; cron ทุก 5 นาทีประเมิน `http.5xx_rate` (>1%, ≥20 คำขอ) และ `queue.dlq_depth` (>0) เก็บใน `metric_counters`/`alert_state`/`alert_events` แสดงบน /admin, /admin/security และ /status |
| A-01 เอกสารสองชุด | ยังไม่ทำ (อยู่นอกรอบ Wave 1 ตามที่ขอ) |

---

## รอบ 1 — Repo truth & CI (A-11, A-10, A-15, A-01)

### A-11 repo hygiene (Medium)

สถานะ: track อยู่ ≈2.2k ไฟล์ใน `bench/` (1,912), `aegishider-integrated/target/` (280),
`.tools/` (90), `dist/` (14) ทั้งที่ควร build ใหม่

1. เพิ่ม `.gitignore`: `aegishider-integrated/target/`, `dist/`, `bench/`, `.tools/`, `site/.qa/`
   (`.qa/` มีอยู่แล้วในบางไฟล์ — รวมให้เหลือชุดเดียวที่ root)
2. `git rm -r --cached` ตามรายการข้างบน (ไฟล์ยังอยู่บนดิสก์) + commit เดียวแยกชัดเจน
3. ตรวจว่า CI/build ไม่พึ่งไฟล์ที่ถอดออก: `mvn -B verify` ต้องสร้าง `target/` เองได้,
   `site/` ต้อง build ได้จาก source, `bench/` ต้องมีสคริปต์สร้างซ้ำหรือย้ายไป release asset
4. **ล้างประวัติ (ต้องอนุมัติ)**: `git filter-repo --path bench --path .tools --path dist
   --path aegishider-integrated/target --invert-paths` แล้ว force-push
   → ต้องแจ้งผู้ร่วมงานให้ clone ใหม่; ถ้ายังไม่พร้อม ให้คง repo size ไว้ก่อนได้

เกณฑ์ยอมรับ: `git ls-files | grep -cE '(^|/)(dist|target|bench|\.tools)/'` = 0 และ CI เขียวโดยไม่ใช้ artefact ที่ commit

### A-10 CI coverage (Medium)

สถานะ: `.github/workflows/ci.yml` มีแค่ job `plugin` (mvn verify) และ `platform`
(pnpm install/typecheck/test) — ไม่มี site build, ไม่มี deploy dry-run, ไม่มี secret scan

เพิ่ม:
1. `platform`: `pnpm exec wrangler deploy --dry-run --outdir /tmp/dry` (จับ compatibility/binding พังก่อน merge)
2. job `site`: `pnpm install --frozen-lockfile && pnpm build` (หรือสคริปต์ build ของ `site/`)
3. job `secret-scan`: `gitleaks detect --no-git -c .gitleaks.toml` (หรือ trufflehog) + ตรวจว่าไม่มี `.dev.vars`, `*.secrets.json`
4. matrix ข้ามเวอร์ชัน: Java 17/21 สำหรับ plugin (ถ้า `pom.xml` ประกาศรองรับ 17) และ MC API ตาม `plugin.yml`
5. cache: `~/.m2` มีแล้ว; เพิ่ม `platform/node_modules` ผ่าน pnpm store (มีแล้วใน setup-node)

เกณฑ์ยอมรับ: PR ที่ทำ binding ผิดหรือ commit คีย์ต้อง fail; `wrangler deploy --dry-run` ผ่านบน `main`

### A-15 dead code (Low)

รายการที่ audit ระบุ: `readJson`, `escapeLike`, `pageCount`, `noStore`, `safeNextPath`,
`getRecentSecurityEvents`, `countInstallationEvents`, `publicKeyDocument`, `requireInstallation`,
`listContactMessages`, `ticketMessagesMeta`

1. ยืนยันด้วย `grep -rn "<name>" platform/src platform/tests` ว่าไม่มีผู้เรียก (ยกเว้นเทสต์)
2. ลบทีละกลุ่ม (helpers → services → views) พร้อมรัน `tsc` + `vitest` ทุกครั้ง
3. ถ้าฟังก์ชันใดถูกใช้ในเทสต์เท่านั้น ให้ย้ายไป `tests/` หรือลบเทสต์ที่คุมพฤติกรรมซ้ำ

เกณฑ์ยอมรับ: `tsc --noEmit` ผ่าน, 24 tests ผ่าน, จำนวน export ที่ไม่มีผู้เรียก = 0

### A-01 เอกสารสองชุด (Medium)

สถานะ: **แก้แล้วบางส่วน (Wave 3)** — `platform/docs/README.md` เป็น index + แหล่งความจริงของแพลตฟอร์ม,
`docs/README.md` ระบุว่า `docs/01–13` เป็นประวัติ, และ CI มี version-consistency check; ยังเหลือการรวมเนื้อหา
audit ที่ซ้ำกันระหว่างสองชุด

1. ประกาศ `platform/docs/` เป็นแหล่งความจริงเดียวของแพลตฟอร์ม; `docs/01-11` เป็นประวัติ (archive)
2. เพิ่ม `docs/README.md` ตาราง "อ่านอะไรที่ไหน" + แหล่งเวอร์ชันจริง (`plugin.yml`, `package.json`)
3. แทนเลขเวอร์ชันที่ hardcode ในเอกสารด้วยการอ้างไฟล์ต้นทาง; ตรวจ `README.md`, `STATUS.md`, `SECURITY.md`
4. ลบ/รวมเอกสารซ้ำ (เช่นรายงาน audit ที่อยู่สองที่) ให้เหลือชุดเดียว

เกณฑ์ยอมรับ: ไม่มีเอกสารใดระบุเวอร์ชัน plugin ขัดกับ `plugin.yml`; `docs/README.md` ชี้ครบทุกไฟล์

---

## รอบ 2 — Data loss & ops (A-06, A-09, A-13, A-04)

### A-06 DLQ ไม่มี consumer (Medium) — แนะนำทำก่อนในรอบนี้

สถานะ: `wrangler.jsonc` ตั้ง `dead_letter_queue: bhcp-telemetry-dlq` แต่ `src/queue.ts`
มี handler เดียวสำหรับ `bhcp-telemetry`; ข้อความที่ fail 3 ครั้งจะไปกองใน DLQ โดยไม่มีใครอ่าน

1. เพิ่ม consumer ที่สองใน `wrangler.jsonc` (`queue: "bhcp-telemetry-dlq"`, `max_retries: 1`)
   แล้วแยก handler ตาม `batch.queue` ใน `src/queue.ts` (`handleTelemetry` / `handleDlq`)
2. DLQ handler: บันทึก `security_events` หรือตาราง `telemetry_dlq` (id, queue, body, attempts, received_at)
   + `logError("queue.dlq", ...)`; **ack เสมอ** เพื่อไม่ให้วนซ้ำไม่จบ
3. เพิ่มตัวนับใน `/admin/security` (จำนวน DLQ 24 ชม.) และแจ้งเตือนเมื่อ > 0
4. เอกสาร: runbook "ข้อความตก DLQ ต้องทำอะไร" ใน `platform/docs/DEPLOYMENT.md`

สถานะ: **เสร็จ 2026-11-19** — เพิ่ม consumer ที่สอง (`max_retries: 1`), `src/services/dlq.ts`
เขียน `telemetry_dlq` แล้ว ack (retry เฉพาะเมื่อเขียน D1 ไม่สำเร็จ และจำกัด 1 ครั้ง), แสดงผลใน
`/admin/security` พร้อมปุ่ม "จัดการแล้ว", เก็บกวาดแถวที่ resolved ตาม retention

เกณฑ์ยอมรับ: เทสต์ที่จำลอง `batch.queue = "bhcp-telemetry-dlq"` แล้วได้แถวใน DB + ack; ไม่มี retry ไม่จำกัด

### A-09 observability (Low–Medium)

สถานะ: **เสร็จ 2026-11-19** — `src/services/observability.ts` รวม sink HTTP + กฎ alert 2 ข้อ;
middleware นับ `http.total`/`http.5xx` ต่อนาทีผ่าน `waitUntil`; cron `*/5 * * * *` ประเมินและเก็บ
`alert_state`/`alert_events`; การ์ดบน /admin และ /admin/security, component บน /status

สถานะเดิม (ก่อนแก้): มีแต่ `console.log` JSON, `observability.enabled = true` แต่ไม่มี sink

1. เลือก sink เดียว: Workers Logpush → R2/HTTP endpoint หรือ Sentry (Workers SDK) — ตัดสินใจก่อนติดตั้ง
2. ผูก `logError` ให้ส่ง event ระดับ error/warning ออก sink พร้อม `requestId`, `installationId`
3. เพิ่ม metrics ที่มีความหมายทางธุรกิจ: activations/ชั่วโมง, lease failures, DLQ depth, 5xx rate
4. ตั้ง alert 2 ตัว: 5xx > 1% ใน 5 นาที, DLQ > 0

เกณฑ์ยอมรับ: จำลอง error แล้วเห็น event ใน sink ภายใน 1 นาที; alert ยิงจริงใน staging

### A-13 `ADMIN_EMAILS` สองความหมาย (Low)

1. เปลี่ยนชื่อเป็น `DEV_ADMIN_EMAILS` ใน `env.ts`, `wrangler.jsonc`, `.dev.vars.example`, เอกสาร
2. production `/auth/dev-admin` ปิดอยู่แล้วด้วย `DEV_BOOTSTRAP` (H-02) — เขียนคอมเมนต์ให้ชัดว่า
   production admin มาจาก `users.role` + Cloudflare Access เท่านั้น
3. อัปเดต `README.md`, `DEPLOYMENT.md`, `SECURITY.md`

เกณฑ์ยอมรับ: `grep -rn "ADMIN_EMAILS" platform/src` เหลือชื่อใหม่ชื่อเดียว; ไม่มีพฤติกรรมเปลี่ยน

### A-04 schema commerce ที่ไม่ใช้ (Medium)

สถานะ: B-13 mark deprecated แล้ว แต่ตารางยัง migrate ทุก environment

1. คงตารางไว้ (ห้าม drop — ข้อมูล production) แต่เพิ่มหมายเหตุใน `DATABASE.md` ว่าอ่านอย่างเดียว
2. ย้ายการอ่าน `products.price_cents`/`product_plans` ออกจาก UI ที่ยังโชว์ราคา (ถ้ามี) ให้เป็นค่าคงที่ "ฟรี"
3. ถ้าจะลบจริงในอนาคต: migration ที่ copy ข้อมูลไป `ARCHIVE` (R2) ก่อน แล้ว drop ใน release ถัดไป

เกณฑ์ยอมรับ: ไม่มี path ใหม่ที่เขียนตารางเหล่านี้; เอกสารระบุแผน retirement ชัดเจน

---

## รอบ 3 — Access & multi-tenancy (A-02, A-12, A-03, A-08)

### A-02 admin bootstrap (High) — ต้องตัดสินใจเชิงนโยบายก่อน

สถานะ: **แก้แล้ว (Wave 2)** — เลือกทางเลือก A: `scripts/bootstrap-admin.mjs <email>` เป็น CLI idempotent
(ไม่สร้างบัญชีเอง, ใช้ `RETURNING` ตรวจผล) พร้อมคู่มือใน `DEPLOYMENT.md`; ทดสอบบน local D1 แล้ว
production ยังต้องรันด้วยมือครั้งแรกหลังสมัครบัญชี

ทางเลือก (เลือกหนึ่ง):
- **A. CLI bootstrap** (แนะนำ): `scripts/bootstrap-admin.mjs <email>` ใช้ `wrangler d1 execute`
  อัปเดต user ที่มีอยู่เป็น `super_admin` (ไม่สร้างบัญชีเอง); รันด้วยมือครั้งเดียวต่อ environment
- **B. First-run page**: `/admin/setup` เปิดเฉพาะเมื่อ `COUNT(staff) = 0` และต้องมี Access JWT +
  `DEV_BOOTSTRAP`-style token; ปิดถาวรหลังมี admin คนแรก
- **C. seed SQL**: เพิ่ม `INSERT` ใน `seed/seed.sql` (ง่ายแต่เสี่ยง commit อีเมล/role ลง repo)

ขั้นตอน (ทางเลือก A): สคริปต์ + dry-run, ตรวจ idempotent, เพิ่มใน `DEPLOYMENT.md` ขั้น "หลัง deploy ครั้งแรก",
ทดสอบบน local D1, หน้า `/admin` 503 ต้องบอกคำสั่งที่ต้องรัน

เกณฑ์ยอมรับ (ผ่านบน local): environment ใหม่ได้ super_admin คนแรกโดยไม่แก้ SQL มือ; รันซ้ำไม่สร้างบัญชีซ้ำ
และบัญชีที่ไม่รู้จักถูกปฏิเสธ

### A-12 auth 3 ทาง + recovery (Medium)

สถานะ: **แก้แล้ว (Wave 2)** — ตัดสินใจ **ไม่ใช้ Resend/อีเมลเลย**: ใช้ email+password + recovery codes 10 ชุด
(HMAC, single-use, แสดงจนกดซ่อนหรือ 15 นาที) + TOTP 2FA และ operator CLI `reset-password.mjs`

1. ไม่มี email provider, OTP, magic link หรืออีเมลรีเซ็ตรหัสผ่านในโค้ดที่ใช้งาน
2. Recovery flow: `/auth/recover` ใช้รหัสแล้ว revoke ทุก session, ล้าง TOTP และออกรหัสชุดใหม่
3. ผู้ที่ไม่มีทั้งรหัสผ่านและรหัสกู้คืน: operator รัน `reset-password.mjs` (ทดสอบ local แล้ว)
4. เทสต์: recovery/TOTP unit + `/auth/recover` end-to-end + GET ไม่กินรหัสก่อน ack

เกณฑ์ยอมรับ (ผ่านบน local): recovery ครบวงจรโดยไม่ต้องส่งอีเมล; ล็อกอินด้วยรหัสชั่วคราวจาก CLI ได้จริง

### A-03 multi-org เป็นผิว (Medium)

สถานะ: แก้แล้ว (Wave 3) — ทุกจุดเรียก `primaryMembership()` จาก `auth/session.ts`; เลือก single-org ต่อบัญชีเป็นดีไซน์ (schema ยังรองรับหลาย org เพื่ออนาคต)

1. เพิ่ม helper `activeOrg(c)` ใน `auth/context.ts` (อ่าน `?org=` ถ้ามี, ตรวจ membership, fallback org แรก)
2. แทน `memberships[0]` ทุกจุดด้วย helper + ส่ง `orgId` ลง service layer อย่างชัดเจน
3. บังคับ scope ใน query ทุกตัวที่รับ `orgId` (มี pattern อยู่แล้วใน `listLicensesForUser`)
4. เทสต์: user ที่มี 2 org เห็นเฉพาะข้อมูล org ที่เลือก; org ที่ไม่ใช่สมาชิก → 404

เกณฑ์ยอมรับ: `grep -rn "memberships\[0\]" platform/src` = 0; เทสต์ 2 org ผ่าน

### A-08 WorldKeys id (Low, ฝั่ง plugin)

สถานะ: `idOf` โยน `IllegalStateException` เมื่อเกิน 1,048,575 worlds ใน hot path

1. เปลี่ยน `WorldKeys` ให้คืน id จาก `computeIfAbsent` แบบไม่พึ่ง index ลำดับ (เช่น map `UUID → int` + counter)
2. ถ้าถึงเพดาน: คืน id แบบ reuse ช่องว่าง หรือ degrade เป็น `-1` พร้อม log ครั้งเดียว (ไม่ throw)
3. เพิ่ม unit test: จำลองเพดานแล้วไม่โยน exception
4. รัน `mvn -B test` (123 tests) ใน `aegishider-integrated`

เกณฑ์ยอมรับ: ไม่มี exception จาก hot path; เทสต์ใหม่ผ่าน

---

## รอบ 4 — Long-term structure (A-14, A-05, A-07)

### A-14 key rotation (Low)

1. สคริปต์ `scripts/rotate-signing-key.mjs`: สร้างคู่คีย์ใหม่ → เพิ่ม `signing_keys` (status active)
   → คง key เก่าเป็น `deprecated` (ยัง verify lease เก่าได้) → หลัง lease TTL เปลี่ยนเป็น `retired`
2. หน้า `/admin/security` แสดง key id/status/วันที่ + ปุ่ม rotate (super_admin เท่านั้น + audit)
3. ฝั่ง plugin: คำสั่ง `/aegishider rekey` แลก installation key ใหม่โดยไม่ต้องลบ `platform/`
4. runbook ใน `DEPLOYMENT.md`: rotate ก่อน suspected compromise, ผลกระทบต่อ lease

เกณฑ์ยอมรับ: rotate แล้ว lease เก่ายัง verify ได้จนหมดอายุ; plugin rekey ไม่ทำให้ server หลุด pairing

### A-05 monolith (Medium) — ทำ incremental เท่านั้น

สถานะ: 12,023 บรรทัดใน `src/`, route → SQL ตรง

1. เลือก 1 domain ก่อน (แนะนำ `licensing` เพราะมีเทสต์หนาแน่น) แล้วสกัด repository
   (`repositories/licenses.ts`) ออกจาก SQL ใน route
2. ตั้งกฎ: route ห้าม import `env.DB` ตรง ๆ; ใช้ service/repository เท่านั้น (lint ด้วย grep ใน CI)
3. ทำซ้ำ domain ละรอบ (licensing → telemetry → support → admin) โดยไม่แตะ UI พร้อมกัน
4. ห้าม big-bang rewrite; ทุกขั้นต้อง `tsc` + `vitest` เขียว

เกณฑ์ยอมรับ: route layer ไม่มี SQL; จำนวนบรรทัดต่อไฟล์ < 800; เทสต์ยัง 24+ ผ่าน

### A-07 fail-closed ไม่จริง (Medium)

1. **แก้เอกสารทันที**: README/ARCHITECTURE ระบุว่า block protection fail-open เมื่อไม่มี PacketEvents
   (ทำได้ในรอบ 1 ราคาถูก)
2. Runtime: เมื่อ PacketEvents หาย → เปิดโหมด degrade ที่ยังกัน container break ได้บางส่วน
   (เช่น cancel `BlockBreakEvent` สำหรับ container ที่ tracked) หรือปิดคำสั่งที่พึ่ง block data
3. เพิ่มสถานะใน `/aegishider status` ว่า protection layer ไหน active/inactive

เกณฑ์ยอมรับ: ข้อความในเอกสารตรงกับพฤติกรรมจริง; ไม่มี path ที่อ้าง fail-closed แต่ปล่อยผ่าน

---

## ลำดับที่แนะนำให้เริ่ม (ถ้าเลือกได้ 3 อย่างแรก)

1. **A-11 (index only)** — 2–3 ชั่วโมง, ลด repo และกันการรัน jar เก่า
2. **A-10** — ครึ่งวัน, ทำให้ทุกงานถัดไปมีตาข่ายนิรภัย (dry-run + site build + secret scan)
3. **A-06** — 1 วัน, ปิดการสูญเสียข้อมูลเงียบที่เกิดได้ทุกวันนี้

จากนั้น A-02 (ต้องมีคนตัดสินนโยบาย bootstrap) และ A-03 (ต้องตัดสินว่าจะรองรับหลาย org จริงหรือไม่)

## สิ่งที่ต้องขออนุมัติ/ตัดสินใจจากเจ้าของโปรเจกต์

| เรื่อง | ต้องตัดสิน |
|---|---|
| A-11 history rewrite | อนุญาต force-push และแจ้งผู้ร่วมงาน clone ใหม่หรือไม่ |
| A-02 | เลือก CLI bootstrap (A) แล้ว — ไม่ต้องอนุมัติเพิ่ม |
| A-12 | เลือกไม่ใช้ Resend/อีเมลแล้ว — recovery codes + TOTP + operator CLI |
| A-05 | ระดับการแยกชั้นที่ต้องการ (repository only vs full domain layer) |
| A-09 | sink ที่เลือก (Logpush/Sentry/OTel) และงบประมาณ |
