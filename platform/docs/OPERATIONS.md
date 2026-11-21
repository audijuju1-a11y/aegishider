# Operations

## What to watch

| Signal | Where | Healthy |
|---|---|---|
| API availability | external monitor on /api/v1/health | 200 in under a second |
| Database latency | /status component detail | single-digit ms locally; investigate sustained >200 ms |
| Telemetry backlog | /admin/telemetry, telemetry_events.processed_at IS NULL | 0 or draining |
| Last telemetry processing | /admin/telemetry | within a few minutes when servers are online |
| Stale installations | installations.status = stale | expected only for offline servers |
| Failed logins | /admin/security | no sustained spikes |
| Invalid signatures | security_events event_type = request.invalid_signature | investigate immediately |
| Queue DLQ | /admin/security (telemetry_dlq) and Cloudflare dashboard | 0 open |
| 5xx ratio | /admin dashboard card, alert_state key http.5xx_rate | under 1% over 5 minutes |
| Firing alerts | /admin/security card, /status component, alert_events | none firing |
| Alert cron | job_runs job = scheduled.alerts | every 5 minutes, status ok |
| Cron executions | job_runs table | hourly, status ok |

## Logs

Structured JSON lines with level, event, ts, request id and route. Important events:
request, email.failed, audit.write_failed, queue.processing_failed, scheduled.cleanup, webhook.failed,
telemetry.archive_failed, security_event.write_failed.

Sensitive keys (token, secret, password, authorization, api key, private, signature, cookie) are redacted.

Each request performs one small D1 upsert into the current minute row (`total`, `errors`) through
`waitUntil`, which is what makes the five-minute ratio accurate; the hourly cleanup keeps the last 7 days.
If D1 write volume ever matters more than the ratio, this counter is the first thing to move to Analytics
Engine.

Warn and error lines are also buffered and POSTed to `OBSERVABILITY_WEBHOOK_URL` when it is set, together
with alert transitions. A sink failure is itself logged as `observability.sink_failed` and never blocks a
request; check `observability.sink_rejected` for a receiver that answers non-2xx.

## Runbooks

### Telemetry backlog growing / not draining
1. Check the consumer is attached: npx wrangler queues consumer list agcp-telemetry.
2. Check Workers logs for queue.processing_failed and R2 errors.
3. Inspect the DLQ at /admin/security (table `telemetry_dlq`). If messages are poisoned, fix the cause,
   replay the payload from the Cloudflare dashboard, then mark the row resolved.
4. Confirm R2 bucket exists and the binding name matches ARCHIVE.
5. Telemetry failure does not affect licence verification; communicate scope accordingly.

### Email is disabled by design
1. `EMAIL_PROVIDER=none` is intentional; password-only auth needs no email delivery.
2. `sendEmail` logs and returns a suppressed result so support/ticket actions do not fail.
3. Password reset without email is an admin action (set a new password for the account).

### Admin console returns 403 or redirects to login
1. A redirect to `/auth/login?next=/admin` means the session is missing or expired; sign in with email+password.
2. 403 means the account is signed in but does not have a staff role; promote it in D1 (`users.role`) or via an existing super_admin.
3. Cloudflare Access is optional. If enabled, a bad assertion fails closed; remove the assertion or fix the Access app.
4. The production owner account is promoted to `super_admin`; use `/app/account` to change its password.

### Licence issuance fails
1. Check /admin/licenses and the audit log for the attempted action.
2. Confirm LICENSE_SIGNING_KEY and LICENSE_PUBLIC_KEY are present and match; ensureSigningKey throws on mismatch.
3. Check signing_keys for the configured key id and status.
4. Verify D1 write capacity and recent errors.

### Invalid signature spike
1. Confirm the plugin uses the exact request bytes and the canonical string from the docs.
2. Check the installation public_key in D1.
3. Check clock skew on the customer server (timestamp window is 300 seconds).
4. Treat repeated failures as a possible credential/compromise signal and review the installation.

### Activation lockout / suspected code guessing

1. Open /admin/security; the top table lists every hashed IP with failure count, lock level, lock expiry,
   plugin slugs and the server names seen from that IP.
2. Locks expire automatically (5/10/20/40/80 minutes based on accumulated failures) and reset after a
   successful claim or 24 hours without failures.
3. If a legitimate owner is caught behind a shared NAT, wait for the lock to expire or verify the server
   in a support ticket; there is no manual unlock button yet (database-only operation if urgent).
4. Look for repeated failures across many server names from one IP: that is the "other server names"
   signal the guard records.

### 5xx alert firing (`http.5xx_rate`)

1. Open /admin/security; the card shows the current ratio, the request count and the threshold.
2. Check Workers Logs (`observability.enabled`) for `unhandled_error` and `metrics.record_failed` in the
   same window. The counter is per minute, so a spike older than 5 minutes is expected to clear itself.
3. Reproduce the failing route with a request id from the log line (every response carries X-Request-Id).
4. A low-traffic hour cannot fire the rule: it needs at least 20 requests in the window.
5. The alert resolves on its own when the ratio drops; the transition is recorded in `alert_events`.

### DLQ depth alert firing (`queue.dlq_depth`)

1. The rule fires while any unresolved row exists, so it stays on until an operator resolves the rows.
2. Follow the DLQ runbook in DEPLOYMENT.md section 7, then mark each row handled on /admin/security.
3. Confirm the card shows zero open and the next tick (within 5 minutes) records the resolution.

### Alert cron failure

1. `job_runs` with job = scheduled.alerts and status = error carries the message in detail.
2. Alert evaluation needs `metric_counters`, `alert_state`, `alert_events`; run the migrations if a
   deployment predates migration 0008.
3. A failing sink does not change alert state; fix the receiver and the next transition is delivered.

### Scheduled job failure
1. Read job_runs status=error and the detail column.
2. Re-run manually by invoking the scheduled handler in a local/dev environment if needed.
3. Cleanup failures are safe to retry; they delete only expired rows and old processed telemetry.

## Change management

- Migrations: back up D1, review SQL, apply to staging first, then production.
- Secrets: rotate signing keys with overlap; retire old keys only after all leases expire.
- Deploys: use wrangler versions/deployments for rollback; keep .dev.vars out of source control.
- Every admin action that changes state is audited; use the reason field meaningfully.

## Escalation

Severity 1: leaked signing key, cross-tenant data exposure, auth bypass, production admin unavailable.
Severity 2: licence issuance/verification failing, telemetry outage, payment webhooks failing.
Severity 3: cosmetic bugs, documentation issues.

For severity 1, rotate secrets, invalidate sessions, review audit/security events, and notify affected customers
according to the privacy policy.
