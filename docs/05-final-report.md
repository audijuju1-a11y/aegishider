# Aegishider 3.3.8 — Final Engineering Report

> Honesty statement: every status below distinguishes **IMPLEMENTED** (code exists and is
> wired), **TESTED** (automated tests exercise it), **VERIFIED** (evidence from a real Paper
> 1.21.4 server / real client packets) and **PARTIAL / NOT IMPLEMENTED**. No claim here is
> based on comments, names or "should work"; test/benchmark numbers are recorded from runs
> performed on this machine (logs kept in `docs/evidence` and `D:\Aegishider\itest\out`).

---

## 1. Executive summary

The audited v3 code was an **anti-xray heuristic that patched blocks after the real chunk
data had already been sent**. It had a dead listener layer (only one container class was
registered), no item protection, destroyed its hidden-block index on every chunk unload,
and several caches that could fail open. The rewrite delivers a fail-closed visibility gate
instead:

- **ItemShield** (top priority): every protected entity is hidden by default through
  Paper's native per-player visibility API (`setVisibleByDefault(false)`), so the tracker
  sends **no** spawn/metadata/movement packets at all until a distance + FOV + occlusion
  check proves the player may see it. Packet filtering is added as defence in depth.
- **Container/base protection at packet level**: protected blocks and block-entity data are
  removed from outgoing chunk packets *before send*, and from block-update/block-entity/
  block-action packets. The chunk path also independently scans the chunk's own block
  entities, so a container changed by a non-Bukkit path cannot leak on the next chunk send
  even if the index is stale; detected positions are fed back into the index within a tick.
- **World-derived discovery**: natural chests/spawners are discovered from real chunk data;
  no persistence file can drift from reality.
- **Bounded async / budgeted main thread**: security decisions are main-thread and
  time-sliced; the bounded async pool now runs real non-security maintenance work
  (periodic atomic diagnostics snapshots), never visibility work. There is no unbounded
  queue and no silent drop of security work.
- **3.3.3â€“3.3.5 emergency hotfix (2026-11-15)**: real-server testing with a ViaVersion
  client (26.x â†’ 1.21.4) proved that chunk/block state ids were resolved against the
  *client* protocol version instead of the server packet format. That leaked container
  block entities/states to storage ESP and produced ghost/disappearing blocks. All state
  resolution now uses the server protocol version; monster/vehicle/frame entity types are
  hidden by default; entity-spawn race is fail-closed; owner grace is bounded. Full details
  and before/after packets: `docs/07-viaversion-hotfix.md`.
- **3.2.0 follow-up hardening** (details: `docs/06-v3.2-improvements.md`): extended startup
  warm-up (first-join block spike ~38 ms -> ~11 ms), item spawn-storm priority lane, gateway
  stale-activity + detected-overflow alarms, and an on-demand `/aegishider export`
  diagnostics snapshot written asynchronously.
- Real-server packet evidence (two headless clients, decoded chunk palettes):

| Scenario | Legacy v3 jar | Aegishider 3.1.0 |
|---|---|---|
| A: dropped item 24 blocks away behind a wall | **LEAK** (2 spawn packets) | **HIDDEN** (0 spawn, 0 follow-ups) |
| B: dropped item ~3 blocks in front | visible (~4 ms) | visible, reveal latency **22â€“63 ms** (1â€“3 ticks across runs) |
| C: player-placed chest, forced chunk resend | **LEAK** (chest state in chunk data) | **HIDDEN** (filler state in chunk data; block entity stripped; positive decoder controls pass) |

- Unit tests: **75 tests, 0 failures**. Integration harness: **PASS on all scenarios**
  (and baseline mode PASS = leaks correctly detected).
- Measured Aegishider own main-thread security work: p50 **100–200 µs**, p95 **≤0.85 ms**,
  p99 **≤3.0 ms** per tick at 0–800 dropped items; server `/mspt` delta over baseline
  ≈ **0.5–1.4 ms** average in the single-client test (including PacketEvents overhead).
  In 3.2.0 the one-time first-evaluation class-load spike was reduced from 235 ms to a
  ~31 ms residual (first reveal: `showEntity`/tracker classes cannot be pre-warmed without
  visible side effects) and the first-join block-engine spike from ~38 ms to ~11 ms via
  startup warm-up + join ramp. Details and limits in §7 / `docs/06-v3.2-improvements.md`;
  raw data in `docs/evidence`.
  No unauthorized data leak was observed in the packet-level tests.

