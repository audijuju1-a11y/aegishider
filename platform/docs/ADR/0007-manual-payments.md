# ADR 0007: Manual payments with a provider-agnostic webhook adapter

## Status

**Superseded (November 2026).** The platform is free; wallet, PromptPay, Stripe and payment webhooks were
removed. This ADR is kept as a historical decision record.

Accepted originally.

## Context
No payment provider credentials are available, and faking a gateway would violate the project rules. The platform
still needs a usable order-to-licence flow.

## Decision
Implement a manual provider: customers create pending orders, staff verify payment and mark them paid, which issues
a licence and writes an audit row. Provide an HMAC-verified, idempotent webhook endpoint for a future provider
without changing the domain model.

## Consequences
- No card data touches the platform and no fake success state exists.
- Staff must confirm each payment manually until a provider is integrated.
- The webhook contract is tested with a signed synthetic event.
