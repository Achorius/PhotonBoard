import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { gunzipSync } from 'zlib'
import AdmZip from 'adm-zip'
import type { FixtureDefinition, ShowFile } from '../../../shared/types'
import { parseGDTF } from '../../fixture-parsers'
import { lookupGdtfAttribute } from './attributes'
import { cieToHex, hexToCie, parseCie } from './color'
import { parseDmxValue, parseGdtfArchive, parseGdtfDescription } from './gdtf-import'
import { attributeForChannel, buildGdtfDescription, gdtfFileName, gdtfName, writeGdtf } from './gdtf-export'
import { gdtfExporter, gdtfImporter } from './index'
import { parseXml, kid, kids, attr } from './xml'

const ROOT = resolve(__dirname, '../../../..')
const FIX = join(ROOT, 'test-fixtures/interchange/gdtf')
const XSD = join(FIX, 'gdtf-1.2.xsd')
const spotXml = readFileSync(join(FIX, 'test-spot.description.xml'), 'utf-8')
const barXml = readFileSync(join(FIX, 'test-bar.description.xml'), 'utf-8')
const NOW = new Date('2026-06-01T12:00:00Z')

export function zipGdtf(xml: string): Uint8Array {
  const zip = new AdmZip()
  zip.addFile('description.xml', Buffer.from(xml, 'utf-8'))
  return new Uint8Array(zip.toBuffer())
}

function catalogFixture(shard: string, id: string): FixtureDefinition {
  const data = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'resources/fixture-library/fixtures', `${shard}.json.gz`))).toString()) as Record<string, FixtureDefinition>
  if (!data[id]) throw new Error(`missing catalog fixture ${id}`)
  return data[id]
}

const hasXmllint = spawnSync('xmllint', ['--version']).status === 0

