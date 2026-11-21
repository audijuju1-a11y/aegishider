# Aegishider Control Platform — status

Updated: 2026-11-19

> Honest verification status. The platform is now **free**: wallet, orders, Stripe, PromptPay,
> slips and top-ups were removed. It is deployed to production (Worker `3579adc4`, D1 migration 0005,
> R2 release jar `e8f8594c…`). Live Access/email credentials remain environment-specific and untested here.

## Verified locally

| Area | State | Evidence |
|---|---|---|
| D1 schema (identity, catalogue, licensing, telemetry, support, audit, activation guard) | Implemented | Migrations 0001–0005 applied by the vitest harness and local Wrangler |
| Free account + licence provisioning | Implemented | Automated test: register server name → 16-char code → claim → free licence created |
| Long random licence keys | Implemented | 240-bit key (`AG-` + 8×6 Crockford groups); only HMAC-SHA256 hash stored; raw key shown once via KV for 7 days |
| Activation brute-force ladder | Implemented | Automated test: 5 failures → 5 min lock, 10 failures → 10 min lock; 20/40/80 escalate further; IP hash + plugin slug + server names recorded |
| Admin graphs and detection analytics | Implemented | 14-day server-rendered SVG charts (activations, telemetry, security, new users), detection breakdown, top servers, live lockout table |
| Free UI (no checkout) | Implemented | Marketing/portal/admin routes compile without wallet/order/payment UI; paid modules and tests deleted |
| Email + password login | Live | Registration signs in immediately; duplicate sign-up rejected; email-link/OTP routes redirect to password login |
| Ed25519 keys, fingerprints, signing, verification | Implemented | 4 crypto tests pass in workerd |
| Password-only registration, sessions, CSRF | Implemented | Integration test: sign-up creates a session, password change and login work, retired email routes redirect |
| Customer portal (overview, products, licences, servers, activations, support, account, security) | Implemented | All routes return 200 with a real session; tenant isolation test passes |
| Admin console (dashboard, customers, licences, products, releases, servers, support, security, audit, telemetry, settings) | Implemented | All routes return 200 for staff; customer gets 403; product creation audited |
| Licence issuance, activation pairing, signed lease, heartbeat, events | Implemented | Automated tests + `scripts/e2e-license.mjs` against the live dev Worker |
| Replay protection and tampered signature rejection | Implemented | Automated tests (401 tampered, 409 replay) |
| Telemetry queue consumer, idempotency, 5-minute rollups, R2 archive | Implemented | Consumer processed a real heartbeat; archive object listed |
| Security headers, CSP, rate limits, audit trail, structured logs | Implemented | Middleware + tests/manual |
| TypeScript strict typecheck | Passing | `pnpm typecheck` (no errors) |
| Email + password auth | Implemented | PBKDF2-SHA256 (Cloudflare cap: 100,000 iterations), 10-char policy, per-IP/email limits, session cookie; OTP disabled by `AUTH_OTP_ENABLED=false` |
| Production sign-up / sign-in | Verified | browser E2E: register → `/app` with a free licence; logout → password login → `/app` |
| Platform test suite | 32 tests passing | crypto + platform + free licensing + reset/re-activation + guard ladder + password-only auth + session admin + admin hierarchy/key visibility + content-type guards |
| Java plugin client (3.6.1) | Hardened | HTTPS-only (localhost exempt), redirects disabled, response size/depth limits, 16-char codes, server-name registration, integrity pin, POSIX 0600/0700 key files |
| Java test suite | 123 tests passing on Windows and Linux | Windows `mvn -o test`; WSL Arch Linux JDK 21 `mvn -o test`; re-run on Linux with Temurin 21.0.13 + Maven 3.9.9 after the 2026-11-19 fixes (123/123, 0 failures) |
| Three-gap packet benchmark | Verified | A–F PASS on Paper 1.21.4; baseline jar leaks all three gaps (`docs/09-three-gap-benchmark.md` in the plugin repo) |
| Local dev | Working | `wrangler dev`; pages, auth, admin and API exercised |
| Production deployment | Live | https://basehider-platform.audijuju1.workers.dev — home/product 200, email+password auth, `/admin` 200 for a super_admin session; Cloudflare Access optional |
| Production plugin download | Verified | `/release/rel_bh_361/download` returns the uploaded jar; SHA-256 matches `e8f8594c…` |
| Production registration | Verified | disposable installation registered (16-char code, server_name stored), then removed |
| Email provider | Disabled | `EMAIL_PROVIDER=none`, `RESEND_API_KEY` deleted; password-only auth needs no email delivery |
| Documentation set | Complete | `docs/` incl. 8 ADRs |

## Not done / not verified

- **Password-only trade-off**: removing email verification means account ownership is proven by the password
  alone. Existing passwordless/unverified placeholder accounts are completed by their first password
  registration; a password cannot be reset without an admin action because no email provider is configured.
- **Password hashing limit**: Cloudflare Workers rejects PBKDF2 above 100,000 iterations, so the hash uses the
  platform maximum rather than OWASP's higher recommendation. Rate limits and password policy compensate.
- **Admin login**: `/admin` uses the email+password session and a staff role. Cloudflare Access is an optional
  extra layer and is not required; there is no 503 path for missing Access env vars.
- **Live Turnstile**: widget and server verification are implemented and the production secret is configured.
- **No transactional email**: email-link, OTP, password-reset-by-email and support notification emails are
  disabled by design.
- **Browser E2E automation**: pages were smoke-tested via HTTP and screenshots; every form is not covered
  by Playwright.
- **Load testing**: D1 write limits were not load-tested with many installations; rate limits and bounded
  writes are in place.
- **In-memory protection**: a server administrator with a JVM agent can still read or patch process
  memory. The jar pin detects on-disk tampering and reports it; it cannot prove runtime integrity.

## Verified commands

~~~bash
pnpm install
pnpm typecheck
pnpm test                 # 24 platform tests passing
node scripts/e2e-license.mjs   # requires pnpm dev on :8787
cd ../aegishider-integrated && mvn test   # 123 plugin tests (Windows and Linux/WSL)
npx wrangler d1 migrations apply agcp-db --local
npx wrangler d1 execute agcp-db --local --file=./seed/seed.sql
~~~

## Open defects

A full repository audit dated 2026-11-19 is in `docs/12-security-audit-2026-11.md` (repo root).
All functional bugs it lists (B-01 … B-20, except the deferred B-13/B-15/B-16 noted there) were fixed
on 2026-11-19, together with the High security findings H-01 … H-05 (signed re-registration, dev-admin
flag + token, email-verified passwords, secret file outside git, old jars removed, draft/unpublish and
split plugin permissions). The Medium findings M-01 … M-13 were closed in the same pass (pepper separation,
mandatory Access issuer, Turnstile hostname/freshness checks, CSRF-safe login links, one-time licence keys,
admin hierarchy + last-admin guard, audit fallback, download limits, suspended installations, retention).
The architecture items A-01 … A-15 remain open; they need product/design decisions rather than local code fixes.

## Next steps

1. Keep Turnstile configured; Cloudflare Access and an email provider are optional and currently not required.
2. Add Playwright coverage for the portal and admin forms.
3. Load-test activation and telemetry ingestion and document operating thresholds.
