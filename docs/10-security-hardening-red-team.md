# Security hardening and red-team review (2026-11-17)

Scope: the free Aegishider Control Platform (Cloudflare Worker + D1/KV/R2) and the Paper
plugin's platform client (`dev.audismp.aegishider.platform`). The review targeted source
exposure, memory handling, licence guessing, and Linux compatibility. It does not claim
that a JVM process controlled by its own administrator can be made tamper-proof.

## 1. Findings fixed in this change

| # | Finding | Fix |
|---|---|---|
| 1 | `api-base-url` accepted plain HTTP to any host; a network attacker could impersonate the platform | `PlatformClient` now requires `https://` and allows `http://` only for `localhost`/`127.0.0.1`/`::1` |
| 2 | JSON responses were parsed without a nesting limit; a malicious/compromised platform response could exhaust the stack | Parser depth capped at 32, response body capped at 512,000 characters |
| 3 | HTTP redirects could silently move signed requests to another origin | `HttpClient.Redirect.NEVER` (was already set, now covered by review) |
| 4 | Activation codes were 8 characters (40 bits) and worth grinding | 16 characters from a 32-symbol alphabet = 80 bits |
| 5 | Licence keys were 20 characters (100 bits) | 48 characters (8 groups of 6) = 240 bits |
| 6 | Wrong activation codes were only counted per challenge (10 tries); there was no cross-challenge lockout | Per-IP escalating lock: 5 failures → 5 min, 10 → 10 min, 20 → 20 min, 40 → 40 min, 80 → 80 min; counters reset after 24 h or on success |
| 7 | Attackers could rotate server names/installation UUIDs freely | Registrations record plugin slug, server name and installation IDs per hashed IP; the admin security page shows the cluster |
| 8 | Private key file was written before permissions were narrowed (short window under a permissive umask) | POSIX temp file created with `0600` before content, directory `0700`, permissions re-asserted on load |
| 9 | Key material stayed in temporary arrays longer than needed | Base64/file byte arrays are zero-filled after decoding; long-lived key is the required Ed25519 private key |
| 10 | No way to detect a modified plugin jar on disk | Optional `integrity.jar-sha256` pin; mismatch logs a warning and sends `integrity.mismatch` telemetry; status shown in `/aegishider license status` |

## 2. Attacks considered and their outcome

| Attack | Result |
|---|---|
| Guess an activation code online | 80-bit code; at 5 wrong attempts the source IP is locked 5 minutes, escalating. Guessing is not economically viable. |
| Guess a licence key | 240-bit key; the platform stores only HMAC-SHA256(pepper, key). Online submission of keys is not a feature. |
| Replay a signed plugin request | Rejected: timestamp skew (300 s), one-time nonce insert, body hash in the Ed25519 canonical string. Covered by tests. |
| Tamper with a lease payload | Rejected: Ed25519 signature over the exact payload bytes; tests flip a signature byte and expect 401. |
| Steal the database | Keys are hashes, IPs are HMACs. Signing private key and pepper live in Cloudflare secrets, not D1. A DB dump alone cannot mint valid leases or claim codes. |
| Copy `platform/private.key` to another server | Fingerprint/UUID pair is unique; re-registration with a different public key is rejected with 409. Duplicate fingerprints are visible to admins. |
| Patch the plugin jar | The optional jar hash pin detects the on-disk change and reports it. It does not stop a JVM agent that patches classes in memory. |
| Read process memory | A server operator/root can always do this. Only the platform private key would be useful, and it is never on the game server. The installation key only signs requests for its own installation. |
| MITM the platform API | HTTPS-only plus standard JVM trust store; no redirects; request/connect timeouts. Certificate pinning is not implemented (operational trade-off for key rotation). |
| Abuse the free platform | Registration is rate-limited (20/hour/IP hash), activation claims are guarded, telemetry is signed and capped. A public free tier cannot prevent Sybil signups entirely; the D1 limits and rate limits bound the damage. |
| Flood a licence endpoint | Per-installation limits (lease 60/min, events 120/min) and global security headers; bounded telemetry buffer on the plugin side. |

## 3. Linux verification (actually executed)