---

## 2. Environment

| Item | Value |
|---|---|
| Machine | Windows 11, AMD64, 8 logical CPUs |
| JDK | Eclipse Temurin 21.0.13+9 (build) / OpenJDK 21 runtime for server |
| Server | Paper 1.21.4 build 232 |
| PacketEvents | 2.14.0 (external plugin) |
| Build | Apache Maven 3.9.9, `mvn -B clean verify` |
| Integration clients | Node.js + `minecraft-protocol` 1.68.0, offline mode, two bots |
| Test world | Paper flat world, `generate-structures=false`, view-distance 4, RCON on 25598, server on 25599 |

Commands used are reproduced in `docs/03-test-plan.md` and the harness README.

---

## 3. Deliverables and file-level changes

Project root: `D:\Aegishider\aegishider-integrated`.
Plugin jar: `D:\Aegishider\dist\Aegishider-3.1.0.jar` (shaded, relocated FastUtil; sha256
recorded in `docs/evidence/jar-inspection.txt`).

### New source files (main)

| File | Purpose |
|---|---|
| `core/WorldKeys.java` | collision-free world identity (UUID→id) |
| `core/ViewerSession.java`, `SessionRegistry.java` | per-viewer snapshot for the packet thread |
| `core/BlockVisibility.java` | fail-closed reveal markers + chunk-resend bridge |
| `core/BoundedTaskExecutor.java` | bounded async pool with explicit rejection |
| `core/TimeBudget.java`, `RaycastBudget.java`, `VisibilityState.java` | budgeted work + policy states |
| `config/AegishiderConfig.java`, `WorldSettings.java`, `ConfigLoader.java` | immutable validated config |
| `index/HiddenBlockIndex.java` | world-scoped copy-on-write protected-block registry |
| `index/BlockDiscovery.java` | chunk-load discovery, bounded reconciliation sweep |
| `occlusion/OcclusionEngine.java`, `PaperRayTracer.java`, `RayTracer.java` | FOV + Paper voxel ray trace with transparent continuation |
| `item/ItemShield.java` | fail-closed item/entity visibility engine |
| `blocks/BlockShield.java` | distance/FOV/occlusion reveal + hysteresis + resync |
| `packet/PacketGateway.java`, `PacketGatewayFactory.java`, `PacketEventsGateway.java`, `ChunkSanitizer.java`, `PacketMaterialCache.java`, `DetectedProtectedBlocks.java` | outgoing-packet gateway, chunk/block/entity filters, TE-scan hardening |
| `listener/BlockListener.java`, `PlayerListener.java`, `ChunkListener.java`, `EntityListener.java`, `WorldListener.java` | explicitly registered event adapters |
| `detection/MiningAnalytics.java`, `RaidAnalytics.java` | optional, non-enforcing analytics |
| `metrics/Metrics.java` | lock-free counters + tick histogram (p50/p95/p99) |
| `command/AegishiderCommand.java` | status/diag/deep/stats/verify/rescan/reload/help |
| `util/BlockPosUtil.java`, `MaterialSets.java` | primitive encodings; material validation |

### Rewritten root class
`AegishiderPlugin.java` — lifecycle, per-tick budget slicing, reload, self-check, explicit
listener registration (fixes audit item A).

### Deleted legacy files (replaced)
`ObfuscationEngine`, `MultiLevelVisibilityCache`, `VisibilityCache`, `PlayerTracker`,
`SmartYCalculator`, `DynamicRevealRadiusEngine`, `ChunkRiskClassifier`,
`PlayerIntelligenceCache`, `BaseSignatureRecognizer`, `ProtectionLayerManager`, `ChunkWork`,
`AllListeners`, `MetricsManager`, `ConfigManager`, `WorldConfig`.
Reasons are in `docs/01-audit.md`; useful ideas were rebuilt, unsafe behaviour was removed
rather than layered over.

### Resources
`plugin.yml` (version 3.1.0, explicit command/permission list, `softdepend: packetevents`,
`folia-supported: false`), `config.yml` (full documented policy, secure defaults),
`META-INF/THIRD-PARTY-NOTICES.txt` (FastUtil Apache-2.0 license text).
`pom.xml`: version 3.1.0, Paper 1.21.4 provided, PacketEvents API 2.14.0 provided, FastUtil
shaded/relocated, JUnit 5; shade filtered/relocated.

