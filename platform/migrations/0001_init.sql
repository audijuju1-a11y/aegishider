-- =============================================================================
-- Aegishider Control Platform — initial schema (D1 / SQLite)
--
-- Conventions
--   * IDs are application-generated text IDs (prefix + ULID-like suffix).
--   * All timestamps are INTEGER Unix epoch milliseconds (UTC).
--   * JSON columns are TEXT containing validated JSON (never user HTML).
--   * Every tenant-owned row carries org_id; every customer query must scope it.
-- =============================================================================

-- ---------------------------------------------------------------- identity --
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,
  display_name      TEXT,
  role              TEXT NOT NULL DEFAULT 'customer'
                    CHECK (role IN ('customer','support','product_manager','security_analyst','read_only_admin','admin','super_admin')),
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','deleted')),
  locale            TEXT NOT NULL DEFAULT 'th' CHECK (locale IN ('th','en')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_login_at     INTEGER
) STRICT;
CREATE INDEX idx_users_role ON users(role, status);

CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_orgs_owner ON organizations(owner_user_id);

CREATE TABLE organization_members (
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','member','read_only')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
) STRICT;
CREATE INDEX idx_members_user ON organization_members(user_id);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  ip_hash      TEXT,
  user_agent   TEXT
) STRICT;
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE email_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('login','verify_email','security')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT
) STRICT;
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose, expires_at);

CREATE TABLE email_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  template   TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  provider   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('queued','sent','failed','suppressed')),
  error_code TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_email_log_created ON email_log(created_at DESC);

-- ---------------------------------------------------------------- catalogue --
CREATE TABLE products (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  name_en         TEXT,
  tagline         TEXT NOT NULL,
  tagline_en      TEXT,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'security',
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','coming_soon','archived')),
  featured        INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  logo_url        TEXT,
  hero_image_url  TEXT,
  gallery         TEXT NOT NULL DEFAULT '[]',
  price_cents     INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency        TEXT NOT NULL DEFAULT 'THB',
  purchase_url    TEXT,
  docs_url        TEXT,
  compatibility   TEXT NOT NULL DEFAULT '{}',
  features        TEXT NOT NULL DEFAULT '[]',
  seo_title       TEXT,
  seo_description TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  published_at    INTEGER
) STRICT;
CREATE INDEX idx_products_status ON products(status, featured);
CREATE INDEX idx_products_category ON products(category, status);

CREATE TABLE product_plans (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  price_cents      INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'THB',
  billing_interval TEXT NOT NULL DEFAULT 'one_time'
                   CHECK (billing_interval IN ('one_time','monthly','yearly')),
  entitlements     TEXT NOT NULL DEFAULT '[]',
  activation_limit INTEGER NOT NULL DEFAULT 1 CHECK (activation_limit BETWEEN 1 AND 1000),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (product_id, code)
) STRICT;
CREATE INDEX idx_plans_product ON product_plans(product_id, active);

CREATE TABLE product_releases (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version             TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable','beta','preview')),
  status              TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','deprecated')),
  notes               TEXT NOT NULL DEFAULT '',
  supported_minecraft TEXT NOT NULL DEFAULT '[]',
  supported_java      TEXT NOT NULL DEFAULT '[]',
  supported_platforms TEXT NOT NULL DEFAULT '[]',
  artifact_url        TEXT,
  artifact_sha256     TEXT,
  signing_key_id      TEXT,
  artifact_signature  TEXT,
  released_at         INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  UNIQUE (product_id, version, channel)
) STRICT;
CREATE INDEX idx_releases_product ON product_releases(product_id, released_at DESC);

-- ----------------------------------------------------------------- licensing --
CREATE TABLE licenses (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  plan_id          TEXT REFERENCES product_plans(id) ON DELETE SET NULL,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key_prefix       TEXT NOT NULL,
  key_hash         TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('pending','active','suspended','expired','revoked')),
  activation_limit INTEGER NOT NULL DEFAULT 1 CHECK (activation_limit BETWEEN 0 AND 1000),
  entitlements     TEXT NOT NULL DEFAULT '[]',
  issued_at        INTEGER NOT NULL,
  expires_at       INTEGER,
  revoked_at       INTEGER,
  revoke_reason    TEXT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_licenses_org ON licenses(org_id, status);
CREATE INDEX idx_licenses_product ON licenses(product_id, status);
CREATE INDEX idx_licenses_prefix ON licenses(key_prefix);