The Java suite was executed inside WSL Arch Linux with OpenJDK 21.0.13:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
cd /mnt/d/Aegishider/aegishider-integrated
mvn -B -o -Dmaven.repo.local=/mnt/c/Users/audim_r0h5i/.m2/repository test
# Tests run: 120, Failures: 0, Errors: 0 — BUILD SUCCESS
```

This run includes `InstallationIdentityTest.restrictsKeyAndDirectoryPermissionsOnPosix`,
which asserts `private.key` is `0600` and the identity directory is `0700`. Path handling uses
`java.nio.file.Path` throughout; there are no Windows-only separators or absolute paths in the
platform client or identity storage.

## 4. Sentinel Shield adaptation

Sentinel Shield protects Python artifacts; its transforms cannot be applied to Java bytecode.
The platform adopts the transferable parts of its model:

| Sentinel Shield concept | Aegishider implementation |
|---|---|
| Signed release manifest and verified loader | Ed25519-signed leases verified every refresh; optional jar SHA-256 pin for the release artifact |
| Release gates and integrity verification | `mvn verify` + 120 tests + `IntegrityGuard` startup check; mismatch telemetry |
| Secure buffers | Temporary key/base64 byte arrays zeroed after use; key file `0600`/directory `0700` on POSIX |
| Online activation + device binding | Installation UUID + Ed25519 keypair + fingerprint; signed requests; activation codes |
| Honest threat model | This document; no claim of runtime immutability |

Deliberately not implemented: anti-debugging, JVM agent suppression, class encryption or
obfuscation. They raise support costs, can break under Java updates, and are bypassable by the
process owner. The security value is in the protocol (signed leases, high-entropy codes,
lockouts, minimal secrets) rather than in hiding bytecode.

## 5. Residual risks

- The platform is only as trustworthy as Cloudflare and its secrets. Rotate `LICENSE_SIGNING_KEY`,
  `LICENSE_KEY_PEPPER` and `OTP_PEPPER` on suspicion; rotation invalidates outstanding leases and codes.
- Offline grace (72 h) keeps servers running during a platform outage but delays revocation.
- Activation codes are bearer tokens for pairing a pending installation; treat them like passwords.
- The free tier cannot distinguish a legitimate owner from an attacker with many IPs; the lockout
  ladder and admin visibility are mitigation, not prevention.
- IPv6 / NAT: the IP hash is per source address; shared NATs may lock several owners together.
  The admin can see the cluster and adjust; there is no per-user override UI yet.
- Java `String` values (configuration, JSON responses) are immutable and cannot be zeroed; only
  byte arrays holding key material are wiped explicitly.


## 6. Live red-team run (2026-11-17)

Concrete attacks executed against the built jar and the deployed Worker:

| Attack | Result |
|---|---|
| List jar contents and look for sources/secrets | No `.java`, `.git`, `.env`, `.pem` or `.key` entries. `strings` over decompressed classes found no private keys, passwords, API keys or hardcoded platform URLs (the base URL comes from config). |
| Decompile with `javap` | Full class/method inventory and bytecode recovered, including `PlatformClient.register`, `requestLease`, `send`, `requireSecureBaseUrl`; `LineNumberTable` and `LocalVariableTable` are present, so any Java decompiler can reconstruct near-source. This is inherent to Java bytecode; no secrets live there. |
| Tamper the jar | Appended/modified a resource in a copy. With the original SHA pinned, `IntegrityGuard.verify` returns `VERIFIED` from the original and `TAMPERED` from the modified jar; with no pin it returns `UNPINNED`. |
| Malformed pin | Found a false-positive: a non-hex pin made every start look `TAMPERED`. Fixed with `normalizePin` (ignores invalid pins and logs a warning) plus a unit test; final suite **121 tests** on Windows and Linux. |
| Steal the installation key | On Linux the identity directory is `0700`, `private.key` is `0600`, `identity.json` is `0644`. An attacker who can read `private.key` can sign requests as that installation (demonstrated: 64-byte Ed25519 signature produced) — file access equals impersonation, which is why the key is owner-only and never leaves the server. |
| Run a plugin command without permission | `/aegishider ...` requires `aegishider.admin` (default op); license subcommands are not exposed to regular players. |
| Production API without a signature | `POST /api/v1/installations/lease` without headers → 401. |
| Production admin | `/admin` → 503 until Cloudflare Access is configured (fail-closed). |
| Production headers | HSTS, CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy and Permissions-Policy present. |

Residual risks confirmed: a JVM agent or root can read process memory and patch classes at runtime;
the jar pin only anchors the artifact on disk. Java bytecode is always decompilable. The platform
therefore treats the plugin as untrusted code that must not contain secrets — and it does not.
