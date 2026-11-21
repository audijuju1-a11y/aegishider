# License and lease protocol

## 1. Identity

Each installation generates:

- a random UUID (installation_uuid);
- an Ed25519 keypair;
- fingerprint_sha256 = lowercase hex SHA-256 of the SPKI DER public key.

The private key stays on the customer server (plugins/Aegishider/license/). The server stores the public key and fingerprint. A UUID registered with a different public key is rejected (409).

## 2. Pairing (activation)

1. Plugin calls POST /api/v1/installations/register (unsigned, first contact).
2. Backend stores the installation as pending and returns a 16-character (80-bit) activation code with a 24 hour expiry.
3. The owner opens the portal and enters the code.
4. If the owner has no licence for the product, the backend provisions a free licence with a 240-bit random key and shows it once (7 days, CACHE-backed). It then checks activation slots, creates the activation and marks the installation active.
5. Wrong codes are counted per hashed source IP. 5 failures lock for 5 minutes, 10 failures for 10 minutes, then 20/40/80 failures lock for 20/40/80 minutes. Server names and plugin slugs seen from the IP are recorded for the admin security page.

Activation codes are stored as HMAC-SHA256(pepper, code), are single-use, attempt-capped and expire.

## 3. Signed requests

Every subsequent plugin request is signed:

~~~text
canonical = METHOD + "\n" + pathname + "\n" + installation_uuid + "\n" +
            timestamp + "\n" + nonce + "\n" + sha256_hex(raw_body)
signature = Ed25519_sign(private_key, UTF8(canonical))
~~~

Headers: X-AG-Installation, X-AG-Timestamp, X-AG-Nonce, X-AG-Signature (base64).
The legacy X-BH-* header set is also accepted; one complete prefix set per request.

Server verification order:

1. Required headers and timestamp skew (300 s).
2. Look up installation by UUID; reject revoked/suspended.
3. Compute SHA-256 of the raw body and rebuild the canonical string.
4. Verify the signature with the stored public key. Invalid signatures create a security event.
5. Insert the nonce once (unique); a conflict is a replay (409).
6. Parse and validate JSON with a strict schema.

## 4. Lease format

lease = base64url(payload_bytes) + "." + base64url(signature_bytes)

The signature covers payload_bytes exactly. The payload is canonical JSON (object keys sorted, integers only, no whitespace, UTF-8).

Claims:

| Claim | Meaning |
|---|---|
| v | protocol version (1) |
| jti | lease id |
| license_id | licence row |
| product | product slug |
| product_id | product row |
| installation_id | internal installation id |
| installation_uuid | plugin installation UUID |
| entitlements | string array from the plan/licence |
| issued_at | Unix seconds |
| expires_at | Unix seconds |
| key_id | which signing key was used |

Default TTL: 24 hours (LEASE_TTL_HOURS). Offline grace: 72 hours (OFFLINE_GRACE_HOURS), returned as offline_grace_hours.

## 5. Plugin verification checklist

1. Split at the first dot; base64url-decode both parts.
2. Verify the signature over the decoded payload bytes with the public key matching key_id (pinned or fetched from /license/keys).
3. Parse JSON; reject if installation_uuid, product, or key_id do not match.
4. Reject if now < issued_at - 300 s or now > expires_at.
5. Store the lease atomically only after verification.
6. On renewal failure, continue until expires_at + offline grace; then apply the configured enforcement mode.

Do not re-serialise the payload before verifying. JSON canonicalisation differences are a common source of false negatives.

## 6. Key rotation

- signing_keys stores multiple keys with status active/retired/revoked.
- The current key id is set by LICENSE_SIGNING_KEY_ID.
- Start a new key, let clients fetch it, switch the signing key, keep the old key as retired until all leases expire, then revoke it.
- Plugins should cache the key set with a short TTL and support multiple keys.

## 7. Revocation and limits

- Revoking a licence immediately blocks new leases and refreshes.
- Existing leases remain valid until expiry, and offline installations can keep running through their grace window.
- This is an intentional trade-off: no phone-home requirement, no server downtime when the platform is unavailable.
- Fingerprints detect copied installations but cannot prevent a determined attacker from copying keys; enforce activation limits and monitor duplicate fingerprints.

## 8. Test vectors

The automated suite verifies signature verification, lease claims, tampered payload/signature rejection, replay rejection and revoked-licence denial against the workerd runtime. See tests/platform.test.ts and scripts/e2e-license.mjs.

A deterministic canonical example (spaces shown for clarity; actual bytes have none):

~~~text
METHOD=POST
pathname=/api/v1/installations/lease
installation_uuid=3f1c2a90-0000-4000-8000-000000000000
timestamp=1794000000
nonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
sha256=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
~~~

Joined with newline characters and no trailing newline.
