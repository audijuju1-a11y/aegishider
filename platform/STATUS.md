# Aegishider Control Platform — status

Updated: 2026-11-24

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
| Email + password auth | Implemented | PBKDF2-SHA256 (Cloudflare cap: 100,000 iterations), 10-char policy, per-IP/email limits, session cookie; OTP disabled, no email provider |
| Account recovery without email | Implemented | 10 one-time HMAC-hashed recovery codes shown until acknowledged, `/auth/recover` consumes a code and revokes sessions, operator `scripts/reset-password.mjs` fallback |
| Optional TOTP 2FA | Implemented | `/app/security` enrolment with `otpauth://` URI; login verifies a 6-digit code and stores the accepted counter to reject replay; disable requires the password |
| Operator CLIs on production D1 | Verified 2026-11-23 | Disposable account: `bootstrap-admin.mjs --remote` promoted it to super_admin, `reset-password.mjs --remote` wrote a PBKDF2 hash and cleared TOTP, then the row was deleted (`leftover = 0`) |
| Public developer page | Implemented | `/developers` with endpoint table, signing canonical string/headers, rate limits and examples; linked in nav/footer |
| Architecture roadmap A-01…A-15 | Closed or explicitly deferred | Status + decisions in `docs/13-architecture-roadmap.md`; CI ratchet `scripts/check-architecture.mjs`; signing-key rotation CLI `scripts/rotate-signing-key.mjs`; history rewrite deliberately not executed |
| Production sign-up / sign-in | Verified | browser E2E: register → `/app` with a free licence; logout → password login → `/app` |
| Platform test suite | 51 tests passing (8 files) | crypto + platform + free licensing + reset/re-activation + guard ladder + password-only auth + session admin + admin hierarchy/key visibility + content-type guards + recovery codes/TOTP replay + registration recovery redirect + TOTP-disable limit + registration switch + security re-auth + one-time key display + discoverability files + product build selector |
| Public sign-up switch | Implemented | `platform.registration_open=false` now closes `/auth/register` (GET/POST) instead of only changing an admin label |
| Security-action re-auth | Implemented | Recovery-code rotation and TOTP enrolment require the current password and are rate-limited; password changes are rate-limited too |
| Java plugin client (4.0.5) | Hardened | HTTPS-only (localhost exempt), redirects disabled, response size/depth limits, 16-char codes, server-name registration, integrity pin, POSIX 0600/0700 key files |
| Java test suite | 153 tests per profile; six profiles: 912 passed, 6 POSIX-only skipped, 0 failures | Temurin JDK 21.0.13.1 / 25.0.5.1 + Maven 3.9.9; `mvn -B -P<profile> clean test`; PacketEvents 2.14.0 present → gateway ACTIVE; absent → plugin disables with NoClassDefFoundError (fail-closed) |
| Three-gap packet benchmark | Verified | A–F PASS on Paper 1.21.4; baseline jar leaks all three gaps (`docs/09-three-gap-benchmark.md` in the plugin repo) |
| Local dev | Working | `wrangler dev`; pages, auth, admin and API exercised |
| Production deployment | Live (canonical proxy) | https://aegishider-platform.audijuju1.workers.dev forwards through a service binding to `basehider-platform`, which holds the production secrets. `/`, `/developers`, `/auth/recover` and `/api/v1/health` return 200; `/app/security` redirects relatively to login; plugin endpoints return JSON 400/401 with no redirect. Migration `0011` applied 2026-11-23; the 2026-11-24 build is version `734ecb1d-4569-40c3-8a30-f49f415bd203` on `basehider-platform` |
| Pages mirror | Verified 2026-11-24 | `aegishider.pages.dev` was rebuilt from the live homepage with the same console hero, local assets and strict CSP; `/plugins`, `/app`, `/docs` and `/latest.jar` redirect to the Worker (4.0.5 build) |
| Discoverability files | Verified 2026-11-24 | Canonical/`og:url`/JSON-LD on public pages, `/sitemap.xml`, `/site.webmanifest`, `/.well-known/security.txt`, `/favicon.ico`, 1200×630 OG card |
| Download UX | Verified 2026-11-24 | Product page defaults to the recommended 1.21.11 build, exposes a build selector with exact Paper/Java range, SHA-256 copy, and a collapsed previous-release list |
| Readability and mobile | Verified 2026-11-24 | Mobile signup CTA and menu login, docs/developer overflow fixed at 360–526px, docs search and code copy, contrast tokens raised, microtype reduced |
| Production 4.0.5 registry | Verified 2026-11-23 | Six build rows published with R2 artifacts and SHA-256; all six `/release/*/download` URLs return 200; downloaded mc1.21.5 hash matches `be2bdcca…`; `/downloads/Aegishider-4.0.5-SHA256SUMS` returns 200 |
| Production plugin download | Verified for 3.6.1 (historical) | `/release/rel_bh_361/download` returned the uploaded jar; 4.0.5 artifacts are listed in `docs/releases/Aegishider-4.0.5-SHA256SUMS` and upload from `/admin/releases` |
| Production registration | Verified | disposable installation registered (16-char code, server_name stored), then removed |
| Email provider | Disabled | `EMAIL_PROVIDER=none`, `RESEND_API_KEY` deleted; password-only auth needs no email delivery |
| Documentation set | Complete | `docs/` incl. 8 ADRs |

## Not done / not verified

- **Custom domain / single origin**: the site still uses the provider hostnames. Moving to a branded domain and
  one canonical host is a product/DNS decision, not a code-only change; duplicate homepage URLs remain until
  a domain is attached.
- **Public demo media and language switch**: no gameplay video/GIF was fabricated; the site uses the real test
  evidence table. A TH/EN switch and historical uptime chart remain product work.
- **Password-only trade-off**: removing email verification means account ownership is proven by the password
  alone (plus optional TOTP). Existing passwordless/unverified placeholder accounts are completed by their
  first password registration. Lost credentials are recovered with one-time codes or an operator reset —
  never email.
- **Canonical host topology**: the app and its secrets live on `basehider-platform`; `aegishider-platform`
  forwards with a service binding and has no cron or queue triggers. Deploying the full app config under
  `aegishider-platform` returned 503 (no secrets) and must not be repeated. Never rotate
  `LICENSE_KEY_PEPPER` casually because existing licence hashes depend on it.
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
pnpm test                 # 51 platform tests passing
node scripts/e2e-license.mjs   # requires pnpm dev on :8787
cd ../aegishider-integrated && mvn test   # 153 plugin tests (Windows and Linux/WSL)
npx wrangler d1 migrations apply bhcp-db --local
npx wrangler d1 execute bhcp-db --local --file=./seed/seed.sql
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
