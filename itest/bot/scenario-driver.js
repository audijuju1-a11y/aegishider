#!/usr/bin/env node
'use strict'
/**
 * Aegishider end-to-end scenario driver.
 *
 * Boots the dedicated Paper 1.21.4 test server (server/), connects two headless
 * capture bots (bot/capture-bot.js), creates fixtures over RCON, records all
 * packets, and evaluates six scenarios:
 *
 *   A. hidden dropped item  - item far away behind solid blocks must NOT be sent
 *   B. visible dropped item - item ~3 blocks in front must be sent within 3s
 *   C. chunk block hiding   - player-placed chest inside a stone room must not be
 *                             present in level_chunk_with_light chunk data after a
 *                             forced chunk resend (palette decoder verifies)
 *   D. far-band BE leak     - chests in chunks 160 and 336 blocks away must not
 *                             appear as block states OR block entities, while a
 *                             sign in the same chunks proves the chunk arrived
 *                             (the "DonutSMP 140-340 blocks" leak class)
 *   E. pie-ray registry     - across the whole session capture, the client-side
 *                             block-entity registry (what the F3 pie chart reads)
 *                             must never contain a hidden container entry; sign
 *                             block entities must be present as a positive control
 *   F. cache replay         - near the viewer the chest is revealed, but after
 *                             leaving, the last state sent for its position is the
 *                             filler again; a replaying Bobby/Distant Horizons
 *                             cache therefore stores the hidden state, not the chest
 *   G. vertical entity band - a base at y=-50 and a surface at y=64 must receive no
 *                             cross-floor entity packets for players, monsters or
 *                             animals, while the same floor stays fully visible
 *                             (the anti-base-ESP height rule). Stationary mobs
 *                             40 blocks away also cover the 24..96 dirty sweep.
 *   H. base markers - a distant chunk holding ENDER_CHEST, ENCHANTING_TABLE, BEACON
 *                     and a plain BOOKSHELF must contain no real block states or
 *                     block entities; the sign control proves the chunk arrived and
 *                     the absent beacon block entity proves its beam has no source.
 *
 * `--baseline` flips the expectations for the legacy jar: A, C, D, E and F are
 * expected to leak or lack the hide/reveal sequence, which validates that the
 * harness can actually detect each gap.
 *
 * `--protection-disabled --jar <build>` is the same leak control against the
 * current build: the harness sets every `worlds.<name>.enabled` to false in
 * server/plugins/Aegishider/config.yml for the run, then restores the original
 * file in its finally block, on the process exit path and on SIGINT/SIGTERM/SIGHUP.
 * A config created for the run (fresh plugins/) is deleted again, and a backup left
 * behind by an interrupted run is rolled back at the start of the next
 * `--protection-disabled` run. Leaks are EXPECTED in this mode; never judge the
 * plugin by it.
 *
 * Every run also fails unless the plugin Paper actually loaded is the jar that was
 * installed: exactly one plugins/*.jar may provide the plugin, its sha256 must equal
 * the --jar file, and the console load/enable lines must report the same version.
 *
 * Writes out/report-<timestamp>.json and prints a PASS/FAIL summary.
 * Exit codes: 0 = all expectations met, 1 = expectation failure, 2 = harness error.
 * SIGINT/SIGTERM/SIGHUP stop the Paper server (and restore a --protection-disabled
 * config) before this process exits; a second signal force-kills the server.
 */
const { spawn, execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const { Rcon } = require('./lib/rcon')
const cd = require('./lib/chunk-decoder')

// ------------------------------------------------------------------ paths / constants
const ROOT = path.resolve(__dirname, '..')
const SERVER_DIR = path.join(ROOT, 'server')
const OUT_DIR = path.join(ROOT, 'out')
const BOT_SCRIPT = path.join(__dirname, 'capture-bot.js')
const SERVER_PID_FILE = path.join(OUT_DIR, 'server.pid')
const IS_WINDOWS = process.platform === 'win32'
const DEFAULT_JAVA_HOME = 'C:\\Users\\audim_r0h5i\\.jdks\\jdk-21.0.13+9'
const JAVA_HOME = process.env.JAVA_HOME || DEFAULT_JAVA_HOME
const JAVA = path.join(JAVA_HOME, 'bin', IS_WINDOWS ? 'java.exe' : 'java')

const SERVER_PORT = 25599
const RCON_PORT = 25598
const RCON_PASSWORD = 'itest-rcon-pass'

const MIN_Y = cd.MIN_Y
const WORLD_HEIGHT = cd.WORLD_HEIGHT

// Entities / blocks of interest, resolved from minecraft-data so a data-version
// bump cannot silently change the ids used by assertions.
const mcdata = require('minecraft-data')('1.21.4')
const ITEM_ENTITY_TYPE = mcdata.entitiesByName.item.id
const PLAYER_ENTITY_TYPE = mcdata.entitiesByName.player.id
const ZOMBIE_ENTITY_TYPE = mcdata.entitiesByName.zombie.id
const COW_ENTITY_TYPE = mcdata.entitiesByName.cow.id
const CHEST_RANGE = cd.stateRange('chest')
const OBSERVER_RANGE = cd.stateRange('observer')
const STONE_RANGE = cd.stateRange('stone')
const BARREL_RANGE = cd.stateRange('barrel')
const ENDER_CHEST_RANGE = cd.stateRange('ender_chest')
const ENCHANTING_TABLE_RANGE = cd.stateRange('enchanting_table')
const BEACON_RANGE = cd.stateRange('beacon')
const BOOKSHELF_RANGE = cd.stateRange('bookshelf')
// Indexed plain bookshelf near the room's viewer, used for the reveal/re-hide test.
const INDEXED_BOOKSHELF_POS = { x: 102, y: -59, z: 100 }
const OAK_SIGN_RANGE = cd.stateRange('oak_sign')

// World coordinates for fixtures (flat world ground surface is y=-61, feet y=-60).
const STAGE = { x: 8.5, y: -59, z: 8.5, yaw: 0 } // facing +z (south)
const STAGE2 = { x: 12.5, y: -59, z: 8.5, yaw: 0 }
const HIDDEN_ITEM = { x: 8.5, y: -59.0, z: 32.5 }
const HIDDEN_WALL = { x1: 0, y1: -60, z1: 16, x2: 16, y2: -54, z2: 17 }
const VISIBLE_ITEM = { x: 8.5, y: -56.5, z: 11.5 }
const VISIBLE_WALL = { x1: 0, y1: -60, z1: 18, x2: 16, y2: -54, z2: 19 } // background only
const ROOM = { x1: 97, y1: -60, z1: 97, x2: 103, z2: 103, floorY: -60, ceilingY: -56 }
const CHEST_POS = { x: 100, y: -59, z: 101 }
const CHEST_CLICK = { x: 100, y: -60, z: 101, face: 1 } // top face of the floor block
const OBSERVER_POS = { x: 101, y: -59, z: 99 }
const STONE_MARKER_POS = { x: 98, y: -59, z: 98 }
const CONTROL_CHEST_POS = { x: 98, y: -59, z: 100 }
const ROOM_BOT_POS = { x: 100.5, y: -59, z: 102.5, yaw: 180 }
const FAR_AWAY = { x: 1100.5, y: -59, z: 102.5, yaw: 180 }
const ROOM_CHUNK = { x: 6, z: 6 }

// Scenario H: a distant base-marker shelf. These blocks are outside the 24-block
// reveal radius, so their chunk must contain only filler states and no beacon/
// enchanting-table/ender-chest block entities. The sign is a positive control.
const MARKER_CHUNK = { x: 3, z: 0 }
const BASE_MARKERS = [
  { key: 'enderChest', material: 'ender_chest', range: ENDER_CHEST_RANGE, pos: { x: 52, y: -59, z: 8 } },
  { key: 'enchantingTable', material: 'enchanting_table', range: ENCHANTING_TABLE_RANGE, pos: { x: 53, y: -59, z: 8 } },
  { key: 'beacon', material: 'beacon', range: BEACON_RANGE, pos: { x: 54, y: -59, z: 8 } },
  { key: 'bookshelf', material: 'bookshelf', range: BOOKSHELF_RANGE, pos: { x: 55, y: -59, z: 8 } }
]
const MARKER_SIGN_POS = { x: 52, y: -59, z: 10 }

// Three-gap benchmark fixtures. The bot stands at STAGE (chunk 0,0); band chunks
// 10 and 21 are 160 and 336 blocks away, inside the harness server's
// view-distance=22 but far outside any plausible reveal distance. Each band
// chunk holds one protected chest plus one oak sign that MUST still be sent:
// the sign is the positive control proving the chunk packet really arrived.
const BAND_FIXTURES = [
  {
    label: 'band-160-blocks',
    chunkX: 10,
    chunkZ: 0,
    chest: { x: 168, y: -59, z: 8 },
    sign: { x: 170, y: -59, z: 10 }
  },
  {
    label: 'band-336-blocks',
    chunkX: 21,
    chunkZ: 0,
    chest: { x: 344, y: -59, z: 8 },
    sign: { x: 346, y: -59, z: 10 }
  }
]

// Scenario G fixtures: a base at y=-50 and a surface platform at y=64 (the
// normal-world surface level), 114 blocks apart. Both platforms are built in the
// flat test world; the height shield must hide all cross-floor entities while
// same-floor players, monsters and animals stay visible. The distant stationary
// mobs (40 blocks from their viewer) also exercise the viewer-join dirty sweep:
// they are summoned before the viewer moves into range and never move, so a
// 24-block-only sweep would leave them invisible.
const G_FLOOR = {
  lowerY: -50,
  upperY: 64,
  verticalGap: 114,
  maxVerticalDistance: 16,
  basePlatform: { x1: 52, y1: -51, z1: 52, x2: 68, y2: -51, z2: 68 },
  surfacePlatform: { x1: 52, y1: 63, z1: 52, x2: 68, y2: 63, z2: 68 },
  lowerViewer: { x: 60.5, y: -50, z: 60.5, yaw: 0 },
  lowerSameFloor: { x: 64.5, y: -50, z: 60.5, yaw: 0 },
  lowerSameFloorMove: { x: 65.5, y: -50, z: 60.5, yaw: 0 },
  upperViewer: { x: 60.5, y: 64, z: 60.5, yaw: 0 },
  upperMove: { x: 61.5, y: 64, z: 60.5, yaw: 0 },
  lowerZombie: { x: 61.5, y: -50, z: 63.5 },
  lowerCow: { x: 63.5, y: -50, z: 63.5 },
  upperZombie: { x: 61.5, y: 64, z: 63.5 },
  upperCow: { x: 63.5, y: 64, z: 63.5 },
  lowerDistantCow: { x: 100.5, y: -50, z: 60.5 },
  upperDistantZombie: { x: 100.5, y: 64, z: 60.5 }
}
const G_MOB_NBT = '{NoAI:1b,NoGravity:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:1b}'

// Packet names that carry an entity id (movement/metadata/spawn) or remove one.
const ENTITY_PACKET_NAMES = new Set([
  'spawn_entity', 'set_entity_metadata', 'entity_metadata', 'rel_entity_move',
  'entity_move_look', 'entity_look', 'entity_teleport', 'entity_velocity',
  'entity_head_rotation', 'entity_animation', 'entity_status', 'entity_equipment',
  // Paper sends this absolute-position packet when an entity is teleported
  // (RCON tp), including same-floor moves; without it the same-floor control
  // in scenario G sees zero player packets even though the client received them.
  'sync_entity_position'
])
function entityPacketsFor (entries, entityId) {
  if (entityId == null) return []
  return entries.filter(l => ENTITY_PACKET_NAMES.has(l.name) && l.data && l.data.entityId === entityId)
}
function removePacketsFor (entries, entityId) {
  if (entityId == null) return []
  return entries.filter(l => l.name === 'remove_entities' && l.data && Array.isArray(l.data.entityIds)
    && l.data.entityIds.includes(entityId))
}
function mobSpawnsAt (entries, pos, typeId) {
  return entries.filter(l => l.name === 'spawn_entity' && l.data && l.data.type === typeId
    && Math.abs((l.data.x ?? 1e9) - pos.x) < 2.5
    && Math.abs((l.data.y ?? 1e9) - pos.y) < 2.5
    && Math.abs((l.data.z ?? 1e9) - pos.z) < 2.5)
}

// Block-entity registry names (NBT "id") of every hidden storage/base-marker type
// in the harness server config. Used by the cumulative pie-ray registry check.
const HIDDEN_BLOCK_ENTITY_TYPES = new Set([
  'chest', 'trapped_chest', 'ender_chest', 'barrel', 'shulker_box',
  'hopper', 'dropper', 'dispenser',
  'furnace', 'blast_furnace', 'smoker', 'brewing_stand',
  'mob_spawner', 'trial_spawner', 'vault', 'enchanting_table', 'beacon'
])
function bareTypeName (nbtId) {
  if (!nbtId) return null
  const s = String(nbtId)
  const colon = s.indexOf(':')
  return (colon >= 0 ? s.slice(colon + 1) : s).toLowerCase()
}

const UUID_A_INTS = [169090600, 185273100, 201326600, 217480100]
const UUID_B_INTS = [202050200, 218103800, 234157400, 250211000]

// ------------------------------------------------------------------ args
function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else { out[key] = next; i++ }
    }
  }
  return out
}
const argv = parseArgs(process.argv.slice(2))
const BASELINE = !!argv.baseline
const PROTECTION_DISABLED = !!argv['protection-disabled']
// --baseline (legacy jar) and --protection-disabled (current jar, protection off)
// are both leak controls, so every scenario expectation flips.
const LEAK_CONTROL = BASELINE || PROTECTION_DISABLED
const JAR_ARG_GIVEN = !!argv.jar
const JAR_PATH = argv.jar ? path.resolve(String(argv.jar)) : path.join(ROOT, '.cache', 'baseline-Aegishider.jar')
const BOOT_TIMEOUT_MS = parseInt(argv['boot-timeout-ms'] || '240000', 10)
const SCENARIO_FILTER = argv.scenarios ? String(argv.scenarios).split(',') : null
const KEEP_SERVER = !!argv['keep-server']
const SKIP_BOOT = !!argv['skip-boot']
const SCENARIO_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
const which = SCENARIO_FILTER || SCENARIO_ORDER

// ------------------------------------------------------------------ small utilities
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Waits until the bot's NDJSON capture stops growing for quietMs. Used after
// teleports so assertions run only after the whole (view-distance=24) chunk
// batch has arrived instead of racing the chunk stream.
async function waitCaptureQuiet (bot, quietMs = 1200, timeoutMs = 45000) {
  const start = Date.now()
  let lastSize = -1
  let lastChange = Date.now()
  while (Date.now() - start < timeoutMs) {
    let size = 0
    try { size = fs.statSync(bot.ndjsonPath).size } catch (_) { size = 0 }
    if (size !== lastSize) {
      lastSize = size
      lastChange = Date.now()
    } else if (Date.now() - lastChange >= quietMs) {
      return true
    }
    await sleep(250)
  }
  return false
}

// The pack only grows when a chunk packet arrives, so its size is an exact signal
// for "the first-join chunk stream has finished" (the NDJSON also carries a packet
// every second, which would never look quiet).
async function waitChunkStreamQuiet (bot, quietMs = 1500, timeoutMs = 180000) {
  const pack = path.join(bot.chunkDir, 'chunks.pack')
  const start = Date.now()
  let lastSize = -1
  let lastChange = Date.now()
  while (Date.now() - start < timeoutMs) {
    let size = 0
    try { size = fs.statSync(pack).size } catch (_) { size = 0 }
    if (size !== lastSize) {
      lastSize = size
      lastChange = Date.now()
    } else if (Date.now() - lastChange >= quietMs) {
      return true
    }
    await sleep(250)
  }
  return false
}

// A freshly wiped world generates and then commits the whole 24-chunk view on the
// first join. Starting fixtures in that window piles RCON work on top of Paper's
// synchronous region/player saves: one run was observed 120 s behind, blocked in
// MoonriseRegionFileIO.scheduleSave and PlayerDataStorage.save. Synchronise on the
// real state (both chunk streams quiet for quietMs, then no new overload line for
// stallQuietMs) instead of sleeping a fixed amount or requiring a pre-generated world.
async function waitForWorldSettled (server, bots, quietMs = 1500, stallQuietMs = 5000, timeoutMs = 180000) {
  const start = Date.now()
  const quiet = await Promise.all(bots.map(b => waitChunkStreamQuiet(b, quietMs, timeoutMs)))
  const isStall = (l) => /Can't keep up|has not responded|ticks behind/.test(l)
  let seen = server.lines.filter(isStall).length
  let lastStallAt = Date.now()
  while (Date.now() - start < timeoutMs) {
    const now = server.lines.filter(isStall).length
    if (now > seen) {
      seen = now
      lastStallAt = Date.now()
    } else if (Date.now() - lastStallAt >= stallQuietMs) {
      break
    }
    await sleep(250)
  }
  const ms = Date.now() - start
  return { ms, captureQuiet: quiet.every(Boolean), stallLines: seen, timedOut: ms >= timeoutMs }
}

