import { describe, expect, it, vi } from 'vitest'
import type { Cuelist, ExecutorPage, StagePage } from '@shared/types'
import {
  cellFn, columnFaderActive, columnFaderCommands, columnFaderLevel, decodeColumnRef, decodeExecRef, defaultFn, encodeColumnRef,
  encodeExecRef, faderKey, isHoldCell, isHoldFn, parseFaderKey, resolveExecPage, stepPage, swipeStep, type ColumnPageLike
} from './executor-surface'
import {
  activeGroupOf, buildSurfaceData, goTargetOf, indexSurface, isStageSurfaceMessage, pageIsActive, resolveCell, surfaceCuelists,
  surfaceFromSnapshot, STAGE_SURFACE_KEY, type SurfaceSources
} from './pages/surface-data'
import { cellAt, clampRect, findFreeSpot, fitWidgetsToGrid, inBounds, overlaps, rectFits, starterWidgets } from './pages/page-layout'
import { createCommandActions, presetCommandLine } from './pages/surface-actions'
import { readGhost } from './controller-ghosts'

// ---------------------------------------------------------------- helpers

function emptyCells(): ExecutorPage['cells'] {
  return Array.from({ length: 8 }, () => Array.from({ length: 4 }, () => null))
}

function page(id = 'p1', name = ''): ExecutorPage {
  return { id, name, cells: emptyCells(), columns: Array.from({ length: 8 }, () => ({ title: '', color: '#3b82f6' })) }
}

function cuelist(id: string, over: Partial<Cuelist> = {}): Cuelist {
  return {
    id, name: id.toUpperCase(), currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
    cues: [
      { id: `${id}-1`, name: 'Intro', number: 1, values: [], fadeIn: 2, fadeOut: 2, delay: 0.5, followTime: null },
      { id: `${id}-2`, name: 'Verse', number: 2, values: [], fadeIn: 1, fadeOut: 1, delay: 0, followTime: null }
    ],
    ...over
  }
}

function sources(over: Partial<SurfaceSources> = {}): SurfaceSources {
  return {
    pages: [page()], currentPage: 0, selectedExecutor: null, selectedCuelistId: null, cuelists: [], chases: [], effects: [],
    macros: [], presets: [], groups: [], selectedFixtureIds: [], groupMasters: {}, speedMasters: [], stagePages: [],
    grandMaster: 255, blackout: false, blinder: false, strobe: false, ...over
  }
}

// ---------------------------------------------------------------- button functions

describe('button functions', () => {
  it('default function follows the mode (TOG / TRIG / FLASH)', () => {
    expect(defaultFn('toggle')).toBe('toggle')
    expect(defaultFn('trigger')).toBe('temp')
    expect(defaultFn('flash')).toBe('flash')
    expect(cellFn({ mode: 'trigger' })).toBe('temp')
    expect(cellFn({ mode: 'trigger', button: 'go' })).toBe('go')
  })

  it('only temp / flash / swap act while held, never for macros, groups or speed masters', () => {
    expect(isHoldFn('temp')).toBe(true)
    expect(isHoldFn('flash')).toBe(true)
    expect(isHoldFn('swap')).toBe(true)
    for (const fn of ['toggle', 'go', 'goBack', 'off', 'select', 'pause', 'learn'] as const) expect(isHoldFn(fn)).toBe(false)
    expect(isHoldCell({ kind: 'cuelist', mode: 'flash' })).toBe(true)
    expect(isHoldCell({ kind: 'chase', mode: 'toggle', button: 'temp' })).toBe(true)
    expect(isHoldCell({ kind: 'macro', mode: 'flash' })).toBe(false)
    expect(isHoldCell({ kind: 'group', mode: 'trigger' })).toBe(false)
  })
})

// ---------------------------------------------------------------- pages

