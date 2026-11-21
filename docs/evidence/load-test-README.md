# Aegishider load-test harness (Paper 1.21.4)

Reproducible, honest load test for the Aegishider plugin on a real Paper 1.21.4
server. Everything here lives in `D:\Aegishider\bench`; the plugin source tree
(`D:\Aegishider\aegishider-integrated`) and the jars in `D:\Aegishider\dist` are
read-only inputs. The load test runs in its **own isolated server directory**
`D:\Aegishider\bench\load-server` on **ports 25601 (game) / 25600 (RCON)** so it
never collides with the integration harness at `D:\Aegishider\itest\server`
(25599/25598).

This harness answers: **with N headless player bots online and M tracked dropped
items near spawn, what do Paper MSPT/TPS and Aegishider's own tick/engine metrics
look like on this machine?** It reports measured numbers only; a tier is only
reported as "passed" when at least 95% of the requested bots actually reached
spawn state.

---

## Files

| File | Purpose |
| --- | --- |
| `load-bench.js` | Orchestrator: preflight/port safety, server dir + properties setup, plugin jar copy, datapack generation, Paper lifecycle, bot workers, RCON sampling, soak churn, cleanup, result JSON. |
| `load-bot.js` | Lightweight headless bot worker (minecraft-protocol 1.68.0, `auth:"offline"`, version `1.21.4`). One process hosts many clients. Counts packets in memory only, writes no capture files, automatic keep-alive, stdin JSON control channel. |
| `gen-datapack.js` | Datapack generator: `world/datapacks/bhload` (`pack_format` 57) with `data/bhload/function/summon_items.mcfunction` containing exactly N `summon minecraft:item ...` commands. Deterministic. |
| `README-load-test.md` | This document. |
| `load-<label>.json` | Result file per run (raw RCON output, parsed metrics, join data, cleanup state). |
| `load-server-<label>.log` | Paper stdout/stderr for the run. |
| `load-console-<label>.log` | Harness progress log (phases, samples, errors). |
| `load-<label>-aborted.json` | Written instead of a result when preflight aborts (port already in use / foreign Paper running). |

The item datapack always has the same function id: `bhload:summon_items`.

---

## Prerequisites / fixed paths

| Component | Path |
| --- | --- |
| Node.js (v24.21.0) | `C:\Users\audim_r0h5i\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` (also returned by the `load_workspace_dependencies` tool) |
| `minecraft-protocol` 1.68.0 | `D:\Aegishider\itest\bot\node_modules` (pre-installed, `type: commonjs`). `load-bot.js` resolves it via `MC_PROTOCOL_DIR` or the absolute default path. |
| Java 21 | `C:\Users\audim_r0h5i\.jdks\jdk-21.0.13+9\bin\java.exe` |
| Paper 1.21.4 (read-only source) | `D:\Aegishider\itest\server\paper-1.21.4.jar` - copied once into `bench\load-server` if missing |
| Plugin jar (input, never modified) | `D:\Aegishider\dist\Aegishider-3.2.0.jar` (final build, preferred if present), else `Aegishider-3.1.0.jar`; the chosen file + SHA-256 are recorded per run |
| PacketEvents (read-only source) | `D:\Aegishider\itest\.cache\PacketEvents.jar` / `D:\Aegishider\itest\server\plugins\PacketEvents.jar`, copied into `bench\load-server\plugins` if missing |
| Existing RCON helper | `D:\Aegishider\itest\bot\lib\rcon.js` (`module.exports = { Rcon }`) |

The harness owns `D:\Aegishider\bench\load-server` (a disposable server root:
`paper-1.21.4.jar`, `eula.txt`, `plugins/PacketEvents.jar`, `world/`, etc.) and
logs there are not shared with the integration harness. It overwrites
`load-server\server.properties` at the start of a run and restores the previous
file after shutdown. It copies the chosen plugin jar from `dist` into
`load-server\plugins\Aegishider.jar` on every run (verified by SHA-256) and uses
`-Xms1G -Xmx2G` unless overridden.

**Only one Paper server may run at a time.** Preflight refuses to start (exit
code 2) when:

* TCP port 25600 or 25601 is already listening (it reports the owning PID but
  **never kills a foreign process**), or
