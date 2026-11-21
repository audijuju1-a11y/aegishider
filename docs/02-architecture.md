# Aegishider 3.1.0 — Target Architecture and Design Decisions

Status: implemented in `src/main/java`. Every statement below describes code that exists
in this build; nothing is aspirational. Verification level per module is reported in
`docs/05-final-report.md`.

---

## 1. Security model

The system is a **visibility gate**, not a detection system. The only thing that protects
a base is that its data never leaves the server before a policy has allowed it.

```
Protected object (block / item entity / block entity)
        │
        ▼
  Visibility Policy  ── distance ──► field of view ──► occlusion raycast
        │                                                   │
        │  (no positive proof)                              │ (proof)
        ▼                                                   ▼
      HIDDEN                                            VISIBLE
        │                                                   │
        ▼                                                   ▼
  packet gateway strips it                         packet gateway forwards
  (chunk data, updates, metadata)                  (or native showEntity)
```

Four rules are non-negotiable in the code:

1. **Fail-closed.** Absence of proof = HIDDEN. Unknown world, unknown viewer, missing
   config, missing packet gateway, stale revision, exception, exhausted budget or queue
   pressure all resolve to HIDDEN. `VisibilityState` only allows data for `VISIBLE` and
   `BYPASS`.
2. **Prevention before detection.** Analytics (`MiningAnalytics`, `RaidAnalytics`) never
   alter visibility and are disabled by default. They cannot compensate for a leak.
3. **Never first-send-then-patch.** Containers are removed from the chunk/tile-entity data
   *before* the packet is written. Sending real data and then calling `sendBlockChange`
   is not protection; it is exactly the leak the previous version had.
4. **Protection coverage is independent of TPS.** Load-shedding only defers *reveals* and
   analytics; hidden data stays hidden and nothing becomes more visible under load.

---

## 2. Module map (single responsibility, one source of truth per concern)

| Package | Class(es) | Responsibility |
|---|---|---|
| root | `AegishiderPlugin` | lifecycle, wiring, per-tick slicing, reload, self-check |
| `config` | `AegishiderConfig`, `WorldSettings`, `ConfigLoader` | immutable config snapshot; validation with secure defaults |
| `core` | `ViewerSession`, `SessionRegistry`, `BlockVisibility`, `BoundedTaskExecutor`, `RaycastBudget`, `TimeBudget`, `WorldKeys`, `VisibilityState` | shared runtime state, world identity, bounded async (non-security), thread-safe visibility markers |
| `index` | `HiddenBlockIndex`, `BlockDiscovery` | world-scoped protected-block registry (copy-on-write per chunk) + discovery/reconciliation |
| `occlusion` | `OcclusionEngine`, `PaperRayTracer`, `RayTracer` | FOV math + Paper native voxel ray trace with transparent-material continuation |
| `item` | `ItemShield` | fail-closed per-viewer visibility for protected entities (items first-class) |
| `blocks` | `BlockShield` | reveal/re-hide policy for protected blocks (distance+FOV+occlusion+hysteresis) |
| `packet` | `PacketGateway`, `PacketGatewayFactory`, `PacketEventsGateway`, `ChunkSanitizer`, `PacketMaterialCache` | outgoing packet interception; chunk/block/entity filtering; fail-closed error policy |
| `listener` | `BlockListener`, `PlayerListener`, `ChunkListener`, `EntityListener`, `WorldListener` | explicit, individually registered Bukkit event adapters |
| `detection` | `MiningAnalytics`, `RaidAnalytics` | optional, non-enforcing, rate-limited analytics |
| `metrics` | `Metrics` | lock-free counters, tick/decision timing, gauges |
| `command` | `AegishiderCommand` | status/diag/deep/stats/verify/reload, no fake status |
| `util` | `BlockPosUtil`, `MaterialSets` | primitive position/chunk encoding, material validation/patterns |

Removed from the old code base (with reasons – see `01-audit.md`):
`ObfuscationEngine`, `MultiLevelVisibilityCache`, `VisibilityCache`, `PlayerTracker`,
`SmartYCalculator`, `DynamicRevealRadiusEngine`, `ChunkRiskClassifier`,
`PlayerIntelligenceCache`, `BaseSignatureRecognizer`, `ProtectionLayerManager`,
`ChunkWork`, `AllListeners`, `MetricsManager`, `ConfigManager`, `WorldConfig`.
Their useful ideas (world-derived index, batching, event-driven updates) were rebuilt on
correct foundations; the parts that created the audit findings were deleted rather than
layered over.

---

## 3. Identity and keys