describe('pages', () => {
  it('steps are clamped, never wrap', () => {
    expect(stepPage(0, -1, 3)).toBe(0)
    expect(stepPage(0, 1, 3)).toBe(1)
    expect(stepPage(2, 1, 3)).toBe(2)
    expect(stepPage(5, 0, 3)).toBe(2)
    expect(stepPage(0, 1, 0)).toBe(0)
  })

  it('recognises horizontal swipes only', () => {
    expect(swipeStep(-120, 10, 200)).toBe(1) // finger to the left: next page
    expect(swipeStep(120, -10, 200)).toBe(-1)
    expect(swipeStep(30, 0, 100)).toBe(0) // too short
    expect(swipeStep(-120, 100, 200)).toBe(0) // too vertical
    expect(swipeStep(-200, 0, 2000)).toBe(0) // too slow
    expect(swipeStep(Number.NaN, 0, 10)).toBe(0)
  })
})

// ---------------------------------------------------------------- references

describe('executor widget references', () => {
  it('round-trips page.col.row, 1-based, 0 = current page', () => {
    expect(encodeExecRef({ page: 1, col: 2, row: 3 })).toBe('2.3.4')
    expect(encodeExecRef({ page: 'current', col: 0, row: 0 })).toBe('0.1.1')
    expect(decodeExecRef('2.3.4')).toEqual({ page: 1, col: 2, row: 3 })
    expect(decodeExecRef('0.8.4')).toEqual({ page: 'current', col: 7, row: 3 })
    expect(decodeExecRef('1.9.1')).toBeNull()
    expect(decodeExecRef('1.1.5')).toBeNull()
    expect(decodeExecRef('x')).toBeNull()
    expect(decodeExecRef(undefined)).toBeNull()
    expect(resolveExecPage({ page: 'current', col: 0, row: 0 }, 4)).toBe(4)
    expect(resolveExecPage({ page: 2, col: 0, row: 0 }, 4)).toBe(2)
  })

  it('round-trips column references', () => {
    expect(encodeColumnRef('current', 2)).toBe('0.3')
    expect(decodeColumnRef('0.3')).toEqual({ page: 'current', col: 2 })
    expect(decodeColumnRef('3.8')).toEqual({ page: 2, col: 7 })
    expect(decodeColumnRef('3.9')).toBeNull()
  })
})

// ---------------------------------------------------------------- column faders

describe('column faders', () => {
  const p: ColumnPageLike = {
    cells: [
      [null, { kind: 'cuelist', id: 'a', mode: 'toggle' }, { kind: 'chase', id: 'c', mode: 'toggle' }, null],
      [{ kind: 'macro', id: 'm', mode: 'toggle' }, null, null, null],
      [null, null, null, null]
    ],
    columns: [{}, {}, { fader: { kind: 'grandmaster' } }]
  }
  const lookup = { cuelist: (id: string) => (id === 'a' ? 100 : undefined), chase: () => 50, group: () => undefined, grandMaster: 200 }

  it('shows the first driven cell, the grand master, or nothing', () => {
    expect(columnFaderLevel(p, 0, lookup)).toBe(100)
    expect(columnFaderLevel(p, 1, lookup)).toBeNull()
    expect(columnFaderLevel(p, 2, lookup)).toBe(200)
    expect(columnFaderActive(p, 0)).toBe(true)
    expect(columnFaderActive(p, 1)).toBe(false)
    expect(columnFaderActive(p, 2)).toBe(true)
  })

  it('maps to existing remote commands for the Stage window', () => {
    expect(columnFaderCommands(p, 0, 127.6)).toEqual([
      { type: 'set-cuelist-fader', payload: { id: 'a', level: 128 } },
      { type: 'set-chase-fader', payload: { id: 'c', level: 128 } }
    ])
    expect(columnFaderCommands(p, 2, 300)).toEqual([{ type: 'set-grand-master', payload: 255 }])
    expect(columnFaderCommands(p, 1, 10)).toEqual([])
    const cellOnly: ColumnPageLike = { ...p, columns: [{ fader: { kind: 'cell', row: 2 } }] }
    expect(columnFaderCommands(cellOnly, 0, 10)).toEqual([{ type: 'set-chase-fader', payload: { id: 'c', level: 10 } }])
  })

  it('serialises fader functions for selects', () => {
    for (const f of [{ kind: 'grandmaster' }, { kind: 'cell', row: 2 }, { kind: 'group', id: 'g1' }, { kind: 'speed', id: 's1' }, { kind: 'rate', row: 0 }, { kind: 'xfade', row: 3 }] as const) {
      expect(parseFaderKey(faderKey(f))).toEqual(f)
    }
    expect(faderKey(undefined)).toBe('column')
    expect(parseFaderKey('column')).toBeUndefined()
    expect(parseFaderKey('cell:9')).toBeUndefined()
    expect(parseFaderKey('nonsense')).toBeUndefined()
  })
})

