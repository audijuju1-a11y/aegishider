# ADR 0005: Tenant scoping enforced in every query

## Status
Accepted.

## Context
Multi-tenant data isolation is the highest-impact failure mode. Accepting org ids from the browser is unsafe.

## Decision
Every customer query derives authority from the session user and joins organization_members. Detail pages return
404 for foreign resources. Admin actions use a permission matrix and are audited. Writes re-check membership role.

## Consequences
- Slightly more verbose SQL and a join on every portal query.
- Cross-tenant access requires a code defect in a single place rather than trusting an id.
- Tests assert isolation for licences and servers.
- Admin roles can see across tenants by design; audit records every mutation.
