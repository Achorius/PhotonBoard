import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  normalizeShow, normalizeExecutorLayout, normalizeSectionItems, normalizeSectionValue, fillObjectNumbers, nextObjectNumber,
  executorPageToLegacy, createExecutorPage, SHOW_FORMAT_VERSION, MAX_EXECUTOR_PAGES, CONTENT_SECTIONS, LIST_SECTIONS
} from './show-format'
import { PRESET_FAMILY_NUMBER, PRESET_TYPES, type ShowFile } from './types'

const DEMO_V2 = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/dev/demo-show.pbshow'), 'utf8'))

/** Every v3-only field removed: what PhotonBoard 1.0 (v2) would keep of a v3 file */
function stripV3(raw: any): any {
  const show = JSON.parse(JSON.stringify(raw))
  show.version = '2'
  for (const k of ['macros', 'speedMasters', 'stagePages', 'parked', 'groupMasters']) delete show[k]
  for (const p of show.patch) delete p.fid
  for (const g of show.groups) delete g.number
  for (const p of show.presets) for (const k of ['number', 'scope', 'typeValues', 'universal', 'color']) delete p[k]
  const stripValues = (values: any[]) => { for (const v of values) for (const k of ['presetId', 'fade', 'delay', 'part']) delete v[k] }
  for (const cl of show.cuelists) {
    for (const k of ['number', 'tracking', 'mib', 'rate', 'priorityMode', 'speedMasterId']) delete cl[k]
    for (const cue of cl.cues) {
      for (const k of ['featureTiming', 'parts', 'followMode', 'block']) delete cue[k]
      stripValues(cue.values)
    }
  }
  for (const ch of show.chases) {
    delete ch.number
    delete ch.speedMasterId
    for (const s of ch.steps) stripValues(s.values)
  }
  for (const e of show.effects) for (const k of ['number', 'speedMasterId', 'speedMultiplier']) delete e[k]
  delete show.executor.pages
  return show
}

