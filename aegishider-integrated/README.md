# Aegishider 4.0.5

Server-side **anti-ESP / anti-base-ESP / anti-storage-ESP** for **Paper 1.21.1 – 26.3**
(Java 21; Paper 26.x runs on Java 25). Protected data is removed from outgoing packets
before a client can receive it, and item/entity visibility uses Paper's native per-player
visibility API.

Security model: **fail-closed on every path the plugin controls**. Errors, unknown worlds,
stale state, timeouts and queue pressure keep protected data hidden. The packet layer needs
PacketEvents 2.14.0+: without it the plugin still loads, but the packet path is reported
**INACTIVE** in `/aegishider status` and the plugin does not claim fail-closed for hides that
only the packet layer can perform — install PacketEvents and restart to activate it. The
licence is a separate product gate (see below).

---

## Download and licence activation (required by default)

The shipped `platform.yml` uses `enforcement: enforce`. The plugin loads and exposes its
commands, but **protection stays disabled until this server is activated on the platform**:

1. Put the matching `Aegishider-4.0.5-mc<version>.jar` and **PacketEvents 2.14.0+** in `plugins/`.
2. Start the server. Protection is intentionally inactive.
3. Run `/aegishider license link`; the server registers an Ed25519 installation identity
   and prints a 16-character activation code plus the portal URL.
4. Sign in (free account) at the **Aegishider Control Platform** — website alias
   `https://aegishider-platform.audijuju1.workers.dev` (the API base is
   `https://aegishider-platform.audijuju1.workers.dev`) — open **การเปิดใช้งาน** and enter the code.
5. Run `/aegishider license refresh`, then `/aegishider status`; `protection` must be `ACTIVE`.

The platform is free. Leases are Ed25519-signed, refresh in the background and use a 72-hour
offline grace. If the platform is unreachable at first start the plugin cannot activate and
protection stays off; that is deliberate. Server owners who do not want the gate can set
`enforcement: warn` (or `enabled: false`) in `plugins/Aegishider/platform/platform.yml`.

## Builds (separate jars)

| Jar suffix | Compiled against | Recommended for |
|---|---|---|
| `mc1.21.1` | paper-api 1.21.1 | Paper 1.21.1–1.21.4 |
| `mc1.21.4` | paper-api 1.21.4 | Paper 1.21.4 (full A–F harness build) |
| `mc1.21.5` | paper-api 1.21.5 | Paper 1.21.5–1.21.8 |
| `mc1.21.11` | paper-api 1.21.11 | Paper 1.21.9–1.21.11 (recommended 1.21.x) |
| `mc26.1` | paper-api 26.1.2 | Paper 26.1.x |
| `mc26.3` | paper-api 26.3 | Paper 26.2–26.3 |

Each jar is compiled against its target API and carries a generated `build.properties`
stamp (`target`, `paper`). `plugin.yml` keeps `api-version: '1.21'`, which Paper 26.x accepts.
Folia is not supported. PacketEvents 2.14.0+ is required for block/container protection;
without it the plugin still protects entities/items but block protection is reported
`INACTIVE` (never a send-then-patch fallback).

### Upgrading from 4.0.3

`config.yml` is never rewritten on upgrade. Add the new base blocks from the shipped
`hidden-blocks` list (pistons, bookshelf, workstations, anvils, cauldrons, redstone),
set `y-shield.enabled: true` with `real-chunk-radius: 0`, and set
`item-protection.mob-melee-visible-distance: 3.0`. If your existing config contains
`hide-all-living-entities: false`, that explicit opt-out is kept; remove it or set it to
`true` to hide animals and villagers like the new default. Alternatively, back up your
config and delete it once to let 4.0.5 write the new secure defaults.

## 4.0.5 performance hardening

- **Bounded entity work.** Periodic safety sweeps are queued and processed at most
  32 entities per tick instead of hiding a whole chunk synchronously. Position polls are
  capped at 256/tick, evaluations at 256/tick, and the time budget is checked every four
  evaluations instead of every 16-32.
- **Bounded block work.** Reveal checks are capped at 128/tick (24 during the join ramp),
  the candidate rebuild checks the tick budget per chunk, and out-of-range re-hides check
  the budget every 16 markers.
