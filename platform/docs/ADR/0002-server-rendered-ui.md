# ADR 0002: Server-rendered HTML instead of an SPA

## Status
Accepted.

## Context
The marketing site needs SEO and fast first paint; the portal is form-heavy with modest interactivity. A React SPA
would add a build pipeline, client bundle and API surface for every page.

## Decision
Render HTML on the Worker with typed template functions. Use small progressive-enhancement scripts for theme, nav,
copy buttons and confirmations. Admin and portal mutations are HTML form POSTs with redirects and CSRF.

## Consequences
- Fast, crawlable marketing pages and no client-side auth token handling.
- Less interactive UI than an SPA; complex tables rely on server-side filtering.
- Views are plain TypeScript and easy to test through HTTP.
- The existing static landing page remains a separate artifact; the platform product page is generated from the DB.
