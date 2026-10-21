import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { FixtureDefinition, ShowFile } from '../../../shared/types'
import type { ImportContext } from '../../../shared/interchange'
import { createEmptyShow } from '../../../shared/show-format'
import { FixtureCatalog } from '../../fixture-catalog'
import { createImportContext } from '../context'
import { decodeText, detectDelimiter, parseRows } from './table'
import { detectColumns, fieldOfHeader, headerUnitFactor, looksLikeHeader } from './columns'
import { parseAddressCell, splitAbsolute } from './address'
import { genericDefinition, importCsvPatch, pickMode } from './import'
import { exportCsvPatch } from './export'

const SAMPLES = resolve(__dirname, '../../../../test-fixtures/interchange/csv')
const sample = (name: string) => new Uint8Array(readFileSync(join(SAMPLES, name)))
const catalog = new FixtureCatalog([resolve(__dirname, '../../../../resources/fixture-library')])

function ctx(library: FixtureDefinition[] = [], options?: ImportContext['options']): ImportContext {
  return createImportContext({ getLibrary: () => library, catalog }, options)
}

describe('table parsing', () => {
  it('detects the delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2,5;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('sep=;\na,b;c')).toBe(';')
  })

  it('parses quoted fields, doubled quotes and newlines in quotes', () => {
    const rows = parseRows('name,note\n"Spot, 1","say ""hi""\nthere"\n\nx,y\n', ',')
    expect(rows).toEqual([['name', 'note'], ['Spot, 1', 'say "hi"\nthere'], ['x', 'y']])
  })

  it('decodes UTF-8 with BOM and Windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A')
    expect(decodeText(new Uint8Array([0x4d, 0x6f, 0x64, 0xe8, 0x6c, 0x65]))).toBe('Modèle')
  })
})

describe('columns and addresses', () => {
  it('maps console / French header wordings', () => {
    expect(fieldOfHeader('Fixture ID')).toBe('fid')
    expect(fieldOfHeader('N° Projo')).toBe('fid')
    expect(fieldOfHeader('Channel')).toBe('fid')
    expect(fieldOfHeader('Modèle')).toBe('model')
    expect(fieldOfHeader('Fixture Type')).toBe('fixtureType')
    expect(fieldOfHeader('DMX Address')).toBe('address')
    expect(fieldOfHeader('Univers')).toBe('universe')
    expect(fieldOfHeader('X (mm)')).toBe('x')
    expect(fieldOfHeader('Perche')).toBe('position')
    expect(fieldOfHeader('Footprint')).toBe('channels')
    expect(fieldOfHeader('Whatever')).toBeNull()
    expect(headerUnitFactor('X (mm)')).toBe(0.001)
    expect(headerUnitFactor('Height ft')).toBeCloseTo(0.3048)
    expect(headerUnitFactor('X')).toBe(1)
  })

  it('recognises headers and guesses columns without them', () => {
    expect(looksLikeHeader(['Fixture ID', 'Name', 'Patch'])).toBe(true)
    expect(looksLikeHeader(['1', '1.001', 'Par 1'])).toBe(false)
    const guess = detectColumns(null, [['1', '1.001', 'Par 1'], ['2', '1.008', 'Par 2']])
    expect(guess.columns).toEqual(['fid', 'address', 'name'])
    expect(guess.confident).toBe(false)
  })

  it('parses every address notation', () => {
    expect(parseAddressCell('1.001')).toEqual({ universe: 1, address: 1 })
    expect(parseAddressCell('2/17')).toEqual({ universe: 2, address: 17 })
    expect(parseAddressCell('U3:100')).toEqual({ universe: 3, address: 100 })
    expect(parseAddressCell('2-017')).toEqual({ universe: 2, address: 17 })
    expect(parseAddressCell('17')).toEqual({ address: 17 })
    expect(parseAddressCell('513')).toEqual({ address: 513, absolute: true })
    expect(parseAddressCell('1.600')).toBeNull()
    expect(parseAddressCell('abc')).toBeNull()
    expect(splitAbsolute(513)).toEqual({ universe: 1, address: 1 })
    expect(splitAbsolute(512)).toEqual({ universe: 0, address: 512 })
  })
})

