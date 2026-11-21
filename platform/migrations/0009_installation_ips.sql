-- Clone detection: remember which hashed client IPs each installation heartbeats from.
-- Hashes only; no raw IP is stored.
CREATE TABLE IF NOT EXISTS installation_ips (
  installation_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_installation_ips_last_seen
  ON installation_ips(installation_id, last_seen_at);
