import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { gzipSync } from 'zlib'
import type { FixtureDefinition } from '../shared/types'
import { buildCatalogBundle, type CatalogBuildInput } from './fixture-catalog-build'
import {
  FixtureCatalog,
  installCatalogFixture,
  installMissingShowFixtures,
  isCatalogId,
  sanitizeCatalogQuery,
  withinEdits,
  type FixtureLibraryLike
} from './fixture-catalog'

const qxf = (mfr: string, model: string, type: string, channels: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>${mfr}</Manufacturer>
 <Model>${model}</Model>
 <Type>${type}</Type>
${channels.map((c) => ` <Channel Name="${c}" Preset="${c === 'Dimmer' ? 'IntensityDimmer' : `Intensity${c}`}"/>`).join('\n')}
 <Mode Name="${channels.length} Channel">
${channels.map((c, i) => `  <Channel Number="${i}">${c}</Channel>`).join('\n')}
 </Mode>
</FixtureDefinition>`

const ofl = (name: string, categories: string[], channels: string[]) => JSON.stringify({
  name,
  categories,
  meta: { authors: ['Tester'], createDate: '2020-01-01', lastModifyDate: '2020-01-01' },
  availableChannels: Object.fromEntries(channels.map((c) => [c, { capability: c === 'Dimmer' ? { type: 'Intensity' } : { type: 'ColorIntensity', color: c } }])),
  modes: [{ name: `${channels.length}-channel`, channels }]
})

const INPUT: CatalogBuildInput = {
  ofl: {
    revision: 'a'.repeat(40),
    date: '2026-01-01T00:00:00Z',
    manufacturers: { 'american-dj': { name: 'American DJ' }, cameo: { name: 'Cameo' }, robe: { name: 'Robe' } },
    files: [
      { path: 'fixtures/american-dj/mega-par-profile.json', content: ofl('Mega Par Profile', ['Color Changer'], ['Red', 'Green', 'Blue', 'Dimmer']) },
      { path: 'fixtures/cameo/flat-par-rgbw.json', content: ofl('Flat PAR RGBW', ['Color Changer'], ['Red', 'Green', 'Blue', 'White']) },
      { path: 'fixtures/robe/robin-megapointe.json', content: ofl('Robin MegaPointe', ['Moving Head'], ['Dimmer']) },
      { path: 'fixtures/robe/old-name.json', content: JSON.stringify({ $schema: 'x', redirectTo: 'robe/robin-megapointe', reason: 'FixtureRenamed' }) },
      { path: 'fixtures/cameo/broken.json', content: '{ nope' }
    ]
  },
  qlcplus: {
    revision: 'b'.repeat(40),
    date: '2026-01-02T00:00:00Z',
    files: [
      // duplicate of the OFL fixture (other maker spelling, maker repeated in the model)
      { path: 'resources/fixtures/ADJ/ADJ-Mega-Par-Profile.qxf', content: qxf('ADJ', 'ADJ Mega Par Profile', 'Color Changer', ['Red', 'Green', 'Blue']) },
      { path: 'resources/fixtures/American_DJ/American-DJ-Flat-Par-QA12XS.qxf', content: qxf('American DJ', 'Flat Par QA12XS', 'Color Changer', ['Red', 'Green', 'Blue', 'Amber']) },
      { path: 'resources/fixtures/Eurolite/Eurolite-LED-PAR-56-RGBA.qxf', content: qxf('Eurolite', 'LED PAR-56 RGBA', 'Color Changer', ['Red', 'Green', 'Blue', 'Amber']) },
      { path: 'resources/fixtures/Martin/Martin-Mégane.qxf', content: qxf('Martin', 'Mégane Strobe', 'Strobe', ['Dimmer']) },
      { path: 'resources/fixtures/Generic/Generic-Dimmer.qxf', content: qxf('Generic', 'Dimmer', 'Dimmer', ['Dimmer']) },
      { path: 'resources/fixtures/Broken/Broken.qxf', content: '<FixtureDefinition><Model>x</Model></FixtureDefinition>' }
    ]
  }
}

function writeBundle(dir: string): void {
  const bundle = buildCatalogBundle(INPUT)
  mkdirSync(join(dir, 'fixtures'), { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(bundle.manifest))
  writeFileSync(join(dir, 'index.json.gz'), gzipSync(JSON.stringify(bundle.index)))
  for (const [name, shard] of bundle.shards) writeFileSync(join(dir, 'fixtures', `${name}.json.gz`), gzipSync(JSON.stringify(shard)))
}

class MemoryLibrary implements FixtureLibraryLike {
  fixtures = new Map<string, FixtureDefinition>()
  saves = 0
  getAllFixtures() { return [...this.fixtures.values()] }
  saveUserFixture(f: FixtureDefinition) { this.saves++; this.fixtures.set(f.id, f); return { success: true } }
}

describe('buildCatalogBundle', () => {
  it('converts both sources, merges manufacturers, drops QLC+ duplicates of OFL fixtures', () => {
    const b = buildCatalogBundle(INPUT)
    expect(b.index.fixtures.map((r) => r[0])).toEqual([
      'ofl/american-dj/mega-par-profile',
      'ofl/cameo/flat-par-rgbw',
      'ofl/robe/robin-megapointe',
      'qlc/american-dj/flat-par-qa12xs',
      'qlc/eurolite/led-par-56-rgba',
      'qlc/generic/dimmer',
      'qlc/martin/megane-strobe'
    ])
    expect(b.manifest.duplicates).toBe(1)
    expect(b.index.aliases).toEqual({
      'ofl/robe/old-name': 'ofl/robe/robin-megapointe',
      'qlc/adj/adj-mega-par-profile': 'ofl/american-dj/mega-par-profile'
    })
    // the QLC+ "American DJ" fixture joins the OFL manufacturer (same shard, same display name)
    const adj = b.index.manufacturers.find((m) => m.name === 'American DJ')!
    expect(adj.shard).toBe('american-dj')
    expect(Object.keys(b.shards.get('american-dj')!)).toEqual(['ofl/american-dj/mega-par-profile', 'qlc/american-dj/flat-par-qa12xs'])
    expect(b.manifest.skipped.map((s) => [s.source, s.path, s.reason.split(':')[0]])).toEqual([
      ['ofl', 'fixtures/cameo/broken.json', 'invalid JSON'],
      ['ofl', 'fixtures/robe/old-name.json', 'redirect to robe/robin-megapointe'],
      ['qlcplus', 'resources/fixtures/Broken/Broken.qxf', 'missing manufacturer or model']
    ])
    expect(b.manifest.sources.map((s) => [s.id, s.fixtureCount, s.license])).toEqual([['ofl', 3, 'MIT'], ['qlcplus', 4, 'Apache-2.0']])
    const def = b.shards.get('american-dj')!['qlc/american-dj/flat-par-qa12xs']
    expect(def.catalog).toEqual({ source: 'qlcplus', path: 'resources/fixtures/American_DJ/American-DJ-Flat-Par-QA12XS.qxf', revision: 'b'.repeat(40), license: 'Apache-2.0' })
    expect(def.source).toBe('qlcplus')
  })

  it('is deterministic (input order does not matter)', () => {
    const a = buildCatalogBundle(INPUT)
    const shuffled: CatalogBuildInput = {
      ofl: { ...INPUT.ofl, files: [...INPUT.ofl.files].reverse() },
      qlcplus: { ...INPUT.qlcplus, files: [...INPUT.qlcplus.files].reverse() }
    }
    const b = buildCatalogBundle(shuffled)
    expect(JSON.stringify(b.index)).toBe(JSON.stringify(a.index))
    expect(JSON.stringify(b.manifest)).toBe(JSON.stringify(a.manifest))
    expect(JSON.stringify([...b.shards])).toBe(JSON.stringify([...a.shards]))
  })
})

describe('FixtureCatalog', () => {
  let dir: string
  let catalog: FixtureCatalog

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-catalog-'))
    writeBundle(join(dir, 'lib'))
    catalog = new FixtureCatalog([join(dir, 'missing'), join(dir, 'lib')])
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reports sources, manufacturers and categories', async () => {
    const info = await catalog.info()
    expect(info.available).toBe(true)
    expect(info.fixtureCount).toBe(7)
    expect(info.sources.map((s) => s.id)).toEqual(['ofl', 'qlcplus'])
    expect(info.manufacturers).toContainEqual({ name: 'American DJ', count: 2 })
    expect(info.categories).toContainEqual({ name: 'Color Changer', count: 4 })
  })

  it('searches by maker / model, accent-insensitive, with prefixes and small typos', async () => {
    const ids = async (text: string) => (await catalog.search({ text })).entries.map((e) => e.id)
    expect((await ids('mega par'))[0]).toBe('ofl/american-dj/mega-par-profile')
    expect(await ids('megane')).toEqual(['qlc/martin/megane-strobe'])
    expect(await ids('mégane')).toEqual(['qlc/martin/megane-strobe'])
    expect(await ids('megapoin')).toEqual(['ofl/robe/robin-megapointe']) // substring of the compact name
    expect(await ids('robin megapionte')).toEqual(['ofl/robe/robin-megapointe']) // transposition
    expect(await ids('eurolit par56')).toEqual(['qlc/eurolite/led-par-56-rgba'])
    expect(await ids('americn dj flat')).toEqual(['qlc/american-dj/flat-par-qa12xs'])
    expect(await ids('adj flat')).toEqual(['qlc/american-dj/flat-par-qa12xs']) // maker initials
    expect(await ids('zzzz')).toEqual([])
  })

  it('filters by manufacturer, category, channel count and source; pages', async () => {
    const all = await catalog.search({})
    expect(all.total).toBe(7)
    expect(all.entries[0].manufacturer).toBe('American DJ')
    expect((await catalog.search({ manufacturer: 'american dj' })).total).toBe(2)
    expect((await catalog.search({ category: 'Strobe' })).entries.map((e) => e.id)).toEqual(['qlc/martin/megane-strobe'])
    expect((await catalog.search({ channelCount: 4 })).total).toBe(4)
    expect((await catalog.search({ source: 'qlcplus' })).total).toBe(4)
    const page = await catalog.search({ limit: 2, offset: 2 })
    expect(page.total).toBe(7)
    expect(page.entries.map((e) => e.id)).toEqual(all.entries.slice(2, 4).map((e) => e.id))
  })

  it('loads definitions on demand and follows aliases', async () => {
    const def = await catalog.get('qlc/eurolite/led-par-56-rgba')
    expect(def?.modes[0]).toMatchObject({ name: '4 Channel', channelCount: 4 })
    expect((await catalog.get('ofl/robe/old-name'))?.id).toBe('ofl/robe/robin-megapointe')
    expect(await catalog.get('ofl/nope/nope')).toBeNull()
    // copies: mutating one does not affect the next
    def!.name = 'changed'
    expect((await catalog.get('qlc/eurolite/led-par-56-rgba'))?.name).toBe('LED PAR-56 RGBA')
  })

  it('installs into the library once, never overwriting an installed definition', async () => {
    const lib = new MemoryLibrary()
    const a = await installCatalogFixture(catalog, lib, 'ofl/cameo/flat-par-rgbw')
    expect(a.id).toBe('ofl/cameo/flat-par-rgbw')
    expect(lib.saves).toBe(1)
    lib.fixtures.get(a.id)!.name = 'Edited by the user'
    const b = await installCatalogFixture(catalog, lib, 'ofl/cameo/flat-par-rgbw')
    expect(b.name).toBe('Edited by the user')
    expect(lib.saves).toBe(1)
    await expect(installCatalogFixture(catalog, lib, 'ofl/x/y')).rejects.toThrow(/not in the offline library/)
  })

  it('installs the fixture types a show uses but the library lacks (other machine, legacy OFL ids)', async () => {
    const lib = new MemoryLibrary()
    lib.fixtures.set('generic/dimmer', { id: 'generic/dimmer', name: 'Dimmer', manufacturer: 'Generic', categories: [], channels: {}, modes: [] })
    const show = {
      patch: [
        { fixtureDefId: 'generic/dimmer', modeName: '1ch' },
        { fixtureDefId: 'qlc/generic/dimmer', modeName: '1 Channel' },
        { fixtureDefId: 'cameo/flat-par-rgbw', modeName: '4-channel' }, // online OFL download id
        { fixtureDefId: 'qlc/eurolite/led-par-56-rgba', modeName: 'Some other mode' }, // mode no longer exists
        { fixtureDefId: 'unknown/thing', modeName: 'x' }
      ]
    } as any
    const installed = await installMissingShowFixtures(catalog, lib, show)
    expect(installed).toEqual(['qlc/generic/dimmer', 'cameo/flat-par-rgbw'])
    expect(lib.fixtures.get('cameo/flat-par-rgbw')?.name).toBe('Flat PAR RGBW')
    expect(await installMissingShowFixtures(catalog, lib, show)).toEqual([])
  })

  it('a missing bundle makes an empty catalog, not an error', async () => {
    const empty = new FixtureCatalog([join(dir, 'nothing-here')])
    const info = await empty.info()
    expect(info.available).toBe(false)
    expect(info.error).toMatch(/not found/)
    expect(await empty.search({ text: 'par' })).toEqual({ total: 0, entries: [] })
    expect(await empty.get('ofl/a/b')).toBeNull()
  })
})

describe('catalog argument validation', () => {
  it('accepts catalog ids only', () => {
    expect(isCatalogId('ofl/robe/robin-megapointe')).toBe(true)
    expect(isCatalogId('qlc/american-dj/flat-par')).toBe(true)
    expect(isCatalogId('robe/robin')).toBe(false)
    expect(isCatalogId('ofl/../x')).toBe(false)
    expect(isCatalogId(42)).toBe(false)
  })

  it('sanitises queries', () => {
    expect(sanitizeCatalogQuery(undefined)).toEqual({})
    expect(sanitizeCatalogQuery({ text: 'par', channelCount: 4, limit: 10, source: 'ofl', extra: 1 })).toEqual({ text: 'par', channelCount: 4, limit: 10, source: 'ofl' })
    expect(() => sanitizeCatalogQuery({ limit: 10_000 })).toThrow()
    expect(() => sanitizeCatalogQuery({ text: 5 })).toThrow()
    expect(() => sanitizeCatalogQuery({ source: 'gdtf' })).toThrow()
    expect(() => sanitizeCatalogQuery('par')).toThrow()
  })

  it('edit distance', () => {
    expect(withinEdits('megapionte', 'megapointe', 1)).toBe(true)
    expect(withinEdits('kitten', 'sitting', 2)).toBe(false)
    expect(withinEdits('kitten', 'sitting', 3)).toBe(true)
  })
})

// The committed bundle (resources/fixture-library) — what ships in the app
const SHIPPED = resolve(__dirname, '../../resources/fixture-library')
describe.skipIf(!existsSync(join(SHIPPED, 'index.json.gz')))('shipped fixture library', () => {
  const catalog = new FixtureCatalog([SHIPPED])

  it('loads, has both sources and finds well-known fixtures', async () => {
    const info = await catalog.info()
    expect(info.available).toBe(true)
    expect(info.fixtureCount).toBeGreaterThan(1500)
    expect(info.sources.map((s) => s.id)).toEqual(['ofl', 'qlcplus'])
    for (const s of info.sources) expect(s.revision).toMatch(/^[0-9a-f]{40}$/)
    const hit = (await catalog.search({ text: 'mac aura' })).entries[0]
    expect(hit?.manufacturer).toBe('Martin')
    const def = await catalog.get(hit.id)
    expect(def?.modes.length).toBeGreaterThan(0)
    for (const mode of def!.modes) {
      expect(mode.channels.length).toBe(mode.channelCount)
      for (const ch of mode.channels) expect(def!.channels[ch]).toBeDefined()
    }
  })
})