// ---------------------------------------------------------------- surface data

describe('surface data', () => {
  it('carries current / next cue names and the fade of the current cue', () => {
    const [stopped, playing] = surfaceCuelists([cuelist('a'), cuelist('b', { isPlaying: true, currentCueIndex: 0, goGeneration: 3 })])
    expect(stopped.cueName).toBeUndefined()
    expect(stopped.nextCueName).toBe('Intro')
    expect(playing).toMatchObject({ cueName: 'Intro', cueNumber: 1, cueFade: 2.5, nextCueName: 'Verse', nextCueNumber: 2, goGeneration: 3, cueCount: 2 })
  })

  it('resolves every cell kind, and missing objects', () => {
    const p = page()
    p.cells[0][0] = { kind: 'cuelist', id: 'a', mode: 'flash' }
    p.cells[1][0] = { kind: 'macro', id: 'm1', mode: 'toggle', button: 'off' }
    p.cells[2][0] = { kind: 'group', id: 'g1', mode: 'toggle' }
    p.cells[3][0] = { kind: 'effect', id: 'gone', mode: 'toggle' }
    const data = buildSurfaceData(sources({
      pages: [p],
      cuelists: [cuelist('a', { isPlaying: true, currentCueIndex: 1, flash: true, faderLevel: 128 })],
      macros: [{ id: 'm1', number: 3, name: 'Reset', color: '#ff0000', lines: [] }],
      groups: [{ id: 'g1', name: 'Wash', color: '#00ff00', fixtureIds: ['f1', 'f2'], number: 2 }],
      selectedFixtureIds: ['f2', 'f1'],
      groupMasters: { g1: 200 }
    }))
    const index = indexSurface(data)
    expect(resolveCell(index, p.cells[0][0])).toMatchObject({ name: 'A', active: true, flash: true, level: 128, fn: 'flash', position: { index: 1, count: 2 }, cueName: 'Verse' })
    expect(resolveCell(index, p.cells[1][0])).toMatchObject({ name: 'Reset', fn: 'off', color: '#ff0000', number: 3, active: false })
    expect(resolveCell(index, p.cells[2][0])).toMatchObject({ name: 'Wash', active: true, level: 200, number: 2 })
    expect(resolveCell(index, p.cells[3][0])).toMatchObject({ missing: true, name: '' })
    expect(resolveCell(index, null)).toBeNull()
    expect(pageIsActive(index, data.executorPages[0])).toBe(true)
  })

  it('finds the active group and the GO target', () => {
    const groups = [{ id: 'g1', name: '', color: '', fixtureIds: ['a', 'b'] }, { id: 'g2', name: '', color: '', fixtureIds: ['a'] }]
    expect(activeGroupOf(groups, ['b', 'a'])).toBe('g1')
    expect(activeGroupOf(groups, ['a'])).toBe('g2')
    expect(activeGroupOf(groups, [])).toBeNull()
    const p = page()
    p.cells[4][1] = { kind: 'cuelist', id: 'b', mode: 'toggle' }
    const cls = [{ id: 'a' }, { id: 'b' }]
    expect(goTargetOf([p], { page: 0, col: 4, row: 1 }, 'a', cls)).toBe('b')
    expect(goTargetOf([p], null, 'a', cls)).toBe('a')
    expect(goTargetOf([p], null, 'zz', cls)).toBe('a')
    expect(goTargetOf([p], null, null, [])).toBeNull()
  })

  it('is plain JSON (it crosses IPC to the Stage window)', () => {
    const data = buildSurfaceData(sources({ cuelists: [cuelist('a')] }))
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
    expect(isStageSurfaceMessage({ [STAGE_SURFACE_KEY]: data })).toBe(true)
    expect(isStageSurfaceMessage({ grandMaster: 1 })).toBe(false)
    expect(isStageSurfaceMessage(null)).toBe(false)
  })

  it('rebuilds the current page from an older snapshot (scene cells only)', () => {
    const data = surfaceFromSnapshot({
      grandMaster: 200, blackout: false, blinder: false, strobe: true,
      cuelists: [{ id: 'a', name: 'A', isPlaying: true, faderLevel: 255, currentCueIndex: 0, cueCount: 2, cues: [{ name: 'One', number: 1 }, { name: 'Two', number: 2 }] }],
      groups: [{ id: 'g', name: 'G', color: '#fff', fixtureCount: 2 }],
      selectedFixtureIds: [],
      executorGrid: [['a', null, null, null], ...Array.from({ length: 7 }, () => [null, null, null, null])],
      executorColumns: Array.from({ length: 8 }, () => ({ title: '', color: '#123456' })),
      executorModes: [['trigger', 'toggle', 'toggle', 'toggle'], ...Array.from({ length: 7 }, () => ['toggle', 'toggle', 'toggle', 'toggle'])],
      executorPage: 1,
      pages: [{ id: 'p1', name: '' }, { id: 'p2', name: 'Band' }]
    })
    expect(data.currentPage).toBe(1)
    expect(data.executorPages).toHaveLength(2)
    expect(data.executorPages[1].cells[0][0]).toEqual({ kind: 'cuelist', id: 'a', mode: 'trigger' })
    expect(data.executorPages[0].cells[0][0]).toBeNull()
    expect(data.cuelists[0]).toMatchObject({ cueName: 'One', nextCueName: 'Two' })
    expect(data.strobe).toBe(true)
  })
})

