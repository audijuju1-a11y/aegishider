'use strict'
/**
 * Minecraft Java Edition 1.21.4 (protocol 769) chunk section / paletted container decoder.
 *
 * Wire format implemented here, per the 1.21.4 protocol and cross-checked against
 * prismarine-chunk's 1.18+ implementation used for 1.21.x:
 *
 *   Chunk data blob (as sent inside "map_chunk"/level_chunk_with_light, after the
 *   packet-level heightmaps and before the separate block-entities array):
 *     repeat for every vertical section (world_height / 16 = 24 in the overworld):
 *       block_states: paletted container  (short block_count, then container)
 *       biomes:       paletted container
 *
 *   Paletted container (1.21.4: every container has a VarInt length prefix before
 *   its long array; 1.21.5+ dropped that prefix):
 *     u8 bits_per_entry
 *     bits_per_entry == 0  -> single value: VarInt value, then u8 size-prefix (0)
 *     0 < bits <= 8       -> indirect: VarInt palette_len, palette entries (VarInt),
 *                            VarInt long_count, long_count * 8 bytes (big endian longs)
 *     bits > 8            -> direct: VarInt long_count, long_count * 8 bytes
 *
 *   Long array ("padded"/no-span format): floor(64 / bits) values per long,
 *   unused high bits are padding. Value i lives in long floor(i / vpl) at
 *   bit offset (i % vpl) * bits.
 *
 * Overworld 1.21.4: min_y = -64, height = 384 => 24 sections of 16x16x16.
 * Section index for block y: (y - minY) >> 4.
 * Index inside a section: ((y & 15) << 8) | ((z & 15) << 4) | (x & 15).
 */

const MIN_Y = -64
const WORLD_HEIGHT = 384
const SECTION_VOLUME = 4096
const BIOME_VOLUME = 64

class Reader {
  constructor (buf) {
    this.buf = buf
    this.off = 0
  }

  remaining () { return this.buf.length - this.off }
  u8 () { const v = this.buf.readUInt8(this.off); this.off += 1; return v }
  i16 () { const v = this.buf.readInt16BE(this.off); this.off += 2; return v }
  u16 () { const v = this.buf.readUInt16BE(this.off); this.off += 2; return v }
  i32 () { const v = this.buf.readInt32BE(this.off); this.off += 4; return v }
  f32 () { const v = this.buf.readFloatBE(this.off); this.off += 4; return v }
  f64 () { const v = this.buf.readDoubleBE(this.off); this.off += 8; return v }
  bytes (n) { const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v }
  skip (n) { this.off += n }

  varint () {
    let result = 0
    let shift = 0
    for (let i = 0; i < 5; i++) {
      const b = this.u8()
      result |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) return result >>> 0
      shift += 7
    }
    throw new Error('VarInt too long')
  }

  varlong () {
    let result = 0n
    let shift = 0n
    for (let i = 0; i < 10; i++) {
      const b = this.u8()
      result |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) return result
      shift += 7n
    }
    throw new Error('VarLong too long')
  }
}

function readLongArray (reader, count) {
  const longs = new Array(count)
  for (let i = 0; i < count; i++) {
    // readBigInt64BE needs Node >= 12
    longs[i] = reader.buf.readBigInt64BE(reader.off)
    reader.off += 8
  }
  return longs
}

