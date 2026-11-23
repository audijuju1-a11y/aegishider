# Database (D1 / SQLite)

Schema: migrations/0001_init.sql plus additive migrations through 0011_account_recovery.sql. Tables are STRICT; timestamps are integer epoch milliseconds; IDs are application-generated text (prefix + sortable time + random).

## Identity

- users: email (unique, lowercase), role, status, locale, verified/login timestamps; password_hash and
  password_updated_at (0006); totp_secret, totp_enabled_at and totp_last_counter (0011).
- recovery_codes: user_id, HMAC-SHA256 code hash, created_at, used_at; up to ten active codes per user,
  single-use, cascade-deleted with the user (0011).
- organizations: owner, slug, status.
- organization_members: composite primary key (org, user), role owner/member/read_only.
- sessions: SHA-256 token hash, expiry, revocation, hashed IP, user agent.
- email_tokens: SHA-256 hash, purpose, single-use, expiry.
- email_log: provider delivery metadata, no message bodies.

## Catalogue

- products: slug, copy, category, status (draft/published/coming_soon/archived), price, compatibility JSON, features JSON, SEO fields.
- product_plans: code/name/price/interval/entitlements JSON/activation_limit.
- product_releases: unique version and channel, notes, supported versions JSON, artifact URL and SHA-256.

## Licensing

- licenses: key_prefix and key_hash (HMAC), status, activation_limit, entitlements, expiry, revoke reason.
- installations: installation_uuid unique, public_key (SPKI), fingerprint unique, status, heartbeat.
- activation_challenges: code hash, expiry, attempts, consumption.
- activations: unique (license, installation), status active/released/revoked.
- license_leases: issued leases with jti, key_id, payload, signature, expiry.
- signing_keys: key_id, SPKI, active/retired/revoked.
- activation_nonces: replay protection with short TTL.

## Telemetry

- heartbeat_latest: one row per installation with raw payload JSON.
- telemetry_events: event id, type, severity, occurred/received, payload, processed_at.
- telemetry_rollups: 5-minute bucket with samples, TPS average, MSPT percentiles and errors.
- security_events: auth, licence, activation and webhook security signals.
- telemetry_dlq: poison messages moved to the dead letter queue (event id, installation, attempts,
  raw payload, failed/resolved timestamps). Written by the DLQ consumer (migration 0007).
- metric_counters: one row per minute with the request `total` and 5xx `errors` that feed the 5xx
  alert; the hourly cleanup keeps the last 7 days (migration 0008).
- alert_state: current status/value/message for `http.5xx_rate` and `queue.dlq_depth`.
- alert_events: one row per alert transition (firing or resolved) for the history shown on
  /admin/security (migration 0008).

## Activation guard, support, audit

- activation_guard: per-IP-hash failure count, lock level, lock expiry, plugin slugs, server names and
  installation IDs (migration 0005).
- email_otp: legacy hashed login codes; no current auth flow writes or reads this table.
- Legacy commerce tables (payment_orders, wallets, wallet_transactions, topup_orders, payment_events,
  payment_webhook_events, payment_slips) remain for historical rows only; the application no longer
  reads or writes them.

## Invariants and indexes

- Tenant ownership flows through org_id; every customer query joins organization_members.
- Unique: licenses.key_hash, installations.fingerprint_sha256, installations.installation_uuid, activations(license_id, installation_id), payment_webhook_events(provider, provider_event_id).
- recovery_codes has no plaintext column; lookups use the user-scoped HMAC hash plus `used_at IS NULL`, and
  `totp_last_counter` is the only replay state for 2FA.
- Hot indexes cover licence status/org, installations org/status/heartbeat, telemetry installation/time and pending processing, audit time/target, security time/type.
- Foreign keys: RESTRICT for products/users, CASCADE for owned child rows, SET NULL for optional links.

## Migrations

~~~bash
pnpm db:migrate:local
npx wrangler d1 migrations apply bhcp-db --remote
~~~

Migrations are additive and versioned by filename. Never edit an applied production migration; add a new one. Back up first (see BACKUP-RECOVERY.md).

## Retention

- Sessions, email tokens, nonces and rate windows are cleaned hourly by the scheduled job.
- Expired licences are marked expired; rows are retained for audit.
- Processed telemetry events are deleted after telemetry.retention_days (default 90). Raw archives in R2 follow the bucket lifecycle policy.
- Audit events are retained indefinitely by default (no deletion API).
- Contact messages and support tickets are retained until an operator closes or removes them.
- Recovery codes live until used, rotated or account deletion; TOTP state until disabled or deletion.

## Tenant-scoping checklist for new queries

1. Does the row have org_id? If not, derive it from the owner (licence or installation).
2. Include org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?).
3. For writes, re-check membership role (owner/member; block read_only).
4. Never accept org_id from the request body for customer operations.

## Legacy commerce tables (deprecated 2026-11-19)

`wallets`, `wallet_transactions`, `topup_orders`, `payment_events`, `payment_orders`,
`payment_webhook_events`, `payment_slips`, `products.price_cents` and `product_plans` are unused:
the platform is free and no route or service reads or writes them. They are kept for now because
dropping tables destroys production rows; remove them in one explicit migration after a verified
D1 export. Do not build new features on these tables.

## Retention added 2026-11-19

The hourly scheduled job now also deletes:

- `license_leases` whose `expires_at` is more than 7 days old,
- `security_events` / `email_log` / `heartbeat_latest` older than `telemetry.retention_days`,
- `job_runs` older than 90 days,
- `activation_guard` rows untouched for 7 days that are not currently locked,
- resolved `telemetry_dlq` rows older than `telemetry.retention_days` (unresolved rows are kept).
