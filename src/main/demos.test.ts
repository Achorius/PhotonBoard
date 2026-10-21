// Demo content bundled with the app (resources/demos, scripts/build-demos.ts):
// every show opens cleanly with the built-in fixture library, and every file
// imports through the interchange registry without error-level warnings.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { BUILTIN_FIXTURES } from './fixture-library'
import { FixtureCatalog } from './fixture-catalog'
import { checkShowObject } from './show-validation'
import { createInterchangeHost } from './interchange'
import { DemoLibrary, defaultDemoDirs } from './demos'
import { normalizeShow } from '../shared/show-format'
import { demoText } from '../shared/demos'

const ROOT = resolve(__dirname, '../..')
const DIR = join(ROOT, 'resources', 'demos')
const demos = new DemoLibrary(defaultDemoDirs({ appPath: ROOT }))
const list = demos.list()
const host = createInterchangeHost({
  getLibrary: () => BUILTIN_FIXTURES,
  catalog: new FixtureCatalog([join(ROOT, 'resources', 'fixture-library')])
})

function totalSize(dir: string): number {
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    n += statSync(p).isDirectory() ? totalSize(p) : statSync(p).size
  }
  return n
}

describe('bundled demos', () => {
  it('lists three demo shows and an example file for each import format', () => {
    expect(list.shows.map((s) => s.id)).toEqual(['club-night', 'theatre', 'concert-pro'])
    expect(new Set(list.formats.map((f) => f.format))).toEqual(new Set(['mvr', 'qlcplus-workspace', 'usitt-ascii', 'csv-patch', 'gdtf', 'ma3-xml', 'ma2-xml']))
    for (const item of [...list.shows, ...list.formats]) {
      expect(demoText(item.description, 'en').length).toBeGreaterThan(20)
      expect(demoText(item.description, 'fr').length).toBeGreaterThan(20)
    }
    expect(totalSize(DIR)).toBeLessThan(2 * 1024 * 1024)
  })

  it('resolves ids only through the manifest', () => {
    expect(demos.showPath('club-night')).toBe(join(DIR, 'Club Night.pbshow'))
    expect(demos.showPath('../../package.json')).toBeNull()
    expect(demos.showPath(42)).toBeNull()
    expect(demos.formatPath(list.formats[0].id)).toBe(list.formats[0].path)
    expect(demos.formatPath('nope')).toBeNull()
  })

  it.each(list.shows.map((s) => [s.id]))('demo show %s is a clean, current show with built-in fixture types', (id) => {
    const text = readFileSync(demos.showPath(id)!, 'utf8')
    const raw = JSON.parse(text)
    expect(checkShowObject(raw).ok).toBe(true)
    const { show, warnings } = normalizeShow(raw)
    expect(warnings).toEqual([])
    const builtin = new Map(BUILTIN_FIXTURES.map((f) => [f.id, f]))
    for (const p of show.patch) {
      const def = builtin.get(p.fixtureDefId)
      expect(def, p.fixtureDefId).toBeTruthy()
      expect(def!.modes.some((m) => m.name === p.modeName)).toBe(true)
    }
    // Every cue value names a channel of its fixture's mode
    const channels = new Map(show.patch.map((p) => [p.id, builtin.get(p.fixtureDefId)!.modes.find((m) => m.name === p.modeName)!.channels]))
    for (const cl of show.cuelists) for (const cue of cl.cues) for (const v of cue.values) {
      expect(channels.get(v.fixtureId)?.includes(v.channelName), `${cl.name} / ${cue.name}: ${v.channelName}`).toBe(true)
    }
    const entry = list.shows.find((s) => s.id === id)!
    expect(entry.fixtures).toBe(show.patch.length)
    expect(show.cuelists.length).toBeGreaterThan(0)
    expect(show.executor?.pages?.length).toBeGreaterThan(0)
  })

  it.each([...list.shows.map((s) => [s.id, demos.showPath(s.id)!]), ...list.formats.map((f) => [f.fileName, f.path])])(
    '%s imports through the registry without errors', async (_name, path) => {
      const res = await host.importPath(path)
      expect(res.success, res.error).toBe(true)
      if (!res.success) return
      expect(res.fragment.warnings.filter((w) => w.level === 'error')).toEqual([])
      expect(res.fragment.patch.length + res.fragment.fixtures.length).toBeGreaterThan(0)
    }
  )

  it('example files come back in their own format', async () => {
    for (const f of list.formats) {
      const res = await host.importPath(f.path)
      expect(res.success && res.fragment.format, f.fileName).toBe(f.format)
    }
  })
})
