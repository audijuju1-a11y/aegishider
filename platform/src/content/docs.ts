export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  category: string;
  updated: string;
  markdown: string;
}

export const docs: DocPage[] = [
  {
    slug: "getting-started",
    title: "เริ่มต้นใช้งาน",
    summary: "สร้างบัญชี รับไลเซนส์ และเชื่อมเซิร์ฟเวอร์เครื่องแรก",
    category: "เริ่มต้น",
    updated: "2026-11",
    markdown: `
# เริ่มต้นใช้งาน Aegishider Control Platform

แพลตฟอร์มนี้ใช้สำหรับรับไลเซนส์ฟรี เปิดใช้งานบนเซิร์ฟเวอร์ และติดตามสุขภาพของเซิร์ฟเวอร์ที่เชื่อมต่อ — ไม่มีระบบชำระเงิน

## 1. สมัครและเข้าสู่ระบบ

1. เปิดหน้า **สมัครบัญชี** กรอกอีเมลและรหัสผ่าน (อย่างน้อย 10 ตัวอักษร มีตัวอักษรและตัวเลข)
2. ระบบสร้างบัญชี องค์กร และไลเซนส์ฟรีให้ทันที
3. เข้าสู่ระบบครั้งถัดไปด้วยอีเมลและรหัสผ่าน

ระบบใช้ **อีเมล + รหัสผ่านเท่านั้น** — ไม่ต้องรออีเมลยืนยัน บัญชีเดิมที่ยังไม่มีรหัสผ่าน
สามารถกรอกรหัสผ่านใหม่ได้ที่หน้าสมัคร (เฉพาะบัญชีที่ยังไม่เคยยืนยันและยังไม่มีรหัสผ่าน)

## 2. รับไลเซนส์

- ทุกบัญชีได้รับไลเซนส์ฟรีอัตโนมัติเมื่อเข้าใช้งานครั้งแรก
- กด **รับไลเซนส์ฟรี** ในเมนู **ไลเซนส์** เพื่อสร้างเพิ่มได้ทุกเมื่อ
- รหัสไลเซนส์แบบยาวจะแสดงให้คัดลอกภายใน 7 วันหลังสร้าง

## 3. เชื่อมเซิร์ฟเวอร์

1. ติดตั้งปลั๊กอิน Aegishider และ PacketEvents บนเซิร์ฟเวอร์ Paper 1.21.1 – 26.3
2. รันคำสั่ง \`/aegishider license link\`
3. ปลั๊กอินจะแสดง **รหัสเปิดใช้งาน 16 ตัวอักษร** และที่อยู่พอร์ทัล
4. เปิดพอร์ทัล → **การเปิดใช้งาน** → กรอกรหัส (ระบบจะออกไลเซนส์ฟรีให้ถ้ายังไม่มี)
5. กลับไปที่เซิร์ฟเวอร์ รอให้ปลั๊กอินต่ออายุใบอนุญาต (ปกติภายใน 1–5 นาที)

## 4. ตรวจสอบสถานะ

ในพอร์ทัล เมนู **เซิร์ฟเวอร์** จะแสดง:

- สถานะการเชื่อมต่อและ heartbeat ล่าสุด
- เวอร์ชันปลั๊กอินและ Minecraft
- TPS / MSPT ที่ปลั๊กอินรายงาน
- เหตุการณ์ล่าสุดและข้อผิดพลาด

หากไม่เห็นข้อมูล ให้ตรวจว่าไฟร์วอลล์ของเซิร์ฟเวอร์อนุญาต outbound HTTPS ไปยังแพลตฟอร์ม
`.trim(),
  },
  {
    slug: "aegishider",
    title: "ติดตั้ง Aegishider บนเซิร์ฟเวอร์",
    summary: "สิ่งที่ต้องมี วิธีติดตั้ง และคำสั่งที่ใช้บ่อย",
    category: "ผลิตภัณฑ์",
    updated: "2026-11",
    markdown: `
# ติดตั้ง Aegishider 4.0.5

## สิ่งที่ต้องมี

| รายการ | ต้องมี |
|---|---|
| เซิร์ฟเวอร์ | Paper 1.21.1 – 26.3 |
| Java | 21 (Paper 26.x รันด้วย Java 25) |
| PacketEvents | 2.14.0 ขึ้นไป (สำหรับซ่อนบล็อก) |
| Folia | ไม่รองรับ |

> 4.0.5 มี **6 ไฟล์**: \`mc1.21.1\`, \`mc1.21.4\`, \`mc1.21.5\`, \`mc1.21.11\`, \`mc26.1\`, \`mc26.3\` — เลือกให้ตรงรุ่นเซิร์ฟเวอร์ ห้ามใช้ไฟล์ข้ามรุ่น

## ขั้นตอน

1. ดาวน์โหลดไฟล์ที่ตรงกับเวอร์ชันเซิร์ฟเวอร์ (1.21.1 – 26.3) จากหน้าผลิตภัณฑ์
2. วางในโฟลเดอร์ \`plugins/\`
3. ดาวน์โหลด PacketEvents 2.14.0 ขึ้นไป แล้ววางใน \`plugins/\` เช่นกัน
4. รีสตาร์ทเซิร์ฟเวอร์
5. รัน \`/aegishider license link\` แล้วนำรหัส 16 ตัวไปกรอกที่หน้า การเปิดใช้งาน บนเว็บ
6. รัน \`/aegishider license refresh\` เพื่อรับ lease ที่เซ็นชื่อ
7. รัน \`/aegishider status\` และตรวจว่า protection ขึ้น **ACTIVE**

> 4.0.5 บังคับ enforcement=enforce: ถ้ายังไม่ activate, protection จะไม่เริ่มทำงาน (เปลี่ยนเป็น warn/ปิดได้ใน platform.yml)

## 1.21.5 ขึ้นไป

- **1.21.5** → ใช้ \`mc1.21.5\` (Java 21)
- **1.21.11** → ใช้ \`mc1.21.11\` (Java 21)
- **26.1.x** → ใช้ \`mc26.1\` (Java 25)
- **26.3** → ใช้ \`mc26.3\` (Java 25)
- รุ่นที่ไม่มีการบิลด์ในรายการนี้ (เช่น 1.21.6–1.21.10 หรือ 26.2) **ยังไม่รองรับ** — อย่าคาดเดาจากเลขรุ่น ให้ดู [Compatibility Matrix](/docs/compatibility) ก่อนอัปเกรด

> ตั้งแต่ 1.21.5 ขึ้นไป ตัว plugin ใช้ chunk/block-state API ของรุ่นนั้นโดยตรง; ถ้าใส่ไฟล์ผิดรุ่น เซิร์ฟเวอร์จะปิด block protection และแจ้งใน \`/aegishider status\`

## คำสั่ง

- \`/aegishider status\` — ภาพรวมทุกโมดูล
- \`/aegishider diag\` — ตัวเลขละเอียดและ watchdog
- \`/aegishider stats\` — p50/p95/p99
- \`/aegishider verify\` — เทียบดัชนีกับโลกจริง
- \`/aegishider rescan\` — ค้นหาของที่ต้องซ่อนใหม่
- \`/aegishider export\` — สร้าง diagnostics.json
- \`/aegishider reload\` — โหลดคอนฟิกใหม่
- \`/aegishider viewer [player]\` — ตรวจว่าทำไมบล็อกหนึ่งถูกซ่อน/เปิดเผย
- \`/aegishider deep\` — สถิติเชิงลึก
- \`/aegishider license link|status|refresh|verify\` — เชื่อม/ตรวจสอบไลเซนส์และ jar integrity
- \`/aegishider help\` — รายการคำสั่งทั้งหมด

## ค่าเริ่มต้นที่สำคัญ

\`\`\`yaml
security:
  fail-closed: true
  main-thread-budget-ms: 1.5
  raycast-budget-per-tick: 180
security:
  fail-closed: true
  main-thread-budget-ms: 1.5
  raycast-budget-per-tick: 180
worlds:
  default:
    block-protection:
      reveal:
        max-distance: 24.0
        fov-degrees: 360.0
    item-protection:
      reveal:
        max-distance: 24.0
        fov-degrees: 360.0
    y-shield:
      enabled: true
      hide-below-y: 40
    tunnel-shield:
      enabled: false
\`\`\`

## ข้อจำกัดที่ควรรู้

- player-protection (ซ่อนผู้เล่นด้วยกัน) ปิดเป็นค่าเริ่มต้น — เปิดเองได้หากต้องการ anti player-ESP
- ไม่กรองเสียง/อนุภาคของการเปิดหีบ
- y-shield และ tunnel-shield ปิดเป็นค่าเริ่มต้น (opt-in) เพราะมีผลกับภาพโลกและการเล่น
- ไอเท็มที่ซ่อนยังเก็บได้จริงฝั่งเซิร์ฟเวอร์
`.trim(),
  },
  {
    slug: "licensing",
    title: "ไลเซนส์และการเปิดใช้งาน",
    summary: "สถานะไลเซนส์ จำนวนเซิร์ฟเวอร์ ใบอนุญาตชั่วคราว และการรีเซ็ต",
    category: "ไลเซนส์",
    updated: "2026-11",
    markdown: `
# ไลเซนส์และการเปิดใช้งาน

## สถานะของไลเซนส์

| สถานะ | ความหมาย |
|---|---|
| ใช้งาน | เปิดใช้งานได้ และต่ออายุใบอนุญาตได้ |
| รอดำเนินการ | สร้างแล้วแต่ยังไม่ได้เชื่อมกับเซิร์ฟเวอร์ |
| ระงับ | หยุดชั่วคราวโดยทีมงาน |
| เพิกถอน | ใช้ไม่ได้ถาวร (เช่น ตรวจพบการละเมิด) |
| หมดอายุ | เกินวันหมดอายุ |

## จำนวนเซิร์ฟเวอร์

แต่ละไลเซนส์มี **activation limit** กำหนดจำนวนเซิร์ฟเวอร์ที่เปิดใช้งานพร้อมกันได้
หากครบจำนวน ให้ **รีเซ็ตการเปิดใช้งาน** ของเครื่องที่ไม่ใช้แล้วในพอร์ทัล

## ใบอนุญาตชั่วคราว (lease)

ปลั๊กอินจะขอใบอนุญาตที่ลงลายเซ็นด้วย Ed25519 จากแพลตฟอร์ม:

- อายุเริ่มต้น 24 ชั่วโมง และต่ออายุอัตโนมัติ
- ตรวจลายเซ็นในเครื่องด้วยกุญแจสาธารณะที่แพลตฟอร์มให้
- ทำงานต่อได้ชั่วคราวแม้แพลตฟอร์มล่ม (offline grace 72 ชั่วโมงตามค่าเริ่มต้น)

**ข้อจำกัด:** หากเพิกถอนไลเซนส์ ขณะที่เซิร์ฟเวอร์ออฟไลน์และยังมีใบอนุญาตที่ยังไม่หมดอายุ
การเพิกถอนจะยังไม่มีผลจนกว่าเครื่องจะต่ออายุครั้งถัดไป

## อายุการใช้งานของไลเซนส์

- ไลเซนส์ฟรีไม่มีวันหมดอายุตามปกติ ใช้งานได้ต่อเนื่องจนกว่าจะมีการเปลี่ยนหรือยกเลิก
- ผู้ให้บริการอาจเปลี่ยน แก้ไข หรือเพิกถอนไลเซนส์/คีย์ได้ทุกเมื่อ โดยแจ้งผ่านหน้าเว็บหรือพอร์ทัล
- การเพิกถอนมีผลกับ lease ใหม่ทันที; เครื่องที่ออฟไลน์ยังใช้ lease เดิมได้จนหมดอายุ + offline grace

## รหัสเปิดใช้งาน

- เป็นรหัส 16 ตัวอักษร สุ่ม 80 บิต ใช้ได้ครั้งเดียว และหมดอายุใน 24 ชั่วโมง
- ใช้ผูก installation เข้ากับไลเซนส์ของคุณ
- หากหมดอายุ ให้รัน \`/aegishider license link\` ใหม่
- การกรอกรหัสผิดซ้ำ ๆ จะถูกจำกัดอัตราและล็อกชั่วคราว พร้อมบันทึกเหตุการณ์เพื่อตรวจสอบ

## ความปลอดภัยของกุญแจ

- Private key ของเซิร์ฟเวอร์เก็บอยู่ที่ \`plugins/Aegishider/platform/private.key\` (สิทธิ์ 0600 บน Linux)
- Private key ของแพลตฟอร์มอยู่ใน secret ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยส่งให้ลูกค้า
- ห้ามคัดลอกโฟลเดอร์ \`platform/\` ไปยังเซิร์ฟเวอร์อื่น — จะทำให้ fingerprint ซ้ำและถูกตรวจพบ
`.trim(),
  },
  {
    slug: "telemetry",
    title: "Telemetry และความเป็นส่วนตัว",
    summary: "ข้อมูลอะไรถูกส่ง ใช้ทำอะไร และปิดได้อย่างไร",
    category: "ความเป็นส่วนตัว",
    updated: "2026-11",
    markdown: `
# Telemetry และความเป็นส่วนตัว

## ข้อมูลที่ส่ง

- เวอร์ชันปลั๊กอิน, เวอร์ชัน Minecraft, แพลตฟอร์ม, เวอร์ชัน Java
- โมดูลที่เปิดใช้งาน
- ตัวเลขประสิทธิภาพ: TPS, MSPT p50/p95/p99, เวลางานของปลั๊กอิน
- จำนวนผู้เล่นออนไลน์ (ตัวเลขรวม ไม่มีรายชื่อ)
- สรุปต่อโลก: ชื่อโลก, environment, จำนวนผู้เล่น/chunks/entities (ตัวเลขรวม)
- จำนวนปลั๊กอินที่โหลด (ไม่ส่งรายชื่อปลั๊กอิน)
- เหตุการณ์ผิดพลาด/ความปลอดภัยที่คัดกรองแล้ว (ข้อความและ attribute แบบ scalar)

## ข้อมูลที่ไม่ส่ง

- ชื่อผู้เล่น, UUID ผู้เล่น, IP ผู้เล่น
- แชท, inventory, พิกัดโลก/ฐาน
- ไฟล์คอนฟิกทั้งไฟล์ หรือข้อมูลส่วนตัวใด ๆ

## ความถี่

- Heartbeat ทุก ~3 นาที (มี jitter)
- Events ส่งเป็นชุด ไม่เกิน 50 รายการต่อครั้ง
- ข้อมูลถูกเก็บแบบ aggregate และ raw archive ตามนโยบาย retention (เริ่มต้น 90 วัน)

## การควบคุม

- ผู้ดูแลเซิร์ฟเวอร์ปิด telemetry ได้ใน \`license.yml\` (\`telemetry.enabled: false\`)
- การปิด telemetry ไม่กระทบการป้องกันหีบ/ไอเท็ม
- ข้อมูลวินิจฉัยภายในเครื่อง (\`diagnostics.json\`) ไม่ถูกส่งออกอัตโนมัติ

## การเข้าถึง

- ลูกค้าเห็นเฉพาะข้อมูลขององค์กรตัวเอง
- ทีมงานเห็นข้อมูลตามสิทธิ์ และทุกการกระทำสำคัญถูกบันทึกใน audit log

## คำถามที่พบบ่อย

**ปิด telemetry แล้วไลเซนส์ยังใช้ได้ไหม?** ได้ — การตรวจไลเซนส์เป็นคนละเส้นทางกับ telemetry
**ข้อมูลถูกลบเมื่อไหร่?** ตาม retention ที่ตั้งไว้ และลบได้ตามคำขอผ่านช่องทางสนับสนุน
`.trim(),
  },
  {
    slug: "security",
    title: "ความปลอดภัยของแพลตฟอร์ม",
    summary: "หลักการออกแบบ การยืนยันตัวตน และการรายงานช่องโหว่",
    category: "ความปลอดภัย",
    updated: "2026-11",
    markdown: `
# ความปลอดภัยของแพลตฟอร์ม

## หลักการ

1. **Fail closed** — เมื่อไม่แน่ใจ ระบบจะปฏิเสธ ไม่ใช่ปล่อยผ่าน
2. **Least privilege** — สิทธิ์ผู้ดูแลแยกตามบทบาท และตรวจทุกครั้งที่เรียก API
3. **Tenant isolation** — ทุกคำสั่งของลูกค้าถูกจำกัดด้วย org_id ไม่เชื่อค่าจากฟรอนต์เอนด์
4. **No secrets in client** — private signing key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น

## การยืนยันตัวตน

- ลูกค้า: email + password เท่านั้น (PBKDF2-SHA256)
- Session: cookie แบบ HttpOnly + SameSite=Lax + CSRF double-submit
- ผู้ดูแล: เข้าสู่ระบบด้วย email+password แล้วตรวจบทบาทในฐานข้อมูล; ชั้นเสริมภายนอกเป็นทางเลือกและไม่เปิดเผยต่อสาธารณะ
- คำขอจากปลั๊กอิน: Ed25519 signature + timestamp + nonce กัน replay

## กุญแจและลายเซ็น

- ไลเซนส์ใช้ Ed25519; public key เผยแพร่ที่ \`/api/v1/license/keys\`
- รองรับ key rotation ผ่าน \`signing_keys.key_id\`
- License key เก็บเป็น HMAC-SHA256 hash ไม่เก็บ plaintext
- รหัสเปิดใช้งานเก็บเป็น hash และใช้ได้ครั้งเดียว

## การป้องกันที่ใช้งาน

- Rate limiting ต่อ IP/อีเมลในเส้นทางสำคัญ
- CSP, HSTS (โปรดักชัน), X-Content-Type-Options, Referrer-Policy
- ผู้ใช้ทั่วไปอัปโหลดไฟล์ไม่ได้; ผู้ดูแลอัปโหลดรีลีส .jar ที่ตรวจชนิด/ขนาด/ส่วนหัวไฟล์
- ไม่ fetch URL จากผู้ใช้ (กัน SSRF)
- Audit trail สำหรับการกระทำของผู้ดูแล

## การรายงานช่องโหว่

ส่งรายละเอียดผ่านหน้า /contact พร้อมขั้นตอนทำซ้ำ หรือดูช่องทางใน /.well-known/security.txt
อย่าเปิดเผยรายละเอียดต่อสาธารณะก่อนได้รับอนุญาต — เราไม่มีโปรแกรมตอบแทนที่ประกาศไว้ จะแจ้งเป็นรายกรณี
`.trim(),
  },
  {
    slug: "api",
    title: "API สำหรับปลั๊กอิน",
    summary: "ปลายทาง, การลงนามคำขอ และรูปแบบใบอนุญาต",
    category: "นักพัฒนา",
    updated: "2026-11",
    markdown: `
# API สำหรับปลั๊กอิน

Base URL: \`https://<โดเมนแพลตฟอร์ม>/api/v1\`

## การลงทะเบียน

\`POST /installations/register\`

\`\`\`json
{
  "product": "aegishider",
  "installation_uuid": "3f1c2a90-...",
  "public_key": "<base64 SPKI DER>",
  "fingerprint_sha256": "<hex>",
  "plugin_version": "4.0.5",
  "minecraft_version": "1.21.11",
  "platform": "Paper",
  "java_version": "21"
}
\`\`\`

ตอบกลับด้วย \`installation_id\`, \`activation_code\`, \`activation_expires_at\`, \`portal_url\`

## คำขอที่ต้องลงนาม

- \`POST /installations/lease\`
- \`POST /installations/heartbeat\`
- \`POST /installations/events\`

Header:

- \`X-AG-Installation\`: installation UUID
- \`X-AG-Timestamp\`: Unix seconds
- \`X-AG-Nonce\`: base64url 32 ไบต์ (ใช้ครั้งเดียว)
- \`X-AG-Signature\`: base64 Ed25519

Worker รับ header ชุดเดิม \`X-BH-*\` ของ BaseHider ด้วย แต่ต้องส่ง prefix เดียวกันทั้งชุด ห้ามผสม

ข้อความที่ลงนาม:

\`\`\`
METHOD + "\\n" +
pathname + "\\n" +
installation_uuid + "\\n" +
timestamp + "\\n" +
nonce + "\\n" +
lowercase_hex_sha256(rawBodyBytes)
\`\`\`

## Lease

\`{ "lease": "<payloadB64url>.<sigB64url>", "key_id": "...", "expires_at": 1730000000, "keys": [...] }\`

Payload คือ JSON canonical ที่มี \`license_id\`, \`installation_uuid\`, \`entitlements\`, \`issued_at\`, \`expires_at\`, \`key_id\`
ตรวจลายเซ็นจากไบต์ของ payload โดยตรง (ไม่ต้อง serialize ใหม่)

## Public keys

\`GET /license/keys\` → \`{ "data": { "keys": [{ "key_id": "...", "public_key": "..." }] } }\`

## Error format

\`\`\`json
{ "error": { "code": "invalid_signature", "message": "...", "request_id": "req_..." } }
\`\`\`
`.trim(),
  },
  {
    slug: "billing",
    title: "ฟรี 100% และการรับไลเซนส์",
    summary: "ไม่มีระบบชำระเงิน รหัสไลเซนส์ยาว และการป้องกันการเดารหัส",
    category: "ไลเซนส์",
    updated: "2026-11",
    markdown: `
# ฟรี 100% และการรับไลเซนส์

## ไม่มีระบบชำระเงิน

แพลตฟอร์มนี้ตัดระบบกระเป๋าเงิน คำสั่งซื้อ Stripe และ PromptPay ออกทั้งหมด
เจ้าของเซิร์ฟเวอร์สมัครบัญชีและใช้ทุกฟีเจอร์ได้ฟรี ไม่มีวันหมดอายุ

## การรับไลเซนส์

1. สมัคร/เข้าสู่ระบบด้วยอีเมล
2. ระบบออกไลเซนส์ฟรีให้อัตโนมัติเมื่อเปิดพอร์ทัลครั้งแรก
3. กด **รับไลเซนส์ฟรี** เพิ่มได้ทุกเมื่อ (สูงสุดตาม activation limit)
4. รหัสไลเซนส์ยาว 240 บิตแสดงให้คัดลอกภายใน 7 วัน (ฐานข้อมูลเก็บเฉพาะ HMAC hash)

## การป้องกันการเดารหัส

- รหัสเปิดใช้งาน 16 ตัวอักษร = 80 บิต สุ่มด้วย CSPRNG
- มีการจำกัดอัตราและล็อกชั่วคราวเมื่อกรอกรหัสผิดซ้ำ ๆ
- ระบบบันทึกเหตุการณ์ความปลอดภัยที่จำเป็นสำหรับการตรวจสอบ โดยไม่เปิดเผยรายละเอียดภายในต่อสาธารณะ
- การเดารหัสแบบออนไลน์จึงถูกจำกัดอย่างมีนัยสำคัญ

## ความเป็นส่วนตัว

ระบบเก็บเฉพาะ hash ของ IP (HMAC) ไม่เก็บ IP ดิบ และรีเซ็ตตัวนับหลัง 24 ชั่วโมงโดยไม่มีความผิดพลาด
`.trim(),
  },
  {
    slug: "support",
    title: "การขอความช่วยเหลือ",
    summary: "เปิดตั๋ว แนบข้อมูลอะไร และติดตามสถานะ",
    category: "ช่วยเหลือ",
    updated: "2026-11",
    markdown: `
# การขอความช่วยเหลือ

## เปิดตั๋ว

1. ไปที่พอร์ทัล → **ช่วยเหลือ**
2. กด **เปิดตั๋วใหม่**
3. เลือกผลิตภัณฑ์ (ถ้ามี) เขียนหัวข้อและรายละเอียด
4. ติดตามการตอบกลับได้ในตั๋วเดียวกัน

## ข้อมูลที่ควรแนบ

- เวอร์ชันปลั๊กอิน, เวอร์ชัน Minecraft, แพลตฟอร์ม, เวอร์ชัน Java
- ข้อความผิดพลาดจากหน้าจอเซิร์ฟเวอร์ (ลบข้อมูลส่วนตัวก่อน)
- ผลของ \`/aegishider status\`, \`/aegishider diag\`
- installation ID (ดูได้จากพอร์ทัล → เซิร์ฟเวอร์)

ห้ามส่ง private key, license key เต็ม, หรือรหัสผ่านใด ๆ

## ระดับความสำคัญ

| ระดับ | ใช้เมื่อ |
|---|---|
| ปกติ | คำถามทั่วไป, ขอคำแนะนำ |
| สูง | ฟีเจอร์หลักทำงานผิด แต่เซิร์ฟเวอร์ยังเล่นได้ |
| เร่งด่วน | เซิร์ฟเวอร์ล่มหรือข้อมูลรั่ว |

## ขอบเขตการสนับสนุน

- ช่วยติดตั้ง/ตั้งค่า/วิเคราะห์ปัญหา
- ไม่รับแก้ไขปลั๊กอินอื่นหรือเซิร์ฟเวอร์ที่ไม่เกี่ยวข้อง
- เวลาตอบกลับขึ้นกับภาระงาน ไม่มี SLA ที่ประกาศไว้
`.trim(),
  },
  {
    slug: "compatibility",
    title: "Compatibility Matrix",
    summary: "รุ่น Minecraft ที่มีบิลด์จริง, Java, PacketEvents และสิ่งที่ไม่รองรับ",
    category: "ผลิตภัณฑ์",
    updated: "2026-11-23",
    markdown: `
# Compatibility Matrix

อัปเดต 2026-11-23 · อ้างอิงจาก \`pom.xml\`, \`plugin.yml\`, CI matrix และ
\`docs/releases/Aegishider-4.0.5-SHA256SUMS\`

| Minecraft | ไฟล์ที่ใช้ | Java | PacketEvents | สถานะ |
|---|---|---|---|---|
| 1.21.1 | \`Aegishider-4.0.5-mc1.21.1.jar\` | 21 | 2.14.0+ | รองรับ |
| 1.21.4 | \`Aegishider-4.0.5-mc1.21.4.jar\` | 21 | 2.14.0+ | รองรับ |
| 1.21.5 | \`Aegishider-4.0.5-mc1.21.5.jar\` | 21 | 2.14.0+ | รองรับ |
| 1.21.11 | \`Aegishider-4.0.5-mc1.21.11.jar\` | 21 | 2.14.0+ | รองรับ |
| 26.1.x | \`Aegishider-4.0.5-mc26.1.jar\` | 25 | 2.14.0+ | รองรับ |
| 26.3 | \`Aegishider-4.0.5-mc26.3.jar\` | 25 | 2.14.0+ | รองรับ |

## 1.21.5 ขึ้นไป

- **1.21.5** ใช้ \`mc1.21.5\`; **1.21.11** ใช้ \`mc1.21.11\`
- **26.1.x** ใช้ \`mc26.1\`; **26.3** ใช้ \`mc26.3\` และต้องรัน Java 25
- รุ่นที่ไม่มีการบิลด์ (เช่น 1.21.6–1.21.10, 26.2) **ยังไม่รองรับ** — ไม่มีการรับประกันว่าไฟล์รุ่นใกล้เคียงจะโหลดได้
- ต้องรีสตาร์ทเซิร์ฟเวอร์หลังเปลี่ยนไฟล์; \`/aegishider reload\` ไม่เปลี่ยน chunk/block-state API

## สิ่งที่ไม่รองรับ

- Folia
- Proxy อย่าง Velocity/BungeeCord (ปลั๊กอินนี้ทำงานฝั่ง Paper เท่านั้น)
- Bedrock/Geyser (เฉพาะผู้เล่น Java)
- Java ต่ำกว่า 21 สำหรับ 1.21.x และต่ำกว่า 25 สำหรับ 26.x

## ถ้าไม่มี PacketEvents

ทดสอบจริง 2026-11-23 บน Paper 1.21.5 build 114: ปลั๊กอิน **ไม่สามารถเปิดทำงานได้**

| ชั้นป้องกัน | ผล |
|---|---|
| ทั้งปลั๊กอิน | **DISABLED** — Paper รายงาน \`NoClassDefFoundError: com/github/retrooper/packetevents/protocol/player/ClientVersion\` ตอน \`onEnable\` แล้วปิด plugin |
| Block/container/chunk | ไม่ทำงาน (ไม่มี gateway) |
| Item/entity visibility | ไม่ทำงาน (plugin ถูกปิดก่อนเริ่มระบบ) |
| วิธีแก้ | ติดตั้ง PacketEvents 2.14.0+ ใน \`plugins/\` แล้วรีสตาร์ท |

นี่คือ fail-closed ในระดับ plugin (ไม่มีข้อมูลใดถูกส่งออกขณะป้องกันไม่ได้) แต่ไม่ใช่ graceful degradation — บิลด์ 4.0.5 ต้องมี PacketEvents เสมอ
`.trim(),
  },
  {
    slug: "defaults",
    title: "Default Configuration",
    summary: "ค่าเริ่มต้นของทุกระบบใน config.yml และ platform.yml",
    category: "ผลิตภัณฑ์",
    updated: "2026-11-23",
    markdown: `
# Default Configuration

ค่าต่อไปนี้คือค่าเริ่มต้นของ 4.0.5 ใน \`config.yml\` และ \`platform.yml\` — เปลี่ยนได้รายโลกภายใต้ \`worlds:\`

## security

| ค่า | เริ่มต้น | ความหมาย |
|---|---|---|
| \`fail-closed\` | \`true\` | ไม่มีโหมดเร็วแต่ไม่ปลอดภัย |
| \`anti-debug\` | \`true\` | ปฏิเสธการเริ่มป้องกันเมื่อมี debugger/agent |
| \`allow-debug\` | \`false\` | เปิดเฉพาะเมื่อตั้งใจใช้ profiler |
| \`packet-gateway.minimum-version\` | \`2.14.0\` | PacketEvents ขั้นต่ำ |
| \`main-thread-budget-ms\` | \`1.5\` | งบเวลาต่อ tick |
| \`raycast-budget-per-tick\` | \`180\` | งบ raycast ต่อ tick (0 = ซ่อนทั้งหมด) |

## block-protection

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`true\` |
| \`replace-with\` | \`CONTEXTUAL\` |
| \`reveal.max-distance\` | \`24.0\` บล็อก |
| \`reveal.fov-degrees\` | \`360.0\` (ปิด FOV gate) |
| \`reveal.keep-distance-factor\` | \`1.6\` |
| \`reveal.recheck-move-blocks\` | \`4\` |
| \`reconcile.enabled\` | \`true\` |
| \`reconcile.chunks-per-second\` | \`20\` |
| \`reconcile.player-radius-chunks\` | \`8\` |

ชุดบล็อกที่ซ่อนเริ่มต้นคือหีบ/barrel/hopper/furnace/spawner/vault/crafter, workstations, anvils, cauldrons, piston ทุกชนิด, observer, target, composter, beacon, bookshelf/chiseled bookshelf, lectern, bell, lodestone, conduit และ shulker box ทุกสี — ดูรายการเต็มใน \`config.yml\`; NOTE_BLOCK และ JUKEBOX เป็น opt-in

## item-protection

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`true\` |
| \`hide-all-living-entities\` | \`true\` |
| \`monster-occlusion-only\` | \`true\` |
| \`monster-max-distance\` | \`96.0\` |
| \`mob-melee-visible-distance\` | \`1.0\` |
| \`reveal.max-distance\` | \`24.0\` |
| \`reveal.fov-degrees\` | \`360.0\` |
| \`reveal.owner-grace\` | \`true\` (ไอเท็มของตัวเองใน 2 วินาที/8 บล็อก) |
| \`update-interval-ticks\` | \`2\` |

## player-protection

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`true\` |
| \`distance-hiding\` | \`false\` (opt-in) |
| \`hide-distance\` | \`48.0\` |
| \`always-visible-distance\` | \`24.0\` |
| \`fov-degrees\` | \`360.0\` |
| \`require-line-of-sight\` | \`true\` |
| \`team-aware\` | \`true\` |
| \`combat-grace-seconds\` | \`8\` |
| \`update-interval-ticks\` | \`4\` |

## entity-height-shield

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`true\` |
| \`max-vertical-distance\` | \`16.0\` |
| \`underground-y\` | \`50.0\` |
| \`band-margin\` | \`12.0\` |

## y-shield

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`true\` |
| \`hide-below-y\` | \`40\` |
| \`real-chunk-radius\` | \`0\` (มาสก์ทุก chunk ในระยะมองเห็น) |
| \`filler\` | \`STONE\` |

## tunnel-shield

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`false\` (opt-in) |
| \`hide-radius\` | \`28.0\` |
| \`max-tracked-breaks\` | \`50000\` |

## analytics และ debug

| ค่า | เริ่มต้น |
|---|---|
| \`analytics.mining.enabled\` | \`false\` |
| \`analytics.mining.xray-ore-rate-threshold-percent\` | \`5.0\` |
| \`analytics.mining.min-samples\` | \`200\` |
| \`analytics.raid.enabled\` | \`false\` |
| \`debug.log-blocked-packets\` | \`false\` |
| \`debug.log-budget-overruns\` | \`true\` |
| \`debug.verbose-errors\` | \`false\` |

## platform.yml

| ค่า | เริ่มต้น |
|---|---|
| \`enabled\` | \`true\` |
| \`api-base-url\` | \`https://aegishider-platform.audijuju1.workers.dev\` |
| \`product\` | \`aegishider\` |
| \`enforcement\` | \`enforce\` |
| \`trial-days\` | \`7\` |
| \`lease-refresh-minutes\` | \`60\` |
| \`heartbeat-minutes\` | \`3\` |
| \`request-timeout-seconds\` | \`15\` |
| \`telemetry.enabled\` | \`true\` |
| \`telemetry.max-buffer\` | \`500\` |
| \`telemetry.batch-max\` | \`50\` |
| \`telemetry.flush-seconds\` | \`60\` |
`.trim(),
  },
  {
    slug: "release-verification",
    title: "Release Verification และ SHA-256",
    summary: "ตรวจไฟล์ jar, checksum, ลายเซ็น lease และกุญแจ public ก่อนติดตั้ง",
    category: "ความปลอดภัย",
    updated: "2026-11-23",
    markdown: `
# Release Verification และ SHA-256

## Registry

- รีลีส \`rel_ag_405\` (4.0.5) เป็นรุ่นที่เผยแพร่ มี 6 บิลด์ตาม Compatibility Matrix
- ไฟล์ checksum อยู่ที่ \`/downloads/Aegishider-4.0.5-SHA256SUMS\` และใน repo ที่ \`docs/releases/\`
- ลิงก์ดาวน์โหลดจริงจะแสดงหลังอัปโหลด jar แต่ละไฟล์ใน \`/admin/releases\` — ถ้าไม่มีลิงก์ แปลว่ายังไม่ได้อัปโหลด ไม่ใช่ไฟล์หาย
- 3.2.0/3.6.x ถูกทำเครื่องหมาย \`deprecated\` และไม่ให้ดาวน์โหลด

## SHA-256 ของ 4.0.5

| ไฟล์ | SHA-256 |
|---|---|
| \`Aegishider-4.0.5-mc1.21.1.jar\` | \`ccd36e20a9e5867b15ace144a88c81669a04c11fe0bf1c36f0559dc34dcdbe41\` |
| \`Aegishider-4.0.5-mc1.21.4.jar\` | \`256393a7c147525c9bff65bfff12a6c2e8f84fbf30dcdf42c31f3336f338129f\` |
| \`Aegishider-4.0.5-mc1.21.5.jar\` | \`be2bdcca5f0720038c13f5d480105efc70753a207b8a88cace7c481441aa81f3\` |
| \`Aegishider-4.0.5-mc1.21.11.jar\` | \`156363cf7e8881ab8d4a6fbeeef24d13e16c7ad5d5f6cf6777191f715a4e44b6\` |
| \`Aegishider-4.0.5-mc26.1.jar\` | \`06bfcbda4edc924c063dafde2f21dcd43d1016c3b34f8d6b936795db1a3a7b2e\` |
| \`Aegishider-4.0.5-mc26.3.jar\` | \`a8cd06ba585d972eab2163aa2c5286199b4f2fd0c83fa0aefd097d29b3183ece\` |

## ตรวจบนเซิร์ฟเวอร์

~~~bash
## Linux/macOS
sha256sum -c Aegishider-4.0.5-SHA256SUMS
~~~

~~~powershell
## Windows PowerShell
Get-FileHash .\Aegishider-4.0.5-mc1.21.5.jar -Algorithm SHA256
~~~

เทียบผลกับตารางหรือไฟล์ sums ก่อนวางใน \`plugins/\` — checksum ยืนยันว่าไฟล์ไม่เสีย/ไม่ถูกแก้ระหว่างทาง แต่ไม่ได้ยืนยันว่าไฟล์มาจากเรา ถ้าได้ไฟล์จากช่องทางอื่นให้เทียบกับตารางนี้หรือหน้า release โดยตรง

## Pin jar ในตัวปลั๊กอิน

ตั้ง \`platform.yml → integrity.jar-sha256\` เป็น hash ของไฟล์ที่ติดตั้ง แล้วรัน \`/aegishider license verify\`; ถ้าไฟล์ถูกแก้ ปลั๊กอินจะรายงาน \`integrity.mismatch\` ผ่าน telemetry และสถานะ license

## ลายเซ็น lease

- \`GET /api/v1/license/keys\` คืน \`key_id\` และ public key (SPKI base64) ที่ใช้ตรวจ lease
- Production key id: \`prod-1\`; rotation เก็บ key เก่าเป็น \`deprecated\` จน lease หมดอายุ
- Plugin ตรวจ Ed25519 signature จาก payload bytes โดยตรง — ไม่เชื่อ JSON ที่ serialize ใหม่

## สิ่งที่ checksum ไม่ได้ยืนยัน

- ความปลอดภัยของ runtime หรือ JVM ที่ถูกแก้
- ว่าเซิร์ฟเวอร์ปลายทางเป็นของเจ้าของจริง (ตรวจจาก HTTPS + key pin + lease)
- ว่า plugin อื่นในเซิร์ฟเวอร์ไม่รั่วข้อมูล
`.trim(),
  },
  {
    slug: "test-evidence",
    title: "ผลทดสอบและหลักฐาน",
    summary: "ทดสอบอะไรไปแล้ว เมื่อไหร่ และอะไรที่ยังไม่ได้ทดสอบ",
    category: "ความน่าเชื่อถือ",
    updated: "2026-11-23",
    markdown: `
# ผลทดสอบและหลักฐาน

ตัวเลขด้านล่างแยก "รันจริงใน workspace นี้" ออกจาก "ผลที่บันทึกไว้ก่อนหน้า" อย่างชัดเจน

## Platform suite — รันจริง 2026-11-23

| รายการ | ผล |
|---|---|
| คำสั่ง | \`vitest run\` (workerd) |
| ไฟล์ | 7 |
| เทสต์ | **51 ผ่าน / 51** |
| ครอบคลุม | สมัคร→ไลเซนส์ฟรี, activation pairing, lease signature/replay, heartbeat, recovery codes/TOTP, redirect หลังสมัคร, rate limit ปิด TOTP |

## Plugin suite — รันจริง 2026-11-23

ติดตั้ง toolchain แบบ portable ใน \`.tools/\` (ไม่ commit): Temurin JDK 21.0.13.1+2, JDK 25.0.5.1+2 และ Maven 3.9.9

| โปรไฟล์ | Paper API | JDK | ผล |
|---|---|---|---|
| \`mc1211\` | 1.21.1 | 21 | 152 ผ่าน, 1 skip |
| \`mc1214\` | 1.21.4 | 21 | 152 ผ่าน, 1 skip |
| \`mc1215\` | 1.21.5 | 21 | 152 ผ่าน, 1 skip |
| \`mc12111\` | 1.21.11 | 21 | 152 ผ่าน, 1 skip |
| \`mc261\` | 26.1.2 | 25 | 152 ผ่าน, 1 skip |
| \`mc263\` | 26.3 | 25 | 152 ผ่าน, 1 skip |

- คำสั่ง: \`mvn -B -P<profile> clean test\` (ต้อง \`clean\` เมื่อสลับ JDK เพราะ \`target/classes\` ข้าม major version ไม่ได้)
- รวม 6 โปรไฟล์: **912 ผ่าน, 6 skip, 0 failure**; 153 \`@Test\` ต่อโปรไฟล์
- 1 skip คือ POSIX file-permission check ใน \`InstallationIdentityTest\` บน Windows; บน Linux ครบ 153
- ใช้ JDK 21 กับ 1.21.x และ JDK 25 กับ 26.x ตาม \`pom.xml\`

## Packet benchmark — ผลบันทึก

ตาราง A–H บนหน้าผลิตภัณฑ์ (หลักฐาน) ทดสอบกับไคลเอนต์จำลองบน Paper 1.21.11 + 1.21.4, PacketEvents 2.14.0, ไฟล์ที่ obfuscate แล้ว:

- A–F: leak/hide ของไอเท็ม, หีบ, block entity, cache replay (Bobby/DH)
- G: Y-shield จากพื้นผิว 213/213 chunks ถูกมาสก์
- H: บล็อกฐานใต้ดิน 0 hidden states / 0 hidden BEs

## PacketEvents และ offline grace — รันจริง 2026-11-23

### มี PacketEvents
- Paper 1.21.5 build 114 + PacketEvents 2.14.0 + Aegishider \`mc1.21.5\`
- \`Packet gateway ACTIVE: PacketEvents 2.14.0 active on V_1_21_5\`; \`protection=ACTIVE\`, \`block-protection=ACTIVE\`, \`item-protection=ACTIVE\`
- ใช้ \`platform.yml → enforcement: warn\` เฉพาะเซิร์ฟเวอร์ทดสอบเพื่อเริ่ม protection โดยไม่ต้อง activate licence

### ไม่มี PacketEvents
- Paper 1.21.5 build 114 ไม่มี PacketEvents
- ผลจริง: \`NoClassDefFoundError: com/github/retrooper/packetevents/protocol/player/ClientVersion\` ที่ \`TunnelShield.<init>\` → \`Aegishider failed to enable - disabling plugin (no visibility data will be sent)\`
- สรุป: fail-closed แต่ plugin ไม่ทำงานทั้งตัว — ต้องติดตั้ง PacketEvents 2.14.0+ ก่อนเปิดเซิร์ฟเวอร์

### Offline grace
- \`LeaseVerifierTest\` 7 tests + \`LeaseStateTest\` 3 tests ผ่านทั้ง 6 โปรไฟล์
- ครอบคลุม: lease หมดอายุรับได้เฉพาะใน grace, เกิน grace ถูกปฏิเสธ, clock rollback ถูกปฏิเสธ, cached lease grace 3 วินาทีรับได้/0 วินาทีไม่รับ, lease ของ installation อื่นถูกเพิกเฉย

## Outage scenarios

| สถานการณ์ | พฤติกรรมที่ออกแบบ | หลักฐาน |
|---|---|---|
| Cloudflare/Platform ล่ม | ใช้ lease ที่เซ็นแล้วต่อจนหมดอายุ + offline grace 72 ชม. (สูงสุด 168) | \`LeaseVerifier\`/\`LeaseState\` + unit tests |
| lease หมดอายุและต่อไม่ได้ | protection gate ปิด (enforcement) — เซิร์ฟเวอร์ไม่ป้องกันจนกว่าจะต่อ lease ได้ | \`PlatformService\` |
| PacketEvents หาย/ไม่ติดตั้ง | ปลั๊กอินปิดตัวเอง (fail-closed); ไม่มี visibility data ใด ๆ | ทดสอบจริงบน Paper 1.21.5 build 114 (2026-11-23) |
| คิว telemetry ล้น | buffer 500, batch 50, flush 60 วินาที; ปิด telemetry ได้โดยไม่กระทบการป้องกัน | \`platform.yml\` |

ถอด PacketEvents ออกจาก local Paper และทดสอบแล้ว; ยังไม่ได้จำลอง Cloudflare outage จริงหรือถอด PacketEvents ออกจาก Production — offline grace เป็นผลจาก unit tests ไม่ใช่ live failover

## ยังไม่ได้ทดสอบ

- Load test จำนวน installation พร้อมกันและ D1 write limits
- DDoS/rate-limit ระดับ edge
- ไคลเอนต์ cheat จริงนอกเหนือ scenario A–H
- Folia, proxy, Bedrock
- การกู้บัญชีผ่าน operator CLI บน Production (ทดสอบแล้วบน local + disposable production row เมื่อ 2026-11-23)
`.trim(),
  },
  {
    slug: "recovery-2fa",
    title: "Recovery Codes และ 2FA",
    summary: "กู้บัญชีโดยไม่มีอีเมล และเปิด/ปิด TOTP อย่างปลอดภัย",
    category: "ความปลอดภัย",
    updated: "2026-11-23",
    markdown: `
# Recovery Codes และ 2FA

แพลตฟอร์มนี้ **ไม่ส่งอีเมล** ทั้งการยืนยันบัญชี การรีเซ็ตรหัสผ่าน และการแจ้งเตือน — ใช้รหัสกู้คืนและ operator CLI แทน

## Recovery codes

- ออกให้ 10 ชุดตอนสมัคร/เมื่อกดสร้างใหม่ แต่ละชุดรูปแบบ \`XXXX-XXXX-XXXX\` (12 ตัวอักษร)
- เก็บเฉพาะ HMAC-SHA256 ไม่เก็บ plaintext; ใช้ได้ครั้งเดียว
- แสดงที่ \`/app/security\` จนกว่าจะกด **บันทึกครบแล้ว / ซ่อนรหัส** หรือครบ 15 นาที
- ถ้า refresh หน้า ระบบยังแสดงชุดเดิมในช่วง 15 นาทีนั้น (GET ไม่กินรหัส)
- เก็บไว้ใน password manager หรือกระดาษที่ปลอดภัย — ไม่มีทางดูย้อนหลัง

## ใช้รหัสกู้คืน

1. ไปที่ \`/auth/recover\`
2. กรอกรหัส 1 ชุด + รหัสผ่านใหม่
3. ระบบใช้รหัสนั้นทิ้ง, revoke ทุก session, ล้าง TOTP และออกชุดใหม่ให้ 10 ชุด
4. เข้าสู่ระบบด้วยรหัสผ่านใหม่

## TOTP 2FA

- เป็นทางเลือก ไม่บังคับ: เปิดที่ \`/app/security\` → สแกน \`otpauth://\` ด้วยแอป authenticator
- Login ต้องกรอกรหัส 6 หลัก; ระบบเก็บ counter ที่รับแล้วเพื่อกัน replay
- ปิด 2FA ต้องใส่รหัสผ่าน และถูกจำกัด 5 ครั้ง/15 นาทีต่อ user+IP
- ถ้าทำมือถือหายและยังมี recovery code ให้ใช้รหัสกู้คืน (จะล้าง TOTP ให้)

## ถ้าไม่มีทั้งรหัสผ่านและ recovery code

ติดต่อ operator ของระบบ พร้อมยืนยันตัวตนตามช่องทางที่ตกลง จากนั้น operator รัน:

~~~bash
node scripts/reset-password.mjs you@example.com --remote
~~~

สคริปต์จะออกรหัสชั่วคราว แสดงครั้งเดียว, revoke ทุก session และล้าง TOTP ผู้ใช้ควรเปลี่ยนรหัสที่ \`/app/account\` ทันที

## สิ่งที่ห้ามทำ

- ห้ามส่งรหัสกู้คืนหรือรหัสผ่านผ่านแชท/ตั๋ว
- ห้ามใช้ recovery code ซ้ำ (ระบบปฏิเสธ)
- ห้ามปิด TOTP จาก session ที่สงสัยว่าถูกขโมยโดยไม่เปลี่ยนรหัสผ่าน
`.trim(),
  },
];

export function getDoc(slug: string): DocPage | undefined {
  return docs.find((doc) => doc.slug === slug);
}

export function docsByCategory(): Array<{ category: string; pages: DocPage[] }> {
  const groups = new Map<string, DocPage[]>();
  for (const doc of docs) {
    const list = groups.get(doc.category) ?? [];
    list.push(doc);
    groups.set(doc.category, list);
  }
  return [...groups.entries()].map(([category, pages]) => ({ category, pages }));
}