CREATE TABLE installations (
  id                  TEXT PRIMARY KEY,
  license_id          TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  org_id              TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  installation_uuid   TEXT NOT NULL UNIQUE,
  public_key          TEXT NOT NULL,
  fingerprint_sha256  TEXT NOT NULL UNIQUE,
  display_name        TEXT,
  plugin_version      TEXT,
  minecraft_version   TEXT,
  platform            TEXT,
  java_version        TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','suspended','revoked','stale')),
  first_seen_at       INTEGER NOT NULL,
  last_heartbeat_at   INTEGER,
  last_seen_ip_hash   TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_installations_license ON installations(license_id);
CREATE INDEX idx_installations_org ON installations(org_id, status);
CREATE INDEX idx_installations_heartbeat ON installations(last_heartbeat_at);

CREATE TABLE activation_challenges (
  id              TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  code_hash       TEXT NOT NULL UNIQUE,
  code_prefix     TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_challenges_installation ON activation_challenges(installation_id);

CREATE TABLE activations (
  id              TEXT PRIMARY KEY,
  license_id      TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','revoked')),
  activated_at    INTEGER NOT NULL,
  last_seen_at    INTEGER,
  released_at     INTEGER,
  UNIQUE (license_id, installation_id)
) STRICT;
CREATE INDEX idx_activations_license ON activations(license_id, status);

CREATE TABLE license_leases (
  id              TEXT PRIMARY KEY,
  license_id      TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  jti             TEXT NOT NULL UNIQUE,
  key_id          TEXT NOT NULL,
  issued_at       INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  payload         TEXT NOT NULL,
  signature       TEXT NOT NULL,
  created_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_leases_installation ON license_leases(installation_id, expires_at);

CREATE TABLE signing_keys (
  key_id     TEXT PRIMARY KEY,
  algorithm  TEXT NOT NULL DEFAULT 'Ed25519',
  public_key TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','revoked')),
  created_at INTEGER NOT NULL,
  retired_at INTEGER
) STRICT;

CREATE TABLE activation_nonces (
  nonce           TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  purpose         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER
) STRICT;
CREATE INDEX idx_nonces_expiry ON activation_nonces(expires_at);

-- ---------------------------------------------------------------- telemetry --
CREATE TABLE heartbeat_latest (
  installation_id TEXT PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  received_at     INTEGER NOT NULL,
  payload         TEXT NOT NULL,
  schema_version  INTEGER NOT NULL
) STRICT;

CREATE TABLE telemetry_events (
  id              TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('debug','info','warning','error','critical')),
  occurred_at     INTEGER NOT NULL,
  received_at     INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  payload         TEXT NOT NULL,
  processed_at    INTEGER
) STRICT;
CREATE INDEX idx_telemetry_installation ON telemetry_events(installation_id, occurred_at DESC);
CREATE INDEX idx_telemetry_pending ON telemetry_events(processed_at, received_at);

CREATE TABLE telemetry_rollups (
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  bucket_start    INTEGER NOT NULL,
  samples         INTEGER NOT NULL DEFAULT 0,
  tps_avg         REAL,
  mspt_p50        REAL,
  mspt_p95        REAL,
  mspt_p99        REAL,
  plugin_ms_avg   REAL,
  errors          INTEGER NOT NULL DEFAULT 0,
  payload         TEXT NOT NULL DEFAULT '{}',
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (installation_id, bucket_start)
) STRICT;

CREATE TABLE security_events (
  id              TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES installations(id) ON DELETE SET NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info','warning','error','critical')),
  ip_hash         TEXT,
  details         TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_security_created ON security_events(created_at DESC);
CREATE INDEX idx_security_type ON security_events(event_type, created_at DESC);

CREATE TABLE admin_audit_events (
  id             TEXT PRIMARY KEY,
  actor_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email    TEXT NOT NULL,
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT,
  before_summary TEXT,
  after_summary  TEXT,
  reason         TEXT,
  request_id     TEXT,
  ip_hash        TEXT,
  created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_audit_created ON admin_audit_events(created_at DESC);
CREATE INDEX idx_audit_target ON admin_audit_events(target_type, target_id);

-- ------------------------------------------------------------------ support --
CREATE TABLE support_tickets (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at  INTEGER
) STRICT;
CREATE INDEX idx_tickets_org ON support_tickets(org_id, updated_at DESC);
CREATE INDEX idx_tickets_status ON support_tickets(status, updated_at DESC);

CREATE TABLE support_messages (
  id             TEXT PRIMARY KEY,
  ticket_id      TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_role    TEXT NOT NULL CHECK (author_role IN ('customer','staff','system')),
  body           TEXT NOT NULL,
  internal       INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1)),
  created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_messages_ticket ON support_messages(ticket_id, created_at);

CREATE TABLE contact_messages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  topic      TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','closed')),
  ip_hash    TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_contact_created ON contact_messages(created_at DESC);

-- ---------------------------------------------------------------- commerce --
CREATE TABLE payment_orders (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  plan_id      TEXT REFERENCES product_plans(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency     TEXT NOT NULL DEFAULT 'THB',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','refunded','cancelled')),
  provider     TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  notes        TEXT,
  license_id   TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER,
  updated_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_orders_org ON payment_orders(org_id, created_at DESC);
CREATE INDEX idx_orders_status ON payment_orders(status, created_at DESC);

CREATE TABLE payment_webhook_events (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','processed','ignored','failed')),
  payload           TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  processed_at      INTEGER,
  UNIQUE (provider, provider_event_id)
) STRICT;

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  read_at    INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- ------------------------------------------------------------------ system --
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
) STRICT;

CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
) STRICT;

CREATE TABLE job_runs (
  id          TEXT PRIMARY KEY,
  job         TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok','warn','error')),
  detail      TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER
) STRICT;
CREATE INDEX idx_job_runs ON job_runs(job, started_at DESC);

INSERT INTO system_settings (key, value, updated_at) VALUES
  ('telemetry.retention_days', '90', 0),
  ('telemetry.last_processed_at', '0', 0),
  ('telemetry.processed_batches', '0', 0),
  ('platform.registration_open', 'true', 0);
