# Aegishider Pro — Security, Bug & Architecture Audit

วันที่: 2026-11-19
ขอบเขต: ทั้ง repository (`platform/` Cloudflare Worker, `aegishider-integrated/` Paper plugin,
`site/` landing page, `bench/`, `itest/`, `docs/`, `.github/`, scripts, migrations, seed)

---

## 1. บทสรุปผู้บริหาร

Repository นี้มีคุณภาพโค้ดโดยรวมดีกว่าค่าเฉลี่ย: template engine escape อัตโนมัติ, SQL parameterised
ทุกจุด, Ed25519 signature + nonce replay protection ครบ, typecheck และ test ผ่านจริง

แต่การตรวจพบ **ช่องโหว่ระดับ High 6 รายการ**, **Medium 13 รายการ**, **บัคเชิงฟังก์ชัน 20+ รายการ**
และ **ความผิดปกติเชิงสถาปัตยกรรม 15 รายการ** ที่สำคัญที่สุดคือ:

1. **การยึด installation ของผู้อื่นได้** ผ่าน `/api/v1/installations/register` (ไม่ต้องมี private key)
2. **`/auth/dev-admin` แจก `super_admin`** โดยเช็คแค่ตัวแปร `ENVIRONMENT`
3. **สมัครบัญชีด้วยอีเมลของคนอื่นได้ก่อนเจ้าของ** (ไม่มีการยืนยันอีเมลก่อนตั้งรหัสผ่าน)
4. **Production signing key อาจหลุดเข้า git** เพราะ `.prod-secrets.json` ไม่ได้อยู่ใน `.gitignore`
5. **ไจาร์เวอร์ชันเก่าที่มีช่องโหว่ยังถูกเสิร์ฟให้ดาวน์โหลด**
6. **ยกเลิก activation แล้วเปิดใหม่ไม่ได้** (unique constraint) และ **activation limit แซงได้ด้วย race**

ข้อผิดพลาดเชิงเอกสารที่กระทบความน่าเชื่อถือ: `platform/docs/SECURITY.md` ระบุว่า licence key
"100-bit" และ activation code "8 ตัวอักษร 40-bit" แต่โค้ดจริงคือ **240-bit / 16 ตัวอักษร 80-bit**
และ threat model ยังพูดถึง wallet/Stripe/PromptPay ที่ถูกลบออกจากระบบแล้ว

---

## 2. วิธีตรวจและสิ่งที่รันจริง

| การตรวจ | ผล |
|---|---|
| อ่านซอร์สทั้งหมดของ `platform/src` (11,606 บรรทัด, 52 ไฟล์) | ครบ |
| อ่าน Java ฝั่ง security/platform/packet/command/config (≈4,500 บรรทัดจาก 11,406) | ครบในส่วนที่มีผลต่อความปลอดภัย ที่เหลืออ่านแบบ targeted grep |
| อ่าน migrations ทั้ง 6 ไฟล์, seed, wrangler, CI, site headers/redirects/JS | ครบ |
| `tsc --noEmit` (platform) | **ผ่าน** (exit 0) |
| `vitest run` (platform) | **ผ่าน 21 tests / 3 files** |
| `pnpm install --frozen-lockfile` ตาม README | **ล้มเหลว** — ดู B-10 |
| `mvn verify` (plugin) | **ไม่ได้รัน** (ไม่มี Maven/JDK ในเครื่องนี้; ต้องมี network) |
| DAST / browser E2E / load test | **ไม่ได้ทำ** |

> หมายเหตุ: การติดตั้ง dependency ของ platform ทำด้วย `npx pnpm@9 install --frozen-lockfile --ignore-workspace`
> เพราะคำสั่งมาตรฐานใน README/CI ล้มเหลว (ดู B-10)

---

## 3. ตารางสรุป findings