* a `java.exe` process running `paper-1.21.4.jar` already exists (this protects
  the integration harness's 25599/25598 server too), or
* another `load-bench.js` run holds `bench/load-bench.lock`.

The same port checks run again during cleanup; ports are reported as
`cleanup.ports[port].free`. Any process still listening is only killed if it is
the exact Paper PID this run started.

---

## Exact commands

Run from any directory (all paths in the scripts are absolute):

```powershell
$N = 'C:\Users\audim_r0h5i\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# smoke tier
& $N D:\Aegishider\bench\load-bench.js --bots 10 --items 200 --label smoke10-200

# mid tier
& $N D:\Aegishider\bench\load-bench.js --bots 50 --items 1000 --label mid50-1000

# max attempt (only claim a pass if join >= 95%)
& $N D:\Aegishider\bench\load-bench.js --bots 200 --items 2000 --label max200-2000

# soak tier: 120 s of item churn (kill @e[type=item] + re-summon every 20 s)
& $N D:\Aegishider\bench\load-bench.js --bots 10 --items 200 --label soak10-200-120s --soak-seconds 120
```

Optional flags (defaults shown):

```
--soak-seconds 0              # soak duration; churn every --churn-interval-ms
--churn-interval-ms 20000
--sample-count 6              # baseline samples after warmup
--sample-interval-ms 10000
--warmup-ms 5000
--join-timeout-ms 180000
--stagger-ms 75               # delay between bot connects (spec: 50-100 ms)
--workers auto                # bot worker processes: 1 (<=100 bots), 2 (<=250), 3 otherwise
--xms 1G --xmx 2G
--server-port 25601 --rcon-port 25600 --rcon-password itest-rcon-pass
--server-dir D:/Aegishider/bench/load-server
--max-run-ms 1500000          # watchdog; emergency cleanup then exit 3
--paper-heap-probe            # opt-in, one-shot: run /paper heap after sampling
```

Output is printed as JSON lines during the run and stored in
`bench/load-<label>.json`. Exit codes: `0` success, `1` run failed (but cleanup
was attempted and partial evidence is still written), `2` preflight abort,
`3` hard-timeout watchdog fired.

The datapack can be regenerated standalone, e.g. to inspect it:

```powershell
& $N D:\Aegishider\bench\gen-datapack.js --items 2000
Get-Content D:\Aegishider\bench\load-server\world\datapacks\bhload\data\bhload\function\summon_items.mcfunction | Select-Object -First 3
```

---

## What a run does (phases in `load-console-<label>.log`)

1. **preflight** - ports/foreign-Paper/lock checks (see above).
2. **prepare** - copies `dist/Aegishider-3.1.0.jar` -> `plugins/Aegishider.jar`
   (SHA-256 verified), ensures `plugins/PacketEvents.jar`, rewrites
   `server.properties`: `online-mode=false`, `enforce-secure-profile=false`,
   flat world (`level-type`, existing world kept), `view-distance=4`,
   `simulation-distance=4`, `spawn-protection=0`, `difficulty=peaceful`,
   `allow-flight=true`, `enable-rcon=true`, `rcon.port=25600`,
   `server-port=25601`, `server-ip=127.0.0.1`,
   `max-players = max(bots + 10, existing)`, `network-compression-threshold=-1`,
   `rate-limit=0`, `player-idle-timeout=0`, `pause-when-empty-seconds=-1`.
   The previous file content is saved in the result JSON and restored afterwards.
3. **datapack** - generated **before server start**:
   `world/datapacks/bhload/pack.mcmeta` (`pack_format: 57`) and
   `data/bhload/function/summon_items.mcfunction` with exactly N summons:
   `summon minecraft:item <x> -59 <z> {NoGravity:1b,PickupDelay:32767s,Age:-32768s,Item:{id:"minecraft:diamond",count:1}}`.
   Layout (reported in the result JSON):
   * before summoning, stale item entities from previous runs are killed with
     `kill @e[type=minecraft:item]` and the remaining count is verified to be 0,
     so the measured field is exactly N entities (`itemsVerification.preExistingItems`);
   * x/z spacing is always within the required 0.5-1.5 block range;
   * `<= 841` items: one flat layer, spacing grows up to 1.5 for small fields;
   * larger fields: multiple horizontal layers 2 blocks apart in Y
     (starting `y=-59`, above the flat ground at `y=-61`) with 1.0 x/z spacing,
     keeping the footprint within ~+/-11 blocks of world spawn and avoiding
     item-entity merging.
4. **server start** - `java -Xms1G -Xmx2G -jar paper-1.21.4.jar --nogui`,
   wait for `Done (` in the log (timeout `--startup-timeout-ms`), then connect
   RCON.
5. **items** - `/datapack list` (must mention `bhload`), then
   `/function bhload:summon_items`, then
   `/execute if entity @e[type=minecraft:item,limit=1] run say ITEM_OK`
   (also greps the server log for `ITEM_OK` as fallback). Raw RCON output is
   recorded; the definitive entity *count* is Aegishider's `tracked=` value in
   the samples (plus `/execute if entity` output where it carries a count).
6. **bots** - spawns `load-bot.js` worker(s), connects N bots staggered by
   `--stagger-ms`, waits until `ceil(0.95*N)` bots reached spawn state
   (first play-state `position` packet) or `--join-timeout-ms`. Join latency is
   measured from client creation to spawn per bot.
   If the 95% target is not met, the run records one failure sample and exits 1 -
   **no load numbers are claimed for that tier**.
7. **samples** - 6 samples every 10 s after a 5 s warmup:
   `/mspt` (3 groups avg/min/max from last 5 s / 10 s / 1 m),
   `/tps`, `/aegishider diag` (Security tick last/avg/max, p50/p95/p99,
   overruns, engine last/max item+block work, raycasts/deferred, item engine
   tracked/revealedPairs/dirtyQueue/viewerIndexChunks/itemChunks/evals,
   block engine, discovery/resync, async queue, errors/config warnings,
   gateway counters, index counters), `/spark health` (TPS/CPU/used+max heap).
   Every raw RCON response is stored in `samples[i].commands`.
   Each sample also runs `/aegishider export` (3.2.0+) and captures the generated
   `plugins/Aegishider/diagnostics.json` snapshot in
   `samples[i].diagnosticsSnapshot` - this file is the source for
   `itemStormBatches`, `itemStormMaxDepth`, `unexpectedItemSpawnPacketsBlocked`,
   `chunkPassed` and the snapshot tick percentiles.
   Server OS metrics: CPU seconds + working set via `Get-Process`; JVM heap via
   `jcmd <pid> GC.heap_info` plus max from the `-Xmx` argument; host CPU via
   `os.cpus()` deltas. `/spark health` is not used: spark answers asynchronously
   and the RCON helper would drop the delayed reply.
   Server OS metrics: CPU seconds + working set via `Get-Process`; JVM heap via
   `jcmd <pid> GC.heap_info`; host CPU via `os.cpus()` deltas.
8. **soak** (optional) - every ~20 s:
   `kill @e[type=minecraft:item]` then `/function bhload:summon_items` again,
   while sampling continues. Each churn cycle's raw responses are stored in
   `soak.churnEvents`.
9. **cleanup** - kill the test item field, quit all bots (`{"cmd":"quit"}`),
   `/stop` via RCON, wait for
   the Paper process to exit, kill only our own leftovers, verify ports
   25600/25601 are free, restore the original `server.properties`, remove the
   lock. Cleanup runs on success, error, SIGINT/SIGTERM and the hard watchdog.

### Note on `/paper heap`

The task list asked to sample `/paper heap` and parse used/max MB "if output
available". On **Paper 1.21.4 `/paper heap` is a heap-*dump* command** (ported
from Sponge): it writes a `.hprof` file to disk, it does not print used/max MB,
and it is intended for the console. Running it every 10 s would create
multi-hundred-MB files and badly distort the measurement. The harness therefore
does **not** invoke it in the sampling loop; heap usage is measured honestly via:

* `/spark health` (bundled with Paper): TPS, CPU, used/max memory,
* `jcmd <pid> GC.heap_info`: JVM heap used/committed + metaspace,
* `Get-Process WorkingSet64/PrivateMemorySize64`.

`--paper-heap-probe` performs a single opt-in `/paper heap` after sampling and
records its raw response and any `.hprof` file it creates. Results record
`paperHeap.invoked=false` with the reason above.

---

## Reading a result JSON

Top-level keys:

| Key | Meaning |
| --- | --- |
| `env` | host/CPU/RAM/Node/Java, free RAM at start. |
| `server` | plugin jar source+target SHA-256, PacketEvents source, applied properties, startup time, log path, PID, Java args. |
| `datapack` | generated paths, command count, layout (cols/rows/layers/spacing/bounds), sample commands. |
| `itemsVerification` | `/datapack list`, `/function ...` response + duration, `ITEM_OK` check, `/execute if entity` output. |
| `join` | `reached`, `spawned`, `target`, `waitedMs`, `timedOut`. |
| `bots` | requested/spawned/percent, join latency min/median/p95/max, failures with phase+reason+kick text, per-worker details incl. stderr tail, final alive/spawned/failed/packets/bytes, per-bot status snapshot. |
| `samples[]` | baseline + soak samples: raw commands, parsed `mspt/tps/diag/sparkHealth/jvmHeap/serverProcess/hostCpuPct`, bot aggregate. |
| `soak` | seconds, churn cycles (raw kill/summon responses + durations), soak sample indices. |
| `summary` | aggregated stats (min/median/p95/max/avg) for MSPT, TPS, Aegishider tick/p50/p95/p99/tracked/evals/raycasts/errors, heap, host CPU, join data, soak trend. |
| `cleanup` | graceful stop results, port-free verification, whether `server.properties` was restored. |
| `limitations[]` | human-readable caveats recorded by the run (e.g. item check fallback, failed 200-bot tier). |

