#!/usr/bin/env node
'use strict'
/**
 * Headless Minecraft Java 1.21.4 capture bot for the Aegishider end-to-end harness.
 *
 * Connects to a local offline-mode Paper server with minecraft-protocol, records
 * EVERY received packet as an NDJSON line:
 *
 *   {"seq":12,"timestampMs":1763..., "tRelMs":512, "state":"play", "name":"spawn_entity",
 *    "rawName":"spawn_entity", "data":{...summarized...}}
 *
 * Chunk payloads (large) are written as sidecar .bin files and referenced from the
 * NDJSON line ("chunkDataFile"), so the palette decoder can be run later without
 * blowing up the capture file.
 *
 * stdin commands (one JSON object per line):
 *   {"cmd":"mark","label":"A-start"}                 -> NDJSON marker
 *   {"cmd":"status"}                                 -> NDJSON __status__ with position
 *   {"cmd":"place","block":"chest","x":..,"y":..,"z":..,"face":1,"cursorX":0.5,...}
 *                                                    -> creative-inventory block placement
 *   {"cmd":"say","message":"..."}                    -> chat message (visible in server log)
 *   {"cmd":"quit"}                                   -> clean disconnect + exit
 *
 * stdout emits machine-readable control lines:
 *   BOT_READY {...}   BOT_MARKED {...}   BOT_PLACED {...}   BOT_EXITING {...}
 * stderr carries diagnostics / packet parse errors.
 */
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const mc = require('minecraft-protocol')

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
const args = parseArgs(process.argv.slice(2))
const USERNAME = String(args.username || 'TestBot')
const HOST = String(args.host || '127.0.0.1')
const PORT = parseInt(args.port || '25599', 10)
const OUT = path.resolve(String(args.out || `out/${USERNAME}.ndjson`))
const CHUNK_DIR = path.resolve(String(args['chunk-dir'] || path.join(path.dirname(OUT), `${USERNAME}-chunks`)))
const MAX_MS = parseInt(args['max-ms'] || '600000', 10)
const VERSION = String(args.version || '1.21.4')
// Must be >= the server's view-distance for the far-band chunk-leak scenarios,
// otherwise the client tells the server to shrink its send radius.
const CLIENT_VIEW_DISTANCE = Math.min(32, parseInt(args['view-distance'] || '32', 10))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.mkdirSync(CHUNK_DIR, { recursive: true })
// One append-only pack per viewer instead of one file per chunk. A freshly wiped
// world streams thousands of chunks per viewer on first join; creating a file for
// each one competes with Paper's own region/player saves on the same filesystem
// (observed as the server blocked in File#createTempFile and
// MoonriseRegionFileIO.scheduleSave while it committed the new world).
const CHUNK_PACK = path.join(CHUNK_DIR, 'chunks.pack')
const chunkPackFd = fs.openSync(CHUNK_PACK, 'w')
let chunkPackOffset = 0
function writeChunkPayload (buf) {
  const offset = chunkPackOffset
  let written = 0
  while (written < buf.length) {
    written += fs.writeSync(chunkPackFd, buf, written, buf.length - written)
  }
  chunkPackOffset += buf.length
  return offset
}
process.on('exit', () => {
  try { fs.closeSync(chunkPackFd) } catch (_) {}
})

const out = fs.createWriteStream(OUT, { flags: 'w' })
let seq = 0
let t0 = Date.now()
let closed = false
function writeLine (obj) {
  if (closed) return
  try { out.write(JSON.stringify(obj) + '\n') } catch (e) { process.stderr.write(`ndjson write error: ${e.message}\n`) }
}
function emitPacket (state, name, data, extra) {
  seq++
  const obj = {
    seq,
    timestampMs: Date.now(),
    tRelMs: Date.now() - t0,
    state,
    name: normalizeName(name),
    rawName: name,
    data
  }
  if (extra) Object.assign(obj, extra)
  writeLine(obj)
}
function marker (label, data) {
  writeLine({ seq: ++seq, timestampMs: Date.now(), tRelMs: Date.now() - t0, state: 'marker', name: '__marker__', rawName: '__marker__', data: Object.assign({ label }, data || {}) })
  process.stdout.write(`BOT_MARKED ${JSON.stringify({ username: USERNAME, label })}\n`)
}

