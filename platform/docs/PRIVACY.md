# Privacy policy

Last updated: November 2026

## Data we collect

- Account: email address, display name, locale, role, organisation membership.
- Authentication: session metadata, hashed IP, user agent, single-use token records, login events.
- Authentication security: password hash, recovery-code HMAC hashes and used timestamps, optional TOTP
  secret/enrolment timestamp and replay counter (no plaintext recovery codes are stored).
- Licensing: licence prefix (not full key), activations, installation UUID, public key, fingerprint, plugin and
  server versions, heartbeat timestamps, and HMAC-hashed client IPs used for rate limits and clone detection
  (no raw IP).
- Telemetry: aggregate runtime metrics and bounded operational events, plus aggregate server health (TPS/MSPT,
  players online, per-world aggregate counts, heap/CPU/GC/threads/disk, JVM/OS, plugin/protection state).
  No player identifiers, chat, coordinates, inventories or world seeds.
- Support: ticket messages, contact form content, attachments not supported.
- Audit: admin actions with actor, target, reason, request id and hashed IP.

## Why we use it

- Provide accounts, licences and activations.
- Verify licence leases and prevent abuse or licence sharing.
- Operate the customer portal and support.
- Detect and respond to security incidents.
- Improve reliability using aggregate performance data.

## Legal bases (where applicable)

Contract (account and licence delivery), legitimate interests (security, abuse prevention, reliability), and
consent where required (for example optional marketing email, which is not implemented in this version).

## Retention

- Raw telemetry: telemetry.retention_days (default 90), then deleted; rollups retained for trends.
- Server-health rollups (aggregate TPS/players/heap/CPU/entities/chunks/worlds): retained with telemetry rollups.
- Heartbeat hashed-IP history used for clone detection: 7 days.
- Sessions: 14 days or until revoked; expired sessions cleaned hourly.
- Recovery codes: active codes until used, rotated or the account is closed; used-code metadata is retained
  for security review. TOTP secrets are kept until 2FA is disabled or the account is closed.
- Legacy email token/OTP rows and legacy commerce records are read-only; current flows do not write them.
- Orders, licences, audit: retained for the life of the account and as required for accounting and security.
- Support tickets: retained until closed and removed by an operator.
- Contact messages: retained until handled.

## Sharing

- Cloudflare (hosting, database, storage, queues, Access) as infrastructure processor.
- No transactional email provider and no payment provider are configured. Account recovery uses one-time
  codes, TOTP and an operator CLI rather than email; the platform is free.
- We do not sell personal data.

## Cookies

- bh_session: HttpOnly session cookie (strictly necessary).
- bh_csrf: CSRF double-submit token (strictly necessary).
- bh_lang, bh_theme: UI preferences (functional).
- Turnstile may set its own cookies when enabled (bot protection on login, contact and activation claims).

## Your rights

Depending on your jurisdiction, you may request access, correction, deletion, restriction or portability of your
personal data, and object to processing. Use the contact channel in SUPPORT_EMAIL. We may need to verify identity
and may retain records required for legal or security purposes.

## Security

Access is protected by authentication, tenant scoping and audit logging. Licence private keys and secrets are not
stored in this database. See SECURITY.md for details.

## Children

The service is not directed at children under 13 (or the applicable age of digital consent).

## Changes

Material changes will be announced on the website. Continued use after the effective date constitutes acceptance.
