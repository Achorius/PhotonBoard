import { describe, it, expect } from 'vitest'
import {
  defaultOutputsConfig,
  fromLegacyList,
  isValidHost,
  sourceUniverseProblem,
  validateArtnetList,
  validateOutputsConfig,
  artnetOutputUniverse
} from './output-config'

const artnet = (over: Record<string, unknown> = {}) => ({ host: '2.0.0.10', port: 6454, universe: 0, subnet: 0, net: 0, ...over })
const usb = (over: Record<string, unknown> = {}) => ({ driver: 'enttec-open-dmx', portPath: '/dev/ttyUSB0', universe: 0, ...over })

describe('isValidHost', () => {
  it('accepts IPv4 and host names', () => {
    for (const h of ['255.255.255.255', '2.0.0.1', '192.168.1.50', 'node-1', 'artnet.lan', 'pi.local']) {
      expect(isValidHost(h)).toBe(true)
    }
  })
  it('rejects garbage', () => {
    for (const h of ['', '256.1.1.1', '1.2.3', '01.2.3.4', 'a b', 'http://x', '-bad', 'x'.repeat(300), 42, null]) {
      expect(isValidHost(h)).toBe(false)
    }
  })
})

describe('validateOutputsConfig', () => {
  it('accepts the defaults', () => {
    const r = validateOutputsConfig(defaultOutputsConfig())
    expect(r.ok).toBe(true)
  })

  it('requires both lists to be arrays', () => {
    expect(validateOutputsConfig({ artnet: {}, usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [] }).ok).toBe(false)
    expect(validateOutputsConfig(null).ok).toBe(false)
    expect(validateOutputsConfig([]).ok).toBe(false)
  })

  it('checks ranges and integer types', () => {
    expect(validateOutputsConfig({ artnet: [artnet({ universe: 16 })], usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [artnet({ universe: 1.5 })], usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [artnet({ port: 0 })], usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [artnet({ net: 128 })], usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [artnet({ artnetUniverse: 16 })], usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [artnet({ host: '999.1.1.1' })], usb: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [], usb: [usb({ driver: 'nope' })] }).ok).toBe(false)
  })

  it('fills defaults, drops unknown fields and assigns unique ids', () => {
    const r = validateOutputsConfig({
      artnet: [{ host: '10.0.0.1', universe: 1, evil: true }, { host: '10.0.0.2', universe: 1, id: 'artnet-1' }],
      usb: []
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.artnet[0]).toEqual({ host: '10.0.0.1', port: 6454, universe: 1, subnet: 0, net: 0, enabled: true, id: 'artnet-2' })
    expect(r.config.artnet[1].id).toBe('artnet-1')
  })

  it('two Art-Net targets may share a source universe', () => {
    const r = validateOutputsConfig({ artnet: [artnet({ host: '10.0.0.1' }), artnet({ host: '10.0.0.2' })], usb: [] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(new Set(r.config.artnet.map(a => a.id)).size).toBe(2)
  })

  it('USB ports must exist (unless already configured) and cannot be used twice', () => {
    expect(validateOutputsConfig({ artnet: [], usb: [usb()] }, { availablePorts: [] }).ok).toBe(false)
    expect(validateOutputsConfig({ artnet: [], usb: [usb()] }, { availablePorts: ['/dev/ttyUSB0'] }).ok).toBe(true)
    expect(validateOutputsConfig({ artnet: [], usb: [usb()] }, { availablePorts: [], knownPorts: ['/dev/ttyUSB0'] }).ok).toBe(true)
    // startup load: no port check
    expect(validateOutputsConfig({ artnet: [], usb: [usb()] }).ok).toBe(true)
    const twice = validateOutputsConfig({ artnet: [], usb: [usb(), usb({ universe: 1 })] }, { availablePorts: ['/dev/ttyUSB0'] })
    expect(twice.ok).toBe(false)
  })
})

describe('legacy conversion', () => {
  it('a USB-only legacy list keeps the current Art-Net outputs', () => {
    const current = defaultOutputsConfig()
    const converted = fromLegacyList([{ id: 'usb-0', type: 'usb-dmx', enabled: true, usbDmx: usb() }], current) as any
    expect(converted.artnet).toEqual(current.artnet)
    expect(converted.usb).toHaveLength(1)
  })

  it('validateArtnetList rejects non-arrays without side effects', () => {
    expect(validateArtnetList({ host: 'x' }).ok).toBe(false)
    expect(validateArtnetList('nope').ok).toBe(false)
    expect(validateArtnetList([artnet()]).ok).toBe(true)
  })
})

describe('helpers', () => {
  it('artnetUniverse overrides the output universe', () => {
    expect(artnetOutputUniverse({ ...artnet({ universe: 2 }) } as any)).toBe(2)
    expect(artnetOutputUniverse({ ...artnet({ universe: 2, artnetUniverse: 7 }) } as any)).toBe(7)
  })
  it('reports source universes the engine does not drive', () => {
    expect(sourceUniverseProblem(2, 3)).toBeNull()
    expect(sourceUniverseProblem(3, 3)).toMatch(/does not exist/)
  })
})
