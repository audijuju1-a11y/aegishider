# ADR 0001: Cloudflare Workers + D1 as the platform runtime

## Status
Accepted.

## Context
The platform must sell plugins, issue licences, serve a portal and ingest telemetry without operating VPS
infrastructure. The expected scale is small to medium, with bursty telemetry and low write volume per user.

## Decision
Use a single Cloudflare Worker with Static Assets, D1 for relational data, KV for ephemeral state, R2 for raw
telemetry archives and Queues for asynchronous processing.

## Consequences
- No servers to patch; global edge latency; predictable cost.
- D1 write throughput and single-region primary are the main limits; we keep writes bounded and asynchronous.
- Vendor coupling to Cloudflare APIs and limits; migrations require wrangler.
- Local development uses the same workerd runtime via wrangler/miniflare.
