import { ArtNetOutput } from './artnet-output'
import { UsbDmxOutput } from './usb-dmx-output'
import { Mutex } from './async-mutex'
import {
  fromLegacyList,
  sourceUniverseProblem,
  toLegacyList,
  validateArtnetList,
  validateOutputsConfig
} from './output-config'
import type { DmxOutputsConfig, DmxOutputsStatus, SerialPortInfo } from '../shared/types'
import type { DmxOutputsConfigureResult } from '../shared/photonboard-api'

export interface DmxOutputManagerOptions {
  universeCount: number
  /** Persist the machine config after every successful change (throws on I/O error) */
  persist?: (config: DmxOutputsConfig) => void
  artnet?: ArtNetOutput
  usb?: UsbDmxOutput
}

/**
 * DMX Output Manager - handles multiple simultaneous outputs
 * Sends DMX data to all enabled outputs (ArtNet + USB DMX adapters).
 *
 * The output configuration is MACHINE configuration (not part of a show):
 * main loads it from <userData>/config/outputs.json at startup and every
 * change is a full replacement that is validated and persisted here.
 */
export class DmxOutputManager {
  private artnet: ArtNetOutput
  private usbDmx: UsbDmxOutput
  private config: DmxOutputsConfig = { artnet: [], usb: [] }
  private lock = new Mutex()
  private universeCount: number
  private persist?: (config: DmxOutputsConfig) => void

  constructor(opts: DmxOutputManagerOptions) {
    this.universeCount = opts.universeCount
    this.persist = opts.persist
    this.artnet = opts.artnet ?? new ArtNetOutput(opts.universeCount)
    this.usbDmx = opts.usb ?? new UsbDmxOutput(opts.universeCount)
  }

  /** Apply an already-validated config (startup). Does not persist. */
  apply(config: DmxOutputsConfig): Promise<void> {
    return this.lock.run(() => this.applyUnlocked(config))
  }

  private async applyUnlocked(config: DmxOutputsConfig): Promise<void> {
    this.config = structuredClone(config)
    // Each output type is configured independently: Art-Net is cheap to rebuild,
    // USB keeps ports whose config is unchanged.
    this.artnet.configure(this.config.artnet)
    await this.usbDmx.configure(this.config.usb)
  }

  /** Human-readable warnings for outputs the engine cannot feed (applied, but dead) */
  private configWarnings(): string | undefined {
    const problems: string[] = []
    const all = [...this.config.artnet, ...this.config.usb]
    for (const entry of all) {
      if (entry.enabled === false) continue
      const problem = sourceUniverseProblem(entry.universe, this.universeCount)
      if (problem) problems.push(`${entry.label || entry.id}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : undefined
  }

  private persistSafely(): string | undefined {
    if (!this.persist) return undefined
    try {
      this.persist(this.config)
      return undefined
    } catch (e) {
      const msg = `Outputs applied, but the configuration could not be saved: ${(e as Error).message}`
      console.error('[DMX-Out]', msg)
      return msg
    }
  }

  /**
   * Full replacement of the machine output config (both lists), validated strictly.
   * Also accepts the legacy DmxOutputConfig[] (see fromLegacyList).
   */
  configure(input: unknown): Promise<DmxOutputsConfigureResult> {
    return this.lock.run(async () => {
      const candidate = Array.isArray(input) ? fromLegacyList(input, this.config) : input
      const hasUsb = !!candidate && typeof candidate === 'object' && Array.isArray((candidate as any).usb) && (candidate as any).usb.length > 0
      const ports = hasUsb ? await this.usbDmx.scanPorts() : []
      const result = validateOutputsConfig(candidate, {
        availablePorts: ports.map(p => p.path),
        knownPorts: this.config.usb.map(u => u.portPath)
      })
      if (!result.ok) return { success: false, error: result.error }

      // Remember the adapter's serial number so it can be found again if its path changes
      for (const u of result.config.usb) {
        if (!u.serialNumber) {
          const sn = ports.find(p => p.path === u.portPath)?.serialNumber
          if (sn) u.serialNumber = sn
        }
      }

      await this.applyUnlocked(result.config)
      const warning = [this.configWarnings(), this.persistSafely()].filter(Boolean).join(' — ')
      return { success: true, config: this.getConfig(), ...(warning ? { warning } : {}) }
    })
  }

  /**
   * Legacy: replace ONLY the Art-Net part of the config (persists).
   */
  configureArtnet(input: unknown): Promise<DmxOutputsConfigureResult> {
    return this.lock.run(async () => {
      const result = validateArtnetList(input)
      if (!result.ok) return { success: false, error: result.error }
      const next = { artnet: result.artnet, usb: this.config.usb }
      // Re-run full validation so ids stay unique across both lists
      const full = validateOutputsConfig(next)
      if (!full.ok) return { success: false, error: full.error }
      await this.applyUnlocked(full.config)
      const warning = [this.configWarnings(), this.persistSafely()].filter(Boolean).join(' — ')
      return { success: true, config: this.getConfig(), ...(warning ? { warning } : {}) }
    })
  }

  getConfig(): DmxOutputsConfig {
    return structuredClone(this.config)
  }

  /**
   * Send DMX data to all active outputs. Called on EVERY engine tick: USB
   * Open DMX needs a continuous stream; Art-Net/ENTTEC Pro filter unchanged
   * frames themselves (with keep-alive).
   */
  send(universes: Uint8Array[], now: number = Date.now()): void {
    this.artnet.send(universes, now)
    this.usbDmx.send(universes, now)
  }

  /**
   * Scan for available USB serial ports
   */
  async scanUsbPorts(): Promise<SerialPortInfo[]> {
    return this.usbDmx.scanPorts()
  }

  /**
   * Attribute an uncaught exception to outputs when its stack points at them.
   * Returns true when it was output-related.
   */
  noteUncaughtError(err: unknown): boolean {
    const stack = err instanceof Error ? `${err.stack || ''} ${err.message}` : String(err)
    if (/serialport|usb-dmx|bindings-cpp/i.test(stack)) {
      this.usbDmx.noteError(err)
      return true
    }
    if (/dgram|artnet|dmxnet/i.test(stack)) {
      this.artnet.noteError(err)
      return true
    }
    return false
  }

  /**
   * Get combined status of all outputs
   */
  getStatus(): DmxOutputsStatus {
    const now = Date.now()
    return {
      outputs: [...this.artnet.getStatuses(now), ...this.usbDmx.getStatuses(now)],
      universeCount: this.universeCount,
      usbAvailable: this.usbDmx.isAvailable(),
      artnet: this.artnet.getStatus(),
      usbDmx: this.usbDmx.getStatus(),
      configs: toLegacyList(this.config)
    }
  }

  /**
   * Get ArtNet status (legacy compat)
   */
  getArtnetStatus() {
    return this.artnet.getStatus()
  }

  /**
   * Clean up all outputs
   */
  async destroy(): Promise<void> {
    this.artnet.destroy()
    await this.usbDmx.destroyAll()
  }
}