- **Bounded packet maintenance.** The packet-detected block bridge drains at most 512
  positions per tick, pending entity registrations 64, dropped-chunk resends 32, and
  Y-shield chunk refreshes 4 per tick.
- The visibility policy and fail-closed behaviour are unchanged. Work is deferred, never
  skipped in the unsafe direction; a deferred item/block stays hidden.

## 4.0.5 entity visibility defaults

- **Monsters and animals are hidden by default.** `item-protection.hide-all-living-entities`
  now defaults to `true`. Cows, pigs, sheep, horses, wolves, villagers, golems and allays
  use the same distance/Y/occlusion policy as hostile mobs; a config with no `worlds`
  section gets this automatically, and an explicit `hidden-entity-types` list does not
  turn it off.
- **Hard 3-block interaction floor.** A living entity within 3 blocks on the viewer's own
  visible floor is always shown, even through a wall, so farms, pens and trading halls keep
  working. `item-protection.mob-melee-visible-distance` (default 3.0) is an additional
  close-range allowance up to 4 blocks; it cannot lower the built-in floor.
- **Distance and Y still apply.** Living entities are never revealed beyond
  `monster-max-distance` (96), below `y-shield.hide-below-y` for a masked viewer, or across
  the `entity-height-shield` floor band. Set `hide-all-living-entities: false` to keep
  animals and villagers visible; hostile mobs remain covered by the explicit list.

## 4.0.4 base-block and Y-shield changes

- **The full base-defining block set is hidden by default.** Piston, sticky piston, piston
  head, bookshelf, crafting/cartography/fletching/smithing tables, loom, stonecutter,
  grindstone, all three anvils, observer, target, composter, daylight detector, all
  cauldrons, respawn anchor, bell, lodestone and beacon join the storage tiles. Note block
  and jukebox remain opt-in so public music/redstone builds do not turn into stone.
- **Stationary pistons and workstations now have a real discovery path.** They have no
  block entity, so they are handled by the palette-prefiltered block-state scan (the same
  path as bookshelf), registered on placement and detected from outgoing chunks. A
  piston/bookshelf behind any number of solid blocks stays hidden; line of sight is still
  required before the 24-block reveal can show it.
- **Y-shield is on by default and covers every chunk.** While a viewer's eye is at least
  2 blocks above `hide-below-y` (default 40), every block below the line is replaced with
  stone, including the air inside cave rooms, not just the containers. The straddling
  section is edited layer by layer so surface terrain above the line is preserved.
  `real-chunk-radius: 0` means even the viewer's own chunk is masked; a positive value
  restores the old nearby-real behaviour.
- **The underground is consistently suppressed above the line.** Block changes,
  multi-block changes, block-entity data, block actions, break animations and tracked
  entities below the line are filtered for that viewer, so a chest opening, piston or
  falling item cannot announce a base through the filler.
- **Crossing the line re-sends chunks.** A viewer who descends into a cave/base gets the
  real world back; ascending re-masks it. The re-send is spread across ticks to avoid a
  teleport-time spike. The bypass permission refresh also re-filters a client that was
  previously bypassing.
- **`BEACON` and `BOOKSHELF` are back in the default hidden set.** Servers with public
  spawn landmarks can remove them from `hidden-blocks`; they remain visible within the
  normal 24-block reveal radius and with clear line of sight regardless.
- **Living-mob wall check (light-medium).** Monsters, animals and villagers require a
  real line of sight beyond the built-in 3-block interaction floor. A cow or zombie
  directly behind a solid wall is hidden beyond 3 blocks, while a fence, glass pane, bars,
  or a head peeking over a ledge still shows it. `item-protection.mob-melee-visible-distance`
  (default 3.0, range 0-4) is an additional close-range allowance and cannot reduce the
  hard floor. The check samples the body centre and the head; there is no extra raycast
  tax for far mobs beyond the existing occlusion pass.

## 4.0.0 behaviour changes

- **Public landmarks.** 4.0.0 made `BEACON` and plain `BOOKSHELF` opt-in; 4.0.4 puts them
  back in the default base set together with pistons, workstations, anvils and redstone
  components. Servers with a public spawn beacon or library should remove those entries
  from `hidden-blocks`. Plain `BOOKSHELF` and the other non-tile-entity base blocks use the
  palette-prefiltered state scan. Anvils and other non-tile-entity workstations are no
  longer rejected: they are state-scanned and can be hidden reliably.