A tier is only **READY** when: `join.reached === true` (>=95% bots spawned),
`cleanup.portsAllFree === true`, samples were collected, and the raw numbers are
internally consistent (e.g. `trackedItems` close to `--items`).

---

## Reproducibility notes

* Fixed inputs: Paper 1.21.4 build, plugin jar from `dist` (SHA-256 in result),
  PacketEvents 2.14.0, `server.properties` values listed above, flat world
  (`generate-structures=false`, spawn-protection 0), same datapack bytes for the
  same `--items` value.
* All bot pacing/parameters are in `params` in the result JSON.
* Machine limits are real: this host is an **Intel i3-10105F (4 cores / 8
  threads, 16 GB RAM)** shared with other processes. The harness runs the Paper
  server and the bot worker(s) on the same machine, so at high bot counts the
  bot workers themselves consume a meaningful share of the CPU (measured host
  CPU is in every sample). Results are labelled with that caveat rather than
  extrapolated.
* The bot is intentionally lightweight: it does not write capture files, does
  not decode chunks beyond minecraft-protocol's normal packet parsing, counts
  packets/bytes/chunks/keep-alives in memory, and requests the same
  `viewDistance=4` the server is configured with.



---

## Measured results (this machine, 2026-11-14)

Environment: Intel i3-10105F (4 cores / 8 threads), 16 GB RAM, Windows 11,
Paper 1.21.4 build 232, Java 21.0.13, PacketEvents 2.14.0,
plugin under test **Aegishider-3.2.0.jar** (sha256
`cf3cc53e7529e35b7dbc801773eba3bf8c8d02dc7e0028cf89bbe3aa1191808c`,
6,797,418 bytes), isolated server dir `bench/load-server`,
ports 25601/25600, `-Xms1G -Xmx2G`. The machine is shared with the agent
runtime/other applications, and the bot workers run on the same host as the
server, so the host CPU column in each sample includes both sides of the load.

All four runs below: 100% of requested bots reached spawn state, the item field
was verified with `/execute if entity @e[type=minecraft:item]` returning exactly
`count: N`, `/aegishider diag` reported `tracked= N`, Aegishider errors remained
0, gateway stayed ACTIVE, and cleanup freed the ports + restored
`server.properties`.

