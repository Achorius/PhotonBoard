import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { FixtureDefinition } from '../../shared/types'
import { createEmptyShow } from '../../shared/show-format'
import { FixtureCatalog } from '../fixture-catalog'
import AdmZip from 'adm-zip'
import { createInterchangeHost, sanitizeFragment } from './index'
import { compactKey, createImportContext, findExactCatalogFixture, findFixture, manufacturerKey, modelKey, scoreCandidate } from './context'
import { detectImporter, listImporters } from './registry'
import { detectUnsupported, listUnsupported } from './unsupported'
import { genericDefinition } from './csv/import'

const ROOT = resolve(__dirname, '../../..')
const catalog = new FixtureCatalog([join(ROOT, 'resources/fixture-library')])
const enc = (s: string) => new TextEncoder().encode(s)

describe('manufacturer / model matching', () => {
  it('normalises manufacturer aliases', () => {
    expect(manufacturerKey('ADJ')).toBe(manufacturerKey('American DJ'))
    expect(manufacturerKey('Martin Professional')).toBe(manufacturerKey('Martin'))
    expect(manufacturerKey('Robe lighting')).toBe(manufacturerKey('Robe'))
    expect(manufacturerKey('Robe Lighting s.r.o.')).toBe('robe')
    expect(manufacturerKey('Clay Paky')).toBe(manufacturerKey('ClayPaky'))
    expect(manufacturerKey('Chauvet DJ')).toBe(manufacturerKey('Chauvet Professional'))
    expect(manufacturerKey('Robert Juliat')).not.toBe(manufacturerKey('Robe'))
    expect(compactKey('Mégapointe ')).toBe('megapointe')
    expect(modelKey('Robe Robin 600', 'Robe')).toBe('robin600')
  })

  it('scores exact > prefix > typo, and wants the maker to agree', () => {
    const c = { manufacturer: 'Martin', names: ['MAC Aura'], counts: [14, 25] }
    const exact = scoreCandidate(c, 'Martin Professional', 'Mac Aura', 14)
    const typo = scoreCandidate(c, 'Martin', 'MAC Arua')
    expect(exact).toBeGreaterThan(typo)
    expect(typo).toBeGreaterThan(0)
    expect(scoreCandidate(c, 'Robe', 'MAC Aura')).toBe(0)
  })

  it('finds library fixtures first, then the catalog', async () => {
    const lib: FixtureDefinition = { ...genericDefinition('MAC Aura', 14), id: 'user/mac-aura', manufacturer: 'Martin', name: 'MAC Aura' }
    expect((await findFixture({ getLibrary: () => [lib], catalog }, 'Martin Professional', 'Mac Aura', 14))?.id).toBe('user/mac-aura')
    expect((await findFixture({ getLibrary: () => [], catalog }, 'Martin Professional', 'Mac Aura', 14))?.id).toBe('ofl/martin/mac-aura')
    expect((await findFixture({ getLibrary: () => [], catalog }, 'ADJ', 'Vizi Beam 5RX'))?.id).toBe('qlc/american-dj/vizi-beam-5rx')
    expect(await findFixture({ getLibrary: () => [], catalog }, 'Nobody', 'Imaginary 9000')).toBeNull()
  })

  it('tries the catalog’s exact id before matching names', async () => {
    // A library type with the same name would win the name match: the exact catalog id comes first
    const decoy: FixtureDefinition = { ...genericDefinition('MAC Aura', 14), id: 'user/mac-aura', manufacturer: 'Martin', name: 'MAC Aura' }
    expect((await findFixture({ getLibrary: () => [decoy], catalog }, 'Martin', 'MAC Aura'))?.id).toBe('ofl/martin/mac-aura')
    expect((await findExactCatalogFixture({ getLibrary: () => [], catalog }, 'American DJ', 'Vizi Beam 5RX'))?.id).toBe('qlc/american-dj/vizi-beam-5rx')
    // …and the installed copy of that catalog type when the library has it
    const installed: FixtureDefinition = { ...genericDefinition('MAC Aura', 14), id: 'ofl/martin/mac-aura', manufacturer: 'Martin', name: 'MAC Aura (mine)' }
    expect(await findFixture({ getLibrary: () => [installed], catalog }, 'Martin', 'MAC Aura')).toBe(installed)
    expect(await findExactCatalogFixture({ getLibrary: () => [] }, 'Martin', 'MAC Aura')).toBeNull()
    expect(await findExactCatalogFixture({ getLibrary: () => [], catalog }, '', 'MAC Aura')).toBeNull()
  })

  it('parses embedded GDTFs with their file name (names a fixture type the description leaves unnamed)', async () => {
    const xml = readFileSync(join(ROOT, 'test-fixtures/interchange/gdtf/test-spot.description.xml'), 'utf8')
      .replace(/ (Name|ShortName|LongName)="[^"]*"/, '')
      .replace(/<FixtureType ShortName="[^"]*" LongName="[^"]*"/, '<FixtureType')
    const zip = new AdmZip()
    zip.addFile('description.xml', Buffer.from(xml, 'utf8'))
    const ctx = createImportContext({ getLibrary: () => [] })
    const def = await ctx.parseGdtf(new Uint8Array(zip.toBuffer()), 'Acme@Wonder Spot@rev2.gdtf')
    expect(def?.name).toBe('Wonder Spot')
    expect(await ctx.parseGdtf(enc('not a zip'), 'x.gdtf')).toBeNull()
  })
})