- **World identity**: `WorldKeys` interns `World.getUID()` to a sequential `long` id
  (1 … 2^20-1). Id 0 = unknown = fail-closed. Panels never use `worldName.hashCode()`.
- **Block position**: 26/12/26-bit packed long (`BlockPosUtil`), world-agnostic; always
  combined with a world id by the enclosing structure.
- **Chunk key**: 20-bit world id | 22-bit signed chunkX | 22-bit signed chunkZ. No
  cross-world collision. `PlayerIntelligenceCache`-style world-less keys do not exist.
- **Entity identity**: wire entity id is the packet key; the tracked record also stores
  the entity UUID. A tracked id is removed synchronously on `EntityRemoveEvent` /
  `EntitiesUnloadEvent`, so id reuse cannot inherit visibility state.

---

## 4. Threading model

| Thread | Allowed work | Forbidden |
|---|---|---|
| Main | Bukkit world/entity/player access, discovery, reveal engines, item show/hide, index writes | blocking waits |
| Netty (PacketEvents) | peek bytes, read concurrent snapshots, cancel/rewrite packets | Bukkit API calls, locks held long, world reads |
| Async pool (bounded, 1–4 threads, queue 512) | only `/aegishider deep` diagnostics | any visibility decision, any Bukkit call |

There is intentionally **no security task on the async pool**: the fastest and safest
place for the occlusion policy is the main thread with a time budget, because every
alternative would either read world state off-thread or add queue latency before a
security decision. The async pool exists only for non-security diagnostics and has
explicit rejection semantics (`BoundedTaskExecutor.submit` returns `false`; nothing is
silently dropped).

Packet-thread state is published through:

- `SessionRegistry.get(UUID)` → volatile world id / world name / min section / bypass;
- `HiddenBlockIndex.chunkView(...)` → immutable `ChunkView` (volatile `long[]`);
- `BlockVisibility.isRevealed(...)` → primitive set guarded by a short monitor;
- `ItemShield.TrackedEntity.revealedViewers` → `ConcurrentHashMap`.

No packet handler takes a lock that the main thread holds while doing world work.

### Per-tick slicing

`AegishiderPlugin.securityTick()` runs every tick:

```
itemShield.tick(budget * 0.45)
blockShield.tick(budget * 0.55)
every 20 ticks: refresh sessions/permissions + reconciliation step
every 40 ticks: gauges
record tick duration; warn (rate-limited) on overrun
```

Both engines check `TimeBudget`; unfinished work is deferred to the next tick. Raycasts
draw from one shared `RaycastBudget` so a storage-cluster scan cannot starve item
visibility. When the budget is exhausted an object keeps its previous state, but a
previously visible object is force-hidden after `MAX_STALE_TICKS` (12) so a starved budget
can never keep a stale "visible" state forever.

---

## 5. HiddenBlockIndex (single source of truth for protected blocks)

- `worldId → chunkKey → ChunkView` (`ConcurrentHashMap` + immutable sorted `long[]`).
- Writes only on the main thread; mutations replace the chunk view (copy-on-write,
  arrays are tiny: tens of blocks per chunk). Readers (reveal engine, Netty) are lock-free.
- `revision` increments on every mutation and is the invalidation signal for downstream
  caches.
- **Not evicted on chunk unload** (the blocks still exist); evicted only on world unload.
- Derived from real world state: discovery reads `Chunk#getTileEntities()` on chunk load
  (before the chunk packet can be sent) and reconciles a bounded set of loaded chunks near
  players in the background. No persistence file can drift from reality: the world *is*
  the source of truth.
- Tile-entity backed materials are discovered from chunk block entities. Plain `BOOKSHELF`
  is the explicit state-scan exception: the packet layer prefilters chunk section palettes
  and the index re-verifies only known positions, so there is no full-chunk world scan.
  Measured on the test JVM (24 sections, 98,304 block states): palette-skip chunks cost
  ~4.0 us, a chunk with one matching section ~52 us, and the global-palette fallback
  (all 24 sections) ~2.4 ms. Live scenario chunk latency was ~630 ms with the state scan
  and ~631 ms without it (same final jar, same fixture). `MaterialSets` validates
  the configured list and *rejects* unsupported materials with a warning instead of
  silently providing partial protection.

## 6. ItemShield (entities)

State machine per entity tracked in `ItemShield.TrackedEntity`:

```
NEW ──setVisibleByDefault(false)──► PROTECTED_HIDDEN
PROTECTED_HIDDEN ──policy VISIBLE──► VISIBLE_TO_VIEWER  (showEntity, marker set first)
VISIBLE_TO_VIEWER ──policy HIDDEN─► HIDDEN_FROM_VIEWER  (marker removed first, hideEntity)
any ──pickup/despawn/merge/remove/chunk-unload/world-unload──► REMOVED (registry entry deleted)
```

