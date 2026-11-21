# ADR 0003: Ed25519 signed leases with offline grace

## Status
Accepted.

## Context
A Minecraft server must keep working when the platform is unreachable, and licence verification must not depend on a
network round trip on every tick. Revocation must eventually take effect.

## Decision
Issue short-lived (24 h default) canonical JSON leases signed with Ed25519. Plugins verify locally and cache the
lease; the network refresh is asynchronous. Offline grace (72 h default) allows continued operation after expiry.
Revocation is enforced at the next successful renewal.

## Consequences
- No per-tick network dependency; survives platform outages.
- Revocation latency up to lease TTL plus grace; documented as a limitation.
- Key rotation must overlap old keys until leases expire.
- Verification must use the exact payload bytes, not a re-serialisation.
