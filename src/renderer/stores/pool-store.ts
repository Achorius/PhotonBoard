// ============================================================
// PhotonBoard — Pools: presets, macros, speed masters, stage pages,
// group masters and parked channels.
//
// Presets live in usePlaybackStore.presets (one source of truth: show
// I/O, content sync and undo already handle them there); the preset
// actions below edit that list. Everything else lives here.
//
// Content (saved, synced to remotes, undoable): presets, macros,
// speedMasters (BPM excepted: a live control, like a chase's BPM),
// stagePages, parked. Saved but live (not synced, not undone, like
// fader levels): groupMasters.
// ============================================================

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type {
  CueChannelValue, Macro, Preset, PresetType, SpeedMaster, StagePage, StageWidget
} from '@shared/types'
import { MAX_OBJECT_NUMBER, nextObjectNumber, numberShowObjects } from '@shared/show-format'
import { usePlaybackStore } from './playback-store'
import { usePatchStore } from './patch-store'
import { useEffectsStore } from './effects-store'
import { useExecutorStore } from './executor-store'
import { markLocalChange, sendRemoteCommandThrottled } from '@renderer/lib/runtime'

export type NewPreset = Partial<Omit<Preset, 'id' | 'type'>> & { type: PresetType }

interface PoolState {
  macros: Macro[]
  speedMasters: SpeedMaster[]
  stagePages: StagePage[]
  /** Parked channels (output frozen); applied by the mixer */
  parked: CueChannelValue[]
  /** Group master levels 0-255 by group id (missing = full) */
  groupMasters: Record<string, number>

  // ---- Presets (usePlaybackStore.presets) ----
  /** New preset; numbered in its family (next free when `number` is missing or taken). Returns its id. */
  addPreset: (input: NewPreset, id?: string) => string
  updatePreset: (id: string, updates: Partial<Omit<Preset, 'id'>>) => void
  /** Delete a preset; cue values that referenced it keep their value */
  removePreset: (id: string) => void
  /** Give a preset another number in its family (swaps with the preset holding it). False when invalid. */
  renumberPreset: (id: string, number: number) => boolean

  // ---- Macros ----
  addMacro: (input?: Partial<Omit<Macro, 'id'>>, id?: string) => string
  updateMacro: (id: string, updates: Partial<Omit<Macro, 'id'>>) => void
  removeMacro: (id: string) => void
  renumberMacro: (id: string, number: number) => boolean

  // ---- Speed masters ----
  addSpeedMaster: (input?: Partial<Omit<SpeedMaster, 'id'>>, id?: string) => string
  updateSpeedMaster: (id: string, updates: Partial<Omit<SpeedMaster, 'id'>>) => void
  /** Live tempo (tap, fader): not an undo step */
  setSpeedMasterBpm: (id: string, bpm: number) => void
  /** Delete; scenes / chases / effects following it go back to their own tempo */
  removeSpeedMaster: (id: string) => void

  // ---- Stage pages ----
  addStagePage: (input?: Partial<Omit<StagePage, 'id'>>, id?: string) => string
  updateStagePage: (id: string, updates: Partial<Omit<StagePage, 'id' | 'widgets'>>) => void
  removeStagePage: (id: string) => void
  addStageWidget: (pageId: string, widget: Omit<StageWidget, 'id'>, id?: string) => string | null
  updateStageWidget: (pageId: string, widgetId: string, updates: Partial<Omit<StageWidget, 'id'>>) => void
  removeStageWidget: (pageId: string, widgetId: string) => void

  // ---- Group masters ----
  setGroupMaster: (groupId: string, level: number) => void

  // ---- Park ----
  /** Park channels at these values (a channel already parked takes the new value) */
  park: (values: CueChannelValue[]) => void
  /** Unpark every channel of these fixtures (all when omitted) */
  unpark: (fixtureIds?: string[]) => void

  // ---- Show load ----
  loadPools: (data: { macros?: Macro[]; speedMasters?: SpeedMaster[]; stagePages?: StagePage[]; parked?: CueChannelValue[]; groupMasters?: Record<string, number> }) => void
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function validNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_OBJECT_NUMBER
}

/** Preset of a family by number */
export function findPreset(type: PresetType, number: number, presets: readonly Preset[] = usePlaybackStore.getState().presets): Preset | undefined {
  return presets.find((p) => p.type === type && p.number === number)
}

/** Next free preset number in a family */
export function nextPresetNumber(type: PresetType, presets: readonly Preset[] = usePlaybackStore.getState().presets): number {
  return nextObjectNumber(presets.filter((p) => p.type === type).map((p) => p.number))
}

export function findMacro(number: number, macros: readonly Macro[] = usePoolStore.getState().macros): Macro | undefined {
  return macros.find((m) => m.number === number)
}

