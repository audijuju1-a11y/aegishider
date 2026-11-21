# Architecture

## 1. Goals and constraints

- Sell multiple Minecraft plugins from one catalogue without duplicating licence, auth or admin code.
- Verify every licence cryptographically at the customer server, including while the platform is offline.
- Keep customer data isolated per organisation; never trust tenant identifiers from the browser.
- Run entirely on Cloudflare: no VPS, no external database, no third-party customer identity provider.
- Fail closed: when a security decision cannot be made, deny rather than allow.

## 2. High-level view

~~~text
                    +----------------------------------------------+
 Browser ---------->| Cloudflare Worker (Hono)                    |
                    |  middleware: request-id, CSP, session, CSRF |
                    |  - marketing SSR (public pages, docs)       |
                    |  - /auth (email+password, email link, verify) |
                    |  - /app  (customer portal, session)         |
                    |  - /admin (Access JWT / staff role)         |
                    |  - /api/v1 (public + plugin + webhooks)     |
                    |                                              |
   Minecraft ------>|  Ed25519 signature verification             |
   plugin           |  nonce + timestamp + body hash              |
                    +------+---------------+--------------+-------+
                           |               |              |
                        D1 (SQL)         KV           R2 (gzip JSON
                        users,          sessions,     telemetry
                        products,       CSRF, dev     archives)
                        licences,       email outbox,
                        installs,       new-key handoff
                        events, audit
                           |
                       Queues (agcp-telemetry) --> consumer --> rollups + R2
                                              +--> DLQ after retries
~~~

## 3. Request lifecycle

1. Static assets (/assets/*, /download/*) are served by Workers Static Assets and never hit the Worker.
2. For application paths, combinedMiddleware runs: request id (cf-ray or generated) -> security headers and CSP -> locale -> CSRF cookie -> HMAC(IP) -> session lookup.
3. Route handlers render HTML or JSON. HTML comes from typed template functions that escape every interpolation. Markdown docs are escaped before a restricted renderer emits markup.
4. onError maps AppError to JSON on /api/*, a 303 login redirect for HTML 401, and a safe error page otherwise. Unknown errors are logged with the request id and return a generic 500 in production.

## 4. Authentication and authorisation

- Customers: email a single-use 32-byte token (SHA-256 hash stored, 15 minute TTL); consuming it creates an opaque session token (hash in D1, HttpOnly cookie). CSRF uses a double-submit cookie plus an Origin/Referer check.
- Staff in production: Cloudflare Access JWT (RS256) verified against the team JWKS, issuer and audience; the verified email must map to an existing user with a staff role. There is no admin signup route.
- Development: /auth/dev-admin promotes the first ADMIN_EMAILS address and creates a session. The route is hard-disabled when ENVIRONMENT=production.
- RBAC: a static permission matrix in src/auth/guards.ts. Permissions are checked on every admin route, not only in the UI. settings.write is reserved for admin/super_admin.
- Tenant isolation: every customer query scopes by org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?). Foreign detail pages return 404 to reduce enumeration.

## 5. Licensing

- License keys are random 240-bit Crockford strings (8 groups of 6) shown once; only HMAC-SHA256(pepper, key) is stored.
- Activation codes are 16-character (80-bit) single-use codes stored as HMAC hashes with a 24 hour TTL.
- Wrong activation codes are locked per hashed source IP: 5 failures -> 5 min, 10 -> 10 min, then 20/40/80 minutes.
- Products are free: claiming a code provisions a free licence when the owner has none.
- Installations own an Ed25519 keypair. Every plugin request is signed over a canonical string including a single-use nonce and the SHA-256 of the raw body. The server verifies before parsing JSON.
- Leases are canonical JSON payloads signed by the platform private key. The format is payloadB64url.signatureB64url. Plugins verify the exact payload bytes with a published SPKI key and check expiry, installation id, product and entitlements.
- Key rotation uses signing_keys.key_id; plugins fetch the key set from /api/v1/license/keys.
- Full contract: docs/LICENSE-PROTOCOL.md.

## 5b. Free platform and OTP

- The live schema keeps legacy commerce tables for historical rows, but no route, service or UI reads or
  writes them. Orders, wallet, PromptPay, Stripe, slips and top-ups are removed.
- Every account gets a free licence automatically; the key is 240-bit, stored as HMAC-SHA256, and shown
  once through KV for 7 days.
- Claiming an activation code with no licence provisions one free of charge before creating the activation.
- Wrong codes are guarded per hashed IP with an escalating lock (5/10/20/40/80 failures -> 5/10/20/40/80 minutes).
- Login supports a 6-digit OTP in addition to the magic link. Codes are HMAC-hashed, single-use, attempt-limited
  and rate-limited. Gmail is an OAuth API adapter, not SMTP password auth.

## 6. Telemetry

- Signed heartbeats (about 3 minutes) carry aggregate runtime metrics only: versions, enabled modules, TPS/MSPT, player count, error count. Events carry a bounded message and scalar attributes; no player identifiers.
- Ingestion writes the event and enqueues a small message (id + installation + timestamp).
- The queue consumer archives the raw event to R2 (gzip), marks it processed idempotently, updates 5-minute rollups and promotes error/security events into the security feed. Failures are retried; a dead-letter queue is configured.
- The admin telemetry page reports processed batches, pending events and last processing time from real state.

## 7. Data model

- D1 tables are grouped: identity, catalogue, licensing, telemetry, support, commerce, system/audit.
- All timestamps are integer epoch milliseconds. IDs are application-generated text with prefixes.
- JSON columns are validated before writing and parsed defensively on read.
- Full schema and retention rules: docs/DATABASE.md.

## 8. Failure modes

| Failure | Behaviour |
|---|---|
| D1 unavailable | API returns 500/503; HTML error page; security state is never faked |
| Queue consumer down | events remain pending; admin telemetry shows backlog; leases unaffected |
| R2 unavailable | consumer retries; event stays pending; DLQ after max retries |
| Platform offline | plugin keeps a valid signed lease until expiry plus configured offline grace |
| Revoked while offline | revocation applies on next successful lease renewal (documented) |
| Email provider down | login reports a generic failure; no session issued |
| Access misconfigured | production admin returns 503 (fail closed), never falls back to passwords |
| Turnstile secret missing in production | login and contact fail closed |

## 9. Scaling

- Worker and assets scale automatically. All state is in D1/KV/R2/Queues.
- D1 writes are the main constraint. Rate limits, session touch throttling (10 minutes) and batched statements bound writes. Telemetry rollups are one upsert per heartbeat.
- Queue batching (25 messages / 5 seconds) and R2 archival keep the ingest path short.
- The schema is multi-product by design, so new products do not require new licence or admin code.

## 10. Code map

- Entry: src/index.ts -> src/app.ts
- Cross-cutting: src/middleware.ts, src/lib/*
- Domain: src/services/*
- HTTP: src/routes/*
- UI: src/views/*, public/assets/css/platform.css
- Tests: tests/*

ADRs are in docs/ADR/.