// Canonical 1.21.4 packet names used by the scenarios. minecraft-data names a few
// packets differently from the vanilla protocol docs; keep both.
const NAME_ALIAS = {
  map_chunk: 'level_chunk_with_light',
  tile_entity_data: 'block_entity_data',
  entity_metadata: 'set_entity_metadata',
  entity_destroy: 'remove_entities',
  unload_chunk: 'forget_level_chunk',
  multi_block_change: 'multi_block_change',
  block_change: 'block_update'
}
function normalizeName (n) { return NAME_ALIAS[n] || n }

// ------------------------------------------------------------------ NBT helpers
// prismarine-nbt (used by minecraft-protocol) wraps values as
// { type:'compound', name:'', value:{ key:{ type:'string', value:'x' } } }.
// On 1.21.4 the chunk block-entity NBT carries NO "id" string (verified in a
// live capture: sign entities only have front_text/is_waxed/back_text), so the
// numeric registry id is the only type information a client receives. This
// table is resolved from PacketEvents' assets/mappings/registries/
// block_entity_type.nbt: V_1_19_3 base list + every version delta up to
// V_1_21_2 (changes apply to the old list, then additions insert, then
// removals). The live capture agrees: chest=1, sign=7.
const BLOCK_ENTITY_TYPE_IDS = [
  'furnace', 'chest', 'trapped_chest', 'ender_chest', 'jukebox',
  'dispenser', 'dropper', 'sign', 'hanging_sign', 'mob_spawner',
  'creaking_heart', 'piston', 'brewing_stand', 'enchanting_table',
  'end_portal', 'beacon', 'skull', 'daylight_detector', 'hopper',
  'comparator', 'banner', 'structure_block', 'end_gateway',
  'command_block', 'shulker_box', 'bed', 'conduit', 'barrel', 'smoker',
  'blast_furnace', 'lectern', 'bell', 'jigsaw', 'campfire', 'beehive',
  'sculk_sensor', 'calibrated_sculk_sensor', 'sculk_catalyst',
  'sculk_shrieker', 'chiseled_bookshelf', 'brushable_block',
  'decorated_pot', 'crafter', 'trial_spawner', 'vault'
]
function blockEntityTypeName (typeId) {
  if (!Number.isInteger(typeId) || typeId < 0 || typeId >= BLOCK_ENTITY_TYPE_IDS.length) return null
  return BLOCK_ENTITY_TYPE_IDS[typeId]
}
function nbtCompound (nbtData) {
  if (!nbtData || typeof nbtData !== 'object') return null
  const value = nbtData.value
  if (!value || typeof value !== 'object') return null
  return value
}
function nbtFieldValue (nbtData, key) {
  const compound = nbtCompound(nbtData)
  if (!compound) return null
  const field = compound[key]
  if (!field || typeof field !== 'object') return null
  return field.value === undefined ? field : field.value
}
function nbtStringValue (nbtData, key) {
  const v = nbtFieldValue(nbtData, key)
  return typeof v === 'string' ? v : null
}
function nbtIntValue (nbtData, key) {
  const v = nbtFieldValue(nbtData, key)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'bigint') return Number(v)
  return null
}
function summarizeBlockEntities (chunkX, chunkZ, blockEntities) {
  if (!Array.isArray(blockEntities)) return null
  const cap = 128 // far more than the fixtures ever contain; bounds NDJSON growth
  const out = []
  for (const be of blockEntities.slice(0, cap)) {
    const nbtTypeName = nbtStringValue(be && be.nbtData, 'id')
    const registryTypeName = be ? blockEntityTypeName(be.type) : null
    const typeName = nbtTypeName || registryTypeName
    const nbtX = nbtIntValue(be && be.nbtData, 'x')
    const nbtY = nbtIntValue(be && be.nbtData, 'y')
    const nbtZ = nbtIntValue(be && be.nbtData, 'z')
    const localX = Number.isFinite(be && be.x) ? be.x : null
    const localZ = Number.isFinite(be && be.z) ? be.z : null
    const y = nbtY !== null ? nbtY : (Number.isFinite(be && be.y) ? be.y : null)
    const worldX = nbtX !== null ? nbtX : (localX !== null ? chunkX * 16 + localX : null)
    const worldZ = nbtZ !== null ? nbtZ : (localZ !== null ? chunkZ * 16 + localZ : null)
    out.push({
      worldX,
      worldZ,
      y,
      xLocal: localX,
      zLocal: localZ,
      type: be ? be.type : null,
      typeName,
      typeSource: nbtTypeName ? 'nbt' : (registryTypeName ? 'registry' : null),
      nbtKeys: (() => { const c = nbtCompound(be && be.nbtData); return c ? Object.keys(c).slice(0, 12) : null })()
    })
  }
  return { count: blockEntities.length, entries: out }
}

