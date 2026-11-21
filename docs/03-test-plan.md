# Aegishider 3.1.0 — Test Plan and Verification Levels

Verification vocabulary used in this document and in the final report:

| Level | Meaning |
|---|---|
| **IMPLEMENTED** | The code exists and is wired into the running plugin. |
| **TESTED** | Automated tests exercise the code path (unit or integration). |
| **VERIFIED** | Evidence was produced on a real Paper 1.21.4 server / real client packets, or the property was proven by exhaustive construction (e.g. encoding round-trip). |
| **PARTIAL** | Implemented and partially tested/verified; a limitation is stated. |
| **NOT IMPLEMENTED** | Deliberately absent; reason stated. |

---

## 1. Automated unit tests (`mvn verify`, 57 tests)

| Test class | Tests | What it proves |
|---|---|---|
| `BlockPosUtilTest` | 5 | block position pack/unpack for min/max coordinates; chunk keys are world-scoped and collision-free; block→chunk key consistency |
| `WorldKeysTest` | 1 | UUID→worldId interning is stable and unique; unknown id is reserved |
| `BlockVisibilityTest` | 5 | absence = hidden; reveal/hide transitions; chunk resync drops only that chunk's markers; resync clears markers immediately (fail-closed); viewer cleanup |
| `VisibilityStateTest` | 2 | only VISIBLE/BYPASS allow data; fail-closed default is UNKNOWN |
| `BoundedTaskExecutorTest` | 4 | execution; **saturation rejects instead of blocking**; rejection after close; queue statistics |
| `HiddenBlockIndexTest` | 8 | world-aware register/unregister; revision increments on every mutation; atomic per-chunk replacement; empty replace clears chunk; world eviction; binary-search `ChunkView`; full snapshot; sorted-array helpers |
| `OcclusionEngineTest` | 9 | FOV inside/outside/behind/boundary; 180° hemisphere; only 360° disables the gate; injected ray tracer controls the result; squared distance |
| `MaterialSetsTest` | 10 | tile-entity and state-only `BOOKSHELF` accepted; ore/air rejected with warnings; transparent defaults; wildcard patterns |
| `ConfigLoaderTest` | 11 | secure built-in defaults (blocks+items enabled); per-world disables; invalid values clamped with warnings; unsupported hidden blocks rejected; PLAYER entity hiding rejected; **legacy v2/v3 `hidden-blocks` migration**; world overrides; minimum PacketEvents version parsing; fail-closed forced true; immutable warning list |
| `ChunkSanitizerTest` | 14 | protected block replaced by filler; stale index (air) safe; non-protected material at an indexed position NOT replaced; block entities stripped; world-transition previous view sanitized; unchanged chunk not rewritten; state-only BOOKSHELF hidden without a block entity; ender chest/enchanting table/beacon states and block entities removed; beacon beam source absent |
| `MiningAnalyticsTest` | 4 | normal mining not flagged; impossible ore rate flagged and rate-limited; straight tunnel detected; disabled analytics short-circuit and store no state |
| `PerformanceBenchmarkTest` | 1 | micro-benchmarks of the visibility primitives; prints measured values (see `docs/05-final-report.md`) |

The unit-test JVM has no running Minecraft server. `TestRegistryAccess` (test-only
`META-INF/services` provider) supplies the Paper `RegistryAccess` needed by
`Material`/`BlockType` classification. It is never packaged into the plugin jar.
Tests that need real Bukkit event dispatch/tracking are covered by the integration
harness instead of being faked with mocks.

---

## 2. Listener registration verification (the v3 P0 bug)

The old build registered only an event container class; this was the first thing the
audit confirmed. Verification in 3.1.0:

1. `AegishiderPlugin.registerListener()` registers `BlockListener`, `PlayerListener`,
   `ChunkListener`, `EntityListener`, `WorldListener` individually.
2. `/aegishider verify` cross-checks `HandlerList.getRegisteredListeners(plugin)` and fails
   with "listener not registered: X" if any is missing. The integration run called
   `/aegishider verify` → **PASS**.
3. Real behaviour evidence from the integration run:
   - player drops/chest placement (`BlockPlaceEvent`) was indexed: item/chest placed by a
     bot becomes hidden and its chunk packet is rewritten (scenario C);
   - `/summon item` fires `ItemSpawnEvent` → item is registered and hidden
     (scenario A: **zero** item spawn packets reach the client);
   - join/move/teleport drive session creation and re-evaluation (scenarios use
     teleports; chunk resend triggers sanitizer);
   - quit cleanup was exercised by the harness disconnecting both bots (server log: no
     leftover tracked entities / no errors on disable).
   - world unload/EntityRemove paths are unit-tested via the registry/cleanup APIs;
     actual world-unload on a live server is **not** part of the automated run (Paper
     cannot unload the primary world without a restart) → PARTIAL.

---

## 3. Packet-level integration harness (`D:\Aegishider\itest`)

A separate, reproducible harness (not shipped, outside the Maven module):

- Paper 1.21.4 (build 232) real server, offline, flat, port 25599; PacketEvents 2.14.0
  installed as a plugin; plugin under test copied into `plugins/`.
- Two headless clients (`minecraft-protocol` 1.68.0) record every incoming packet to
  NDJSON and dump raw chunk payloads.
- Scenarios are driven over RCON with fixtures, markers in the packet capture and a
  chunk-palette decoder that is self-tested against known states (stone/chest/observer).

### Scenarios and assertions