export function findSpeedMaster(number: number, masters: readonly SpeedMaster[] = usePoolStore.getState().speedMasters): SpeedMaster | undefined {
  return masters.find((m) => m.number === number)
}

/** Renumber `id` to `number` in `list` (swap with the holder of that number). Null when invalid / unchanged. */
function renumber<T extends { id: string; number?: number }>(list: T[], id: string, number: number, sameFamily: (a: T, b: T) => boolean = () => true): T[] | null {
  if (!validNumber(number)) return null
  const item = list.find((x) => x.id === id)
  if (!item || item.number === number) return null
  const holder = list.find((x) => x.id !== id && x.number === number && sameFamily(x, item))
  return list.map((x) => {
    if (x.id === id) return { ...x, number }
    if (holder && x.id === holder.id) {
      return { ...x, number: item.number ?? nextObjectNumber(list.filter((y) => sameFamily(y, item)).map((y) => y.number)) }
    }
    return x
  })
}

/** Remove executor cells (and column faders) pointing at an object */
function clearExecutorRefs(kind: 'macro' | 'speed', id: string): void {
  const ex = useExecutorStore.getState()
  ex.pages.forEach((page, p) => {
    page.cells.forEach((column, col) => column.forEach((cell, row) => {
      if (cell && cell.kind === kind && cell.id === id) ex.assignCell(p, col, row, null)
    }))
    if (kind === 'speed') {
      page.columns.forEach((c, col) => {
        if (c.fader?.kind === 'speed' && c.fader.id === id) ex.setColumnFader(p, col, undefined)
      })
    }
  })
}

const valueKey = (v: { fixtureId: string; channelName: string }) => `${v.fixtureId}\u0000${v.channelName}`