function readPalettedContainer (reader, opts) {
  const bits = reader.u8()
  if (bits === 0) {
    const value = reader.varint()
    const prefix = reader.u8() // 1.21.4 size prefix (0) for a "long array" of length 0
    if (prefix !== 0) throw new Error(`single-value container size prefix not 0 (got ${prefix})`)
    return {
      kind: 'single',
      bits: 0,
      palette: [value],
      longs: [],
      get () { return value }
    }
  }
  if (bits > 8) {
    // Direct (global palette) container.
    const longCount = reader.varint()
    const longs = readLongArray(reader, longCount)
    const valuesPerLong = Math.floor(64 / bits)
    const mask = (1n << BigInt(bits)) - 1n
    if (longCount < Math.ceil(opts.volume / valuesPerLong)) {
      throw new Error(`direct container long count too small: ${longCount} for ${opts.volume} values at ${bits} bits`)
    }
    return {
      kind: 'direct',
      bits,
      palette: null,
      longs,
      get (i) {
        const longIdx = Math.floor(i / valuesPerLong)
        const bitOffset = (i - longIdx * valuesPerLong) * bits
        return Number((longs[longIdx] >> BigInt(bitOffset)) & mask)
      }
    }
  }
  // Indirect (local palette) container.
  const paletteLen = reader.varint()
  const palette = new Array(paletteLen)
  for (let i = 0; i < paletteLen; i++) palette[i] = reader.varint()
  const longCount = reader.varint()
  const longs = readLongArray(reader, longCount)
  const valuesPerLong = Math.floor(64 / bits)
  const mask = (1n << BigInt(bits)) - 1n
  if (longCount < Math.ceil(opts.volume / valuesPerLong)) {
    throw new Error(`indirect container long count too small: ${longCount} for ${opts.volume} values at ${bits} bits`)
  }
  return {
    kind: 'indirect',
    bits,
    palette,
    longs,
    get (i) {
      const longIdx = Math.floor(i / valuesPerLong)
      const bitOffset = (i - longIdx * valuesPerLong) * bits
      const palIdx = Number((longs[longIdx] >> BigInt(bitOffset)) & mask)
      return palette[palIdx]
    }
  }
}

/**
 * Decode the chunk-data blob of a 1.21.4 map_chunk / level_chunk_with_light packet.
 * Returns { sections: [{ blockCount, blocks, biomes }], minY, worldHeight, bytesRead, trailingBytes }.
 */
function decodeChunkData (buffer, opts = {}) {
  const minY = opts.minY ?? MIN_Y
  const worldHeight = opts.worldHeight ?? WORLD_HEIGHT
  const sectionCount = worldHeight >> 4
  const reader = new Reader(buffer)
  const sections = []
  for (let i = 0; i < sectionCount; i++) {
    const blockCount = reader.i16()
    const blocks = readPalettedContainer(reader, { volume: SECTION_VOLUME })
    const biomes = readPalettedContainer(reader, { volume: BIOME_VOLUME })
    sections.push({ index: i, blockCount, blocks, biomes })
  }
  return {
    minY,
    worldHeight,
    sections,
    bytesRead: reader.off,
    trailingBytes: buffer.length - reader.off
  }
}

/** stateId of block (x,y,z) in a decoded chunk column, or null when outside the column. */
function getBlockState (decoded, x, y, z, minYOverride) {
  const minY = minYOverride ?? decoded.minY
  if (y < minY || y >= minY + decoded.worldHeight) return null
  const secIdx = (y - minY) >> 4
  const sec = decoded.sections[secIdx]
  if (!sec) return null
  const idx = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15)
  return sec.blocks.get(idx)
}

// ---------------------------------------------------------------- NBT-free helpers

let _md = null
function mcData () {
  if (!_md) _md = require('minecraft-data')('1.21.4')
  return _md
}

/** Block name for a global block-state id (e.g. 1 -> minecraft:stone). */
function blockName (stateId) {
  const md = mcData()
  const b = md.blocksByStateId ? md.blocksByStateId[stateId] : md.blocks[stateId]
  return b ? b.name : `unknown_state_${stateId}`
}

function stateRange (blockName) {
  const md = mcData()
  const b = md.blocksByName[blockName]
  if (!b) throw new Error(`unknown block ${blockName}`)
  return { min: b.minStateId, max: b.maxStateId, name: blockName }
}

function stateMatches (stateId, range) {
  return stateId >= range.min && stateId <= range.max
}

// ---------------------------------------------------------------- self-test / encoder