- **Ghost blocks fixed.** Breaking a hidden container while it was rendered as filler used
  to have the air update rewritten back to the filler, so the block “came back” forever.
  Air removals are now passed through; Tunnel Shield still masks its own dug-block updates.
- **Monsters are occlusion-only by default.** Hostile mobs are hidden only when a wall,
  terrain or underground blocks the line of sight. Field of view and distance no longer
  hide monsters (distance cap 96 blocks, beyond normal entity tracking), so turning around
  no longer makes mobs pop in/out. Items, item frames, armour stands and storage minecarts
  keep the strict distance + line-of-sight policy. Configure with
  `item-protection.monster-occlusion-only` / `monster-max-distance`.
- **FOV is disabled by default (360°).** A third-person front view (F5 twice) legitimately
  shows the world behind the player, and fast turns made narrow 120°/130° cones hide
  blocks/items that were visibly on screen. Set `fov-degrees: 180` to keep a front-hemisphere
  gate, or 120/130 for the old strict behaviour with that known trade-off.
- **Block reveal distance 12 → 16 → 24 blocks.** Fewer close-range pop-in moments; everything
  beyond 24 blocks is still replaced before it reaches a client, and line of sight is still
  required.
- **Raycast budget is per tick again.** It is reset every security tick (180 rays/tick by
  default), not once per second; this fixes fake nearby blocks and invisible mobs under load.
- **Viewer join/move sweep now covers the monster band.** A new or teleported viewer marks
  living mobs dirty out to `monster-max-distance` (96), not just the 24-block item distance;
  a stationary mob at 24-96 blocks no longer stays invisible until it moves. Items, item
  frames, armor stands and minecarts keep the 24-block sweep.
- **Teleports explicitly hide previously revealed entities.** A same-world teleport does
  not clear the client entity list, so the old marker-only reset could leave a mob from the
  previous floor visible. Revealed entities are now hidden before their markers are cleared
  and then re-evaluated at the new position.
- **Licence gate** with a persisted signed lease, pinned platform key, server-side release
  hash reporting, a monotonic server-time high-watermark (clock-rollback guard) and a
  periodic entity sweep for spawn paths that bypass Bukkit's spawn events. A missing or
  corrupt `platform.yml` now fails closed instead of silently disabling the gate; JVM
  debugger/agent detection is advisory and is reported as a security event instead of
  killing protection on profiled hosts.

## What it protects

- Dropped items, item frames, armour stands, storage minecarts and all living entities
  (monsters, animals, villagers, golems...). `hide-all-living-entities` defaults to true;
  their visibility follows distance/Y/occlusion with the hard 3-block interaction floor.
- Configured tile-entity blocks (chests, barrels, shulkers, hoppers, furnaces, dispensers,
  spawners, trial spawners, vaults, ...) discovered from real chunk data.
- Tunnel / dug-hole shield (defaults off): player-mined blocks beyond 28 blocks are shown
  as their original material; walking close reveals the real tunnel.
- Full Y-shield (default on, `hide-below-y: 40`): surface viewers receive stone for the
  complete underground volume, not only for containers. Descending below the line restores
  the real chunks.
- Player vertical height shield (default on) plus an opt-in same-floor distance shield
  (`player-protection.distance-hiding`, default off).

Server-side gameplay is unchanged: pickups, merging, physics, despawn timers, containers
and item stacks behave like vanilla. Hidden items can still be picked up.

## Player-fair defaults (4.0.4)

- **FOV is disabled (360°)** so F5 front view and fast turns never hide something that is
  visibly on screen.
- **Height shield has a 12-block dead band** around `underground-y`: a deep base is still
  hidden from the surface, but two players at y=40/y=70 across a ravine or mineshaft stay
  visible when they can actually see each other.
- **Base blocks are hidden, public landmarks can be opted out.** `BEACON`, `BOOKSHELF`,
  pistons, workstations and redstone components are in the default set. Spawn hubs and
  libraries can remove those entries from `hidden-blocks`; anything close and unobstructed
  is still shown by the reveal policy.
