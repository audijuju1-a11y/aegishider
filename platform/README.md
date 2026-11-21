# Aegishider Control Platform (AGCP)

Free multi-product platform for Minecraft plugins: public storefront, owner portal with email+password login,
developer admin console, Ed25519 license leases, activation pairing, telemetry, admin graphs/alerts and
abuse protection — all on Cloudflare Workers + D1 + KV + R2 + Queues.

**There is no paid system.** Wallet, PromptPay, Stripe, orders, slips and top-ups were removed.
Every account receives a free licence with a 240-bit random key; the platform stores only an HMAC hash.

> **Status:** live on Cloudflare at **https://aegishider-platform.audijuju1.workers.dev** (Worker, D1, KV, R2,
> Queues, cron). Public pages and API are verified. Authentication is email+password only (no transactional
> email provider), and \`/admin\` works with a staff session; Cloudflare Access is an optional extra layer.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (single Worker + Static Assets) |
| Router / SSR | Hono 4 + typed HTML template functions (no SPA framework) |
| Database | Cloudflare D1 (SQLite), migrations in `migrations/` |
| Sessions / cache | Cloudflare KV (`CACHE`) plus D1-backed sessions |
| Archives | Cloudflare R2 (`ARCHIVE`) for raw telemetry JSON |
| Async | Cloudflare Queues (`agcp-telemetry` + DLQ) |
| Crypto | WebCrypto Ed25519 (SPKI/PKCS#8), HMAC-SHA256, SHA-256 |
| Admin auth | Email+password session with a staff role; optional Cloudflare Access JWT (RS256) when configured |
| Customer auth | Email+password only (PBKDF2-SHA256); opaque HttpOnly session cookie, CSRF double-submit |
| Tests | Vitest 4 with `@cloudflare/vitest-plugin` (workerd, real D1/KV/R2/Queue bindings) |

## Layout

```
src/
  index.ts             Worker entry (fetch / queue / scheduled)
  app.ts               Hono app, error handling, 404
  middleware.ts        request id, security headers, CSP, session, CSRF, lang, IP hash
  auth/                sessions, email tokens, Turnstile, Access JWT, RBAC guards
  services/            licensing, telemetry, catalog, orders, support, portal, admin, status
  routes/              marketing, auth, portal, admin, plugin/public API
  views/               server-rendered UI (layout, marketing, portal, admin, auth)
  content/docs.ts      in-app documentation
migrations/0001_init.sql
seed/                  Aegishider product + plan + release, copy refresh script
public/                CSS, JS, fonts, favicon, jar download, robots.txt
tests/                 workerd integration tests + helpers
scripts/               key generation, e2e licence smoke test, shots/QA helpers
docs/                  architecture, security, DB, API, protocol, ops, ADRs
```

## Quick start (local)

Requirements: Node 24 + pnpm 11 (or use the bundled runtimes), and Windows/macOS/Linux.

```bash
cd platform
pnpm install            # single-package pnpm workspace (`packages: ["."]`)

# local D1 (same local state used by wrangler dev)
pnpm db:migrate:local
pnpm db:seed:local

# optional: generate your own dev signing key and derive the public key
pnpm keygen
node scripts/dev-public-key.mjs

pnpm dev          # http://127.0.0.1:8787
```

Production admin: sign in at `/auth/login` with the staff email+password, then open `/admin`. The account must
have a staff role (`super_admin`, `admin`, ...). No Cloudflare Access or email provider is required.

Local admin bootstrap: set `DEV_BOOTSTRAP=1` and `DEV_ADMIN_TOKEN=<16+ characters>` in `.dev.vars`, then
open `http://127.0.0.1:8787/auth/dev-admin?token=<token>` (or send the `x-dev-admin-token` header). It signs in
the first address in `ADMIN_EMAILS` and grants `super_admin`. The route answers 404 unless both variables are
set and `ENVIRONMENT !== production`.

Customer sign-up collects **email + password** and signs the account in immediately. A passwordless,
never-verified placeholder account (created by the old email-only flow) is completed by its first password
registration. Duplicate sign-ups are rejected with "มีบัญชีแล้ว" and there is no email-link/OTP path.

## Environment

Copy `.dev.vars.example` → `.dev.vars` and fill the values. Secrets required for production:

