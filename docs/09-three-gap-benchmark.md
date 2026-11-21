# Three-gap public benchmark (block-entity leak, pie-ray, cache replay)

Date: 2026-11-17
Plugin under test: `Aegishider-3.6.1.jar` (sha256 `e8f8594cf9a42ca1787ff1d858cd602c9343556bc0c1a1c8f0a0eb0f7f96b7e4`)
Baseline: `3.0.0` (sha256 `8fa4c379422f8218d52dc2e70210529accbb7a39c80971c9d14900086f86cd75`)

This document defines and reports a reproducible packet-level benchmark for the
three leak classes that server-side container hiding normally misses. The harness
is `D:\Aegishider\itest` (`run-itest.ps1`, scenarios A-F). Nothing in the benchmark
requires a modified client or a rendering mod: it records what the server actually
sends to an unmodified 1.21.4 client and decides from those bytes.

## 1. The three gaps

| # | Gap | Why hiding the block state is not enough | Benchmark scenario |
|---|-----|-------------------------------------------|--------------------|
| 1 | Block-entity position leak | Chunk packets carry a block-entity list with absolute coordinates next to the block states. A client (or ESP mod) can name a chest from that list even when the block state itself is replaced. Leaks survive at 140-340 blocks because chunks keep streaming long after the reveal radius. | D |
| 2 | Pie-ray / client registry scan | F3's pie chart (and client ESP mods) enumerate the block entities the client has received, not what the player can see. One leaked `chest` entry anywhere in the session is enough to keep the container in that registry. | E |
| 3 | Cache replay (Bobby / Distant Horizons) | These mods persist chunk data to disk and replay it on rejoin. Whatever block state the server sent last for a position is what gets cached. Revealing a container when the player is near and never sending the filler again means the real chest is cached and later replayed from any distance. | F |

Scenarios A-C remain in the suite as regression guards: A hidden dropped item,
B visible dropped item, C chunk-level chest hiding with palette-decoded chunk
data.

## 2. How the plugin closes each gap

| Gap | Mitigation (code path) | Tested by |
|-----|------------------------|-----------|
| 1 | `ChunkSanitizer` replaces protected block states and strips block-entity entries whose type is a hidden container, independent of the state-id mapping (an unresolvable state id cannot preserve the block entity). `FillerChooser`/config validation never pick a block-entity-bearing block (sign, banner, ...) as filler. | D, C |
| 1 | Single and multi block updates are fail-closed: an unindexed position whose state is a configured protected material is rewritten to the filler; `BLOCK_ENTITY_DATA` at an unindexed position is cancelled unless its peeked block-entity type is non-hidden. | unit tests, C |
| 2 | Because the chunk sanitizer works on every outgoing chunk, the cumulative client-side block-entity registry never receives a hidden container entry, so the pie chart/ESP has nothing to list. | E |
| 3 | `BlockShield.onViewerPositionJump` re-hides every revealed block beyond `reveal-distance * keep-distance-factor` **before** dropping the marker on same-world teleports/respawns. Previously the markers were dropped silently, which left the real block as the last state the client (and any caching mod) received. | F |

## 3. Environment

- Windows `10.0.26300`, JDK `21.0.13+9`, Node `24.21.0`.
- Paper `1.21.4-232`, offline mode, flat world (`y=-61` surface), port `25599`, RCON `25598`.
- `view-distance=24`, `simulation-distance=4`. View distance 24 is needed for the
  336-block band (chunk 21) to arrive reliably; the capture bot advertises client
  view-distance 32 so the server does not shrink the send radius.
- PacketEvents `2.14.0` (full distribution jar).
- Bots: `minecraft-protocol 1.68.0`, `minecraft-data 3.119.0`, recording every
  received packet as NDJSON; chunk payloads are stored as sidecar `.bin` files and
  decoded with the in-repo 1.21.4 palette decoder.
- Two clients (`TestBot`, `TestBot2`) so leak checks are multi-viewer.

## 4. Scenario methodology

### D - far-band block-entity leak (160 / 336 blocks)

1. Park `TestBot` 1100 blocks away; wait for the capture to go quiet.
2. `forceload add` + `setblock` a real chest and an oak sign inside two far
   chunks (chunk `10,0` = 160 blocks and chunk `21,0` = 336 blocks from the stage);
   verify both server-side with `data get block`.
