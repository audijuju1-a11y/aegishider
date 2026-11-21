-- =============================================================================
-- Aegishider 4.0.0 production catalogue refresh.
--
-- Keeps the existing product row (prod_basehider) and its licences/plans so
-- activation hashes remain valid; only the public slug/name/copy changes.
-- Old 3.x releases are deprecated (not deleted). Six obfuscated builds are
-- published; the JARs live in R2 under releases/prod_basehider/<version>/.
--
-- Apply with:
--   npx wrangler d1 execute bhcp-db --remote --file=./seed/refresh_aegishider_400.sql
-- =============================================================================

UPDATE products SET
  slug               = 'aegishider',
  name               = 'Aegishider',
  name_en            = 'Aegishider',
  tagline            = 'ซ่อนหีบและไอเท็มก่อนข้อมูลจะถูกส่งถึงเกมผู้เล่น',
  tagline_en         = 'Hide containers and dropped items before the data ever reaches the client.',
  description        = 'Aegishider 4.0.0 คือปลั๊กอินสำหรับเซิร์ฟเวอร์ Paper 1.21.1 ถึง 26.3 ที่ช่วยซ่อนหีบ กล่องเก็บของ และไอเท็มที่ตกอยู่ ไม่ให้คนอื่นมองเห็น — โดยไม่ส่งข้อมูลเหล่านั้นออกจากเซิร์ฟเวอร์ตั้งแต่แรก

มีไบล์แยกตามรุ่นเซิร์ฟเวอร์ 6 รุ่น (1.21.1, 1.21.4, 1.21.5, 1.21.11, 26.1, 26.3) ทุกไบล์ผ่าน Sentinel Shield obfuscation และมี manifest เซ็น Ed25519 ตรวจสอบได้

ระบบตัดสินใจจากระยะทาง มุมมอง และสิ่งกีดขวาง ถ้าผู้เล่นอยู่ใกล้ มองเห็น และไม่มีอะไรบัง ก็จะเห็นของตามปกติ แต่ถ้าไม่แน่ใจ ระบบจะซ่อนไว้ก่อน',
  category           = 'security',
  status             = 'published',
  featured           = 1,
  docs_url           = '/docs/aegishider',
  compatibility      = '{"minecraft":["1.21.1","1.21.4","1.21.5","1.21.11","26.1.2","26.3"],"servers":["Paper"],"java":["21","25"],"requires":["PacketEvents 2.14.0+"]}',
  seo_title          = 'Aegishider 4.0.0 — ปลั๊กอินซ่อนหีบและไอเท็มสำหรับ Paper 1.21.1–26.3',
  seo_description    = 'ปลั๊กอิน Paper 1.21.1–26.3 ที่ซ่อนหีบและไอเท็มก่อนส่งถึงเกมผู้เล่น พร้อมไบล์แยกตามรุ่น Sentinel Shield obfuscation และหลักฐานการทดสอบจริง',
  updated_at         = (CAST(strftime('%s','now') AS INTEGER) * 1000)
WHERE id = 'prod_basehider';

UPDATE product_releases
   SET status = 'deprecated'
 WHERE product_id = 'prod_basehider'
   AND status = 'published';