Lifecycle rules:
- Registration is synchronous before any tracking packet: `EntitySpawnEvent`
  (new entities) and `EntitiesLoadEvent` (entities restored from disk). Startup/restart
  sweeps existing entities around players and re-asserts `setVisibleByDefault(false)`.
- Owner grace: the thrower sees their own drop immediately.
- Visibility is recomputed on: registration, item block-position change, viewer
  significant movement/look change, block change within one chunk (line-of-sight
  invalidation), merge, and periodic re-evaluation with a 2-tick default interval.
- Gameplay is untouched server-side: pickup, merge, physics, despawn timers, item stack,
  owner/thrower are never modified. Hidden items can still be picked up (server-side).
- No memory leak: entity removal removes the record; viewer quit removes that viewer from
  its revealed-item set only (O(revealed items), not O(all items)); disable restores
  vanilla visibility for everything tracked (no permanently invisible entities after a
  plugin reload).

## 7. BlockShield (containers and other protected blocks)

- Chunk packets and block packets never contain protected block data (see gateway).
- A viewer sees a protected block only when: within `reveal.max-distance`, inside
  `reveal.fov-degrees` (360 disables the FOV gate), and a ray from the eye to the block
  surface is not blocked by a non-transparent material.
- Once revealed, the block stays visible while within `keep-distance-factor × distance`
  (no flicker). It is re-hidden when the viewer leaves, the chunk is re-sent, the world
  changes, the block stops being protected, or after respawn/teleport.
- `hide/reveal` packets are sent with `sendBlockChange`; ordering with the packet filter is
  deterministic because the reveal marker is written *before* the packet is written and
  removed *before* the hide packet is written.
- Occlusion invalidation: any block place/break/explosion resets a per-viewer marker and
  re-evaluates; revealed blocks are re-raycast on significant movement.
- Chunk-resend safety: when the gateway sanitizes a chunk it immediately clears reveal
  markers for that chunk (fail-closed) and queues a main-thread re-evaluation.

## 8. Packet gateway (PacketEvents 2.14.0)

A soft dependency (`softdepend: [packetevents]`). When absent:
- entity/item protection still works (Paper native per-player visibility);
- block/container protection is **disabled**, logged as SEVERE and reported by
  `/aegishider status` — the plugin does not fake protection.

Handlers (all on the Netty thread, all fail-closed on exception):

| Packet | Action |
|---|---|
| `CHUNK_DATA` | fast `long` peek of chunk x/z and of the block-entity count (skips heightmaps/section bytes without copying). Chunks with 0 block entities and no index entries are passed untouched (every supported protected material is block-entity backed). Otherwise the column is parsed once and sanitized from **two independent sources**: (1) the index view and (2) the chunk's own block-entity list — every block entity whose block state resolves to a protected material is replaced by the filler and reported as "detected". Protected block entities are stripped and the column is re-encoded. Detected positions are pushed into `DetectedProtectedBlocks` so block updates for them are already filtered; the main thread registers them and reconciles the chunk within a tick. This closes the "index stale / block changed by a non-Bukkit path" chunk-level leak. |
| `BLOCK_CHANGE` | peek packed BlockPos; "protected" = index OR packet-detected bridge; if protected and not revealed: verify the new state is still a protected material, rewrite state to filler. No wrapper is created on the fast path. |
| `MULTI_BLOCK_CHANGE` | filter each encoded block position/state (bulk updates are rare). |
| `BLOCK_ENTITY_DATA`, `BLOCK_ACTION` | peek position; cancel when the position is protected and not revealed (sign text, spawner data, chest animations). |
| `BLOCK_BREAK_ANIMATION` | peek position; cancel for hidden protected blocks. |
| `SPAWN_ENTITY` / entity state packets | peek entity id; for tracked protected entities that are not revealed to this viewer: cancel. An item spawn for an untracked id is cancelled as fail-closed and counted (`unexpectedItemSpawnPacketsBlocked`). Zero overhead when no entity protection is active. |

Fail-closed error path: any handler exception cancels that packet (never sends it
unverified) and increments `internalErrors`; logging is rate-limited.

## 9. Occlusion engine

