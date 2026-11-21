# API specification (v1)

Base URL: https://your-domain.example/api/v1

## Conventions

- JSON responses use { ldatal: ... } on success and { lerrorl: { code, message, details?, request_id } } on failure.
- All timestamps in JSON are Unix seconds for plugin APIs and ISO display strings only in HTML.
- Requests are size-limited. Unknown JSON keys are rejected by strict schemas.
- Every response carries X-Request-Id. Portal and admin responses are HTML, not part of this JSON API.

## Authentication modes

| Mode | Used by | Mechanism |
|---|---|---|
| Public | catalogue, keys, status | none |
| Signed installation | plugin lease/heartbeat/events | Ed25519 request signature + nonce |
| Webhook | payment provider | HMAC-SHA256 over timestamp.body |
| Customer session | portal HTML | HttpOnly session cookie + CSRF |
| Staff | admin HTML | Cloudflare Access JWT (production) plus staff role |

## Public endpoints

### GET /products

Returns published products.

~~~json
{ ldatal: { lproductsl: [
  { lslugl: laegishiderl, lnamel: lAegishiderl, ltaglinel: l...l, lstatusl: lpublishedl,
    lprice_centsl: 0, lcurrencyl: lTHBl, lcompatibilityl: { lminecraftl: [l1.21.4l] },
    llatest_versionl: l3.6.0l }
] } }
~~~

### GET /products/{slug}

Returns description, features, compatibility and published releases.

### GET /license/keys

~~~json
{ ldatal: { lkeysl: [ { lkey_idl: ldev-key-1l, lpublic_keyl: l<base64 SPKI DER>l } ] } }
~~~

Keys are sorted newest first. Revoked keys are excluded; retired keys remain valid for existing leases until expiry.

### GET /status

~~~json
{ ldatal: { loveralll: loperationall,
  lcomponentsl: [ { lkeyl: ldatabasel, lstatusl: loperationall, ldetaill: lresponded in 2 msl } ],
  lgenerated_atl: 1794000000000 } }
~~~

## Plugin endpoints

### POST /installations/register

Unsigned, first contact only. Rate limited per IP.

~~~json
{
  lproductl: laegishiderl,
  linstallation_uuidl: l3f1c2a90-0000-4000-8000-000000000000l,
  lpublic_keyl: l<base64 SPKI DER>l,
  lfingerprint_sha256l: l<64 lowercase hex chars>l,
  lplugin_versionl: l3.3.0l,
  lminecraft_versionl: l1.21.4l,
  lplatforml: lPaperl,
  ljava_versionl: l21l
}
~~~

Response 201:

~~~json
{ ldatal: {
  linstallation_idl: lins_...l,
  lactivation_codel: lW34WDP9Ql,
  lactivation_expires_atl: 1794086400000,
  lportal_urll: lhttps://your-domain.example/app/activationsl,
  lproductl: laegishiderl,
  lreusedl: false
} }
~~~

The server recomputes the fingerprint from public_key and rejects mismatches. Re-registering an existing UUID with the same key issues a fresh activation code; a different key returns 409.

### Signed request headers

- X-AG-Installation: installation UUID
- X-AG-Timestamp: Unix seconds, allowed skew 300 seconds
- X-AG-Nonce: base64url, 16-128 characters, single use
- X-AG-Signature: base64 Ed25519 signature

The Worker also accepts the legacy `X-BH-*` set used by BaseHider builds. Send one complete
prefix set per request; mixed prefixes are rejected.

Signed message, UTF-8, newline separated:

~~~text
METHOD
pathname
installation_uuid
timestamp
nonce
lowercase_hex_sha256(rawBodyBytes)
~~~

Notes: pathname includes /api/v1/... and excludes the query string. The body must be the exact bytes sent. The nonce is recorded after signature verification; re-use returns 409.

### POST /installations/lease

Body: { lplugin_versionl: l3.3.0l } (optional).

Response 200:

~~~json
{ ldatal: {
  lleasel: l<payloadB64url>.<signatureB64url>l,
  lkey_idl: ldev-key-1l,
  lexpires_atl: 1794086400,
  lserver_timel: 1794000000,
  lkeysl: [ { lkey_idl: ldev-key-1l, lpublic_keyl: l<base64 SPKI DER>l } ],
  loffline_grace_hoursl: 72
} }
~~~

Requirements: installation active, licence active and unexpired, activation active. Otherwise 403.

### POST /installations/heartbeat

~~~json
{
  lschema_versionl: 1,
  lplugin_versionl: l3.3.0l,
  lminecraft_versionl: l1.21.4l,
  lplatforml: lPaperl,
  ljava_versionl: l21l,
  lenabled_modulesl: [lblock-protectionl, litem-shieldl],
  lmetricsl: { ltpsl: 19.96, lmspt_p50l: 0.21, lmspt_p95l: 0.88, lmspt_p99l: 2.9,
               lplugin_ms_avgl: 0.19, lerrorsl: 0, lplayers_onlinel: 12 },
  loccurred_atl: 1794000000
}
~~~

Response 202 with received_at and event_id.

### POST /installations/events

At most 50 events per request:

~~~json
{ leventsl: [ {
  levent_idl: l<UUID>l,
  ltypel: lruntime.errorl,
  lseverityl: lerrorl,
  loccurred_atl: 1794000000,
  lmessagel: lpacket handler failed safelyl,
  lattributesl: { lmodulel: lpacketl }
} ] }
~~~

Response 202: { "accepted": 1, "duplicates": 0 }. Duplicate event_ids are idempotent.

## Removed payment endpoints

The platform no longer has a paid system. `POST /webhooks/payments/{provider}`,
`POST /webhooks/bank/promptpay` and the Stripe webhook were removed together with orders,
wallet, top-ups and slips. Requests to those paths return 404.

## Activation guard

Activation codes are 16 characters (80 bits) and are claimed in the owner portal, not through a
public API endpoint. Wrong claims are counted per hashed source IP with the following lock ladder:

| Failures | Lock |
|---|---|
| 5 | 5 minutes |
| 10 | 10 minutes |
| 20 | 20 minutes |
| 40 | 40 minutes |
| 80 | 80 minutes |

Locked responses are HTTP 429 with `Retry-After` seconds. The guard also records plugin slugs,
installation IDs and owner-supplied server names seen from that IP for the admin security page.
Counters reset on a successful claim or after 24 hours without a failure.

## Rate limits

| Scope | Limit |
|---|---|
| Register | 20/hour/IP |
| Login request | 10/15 min/IP and 5/15 min/email hash |
| Contact | 5/hour/IP |
| Lease | 60/minute/installation |
| Heartbeat | 120/minute/installation |
| Events | 120/minute/installation |

Rate-limited responses use 429 with a Retry-After header.