- **Y-shield starts 2 blocks above the line** so the viewer's own feet and body space stay
  real; the line is absolute Y, so choose a value below normal surface terrain (40 by
  default, raise it for a deep cave base).
- **Ray budget reserves a third of the pool (max 60) for entities/items**, so a dense
  storage room cannot starve a dropped item next to the player.
- **Player shield gets 15% of the tick budget** (was 7.5%) so a 50-player sweep does not
  fall several ticks behind.
- Living mobs (monsters, animals and villagers) are occlusion-only with the hard 3-block
  interaction floor; player distance hiding is off and Tunnel Shield is off by default.
  Existing world sections can override any of these per world, including
  `hide-all-living-entities: false` to keep animals/villagers visible.

## Commands / permissions

`/aegishider status|diag|viewer|export|deep|stats|verify|rescan|reload|license|help`
(alias `/ah`). Permissions: `aegishider.admin`, `aegishider.admin.license`,
`aegishider.admin.diagnostics`, `aegishider.bypass` (not granted to OPs by default).
Commands other than status/license/help are refused until protection is activated.

## Licence gate (strict)

- `platform.yml` defaults to `enforcement: enforce`; a missing/corrupt config or a failed
  platform service fails closed, not open.
- Protection cannot start without a signed lease: `enableProtection()` checks
  `protectionAllowed()` and the security tick re-checks it every five seconds. A single
  patched boolean is not enough to unlock visibility.
- A verified lease is cached on disk with a monotonic server-time high-watermark. A
  restart during a platform outage keeps protection for the 72-hour grace; a rolled-back
  clock is rejected; expiry beyond grace disables protection.
- Verified live on Paper 1.21.11 (Java 21) and Paper 26.3 (Java 25) with PacketEvents
  2.14.0: before activation `protection=WAITING_FOR_LICENSE`, after activation
  `gateway=ACTIVE` and `protection=ACTIVE`.

## Server health heartbeat (4.0.3)

Every heartbeat now carries two optional, strictly bounded objects in addition to the
existing metrics:

- `server` — TPS (1/5/15 min), average MSPT, players/max, average ping, world summaries
  (name, environment, players, loaded chunks, entities), heap used/committed/max, process
  and system CPU, load average, processors, GC count/time, thread counts, uptime, disk
  usable/total, server version, Java/OS, plugin count and PacketEvents version.
- `aegishider` — protection/gateway/block/item state, tracked entities, protected blocks,
  sensitive chunks, viewer sessions, plugin tick p50/p95/p99, overruns, raycasts/deferred,
  async queue, internal errors, config revision, licence state and lease source/expiry.

The values are aggregates from a main-thread sampler (30 s); no player names, UUIDs, IPs,
chat or coordinates are sent. The admin server page renders a health dashboard with
alerts (TPS/MSPT/heap/CPU/disk/gateway/licence) and 5-minute trend charts. Older plugin
builds remain compatible; only the deep section is absent.

## Release protection layers

There are two build paths:

- **Signed release** — the Sentinel Shield pipeline (`scripts/release.sh`) when the
  release private key and Sentinel venv are available. It adds Ed25519-signed per-entry
  manifests on top of the hardening steps below.
- **Local hardened build** — `scripts/harden-local.sh`, which needs only JDK 21/25, Maven,
  ProGuard 7.10 and ASM. It produces the same six obfuscated jars plus `SHA256SUMS`.

Both paths apply:

1. ProGuard 7.10 rename (105 classes / 600+ fields / 900+ methods), source/line/local
   variable stripping, and `-dontusemixedcaseclassnames` so Windows extraction cannot
   collide.
2. String-constant encryption for the ~105 plugin classes (ASM; FastUtil skipped).
3. `Record` attribute removal (component names no longer readable).
4. `META-INF/maven/**` and signature metadata removed from the shaded jar.
5. Per-build `build.properties` stamp (the six jars are not byte-identical).
6. Ed25519 per-entry signed manifest (sidecar `.sentinel.json`; signed Sentinel pipeline only).
7. Secret scan of the input/output jar (release pipeline).
8. Runtime anti-debug advisory: JDWP, `-Xdebug`, `-agentlib`, `-javaagent` and JMX remote
   are logged and reported to the platform, but protection stays active so a profiler on a
   legitimate host cannot silently expose every base.
