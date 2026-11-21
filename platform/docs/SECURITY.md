# Security

## Principles

1. Fail closed. Missing configuration, missing session, unknown tenant, invalid signature or queue pressure means deny or keep hidden.
2. Server-side enforcement. Every authorisation decision comes from the database and session; nothing tenant-related is trusted from the browser.
3. Least privilege. Roles map to a fixed permission matrix, enforced in routes and reflected in the UI.
4. No secrets in the client. Ed25519 private keys, HMAC peppers and provider keys live in Worker secrets.

## Authentication

- Email+password: PBKDF2-SHA256, 16-byte salt, 100,000 iterations, constant-time comparison. Email-link and OTP routes are retired and redirect to `/auth/login`; `EMAIL_PROVIDER=none` keeps `sendEmail` a logged no-op.
- Sessions: opaque 32-byte tokens, SHA-256 hash in D1, HttpOnly + SameSite=Lax + Secure in production, 14 day TTL, revocable per session or all-other-sessions.
- CSRF: double-submit cookie plus hidden field or header, with Origin/Referer validation, mandatory on cookie-authenticated mutations. Only `APP_URL` is an accepted origin in production (the `Host` header allowance is development-only). The emailed login link is a GET that renders a confirmation form; the session is only created by the CSRF-protected POST, which prevents login-CSRF/session fixation.
- Admin: email+password session with a staff role. When Cloudflare Access is configured and an assertion is present, the JWT is verified server-side (RS256 against team JWKS, issuer, audience, exp/nbf) before falling back to the session; Access is optional, not a 503 gate.
- Development admin bootstrap (`/auth/dev-admin`) answers 404 unless `ENVIRONMENT` is not production, `DEV_BOOTSTRAP=1` **and** the request carries a matching `DEV_ADMIN_TOKEN` (16+ characters, header or query). Deploying with the wrong environment therefore cannot expose a super_admin sign-in.
- Plugin: Ed25519 request signatures with X-AG-Timestamp (+/- 300 seconds), single-use X-AG-Nonce and a SHA-256 body hash in the signed string. Nonces are inserted after signature verification; replay returns 409.
- Registration: a first registration is unauthenticated, but every **re-registration** must carry a valid signature by the public key already bound to that installation_uuid. installation_uuid and public_key are not secrets, so without proof of possession a new pairing code (and therefore the licence slot) could be claimed by anyone who saw them.
- Sign-up collects email+password, hashes it immediately, marks the account verified and creates a session. A passwordless, never-verified placeholder from the old email-only flow is completed by its first password registration; duplicate sign-ups are rejected.

## Authorisation and tenant isolation

- Every portal query includes an organisation membership subquery.
- Resource detail pages return 404 for foreign tenants.
- Admin permissions: customers.*, licenses.*, products.*, releases.write, support.*, servers.read, security.read, audit.read, telemetry.read, settings.*.
- `admin` is strictly below `super_admin`: it has every permission except `settings.write`, so it cannot change roles or platform settings. Only a `super_admin` may grant `admin`/`super_admin`.
- Admins cannot change their own role or status, and the last active administrator can be neither demoted nor disabled (server-side checks), so the console cannot be locked out.

## Cryptography

- License keys: 240-bit random (`AG-` + 8 groups x 6 symbols from a 32-symbol alphabet), HMAC-SHA256 with a secret pepper; plaintext is never stored.
- Activation codes: 16 characters from a 32-symbol alphabet (80 bits), HMAC-hashed, attempt-capped, 24 hour TTL.
- Leases: Ed25519 over canonical JSON (sorted keys, integer numbers, no whitespace). Verification is over the received payload bytes, never a re-serialisation.
- Fingerprints: SHA-256 of the SPKI DER public key, lowercase hex.
- Hashing peppers are separated by purpose: `IP_HASH_PEPPER` (falls back to `LICENSE_KEY_PEPPER`) for hashed IPs, `LICENSE_KEY_PEPPER` for licence keys and activation codes, `OTP_PEPPER` for OTP codes, plus a distinct `ip:`/`license:`/`activation:`/`otp|` context in every HMAC input. In production a missing pepper fails closed instead of using a constant.
- Secret comparisons use constant-time comparison.
- Key rotation: signing_keys supports multiple active keys with key_id; the plugin chooses the key named in the lease payload.

## Input and output

