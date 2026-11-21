-- Email + password authentication. OTP remains in the schema for a later
-- re-enable but is disabled by AUTH_OTP_ENABLED=false.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_updated_at INTEGER;