| ID | ระดับ | หมวด | หัวข้อ |
|---|---|---|---|
| H-01 | High | Security | ยึด installation ด้วย re-registration (ไม่มี proof of possession) |
| H-02 | High | Security | `/auth/dev-admin` แจก super_admin ถ้า ENVIRONMENT ไม่ใช่ production |
| H-03 | High | Security | Pre-account-takeover ด้วยการสมัครอีเมลผู้อื่นก่อนยืนยันอีเมล |
| H-04 | High | Security | `.prod-secrets.json` ไม่อยู่ใน `.gitignore` |
| H-05 | High | Supply chain | ไจาร์เก่า/มีช่องโหว่ถูกเสิร์ฟต่อสาธารณะ + `_headers` hardcode 3.6.1 |
| H-06 | High | Bug/Security | Activation limit แซงได้ด้วย race; re-activation หลัง release พัง |
| M-01 | Medium | DoS | ไม่จำกัดขนาด body ของ `/api/v1/installations/register` |
| M-02 | Medium | Crypto | `hashIp` ใช้ pepper ค่าคงที่ `"unconfigured-pepper"` เมื่อไม่ได้ตั้งค่า |
| M-03 | Medium | Auth | Access JWT ไม่บังคับ `iss` และไม่ตรวจ claim เสริม |
| M-04 | Medium | Auth | Turnstile ไม่ตรวจ `hostname`/`action` |
| M-05 | Medium | Auth | Login-CSRF ผ่าน `/auth/verify` GET + CSRF allowlist กว้าง |
| M-06 | Medium | Crypto | PBKDF2 100k ต่ำกว่า OWASP (ข้อจำกัด Workers) |
| M-07 | Medium | Data | Raw licence key ค้างใน KV 7 วัน และ read_only ดูได้ |
| M-08 | Medium | Abuse | ไม่มี rate limit ที่ `/auth/verify` และ GET `/app` สร้าง licence ได้ |
| M-09 | Medium | Privilege | `admin` = `super_admin`, ไม่มี hierarchy, ไม่กัน last-admin |
| M-10 | Medium | Audit | บาง mutation ของ admin ไม่ถูก audit; audit write กลืน error |
| M-11 | Medium | Supply chain | ดาวน์โหลด artefact ไม่จำกัด/ไม่มี signature verification ฝั่งปลั๊กอิน |
| M-12 | Medium | Data | installation ที่ `suspended` ยังส่ง telemetry/sign ได้ |
| M-13 | Medium | Key mgmt | Key reuse: pepper เดียวกันทำ IP hash / licence / OTP |
| B-01 | High | Bug | `UNIQUE(license_id, installation_id)` ทำให้ re-activate ไม่ได้ |
| B-02 | High | Bug | หน้า customer detail แสดงเซิร์ฟเวอร์ผิด (กรองหลัง LIMIT 100) |
| B-03 | Medium | Bug | `snapshotAllPositions()` ทิ้ง world id → reload อาจส่ง block ข้ามโลก |
| B-04 | Medium | Bug | LIKE escape ไม่มี `ESCAPE '\'` → `%`/`_` ยังเป็น wildcard |
| B-05 | Medium | Bug | `ensureFreeLicenseForUser` ไม่ idempotent เวลาแข่งกัน → licence ซ้ำ |
| B-06 | Medium | Bug | challenge เก่าไม่ถูกยกเลิกเมื่อ re-register → รหัสค้างหลายใบ |
| B-07 | Medium | Bug | `license_leases` / `security_events` / `job_runs` โตไม่จำกัด |
| B-08 | Low | Bug | `flushEvents` ทิ้ง event ใหม่สุด แต่ `recordEvent` ทิ้งเก่าสุด |
| B-09 | Low | Bug | `Content-Disposition` ฝัง 3.6.1 ให้ทุกไฟล์ใน `/download/*` |
| B-10 | High | CI | `pnpm-workspace.yaml` ไม่มี `packages:` → `pnpm install` และ CI platform ล้ม |
| B-11 | Medium | Docs | SECURITY/README/STATUS/THREAT-MODEL ล้าสมัย ขัดกับโค้ด |
| B-12 | Low | Repo | `pom.xml` root เป็นไฟล์ว่าง 0 byte |
| B-13 | Medium | Schema | ตาราง payment/wallet/topup ตกค้างโดยไม่มีโค้ดใช้งาน |
| B-14 | Low | Bug | `rescan` และ `onChunkSwept` ทำงานหนักบน main thread |
| B-15 | Low | Bug | `/admin/releases` บังคับ `status=published` ไม่มี draft/unpublish |
| B-16 | Low | UX | `/aegishider license link` และ `rescan` ใช้ permission เดียวกับ status |
| B-17 | Low | Bug | งบเวลาต่อ tick รวมเกิน 100% แล้วยังมี reconciliation เพิ่ม |
| B-18 | Medium | Bug | `block-protection:` ไม่มี `hidden-blocks` → ปิดการป้องกันเงียบ ๆ |
| B-19 | Low | Bug | `og:image` hardcode workers.dev ไม่ใช้ `APP_URL` |
| B-20 | Low | Bug | analytics bucket เป็น UTC แต่แสดงเวลาไทย → กราฟเลื่อนวัน |
| A-01 | Medium | Architecture | เอกสารสองชุด (docs/ กับ platform/docs/) ไม่มีแหล่งความจริงเดียว |
| A-02 | High | Architecture | Admin auth แบบ split-brain (Access + role) ไม่มี bootstrap/seed |
| A-03 | Medium | Architecture | โมเดล multi-org เป็นเพียงผิว; โค้ดใช้ `memberships[0]` ทุกที่ |
| A-04 | Medium | Architecture | ระบบ "ฟรี" แต่ schema ยังเต็มไปด้วย payments/plans |
| A-05 | Medium | Architecture | Worker monolith 11.6k บรรทัด ไม่มีชั้น service/DTO ที่ชัด |
| A-06 | Medium | Architecture | Queue ไม่มี handler ของ DLQ → ข้อความหายเงียบ |
| A-07 | Medium | Architecture | ถ้าไม่มี PacketEvents block protection ปิด แต่ยังอ้างว่า fail-closed |
| A-08 | Low | Architecture | `WorldKeys` ไม่คืน id, ชนิก id หลัง 1M worlds โยน exception ใน hot path |
| A-09 | Low | Architecture | ไม่มี observability/metrics sink นอกจาก console log |
| A-10 | Medium | Architecture | CI ไม่มี deploy dry-run / cross-version test / site build |
| A-11 | Medium | Repo hygiene | commit `dist/*.jar`, `target/`, `bench/` 1,912 ไฟล์, `.tools/` 90 ไฟล์ |
| A-12 | Medium | Architecture | auth 3 ทางพร้อมกัน + recovery พึ่ง sending domain ที่ยังไม่ยืนยัน |
| A-13 | Low | Config | `ADMIN_EMAILS` สื่อความหมายสองแบบ (dev bootstrap vs production admin) |
| A-14 | Low | Key mgmt | ไม่มี key rotation flow ทั้งฝั่ง plugin และ signing key |
| A-15 | Low | Code health | dead code/duplicate helper หลายชุด (`readJson`, `escapeLike`, `pageCount`, ...) |

---

## 4. รายละเอียดช่องโหว่ (Security)

### H-01 — ยึด installation ของผู้อื่นผ่าน re-registration
**ไฟล์:** `platform/src/services/licensing.ts:430-465` (`registerInstallation`), `platform/src/routes/api.ts:118-152`

`registerInstallation` ตรวจว่า installation มีอยู่แล้วหรือไม่ ถ้ามีและ public key ตรงกันจะ
**ออก activation code ใหม่ให้ทันที** โดยไม่มีอะไรพิสูจน์ว่าผู้เรียกถือ private key:

```ts
// licensing.ts:454
// Re-registration: issue a fresh pairing code so the owner can link again.
const challenge = await createActivationChallenge(env, existing.id);
```

`installation_uuid` และ `public_key` ไม่ใช่ความลับ: uuid ถูกส่งในทุก request header
(`X-AG-Installation`), ปรากฏในหน้า admin/portal, อยู่ในตั๋ว support และ `public_key` ถูกส่งใน
registration body. ใครที่เห็นค่าเหล่านี้สามารถเรียก register ซ้ำ รับรหัสใหม่ แล้วเอาไป claim
ในบัญชีของตน → `claimActivationInner` เขียนทับ `installations.license_id` และ `org_id`
(`licensing.ts:737`) ทำให้เซิร์ฟเวอร์ของเหยื่อถูกผูกกับบัญชีผู้โจมตี (และเหยื่อถูกตัดสิทธิ์)

**ผลกระทบ:** ยึด installation, hijack licence slot, DoS ด้วยการ re-pair ซ้ำ ๆ (rate limit 20/ชม./IP
แต่ไม่จำกัดต่อ installation)

**แนวทางแก้:**
- re-registration ต้องเป็น **signed request** ด้วยกุญแจเดิม (ใช้ `verifySignedRequest` ที่มีอยู่แล้ว)
- หรือออก pairing code ผ่าน endpoint ที่ต้องมี session เจ้าของ + ต้องมี private key proof
- invalidate challenge เก่าทั้งหมดของ installation เมื่อออกใหม่
- เก็บ `register` event เดิมไว้เป็น audit

### H-02 — `/auth/dev-admin` ให้ super_admin โดยพึ่ง `ENVIRONMENT`
**ไฟล์:** `platform/src/routes/auth.ts:405-460`

Route นี้สร้าง/ยึดบัญชีแรกใน `ADMIN_EMAILS`, ตั้ง `role='super_admin'`, ออก session ให้ทันที
และเช็คเพียง `isProduction(c.env)` ซึ่งอ่านจากตัวแปร `ENVIRONMENT` ใน `wrangler.jsonc`
ถ้า deploy ผิด environment (staging/preview ที่ลืมตั้ง `ENVIRONMENT=production`) ใครก็เปิด URL นี้ได้
→ **full admin takeover**

**แนวทางแก้:** ใช้ flag แยก (`DEV_BOOTSTRAP=1`) + จำกัด loopback/`CF-Connecting-IP` + ต้องมี secret
ใน header, และลบ route ออกจาก production bundle

### H-03 — Pre-account-takeover จากการสมัครด้วยอีเมลผู้อื่น
**ไฟล์:** `platform/src/routes/auth.ts:139-210`