- Zod schemas with strict objects for every JSON API; unknown keys are rejected.
- Body limits: 16 KB for installation registration, 64 KB JSON, 128 KB signed plugin bodies, 5000-character support messages. Registration reads its body through a size-capped helper before parsing.
- HTML templating escapes interpolations by default. Markdown is escaped before rendering and link schemes are restricted to http(s) and relative paths.
- SQL is parameterised. LIKE input escapes %, _ and backslash, and every LIKE clause declares `ESCAPE '\'`.
- The Worker never fetches a user-supplied URL (no SSRF surface). Release artifact URLs are rendered as links, not fetched.

## Headers

CSP (self plus Turnstile), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy, COOP, HSTS in production, no-store on portal and admin responses.

## Abuse resistance

- D1 fixed-window rate limits: login (10 per 15 min per IP, 5 per 15 min per email hash), contact (5 per hour per IP), registration (20 per hour per IP), lease/heartbeat/events per installation (60 to 120 per minute).
- Turnstile on login and contact in production; a missing secret fails closed.
- Activation codes are 80-bit, single-use, expire in 24 hours and are guarded by a per-IP escalating lock.
- Plugin requests use signed canonical strings with nonces; leases are Ed25519-signed.

## Password authentication

- Email + password sign-up/login: PBKDF2-SHA256, random 16-byte salt, 100,000 iterations (the maximum
  Cloudflare Workers accepts), constant-time comparison. Passwords require at least 10 characters with
  letters and numbers.
- Login is rate-limited per source IP and per email hash. Errors are generic to avoid account enumeration.
- OTP, email-link login and email delivery are retired. Password registration/login and session-based
  admin are the supported flows; password changes happen at `/app/account`.

## Activation and OTP

- Login links are confirmed through a CSRF-protected POST and rate-limited per hashed IP (30 per 15 minutes).
- Raw licence keys are shown once (KV slot with a 10-minute TTL, deleted on first display) and are never returned to read-only organisation members.
- Activation claims are limited to 8-32 input characters, matched against HMAC hashes, single-use and expire
  in 24 hours. Wrong claims are counted per hashed IP; 5 failures lock 5 minutes, 10 lock 10 minutes, then
  20/40/80 minutes. The guard records plugin slugs, installation IDs and server names for admin review.
- Licence keys are 240-bit random values; D1 stores only HMAC-SHA256(pepper, key).
- OTP codes are 6 digits, hashed with HMAC-SHA256 and a pepper, single-use, 10-minute TTL, max 5 attempts,
  and rate-limited per IP/email. Successful OTP/magic-link login marks `email_verified_at`.
- Gmail delivery uses an OAuth refresh token; the platform never accepts or stores a Gmail account password.

## Auditing

- Admin mutations (including support ticket status changes) write an immutable admin_audit_events row with actor, action, target, before/after summary, reason, request id and hashed IP. If that write fails, the attempt is recorded in `security_events` instead of being dropped.
- Security events record login, logout, registration, activation, invalid signatures and contact failures.
- Logs are structured JSON; sensitive keys are redacted by the logger.

## Residual risks

- Cloudflare and Cloudflare Access (when enabled) are trusted third parties. No email provider is used.
- A compromised customer server can copy its licence folder and private key. Fingerprinting detects duplicates but cannot prevent determined tampering.
- Revocation is not instantaneous while a plugin is offline with a still-valid lease. Suspended installations are rejected on signed requests, but an offline server keeps its last lease until expiry.
- PBKDF2-SHA256 uses 100,000 iterations, the Cloudflare Workers maximum, below OWASP's current recommendation; rate limits, the 10-character policy and generic errors compensate.
- Release artifacts are served with a published SHA-256 and a per-IP download limit; the plugin pins the jar hash it was built against, but it does not verify a platform signature before a first run.
- Defence in depth for release artifacts: only the current reviewed jar is shipped in the Worker assets and static site; older vulnerable builds were removed, and CI/deploy must keep that true.
- DDoS beyond Cloudflare edge protections and our rate limits is out of scope.
- The platform cannot verify that a customer Minecraft server is honest; it only verifies signed requests.

## Audit

The full repository audit (2026-11-19), including confirmed defects and remediation order, is in
[`docs/12-security-audit-2026-11.md`](../../docs/12-security-audit-2026-11.md).

## Reporting

Contact the address configured in SUPPORT_EMAIL with reproduction steps. Do not disclose publicly before coordination. No bounty programme is advertised.
