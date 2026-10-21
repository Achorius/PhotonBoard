import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { FixtureDefinition, PatchEntry, ShowFile } from '@shared/types'
import { emptyFragment, type ImportedShowFragment, type MergeOptions } from '@shared/interchange'
import { createExecutorPage, normalizeShow } from '@shared/show-format'
import {
  contentOfShow, defaultMergeOptions, emptyMergeContent, fragmentContents, mergeFragment, missingFixtureTypes, showFromContent,
  summarizeFixtureTypes, type MergeContent
} from './interchange-merge'

const demo: ShowFile = normalizeShow(readFileSync(resolve(__dirname, '../../../scripts/dev/demo-show.pbshow'), 'utf8')).show

function def(id: string, modes: [string, number][], extra: Partial<FixtureDefinition> = {}): FixtureDefinition {
  const channels: FixtureDefinition['channels'] = {}
  const out: FixtureDefinition = { id, name: id.split('/').pop()!, manufacturer: 'Test', categories: [], channels, modes: [] }
  for (const [name, n] of modes) {
    const names = Array.from({ length: n }, (_, i) => `Ch${i + 1}`)
    for (const c of names) channels[c] = { name: c, type: 'generic' }
    out.modes.push({ name, channels: names, channelCount: n })
  }
  return { ...out, ...extra }
}

/** Library: every fixture type the demo show uses (footprints matter for address conflicts) */
const library: FixtureDefinition[] = []
for (const p of demo.patch) {
  let d = library.find((x) => x.id === p.fixtureDefId)
  if (!d) { d = def(p.fixtureDefId, []); library.push(d) }
  if (!d.modes.some((m) => m.name === p.modeName)) {
    const n = Number(/\d+/.exec(p.modeName)?.[0] ?? 1)
    d.modes.push({ name: p.modeName, channels: Array.from({ length: n }, (_, i) => `Ch${i + 1}`), channelCount: n })
  }
}

function fragmentOf(show: ShowFile): ImportedShowFragment {
  const f = emptyFragment('photonboard', show.name)
  return {
    ...f, patch: show.patch, groups: show.groups, presets: show.presets, cuelists: show.cuelists, chases: show.chases,
    effects: show.effects, macros: show.macros ?? [], midiMappings: show.midiMappings, timeline: show.timeline, executor: show.executor,
    roomConfig: show.roomConfig, speedMasters: show.speedMasters, stagePages: show.stagePages
  }
}

function ids(): () => string {
  let n = 0
  return () => `id-${++n}`
}

const ALL: MergeOptions['include'] = {
  fixtures: true, patch: true, positions: true, groups: true, presets: true, cues: true, chases: true, effects: true,
  timeline: true, executors: true, midi: true, macros: true
}

function opts(o: Partial<MergeOptions> = {}): MergeOptions {
  return { mode: 'merge', include: ALL, addressConflicts: 'shift', universeOffset: 0, ...o }
}

function footprint(p: PatchEntry): number {
  return library.find((d) => d.id === p.fixtureDefId)!.modes.find((m) => m.name === p.modeName)!.channelCount
}

function overlaps(patch: PatchEntry[]): number {
  let n = 0
  for (let i = 0; i < patch.length; i++) {
    for (let j = i + 1; j < patch.length; j++) {
      const a = patch[i]
      const b = patch[j]
      if (a.universe !== b.universe) continue
      if (a.address < b.address + footprint(b) && b.address < a.address + footprint(a)) n++
    }
  }
  return n
}

