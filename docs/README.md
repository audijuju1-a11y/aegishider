# Historical project documentation

The numbered documents and evidence files here are the audit, benchmark and planning
history for Aegishider. They are kept for traceability, including findings that
were later fixed.

**Current operational truth lives in [`platform/docs/`](../platform/docs/README.md)** — deployment,
operations, security, database and API docs are maintained there. If a historical document
disagrees with code or `platform/docs/`, the code and `platform/docs/` win.

## Read what where

| Question | Source of truth |
|---|---|
| Deploy, secrets, rollback, signing-key rotation | `platform/docs/DEPLOYMENT.md` |
| On-call, backups, DLQ, incidents | `platform/docs/OPERATIONS.md`, `BACKUP-RECOVERY.md` |
| Tables, retention, legacy commerce columns | `platform/docs/DATABASE.md` |
| Auth model, recovery codes, TOTP, headers | `platform/docs/SECURITY.md`, `THREAT-MODEL.md` |
| Routes, request/response shapes, signing | `platform/docs/API-SPECIFICATION.md`, `/developers` |
| Architecture and module boundaries | `platform/docs/ARCHITECTURE.md`, `ADR/` |
| Tests and local verification | `platform/docs/TESTING.md`, `platform/STATUS.md` |
| Version numbers | `aegishider-integrated/pom.xml`, `plugin.yml`, `platform/package.json` (checked by `scripts/check-version-consistency.mjs`) |

The Wave 1–3 changes (canonical host, recovery codes/TOTP, single-org helper, developer page)
and the A-01…A-15 architecture decisions are summarised in `platform/STATUS.md`, the status
section of `13-architecture-roadmap.md`, and the status notes at the end of
`12-security-audit-2026-11.md`.
