# ADR 0004: Passwordless email authentication for customers

## Status
Accepted.

## Context
Password storage and reset flows add attack surface and support burden. The platform needs verified email addresses
for licence ownership and support.

## Decision
Use single-use email links (or one-time codes) with short expiry, hashed tokens in D1, opaque HttpOnly sessions and
CSRF protection. Accounts are created on first successful verification.

## Consequences
- No password database and no password-reset flow.
- Email deliverability becomes critical; provider failures block login and must fail closed.
- Token issuance is rate-limited per IP and email hash; token replay is prevented by single-use consumption.
- Users without access to their email cannot recover the account without support intervention.