describe('fragment preview', () => {
  it('counts what a fragment carries and defaults to all of it', () => {
    const f = fragmentOf(demo)
    const c = fragmentContents(f)
    expect(c.patch).toBe(23)
    expect(c.cues).toBe(12)
    expect(c.midi).toBe(8)
    const o = defaultMergeOptions(f, 'merge')
    expect(o.include.patch && o.include.cues && o.include.groups).toBe(true)
    expect(o.include.macros).toBeUndefined()
    expect(o.addressConflicts).toBe('shift')
  })

  it('tells where each fixture type comes from', () => {
    const f = emptyFragment('mvr', 'rig')
    f.patch = [
      { id: 'a', fixtureDefId: 'lib/x', modeName: 'm', universe: 0, address: 1, name: 'A', groupIds: [] },
      { id: 'b', fixtureDefId: 'gdtf/y', modeName: 'm', universe: 0, address: 10, name: 'B', groupIds: [] },
      { id: 'c', fixtureDefId: 'ofl/z/w', modeName: 'm', universe: 0, address: 20, name: 'C', groupIds: [] },
      { id: 'd', fixtureDefId: 'import/q', modeName: 'm', universe: 0, address: 30, name: 'D', groupIds: [] },
      { id: 'e', fixtureDefId: 'nowhere', modeName: 'm', universe: 0, address: 40, name: 'E', groupIds: [] }
    ]
    f.fixtures = [def('gdtf/y', [['m', 1]], { source: 'gdtf' }), def('import/q', [['m', 1]], { source: 'user' })]
    const s = summarizeFixtureTypes(f, [def('lib/x', [['m', 1]])])
    const origin = Object.fromEntries(s.map((x) => [x.id, x.origin]))
    expect(origin).toEqual({ 'lib/x': 'library', 'gdtf/y': 'file', 'ofl/z/w': 'catalog', 'import/q': 'generic', nowhere: 'missing' })
    expect(missingFixtureTypes(f, [def('lib/x', [['m', 1]])])).toEqual(['ofl/z/w', 'nowhere'])
  })
})