// ---------------------------------------------------------------- page layout

describe('stage page layout', () => {
  const pg = (widgets: StagePage['widgets'] = []): StagePage => ({ id: 's', name: '', cols: 4, rows: 3, widgets })
  const w = (id: string, x: number, y: number, ww = 1, h = 1) => ({ id, kind: 'label' as const, x, y, w: ww, h })

  it('detects overlaps and bounds', () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 1, h: 1 })).toBe(true)
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 1, h: 1 })).toBe(false)
    expect(inBounds(pg(), { x: 3, y: 2, w: 1, h: 1 })).toBe(true)
    expect(inBounds(pg(), { x: 3, y: 2, w: 2, h: 1 })).toBe(false)
    const p = pg([w('a', 0, 0, 2, 2)])
    expect(rectFits(p, { x: 1, y: 1, w: 1, h: 1 })).toBe(false)
    expect(rectFits(p, { x: 1, y: 1, w: 1, h: 1 }, 'a')).toBe(true) // moving itself
    expect(rectFits(p, { x: 2, y: 0, w: 2, h: 3 })).toBe(true)
  })

  it('clamps rectangles into the page', () => {
    expect(clampRect(pg(), { x: 3, y: 2, w: 3, h: 2 })).toEqual({ x: 1, y: 1, w: 3, h: 2 })
    expect(clampRect(pg(), { x: -2, y: -1, w: 9, h: 0 })).toEqual({ x: 0, y: 0, w: 4, h: 1 })
  })

  it('finds a free spot, near a cell first, shrinking when needed', () => {
    const p = pg([w('a', 0, 0, 2, 3)])
    expect(findFreeSpot(p, 2, 2)).toEqual({ x: 2, y: 0, w: 2, h: 2 })
    expect(findFreeSpot(p, 1, 1, { x: 3, y: 2 })).toEqual({ x: 3, y: 2, w: 1, h: 1 })
    expect(findFreeSpot(p, 3, 3)).toEqual({ x: 2, y: 0, w: 2, h: 3 })
    const full = pg([w('a', 0, 0, 4, 3)])
    expect(findFreeSpot(full, 1, 1)).toBeNull()
  })

  it('maps a point to a grid cell', () => {
    const b = { left: 100, top: 50, width: 400, height: 300 }
    expect(cellAt(b, 4, 3, 101, 51)).toEqual({ x: 0, y: 0 })
    expect(cellAt(b, 4, 3, 499, 349)).toEqual({ x: 3, y: 2 })
    expect(cellAt(b, 4, 3, 9999, -50)).toEqual({ x: 3, y: 0 })
  })

  it('fits widgets into a smaller grid, dropping what cannot fit', () => {
    const out = fitWidgetsToGrid([w('a', 0, 0, 2, 2), w('b', 3, 2, 1, 1), w('c', 2, 0, 2, 2)], 2, 2)
    expect(out.map((x) => x.id)).toEqual(['a'])
    const out2 = fitWidgetsToGrid([w('a', 0, 0, 1, 1), w('b', 5, 5, 1, 1)], 3, 3)
    expect(out2).toEqual([w('a', 0, 0, 1, 1), w('b', 2, 2, 1, 1)])
  })

  it('builds a starter layout that fits an 8 × 6 page without overlaps', () => {
    const widgets = starterWidgets({
      groups: Array.from({ length: 9 }, (_, i) => ({ id: `g${i}` })),
      macros: [{ id: 'm1' }],
      presets: [{ id: 'p1', type: 'color' }, { id: 'p2', type: 'position' }]
    }).map((x, i) => ({ ...x, id: String(i) }))
    const page: StagePage = { id: 's', name: '', cols: 8, rows: 6, widgets: [] }
    for (const x of widgets) {
      expect(rectFits(page, x)).toBe(true)
      page.widgets.push(x)
    }
    expect(widgets.filter((x) => x.kind === 'group')).toHaveLength(7)
    expect(widgets.filter((x) => x.kind === 'preset').map((x) => x.ref)).toEqual(['p1'])
    expect(widgets.some((x) => x.kind === 'go')).toBe(true)
  })
})

