# Backup and recovery

## What must be backed up

| Data | Store | Method | Frequency |
|---|---|---|---|
| Relational data | D1 | SQL export via wrangler | daily, before migrations |
| Raw telemetry archives | R2 | bucket replication or lifecycle export | provider-managed |
| Signing keys | Worker secret + password manager | manual escrow | on creation/rotation |
| HMAC pepper | Worker secret + escrow | manual escrow | on rotation |
| Worker secrets (LICENSE_KEY_PEPPER, signing keys, Turnstile) | password manager | Cloudflare secret rotation | on rotation |
| Source and migrations | Git repository | push + tags | every change |

KV holds only ephemeral data (CSRF, dev email outbox, new-key handoff) and does not require backup.

## D1 export and restore

~~~bash
npx wrangler d1 export bhcp-db --remote --output backups/bhcp-$(date +%F).sql
~~~

Restore into a new database:

~~~bash
npx wrangler d1 create bhcp-db-restore
npx wrangler d1 execute bhcp-db-restore --remote --file=backups/bhcp-YYYY-MM-DD.sql
~~~

Then update wrangler.jsonc to the restored database id and deploy. Validate:
- users count and a sample login
- products/plans/releases
- licences and activations
- signing_keys (key ids)
- audit rows

Never restore over a live database without stopping writes (deploy a maintenance version or pause traffic).

## Recovery scenarios

### Accidental data deletion (single row)
Prefer restoring the specific rows from the latest export into a scratch database, verify, then insert. The audit
log records admin actions but is not a backup mechanism.

### Corrupted or lost D1 database
Create a new D1 database, import the latest export, apply any newer additive migrations, update the binding id,
deploy, and rotate secrets only if compromise is suspected. Leases remain valid on customer servers until expiry;
new leases fail until the platform is restored, so offline grace (72 h default) applies.

### R2 archive loss
Rollups and latest heartbeat remain in D1. Historical raw events are lost. Document the gap; no customer-facing
feature depends on raw archives for licence checks.

### Signing key loss
If the private key is lost and cannot be recovered from escrow, issue a new key id, publish it, and keep the old
key id in signing_keys only if the public key is still known (verification of existing leases continues). New
leases are signed with the new key. Plugins must fetch the new key set; support them through the transition.

## Targets (honest)

- Recovery point objective: 24 hours for D1 without continuous replication; 0 for source code.
- Recovery time objective: 1 to 4 hours for a full D1 restore and redeploy, depending on export size and DNS.
- R2 archives: provider durability; local recovery is not implemented.

These are engineering targets, not a contractual SLA.

## Drills

Quarterly:
1. Export D1 and restore into a scratch database.
2. Run the app against the scratch database locally and verify login, licence issuance, lease and telemetry.
3. Verify secret escrow access with the designated owner.
4. Record results in the operations log.
