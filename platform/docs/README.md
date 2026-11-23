# Aegishider platform documentation

This directory is the **source of truth** for the Cloudflare Worker platform (auth, licensing API,
database, operations and deployment). The root `docs/` directory is the historical audit and planning
archive; where the two disagree, this directory and the code win.

## Start here

| Document | Use it for |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | First deploy, secrets, Turnstile, migrations, admin bootstrap, smoke tests, rollback |
| [OPERATIONS.md](OPERATIONS.md) | Runbooks: recovery/TOTP support, reset CLI, DLQ, alerts, admin access |
| [SECURITY.md](SECURITY.md) | Auth, sessions, recovery codes, TOTP, CSRF, rate limits, residual risks |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Request lifecycle, auth, licensing, telemetry and failure modes |
| [DATABASE.md](DATABASE.md) | Tables, indexes, retention and tenant-scoping rules |
| [TESTING.md](TESTING.md) | Automated suite, manual checklist and security test matrix |
| [API-SPECIFICATION.md](API-SPECIFICATION.md) | Public/plugin HTTP contract |
| [LICENSE-PROTOCOL.md](LICENSE-PROTOCOL.md) | Activation, lease and signing protocol |
| [TELEMETRY.md](TELEMETRY.md) | Heartbeat/event payloads and rollups |
| [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md) | D1 export/restore and secret recovery |
| [PRIVACY.md](PRIVACY.md) | Data collected, retention and sharing |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Assets, actors, STRIDE summary and residual risk |
| [ADR/](ADR/) | Historical architecture decisions (0004 and 0007 are superseded) |

## Account security in one screen

There is **no transactional email provider** (`EMAIL_PROVIDER=none`). Password login is the credential,
with optional TOTP and one-time recovery codes.

- Registration: `POST /auth/register` → session → `/app/security?ok=recovery-codes`.
- Recovery codes: 10 per set, HMAC-hashed, visible until “บันทึกครบแล้ว / ซ่อนรหัส” or 15 minutes.
- Forgot password: `/auth/recover` consumes one code, resets the password, revokes every session and
  clears TOTP; a fresh set of codes is issued.
- TOTP: enrol at `/app/security`; login then requires the 6-digit code. Replays are rejected via
  `totp_last_counter`; disabling needs the password and is rate-limited.
- Operator paths: `node scripts/bootstrap-admin.mjs <email>` (first staff) and
  `node scripts/reset-password.mjs <email>` (lost password + codes; prints a temporary password once).
- `/developers` is the public API guide; `/docs/api` and `/docs/licensing` are the long-form references.