`POST /auth/register` รับอีเมล + รหัสผ่านแล้วตั้ง `password_hash` ได้ทันทีโดยไม่ยืนยันว่า
ผู้สมัครเป็นเจ้าของอีเมล และ `findOrCreateAccount` สร้างบัญชีให้อีเมลใดก็ได้

 consequence: ผู้โจมตีสมัคร `victim@example.com` ด้วยรหัสของตนได้ เมื่อเหยื่อภายหลังขอ login
ด้วยลิงก์อีเมล ระบบจะให้เหยื่อเข้า **บัญชีเดียวกัน** ที่ผู้โจมตีถือรหัสอยู่แล้ว (และผู้โจมตี
เห็นข้อมูล/licence ที่เหยื่อเพิ่มเข้ามา)

**แนวทางแก้:** บังคับ verify email ก่อนเปิดใช้ password login (หรือก่อนแนบ password เข้าบัญชี),
แจ้งเจ้าของอีเมลเมื่อมีผู้พยายามสร้างบัญชี, เก็บ `email_verified_at` เป็นเงื่อนไขของ password login

### H-04 — Production secret file ไม่อยู่ใน `.gitignore`
**ไฟล์:** `platform/scripts/cf-prod-secrets.mjs:15`, `.gitignore`, `platform/.gitignore`

สคริปต์เขียน `LICENSE_SIGNING_KEY` (private key), `LICENSE_KEY_PEPPER`, `OTP_PEPPER`,
`TURNSTILE_SECRET` ลงไฟล์ `.prod-secrets.json` ใน working directory แต่ไม่มี `.gitignore`
ที่ไหนอ้างถึงชื่อนี้ (ตรวจแล้วทั้งสองไฟล์) → `git add .` ครั้งเดียวคือการรั่ว signing key
ที่ใช้ลงนาม lease ทั้งระบบ

**แนวทางแก้:** เพิ่ม `.prod-secrets.json` (และ `*.secrets.json`) ใน `.gitignore` ทั้งสองไฟล์,
เขียนไฟล์นอก repo หรือ `os.tmpdir()` พร้อม `0o600`, และเพิ่ม pre-commit secret scan

### H-05 — เผยแพร่ไจาร์เวอร์ชันเก่า/มีช่องโหว่ และ header ผิดเวอร์ชัน
**ไฟล์:** `platform/public/download/Aegishider-3.2.0.jar`, `.../3.6.0.jar`, `.../3.6.1.jar`,
`dist/Aegishider-3.2.0.jar` … `3.5.0.jar`, `site/public/download/Aegishider-3.6.1.jar`,
`site/public/_headers:28`, `site/public/_redirects:2-5`

- `docs/09-three-gap-benchmark.md` ระบุว่า baseline เวอร์ชันเก่า "leaks all three gaps" แต่ไจาร์
  เหล่านั้นยังถูกเสิร์ฟผ่าน static assets ของ Worker และ Pages
- `_headers` ตั้ง `Content-Disposition: attachment; filename="Aegishider-3.6.1.jar"` ให้ทุกไฟล์
  ใต้ `/download/*` → ถ้าเพิ่ม 3.7.0 ไฟล์จะถูกบันทึกชื่อผิด
- ปลั๊กอิน HEAD คือ 3.7.0 (`plugin.yml`) แต่เว็บยังลิงก์ 3.6.1

**แนวทางแก้:** ลบ artefact เก่าออกจากทั้งสองที่, ให้ release มาจาก R2 ผ่าน `/release/:id/download`
เท่านั้น, ใช้ `_headers` แบบรายไฟล์ หรือ rewrite ชื่อจาก Worker

### H-06 — Activation limit race + re-activation พัง
**ไฟล์:** `platform/src/services/licensing.ts:700-760`, `platform/migrations/0001_init.sql:226`

อ่าน `active_activations` แล้วค่อย INSERT (`licensing.ts:732`) โดยไม่มีการนับซ้ำในระดับ DB
→ คำขอพร้อมกันหลายตัวสามารถทำให้ activation เกิน `activation_limit`

และเพราะ `UNIQUE (license_id, installation_id)` ไม่ถูกลบเมื่อ `releaseActivation` ตั้ง
`status='released'` การ claim installation เดิมซ้ำจะชน constraint แล้วถูกแปลงเป็น
`409 "ไม่สามารถเปิดใช้งานได้"` → **ผู้ใช้ที่กด reset activation จะเปิดใหม่ไม่ได้ตลอดไป**
(ต้องแก้ DB มือ)

**แนวทางแก้:** ใช้ transaction/`INSERT ... SELECT` ที่นับเงื่อนไขในคำสั่งเดียว, เปลี่ยน unique
constraint เป็น partial index บน `status='active'` (`CREATE UNIQUE INDEX ... WHERE status='active'`)
หรือใช้ UPSERT `ON CONFLICT ... DO UPDATE SET status='active'`

---

## 5. ช่องโหว่ระดับ Medium

