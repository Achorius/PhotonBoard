// ============================================================
// PhotonBoard — Art-Net output
// One UDP socket for every target; each target is keyed by its
// output id (two targets may share a source universe). Frames go out
// when the universe changes, plus a keep-alive every second so
// nodes never time out on a static look.
//
// We used to go through dmxnet, but its senders each own a socket and
// a 1 s timer that were never stopped on reconfigure (stale frames,
// flicker, blackout not holding) and it throws from UDP callbacks when
// the network is down. Packets are encoded in artnet-protocol.ts.
// ============================================================

import dgram from 'dgram'
import { lookup } from 'dns'
import type { ArtNetConfig, DmxOutputStatus } from '../shared/types'
import { ARTNET_PORT, buildArtDmxPacket, nextSequence } from './artnet-protocol'
import { artnetOutputUniverse, isValidIPv4, sourceUniverseProblem } from './output-config'
import { OutputHealth } from './output-health'

const KEEPALIVE_MS = 1000
const SOCKET_REOPEN_MS = 2000
const DNS_TTL_MS = 30_000

interface ArtNetTarget {
  id: string
  config: ArtNetConfig
  enabled: boolean
  invalid: string | null
  outUniverse: number
  /** Resolved IPv4 address (host names are looked up and cached) */
  address: string | null
  resolvedAt: number
  resolving: boolean
  seq: number
  prev: Uint8Array
  hasPrev: boolean
  lastSentAt: number
  health: OutputHealth
}

export class ArtNetOutput {
  private socket: dgram.Socket | null = null
  private socketReady = false
  private socketError: string | null = null
  private reopenTimer: ReturnType<typeof setTimeout> | null = null
  private targets: ArtNetTarget[] = []
  private destroyed = false

  constructor(private universeCount: number) {}

  /** Replace every target. Forces a full frame to each one on the next tick. */
  configure(configs: ArtNetConfig[]): void {
    this.targets = configs.map((config, i) => {
      const id = config.id || `artnet-${i + 1}`
      const outUniverse = artnetOutputUniverse(config)
      const name = `Art-Net ${config.host} U${config.net}:${config.subnet}:${outUniverse}`
      return {
        id,
        config,
        enabled: config.enabled !== false,
        invalid: sourceUniverseProblem(config.universe, this.universeCount),
        outUniverse,
        address: isValidIPv4(config.host) ? config.host : null,
        resolvedAt: 0,
        resolving: false,
        seq: 1,
        prev: new Uint8Array(512),
        hasPrev: false,
        lastSentAt: 0,
        health: new OutputHealth(name)
      }
    })

    for (const t of this.targets) {
      if (t.enabled && t.invalid) console.warn(`[Art-Net] ${t.id}: ${t.invalid}`)
    }

    if (this.targets.some(t => t.enabled && !t.invalid)) {
      this.ensureSocket()
    } else {
      this.closeSocket()
    }
  }

  private ensureSocket(): void {
    if (this.socket || this.destroyed) return
    const socket = dgram.createSocket({ type: 'udp4' })
    this.socket = socket
    this.socketReady = false

    socket.on('error', (err) => {
      if (this.socket !== socket) return
      console.error('[Art-Net] Socket error:', err.message)
      this.socketError = err.message
      for (const t of this.targets) t.health.fail(err, Date.now())
      this.closeSocket()
      this.scheduleReopen()
    })

    socket.bind(0, () => {
      if (this.socket !== socket) return
      try {
        socket.setBroadcast(true)
      } catch (e) {
        console.error('[Art-Net] Cannot enable broadcast:', (e as Error).message)
      }
      this.socketReady = true
      this.socketError = null
    })
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    this.socketReady = false
    if (socket) {
      socket.removeAllListeners('error')
      socket.on('error', () => { /* closing */ })
      try { socket.close() } catch { /* already closed */ }
    }
  }