describe('show format v3', () => {
  it('is version 3', () => {
    expect(SHOW_FORMAT_VERSION).toBe(3)
    expect(normalizeShow(DEMO_V2).show.version).toBe('3')
  })

  it('golden: a v2 show migrates, saves as v3 and reloads identically', () => {
    const { show: v3 } = normalizeShow(DEMO_V2)
    // Numbers from list order
    expect(v3.patch.map(p => p.fid)).toEqual(v3.patch.map((_, i) => i + 1))
    expect(v3.groups.map(g => g.number)).toEqual(v3.groups.map((_, i) => i + 1))
    expect(v3.cuelists.map(c => c.number)).toEqual(v3.cuelists.map((_, i) => i + 1))
    expect(v3.chases.map(c => c.number)).toEqual(v3.chases.map((_, i) => i + 1))
    expect(v3.effects.map(e => e.number)).toEqual(v3.effects.map((_, i) => i + 1))
    // One executor page, from the v2 grid
    expect(v3.executor!.pages).toHaveLength(1)
    expect(v3.executor!.grid).toEqual(DEMO_V2.executor.grid)
    expect(v3.executor!.modes).toEqual(DEMO_V2.executor.modes)
    expect(v3.executor!.columns).toEqual(DEMO_V2.executor.columns)
    expect(v3).toMatchObject({ macros: [], speedMasters: [], stagePages: [], parked: [], groupMasters: {} })
    // Save (JSON) → reload: identical
    const reloaded = normalizeShow(JSON.parse(JSON.stringify(v3))).show
    expect(reloaded).toEqual(v3)
  })

  it('golden: a v3 file stripped of every v3 field is still the same v2 show', () => {
    const { show: v3 } = normalizeShow(DEMO_V2)
    const asV2 = stripV3(v3)
    // v2-visible content is untouched by the migration
    const original = normalizeShow(DEMO_V2).show
    expect(normalizeShow(asV2).show).toEqual(original)
    for (const key of ['patch', 'groups', 'presets', 'cuelists', 'chases', 'effects', 'midiMappings'] as const) {
      expect(asV2[key].length).toBe(DEMO_V2[key].length)
    }
    expect(asV2.executor).toEqual(DEMO_V2.executor)
  })

  it('numbers presets per family and keeps existing numbers', () => {
    const { show } = normalizeShow({
      version: '2',
      presets: [
        { id: 'c1', type: 'color', values: {} },
        { id: 'p1', type: 'position', values: {} },
        { id: 'c2', type: 'color', values: {} },
        { id: 'f1', type: 'focus', values: {} },
        { id: 'k1', type: 'control', values: {} }
      ]
    })
    expect(show.presets.map(p => [p.id, p.type, p.number])).toEqual([
      ['c1', 'color', 1], ['p1', 'position', 1], ['c2', 'color', 2], ['f1', 'focus', 1], ['k1', 'control', 1]
    ])
    const v3 = normalizeShow({
      version: '3',
      presets: [
        { id: 'a', type: 'color', number: 5, values: {} },
        { id: 'b', type: 'color', values: {} },
        { id: 'c', type: 'color', number: 5, values: {} } // duplicate: renumbered
      ]
    }).show
    expect(v3.presets.map(p => p.number)).toEqual([5, 6, 7])
  })

  it('preset family numbers and order', () => {
    expect(PRESET_FAMILY_NUMBER.color).toBe(4)
    expect(PRESET_TYPES.map(t => PRESET_FAMILY_NUMBER[t])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps every v3 field through normalisation', () => {
    const raw = {
      version: '3',
      patch: [{ id: 'f', fixtureDefId: 'd', modeName: 'm', universe: 0, address: 1, name: 'F', groupIds: ['g'], fid: 101 }],
      groups: [{ id: 'g', name: 'G', color: '#fff', fixtureIds: ['f'], number: 7 }],
      presets: [{
        id: 'pr', name: 'Red', type: 'color', number: 2, scope: 'global', values: { f: { Red: 255 } },
        typeValues: { d: { Red: 250, Bad: 'x' } }, universal: { red: 255 }, color: '#f00'
      }],
      speedMasters: [{ id: 'sm', number: 1, name: 'BPM', bpm: 128 }],
      cuelists: [{
        id: 'cl', name: 'S', number: 3, tracking: false, mib: { enabled: true, delay: 1, fade: 2 }, rate: 2, priorityMode: 'swap', speedMasterId: 'sm',
        cues: [{
          id: 'q', name: 'Q', number: 1, fadeIn: 1, fadeOut: 1, delay: 0, followTime: null,
          values: [{ fixtureId: 'f', channelName: 'Red', value: 255, presetId: 'pr', fade: 3, delay: 0.5, part: 1 }],
          featureTiming: { colour: { fade: 4 }, position: { delay: 1 }, bogus: { fade: 1 } },
          parts: [{ index: 1, name: 'Part 1', fade: 2 }],
          followMode: 'after-go',
          block: true
        }]
      }],
      chases: [{ id: 'ch', name: 'C', steps: [], number: 4, speedMasterId: 'sm' }],
      effects: [{ id: 'e', name: 'E', number: 9, speedMasterId: 'sm', speedMultiplier: 2 }],
      macros: [{ id: 'm', number: 3, name: 'Go', color: '#0f0', lines: [{ command: 'Go Sequence 1', wait: 2 }, 'Clear', { nope: 1 }] }],
      stagePages: [{ id: 'sp', name: 'Live', cols: 4, rows: 3, widgets: [{ id: 'w', x: 3, y: 2, w: 5, h: 5, kind: 'macro', ref: 'm', options: { big: true, bad: {} } }] }],
      parked: [{ fixtureId: 'f', channelName: 'Red', value: 10 }, { fixtureId: 'ghost', channelName: 'Red', value: 1 }],
      groupMasters: { g: 128, ghost: 3 },
      executor: {
        grid: [], columns: [], modes: [],
        pages: [
          { id: 'p1', name: 'Main', cells: [[{ kind: 'cuelist', id: 'cl', mode: 'flash', button: 'go' }, { kind: 'macro', id: 'm', mode: 'toggle' }]], columns: [{ title: 'A', color: '#111', fader: { kind: 'speed', id: 'sm' } }] },
          { id: 'p2', name: '', cells: [[{ kind: 'chase', id: 'gone', mode: 'toggle' }, { kind: 'group', id: 'g', mode: 'toggle' }]], columns: [] }
        ]
      }
    }
    const { show } = normalizeShow(raw)
    expect(show.patch[0].fid).toBe(101)
    expect(show.groups[0].number).toBe(7)
    expect(show.presets[0]).toEqual({
      id: 'pr', name: 'Red', type: 'color', number: 2, scope: 'global', values: { f: { Red: 255 } },
      typeValues: { d: { Red: 250 } }, universal: { red: 255 }, color: '#f00'
    })
    const cl = show.cuelists[0]
    expect(cl).toMatchObject({ number: 3, tracking: false, mib: { enabled: true, delay: 1, fade: 2 }, rate: 2, priorityMode: 'swap', speedMasterId: 'sm' })
    expect(cl.cues[0].values[0]).toEqual({ fixtureId: 'f', channelName: 'Red', value: 255, presetId: 'pr', fade: 3, delay: 0.5, part: 1 })
    expect(cl.cues[0].featureTiming).toEqual({ colour: { fade: 4 }, position: { delay: 1 } })
    expect(cl.cues[0].parts).toEqual([{ index: 1, name: 'Part 1', fade: 2 }])
    expect(cl.cues[0]).toMatchObject({ followMode: 'after-go', block: true })
    expect(show.chases[0]).toMatchObject({ number: 4, speedMasterId: 'sm' })
    expect(show.effects[0]).toMatchObject({ number: 9, speedMasterId: 'sm', speedMultiplier: 2 })
    expect(show.macros).toEqual([{ id: 'm', number: 3, name: 'Go', color: '#0f0', lines: [{ command: 'Go Sequence 1', wait: 2 }, { command: 'Clear' }] }])
    expect(show.speedMasters).toEqual([{ id: 'sm', number: 1, name: 'BPM', bpm: 128 }])
    expect(show.stagePages![0]).toEqual({
      id: 'sp', name: 'Live', cols: 4, rows: 3, widgets: [{ id: 'w', x: 3, y: 2, w: 1, h: 1, kind: 'macro', ref: 'm', options: { big: true } }]
    })
    expect(show.parked).toEqual([{ fixtureId: 'f', channelName: 'Red', value: 10 }])
    expect(show.groupMasters).toEqual({ g: 128 })
    const ex = show.executor!
    expect(ex.pages!.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(ex.pages![0].cells[0][0]).toEqual({ kind: 'cuelist', id: 'cl', mode: 'flash', button: 'go' })
    expect(ex.pages![0].cells[0][1]).toEqual({ kind: 'macro', id: 'm', mode: 'toggle' })
    expect(ex.pages![0].columns[0]).toEqual({ title: 'A', color: '#111', fader: { kind: 'speed', id: 'sm' } })
    expect(ex.pages![1].cells[0][0]).toBeNull() // missing chase
    expect(ex.pages![1].cells[0][1]?.id).toBe('g')
    // v2 mirror = page 1, scene cells only
    expect(ex.grid[0]).toEqual(['cl', null, null, null])
    expect(ex.modes[0]).toEqual(['flash', 'toggle', 'toggle', 'toggle'])
    expect(ex.columns[0]).toEqual({ title: 'A', color: '#111' })
    // Idempotent
    expect(normalizeShow(JSON.parse(JSON.stringify(show))).show).toEqual(show)
  })

  it('drops references to missing presets (keeping the value) and speed masters', () => {
    const { show, warnings } = normalizeShow({
      version: '3',
      cuelists: [{ id: 'c', speedMasterId: 'nope', cues: [{ id: 'q', values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 77, presetId: 'gone' }] }] }],
      chases: [{ id: 'ch', speedMasterId: 'nope', steps: [{ id: 's', values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 5, presetId: 'gone' }] }] }]
    })
    expect(show.cuelists[0].cues[0].values[0]).toEqual({ fixtureId: 'f', channelName: 'Dimmer', value: 77 })
    expect(show.cuelists[0].speedMasterId).toBeUndefined()
    expect(show.chases[0].steps[0].values[0]).toEqual({ fixtureId: 'f', channelName: 'Dimmer', value: 5 })
    expect(show.chases[0].speedMasterId).toBeUndefined()
    expect(warnings.some(w => /missing preset/.test(w))).toBe(true)
  })

  it('caps executor pages and fixes page ids', () => {
    const pages = Array.from({ length: MAX_EXECUTOR_PAGES + 3 }, (_, i) => ({ id: i === 2 ? 'dup' : i === 3 ? 'dup' : undefined, cells: [] }))
    const layout = normalizeExecutorLayout({ pages })
    expect(layout.pages).toHaveLength(MAX_EXECUTOR_PAGES)
    const ids = layout.pages!.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('page-1')
  })

  it('a v2 executor layout becomes page 1 (deterministic id)', () => {
    const layout = normalizeExecutorLayout({ grid: [['a', 'b']], modes: [['trigger', 'flash']], columns: [{ title: 'X', color: '#123' }] }, new Set(['a', 'b']))
    expect(layout.pages).toHaveLength(1)
    expect(layout.pages![0].id).toBe('page-1')
    expect(layout.pages![0].cells[0].slice(0, 2)).toEqual([
      { kind: 'cuelist', id: 'a', mode: 'trigger' }, { kind: 'cuelist', id: 'b', mode: 'flash' }
    ])
    expect(executorPageToLegacy(layout.pages![0])).toEqual({ grid: layout.grid, columns: layout.columns, modes: layout.modes })
  })

  it('an empty page mirrors the default v2 layout', () => {
    const legacy = executorPageToLegacy(createExecutorPage('x'))
    expect(legacy.grid.flat().every(c => c === null)).toBe(true)
    expect(legacy.modes.flat().every(m => m === 'toggle')).toBe(true)
  })
})

