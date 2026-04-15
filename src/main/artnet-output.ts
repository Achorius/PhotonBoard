import type { ArtNetConfig } from '../shared/types'

interface SenderInstance {
  config: ArtNetConfig
  sender: any
}

export class ArtNetOutput {
  private dmxnetInstance: any = null
  private senders: Map<number, SenderInstance> = new Map()
  private configs: ArtNetConfig[] = []
  private connected = false
  // Track previous values per universe to avoid sending unchanged frames
  private prevData: Map<number, Uint8Array> = new Map()

  constructor() {
    try {
      // Dynamic import to handle missing module gracefully
      const dmxnet = require('dmxnet')
      this.dmxnetInstance = new dmxnet.dmxnet({
        log: { level: 'error' },
        oem: 0,
        sName: 'PhotonBoard',
        lName: 'PhotonBoard DMX Controller'
      })
      this.connected = true
    } catch (e) {
      console.warn('dmxnet not available, running in offline mode:', (e as Error).message)
      this.connected = false
    }
  }

  configure(configs: ArtNetConfig[]): void {
    // Close existing senders
    this.senders.clear()
    this.configs = configs

    if (!this.dmxnetInstance) return

    for (const config of configs) {
      try {
        const sender = this.dmxnetInstance.newSender({
          ip: config.host,
          port: config.port || 6454,
          subnet: config.subnet || 0,
          universe: config.universe || 0,
          net: config.net || 0,
          base_refresh_interval: 1000 // Auto-refresh every 1s if no data
        })
        this.senders.set(config.universe, { config, sender })
      } catch (e) {
        console.error(`Failed to create ArtNet sender for universe ${config.universe}:`, e)
      }
    }
  }

  send(universes: Uint8Array[]): void {
    if (!this.connected) return

    for (let i = 0; i < universes.length; i++) {
      const senderEntry = this.senders.get(i)
      if (senderEntry) {
        const data = universes[i]

        // Skip transmission if data hasn't changed since last send
        // (dmxnet's base_refresh_interval handles keepalive automatically)
        const prev = this.prevData.get(i)
        if (prev && prev.length === data.length) {
          let same = true
          for (let ch = 0; ch < data.length; ch++) {
            if (prev[ch] !== data[ch]) { same = false; break }
          }
          if (same) continue
        }

        // Data changed — update cache and transmit
        this.prevData.set(i, new Uint8Array(data))
        const { sender } = senderEntry
        for (let ch = 0; ch < data.length; ch++) {
          sender.prepChannel(ch, data[ch])
        }
        sender.transmit()
      }
    }
  }

  getStatus(): { connected: boolean; senders: { universe: number; host: string }[] } {
    return {
      connected: this.connected,
      senders: this.configs.map((c) => ({ universe: c.universe, host: c.host }))
    }
  }

  destroy(): void {
    this.senders.clear()
    this.dmxnetInstance = null
    this.connected = false
  }
}