| ID | ไฟล์ | รายละเอียด / ผลกระทบ / แนวทาง |
|---|---|---|
| M-01 | `platform/src/routes/api.ts:132` | `const raw = await c.req.text()` ก่อน validate — body ไม่จำกัดขนาด (ต่างจาก `readJson` ที่มี 64KB) ทำให้เปลือง memory/CPU; ควรเช็ค `content-length` และอ่านแบบจำกัด |
| M-02 | `platform/src/lib/http.ts:29` | `hashIp` fallback `"unconfigured-pepper"` → hash IP คาดเดาได้ (ทำ rainbow ของ 2^32 IP ได้) และ rate-limit key ชนกันข้าม deployment; ควร throw ใน production |
| M-03 | `platform/src/auth/access.ts:109` | `if (payload.iss && ...)` — JWT ที่ไม่มี `iss` ผ่าน; ไม่ตรวจ `type`/`azp`; ควรบังคับ `iss` และ `aud` เสมอ (fail closed) |
| M-04 | `platform/src/auth/turnstile.ts:37-45` | ตรวจแค่ `success`; ไม่เทียบ `hostname` กับ `APP_URL` และ `action`; token จาก sitekey เดียวกันบนโดเมนอื่นใช้ซ้ำได้ |
| M-05 | `platform/src/lib/http.ts:84-115`, `routes/auth.ts:365` | CSRF allowlist รวม `requestUrl.host` (host ใดก็ได้ที่วิ่งมาถึง Worker) และ fallback Referer; `/auth/verify` เป็น GET ที่ consume token → login-CSRF/session fixation (เหยื่อถูก log เข้าบัญชีผู้โจมตี) |
| M-06 | `platform/src/auth/password.ts:12` | PBKDF2-SHA256 100k (เพดาน Workers) ต่ำกว่า OWASP 600k; ชดเชยด้วย rate limit + password policy แต่ควรบันทึกเป็นความเสี่ยงที่ยอมรับ |
| M-07 | `platform/src/services/licensing.ts:571`, `routes/portal.ts:104,129` | raw licence key เก็บใน KV 7 วัน และ **สมาชิก org ทุกคน (รวม read_only) เห็นได้**; admin path เก็บแค่ 600s (`routes/admin.ts:299`) — ไม่สอดคล้องกัน; ควรผูกกับ user ที่ออกคีย์ และให้ดูได้ครั้งเดียว |
| M-08 | `platform/src/routes/auth.ts:365`, `routes/portal.ts:60` | ไม่มี rate limit ที่ `/auth/verify` (token 256-bit จึงเดายาก แต่ยิงถล่ม DB ได้) และ GET `/app` ทำให้เกิด `ensureFreeLicenseForUser` (เขียน D1) ทุกครั้ง |
| M-09 | `platform/src/auth/guards.ts:38-40`, `routes/admin.ts:213-232` | `admin` และ `super_admin` มี permission ชุดเดียวกันทุกตัว; `admin` สามารถเลื่อนคนอื่นเป็น `super_admin` ได้; ไม่มีการกันการลบ/ลด admin คนสุดท้าย → privilege escalation ระหว่าง staff และล็อกตัวเองออกจากระบบ |
| M-10 | `platform/src/routes/admin.ts:663-680`, `services/audit.ts:24-52` | เปลี่ยน status ตั๋วไม่ถูก audit; `recordAudit` กลืน error (audit ขาดได้เงียบ ๆ) — ควรลง `security_events` แทนเมื่อ write ล้มเหลว |
| M-11 | `platform/src/routes/marketing.ts:75-95` | `/release/:id/download` ไม่ต้อง auth และไม่จำกัด bandwidth; ปลั๊กอินไม่ตรวจ `artifact_sha256`/signature ก่อนรัน |
| M-12 | `platform/src/services/licensing.ts:850-870` | `verifySignedRequest` ปฏิเสธเฉพาะ `status === 'revoked'`; installation ที่ `suspended` ยัง heartbeat/events ได้ → D1 โตและ telemetry ปนเปื้อน |
| M-13 | `platform/src/lib/http.ts:29`, `auth/otp.ts:14` | pepper เดียว (`LICENSE_KEY_PEPPER`) ใช้ทำ IP hash, licence HMAC และ fallback ของ OTP — ควรแยกคีย์ตามวัตถุประสงค์ (key separation) |

---

## 6. บัคเชิงฟังก์ชัน

### B-01 (High) — reset activation แล้วเปิดใหม่ไม่ได้
ดู H-06

### B-02 (High) — หน้า customer detail แสดงเซิร์ฟเวอร์ผิด
**ไฟล์:** `platform/src/routes/admin.ts:190`

```ts
const servers = await listAdminInstallations(c.env, { q: "", limit: 100 });
...
servers.filter((server) => server.customer_email === data.user.email)
```

ดึง 100 installation ล่าสุดของ **ทั้งระบบ** แล้วมากรองด้วยอีเมลทีหลัง → ลูกค้าที่ไม่ได้อยู่ใน 100
รายการแรกจะเห็น "ไม่มีเซิร์ฟเวอร์" และรายการอาจไม่ครบ ต้องส่ง filter ลง SQL (`q = email` หรือ
`org_id`) และแบ่งหน้า

### B-03 (Medium) — snapshot ข้ามโลก
**ไฟล์:** `aegishider-integrated/.../index/HiddenBlockIndex.java:351`,
`AegishiderPlugin.java:610,641,647-670`

`snapshotAllPositions()` รวม position ของ **ทุก world** เป็น `long[]` โดยไม่มี world id
จากนั้น `revealPositionsToViewers` เอา position ไปใช้กับ `player.getWorld()` และ
`player.isChunkSent(Chunk.getChunkKey(cx, cz))` ซึ่งเป็น key ที่ไม่ผูก world
→ เมื่อ reload แล้วปิด block protection ระบบอาจส่ง `BlockData` ของอีกโลกหนึ่งไปยังพิกัดเดียวกัน
ในโลกปัจจุบัน (ข้อมูลผิด/รั่วข้ามโลก)

**แนวทางแก้:** snapshot เป็น `Map<worldId, long[]>` หรือ `long[]{worldId,pos}` และกรองด้วย
`session.worldId()`

### B-04 (Medium) — LIKE escape ไม่ทำงานจริง
**ไฟล์:** `platform/src/services/admin.ts:140,236`, `services/catalog.ts:88`

escape `%`, `_`, `\` แต่ SQL ไม่มี `ESCAPE '\'`; SQLite ถือ `\` เป็นอักขระปกติ → ผู้ใช้พิมพ์ `%`
ยังได้ wildcard (ผลค้นหาผิด, ไม่ใช่ SQL injection)

### B-05 (Medium) — licence ฟรีซ้ำได้
**ไฟล์:** `platform/src/services/licensing.ts:587-610`

`ensureFreeLicenseForUser` = SELECT แล้ว INSERT; ไม่มี unique index บน `(org_id, product_id)`
สำหรับ licence ฟรี และ GET `/app` เรียกทุกครั้ง → คำขอพร้อมกันสร้าง licence ซ้ำ (activation limit
และ KV key เพิ่มขึ้นเรื่อย ๆ)

### B-06 — challenge เก่าไม่ถูกยกเลิก
`createActivationChallenge` (licensing.ts:507) INSERT ใหม่ทุกครั้ง ไม่ mark ของเก่าเป็น consumed
→ มีรหัสที่ยังใช้ได้หลายใบต่อ installation และตารางโต

### B-07 — ตารางโตไม่จำกัด
`license_leases` ถูก INSERT ทุกครั้งที่ขอ lease (ทุกชั่วโมง/เซิร์ฟเวอร์) และ scheduled cleanup
(`platform/src/scheduled.ts:29-52`) ไม่มี delete; เช่นเดียวกัน `security_events`, `job_runs`,
`email_log`, `heartbeat_latest`, `activation_guard` และ telemetry ลบได้แค่ 1,000 แถว/ชม.

### B-08 — นโยบาย drop event ไม่สอดคล้อง
`recordEvent` ทิ้ง "เก่าสุด" (`pollFirst`) แต่ `flushEvents` เมื่อส่งไม่สำเร็จทิ้ง "ใหม่สุด"
(`pollLast`) — ควรเลือกนโยบายเดียวและนับ metric แยก

### B-09 — `_headers` ฝังชื่อไฟล์
`site/public/_headers:28` ตั้ง `filename="Aegishider-3.6.1.jar"` ให้ทุก path ใต้ `/download/*`

### B-10 (High) — workspace config พัง ทำให้ CI ล้ม
**ไฟล์:** `platform/pnpm-workspace.yaml`

ไฟล์มีแค่:

```yaml
minimumReleaseAgeExclude:
  - '@cloudflare/workers-types@5.20261115.1'
verifyDepsBeforeRun: false
```

ไม่มี `packages:` → pnpm ตอบ `ERROR packages field missing or empty` ทุกคำสั่ง
(`pnpm install`, `pnpm typecheck`, `pnpm test`) ดังนั้น:
- quick start ใน `platform/README.md` ใช้ไม่ได้
- CI job `platform` (`.github/workflows/ci.yml:35-45`) จะล้มที่ `pnpm install` ก่อนถึง typecheck/test
- `pnpm test` ใน `STATUS.md` อ้างว่าผ่าน แต่รันตามเอกสารไม่ได้

