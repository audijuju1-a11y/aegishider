-- Deep server health trends for the admin dashboard.
-- Values are aggregate only; no player names, UUIDs, IPs, chat or coordinates.
ALTER TABLE telemetry_rollups ADD COLUMN players_online INTEGER;
ALTER TABLE telemetry_rollups ADD COLUMN avg_ping_ms REAL;
ALTER TABLE telemetry_rollups ADD COLUMN heap_used_mb INTEGER;
ALTER TABLE telemetry_rollups ADD COLUMN heap_max_mb INTEGER;
ALTER TABLE telemetry_rollups ADD COLUMN process_cpu_load REAL;
ALTER TABLE telemetry_rollups ADD COLUMN entity_count INTEGER;
ALTER TABLE telemetry_rollups ADD COLUMN chunk_count INTEGER;
ALTER TABLE telemetry_rollups ADD COLUMN world_count INTEGER;
