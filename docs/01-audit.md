# Aegishider 3.1.0 — Deep Audit of the Previous Code Base

Scope: every Java source file in `aegishider-integrated` (20 files), `pom.xml`,
`plugin.yml`, `config.yml`, the built `target/Aegishider-2.0.0.jar` and the legacy
`target/Aegishider.jar`. Baseline `mvn clean package` succeeded (compile only, zero tests:
`Tests run: No tests to run`).

This document records what the code actually did — not what comments or module names
claimed. Everything below was confirmed by reading the sources (and, where noted, by
decompiling/inspecting Paper 1.21.4 and PacketEvents 2.14.0). It is the justification for
the rewrite that follows.

Severity: **P0** = security correctness / data leak, **P1** = thread safety/lifecycle,
**P2** = performance, **P3** = dead code/inconsistency.

---

## A. Listener registration (P0, confirmed)

`AegishiderPlugin.onEnable()` registered exactly one listener:

```java
pm.registerEvents(new AllListeners(this), this);
```

`AllListeners` is a *container* class. `BlockListener`, `PlayerListener` and
`WorldListener` are separate top-level package-private classes in the same file and were
**never instantiated or registered**.

Consequences (all confirmed dead in the shipped JAR):
- `BlockPlaceEvent` → hidden blocks were never indexed from placement.
- `BlockBreakEvent` → never unindexed/revealed.
- `PlayerJoin/Move/Teleport/Quit` → no viewer lifecycle, no hideY updates, no cleanup
  bookkeeping (quit cleanup only partly worked through other paths that also never ran).
- `WorldUnloadEvent` → world data never evicted.
Only `ChunkLoadEvent`/`ChunkUnloadEvent` (methods on `AllListeners` itself) actually ran.

## B. Natural blocks were never discovered (P0)

`HiddenBlockIndex` was only written from `BlockPlaceEvent` (dead, see A) and a YAML file.
Chunk data was only read to *verify* already-indexed positions. Natural dungeon/stronghold/
village/trial-chamber chests and spawners were therefore invisible to the system even on a
perfectly functioning listener set. The index eviction bug below compounded this.

## C. `pendingUpdates`: unsynchronized `LinkedHashMap` across threads (P1, confirmed)

```java
pendingUpdates.computeIfAbsent(player, k -> new LinkedHashMap<>()).put(pos, data);
```

`stagePending()` ran on async worker threads; `drainPending()` ran on the main thread.
A plain `LinkedHashMap` was mutated and drained concurrently with no synchronization:
lost updates, `ConcurrentModificationException`, and (worst case) a block that stays real
on the client while the cache believes it is faked → persistent leak.

## D. Wrong `ChunkSnapshot` when draining a shared per-player batch (P0, confirmed)

The pending buffer is per **player**, not per `(player, chunk)`. Async work items for
several chunks of the same player could finish concurrently; whichever scheduled the
main-thread task first drained *the whole per-player map*, then evaluated every drained
position against its own `work.snapshot()`:

```java
Material mat = work.snapshot().getBlockType(x - work.chunkX()*16, y, z - work.chunkZ()*16);
```

For positions from a different chunk the local coordinates can be outside 0..15: either
`IndexOutOfBoundsException` (caught, silently skipped → protection lost) or the wrong
material (wrong spawner reveal). Same-position updates from other chunks could be sent
with incorrect material checks.

## E. Cache committed before the packet was actually sent (P0, confirmed)

`markFaked()`/`markRevealed()` were called while building the batch, *before*
`sendMultiBlockChange`. If sending throws, the client never receives the fake block but
the cache records FAKED; later scans skip that position because "already faked" → the real
block stays visible forever. Fail-open.

## F. Queue overload silently drops security work (P0, confirmed)

`scheduleChunk()` acquired a semaphore; on failure it returned with only
`metrics.setQueueSize(MAX)`. No retry, no fallback, no alert. Under load, hiding silently
stops for chunks. Metrics then report `MAX_QUEUE_DEPTH - availablePermits`, which is not
the number of rejected tasks.

