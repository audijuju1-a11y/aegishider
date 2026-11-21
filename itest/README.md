# Aegishider end-to-end integration test harness (Paper 1.21.4)

Fully automated, reproducible end-to-end test harness that proves - at the packet
level - what a Minecraft **Paper 1.21.4** server actually sends to connected
clients for the Aegishider plugin.

Eight scenarios: A hidden item, B visible item, C chunk-level chest hiding, the
**three-gap benchmark** - D far-band block-entity leak (160/336 blocks), E pie-ray
client block-entity registry, F Bobby/Distant Horizons cache replay, G the vertical
entity band that proves an underground base and the surface cannot see each other,
and H the base-marker shelf: `ENDER_CHEST`, `ENCHANTING_TABLE`, `BEACON` and plain
`BOOKSHELF` must lose their block states/entities, with a sign control proving the
chunk arrived and no beacon block entity left for a client-side beam. See `D:\Aegishider\docs\09-three-gap-benchmark.md` for methodology,
results and the reproduce commands.

Everything lives in `D:\Aegishider\itest` and **nothing outside it is modified**:
the plugin jar, Paper jar and PacketEvents jar are always *copied*, never edited.

The harness is validated against the legacy plugin jar snapshot in
`itest\.cache\baseline-Aegishider.jar` (`3.0.0`, sha256
`8fa4c379422f8218d52dc2e70210529accbb7a39c80971c9d14900086f86cd75`), which is
**expected to leak**. In baseline mode a detected leak is a PASS: it proves the
detector can see real leaks. In normal mode the same leak is a FAIL.

---

## Quick start

This machine has Windows PowerShell 5.1 (`powershell.exe`) and no `pwsh.exe`; the
scripts require only PowerShell 5.1+.

```powershell
# 1) Full A-I suite against the plugin under test (default: newest
#    Aegishider-*.jar in D:\Aegishider\aegishider-integrated\target)
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1

# 2) Validate the harness itself against the legacy jar (leaks are EXPECTED -> PASS)
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 -Baseline

# 2b) Same detector check with the build under test: world protection is switched
#     off for the run and the original config is restored afterwards
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 `
    -ProtectionDisabled -Jar D:\Aegishider\aegishider-integrated\target\Aegishider.jar

# 3) Three-gap scenarios only
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 -Scenarios 'D,E,F'

# 4) Test an explicit plugin jar
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 `
    -Jar D:\path\to\new-Aegishider.jar

# Useful variants
#   -KeepServer           leave the Paper server running for debugging
#   -SkipSetup            reuse the existing server dir/world (no wipe)
#   -BootTimeoutSec 420   slow machine / first-ever boot (downloads vanilla jar)
```

Exit codes: `0` = PASS, `1` = a scenario expectation failed (plugin bug),
`2` = harness/server/fixture error. Every run prints a PASS/FAIL table with exact
packet counts and writes `itest\out\report-<timestamp>.json`
(plus `itest\out\latest-report.json`).

A full A-I run takes about 6-9 minutes on this machine: ~60-90 s Paper boot
(varies with machine load) plus ~3-5 minutes of scenarios (D streams a
view-distance=24 chunk batch around its teleport; F now waits for its exact
room chunk instead of a fixed quiet window). On a wiped world the first join
generates and commits the whole view; the driver waits for both captures to go
quiet and for the server to stop logging overload before the first fixture
(bounded at 180 s, recorded as `server.settle` in the report), so a fresh-world
run does not race Paper's region/player saves.

