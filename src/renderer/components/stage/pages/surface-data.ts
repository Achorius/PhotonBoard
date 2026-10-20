// ============================================================
// PhotonBoard — Stage surface data (pure, serialisable).
//
// Everything a touch surface (executor grid of any page, stage page
// widgets) needs to DRAW, in one plain object:
//   - console / remote: built from the stores (useSurfaceData)
//   - Stage window: received from the console (stage-surface-broadcast)
// `indexSurface()` turns it into lookup maps, `resolveCell()` gives the
// name / colour / state of an executor cell whatever it holds.
// No store access here (the Stage window bundle imports it).
// ============================================================

import type {
  Chase, Cuelist, Effect, ExecutorButtonFn, ExecutorColumnFader, ExecutorPage, ExecutorSceneMode, ExecutorTargetKind,
  Group, Macro, Preset, PresetType, SpeedMaster, StagePage
} from '@shared/types'
import type { ExecutorRef } from '@renderer/lib/pro/contracts'
import { cellFn, type CellRefData } from '../executor-surface'

export interface SurfaceExecPage {
  id: string
  name: string
  columns: { title: string; color: string; fader?: ExecutorColumnFader }[]
  /** [col][row] */
  cells: (CellRefData | null)[][]
}

export interface SurfaceCuelist {
  id: string
  name: string
  number?: number
  isPlaying: boolean
  faderLevel: number
  currentCueIndex: number
  cueCount: number
  flash: boolean
  goGeneration: number
  /** Current cue (while playing) */
  cueName?: string
  cueNumber?: number
  /** Fade of the current cue (delay + fade in, seconds) */
  cueFade?: number
  /** Cue the next GO plays */
  nextCueName?: string
  nextCueNumber?: number
}

export interface SurfaceChase { id: string; name: string; isPlaying: boolean; faderLevel: number; bpm: number; stepCount: number; currentStepIndex: number }
export interface SurfaceEffect { id: string; name: string; isRunning: boolean }
export interface SurfaceMacro { id: string; number: number; name: string; color?: string }
export interface SurfacePreset { id: string; type: PresetType; number: number; name: string; color?: string }
export interface SurfaceGroup { id: string; number?: number; name: string; color: string; fixtureCount: number; master: number }
export interface SurfaceSpeed { id: string; number: number; name: string; bpm: number }

export interface SurfaceData {
  executorPages: SurfaceExecPage[]
  currentPage: number
  selectedExecutor: ExecutorRef | null
  /** Sequence GO / Back widgets act on when they have no ref */
  goTargetId: string | null
  cuelists: SurfaceCuelist[]
  chases: SurfaceChase[]
  effects: SurfaceEffect[]
  macros: SurfaceMacro[]
  presets: SurfacePreset[]
  groups: SurfaceGroup[]
  /** Group whose fixtures are exactly the selection */
  activeGroupId: string | null
  selectionCount: number
  speedMasters: SurfaceSpeed[]
  stagePages: StagePage[]
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
}

/** Store slices buildSurfaceData reads */
export interface SurfaceSources {
  pages: readonly ExecutorPage[]
  currentPage: number
  selectedExecutor: ExecutorRef | null
  selectedCuelistId: string | null
  cuelists: readonly Cuelist[]
  chases: readonly Chase[]
  effects: readonly Effect[]
  macros: readonly Macro[]
  presets: readonly Preset[]
  groups: readonly Group[]
  selectedFixtureIds: readonly string[]
  groupMasters: Readonly<Record<string, number>>
  speedMasters: readonly SpeedMaster[]
  stagePages: readonly StagePage[]
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
}

// ---------------------------------------------------------------
// Pieces (each memoisable on its own source array)
// ---------------------------------------------------------------

export function surfaceExecPages(pages: readonly ExecutorPage[]): SurfaceExecPage[] {
  return pages.map((p) => ({
    id: p.id,
    name: p.name,
    columns: p.columns.map((c) => (c.fader ? { title: c.title, color: c.color, fader: c.fader } : { title: c.title, color: c.color })),
    cells: p.cells.map((col) => col.map((cell) => (cell ? (cell.button ? { kind: cell.kind, id: cell.id, mode: cell.mode, button: cell.button } : { kind: cell.kind, id: cell.id, mode: cell.mode }) : null)))
  }))
}