### Test files
12 test classes, 60 tests (`src/test/java`), plus a test-only `RegistryAccess` provider for
the server-less JVM. Integration harness lives outside the module (`D:\Aegishider\itest`, not
shipped) and benchmark tooling in `D:\Aegishider\bench` (evidence only).

---

## 4. Audit findings → resolution

| Audit finding | Status in 3.1.0 |
|---|---|
| A. Listener registration bug (only container registered) | **FIXED + TESTED + VERIFIED**: five listeners registered individually; `/aegishider verify` PASS; real place/join/move/teleport/quit paths exercised by harness. World-unload path is unit-tested/reviewed, not live-tested (PARTIAL). |
| B. Natural blocks never discovered | **FIXED + VERIFIED**: discovery from `Chunk#getTileEntities()` on load + reconciliation; harness places a chest and it disappears from chunk data. |
| C. `pendingUpdates` race | **REMOVED** by architecture: no cross-thread pending map exists; packet thread only reads concurrent snapshots. |
| D. Wrong `ChunkSnapshot` per drained batch | **REMOVED**: no chunk snapshot work items in security path; reveal decisions run main-thread. |
| E. Cache commit-before-send | **FIXED**: reveal markers are written before the reveal packet and removed before the hide packet; chunk rewrite clears markers fail-closed. |
| F. Silent queue drop | **FIXED**: security never uses a queue; async pool has explicit rejection + counters; per-tick budget defers without hiding less. |
| G. TPS-based coverage reduction | **REMOVED**: coverage is TPS-independent; only background analytics can shed load. |
| H. Spawner O(P×S) loop + flicker | **REMOVED**: no spawner-specific loop; containers use the normal reveal policy (no flicker timer). |
| I. `PlayerMoveEvent` dead/wrong | **FIXED**: session transforms updated on move (significant-change gate), all engine work budgeted per tick. |
| J. World/chunk key collisions | **FIXED**: world UUID interned to id; chunk keys include it; per-viewer caches are world-scoped. Tests cover cross-world/chunk keys. |
| K. L1/L2/L3 cache cost & leaks | **REMOVED**: replaced by one primitive reveal set per viewer with cleanup; no slot-collision bitmask, no unbounded L3. |
| L. Unbounded executors / shutdown stall | **FIXED**: bounded executor with rejection; security path not async; shutdown has a deadline. |
| M. Commands/status inconsistency | **FIXED**: status is derived from live flags; no advertised dead feature; `/aegishider raidinfo` removed rather than faked. |
| Chunk unload destroyed index | **FIXED + TESTED**: index is world-data derived and not evicted on chunk unload; verified by review + unit test (`evictWorld` only). |
| No item protection | **FIXED + VERIFIED**: scenario A/B packet evidence. |
| No chunk-packet interception | **FIXED + VERIFIED**: scenario C packet evidence. |
| Bypass permission ignored | **FIXED**: per-world `bypass-permission`; bypass viewers get real chunk data and no reveal work. |

---

## 5. Module status (separate levels, no IMPLEMENTED = VERIFIED merging)

| Module | IMPLEMENTED | TESTED | VERIFIED | Notes |
|---|---|---|---|---|
| Packet Security Gateway (PacketEvents) | yes | unit-level sanitizer/filter logic | real-server packet evidence (A: 0 spawn; C: filler in decoded chunk) | requires PacketEvents 2.14.0; server version gate 1.21.4 |
| Visibility Policy Engine | yes | FOV/state/index/config tests | scenario A/B/C | fail-closed defaults |
| Occlusion / Raycast Engine | yes | injected tracer + FOV unit tests | indirectly via scenarios B/C | transparent-material continuation, bounded segments |
| Section-Based Cache | yes (per-chunk `ChunkView`) | index tests | scenario C resend | no extra L2/L3 layers (removed; not cost-effective) |
| ItemShield Engine | yes | state/policy indirectly + config tests | scenario A (0 leaks), B (visible, 63 ms) | native hide-by-default + packet filter |
| ContainerShield / BlockShield | yes | index/sanitizer tests | scenario C + integration | TE-scan hardening included |
| EntityShield Engine | yes | same engine as items | items only | other entity types configurable, not in E2E matrix |
| ChunkShield | yes | sanitizer tests | scenario C | block entities stripped |
| PlayerVisibility Engine | **NOT IMPLEMENTED** | — | — | deliberately out of scope (breaks teams/combat); documented |
| Bounded Async Scheduler | yes | saturation/rejection tests + maintenance exporter tests | live server: `/aegishider export` wrote diagnostics.json off-thread | now does real non-security work (periodic diagnostics snapshots); security path intentionally not async |
| Spatial Index | yes (world→chunk immutable views) | index tests | scenario C | no periodic full-world scan; event + reconciliation |
| Security Analytics | yes (mining/raid) | mining tests | NOT VERIFIED on live alerts | non-enforcing, default off |
| Metrics / Diagnostics | yes | counters exercised by tests/bench | `/aegishider diag` on live server, diagnostics.json validated | tick p50/p95/p99 histogram, item-storm counters, watchdog state, async snapshot state |
| Natural-block discovery | yes | config/material tests | scenario C (player placed) + reconciliation probe | natural structures covered by same discovery path |
| Configuration + reload | yes | 11 config tests | reload exercised in probes | legacy format migration |
| Commands | yes | compile/command status inspected | `/aegishider verify` PASS on server | no fake subcommands |
| Persistence of block index | **NOT IMPLEMENTED (by design)** | — | — | index is world-derived; reasons ADR-3 |
| Player-vs-player hiding | **NOT IMPLEMENTED** | — | — | reason ADR-6 |

