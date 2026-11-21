-- Observability for Wave 3: one request-counter row per minute, current alert
-- state and the history of alert transitions. Written by
-- src/services/observability.ts (middleware increments, 5-minute cron evaluates).

CREATE TABLE metric_counters (
  bucket_start INTEGER PRIMARY KEY,
  total        INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE alert_state (
  key         TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  value       REAL NOT NULL,
  threshold   REAL NOT NULL,
  message     TEXT NOT NULL,
  fired_at    INTEGER,
  resolved_at INTEGER,
  updated_at  INTEGER NOT NULL
) STRICT;

-- One row per transition (ok -> firing or firing -> ok); steady state only
-- updates alert_state, so this keeps the history readable.
CREATE TABLE alert_events (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  status     TEXT NOT NULL,
  value      REAL NOT NULL,
  threshold  REAL NOT NULL,
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_alert_events_created ON alert_events(created_at DESC);
CREATE INDEX idx_alert_events_key ON alert_events(key, created_at DESC);