3. Teleport to the stage (`8.5,-59,8.5`) and wait until the capture contains a
   `level_chunk_with_light` packet for **both** fixture chunks (explicit packet
   waiter, not a size heuristic), then wait for quiet.
4. For each band: decode the last chunk packet and assert
   - chest block state at the exact coordinates is **not** in the chest state range
     (filler instead),
   - no block-entity entry exists at the chest coordinates,
   - positive control: the sign block state **and** its block entity are present in
     the same chunk (proof the chunk really was sent and the decoder works).

The positive control is what separates "hidden" from "never sent".

### E - pie-ray (client block-entity registry)

Scan every `level_chunk_with_light` packet captured by `TestBot` for the whole
session and classify each block-entity entry by its numeric registry id
(1.21.4 chunk block entities carry **no NBT `id` string**; the numeric type is the
only type information the client gets). The type table is resolved from
PacketEvents' `assets/mappings/registries/block_entity_type.nbt` (base list
`V_1_19_3` plus every delta up to `V_1_21_2`; changes apply to the old list, then
additions insert). The live capture agrees with the table (`chest=1`, `sign=7`).

- Offender: any `chest`, `trapped_chest`, `ender_chest`, `barrel`, `shulker_box`,
  `hopper`, `dropper`, `dispenser`, `furnace`, `blast_furnace`, `smoker`,
  `brewing_stand`, `mob_spawner`, `trial_spawner`, `vault` entry.
- Positive control: at least one sign block entity must exist (fixtures from D),
  otherwise the scan is INCONCLUSIVE - an empty registry proves nothing.
- Cumulative by design: one leaked entry at any moment dirties the registry.

### F - cache replay (Bobby / Distant Horizons)

1. Build a closed stone room at `(97..103, -60..-56, 97..103)` via RCON and place
   the protected chest with `setblock` (no placement packet that could be mistaken
   for a reveal).
2. Park the bot far away, then teleport it to the room. The room chunk arrives with
   the chest hidden (asserted on the arrival chunk payload).
3. Wait for the reveal: while near and in FOV the plugin sends the real chest as a
   `block_update` (state in the chest range).
4. Teleport far away (beyond `reveal-distance * keep-distance-factor`). The
   benchmark requires a **re-hide** `block_update` (filler state) after the last
   chest update, and the session's last state for that position must not be a chest.
   That last state is exactly what a caching mod would persist.

A re-hide must not depend on the chunk being re-sent: when the player leaves, the
server unloads the room chunk and never sends it again, so dropping the reveal
marker without a block update leaves the real chest as the final cached state.

## 5. Results - plugin under test (2026-11-17)

Report: `itest\out\report-20261117-194710-000.json`
Run dir: `itest\out\run-20261117-194119-127\`
Command: `powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1`
Overall: **PASS** (365 s, boot 38.9 s, 121 unit tests green on Windows and Linux before the run).
This run uses the exact published jar (`e8f8594c…`), downloadable at
`https://aegishider-platform.audijuju1.workers.dev/release/rel_bh_361/download` (SHA-256 verified).

| Scenario | Expectation | Observed | Key evidence |
|----------|-------------|----------|--------------|
| A hidden item | HIDDEN | HIDDEN | 0 item spawn packets on both bots, 0 follow-ups |
| B visible item | VISIBLE | VISIBLE | 1 spawn each, 62 ms latency, 20 follow-ups each |
| C chunk chest | HIDDEN | HIDDEN | `chestInChunkData=false`; stone marker + observer controls decoded; chunk unloaded and re-sent once |
| D 160/336 blocks | HIDDEN | HIDDEN | both chunks received; chest state `stone` at both coordinates; 0 chest block entities; sign state 4358 + sign block entity (registry type 7) in both chunks |
| E pie-ray | CLEAN_REGISTRY | CLEAN_REGISTRY | 6037 chunk packets scanned; 0 hidden container block entities; 2 sign block entities (positive control) |
| F cache replay | REVEAL_THEN_REHIDE | REVEAL_THEN_REHIDE | arrival `stone` (hidden); near reveal arrives as a chest update; filler `stone` update follows; final state `stone` |

## 6. Results - baseline (3.0.0, leaks expected)

