import { describe, it, expect, vi } from 'vitest'
import { DmxOutputManager } from './dmx-output-manager'
import { defaultOutputsConfig } from './output-config'

function fakeUsb(ports: string[] = ['/dev/ttyUSB0']) {
  return {
    configure: vi.fn(async (_list: any[]) => {}),
    scanPorts: vi.fn(async () => ports.map(path => ({ path, serialNumber: 'SN1' }))),
    send: vi.fn(),
    getStatuses: () => [],
    getStatus: () => ({ available: true, outputs: [] }),
    isAvailable: () => true,
    noteError: vi.fn(),
    destroyAll: vi.fn(async () => {})
  }
}

function fakeArtnet() {
  return { configure: vi.fn(), send: vi.fn(), getStatuses: () => [], getStatus: () => ({ connected: true, senders: [] }), noteError: vi.fn(), destroy: vi.fn() }
}

describe('DmxOutputManager', () => {
  it('a legacy USB-only configure keeps Art-Net running', async () => {
    const artnet = fakeArtnet()
    const usb = fakeUsb()
    const persist = vi.fn()
    const m = new DmxOutputManager({ universeCount: 3, artnet: artnet as any, usb: usb as any, persist })
    await m.apply(defaultOutputsConfig())
    const r = await m.configure([{ id: 'usb-0', type: 'usb-dmx', enabled: true, usbDmx: { driver: 'enttec-open-dmx', portPath: '/dev/ttyUSB0', universe: 0 } }])
    expect(r.success).toBe(true)
    expect(m.getConfig().artnet).toHaveLength(3)
    expect(m.getConfig().usb[0]).toMatchObject({ portPath: '/dev/ttyUSB0', serialNumber: 'SN1' })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('artnet.configure replaces only the Art-Net part', async () => {
    const usb = fakeUsb()
    const m = new DmxOutputManager({ universeCount: 3, artnet: fakeArtnet() as any, usb: usb as any })
    await m.apply({ artnet: [], usb: [{ id: 'usb-1', driver: 'enttec-pro', portPath: '/dev/ttyUSB0', universe: 0 }] })
    const r = await m.configureArtnet([{ host: '10.0.0.5', port: 6454, universe: 0, subnet: 0, net: 0 }])
    expect(r.success).toBe(true)
    expect(m.getConfig().usb).toHaveLength(1)
    expect(m.getConfig().artnet[0].host).toBe('10.0.0.5')
  })

  it('invalid input changes nothing and is not persisted', async () => {
    const artnet = fakeArtnet()
    const persist = vi.fn()
    const m = new DmxOutputManager({ universeCount: 3, artnet: artnet as any, usb: fakeUsb() as any, persist })
    await m.apply(defaultOutputsConfig())
    artnet.configure.mockClear()
    expect((await m.configure({ artnet: 'nope', usb: [] })).success).toBe(false)
    expect((await m.configureArtnet({ host: 'x' })).success).toBe(false)
    expect(artnet.configure).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('serialises concurrent configure calls', async () => {
    const order: string[] = []
    const usb = fakeUsb()
    usb.configure.mockImplementation(async (list: any[]) => {
      order.push(`start ${list.length}`)
      await new Promise(r => setTimeout(r, 10))
      order.push(`end ${list.length}`)
    })
    const m = new DmxOutputManager({ universeCount: 3, artnet: fakeArtnet() as any, usb: usb as any })
    const one = { artnet: [], usb: [{ driver: 'enttec-pro', portPath: '/dev/ttyUSB0', universe: 0 }] }
    await Promise.all([m.configure(one), m.configure({ artnet: [], usb: [] })])
    expect(order).toEqual(['start 1', 'end 1', 'start 0', 'end 0'])
  })

  it('persist failure still applies, with a warning', async () => {
    const m = new DmxOutputManager({ universeCount: 3, artnet: fakeArtnet() as any, usb: fakeUsb() as any, persist: () => { throw new Error('disk full') } })
    const r = await m.configure({ artnet: [], usb: [] })
    expect(r.success).toBe(true)
    expect(r.warning).toMatch(/disk full/)
  })
})

describe('DmxOutputManager warnings', () => {
  it('warns about outputs fed by a universe the engine does not drive', async () => {
    const m = new DmxOutputManager({ universeCount: 3, artnet: fakeArtnet() as any, usb: fakeUsb() as any })
    const r = await m.configure({ artnet: [{ host: '10.0.0.1', universe: 5 }], usb: [] })
    expect(r.success).toBe(true)
    expect(r.warning).toMatch(/Source universe 5 does not exist/)
  })
})