export function surfaceCuelists(cuelists: readonly Cuelist[]): SurfaceCuelist[] {
  return cuelists.map((cl) => {
    const s: SurfaceCuelist = {
      id: cl.id,
      name: cl.name,
      isPlaying: cl.isPlaying,
      faderLevel: cl.faderLevel,
      currentCueIndex: cl.currentCueIndex,
      cueCount: cl.cues.length,
      flash: cl.flash,
      goGeneration: cl.goGeneration ?? 0
    }
    if (cl.number !== undefined) s.number = cl.number
    const cur = cl.isPlaying ? cl.cues[cl.currentCueIndex] : undefined
    if (cur) {
      s.cueName = cur.name
      s.cueNumber = cur.number
      s.cueFade = (cur.delay ?? 0) + (cur.fadeIn ?? 0)
    }
    const nextIndex = cl.isPlaying ? cl.currentCueIndex + 1 : 0
    const next = cl.cues[nextIndex] ?? (cl.isPlaying && cl.isLooping ? cl.cues[0] : undefined)
    if (next) {
      s.nextCueName = next.name
      s.nextCueNumber = next.number
    }
    return s
  })
}

export function surfaceChases(chases: readonly Chase[]): SurfaceChase[] {
  return chases.map((c) => ({ id: c.id, name: c.name, isPlaying: c.isPlaying, faderLevel: c.faderLevel, bpm: c.bpm, stepCount: c.steps.length, currentStepIndex: c.currentStepIndex }))
}

export function surfaceGroups(groups: readonly Group[], masters: Readonly<Record<string, number>>): SurfaceGroup[] {
  return groups.filter((g) => !g.parentGroupId).map((g) => {
    const s: SurfaceGroup = { id: g.id, name: g.name, color: g.color, fixtureCount: g.fixtureIds.length, master: masters[g.id] ?? 255 }
    if (g.number !== undefined) s.number = g.number
    return s
  })
}

/** Group whose fixtures are exactly the selection */
export function activeGroupOf(groups: readonly Group[], selection: readonly string[]): string | null {
  if (selection.length === 0) return null
  const sel = new Set(selection)
  return groups.find((g) => !g.parentGroupId && g.fixtureIds.length === sel.size && g.fixtureIds.every((id) => sel.has(id)))?.id ?? null
}

/** Sequence GO / Back act on: the selected executor's scene, else the Scenes view selection, else the first */
export function goTargetOf(pages: readonly ExecutorPage[], selected: ExecutorRef | null, selectedCuelistId: string | null, cuelists: readonly Pick<Cuelist, 'id'>[]): string | null {
  if (selected) {
    const cell = pages[selected.page]?.cells[selected.col]?.[selected.row]
    if (cell?.kind === 'cuelist' && cuelists.some((c) => c.id === cell.id)) return cell.id
  }
  if (selectedCuelistId && cuelists.some((c) => c.id === selectedCuelistId)) return selectedCuelistId
  return cuelists[0]?.id ?? null
}

export function buildSurfaceData(s: SurfaceSources): SurfaceData {
  return {
    executorPages: surfaceExecPages(s.pages),
    currentPage: s.currentPage,
    selectedExecutor: s.selectedExecutor,
    goTargetId: goTargetOf(s.pages, s.selectedExecutor, s.selectedCuelistId, s.cuelists),
    cuelists: surfaceCuelists(s.cuelists),
    chases: surfaceChases(s.chases),
    effects: s.effects.map((e) => ({ id: e.id, name: e.name, isRunning: e.isRunning })),
    macros: s.macros.map((m) => (m.color ? { id: m.id, number: m.number, name: m.name, color: m.color } : { id: m.id, number: m.number, name: m.name })),
    presets: s.presets.map((p) => {
      const out: SurfacePreset = { id: p.id, type: p.type, number: p.number ?? 0, name: p.name }
      if (p.color) out.color = p.color
      return out
    }),
    groups: surfaceGroups(s.groups, s.groupMasters),
    activeGroupId: activeGroupOf(s.groups, s.selectedFixtureIds),
    selectionCount: s.selectedFixtureIds.length,
    speedMasters: s.speedMasters.map((m) => ({ id: m.id, number: m.number, name: m.name, bpm: m.bpm })),
    stagePages: s.stagePages as StagePage[],
    grandMaster: s.grandMaster,
    blackout: s.blackout,
    blinder: s.blinder,
    strobe: s.strobe
  }
}