  private scheduleReopen(): void {
    if (this.reopenTimer || this.destroyed) return
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null
      if (this.targets.some(t => t.enabled && !t.invalid)) this.ensureSocket()
    }, SOCKET_REOPEN_MS)
  }

  private resolve(t: ArtNetTarget, now: number): void {
    if (t.resolving) return
    if (t.address && (isValidIPv4(t.config.host) || now - t.resolvedAt < DNS_TTL_MS)) return
    t.resolving = true
    lookup(t.config.host, { family: 4 }, (err, address) => {
      t.resolving = false
      t.resolvedAt = Date.now()
      if (err) {
        t.health.fail(new Error(`Cannot resolve ${t.config.host}: ${err.code || err.message}`), t.resolvedAt)
        // Keep a previously resolved address while DNS is flaky
        return
      }
      t.address = address
    })
  }

  /** Called on every engine tick (~40 Hz). Sends only changed universes + keep-alives. */
  send(universes: Uint8Array[], now: number = Date.now()): void {
    if (!this.socket || !this.socketReady) return
    for (const t of this.targets) {
      if (!t.enabled || t.invalid) continue
      const data = universes[t.config.universe]
      if (!data) continue

      if (!isValidIPv4(t.config.host)) this.resolve(t, now)
      if (!t.address) continue

      if (t.hasPrev && now - t.lastSentAt < KEEPALIVE_MS && equalBytes(t.prev, data)) continue
      this.transmit(t, data, now)
    }
  }

  private transmit(t: ArtNetTarget, data: Uint8Array, now: number): void {
    const socket = this.socket
    if (!socket || !t.address) return
    t.prev.set(data.subarray(0, 512))
    t.hasPrev = true
    t.lastSentAt = now
    const packet = buildArtDmxPacket(t.seq, t.config.net, t.config.subnet, t.outUniverse, data)
    t.seq = nextSequence(t.seq)
    try {
      socket.send(packet, t.config.port || ARTNET_PORT, t.address, (err) => {
        const at = Date.now()
        if (err) {
          t.health.fail(err, at)
        } else {
          t.health.ok()
          t.health.frameSent(at)
        }
      })
    } catch (e) {
      // Socket closed between ticks, or invalid argument
      t.health.fail(e, now)
    }
  }

  /** Mark targets as errored after an exception we could not attribute precisely */
  noteError(err: unknown, now: number = Date.now()): void {
    for (const t of this.targets) if (t.enabled) t.health.fail(err, now)
  }

  getStatuses(now: number = Date.now()): DmxOutputStatus[] {
    return this.targets.map(t => {
      let state: DmxOutputStatus['state']
      if (!t.enabled) state = 'disabled'
      else if (t.invalid) state = 'invalid'
      else if (this.socketError || t.health.failing) state = 'error'
      else if (!this.socketReady || !t.address) state = 'connecting'
      else state = 'ok'
      const lastError = t.invalid ?? (this.socketError || t.health.lastError)
      return {
        id: t.id,
        type: 'artnet' as const,
        label: t.config.label || `Art-Net → ${t.config.host}`,
        enabled: t.enabled,
        sourceUniverse: t.config.universe,
        target: `${t.config.host}:${t.config.port || ARTNET_PORT} · Art-Net ${t.config.net}:${t.config.subnet}:${t.outUniverse}`,
        state,
        connected: state === 'ok',
        lastError: lastError || undefined,
        lastErrorAt: t.invalid ? undefined : t.health.lastErrorAt,
        framesSent: t.health.framesSent,
        fps: t.health.getFps(now)
      }
    })
  }

  /** Legacy status shape */
  getStatus(): { connected: boolean; senders: { universe: number; host: string }[] } {
    return {
      connected: this.socketReady,
      senders: this.targets.filter(t => t.enabled).map(t => ({ universe: t.config.universe, host: t.config.host }))
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.reopenTimer) { clearTimeout(this.reopenTimer); this.reopenTimer = null }
    this.targets = []
    this.closeSocket()
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.min(a.length, b.length, 512)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false
  return true
}
