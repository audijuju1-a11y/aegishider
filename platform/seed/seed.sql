-- =============================================================================
-- Seed data for local development / first deploy.
-- The platform is free: every plan is seeded at 0 and there is no checkout.
-- The admin console remains the source of truth for catalogue changes.
-- =============================================================================

INSERT OR IGNORE INTO products (
  id, slug, name, name_en, tagline, tagline_en, description, category, status,
  featured, price_cents, currency, docs_url, compatibility, features,
  seo_title, seo_description, created_at, updated_at, published_at
) VALUES (
  'prod_aegishider',
  'aegishider',
  'Aegishider',
  'Aegishider',
  'ซ่อนหีบและไอเท็มที่ตกอยู่ — ก่อนข้อมูลจะถูกส่งถึงเกมผู้เล่น',
  'Hide containers and dropped items before the data ever reaches the client.',
  'Aegishider 4.0.0 คือปลั๊กอินสำหรับเซิร์ฟเวอร์ Paper 1.21.1 ถึง 26.3 ที่ช่วยซ่อนหีบ กล่องเก็บของ และไอเท็มที่ตกอยู่ ไม่ให้คนอื่นมองเห็น — โดยไม่ส่งข้อมูลเหล่านั้นออกจากเซิร์ฟเวอร์ตั้งแต่แรก

ระบบตัดสินใจจากระยะทาง มุมมอง และสิ่งกีดขวาง ถ้าผู้เล่นอยู่ใกล้ มองเห็น และไม่มีอะไรบัง ก็จะเห็นของตามปกติ แต่ถ้าไม่แน่ใจ ระบบจะซ่อนไว้ก่อน

ทุกอย่างทำงานบนเซิร์ฟเวอร์ ผู้เล่นไม่ต้องติดตั้งมอด และมีชุดทดสอบบนเซิร์ฟเวอร์จริงยืนยันว่าไม่มีข้อมูลหลุด',
  'security',
  'published',
  1,
  0,
  'THB',
  '/docs/aegishider',
  '{"minecraft":["1.21.1","1.21.4","1.21.5","1.21.11","26.1.2","26.3"],"servers":["Paper"],"java":["21","25"],"requires":["PacketEvents 2.14.0+"]}',
  '[{"title":"ซ่อนหีบจริง","description":"ข้อมูลหีบถูกถอดออกจากแผนที่ก่อนส่ง และแทนที่ด้วยหินธรรมดา"},{"title":"ซ่อนไอเท็มที่ตกอยู่","description":"ไม่มีข้อมูลไอเท็มถูกสร้างจนกว่าผู้เล่นจะอยู่ใกล้ ในมุมมอง และไม่มีอะไรบัง"},{"title":"เห็นของใกล้ตัวตามปกติ","description":"ใช้การยิงเส้นสายตาตรวจสิ่งกีดขวางจริง ทำให้เล่นได้เหมือนเดิมในระยะใกล้"},{"title":"ไม่แน่ใจ = ซ่อน","description":"ข้อผิดพลาด การตั้งค่าผิด หรือระบบทำงานไม่ทัน จบที่การซ่อนทุกครั้ง"},{"title":"ไม่ทำให้เซิร์ฟเวอร์กระตุก","description":"จำกัดงานไม่เกิน 1.5 มิลลิวินาทีต่อติ๊ก พร้อมตัวเลข p50/p95/p99 ให้ตรวจสอบ"},{"title":"ตรวจสอบได้ทุกเมื่อ","description":"คำสั่ง status, diag, verify และ export แสดงสถานะจริงของระบบ"},{"title":"ไคลเอนต์ไลเซนส์","description":"ลงทะเบียนเซิร์ฟเวอร์ รับ lease ที่ลงลายเซ็น Ed25519 และส่ง heartbeat โดยไม่แตะเธรดหลัก"}]',
  'Aegishider 4.0.0 — ปลั๊กอินซ่อนหีบและไอเท็มสำหรับ Paper 1.21.1–26.3',
  'ปลั๊กอินสำหรับ Paper 1.21.1–26.3 ที่ซ่อนหีบและไอเท็มก่อนส่งถึงเกมผู้เล่น พร้อมหลักฐานการทดสอบบนเซิร์ฟเวอร์จริง',
  (strftime('%s','now') * 1000),
  (strftime('%s','now') * 1000),
  (strftime('%s','now') * 1000)
);

