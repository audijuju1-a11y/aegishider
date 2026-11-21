# Review fixes — 2026-11-18

Scope: Aegishider 3.6.1 source review (Improve.md, เอกสารปรับปรุง.markdown, ข้อมูล.md) and the
signup/sign-in failure on the control platform. Per instruction this pass **changed source and ran
tests only**; no plugin JAR was packaged or deployed and no obfuscation build was introduced.

## 1. Signup / sign-in failure (root cause and fix)

- Production registration/login returned HTTP 500.
- Worker logs: `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported
  (requested 210000).`
- Fix: `platform/src/auth/password.ts` now uses PBKDF2-SHA256 with **100,000** iterations (the
  Cloudflare Workers maximum). Hash format unchanged; verification clamps to 50,000–100,000.
- Added email+password auth while OTP is disabled: `/auth/register`, `/auth/login`,
  `/auth/email` (link only), `/app/account` password set/change, `AUTH_OTP_ENABLED=false`.
- `/auth/verify-otp` returns 404 "OTP ปิดชั่วคราว" while disabled.
- Non-form POSTs now return **415** instead of 500 (`platform/src/lib/http.ts`).
- Verified in production browser E2E: register → `/app` with a free licence; logout → password
  login → `/app`.

## 2. Plugin findings fixed

| Finding | Fix |
|---|---|
| `config.yml:34` key swallowed by a literal `\n`; loader default mismatch (300 vs 180) | Key is live at `security.raycast-budget-per-tick: 180`; loader default is 180; shipped-config test added |
| Invasive features enabled by default | `player-protection`, `y-shield`, `tunnel-shield` default to **false** (opt-in) |
| Time budget shares summed to 1.20× | Shares are now 0.40 + 0.45 + 0.075 + 0.075 = 1.00 |
| Reconciliation ran 1 chunk/s instead of 40 | Queue work is sliced every tick (`chunks-per-second / 20`); enqueue/rescan once per second |
| `TunnelShield.byChunk` / `revealedByViewer` non-concurrent | Concurrent maps and `ConcurrentHashMap.newKeySet()` |
| `ViewerSession` transform written on main thread, read on Netty | Cross-thread fields are `volatile` |
| Chest broken → raw `air` update leaks the position (tombstone gap) | 15-second tombstone per unregistered position; air updates are replaced with the last filler |
| Tunnel shield skipped on chunks without containers | Fast path now checks `hasTunnelsInChunk(...)` |
| Contextual filler only applied on the next chunk, never corrected | Discovery now detects filler changes and pushes a one-time filler correction to clients that already received the chunk |
| Cross-world entity-id match | Tracked entity ids are compared with the session world id |
| `replace-with` accepted air/liquid/non-solid blocks | Loader rejects them with a warning and falls back to STONE |
| Cancelled chunk packets had no recovery | Bounded resend queue (max 3 attempts, per-player 32 chunks) calls `World#refreshChunk`; unsanitized data is never sent |
| Missing storage/base-marker types | `CRAFTER`, `DECORATED_POT`, `CHISELED_BOOKSHELF`, `BOOKSHELF`, `LECTERN`, `ENDER_CHEST`, `ENCHANTING_TABLE`, `BEACON` are covered; decorative `JUKEBOX` / `NOTE_BLOCK` stay opt-in |
| Stale metadata | Config header 3.6.1, third-party notices 3.6.1, plugin website points at the platform |

## 3. Findings checked and intentionally not changed

- **Per-client state ids (N-01/N-12)**: on a Paper 1.21.4 server the outgoing buffer is encoded in the
  **server** protocol version; ViaVersion translates afterwards. The existing code comment and
  `PACKET_FORMAT_VERSION = V_1_21_4` are therefore correct for this architecture. Changing to the
  client version would corrupt state ids for translated clients. This needs a real multi-version test
  before any change.
- **Shared y-shield `BaseChunk` (N-13)**: the configuration now rejects AIR as the y-shield filler, so
  the tunnel mask cannot write into the shared section. A per-column copy remains a performance
  optimisation, not a correctness requirement.
- **Heightmap/light recalculation (N-14)**: not recalculated when replacing whole sections; requires
  a client-side visual test before changing.
- **Index soft caps / fastutil filler map (P1-04/P2-03)**: deferred; current maps are thread-safe and
  bounded at the detection bridge, and changing the storage needs a heap benchmark.
- **Reveal latency priority (F-06)**: the budget shares and discovery throughput were improved, but a
  dedicated FOV priority queue is a behavioural change that needs the live Paper harness.
- **Licence enforcement (N-10)**: the platform is now free; registration is optional by design and
  documented as such.
- **Obfuscation / Sentinel Shield pipeline**: not implemented in this pass because the instruction was
  explicitly **no build**. Introducing untested ProGuard/bytecode transforms without a production
  JAR and Paper runtime verification would violate the "no user regressions" requirement.

## 4. Verification run in this pass

| Check | Result |
|---|---|
| Platform `tsc --noEmit` | PASS |
| Platform vitest | **21/21 PASS** (password auth, OTP disabled, 415 guards, free licence, lockouts, admin graphs) |
| Plugin JUnit, Windows JDK 21 | **123 tests, 0 failures** (1 POSIX-only test skipped on Windows) |
| Plugin JUnit, WSL Arch Linux JDK 21 | **123/123 PASS** including POSIX permissions |
| Production signup/login browser E2E | PASS (register → app, logout → password login → app) |
| Plugin JAR build | **NOT RUN** (per instruction) |
| A–F Paper benchmark | **NOT RUN** (requires packaging the JAR, per instruction) |
| Obfuscation/red-team of a protected JAR | **NOT RUN** (no protected JAR was produced) |

## 5. Remaining work before a release build

1. Build the protected JAR, run the Windows/Linux suites against it, and run the A–F benchmark.
2. Add the FOV-priority reveal queue and verify p95 reveal latency on Paper.
3. Benchmark the filler/index memory changes before switching to fastutil maps.
4. Re-test ViaVersion/newer clients before changing state-id handling.
5. Configure a verified Resend domain so email-link recovery works for every owner (password signup
   already works without email).