describe('fixture helpers', () => {
  it('builds generic definitions', () => {
    const d = genericDefinition('Acme Fog', 2)
    expect(d.modes[0]).toMatchObject({ name: '2ch', channelCount: 2 })
    expect(Object.keys(d.channels)).toEqual(['Channel 1', 'Channel 2'])
    expect(genericDefinition('', 1).channels.Dimmer.type).toBe('intensity')
  })

  it('picks modes by name, channel count, then the first', () => {
    const def = genericDefinition('X', 3)
    def.modes.push({ name: 'Extended', channels: ['Channel 1'], channelCount: 1 })
    expect(pickMode(def, 'extended', undefined)).toEqual({ name: 'Extended', exact: true })
    expect(pickMode(def, undefined, 1)).toEqual({ name: 'Extended', exact: true })
    expect(pickMode(def, '1 ch', undefined)?.name).toBe('Extended')
    expect(pickMode(def, 'Nope', undefined)).toEqual({ name: '3ch', exact: false })
  })
})

describe('CSV patch import (samples)', () => {
  it('grandMA-style export: types from the catalog, modes, groups by layer, CAD axes', async () => {
    const f = await importCsvPatch(sample('ma3-style-patch.csv'), 'ma3-style-patch.csv', ctx())
    expect(f.tabular?.confident).toBe(true)
    expect(f.patch).toHaveLength(9)
    const spot = f.patch.find((p) => p.name === 'Spot 2')!
    expect(spot).toMatchObject({ fid: 102, universe: 0, address: 15, modeName: 'Standard' })
    expect(spot.fixtureDefId).toBe('ofl/martin/mac-aura')
    // X stays X, CSV Y (depth) → z, CSV Z (height) → y
    expect(spot.position3D).toEqual({ x: -1.5, y: 6, z: 2 })
    const wash = f.patch.find((p) => p.name === 'Wash 1')!
    expect(wash.fixtureDefId).toBe('qlc/robe/robin-600-led-wash')
    expect(wash.modeName).toBe('Mode 3')
    expect(wash.universe).toBe(1)
    expect(wash.rotation3D?.ry).toBeCloseTo(Math.PI)
    const sharpy = f.patch.find((p) => p.name === 'Beam 1')!
    expect(sharpy.fixtureDefId).toBe('ofl/clay-paky/sharpy')
    // Unknown fixture: a generic 2-channel type, nothing lost
    const hazer = f.patch.find((p) => p.name === 'Hazer')!
    const generic = f.fixtures.find((d) => d.id === hazer.fixtureDefId)!
    expect(generic.modes[0].channelCount).toBe(2)
    expect(f.warnings.some((w) => w.code === 'fixtureTypeNotFound')).toBe(true)
    expect(f.groups.map((g) => g.name)).toEqual(['Front Truss', 'Back Truss', 'Floor'])
    expect(f.groups[0].fixtureIds).toHaveLength(4)
    expect(f.fixtures.map((d) => d.id)).toContain('ofl/martin/mac-aura')
  })

  it('French Excel export: ; + Windows-1252 + mm + decimal comma + ADJ alias', async () => {
    const f = await importCsvPatch(sample('lightwright-fr-excel.csv'), 'lightwright-fr-excel.csv', ctx())
    expect(f.tabular?.delimiter).toBe(';')
    expect(f.tabular?.headers[3]).toBe('Modèle')
    expect(f.patch).toHaveLength(5)
    const face = f.patch[0]
    expect(face).toMatchObject({ name: 'Face jardin', fid: 1, universe: 0, address: 1 })
    expect(face.fixtureDefId).toBe('ofl/american-dj/mega-par-profile-plus')
    expect(face.modeName).toBe('6-channel')
    expect(face.position3D?.x).toBeCloseTo(-2.5)
    expect(face.position3D?.y).toBeCloseTo(4.5005)
    expect(face.position3D?.z).toBeCloseTo(-1)
    expect(f.patch[4]).toMatchObject({ name: 'Découpe', universe: 1, address: 1 })
    expect(f.groups.map((g) => g.name)).toEqual(['Face', 'Contre'])
  })

  it('Eos-style TSV: absolute addresses, channel = fixture number, rows without an address', async () => {
    const f = await importCsvPatch(sample('eos-absolute.tsv'), 'eos-absolute.tsv', ctx())
    expect(f.tabular?.delimiter).toBe('\t')
    const cyc = f.patch.find((p) => p.name === 'Cyc 1')!
    expect(cyc).toMatchObject({ fid: 11, universe: 1, address: 1 })
    const mover = f.patch.find((p) => p.name === 'Mover')!
    expect(mover.address).toBeGreaterThan(0)
    expect(f.warnings.some((w) => w.code === 'csvAutoAddressed')).toBe(true)
  })

  it('no header: guessed columns, then the operator mapping wins', async () => {
    const first = await importCsvPatch(sample('no-header.csv'), 'no-header.csv', ctx())
    expect(first.tabular?.confident).toBe(false)
    expect(first.tabular?.hasHeader).toBe(false)
    expect(first.patch.map((p) => p.address)).toEqual([1, 8, 15])
    const again = await importCsvPatch(sample('no-header.csv'), 'no-header.csv', ctx([], {
      tabular: { hasHeader: false, columns: ['fid', 'address', 'fixtureType'] }
    }))
    expect(again.tabular?.confident).toBe(true)
    expect(again.patch[0].name).toMatch(/Par/)
  })

  it('never throws on garbage', async () => {
    const f = await importCsvPatch(new TextEncoder().encode('\n\n;;;\n'), 'x.csv', ctx())
    expect(f.patch).toEqual([])
    const g = await importCsvPatch(new Uint8Array([0xff, 0xfe, 0x00, 0x41]), 'y.csv', ctx())
    expect(Array.isArray(g.patch)).toBe(true)
  })
})