INSERT OR REPLACE INTO product_releases (
  id, product_id, version, channel, status, notes,
  supported_minecraft, supported_java, supported_platforms,
  artifact_url, artifact_sha256, artifact_r2_key, artifact_size_bytes,
  signing_key_id, released_at, created_at
) VALUES
(
  'rel_ag_400_mc12111', 'prod_basehider', '4.0.0', 'stable', 'published',
  'Aegishider 4.0.0 (Paper 1.21.9–1.21.11). Recommended build. Packet-level container/item hiding, Tunnel Shield, 123 unit tests, A–F harness PASS (items hidden, chunk/far-band containers hidden, clean client BE registry, cache re-hidden). Sentinel Shield obfuscation + signed manifest.',
  '["1.21.9","1.21.10","1.21.11"]', '["21"]', '["Paper"]',
  '/release/rel_ag_400_mc12111/download',
  '35d1cfb8676c0c0701fcfdc234326acc2a3d0d647a674f2514520bed8190cef6',
  'releases/prod_basehider/4.0.0/Aegishider-4.0.0-mc1.21.11.jar', 5201945,
  '6a6e44a1c42f6769',
  (CAST(strftime('%s','now') AS INTEGER) * 1000),
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
),
(
  'rel_ag_400_mc263', 'prod_basehider', '4.0.0+mc26.3', 'stable', 'published',
  'Aegishider 4.0.0 for Paper 26.2–26.3 (Java 25 runtime). Packet gateway ACTIVE on V_26_3 in the smoke test. Sentinel Shield obfuscation + signed manifest.',
  '["26.2","26.3"]', '["21","25"]', '["Paper"]',
  '/release/rel_ag_400_mc263/download',
  'c7605df5fd2967f116dc12052d9cf15d73b8c2bd8a5da560aba9691297a6946d',
  'releases/prod_basehider/4.0.0+mc26.3/Aegishider-4.0.0-mc26.3.jar', 5201945,
  '6a6e44a1c42f6769',
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 60000,
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 60000
),
(
  'rel_ag_400_mc261', 'prod_basehider', '4.0.0+mc26.1', 'stable', 'published',
  'Aegishider 4.0.0 for Paper 26.1.x. Compiled against paper-api 26.1.2. Sentinel Shield obfuscation + signed manifest.',
  '["26.1","26.1.1","26.1.2"]', '["21","25"]', '["Paper"]',
  '/release/rel_ag_400_mc261/download',
  '52787426ef5f5bbd9d42e0b1eae55e048a689b2dbfdc4eb9514998a038ee69c8',
  'releases/prod_basehider/4.0.0+mc26.1/Aegishider-4.0.0-mc26.1.jar', 5201945,
  '6a6e44a1c42f6769',
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 120000,
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 120000
),
(
  'rel_ag_400_mc1215', 'prod_basehider', '4.0.0+mc1.21.5', 'stable', 'published',
  'Aegishider 4.0.0 for Paper 1.21.5–1.21.8. Smoke-tested with PacketEvents 2.14.0 (gateway ACTIVE). Sentinel Shield obfuscation + signed manifest.',
  '["1.21.5","1.21.6","1.21.7","1.21.8"]', '["21"]', '["Paper"]',
  '/release/rel_ag_400_mc1215/download',
  'ecf76bb1864d7b725a2909f902d62364e5d95c9e1d0b57ced8d77fc084cbacaf',
  'releases/prod_basehider/4.0.0+mc1.21.5/Aegishider-4.0.0-mc1.21.5.jar', 5201945,
  '6a6e44a1c42f6769',
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 180000,
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 180000
),
(
  'rel_ag_400_mc1214', 'prod_basehider', '4.0.0+mc1.21.4', 'stable', 'published',
  'Aegishider 4.0.0 for Paper 1.21.4. This exact build passed the A–F packet harness on Paper 1.21.4 build 232. Sentinel Shield obfuscation + signed manifest.',
  '["1.21.4"]', '["21"]', '["Paper"]',
  '/release/rel_ag_400_mc1214/download',
  'e99f883316252f5d758588657042c233f68c561ad9302688983dfe9c806461a4',
  'releases/prod_basehider/4.0.0+mc1.21.4/Aegishider-4.0.0-mc1.21.4.jar', 5201945,
  '6a6e44a1c42f6769',
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 240000,
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 240000
),
(
  'rel_ag_400_mc1211', 'prod_basehider', '4.0.0+mc1.21.1', 'stable', 'published',
  'Aegishider 4.0.0 for Paper 1.21.1–1.21.4. Smoke-tested on Paper 1.21.1 (gateway ACTIVE). Sentinel Shield obfuscation + signed manifest.',
  '["1.21.1","1.21.2","1.21.3","1.21.4"]', '["21"]', '["Paper"]',
  '/release/rel_ag_400_mc1211/download',
  'f18178121035820b0717cbacb0ff12edb5add435d6d9aabba0a3f56d0fb1c527',
  'releases/prod_basehider/4.0.0+mc1.21.1/Aegishider-4.0.0-mc1.21.1.jar', 5201945,
  '6a6e44a1c42f6769',
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 300000,
  (CAST(strftime('%s','now') AS INTEGER) * 1000) - 300000
);

INSERT OR REPLACE INTO system_settings (key, value, updated_at)
VALUES ('platform.support_email', 'audijuju1@gmail.com', (CAST(strftime('%s','now') AS INTEGER) * 1000));
