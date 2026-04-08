import { ArtNetOutput } from './artnet-output'
import { UsbDmxOutput } from './usb-dmx-output'
import type { DmxOutputConfig, ArtNetConfig, UsbDmxConfig, SerialPortInfo } from '../shared/types'

/**
 * DMX Output Manager - handles multiple simultaneous outputs
 * Sends DMX data to all enabled outputs (ArtNet + USB DMX adapters)
 */
export class DmxOutputManager {
  private artnet: ArtNetOutput
  private usbDmx: UsbDmxOutput
  private configs: DmxOutputConfig[] = []

  constructor() {
    this.artnet = new ArtNetOutput()
    this.usbDmx = new UsbDmxOutput()
  }

  /**
   * Configure all outputs at once
   */
  async configure(configs: DmxOutputConfig[]): Promise<void> {
    this.configs = configs

    // Separate ArtNet and USB configs
    const artnetConfigs: ArtNetConfig[] = []
    const usbConfigs: UsbDmxConfig[] = []

    for (const config of configs) {
      if (!config.enabled) continue

      if (config.type === 'artnet' && config.artnet) {
        artnetConfigs.push(config.artnet)
      } else if (config.type === 'usb-dmx' && config.usbDmx) {
        usbConfigs.push(config.usbDmx)
      }
    }

    // Apply configs
    this.artnet.configure(artnetConfigs)
    await this.usbDmx.configure(usbConfigs)
  }

  /**
   * Legacy: configure ArtNet only (backward compat)
   */
  configureArtnet(configs: ArtNetConfig[]): void {
    this.artnet.configure(configs)
  }

  /**
   * Send DMX data to all active outputs
   */
  send(universes: Uint8Array[]): void {
    this.artnet.send(universes)
    this.usbDmx.send(universes)
  }

  /**
   * Scan for available USB serial ports
   */
  async scanUsbPorts(): Promise<SerialPortInfo[]> {
    return this.usbDmx.scanPorts()
  }

  /**
   * Get combined status of all outputs
   */
  getStatus(): {
    artnet: { connected: boolean; senders: { universe: number; host: string }[] }
    usbDmx: { available: boolean; outputs: { universe: number; driver: string; port: string; connected: boolean }[] }
    configs: DmxOutputConfig[]
  } {
    return {
      artnet: this.artnet.getStatus(),
      usbDmx: this.usbDmx.getStatus(),
      configs: this.configs
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