| Name | Purpose |
|---|---|
| `LICENSE_KEY_PEPPER` | HMAC pepper for license keys and activation codes |
| `LICENSE_SIGNING_KEY` | Ed25519 private key, PKCS#8 DER base64 |
| `LICENSE_PUBLIC_KEY` | matching SPKI DER base64 |
| `LICENSE_SIGNING_KEY_ID` | key id published to plugins (rotation support) |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | optional Cloudflare Access layer for `/admin`; not required for session login |
| `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY` | bot protection on login/register/contact/activation |
| `EMAIL_PROVIDER` | `none` in production (password-only); `console` for legacy local email debugging |
| `MAIL_FROM` | legacy sender label; unused when `EMAIL_PROVIDER=none` |
| `OTP_PEPPER` | optional dedicated pepper for legacy OTP hashes; falls back to `LICENSE_KEY_PEPPER` |
| `IP_HASH_PEPPER` | optional dedicated pepper for hashed IPs in rate limits/analytics; falls back to `LICENSE_KEY_PEPPER` and fails closed in production |

Non-secret vars: `APP_URL`, `ENVIRONMENT`, session/lease TTLs, `EMAIL_OTP_TTL_MINUTES`, `ADMIN_EMAILS` (development only).

## Email

Transactional email is disabled (`EMAIL_PROVIDER=none`); there is no Resend, OTP or email-link path.
`sendEmail` becomes a logged no-op so support/ticket actions still work. Authentication is
email+password and admin access uses the same session with a staff role.

## Verification (run locally)

```bash
pnpm typecheck          # strict TypeScript, no errors
pnpm test               # 32 tests: crypto, auth, licensing, tenancy, admin, telemetry, free licence issuance
node scripts/e2e-license.mjs

# plugin client (Java 21 / Maven)
cd ../aegishider-integrated
mvn test                # 147 tests
```

The e2e script exercises the real HTTP surface: dev admin login → issue licence → plugin registration →
portal activation claim → signed lease (verified locally with the published key) → heartbeat → events →
replay rejection → portal visibility. It expects the dev server on port 8787.

## License protocol (short)

1. Plugin creates an installation UUID + Ed25519 keypair and registers it (`/api/v1/installations/register`).
2. Backend returns a 16-character (80-bit) activation code; the owner claims it in the portal and a free licence is provisioned automatically.
3. Plugin requests a signed lease with a signed request:

   ```
   METHOD\npathname\ninstallation_uuid\ntimestamp\nnonce\nsha256hex(rawBody)
   ```

   Headers: `X-AG-Installation`, `X-AG-Timestamp`, `X-AG-Nonce`, `X-AG-Signature`.
   The legacy `X-BH-*` set is accepted too; send one complete prefix set per request.
4. The lease is `payloadB64url.signatureB64url`; the payload is canonical JSON and the signature covers
   the exact payload bytes. Plugins verify with the published SPKI keys.
5. Leases default to 24 h TTL with 72 h offline grace. Revocation takes effect on the next renewal.

Full contract: `docs/API-SPECIFICATION.md`, `docs/LICENSE-PROTOCOL.md`.

## Deployment (summary)

Cloudflare account required. Create D1/KV/R2/Queues, replace the placeholder IDs in `wrangler.jsonc`,
set secrets, apply migrations remotely, seed the catalogue once, then deploy:

```bash
npx wrangler d1 create agcp-db
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create agcp-archive
npx wrangler queues create agcp-telemetry
npx wrangler queues create agcp-telemetry-dlq

npx wrangler d1 migrations apply agcp-db --remote
npx wrangler d1 execute agcp-db --remote --file=./seed/seed.sql
npx wrangler secret put LICENSE_SIGNING_KEY
# ... other secrets
npx wrangler deploy
```

Deployment is live. Turnstile is configured; Cloudflare Access is optional and email is disabled. See
`docs/DEPLOYMENT.md` for the full checklist and rollback steps.

## Known gaps

- Turnstile is enabled in production; automated end-to-end login needs a real browser challenge.
- No transactional email provider is used. Generic support notifications stay in the portal.
- Cloudflare Access and Resend/Gmail code paths were removed or disabled; licensing itself is fully free.
- Multi-user organisations, file attachments and invoice PDFs are not implemented (invoices are no longer relevant: the platform has no payments).
- Light theme exists; marketing copy is Thai-first with English UI strings partially available.

## Local free-licence test

1. Boot `pnpm dev` (or use the automated tests: `pnpm test`).
2. Sign in through the dev route, open `/app`, and the account receives a free Aegishider licence.
3. Open `/app/licenses`, copy the long key shown for 7 days, and claim the plugin's 16-character
   activation code at `/app/activations`.
4. Wrong activation codes from one IP raise the lockout ladder; watch it in `/admin/security`.