| label | bots | items | bots spawned (final) | join latency median / p95 / max (ms) | tracked items | MSPT /mspt 5s avg | TPS (/tps 1m) | Aegishider tick p50 / p95 / p99 (us) | BH tick avg (us) | heap used (JVM) | server working set | itemStormBatches / maxDepth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| smoke10-200 | 10 | 200 | 10 (10) | 1436.5 / 1493.5 / 1520 | 200 | min 2.9, median 4.6, max 6.4 | 20.0 | 150-200 / 500-1100 / 2650-3200 | 274-634 | 398-762 MB / 2048 | 1467-1475 MB | (not exported in this early run) |
| mid50-1000 | 50 | 1000 | 50 (50) | 4812.5 / 5899.1 / 6056 | 1000 | min 10.6, median 11.3, max 14.2 | 19.1 | 250-450 / 800-1200 / 1650-2650 | 337-601 | 444-833 MB / 2048 | 1427-1443 MB | 2 / 512 |
| max200-2000 | 200 | 2000 | 196 at 95% cutoff (200 final) | 9024.5 / 12940.5 / 13747 | 2000 | min 58.3, median 64.2, max 119.9 | 16.2-17.3 | 400-500 / 1150-1300 / 3050-3100 | 536-674 | 500-805 MB / 2048 | 1429-1462 MB | 4 / 512 |
| soak10-200-120s | 10 | 200 | 10 (10) | 1726 / 2234.7 / 2250 | 200-201 | baseline median 3.4; soak median 3.3, max 3.9 | 20.0 | 150-250 / 450-900 / 950-3200 | 162-362 | 322-831 MB / 2048 | 1409-1442 MB | 1->9 / 200 |

Notes on the numbers:

* **200 bots is feasible on this machine but degrades server TPS to 16.2-17.3**
  (MSPT 5 s average median 64 ms) with 2000 dropped item entities tracked. The
  server survived the whole run: 200 bots were alive at the end, 0 bot failures,
  0 Aegishider internal errors, ports freed normally. Host CPU during the 200-bot
  tier was 50.8-81.2% (server + two bot worker processes on the same host).
* **50 bots / 1000 items already drops /tps to 19.1** (MSPT 5 s median 11.3 ms).
* The 10-bot runs stayed at 20.0 TPS; soak churn (6 x kill+summon of 200 items,
  all 6 cycles succeeded, 142-173 ms per re-summon) did not move MSPT/TPS
  (soak MSPT 5 s median 3.3 ms, max 3.9 ms; 20.0 TPS throughout).
* **itemStormBatches / itemStormMaxDepth** (from the plugin's own
  `plugins/Aegishider/diagnostics.json` via `/aegishider export`):
  2 / 512 at 50 bots/1000 items, 4 / 512 at 200 bots/2000 items (all 6
  samples), and in the soak run the batch counter grew 1 -> 2 -> 3 -> 4 -> 5 ->
  6 -> 9 with maxDepth 200 (one 200-item summon storm per churn).
  `itemEvaluations` stayed 0 while bots were idle and reached only 2 in the
  last soak samples; the storm batches are the observable item-engine work at
  these tiers (raycasts 0: no protected blocks near the item field).
* Heap: JVM used peaked at 833 MB of the configured 2048 MB max; process working
  set stayed ~1.41-1.48 GB. No OOM, no GC-driven tick spikes were observed
  beyond the initial join burst (tickMax 11.7-29.7 ms is a since-start maximum,
  not a per-sample maximum).
* Each sample stores the raw RCON output it was parsed from, including all
  `/mspt`, `/tps`, `/aegishider diag`, `/aegishider export` responses, jcmd heap
  info and the bot/packet counters. The `load-server-<label>.log` Paper log and
  `load-console-<label>.log` harness log sit next to the JSON.

Evidence files:

* `bench/load-smoke10-200.json` + `bench/load-server-smoke10-200.log`
* `bench/load-mid50-1000.json` + `bench/load-server-mid50-1000.log`
* `bench/load-max200-2000.json` + `bench/load-server-max200-2000.log`
* `bench/load-soak10-200-120s.json` + `bench/load-server-soak10-200-120s.log`

Known limitations of this measurement (not hidden):

* Server and bot clients share one 4-core/8-thread machine; high-tier numbers
  include client-side CPU/memory contention. Absolute values would improve on a
  dedicated server host.
* The flat test world's spawn area was already generated; startup took
  21-25 s for warm runs and 100 s for the first cold run in the fresh
  `load-server` directory.
* Bots are idle (no movement/chat/inventory); the load is player-count +
  chunk streaming + dropped-item tracking, not a gameplay simulation.
* Soak observed `trackedItems` 201 in its last two samples (one extra tracked
  entity across 6 kill/summon churn cycles); recorded as measured, not
  suppressed.