/** XSD validation with xmllint when it is installed (CI images without it skip) */
function validateXsd(xml: string): string | null {
  if (!hasXmllint) return null
  const dir = mkdtempSync(join(tmpdir(), 'pb-gdtf-'))
  try {
    const file = join(dir, 'description.xml')
    writeFileSync(file, xml)
    const r = spawnSync('xmllint', ['--noout', '--schema', XSD, file], { encoding: 'utf-8' })
    return r.status === 0 ? null : r.stderr
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const par: FixtureDefinition = {
  id: 'test/rgbw-par',
  name: 'RGBW Par 7',
  manufacturer: 'Test Co.',
  categories: ['Color Changer'],
  channels: {
    Dimmer: { name: 'Dimmer', type: 'intensity', precedence: 'HTP', highlightValue: 255, capabilities: [{ dmxRange: [0, 255], type: 'Intensity', label: 'Intensity 0…100%' }] },
    Red: { name: 'Red', type: 'color', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red', color: '#ff0000' }] },
    Green: { name: 'Green', type: 'color', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Green', color: '#00ff00' }] },
    Blue: { name: 'Blue', type: 'color', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Blue', color: '#0000ff' }] },
    White: { name: 'White', type: 'color', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'White', color: '#ffffff' }] },
    Amber: { name: 'Amber', type: 'color', precedence: 'LTP' },
    Strobe: {
      name: 'Strobe', type: 'strobe', precedence: 'LTP', defaultValue: 0,
      capabilities: [
        { dmxRange: [0, 9], type: 'ShutterOpen', label: 'No strobe' },
        { dmxRange: [10, 250], type: 'ShutterStrobe', label: 'Strobe 1…20Hz' },
        { dmxRange: [251, 255], type: 'ShutterOpen', label: 'Open' }
      ]
    },
    'Color Macros': {
      name: 'Color Macros', type: 'color', precedence: 'LTP',
      capabilities: [
        { dmxRange: [0, 9], type: 'NoFunction', label: 'No function' },
        { dmxRange: [10, 99], type: 'ColorPreset', label: 'Red', color: '#ff0000' },
        { dmxRange: [100, 199], type: 'ColorPreset', label: 'Blue', color: '#0000ff' }
      ]
    }
  },
  modes: [
    { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Strobe', 'Color Macros'], channelCount: 8 },
    { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 }
  ],
  physical: { dimensions: [200, 250, 180], weight: 2.4, power: 120, lens: { degreesMinMax: [25, 25] } }
}

describe('GDTF attributes / colours / DMX values', () => {
  it('resolves standard attributes with wildcards', () => {
    expect(lookupGdtfAttribute('Gobo2Pos')).toMatchObject({ feature: 'Gobo.Gobo', activationGroup: 'Gobo2Pos', physicalUnit: 'Angle', n: 2 })
    expect(lookupGdtfAttribute('Shutter1Strobe')).toMatchObject({ feature: 'Beam.Beam', mainAttribute: 'Shutter1' })
    expect(lookupGdtfAttribute('ColorAdd_R')?.color).toBe('0.64,0.33,21.3')
    expect(lookupGdtfAttribute('Effects3Adjust2')).toMatchObject({ n: 3, m: 2 })
    expect(lookupGdtfAttribute('MyCustom')).toBeNull()
  })

  it('converts CIE xyY ↔ hex', () => {
    expect(cieToHex(0.3127, 0.329)).toBe('#ffffff')
    expect(cieToHex(0.64, 0.33)).toBe('#ff0000')
    expect(cieToHex(0.15, 0.06)).toBe('#0000ff')
    const c = hexToCie('#00ff00')!
    expect(c.x).toBeCloseTo(0.3, 2)
    expect(c.y).toBeCloseTo(0.6, 2)
    expect(parseCie('nonsense')).toBeNull()
  })

  it('parses DMX values (byte mirroring / shifting)', () => {
    expect(parseDmxValue('128/1', 1)).toBe(128)
    expect(parseDmxValue('255/1', 2)).toBe(65535)
    expect(parseDmxValue('128/1', 2)).toBe(0x8080)
    expect(parseDmxValue('128/1s', 2)).toBe(0x8000)
    expect(parseDmxValue('32768/2', 1)).toBe(128)
    expect(parseDmxValue('42', 1)).toBe(42)
    expect(parseDmxValue('None', 1)).toBeNull()
    expect(parseDmxValue('abc', 1)).toBeNull()
  })
})

describe('GDTF import', () => {
  it('reads a 16-bit moving head: offsets, fine channels, functions, wheels, physical', () => {
    const { definition: d, notes, fixtureTypeId } = parseGdtfArchive(zipGdtf(spotXml), 'PhotonBoard Labs@Test Spot 300.gdtf')
    expect(fixtureTypeId).toBe('5B4F2C6E-1A2B-4C3D-8E9F-0A1B2C3D4E5F')
    expect(d.name).toBe('Test Spot 300')
    expect(d.manufacturer).toBe('PhotonBoard Labs')
    expect(d.shortName).toBe('TS300')
    expect(d.source).toBe('gdtf')
    expect(d.categories).toEqual(['Moving Head'])
    expect(d.lastModified).toBe('2026-05-04T10:00:00.000Z')

    const std = d.modes.find((m) => m.name === 'Standard 16bit')!
    expect(std.channelCount).toBe(18)
    expect(std.channels).toEqual(['Pan', 'Pan fine', 'Tilt', 'Tilt fine', 'Pan/Tilt Speed', 'Control', 'Color Wheel', 'Cyan', 'Magenta', 'Yellow', 'Gobo Wheel', 'Gobo Rotation', 'Gobo Rotation fine', 'Shutter', 'Dimmer', 'Dimmer fine', 'Zoom', 'Focus'])
    const basic = d.modes.find((m) => m.name === 'Basic 8bit')!
    expect(basic.channels).toEqual(['Pan', 'Tilt', 'Color Wheel', 'No function', 'Dimmer'])

    expect(d.channels.Pan).toMatchObject({ type: 'pan', defaultValue: 128, fineChannelAliases: ['Pan fine'] })
    expect(d.channels.Pan.capabilities).toEqual([{ dmxRange: [0, 255], type: 'Pan', label: 'Pan' }])
    expect(d.channels['Pan fine']).toMatchObject({ type: 'pan', fineOf: 'Pan', defaultValue: 0 })
    expect(d.channels.Dimmer).toMatchObject({ type: 'intensity', precedence: 'HTP', highlightValue: 255 })
    expect(d.channels.Shutter.defaultValue).toBe(20)
    expect(d.channels.Shutter.capabilities!.map((c) => [c.dmxRange, c.type, c.label])).toEqual([
      [[0, 15], 'ShutterClose', 'Closed'],
      [[16, 31], 'ShutterOpen', 'Open'],
      [[32, 127], 'ShutterStrobe', 'Strobe 1…20Hz'],
      [[128, 239], 'ShutterStrobe', 'Random 1…10Hz'],
      [[240, 255], 'ShutterOpen', 'Open 2']
    ])
    const color = d.channels['Color Wheel'].capabilities!
    expect(color[1]).toMatchObject({ dmxRange: [10, 19], type: 'WheelSlot', label: 'Red', wheel: 'Color Wheel', wheelSlot: 2, color: '#ff0000' })
    expect(color[4]).toMatchObject({ dmxRange: [128, 255], type: 'WheelRotation' })
    expect(d.channels['Gobo Wheel'].capabilities![3]).toMatchObject({ type: 'WheelShake', wheelSlot: 2 })
    expect(d.channels['Gobo Wheel'].capabilities![1]).toMatchObject({ image: 'gobo_dots' })
    expect(d.channels['Control'].capabilities!.map((c) => c.label)).toEqual(['No function', 'Reset all', 'Reserved', 'Display off', 'Display on'])
    expect(d.channels.Cyan.capabilities![0]).toMatchObject({ type: 'ColorIntensity', color: '#00ffff' })

    expect(d.wheels!.map((w) => w.slots.map((s) => s.type))).toEqual([['Open', 'Color', 'Color', 'Color'], ['Open', 'Gobo', 'Gobo']])
    expect(d.physical).toMatchObject({ weight: 18.5, power: 420, panRange: 540, tiltRange: 270, lens: { degreesMinMax: [8, 40] }, dimensions: [380, 120, 250], bulb: { type: 'LED', lumens: 12000 } })

    expect(notes.some((n) => /virtual/.test(n))).toBe(true)
    expect(notes.some((n) => /2 DMX breaks/.test(n))).toBe(true)
    expect(notes.some((n) => /mode-dependent/.test(n))).toBe(true)
  })

  it('expands geometry references into numbered pixel channels', () => {
    const { definition: d } = parseGdtfDescription(barXml)
    const mode = d.modes[0]
    expect(mode.channelCount).toBe(13)
    expect(mode.channels).toEqual(['Dimmer', 'Red 1', 'Green 1', 'Blue 1', 'Red 2', 'Green 2', 'Blue 2', 'Red 3', 'Green 3', 'Blue 3', 'Red 4', 'Green 4', 'Blue 4'])
    expect(mode.pixelLayout?.cellCount).toBe(4)
    expect(mode.pixelLayout?.cells[1]).toEqual({ index: 1, channelOffset: 4, channelNames: ['Red 2', 'Green 2', 'Blue 2'] })
    expect(d.categories).toEqual(['Pixel Bar'])
    expect(d.channels['Red 3']).toMatchObject({ type: 'color', highlightValue: 255 })
  })

  it('rejects non-GDTF input and survives broken content', () => {
    expect(() => parseGdtfArchive(new Uint8Array([1, 2, 3]))).toThrow(/Not a GDTF/)
    const zip = new AdmZip()
    zip.addFile('other.txt', Buffer.from('x'))
    expect(() => parseGdtfArchive(new Uint8Array(zip.toBuffer()))).toThrow(/description.xml/)
    expect(() => parseGdtfDescription('<foo/>')).toThrow(/FixtureType/)
    // A mode without channels and odd values still parses
    const odd = parseGdtfDescription('<GDTF DataVersion="1.0"><FixtureType Name="Odd" Manufacturer="X"><DMXModes><DMXMode Name="M"><DMXChannels><DMXChannel Offset="2,x" Default="bad"><LogicalChannel Attribute="Weird_Thing"><ChannelFunction DMXFrom="zz"/></LogicalChannel></DMXChannel></DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>')
    expect(odd.definition.modes[0].channels).toEqual(['No function', 'Weird Thing'])
  })

  it('the legacy library parser (parseGDTF) uses the same converter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-gdtf-'))
    try {
      const file = join(dir, 'spot.gdtf')
      writeFileSync(file, zipGdtf(spotXml))
      const d = parseGDTF(file)
      expect(d.modes.find((m) => m.name === 'Standard 16bit')!.channelCount).toBe(18)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('GDTF export', () => {
  it('maps console channels to GDTF attributes', () => {
    const ch = (type: FixtureDefinition['channels'][string]['type']) => ({ name: 'x', type })
    expect(attributeForChannel('Dimmer', ch('intensity'), false)).toBe('Dimmer')
    expect(attributeForChannel('Red Master', ch('color'), false)).toBe('ColorAdd_R')
    expect(attributeForChannel('Amber', ch('color'), false)).toBe('ColorAdd_RY')
    expect(attributeForChannel('UV', ch('color'), false)).toBe('ColorAdd_UV')
    expect(attributeForChannel('Cyan', ch('color'), false)).toBe('ColorSub_C')
    expect(attributeForChannel('CTO', ch('color'), false)).toBe('CTO')
    expect(attributeForChannel('Color Wheel', ch('color'), false)).toBe('Color1')
    expect(attributeForChannel('Gobo Wheel 2', ch('gobo'), false)).toBe('Gobo2')
    expect(attributeForChannel('Gobo 2 Rotation', ch('gobo'), false)).toBe('Gobo2Pos')
    expect(attributeForChannel('Pan/Tilt Speed', ch('speed'), false)).toBe('PositionMSpeed')
    expect(attributeForChannel('Shutter', ch('shutter'), false)).toBe('Shutter1')
    expect(attributeForChannel('Strobe', ch('strobe'), false)).toBe('Shutter1')
    expect(attributeForChannel('Strobe', ch('strobe'), true)).toBe('Shutter1Strobe')
    expect(attributeForChannel('Strobe Speed', ch('strobe'), true)).toBe('StrobeRate')
    expect(attributeForChannel('Zoom', ch('generic'), false)).toBe('Zoom')
    expect(attributeForChannel('Prism Rotation', ch('prism'), false)).toBe('Prism1PosRotate')
    expect(attributeForChannel('Reset', ch('maintenance'), false)).toBe('FixtureGlobalReset')
    expect(attributeForChannel('Pixel Select', ch('generic'), false)).toBe('PixelSelect')
    expect(gdtfName('Mégapointe 2.0 [x]')).toBe('Megapointe 2_0 _x_')
    expect(gdtfName('Mégapointe 2.0', 'F', true)).toBe('Megapointe 2.0')
    expect(gdtfFileName({ manufacturer: 'Clay Paky', name: 'A.leda Wash K20' })).toBe('Clay_Paky@A_leda_Wash_K20@PhotonBoard.gdtf')
  })

  it('writes a valid GDTF 1.2 that re-imports with the same footprint and channel types', () => {
    const res = writeGdtf(par, { now: NOW, appVersion: '1.1.1' })
    expect(res.fileName).toBe('Test_Co@RGBW_Par_7@PhotonBoard.gdtf')
    expect(validateXsd(res.xml)).toBeNull()
    const doc = parseXml(res.xml)
    const ft = kid(kid(doc, 'GDTF'), 'FixtureType')!
    expect(attr(kid(doc, 'GDTF'), 'DataVersion')).toBe('1.2')
    expect(attr(ft, 'Manufacturer')).toBe('Test Co.')
    const attrNames = kids(kid(kid(ft, 'AttributeDefinitions'), 'Attributes'), 'Attribute').map((a) => attr(a, 'Name'))
    expect(attrNames).toEqual(expect.arrayContaining(['Dimmer', 'ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'ColorAdd_W', 'ColorAdd_RY', 'Shutter1', 'Shutter1Strobe', 'ColorMacro1', 'NoFeature']))
    const mode = kids(kid(ft, 'DMXModes'), 'DMXMode')[0]
    const strobe = kids(kid(mode, 'DMXChannels'), 'DMXChannel')[6]
    const fns = kids(kid(strobe, 'LogicalChannel'), 'ChannelFunction')
    expect(fns.map((f) => [attr(f, 'Attribute'), attr(f, 'DMXFrom'), attr(f, 'PhysicalFrom'), attr(f, 'PhysicalTo')])).toEqual([
      ['Shutter1', '0/1', undefined, undefined],
      ['Shutter1Strobe', '10/1', '1', '20'],
      ['Shutter1', '251/1', undefined, undefined]
    ])

    const back = parseGdtfArchive(res.bytes, res.fileName).definition
    for (const m of par.modes) {
      const bm = back.modes.find((x) => x.name === m.name)!
      expect(bm.channelCount).toBe(m.channelCount)
      expect(bm.channels.map((c) => back.channels[c].type)).toEqual(m.channels.map((c) => par.channels[c].type === 'strobe' ? 'shutter' : par.channels[c].type))
    }
    expect(back.channels.Strobe ?? back.channels.Shutter).toBeDefined()
    const strobeBack = back.channels.Shutter
    expect(strobeBack.capabilities!.find((c) => c.type === 'ShutterStrobe')).toMatchObject({ dmxRange: [10, 250], label: 'Strobe 1-20Hz' })
    expect(back.physical).toMatchObject({ weight: 2.4, lens: { degreesMinMax: [25, 25] } })
  })

  it('round-trips a moving head and a pixel bar (GDTF → PhotonBoard → GDTF → PhotonBoard)', () => {
    for (const xml of [spotXml, barXml]) {
      const first = parseGdtfDescription(xml).definition
      const res = writeGdtf(first, { now: NOW })
      expect(validateXsd(res.xml)).toBeNull()
      const second = parseGdtfArchive(res.bytes, res.fileName).definition
      expect(second.modes.map((m) => [m.name, m.channels])).toEqual(first.modes.map((m) => [m.name, m.channels]))
      for (const [name, ch] of Object.entries(first.channels)) {
        expect(second.channels[name]?.type, name).toBe(ch.type)
        expect(second.channels[name]?.fineOf, name).toBe(ch.fineOf)
        expect(second.channels[name]?.defaultValue ?? 0, name).toBe(ch.defaultValue ?? 0)
        expect((second.channels[name]?.capabilities ?? []).map((c) => [c.dmxRange, c.type]), name).toEqual((ch.capabilities ?? []).map((c) => [c.dmxRange, c.type]))
      }
      expect(second.modes.map((m) => m.pixelLayout?.cellCount)).toEqual(first.modes.map((m) => m.pixelLayout?.cellCount))
      expect(second.wheels?.map((w) => w.slots.map((s) => [s.name, s.color]))).toEqual(first.wheels?.map((w) => w.slots.map((s) => [s.name, s.color])))
      expect(second.physical?.panRange).toBe(first.physical?.panRange)
    }
  })

  it('exports real catalog fixtures (OFL / QLC+) to valid GDTF with identical footprints', () => {
    const defs = [
      catalogFixture('martin', 'ofl/martin/mac-aura'),
      catalogFixture('martin', 'qlc/martin/mac-aura-xip'),
      catalogFixture('chauvet-dj', 'ofl/chauvet-dj/colorband-pix')
    ]
    for (const def of defs) {
      const res = writeGdtf(def, { now: NOW })
      expect(validateXsd(res.xml), def.id).toBeNull()
      const back = parseGdtfArchive(res.bytes).definition
      for (const m of def.modes) {
        const bm = back.modes.find((x) => x.name === res.modeNames.get(m.name))
        expect(bm?.channelCount, `${def.id} ${m.name}`).toBe(m.channelCount)
      }
    }
  })

  it('keeps stable ids and names unique', () => {
    const a = buildGdtfDescription(par, { now: NOW })
    const b = buildGdtfDescription(par, { now: NOW })
    expect(a.xml).toBe(b.xml)
    expect(a.fixtureTypeId).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)
    const dup: FixtureDefinition = { ...par, modes: [par.modes[0], { ...par.modes[1], name: '8ch' }] }
    const res = buildGdtfDescription(dup, { now: NOW })
    const modes = kids(kid(kid(kid(parseXml(res.xml), 'GDTF'), 'FixtureType'), 'DMXModes'), 'DMXMode').map((m) => attr(m, 'Name'))
    expect(modes).toEqual(['8ch', '8ch 2'])
    expect(validateXsd(res.xml)).toBeNull()
  })
})

describe('GDTF importer / exporter plug-ins', () => {
  const ctx = { findFixture: async () => null, parseGdtf: async () => null, parseQxf: async () => null }

  it('detects .gdtf archives but not MVR files', () => {
    const gdtf = zipGdtf(spotXml)
    expect(gdtfImporter.detect('x.gdtf', gdtf.subarray(0, 65536))).toBe(1)
    expect(gdtfImporter.detect('x.bin', gdtf.subarray(0, 65536))).toBeGreaterThanOrEqual(0.3)
    const mvr = new AdmZip()
    mvr.addFile('GeneralSceneDescription.xml', Buffer.from('<x/>'))
    mvr.addFile('a.gdtf', Buffer.from(gdtf))
    expect(gdtfImporter.detect('x.mvr', new Uint8Array(mvr.toBuffer()))).toBe(0)
    expect(gdtfImporter.detect('x.gdtf', new Uint8Array([0x3c, 0x3f]))).toBe(0)
  })

  it('imports a fixture fragment', async () => {
    const frag = await gdtfImporter.parse(zipGdtf(spotXml), 'Test.gdtf', ctx)
    expect(frag.format).toBe('gdtf')
    expect(frag.fixtures).toHaveLength(1)
    expect(frag.patch).toHaveLength(0)
    expect(frag.warnings.length).toBeGreaterThan(0)
  })

  it('exports one fixture (writeFixture) and the single type of a show', async () => {
    const one = await gdtfExporter.writeFixture!(par)
    expect(one.fileName).toBe('Test_Co@RGBW_Par_7@PhotonBoard.gdtf')
    expect(parseGdtfArchive(one.bytes).definition.name).toBe('RGBW Par 7')
    const other: FixtureDefinition = { ...par, id: 'test/other', name: 'Other' }
    const show = { patch: [{ id: 'p1', fixtureDefId: par.id }, { id: 'p2', fixtureDefId: other.id }] } as unknown as ShowFile
    const res = await gdtfExporter.write(show, [par, other])
    expect(res.warnings.map((w) => w.code)).toContain('gdtf.export.singleFixture')
    expect(parseGdtfArchive(res.bytes).definition.name).toBe('RGBW Par 7')
  })
})
