// ============================================================
// PhotonBoard — ProApi: the real facade over the stores and the pro
// modules (command line, macros, MIDI profiles, remote commands and
// the pro UI all go through it; see contracts.ts).
//
//   const api = createProApi()        // once, at app start
//   setCliContext({ api, t, now })    // the integrator wires the CLI
//
// Every mutating method is ONE undo step (history.historyStep) named
// in pro.programmer.undo.*; `transaction(label, fn)` groups several
// into one (nested transactions join the outer one). Executor / cue
// engine specifics call executor-actions and the playback store (WP3
// improves those engines behind the same signatures).
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { Cue, CueChannelValue, CueFeature, Cuelist, FixtureDefinition, PresetType } from '@shared/types'
import { PRESET_FAMILY_NUMBER } from '@shared/types'
import { MAX_OBJECT_NUMBER } from '@shared/show-format'
import { featureOfChannel } from '@shared/attribute-families'
import { t } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore, DEFAULT_CUE_FADE_IN, DEFAULT_CUE_FADE_OUT } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { findMacro, findPreset, usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { getActiveSelection, stepSelection, useSelectionStore } from '@renderer/stores/selection-store'
import { SWATCH_COLORS } from '@renderer/components/ui/tokens'
import { isProgrammerActive } from '@renderer/lib/dmx-mixer'
import { clearProgrammerAll, programChannel, recordFromProgrammer } from '@renderer/lib/programmer-utils'
import { historyStep, redo as historyRedo, undo as historyUndo } from '@renderer/lib/history'
import { runMacro as cliRunMacro, stopMacro as cliStopMacro } from '@renderer/lib/cli'
import type { AskChoice, ClearStage, ExecutorRef, ProApi, ProgTime, StoreCueResult } from './contracts'
import {
  applyPreset as engineApplyPreset, getProgrammerMeta, isProgrammerFading, outputValuesOf, park as enginePark,
  releaseFixtures as engineRelease, setAttributeValues as engineSetValues, setHighlight as engineSetHighlight, setPresetRef,
  unpark as engineUnpark
} from './programmer-engine'
import { cueKey } from '@renderer/lib/fixture-index'
import { channelFitsPreset, refreshCueValuesFromPresets } from './preset-resolve'
import {
  insertCue, nextCueNumber, storeIntoCue, storePreset as storePresetValues, updateCueValues, updateFromProgrammer,
  type KeyMetaFn, type StoreOptions
} from './store-ops'
import { columnFader, executorCellAt, executorPress, selectExecutor, selectedExecutor } from './executor-actions'
import { tapSpeedMaster } from './speed-masters'

/** What createProApi adds to the ProApi contract */
export interface ProApiExtras {
  /** Current output (post-master) of every channel of these fixtures, for "Park" without a value */
  getOutputValues(fixtureIds: string[]): CueChannelValue[]
}

export interface ProApiOptions {
  /**
   * How ask() reaches the operator. Default: the app's dialog (ui/dialogs
   * ask). Return null when cancelled.
   */
  ask?: (question: string, choices: AskChoice[]) => Promise<string | null>
  /** false: never ask (headless / macros) — ask() answers `fallback` */
  interactive?: boolean
}

const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_OBJECT_NUMBER
const clampByte = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0)

function defOf(fixtureId: string): FixtureDefinition | undefined {
  const { patch, fixtures } = usePatchStore.getState()
  const entry = patch.find(p => p.id === fixtureId)
  return entry ? fixtures.find(f => f.id === entry.fixtureDefId) : undefined
}

/** Feature lookup for store operations (maps built once per call) */
function makeKeyMeta(): KeyMetaFn {
  const { patch, fixtures } = usePatchStore.getState()
  const entries = new Map(patch.map(p => [p.id, p]))
  const defs = new Map(fixtures.map(f => [f.id, f]))
  return (fixtureId, channelName) => {
    const entry = entries.get(fixtureId)
    const ch = entry ? defs.get(entry.fixtureDefId)?.channels[channelName] : undefined
    return { feature: featureOfChannel(channelName, ch?.type, ch?.precedence) }
  }
}