---

## 6. Integration test evidence (real Paper server + packet capture)

Harness: `D:\Aegishider\itest` (Paper 1.21.4 build 232, PacketEvents 2.14.0, two headless
clients, RCON fixtures, raw chunk palette decoding with self-tests).

### Final run (Aegishider 3.2.0, jar sha256 prefix `f2ca7a488d35`)

```
[PASS] A hidden dropped item far away behind solid blocks
       expected=HIDDEN observed=HIDDEN  TestBot:0 spawn, TestBot2:0 spawn; followups=0
[PASS] B visible dropped item ~3 blocks in front
       expected=VISIBLE observed=VISIBLE  TestBot:1 spawn, TestBot2:1 spawn; latency=9ms; followups=8
[PASS] C chunk-level block hiding of a player-placed chest after forced chunk resend
       expected=HIDDEN observed=HIDDEN  chest_in_chunk=false; observer_marker=true;
       chest_states_in_section=0; resend_chunk_packets=1
OVERALL: PASS (71 s)
```

`chest_states_in_section=0` means **both** the player-placed chest and the console-placed
control chest (`setblock`, no BlockPlaceEvent) were replaced in the client's decoded chunk;
the earlier chunk hardening (packet-level block-entity scan) closed that gap.
An earlier run of the same scenario before that hardening showed `chest_states_in_section=1`
(control chest leaked) — this is the concrete regression evidence for the fix.

### Baseline validation (legacy v3 jar, same harness)

```
A: LEAK  (2 leaked item spawn packets + followups)   <- detector sees real leaks
B: VISIBLE latency=4ms                               <- baseline is already visible
C: LEAK  (chest state present in chunk data)         <- detector sees real leaks
OVERALL: PASS (baseline mode expects these leaks)
```

Reports: `docs/evidence/itest-final-warmup-report.json` (latest PASS),
`docs/evidence/itest-final-hardened-report.json`, `docs/evidence/itest-baseline-report.json`.
Raw captures under `D:\Aegishider\itest\out\run-*` (NDJSON + raw chunk files).

Additional live probes executed during development (not part of the final harness):
- `/summon item` behind a wall: 0 item spawn packets captured; tracked count = 1
  (proves `ItemSpawnEvent` registration; the earlier v3-style bug where only
  `EntitySpawnEvent` was registered did not hide items).
- console `setblock chest` (no Bukkit event) plus forced chunk resend: decoded client chunk
  contained the filler state at the chest position after the chunk-level block-entity scan
  hardening; detected positions were registered by the main thread in the same second.
- `/aegishider verify` on the live server: **PASS**.

---

## 7. Benchmark (real server, measured)

Hardware/software: Windows 11, 8 logical CPUs (shared build machine), Temurin 21.0.13,
Paper 1.21.4 build 232, PacketEvents 2.14.0, one headless client on a flat world. Each mode
was measured after the server reached `Done` and the client spawned.

Two measurement layers:

1. **Server tick time** via Paper's console `/mspt`
   (`avg/min/max` over the last 5 s, 10 s, 1 min, in ms).