## G. TPS-based protection reduction (P0 - policy violation)

`DynamicRevealRadiusEngine.getRevealRadius()` reduced the processed radius when TPS was
low (`tps < 19.5 → -1 chunk`, `<18 → -2`, `<15 → -3`) and `adaptiveRadius()` had the same
behavior. Lower server performance therefore reduced protection coverage exactly when the
server is loaded. `signatureConfidence` *also* reduced the radius: a high-confidence base
detection meant **fewer** nearby chunks were hidden than for a normal chunk (inverted
security semantics).

## H. Spawner proximity loop: O(players × spawners) + flicker (P2/P0)

Every 3 s, for every world, a copy of the whole spawner array was taken
(`getSpawnersInWorld`) and every player × spawner pair was distance-checked, with a
`Location` allocation per hit. The async scan meanwhile re-faked spawners because the L1
state was `REVEALED` (treated as "not faked"), so faked → reveal → faked ... produced a
repeating flicker every ~3 s for any player near a spawner.

## I. `PlayerMoveEvent` (P0 - dead + wrong)

Not registered (A). Even if registered, it compared `getFrom().getPitch()` (no yaw/FOV),
used arbitrary 4-block/10-degree thresholds, and called `refreshPlayer()` which posts one
`runTask` per move event that each schedules up to 81 chunk snapshots — a main-thread
task storm. Snapshot capture of 81 chunks per move is O(1.2M blocks) copied per refresh.

## J. World/chunk keys (P0 - cross-world collisions)

- `BlockPosUtil.chunkKey(worldName.hashCode(), cx, cz)` truncated the world name hash to
  20 bits.
- `PlayerIntelligenceCache.chunkKey(cx, cz)` omitted the world completely.
- Per-player caches (`VisibilityCache`, L1/L3) keyed blocks by `(x,y,z)` only: the same
  coordinates in another dimension collided. A player teleporting between worlds could see
  stale faked/revealed state from the other world.
- `HiddenBlockIndex.loadFromDisk` parsed `worldName + ":" + pos` with `lastIndexOf(':')`,
  which corrupts world names containing a colon.

## K. L1/L2/L3 cache cost/benefit (P1/P3)

- L3 used `nextSlot++ & 0x3F` → **slot collisions after 64 players**; `getPlayerBySlot`
  is O(n); the bitmask value returned by `getFakedBitmask` was computed and then ignored
  by `revealToAll` (which iterates all world players).
- `l3Bitmask` is a `Long2LongOpenHashMap` (not thread-safe; synchronized ad-hoc) that grows
  for every position ever faked and is never evicted on chunk/player cleanup.
- L2 (`world → chunk → set`) is never cleaned on player quit and is written for every
  player/block: unbounded growth for long sessions.
- `VisibilityCache` and `MultiLevelVisibilityCache` duplicated the same state with
  different locking; `stats` read the legacy one while the engine wrote the new one.
- `getChunkBlocks()` returned a defensive copy per scan; the hot path allocated a
  `LongOpenHashSet` copy per chunk per player per refresh.

## L. Executors (P2, confirmed)

- `Executors.newFixedThreadPool(cores)` → unbounded `LinkedBlockingQueue`. The only bound
  was a manual semaphore around submission; on shutdown `awaitTermination(5 s)` blocks the
  main thread.
- `newScheduledThreadPool(1)` performed the entire YAML persistence serialization
  (building a `List<String>` with every block) while main-thread events locked the same
  sets. `saveToDisk()` runs on the server thread during `onDisable`.
- No task coalescing, no stale-result cancellation, no rejection counter.

## M. Commands / status messages vs reality (P3)

- `/aegishider raidinfo` printed "not yet wired" although plugin.yml advertised it.
- Startup log claimed `AntiXray: ON | RaidDetection: ON | ProtectionLayer: ON` while
  `RaidDetectionEngine.recordChunkEntry` was never called and `ChunkRiskClassifier.recordVisit`
  was never called (visitor counts always 0).