export const usePoolStore = create<PoolState>()(subscribeWithSelector((set, get) => ({
  macros: [],
  speedMasters: [],
  stagePages: [],
  parked: [],
  groupMasters: {},

  // ---- Presets ----
  addPreset: (input, givenId) => {
    const id = givenId || uuidv4()
    const { presets } = usePlaybackStore.getState()
    const number = validNumber(input.number) && !findPreset(input.type, input.number, presets) ? input.number : nextPresetNumber(input.type, presets)
    const preset: Preset = { ...input, id, name: input.name ?? '', type: input.type, values: input.values ?? {}, number }
    usePlaybackStore.setState({ presets: [...presets, preset] })
    return id
  },

  updatePreset: (id, updates) => {
    const { presets } = usePlaybackStore.getState()
    if (!presets.some((p) => p.id === id)) return
    usePlaybackStore.setState({
      presets: presets.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, ...updates, id }
        // A new family: keep the number only when free there
        if (updates.type && updates.type !== p.type && updates.number === undefined) {
          next.number = findPreset(updates.type, p.number ?? -1, presets) ? nextPresetNumber(updates.type, presets) : p.number
        }
        return next
      })
    })
  },

  removePreset: (id) => {
    const pb = usePlaybackStore.getState()
    if (!pb.presets.some((p) => p.id === id)) return
    const strip = (values: CueChannelValue[]) => {
      if (!values.some((v) => v.presetId === id)) return values
      return values.map((v) => {
        if (v.presetId !== id) return v
        const { presetId: _p, ...rest } = v
        return rest
      })
    }
    let cuelistsChanged = false
    const cuelists = pb.cuelists.map((cl) => {
      let changed = false
      const cues = cl.cues.map((cue) => {
        const values = strip(cue.values)
        if (values === cue.values) return cue
        changed = true
        return { ...cue, values }
      })
      if (!changed) return cl
      cuelistsChanged = true
      return { ...cl, cues }
    })
    let chasesChanged = false
    const chases = pb.chases.map((ch) => {
      let changed = false
      const steps = ch.steps.map((s) => {
        const values = strip(s.values)
        if (values === s.values) return s
        changed = true
        return { ...s, values }
      })
      if (!changed) return ch
      chasesChanged = true
      return { ...ch, steps }
    })
    usePlaybackStore.setState({
      presets: pb.presets.filter((p) => p.id !== id),
      ...(cuelistsChanged ? { cuelists } : {}),
      ...(chasesChanged ? { chases } : {})
    })
  },

  renumberPreset: (id, number) => {
    const { presets } = usePlaybackStore.getState()
    const next = renumber(presets, id, number, (a, b) => a.type === b.type)
    if (!next) return false
    usePlaybackStore.setState({ presets: next })
    return true
  },

  // ---- Macros ----
  addMacro: (input = {}, givenId) => {
    const id = givenId || uuidv4()
    const { macros } = get()
    const number = validNumber(input.number) && !findMacro(input.number, macros) ? input.number : nextObjectNumber(macros.map((m) => m.number))
    const macro: Macro = { ...input, id, number, name: input.name ?? '', lines: (input.lines ?? []).map((l) => ({ ...l })) }
    set({ macros: [...macros, macro] })
    return id
  },

  updateMacro: (id, updates) => {
    const { macros } = get()
    if (!macros.some((m) => m.id === id)) return
    set({ macros: macros.map((m) => (m.id === id ? { ...m, ...updates, id, number: validNumber(updates.number) ? updates.number : m.number } : m)) })
  },

  removeMacro: (id) => {
    if (!get().macros.some((m) => m.id === id)) return
    set({ macros: get().macros.filter((m) => m.id !== id) })
    clearExecutorRefs('macro', id)
  },

  renumberMacro: (id, number) => {
    const next = renumber(get().macros, id, number)
    if (!next) return false
    set({ macros: next })
    return true
  },

  // ---- Speed masters ----
  addSpeedMaster: (input = {}, givenId) => {
    const id = givenId || uuidv4()
    const { speedMasters } = get()
    const number = validNumber(input.number) && !findSpeedMaster(input.number, speedMasters) ? input.number : nextObjectNumber(speedMasters.map((m) => m.number))
    const bpm = typeof input.bpm === 'number' && Number.isFinite(input.bpm) ? Math.max(1, Math.min(999, input.bpm)) : 120
    set({ speedMasters: [...speedMasters, { id, number, name: input.name ?? '', bpm }] })
    return id
  },

  updateSpeedMaster: (id, updates) => {
    const { speedMasters } = get()
    if (!speedMasters.some((m) => m.id === id)) return
    set({ speedMasters: speedMasters.map((m) => (m.id === id ? { ...m, ...updates, id } : m)) })
  },

  setSpeedMasterBpm: (id, bpm) => {
    if (!Number.isFinite(bpm)) return
    const value = Math.max(1, Math.min(999, bpm))
    // Remote browser: the console runs the masters (no-ops on the console)
    markLocalChange(`speedBpm:${id}`)
    sendRemoteCommandThrottled(`speedBpm:${id}`, 'set-speed-master-bpm', { id, bpm: value })
    const { speedMasters } = get()
    if (speedMasters.find((m) => m.id === id)?.bpm === value) return
    set({ speedMasters: speedMasters.map((m) => (m.id === id ? { ...m, bpm: value } : m)) })
  },

  removeSpeedMaster: (id) => {
    if (!get().speedMasters.some((m) => m.id === id)) return
    set({ speedMasters: get().speedMasters.filter((m) => m.id !== id) })
    const pb = usePlaybackStore.getState()
    if (pb.cuelists.some((c) => c.speedMasterId === id) || pb.chases.some((c) => c.speedMasterId === id)) {
      usePlaybackStore.setState({
        cuelists: pb.cuelists.map((c) => (c.speedMasterId === id ? (({ speedMasterId: _s, ...rest }) => rest)(c) : c)),
        chases: pb.chases.map((c) => (c.speedMasterId === id ? (({ speedMasterId: _s, ...rest }) => rest)(c) : c))
      })
    }
    const fx = useEffectsStore.getState()
    if (fx.effects.some((e) => e.speedMasterId === id)) {
      useEffectsStore.setState({ effects: fx.effects.map((e) => (e.speedMasterId === id ? (({ speedMasterId: _s, ...rest }) => rest)(e) : e)) })
    }
    clearExecutorRefs('speed', id)
  },

  // ---- Stage pages ----
  addStagePage: (input = {}, givenId) => {
    const id = givenId || uuidv4()
    const page: StagePage = {
      id,
      name: input.name ?? '',
      cols: input.cols ?? 8,
      rows: input.rows ?? 6,
      widgets: (input.widgets ?? []).map((w) => ({ ...w }))
    }
    set({ stagePages: [...get().stagePages, page] })
    return id
  },

  updateStagePage: (id, updates) => {
    const { stagePages } = get()
    if (!stagePages.some((p) => p.id === id)) return
    set({ stagePages: stagePages.map((p) => (p.id === id ? { ...p, ...updates, id, widgets: p.widgets } : p)) })
  },

  removeStagePage: (id) => {
    if (!get().stagePages.some((p) => p.id === id)) return
    set({ stagePages: get().stagePages.filter((p) => p.id !== id) })
  },

  addStageWidget: (pageId, widget, givenId) => {
    const { stagePages } = get()
    if (!stagePages.some((p) => p.id === pageId)) return null
    const id = givenId || uuidv4()
    set({ stagePages: stagePages.map((p) => (p.id === pageId ? { ...p, widgets: [...p.widgets, { ...widget, id }] } : p)) })
    return id
  },

  updateStageWidget: (pageId, widgetId, updates) => {
    const { stagePages } = get()
    const page = stagePages.find((p) => p.id === pageId)
    if (!page || !page.widgets.some((w) => w.id === widgetId)) return
    set({
      stagePages: stagePages.map((p) => (p.id === pageId
        ? { ...p, widgets: p.widgets.map((w) => (w.id === widgetId ? { ...w, ...updates, id: widgetId } : w)) }
        : p))
    })
  },

  removeStageWidget: (pageId, widgetId) => {
    const { stagePages } = get()
    const page = stagePages.find((p) => p.id === pageId)
    if (!page || !page.widgets.some((w) => w.id === widgetId)) return
    set({ stagePages: stagePages.map((p) => (p.id === pageId ? { ...p, widgets: p.widgets.filter((w) => w.id !== widgetId) } : p)) })
  },

  // ---- Group masters ----
  setGroupMaster: (groupId, level) => {
    if (!Number.isFinite(level)) return
    const v = Math.max(0, Math.min(255, Math.round(level)))
    // Remote browser: the console applies group masters (no-ops on the console)
    markLocalChange(`groupMaster:${groupId}`)
    sendRemoteCommandThrottled(`groupMaster:${groupId}`, 'set-group-master', { id: groupId, level: v })
    if (get().groupMasters[groupId] === v) return
    set({ groupMasters: { ...get().groupMasters, [groupId]: v } })
  },

  // ---- Park ----
  park: (values) => {
    if (values.length === 0) return
    const byKey = new Map(get().parked.map((v) => [valueKey(v), v]))
    let changed = false
    for (const v of values) {
      const key = valueKey(v)
      const value = Math.max(0, Math.min(255, Math.round(v.value)))
      if (byKey.get(key)?.value === value) continue
      byKey.set(key, { fixtureId: v.fixtureId, channelName: v.channelName, value })
      changed = true
    }
    if (changed) set({ parked: Array.from(byKey.values()) })
  },

  unpark: (fixtureIds) => {
    const { parked } = get()
    if (parked.length === 0) return
    const ids = fixtureIds ? new Set(fixtureIds) : null
    const next = ids ? parked.filter((v) => !ids.has(v.fixtureId)) : []
    if (next.length !== parked.length) set({ parked: next })
  },

  loadPools: (data) => set({
    macros: data.macros ?? [],
    speedMasters: data.speedMasters ?? [],
    stagePages: data.stagePages ?? [],
    parked: data.parked ?? [],
    groupMasters: data.groupMasters ?? {}
  })
})))