function featureOf(fixtureId: string, channelName: string): CueFeature {
  const ch = defOf(fixtureId)?.channels[channelName]
  return featureOfChannel(channelName, ch?.type, ch?.precedence)
}

function presetLabel(type: PresetType, number: number | undefined): string {
  return `${PRESET_FAMILY_NUMBER[type]}.${number ?? '?'}`
}

function programmerValues(withMeta: boolean, fixtureIds?: string[]): CueChannelValue[] {
  const values = recordFromProgrammer({ withMeta })
  if (!fixtureIds) return values
  const ids = new Set(fixtureIds)
  return values.filter(v => ids.has(v.fixtureId))
}

/** Re-resolve the values of cue / chase values that reference presets (after a preset changed) */
function refreshPresetRefs(): void {
  const pb = usePlaybackStore.getState()
  const { patch, fixtures } = usePatchStore.getState()
  const cuelists = refreshCueValuesFromPresets(pb.cuelists, pb.presets, patch, fixtures)
  const chases = refreshCueValuesFromPresets(pb.chases, pb.presets, patch, fixtures)
  if (cuelists !== pb.cuelists || chases !== pb.chases) usePlaybackStore.setState({ cuelists, chases })
}

function replaceCuelist(list: Cuelist): void {
  usePlaybackStore.setState((s) => ({ cuelists: s.cuelists.map(c => (c.id === list.id ? list : c)) }))
}

function nextSceneName(): string {
  const { cuelists } = usePlaybackStore.getState()
  const names = new Set(cuelists.map(c => c.name))
  let n = cuelists.length + 1
  while (names.has(t('scenes.defaults.sceneName', { n }))) n++
  return t('scenes.defaults.sceneName', { n })
}

function newCue(number: number): Cue {
  return {
    id: uuidv4(),
    name: t('scenes.defaults.cueName', { n: number }),
    number,
    values: [],
    fadeIn: DEFAULT_CUE_FADE_IN,
    fadeOut: DEFAULT_CUE_FADE_OUT,
    delay: 0,
    followTime: null
  }
}

/** Set a group's fixtures (in this order), keeping the patch entries' groupIds in step */
function setGroupFixtures(groupId: string, fixtureIds: string[]): void {
  const ids = [...new Set(fixtureIds)]
  const inGroup = new Set(ids)
  usePatchStore.setState((s) => ({
    groups: s.groups.map(g => (g.id === groupId ? { ...g, fixtureIds: ids } : g)),
    patch: s.patch.map(p => {
      const has = p.groupIds.includes(groupId)
      if (inGroup.has(p.id) === has) return p
      return { ...p, groupIds: has ? p.groupIds.filter(g => g !== groupId) : [...p.groupIds, groupId] }
    })
  }))
}

async function dialogAsk(question: string, choices: AskChoice[]): Promise<string | null> {
  const { ask } = await import('@renderer/components/ui/dialogs')
  return ask({ title: question, actions: choices.map(c => ({ id: c.id, label: c.label })) })
}