The driver installs the jar selected with `-Jar`/`--jar` into
`itest\server\plugins\Aegishider.jar` (dropping Paper's remapped copy) before
boot, then records both the requested SHA-256 and the `Loading server plugin ...`
line in the report (`server.pluginJar`, `server.pluginLoadLine`). It also verifies
the loaded plugin hard (`server.pluginVerification`): exactly one `plugins\*.jar`
may provide the plugin, that jar's SHA-256 must equal the selected jar, and the
console load/enable lines must report the same version. Any mismatch fails the run
with exit code 2 before a scenario runs, so a run can never silently test a
leftover build.

### Leak control without the legacy jar (`-ProtectionDisabled`)

When the legacy baseline jar is not available, `-ProtectionDisabled` (driver:
`--protection-disabled --jar <build>`, which requires an explicit `--jar`) turns
the selected build into the leak control. Before boot the harness rewrites every
`worlds.<name>.enabled` under the top-level `worlds:` block of
`server\plugins\Aegishider\config.yml` to `false`, so the same scenarios must again
observe A/C/D LEAK (plus E `DIRTY_REGISTRY`, F `CACHE_LEAK`, G
`CROSS_FLOOR_VISIBLE`, H LEAK, I `CACHE_LEAK`). This validates the detectors; it is
not a verdict on the plugin.

The original config bytes are restored in the driver's `finally` block (after the
server has stopped, because the plugin can rewrite the file on shutdown), from the
process exit path, and on `SIGINT`/`SIGTERM`/`SIGHUP` (which also stop the Paper
server before exiting). When `plugins\` was
temporarily recreated and no config existed, the driver starts from the jar's own
shipped `config.yml` and deletes it again on restore, so the next boot writes
normal defaults. A backup left by a hard-killed run
(`config.yml.itest-orig` / `config.yml.itest-created`) is rolled back at the start
of the next `--protection-disabled` run. `--keep-server` also restores the file,
but the still-running server keeps its in-memory settings and may rewrite
`config.yml` when it finally stops. The report records `protectionDisabled: true`
and `protectionConfig` (origin, hashes, restore result).

---

## What a run does

1. **Concurrency + cleanup** (`run-itest.ps1`): only one harness run may use the
   fixed ports 25598/25599. A second run detects the live `scenario-driver.js` or
   `out\run.lock` owner and aborts immediately with a clear message instead of
   killing the active run (`-ForceCleanup` kills a stale hung run if needed).
   Cleanup then kills only harness-owned leftovers - processes on ports
   25598/25599 whose command line or `out\server.pid` marks them as ours, plus
   `itest\...\capture-bot.js` / `scenario-driver.js` node processes. Kills are
   tolerant of PIDs that disappear between discovery and `taskkill` (a stale PID
   is treated as already-cleaned, never as an error). Stale `out\server.pid` /
   `out\run.lock` files from crashed runs are detected and removed. A foreign
   process on either port aborts with an explicit message; nothing foreign is
   ever killed.
2. **Server rebuild** (`scripts\setup-server.ps1`): wipes only `itest\server\world*`,
   `logs`, `crash-reports`, recreates `plugins\` with `PacketEvents.jar` and the
   plugin under test, writes `server.properties` + `eula.txt`. Paper/vanilla caches
   under `itest\server\cache` / `libraries` are preserved to keep boot fast.
3. **Boot**: starts Paper 1.21.4 (port 25599, offline, flat, view-distance 24 /
   simulation-distance 4, RCON 25598) and waits for `Done (` in the console log
   (timeout 240 s).
4. **Bots**: starts `TestBot` and `TestBot2` (`bot\capture-bot.js`,
   `minecraft-protocol` 1.68.0). Each records every received packet to NDJSON and
   announces readiness on stdout. Both are put in creative mode via RCON.
5. **Scenarios A-I** run in sequence with RCON-created fixtures, markers are
   written into the captures so evidence windows are exact.
6. **Teardown**: bots disconnect, server is stopped with the RCON `stop` command,
   the process tree is force-killed only if it does not exit (it does exit
   cleanly), and the harness verifies both ports are free.

`SIGINT`/`SIGTERM`/`SIGHUP` run that same teardown before the driver exits: bots
disconnect, Paper receives `stop` (SIGKILL only after a short grace, or immediately
when RCON is not up yet), a `--protection-disabled` config is restored, and the
driver exits `2`. A second signal force-kills the server and exits at once, and a
90 s watchdog bounds a wedged shutdown. Ctrl-C therefore cannot leave a Java
process holding 25599/25598.

If the server process dies mid-run the driver aborts immediately with a clear
`harness error`, still tears everything down, frees the ports and exits `2`
(this path was tested by killing the server mid-scenario).

---

## Layout

```
D:\Aegishider\itest\
  run-itest.ps1              # one-command wrapper (PASS/FAIL summary, exit code)
  README.md
  scripts\
    setup-server.ps1         # idempotent Paper 1.21.4 test-server builder
  bot\
    package.json             # minecraft-protocol + minecraft-data
    capture-bot.js           # headless client, records every packet as NDJSON
    scenario-driver.js       # boots server+bots, runs A-I, writes report JSON
    lib\rcon.js              # zero-dependency Minecraft RCON client
    lib\chunk-decoder.js     # 1.21.4 paletted-container/chunk decoder + self-test
  server\                    # generated Paper server (world wiped every run)
  .cache\                    # cached jars: paper, PacketEvents-full, baseline snapshot
  out\                       # reports, captures, per-run directories, logs
```

### Server configuration (written every run)

`online-mode=false`, `server-port=25599`, `enable-rcon=true rcon.port=25598
rcon.password=itest-rcon-pass`, `level-type=minecraft\:flat` with an explicit
`generator-settings` (bedrock+dirt+grass, plains) so the ground surface is
predictable at **y=-61**, `generate-structures=false`, `view-distance=24`,
`simulation-distance=4`, `spawn-protection=0`, `enable-command-block=false`,
`gamemode=creative`, `network-compression-threshold=-1` (faster bot parsing),
`difficulty=peaceful`, `spawn-monsters=true` (scenario G needs a summoned zombie;
peaceful still suppresses natural monsters), `spawn-animals/spawn-npcs=false`,
`allow-nether=false`.

PacketEvents note: the Maven `packetevents-spigot` artifact from repo.codemc.io is
a *thin module jar* and fails on Paper with
`NoClassDefFoundError: com/github/retrooper/packetevents/PacketEvents`. The harness
therefore uses the **full distribution jar** from the official GitHub release
(`packetevents-spigot-2.14.0.jar`, ~5.7 MB) - copied from
`D:\Aegishider\.work\server\PacketEvents.jar` when that file is a full jar, else
downloaded from
`https://github.com/retrooper/packetevents/releases/download/v2.14.0/packetevents-spigot-2.14.0.jar`.
It loads successfully on Paper 1.21.4 in this harness.

---

## Bot capture format

`capture-bot.js` connects with `version: '1.21.4'`, `auth: 'offline'`,
username `TestBot` / `TestBot2`, handles configuration-state, keep-alives,
teleport confirms and position-look sync, and writes one JSON object per line per
received packet:

```json
{"seq": 23, "timestampMs": 1794627890123, "tRelMs": 1234, "state": "play",
 "name": "spawn_entity", "rawName": "spawn_entity",
 "data": {"entityId": 23, "objectUUID": "0a141e28-...", "type": 68,
          "x": 8.5, "y": -59.0, "z": 32.5, ...}}
```

* All received packets are recorded (play and configuration states).
* `name` is the canonical 1.21.4 name where minecraft-data uses a different one:
  `map_chunk -> level_chunk_with_light`, `tile_entity_data -> block_entity_data`,
  `unload_chunk -> forget_level_chunk`, `entity_metadata -> set_entity_metadata`,
  `entity_destroy -> remove_entities`, `block_change -> block_update`.
  `rawName` always keeps the library's name.
* Large payloads are summarized: chunk-data buffers are appended to a single
  `<bot>-chunks/chunks.pack` and referenced by `chunkDataFile` plus
  `chunkDataOffset`/`chunkDataLen`; multi-block-change arrays and other huge
  packets are length-summarized/truncated where safe. Entity positions,
  metadata, block updates and chunk coordinates are always kept in full. One
  pack instead of one file per chunk keeps the first-join capture from creating
  thousands of files while Paper is saving a freshly generated world. Older
  runs' per-chunk `.bin` captures are still readable.
* Marker lines (`state:"marker"`, `name:"__marker__"`) delimit every evidence
  window, e.g. `A-start` / `A-end`.
* The bot also supports `place` (creative-inventory block placement via
  `set_creative_slot` + `held_item_slot` + `block_place`), used to place the
  scenario C chest as a real player placement (fires `BlockPlaceEvent`).
* stderr of each bot is saved to `<bot>.stderr.log` in the run directory.

---

## Chunk decoder and self-test

`bot\lib\chunk-decoder.js` implements the 1.21.4 (protocol 769) wire format
without third-party chunk libraries:

* overworld column = 24 sections (`min_y=-64`, height 384), each section =
  `short block_count` + block-state **paletted container** + biome container;
* containers: single-value (bits=0, VarInt value + size prefix), indirect
  palette (bits 4-8, VarInt palette, VarInt long count, 64-bit big-endian longs),
  direct palette (bits>8);
* padded ("no span") bit packing: `floor(64/bits)` values per long;
* block lookup: section `(y-minY)>>4`, index `((y&15)<<8)|((z&15)<<4)|(x&15)`;
* global state id -> block name via `minecraft-data`.

Self-test (`node bot\lib\chunk-decoder.js --self-test`, also run inside every
driver invocation): it *encodes* a synthetic 24-section chunk containing known
stone / chest / observer / air states, decodes it, and asserts every check
(section count, byte accounting, per-block state round-trips, names, no trailing
bytes). Result is stored in the report as `decoderSelfTest`; a failing self-test
makes scenario C inconclusive and the run fails.

In scenario C the same decoder additionally has to find two **in-world positive
controls** in the real chunk packet before the chest assertion counts:
a stone marker at `(98,-59,98)` (state 1) and an observer at `(101,-59,99)`
(state 13572). Only if both decode correctly is the chest-at-`(100,-59,101)`
result trusted.

---

## Scenarios

Fixtures are built with RCON; bot positions/markers are exact. A/B/C/F/H/I take
5-13 s each; D waits for a view-distance=24 chunk batch around its teleport
(~110-170 s); G takes ~10 s.

**A - hidden dropped item** (`expected=HIDDEN`, baseline `expected=LEAK`)
Summons `minecraft:item` (diamond, deterministic UUID, `NoGravity`, pickup
disabled) at `(8.5,-59,32.5)`, 24 blocks from the bots and behind a
17x7x2 solid stone wall at z=16-17. A leak is any `spawn_entity` of entity type
`item` (68) / target UUID / follow-up metadata-move packet for that entity id in
the 3 s window after the summon, on **either** bot (multi-viewer check).
Evidence: per-bot item-spawn count, target-UUID matches, follow-up packets by
type, leaked entity ids, packet counts, markers.

**B - visible dropped item** (`expected=VISIBLE`)
Summons an item with a known UUID at `(8.5,-56.5,11.5)` - ~3 blocks in front of
`TestBot` with clear line of sight (it falls, generating movement packets).
PASS requires the spawn packet plus at least one metadata/position/velocity
follow-up within 3 s. Evidence: spawn latency (observed 2-30 ms), follow-up
counts by packet type, UUID match.

**C - chunk-level block hiding** (`expected=HIDDEN`, baseline `expected=LEAK`)
Builds a hollow 7x5x7 stone room around `(97..103, -60..-56, 97..103)`, stones
in a marker block, sets an observer marker, and - as `TestBot`, in creative
mode - places a **real chest** on the floor at `(100,-59,101)` via the actual
`block_place` packet (so the plugin sees a genuine `BlockPlaceEvent`). The
fixture chunk is explicitly `forceload`ed for the RCON build (building it while
unloaded used to fail with `That position is not loaded`), and every fill/set
response is validated. The harness then waits for the **exact** post-build room
chunk and its re-send after the 1000-block round trip; no fixed scan delay is
used. PASS (plugin mode) requires the chest state (3000-range) to be **absent**
from the section data at that coordinate; baseline PASS requires it to be
present. Extra diagnostics: RCON-placed control chest (placement-vs-material
hiding), post-chunk `block_update` corrections at the chest position, number of
chest states in the section, chunk unload/re-send counts, and measured
`initialChunkLatencyMs` / `resend.chunkLatencyMs`. On 2026-11-21 the same fixture
measured **630 ms** with the BOOKSHELF state scan and **631 ms** with it disabled
(see `docs/evidence/state-scan-latency-20261121.txt`).

**D - far-band block-entity leak** (`expected=HIDDEN`, baseline `expected=LEAK`)
Parks the bot 1100 blocks away, then `forceload` + `setblock` a real chest and an
oak sign inside chunk `(10,0)` (160 blocks) and chunk `(21,0)` (336 blocks) from
the stage. The bot teleports to the stage and the harness waits for the exact
chunk packets for both bands (an explicit packet waiter - a size-stability check
can fire between chunk batches). PASS requires, per band: the decoded chest state
at the exact coordinates is a filler (not in the chest state range), no
block-entity entry exists at the chest, and the sign block state + its block
entity are present in the same chunk as a positive control. Evidence: per-band
chunk counts, decoded chest state, block entities at both coordinates.

**E - pie-ray client block-entity registry** (`expected=CLEAN_REGISTRY`, baseline
`expected=DIRTY_REGISTRY`) scans **every** chunk packet captured in the session
for block-entity entries and classifies them by numeric registry id (1.21.4 chunk
block entities carry no NBT `id`; the id table is resolved from PacketEvents'
registry asset, verified by the captured `sign=7`). Any hidden container type
(chest family, barrel, shulker box, hopper, dropper/dispenser, furnace family,
spawner/trial spawner/vault) dirties the registry. The sign block entities from D
are the positive control; without them the scenario is INCONCLUSIVE, never a
false CLEAN.

**F - cache replay (Bobby / Distant Horizons)** (`expected=REVEAL_THEN_REHIDE`,
baseline `expected=CACHE_LEAK`) builds a closed room by RCON. The bot approaches:
the room chunk must arrive with the chest hidden, then a near reveal must arrive
as a chest `block_update`. The bot then teleports beyond
`reveal-distance * keep-distance-factor`; PASS requires a filler `block_update`
after the last chest update and a final session state that is **not** a chest -
that final state is exactly what a disk-caching mod would persist and replay.

**G - vertical entity band / anti-base-ESP** (`expected=CROSS_FLOOR_HIDDEN`,
baseline `expected=CROSS_FLOOR_VISIBLE`) builds a base floor at **y=-50** and a
surface floor at **y=64** (normal-world surface level), 114 blocks apart. A
zombie and a cow are summoned 2-4 blocks in front of each viewer **in open air**,
so the cross-floor pairs have a clear line of sight; only the vertical rule can
hide them. Two stationary mobs 40 blocks away also test the 24..96-block
viewer-join dirty sweep (they must appear when the viewer reaches its floor).
TestBot2 first moves beside TestBot on the base floor (same-floor player control),
then to the surface. PASS requires: each bot receives its own floor's zombie and
cow spawns, no cross-floor zombie/cow spawns after the final teleport (with the
hide/remove packet as evidence), no entity packets for the other bot during the
cross-floor window, and entity packets for the other bot on the same floor. This
is the packet-level form of "a base at y=-50 and the surface cannot see each
other" with the shipped `entity-height-shield.underground-y: 50` and 16-block
vertical threshold.

**H - base-marker states/entities and BOOKSHELF** (`expected=HIDDEN`, baseline
`expected=LEAK`) places `ENDER_CHEST`, `ENCHANTING_TABLE`, `BEACON` and plain
`BOOKSHELF` on a shelf **43 blocks** from the bot, with an oak sign as a positive
control. After a forced chunk resend, the decoded chunk must contain filler states
at all four positions, zero ender-chest/enchanting-table/beacon block entities, and
no beacon block-entity-data packet. The sign state **and** sign block entity must
still be present. Because the beacon beam is rendered client-side from the beacon
block entity, zero beacon state/entity/data means the client has no beam source.

**I - indexed plain BOOKSHELF reveal/re-hide** (`expected=REVEAL_THEN_REHIDE`,
baseline `expected=CACHE_LEAK`) places a plain `BOOKSHELF` by RCON (no
`BlockPlaceEvent`) at `(102,-59,100)`, so the only discovery path is the chunk
palette/state scan. The room is loaded for the build and the reader waits for the
exact fresh chunk on approach. PASS requires: the arrival chunk contains a
non-bookshelf state at that position, the indexed position is revealed by a
parseable bookshelf `block_update` while the bot is close, and a filler update
follows after the bot leaves, with the final state not a bookshelf. This is the
reveal/re-hide proof for a state-only-indexed block.

**Baseline comparison mode** is the `-Baseline` switch: same nine scenarios, old
3.0.0 jar, A/C/D/E/F **must leak** (E must have chest entries in the client
registry, F must end on the real chest), G must show cross-floor visibility, H
must leak its base markers, I must end with the real bookshelf, and B must be
visible. That validates the harness and the detectors. The wrapper prints and records the expected `LEAK`/
`DIRTY_REGISTRY`/`CACHE_LEAK`/`CROSS_FLOOR_VISIBLE` outcomes.

---

## Report schema (out\report-<timestamp>.json)

```jsonc
{
  "schema": "aegishider-itest/report/v1",
  "runId": "run-YYYYMMDD-HHmmss-mmm",
  "startedAt": "...", "finishedAt": "...", "durationMs": 226772,
  "baselineMode": true,
  "protectionDisabled": false,
  "protectionConfig": null,
  "environment": { "platform": "...", "node": "v24...", "minecraftProtocol": "1.68.0", "java": "..." },
  "plugin": { "jarPath": "...", "size": 6696904, "sha256": "...", "pluginYmlName": "Aegishider", "pluginYmlVersion": "3.0.0", "packetEventsInstalled": true },
  "server": { "bootMs": 159617, "versionLine": "...Loading Paper 1.21.4...", "rconReady": true, "crashDetected": false,
              "pluginVerification": { "ok": true, "expectedName": "Aegishider", "expectedVersion": "4.0.0", "expectedSha256": "...",
                                      "installedFile": "Aegishider.jar", "providers": [ { "file": "Aegishider.jar", "version": "4.0.0", "sha256": "..." } ],
                                      "loadLine": "...Loading server plugin Aegishider v4.0.0...", "loadVersion": "4.0.0", "reason": null },
              "stopped": { "cleanExit": true, "portsFreeAfterStop": true } },
  "decoderSelfTest": { "ok": true, "checks": [ ... 10 checks ... ] },
  "scenarios": {
    "A": { "expectation": "LEAK", "outcome": "LEAK", "pass": true, "durationMs": 8942,
           "evidence": { "perBot": { "testBot": { "itemSpawnPackets": 1, "targetUuidSpawns": 1, "followupPackets": 5, "leakedEntityIds": [23] }, ... },
                         "totalLeakedSpawnPackets": 2, "totalFollowupPackets": 10, "targetUuid": "...", "itemPosition": {...} },
           "markers": { "start": {...}, "end": {...} } },
    "B": { "expectation": "VISIBLE", "outcome": "VISIBLE", "pass": true, ... },
    "C": { "expectation": "LEAK", "outcome": "LEAK", "pass": true,
           "evidence": { "chestInChunkData": true, "chestChunkState": {"state":3016,"name":"chest"},
                         "decoderPositiveControls": { "stoneMarkerPresent": true, "observerPresent": true, ... },
                         "chestStatesInSection": 2, "resend": {...}, "postChunkBlockUpdatesAtChest": {...},
                         "fixture": { "chestServerData": "100, -59, 101 has the following block data: {id: \"minecraft:chest\"...}" } } },
    "D": { "expectation": "LEAK", "outcome": "LEAK", "pass": true,
           "evidence": { "perBand": { "band-160-blocks": { "distanceBlocks": 160,
                           "chunkPacketsReceived": 1, "chestState": {"state":3010,"name":"chest","leak":true},
                           "chestBlockEntities": [...], "signControl": {...} }, ... },
                         "anyLeak": true, "fixture": [...] } },
    "E": { "expectation": "DIRTY_REGISTRY", "outcome": "DIRTY_REGISTRY", "pass": true,
           "evidence": { "chunkPacketsScanned": 6050, "hiddenContainerBlockEntities": 6,
                         "signBlockEntities": 2, "offenders": [...],
                         "blockEntityTypeCounts": {"chest": 6, "sign": 2} } },
    "F": { "expectation": "CACHE_LEAK", "outcome": "CACHE_LEAK", "pass": true,
           "evidence": { "arrivalState": {"state":3010,"name":"chest","hidden":false},
                         "blockUpdatesAtChest": [], "revealSeen": false,
                         "rehideUpdates": [], "finalCachedState": {"state":3010,"name":"chest","dirty":true},
                         "cacheDirty": true } }
  },
  "overall": { "pass": true, "reason": "baseline validation passed - all expected leaks/visibility were detected" },
  "limitations": [], "errors": [],
  "artifacts": { "runDir": "...", "captures": {"TestBot": "...ndjson", "TestBot2": "..."},
                 "chunkDirs": {...}, "botStderrLogs": {...}, "consoleLog": "...", "reportPath": "..." }
}
```

---

## Verified evidence (actual runs on this machine)

**Baseline validation - legacy jar, `run-itest.ps1 -Baseline` -> PASS, exit 0**
(report `out\report-20261114-105600-528.json`, log `out\baseline-validation.log`,
captures `out\run-20261114-105357-245\`):

* Server: Paper `1.21.4-232` booted, RCON ready, **TestBot (entity 21) and
  TestBot2 (entity 22) both connected**, server stopped cleanly, ports 25598 and
  25599 free afterwards.
* Chunk decoder self-test: **all checks OK**.
* Scenario A (expected LEAK): **LEAK observed** - `TestBot: 1 item spawn packet`
  (target UUID match), `TestBot2: 1`, 5 follow-up entity packets each
  (2 metadata + 1 velocity + 2 relative-move) -> 2 leaked spawns, 10 follow-ups.
* Scenario B (expected VISIBLE): **VISIBLE observed** - spawn latencies 30 ms /
  26 ms, 2 metadata + 1 position/velocity follow-up each (follow-ups 3 per bot).
* Scenario C (expected LEAK): **LEAK observed** - after the forced chunk resend
  (`chunkUnloadPacketsForRoomChunk=1`, `chunkPacketsForRoomChunkAfterReturn=1`)
  the decoded chunk `(6,6)` contains **chest state 3016 at (100,-59,101)**;
  2 chest states in the section (player chest + RCON control chest); positive
  controls decoded: stone marker state 1 (present), floor stone state 1
  (present), observer state 13572 (present); zero post-chunk chest block-update
  corrections. The old jar's `HiddenBlockIndex` is evicted on chunk unload, so
  this fixture leaks both at the wire level and to the client.

**Baseline validation - legacy jar, `run-itest.ps1 -Baseline` -> PASS, exit 0**
(report `out\report-20261117-181855-258.json`, captures
`out\run-20261117-181201-309\`):

* A = LEAK (1 item spawn + 8 follow-ups per bot), B = VISIBLE, C = LEAK
  (chest state 3016 in the chunk payload), D = LEAK (chest state 3010 at **both**
  160 and 336 blocks), E = DIRTY_REGISTRY (6 chest block entities across 6050
  chunk packets; 2 sign controls), F = CACHE_LEAK (arrival state chest, no
  re-hide, final cached state chest).

**Plugin under test, `run-itest.ps1` -> PASS, exit 0 (2026-11-17)**
(report `out\report-20261117-194710-000.json`, captures
`out\run-20261117-194119-127\`, plugin `3.6.1` sha256 `e8f8594...`):

* A = HIDDEN (0 item spawns on both bots), B = VISIBLE (1 spawn each, 62 ms
  latency, 20 follow-ups each), C = HIDDEN (`chestInChunkData=false`, stone +
  observer positive controls decoded, chunk unloaded and re-sent once),
  D = HIDDEN (both 160/336 chunks received; chest state `stone`; 0 chest block
  entities; sign state + block entity present in both), E = CLEAN_REGISTRY
  (6037 chunk packets, 0 hidden container block entities, 2 sign controls),
  F = REVEAL_THEN_REHIDE (arrival hidden, near reveal, re-hide `stone`, final state `stone`).

**Crash robustness**: killing the Paper process mid-scenario produced
`RESULT: ERROR`, wrapper exit `2`, a single clear
`harness error: Paper server process died unexpectedly during scenario A (exit=...)`
in report/log, and both ports were free afterwards with no orphaned
java/node processes (report `out\report-20261114-104029-167.json`).

**Concurrency guard**: with a baseline run active, a second
`run-itest.ps1 -Baseline` was refused in ~1 s with
`another harness run is already in progress (node PID ... running scenario-driver.js)`,
exit `2`, and the first run was completely unaffected and finished PASS
(exit `0`) - this is the fix for the two-concurrent-runs sabotage mode.

**Stale-PID regression** (the "The process ... not found" abort reported during
new-plugin testing): a dead `out\server.pid` (PID 999999) and a dead
`out\run.lock` (PID 999998) were planted, then the harness was run. It logged
`removing stale out\server.pid` / `removing stale out\run.lock` in cleanup,
never treated the vanished PIDs as errors, and finished baseline PASS, exit `0`
(`out\stale-pid-regression.log`).

---

## Limitations / honest caveats

* **Packet-level client, not a rendering client.** "Hidden" means "the server did
  not send the information"; entity tracking distances are Paper's. The hidden
  item sits 24 blocks away, comfortably inside Paper's default item/misc tracking
  range (~32 blocks) so the baseline definitely leaks. If tracking ranges are
  changed drastically in `bukkit.yml`/Paper config, scenario A holds as long as
  the baseline still leaks; a baseline run that stops leaking fails loudly.
* **Item metadata visibility.** Scenario B accepts metadata **or**
  position/velocity follow-ups after the spawn; item entities normally send both.
* **Scenario C is about chunk *packet* data by design.** It intentionally does
  not accept "the plugin sent a block-change correction afterwards" as hidden
  (that is exactly the legacy leak the new PacketEvents build is supposed to fix);
  post-chunk corrections are reported as diagnostics.
* **Scenario C requires a player-placed chest.** The chest is placed with a real
  client `block_place` packet so `BlockPlaceEvent` fires. A plugin that only hides
  blocks placed by players (as the legacy jar does) will hide this one; the
  additionally RCON-placed control chest is reported but does not gate the test.
  If the new plugin hides based on a different config (e.g. world disabled, other
  hidden-material list), scenario C will report the mismatch with evidence -
  inspect `chestInChunkData` / `controlChestInChunkData` / `postChunkBlockUpdatesAtChest`.
* **Block-entity types are classified by numeric registry id.** On 1.21.4 the
  chunk block-entity NBT carries no `id` string, so `capture-bot.js` resolves the
  numeric type against the vanilla `block_entity_type` registry order (45 entries,
  from PacketEvents' registry asset, verified by the captured `sign=7`). If a
  future server version changes the order, update `BLOCK_ENTITY_TYPE_IDS` in
  `bot\capture-bot.js`.
* **Scenario E needs D's positive control.** E is INCONCLUSIVE (not CLEAN) when no
  sign block entity was captured, because an empty registry proves nothing. Run
  D and E together (`-Scenarios 'D,E'`) or as part of the full suite.
* **Scenario D needs view-distance 24 and an explicit packet waiter.** Chunk 21
  (336 blocks) sits on the edge at view-distance 22 and intermittently arrived
  after the size-stability check, producing an INCONCLUSIVE band; the harness now
  waits for the exact chunk packets and the server uses view-distance 24.
* **Scenario F measures the last block state sent**, not an installed caching mod:
  that state is the invariant Bobby/Distant Horizons persist. A client that never
  processes the re-hide is out of scope for any server-side plugin.
* **Scenario H proves the beacon beam source is absent, not rendered pixels.**
  The harness is a packet client: it checks that no beacon block state, beacon
  block entity, or beacon `BLOCK_ENTITY_DATA` packet reaches the client. The
  vanilla client renders a beacon beam from that block entity, so with all three
  absent it has no beam source. A rendering-client screenshot is out of scope.
* **Scenario G assumes the shipped vertical rule.** It builds a 114-block gap
  between y=-50 and y=64, so it passes while `max-vertical-distance` is below 114
  (default 16) and `underground-y` is at least -50 (default 50). Raising the
  threshold above 114 requires a taller fixture and a matching
  `maxVerticalDistance` in `G_FLOOR`. The harness switches the server to
  `difficulty normal` for the summoned zombie and restores `peaceful` after.
  The baseline jar does not hide animals/monsters, so cross-floor spawns prove
  the probe itself works. The server must run with `spawn-monsters=true`
  (`setup-server.ps1` sets this): Paper removes Monster entities immediately in
  a `spawn-monsters=false` world, so a summoned zombie would never reach any
  client. Scenario G sets `doMobSpawning=false` during its normal-difficulty
  window so natural mobs cannot pollute the fixture.
* **Reveal policy assumptions** (F): default `reveal-distance=24` and
  `keep-distance-factor=1.6`; the far teleport must exceed their product. Changing
  the config requires adjusting the teleport distance in the driver.
* **Config is the jar's default.** The setup wipes `plugins\` each run, so the
  plugin starts with its bundled default `config.yml`. A custom `config.yml` must
  be dropped in by the caller if needed (not required for the default scenarios).
* **Chunk decoder assumptions**: overworld only (`minY=-64`, height 384, 24
  sections), which is exactly this test server's dimension. Heightmaps are parsed
  by `minecraft-protocol`, not by the decoder; the decoder consumes the chunk-data
  blob and asserts it is fully consumed (trailing bytes = 0).
* **Boot time varies** (observed 70-160 s; fresh flat world + Paper's re-obf
  server remap + PacketEvents resource loading + machine load). Boot is not a
  scenario and is excluded from the per-scenario <120 s budget. Use
  `-BootTimeoutSec 420` if the first run on a cold machine exceeds 240 s.
* **PacketEvents "thin jar" trap** (documented above): the Maven spigot artifact
  is not the runnable plugin jar; the harness fetches the full GitHub release jar.
* **minecraft-data naming**: packet names in NDJSON follow minecraft-data 3.119.0
  for 1.21.4; canonical aliases are provided in `name` and the library name in
  `rawName`.
* **RCON implementation**: Paper replies to commands with one type-0 packet and
  no Source-RCON terminator; the custom client settles after a 120 ms idle window
  (long responses still work). If RCON were ever unusable, the driver's only
  alternative would be a stdin console pipe (not currently implemented because
  RCON works reliably here).
* The baseline snapshot is taken automatically from the integrated target jar the
  first time (and can be refreshed with
  `scripts\setup-server.ps1 -RefreshBaseline`). It is a copy; the integrated
  directory is never modified.

---

## Testing the new plugin jar

Once the main engineer produces the new (PacketEvents-based) jar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Aegishider\itest\run-itest.ps1 `
    -Jar D:\Aegishider\aegishider-integrated\target\Aegishider.jar
```

Expected PASS = `A: expected HIDDEN observed HIDDEN` (0 leaked spawn packets on
either bot), `B: expected VISIBLE observed VISIBLE`,
`C: expected HIDDEN observed HIDDEN` (chest state absent from
`level_chunk_with_light` at (100,-59,101) while the stone/observer markers decode
correctly), `D: expected HIDDEN observed HIDDEN` (both far-band chunks arrive, the
chest state decodes as a filler and no chest block entity exists, while the sign
state + block entity prove the chunk was sent), `E: expected CLEAN_REGISTRY
observed CLEAN_REGISTRY` (0 hidden container block entities, sign control > 0) and
`F: expected REVEAL_THEN_REHIDE observed REVEAL_THEN_REHIDE` (hidden arrival,
near reveal, far re-hide, final state not a chest) and `G: expected
CROSS_FLOOR_HIDDEN observed CROSS_FLOOR_HIDDEN` (own-floor zombie + cow visible
on both floors, no cross-floor mob or player packets, same-floor player visible).
Any failing scenario leaves
the exact packet counts, coordinates and capture paths in the report's `evidence`
blocks and the NDJSON captures/`server-console.log` for debugging.

## Troubleshooting

* `port 25599 is in use by a process that does not belong to this harness` -
  another Minecraft server is running on that port; stop it or change the port
  constants in the scripts (both use 25599/25598 deliberately).
* `Paper server did not reach "Done (" within ...s` - machine was very slow;
  re-run with `-BootTimeoutSec 420` or inspect `out\run-*\server-console.log`.
* `NoClassDefFoundError: com/github/retrooper/packetevents/PacketEvents` in the
  server log - a thin PacketEvents jar got installed; delete
  `itest\.cache\PacketEvents-full.jar` and re-run (the setup re-downloads the
  full distribution jar).
* `bot ... did not become ready` - check `out\run-*\TestBot.stderr.log` and the
  server console log (usually a protocol/client handshake problem).
* `-SkipSetup` keeps the previous world/fixtures; scenario fixtures are built
  idempotently (rooms/walls are re-filled), so repeated runs are safe.
* `another harness run is already in progress ...` - the harness uses fixed test
  ports, so two runs cannot overlap. Wait for the other run (its wrapper prints
  PASS/FAIL and frees the ports) or use `-ForceCleanup` when a previous run's
  node driver is hung. Never start two runs concurrently: they would otherwise
  treat each other's server as a leftover and kill it (the old stale-PID crash
  mode is fixed, but results would still be garbage).