// Waits until every requested chunk packet appears AFTER fromOffset. A size-based
// quiet check can fire in a gap between chunk batches when the server is throttling
// a view-distance=24 stream, which made the 336-block band flaky (chunk 21 only
// arrives in the tail of the batch).
async function waitForChunkPackets (bot, chunkKeys, fromOffset, quietMs = 1000, timeoutMs = 90000) {
  const pending = new Set(chunkKeys.map(k => `${k.x},${k.z}`))
  const start = Date.now()
  let offset = fromOffset
  let partial = ''
  while (Date.now() - start < timeoutMs) {
    let size = 0
    try { size = fs.statSync(bot.ndjsonPath).size } catch (_) { size = 0 }
    if (size > offset) {
      const fd = fs.openSync(bot.ndjsonPath, 'r')
      try {
        const length = size - offset
        const buf = Buffer.alloc(length)
        fs.readSync(fd, buf, 0, length, offset)
        offset = size
        const lines = (partial + buf.toString('utf8')).split('\n')
        partial = lines.pop()
        for (const line of lines) {
          if (!line) continue
          let entry
          try { entry = JSON.parse(line) } catch (_) { continue }
          if (entry.name === 'level_chunk_with_light' && entry.data) {
            pending.delete(`${entry.data.x},${entry.data.z}`)
          }
        }
      } finally {
        fs.closeSync(fd)
      }
    }
    if (pending.size === 0) {
      await sleep(quietMs)
      return true
    }
    await sleep(250)
  }
  return false
}
const nowIso = () => new Date().toISOString()
function stamp () {
  const d = new Date()
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}
function sha256 (file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}
function sha256Buffer (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// ------------------------------------------------------------------ leak-control config guard
// `--protection-disabled` runs the current build as a leak control: it switches
// every world's protection off in the harness server config so the detectors must
// still see A/C/D leak (the same proof the legacy baseline jar gives). The original
// bytes are restored in the run's finally block, on the process exit path and on
// SIGINT/SIGTERM/SIGHUP, so a failed, killed or interrupted run does not leave
// protection off. A config created for the run is deleted again so the plugin writes
// its own defaults on the next boot. If a previous run was killed hard enough to skip
// all of that, the leftover backup is rolled back at the start of the next
// `--protection-disabled` run.
const CONFIG_PATH = path.join(SERVER_DIR, 'plugins', 'Aegishider', 'config.yml')
const CONFIG_BACKUP_PATH = `${CONFIG_PATH}.itest-orig`
const CONFIG_CREATED_PATH = `${CONFIG_PATH}.itest-created`
const CONFIG_MARKER = '# itest-harness: world protection temporarily disabled by --protection-disabled; the original is restored after the run.'
let protectionState = null
let activeServer = null
let activeBots = null
let exitGuardsInstalled = false
let teardownPromise = null
let signalCount = 0

// Extracts one entry from a jar with the JDK's jar tool (no zip dependency).
function extractJarEntry (jarPath, entry, workDir, tag) {
  const jarTool = path.join(JAVA_HOME, 'bin', IS_WINDOWS ? 'jar.exe' : 'jar')
  const tmpDir = path.join(workDir, `jar-${tag}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  execFileSync(jarTool, ['xf', jarPath, entry], { cwd: tmpDir, timeout: 30000 })
  return fs.readFileSync(path.join(tmpDir, entry))
}

const unquoteYaml = (v) => (v == null ? null : String(v).trim().replace(/^['"]|['"]$/g, ''))

function pluginYmlFromJar (jarPath, workDir, tag) {
  const text = extractJarEntry(jarPath, 'plugin.yml', workDir, tag).toString('utf8')
  return {
    text,
    name: unquoteYaml((text.match(/^name:\s*(.+)$/m) || [])[1]),
    version: unquoteYaml((text.match(/^version:\s*(.+)$/m) || [])[1])
  }
}

// Sets every per-world `enabled:` under the top-level `worlds:` block to false.
// Comment lines, key order and the rest of the file are preserved byte for byte.
function disableWorldsInConfig (text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const worldsAt = lines.findIndex(l => /^worlds:\s*(#.*)?$/.test(l))
  if (worldsAt < 0) throw new Error(`config has no top-level "worlds:" section: ${CONFIG_PATH}`)
  let endAt = lines.length
  for (let i = worldsAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { endAt = i; break }
  }
  let worldIndent = -1
  for (let i = worldsAt + 1; i < endAt; i++) {
    if (!lines[i].trim() || /^\s*#/.test(lines[i])) continue
    worldIndent = lines[i].match(/^\s*/)[0].length
    break
  }
  let enabledIndent = -1
  for (let i = worldsAt + 1; i < endAt; i++) {
    const m = lines[i].match(/^(\s*)enabled:\s*(?:true|false)\b/)
    if (!m) continue
    const indent = m[1].length
    if (indent > worldIndent && (enabledIndent < 0 || indent < enabledIndent)) enabledIndent = indent
  }
  if (enabledIndent < 0) throw new Error(`config has no per-world "enabled:" key under "worlds:": ${CONFIG_PATH}`)
  let changed = 0
  for (let i = worldsAt + 1; i < endAt; i++) {
    const m = lines[i].match(/^(\s*)enabled:\s*(true|false)\b(.*)$/)
    if (!m || m[1].length !== enabledIndent || m[2] === 'false') continue
    lines[i] = `${m[1]}enabled: false${m[3]}`
    changed++
  }
  if (!text.startsWith(CONFIG_MARKER)) lines.unshift(CONFIG_MARKER)
  return { text: lines.join(eol), changed }
}

function beginProtectionDisabled (installedJarPath, workDir) {
  // A backup or created-marker left behind means a previous run never restored the file.
  if (fs.existsSync(CONFIG_BACKUP_PATH) || fs.existsSync(CONFIG_CREATED_PATH)) {
    const live = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : ''
    if (live.includes(CONFIG_MARKER)) {
      if (fs.existsSync(CONFIG_BACKUP_PATH)) fs.copyFileSync(CONFIG_BACKUP_PATH, CONFIG_PATH)
      else fs.rmSync(CONFIG_PATH, { force: true })
      console.log('[driver] --protection-disabled: rolled back config state left by an interrupted run')
    }
    fs.rmSync(CONFIG_BACKUP_PATH, { force: true })
    fs.rmSync(CONFIG_CREATED_PATH, { force: true })
  }
  const existed = fs.existsSync(CONFIG_PATH)
  const original = existed ? fs.readFileSync(CONFIG_PATH) : null
  // A fresh plugins/ (setup-server.ps1 recreates it) has no config yet: start from the
  // jar's own shipped config, which is what the plugin would write on its first boot.
  const source = original || extractJarEntry(installedJarPath, 'config.yml', workDir, 'shipped-config')
  const patched = disableWorldsInConfig(source.toString('utf8'))
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  if (existed) fs.writeFileSync(CONFIG_BACKUP_PATH, original)
  else fs.writeFileSync(CONFIG_CREATED_PATH, `${nowIso()} config created by --protection-disabled\n`)
  fs.writeFileSync(CONFIG_PATH, patched.text)
  protectionState = {
    origin: existed ? 'existing-config' : 'jar-default',
    configPath: CONFIG_PATH,
    backupPath: existed ? CONFIG_BACKUP_PATH : null,
    worldsChanged: patched.changed,
    originalSha256: original ? sha256Buffer(original) : null,
    patchedSha256: sha256(CONFIG_PATH),
    active: true,
    restore: null
  }
  return protectionState
}

function restoreProtectionDisabled (reason) {
  const st = protectionState
  if (!st || !st.active) return st
  st.active = false
  const restore = { reason, at: nowIso(), ok: false }
  try {
    if (st.origin === 'existing-config') {
      fs.copyFileSync(st.backupPath, st.configPath)
      restore.action = 'restored-original'
      restore.sha256 = sha256(st.configPath)
      restore.ok = restore.sha256 === st.originalSha256
    } else {
      fs.rmSync(st.configPath, { force: true })
      restore.action = 'removed-run-created-config'
      restore.ok = !fs.existsSync(st.configPath)
    }
  } catch (e) {
    restore.action = 'failed'
    restore.error = e.message
  }
  // Keep the backup when the restore failed: the next --protection-disabled run rolls it back.
  if (restore.ok) {
    fs.rmSync(CONFIG_BACKUP_PATH, { force: true })
    fs.rmSync(CONFIG_CREATED_PATH, { force: true })
  }
  st.restore = restore
  return st
}

// One shutdown path for a finished/failed run and for Ctrl-C/SIGTERM: quit the bots,
// send Paper its stop command (SIGKILL only when it will not go), then restore the
// harness config. The server must be gone before the driver exits; otherwise Ctrl-C
// leaves a Java process holding 25599/25598.
async function teardownRun (reason) {
  if (teardownPromise) return teardownPromise
  teardownPromise = (async () => {
    try {
      for (const bot of Object.values(activeBots || {})) {
        try { await bot.quit() } catch (e) { addError(`bot ${bot.name} quit: ${e.message}`) }
      }
      if (activeServer && activeServer.started) {
        const viaSignal = reason.startsWith('signal-')
        const stopInfo = await activeServer.stop(reason, viaSignal
          ? { graceMs: activeServer.rcon ? 15000 : 2000, killGraceMs: 5000, portWaitMs: 5000 }
          : {})
        report.server.stopped = stopInfo
        if (KEEP_SERVER && reason === 'run-finished') console.log('[driver] --keep-server: leaving the server process running on purpose')
      }
    } finally {
      // The plugin can rewrite config.yml while shutting down, so the original is
      // restored only after the server is gone - and even when boot or a scenario failed.
      if (PROTECTION_DISABLED) {
        const restored = restoreProtectionDisabled(reason)
        if (restored && !restored.restore.ok) {
          addError(`--protection-disabled could not restore ${restored.configPath} (${restored.restore.error || 'sha256 mismatch'}); the original is kept at ${CONFIG_BACKUP_PATH}`)
        } else if (restored) {
          console.log(`[driver] --protection-disabled: config ${restored.restore.action}`)
        }
        if (KEEP_SERVER && reason === 'run-finished') console.log('[driver] --keep-server: the running server still holds protection off in memory and may rewrite config.yml when it stops')
      }
    }
  })()
  return teardownPromise
}

function installExitGuards () {
  if (exitGuardsInstalled) return
  exitGuardsInstalled = true
  process.on('exit', () => {
    const st = restoreProtectionDisabled('process-exit')
    if (st && st.restore && !st.restore.ok) {
      console.error(`[driver] ERROR: could not restore ${st.configPath}; the original is kept at ${CONFIG_BACKUP_PATH}`)
    }
    if (activeServer && activeServer.started && activeServer.proc && !activeServer.exited && !activeServer.stopped) {
      console.error(`[driver] WARNING: exiting while Paper pid ${activeServer.proc.pid} is still running (only SIGKILL skips this path)`)
    }
  })
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      signalCount += 1
      if (signalCount > 1) {
        console.error(`[driver] ${sig} again: forcing the Paper server down and exiting`)
        if (activeServer) activeServer.stopped = `signal-${sig}-force`
        if (activeServer && activeServer.proc && activeServer.proc.pid && !activeServer.exited) killPidTree(activeServer.proc.pid, `signal-${sig}-force`)
        restoreProtectionDisabled(`signal-${sig}-force`)
        process.exit(2)
      }
      console.error(`[driver] ${sig}: stopping the Paper server before exit (send it again to force)`)
      const startedAt = Date.now()
      // Hard ceiling: a wedged server must not make Ctrl-C hang forever.
      const watchdog = setTimeout(() => {
        console.error(`[driver] ${sig}: shutdown watchdog fired; killing the Paper server`)
        if (activeServer) activeServer.stopped = `signal-${sig}-watchdog`
        if (activeServer && activeServer.proc && activeServer.proc.pid && !activeServer.exited) killPidTree(activeServer.proc.pid, `signal-${sig}-watchdog`)
        restoreProtectionDisabled(`signal-${sig}-watchdog`)
        process.exit(2)
      }, 90000)
      watchdog.unref()
      teardownRun(`signal-${sig}`).then(() => {
        const st = restoreProtectionDisabled(`signal-${sig}`)
        const restored = !PROTECTION_DISABLED || !!(st && st.restore && st.restore.ok)
        console.error(`[driver] ${sig}: shutdown finished in ${Date.now() - startedAt}ms (config ${restored ? 'restored' : 'NOT restored'}); exiting with code 2`)
        process.exit(2)
      }, (e) => {
        console.error(`[driver] ${sig}: shutdown failed (${e && e.message}); force-killing the Paper server`)
        if (activeServer) activeServer.stopped = `signal-${sig}-fallback`
        if (activeServer && activeServer.proc && activeServer.proc.pid && !activeServer.exited) killPidTree(activeServer.proc.pid, `signal-${sig}-fallback`)
        restoreProtectionDisabled(`signal-${sig}-fallback`)
        process.exit(2)
      })
    })
  }
}

// ------------------------------------------------------------------ loaded-plugin verification
// Proves the plugin Paper actually loaded is the jar this run installed, rather than a
// stale jar left in plugins/. The run fails (exit 2, before any scenario) when a second
// jar provides the same plugin, the on-disk copy no longer has the installed sha256, or
// the console load/enable lines report a different version.
function verifyLoadedPlugin (server, installed, expected, workDir) {
  const pluginsDir = path.join(SERVER_DIR, 'plugins')
  const providers = []
  const skipped = []
  const jars = fs.readdirSync(pluginsDir).filter(f => /\.jar$/i.test(f)).sort()
  for (const [i, file] of jars.entries()) {
    const filePath = path.join(pluginsDir, file)
    try {
      const yml = pluginYmlFromJar(filePath, workDir, `loaded-${i}`)
      if (expected.name && yml.name === expected.name) providers.push({ file, version: yml.version, sha256: sha256(filePath) })
    } catch (e) {
      skipped.push({ file, error: e.message })
    }
  }
  const installedFile = path.basename(installed.path)
  const installedSha256 = sha256(installed.path)
  const nameRe = expected.name ? expected.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null
  const loadLine = expected.name
    ? (server.lines.find(l => l.includes(`Loading server plugin ${expected.name} v`)) || null)
    : null
  const loadVersion = loadLine ? unquoteYaml((loadLine.match(/Loading server plugin .+ v(\S+)/) || [])[1]) : null
  const enableRe = nameRe ? new RegExp(`\\[${nameRe}\\] ${nameRe} (\\S+) enabled`) : null
  const enableLine = enableRe ? (server.lines.find(l => enableRe.test(l)) || null) : null
  const enableVersion = enableLine ? unquoteYaml((enableLine.match(enableRe) || [])[1]) : null
  const problems = []
  if (!expected.name || !expected.version) problems.push(`could not read name/version from the selected jar (${path.basename(JAR_PATH)})`)
  if (providers.length !== 1) {
    problems.push(providers.length === 0
      ? `no jar in plugins/ provides the plugin "${expected.name}"`
      : `plugins/ contains ${providers.length} jars providing "${expected.name}": ${providers.map(p => p.file).join(', ')}`)
  } else if (providers[0].file !== installedFile || providers[0].sha256 !== installed.sha256) {
    problems.push(`plugins/${providers[0].file} (sha256 ${providers[0].sha256.slice(0, 12)}) is not the installed jar plugins/${installedFile} (sha256 ${installed.sha256.slice(0, 12)})`)
  }
  if (installedSha256 !== installed.sha256) {
    problems.push(`plugins/${installedFile} changed on disk after install (sha256 ${installedSha256.slice(0, 12)})`)
  }
  if (!loadLine) problems.push(`the server console has no "Loading server plugin ${expected.name} v..." line`)
  else if (loadVersion !== expected.version) problems.push(`loaded version ${loadVersion} != installed jar version ${expected.version}`)
  if (enableLine && enableVersion !== expected.version) problems.push(`enable line reports version ${enableVersion} != installed jar version ${expected.version}`)
  return {
    ok: problems.length === 0,
    reason: problems.length ? problems.join('; ') : null,
    expectedName: expected.name,
    expectedVersion: expected.version,
    expectedSha256: installed.sha256,
    installedFile,
    installedSha256,
    providers,
    skipped,
    loadLine: loadLine ? loadLine.trim() : null,
    loadVersion,
    enableLine: enableLine ? enableLine.trim() : null,
    enableVersion
  }
}
function uuidFromInts (ints) {
  const hex = ints.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const UUID_A = uuidFromInts(UUID_A_INTS)
const UUID_B = uuidFromInts(UUID_B_INTS)
function normUuid (v) {
  if (!v) return null
  if (typeof v === 'string') return v.toLowerCase()
  if (Buffer.isBuffer(v)) return uuidFromInts([v.readInt32BE(0), v.readInt32BE(4), v.readInt32BE(8), v.readInt32BE(12)])
  if (Array.isArray(v)) return v.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('')
  return String(v).toLowerCase()
}
function stateLabel (stateId) {
  if (stateId === null || stateId === undefined) return 'out_of_world'
  return `${cd.blockName(stateId)} (state ${stateId})`
}
function sectionBlockIndex (x, y, z) {
  return ((y & 15) << 8) | ((z & 15) << 4) | (x & 15)
}
function chunkSectionIndexForY (y) { return (y - MIN_Y) >> 4 }
function isPortOpen (port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port })
    let done = false
    const finish = (v) => { if (!done) { done = true; try { sock.destroy() } catch (_) {} ; resolve(v) } }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}
function portOwnerInfo (port) {
  if (!IS_WINDOWS) return 'unknown (non-Windows harness)'
  try {
    const ps = `$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($c[0].OwningProcess)"; [Console]::Out.WriteLine("PID=$($c[0].OwningProcess);CMD=$($p.CommandLine)") }`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 15000 }).trim()
    return out || 'unknown'
  } catch (e) {
    return `unknown (${e.message})`
  }
}
function killPidTree (pid, reason) {
  try {
    if (IS_WINDOWS) {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 20000 })
    } else {
      process.kill(pid, 'SIGKILL')
    }
    return true
  } catch (e) {
    return false
  }
}

