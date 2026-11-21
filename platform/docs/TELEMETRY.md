# Telemetry

## What is collected

Heartbeats (default every 3 minutes, jittered):

- plugin, Minecraft, platform and Java versions;
- enabled module names;
- aggregate TPS, MSPT p50/p95/p99, plugin processing time, error counter, players online;
- schema version and occurred_at.

Events (batched, at most 50 per request):

- a UUID event_id, type, severity, timestamp, a message up to 500 characters;
- optional attributes: up to 20 keys with scalar values (string up to 200 characters, number or boolean).

## What is not collected

- Player names, UUIDs, raw IP addresses or inventories. Hashed IPs are kept separately for
  licence rate limits and clone detection; they are never part of the heartbeat payload.
- Chat, coordinates, world seeds or base locations.
- Configuration files, stack traces containing PII, or arbitrary binary data.
- Any data from servers that are not activated.

The plugin should filter messages before sending. The backend limits size and shape but cannot know whether a free-text message contains sensitive information.

## Pipeline

~~~text
plugin -> POST heartbeat/events (signed)
       -> validate -> telemetry_events row
       -> TELEMETRY_QUEUE message {kind,id,installationId,receivedAt}
       -> consumer -> gzip archive in R2 telemetry/YYYY/MM/DD/... (heartbeats: first per hour)
                   -> mark processed (idempotent)
                   -> 5-minute rollup upsert
                   -> security_events for error/security types
                   -> clone signal when one installation heartbeats from 2+ hashed IPs in 30 min
       -> failure: retry; after max_retries -> DLQ
~~~

## Idempotency and ordering

- Heartbeat events use a generated telemetry event id, not the plugin request id. Retries of the same queue message are ignored once processed.
- Plugin events use the plugin-supplied event_id as the primary key; duplicate submissions are counted and not re-enqueued.
- Rollups are upserts keyed by (installation_id, bucket_start). Late events still land in the correct bucket.
- The consumer archives first, then marks processed. If the database update fails after archival, retries overwrite the same archive key.

## Aggregation

- Bucket size: 5 minutes.
- TPS is averaged across samples; MSPT percentiles store the latest sample per bucket (they are already percentiles, not raw values).
- Error counts are summed.
- Admin pages label these semantics; they do not claim per-second granularity.

## Retention

- Raw processed events: deleted after telemetry.retention_days (default 90) by the hourly scheduled job, in batches of 1000.
- Hashed-IP rows used for clone detection: pruned after 7 days on each heartbeat.
- R2 archives: one heartbeat per installation per hour; events are archived individually and follow the bucket lifecycle policy.
- Rollups: retained for trend charts; no automatic deletion in the current schema.
- Security events derived from telemetry: retained with the security log policy.

## Failure behaviour

- Queue consumer errors retry the message. Exhausted messages go to the DLQ, where the second
  consumer persists them in `telemetry_dlq`; operators see them at /admin/security.
- Telemetry failure never blocks licence verification or the plugin's protection features.
- The admin telemetry page shows processed batches, pending events and last processing time from D1 settings, not estimated values.

## Privacy

- IPs are stored only as HMAC hashes (pepper) and only where needed for rate limits and
  clone detection. The same installation reporting from several hashed IPs in a 30-minute
  window raises a warning event; it never auto-suspends a server, because IPv6 rotation and
  mobile networks change addresses legitimately.
- Data is readable by the customer (only their organisation) and by staff with telemetry.read.
- Telemetry can be disabled in the plugin without affecting licence checks.