**แนวทางแก้:** ลบไฟล์นี้ (โปรเจกต์เดี่ยวไม่ต้องมี workspace) หรือใส่ `packages: ["."]`
และ pin pnpm version ให้ตรงกับ lockfile

### B-11 (Medium) — เอกสารล้าสมัย/ขัดกับโค้ด
- `platform/docs/SECURITY.md`: "License keys: 100-bit", "Activation codes: 8 characters (40 bits)"
  → จริงคือ 240-bit (`newLicenseKey`, core.ts:70-90) และ 16 ตัวอักษร 80-bit (`newActivationCode`, core.ts:52-60)
- `SECURITY.md`/`THREAT-MODEL.md` ยังมี wallet, Stripe, PromptPay, payment webhook, HMAC shared secret
  ที่ไม่มีโค้ดแล้ว (ตาราง payment ถูกลบจาก UI แต่ schema ยังอยู่ — ดู B-13)
- จำนวน test ไม่ตรงกัน: README "15 tests", STATUS "14 platform tests", จริง **21 tests**
- README แนะนำ `pnpm install` ซึ่งล้มเหลว (B-10)

### B-12 — `pom.xml` ที่ root ว่างเปล่า
`/pom.xml` มีขนาด 0 byte; ใครรัน `mvn` ที่ root จะได้ error ที่สับสน ควรลบหรือใส่ aggregator

### B-13 (Medium) — schema ที่ไม่มีโค้ด
`wallets`, `wallet_transactions`, `topup_orders`, `payment_events`, `payment_orders`,
`payment_webhook_events`, `payment_slips` ยังอยู่ใน migrations 0001-0004 แต่ไม่มี route/service ใด
อ่านเขียนแล้ว → พื้นที่โจมตี/ความเข้าใจผิด และเป็นหนี้ทางเทคนิคตอน migrate

### B-14 — งานหนักบน main thread
- `/aegishider rescan` เรียก `rescanLoadedChunks(8192)` แบบ synchronous (`AegishiderPlugin.java:568-585`)
- `onChunkSwept` เรียก `player.sendBlockChange` ต่อบล็อก ต่อผู้เล่น (`AegishiderPlugin.java:404-460`)
ทั้งสองเป็นคำสั่ง admin แต่บนเซิร์ฟเวอร์ใหญ่จะทำให้ tick สะดุด

### B-15 — release เผยแพร่ทันที
`routes/admin.ts:512-540` สร้าง release ด้วย `status: "published"` เสมอ ไม่มี draft/unpublish

### B-16 — permission กว้างเกิน
`aegishider.admin` เดียวคุมทั้ง `status`, `license link` (แสดง activation code) และ `rescan`
ควรแยก `aegishider.admin.license` / `.diagnostics`

### B-17 — งบเวลาเกิน 100%
`securityTick` ให้ item 40% + block 45% + player 7.5% + tunnel 7.5% = 100% ของ budget
แล้วยังเรียก `processReconciliation()` ต่อ → เกินงบทุก tick (แม้เป็นงานเล็ก)

### B-18 (Medium) — config ปิดการป้องกันเงียบ ๆ
`ConfigLoader.parseWorld`: ถ้ามี section `block-protection:` แต่ไม่มี key `hidden-blocks`
จะได้ list ว่าง → `blocksEnabled = false` พร้อม warning ระดับ log เท่านั้น
ขัดกับหลัก "fail closed" (ผู้ดูแลแก้ config แล้วป้องกันหายโดยไม่รู้)

### B-19 — OG image hardcode
`platform/src/views/ui.ts:190-199` ใช้ `https://aegishider-platform.audijuju1.workers.dev/...`
แทน `APP_URL` → ผิดเมื่อย้ายโดเมน

### B-20 — analytics เลื่อนวัน
`services/admin.ts:95-160` ใช้ `strftime(..., 'unixepoch')` เป็น UTC แต่ UI แสดง
`Asia/Bangkok` → กราฟ 14 วันเหลื่อม 1 วันสำหรับเหตุการณ์ช่วง 00:00-07:00 น.

---

## 7. ความผิดปกติเชิงสถาปัตยกรรม

**A-01 เอกสารสองชุดไม่มีแหล่งความจริงเดียว**
`docs/01-11` (plugin) กับ `platform/docs/*` (platform) บรรยายระบบเดียวกันต่างเวอร์ชัน
(3.2.0/3.6.1/3.7.0) และขัดกับโค้ด (B-11) → ควรมี `docs/` เดียว + เวอร์ชันในเอกสารอ้าง `plugin.yml`

**A-02 (High) Admin auth split-brain**
- production: ต้องมี Cloudflare Access JWT + user ใน DB ที่ role เป็น staff
- dev: ใช้ session + `/auth/dev-admin`
- ไม่มี seed admin (`seed/seed.sql` ไม่มี `INSERT INTO users`) และไม่มี bootstrap flow สำหรับ production
  → deploy ใหม่จะได้ `/admin` = 503 จนกว่าจะมีคนรัน SQL เอง (STATUS.md ยอมรับว่า 503)
- `admin` vs `super_admin` ไม่ต่างกัน (M-09)

**A-03 multi-org เป็นผิว**
ทุกที่ใช้ `user.memberships[0]` (`routes/portal.ts`, `services/support.ts:60`,
`routes/admin.ts:283`) แม้ schema รองรับหลาย org → ถ้ามีการเพิ่ม org ที่สอง ข้อมูลจะไปลง org แรกเสมอ
ปนกันยาก

**A-04 ระบบ "ฟรี" แต่ schema ยังเป็น commerce**
`products.price_cents`, `product_plans`, `payment_*`, `wallet*`, `topup_orders` ไม่ถูกใช้ แต่ยัง
migrate ทุก environment (B-13) — ตัดออกหรือ mark deprecated

**A-05 monolith**
Worker ไฟล์เดียว 11.6k บรรทัดใน `src/`, route → service → SQL ตรง ๆ ไม่มี domain layer;
ทดสอบได้ดีแต่ขยายยาก (ไม่มี DI, ไม่มี repository abstraction)

**A-06 DLQ ไม่มี consumer**
`wrangler.jsonc` ตั้ง `dead_letter_queue: agcp-telemetry-dlq` แต่ `src/queue.ts` มี handler เดียว
และ `message.retry()` ไม่จำกัดด้วยตัวเอง (พึ่ง max_retries 3) → ข้อความที่ fail จะหายเข้า DLQ
โดยไม่มีใครประมวลผล/แจ้งเตือน

**A-07 fail-closed ไม่จริงทั้งระบบ**
ถ้าไม่มี PacketEvents: block protection = INACTIVE (fail-open สำหรับ container data) แต่
item protection ยังทำงาน; ข้อความ "fail closed" ใน README/ARCHITECTURE จึงจริงเฉพาะ packet path
ที่ active อยู่แล้ว

