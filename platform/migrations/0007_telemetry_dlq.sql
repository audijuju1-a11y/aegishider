-- Durable landing zone for messages Cloudflare moved to agcp-telemetry-dlq.
-- The DLQ consumer in src/queue.ts writes one row per poison message so an
-- operator can inspect and resolve it from /admin/security after a fix.

CREATE TABLE telemetry_dlq (
  id              TEXT PRIMARY KEY,
  queue           TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  kind            TEXT,
  event_id        TEXT,
  installation_id TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  payload         TEXT NOT NULL DEFAULT '{}',
  failed_at       INTEGER NOT NULL,
  resolved_at     INTEGER,
  resolved_by     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_dlq_open ON telemetry_dlq(resolved_at, failed_at DESC);
CREATE INDEX idx_dlq_failed ON telemetry_dlq(failed_at DESC);