describe('merge into the current show', () => {
  const base = contentOfShow(demo)

  it('merges a show into itself: new ids, free addresses, every reference remapped', () => {
    const { content, report, install } = mergeFragment(fragmentOf(demo), base, library, opts(), { newId: ids() })
    expect(install).toEqual([])
    expect(content.patch).toHaveLength(46)
    expect(report.shifted).toBe(23)
    expect(overlaps(content.patch)).toBe(0)
    // the show's own items are untouched (same references)
    for (let i = 0; i < base.cuelists.length; i++) expect(content.cuelists[i]).toBe(base.cuelists[i])
    expect(content.patch.slice(0, 23).every((p, i) => p === base.patch[i])).toBe(true)
    const newIds = new Set(content.patch.slice(23).map((p) => p.id))
    // groups list imported fixtures only, fixtures list their groups
    for (const g of content.groups.slice(base.groups.length)) {
      expect(g.fixtureIds.every((id) => newIds.has(id))).toBe(true)
      for (const id of g.fixtureIds) expect(content.patch.find((p) => p.id === id)!.groupIds).toContain(g.id)
    }
    // cue values point at the imported fixtures
    for (const cl of content.cuelists.slice(base.cuelists.length)) {
      for (const cue of cl.cues) for (const v of cue.values) expect(newIds.has(v.fixtureId)).toBe(true)
    }
    // object numbers are unique
    const fids = content.patch.map((p) => p.fid)
    expect(new Set(fids).size).toBe(fids.length)
    const seqNumbers = content.cuelists.map((c) => c.number)
    expect(new Set(seqNumbers).size).toBe(seqNumbers.length)
    expect(report.renumbered).toBeGreaterThan(0)
    // executor pages appended, MIDI targets remapped
    expect((content.executor.pages ?? []).length).toBe((base.executor.pages ?? []).length + 1)
    const importedCuelists = new Set(content.cuelists.slice(base.cuelists.length).map((c) => c.id))
    const page = content.executor.pages![content.executor.pages!.length - 1]
    for (const col of page.cells) for (const cell of col) if (cell?.kind === 'cuelist') expect(importedCuelists.has(cell.id)).toBe(true)
    for (const m of content.midiMappings.slice(base.midiMappings.length)) {
      if (m.target.type === 'cuelist_go') expect(importedCuelists.has(m.target.id!)).toBe(true)
    }
    // the merged content is a valid show
    const show = showFromContent(content, 'Merged')
    expect(show.patch).toHaveLength(46)
  })

  it('skip: conflicting fixtures are not patched but map onto the same fixture of the show', () => {
    const { content, report } = mergeFragment(fragmentOf(demo), base, library, opts({ addressConflicts: 'skip' }), { newId: ids() })
    // the show's fixtures join the imported groups; nothing new is patched
    expect(content.patch.map((p) => p.id)).toEqual(base.patch.map((p) => p.id))
    expect(content.patch[0].groupIds.length).toBe(base.patch[0].groupIds.length + 1)
    expect(report.skipped).toBe(23)
    expect(report.matched).toBe(23)
    // imported cues now drive the show's own fixtures
    const baseIds = new Set(base.patch.map((p) => p.id))
    const cl = content.cuelists[content.cuelists.length - 1]
    expect(cl.cues.every((c) => c.values.every((v) => baseIds.has(v.fixtureId)))).toBe(true)
  })

  it('keep: same addresses (overlap allowed); universe offset moves the import', () => {
    const keep = mergeFragment(fragmentOf(demo), base, library, opts({ addressConflicts: 'keep' }), { newId: ids() })
    expect(keep.content.patch.slice(23).map((p) => `${p.universe}.${p.address}`)).toEqual(base.patch.map((p) => `${p.universe}.${p.address}`))
    const off = mergeFragment(fragmentOf(demo), base, library, opts({ universeOffset: 2 }), { newId: ids() })
    expect(off.report.shifted).toBe(0)
    expect(off.content.patch.slice(23).every((p, i) => p.universe === base.patch[i].universe + 2 && p.address === base.patch[i].address)).toBe(true)
  })

  it('only presets and cues: mapped onto the existing rig by address / fixture ID', () => {
    const include = { presets: true, cues: true }
    const { content, report } = mergeFragment(fragmentOf(demo), base, library, opts({ include }), { newId: ids() })
    expect(content.patch).toBe(base.patch)
    expect(content.groups).toBe(base.groups)
    expect(report.matched).toBe(23)
    expect(content.presets.length).toBe(base.presets.length * 2)
    expect(content.chases).toBe(base.chases)
  })

  it('drops values on fixtures that were not imported, with a warning', () => {
    const f = fragmentOf(demo)
    // every fixture but two sits in universe 16: with an offset of 1 they fall off the end
    f.patch = f.patch.map((p, i) => (i < 2 ? p : { ...p, universe: 15 }))
    const { content, report } = mergeFragment(f, emptyMergeContent(), library, opts({ universeOffset: 1, include: { patch: true, cues: true, groups: true } }), { newId: ids() })
    expect(content.patch).toHaveLength(2)
    expect(report.skipped).toBe(21)
    expect(report.warnings.some((w) => w.code === 'universeOutOfRange')).toBe(true)
    expect(report.warnings.some((w) => w.code === 'valuesDropped')).toBe(true)
    expect(report.warnings.some((w) => w.code === 'groupsEmptyDropped')).toBe(true)
    const kept = new Set(content.patch.map((p) => p.id))
    for (const cl of content.cuelists) for (const c of cl.cues) for (const v of c.values) expect(kept.has(v.fixtureId)).toBe(true)
  })

  it('without positions: no 3D position on the imported fixtures', () => {
    const include = { ...ALL, positions: false }
    const { content } = mergeFragment(fragmentOf(demo), base, library, opts({ include }), { newId: ids() })
    expect(content.patch.slice(23).some((p) => p.position3D)).toBe(false)
    expect(content.roomConfig).toBe(base.roomConfig)
  })

  it('caps executor pages at 16', () => {
    const many: MergeContent = { ...base, executor: { ...base.executor, pages: Array.from({ length: 16 }, (_, i) => {
      const p = createExecutorPage(`p${i}`)
      p.cells[0][0] = { kind: 'cuelist', id: base.cuelists[0].id, mode: 'toggle' }
      return p
    }) } }
    const { content, report } = mergeFragment(fragmentOf(demo), many, library, opts(), { newId: ids() })
    expect(content.executor.pages).toHaveLength(16)
    expect(report.warnings.some((w) => w.code === 'executorPagesDropped')).toBe(true)
  })
})