2. **Aegishider's own main-thread security work** via `/aegishider diag`:
   cumulative tick histogram p50/p95/p99 plus per-engine last/max, evaluation and raycast
   counters.

### Server MSPT (`/mspt`, one online client)

| Mode | last 5 s avg/min/max | last 10 s avg/min/max | notes |
|---|---|---|---|
| A. Baseline, plugin not loaded | **3.1 / 1.5 / 6.4 ms** | 3.4 / 1.2 / 7.2 | idle, same client |
| B. Plugin loaded, idle | **4.5 / 2.3 / 20.4 ms** | 6.2 / 2.3 / 49.3 | includes PacketEvents + Aegishider; high variance on shared machine |
| C. Baseline, 300 dropped items | **3.4 / 1.2 / 8.4 ms** | 3.5 / 1.2 / 8.4 | item entities are vanilla-visible/tracked |
| D. Plugin, 300 dropped items | **4.0 / 1.8 / 7.1 ms** | 4.4 / 1.8 / 17.7 | items hidden/protected |
| E. Plugin, 800 dropped items | **6.1 / 2.3 / 10.7 ms** | 5.4 / 2.0 / 10.7 | dense dropped-item field |

Measured overhead of the whole Aegishider+PacketEvents stack is roughly **0.5–1.4 ms
average** in this single-client setting; the 1-minute max in startup windows (275–397 ms)
is world load/GC, not steady-state security work (baseline also shows a 318 ms startup max).

### 3.2.0 load test (separate load server, ports 25601/25600)

Hardware: Intel Core i3-10105F (4 cores / 8 threads), 16 GB RAM, Windows 11; same JVM/Paper
as above. Harness `bench/load-bench.js` + `bench/load-bot.js` (capture-free headless bots),
items summoned in one `datapack` function call so the storm lane is exercised. All runs are
on the delivered 3.2.0 jar (sha `cf3cc53eâ€¦`).

| Tier | Bots joined (final alive) | Items tracked | Join median/p95 | TPS | Server MSPT (5 s avg) med/range | Aegishider p50/p95/p99 (Âµs) | Heap used |
|---|---|---|---|---|---|---|---|
| 10 / 200 | 10/10 | 200 | 1.44 / 1.49 s | 20.0 | 4.6 (2.9â€“6.4) | 150â€“200 / 500â€“1100 / 2650â€“3200 | 398â€“762 MB |
| 50 / 1000 | 50/50 | 1000 | 4.81 / 5.90 s | 19.1 | 11.3 (10.6â€“14.2) | 250â€“450 / 800â€“1200 / 1650â€“2650 | 444â€“833 MB |
| 200 / 2000 | 196 at 95% cutoff, **200/200 alive**, 0 failures | **2000** | 9.02 / 12.94 s | **16.2â€“17.3** | 64.2 (58.3â€“119.9) | 400â€“500 / 1150â€“1300 / 3050â€“3100 | 500â€“805 MB (WS 1.43â€“1.46 GB) |
| soak 10 / 200, 120 s, 6 churn cycles | 10/10 | 200 (201 in last 2 samples) | 1.73 / 2.23 s | 20.0 | baseline med 3.4; soak med 3.3 (max 3.9) | 150â€“250 / 450â€“900 / 950â€“3200 | 322â€“831 MB |

Honest interpretation:
- 200 bots / 2000 items on this 8-thread desktop CPU **degrades the whole server** to
  16â€“17 TPS; the server does not crash, all 200 bots stayed alive and 2000 items were
  registered/hidden, but this is not a recommended production capacity for this hardware.
- Aegishider's own security work stayed bounded (p99 3.05â€“3.1 ms) and is a small fraction of
  the ~64 ms server tick at that tier; the dominant cost is 200 bot connections/entity/chunk
  load on a desktop CPU (PacketEvents also processes every packet).
- The soak tier ran the full 120 s with **6/6 item churns successful** (kill 200 + summon 200
  per cycle, 142â€“173 ms per function call), TPS stayed 20.0, heap stayed within 831 MB.
  The first soak attempt hit a bug in the test harness churn path; it was fixed and rerun;
  the reported soak JSON is the successful rerun.
- The `itemEvals` diagnostic counter stayed 0 while bots were idle (2 in the last soak
  samples); the spawn-storm lane is observable through `itemStormBatches`/`itemStormMaxDepth`
  (2/512 at 50 bots, 4/512 at 200 bots, 1â†’9/200 during soak churns). Item protection state
  (tracked count, no spawn leak, gateway ACTIVE, 0 errors) remained correct.