class Writer {
  constructor () { this.parts = [] }
  push (buf) { this.parts.push(buf); return this }
  u8 (v) { const b = Buffer.alloc(1); b.writeUInt8(v); return this.push(b) }
  i16 (v) { const b = Buffer.alloc(2); b.writeInt16BE(v); return this.push(b) }
  varint (v) {
    v = v >>> 0
    const out = []
    do {
      let b = v & 0x7f
      v >>>= 7
      if (v !== 0) b |= 0x80
      out.push(b)
    } while (v !== 0)
    return this.push(Buffer.from(out))
  }

  buffer () { return Buffer.concat(this.parts) }
}

function encodePalettedContainer (spec) {
  // spec: {volume, singleValue?} or {volume, bits, palette, values}
  const w = new Writer()
  if (spec.singleValue !== undefined) {
    w.u8(0).varint(spec.singleValue).u8(0)
    return w.buffer()
  }
  w.u8(spec.bits)
  w.varint(spec.palette.length)
  for (const p of spec.palette) w.varint(p)
  const valuesPerLong = Math.floor(64 / spec.bits)
  const longCount = Math.ceil(spec.volume / valuesPerLong)
  const mask = (1n << BigInt(spec.bits)) - 1n
  const longs = new Array(longCount).fill(0n)
  for (let i = 0; i < spec.volume; i++) {
    const val = BigInt(spec.values[i] ?? 0) & mask
    const longIdx = Math.floor(i / valuesPerLong)
    const bitOffset = (i - longIdx * valuesPerLong) * spec.bits
    longs[longIdx] |= val << BigInt(bitOffset)
  }
  w.varint(longCount)
  for (const l of longs) {
    const b = Buffer.alloc(8)
    b.writeBigInt64BE(BigInt.asIntN(64, l))
    w.push(b)
  }
  return w.buffer()
}

/** Build one wire section: short block_count + block-states container + biome container. */
function encodeSection (blockCount, blocksBuf, biomesBuf) {
  const w = new Writer()
  w.i16(blockCount)
  w.push(blocksBuf)
  w.push(biomesBuf)
  return w.buffer()
}

/**
 * Build a synthetic 1.21.4 chunk data blob and verify the decoder round-trips it.
 * The self-test embeds known stone / chest / observer states in a real paletted
 * section so a decoder bug cannot be hidden by an empty world.
 */
