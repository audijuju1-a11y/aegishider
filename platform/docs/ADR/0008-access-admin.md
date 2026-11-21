# ADR 0008: Cloudflare Access for the developer console

## Status
Accepted.

## Context
The admin console can issue licences, revoke access and read all customer data. It needs strong authentication and
should not share the customer passwordless flow.

## Decision
Protect /admin* with Cloudflare Access (MFA-capable) and verify the Access JWT in the Worker (JWKS, issuer,
audience, expiry). Map the verified email to a pre-provisioned staff user with a role. Fail closed if Access is not
configured in production.

## Consequences
- Strong, centrally managed admin authentication with no admin passwords in D1.
- Requires Access configuration and staff provisioning.
- Development uses a gated /auth/dev-admin bootstrap that is disabled in production.
- Every admin request still performs RBAC and audit checks in the Worker.
