-- Account recovery without an email provider, and TOTP second factor.
--
-- Recovery codes are one-time, HMAC-hashed (LICENSE_KEY_PEPPER) and shown until the
-- user acknowledges them or the 15-minute KV window expires. TOTP secrets are stored per user; `totp_last_counter`
-- prevents replay of a code that was already accepted.

CREATE TABLE recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id, used_at);
CREATE INDEX idx_recovery_codes_hash ON recovery_codes(code_hash);

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at INTEGER;
ALTER TABLE users ADD COLUMN totp_last_counter INTEGER;