**A-08 World id ไม่ถูกคืน**
`WorldKeys` เพิ่มขึ้นเรื่อย ๆ ต่อ UUID และ `idOf` โยน `IllegalStateException` เมื่อเกิน 1,048,575
worlds — ในทางปฏิบัติไม่เกิด แต่ exception เกิดใน hot path (main thread) และไม่มี recovery

**A-09 observability**
มีแต่ `console.log` JSON; ไม่มี metrics/tracing sink (Sentry/OTel) ทั้งที่ `observability` เปิดใน
wrangler → incident response ต้องดู log ใน dashboard เท่านั้น

**A-10 CI ไม่ครอบคลุม**
`.github/workflows/ci.yml` ไม่มี: `wrangler deploy --dry-run` (เช็ค compatibility),
test ข้ามเวอร์ชัน MC/Java, build ของ `site/`, secret scan; และ job platform ล้มเพราะ B-10

**A-11 (Medium) repo hygiene**
commit ไฟล์ที่ควร build: `dist/*.jar` (13 ไฟล์), `aegishider-integrated/target/**` (class,
surefire reports), `bench/**` 1,912 ไฟล์ (รวม `PlaceBot-chunks/*.bin`), `.tools/apache-maven-3.9.9/**`
90 ไฟล์, `site/.qa/*.png` (ทั้งที่ `.gitignore` มี `.qa/`) → repo ใหญ่, ประวัติมี binary/ล็อกภายใน
และเสี่ยงรันไจาร์เก่าโดยไม่ตั้งใจ

**A-12 auth 3 ทางพร้อมกัน**
password + email link + OTP (ปิด) โดย recovery พึ่งอีเมลที่ยังใช้ `onboarding@resend.dev`
(ส่งได้เฉพาะเจ้าของบัญชี Resend) → ผู้ใช้ที่ลืมรหัสอาจกู้บัญชีไม่ได้จริงใน production

**A-13 `ADMIN_EMAILS` สองความหมาย**
ใช้เป็น dev bootstrap allowlist และถูกพูดถึงในเอกสารเหมือน production admin list
แต่ production ใช้ role ใน DB + Access email

**A-14 ไม่มี key rotation**
`signing_keys` รองรับหลาย key และ lease อ้าง `key_id` แต่ไม่มี UI/สคริปต์ rotate;
ฝั่ง plugin ไม่มีกลไกเปลี่ยน installation key (ต้องลบ `platform/` แล้ว pair ใหม่)

**A-15 dead code**
`readJson`, `escapeLike`, `pageCount`, `noStore`, `safeNextPath` (ซ้ำกับ `helpers.safeInternalPath`),
`getRecentSecurityEvents`, `countInstallationEvents`, `publicKeyDocument`, `requireInstallation`,
`listContactMessages`, `ticketMessagesMeta` — ไม่ถูกเรียก; เพิ่มภาระ review และทำให้ audited surface ไม่ชัด

---

## 8. สิ่งที่ตรวจแล้วไม่พบปัญหา (เพื่อความเป็นธรรม)

- XSS: template `html` escape ค่า interpolate ทั้งหมด; `raw()` ใช้กับค่าคงที่/icons เท่านั้น;
  Markdown escape ก่อน render และจำกัด scheme ของลิงก์ (`lib/markdown.ts:24-30`)
