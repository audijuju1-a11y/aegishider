# Threat model

## Assets

- License keys, activation codes and the lease signing private key.
- Account credentials: password hashes, one-time recovery codes, optional TOTP secrets.
- Customer PII: email, organisation, sessions, hashed IPs.
- Telemetry and server fingerprints.
- Admin capabilities and the audit trail.

## Actors

- Anonymous internet user, customer, organisation owner, staff (support/product/security/admin), Cloudflare operator, operator with CLI/D1 access, malicious plugin client, compromised customer server.

## Trust boundaries

1. Browser to Worker: untrusted input, authenticated by session and CSRF.
2. Plugin to API: authenticated by Ed25519 over the canonical request; body parsed only after verification.
3. Worker to D1/KV/R2/Queues: trusted platform bindings.
4. Worker to Cloudflare Access: JWKS over TLS, JWT verified.
5. Customer server to lease: plugin verifies the signature with pinned or published public keys.

## STRIDE summary

| Threat | Example | Mitigation | Residual |
|---|---|---|---|
| Spoofing | Forged plugin request | Ed25519 signature, nonce, timestamp, body hash | Stolen private key |
| Tampering | Modified lease or body | Signature over exact bytes; body hash in signed string | None known |
| Repudiation | Admin denies action | Immutable audit rows with actor and request id | Database compromise |
| Information disclosure | Tenant A reads B licence | org-scoped queries, 404 for foreign detail | Database compromise |
| Denial of service | Login or registration flood | Rate limits, Turnstile, Cloudflare edge | Large botnets |
| Elevation of privilege | Customer hits /admin | Staff role and Access in production; dev bootstrap needs DEV_BOOTSTRAP + a token | Misconfigured Access |
| Installation hijack | Re-register a known installation_uuid to get a fresh pairing code | Re-registration must be signed by the existing installation key; the pairing code is single-use | Stolen private key |
| Account squatting | Register victim@example.com with an attacker password | Password policy, per-IP signup limits and Turnstile; email ownership is not proven, so a victim can recover with codes or an operator reset | Email ownership unverified by design |
| Session theft | Reuse a stolen session cookie | HttpOnly/SameSite cookies, password change and recovery revoke other sessions, TOTP available | Malware or same-site XSS |
| Replay | Re-send signed lease request | Single-use nonce table plus timestamp window | None known |
| Recovery/TOTP brute force | Guess a recovery code or 6-digit TOTP | 60-bit single-use HMAC codes, 10-minute TOTP step with replay counter, per-IP/email limits, TOTP-disable limit | Stolen saved codes or device |
| CSRF | Force state change | Double-submit cookie and Origin check | Same-site XSS |
| XSS | Product description HTML | Escaped templating and escaped Markdown | Future rich-text feature |
| SQL injection | Search query | Prepared statements and LIKE escaping | None known |
| SSRF | Fetch attacker URL | No outbound fetch from user input | None known |
| Key leakage | Logs contain private key | Redaction and Worker secrets | Operator error |
| Licence sharing | Copy installation key | Fingerprint uniqueness, revocation, rate limits | Determined attacker |
| Offline revocation | Revoked server keeps running | Short lease TTL plus grace; documented | Up to TTL plus grace |
| Supply chain | Malicious dependency | Small dependency set, lockfile | npm compromise |

## Out of scope

- Anti-cheat or anti-tamper on the customer machine.
- Keeping the Minecraft server itself secure (that is Aegishider's job).
- DDoS beyond Cloudflare standard protections.
- Legal compliance beyond the published privacy and terms pages.