// ---------------------------------------------------------------- Stage window actions

describe('command actions (Stage window)', () => {
  it('sends existing remote commands', () => {
    const sent: [string, unknown][] = []
    const send = vi.fn((type: string, payload?: unknown) => { sent.push([type, payload]) })
    const throttled = vi.fn((_k: string, type: string, payload: unknown) => { sent.push([type, payload]) })
    const p: ColumnPageLike = { cells: [[{ kind: 'cuelist', id: 'a', mode: 'toggle' }, null, null, null]], columns: [{}] }
    const a = createCommandActions(send, throttled, (i) => (i === 0 ? p : undefined))
    a.executor({ page: 2, col: 1, row: 3 }, 'down')
    a.columnFader(0, 0, 64)
    a.columnFader(1, 0, 64) // unknown page: nothing
    a.macro('m1')
    a.preset('p', 'color', 2)
    a.setPage(3)
    a.go('a')
    expect(sent).toEqual([
      ['executor', { page: 2, col: 1, row: 3, phase: 'down' }],
      ['set-cuelist-fader', { id: 'a', level: 64 }],
      ['run-macro', { id: 'm1' }],
      ['cli', { text: 'At Preset 4.2', origin: 'stage' }],
      ['set-executor-page', 3],
      ['go-cuelist', 'a']
    ])
    expect(a.groupMaster).toBeUndefined()
    expect(a.speedTap).toBeUndefined()
  })

  it('writes preset command lines with the family number', () => {
    expect(presetCommandLine('position', 7)).toBe('At Preset 2.7')
    expect(presetCommandLine('full', 1)).toBe('At Preset 0.1')
  })
})

// ---------------------------------------------------------------- pickup ghosts

describe('controller ghosts', () => {
  it('reads the likely store shapes defensively', () => {
    expect(readGhost({ 'fader:2': 100 }, 2)).toBe(100)
    expect(readGhost({ 3: 300 }, 3)).toBe(255)
    expect(readGhost(new Map([['fader:1', { value: 12.4 }]]), 1)).toBe(12)
    expect(readGhost({ 'fader:1': 'x' }, 1)).toBeNull()
    expect(readGhost({}, 0)).toBeNull()
    expect(readGhost(undefined, 0)).toBeNull()
  })
})
