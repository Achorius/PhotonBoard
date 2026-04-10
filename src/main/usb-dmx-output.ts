import type { UsbDmxConfig, SerialPortInfo } from '../shared/types'

/**
 * USB DMX Output - supports multiple cheap USB-DMX adapters:
 *
 * 1. ENTTEC Open DMX USB (FTDI-based, ~30EUR)
 *    - Simple serial at 250kbaud, sends raw DMX frames
 *    - No feedback, cheapest option
 *
 * 2. ENTTEC DMX USB Pro (~150EUR)
 *    - Uses ENTTEC Pro protocol with message framing
 *    - More reliable, has RDM support
 *
 * 3. uDMX (cheap Chinese clones, ~15EUR)
 *    - USB HID device, sends via control transfers
 *    - Very common, many clones available
 */

interface UsbDmxInstance {
  config: UsbDmxConfig
  port: any // SerialPort instance
  connected: boolean
  buffer: Buffer
}

export class UsbDmxOutput {
  private instances: Map<number, UsbDmxInstance> = new Map()
  private SerialPort: any = null
  private available = false

  constructor() {
    try {
      const sp = require('serialport')
      this.SerialPort = sp.SerialPort
      this.available = true
      console.log('[USB-DMX] serialport module loaded successfully')
    } catch (e) {
      console.warn('[USB-DMX] serialport not available:', (e as Error).message)
      this.available = false
    }
  }

  /**
   * Scan for available serial ports (USB DMX adapters)
   */
  async scanPorts(): Promise<SerialPortInfo[]> {
    if (!this.available) return []
    try {
      const { SerialPort } = require('serialport')
      const ports = await SerialPort.list()
      return ports.map((p: any) => ({
        path: p.path,
        manufacturer: p.manufacturer || undefined,
        serialNumber: p.serialNumber || undefined,
        vendorId: p.vendorId || undefined,
        productId: p.productId || undefined,
        friendlyName: p.friendlyName || p.pnpId || undefined
      }))
    } catch (e) {
      console.error('[USB-DMX] Failed to scan ports:', e)
      return []
    }
  }

  /**
   * Configure USB DMX outputs
   */
  async configure(configs: UsbDmxConfig[]): Promise<void> {
    console.log(`[USB-DMX] Configuring ${configs.length} output(s)...`)
    // Close existing connections
    await this.destroyAll()

    if (!this.available) {
      console.warn('[USB-DMX] serialport module not available — cannot configure')
      return
    }

    for (const config of configs) {
      try {
        console.log(`[USB-DMX] Opening ${config.driver} on ${config.portPath} (universe ${config.universe})...`)
        const instance = await this.openPort(config)
        if (instance) {
          this.instances.set(config.universe, instance)
          console.log(`[USB-DMX] ✓ ${config.driver} on ${config.portPath} ready (universe ${config.universe})`)
        }
      } catch (e) {
        console.error(`[USB-DMX] ✗ Failed to open ${config.driver} on ${config.portPath}:`, e)
      }
    }
    console.log(`[USB-DMX] Configuration complete: ${this.instances.size} output(s) active`)
  }

  private async openPort(config: UsbDmxConfig): Promise<UsbDmxInstance | null> {
    const { SerialPort } = require('serialport')

    switch (config.driver) {
      case 'enttec-pro':
      case 'eurolite-pro': // Eurolite USB-DMX512 Pro = ENTTEC Pro clone
        return this.openEnttecPro(SerialPort, config)
      // All FTDI-based adapters use the same Open DMX protocol
      case 'enttec-open-dmx':
      case 'eurolite':
      case 'showtec':
      case 'beamz':
      case 'velleman':
      case 'stairville':
      case 'udmx':
      case 'generic-ftdi':
        return this.openEnttecOpen(SerialPort, config)
      default:
        console.warn(`[USB-DMX] Unknown driver: ${config.driver}`)
        return null
    }
  }

  /**
   * ENTTEC Open DMX USB - simple FTDI serial at 250kbaud
   * Sends raw DMX512 frames: BREAK + MAB + START_CODE + 512 bytes
   */
  private async openEnttecOpen(SP: any, config: UsbDmxConfig): Promise<UsbDmxInstance> {
    const port = new SP({
      path: config.portPath,
      baudRate: 250000,
      dataBits: 8,
      stopBits: 2,
      parity: 'none',
      autoOpen: false
    })

    return new Promise((resolve, reject) => {
      port.open((err: Error | null) => {
        if (err) {
          reject(err)
          return
        }
        console.log(`[USB-DMX] ENTTEC Open DMX connected on ${config.portPath}`)
        const buffer = Buffer.alloc(513) // Start code (0x00) + 512 channels
        buffer[0] = 0x00 // DMX start code
        resolve({
          config,
          port,
          connected: true,
          buffer
        })
      })
    })
  }