| Scenario | Fixture | Assertion |
|---|---|---|
| A | diamond item summoned 24 blocks away behind a full stone wall | **no** `spawn_entity`, no metadata/movement for that item UUID on either bot |
| B | diamond item ~3 blocks in front of the bot, clear line of sight | item **must** appear (spawn packet) within a bounded time; reveal latency recorded |
| C | player bot places a chest inside a stone room; room chunk is `forceload`ed for the build and every fill response is validated; exact fresh chunk waiter, then teleport 1000 blocks away and back to force resend | decoded `level_chunk_with_light` for the room chunk must contain the configured filler at the chest position, not a chest state; decoder positive controls (stone marker, floor stone, observer) must decode in the same packet; control chest semantics and measured chunk latency recorded |
| I | plain `BOOKSHELF` placed by RCON (no placement event) next to the viewer; exact room chunk waiter | arrival chunk is filler; indexed position gets a real bookshelf `block_update` when near and a filler update after leaving; final client state is not a bookshelf |
| Baseline mode | same scenarios against the legacy v3 jar | A and C **must leak**, B must be visible; a detected leak in baseline mode is a PASS (validates the detector) |

Exit codes: 0 = all expectations met, 1 = scenario assertion failed, 2 = harness/server
error. Baseline validation passed with A/C leaks and B visible; the harness was also
validated against stale-PID and concurrent-run failure modes.

### What the harness does NOT test

- 200-player / multi-region scale (needs a load fleet); stress is covered by design
  bounds + micro benchmarks.
- Protocol translation (ViaVersion) clients; other server versions.
- Netty-level timing under artificial packet floods.
- Entity types other than `ITEM` (config supports them; not part of the default test
  matrix).

---

## 4. Benchmark methodology

Two levels:

1. **Micro benchmarks** (`PerformanceBenchmarkTest`, run on the build machine): block
   position encode/decode, index lookup, `ChunkView` binary search, FOV math, ray tracer
   policy call, synthetic chunk sanitization (20 protected blocks), bounded executor
   dispatch, and the state-only scan (palette prefilter, one matching section, global
   palette fallback). These isolate Aegishider's own code cost from server noise.
   The state-scan run is captured in
   `docs/evidence/state-scan-benchmark-20261121.txt`: 24-section chunks skip in ~4.0 us,
   one matching section costs ~52 us, and the fallback scans ~98k states in ~2.4 ms.
2. **Real server measurement**: Paper 1.21.4 flat world, one headless client, idle vs.
   plugin-enabled vs. plugin-enabled with a dense dropped-item field; metrics from
   `/aegishider diag` (Aegishider's own per-tick work) and spark `/spark tps` / health for
   overall server tick time. Results are recorded in `docs/05-final-report.md` with the
   exact commands and run context.

---

## 5. Fail-closed behaviour tests

Beyond the automated tests, the following fail-closed paths were exercised manually or by
unit tests:

- packet gateway unavailable → block protection reported INACTIVE, plugin still loads,
  SEVERE log (code path; PacketEvents was installed for all integration runs, so the
  "missing gateway" path is code-reviewed + covered by the UnavailableGateway branch, not
  server-tested).
- unknown world during chunk packet → cancel (`chunkFailClosed` counter; exercised by
  unit-level reasoning; not reproducible without a client in a broken world).
- queue saturation → `BoundedTaskExecutorTest` (rejects, never blocks).
- raycast budget exhaustion → deferred work; unit-level construction plus code review.
- handler exception → packet cancelled + counter; error path is defensive and was not
  artificially triggered on the live server.
- chunk resend → verified by scenario C (markers cleared, sanitizer re-applied, stable
  filler in decoded chunk data).

---

## 6. Final results (run on this machine)

- `mvn -B -P<profile> verify` on all six profiles (mc1211, mc1214, mc1215, mc12111,
  mc261, mc263): **BUILD SUCCESS**, 141 tests, 0 failures, 0 errors, 0 skipped in each.
- Integration harness, legacy v3 jar (baseline mode): **PASS** — A LEAK (2 leaked spawns),
  B VISIBLE, C LEAK (chest state in chunk data). The detector sees real leaks.
- Integration harness, Aegishider 3.1.0: **PASS** —
  A HIDDEN (0 spawn, 0 follow-ups on both clients),
  B VISIBLE (1 spawn per client, reveal latency 22 ms in the latest run),
  C HIDDEN (`chest_in_chunk=false`, `chest_states_in_section=0`, decoder positive controls
  and chunk-resend evidence present).
- Real-server MSPT (`/mspt`) and Aegishider tick histogram, including a 300/800-item dense
  field and the startup pre-warm re-test: raw JSON in `docs/evidence/mspt-*.json`,
  summary in `docs/05-final-report.md` §7.
- The delivered jar's classes are byte-identical to the harness-tested build (verified by
  per-class SHA-256 comparison), so the packet evidence applies to the shipped artifact.
## 7. Load-test harness (3.2.0)

`bench/load-bench.js` + `bench/load-bot.js` (isolated server dir/ports 25601/25600,
datapack item bursts, capture-free bots). Measured tiers (delivered build):

| Tier | bots | items | TPS | server MSPT 5 s avg med | Aegishider p99 med |
|---|---|---|---|---|---|
| smoke | 10 | 200 | 20.0 | 4.6 ms | 3.2 ms |
| mid | 50 | 1000 | 19.1 | 11.3 ms | 2.1 ms |
| max | 200 | 2000 | 16.2-17.3 | 64.2 ms | 3.1 ms |
| soak | 10 | 200 | 20.0 | 3.3 ms | 3.2 ms |

200 bots / 2000 items is feasible on the shared 8-thread desktop but degrades TPS; this is
evidence of bounded behavior/survival, not a production capacity claim.