describe('object numbers', () => {
  it('fills missing numbers after the highest, keeps valid ones, renumbers duplicates', () => {
    const list: { n?: number }[] = [{}, { n: 4 }, { n: 4 }, { n: 0 }, {}]
    fillObjectNumbers(list, x => x.n, (x, n) => { x.n = n })
    expect(list.map(x => x.n)).toEqual([5, 4, 6, 7, 8])
    expect(nextObjectNumber([undefined, 3, 9])).toBe(10)
    expect(nextObjectNumber([])).toBe(1)
  })
})

describe('v3 content sections', () => {
  it('lists the new sections (before executor)', () => {
    expect(CONTENT_SECTIONS).toEqual(expect.arrayContaining(['macros', 'speedMasters', 'stagePages', 'parked']))
    expect(LIST_SECTIONS).toEqual(expect.arrayContaining(['macros', 'speedMasters', 'stagePages']))
    expect(CONTENT_SECTIONS.indexOf('macros')).toBeLessThan(CONTENT_SECTIONS.indexOf('executor'))
  })

  it('normalises section items and values like a show load', () => {
    const macros = normalizeSectionItems('macros', [{ id: 'a', name: 'A', lines: ['Go'] }, { id: 'b', number: 1 }])
    expect(macros.map(m => m.number)).toEqual([2, 1])
    const masters = normalizeSectionItems('speedMasters', [{ id: 's', bpm: 5000 }])
    expect(masters[0]).toEqual({ id: 's', number: 1, name: 'Speed', bpm: 999 })
    const parked = normalizeSectionValue('parked', [{ fixtureId: 'f', channelName: 'Dimmer', value: 300, presetId: 'x' }], new Set())
    expect(parked).toEqual([{ fixtureId: 'f', channelName: 'Dimmer', value: 255 }])
    const ex = normalizeSectionValue('executor', { pages: [{ id: 'p', cells: [[{ kind: 'macro', id: 'gone', mode: 'toggle' }]] }] }, new Set(), { macro: new Set() })
    expect(ex.pages![0].cells[0][0]).toBeNull()
  })
})

describe('ShowFile type', () => {
  it('v3 fields are optional (a v2 object is a ShowFile)', () => {
    const v2: ShowFile = normalizeShow({ version: '2', patch: [] }).show
    delete v2.macros
    delete v2.executor!.pages
    expect(v2.patch).toEqual([])
  })
})