// ------------------------------------------------------------------ report bucket
const report = {
  schema: 'aegishider-itest/report/v1',
  runId: null,
  startedAt: nowIso(),
  baselineMode: BASELINE,
  protectionDisabled: PROTECTION_DISABLED,
  protectionConfig: null,
  environment: {
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    minecraftProtocol: require('minecraft-protocol/package.json').version,
    java: JAVA,
    serverPort: SERVER_PORT,
    rconPort: RCON_PORT
  },
  plugin: null,
  server: null,
  decoderSelfTest: null,
  scenarios: {},
  overall: { pass: false, reason: 'not-finished' },
  limitations: [],
  artifacts: {},
  errors: []
}
function addError (msg) {
  report.errors.push(msg)
  console.error(`[driver] ERROR: ${msg}`)
}

// ------------------------------------------------------------------ server management
class PaperServer {
  constructor (runDir) {
    this.runDir = runDir
    this.logPath = path.join(runDir, 'server-console.log')
    this.proc = null
    this.lines = []
    this.exited = false
    this.exitInfo = null
    this.rcon = null
    this.bootMs = null
    this.stopped = false
    this.started = false
    this._logStream = null
  }

  async preflight () {
    if (!fs.existsSync(JAVA)) throw new Error(`Java 21 not found at ${JAVA}`)
    if (!fs.existsSync(path.join(SERVER_DIR, 'paper-1.21.4.jar'))) throw new Error('server/paper-1.21.4.jar missing - run setup-server.ps1')
    for (const port of [SERVER_PORT, RCON_PORT]) {
      if (await isPortOpen(port)) {
        throw new Error(`port ${port} is already in use (${portOwnerInfo(port)}); run run-itest.ps1 to clean up or stop the process`)
      }
    }
  }

  // Paper always loads server/plugins/Aegishider.jar, so the jar selected by --jar
  // must be installed there first. Without this a run (including --baseline) would
  // silently test whatever build happened to be left in the plugins folder.
  installPluginJar () {
    const target = path.join(SERVER_DIR, 'plugins', 'Aegishider.jar')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const wanted = sha256(JAR_PATH)
    let current = null
    try { current = sha256(target) } catch (_) {}
    if (current === wanted) return { changed: false, sha256: wanted, path: target }
    fs.copyFileSync(JAR_PATH, target)
    // Drop Paper's remapped copy (keyed to the old jar) so the new build is loaded.
    try { fs.unlinkSync(path.join(SERVER_DIR, 'plugins', '.paper-remapped', 'Aegishider.jar')) } catch (_) {}
    return { changed: true, sha256: wanted, path: target, previousSha256: current }
  }

  start () {
    fs.mkdirSync(this.runDir, { recursive: true })
    this.started = true
    this._logStream = fs.createWriteStream(this.logPath, { flags: 'w' })
    const jvmArgs = [
      '-Xms512M', '-Xmx2048M', '-XX:+UseG1GC', '-Dfile.encoding=UTF-8',
      // GC lines land in the captured console log, so a future stall can be
      // attributed to a collection pause instead of guessed at.
      '-Xlog:gc',
      '-jar', path.join(SERVER_DIR, 'paper-1.21.4.jar'), '--nogui'
    ]
    this.proc = spawn(JAVA, jvmArgs, {
      cwd: SERVER_DIR,
      env: Object.assign({}, process.env, { JAVA_HOME, PATH: [path.join(JAVA_HOME, 'bin'), process.env.PATH || ''].join(path.delimiter) }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    try {
      fs.writeFileSync(SERVER_PID_FILE, JSON.stringify({ pid: this.proc.pid, startedAt: nowIso(), jar: path.join(SERVER_DIR, 'paper-1.21.4.jar'), cwd: SERVER_DIR }) + '\n')
    } catch (e) {
      addError(`could not write server pid file: ${e.message}`)
    }
    const onChunk = (buf) => {
      const text = buf.toString('utf8')
      this._logStream.write(text)
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        this.lines.push(line)
        if (this.lines.length > 4000) this.lines.shift()
      }
    }
    this.proc.stdout.on('data', onChunk)
    this.proc.stderr.on('data', onChunk)
    this.proc.on('exit', (code, signal) => {
      this.exited = true
      this.exitInfo = { code, signal }
      if (this._logStream) {
        try { this._logStream.write(`\n[driver] server process exited code=${code} signal=${signal}\n`) } catch (_) {}
      }
    })
  }

  async waitForDone (timeoutMs) {
    const start = Date.now()
    let lastProgress = start
    while (Date.now() - start < timeoutMs) {
      if (this.exited && !this.stopped) {
        const tail = this.lines.slice(-25).join('\n')
        throw new Error(`Paper server exited during boot (code=${this.exitInfo && this.exitInfo.code}). Last log lines:\n${tail}`)
      }
      if (this.lines.some(l => /Done \([\d.]+s\)!/.test(l))) {
        this.bootMs = Date.now() - start
        return this.bootMs
      }
      if (Date.now() - lastProgress > 30000) lastProgress = Date.now()
      await sleep(100)
    }
    throw new Error(`Paper server did not reach "Done (" within ${Math.round(timeoutMs / 1000)}s; see ${this.logPath}`)
  }

  async connectRcon (timeoutMs = 20000) {
    const start = Date.now()
    let lastErr = null
    while (Date.now() - start < timeoutMs) {
      if (this.exited && !this.stopped) throw new Error('server exited before RCON could connect')
      // The control channel must survive Paper's own chunk-stream stalls: a
      // view-distance=24 batch can leave the server several seconds behind on a
      // slow host (observed 8.57 s), which is not a plugin failure.
      const rcon = new Rcon({ host: '127.0.0.1', port: RCON_PORT, password: RCON_PASSWORD, timeoutMs: 30000 })
      try {
        await rcon.connect()
        this.rcon = rcon
        return rcon
      } catch (e) {
        lastErr = e
        try { rcon.close() } catch (_) {}
        await sleep(500)
      }
    }
    throw new Error(`RCON connect failed after ${timeoutMs}ms: ${lastErr && lastErr.message}`)
  }

  async rconCmd (command) {
    if (this.exited) throw new Error('Paper server process has exited; RCON command aborted')
    if (!this.rcon) throw new Error('RCON not connected')
    const res = await this.rcon.cmd(command)
    this._lastRcon = { command, response: res, at: nowIso() }
    return res
  }

  async stop (reason, options = {}) {
    const graceMs = Number.isFinite(options.graceMs) ? options.graceMs : 45000
    const killGraceMs = Number.isFinite(options.killGraceMs) ? options.killGraceMs : 15000
    const portWaitMs = Number.isFinite(options.portWaitMs) ? options.portWaitMs : 15000
    this.stopped = reason || 'driver-stop'
    if (this.rcon) {
      try { await Promise.race([this.rcon.cmd('stop'), sleep(5000)]) } catch (_) {}
      try { this.rcon.close() } catch (_) {}
      this.rcon = null
    }
    const start = Date.now()
    while (!this.exited && Date.now() - start < graceMs) await sleep(200)
    let killedTree = false
    if (!this.exited && this.proc && this.proc.pid) {
      killedTree = killPidTree(this.proc.pid, 'stop-timeout')
      const kstart = Date.now()
      while (!this.exited && Date.now() - kstart < killGraceMs) await sleep(200)
    }
    if (this._logStream) {
      try { this._logStream.write(`\n[driver] stop requested (${reason}); cleanExit=${this.exited && !killedTree}\n`); this._logStream.end() } catch (_) {}
    }
    // Wait for the ports to be released.
    const portStart = Date.now()
    while (Date.now() - portStart < portWaitMs) {
      const busy = (await isPortOpen(SERVER_PORT)) || (await isPortOpen(RCON_PORT))
      if (!busy) break
      await sleep(250)
    }
    try { fs.unlinkSync(SERVER_PID_FILE) } catch (_) {}
    return {
      cleanExit: !!(this.exited && !killedTree),
      killedTree,
      exitCode: this.exitInfo && this.exitInfo.code,
      portsFreeAfterStop: !(await isPortOpen(SERVER_PORT)) && !(await isPortOpen(RCON_PORT))
    }
  }
}

// ------------------------------------------------------------------ bot management
class BotHandle {
  constructor (name, runDir) {
    this.name = name // username
    this.runDir = runDir
    this.ndjsonPath = path.join(runDir, `${name}.ndjson`)
    this.chunkDir = path.join(runDir, `${name}-chunks`)
    this.stderrPath = path.join(runDir, `${name}.stderr.log`)
    this.proc = null
    this.ready = null
    this.stdoutBuf = ''
    this.stdoutLines = []
    this.seenMarkers = new Set()
    this.markerWaiters = []
    this.exit = null
    this.stderrTail = []
    this._stderrStream = null
  }

  start () {
    fs.mkdirSync(this.chunkDir, { recursive: true })
    this._stderrStream = fs.createWriteStream(this.stderrPath, { flags: 'w' })
    this.proc = spawn(process.execPath, [
      BOT_SCRIPT,
      '--username', this.name,
      '--host', '127.0.0.1',
      '--port', String(SERVER_PORT),
      '--out', this.ndjsonPath,
      '--chunk-dir', this.chunkDir,
      '--max-ms', '1800000'
    ], { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

    this.proc.stdout.on('data', (data) => {
      const text = data.toString()
      this.stdoutBuf += text
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        this.stdoutLines.push(line)
        if (line.startsWith('BOT_READY ')) {
          try { this.ready = JSON.parse(line.slice('BOT_READY '.length)) } catch (_) {}
        } else if (line.startsWith('BOT_MARKED ')) {
          try {
            const m = JSON.parse(line.slice('BOT_MARKED '.length))
            this.seenMarkers.add(m.label)
            const stillWaiting = []
            for (const w of this.markerWaiters) {
              if (w.label === m.label) w.resolve()
              else stillWaiting.push(w)
            }
            this.markerWaiters = stillWaiting
          } catch (_) {}
        } else if (line.startsWith('BOT_PLACED ')) {
          try { this.lastPlaced = JSON.parse(line.slice('BOT_PLACED '.length)) } catch (_) {}
        } else if (line.startsWith('BOT_PLACE_ERROR ') || line.startsWith('BOT_ERROR ')) {
          this.stderrTail.push(line)
        }
      }
    })
    this.proc.stderr.on('data', (data) => {
      const text = data.toString()
      this.stderrTail.push(text)
      if (this.stderrTail.length > 80) this.stderrTail.shift()
      if (this._stderrStream) this._stderrStream.write(text)
    })
    this.proc.on('exit', (code, signal) => {
      this.exit = { code, signal }
      for (const w of this.markerWaiters) w.reject(new Error(`bot ${this.name} exited: ${code}`))
      this.markerWaiters = []
      if (this._stderrStream) {
        try { this._stderrStream.write(`\n[driver] bot process exited code=${code} signal=${signal}\n`); this._stderrStream.end() } catch (_) {}
      }
    })
  }

  send (obj) {
    if (!this.proc || this.exit) throw new Error(`bot ${this.name} is not running`)
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  async waitReady (timeoutMs = 45000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (this.exit) throw new Error(`bot ${this.name} exited before ready (${JSON.stringify(this.exit)}): ${this.stderrTail.join('').slice(-600)}`)
      if (this.ready) return this.ready
      await sleep(100)
    }
    throw new Error(`bot ${this.name} did not become ready within ${timeoutMs}ms; stderr: ${this.stderrTail.join('').slice(-600)}`)
  }

  async waitMarker (label, timeoutMs = 15000) {
    if (this.seenMarkers.has(label)) return
    return new Promise((resolve, reject) => {
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        this.markerWaiters = this.markerWaiters.filter(w => w !== waiter)
        reject(new Error(`bot ${this.name} marker "${label}" not reported within ${timeoutMs}ms; stderr: ${this.stderrTail.join('').slice(-400)}`))
      }, timeoutMs)
      const waiter = {
        label,
        resolve: () => { if (done) return; done = true; clearTimeout(timer); resolve() },
        reject: (err) => { if (done) return; done = true; clearTimeout(timer); reject(err) }
      }
      this.markerWaiters.push(waiter)
    })
  }

  async mark (label, timeoutMs = 15000) {
    this.send({ cmd: 'mark', label })
    await this.waitMarker(label, timeoutMs)
    return label
  }

  async quit () {
    if (!this.proc || this.exit) return this.exit
    try { this.send({ cmd: 'quit' }) } catch (_) {}
    const start = Date.now()
    while (!this.exit && Date.now() - start < 8000) await sleep(100)
    if (!this.exit && this.proc.pid) {
      killPidTree(this.proc.pid, 'bot-quit-timeout')
      await sleep(500)
    }
    return this.exit
  }
}

// ------------------------------------------------------------------ capture reading / analysis
function readCapture (bot) {
  if (!fs.existsSync(bot.ndjsonPath)) return { lines: [], markers: {} }
  const raw = fs.readFileSync(bot.ndjsonPath, 'utf8')
  const lines = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { lines.push(JSON.parse(line)) } catch (_) {}
  }
  const markers = {}
  for (const l of lines) {
    if (l.state === 'marker' && l.data && l.data.label) markers[l.data.label] = l
  }
  return { lines, markers, chunkDir: bot.chunkDir, ndjsonPath: bot.ndjsonPath }
}

/** Resolve a captured chunk payload from the append-only pack (or a legacy .bin). */
function readChunkPayload (bot, data) {
  if (!data || !data.chunkDataFile) return null
  const file = path.join(bot.chunkDir, data.chunkDataFile)
  if (!fs.existsSync(file)) return null
  if (Number.isFinite(data.chunkDataOffset) && data.chunkDataLen > 0) {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.allocUnsafe(data.chunkDataLen)
      const read = fs.readSync(fd, buf, 0, buf.length, data.chunkDataOffset)
      return read === buf.length ? buf : buf.subarray(0, read)
    } finally {
      fs.closeSync(fd)
    }
  }
  return fs.readFileSync(file) // captures written before the pack format
}
function windowBetween (capture, startLabel, endLabel) {
  const start = capture.markers[startLabel]
  const end = capture.markers[endLabel]
  if (!start || !end) return { start, end, entries: [] }
  return {
    start,
    end,
    entries: capture.lines.filter(l => l.seq > start.seq && l.seq < end.seq && l.state !== 'marker')
  }
}
function followupsForEntity (entries, entityId, afterSeq) {
  const names = new Set(['set_entity_metadata', 'entity_metadata', 'rel_entity_move', 'entity_teleport', 'entity_move_look', 'entity_velocity', 'entity_head_rotation'])
  return entries.filter(l => l.seq > (afterSeq || 0) && names.has(l.name) && l.data && l.data.entityId === entityId)
}
function captureStats (capture) {
  const counts = {}
  for (const l of capture.lines) {
    if (['marker', 'meta', 'error'].includes(l.state)) continue
    counts[l.name] = (counts[l.name] || 0) + 1
  }
  return counts
}
function markerEvidence (m) {
  if (!m) return null
  return { label: m.data && m.data.label, seq: m.seq, timestampMs: m.timestampMs, tRelMs: m.tRelMs }
}

// ------------------------------------------------------------------ fixture / scenario helpers
class Harness {
  constructor (server, bots) {
    this.server = server
    this.bots = bots // {testBot, testBot2}
    this.rconTrace = []
    this.scenarioResults = {}
  }

  async rcon (command) {
    const response = await this.server.rconCmd(command)
    this.rconTrace.push({ at: nowIso(), command, response })
    if (this.rconTrace.length > 500) this.rconTrace.shift()
    return response
  }

  async tp (botName, pos) {
    return this.rcon(`tp ${botName} ${pos.x} ${pos.y} ${pos.z} ${pos.yaw ?? 0} ${pos.pitch ?? 0}`)
  }

  async forEachBot (fn) {
    for (const [key, bot] of Object.entries(this.bots)) await fn(bot, key)
  }

  async clearEntities () {
    try { await this.rcon('kill @e[type=!minecraft:player]') } catch (e) { addError(`clearEntities failed: ${e.message}`) }
  }

  async clearTextArea () {
    // Remove any stray items/entities, teleport bots to the staging area.
    await this.clearEntities()
    await this.tp('TestBot', STAGE)
    await this.tp('TestBot2', STAGE2)
    await sleep(900)
  }
}