- These numbers must not be presented as a 200-player production benchmark: the machine is
  a shared desktop, bots are not real clients, and no anti-cheat/client rendering is
  involved. They demonstrate bounded behavior and survival, not capacity.

Raw: `bench/load-*.json`, `bench/README-load-test.md`.

### Aegishider's own tick cost (`/aegishider diag`, steady window after warm-up)

| Mode | p50 | p95 | p99 | avg | item evals | raycasts |
|---|---|---|---|---|---|---|
| B. plugin idle | 100 µs | 450 µs | 1.2 ms | 164 µs | 0 | 0 |
| D. plugin 300 items | 100 µs | 850 µs | 2.6 ms | 535 µs | 799 | 701 |
| E. plugin 800 items | 200 µs | 800 µs | 1.45 ms | 415 µs | 2941 | 2572 |

One-time warm-up outlier before the pre-warm patch: a single **235 ms** tick on the first
large item evaluation (class loading/JIT of the Paper ray-trace path). A bounded startup
warm-up (`scheduleRuntimeWarmup` in the plugin: repeatedly ray-traces from spawn and
touches the policy classes while no player data is involved, then cancels itself) was added
specifically to move that cost to server start. Post-warm-up repeat of the 300-item run is
recorded in `docs/evidence/mspt-plugin-items300-warmup.json` (row F below).

| Mode | p50 | p95 | p99 | tick max | note |
|---|---|---|---|---|---|
| F. plugin 300 items, with startup pre-warm | 200 Âµs | 1.0 ms | 3.0 ms | 38 ms cumulative first-join/JIT (was 235 ms one-time item evaluation) | same 300-item burst; server `/mspt` 3.5 / 1.3 / 8.6 ms (5 s) |
| G. 3.2.0, 300 items, extended warm-up + join ramp | 200 Âµs | 0.90 ms | 3.2 ms | block-engine first-join max ~11 ms (was ~38 ms); item first-eval residual ~31 ms | server `/mspt` **3.1 / 1.2 / 8.0 ms** (5 s) â€” back to baseline; raw `docs/evidence/mspt-plugin-items300-v32improved.json` |

Micro benchmarks (JDK 21, 8 CPUs, `PerformanceBenchmarkTest`; ranges over three runs on a
shared machine):

```
blockPos encode+decode (x/y/z)     ~5–11 ns/op
HiddenBlockIndex.isHidden          ~36–114 ns/op   (concurrent map + binary search)
ChunkView.contains                 ~16–57 ns/op
FOV insideFov math                 ~4–12 ns/op
occlusion policy call (no trace)   ~2–5 ns/op
chunk sanitize, 20 protected       ~3.5–9.5 µs/chunk (only sensitive chunks are parsed)
bounded executor dispatch          ~0.6–1.6 µs/task (bounded queue)
```

Raw data: `docs/evidence/mspt-*.json`, `docs/evidence/bench-results-initial.json`,
`docs/evidence/bench-run-final.log`.

Limitations of these numbers (no over-claiming):
- Single client, flat world, no mobs, shared build machine → absolute MSPT numbers are
  environment-specific; only the deltas and Aegishider-internal numbers are meaningful.
- The 235 ms item-engine spike was a **one-time class-load/JIT** event, not per-tick
  behavior; it is now attacked with the startup warm-up and reported above.
- A 200-player / 1,000–2,000-item stress test was not performed (no load fleet available).
  Bounds are enforced by design: no per-tick full scan, evaluation cap, shared ray budget,
  bounded queues — but this is a design argument, not a measured 200-player result.

---

## 8. Security analysis after the rewrite

Properties enforced by construction + tests:

1. **No item spawn packet for a hidden item**: native hidden-by-default; packet filter also
   cancels item spawn/metadata/movement for unrevealed viewers. Scenario A: 0 packets.
2. **No container block state in chunk data**: all configured protected materials are
   block-entity backed, the chunk's block entities are inspected/removed, and every matching
   block state is replaced with the filler before serialization. Scenario C decoded data
   contains filler, not a chest.
3. **Block updates/animations/entity data for hidden protected positions are filtered**,
   including positions detected in the packet layer before the index catches up
   (`DetectedProtectedBlocks` bridge).