- `aegishider.bypass` was documented as "see blocks normally" but the hiding path never
  checked it; it only influenced the reveal radius. Bypass players still received fake blocks.
- pom version `2.0.0` vs plugin.yml `3.0.0`.

## Additional defects found

1. **Chunk unload destroyed the protection index** (P0): `onChunkUnload` called
   `hiddenBlockIndex.evictChunk(...)`. A player leaving the area unloaded the chunk and
   permanently deleted its hidden-block registry entries; on reload the real chests and
   spawners were sent to the client. This is the single most damaging "security" bug after
   the listener issue.
2. **No item/entity protection at all**: no code path touched item entities, so dropped
   items, stacks, NBT/components and movement were fully visible to every tracking player
   (Item ESP trivial).
3. **No chunk-packet interception**: block hiding was `sendBlockChange` *after* the real
   chunk packet was already sent. Any client that reads the chunk packet (ordinary ESP)
   sees every container before the fake arrives. This is an architecture-level leak, not a
   bug to patch in the old design.
4. **Index written before verifying snapshot material**: an index entry whose block had
   changed was silently skipped (`snapshotMat` mismatch) and never re-discovered.
5. **Load path**: `loadFromDisk` recomputed the chunk key from `worldName.hashCode()`,
   consistent with the runtime (bad) key but not with the on-disk line format for names
   containing ':'.
6. **Config reload races**: `ConfigManager.load()` cleared/populated a plain `HashMap` on
   the main thread while async scans read `WorldConfig` through it; no memory barrier.
7. **Bypass/team/ally settings were never enforced**: `teamBypass`/`allyBypass`,
   `PlayerTracker.allyMap` and the `UltimateTeams` softdepend were dead settings.
8. **Analytics ran per block break with O(n) `toArray` copies** and 500-element deques,
   plus `miningDirectionScore` unused.
9. **`BlockPosUtil.encode` clamps Y to 12 bits (±2048)** — fine for 1.21.4 (-64..320) but
   the decoded sign extension was correct only because of manual masks; no tests existed.
10. **No tests at all**: surefire reported "No tests to run"; no unit tests for encoding,
    policy, thread safety or packet paths.
11. **Raid alert listener**: broadcast to all admins synchronously from arbitrary (main)
    context and could run during shutdown; no cooldown beyond per-chunk 60 s.
12. **World keys**: `worldName.hashCode()` is reused for every map although the outer map
    already used the string — inconsistent identity between components.
13. **Shade**: jar produced as `Aegishider-2.0.0.jar` plus a `Aegishider.jar` replacement;
    plugin.yml inside claimed 3.0.0. Old `target/` artifacts were left in place.
14. **`getSpawnersInWorld` array copy per world per 3 s** even when no players were near.
15. **Everything that claimed "async" was effectively unbounded main-thread scheduling**:
    `refreshPlayer` posted a new main-thread task per event, each scheduling up to 81
    snapshot jobs; the semaphore rejected silently after 256 in-flight items.

---

## Root cause summary

The previous system was an **anti-xray heuristic that operated after the data had already
left the server**. It had no packet-layer enforcement, no entity shield, no natural-block
discovery, a dead event layer, and several fail-open caches. Feature names ("AntiXray",
"RaidDetection", "ProtectionLayer", "MultiLevel cache") did not correspond to active,
correct behaviour.

## What the rewrite had to guarantee

1. No protected data in outgoing packets before a completed policy check (packet gateway,
   fail-closed on errors/unknowns).
2. Per-viewer entity visibility as a first-class primitive (native hide-by-default).
3. World-scoped, collision-free keys and world-derived block discovery (natural blocks).
4. Explicit fail-closed states for queue pressure, timeouts, missing plugin, stale
   revisions and exceptions.
5. Bounded, budgeted main-thread work with no unbounded queues and no silent rejection.
6. A test suite that fails if any of the above regresses, plus packet-level evidence from
   a real Paper server.
