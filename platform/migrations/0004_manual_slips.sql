-- 0004 — manual payment slips, blacklist and site content.
-- Stripe remains optional but is not required for manual PromptPay verification.

CREATE TABLE payment_slips (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  r2_key            TEXT NOT NULL,
  filename          TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note       TEXT,
  reviewed_by_email TEXT,
  reviewed_at       INTEGER,
  created_at        INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_slips_order ON payment_slips(order_id, created_at DESC);
CREATE INDEX idx_slips_status ON payment_slips(status, created_at DESC);

CREATE TABLE blacklist_entries (
  id                 TEXT PRIMARY KEY,
  license_id         TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  installation_uuid  TEXT,
  fingerprint_sha256 TEXT,
  reason             TEXT NOT NULL,
  created_by_email   TEXT NOT NULL,
  created_at         INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_blacklist_uuid ON blacklist_entries(installation_uuid);
CREATE INDEX idx_blacklist_fingerprint ON blacklist_entries(fingerprint_sha256);

-- Uploaded release artifacts (R2). Admin can publish a new jar without a rebuild.
ALTER TABLE product_releases ADD COLUMN artifact_r2_key TEXT;
ALTER TABLE product_releases ADD COLUMN artifact_size_bytes INTEGER;