/** The real ProApi over the app's stores. */
export function createProApi(options: ProApiOptions = {}): ProApi & ProApiExtras {
  let depth = 0

  function transaction<T>(label: string, fn: () => T): T {
    if (depth > 0) return fn()
    let result!: T
    depth++
    try {
      historyStep(label, () => { result = fn() })
    } finally {
      depth--
    }
    return result
  }

  function getSelectedCuelist(): string | null {
    const { cuelists, selectedCuelistId } = usePlaybackStore.getState()
    const ref = selectedExecutor()
    if (ref) {
      const cell = executorCellAt(ref)
      if (cell?.kind === 'cuelist' && cuelists.some(c => c.id === cell.id)) return cell.id
    }
    return selectedCuelistId && cuelists.some(c => c.id === selectedCuelistId) ? selectedCuelistId : null
  }

  function createCuelistInner(name?: string, number?: number): string {
    const pb = usePlaybackStore.getState()
    const id = pb.addCuelist(name?.trim() || nextSceneName())
    if (validNumber(number) && !usePlaybackStore.getState().cuelists.some(c => c.id !== id && c.number === number)) {
      usePlaybackStore.setState((s) => ({ cuelists: s.cuelists.map(c => (c.id === id ? { ...c, number } : c)) }))
    }
    return id
  }

  const api: ProApi & ProApiExtras = {
    // ---------------------------------------------------------------- read model
    getPatch: () => usePatchStore.getState().patch,
    getFixtureDefs: () => usePatchStore.getState().fixtures,
    getGroups: () => usePatchStore.getState().groups,
    getPresets: () => usePlaybackStore.getState().presets,
    getCuelists: () => usePlaybackStore.getState().cuelists,
    getChases: () => usePlaybackStore.getState().chases,
    getEffects: () => useEffectsStore.getState().effects,
    getMacros: () => usePoolStore.getState().macros,
    getSpeedMasters: () => usePoolStore.getState().speedMasters,
    getExecutorPages: () => useExecutorStore.getState().pages,

    // ---------------------------------------------------------------- selection
    getSelection: () => [...usePatchStore.getState().selectedFixtureIds],
    setSelection: (ids) => usePatchStore.getState().selectFixtures(ids),
    selectStep: (direction) => stepSelection(direction),
    getActiveSelection: () => getActiveSelection(),
    getMatricks: () => ({ ...useSelectionStore.getState().matricks }),
    setMatricks: (m) => useSelectionStore.getState().setMatricks(m),
    setAlign: (align) => useSelectionStore.getState().setAlign(align),

    // ---------------------------------------------------------------- programmer
    setAttributeValues: (values, time) => engineSetValues(values, time),
    applyPreset: (presetId, fixtureIds, time) => engineApplyPreset(presetId, fixtureIds, time),
    releaseFixtures: (fixtureIds) => { engineRelease(fixtureIds) },
    clear: (stage) => {
      const hasSelection = usePatchStore.getState().selectedFixtureIds.length > 0
      const hasValues = isProgrammerActive() || isProgrammerFading()
      const s: ClearStage = stage ?? (hasSelection ? 'selection' : hasValues ? 'values' : 'all')
      if (s === 'selection') {
        usePatchStore.getState().clearSelection()
      } else if (s === 'values') {
        clearProgrammerAll()
      } else {
        clearProgrammerAll()
        usePatchStore.getState().clearSelection()
        useSelectionStore.getState().reset()
        engineSetHighlight(null)
      }
      return s
    },
    getProgrammerValues: (opts = {}) => programmerValues(!!opts.withMeta, opts.fixtureIds),
    getProgTime: () => useProStore.getState().progTime,
    setProgTime: (time: ProgTime | null) => useProStore.getState().setProgTime(time),
    setDmx: (universe, channel, value) => {
      if (!Number.isInteger(universe) || !Number.isInteger(channel) || channel < 0 || channel >= 512 || universe < 0) return
      programChannel(universe, channel, clampByte(value))
    },

    // ---------------------------------------------------------------- presets
    storePreset: (type, number, opts = {}) => {
      if (!validNumber(number)) return null
      const existing = findPreset(type, number)
      const mode = opts.mode === 'overwrite' ? 'overwrite' : opts.mode === 'remove' ? 'remove' : 'merge'
      const values = programmerValues(false, opts.fixtureIds).filter(v => channelFitsPreset(type, defOf(v.fixtureId), v.channelName))
      if (values.length === 0 || (mode === 'remove' && !existing)) return null
      const scope = opts.scope ?? existing?.scope ?? 'selective'
      return transaction(t('pro.programmer.undo.storePreset', { preset: presetLabel(type, number) }), () => {
        const { patch } = usePatchStore.getState()
        const stored = storePresetValues(existing ?? null, type, values, scope, patch, mode)
        if (opts.name !== undefined) stored.name = opts.name
        const pool = usePoolStore.getState()
        if (existing) {
          // Whole replacement: overwrite / remove may drop whole scope levels
          const presets = usePlaybackStore.getState().presets
          usePlaybackStore.setState({ presets: presets.map(p => (p.id === existing.id ? { ...stored, id: existing.id, type, number: existing.number } : p)) })
        } else {
          const { id, ...input } = stored
          pool.addPreset({ ...input, type, number }, id)
        }
        refreshPresetRefs()
        if (mode !== 'remove') setPresetRef(values, stored.id)
        return usePlaybackStore.getState().presets.find(p => p.id === stored.id) ?? null
      })
    },
    updatePresetsFromProgrammer: () => {
      // Values that came from a preset (still referenced, or changed by hand since)
      const meta = getProgrammerMeta()
      const values: CueChannelValue[] = []
      for (const v of programmerValues(false)) {
        const m = meta.get(cueKey(v.fixtureId, v.channelName))
        const presetId = m?.presetId ?? m?.origin
        if (presetId) values.push({ ...v, presetId })
      }
      if (values.length === 0) return 0
      return transaction(t('pro.programmer.undo.updatePresets'), () => {
        const pb = usePlaybackStore.getState()
        const res = updateFromProgrammer({ cuelists: [], presets: pb.presets, values, activeCues: [], patch: usePatchStore.getState().patch })
        if (res.presets > 0) {
          usePlaybackStore.setState({ presets: res.presetList })
          refreshPresetRefs()
        }
        // The programmer shows the (updated) presets again
        const byPreset = new Map<string, CueChannelValue[]>()
        for (const v of values) (byPreset.get(v.presetId!) ?? byPreset.set(v.presetId!, []).get(v.presetId!)!).push(v)
        for (const [presetId, list] of byPreset) setPresetRef(list, presetId)
        return res.presets
      })
    },
    updatePreset: (id, updates) => {
      const p = usePlaybackStore.getState().presets.find(x => x.id === id)
      if (!p) return
      transaction(t('pro.programmer.undo.editPreset', { preset: presetLabel(p.type, p.number) }), () => {
        usePoolStore.getState().updatePreset(id, updates)
        refreshPresetRefs()
      })
    },
    deletePreset: (id) => {
      const p = usePlaybackStore.getState().presets.find(x => x.id === id)
      if (!p) return
      transaction(t('pro.programmer.undo.deletePreset', { preset: presetLabel(p.type, p.number) }), () => usePoolStore.getState().removePreset(id))
    },
    copyPreset: (id, toNumber) => {
      const p = usePlaybackStore.getState().presets.find(x => x.id === id)
      if (!p || !validNumber(toNumber) || findPreset(p.type, toNumber)) return null
      return transaction(t('pro.programmer.undo.copyPreset', { preset: presetLabel(p.type, p.number) }), () => {
        const { id: _id, number: _n, ...rest } = structuredClone(p)
        return usePoolStore.getState().addPreset({ ...rest, number: toNumber })
      })
    },
    movePreset: (id, toNumber) => {
      const p = usePlaybackStore.getState().presets.find(x => x.id === id)
      if (!p || !validNumber(toNumber)) return false
      return transaction(t('pro.programmer.undo.movePreset', { preset: presetLabel(p.type, p.number) }), () => usePoolStore.getState().renumberPreset(id, toNumber))
    },

    // ---------------------------------------------------------------- sequences & cues
    getSelectedCuelist,
    selectCuelist: (id) => usePlaybackStore.getState().selectCuelist(id),
    createCuelist: (name, number) => transaction(t('pro.programmer.undo.newSequence'), () => createCuelistInner(name, number)),
    storeCue: (cuelistId, cueNumber, opts: StoreOptions): StoreCueResult | null => {
      const values = programmerValues(true)
      if (values.length === 0 && opts.mode !== 'block') return null
      if (cueNumber !== null && !(Number.isFinite(cueNumber) && cueNumber > 0)) return null
      const target = cuelistId ?? getSelectedCuelist()
      const existingList = target ? usePlaybackStore.getState().cuelists.find(c => c.id === target) : undefined
      if (cuelistId && !existingList) return null
      const number = cueNumber ?? (existingList ? nextCueNumber(existingList) : 1)
      return transaction(t('pro.programmer.undo.storeCue', { cue: number }), () => {
        let listId = existingList?.id
        if (!listId) {
          listId = createCuelistInner()
          usePlaybackStore.getState().selectCuelist(listId)
        }
        let list = usePlaybackStore.getState().cuelists.find(c => c.id === listId)!
        let index = list.cues.findIndex(c => c.number === number)
        const existed = index >= 0
        if (!existed) ({ cuelist: list, index } = insertCue(list, newCue(number)))
        list = storeIntoCue(list, index, values, opts, makeKeyMeta())
        replaceCuelist(list)
        return { cuelistId: list.id, cueId: list.cues[index].id, existed }
      })
    },
    updateCuesFromProgrammer: (opts = {}) => {
      const values = programmerValues(true)
      if (values.length === 0) return 0
      const pb = usePlaybackStore.getState()
      const activeCues = pb.cuelists
        .filter(c => c.isPlaying && c.currentCueIndex >= 0)
        .map(c => ({ cuelistId: c.id, cueIndex: c.currentCueIndex }))
      if (activeCues.length === 0) return 0
      return transaction(t('pro.programmer.undo.updateCues'), () => {
        const res = updateCueValues(usePlaybackStore.getState().cuelists, activeCues, values, opts, makeKeyMeta())
        if (res.cues > 0) usePlaybackStore.setState({ cuelists: res.cuelists })
        return res.cues
      })
    },
    deleteCue: (cuelistId, cueId) => {
      const cue = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)?.cues.find(q => q.id === cueId)
      if (!cue) return
      transaction(t('pro.programmer.undo.deleteCue', { cue: cue.number }), () => usePlaybackStore.getState().removeCue(cuelistId, cueId))
    },
    updateCue: (cuelistId, cueId, updates) => {
      const cue = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)?.cues.find(q => q.id === cueId)
      if (!cue) return
      const clean: Partial<Cue> = {}
      if (typeof updates.name === 'string') clean.name = updates.name
      if (typeof updates.color === 'string') clean.color = updates.color
      for (const k of ['fadeIn', 'fadeOut', 'delay'] as const) {
        const v = updates[k]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[k] = v
      }
      if (updates.followTime === null) clean.followTime = null
      else if (typeof updates.followTime === 'number' && Number.isFinite(updates.followTime) && updates.followTime >= 0) clean.followTime = updates.followTime
      if (Object.keys(clean).length === 0) return
      transaction(t('pro.programmer.undo.editCue', { cue: cue.number }), () => usePlaybackStore.getState().updateCue(cuelistId, cueId, clean))
    },
    copyCue: (cuelistId, cueId, toNumber, toCuelistId) => {
      const pb = usePlaybackStore.getState()
      const cue = pb.cuelists.find(c => c.id === cuelistId)?.cues.find(q => q.id === cueId)
      const dest = pb.cuelists.find(c => c.id === (toCuelistId ?? cuelistId))
      if (!cue || !dest || !(Number.isFinite(toNumber) && toNumber > 0) || dest.cues.some(c => c.number === toNumber)) return null
      return transaction(t('pro.programmer.undo.copyCue', { cue: cue.number }), () => {
        const copy: Cue = { ...structuredClone(cue), id: uuidv4(), number: toNumber }
        const list = usePlaybackStore.getState().cuelists.find(c => c.id === dest.id)!
        replaceCuelist(insertCue(list, copy).cuelist)
        return copy.id
      })
    },
    moveCue: (cuelistId, cueId, toNumber) => {
      const cl = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)
      const cue = cl?.cues.find(q => q.id === cueId)
      if (!cl || !cue || !(Number.isFinite(toNumber) && toNumber > 0) || cl.cues.some(c => c.id !== cueId && c.number === toNumber)) return false
      if (cue.number === toNumber) return true
      return transaction(t('pro.programmer.undo.moveCue', { cue: cue.number }), () => {
        const list = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)!
        const playingId = list.currentCueIndex >= 0 ? list.cues[list.currentCueIndex]?.id : undefined
        const without: Cuelist = { ...list, cues: list.cues.filter(c => c.id !== cueId), currentCueIndex: -1 }
        const moved = insertCue(without, { ...cue, number: toNumber }).cuelist
        const currentCueIndex = playingId ? moved.cues.findIndex(c => c.id === playingId) : list.currentCueIndex
        replaceCuelist({ ...moved, currentCueIndex })
        return true
      })
    },
    deleteCuelist: (id) => {
      const cl = usePlaybackStore.getState().cuelists.find(c => c.id === id)
      if (!cl) return
      transaction(t('pro.programmer.undo.deleteSequence', { name: cl.name }), () => usePlaybackStore.getState().removeCuelist(id))
    },
    renameCuelist: (id, name) => {
      const cl = usePlaybackStore.getState().cuelists.find(c => c.id === id)
      if (!cl || !name.trim() || cl.name === name.trim()) return
      transaction(t('pro.programmer.undo.renameSequence'), () => usePlaybackStore.getState().renameCuelist(id, name.trim()))
    },
    go: (id) => usePlaybackStore.getState().goCuelist(id),
    goBack: (id) => usePlaybackStore.getState().goBackCuelist(id),
    goto: (cuelistId, cueNumber) => {
      const cl = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)
      const index = cl ? cl.cues.findIndex(c => c.number === cueNumber) : -1
      if (index < 0) return false
      usePlaybackStore.getState().goToCue(cuelistId, index)
      return true
    },
    off: (id) => usePlaybackStore.getState().stopCuelist(id),
    pause: () => { /* pause / resume of fades: P3 (cue engine) */ },
    releaseAll: () => usePlaybackStore.getState().releaseAll(),

    // ---------------------------------------------------------------- executors
    getCurrentExecutorPage: () => useExecutorStore.getState().currentPage,
    setExecutorPage: (page) => useExecutorStore.getState().setPage(page),
    executorPress: (ref, phase, opts) => executorPress(ref, phase, opts),
    columnFader: (page, col, level) => columnFader(page, col, level),
    assignExecutor: (ref: ExecutorRef, target, opts = {}) => {
      if (!(ref.col >= 0 && ref.col < 8 && ref.row >= 0 && ref.row < 4 && ref.page >= 0)) return
      transaction(t('pro.programmer.undo.assignExecutor', { page: ref.page + 1, slot: ref.col * 4 + ref.row + 1 }), () => {
        while (useExecutorStore.getState().pages.length <= ref.page) {
          if (useExecutorStore.getState().addPage() < 0) return
        }
        const ex = useExecutorStore.getState()
        const existing = executorCellAt(ref)
        if (target) {
          const button = opts.button ?? existing?.button
          ex.assignCell(ref.page, ref.col, ref.row, { kind: target.kind, id: target.id, mode: existing?.mode ?? 'toggle', ...(button ? { button } : {}) })
        } else {
          ex.assignCell(ref.page, ref.col, ref.row, null)
        }
        if (opts.fader) useExecutorStore.getState().setColumnFader(ref.page, ref.col, opts.fader)
      })
    },
    getSelectedExecutor: () => selectedExecutor(),
    selectExecutor: (ref) => selectExecutor(ref),

    // ---------------------------------------------------------------- macros
    runMacro: (id) => { cliRunMacro(id) },
    stopMacro: (id) => cliStopMacro(id),
    storeMacro: (number, lines, name) => transaction(t('pro.programmer.undo.storeMacro', { n: number }), () => {
      const pool = usePoolStore.getState()
      const existing = findMacro(number)
      if (existing) {
        pool.updateMacro(existing.id, { lines: lines.map(l => ({ ...l })), ...(name !== undefined ? { name } : {}) })
        return existing.id
      }
      return pool.addMacro({ number, lines, name })
    }),
    updateMacro: (id, updates) => {
      const m = usePoolStore.getState().macros.find(x => x.id === id)
      if (!m) return
      transaction(t('pro.programmer.undo.editMacro', { n: m.number }), () => usePoolStore.getState().updateMacro(id, updates))
    },
    deleteMacro: (id) => {
      const m = usePoolStore.getState().macros.find(x => x.id === id)
      if (!m) return
      transaction(t('pro.programmer.undo.deleteMacro', { n: m.number }), () => usePoolStore.getState().removeMacro(id))
    },

    // ---------------------------------------------------------------- groups
    storeGroup: (number, fixtureIds, opts = {}) => {
      if (!validNumber(number)) return ''
      const known = new Set(usePatchStore.getState().patch.map(p => p.id))
      const ids = fixtureIds.filter(id => known.has(id))
      const mode = opts.mode ?? 'overwrite'
      return transaction(t('pro.programmer.undo.storeGroup', { n: number }), () => {
        const existing = usePatchStore.getState().groups.find(g => g.number === number)
        if (!existing) {
          if (mode === 'remove') return ''
          const id = uuidv4()
          const color = SWATCH_COLORS[(number - 1) % SWATCH_COLORS.length]
          usePatchStore.setState((s) => ({
            groups: [...s.groups, { id, name: opts.name?.trim() || t('pro.programmer.defaults.group', { n: number }), color, fixtureIds: [], number }]
          }))
          setGroupFixtures(id, ids)
          return id
        }
        const next = mode === 'merge'
          ? [...existing.fixtureIds, ...ids]
          : mode === 'remove'
            ? existing.fixtureIds.filter(id => !ids.includes(id))
            : ids
        setGroupFixtures(existing.id, next)
        if (opts.name?.trim()) usePatchStore.getState().updateGroup(existing.id, { name: opts.name.trim() })
        return existing.id
      })
    },
    deleteGroup: (id) => {
      const g = usePatchStore.getState().groups.find(x => x.id === id)
      if (!g) return
      transaction(t('pro.programmer.undo.deleteGroup', { name: g.name }), () => usePatchStore.getState().removeGroup(id))
    },
    renameGroup: (id, name) => {
      const g = usePatchStore.getState().groups.find(x => x.id === id)
      if (!g || !name.trim() || g.name === name.trim()) return
      transaction(t('pro.programmer.undo.renameGroup'), () => usePatchStore.getState().updateGroup(id, { name: name.trim() }))
    },
    setGroupMaster: (id, level) => usePoolStore.getState().setGroupMaster(id, level),

    // ---------------------------------------------------------------- objects
    toggleChase: (id, on) => usePlaybackStore.getState().toggleChase(id, on),
    setEffectRunning: (id, on) => useEffectsStore.getState().setEffectRunning(id, on),
    setSpeedMasterBpm: (id, bpm) => usePoolStore.getState().setSpeedMasterBpm(id, bpm),
    tapSpeedMaster: (id) => { tapSpeedMaster(id) },

    // ---------------------------------------------------------------- park / highlight / blind / masters
    park: (values) => {
      if (values.length === 0) return
      transaction(t('pro.programmer.undo.park'), () => enginePark(values))
    },
    unpark: (fixtureIds) => {
      if (usePoolStore.getState().parked.length === 0) return
      transaction(t('pro.programmer.undo.unpark'), () => engineUnpark(fixtureIds))
    },
    isHighlight: () => useProStore.getState().highlight,
    setHighlight: (on) => {
      if (on) useProStore.getState().setHighlight(true)
      else engineSetHighlight(null)
    },
    isBlind: () => useProStore.getState().blind,
    setBlind: (on) => useProStore.getState().setBlind(on),
    setBlackout: (on) => {
      const dmx = useDmxStore.getState()
      if (on === undefined) dmx.toggleBlackout()
      else dmx.setBlackout(on)
    },
    setGrandMaster: (level) => useDmxStore.getState().setGrandMaster(clampByte(level)),

    // ---------------------------------------------------------------- undo & UI
    transaction,
    undo: () => historyUndo({ toast: false })?.label ?? null,
    redo: () => historyRedo({ toast: false })?.label ?? null,
    ask: async (question, choices, fallback) => {
      if (options.interactive === false) return fallback ?? null
      try {
        return await (options.ask ?? dialogAsk)(question, choices)
      } catch (e) {
        console.warn('[ProApi] ask failed:', e)
        return fallback ?? null
      }
    },
    featureOf,

    // ---------------------------------------------------------------- extras
    getOutputValues: (fixtureIds) => outputValuesOf(fixtureIds)
  }
  return api
}

let shared: (ProApi & ProApiExtras) | null = null

/** The app's ProApi (created on first use) */
export function getProApi(): ProApi & ProApiExtras {
  if (!shared) shared = createProApi()
  return shared
}