describe('fixture types', () => {
  function oneFixture(defId: string, mode: string): ImportedShowFragment {
    const f = emptyFragment('mvr', 'rig')
    f.patch = [{ id: 'f1', fixtureDefId: defId, modeName: mode, universe: 0, address: 1, name: 'Spot', groupIds: [], fid: 5 }]
    return f
  }

  it('uses the library definition when it has the mode', () => {
    const f = oneFixture('lib/spot', 'Std')
    f.fixtures = [def('lib/spot', [['Std', 3]])]
    const r = mergeFragment(f, emptyMergeContent(), [def('lib/spot', [['Std', 3]])], opts(), { newId: ids() })
    expect(r.install).toEqual([])
    expect(r.content.patch[0].fixtureDefId).toBe('lib/spot')
  })

  it('installs the file definition beside a different library definition of the same id', () => {
    const f = oneFixture('lib/spot', 'Ext')
    f.fixtures = [def('lib/spot', [['Ext', 9]])]
    const r = mergeFragment(f, emptyMergeContent(), [def('lib/spot', [['Std', 3]])], opts(), { newId: ids() })
    expect(r.install.map((d) => d.id)).toEqual(['lib/spot-import'])
    expect(r.content.patch[0].fixtureDefId).toBe('lib/spot-import')
  })

  it('does not install a definition the library already holds under another id', () => {
    const f = oneFixture('gdtf/robe@spot', 'Std')
    f.fixtures = [def('gdtf/robe@spot', [['Std', 3]], { manufacturer: 'Robe', name: 'Spot' })]
    const lib = [def('user/robe-spot', [['Std', 3]], { manufacturer: 'Robe', name: 'Spot' })]
    const r = mergeFragment(f, emptyMergeContent(), lib, opts(), { newId: ids() })
    expect(r.install).toEqual([])
    expect(r.content.patch[0].fixtureDefId).toBe('user/robe-spot')
  })

  it('installs new definitions, and unpatched ones only with "fixtures"', () => {
    const f = oneFixture('gdtf/new', 'Std')
    f.fixtures = [def('gdtf/new', [['Std', 3]]), def('gdtf/extra', [['A', 1]])]
    const withTypes = mergeFragment(f, emptyMergeContent(), [], opts(), { newId: ids() })
    expect(withTypes.install.map((d) => d.id)).toEqual(['gdtf/new', 'gdtf/extra'])
    expect(withTypes.report.added.fixtures).toBe(2)
    const patchOnly = mergeFragment(f, emptyMergeContent(), [], opts({ include: { patch: true } }), { newId: ids() })
    expect(patchOnly.install.map((d) => d.id)).toEqual(['gdtf/new'])
  })

  it('warns about fixture types nobody defines', () => {
    const r = mergeFragment(oneFixture('nowhere/x', 'm'), emptyMergeContent(), [], opts(), { newId: ids() })
    expect(r.content.patch).toHaveLength(1)
    expect(r.report.warnings.some((w) => w.code === 'fixtureTypesMissing')).toBe(true)
  })

  it('remaps global preset values to the installed fixture type', () => {
    const f = oneFixture('lib/spot', 'Ext')
    f.fixtures = [def('lib/spot', [['Ext', 9]])]
    f.presets = [{ id: 'p', name: 'Red', type: 'color', values: {}, scope: 'global', typeValues: { 'lib/spot': { Ch1: 255 } } }]
    const r = mergeFragment(f, emptyMergeContent(), [def('lib/spot', [['Std', 3]])], opts(), { newId: ids() })
    expect(r.content.presets[0].typeValues).toEqual({ 'lib/spot-import': { Ch1: 255 } })
  })
})

describe('new show', () => {
  it('keeps the file as it is: addresses, fixture IDs, numbers, executor, timeline', () => {
    const { content, report } = mergeFragment(fragmentOf(demo), emptyMergeContent('X'), library, opts({ mode: 'new' }), { newId: ids() })
    expect(report.shifted).toBe(0)
    expect(report.renumbered).toBe(0)
    expect(content.patch.map((p) => `${p.fid}:${p.universe}.${p.address}`)).toEqual(demo.patch.map((p) => `${p.fid}:${p.universe}.${p.address}`))
    expect(content.cuelists.map((c) => c.number)).toEqual(demo.cuelists.map((c) => c.number))
    expect(content.executor.pages).toHaveLength(demo.executor!.pages!.length)
    expect(content.timeline.clips.length).toBe(demo.timeline!.clips.length)
    expect(content.roomConfig.width).toBe(demo.roomConfig!.width)
    const show = showFromContent(content, 'Demo copy')
    expect(show.name).toBe('Demo copy')
    expect(show.cuelists).toHaveLength(12)
  })

  it('never throws on a malformed fragment', () => {
    const bad = { ...emptyFragment('x', 'bad'), patch: [{ nope: true }], cuelists: 'oops' } as unknown as ImportedShowFragment
    const r = mergeFragment(bad, emptyMergeContent(), [], opts(), { newId: ids() })
    expect(r.content.patch).toEqual([])
    expect(r.report.warnings.length).toBeGreaterThan(0)
  })
})
