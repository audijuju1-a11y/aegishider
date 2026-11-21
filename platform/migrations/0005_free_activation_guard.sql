-- Free platform + activation brute-force guard.
--
-- server_name records the owner-supplied server name from the plugin
-- registration payload. Only the hash of the source IP is stored, never the
-- raw address.

ALTER TABLE installations ADD COLUMN server_name TEXT;

CREATE TABLE activation_guard (
  ip_hash          TEXT PRIMARY KEY,
  failures         INTEGER NOT NULL DEFAULT 0,
  lock_level       INTEGER NOT NULL DEFAULT 0,
  locked_until     INTEGER,
  first_failure_at INTEGER,
  last_failure_at  INTEGER,
  plugin_slugs     TEXT NOT NULL DEFAULT '[]',
  server_names     TEXT NOT NULL DEFAULT '[]',
  installation_ids TEXT NOT NULL DEFAULT '[]',
  updated_at       INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_activation_guard_locked ON activation_guard(locked_until);