// ---------------------------------------------------------------
// Index + cell resolution
// ---------------------------------------------------------------

export interface SurfaceIndex {
  data: SurfaceData
  cuelists: Map<string, SurfaceCuelist>
  chases: Map<string, SurfaceChase>
  effects: Map<string, SurfaceEffect>
  macros: Map<string, SurfaceMacro>
  presets: Map<string, SurfacePreset>
  groups: Map<string, SurfaceGroup>
  speedMasters: Map<string, SurfaceSpeed>
}

const byId = <T extends { id: string }>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))

export function indexSurface(data: SurfaceData): SurfaceIndex {
  return {
    data,
    cuelists: byId(data.cuelists),
    chases: byId(data.chases),
    effects: byId(data.effects),
    macros: byId(data.macros),
    presets: byId(data.presets),
    groups: byId(data.groups),
    speedMasters: byId(data.speedMasters)
  }
}

/** What a surface draws for an executor cell */
export interface ResolvedCell {
  kind: ExecutorTargetKind
  id: string
  mode: ExecutorSceneMode
  fn: ExecutorButtonFn
  name: string
  /** Object colour (macros), else the column colour is used */
  color?: string
  /** Playing / running / selected */
  active: boolean
  /** Flash on (scenes) */
  flash: boolean
  /** Scene / chase level 0-255 (levels mode) */
  level?: number
  /** Scenes: cue index & count; chases: step */
  position?: { index: number; count: number }
  /** Current cue name (scenes, while playing) */
  cueName?: string
  /** Fade of the current cue (seconds) + GO counter (progress bar restart) */
  cueFade?: number
  goGeneration?: number
  /** Secondary text: "128 BPM", "Macro 3"… (already formatted by the caller when needed) */
  detail?: string
  /** Number of the object (macros, groups, speed masters) */
  number?: number
  /** The object no longer exists */
  missing?: boolean
}

export function resolveCell(index: SurfaceIndex, cell: CellRefData | null | undefined): ResolvedCell | null {
  if (!cell) return null
  const base = { kind: cell.kind, id: cell.id, mode: cell.mode, fn: cellFn(cell), active: false, flash: false }
  switch (cell.kind) {
    case 'cuelist': {
      const cl = index.cuelists.get(cell.id)
      if (!cl) return { ...base, name: '', missing: true }
      return {
        ...base,
        name: cl.name,
        active: cl.isPlaying,
        flash: cl.flash,
        level: cl.faderLevel,
        position: { index: cl.isPlaying ? cl.currentCueIndex : -1, count: cl.cueCount },
        cueName: cl.cueName,
        cueFade: cl.cueFade,
        goGeneration: cl.goGeneration,
        number: cl.number
      }
    }
    case 'chase': {
      const ch = index.chases.get(cell.id)
      if (!ch) return { ...base, name: '', missing: true }
      return { ...base, name: ch.name, active: ch.isPlaying, level: ch.faderLevel, position: { index: ch.isPlaying ? ch.currentStepIndex : -1, count: ch.stepCount } }
    }
    case 'effect': {
      const fx = index.effects.get(cell.id)
      if (!fx) return { ...base, name: '', missing: true }
      return { ...base, name: fx.name, active: fx.isRunning }
    }
    case 'macro': {
      const m = index.macros.get(cell.id)
      if (!m) return { ...base, name: '', missing: true }
      return { ...base, name: m.name, color: m.color, number: m.number }
    }
    case 'group': {
      const g = index.groups.get(cell.id)
      if (!g) return { ...base, name: '', missing: true }
      return { ...base, name: g.name, color: g.color, active: index.data.activeGroupId === g.id, level: g.master, number: g.number }
    }
    case 'speed': {
      const s = index.speedMasters.get(cell.id)
      if (!s) return { ...base, name: '', missing: true }
      return { ...base, name: s.name, number: s.number }
    }
  }
}

/** Something on this page plays (page selector dots) */
export function pageIsActive(index: SurfaceIndex, page: SurfaceExecPage | undefined): boolean {
  if (!page) return false
  for (const col of page.cells) {
    for (const cell of col) {
      if (!cell) continue
      if (cell.kind === 'cuelist' && index.cuelists.get(cell.id)?.isPlaying) return true
      if (cell.kind === 'chase' && index.chases.get(cell.id)?.isPlaying) return true
      if (cell.kind === 'effect' && index.effects.get(cell.id)?.isRunning) return true
    }
  }
  return false
}