INSERT OR IGNORE INTO product_plans (
  id, product_id, code, name, price_cents, currency, billing_interval, entitlements,
  activation_limit, active, created_at, updated_at
) VALUES
  ('plan_bh_lite', 'prod_aegishider', 'lite', 'Free', 0, 'THB', 'one_time',
   '["aegishider:block-protection","aegishider:item-shield","aegishider:diagnostics"]', 1, 1,
   (strftime('%s','now') * 1000), (strftime('%s','now') * 1000)),
  ('plan_bh_pro', 'prod_aegishider', 'pro', 'Free', 0, 'THB', 'one_time',
   '["aegishider:block-protection","aegishider:item-shield","aegishider:diagnostics"]', 5, 1,
   (strftime('%s','now') * 1000), (strftime('%s','now') * 1000));

INSERT OR IGNORE INTO product_releases (
  id, product_id, version, channel, status, notes, supported_minecraft, supported_java,
  supported_platforms, artifact_url, artifact_sha256, released_at, created_at
) VALUES (
  'rel_ag_400', 'prod_aegishider', '4.0.0', 'stable', 'published',
  'Aegishider 4.0.0 — six Paper builds (1.21.1–26.3), Sentinel Shield obfuscation with signed manifests, 123 unit tests, and the A–F packet harness PASS (hidden items, chunk/far-band containers, clean client BE registry, cache re-hidden). Upload the build artifact from /admin/releases to enable the download.',
  '["1.21.1","1.21.4","1.21.5","1.21.11","26.1.2","26.3"]', '["21","25"]', '["Paper"]',
  NULL, NULL,
  (strftime('%s','now') * 1000), (strftime('%s','now') * 1000)
);

INSERT OR IGNORE INTO product_releases (
  id, product_id, version, channel, status, notes, supported_minecraft, supported_java,
  supported_platforms, artifact_url, artifact_sha256, released_at, created_at
) VALUES (
  'rel_bh_361', 'prod_aegishider', '3.6.1', 'stable', 'published',
  'Aegishider 3.6.1 — three-gap benchmark release: block-entity leak, pie-ray registry and Bobby/Distant Horizons cache replay all covered, plus a free licence platform with 16-character activation codes, 240-bit licence keys, escalating brute-force lockouts, HTTPS-only platform calls and Linux POSIX key permissions. 120 unit tests pass on Windows and Linux; Paper 1.21.4 A-F harness verified.',
  '["1.21.4"]', '["21"]', '["Paper"]',
  '/release/rel_bh_361/download',
  'e8f8594cf9a42ca1787ff1d858cd602c9343556bc0c1a1c8f0a0eb0f7f96b7e4',
  (strftime('%s','now') * 1000), (strftime('%s','now') * 1000)
);

INSERT OR IGNORE INTO product_releases (
  id, product_id, version, channel, status, notes, supported_minecraft, supported_java,
  supported_platforms, artifact_url, artifact_sha256, released_at, created_at
) VALUES (
  'rel_bh_360', 'prod_aegishider', '3.6.0', 'stable', 'published',
  'Aegishider 3.6.0 — Tunnel/Dug-hole Shield (hide player-dug tunnels beyond 28 blocks, re-mask on leave), Y-Shield, contextual filler and player ESP shield. 85 unit tests; verified running on a live Paper 1.21.4 server at TPS 20.0.',
  '["1.21.4"]', '["21"]', '["Paper"]',
  NULL,
  'bbb8da5323b925a28e681dbff18b1828e084416e8a443be91f0001dc82f09eb5',
  ((strftime('%s','now') * 1000) - 3600000), ((strftime('%s','now') * 1000) - 3600000)
);

INSERT OR IGNORE INTO product_releases (
  id, product_id, version, channel, status, notes, supported_minecraft, supported_java,
  supported_platforms, artifact_url, artifact_sha256, released_at, created_at
) VALUES (
  'rel_bh_320', 'prod_aegishider', '3.2.0', 'stable', 'published',
  'Aegishider 3.2.0 — startup warm-up, item spawn-storm priority lane, gateway watchdog, detected-position overflow alarm and async diagnostics snapshots. 75 unit tests, packet-level integration harness PASS on Paper 1.21.4.',
  '["1.21.4"]', '["21"]', '["Paper"]',
  NULL,
  'cf3cc53e7529e35b7dbc801773eba3bf8c8d02dc7e0028cf89bbe3aa1191808c',
  ((strftime('%s','now') * 1000) - 2592000000), ((strftime('%s','now') * 1000) - 2592000000)
);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('platform.support_email', 'audijuju1@gmail.com', (strftime('%s','now') * 1000)),
  ('platform.registration_open', 'true', (strftime('%s','now') * 1000));