/**
 * Give a number to every object that has none (fixtures created in the
 * patch, groups, sequences…). Show loads number everything already; call
 * this before showing numbers (Pro view, command line) to make numbers of
 * new objects stable. Only writes the stores that change.
 */
export function ensureObjectNumbers(): void {
  const patchState = usePatchStore.getState()
  const pb = usePlaybackStore.getState()
  const fx = useEffectsStore.getState()
  const pool = usePoolStore.getState()
  const missing = (list: { number?: number }[]) => list.some((x) => !x.number)
  /** Copies numbered in place; untouched items keep their identity */
  const keep = <T extends object>(orig: T[], copies: T[]): T[] =>
    copies.map((c, i) => (JSON.stringify(c) === JSON.stringify(orig[i]) ? orig[i] : c))
  if (patchState.patch.some((p) => !p.fid) || missing(patchState.groups)) {
    const patch = patchState.patch.map((p) => ({ ...p }))
    const groups = patchState.groups.map((g) => ({ ...g }))
    numberShowObjects({ patch, groups })
    usePatchStore.setState({ patch: keep(patchState.patch, patch), groups: keep(patchState.groups, groups) })
  }
  if (missing(pb.presets) || missing(pb.cuelists) || missing(pb.chases)) {
    const presets = pb.presets.map((p) => ({ ...p }))
    const cuelists = pb.cuelists.map((c) => ({ ...c }))
    const chases = pb.chases.map((c) => ({ ...c }))
    numberShowObjects({ presets, cuelists, chases })
    usePlaybackStore.setState({ presets: keep(pb.presets, presets), cuelists: keep(pb.cuelists, cuelists), chases: keep(pb.chases, chases) })
  }
  if (missing(fx.effects)) {
    const effects = fx.effects.map((e) => ({ ...e }))
    numberShowObjects({ effects })
    useEffectsStore.setState({ effects: keep(fx.effects, effects) })
  }
  if (missing(pool.macros) || missing(pool.speedMasters)) {
    const macros = pool.macros.map((m) => ({ ...m }))
    const speedMasters = pool.speedMasters.map((m) => ({ ...m }))
    numberShowObjects({ macros, speedMasters })
    usePoolStore.setState({ macros: keep(pool.macros, macros), speedMasters: keep(pool.speedMasters, speedMasters) })
  }
}