// ---------------------------------------------------------------
// Stage window: the surface message, and a surface from the slim
// snapshot alone (older consoles / before the first surface message)
// ---------------------------------------------------------------

/** Key of the surface message on the Stage window channel */
export const STAGE_SURFACE_KEY = '__stageSurface'

export interface StageSurfaceMessage {
  [STAGE_SURFACE_KEY]: SurfaceData
}

export function isStageSurfaceMessage(msg: unknown): msg is StageSurfaceMessage {
  return !!msg && typeof msg === 'object' && STAGE_SURFACE_KEY in msg
}

/** Fields of the state snapshot (lib/state-snapshot.ts) a surface can use */
export interface SnapshotLike {
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  cuelists: {
    id: string; name: string; isPlaying: boolean; faderLevel: number; currentCueIndex: number; cueCount?: number; flash?: boolean
    cues?: { name: string; number: number; fadeIn?: number; delay?: number }[]
  }[]
  chases?: { id: string; name: string; isPlaying: boolean; bpm: number; faderLevel: number; currentStepIndex: number; stepCount: number }[]
  groups: { id: string; name: string; color: string; fixtureCount: number }[]
  selectedFixtureIds: string[]
  executorGrid: (string | null)[][]
  executorColumns: { title: string; color: string }[]
  executorModes: string[][]
  executorPage?: number
  pages?: { id: string; name: string }[]
  speedMasters?: { id: string; number: number; name: string; bpm: number }[]
  runningEffects?: string[]
}

const modeOf = (m: unknown): ExecutorSceneMode => (m === 'trigger' || m === 'flash' ? m : 'toggle')

/**
 * Surface data from the snapshot only: the CURRENT page as the legacy
 * scene grid (other pages empty, other cell kinds unknown).
 */
export function surfaceFromSnapshot(s: SnapshotLike): SurfaceData {
  const pageList = s.pages && s.pages.length > 0 ? s.pages : [{ id: 'page-1', name: '' }]
  const current = Math.max(0, Math.min(pageList.length - 1, s.executorPage ?? 0))
  const legacy: SurfaceExecPage = {
    id: pageList[current].id,
    name: pageList[current].name,
    columns: s.executorColumns.map((c) => ({ title: c.title, color: c.color })),
    cells: s.executorGrid.map((col, c) => col.map((id, r) => (id ? { kind: 'cuelist' as const, id, mode: modeOf(s.executorModes[c]?.[r]) } : null)))
  }
  const executorPages = pageList.map((p, i) => (i === current
    ? legacy
    : { id: p.id, name: p.name, columns: legacy.columns, cells: legacy.cells.map((col) => col.map(() => null)) }))
  const cuelists: SurfaceCuelist[] = s.cuelists.map((c) => {
    const cur = c.isPlaying ? c.cues?.[c.currentCueIndex] : undefined
    const next = c.cues?.[c.isPlaying ? c.currentCueIndex + 1 : 0]
    const out: SurfaceCuelist = {
      id: c.id, name: c.name, isPlaying: c.isPlaying, faderLevel: c.faderLevel, currentCueIndex: c.currentCueIndex,
      cueCount: c.cueCount ?? c.cues?.length ?? 0, flash: !!c.flash, goGeneration: 0
    }
    if (cur) { out.cueName = cur.name; out.cueNumber = cur.number; out.cueFade = (cur.delay ?? 0) + (cur.fadeIn ?? 0) }
    if (next) { out.nextCueName = next.name; out.nextCueNumber = next.number }
    return out
  })
  return {
    executorPages,
    currentPage: current,
    selectedExecutor: null,
    goTargetId: cuelists[0]?.id ?? null,
    cuelists,
    chases: (s.chases ?? []).map((c) => ({ ...c })),
    effects: (s.runningEffects ?? []).map((id) => ({ id, name: '', isRunning: true })),
    macros: [],
    presets: [],
    groups: s.groups.map((g) => ({ ...g, master: 255 })),
    activeGroupId: null,
    selectionCount: s.selectedFixtureIds.length,
    speedMasters: s.speedMasters ?? [],
    stagePages: [],
    grandMaster: s.grandMaster,
    blackout: s.blackout,
    blinder: s.blinder,
    strobe: s.strobe
  }
}