describe('GDTF files have one importer', () => {
  function gdtfBytes(extra: string[] = []): Uint8Array {
    const zip = new AdmZip()
    zip.addFile('description.xml', readFileSync(join(ROOT, 'test-fixtures/interchange/gdtf/test-spot.description.xml')))
    for (const name of extra) zip.addFile(name, Buffer.from('x'))
    return new Uint8Array(zip.toBuffer())
  }

  it('format ids are unique, and only the GDTF importer claims a .gdtf', () => {
    const list = createInterchangeHost({ getLibrary: () => [] }).listFormats()
    const importerIds = list.importers.map((i) => i.id)
    const exporterIds = list.exporters.map((i) => i.id)
    expect(new Set(importerIds).size).toBe(importerIds.length)
    expect(new Set(exporterIds).size).toBe(exporterIds.length)
    expect(importerIds.filter((id) => id === 'gdtf')).toHaveLength(1)
    for (const [name, bytes] of [
      ['Robe@Spot@v1.gdtf', gdtfBytes()],
      ['Robe@Spot@v1.gdtf', gdtfBytes(['wheels/gobo1.png', 'models/3ds/base.3ds'])],
      ['fixture.zip', gdtfBytes()]
    ] as const) {
      const claims = listImporters().filter((i) => i.detect(name, bytes.subarray(0, 64 * 1024)) > 0).map((i) => i.info.id)
      expect(claims, name).toEqual(['gdtf'])
      expect(detectImporter(name, bytes.subarray(0, 64 * 1024))?.importer.info.id).toBe('gdtf')
    }
  })

  it('a dropped .gdtf becomes a fragment with its fixture type (installed by the merge)', async () => {
    const host = createInterchangeHost({ getLibrary: () => [] })
    const res = await host.importBytes(gdtfBytes(), 'PhotonBoard Labs@Test Spot 300@v1.gdtf')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.fragment.format).toBe('gdtf')
    expect(res.fragment.fixtures.map((d) => d.name)).toEqual(['Test Spot 300'])
    expect(res.fragment.patch).toEqual([])
  })
})

describe('closed formats', () => {
  it('recognises console show files and explains them', () => {
    expect(detectUnsupported('My Show.show', enc('xx'))?.key).toBe('grandma3Show')
    expect(detectUnsupported('My Show.show.gz', new Uint8Array([0x1f, 0x8b, 8]))?.key).toBe('grandma2Show')
    expect(detectUnsupported('My Show.show', new Uint8Array([0x1f, 0x8b, 8]))?.key).toBe('grandma2Show')
    expect(detectUnsupported('gig.shw', enc('...'))?.app).toBe('ChamSys MagicQ')
    expect(detectUnsupported('theatre.esf3d', enc('..'))?.key).toBe('eosShow')
    expect(detectUnsupported('club.ONYXShow', enc('..'))?.key).toBe('onyxShow')
    expect(detectUnsupported('home.lightkeyproj', enc('..'))?.key).toBe('lightkeyProject')
    expect(detectUnsupported('patch.xlsx', enc('PK'))?.suggestedFormats).toEqual(['csv-patch'])
    expect(detectUnsupported('notes.md', enc('hello'))).toBeNull()
    expect(listUnsupported().find((u) => u.key === 'grandma2Show')?.extensions).toEqual(['show.gz', 'show'])
  })
})