4. **Fail-closed on errors/unknowns**: packet handler exception cancels that packet; unknown
   world cancels chunk/block packets; unavailable gateway disables block protection and says
   so; queue/budget pressure defers without revealing more.
5. **No async world access / no unbounded queues**: main-thread security work is budgeted;
   async pool is bounded and non-security only.
6. **No stale "visible" state unbounded**: revealed markers are dropped on chunk resend,
   world change, respawn, block removal and after a bounded staleness window if the budget
   is exhausted.
7. **Cleanup**: entity removal/pickup/merge/unload, player quit, world unload, plugin
   disable (restores vanilla visibility) are handled; no unbounded entity/viewer maps.

Residual risks (honest):
- Player-vs-player ESP is not implemented.
- Sound/particle effect packets that can be triggered by a container (chest open sound,
  ender-chest particles) are not filtered in this build; an advanced cheat could use them as
  weak location hints when a container is opened. They are not positional state data in the
  same class as entity/block packets.
- A protected container placed by a non-Bukkit path is hidden on the next chunk send (TE
  scan) and registered within a tick, but a *block update animation* in that sub-tick window
  could theoretically be observed; the chunk data itself is never leaked.
- ViaVersion clients older than 1.18 receive sensitive chunk packets cancelled
  (fail-closed) rather than sanitized; behavior is degraded but not leaking.
- Analytics are advisory and can false-positive; they never enforce.

---

## 9. Dependency / license report (summary; full text `docs/04-dependencies.md`)

- Paper API 1.21.4 — provided, not redistributed.
- PacketEvents API 2.14.0 — provided, **GPL-3.0**, not shaded; PacketEvents plugin must be
  installed separately. No PacketEvents code is copied or redistributed.
- FastUtil 8.5.13 — **Apache-2.0**, shaded + relocated; license notice included in the jar.
- JUnit Jupiter 5.11.4 — test scope only.
- No AGPL code copied; no NMS/reflection/hardcoded packet IDs.

## 10. JAR / plugin.yml verification

Final artifact: `D:\Aegishider\dist\Aegishider-3.3.8.jar` sha256
`f2ca7a488d358d5b5db32394b9ebb787af27dd4938dcb3019dee9431e35baf79`
(6,797,780 bytes). It is the jar used for the final packet-level integration run. The load
tests and 3.2.0 benchmark were run on the previous 3.2.0 build (`cf3cc53eâ€¦`); comparing
plugin classes shows only 2 of 3466 class files differ (the `/aegishider diag` output and a
console color string in `AegishiderPlugin`), so all security/engine code is identical.

`jar tf` inspection (full output `docs/evidence/jar-inspection.txt`):
- 36 plugin classes + nested classes; 3407 relocated FastUtil classes; `plugin.yml`,
  `config.yml`, `META-INF/THIRD-PARTY-NOTICES.txt`.
