import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { UsbDmxOutput } from './usb-dmx-output'

/** Minimal fake of serialport's SerialPort */
function makeFakeSerial() {
  const ports: { path: string; serialNumber?: string }[] = [{ path: '/dev/ttyUSB0', serialNumber: 'A1' }, { path: '/dev/ttyUSB1', serialNumber: 'B2' }]
  const instances: FakePort[] = []
  class FakePort extends EventEmitter {
    static list = async () => ports
    isOpen = false
    writes = 0
    /** When true, write callbacks never fire (hung adapter) */
    hang = false
    constructor(public opts: any) { super(); instances.push(this) }
    open(cb: (e: Error | null) => void) {
      if (!ports.some(p => p.path === this.opts.path)) return cb(new Error('ENOENT'))
      this.isOpen = true; cb(null)
    }
    set(_o: any, cb: (e: Error | null) => void) { cb(null) }
    update(_o: any, cb: (e: Error | null) => void) { cb(null) }
    write(_b: Buffer, cb: (e: Error | null) => void) { this.writes++; if (!this.hang) cb(null) }
    drain(cb: (e: Error | null) => void) { if (!this.hang) cb(null) }
    close(cb?: () => void) { this.isOpen = false; cb?.() }
    unplug() { this.isOpen = false; this.emit('close', Object.assign(new Error('disconnected'), { disconnected: true })) }
  }
  return { FakePort, ports, instances }
}

const universes = () => [new Uint8Array(512), new Uint8Array(512), new Uint8Array(512)]

afterEach(() => { vi.useRealTimers() })

describe('UsbDmxOutput', () => {
  it('streams Open DMX frames on every tick, even when nothing changes', async () => {
    const { FakePort, instances } = makeFakeSerial()
    const out = new UsbDmxOutput(3, { SerialPort: FakePort })
    await out.configure([{ id: 'u1', driver: 'enttec-open-dmx', portPath: '/dev/ttyUSB0', universe: 0 }])
    const u = universes()
    for (let i = 0; i < 5; i++) out.send(u, 1000 + i * 25)
    // 2 writes per Open DMX frame (BREAK byte + frame)
    expect(instances[0].writes).toBe(10)
    expect(out.getStatuses()[0]).toMatchObject({ id: 'u1', state: 'ok', framesSent: 5 })
    await out.destroyAll()
  })

  it('ENTTEC Pro only sends on change plus a 1 s keep-alive', async () => {
    const { FakePort, instances } = makeFakeSerial()
    const out = new UsbDmxOutput(3, { SerialPort: FakePort })
    await out.configure([{ id: 'p', driver: 'enttec-pro', portPath: '/dev/ttyUSB0', universe: 0 }])
    const u = universes()
    out.send(u, 1000); out.send(u, 1025); out.send(u, 1050)
    expect(instances[0].writes).toBe(1)
    u[0][3] = 9
    out.send(u, 1075)
    expect(instances[0].writes).toBe(2)
    out.send(u, 2100)
    expect(instances[0].writes).toBe(3)
    await out.destroyAll()
  })

  it('a busy adapter does not starve the others, and a hung one is detected', async () => {
    const { FakePort, instances } = makeFakeSerial()
    const out = new UsbDmxOutput(3, { SerialPort: FakePort })
    await out.configure([
      { id: 'a', driver: 'enttec-open-dmx', portPath: '/dev/ttyUSB0', universe: 0 },
      { id: 'b', driver: 'enttec-open-dmx', portPath: '/dev/ttyUSB1', universe: 1 }
    ])
    instances[0].hang = true
    const u = universes()
    out.send(u, 1000); out.send(u, 1025); out.send(u, 1050)
    expect(instances[1].writes).toBe(6)
    out.send(u, 2500) // watchdog: first adapter stuck for > 1 s
    expect(out.getStatuses()[0].state).toBe('error')
    expect(out.getStatuses()[0].lastError).toMatch(/timed out/)
    await out.destroyAll()
  })

  it('reconnects after an unplug, finding the adapter by serial number on a new path', async () => {
    vi.useFakeTimers()
    const { FakePort, ports, instances } = makeFakeSerial()
    const out = new UsbDmxOutput(3, { SerialPort: FakePort })
    await out.configure([{ id: 'a', driver: 'enttec-open-dmx', portPath: '/dev/ttyUSB0', serialNumber: 'A1', universe: 0 }])
    instances[0].unplug()
    expect(out.getStatuses()[0].state).toBe('error')
    // replugged as ttyUSB2
    ports[0] = { path: '/dev/ttyUSB2', serialNumber: 'A1' }
    await vi.advanceTimersByTimeAsync(1500)
    const s = out.getStatuses()[0]
    expect(s.state).toBe('ok')
    expect(s.target).toBe('/dev/ttyUSB2')
    await out.destroyAll()
  })

  it('keeps an unchanged adapter open across reconfigures and serialises configure()', async () => {
    const { FakePort, instances } = makeFakeSerial()
    const out = new UsbDmxOutput(3, { SerialPort: FakePort })
    const cfg = { id: 'a', driver: 'enttec-open-dmx' as const, portPath: '/dev/ttyUSB0', universe: 0 }
    await Promise.all([out.configure([cfg]), out.configure([cfg]), out.configure([cfg, { ...cfg, id: 'b', portPath: '/dev/ttyUSB1' }])])
    expect(instances.length).toBe(2)
    expect(instances.filter(p => p.isOpen).length).toBe(2)
    await out.destroyAll()
    expect(instances.every(p => !p.isOpen)).toBe(true)
  })

  it('reports invalid source universes and missing adapters', async () => {
    vi.useFakeTimers()
    const { FakePort } = makeFakeSerial()
    const out = new UsbDmxOutput(3, { SerialPort: FakePort })
    await out.configure([
      { id: 'x', driver: 'enttec-pro', portPath: '/dev/ttyUSB0', universe: 9 },
      { id: 'y', driver: 'enttec-pro', portPath: '/dev/ttyACM9', universe: 0 }
    ])
    const [x, y] = out.getStatuses()
    expect(x.state).toBe('invalid')
    expect(y.state).toBe('error')
    expect(y.lastError).toMatch(/not found/)
    await out.destroyAll()
  })
})