// ------------------------------------------------------------------ summarizer
function safeJson (v, depth) {
  depth = depth || 0
  if (v === null || v === undefined) return null
  const t = typeof v
  if (t === 'number') return Number.isFinite(v) ? v : String(v)
  if (t === 'string' || t === 'boolean') return v
  if (t === 'bigint') return v.toString()
  if (Buffer.isBuffer(v)) return { __buffer__: v.length }
  if (Array.isArray(v)) {
    if (depth > 3) return { __array_len__: v.length }
    if (v.length > 256) {
      // Keep a few leading elements for context; large arrays are summarised to keep NDJSON small.
      return { __array_len__: v.length, first: v.slice(0, 8).map(x => safeJson(x, depth + 1)) }
    }
    return v.map(x => safeJson(x, depth + 1))
  }
  if (t === 'object') {
    if (v.constructor && v.constructor.name === 'Date') return v.toISOString()
    if (depth > 5) return { __object__: true }
    const o = {}
    for (const k of Object.keys(v)) o[k] = safeJson(v[k], depth + 1)
    return o
  }
  return String(v)
}

function summarize (name, data) {
  if (!data || typeof data !== 'object') return safeJson(data)
  switch (name) {
    case 'map_chunk': {
      const chunkData = data.chunkData
      const chunkX = data.x
      const chunkZ = data.z
      let chunkDataFile = null
      let chunkDataOffset = null
      let len = 0
      if (Buffer.isBuffer(chunkData)) {
        // The payload is on disk before the NDJSON line that points at it is
        // written, so a scenario can always resolve seq -> offset -> bytes.
        chunkDataOffset = writeChunkPayload(chunkData)
        chunkDataFile = path.basename(CHUNK_PACK)
        len = chunkData.length
      }
      return {
        x: chunkX,
        z: chunkZ,
        chunkDataFile,
        chunkDataOffset,
        chunkDataLen: len,
        blockEntityCount: Array.isArray(data.blockEntities) ? data.blockEntities.length : null,
        blockEntities: summarizeBlockEntities(chunkX, chunkZ, data.blockEntities),
        heightmapsPresent: data.heightmaps != null,
        light: {
          skyLightMask: safeJson(data.skyLightMask),
          blockLightMask: safeJson(data.blockLightMask),
          emptySkyLightMask: safeJson(data.emptySkyLightMask),
          emptyBlockLightMask: safeJson(data.emptyBlockLightMask),
          skyLightSections: Array.isArray(data.skyLight) ? data.skyLight.length : null,
          blockLightSections: Array.isArray(data.blockLight) ? data.blockLight.length : null
        }
      }
    }
    case 'tile_entity_data':
      return {
        location: safeJson(data.location),
        action: data.action,
        nbtId: nbtStringValue(data.nbtData, 'id'),
        nbt: safeJson(data.nbtData)
      }
    case 'update_light':
      return {
        chunkX: data.chunkX,
        chunkZ: data.chunkZ,
        skyLightMask: safeJson(data.skyLightMask),
        blockLightMask: safeJson(data.blockLightMask),
        emptySkyLightMask: safeJson(data.emptySkyLightMask),
        emptyBlockLightMask: safeJson(data.emptyBlockLightMask),
        skyLightSections: Array.isArray(data.skyLight) ? data.skyLight.map(a => (a ? a.length : null) || a) : null,
        blockLightSections: Array.isArray(data.blockLight) ? data.blockLight.map(a => (a ? a.length : null) || a) : null
      }
    case 'spawn_entity':
    case 'spawn_entity_experience_orb':
    case 'entity_metadata':
    case 'rel_entity_move':
    case 'entity_move_look':
    case 'entity_look':
    case 'entity_teleport':
    case 'entity_velocity':
    case 'entity_head_rotation':
    case 'entity_destroy':
    case 'block_change':
    case 'multi_block_change':
    case 'block_action':
    case 'unload_chunk':
    case 'login':
    case 'position':
    case 'respawn':
    case 'keep_alive':
    case 'game_state_change':
    case 'chunk_batch_start':
    case 'chunk_batch_finished':
    case 'update_view_position':
      return safeJson(data)
    default: {
      const s = safeJson(data)
      let json
      try { json = JSON.stringify(s) } catch (e) { json = '"[unserializable]"' }
      if (json && json.length > 4096) {
        return { __truncated__: true, size: json.length, preview: json.slice(0, 512) }
      }
      return s
    }
  }
}