Report: `itest\out\report-20261117-181855-258.json`
Run dir: `itest\out\run-20261117-181201-309\`
Command: `... run-itest.ps1 -Baseline`
Overall: **PASS** (baseline validation: every expected leak was detected, 427 s).

| Scenario | Expectation | Observed | Key evidence |
|----------|-------------|----------|--------------|
| A hidden item | LEAK | LEAK | 1 item spawn packet + 8 follow-ups per bot |
| B visible item | VISIBLE | VISIBLE | 1 spawn each |
| C chunk chest | LEAK | LEAK | chest state 3016 inside the chunk payload at the fixture coordinates; 2 chest states in the section |
| D 160/336 blocks | LEAK | LEAK | chest state 3010 at **both** 160 and 336 blocks in the chunk payloads |
| E pie-ray | DIRTY_REGISTRY | DIRTY_REGISTRY | 6 leaked chest block entities across 6050 chunk packets; 2 sign controls |
| F cache replay | CACHE_LEAK | CACHE_LEAK | arrival state `chest` (not hidden), no reveal, no re-hide, final cached state `chest` |

The baseline proves the detectors see the real information, not the filler: the
old jar leaks the chest block state at both far bands and leaks six chest block
entries into the client registry within one session.

## 7. Reproduce

```powershell
# 1) build the plugin (unit tests + shaded jar)
$env:JAVA_HOME = 'C:\Users\audim_r0h5i\.jdks\jdk-21.0.13+9'
D:\Aegishider\.tools\apache-maven-3.9.9\bin\mvn -B -o clean verify   # in D:\Aegishider\aegishider-integrated

# 2) full A-F suite against the built jar (default: newest Aegishider-*.jar)
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1

# 3) three-gap scenarios only
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 -Scenarios 'D,E,F'

# 4) detector validation against the old jar (all leaks must be detected)
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 -Baseline

# 5) explicit jar
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 `
    -Jar D:\Aegishider\aegishider-integrated\target\Aegishider-3.6.1.jar
```

Exit codes: `0` PASS, `1` scenario expectation failed, `2` harness/server/fixture
error. Every run writes `itest\out\report-<timestamp>.json` and
`latest-report.json`, with per-scenario evidence and capture paths.

## 8. Limitations (honest caveats)

- **Packet-level, not rendering.** "Hidden" means the server never sent the
  information. No real Bobby or Distant Horizons client is installed; scenario F
  measures the invariant those mods depend on - the last block state sent for a
  position. A mod that caches the reveal but receives the re-hide afterwards is
  covered; a mod that snapshots mid-reveal without processing later updates is out
  of scope for any server-side plugin.
- **Block-entity registry table is version-specific.** 1.21.4 chunk block entities
  carry no NBT `id`; classification uses the vanilla `block_entity_type` registry
  order (45 entries) resolved from the PacketEvents registry asset. The live
  capture confirms `sign=7`; if a future server version changes the order, update
  the table in `bot\capture-bot.js` (`BLOCK_ENTITY_TYPE_IDS`).
- **E depends on D's fixtures.** Scenario E requires at least one sign block
  entity captured in the session; if D could not deliver a fixture chunk, E reports
  INCONCLUSIVE instead of a false CLEAN.
- **D needs view distance 24 and an explicit chunk waiter.** Chunk 21 at
  336 blocks was flaky at view-distance 22 (edge of the send radius); the harness
  now waits for the exact chunk packets and the test server uses view-distance 24.
- **Reveal policy assumptions.** F uses the default `reveal-distance=12` and
  `keep-distance-factor=1.6`; the far teleport must exceed their product. If the
  config is changed, adjust the teleport distance in the driver.
- **No claim about other versions or third-party servers.** Results apply to Paper
  1.21.4 with this plugin build and these packet captures. The "DonutSMP leaks at
  140-340 blocks" observation comes from the AntiBaseESP findings and is not
  independently reproduced against DonutSMP here; what is reproduced is that the
  legacy Aegishider jar leaks the same class of data at those distances, and that
  the new build does not.
- **Timing.** Full A-F takes ~7 minutes (boot 60-90 s, D ~170 s, F ~113 s); the
  per-run artifacts are large (captures ~5-10 MB NDJSON plus chunk sidecars).

## 9. Artifacts

- Harness: `D:\Aegishider\itest\README.md`
- This benchmark report: `D:\Aegishider\docs\09-three-gap-benchmark.md`
- Plugin run: `itest\out\report-20261117-194710-000.json`
- Baseline run: `itest\out\report-20261117-181855-258.json`
- Captures and server logs: `itest\out\run-20261117-194119-127\` and
  `itest\out\run-20261117-181201-309\`
