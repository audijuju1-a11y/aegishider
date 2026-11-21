-- 0002 — wallet / PromptPay top-ups / email OTP / payment events
-- Additive migration. Existing licences, orders and telemetry are untouched.

-- ---------------------------------------------------------------- wallets --
CREATE TABLE wallets (
  org_id                   TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance_cents            INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency                 TEXT NOT NULL DEFAULT 'THB',
  auto_topup_enabled       INTEGER NOT NULL DEFAULT 0 CHECK (auto_topup_enabled IN (0,1)),
  auto_topup_threshold_cents INTEGER NOT NULL DEFAULT 20000 CHECK (auto_topup_threshold_cents >= 0),
  auto_topup_amount_cents  INTEGER NOT NULL DEFAULT 50000 CHECK (auto_topup_amount_cents >= 100),
  updated_at               INTEGER NOT NULL
) STRICT;

CREATE TABLE wallet_transactions (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  type                TEXT NOT NULL CHECK (type IN ('topup','order_payment','refund','adjustment')),
  amount_cents        INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
  idempotency_key     TEXT NOT NULL UNIQUE,
  reference_type      TEXT,
  reference_id        TEXT,
  description         TEXT NOT NULL,
  created_at          INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_wallet_tx_org ON wallet_transactions(org_id, created_at DESC);
CREATE INDEX idx_wallet_tx_ref ON wallet_transactions(reference_type, reference_id);

-- ------------------------------------------------------------- top-up orders --
CREATE TABLE topup_orders (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 100),
  currency         TEXT NOT NULL DEFAULT 'THB',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','expired','cancelled')),
  method           TEXT NOT NULL DEFAULT 'promptpay',
  reference        TEXT NOT NULL UNIQUE,
  promptpay_payload TEXT NOT NULL,
  qr_svg           TEXT,
  provider_ref     TEXT,
  paid_at          INTEGER,
  expires_at       INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_topup_org ON topup_orders(org_id, created_at DESC);
CREATE INDEX idx_topup_status ON topup_orders(status, expires_at);
CREATE INDEX idx_topup_user ON topup_orders(user_id, created_at DESC);

-- ---------------------------------------------------------- payment events --
CREATE TABLE payment_events (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  topup_id          TEXT REFERENCES topup_orders(id) ON DELETE SET NULL,
  status            TEXT NOT NULL CHECK (status IN ('received','processed','ignored','failed')),
  payload           TEXT NOT NULL,
  received_at       INTEGER NOT NULL,
  UNIQUE (provider, provider_event_id)
) STRICT;
CREATE INDEX idx_payment_events_received ON payment_events(received_at DESC);

-- --------------------------------------------------------------- email OTP --
CREATE TABLE email_otp (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  code_hash    TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','verify_email')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_email_otp_email ON email_otp(email, created_at DESC);
CREATE INDEX idx_email_otp_expiry ON email_otp(expires_at);