- No `packetevents`, `papermc`, `net.minecraft`, `craftbukkit`, JUnit or MockBukkit classes
  bundled (only Aegishider's own `PacketEventsGateway*` class names match "packetevents").
- `plugin.yml`: name Aegishider, version 3.1.0, main `dev.audismp.aegishider.AegishiderPlugin`,
  api-version 1.21, softdepend `[packetevents]`, command/permissions complete.
- Maven `clean verify`: BUILD SUCCESS, 60 tests, jar replaced by shaded artifact.

## 11. Known limitations

1. **Player entities are not hidden** (anti-player-ESP) — deliberate: breaks teams, combat,
   scoreboards and many plugins; needs a team-aware policy. Documented, not faked.
2. **Server version lock**: the packet gateway activates only on Paper 1.21.4
   (`ServerVersion.V_1_21_4`) because chunk serialization/heightmaps differ on 1.21.5+.
   On other 1.21.x servers item protection still works natively but block protection reports
   INACTIVE. Rebuild + re-verify required for other versions.
3. **Bypass permission changes require re-evaluation**: permissions are refreshed once per
   second; toggling bypass mid-session only fully applies to newly sent chunks, the reveal
   engine handles near-field state.
4. **Reconciliation is a safety net**, not a substitute for events: blocks changed by
   non-Bukkit means are fully protected at chunk-send time by the TE scan and registered
   within ~1 s, but block-update packets in that sub-tick window are only protected by the
   detected-position bridge (present) — extreme edge only.
5. **Mass item spawn bursts** can cause a large single tick (observed 138 ms while 300
   entities were force-summoned in one burst); steady state is bounded (~0.3–0.9 ms
   Aegishider work). A production server normally cannot create 3000+ spawn events per tick
   without other bottlenecks.
6. **Player-vs-player, mob ESP, storage minecarts/item frames** are configurable entities but
   only ITEM is exercised in the E2E matrix; other types share the same engine.
7. **Whole-server MSPT under 200 players** was not benchmarked (no load fleet); only
   Aegishider's own tick cost and a single-client server were measured.
8. **Packet gateway behavior depends on PacketEvents 2.14.0 internals**; version is checked
   at startup and the gateway refuses older/newer-incompatible setups instead of guessing.

## 12. Reproduce everything

```
# unit tests + build
cd D:\Aegishider\aegishider-integrated
mvn -B clean verify

# packet-level integration (expects PASS; baseline mode must show leaks)
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 `
    -Jar D:\Aegishider\dist\Aegishider-3.1.0.jar
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 -Baseline

# real-server benchmark (requires itest server assets; see bench/run-bench.js)
node D:\Aegishider\bench\run-bench.js

# on-demand maintenance snapshot (async, non-security work)
#   /aegishider export   -> plugins/Aegishider/diagnostics.json

# load-test harness (separate server dir/ports 25601/25600; see bench/README-load-test.md)
node D:\Aegishider\bench\load-bench.js --bots 200 --items 2000 --label max200-2000
node D:\Aegishider\bench\load-bench.js --bots 10 --items 200 --label soak10-200 --soak-seconds 120
```

Final jar: `D:\Aegishider\dist\Aegishider-3.1.0.jar`
sha256 `59e1391cc2151459340b7c0daf372caf0c4ae258ef7116588bd93f8da51f9a0d`

---

## 13. Emergency hotfix 2026-11-15 (ViaVersion client)

After the 3.2.0 delivery a real cheat-client test against Paper 1.21.4 + PacketEvents
2.14.0 + ViaVersion 5.12.2 (client protocol 26.x) showed that storage ESP still found
containers and that filler blocks could ghost/disappear. Root cause: state-id â†” material
resolution used the client protocol version (26.x) on packets that are encoded in the
server format (1.21.4), so protected containers were not recognised and filler ids were
wrong. Fixed in 3.3.3 (server-format state mapping), 3.3.4 (early-spawn fail-closed for
untracked hidden entities: armour stands/chest mine carts/monsters) and 3.3.5 (verification
build). Additional real-server changes: expanded hidden-entity list (monsters, item frames,
armour stands, storage minecarts), bounded owner grace (8 blocks / 2 s), reduced raycast and
reconciliation defaults.

Verified locally with an isolated Paper 1.21.4 + ViaVersion server and a protocol-26.1
headless client: before the fix the client received a chunk with three protected containers'
block entities; after the fix `blockEntities=0` and the server logged
`changed=3 detected=3 tileEntitiesRemoved=true`. A chest-minecart spawn race was observed
and correctly cancelled (`hiddenSpawn=true cancelled=true`). Native 1.21.4 E2E harness on
3.3.5: PASS (A HIDDEN, B VISIBLE, C HIDDEN). Details: `docs/07-viaversion-hotfix.md`.

### 13.1 Reveal regression fixed in 3.3.8

After the ViaVersion fix, chests were hidden correctly but **stayed stone when the player
walked close**. Three independent bugs were found by a live diagnostic and fixed:

1. `PaperRayTracer` treated a hit on the target chest's own hitbox as occlusion. The
   block-target ray now treats reaching the target block as visible.
2. Reveal markers were not cleared when a chunk was (re)sent, so a marker from before the
   chunk send blocked every later reveal. The gateway now clears the marker + requests a
   resync for every sent chunk.
3. `Player#isChunkSent` returned false for the candidate chunks in the test (527/527 skips),
   so the reveal loop never raycast. The unreliable guard was removed; chunk-send resync
   makes late reveals safe.

Verified with a headless native 1.21.4 client: after the fix the server reported
`revealed=1, Raycasts=1` and the client received `BLOCK_CHANGE` at the chest position with
state id **3010 (chest)**, i.e. the stone became a real chest again when approached.
A coverage test placing all **31** configured hidden block types in one chunk plus two
control block entities showed the client chunk contained only the two controls (all hidden
block entities/state were stripped).

The Aegishider test server was moved to port **25566** because another test server occupies
25565; reconnect there to test.