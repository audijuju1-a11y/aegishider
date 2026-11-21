# Testing

## Commands

~~~bash
pnpm typecheck        # strict TypeScript
pnpm test             # 15 tests: crypto, auth/OTP, licensing, tenancy, admin, telemetry, free licence, lockout ladder, dashboard
node scripts/e2e-license.mjs
~~~

The e2e script needs a running dev server on http://127.0.0.1:8787 with local D1 migrated and seeded. It creates
real rows (a licence, installation, heartbeat and event) and should be used only in development/staging.

## Automated coverage

### Crypto and schema (tests/crypto.test.ts)
- Ed25519 keypair generation, sign/verify, PKCS#8 round-trip, fingerprint stability.
- D1 migrations apply and core tables exist.

### Platform (tests/platform.test.ts)
- Marketing pages, product detail, docs, 404.
- Public API product catalogue and signing keys.
- Login: CSRF rejection, email link creation, single-use verification, session issuance, replay rejection.
- Licensing: signed lease signature verification with the published SPKI key, claim values, heartbeat ingest,
  rollup creation, R2 archive existence, tampered signature rejection, revoked-licence denial.
- Tenant isolation: user B cannot read user A licence or server; customer cannot access /admin.
- Admin: product creation through the HTML form with CSRF, public visibility, audit row; manual order paid issues
  a licence.
- Webhook: valid HMAC marks the order paid, replay is idempotent, invalid HMAC is rejected.
- Telemetry events: signed ingest, duplicate event id is counted and not re-enqueued, error event creates a
  security event with a deterministic id.
- PromptPay: phone normalisation, EMVCo payload fields, CRC-16 validation, QR SVG generation.
- Wallet: top-up credit exactly once, auto top-up creation, conditional debit, order payment from wallet,
  refund path.
- Bank webhook: valid HMAC credits, replay is idempotent, invalid HMAC is rejected, amount mismatch is rejected.
- Stripe provider: PaymentIntent form/idempotency, Stripe-Signature verification with timestamp tolerance,
  signed webhook credit, replay duplicate, invalid signature rejected.
- OTP: 6-digit code from the dev outbox, single-use verification, session issuance, replay rejection, email
  verification timestamp.

All tests run inside workerd with real D1/KV/R2/Queue bindings and apply migrations in tests/setup.ts.
Each test resets mutable tables so tests are order-independent.

## Manual verification checklist

1. pnpm dev; open / and /plugins; verify product page, docs and status.
2. /auth/login with a test email; open the console link; verify /app.
3. /auth/dev-admin; verify dashboard graphs, customers, licence issue, product create, telemetry.
4. Register a test installation via scripts/e2e-license.mjs; verify portal server and admin telemetry.
5. Open /app; verify a free licence is provisioned and its long key is visible for 7 days.
6. Claim a plugin activation code at /app/activations; verify the installation becomes active.
7. Send five wrong activation codes from one IP; verify /admin/security shows the 5-minute lock.
8. Test the OTP login: request a code, read it from the console/dev outbox, verify and replay (must fail).
9. Change theme and language cookie; verify rendering and check the console for CSP violations.

## Security test matrix

| Test | Covered |
|---|---|
| Cross-tenant licence/server access | automated |
| Customer accessing admin | automated |
| CSRF missing token | automated |
| Single-use login token replay | automated |
| Signed request tampering | automated |
| Signed request replay | e2e script and manual |
| Revoked licence lease | automated |
| Webhook signature forgery | automated |
| Webhook replay | automated |
| PromptPay payload/CRC | automated |
| Wallet double-credit / refund | automated |
| Stripe signature/webhook | automated (mocked API) |
| OTP replay | automated |
| Rate limiting | implemented; not asserted end-to-end |
| Turnstile rejection | requires live secret; not automated |
| Access JWT verification | requires live Access; not automated |
| SQL injection / XSS payloads | schemas and escaping; no dedicated fuzz suite |
| R2 unavailable / queue retry | not simulated |

## Plugin client (Java)

~~~bash
cd ../aegishider-integrated
mvn test
~~~

102 tests, including 17 platform-client tests: JSON parser/writer, canonical signing string,
installation identity persistence and signing, lease signature/claims/expiry/tampering
rejection, and config parsing/clamping. The live smoke used
`dev.audismp.aegishider.platform.PlatformLiveSmoke` against the local platform:
register -> activation code -> portal claim -> signed lease verified locally -> heartbeat
accepted.

The same flow was then verified on a real Paper 1.21.4 staging server with the 3.6.1 jar:
plugin enabled, packet gateway ACTIVE, Tunnel Shield diagnostics present, licence ACTIVE
after portal claim, heartbeat accepted by the platform, clean shutdown with no exceptions.
The staging server and its test identity were removed after the run.

## Not covered yet

- Real Cloudflare deployment and live provider integrations.
- Browser end-to-end automation (Playwright) for every form.
- Two-client Tunnel Shield behaviour on 3.6.1 (the tunnel code is unchanged from the
  3.6.0 build verified on a live server; 3.6.1 staging verified enable/lease/heartbeat).
- Load testing and live provider integrations.
- Load testing of D1 write capacity under many installations.
- Backups and restore drills (procedure documented, not executed here).
