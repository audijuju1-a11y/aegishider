# Aegishider — Cloudflare Pages homepage

`site/` คือ static mirror ของหน้าแรก **Aegishider Control Platform** (Worker:
`https://basehider-platform.audijuju1.workers.dev`) เพื่อให้ `https://aegishider.pages.dev`
แสดงดีไซน์เดียวกับแพลตฟอร์ม โดยไม่ต้องดูแลหน้าเว็บอีกชุดหนึ่ง

```
site/public/
├─ index.html        ← snapshot ของหน้าแรกแพลตฟอร์ม (assets local)
├─ 404.html          ← snapshot ของหน้า 404 แพลตฟอร์ม
├─ _headers          ← CSP/cache headers ของ Cloudflare Pages
├─ _redirects        ← เส้นทางแอป (/plugins, /docs, /auth, /app, ...) → Worker
├─ sitemap.xml, robots.txt, site.webmanifest
└─ assets/           ← คัดลอกจาก platform/public/assets (CSS, JS, ฟอนต์, โลโก้)
```

ไจาร์ทุกเวอร์ชันให้บริการจากแพลตฟอร์ม (`/release/<id>/download`) และมี SHA-256
อยู่ใน `dist/obf/SHA256SUMS` ของ repo — ไม่มีสำเนาไจาร์ค้างใน Pages

## กติกา

- **หน้าแรก/404 ต้องตรงกับแพลตฟอร์ม**: สร้างจาก HTML ที่เรนเดอร์จริง แล้ว rewrite
  ลิงก์เส้นทางแอปเป็น absolute ไปที่ Worker; assets เก็บ local เพื่อให้ CSP ยัง `'self'`
- ลิงก์ `/plugins`, `/docs`, `/auth`, `/app`, `/admin`, `/legal`, `/release`, `/api`
  ถูก redirect ไป Worker ผ่าน `_redirects`
- ห้ามเพิ่มธีม/สคริปต์จากเว็บชุดเก่า (clockwork) — ไฟล์เหล่านั้นถูกลบแล้ว
- อัปเดต snapshot เมื่อหน้าแรกของแพลตฟอร์มเปลี่ยน

## ตรวจสอบก่อน deploy

```bash
node scripts/check-site.mjs
python -m http.server 4321 --directory public   # หรือ static server ใดก็ได้
node scripts/qa-static.mjs
```

## Deploy

```bash
cd site
npx wrangler login
npx wrangler pages deploy public --project-name aegishider
```

หรืออัปโหลดโฟลเดอร์ `public/` ผ่าน Dashboard → Workers & Pages → Pages → Upload assets
