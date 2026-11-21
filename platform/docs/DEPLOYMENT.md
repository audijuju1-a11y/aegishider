# Deployment

## Prerequisites

- Cloudflare account with Workers, D1, KV, R2 and Queues enabled.
- Node 24 and pnpm 11 (or use the bundled runtimes in this workspace).
- Wrangler authenticated: npx wrangler login.
- A domain on Cloudflare for the Worker route (Cloudflare Access is optional).
- No email provider is required: authentication is email+password only.

## 1. Create resources

~~~bash
npx wrangler d1 create agcp-db
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create agcp-archive
npx wrangler queues create agcp-telemetry
npx wrangler queues create agcp-telemetry-dlq
~~~

Copy the D1 database_id and KV namespace id into wrangler.jsonc, replacing the placeholder zeros.

## 2. Configure vars and secrets

Non-secret vars in wrangler.jsonc:

- ENVIRONMENT=production
- APP_URL=https://your-domain.example
- SESSION_TTL_DAYS=14, LEASE_TTL_HOURS=24, OFFLINE_GRACE_HOURS=72
- TURNSTILE_SITE_KEY, ACCESS_TEAM_DOMAIN, ACCESS_AUD
- EMAIL_PROVIDER=resend or gmail, MAIL_FROM, SUPPORT_EMAIL
- PROMPTPAY_PHONE=0925789459, PROMPTPAY_NAME=Aegishider, EMAIL_OTP_TTL_MINUTES=10
- ADMIN_EMAILS may be left empty in production (Access is the admin path)
- OBSERVABILITY_WEBHOOK_URL (optional; empty = Workers Logs only)

Secrets:

~~~bash
npx wrangler secret put LICENSE_KEY_PEPPER
# optional but recommended: a separate pepper for hashed IPs (production fails closed without a pepper)
npx wrangler secret put IP_HASH_PEPPER
npx wrangler secret put LICENSE_SIGNING_KEY
npx wrangler secret put LICENSE_PUBLIC_KEY
npx wrangler secret put LICENSE_SIGNING_KEY_ID
npx wrangler secret put TURNSTILE_SECRET
# only when the log/alert sink requires a bearer token
npx wrangler secret put OBSERVABILITY_WEBHOOK_TOKEN
# EMAIL_PROVIDER=none: no Resend/Gmail/MailChannels credentials are used.
~~~

Generate the signing key with: node scripts/generate-signing-key.mjs. Keep the private key in a password manager
as well as the Worker secret. Never commit .dev.vars.

## 3. Database

~~~bash
npx wrangler d1 migrations apply agcp-db --remote
npx wrangler d1 execute agcp-db --remote --file=./seed/seed.sql
~~~

Seeding is idempotent for the Aegishider row. The seed publishes the 3.6.1 release with its SHA-256 and the
3.2.0 history; the jar is served from `/download/Aegishider-3.6.1.jar`. Set the real price and plans in the admin
console after the first login. If you do not want to seed the Aegishider product, skip the seed and create products
in the admin UI.

## 4. Admin access

1. Sign up (or sign in) with the staff email+password at `/auth/login`.
2. Promote the account to a staff role:
   npx wrangler d1 execute agcp-db --remote --command "UPDATE users SET role='super_admin' WHERE email='you@example.com'"
3. Open `/admin` with that session. Anonymous requests redirect to `/auth/login?next=/admin`; non-staff sessions get 403.
4. Cloudflare Access is optional. If configured, an Access assertion is verified when present, then the session
   staff role is checked; missing Access env vars no longer cause a 503.

`/auth/dev-admin` is a development-only bootstrap and answers 404 unless `DEV_BOOTSTRAP=1` and
`DEV_ADMIN_TOKEN` (16+ characters) are both set; it never runs when `ENVIRONMENT=production`.

## 5. Turnstile

Create a Turnstile widget for the domain, set TURNSTILE_SITE_KEY and TURNSTILE_SECRET. In production a missing
secret blocks login and contact submissions with a clear configuration message.

## 6. Transactional email and OTP

Email is disabled (`EMAIL_PROVIDER=none`). There is no OTP, magic link, password-reset email or support
notification email; password-only auth is the supported flow. `sendEmail` logs a suppressed result so
support/ticket actions never fail because of the missing provider.