describe('interchange host', () => {
  const host = createInterchangeHost({ getLibrary: () => [], catalog })

  it('lists formats (importers, exporters, recognised closed formats)', () => {
    const list = host.listFormats()
    expect(list.importers.map((i) => i.id)).toEqual(expect.arrayContaining(['photonboard', 'csv-patch']))
    expect(list.exporters.map((i) => i.id)).toEqual(expect.arrayContaining(['photonboard', 'csv-patch', 'csv-patch-excel']))
    expect(list.recognised.length).toBeGreaterThan(5)
    expect(host.importExtensions()).toEqual(expect.arrayContaining(['pbshow', 'csv', 'shw', 'show']))
  })

  it('imports the demo show as a fragment (every section)', async () => {
    const result = await host.importPath(join(ROOT, 'scripts/dev/demo-show.pbshow'))
    expect(result.success).toBe(true)
    if (!result.success) return
    const f = result.fragment
    expect(f.format).toBe('photonboard')
    expect(f.patch.length).toBe(23)
    expect(f.groups.length).toBeGreaterThan(0)
    expect(f.cuelists.length).toBe(12)
    expect(f.executor?.pages?.length).toBeGreaterThan(0)
    expect(f.speedMasters).toEqual([])
    expect(result.fileName).toBe('demo-show.pbshow')
  })

  it('answers closed formats with guidance, unknown files with an error code', async () => {
    const ma3 = await host.importBytes(enc('binary'), 'Concert.show')
    expect(ma3.success).toBe(false)
    if (!ma3.success) {
      expect(ma3.errorCode).toBe('unsupported')
      expect(ma3.guidance?.app).toBe('grandMA3')
      expect(ma3.guidance?.suggestedFormats[0]).toBe('mvr')
    }
    const unknown = await host.importBytes(enc('hello'), 'notes.md')
    expect(unknown.success === false && unknown.errorCode).toBe('unknownFormat')
    const empty = await host.importBytes(new Uint8Array(), 'x.csv')
    expect(empty.success === false && empty.errorCode).toBe('emptyFile')
    const missing = await host.importPath(join(tmpdir(), 'does-not-exist-pb.csv'))
    expect(missing.success === false && missing.errorCode).toBe('notFound')
  })

  it('reports a broken file of a known format as parseFailed (never throws)', async () => {
    const res = await host.importBytes(enc('{ not json'), 'broken.pbshow')
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.errorCode).toBe('parseFailed')
      expect(res.error).toMatch(/JSON/)
    }
  })

  it('imports a CSV from disk and forces a format', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-interchange-'))
    const file = join(dir, 'patch.txt')
    writeFileSync(file, 'Fixture ID;Name;Patch;Channels\n1;Par;1.001;3\n')
    const res = await host.importPath(file, { format: 'csv-patch' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.fragment.patch[0]).toMatchObject({ name: 'Par', address: 1, fid: 1 })
    expect(res.path).toBe(file)
  })

  it('exports a show (pbshow round trip, CSV) and rejects bad requests', async () => {
    const demo = JSON.parse(readFileSync(join(ROOT, 'scripts/dev/demo-show.pbshow'), 'utf8'))
    const out = await host.exportShow('photonboard', demo, [])
    expect(out.success).toBe(true)
    if (out.success) {
      expect(out.fileName).toMatch(/\.pbshow$/)
      const back = await host.importBytes(out.bytes, out.fileName)
      expect(back.success && back.fragment.patch.length).toBe(23)
    }
    const csv = await host.exportShow('csv-patch', createEmptyShow('A/B'), [])
    expect(csv.success && csv.fileName).toBe('A B.csv')
    expect((await host.exportShow('nope', demo, [])).success).toBe(false)
    const bad = await host.exportShow('csv-patch', 'garbage', [])
    expect(bad.success === false && bad.errorCode).toBe('invalidShow')
  })

  it('sanitises fragments from importers', () => {
    const f = sanitizeFragment({ name: '', patch: null, fixtures: [{ id: 'x' }], warnings: [{ code: 'a' }, null] } as never, 'mvr', 'rig.mvr')
    expect(f).toMatchObject({ format: 'mvr', name: 'rig', patch: [], fixtures: [], groups: [] })
    expect(f.warnings).toHaveLength(1)
  })
})