- SQL injection: ทุก query ใช้ `bind()`; ไม่มีการต่อ string จาก input
- Path traversal: `safeNextPath` กัน `//`, `\`, `/auth/`, `/api/`; R2 key ถูก sanitize
- Session: opaque 32-byte token, SHA-256 at rest, HttpOnly, SameSite=Lax, Secure ใน production,
  revoke ราย session/all-others, role เปลี่ยนมีผลทันทีเพราะ join users ทุกครั้ง
- Replay: nonce unique + timestamp ±300s + body hash ตรวจก่อน parse; tampered signature ถูกปฏิเสธ
  (มี test ยืนยัน 401/409)
- Secret scanning: ไม่พบ live key/token ในไฟล์ tracked (เจอแต่ `sk_test_dummy` ใน vitest config)

---

## 9. ลำดับการแก้ที่แนะนำ

**Week 1 (ช่องโหว่ High)**
1. H-01 บังคับ signed re-registration + invalidate challenge เก่า
2. H-02 ปิด/ป้องกัน `/auth/dev-admin` ด้วย flag + loopback
3. H-03 บังคับ verify email ก่อน password login
4. H-04 เพิ่ม `.prod-secrets.json` ใน `.gitignore` และย้ายการเขียนไฟล์ออกนอก repo
5. B-10 แก้ `pnpm-workspace.yaml` เพื่อให้ CI กลับมาเขียว
6. H-05 ลบ artefact เก่า/แก้ `_headers`

**Week 2 (ข้อมูลและสิทธิ์)**
7. B-01/H-06 partial unique index + UPSERT + นับ limit ในคำสั่งเดียว
8. B-02 กรองเซิร์ฟเวอร์ใน SQL
9. M-09 แยกสิทธิ์ admin/super_admin + กัน last-admin
10. B-05 unique index ของ licence ฟรี
11. M-07 จำกัดผู้เห็น raw key + one-time view

**Week 3 (hardening)**
12. M-02/M-03/M-04/M-05/M-13, B-18, B-07 retention
13. A-02 seed/bootstrap admin + A-06 DLQ handler + A-11 ล้าง binary ออกจาก git history (BFG)

---

## 10. ข้อจำกัดของการตรวจครั้งนี้

- ไม่ได้ build/รันชุดทดสอบ Java (ต้องมี JDK 21 + Maven + network) — ผล `mvn verify` ของ CI
  จึงอ้างอิงจาก surefire report ที่ commit ไว้ (`target/surefire-reports`, 123 tests) ไม่ใช่การรันสด
- ไม่ได้ทดสอบกับ Cloudflare จริง (KV/R2/Queues/Access/Turnstile/Resend) — ข้อสรุปด้าน provider
  มาจากการอ่านโค้ดและการจับคู่ config
- ไม่ได้ทำ DAST/fuzzing/load test; ประเด็น race (H-06, B-05) วิเคราะห์จากโค้ดและ schema
  ไม่ได้ reproduce ด้วยคำขอพร้อมกันจริง
- Java packet path (`PacketEventsGateway` 1,287 บรรทัด, `ItemShield` 1,006 บรรทัด) ตรวจแบบ
  targeted (grep + จุดเชื่อมต่อ) ไม่ได้อ่านทุกบรรทัด

---

## 11. สถานะการแก้ไข (2026-11-19)

แก้เฉพาะ **บัคเชิงฟังก์ชัน (B-series)** ทั้งหมดที่แก้ได้ในโค้ด โดยไม่แตะพฤติกรรมด้านความปลอดภัย
ที่มีการออกแบบไว้ (H/M/A-series ยังเปิดอยู่)

| ID | สถานะ | สิ่งที่เปลี่ยน |
|---|---|---|
| B-01 / H-06 | แก้แล้ว | `claimActivationInner` เปลี่ยน INSERT เป็น UPSERT `ON CONFLICT (license_id, installation_id) DO UPDATE` (คืนแถวที่ `released` กลับเป็น `active`) และนับ `activation_limit` ในคำสั่งเดียว → reset แล้วเปิดใหม่ได้ และปิด race ของ limit |
| B-02 | แก้แล้ว | `/admin/customers/:id` ส่ง `q = email` ลง SQL (`listAdminInstallations` ค้น email/org เพิ่ม) แทนการกรอง 100 แถวแรกในหน่วยความจำ |
| B-03 | แก้แล้ว | `HiddenBlockIndex.snapshotByWorld()` คืน `Map<worldId, long[]>`; `revealPositionsToViewers` ใช้เฉพาะ position ของโลกที่ผู้เล่นอยู่ |
| B-04 | แก้แล้ว | ทุก `LIKE` ใน `services/admin.ts`, `services/catalog.ts`, `services/telemetry.ts` ประกาศ `ESCAPE '\'` |
| B-05 | แก้แล้ว | `issueLicense({ onlyIfNoActive: true })` ตรวจ "ไม่มี licence active ของ org+product" ใน `INSERT ... SELECT ... WHERE NOT EXISTS`; ถ้าแพ้ race จะ re-select แล้วคืนใบที่มีอยู่ |
| B-06 | แก้แล้ว | `createActivationChallenge` mark challenge เก่าที่ `consumed_at IS NULL` เป็น consumed ก่อนออกใบใหม่ |
| B-07 | แก้แล้ว | scheduled cleanup ลบ `license_leases` (หมดอายุ > 7 วัน), `security_events`, `email_log`, `heartbeat_latest` (ตาม retention), `job_runs` (> 90 วัน), `activation_guard` (> 7 วัน และไม่ถูกล็อก) |
| B-08 | แก้แล้ว | `PlatformService.flushEvents` เปลี่ยน `pollLast()` → `pollFirst()` ให้ตรงกับ `recordEvent` (ทิ้งเก่าสุด ไม่ทิ้งใหม่สุด) |
| B-09 | แก้แล้ว | `site/public/_headers`: wildcard ไม่ตั้ง `Content-Disposition` อีก ใช้ block รายไฟล์ (`/download/Aegishider-3.6.1.jar`) |
| B-10 | แก้แล้ว | `platform/pnpm-workspace.yaml` เพิ่ม `packages: ["."]` (ทดสอบ `pnpm list` ผ่านแล้ว) |
| B-11 | แก้แล้ว | `SECURITY.md` (หัวข้อซ้ำ, payment provider, `ESCAPE`), `THREAT-MODEL.md` (ลบ webhook/wallet/top-up), `README.md`/`STATUS.md` (คำสั่ง `pnpm install`, จำนวนเทสต์ 22) |
| B-12 | แก้แล้ว | ลบ `pom.xml` ที่ root (0 byte) |
| B-13 | เลื่อน (ตั้งใจ) | ตาราง payment/wallet/topup ถูก mark deprecated ใน `platform/docs/DATABASE.md` แต่ **ไม่ drop** เพราะ migration ที่ลบตารางเป็นการทำลายข้อมูลใน production แบบย้อนกลับไม่ได้ |
| B-14 | แก้แล้วบางส่วน | `rescanLoadedChunks` จำกัดเวลาด้วย `mainThreadBudgetMs` แล้ว ที่เหลือให้ reconciliation ราย tick ดูดต่อ; `onChunkSwept` ยังส่ง `sendBlockChange` ต่อบล็อก (ต้องออกแบบ batching เพิ่ม) |
| B-15 | เลื่อน | ต้องมี draft/unpublish flow + UI (เป็นฟีเจอร์ ไม่ใช่บัคเชิงตรรกะ) |
| B-16 | เลื่อน | การแยก permission `aegishider.admin.license`/`.diagnostics` ต้องอัปเดต `plugin.yml`, เอกสาร และ config ของผู้ใช้ |
| B-17 | แก้แล้ว | งบ engine เหลือ 35/40/7.5/7.5 = 90% เหลือ 10% ให้ `processReconciliation` |
| B-18 | แก้แล้ว | `block-protection:` ที่ไม่มี `hidden-blocks` ใช้ built-in default + warning แทนการปิดการป้องกันเงียบ ๆ (ถ้าตั้ง `enabled: false` ยังปิดตามที่ผู้ดูแลสั่ง) |
| B-19 | แก้แล้ว | `layout()` รับ `baseUrl` (ส่ง `APP_URL` จาก `publicPage`/`appPage`) ใช้ทำ `og:image`/`twitter:image` |
| B-20 | แก้แล้ว | analytics bucket ใช้ `'+7 hours'` ทั้งใน SQL และการสร้าง bucket ฝั่ง JS |

**การตรวจหลังแก้:** `tsc --noEmit` ผ่าน, `vitest run` ผ่าน **23 tests / 3 files**
(เพิ่ม regression test: re-register ต้องเหลือ challenge เดียว, reset แล้ว claim ซ้ำต้องได้ `active` คืน)
และแก้ test ที่ตรวจ tampered signature ให้ flip byte จริง (เดิมเขียนทับตัวอักษร base64 ตัวแรก
ซึ่งบางครั้งได้ byte เดิม → เทสต์ flaky)

**ตรวจ Java แล้ว (รอบที่สอง):** ติดตั้ง Temurin JDK 21.0.13 + Maven 3.9.9 แล้วรัน `mvn -B test` กับสำเนา source
(ไม่แตะ `target/` ที่ commit ไว้) → **BUILD SUCCESS, 123 tests / 0 failures**

---

## 12. สถานะช่องโหว่ High (แก้ครบ 2026-11-19)

| ID | สถานะ | สิ่งที่เปลี่ยน |
|---|---|---|
| H-01 | แก้แล้ว | `/api/v1/installations/register` แยก `verifySignedBody()` ออกมาใช้กับ body ที่อ่านแล้ว; ถ้า installation มีอยู่ **ต้อง** มีลายเซ็น Ed25519 ของกุญแจเดิม (path `/api/v1/installations/register`, nonce เดียว, ±300s) มิฉะั้น 401. `registerInstallation()` ยังกันอีกชั้นด้วย `signedReregistration`. ปลั๊กอิน (`PlatformClient.register`) เปลี่ยนมาใช้ `signedPost` ทุกครั้ง. ปลอม uuid/public key เพื่อขอรหัสใหม่ไม่ได้แล้ว |
| H-02 | แก้แล้ว | `/auth/dev-admin` ตอบ 404 เว้นแต่ `ENVIRONMENT != production` **และ** `DEV_BOOTSTRAP=1` **และ** token ตรงกับ `DEV_ADMIN_TOKEN` (16+ ตัว, header `x-dev-admin-token` หรือ `?token=`) ใช้ `timingSafeEqual`; ความพยายามที่ผิดถูกบันทึกเป็น `auth.dev_admin_denied`. เพิ่มตัวแปรใน `.dev.vars.example` + README/DEPLOYMENT |
| H-03 | แก้แล้ว | ปิด pre-account-takeover ที่ต้นทาง: `/auth/register` **ไม่รับรหัสผ่านแล้ว** (สมัครด้วยอีเมล → ยืนยันผ่านลิงก์ → ตั้งรหัสที่ `/app/account`), password login ถูกปฏิเสธเมื่อ `email_verified_at` เป็น NULL และเมื่อยืนยันอีเมลสำเร็จจะล้างรหัสผ่านที่ถูกตั้งก่อนการยืนยัน (`clearUnverifiedPassword`) → รหัสของ attacker ใช้ไม่ได้อีก |
| H-04 | แก้แล้ว | `.gitignore` ทั้ง root และ `platform/` มี `.prod-secrets.json` + `*.secrets.json`; `scripts/cf-prod-secrets.mjs` เขียนไฟล์ไปที่ `os.tmpdir()` โหมด 0600 แทน working directory |
| H-05 | แก้แล้ว | ลบไจาร์เก่าออกจากที่เสิร์ฟจริง: `platform/public/download/Aegishider-{3.2.0,3.6.0}.jar` และ `dist/*.jar` ทั้งหมด (เหลือ 3.6.1 ที่เป็น build ปัจจุบัน); `_headers` ตั้งชื่อไฟล์รายไฟล์แล้ว; seed SQL ไม่ลิงก์ไฟล์ที่ถูกลบ (artifact_url = NULL) |
| H-06 | แก้แล้ว | ดู B-01 (UPSERT + นับ limit ในคำสั่งเดียว) |