// ------------------------------------------------------------------ client
let client = null
let myEntityId = null
let myPos = null
let sawLogin = false
let sawPosition = false
let sawChunk = false
let readySent = false
let placeSequence = 0

function emitStatus () {
  marker('__status__', { entityId: myEntityId, position: myPos })
}

function start () {
  t0 = Date.now()
  client = mc.createClient({
    host: HOST,
    port: PORT,
    username: USERNAME,
    version: VERSION,
    auth: 'offline',
    hideErrors: false,
    clientSettings: { viewDistance: CLIENT_VIEW_DISTANCE }
  })

  client.on('connect', () => {
    emitPacket('meta', '__connect__', { host: HOST, port: PORT, username: USERNAME, version: VERSION })
    process.stdout.write(`BOT_CONNECTED ${JSON.stringify({ username: USERNAME, host: HOST, port: PORT })}\n`)
  })

  client.on('packet', (data, meta) => {
    if (!meta) return
    const state = meta.state || (client && client.state) || 'unknown'
    emitPacket(state, meta.name, summarize(meta.name, data))
  })

  client.on('login', (packet) => {
    sawLogin = true
    myEntityId = packet.entityId
    emitPacket('play', '__login_event__', { entityId: packet.entityId, worldState: safeJson(packet.worldState) })
  })

  client.on('position', (packet) => {
    myPos = { x: packet.x, y: packet.y, z: packet.z, yaw: packet.yaw, pitch: packet.pitch }
    // Required handshake: confirm every server teleport so chunk streaming continues.
    try {
      client.write('teleport_confirm', { teleportId: packet.teleportId })
    } catch (e) {
      process.stderr.write(`teleport_confirm error: ${e.message}\n`)
    }
    // Report our authoritative position back to the server so entity tracking works.
    try {
      client.write('position_look', {
        x: packet.x,
        y: packet.y,
        z: packet.z,
        yaw: packet.yaw,
        pitch: packet.pitch,
        flags: 0
      })
    } catch (e) { /* older clients may reject; harmless */ }
    sawPosition = true
    maybeReady()
  })

  client.on('rel_entity_move', (p) => {
    if (p.entityId === myEntityId) maybeReady()
  })

  client.on('map_chunk', () => {
    sawChunk = true
    maybeReady()
  })

  client.on('kick_disconnect', (p) => {
    marker('__kicked__', { reason: safeJson(p.reason) })
    process.stderr.write(`kicked: ${JSON.stringify(safeJson(p.reason))}\n`)
    finish(3)
  })
  client.on('disconnect', (p) => {
    marker('__disconnected__', { reason: safeJson(p && p.reason) })
  })

  client.on('error', (err) => {
    // Packet parse errors do not necessarily kill the connection; keep capturing.
    writeLine({ seq: ++seq, timestampMs: Date.now(), tRelMs: Date.now() - t0, state: 'error', name: '__error__', rawName: '__error__', data: { message: String(err && err.message), field: err && err.field } })
    process.stderr.write(`BOT_ERROR ${err && err.message}\n`)
  })

  client.on('end', (reason) => {
    marker('__end__', { reason: String(reason || '') })
    finish(0)
  })

  const readyTimer = setInterval(() => {
    if (sawLogin && sawPosition && sawChunk) {
      clearInterval(readyTimer)
      setTimeout(() => { if (!readySent) maybeReady(true) }, 400) // let initial chunks stream in
    }
  }, 100)

  const lifetime = setTimeout(() => {
    process.stderr.write('BOT_TIMEOUT lifetime exceeded\n')
    markExit(4, 'timeout')
  }, MAX_MS)
  lifetime.unref()
}

