'use strict'
/**
 * Minimal Minecraft RCON client (Source RCON protocol) - no external deps.
 *
 * Packet framing (little endian):
 *   int32 length | int32 requestId | int32 type | payload bytes | 0x00 0x00
 *   (length covers requestId+type+payload+2 nulls)
 *
 * types: 3 = LOGIN, 2 = COMMAND (and command terminator response), 0 = response chunk
 */
const net = require('net')

const TYPE_RESPONSE = 0
const TYPE_COMMAND = 2
const TYPE_LOGIN = 3

class Rcon {
  constructor (options = {}) {
    this.host = options.host || '127.0.0.1'
    this.port = options.port || 25598
    this.password = options.password || 'itest-rcon-pass'
    this.timeoutMs = options.timeoutMs || 10000
    this.socket = null
    this._buf = Buffer.alloc(0)
    this._nextId = 1
    this._pending = null // {id, kind, chunks, resolve, reject, timer}
  }

  connect () {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port })
      this.socket = socket
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`RCON connect timeout to ${this.host}:${this.port}`))
      }, this.timeoutMs)
      socket.once('connect', () => {
        // Keep reference; auth is a normal request
        this._request(TYPE_LOGIN, this.password).then(() => {
          clearTimeout(timer)
          resolve()
        }, (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
      socket.on('data', (chunk) => this._onData(chunk))
      socket.on('error', (err) => {
        clearTimeout(timer)
        if (this._pending) {
          const p = this._pending
          this._pending = null
          clearTimeout(p.timer)
          p.reject(err)
        }
        reject(err)
      })
      socket.on('close', () => {
        if (this._pending) {
          const p = this._pending
          this._pending = null
          clearTimeout(p.timer)
          p.reject(new Error('RCON socket closed while waiting for response'))
        }
      })
    })
  }

  _encode (id, type, payload) {
    const body = Buffer.byteLength(payload, 'utf8')
    const buf = Buffer.alloc(4 + 4 + 4 + body + 2)
    buf.writeInt32LE(body + 10, 0)
    buf.writeInt32LE(id, 4)
    buf.writeInt32LE(type, 8)
    buf.write(payload, 12, 'utf8')
    buf.writeUInt8(0, 12 + body)
    buf.writeUInt8(0, 13 + body)
    return buf
  }

  _request (type, payload) {
    if (!this.socket) return Promise.reject(new Error('RCON not connected'))
    if (this._pending) return Promise.reject(new Error('RCON request already in flight'))
    const id = this._nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending && this._pending.id === id) {
          this._pending = null
          reject(new Error(`RCON response timeout for request ${id}`))
        }
      }, this.timeoutMs)
      this._pending = { id, kind: type, chunks: [], resolve, reject, timer, idleTimer: null }
      this.socket.write(this._encode(id, type, payload))
    })
  }

  /** Resolve a command once the server has been idle for a moment (Paper does not
   *  send a separate terminator packet for command responses; long responses may
   *  arrive as several type-0 packets). */
  _settleCommand (pending) {
    if (this._pending !== pending) return
    this._pending = null
    clearTimeout(pending.timer)
    if (pending.idleTimer) clearTimeout(pending.idleTimer)
    pending.resolve(pending.chunks.join(''))
  }

  _onData (chunk) {
    this._buf = Buffer.concat([this._buf, chunk])
    for (;;) {
      if (this._buf.length < 4) return
      const len = this._buf.readInt32LE(0)
      if (len < 10 || len > 1024 * 1024 * 16) {
        // Desync; drop everything to avoid an infinite loop
        this._buf = Buffer.alloc(0)
        return
      }
      if (this._buf.length < 4 + len) return
      const pkt = this._buf.subarray(4, 4 + len)
      this._buf = this._buf.subarray(4 + len)
      const id = pkt.readInt32LE(0)
      const type = pkt.readInt32LE(4)
      const payload = pkt.subarray(8, pkt.length - 2).toString('utf8')
      const pending = this._pending
      if (!pending) continue
      if (id === -1) {
        this._pending = null
        clearTimeout(pending.timer)
        pending.reject(new Error('RCON authentication failed (bad password)'))
        return
      }
      if (id !== pending.id) continue // stale packet
      if (pending.kind === TYPE_LOGIN) {
        if (type === TYPE_COMMAND) {
          this._pending = null
          clearTimeout(pending.timer)
          pending.resolve(payload)
        }
        continue
      }
      // Command response: type 0 carries the text; Paper sends no terminator, so
      // settle shortly after the last chunk arrives.
      if (type === TYPE_RESPONSE || type === TYPE_COMMAND) {
        pending.chunks.push(payload)
        if (type === TYPE_COMMAND) { this._settleCommand(pending); continue }
        if (pending.idleTimer) clearTimeout(pending.idleTimer)
        pending.idleTimer = setTimeout(() => this._settleCommand(pending), 120)
      }
    }
  }

  /** Send a console command and resolve with the server response text. */
  cmd (command) {
    return this._request(TYPE_COMMAND, command)
  }

  close () {
    if (this.socket) {
      try { this.socket.destroy() } catch (_) {}
      this.socket = null
    }
  }
}

module.exports = { Rcon }