Gmail API (OAuth refresh token, not an account password):
1. Google Cloud console: enable Gmail API and create an OAuth client.
2. Authorize scope https://www.googleapis.com/auth/gmail.send for the sender account.
3. Exchange the authorization code once and store the refresh token as GMAIL_REFRESH_TOKEN.
4. Set EMAIL_PROVIDER=gmail, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_SENDER.
5. Rotate the refresh token when the account changes. A raw Gmail password/SMTP is intentionally not accepted.

Console mode is for development only; production refuses to send with EMAIL_PROVIDER=console.

## 6b. Free platform

There is no payment configuration. Wallet, PromptPay, Stripe, top-ups, slips and orders were removed;
activation codes and licence keys are the only customer-facing secrets. Configure `LICENSE_KEY_PEPPER`,
`LICENSE_SIGNING_KEY`, `LICENSE_PUBLIC_KEY` and `LICENSE_SIGNING_KEY_ID`.
## 7. Queues and cron

wrangler.jsonc already defines the producer and both consumers (telemetry and its DLQ) plus two crons:
the hourly cleanup (17 * * * *) and the five-minute alert tick (*/5 * * * *). After deploy check that the
consumers are connected:

~~~bash
npx wrangler queues consumer list agcp-telemetry
npx wrangler queues consumer list agcp-telemetry-dlq
~~~

### Messages in the DLQ

The `agcp-telemetry-dlq` consumer writes every poison message to `telemetry_dlq` and acks it,
so a message is never silently dropped. Open `/admin/security` to see open rows with their event
id, installation, attempt count and raw payload (requires `security.write` to mark one handled).

1. Search Workers logs for `queue.processing_failed` with the same event id to see the cause
   (usually a missing R2 binding, a schema violation or an exhausted database).
2. Fix and deploy the cause.
3. Replay the message from the Cloudflare dashboard (Queues → `agcp-telemetry` → Send message)
   using the payload shown in the DLQ card, or re-run the original event from the server.
   Nothing replays automatically; the admin action only records that an operator handled it.
4. Mark the row resolved on `/admin/security` and confirm the open count is zero.

Resolved rows are deleted by the hourly job after `telemetry.retention_days`; unresolved rows
stay until an operator acts.

The scheduled job cleans expired sessions, tokens, nonces and rate windows, expires licences, marks stale
installations and deletes telemetry beyond retention. It records each run in job_runs and logs a JSON line.

### Alerts and the log sink

The five-minute cron evaluates two rules and stores the result in `alert_state`:

| Rule | Fires when | Default |
|---|---|---|
| `http.5xx_rate` | share of requests that returned 5xx in the last 5 minutes | > 1% with at least 20 requests |
| `queue.dlq_depth` | unresolved rows in `telemetry_dlq` | > 0 |

Every transition is appended to `alert_events` and POSTed to the optional HTTP sink together with the
warn/error log lines buffered during the same request or run. Point the sink at any collector that
accepts JSON (a Worker, Logpush target, or a hosted logging endpoint):

~~~bash
# var in wrangler.jsonc
OBSERVABILITY_WEBHOOK_URL=https://logs.example/ingest
# optional bearer token (secret)
npx wrangler secret put OBSERVABILITY_WEBHOOK_TOKEN
~~~

The Worker sends `{ source, environment, records: [...] }` with a 3-second timeout and never blocks a
response on it. With the URL empty, logging stays in Workers Logs only and no alert is delivered out of
band; the dashboard and `/admin/security` still show the current state. `/status` adds an alerts component
that turns degraded while a rule is firing.

## 8. Deploy

~~~bash
npx wrangler deploy
~~~

Set the custom domain in the Worker settings. Then smoke test:

1. GET / and /plugins return 200.
2. GET /api/v1/health returns { data: { status: "ok" } }.
3. GET /auth/login renders and sends a real email.
4. /admin is protected by Access and renders the dashboard.
5. GET /api/v1/license/keys returns the production key id and SPKI.
6. Registration + activation + lease + heartbeat from a test installation (scripts/e2e-license.mjs can be
   adapted to the production URL, but creates test data).

## 9. Rollback

- Workers: deploy the previous version from the Cloudflare dashboard or re-deploy the previous git commit.
- D1: migrations are additive. Restore from a pre-deploy export if a migration is destructive (none are, currently).
- Secrets: rotated keys keep old public keys in signing_keys as retired until leases expire.

## 10. CI outline

~~~text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
npx wrangler deploy --dry-run
~~~

Do not run production migrations automatically before backups and review.