// Scenario A: dropped item far away behind solid blocks must be invisible.
async function scenarioA (h) {
  const result = {
    id: 'A',
    name: 'hidden dropped item far away behind solid blocks',
    expectation: LEAK_CONTROL ? 'LEAK' : 'HIDDEN',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  try {
    await h.clearTextArea()
    // Rebuild the blocking wall (idempotent) and make sure no leftover items exist.
    await h.rcon(`fill ${HIDDEN_WALL.x1} ${HIDDEN_WALL.y1} ${HIDDEN_WALL.z1} ${HIDDEN_WALL.x2} ${HIDDEN_WALL.y2} ${HIDDEN_WALL.z2} minecraft:stone`)
    await sleep(400)
    await h.tp('TestBot', STAGE)
    await h.tp('TestBot2', STAGE2)
    await sleep(900)

    for (const bot of Object.values(h.bots)) await bot.mark('A-start')
    const summon = `summon minecraft:item ${HIDDEN_ITEM.x} ${HIDDEN_ITEM.y} ${HIDDEN_ITEM.z} {UUID:[I;${UUID_A_INTS.join(',')}],NoGravity:1b,PickupDelay:32767s,Item:{id:"minecraft:diamond",count:1}}`
    const summonResponse = await h.rcon(summon)
    result.evidence.summonCommand = summon
    result.evidence.summonResponse = summonResponse
    await sleep(3000)
    for (const bot of Object.values(h.bots)) await bot.mark('A-end')
    await sleep(150)

    const perBot = {}
    let anyLeak = false
    let anySpawn = false
    for (const [key, bot] of Object.entries(h.bots)) {
      const capture = readCapture(bot)
      const win = windowBetween(capture, 'A-start', 'A-end')
      const before = capture.lines.filter(l => l.seq <= (win.start ? win.start.seq : 0))
      const knownEntityIds = new Set(before.filter(l => l.name === 'spawn_entity' && l.data).map(l => l.data.entityId))
      const itemSpawns = win.entries.filter(l => l.name === 'spawn_entity' && l.data && l.data.type === ITEM_ENTITY_TYPE)
      const uuidMatches = itemSpawns.filter(l => normUuid(l.data.objectUUID) === UUID_A)
      const leakedIds = itemSpawns.map(l => l.data.entityId)
      const followups = win.entries.filter(l => ['set_entity_metadata', 'entity_metadata', 'rel_entity_move', 'entity_teleport', 'entity_move_look', 'entity_velocity', 'entity_head_rotation'].includes(l.name) && leakedIds.includes(l.data && l.data.entityId))
      const unknownEntityPackets = win.entries.filter(l => ['rel_entity_move', 'entity_teleport', 'entity_move_look', 'entity_velocity', 'set_entity_metadata', 'entity_metadata'].includes(l.name) && l.data && !knownEntityIds.has(l.data.entityId) && l.data.entityId !== (bot.ready && bot.ready.entityId))
      const leak = itemSpawns.length > 0
      anyLeak = anyLeak || leak
      anySpawn = anySpawn || itemSpawns.length > 0
      perBot[key] = {
        username: bot.name,
        windowPackets: win.entries.length,
        itemSpawnPackets: itemSpawns.length,
        targetUuidSpawns: uuidMatches.length,
        leakedEntityIds: leakedIds,
        followupPackets: followups.length,
        followupByType: followups.reduce((acc, l) => { acc[l.name] = (acc[l.name] || 0) + 1; return acc }, {}),
        unknownEntityPackets: unknownEntityPackets.length,
        leaked: leak,
        capturePath: bot.ndjsonPath
      }
    }
    result.evidence.perBot = perBot
    result.evidence.anyLeak = anyLeak
    result.evidence.totalLeakedSpawnPackets = Object.values(perBot).reduce((n, b) => n + b.itemSpawnPackets, 0)
    result.evidence.totalFollowupPackets = Object.values(perBot).reduce((n, b) => n + b.followupPackets, 0)
    result.evidence.targetUuid = UUID_A
    result.evidence.itemPosition = HIDDEN_ITEM
    result.evidence.observerDistance = Math.hypot(HIDDEN_ITEM.x - STAGE.x, HIDDEN_ITEM.z - STAGE.z)
    {
      const capture = readCapture(h.bots.testBot)
      const win = windowBetween(capture, 'A-start', 'A-end')
      result.markers = { start: markerEvidence(win.start), end: markerEvidence(win.end) }
      result.evidence.packetCountsTestBot = captureStats(capture)
    }

    const observed = anyLeak ? 'LEAK' : 'HIDDEN'
    result.outcome = observed
    // Validation semantics: in baseline mode a LEAK proves the harness can detect
    // leaks; against the real plugin a LEAK is a failure.
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet
    if (!result.pass) {
      result.failureReason = LEAK_CONTROL
        ? 'baseline did not leak the hidden item; the harness fixture/probe is not reliable'
        : `hidden item was sent to the client (${result.evidence.totalLeakedSpawnPackets} item spawn packets)`
    }
  } catch (e) {
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario A: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario B: dropped item ~3 blocks in front must be visible within 3s.
async function scenarioB (h) {
  const result = {
    id: 'B',
    name: 'visible dropped item ~3 blocks in front',
    expectation: 'VISIBLE',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  try {
    await h.clearEntities()
    await h.rcon(`fill ${VISIBLE_WALL.x1} ${VISIBLE_WALL.y1} ${VISIBLE_WALL.z1} ${VISIBLE_WALL.x2} ${VISIBLE_WALL.y2} ${VISIBLE_WALL.z2} minecraft:stone`)
    await h.tp('TestBot', STAGE)
    await h.tp('TestBot2', STAGE2)
    await sleep(900)

    for (const bot of Object.values(h.bots)) await bot.mark('B-start')
    const summon = `summon minecraft:item ${VISIBLE_ITEM.x} ${VISIBLE_ITEM.y} ${VISIBLE_ITEM.z} {UUID:[I;${UUID_B_INTS.join(',')}],PickupDelay:32767s,Item:{id:"minecraft:diamond",count:1}}`
    const summonResponse = await h.rcon(summon)
    result.evidence.summonCommand = summon
    result.evidence.summonResponse = summonResponse
    await sleep(3000)
    for (const bot of Object.values(h.bots)) await bot.mark('B-end')
    await sleep(150)

    const perBot = {}
    let visible = false
    for (const [key, bot] of Object.entries(h.bots)) {
      const capture = readCapture(bot)
      const win = windowBetween(capture, 'B-start', 'B-end')
      const isTarget = (l) => l.name === 'spawn_entity' && l.data && (normUuid(l.data.objectUUID) === UUID_B ||
        (l.data.type === ITEM_ENTITY_TYPE && Math.hypot(l.data.x - VISIBLE_ITEM.x, l.data.z - VISIBLE_ITEM.z) < 6))
      const spawns = win.entries.filter(isTarget)
      const first = spawns[0]
      const latencyMs = first && win.start ? first.timestampMs - win.start.timestampMs : null
      const entityId = first ? first.data.entityId : null
      const followups = entityId == null ? [] : followupsForEntity(win.entries, entityId)
      const byType = followups.reduce((acc, l) => { acc[l.name] = (acc[l.name] || 0) + 1; return acc }, {})
      const metadata = followups.filter(l => l.name === 'set_entity_metadata' || l.name === 'entity_metadata').length
      const position = followups.filter(l => ['rel_entity_move', 'entity_teleport', 'entity_move_look', 'entity_velocity'].includes(l.name)).length
      const botVisible = !!first && (metadata > 0 || position > 0) && latencyMs <= 3000
      visible = visible || botVisible
      perBot[key] = {
        username: bot.name,
        windowPackets: win.entries.length,
        spawnPackets: spawns.length,
        targetUuidFound: spawns.some(l => normUuid(l.data.objectUUID) === UUID_B),
        firstSpawnLatencyMs: latencyMs,
        entityId,
        followupPackets: followups.length,
        followupByType: byType,
        metadataPackets: metadata,
        positionPackets: position,
        visible: botVisible,
        capturePath: bot.ndjsonPath
      }
    }
    result.evidence.perBot = perBot
    result.evidence.targetUuid = UUID_B
    result.evidence.itemPosition = VISIBLE_ITEM
    result.evidence.visible = visible
    {
      const capture = readCapture(h.bots.testBot)
      const win = windowBetween(capture, 'B-start', 'B-end')
      result.markers = { start: markerEvidence(win.start), end: markerEvidence(win.end) }
      result.evidence.packetCountsTestBot = captureStats(capture)
    }
    result.outcome = visible ? 'VISIBLE' : 'NOT_VISIBLE'
    result.pass = visible
    if (!visible) result.failureReason = 'visible item spawn/follow-up packets were not observed within 3s'
  } catch (e) {
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario B: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario C: player-placed chest inside a stone room must be absent from chunk data.
async function scenarioC (h) {
  const result = {
    id: 'C',
    name: 'chunk-level block hiding of a player-placed chest after forced chunk resend',
    expectation: LEAK_CONTROL ? 'LEAK' : 'HIDDEN',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  try {
    const testBot = h.bots.testBot
    // Stage bots away from the room chunk so it is unloaded before the test.
    await h.clearEntities()
    await h.tp('TestBot', STAGE)
    await h.tp('TestBot2', STAGE2)
    await sleep(900)

    // The room chunk may be unloaded while both bots are staged. Building first
    // used to fail with "That position is not loaded", leaving stale terrain and
    // making the bot's subsequent chest placement land on the floor. Keep the
    // fixture chunk loaded for the build, then release it.
    const loaded = await h.rcon('forceload add 100 101')
    if (/not loaded|Could not|unknown|failed/i.test(loaded || '')) {
      throw new Error(`fixture failure: could not load room chunk: ${loaded}`)
    }
    await sleep(300)

    // Idempotent room build. Flat world: ground surface y=-61, so the room floor
    // block sits at y=-60 and a player inside stands at y=-59.
    const cmds = [
      `fill ${ROOM.x1} ${ROOM.floorY} ${ROOM.z1} ${ROOM.x2} ${ROOM.ceilingY} ${ROOM.z2} minecraft:air`,
      `fill ${ROOM.x1} ${ROOM.floorY} ${ROOM.z1} ${ROOM.x2} ${ROOM.floorY} ${ROOM.z2} minecraft:stone`,
      `fill ${ROOM.x1} ${ROOM.floorY + 1} ${ROOM.z1} ${ROOM.x2} ${ROOM.ceilingY} ${ROOM.z2} minecraft:stone`,
      `fill ${ROOM.x1 + 1} ${ROOM.floorY + 1} ${ROOM.z1 + 1} ${ROOM.x2 - 1} ${ROOM.ceilingY - 1} ${ROOM.z2 - 1} minecraft:air`
    ]
    const buildResponses = []
    for (const c of cmds) {
      const response = await h.rcon(c)
      buildResponses.push({ command: c, response })
      if (/not loaded|Could not|unknown|failed/i.test(response || '')) {
        throw new Error(`fixture failure: room build rejected: ${response} (${c})`)
      }
    }
    for (const command of [
      `setblock ${STONE_MARKER_POS.x} ${STONE_MARKER_POS.y} ${STONE_MARKER_POS.z} minecraft:stone`,
      `setblock ${OBSERVER_POS.x} ${OBSERVER_POS.y} ${OBSERVER_POS.z} minecraft:observer[facing=up]`,
      // Informational control: a chest placed by RCON (no BlockPlaceEvent); used to
      // distinguish placement-index-based hiding from material-scan hiding.
      `setblock ${CONTROL_CHEST_POS.x} ${CONTROL_CHEST_POS.y} ${CONTROL_CHEST_POS.z} minecraft:chest`
    ]) {
      const response = await h.rcon(command)
      buildResponses.push({ command, response })
      if (/not loaded|Could not|unknown|failed/i.test(response || '')) {
        throw new Error(`fixture failure: room build rejected: ${response} (${command})`)
      }
    }
    await h.rcon('forceload remove 100 101')
    await sleep(400)
    result.evidence.build = buildResponses

    // The bot initially spawned inside this chunk (before it was rebuilt), so the
    // client can still hold the old copy and the server will not resend it on a
    // simple teleport back. Move far enough to unload it, then return and wait for
    // the exact post-build chunk before placing the chest.
    await h.tp('TestBot', FAR_AWAY)
    await sleep(1600)
    const enterOffset = (() => { try { return fs.statSync(testBot.ndjsonPath).size } catch (_) { return 0 } })()
    const enterStarted = Date.now()
    await h.tp('TestBot', ROOM_BOT_POS)
    const gotRoomChunk = await waitForChunkPackets(testBot, [ROOM_CHUNK], enterOffset, 250, 30000)
    if (!gotRoomChunk) {
      throw new Error(`fixture failure: room chunk (${ROOM_CHUNK.x},${ROOM_CHUNK.z}) did not arrive before placement`)
    }
    result.evidence.initialChunkLatencyMs = Date.now() - enterStarted
    await sleep(250)
    await testBot.mark('C-place')
    testBot.send({ cmd: 'place', block: 'chest', x: CHEST_CLICK.x, y: CHEST_CLICK.y, z: CHEST_CLICK.z, face: CHEST_CLICK.face, cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5 })
    try {
      await sleep(1200)
      await testBot.mark('C-placed')
    } catch (e) { addError(`scenario C: marker after place failed: ${e.message}`) }

    // Verify the fixture on the server side before asserting on packets.
    const chestData = await h.rcon(`data get block ${CHEST_POS.x} ${CHEST_POS.y} ${CHEST_POS.z}`)
    const observerData = await h.rcon(`data get block ${OBSERVER_POS.x} ${OBSERVER_POS.y} ${OBSERVER_POS.z}`)
    const floorProbe = await h.rcon(`execute if block ${CHEST_CLICK.x} ${CHEST_CLICK.y} ${CHEST_CLICK.z} minecraft:stone`)
    result.evidence.fixture = { chestServerData: chestData, observerServerData: observerData, floorProbe }
    if (!/Test passed/i.test(floorProbe || '')) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: room floor at ${JSON.stringify(CHEST_CLICK)} is not stone (server said: ${floorProbe})`
      result.pass = false
      addError(`scenario C: ${result.failureReason}`)
      result.durationMs = Date.now() - t0
      return result
    }
    if (!/chest/i.test(chestData || '')) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: no chest at ${JSON.stringify(CHEST_POS)} after bot placement (server said: ${chestData})`
      result.pass = false
      addError(`scenario C: ${result.failureReason}`)
      result.durationMs = Date.now() - t0
      return result
    }
    // Give the plugin time to scan/index and (for hiding plugins) to rewrite.
    await sleep(1200)

    // Force a real chunk resend: teleport 1000 blocks away, then back. Wait for
    // the exact room chunk and record its latency instead of adding a fixed delay.
    await testBot.mark('C-far')
    await h.tp('TestBot', FAR_AWAY)
    await sleep(1600)
    await testBot.mark('C-back')
    const backOffset = (() => { try { return fs.statSync(testBot.ndjsonPath).size } catch (_) { return 0 } })()
    const backStarted = Date.now()
    await h.tp('TestBot', ROOM_BOT_POS)
    const gotResendChunk = await waitForChunkPackets(testBot, [ROOM_CHUNK], backOffset, 250, 30000)
    const resendChunkLatencyMs = Date.now() - backStarted
    if (!gotResendChunk) {
      throw new Error(`fixture failure: room chunk (${ROOM_CHUNK.x},${ROOM_CHUNK.z}) did not arrive after return`)
    }
    await sleep(700)
    await testBot.mark('C-end')
    await sleep(200)

    const capture = readCapture(testBot)
    const win = windowBetween(capture, 'C-back', 'C-end')
    const farWin = windowBetween(capture, 'C-far', 'C-back')
    result.markers = {
      place: markerEvidence(capture.markers['C-place']),
      placed: markerEvidence(capture.markers['C-placed']),
      far: markerEvidence(capture.markers['C-far']),
      back: markerEvidence(capture.markers['C-back']),
      end: markerEvidence(capture.markers['C-end'])
    }
    result.evidence.packetCountsTestBot = captureStats(capture)
    const unloads = farWin.entries.filter(l => l.name === 'forget_level_chunk' || l.rawName === 'unload_chunk')
      .filter(l => l.data && l.data.chunkX === ROOM_CHUNK.x && l.data.chunkZ === ROOM_CHUNK.z)
    const chunkEntries = win.entries.filter(l => l.name === 'level_chunk_with_light' && l.data && l.data.x === ROOM_CHUNK.x && l.data.z === ROOM_CHUNK.z)
    result.evidence.resend = {
      chunkUnloadPacketsForRoomChunk: unloads.length,
      chunkPacketsForRoomChunkAfterReturn: chunkEntries.length,
      chunkLatencyMs: resendChunkLatencyMs
    }
    if (!chunkEntries.length) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: bot received no level_chunk_with_light for chunk (${ROOM_CHUNK.x},${ROOM_CHUNK.z}) after teleporting back`
      result.pass = false
      addError(`scenario C: ${result.failureReason}`)
      result.durationMs = Date.now() - t0
      return result
    }
    const lastChunk = chunkEntries[chunkEntries.length - 1]
    const payload = readChunkPayload(testBot, lastChunk.data)
    if (!payload) throw new Error(`chunk payload missing for seq ${lastChunk.seq} in ${testBot.chunkDir}`)
    const decoded = cd.decodeChunkData(payload)
    const blockAt = (p) => {
      const state = cd.getBlockState(decoded, p.x, p.y, p.z)
      return { state, name: state === null ? 'out_of_world' : cd.blockName(state), matches: (range) => state !== null && cd.stateMatches(state, range) }
    }
    const chest = blockAt(CHEST_POS)
    const observer = blockAt(OBSERVER_POS)
    const stoneMarker = blockAt(STONE_MARKER_POS)
    const floorStone = blockAt({ x: CHEST_CLICK.x, y: CHEST_CLICK.y, z: CHEST_CLICK.z })
    const controlChest = blockAt(CONTROL_CHEST_POS)
    const chestInChunk = cd.stateMatches(chest.state, CHEST_RANGE)
    const observerPresent = cd.stateMatches(observer.state, OBSERVER_RANGE)
    const stoneMarkerPresent = cd.stateMatches(stoneMarker.state, STONE_RANGE)
    const floorStonePresent = cd.stateMatches(floorStone.state, STONE_RANGE)

    // Positive controls: the decoder must find the marker blocks at their exact
    // coordinates in the same real chunk packet, otherwise the assertion is void.
    result.evidence.decoderPositiveControls = {
      stoneMarkerAt: STONE_MARKER_POS, stoneMarkerState: stoneMarker.state, stoneMarkerName: stoneMarker.name, stoneMarkerPresent,
      floorStoneAt: { x: CHEST_CLICK.x, y: CHEST_CLICK.y, z: CHEST_CLICK.z }, floorStoneState: floorStone.state, floorStoneName: floorStone.name, floorStonePresent,
      observerAt: OBSERVER_POS, observerState: observer.state, observerName: observer.name, observerPresent
    }
    if (!(stoneMarkerPresent && floorStonePresent && observerPresent)) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'decoder positive controls failed: marker stone/observer blocks were not decoded at their known coordinates (chunk decoder bug or wrong chunk)'
      result.pass = false
      addError(`scenario C: ${result.failureReason}`)
      result.durationMs = Date.now() - t0
      return result
    }

    // Count chest states in the section containing the fixture (leak magnitude).
    const secIdx = chunkSectionIndexForY(CHEST_POS.y)
    const section = decoded.sections[secIdx]
    let chestStatesInSection = 0
    for (let i = 0; i < 4096; i++) {
      if (cd.stateMatches(section.blocks.get(i), CHEST_RANGE)) chestStatesInSection++
    }

    // Post-chunk block updates: what a client would end up rendering if the chunk
    // packet leaked and the plugin patched it afterwards with block-change packets.
    const updates = capture.lines.filter(l => l.seq > lastChunk.seq && l.name === 'block_update' && l.data && l.data.location &&
      l.data.location.x === CHEST_POS.x && l.data.location.y === CHEST_POS.y && l.data.location.z === CHEST_POS.z)
    const lastUpdate = updates[updates.length - 1]
    result.evidence.chestInChunkData = chestInChunk
    result.evidence.chestChunkState = { state: chest.state, name: chest.name, inChestRange: chestInChunk }
    result.evidence.controlChestInChunkData = controlChest.inChestRange
    result.evidence.controlChestChunkState = { state: controlChest.state, name: controlChest.name }
    result.evidence.chestStatesInSection = chestStatesInSection
    result.evidence.postChunkBlockUpdatesAtChest = {
      count: updates.length,
      lastState: lastUpdate ? lastUpdate.data.type : null,
      lastName: lastUpdate ? cd.blockName(lastUpdate.data.type) : null
    }
    result.evidence.serverGroundTruthChest = chestData

    const observed = chestInChunk ? 'LEAK' : 'HIDDEN'
    result.outcome = observed
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet
    if (!result.pass) {
      result.failureReason = LEAK_CONTROL
        ? 'baseline did not leak the chest into the chunk packet; the decoder/fixture cannot prove a leak'
        : `player-placed chest was present in level_chunk_with_light chunk data (${chest.name} state ${chest.state} at ${JSON.stringify(CHEST_POS)})`
    }
    if (controlChest.inChestRange && !chestInChunk) {
      result.evidence.note = 'primary chest hidden but RCON-placed control chest leaked - plugin hiding appears placement-tracked, not material-wide'
    }
  } catch (e) {
    try { await h.rcon('forceload remove 100 101') } catch (_) {}
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario C: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario D: protected chests inside far chunks (160 / 336 blocks) must never
// reach the client, while a sign in the same chunk proves the chunk was sent.
async function scenarioD (h) {
  const result = {
    id: 'D',
    name: 'block-entity leak at 160/336 blocks (far chunk resend)',
    expectation: LEAK_CONTROL ? 'LEAK' : 'HIDDEN',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  const testBot = h.bots.testBot
  try {
    await h.clearEntities()
    // Park far away first so the fixture area is not resident client-side; the
    // chunks must arrive AFTER the chests exist for this to be a chunk-path test.
    await h.tp('TestBot', FAR_AWAY)
    await h.tp('TestBot2', STAGE2)
    await waitCaptureQuiet(testBot, 1200, 60000)
    await sleep(400)

    for (const band of BAND_FIXTURES) {
      await h.rcon(`forceload add ${band.chest.x} ${band.chest.z}`)
      await h.rcon(`setblock ${band.chest.x} ${band.chest.y} ${band.chest.z} minecraft:chest`)
      await h.rcon(`setblock ${band.sign.x} ${band.sign.y} ${band.sign.z} minecraft:oak_sign`)
    }
    await sleep(500)

    const fixture = []
    for (const band of BAND_FIXTURES) {
      const chestData = await h.rcon(`data get block ${band.chest.x} ${band.chest.y} ${band.chest.z}`)
      const signData = await h.rcon(`data get block ${band.sign.x} ${band.sign.y} ${band.sign.z}`)
      fixture.push({ label: band.label, chestServerData: chestData, signServerData: signData })
    }
    result.evidence.fixture = fixture
    if (fixture.some(f => !/chest/i.test(f.chestServerData || ''))) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: server-side chest missing (${JSON.stringify(fixture)})`
      result.durationMs = Date.now() - t0
      addError(`scenario D: ${result.failureReason}`)
      return result
    }

    await testBot.mark('D-start')
    const captureOffset = (() => { try { return fs.statSync(testBot.ndjsonPath).size } catch (_) { return 0 } })()
    await h.tp('TestBot', STAGE)
    // Chunk 21 is at the edge of the server view distance; wait for the exact
    // packets instead of trusting a size-stability heuristic.
    await waitForChunkPackets(testBot, BAND_FIXTURES.map(b => ({ x: b.chunkX, z: b.chunkZ })), captureOffset, 1000, 90000)
    await waitCaptureQuiet(testBot, 1500, 90000)
    await testBot.mark('D-end')
    await sleep(200)

    const capture = readCapture(testBot)
    const win = windowBetween(capture, 'D-start', 'D-end')
    result.markers = { start: markerEvidence(win.start), end: markerEvidence(win.end) }
    result.evidence.packetCountsTestBot = captureStats(capture)

    const perBand = {}
    let anyLeak = false
    let allControlsPresent = true
    let allChunksReceived = true
    for (const band of BAND_FIXTURES) {
      const chunkEntries = win.entries.filter(l => l.name === 'level_chunk_with_light' && l.data &&
        l.data.x === band.chunkX && l.data.z === band.chunkZ)
      const lastChunk = chunkEntries[chunkEntries.length - 1]
      const distance = Math.hypot(band.chest.x + 0.5 - STAGE.x, band.chest.z + 0.5 - STAGE.z)
      const entry = {
        label: band.label,
        distanceBlocks: Math.round(distance * 10) / 10,
        chunk: { x: band.chunkX, z: band.chunkZ },
        chunkPacketsReceived: chunkEntries.length,
        chestAt: band.chest,
        signAt: band.sign
      }
      if (!lastChunk) {
        allChunksReceived = false
        entry.note = 'fixture failure: chunk packet for this band was never received'
        perBand[band.label] = entry
        continue
      }
      const payload = readChunkPayload(testBot, lastChunk.data)
      const decoded = payload ? cd.decodeChunkData(payload) : null
      const chestState = decoded ? cd.getBlockState(decoded, band.chest.x, band.chest.y, band.chest.z) : null
      const signState = decoded ? cd.getBlockState(decoded, band.sign.x, band.sign.y, band.sign.z) : null
      const beEntries = lastChunk.data.blockEntities && Array.isArray(lastChunk.data.blockEntities.entries)
        ? lastChunk.data.blockEntities.entries
        : []
      const beAt = (p) => beEntries.filter(e => e.worldX === p.x && e.worldZ === p.z && e.y === p.y)
      const chestBes = beAt(band.chest)
      const signBes = beAt(band.sign)
      const chestStateLeak = chestState !== null && cd.stateMatches(chestState, CHEST_RANGE)
      const chestBeLeak = chestBes.length > 0
      const signStatePresent = signState !== null && signState !== 0
      const signBePresent = signBes.length > 0
      const leak = chestStateLeak || chestBeLeak
      anyLeak = anyLeak || leak
      if (!signBePresent && !signStatePresent) allControlsPresent = false
      entry.blockEntityCount = lastChunk.data.blockEntities ? lastChunk.data.blockEntities.count : null
      entry.chestState = { state: chestState, name: chestState === null ? 'out_of_world' : cd.blockName(chestState), leak: chestStateLeak }
      entry.chestBlockEntities = chestBes
      entry.signControl = { state: signState, signStatePresent, signBlockEntityPresent: signBePresent, blockEntities: signBes }
      entry.leak = leak
      perBand[band.label] = entry
    }
    result.evidence.perBand = perBand
    result.evidence.anyLeak = anyLeak
    if (!allChunksReceived) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'fixture failure: at least one band chunk packet was not received after the teleport'
      result.durationMs = Date.now() - t0
      addError(`scenario D: ${result.failureReason}`)
      return result
    }
    if (!allControlsPresent) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'positive control failed: the sign (block + block entity) inside a band chunk was not received, the assertion would be void'
      result.durationMs = Date.now() - t0
      addError(`scenario D: ${result.failureReason}`)
      return result
    }

    const observed = anyLeak ? 'LEAK' : 'HIDDEN'
    result.outcome = observed
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet
    if (!result.pass) {
      result.failureReason = LEAK_CONTROL
        ? 'baseline did not leak a far-band chest into chunk data; the detector cannot prove a leak'
        : 'a protected chest (block state or block entity) reached the client at 160/336 blocks'
    }
  } catch (e) {
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario D: ${e.message}`)
  } finally {
    for (const band of BAND_FIXTURES) {
      try { await h.rcon(`forceload remove ${band.chest.x} ${band.chest.z}`) } catch (_) {}
    }
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario E: pie-ray proxy. The F3 pie chart (and every client-side ESP that
// enumerates block entities) can only name a container if a block-entity entry
// for it ever reached the client. Scan the WHOLE session capture: zero hidden
// container block entities may exist, while sign block entities must exist as a
// positive control (scenario D places them).
async function scenarioE (h) {
  const result = {
    id: 'E',
    name: 'pie-ray: cumulative client block-entity registry stays free of hidden containers',
    expectation: LEAK_CONTROL ? 'DIRTY_REGISTRY' : 'CLEAN_REGISTRY',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  const testBot = h.bots.testBot
  try {
    const capture = readCapture(testBot)
    const chunkPackets = capture.lines.filter(l => l.name === 'level_chunk_with_light' && l.data)
    let beBearingChunks = 0
    let signBlockEntities = 0
    const offenders = []
    const typeCounts = {}
    for (const chunk of chunkPackets) {
      const summary = chunk.data.blockEntities
      if (!summary || !Array.isArray(summary.entries)) continue
      beBearingChunks++
      for (const be of summary.entries) {
        const bare = bareTypeName(be.typeName)
        if (!bare) continue
        typeCounts[bare] = (typeCounts[bare] || 0) + 1
        if (bare === 'sign' || bare === 'hanging_sign') signBlockEntities++
        if (HIDDEN_BLOCK_ENTITY_TYPES.has(bare)) {
          if (offenders.length < 20) {
            offenders.push({
              chunk: { x: chunk.data.x, z: chunk.data.z },
              worldX: be.worldX,
              worldY: be.y,
              worldZ: be.worldZ,
              typeName: bare,
              seq: chunk.seq
            })
          }
        }
      }
    }
    result.evidence = {
      chunkPacketsScanned: chunkPackets.length,
      chunksWithBlockEntities: beBearingChunks,
      signBlockEntities,
      hiddenContainerBlockEntities: offenders.length,
      offenders,
      blockEntityTypeCounts: typeCounts
    }
    if (beBearingChunks === 0 || signBlockEntities === 0) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'positive control failed: no sign block entity was captured at all (scenario D control fixture missing?), so an empty registry proves nothing'
      result.pass = false
      addError(`scenario E: ${result.failureReason}`)
      result.durationMs = Date.now() - t0
      return result
    }
    const clean = offenders.length === 0
    result.outcome = clean ? 'CLEAN_REGISTRY' : 'DIRTY_REGISTRY'
    result.expectationMet = result.outcome === result.expectation
    result.pass = result.expectationMet
    if (!result.pass) {
      result.failureReason = LEAK_CONTROL
        ? 'baseline did not expose any hidden container block entity; the registry probe found nothing to detect'
        : `hidden container block entities reached the client: ${offenders.length} entries, e.g. ${JSON.stringify(offenders[0])}`
    }
  } catch (e) {
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario E: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario F: Bobby / Distant Horizons cache replay. Those mods persist whatever
// chunk/block state the client last held. The plugin must reveal a chest while
// the viewer stands next to it, then push the filler state again when the viewer
// leaves, so the last cached state is the filler - a replay cannot show a chest.
async function scenarioF (h) {
  const result = {
    id: 'F',
    name: 'cache replay (Bobby/Distant Horizons): reveal near, re-hide before the client caches',
    expectation: LEAK_CONTROL ? 'CACHE_LEAK' : 'REVEAL_THEN_REHIDE',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  const testBot = h.bots.testBot
  try {
    await h.clearEntities()
    await h.tp('TestBot', FAR_AWAY)
    await h.tp('TestBot2', STAGE2)
    // The initial join chunk stream is unrelated to this scenario; the explicit
    // room-chunk waiter below is the ordering guarantee.
    await sleep(1600)

    // Build the room far from the bot, then place the protected chest via RCON:
    // no placement block-update can be confused with a reveal packet later. Keep
    // the fixture chunk loaded while filling it, just as in C and I.
    await h.rcon('forceload add 100 101')
    await sleep(300)
    const cmds = [
      `fill ${ROOM.x1} ${ROOM.floorY} ${ROOM.z1} ${ROOM.x2} ${ROOM.ceilingY} ${ROOM.z2} minecraft:air`,
      `fill ${ROOM.x1} ${ROOM.floorY} ${ROOM.z1} ${ROOM.x2} ${ROOM.floorY} ${ROOM.z2} minecraft:stone`,
      `fill ${ROOM.x1} ${ROOM.floorY + 1} ${ROOM.z1} ${ROOM.x2} ${ROOM.ceilingY} ${ROOM.z2} minecraft:stone`,
      `fill ${ROOM.x1 + 1} ${ROOM.floorY + 1} ${ROOM.z1 + 1} ${ROOM.x2 - 1} ${ROOM.ceilingY - 1} ${ROOM.z2 - 1} minecraft:air`
    ]
    for (const c of cmds) {
      const response = await h.rcon(c)
      if (/not loaded|Could not|unknown|failed/i.test(response || '')) {
        throw new Error(`fixture failure: cache room build rejected: ${response} (${c})`)
      }
    }
    // Clearing an already-air position is a harmless no-op (Paper answers
    // "Could not set the block"); the chest setblock and the data-get below are
    // the actual fixture assertions.
    await h.rcon(`setblock ${CHEST_POS.x} ${CHEST_POS.y} ${CHEST_POS.z} minecraft:air`)
    const chestSetResponse = await h.rcon(`setblock ${CHEST_POS.x} ${CHEST_POS.y} ${CHEST_POS.z} minecraft:chest`)
    if (/not loaded|Could not|unknown|failed/i.test(chestSetResponse || '')) {
      throw new Error(`fixture failure: cache chest rejected: ${chestSetResponse}`)
    }
    await h.rcon('forceload remove 100 101')
    await sleep(400)
    const chestData = await h.rcon(`data get block ${CHEST_POS.x} ${CHEST_POS.y} ${CHEST_POS.z}`)
    result.evidence.fixture = { chestServerData: chestData, chestAt: CHEST_POS }
    if (!/chest/i.test(chestData || '')) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: no chest at ${JSON.stringify(CHEST_POS)} (server said: ${chestData})`
      result.durationMs = Date.now() - t0
      addError(`scenario F: ${result.failureReason}`)
      return result
    }

    // Approach: the room chunk arrives with the chest already hidden.
    await testBot.mark('F-start')
    const approachOffset = (() => { try { return fs.statSync(testBot.ndjsonPath).size } catch (_) { return 0 } })()
    await h.tp('TestBot', ROOM_BOT_POS)
    const gotChunk = await waitForChunkPackets(testBot, [ROOM_CHUNK], approachOffset, 250, 45000)
    if (!gotChunk) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'fixture failure: no room chunk on approach'
      result.durationMs = Date.now() - t0
      addError(`scenario F: ${result.failureReason}`)
      return result
    }
    await sleep(2500) // reveal tick: near + in FOV + line of sight
    await testBot.mark('F-revealed')
    // Leave: beyond reveal.max-distance * keep-distance-factor -> re-hide update.
    await h.tp('TestBot', FAR_AWAY)
    await sleep(3000)
    await testBot.mark('F-end')
    await sleep(200)

    const capture = readCapture(testBot)
    const win = windowBetween(capture, 'F-start', 'F-end')
    result.markers = {
      start: markerEvidence(win.start),
      revealed: markerEvidence(capture.markers['F-revealed']),
      end: markerEvidence(win.end)
    }
    const roomChunks = win.entries.filter(l => l.name === 'level_chunk_with_light' && l.data &&
      l.data.x === ROOM_CHUNK.x && l.data.z === ROOM_CHUNK.z)
    if (!roomChunks.length) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: no chunk packet for the room chunk (${ROOM_CHUNK.x},${ROOM_CHUNK.z}) on approach`
      result.durationMs = Date.now() - t0
      addError(`scenario F: ${result.failureReason}`)
      return result
    }
    const firstChunk = roomChunks[0]
    let arrivalState = null
    const arrivalPayload = readChunkPayload(testBot, firstChunk.data)
    if (arrivalPayload) {
      const decoded = cd.decodeChunkData(arrivalPayload)
      arrivalState = cd.getBlockState(decoded, CHEST_POS.x, CHEST_POS.y, CHEST_POS.z)
    }
    const updates = win.entries.filter(l => l.name === 'block_update' && l.data && l.data.location &&
      l.data.location.x === CHEST_POS.x && l.data.location.y === CHEST_POS.y &&
      l.data.location.z === CHEST_POS.z && l.seq > firstChunk.seq)
    const chestUpdateIdx = []
    updates.forEach((u, i) => { if (cd.stateMatches(u.data.type, CHEST_RANGE)) chestUpdateIdx.push(i) })
    const revealSeen = chestUpdateIdx.length > 0
    const lastChestIdx = revealSeen ? chestUpdateIdx[chestUpdateIdx.length - 1] : -1
    const rehideUpdates = lastChestIdx >= 0
      ? updates.slice(lastChestIdx + 1).filter(u => !cd.stateMatches(u.data.type, CHEST_RANGE))
      : []
    const lastUpdate = updates[updates.length - 1]
    const finalStateValue = lastUpdate ? lastUpdate.data.type : arrivalState
    const finalStateName = finalStateValue === null || finalStateValue === undefined
      ? 'out_of_world'
      : cd.blockName(finalStateValue)
    const arrivalHidden = arrivalState !== null && arrivalState !== undefined && !cd.stateMatches(arrivalState, CHEST_RANGE)
    const cacheDirty = finalStateValue !== null && finalStateValue !== undefined && cd.stateMatches(finalStateValue, CHEST_RANGE)

    result.evidence = Object.assign(result.evidence, {
      roomChunkPackets: roomChunks.length,
      arrivalState: {
        state: arrivalState,
        name: arrivalState === null || arrivalState === undefined ? 'out_of_world' : cd.blockName(arrivalState),
        hidden: arrivalHidden
      },
      blockUpdatesAtChest: updates.map(u => ({ seq: u.seq, state: u.data.type, name: cd.blockName(u.data.type) })),
      revealSeen,
      revealUpdates: chestUpdateIdx.length,
      rehideUpdates: rehideUpdates.map(u => ({ seq: u.seq, state: u.data.type, name: cd.blockName(u.data.type) })),
      finalCachedState: { state: finalStateValue === undefined ? null : finalStateValue, name: finalStateName, dirty: cacheDirty },
      cacheDirty
    })

    let observed
    if (LEAK_CONTROL) {
      observed = cacheDirty ? 'CACHE_LEAK' : 'NO_CACHE_LEAK'
    } else {
      observed = (arrivalHidden && revealSeen && rehideUpdates.length > 0 && !cacheDirty)
        ? 'REVEAL_THEN_REHIDE'
        : (cacheDirty ? 'CACHE_LEAK' : 'INCOMPLETE_SEQUENCE')
    }
    result.outcome = observed
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet
    if (!result.pass) {
      result.failureReason = LEAK_CONTROL
        ? 'baseline cache did not end with a leaked chest state; the replay probe cannot prove a leak'
        : (cacheDirty
            ? 'the last state sent for the chest position is the real chest - a replaying client would cache it'
            : 'sequence incomplete: expected chunk-hidden arrival, a near reveal, and a far re-hide update')
    }
  } catch (e) {
    try { await h.rcon('forceload remove 100 101') } catch (_) {}
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario F: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario G: vertical entity band (anti-base-ESP) at the real base/surface Y.
//
// A base floor at y=-50 and a surface floor at y=64 (normal-world surface level),
// 114 blocks apart. TestBot stands in the base, TestBot2 on the surface. A zombie
// and a cow are summoned on each floor in open air, so the cross-floor pairs have
// a clear line of sight. Two stationary mobs 40 blocks away from their viewer test
// the new viewer-join dirty sweep (24..96 blocks) as well. The plugin must send no
// cross-floor entity packets while same-floor players/mobs stay visible.
async function scenarioG (h) {
  const result = {
    id: 'G',
    name: 'vertical entity band: base y=-50 and surface y=64 stay mutually invisible',
    expectation: LEAK_CONTROL ? 'CROSS_FLOOR_VISIBLE' : 'CROSS_FLOOR_HIDDEN',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  try {
    await h.clearTextArea()
    // Peaceful removes hostile mobs, so the zombie needs normal difficulty; it is
    // invulnerable and the time is midnight so daylight cannot remove it either.
    // Natural spawning stays off, so only the four fixture mobs exist.
    await h.rcon('gamerule doMobSpawning false')
    await h.rcon('difficulty normal')
    await h.rcon('time set midnight')
    await h.rcon(`fill ${G_FLOOR.basePlatform.x1} ${G_FLOOR.basePlatform.y1} ${G_FLOOR.basePlatform.z1} ` +
      `${G_FLOOR.basePlatform.x2} ${G_FLOOR.basePlatform.y2} ${G_FLOOR.basePlatform.z2} minecraft:stone`)
    await h.rcon(`fill ${G_FLOOR.surfacePlatform.x1} ${G_FLOOR.surfacePlatform.y1} ${G_FLOOR.surfacePlatform.z1} ` +
      `${G_FLOOR.surfacePlatform.x2} ${G_FLOOR.surfacePlatform.y2} ${G_FLOOR.surfacePlatform.z2} minecraft:stone`)
    await sleep(400)

    // The distant mobs exist before the viewers teleport into range. They never
    // move (NoAI + NoGravity), so they are only revealed when the viewer-join
    // sweep marks the whole monster-max-distance band dirty. With the old
    // item-distance-only sweep they stay hidden at 40 blocks.
    await h.rcon(`summon minecraft:cow ${G_FLOOR.lowerDistantCow.x} ${G_FLOOR.lowerDistantCow.y} ` +
      `${G_FLOOR.lowerDistantCow.z} ${G_MOB_NBT}`)
    await h.rcon(`summon minecraft:zombie ${G_FLOOR.upperDistantZombie.x} ${G_FLOOR.upperDistantZombie.y} ` +
      `${G_FLOOR.upperDistantZombie.z} ${G_MOB_NBT}`)
    for (const bot of Object.values(h.bots)) await bot.mark('G-distant-start')
    await h.tp('TestBot', G_FLOOR.lowerViewer)
    await h.tp('TestBot2', G_FLOOR.lowerSameFloor)
    await sleep(1500)

    // 1) Same-floor control: both players on the lower floor, TestBot2 moves a
    //    block and TestBot must receive that entity update.
    for (const bot of Object.values(h.bots)) await bot.mark('G-same-start')
    await h.tp('TestBot2', G_FLOOR.lowerSameFloorMove)
    await sleep(1200)
    for (const bot of Object.values(h.bots)) await bot.mark('G-same-end')

    // 2) Move TestBot2 to the upper floor; the plugin should hide it within a
    //    few ticks. The cross-floor window then contains no packets for it.
    await h.tp('TestBot2', G_FLOOR.upperViewer)
    for (const bot of Object.values(h.bots)) await bot.mark('G-upper-start')
    await sleep(2500)
    for (const bot of Object.values(h.bots)) await bot.mark('G-cross-start')
    await h.tp('TestBot2', G_FLOOR.upperMove)
    await sleep(1500)
    for (const bot of Object.values(h.bots)) await bot.mark('G-cross-end')
    for (const bot of Object.values(h.bots)) await bot.mark('G-distant-end')

    // 3) One zombie + one cow per floor, all in open air. Each viewer must see
    //    its own floor's pair and receive nothing for the other floor's pair.
    for (const bot of Object.values(h.bots)) await bot.mark('G-mobs-start')
    const summons = [
      `summon minecraft:zombie ${G_FLOOR.lowerZombie.x} ${G_FLOOR.lowerZombie.y} ${G_FLOOR.lowerZombie.z} ${G_MOB_NBT}`,
      `summon minecraft:cow ${G_FLOOR.lowerCow.x} ${G_FLOOR.lowerCow.y} ${G_FLOOR.lowerCow.z} ${G_MOB_NBT}`,
      `summon minecraft:zombie ${G_FLOOR.upperZombie.x} ${G_FLOOR.upperZombie.y} ${G_FLOOR.upperZombie.z} ${G_MOB_NBT}`,
      `summon minecraft:cow ${G_FLOOR.upperCow.x} ${G_FLOOR.upperCow.y} ${G_FLOOR.upperCow.z} ${G_MOB_NBT}`
    ]
    for (const command of summons) await h.rcon(command)
    await sleep(3000)
    for (const bot of Object.values(h.bots)) await bot.mark('G-mobs-end')
    await sleep(150)

    const perBot = {}
    let sameFloorPlayerPackets = 0
    let crossFloorPlayerPackets = 0
    let playerRemovePackets = 0
    let crossFloorMobSpawns = 0
    let sameFloorMobsVisible = true
    const missingOwnFloorMobs = []
    for (const [key, bot] of Object.entries(h.bots)) {
      const other = key === 'testBot' ? h.bots.testBot2 : h.bots.testBot
      const otherId = other.ready && other.ready.entityId
      const ownIsLower = key === 'testBot'
      const capture = readCapture(bot)
      const sameWin = windowBetween(capture, 'G-same-start', 'G-same-end')
      const crossWin = windowBetween(capture, 'G-cross-start', 'G-cross-end')
      const mobWin = windowBetween(capture, 'G-mobs-start', 'G-mobs-end')
      const distantWin = windowBetween(capture, 'G-distant-start', 'G-distant-end')
      const samePlayer = entityPacketsFor(sameWin.entries, otherId)
      const crossPlayer = entityPacketsFor(crossWin.entries, otherId)
      const removes = removePacketsFor(capture.lines.filter(l =>
        l.seq > (sameWin.end ? sameWin.end.seq : 0) &&
        l.seq <= (crossWin.end ? crossWin.end.seq : 0)), otherId)

      const ownZombie = ownIsLower ? G_FLOOR.lowerZombie : G_FLOOR.upperZombie
      const ownCow = ownIsLower ? G_FLOOR.lowerCow : G_FLOOR.upperCow
      const otherZombie = ownIsLower ? G_FLOOR.upperZombie : G_FLOOR.lowerZombie
      const otherCow = ownIsLower ? G_FLOOR.upperCow : G_FLOOR.lowerCow
      const ownDistant = ownIsLower ? G_FLOOR.lowerDistantCow : G_FLOOR.upperDistantZombie
      const otherDistant = ownIsLower ? G_FLOOR.upperDistantZombie : G_FLOOR.lowerDistantCow
      const ownDistantType = ownIsLower ? COW_ENTITY_TYPE : ZOMBIE_ENTITY_TYPE
      const otherDistantType = ownIsLower ? ZOMBIE_ENTITY_TYPE : COW_ENTITY_TYPE
      const ownZombieSpawns = mobSpawnsAt(mobWin.entries, ownZombie, ZOMBIE_ENTITY_TYPE)
      const ownCowSpawns = mobSpawnsAt(mobWin.entries, ownCow, COW_ENTITY_TYPE)
      const otherZombieSpawns = mobSpawnsAt(mobWin.entries, otherZombie, ZOMBIE_ENTITY_TYPE)
      const otherCowSpawns = mobSpawnsAt(mobWin.entries, otherCow, COW_ENTITY_TYPE)
      const ownDistantSpawns = mobSpawnsAt(distantWin.entries, ownDistant, ownDistantType)
      const otherDistantSpawns = mobSpawnsAt(distantWin.entries, otherDistant, otherDistantType)
      // A distant mob may have been legitimately visible before the viewer moved
      // floors (TestBot2 starts beside the lower cow). Cross-floor visibility is
      // only a leak if the spawn is not followed by an explicit removal/hide after
      // the viewer reached its final floor.
      const otherDistantId = otherDistantSpawns.length > 0 ? otherDistantSpawns[0].data.entityId : null
      // Compare the last spawn with the last removal: the distant mob may have
      // been legitimately visible on the previous floor, so only a final spawn
      // that is not followed by a hide/remove is a cross-floor leak.
      const otherDistantRemoves = removePacketsFor(capture.lines, otherDistantId)
      const otherDistantLastSpawnSeq = otherDistantSpawns.length
        ? otherDistantSpawns[otherDistantSpawns.length - 1].seq : -1
      const otherDistantLastRemoveSeq = otherDistantRemoves.length
        ? otherDistantRemoves[otherDistantRemoves.length - 1].seq : -1
      const otherDistantLeak = otherDistantSpawns.length > 0
        && otherDistantLastSpawnSeq > otherDistantLastRemoveSeq
      const distantOwnVisible = ownDistantSpawns.length > 0
      const ownVisible = ownZombieSpawns.length > 0 && ownCowSpawns.length > 0 && distantOwnVisible
      if (!ownVisible) {
        missingOwnFloorMobs.push(`${bot.name}: zombie=${ownZombieSpawns.length} cow=${ownCowSpawns.length} distant=${ownDistantSpawns.length}`)
      }
      sameFloorMobsVisible = sameFloorMobsVisible && ownVisible
      sameFloorPlayerPackets += samePlayer.length
      crossFloorPlayerPackets += crossPlayer.length
      playerRemovePackets += removes.length
      crossFloorMobSpawns += otherZombieSpawns.length + otherCowSpawns.length
              + (otherDistantLeak ? otherDistantSpawns.length : 0)
      perBot[key] = {
        username: bot.name,
        floor: ownIsLower ? 'base (y=-50)' : 'surface (y=64)',
        otherPlayerEntityId: otherId,
        sameFloorPlayerPackets: samePlayer.length,
        crossFloorPlayerPackets: crossPlayer.length,
        crossFloorPlayerRemovePackets: removes.length,
        ownFloorMobs: {
          zombieSpawns: ownZombieSpawns.length,
          cowSpawns: ownCowSpawns.length,
          visible: ownVisible
        },
        otherFloorMobs: {
          zombieSpawns: otherZombieSpawns.length,
          cowSpawns: otherCowSpawns.length,
          distantSpawns: otherDistantSpawns.length,
          distantRemoves: otherDistantRemoves.length,
          distantLeak: otherDistantLeak,
          visible: otherZombieSpawns.length + otherCowSpawns.length > 0 || otherDistantLeak
        },
        distantSameFloor: {
          type: ownIsLower ? 'cow' : 'zombie',
          distanceBlocks: Math.abs(ownDistant.x - (ownIsLower ? G_FLOOR.lowerViewer.x : G_FLOOR.upperViewer.x)),
          spawns: ownDistantSpawns.length,
          visible: distantOwnVisible
        },
        capturePath: bot.ndjsonPath
      }
    }

    const crossFloorVisible = crossFloorPlayerPackets > 0 || crossFloorMobSpawns > 0
    const observed = crossFloorVisible ? 'CROSS_FLOOR_VISIBLE' : 'CROSS_FLOOR_HIDDEN'
    const sameFloorVisible = sameFloorPlayerPackets > 0 && sameFloorMobsVisible
    result.evidence = {
      floors: {
        lowerY: G_FLOOR.lowerY,
        upperY: G_FLOOR.upperY,
        verticalGap: G_FLOOR.verticalGap,
        maxVerticalDistance: G_FLOOR.maxVerticalDistance
      },
      perBot,
      sameFloorPlayerPackets,
      crossFloorPlayerPackets,
      playerRemovePackets,
      crossFloorMobSpawns,
      sameFloorMobsVisible,
      missingOwnFloorMobs,
      summons,
      distantMobs: {
        lowerCow: G_FLOOR.lowerDistantCow,
        upperZombie: G_FLOOR.upperDistantZombie,
        distanceBlocks: 40
      }
    }
    {
      const win = windowBetween(readCapture(h.bots.testBot), 'G-mobs-start', 'G-mobs-end')
      result.markers = { start: markerEvidence(win.start), end: markerEvidence(win.end) }
    }
    result.outcome = observed
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet && sameFloorVisible
    if (!result.pass) {
      if (!sameFloorVisible) {
        result.failureReason = `same-floor control failed (player packets=${sameFloorPlayerPackets}, own-floor mobs ok=${sameFloorMobsVisible}); the harness cannot prove visibility at all`
      } else if (LEAK_CONTROL) {
        result.failureReason = 'baseline did not show cross-floor visibility; the probe is not reliable'
      } else {
        result.failureReason = `cross-floor entities reached the client (player packets=${crossFloorPlayerPackets}, mob spawns=${crossFloorMobSpawns})`
      }
    }
    await h.rcon('difficulty peaceful')
    await h.rcon('gamerule doMobSpawning true')
    await h.clearTextArea()
  } catch (e) {
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    try { await h.rcon('difficulty peaceful') } catch (_) {}
    try { await h.rcon('gamerule doMobSpawning true') } catch (_) {}
    addError(`scenario G: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario I: a plain BOOKSHELF placed by RCON has no Bukkit placement event, so the
// only way it can be indexed is the packet-layer state scan. Stand next to it and
// prove the indexed position still reveals the real block, then re-hides it on leave.
async function scenarioI (h) {
  const result = {
    id: 'I',
    name: 'indexed plain BOOKSHELF reveal/re-hide',
    expectation: LEAK_CONTROL ? 'CACHE_LEAK' : 'REVEAL_THEN_REHIDE',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  const testBot = h.bots.testBot
  try {
    await h.clearEntities()
    await h.tp('TestBot', FAR_AWAY)
    await h.tp('TestBot2', STAGE2)
    // The initial view-distance=24 stream can stay noisy for a minute; a short
    // settle is enough to make the room chunk leave the client's view.
    await sleep(1600)

    // Keep the fixture chunk loaded for the RCON build, then release it before
    // the approach so the client must receive a fresh post-build chunk.
    const loaded = await h.rcon('forceload add 100 101')
    if (/not loaded|Could not|unknown|failed/i.test(loaded || '')) {
      throw new Error(`fixture failure: could not load room chunk: ${loaded}`)
    }
    await sleep(300)
    const build = []
    for (const command of [
      `fill ${ROOM.x1} ${ROOM.floorY} ${ROOM.z1} ${ROOM.x2} ${ROOM.ceilingY} ${ROOM.z2} minecraft:air`,
      `fill ${ROOM.x1} ${ROOM.floorY} ${ROOM.z1} ${ROOM.x2} ${ROOM.floorY} ${ROOM.z2} minecraft:stone`,
      `fill ${ROOM.x1} ${ROOM.floorY + 1} ${ROOM.z1} ${ROOM.x2} ${ROOM.ceilingY} ${ROOM.z2} minecraft:stone`,
      `fill ${ROOM.x1 + 1} ${ROOM.floorY + 1} ${ROOM.z1 + 1} ${ROOM.x2 - 1} ${ROOM.ceilingY - 1} ${ROOM.z2 - 1} minecraft:air`,
      `setblock ${INDEXED_BOOKSHELF_POS.x} ${INDEXED_BOOKSHELF_POS.y} ${INDEXED_BOOKSHELF_POS.z} minecraft:bookshelf`
    ]) {
      const response = await h.rcon(command)
      build.push({ command, response })
      if (/not loaded|Could not|unknown|failed/i.test(response || '')) {
        throw new Error(`fixture failure: bookshelf room build rejected: ${response} (${command})`)
      }
    }
    await h.rcon('forceload remove 100 101')
    await sleep(300)
    const shelfProbe = await h.rcon(`execute if block ${INDEXED_BOOKSHELF_POS.x} ${INDEXED_BOOKSHELF_POS.y} ${INDEXED_BOOKSHELF_POS.z} minecraft:bookshelf`)
    result.evidence.fixture = { build, shelfProbe, shelfAt: INDEXED_BOOKSHELF_POS }
    if (!/Test passed/i.test(shelfProbe || '')) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: bookshelf missing at ${JSON.stringify(INDEXED_BOOKSHELF_POS)} (${shelfProbe})`
      result.durationMs = Date.now() - t0
      addError(`scenario I: ${result.failureReason}`)
      return result
    }

    await testBot.mark('I-start')
    const approachOffset = (() => { try { return fs.statSync(testBot.ndjsonPath).size } catch (_) { return 0 } })()
    const approachStarted = Date.now()
    await h.tp('TestBot', ROOM_BOT_POS)
    const gotChunk = await waitForChunkPackets(testBot, [ROOM_CHUNK], approachOffset, 250, 45000)
    if (!gotChunk) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'fixture failure: no room chunk on approach'
      result.durationMs = Date.now() - t0
      addError(`scenario I: ${result.failureReason}`)
      return result
    }
    result.evidence.approachChunkLatencyMs = Date.now() - approachStarted
    await sleep(2500) // reveal tick: near + FOV + line of sight
    await testBot.mark('I-revealed')
    await h.tp('TestBot', FAR_AWAY)
    await sleep(3000)
    await testBot.mark('I-end')
    await sleep(200)

    const capture = readCapture(testBot)
    const win = windowBetween(capture, 'I-start', 'I-end')
    result.markers = {
      start: markerEvidence(win.start),
      revealed: markerEvidence(capture.markers['I-revealed']),
      end: markerEvidence(win.end)
    }
    const roomChunks = win.entries.filter(l => l.name === 'level_chunk_with_light' && l.data &&
      l.data.x === ROOM_CHUNK.x && l.data.z === ROOM_CHUNK.z)
    if (!roomChunks.length) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: no chunk packet for ${JSON.stringify(ROOM_CHUNK)} on approach`
      result.durationMs = Date.now() - t0
      addError(`scenario I: ${result.failureReason}`)
      return result
    }
    const firstChunk = roomChunks[0]
    let arrivalState = null
    const arrivalPayload = readChunkPayload(testBot, firstChunk.data)
    if (arrivalPayload) {
      const decoded = cd.decodeChunkData(arrivalPayload)
      arrivalState = cd.getBlockState(decoded, INDEXED_BOOKSHELF_POS.x,
        INDEXED_BOOKSHELF_POS.y, INDEXED_BOOKSHELF_POS.z)
    }
    const updates = win.entries.filter(l => l.name === 'block_update' && l.data && l.data.location &&
      l.data.location.x === INDEXED_BOOKSHELF_POS.x &&
      l.data.location.y === INDEXED_BOOKSHELF_POS.y &&
      l.data.location.z === INDEXED_BOOKSHELF_POS.z && l.seq > firstChunk.seq)
    const revealIdx = []
    updates.forEach((u, i) => { if (cd.stateMatches(u.data.type, BOOKSHELF_RANGE)) revealIdx.push(i) })
    const revealSeen = revealIdx.length > 0
    const lastRevealIdx = revealSeen ? revealIdx[revealIdx.length - 1] : -1
    const rehideUpdates = lastRevealIdx >= 0
      ? updates.slice(lastRevealIdx + 1).filter(u => !cd.stateMatches(u.data.type, BOOKSHELF_RANGE))
      : []
    const lastUpdate = updates[updates.length - 1]
    const finalStateValue = lastUpdate ? lastUpdate.data.type : arrivalState
    const finalStateName = finalStateValue === null || finalStateValue === undefined
      ? 'out_of_world'
      : cd.blockName(finalStateValue)
    const arrivalHidden = arrivalState !== null && arrivalState !== undefined &&
      !cd.stateMatches(arrivalState, BOOKSHELF_RANGE)
    const cacheDirty = finalStateValue !== null && finalStateValue !== undefined &&
      cd.stateMatches(finalStateValue, BOOKSHELF_RANGE)

    result.evidence = Object.assign(result.evidence, {
      roomChunkPackets: roomChunks.length,
      arrivalState: {
        state: arrivalState,
        name: arrivalState === null || arrivalState === undefined ? 'out_of_world' : cd.blockName(arrivalState),
        hidden: arrivalHidden
      },
      blockUpdatesAtBookshelf: updates.map(u => ({ seq: u.seq, state: u.data.type, name: cd.blockName(u.data.type) })),
      revealSeen,
      revealUpdates: revealIdx.length,
      rehideUpdates: rehideUpdates.map(u => ({ seq: u.seq, state: u.data.type, name: cd.blockName(u.data.type) })),
      finalCachedState: { state: finalStateValue === undefined ? null : finalStateValue, name: finalStateName, dirty: cacheDirty },
      indexedBy: 'RCON setblock has no BlockPlaceEvent; the chunk state scan must have indexed this position for the reveal to happen',
      cacheDirty
    })

    const observed = LEAK_CONTROL
      ? (cacheDirty ? 'CACHE_LEAK' : 'NO_CACHE_LEAK')
      : (arrivalHidden && revealSeen && rehideUpdates.length > 0 && !cacheDirty
          ? 'REVEAL_THEN_REHIDE'
          : (cacheDirty ? 'CACHE_LEAK' : 'INCOMPLETE_SEQUENCE'))
    result.outcome = observed
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet
    if (!result.pass) {
      result.failureReason = LEAK_CONTROL
        ? 'baseline did not end with a leaked bookshelf state'
        : (cacheDirty
            ? 'the last state sent for the bookshelf is real - a replaying client would cache it'
            : 'sequence incomplete: expected chunk-hidden arrival, a near reveal, and a far re-hide update')
    }
  } catch (e) {
    try { await h.rcon('forceload remove 100 101') } catch (_) {}
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario I: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// Scenario H: block-state-only BOOKSHELF plus the three block-entity base markers.
// The shelf is far outside the reveal radius and its chunk is forced to resend. A
// sanitized chunk must contain filler states, zero ender-chest/enchanting-table/beacon
// block entities, and a sign block + block entity as the positive control. The beacon
// block entity is the client-side beam source; no beacon state or block entity means the
// client has nothing from which to render a beam.
async function scenarioH (h) {
  const result = {
    id: 'H',
    name: 'base-marker block states/entities and BOOKSHELF state hiding',
    expectation: LEAK_CONTROL ? 'LEAK' : 'HIDDEN',
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'INCONCLUSIVE',
    pass: false,
    evidence: {},
    markers: {}
  }
  const t0 = Date.now()
  try {
    await h.tp('TestBot', STAGE)
    await h.tp('TestBot2', STAGE2)
    await sleep(700)

    await h.rcon('fill 50 -60 7 58 -60 12 minecraft:stone')
    for (const marker of BASE_MARKERS) {
      await h.rcon(`setblock ${marker.pos.x} ${marker.pos.y} ${marker.pos.z} minecraft:${marker.material}`)
    }
    await h.rcon(`setblock ${MARKER_SIGN_POS.x} ${MARKER_SIGN_POS.y} ${MARKER_SIGN_POS.z} minecraft:oak_sign[rotation=0]`)
    await sleep(700)

    const serverData = {}
    for (const marker of BASE_MARKERS) {
      serverData[marker.key] = await h.rcon(`data get block ${marker.pos.x} ${marker.pos.y} ${marker.pos.z}`)
    }
    serverData.sign = await h.rcon(`data get block ${MARKER_SIGN_POS.x} ${MARKER_SIGN_POS.y} ${MARKER_SIGN_POS.z}`)
    result.evidence.fixture = serverData

    const bot = h.bots.testBot
    await bot.mark('H-start')
    await h.tp('TestBot', FAR_AWAY)
    await sleep(1400)
    await bot.mark('H-back')
    await h.tp('TestBot', STAGE)
    // Chunk 3 is close enough to arrive reliably within the first chunk batch;
    // wait for that batch instead of the whole view-distance stream to go quiet.
    await sleep(3200)
    await bot.mark('H-end')
    await sleep(200)

    const capture = readCapture(bot)
    const win = windowBetween(capture, 'H-back', 'H-end')
    result.markers = { start: markerEvidence(capture.markers['H-start']), back: markerEvidence(capture.markers['H-back']), end: markerEvidence(capture.markers['H-end']) }
    const chunkEntries = win.entries.filter(l => l.name === 'level_chunk_with_light' && l.data && l.data.x === MARKER_CHUNK.x && l.data.z === MARKER_CHUNK.z)
    result.evidence.chunkPacketsForMarkerChunk = chunkEntries.length
    if (!chunkEntries.length) {
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = `fixture failure: no chunk packet for (${MARKER_CHUNK.x},${MARKER_CHUNK.z}) after returning`
      result.pass = false
      addError(`scenario H: ${result.failureReason}`)
      result.durationMs = Date.now() - t0
      return result
    }
    const lastChunk = chunkEntries[chunkEntries.length - 1]
    const payload = readChunkPayload(bot, lastChunk.data)
    if (!payload) throw new Error(`chunk payload missing for seq ${lastChunk.seq} in ${bot.chunkDir}`)
    const decoded = cd.decodeChunkData(payload)
    const stateAt = (p) => {
      const state = cd.getBlockState(decoded, p.x, p.y, p.z)
      return { state, name: state === null ? 'out_of_world' : cd.blockName(state) }
    }
    const blockEntities = (lastChunk.data.blockEntities && lastChunk.data.blockEntities.entries) || []
    const markerStates = {}
    let allStatesHidden = true
    for (const marker of BASE_MARKERS) {
      const state = stateAt(marker.pos)
      const leaked = state.state !== null && cd.stateMatches(state.state, marker.range)
      markerStates[marker.key] = { ...state, leaked }
      if (leaked) allStatesHidden = false
    }
    const hiddenEntityNames = new Set(['ender_chest', 'enchanting_table', 'beacon'])
    const hiddenEntityHits = blockEntities.filter(be => {
      const name = String(be.typeName || '').replace(/^minecraft:/, '')
      return hiddenEntityNames.has(name)
    })
    const beaconLocation = BASE_MARKERS.find(marker => marker.key === 'beacon').pos
    const beaconBlockEntityDataPackets = win.entries.filter(line =>
      line.name === 'block_entity_data' && line.data && line.data.location &&
      line.data.location.x === beaconLocation.x && line.data.location.y === beaconLocation.y &&
      line.data.location.z === beaconLocation.z)
    const signState = stateAt(MARKER_SIGN_POS)
    const signStatePresent = signState.state !== null && cd.stateMatches(signState.state, OAK_SIGN_RANGE)
    const signEntityPresent = blockEntities.some(be => {
      const name = String(be.typeName || '').replace(/^minecraft:/, '')
      return name === 'sign' || name === 'oak_sign'
    })
    const beaconBeamSourcePresent = markerStates.beacon.leaked || hiddenEntityHits.some(be =>
      String(be.typeName || '').replace(/^minecraft:/, '') === 'beacon') ||
      beaconBlockEntityDataPackets.length > 0

    result.evidence.markerStates = markerStates
    result.evidence.hiddenBlockEntityHits = hiddenEntityHits
    result.evidence.blockEntityEntries = blockEntities.length
    result.evidence.signControl = { state: signState, statePresent: signStatePresent, blockEntityPresent: signEntityPresent }
    result.evidence.beaconBeamSourcePresent = beaconBeamSourcePresent
    result.evidence.beaconBlockEntityDataPackets = beaconBlockEntityDataPackets.length
    result.evidence.beaconBeamNote = 'beacon beam is client-rendered from its block entity; no beacon state, block entity or BE-data packet was sent'
    result.evidence.packetCountsTestBot = captureStats(capture)

    const observed = allStatesHidden && hiddenEntityHits.length === 0 && !beaconBeamSourcePresent
      ? 'HIDDEN' : 'LEAK'
    result.outcome = observed
    result.expectationMet = observed === result.expectation
    result.pass = result.expectationMet
    if (!signStatePresent || !signEntityPresent) {
      result.pass = false
      result.outcome = 'INCONCLUSIVE'
      result.failureReason = 'positive control failed: the oak sign state and block entity were not both present, so the chunk cannot prove hiding'
    } else if (!result.pass) {
      result.failureReason = `base marker leak: statesHidden=${allStatesHidden} hiddenBlockEntities=${hiddenEntityHits.length} beaconBeamSource=${beaconBeamSourcePresent}`
    }
  } catch (e) {
    result.outcome = 'ERROR'
    result.error = String(e && e.stack || e)
    result.failureReason = 'harness exception: ' + (e && e.message)
    result.pass = false
    addError(`scenario H: ${e.message}`)
  }
  result.durationMs = Date.now() - t0
  return result
}

// ------------------------------------------------------------------ summary + report
function printSummary (report) {
  const line = (s) => console.log(s)
  line('')
  line('================================================================================')
  const mode = report.baselineMode
    ? '[BASELINE - legacy jar, leaks expected]'
    : report.protectionDisabled ? '[PROTECTION DISABLED - current jar, leaks expected]' : '[PLUGIN UNDER TEST]'
  line(`Aegishider integration test  ${mode}`)
  line(`run: ${report.runId}    plugin: ${report.plugin ? path.basename(report.plugin.jarPath) : '?'} (${report.plugin ? report.plugin.sha256.slice(0, 12) : '?'})`)
  if (report.server && report.server.pluginVerification) {
    const v = report.server.pluginVerification
    line(`loaded plugin: ${v.ok ? 'VERIFIED' : 'MISMATCH'} - ${v.expectedName || '?'} v${v.expectedVersion || '?'} sha256=${(v.expectedSha256 || '').slice(0, 12)}${v.reason ? ' | ' + v.reason : ''}`)
  }
  if (report.protectionConfig) {
    const r = report.protectionConfig.restore
    line(`protection: DISABLED for this run (${report.protectionConfig.origin}); config ${r ? (r.ok ? r.action : 'NOT RESTORED') : 'restore pending'}`)
  }
  line(`server boot: ${report.server && report.server.bootMs != null ? report.server.bootMs + 'ms' : 'n/a'}    decoder self-test: ${report.decoderSelfTest && report.decoderSelfTest.ok ? 'OK' : 'FAILED'}`)
  line('--------------------------------------------------------------------------------')
  for (const id of SCENARIO_ORDER) {
    const r = report.scenarios[id]
    if (!r) continue
    const verdict = r.pass ? 'PASS' : (r.outcome === 'INCONCLUSIVE' || r.outcome === 'ERROR' ? 'ERROR' : 'FAIL')
    let detail = ''
    if (id === 'A' || id === 'B') {
      const pb = (r.evidence && r.evidence.perBot) || {}
      const spawns = Object.values(pb).map(b => `${b.username}:${b.itemSpawnPackets ?? b.spawnPackets} spawn`)
      detail = `${spawns.join(', ')}`
      if (id === 'A') detail += `; followups=${r.evidence.totalFollowupPackets ?? 0}`
      if (id === 'B') {
        const first = Object.values(pb).find(b => b.firstSpawnLatencyMs != null)
        detail += `; latency=${first ? first.firstSpawnLatencyMs + 'ms' : 'n/a'}; followups=${Object.values(pb).reduce((n, b) => n + (b.followupPackets || 0), 0)}`
      }
    }
    if (id === 'C') {
      const ch = r.evidence.chestInChunkData
      const obs = r.evidence.decoderPositiveControls && r.evidence.decoderPositiveControls.observerPresent
      detail = `chest_in_chunk=${ch}; observer_marker=${obs}; chest_states_in_section=${r.evidence.chestStatesInSection}`
      if (r.evidence.resend) detail += `; resend_chunk_packets=${r.evidence.resend.chunkPacketsForRoomChunkAfterReturn}`
    }
    if (id === 'D') {
      const bands = (r.evidence && r.evidence.perBand) || {}
      detail = Object.values(bands).map(b => `${b.label}: chunk=${b.chunkPacketsReceived} chest_leak=${b.leak}`).join('; ')
    }
    if (id === 'E') {
      detail = `chunks=${r.evidence.chunkPacketsScanned}; hidden_container_BEs=${r.evidence.hiddenContainerBlockEntities}; sign_BEs=${r.evidence.signBlockEntities}`
    }
    if (id === 'F') {
      const ev = r.evidence || {}
      detail = `arrival_hidden=${ev.arrivalState && ev.arrivalState.hidden}; reveal=${ev.revealSeen}; rehide_updates=${(ev.rehideUpdates || []).length}; final=${ev.finalCachedState && ev.finalCachedState.name}`
    }
    if (id === 'G') {
      const ev = r.evidence || {}
      detail = `gap=${ev.floors && ev.floors.verticalGap} blocks; cross_floor_mobs=${ev.crossFloorMobSpawns ?? '?'}; cross_floor_player_packets=${ev.crossFloorPlayerPackets ?? '?'}; same_floor_player_packets=${ev.sameFloorPlayerPackets ?? '?'}; same_floor_mobs_ok=${ev.sameFloorMobsVisible}`
    }
    if (id === 'H') {
      const ev = r.evidence || {}
      const states = ev.markerStates || {}
      detail = `enders=${states.enderChest && states.enderChest.leaked}; enchanting=${states.enchantingTable && states.enchantingTable.leaked}; beacon=${states.beacon && states.beacon.leaked}; bookshelf=${states.bookshelf && states.bookshelf.leaked}; hidden_BEs=${(ev.hiddenBlockEntityHits || []).length}; beam_source=${ev.beaconBeamSourcePresent}`
    }
    if (id === 'I') {
      const ev = r.evidence || {}
      detail = `arrival_hidden=${ev.arrivalState && ev.arrivalState.hidden}; reveal=${ev.revealSeen}; rehide_updates=${(ev.rehideUpdates || []).length}; final=${ev.finalCachedState && ev.finalCachedState.name}; chunk_latency=${ev.approachChunkLatencyMs}ms`
    }
    line(`[${verdict}] ${id} ${r.name}`)
    line(`       expected=${r.expectation} observed=${r.outcome} ${detail} ${r.failureReason ? '\n       reason: ' + r.failureReason : ''} (${r.durationMs}ms)`)
  }
  line('--------------------------------------------------------------------------------')
  line(`OVERALL: ${report.overall.pass ? 'PASS' : 'FAIL'} (${report.overall.reason})`)
  if (report.artifacts.captures) {
    for (const [name, p] of Object.entries(report.artifacts.captures)) line(`capture ${name}: ${p}`)
  }
  if (report.server && report.server.logPath) line(`server log: ${report.server.logPath}`)
  line(`report: ${report.artifacts.reportPath}`)
  line('================================================================================')
}

// ------------------------------------------------------------------ main
async function main () {
  if (PROTECTION_DISABLED && !JAR_ARG_GIVEN) {
    throw new Error('--protection-disabled needs an explicit --jar <path>: it is a leak control for a known build, not a legacy-baseline run')
  }
  const runId = `run-${stamp()}`
  report.runId = runId
  const runDir = path.join(OUT_DIR, runId)
  fs.mkdirSync(runDir, { recursive: true })
  report.artifacts.runDir = runDir

  // --- plugin metadata -------------------------------------------------------
  if (!fs.existsSync(JAR_PATH)) throw new Error(`plugin jar not found: ${JAR_PATH}`)
  const jarStat = fs.statSync(JAR_PATH)
  let pluginYml = null
  try {
    pluginYml = pluginYmlFromJar(JAR_PATH, runDir, 'plugin-yml')
  } catch (e) {
    addError(`could not read plugin.yml from jar: ${e.message}`)
  }
  report.plugin = {
    jarPath: JAR_PATH,
    size: jarStat.size,
    sha256: sha256(JAR_PATH),
    pluginYmlName: pluginYml ? pluginYml.name : null,
    pluginYmlVersion: pluginYml ? pluginYml.version : null,
    packetEventsInstalled: fs.existsSync(path.join(SERVER_DIR, 'plugins', 'PacketEvents.jar'))
  }

  // --- chunk decoder self-test ----------------------------------------------
  report.decoderSelfTest = cd.selfTest()

  // --- server ----------------------------------------------------------------
  const server = new PaperServer(runDir)
  const bots = {
    testBot: new BotHandle('TestBot', runDir),
    testBot2: new BotHandle('TestBot2', runDir)
  }
  activeServer = server
  activeBots = bots
  installExitGuards()
  report.server = {
    dir: SERVER_DIR,
    jar: path.join(SERVER_DIR, 'paper-1.21.4.jar'),
    port: SERVER_PORT,
    rconPort: RCON_PORT,
    logPath: server.logPath,
    bootMs: null,
    versionLine: null,
    rconReady: false,
    crashDetected: false
  }
  report.artifacts.captures = {}
  report.artifacts.chunkDirs = {}
  report.artifacts.botStderrLogs = {}
  for (const bot of Object.values(bots)) {
    report.artifacts.captures[bot.name] = bot.ndjsonPath
    report.artifacts.chunkDirs[bot.name] = bot.chunkDir
    report.artifacts.botStderrLogs[bot.name] = bot.stderrPath
  }

  let exitCode = 2
  try {
    await server.preflight()
    const installed = server.installPluginJar()
    report.server.pluginJar = installed
    console.log(`[driver] plugin jar ${installed.changed ? 'installed' : 'already current'}: ${path.basename(JAR_PATH)} -> plugins/Aegishider.jar (${installed.sha256.slice(0, 12)})`)
    if (PROTECTION_DISABLED) {
      report.protectionConfig = beginProtectionDisabled(installed.path, runDir)
      console.log(`[driver] --protection-disabled: ${report.protectionConfig.origin}, ${report.protectionConfig.worldsChanged} world(s) disabled in ${CONFIG_PATH}; the original is restored when the run ends`)
    }
    console.log(`[driver] starting Paper server on port ${SERVER_PORT} (log: ${server.logPath})`)
    server.start()
    const bootMs = await server.waitForDone(BOOT_TIMEOUT_MS)
    report.server.bootMs = bootMs
    report.server.pid = server.proc && server.proc.pid
    report.server.pidFile = SERVER_PID_FILE
    const versionLine = server.lines.find(l => /Starting minecraft server version|Loading Paper/.test(l))
    report.server.versionLine = versionLine ? versionLine.trim() : null
    // Proof of which build actually loaded, independent of the --jar argument.
    const pluginLine = server.lines.find(l => /Loading server plugin (Aegishider|BaseHider) v/.test(l))
    report.server.pluginLoadLine = pluginLine ? pluginLine.trim() : null
    console.log(`[driver] loaded: ${report.server.pluginLoadLine || 'plugin load line not found'}`)
    // Hard integrity gate: a scenario result means nothing if a different jar loaded.
    const verification = verifyLoadedPlugin(server, installed, { name: report.plugin.pluginYmlName, version: report.plugin.pluginYmlVersion }, runDir)
    report.server.pluginVerification = verification
    if (!verification.ok) throw new Error(`plugin load verification failed: ${verification.reason}`)
    console.log(`[driver] plugin verified: ${verification.expectedName} v${verification.expectedVersion} sha256=${verification.expectedSha256.slice(0, 12)} (loaded plugin matches the installed jar)`)
    console.log(`[driver] server ready after ${bootMs}ms: ${versionLine ? versionLine.trim() : ''}`)
    await server.connectRcon()
    report.server.rconReady = true
    // Detect a server crash while scenarios run (report it once).
    let crashReported = false
    const crashWatcher = setInterval(() => {
      if (server.exited && !server.stopped && !crashReported) {
        crashReported = true
        report.server.crashDetected = true
        addError('Paper server exited unexpectedly during the test run')
      }
    }, 500)
    crashWatcher.unref()

    // --- bots ---------------------------------------------------------------
    for (const bot of Object.values(bots)) bot.start()
    const [ready1, ready2] = await Promise.all([bots.testBot.waitReady(), bots.testBot2.waitReady()])
    report.bots = { TestBot: ready1, TestBot2: ready2 }
    console.log(`[driver] bots ready: ${ready1.username} entity=${ready1.entityId} @ ${ready1.position.x},${ready1.position.y},${ready1.position.z}; ${ready2.username} entity=${ready2.entityId}`)
    // Creative mode is needed for the bot-side chest placement in scenario C.
    for (const name of Object.keys(bots)) {
      try { await server.rconCmd(`gamemode creative ${name}`) } catch (e) { addError(`gamemode creative ${name}: ${e.message}`) }
    }
    // On a wiped world the first join is still generating/saving when the bots are
    // "ready"; start fixtures only after that burst has finished (bounded).
    const settled = await waitForWorldSettled(server, Object.values(bots))
    report.server.settle = settled
    console.log(`[driver] world settled after ${settled.ms}ms (stall lines: ${settled.stallLines}${settled.timedOut ? ', TIMEOUT' : ''})`)

    const harness = new Harness(server, bots)
    const assertServerAlive = async (stage) => {
      await sleep(250) // let the child-process 'exit' event be delivered
      const exitCode = server.proc ? server.proc.exitCode : null
      if ((server.exited || exitCode !== null) && !server.stopped) {
        throw new Error(`Paper server process died unexpectedly during ${stage} (exit=${JSON.stringify(server.exitInfo || { code: exitCode })}); see ${server.logPath}`)
      }
    }
    if (which.includes('A')) {
      await assertServerAlive('startup')
      console.log('[driver] scenario A: hidden dropped item ...')
      report.scenarios.A = await scenarioA(harness)
      printScenarioProgress(report.scenarios.A)
      await assertServerAlive('scenario A')
    }
    if (which.includes('B')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario B: visible dropped item ...')
      report.scenarios.B = await scenarioB(harness)
      printScenarioProgress(report.scenarios.B)
      await assertServerAlive('scenario B')
    }
    if (which.includes('C')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario C: chunk-level chest hiding ...')
      report.scenarios.C = await scenarioC(harness)
      printScenarioProgress(report.scenarios.C)
      await assertServerAlive('scenario C')
    }
    if (which.includes('D')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario D: far-band block-entity leak (160/336 blocks) ...')
      report.scenarios.D = await scenarioD(harness)
      printScenarioProgress(report.scenarios.D)
      await assertServerAlive('scenario D')
    }
    if (which.includes('E')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario E: pie-ray client block-entity registry scan ...')
      report.scenarios.E = await scenarioE(harness)
      printScenarioProgress(report.scenarios.E)
      await assertServerAlive('scenario E')
    }
    if (which.includes('F')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario F: Bobby/Distant Horizons cache replay ...')
      report.scenarios.F = await scenarioF(harness)
      printScenarioProgress(report.scenarios.F)
      await assertServerAlive('scenario F')
    }
    if (which.includes('G')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario G: vertical entity band (base y=-50 vs surface y=64) ...')
      report.scenarios.G = await scenarioG(harness)
      printScenarioProgress(report.scenarios.G)
      await assertServerAlive('scenario G')
    }
    if (which.includes('H')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario H: base-marker states/entities and BOOKSHELF ...')
      report.scenarios.H = await scenarioH(harness)
      printScenarioProgress(report.scenarios.H)
      await assertServerAlive('scenario H')
    }
    if (which.includes('I')) {
      await assertServerAlive('between scenarios')
      console.log('[driver] scenario I: indexed BOOKSHELF reveal/re-hide ...')
      report.scenarios.I = await scenarioI(harness)
      printScenarioProgress(report.scenarios.I)
      await assertServerAlive('scenario I')
    }
    report.rconTrace = harness.rconTrace
  } catch (e) {
    addError(`harness failure: ${e && e.stack || e}`)
    report.overall = { pass: false, reason: `harness error: ${e && e.message}` }
  } finally {
    // --- teardown -----------------------------------------------------------
    // One path for a finished/failed run and for Ctrl-C/SIGTERM: it stops Paper and
    // restores the harness config before this process is allowed to exit.
    await teardownRun(KEEP_SERVER ? 'keep-server' : 'run-finished')
  }

  // --- verdict ---------------------------------------------------------------
  const scenarioIds = Object.keys(report.scenarios)
  const missingScenarios = which.filter(id => !report.scenarios[id])
  const pluginVerified = !!(report.server && report.server.pluginVerification && report.server.pluginVerification.ok)
  const protectionRestored = !PROTECTION_DISABLED || !!(report.protectionConfig && report.protectionConfig.restore && report.protectionConfig.restore.ok)
  if (report.overall.reason !== 'not-finished' && report.overall.reason.startsWith('harness error')) {
    exitCode = 2
  } else if (!pluginVerified) {
    report.overall = { pass: false, reason: 'plugin load verification failed - the loaded plugin is not the installed jar' }
    exitCode = 2
  } else if (!protectionRestored) {
    report.overall = { pass: false, reason: '--protection-disabled did not restore the harness config' }
    exitCode = 2
  } else if (!missingScenarios.length && which.every(id => report.scenarios[id].pass) && !report.server.crashDetected) {
    report.overall = {
      pass: true,
      reason: LEAK_CONTROL
        ? 'leak-control validation passed - all expected leaks/visibility differences were detected'
        : 'all scenarios meet plugin expectations (items hidden/visible, chunk + far-band containers hidden, clean client BE registry, cache re-hidden, vertical entity band hidden)'
    }
    exitCode = 0
  } else {
    const failed = missingScenarios.length ? missingScenarios : scenarioIds.filter(id => !report.scenarios[id].pass)
    report.overall = { pass: false, reason: `failed scenarios: ${failed.join(', ') || 'none recorded'}` }
    exitCode = 1
  }
  report.finishedAt = nowIso()
  report.durationMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt)
  report.artifacts.consoleLog = server.logPath
  report.artifacts.dedup = undefined

  // --- write report ----------------------------------------------------------
  const reportPath = path.join(OUT_DIR, `report-${stamp()}.json`)
  report.artifacts.reportPath = reportPath
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(OUT_DIR, 'latest-report.json'), JSON.stringify(report, null, 2))
  printSummary(report)
  process.exit(exitCode)
}

function printScenarioProgress (r) {
  const icon = r.pass ? 'PASS' : (r.outcome === 'ERROR' || r.outcome === 'INCONCLUSIVE' ? 'ERROR' : 'FAIL')
  console.log(`[driver] scenario ${r.id}: ${icon} expectation=${r.expectation} observed=${r.outcome} (${r.durationMs}ms)`)
}

main().catch((e) => {
  console.error('[driver] FATAL', e && e.stack || e)
  report.overall = { pass: false, reason: `fatal: ${e && e.message}` }
  try { fs.writeFileSync(path.join(OUT_DIR, 'latest-report.json'), JSON.stringify(report, null, 2)) } catch (_) {}
  process.exit(2)
})
