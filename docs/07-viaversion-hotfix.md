# Incident 2026-11-15 — ViaVersion / PacketEvents state-id hotfix (3.3.3–3.3.5)

This document records a **confirmed production bug** found on the real server and the fixes,
with the local packet-level reproduction used to verify them. It is written to be auditable:
every claim below is backed by a log/capture in `docs/evidence/`.

## 1. Reported symptoms (real server)

- Chest/base storage ESP still worked on a real cheat client even though Aegishider reported
  `chunkSanitized > 0`.
- **Ghost blocks / disappearing blocks** appeared instead of a clean filler block.
- Monster/entity ESP still worked at distance.
- Items thrown by the player were visible via ESP at any distance (`owner-grace` was
  unbounded).

## 2. Root causes found

### 2.1 ViaVersion clients: state ids resolved against the CLIENT protocol version

Real server setup: Paper **1.21.4** + PacketEvents **2.14.0** + ViaVersion **5.12.2**, client
protocol **V_26_3 / V_26_1** (newer client translated down to 1.21.4).

The outgoing chunk/block packets are encoded in the **server** protocol version (1.21.4),
even for a ViaVersion client. The gateway was using `event.getClientVersion()` (V_26_x) as
the version for:

- `PacketMaterialCache.typeName(...)` / `fillerStateId(...)`, and
- block-change / multi-block-change state id resolution.

PacketEvents has block-state mappings for **different protocol versions with different state
ids**. Resolving 1.21.4 state ids against a 26.x mapping produces:

- protected blocks (chests/barrels/shulkers) not recognised as hidden → real block found by
  the cheat client's storage ESP;
- a wrong/air filler state id → **blocks disappear / ghost blocks**;
- block update fakes use the wrong state → ghost/visual corruption.

### 2.2 Block-entity data leaked in the chunk packet

Same root cause: the chunk's block-entity list/tile-entity removal depends on correct state
recognition. A local reproduction (see §4) showed the 26.1 client receiving the chunk with
`blockEntities=3` for three protected containers before the fix, and `blockEntities=0` after.

### 2.3 Entity spawn race for non-item entities

The server tracker can emit a `SPAWN_ENTITY` packet for a newly spawned entity **before**
the main-thread `EntitySpawnEvent` handler registers/hides it. Items were covered by the
existing untracked-item fail-closed path, but armour stands / chest minecarts / monsters
could leak their spawn packet in that race window. The packet filter now fails closed for
**any untracked spawn whose entity type is configured as hidden**; when the main thread
registers it and proves visibility, `showEntity` sends the spawn again.

### 2.4 Monsters were never configured as hidden

The default `hidden-entity-types` list contained only `ITEM`. Mob ESP therefore worked by
design because the server sent the mob normally. The default list now covers hostile mobs,
item frames/glow item frames, armour stands and storage minecarts (players, villagers and
passive animals remain opt-in).

### 2.5 Unbounded owner grace

The thrower was shown their own item **at any distance, forever**. Owner grace is now bounded
to **8 blocks or 40 ticks (2 s) after spawn**; after that the normal distance/FOV/occlusion
policy applies.

## 3. Fixes shipped

| Version | Change |
|---|---|
| 3.3.3 | All chunk/block state-id ↔ material resolution and the filler id now use the **server protocol version (1.21.4)** via `PACKET_FORMAT_VERSION`; debug log of sanitize decisions + actual client version. |
| 3.3.4 | Early-spawn fail-closed filter for untracked hidden entity types (armour stands, minecarts, monsters); bypass-viewer exempt; metric `earlyEntitySpawnBlocked`. |
| 3.3.5 | Debug entity type-id→name logging (used to prove `type 28=cow`, `104=sheep`, `24=chest_minecart`), final verified build. |

Additional real-server config changes (documented, backed up):

- `hidden-entity-types` expanded to the hostile/vehicle/frame list.
- `item-protection.reveal.max-distance` 32 → 16.
- `raycast-budget-per-tick` 300 → 180 and `reconcile.chunks-per-second` 40 → 20 (reduce
  main-thread spikes; both are documented tunables).
- `log-blocked-packets: true` temporarily for verification (set back to false after tests).

## 4. Local packet-level reproduction (isolated server, ViaVersion installed)

Harness: `bench/via-test-bot.js` + `bench/via-test-run.js`; a headless client connects with
`version=26.1` (ViaVersion translates to server 1.21.4). Three containers were placed in
chunk 0,0 before joining.

### Before fix (3.3.2, `docs/evidence/via-v332-client26.log`)

```
CHUNK_INFO {"x":0,"z":0,"blockEntities":3,...}
```
→ the 26.1 client received all three protected containers' block entities.

### After fix (3.3.3+, `docs/evidence/via-v333-client26.log`, `via-v335-client26.log`)

```
server: Chunk sanitize: client=V_26_1 chunk=0,0 changed=3 detected=3 tileEntitiesRemoved=true
client: CHUNK_INFO {"x":0,"z":0,"blockEntities":0,...}
```
→ protected container block states replaced with the correct 1.21.4 stone state and all
block entities stripped **after ViaVersion translation**.

Entity checks in the same run:

```
Entity spawn decision: entityId=21 typeId=24 type=minecraft:chest_minecart
    tracked=false hiddenSpawn=true cancelled=true
```
→ chest minecart spawn correctly blocked despite the registration race; no `ENTITY_SPAWN`
for hidden zombie/item/armour-stand in the 26.1 capture.

Native 1.21.4 control and the full E2E harness on 3.3.5: **PASS**
(`docs/evidence/itest-3.3.5.log`).

## 5. Residual / next steps

- User must verify on the real cheat client against the running server (port **25566** while
  another test server occupies 25565).
- `players` are still not hidden (deliberate; team/combat policy).
- If a cheat client uses a **legacy ViaVersion pipeline order** different from the tested
  2.14.0 + ViaVersion 5.12.2 combination, re-run the ViaVersion harness before changing
  PacketEvents/ViaVersion versions.
- Performance: debug packet logging can be noisy; disable `debug.log-blocked-packets` after
  verification.
