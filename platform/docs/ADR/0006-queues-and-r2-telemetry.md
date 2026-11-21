# ADR 0006: Queues and R2 for telemetry ingestion

## Status
Accepted.

## Context
Telemetry arrives from many servers and must not slow licence verification or the request path. Raw data is bulky
and does not belong in D1.

## Decision
Validate and persist a small event row, enqueue a compact message, archive raw payloads to R2 from the consumer,
and maintain 5-minute rollups in D1. Use idempotent event ids and a DLQ for poison messages.

## Consequences
- Fast ingest and bounded D1 writes.
- Eventual consistency for dashboards and archives.
- Consumers must be idempotent; duplicates are expected.
- Operators must monitor the DLQ and R2 lifecycle.