function maybeReady (force) {
  if (readySent) return
  if (!(sawLogin && sawPosition && (sawChunk || force))) return
  readySent = true
  const payload = { username: USERNAME, entityId: myEntityId, position: myPos }
  marker('__ready__', payload)
  process.stdout.write(`BOT_READY ${JSON.stringify(payload)}\n`)
}

// ------------------------------------------------------------------ stdin commands
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  line = line.trim()
  if (!line) return
  let cmd
  try { cmd = JSON.parse(line) } catch (e) {
    process.stderr.write(`bad command json: ${line}\n`)
    return
  }
  try {
    switch (cmd.cmd) {
      case 'mark':
        marker(String(cmd.label || 'mark'), cmd.data)
        break
      case 'status':
        emitStatus()
        break
      case 'say':
        if (client && client.state === 'play') client.write('chat_message', { message: String(cmd.message || ''), timestamp: BigInt(Date.now()), salt: 0n, signature: null, offset: 0 })
        break
      case 'place':
        doPlace(cmd)
        break
      case 'quit':
        markExit(0, 'quit')
        break
      default:
        process.stderr.write(`unknown command: ${cmd.cmd}\n`)
    }
  } catch (e) {
    process.stderr.write(`command error: ${e.message}\n`)
  }
})

function itemStackFor (blockName) {
  const md = require('minecraft-data')('1.21.4')
  const item = md.itemsByName[blockName]
  if (!item) throw new Error(`unknown item ${blockName}`)
  return {
    itemCount: 1,
    itemId: item.id,
    addedComponentCount: 0,
    removedComponentCount: 0,
    components: [],
    removeComponents: []
  }
}

function doPlace (cmd) {
  const blockName = String(cmd.block || 'chest').replace(/^minecraft:/, '')
  const item = itemStackFor(blockName)
  // 1) put the item in hotbar slot 0 of the (creative) inventory
  client.write('set_creative_slot', { slot: 36, item })
  // 2) select hotbar slot 0
  client.write('held_item_slot', { slotId: 0 })
  const hand = 0
  const location = { x: Math.trunc(cmd.x), y: Math.trunc(cmd.y), z: Math.trunc(cmd.z) }
  const direction = cmd.face === undefined ? 1 : Math.trunc(cmd.face)
  const cursorX = cmd.cursorX === undefined ? 0.5 : Number(cmd.cursorX)
  const cursorY = cmd.cursorY === undefined ? 0.5 : Number(cmd.cursorY)
  const cursorZ = cmd.cursorZ === undefined ? 0.5 : Number(cmd.cursorZ)
  const sequence = ++placeSequence
  setTimeout(() => {
    try {
      client.write('block_place', {
        hand,
        location,
        direction,
        cursorX,
        cursorY,
        cursorZ,
        insideBlock: false,
        worldBorderHit: false,
        sequence
      })
      const payload = { block: blockName, location, direction, sequence, itemId: item.itemId }
      marker('__place_sent__', payload)
      process.stdout.write(`BOT_PLACED ${JSON.stringify(payload)}\n`)
    } catch (e) {
      process.stderr.write(`place write error: ${e.message}\n`)
      process.stdout.write(`BOT_PLACE_ERROR ${JSON.stringify({ message: e.message })}\n`)
    }
  }, 150)
}

function markExit (code, reason) {
  marker('__bot_exit__', { reason, code })
  process.stdout.write(`BOT_EXITING ${JSON.stringify({ username: USERNAME, reason, code })}\n`)
  finish(code)
}

let finishing = false
function finish (code) {
  if (finishing) return
  finishing = true
  try { client && client.end('bot-finish') } catch (_) {}
  closed = true
  out.end(() => {
    setTimeout(() => process.exit(code), 50)
  })
  setTimeout(() => process.exit(code), 1500).unref()
}

process.on('SIGINT', () => markExit(0, 'sigint'))
process.on('SIGTERM', () => markExit(0, 'sigterm'))
process.on('uncaughtException', (err) => {
  process.stderr.write(`BOT_UNCAUGHT ${err && err.stack}\n`)
  markExit(5, 'uncaughtException')
})

start()