### 3 ข้อท้ายที่ขอเพิ่ม

- **B-15 draft/unpublish**: `POST /admin/releases` รับ `status` (`draft`/`published`), เพิ่ม `POST /admin/releases/:id/status`
  พร้อม audit และปุ่ม “เผยแพร่/ถอนเผยแพร่” ในตาราง; `/release/:id/download` เสิร์ฟเฉพาะ `published` อยู่แล้ว
- **B-16 แยก permission ปลั๊กอิน**: เพิ่ม `aegishider.admin.license` (คำสั่ง `license`) และ `aegishider.admin.diagnostics`
  (`rescan`) ใน `plugin.yml` โดยเป็น child ของ `aegishider.admin` (ค่าเริ่มต้นเท่าเดิม แต่ถอนรายตัวได้)
- **รันเทสต์ Java จริง**: Temurin 21.0.13 + Maven 3.9.9 → `BUILD SUCCESS`, 123 tests / 0 failures

### ตรวจซ้ำหลังแก้ทั้งหมด

- `tsc --noEmit` → ผ่าน
- `vitest run` → **23 tests / 3 files ผ่าน** (เพิ่มเทสต์: gate ของ unverified password, การล้างรหัสก่อนยืนยัน,
  signed re-registration + reset/reactivate, และแก้เทสต์ tampered signature ที่ flaky)
- `pnpm install --frozen-lockfile` → ผ่าน (workspace config ใช้ได้)
- `mvn -B test` (Java 21) → 123/123 ผ่าน

## 13) Medium findings — ปิดครบ (M-01 … M-13)

| ID | สถานะ | รายละเอียดที่แก้ |
|---|---|---|
| M-01 | แก้แล้ว | `POST /auth/register` จำกัด body 16 KB; endpoint JSON อื่นใช้ `readJson` 64 KB |
| M-02 | แก้แล้ว | `hashIp()` ใช้ `IP_HASH_PEPPER` (fallback `LICENSE_KEY_PEPPER`) และ fail-closed ใน production แทน pepper ค่าคงที่ |
| M-03 | แก้แล้ว | `verifyAccessJwt()` บังคับ `iss` — JWT ที่ไม่มี issuer ถูกปฏิเสธ |
| M-04 | แก้แล้ว | Turnstile ตรวจ `hostname` เทียบ `APP_URL` และอายุ `challenge_ts` ไม่เกิน 5 นาที |
| M-05 | แก้แล้ว | ลิงก์อีเมลเป็น GET ที่แสดงหน้าคอนเฟิร์มเท่านั้น; session เกิดจาก `POST /auth/verify` ที่มี CSRF + rate limit 30/15 นาที; CSRF allowlist ตัด `Host` เหลือ `APP_URL` (เพิ่ม `Host` เฉพาะ non-production) |
| M-06 | ยอมรับความเสี่ยง (เอกสาร) | PBKDF2-SHA256 100,000 รอบคือเพดานของ Workers — ชดเชยด้วย rate limit, นโยบายรหัสผ่าน 10 ตัว และ error แบบ generic; บันทึกใน `SECURITY.md` |
| M-07 | แก้แล้ว | คีย์ดิบใน KV อายุ 10 นาที, อ่านแล้วลบทันที (แสดงครั้งเดียว) และ read-only member ไม่เห็นคีย์ |
| M-08 | แก้แล้ว | `POST /auth/verify` มี rate limit ต่อ IP hash; `GET /app` ไม่เขียน D1 อีก (สร้าง free licence ที่หน้า licences/activation) |
| M-09 | แก้แล้ว | `admin` ไม่มี `settings.write`; เฉพาะ `super_admin` ตั้ง role admin/super_admin; กัน demote/disable last admin |
| M-10 | แก้แล้ว | เปลี่ยนสถานะตั๋วซัพพอร์ตเขียน audit (`ticket.status`); ถ้าเขียน audit ไม่ได้จะ fallback ลง `security_events` |
| M-11 | แก้แล้ว | `/release/:id/download` จำกัด 120 ครั้ง/ชม. ต่อ IP hash + `nosniff`; sha256 ของ artifact ยังประกาศคู่ทุก release |
| M-12 | แก้แล้ว | `verifySignedBody()` ปฏิเสธ installation ที่ `suspended` เช่นเดียวกับ `revoked` |
| M-13 | แก้แล้ว | แยก pepper ตามวัตถุประสงค์ (IP / licence / OTP) พร้อม domain prefix ใน HMAC ทุกจุด |

### ยังเปิดอยู่โดยเจตนา

- **อัปเดต พ.ย. 2026 (Wave 1–3):** A-02 ปิดแล้วด้วย CLI bootstrap, A-03 ปิดด้วย `primaryMembership()` +
decision single-org, A-12 ปิดด้วย recovery codes/TOTP แทนอีเมล (ไม่ใช้ Resend), M-04 ปิดด้วยการตรวจ
Turnstile `action` ทุกฟอร์ม, P1-5 ปิดด้วย `LICENSE` — ดูสถานะล่าสุดใน
  [`docs/13-architecture-roadmap.md`](13-architecture-roadmap.md)
- A-01 แก้บางส่วนแล้ว (index/แหล่งความจริงที่ `platform/docs/README.md`; ยังเหลือ dedupe เนื้อหา)
- A-04…A-11 และ A-13…A-15 ยังเปิดอยู่ — แปลงเป็นแผนงานพร้อมเกณฑ์ยอมรับใน roadmap เดียวกัน
  (history rewrite, observability sink, ระดับการแยกชั้นโค้ด ฯลฯ)
- ปลั๊กอินยังไม่ตรวจ signature ของ artifact ก่อนรันครั้งแรก (มี sha256 pin + download limit แทน)