function selfTest () {
  const minY = -64
  const sectionCount = WORLD_HEIGHT >> 4
  const airSection = encodeSection(0, encodePalettedContainer({ volume: SECTION_VOLUME, singleValue: 0 }), encodePalettedContainer({ volume: BIOME_VOLUME, singleValue: 1 }))

  const chestState = stateRange('chest').min // any chest state id; use first
  const observerState = stateRange('observer').min
  const stoneState = stateRange('stone').min

  // Section 0: palette [air, stone, chest, observer]; bits 4 (256 padded longs)
  const values = new Array(SECTION_VOLUME).fill(0)
  const idx = (x, y, z) => ((y & 15) << 8) | ((z & 15) << 4) | (x & 15)
  values[idx(0, 0, 0)] = 1 // stone
  values[idx(1, 0, 0)] = 2 // chest
  values[idx(2, 0, 0)] = 3 // observer
  const section0 = encodePalettedContainer({
    volume: SECTION_VOLUME,
    bits: 4,
    palette: [0, stoneState, chestState, observerState],
    values
  })

  const biomeSection = encodePalettedContainer({ volume: BIOME_VOLUME, singleValue: 1 })
  const section0Wire = encodeSection(3, section0, biomeSection)
  const sections = []
  for (let i = 0; i < sectionCount; i++) {
    sections.push(i === 0 ? section0Wire : airSection)
  }
  const blob = Buffer.concat(sections)
  const decoded = decodeChunkData(blob)
  const checks = []
  const check = (label, cond, detail) => checks.push({ label, ok: !!cond, detail })
  const y = minY // section 0, local y 0
  const stoneGot = getBlockState(decoded, 0, y, 0)
  const chestGot = getBlockState(decoded, 1, y, 0)
  const observerGot = getBlockState(decoded, 2, y, 0)
  const airGot = getBlockState(decoded, 5, y, 5)
  check('section count', decoded.sections.length === 24, `${decoded.sections.length}`)
  check('bytes consumed == blob size', decoded.bytesRead === blob.length, `${decoded.bytesRead}/${blob.length}`)
  check('stone state round-trip', stoneGot === stoneState, `got ${stoneGot} want ${stoneState} (${blockName(stoneGot)})`)
  check('chest state round-trip', chestGot === chestState, `got ${chestGot} want ${chestState} (${blockName(chestGot)})`)
  check('observer state round-trip', observerGot === observerState, `got ${observerGot} want ${observerState} (${blockName(observerGot)})`)
  check('air state round-trip', airGot === 0, `got ${airGot}`)
  check('chest decodes to chest block', /^chest/.test(blockName(chestGot) || ''), blockName(chestGot))
  check('stone decodes to stone block', blockName(stoneGot) === 'stone', blockName(stoneGot))
  check('observer decodes to observer block', blockName(observerGot) === 'observer', blockName(observerGot))
  check('reader consumed whole blob (no trailing)', decoded.trailingBytes === 0, `trailing ${decoded.trailingBytes}`)

  // Second synthetic column: exercise the DIRECT (global palette) container path
  // (bits > 8), which the server uses when a section has too many distinct states
  // for a local palette.
  const directBits = 15 // 1.21.4 max block-state id (~26.9k) needs 15 bits
  const vpl = Math.floor(64 / directBits)
  const directLongCount = Math.ceil(SECTION_VOLUME / vpl)
  const directLongs = new Array(directLongCount).fill(0n)
  const directMask = (1n << BigInt(directBits)) - 1n
  const directSet = (i, value) => {
    const longIdx = Math.floor(i / vpl)
    const bitOffset = (i - longIdx * vpl) * directBits
    directLongs[longIdx] |= (BigInt(value) & directMask) << BigInt(bitOffset)
  }
  directSet(idx(0, 0, 0), stoneState)
  directSet(idx(1, 0, 0), chestState)
  directSet(idx(2, 0, 0), observerState)
  const dw = new Writer()
  dw.u8(directBits).varint(directLongCount)
  for (const l of directLongs) {
    const b = Buffer.alloc(8)
    b.writeBigInt64BE(BigInt.asIntN(64, l))
    dw.push(b)
  }
  const directSection0 = encodeSection(3, dw.buffer(), biomeSection)
  const directSections = []
  for (let i = 0; i < sectionCount; i++) directSections.push(i === 0 ? directSection0 : airSection)
  const directBlob = Buffer.concat(directSections)
  const directDecoded = decodeChunkData(directBlob)
  const dStone = getBlockState(directDecoded, 0, y, 0)
  const dChest = getBlockState(directDecoded, 1, y, 0)
  const dObserver = getBlockState(directDecoded, 2, y, 0)
  check('direct-palette container: whole blob consumed', directDecoded.bytesRead === directBlob.length && directDecoded.trailingBytes === 0,
    `${directDecoded.bytesRead}/${directBlob.length}, trailing ${directDecoded.trailingBytes}`)
  check('direct-palette container: stone state round-trip', dStone === stoneState, `got ${dStone} want ${stoneState}`)
  check('direct-palette container: chest state round-trip', dChest === chestState, `got ${dChest} want ${chestState}`)
  check('direct-palette container: observer state round-trip', dObserver === observerState, `got ${dObserver} want ${observerState}`)
  check('direct-palette container: air remains air', getBlockState(directDecoded, 7, y, 7) === 0, 'expected 0')
  return { ok: checks.every(c => c.ok), checks }
}

module.exports = {
  MIN_Y,
  WORLD_HEIGHT,
  decodeChunkData,
  getBlockState,
  blockName,
  stateRange,
  stateMatches,
  selfTest,
  // exported for unit tests / debugging
  Reader,
  encodePalettedContainer,
  readPalettedContainer
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    const r = selfTest()
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.ok ? 0 : 1)
  } else {
    console.error('usage: node lib/chunk-decoder.js --self-test')
    process.exit(2)
  }
}