  /**
   * ENTTEC DMX USB Pro - uses message protocol
   * Frame format: 0x7E [label] [length_lsb] [length_msb] [data...] 0xE7
   */
  private async openEnttecPro(SP: any, config: UsbDmxConfig): Promise<UsbDmxInstance> {
    const port = new SP({
      path: config.portPath,
      baudRate: 57600, // Pro uses 57600 for the USB serial, internally generates 250kbaud DMX
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    })

    return new Promise((resolve, reject) => {
      port.open((err: Error | null) => {
        if (err) {
          reject(err)
          return
        }
        console.log(`[USB-DMX] ENTTEC Pro connected on ${config.portPath}`)
        // Pro frame: header(1) + label(1) + length(2) + start_code(1) + 512ch + footer(1) = 518
        const buffer = Buffer.alloc(518)
        resolve({
          config,
          port,
          connected: true,
          buffer
        })
      })
    })
  }

  /**
   * Send DMX data to all connected USB adapters
   */
  send(universes: Uint8Array[]): void {
    for (const [universeIdx, instance] of this.instances) {
      if (!instance.connected || universeIdx >= universes.length) continue
      const data = universes[universeIdx]

      if (instance.config.driver === 'enttec-pro' || instance.config.driver === 'eurolite-pro') {
        this.sendEnttecPro(instance, data)
      } else {
        // All other drivers use FTDI/Open DMX protocol
        this.sendOpenDmx(instance, data)
      }
    }
  }

  /**
   * Send raw DMX frame (Open DMX / uDMX style)
   * The FTDI chip handles the BREAK signal via serial settings
   */
  private sendOpenDmx(instance: UsbDmxInstance, data: Uint8Array): void {
    try {
      if (!instance.port || !instance.port.isOpen) {
        instance.connected = false
        return
      }

      // Copy channel data after start code
      for (let i = 0; i < 512; i++) {
        instance.buffer[i + 1] = data[i]
      }

      // Send BREAK by setting baud to low rate momentarily
      instance.port.update({ baudRate: 76800 }, (err: Error | null) => {
        if (err) { instance.connected = false; return }
        // Send break byte
        const breakBuf = Buffer.from([0x00])
        instance.port.write(breakBuf, (err2: Error | null) => {
          if (err2) { instance.connected = false; return }
          instance.port.drain((err3: Error | null) => {
            if (err3) { instance.connected = false; return }
            // Restore DMX baud rate and send data
            instance.port.update({ baudRate: 250000 }, (err4: Error | null) => {
              if (err4) { instance.connected = false; return }
              instance.port.write(instance.buffer, (err5: Error | null) => {
                if (err5) {
                  console.error(`[USB-DMX] Write error on ${instance.config.portPath}:`, err5.message)
                  instance.connected = false
                }
              })
            })
          })
        })
      })
    } catch (e) {
      console.error(`[USB-DMX] Send error (${instance.config.driver}):`, (e as Error).message)
      instance.connected = false
    }
  }

  /**
   * Send ENTTEC Pro message frame
   * Label 6 = "Send DMX Packet"
   */
  private sendEnttecPro(instance: UsbDmxInstance, data: Uint8Array): void {
    try {
      if (!instance.port || !instance.port.isOpen) {
        instance.connected = false
        return
      }

      const dataLength = 513 // start code + 512 channels
      const buf = instance.buffer

      buf[0] = 0x7E        // Start delimiter
      buf[1] = 6            // Label: Send DMX Packet
      buf[2] = dataLength & 0xFF        // Length LSB
      buf[3] = (dataLength >> 8) & 0xFF // Length MSB
      buf[4] = 0x00         // DMX start code

      // Copy channel data
      for (let i = 0; i < 512; i++) {
        buf[i + 5] = data[i]
      }

      buf[517] = 0xE7       // End delimiter

      instance.port.write(buf, (err: Error | null) => {
        if (err) {
          console.error(`[USB-DMX] Write error on ${instance.config.portPath}:`, err.message)
          instance.connected = false
        }
      })
    } catch (e) {
      console.error(`[USB-DMX] Send error (${instance.config.driver}):`, (e as Error).message)
      instance.connected = false
    }
  }

  /**
   * Get status of all USB DMX outputs
   */
  getStatus(): { available: boolean; outputs: { universe: number; driver: string; port: string; connected: boolean }[] } {
    return {
      available: this.available,
      outputs: Array.from(this.instances.entries()).map(([universe, inst]) => ({
        universe,
        driver: inst.config.driver,
        port: inst.config.portPath,
        connected: inst.connected
      }))
    }
  }

  /**
   * Close all ports
   */
  async destroyAll(): Promise<void> {
    for (const [, instance] of this.instances) {
      try {
        if (instance.port && instance.port.isOpen) {
          await new Promise<void>((resolve) => {
            instance.port.close(() => resolve())
          })
        }
      } catch (e) {
        // Ignore close errors
      }
    }
    this.instances.clear()
  }

  isAvailable(): boolean {
    return this.available
  }
}
