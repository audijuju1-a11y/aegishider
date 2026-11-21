# Privacy policy

Last updated: November 2026

## Data we collect

- Account: email address, display name, locale, role, organisation membership.
- Authentication: session metadata, hashed IP, user agent, single-use token records, login events.
- Authentication OTP: hashed 6-digit codes, expiry, attempts (no plaintext code stored).
- Licensing: licence prefix (not full key), activations, installation UUID, public key, fingerprint, plugin and
  server versions, heartbeat timestamps, and HMAC-hashed client IPs used for rate limits and clone detection
  (no raw IP).
- Telemetry: aggregate runtime metrics and bounded operational events. No player identifiers, chat, coordinates
  or inventories.
- Support: ticket messages, contact form content, attachments not supported.
- Audit: admin actions with actor, target, reason, request id and hashed IP.

## Why we use it

- Provide accounts, licences and activations.
- Verify licence leases and prevent abuse or licence sharing.
- Operate the customer portal, support and billing.
- Detect and respond to security incidents.
- Improve reliability using aggregate performance data.

## Legal bases (where applicable)

Contract (account and licence delivery), legitimate interests (security, abuse prevention, reliability), and
consent where required (for example optional marketing email, which is not implemented in this version).

## Retention

- Raw telemetry: telemetry.retention_days (default 90), then deleted; rollups retained for trends.
- Heartbeat hashed-IP history used for clone detection: 7 days.
- Sessions: 14 days or until revoked; expired sessions cleaned hourly.
- Login/email tokens and OTP records: 15 minutes to 1 day, then cleaned.
- Wallet/top-up and payment-event records: retained for accounting reconciliation and fraud/security review.
- Orders, licences, audit: retained for the life of the account and as required for accounting and security.
- Support tickets: retained until closed and removed by an operator.
- Contact messages: retained until handled.

## Sharing

- Cloudflare (hosting, database, storage, queues, Access) as infrastructure processor.
- Email provider (Resend, MailChannels or Gmail API) for transactional email and OTP delivery.
- Payment provider only when a real provider is integrated; the default PromptPay QR is generated locally and
  the customer's bank app handles the transfer. Bank/provider webhook payloads are stored for reconciliation.
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
