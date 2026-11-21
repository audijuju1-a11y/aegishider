# Design proposal — contextual filler, Y-level shield, cave/tunnel hiding

Status: **design/ brainstorm only** (not implemented yet). This file records the problem
analysis, options, recommended phasing and the questions that need product decisions before
code is written. The reveal/ghost-block bug fix (3.3.8) is separate and already verified.

## 1. Problems to solve

1. **Stone filler is conspicuous**: a chest sitting on grass becomes a floating stone
   block above the ground; inside walls stone may also be wrong. Filler should look like
   the surrounding material (air/grass/dirt/stone/deepslate/wall material).
2. **Y-level look-down protection**: players/cheats looking down from the surface should not
   receive cave/base geometry below a configured Y (or should receive solid filler), while
   legitimate players who go underground must still see the real world.
3. **Natural cave hiding**: caves, tunnels and underground rooms below the surface must not
   be visible from above; potentially also hide cave entrances from distant clients.
4. **Player-dug hole/tunnel hiding**: blocks mined by players (which become air) should not
   reveal the base layout to distant clients; near players must still see the real tunnel.

## 2. Contextual filler (recommended phase 1, low risk)

### Approach
- New config: `block-protection.replace-with: CONTEXTUAL` (also accept `AUTO`).
- On discovery (main thread) a `FillerChooser` picks a Material per protected position:
  1. If the block above is non-solid and the block below is solid (surface-placed chest):
     use **AIR** — the chest was occupying air, so nothing appears; no floating block.
  2. Otherwise count the six neighbours that are solid and not themselves hidden:
     - no solid neighbour → AIR;
     - else most frequent solid neighbour material (tie → the one below).
  3. Never choose a configured hidden material (avoid revealing another container's shape).
- Store `pos -> Material` in `HiddenBlockIndex` (per-world nested concurrent map; purge on
  unregister/evict).
- Packet path: `ChunkSanitizer`/block-change/multi-block-change use the per-position material
  converted to a server-format state id (existing `PacketMaterialCache`, `V_1_21_4`).
- `BlockShield.hide()` re-sends the same contextual filler, so leaving the reveal radius
  returns to the same natural-looking filler.
- Fall back to `STONE` for positions detected only at packet time (TE scan) before the main
  thread has a material; after discovery the next chunk send uses the contextual one.

### Why this is safe
- No change to server-side blocks/gameplay; only client display.
- Per-position map is bounded by the protected block count (hundreds/thousands).
- The reveal policy and raycast fix stay unchanged.

### Open choices
- AIR for surface containers vs a soil block (AIR is most natural for a chest placed on
  grass; a soil block may look like terrain). Recommend AIR.
- Should filler matching include the block **above** (e.g., for a chest under a roof)?

## 3. Y-level look-down shield (recommended phase 2)

### Options
| Option | How | Pros | Cons |
|---|---|---|---|
| A. Static mask below Y | For every chunk sent to a viewer **above** Y, replace all sections below Y with stone/air and strip TEs | Strong; simple; hides caves + bases from cheats | When the viewer descends below Y they see fake blocks; needs a resend/reveal strategy |
| B. Per-viewer dynamic mask | Mask only sections below `viewerY - depth`; on Y crossing, resend/reveal affected sections | Correct for legit cave players | Needs chunk resend/section reveal machinery; higher complexity |
| C. Distance-only underground mask | Mask below surface only in chunks **beyond N blocks** horizontally; nearby chunks real | Gameplay-safe (nearby caves work), hides far bases/caves from ESP | Cheat near the base can still see the local area; not a full Y shield |

Recommended **phase 2 = C** (safe), then optionally A/B for strict servers:
- `y-shield.enabled`, `y-shield.mode: DISTANCE_ONLY|ALL`, `hide-below-y` (default e.g. 40),
  `chunk-radius-real` (e.g. 4), `filler` (STONE/AIR), `exclude-worlds`.
- When a chunk is rewritten: replace hidden sections' block states with filler, drop block
  entities in them; keep surface sections intact.
- Player crossing Y: if mode=ALL, force a chunk resend (PacketEvents wrapper) or reveal
  sections via block-change batches within a radius; start with DISTANCE_ONLY to avoid this.
- Heightmaps must be recomputed/left consistent; tested with both native 1.21.4 and
  ViaVersion 26.x clients before enabling.

## 4. Natural cave hiding

- With a Y shield, natural cave air/ores below the mask become stone/air → caves disappear
  from the surface view.
- Stronger mode: detect **cave entrances** (air columns from surface downward) and mask them
  for distant clients; near players reveal the real entrance. This is expensive and should
  wait until the Y shield is verified.
- Alternative "cave-only" mode: mask all air below `surfaceY - 8` while viewer is above
  `surfaceY`; requires per-chunk surface height (heightmap) and per-viewer mask. Phased after
  Y shield.

## 5. Player-dug tunnel/hole hiding

### Approach
- Record `BlockBreakEvent` (and explosion/piston-caused air where feasible) with:
  original block state, position, timestamp, world.
- Bounded history: e.g. `max-entries: 50000`, `expiry-hours: 48`, per-world.
- In chunk/ block-change sanitization for a viewer:
  - if the viewer is **far** from the dug position (e.g. > `hide-radius: 24`) and the player
    is above surface, send the **original block instead of air** (and mask the resulting
    cave/tunnel geometry) so a distant cheat sees solid terrain;
  - when the viewer comes within radius or has line of sight, send the real air via
    block-change/resync; re-mask when leaving.
- This is display-only; mining/physics remain server-side.
- Risk: legitimate players may see "ghost" solid blocks in tunnels until they are near
  enough; tune radius (24–40) and add `reveal-on-line-of-sight`.
- Needs packet-level test with two clients (digger + observer) before enabling.

### Config sketch
```yaml
block-protection:
  replace-with: CONTEXTUAL
  y-shield:
    enabled: false            # phase 2
    mode: DISTANCE_ONLY
    hide-below-y: 40
    chunk-radius-real: 4
    filler: STONE
  tunnel-shield:
    enabled: false            # phase 3
    hide-radius: 28
    max-tracked-breaks: 50000
    expiry-hours: 48
    reveal-on-line-of-sight: true
```

## 6. Verification plan (before enabling on the real server)

1. Unit tests: filler chooser (surface/wall/cave cases), Y-section masking bounds,
   tunnel history expiry/limit, config parsing.
2. Packet-level harness (Paper 1.21.4 + ViaVersion 26.x client):
   - place chests on grass/in wall/in cave → client chunk shows chosen filler, no TE;
   - Y-shield: bot above Y receives masked sections, bot below Y receives real sections;
   - tunnel: digger mines a tunnel, observer client far away sees solid terrain; observer
     close sees real tunnel.
3. Real-server A/B test with the cheat client before enabling; keep debug counters:
   `yShieldSectionsMasked`, `tunnelBlocksMasked`, reveal counts.
4. Performance: mask only chunk sends (no per-tick world scans); tunnel history is a bounded
   map; measure `/mspt` impact at 50 bots/1000 items with the existing load harness.

## 7. Decisions needed from the owner

1. Contextual filler: **AIR for surface containers** or a soil block? (recommend AIR)
2. Y shield scope: `DISTANCE_ONLY` (safe default) or `ALL` (strict; players entering caves
   need dynamic resend)?
3. Y threshold per world (e.g. overworld 40, nether 32, end none)?
4. Tunnel shield: hide player-dug holes from **all other players** or only beyond a radius?
   Reveal by radius only, or radius + line of sight?
5. Are player entities (player ESP) in scope? Currently intentionally not hidden.