- Uses Paper's native `World#rayTraceBlocks(eye, dir, distance, FluidCollisionMode.SOURCE_ONLY,
  ignorePassableBlocks=true)` — accurate collision shapes, no block-object loops.
- Transparent materials (glass, water, ice, slime, ...) are resolved from configuration
  patterns; the ray continues past them by stepping to the far side of the hit voxel.
  Lava is not transparent and correctly occludes.
- The number of transparent continuations is bounded (`occlusion.max-raycast-segments`).
  Too many transparent layers = "occluded" (fail-closed, never a false reveal).
- Field of view: `dot² + ε ≥ cos²(halfFov) · |v|²` (no sqrt; ε only makes the cone
  boundary inclusive, it cannot reveal behind the viewer).
- Unit-tested with an injected `RayTracer`; production tracer is the Paper one.

## 10. Configuration and reload

`ConfigLoader` never throws on bad input: invalid values are clamped, invalid materials /
entity types rejected with warnings, and secure built-in defaults are used when sections
are missing. Legacy `hidden-blocks` under a world section is migrated in memory with a
warning. `security.fail-closed=false` is rejected (forced true).

`/aegishider reload`:
1. builds a new immutable config snapshot (atomic swap; packet thread reads the volatile
   reference),
2. re-registers item entities whose protection type changed (unprotected ones are made
   visible again),
3. re-discovers all loaded chunks; the sweep listener sends filler/real-block deltas to
   players who already have those chunks,
4. clears packet caches (state-id mapping is per client version),
5. reports warnings.

## 11. Key architecture decisions (ADRs)

**ADR-1: PacketEvents, not ProtocolLib/NMS/reflection.** Chunk-level protection without
intercepting outgoing packets is impossible; the mission forbids send-then-patch and NMS
reflection. PacketEvents 2.14.0 provides a version-independent wrapper model for the
chunk column and block states and is a well-maintained external plugin dependency
(GPL-3.0, not shaded; reported in `docs/04-dependencies.md`). Only one packet library is
used.

**ADR-2: Native `Entity#setVisibleByDefault(false)` for entities.** Paper's tracker checks
`Player#canSee(entity)` before pairing, so a hidden entity generates **no spawn, metadata
or movement packets at all**. This is stronger and cheaper than cancelling each packet,
and it is exactly fail-closed. Packet filtering is added as defence in depth (unexpected
item spawns are counted and blocked).

**ADR-3: No persistence of the block index.** Real containers are discoverable from chunk
tool-entity data; a persistence file can only introduce drift (the audit found blocks
evicted on unload with no recovery). Startup/reload sweeps re-establish state before
packets are sent.

**ADR-4: Occlusion reveal instead of "always hide priority blocks".** Always-hide broke
gameplay (players could not see their own chests, and the old spawner loop flickered).
Distance + optional FOV + occlusion + hysteresis gives vanilla-like near-field visibility
while never sending far/occluded positions. FOV defaults to 360 (disabled) because F5
front view and fast turns legitimately show the world behind the player.

**ADR-5: Keep security off the async pool.** Async visibility decisions add latency/race
surface and require cross-thread world access. Main-thread slicing with a hard budget is
simpler to prove correct and has lower visibility latency; the async pool is retained
only for bounded, non-security diagnostics.

**ADR-6: Player-vs-player visibility is split into two layers.** The vertical height
shield is always on for cross-floor bases. The 24..48 block through-wall distance layer is
opt-in (`player-protection.distance-hiding`) because it can hide same-floor players behind
fences/slabs and interacts with F5/third-person play. FOV defaults to 360 (disabled) for
the same reason. Team and combat grace rules apply to both layers.

## 12. Fail-closed decision matrix

| Situation | Block data | Item/entity data | Reported |
|---|---|---|---|
| No packet gateway (PacketEvents missing) | not sent because feature DISABLED (chunks go out real) → status INACTIVE, SEVERE log, `/aegishider status` | hidden via native API | yes |
| Gateway exception while filtering | packet cancelled | packet cancelled | `internalErrors` |
| Unknown viewer world (session missing) | chunk/block packets cancelled | tracked entity packets cancelled for tracked ids | counters |
| Configuration cannot resolve world | chunk with protected blocks cancelled | n/a (entity policy uses fallback) | counter + warning |
| Raycast budget exhausted | stays in previous state; forced hidden after 12 ticks | same | `raycastBudgetDeferred` |
| Chunk resend | reveal markers dropped; block stays hidden until re-proven | hide-by-default persists; re-evaluated | `chunkPacketsSanitized` |
| Item not registered before a spawn packet (should not happen) | n/a | spawn packet cancelled + alarm | `unexpectedItemSpawnPacketsBlocked` |
| Async queue saturated | no effect (security never uses async) | no effect | `asyncRejections` |
| Main-thread budget overrun | work deferred, hidden data stays hidden | work deferred | `tickOverruns`, rate-limited warning |