describe('CSV patch export', () => {
  const def: FixtureDefinition = genericDefinition('Acme Spot', 3)
  def.manufacturer = 'Acme'
  def.name = 'Spot'
  const show: ShowFile = createEmptyShow('Test')
  show.patch = [
    { id: 'a', fixtureDefId: def.id, modeName: '3ch', universe: 1, address: 5, name: 'Spot, left', groupIds: ['g'], fid: 7, position3D: { x: 1.25, y: 6, z: -2 } }
  ]
  show.groups = [{ id: 'g', name: 'Front', color: '#fff', fixtureIds: ['a'] }]

  it('writes a comma CSV that re-imports to the same patch', async () => {
    const { bytes } = exportCsvPatch(show, [def], { delimiter: ',', decimalComma: false, bom: false })
    const text = new TextDecoder().decode(bytes)
    expect(text.split('\r\n')[1]).toBe('7,"Spot, left",Acme,Spot,3ch,3,2,5,2.005,517,1.25,-2,6,,,,Front')
    const back = await importCsvPatch(bytes, 'export.csv', ctx([def]))
    expect(back.patch[0]).toMatchObject({ fid: 7, name: 'Spot, left', universe: 1, address: 5, fixtureDefId: def.id, modeName: '3ch' })
    expect(back.patch[0].position3D).toEqual({ x: 1.25, y: 6, z: -2 })
    expect(back.groups[0].name).toBe('Front')
  })

  it('writes the Excel variant with BOM, ; and decimal comma', async () => {
    const { bytes } = exportCsvPatch(show, [def], { delimiter: ';', decimalComma: true, bom: true })
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = decodeText(bytes)
    expect(text).toContain('7;Spot, left;Acme;Spot;3ch;3;2;5;2.005;517;1,25;-2;6')
    const back = await importCsvPatch(bytes, 'export.csv', ctx([def]))
    expect(back.patch[0].position3D).toEqual({ x: 1.25, y: 6, z: -2 })
  })
})