9. Pinned platform Ed25519 key (`prod-1`, SPKI SHA-256 `7ba972af…`) so a rogue platform
   response cannot mint a trusted lease.
10. Server-side release verification: the plugin reports its actual jar SHA-256 on every
    heartbeat; the platform compares it to published release records.
11. Licence gate + Ed25519 installation identity, lease, refresh and offline grace.
12. Fail-closed packet/visibility paths and the periodic entity safety sweep.

These are real, testable layers — not “200 arbitrary transformations”. Client-side code can
never be made impossible to reverse; the goal is raising cost and detecting unlisted builds.

## Build / release

Requirements: JDK 21 and JDK 25, Maven 3.9+, ProGuard 7.10+, ASM 9.8. The signed Sentinel
pipeline additionally needs its venv and an Ed25519 release key outside the repo.

```bash
cd aegishider-integrated
mvn -B test                                  # 179 tests
mvn -B -Pmc1211 -Dmaven.test.skip=true package

# local hardened build: all six profiles + string encryption + ProGuard + SHA256SUMS
JAVA21_HOME=... JAVA25_HOME=... MVN=... PROGUARD_JAR=... ASM_JAR=... \
  STRINGCRYPT_CLASSES=... bash ../scripts/harden-local.sh
# artifacts: dist/obf/Aegishider-4.0.5-*.jar + dist/obf/SHA256SUMS
# or run the whole matrix + string encryption + ProGuard + manifests:
cd ..
SENTINEL_PY=/d/sentinel-shield/.venv/Scripts/python.exe bash scripts/release.sh
```

Artifacts: `dist/plain/` (plain), `dist/pre/` (string-encrypted), `dist/obf/` (final,
obfuscated; signed manifest sidecars only when using the Sentinel pipeline) and
`dist/obf/SHA256SUMS`. Private keys live in `.release/keys/` and are never committed.

## Verification snapshot

- 179 unit tests, 0 failures (1 POSIX-only test skipped on Windows).
- A–F packet harness PASS on Paper 1.21.4 (plain and ProGuard-obfuscated jar); the same
  harness detects A/C/D/E/F leaks in the legacy BaseHider 3.0.0 baseline.
- 4.0.4 live verification: Paper 1.21.11 (Java 21) and Paper 26.3 (Java 25) with
  PacketEvents 2.14.0 and the obfuscated jars. Both start `protection=WAITING_FOR_LICENSE`,
  restore the cached signed lease after activation/restart, then report
  `gateway=ACTIVE` on `V_1_21_11` / `V_26_3` and `protection=ACTIVE`.
- Real-server behaviour test: an open zombie behind the player's back stays visible while a
  zombie behind a wall is hidden; a filler block that is mined becomes air (no ghost loop).
- 4.0.4 packet-level Y-shield test on Paper 1.21.11 + PacketEvents 2.14.0: a 1.21.4 client
  at y=78 received 213/213 checked chunks with every block below y=40 replaced by stone;
  a spectator moved to the base received 238 real chunks with 0 hidden block states and
  0 hidden block entities. This exercises the obfuscated hardened jar, not the plain build.
- Licence gate test: with no lease, `protection=WAITING_FOR_LICENSE`, gateway `NOT_STARTED`.

## Known limitations

- The licence gate needs one successful online activation. A verified lease is cached on
  disk, so restarts during an outage keep protection for the 72-hour offline grace; a
  clock rollback is rejected and expiry beyond the grace disables protection until the
  server reconnects.
- The platform signing key is pinned; key rotation requires a plugin update or an additional
  `trusted-key-sha256` in `platform.yml`.
- String encryption hides literals but the embedded decoder key can be recovered by a
  determined reverse engineer; server-side SHA reporting is the detection layer.
- Tunnel history is memory-only; explosions/pistons are not tracked; bypass players see the
  real world. Player-vs-player hiding is opt-in and has the documented team/combat rules.
- Paper's plugin remapper and future Minecraft protocol changes can require a new build.
