// ============================================================
// Pools — actions (store changes, one undo step each).
// The command line's ProApi offers the same operations; when the
// integrator's lib/pro/api.ts exists these can delegate to it. For now
// they call the pro modules / stores directly (same semantics):
//   presets  lib/pro/store-ops storePreset + pool-store CRUD,
//            lib/pro/programmer-engine applyPreset
//   groups   patch-store groups (+ numbers)
//   macros   pool-store + lib/cli runMacro / stopMacro
//   speed    pool-store + lib/pro/speed-masters tap
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { CueChannelValue, ExecutorTargetKind, Group, Preset, PresetScope, PresetType } from '@shared/types'
import { MAX_OBJECT_NUMBER, nextObjectNumber } from '@shared/show-format'
import { t } from '@renderer/i18n'
import { historyStep } from '@renderer/lib/history'
import { deleteWithUndo } from '@renderer/lib/selection-actions'
import { recordFromProgrammer, refreshProgrammerState } from '@renderer/lib/programmer-utils'
import { applyPreset, setAttributeValues } from '@renderer/lib/pro/programmer-engine'
import { applyMatricks } from '@renderer/lib/pro/selection-tools'
import { storePreset } from '@renderer/lib/pro/store-ops'
import { tapSpeedMaster } from '@renderer/lib/pro/speed-masters'
import { runMacro as cliRunMacro, stopMacro as cliStopMacro, isMacroRunning } from '@renderer/lib/cli'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { ensureObjectNumbers, findPreset, usePoolStore } from '@renderer/stores/pool-store'
import { useSelectionStore } from '@renderer/stores/selection-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { toast, SWATCH_COLORS } from '@renderer/components/ui'
import { refreshPresetMeta } from '@renderer/components/fixtures/preset-meta'
import {
  channelLookup, emptiedPreset, numbersOf, presetRef, storeGroupFixtures, valuesForFamily, valuesHeldByPreset, valuesOfFixtures
} from './pool-model'

// ---------------------------------------------------------------- selection

/** Fixtures values apply to: the selection after MAtricks / Next-Prev step, in order */
export function activeSelection(): string[] {
  const ids = usePatchStore.getState().selectedFixtureIds
  const { matricks, step } = useSelectionStore.getState()
  return applyMatricks(ids, matricks, step).active
}

function family(type: PresetType): string {
  return t(`pro.pools.families.${type}`)
}

// ---------------------------------------------------------------- presets

export function presetLabel(p: Preset): string {
  const ref = presetRef(p)
  return p.name ? t('pro.pools.sel.preset', { ref, name: p.name }) : t('pro.pools.sel.presetNoName', { ref })
}

/** Programmer values of a family (optionally only these fixtures) */
export function programmerValuesFor(type: PresetType, fixtureIds: readonly string[] | null): CueChannelValue[] {
  const { patch, fixtures } = usePatchStore.getState()
  return valuesForFamily(valuesOfFixtures(recordFromProgrammer(), fixtureIds), type, channelLookup(patch, fixtures))
}

/** Tap a preset tile: apply it to the active selection */
export function applyPresetToSelection(id: string): boolean {
  const ids = activeSelection()
  if (ids.length === 0) {
    toast.info(t('pro.pools.toast.selectFirst'), { description: t('pro.pools.toast.selectFirstHint') })
    return false
  }
  const n = applyPreset(id, ids)
  refreshProgrammerState()
  refreshPresetMeta()
  if (n === 0) {
    const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
    toast.info(t('pro.pools.toast.presetNothing', { what: p ? presetLabel(p) : '' }))
  }
  return n > 0
}

/**
 * Store the programmer into preset `type`.`number` (created when empty).
 * Values: the family's programmer values (of the active selection when
 * there is one). Returns the preset id, or null when nothing was stored.
 */
export function storePresetAt(type: PresetType, number: number, opts: { scope?: PresetScope; mode?: 'merge' | 'overwrite'; name?: string } = {}): string | null {
  const selection = activeSelection()
  const values = programmerValuesFor(type, selection.length > 0 ? selection : null)
  if (values.length === 0) {
    toast.warning(t('pro.pools.toast.nothingToStore'), { description: t('pro.pools.toast.nothingToStoreHint', { family: family(type) }) })
    return null
  }
  const { patch } = usePatchStore.getState()
  let id: string | null = null
  historyStep(t('pro.pools.undo.storePreset', { ref: `${presetRef({ type, number })}` }), () => {
    ensureObjectNumbers()
    const existing = findPreset(type, number) ?? null
    const base = existing && opts.mode === 'overwrite' ? emptiedPreset(existing) : existing
    const stored = storePreset(base, type, values.map(({ fixtureId, channelName, value }) => ({ fixtureId, channelName, value })), opts.scope ?? existing?.scope ?? 'selective', patch)
    const pool = usePoolStore.getState()
    if (existing) {
      const { id: _id, ...updates } = stored
      pool.updatePreset(existing.id, updates)
      id = existing.id
    } else {
      const { id: _id, ...input } = stored
      id = pool.addPreset({ ...input, number, name: opts.name ?? '' })
    }
  })
  if (!id) return null
  // The programmer values now come from that preset ("P4.2")
  setAttributeValues(values.map((v) => ({ fixtureId: v.fixtureId, channelName: v.channelName, value: v.value, meta: { presetId: id! } })), { fade: 0, delay: 0 })
  refreshProgrammerState()
  refreshPresetMeta()
  const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
  if (p) toast.success(t('pro.pools.toast.stored', { what: presetLabel(p) }))
  return id
}

/** Update a preset with the programmer values of channels it already holds */
export function updatePresetFromProgrammer(id: string): boolean {
  const preset = usePlaybackStore.getState().presets.find((p) => p.id === id)
  if (!preset) return false
  const { patch } = usePatchStore.getState()
  const values = valuesHeldByPreset(preset, recordFromProgrammer(), patch)
  if (values.length === 0) {
    toast.info(t('pro.pools.toast.nothingToUpdate'), { description: t('pro.pools.toast.nothingToUpdateHint') })
    return false
  }
  historyStep(t('pro.pools.undo.updatePreset', { ref: presetRef(preset) }), () => {
    const stored = storePreset(preset, preset.type, values, preset.scope ?? 'selective', patch)
    const { id: _id, ...updates } = stored
    usePoolStore.getState().updatePreset(id, updates)
  })
  toast.success(t('pro.pools.toast.updated', { what: presetLabel(preset) }))
  return true
}

export function renamePreset(id: string, name: string): void {
  const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
  if (!p || p.name === name) return
  historyStep(t('pro.pools.undo.label', { what: presetLabel(p) }), () => usePoolStore.getState().updatePreset(id, { name }))
}

export function recolourPreset(id: string, color: string | undefined): void {
  const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
  if (!p) return
  historyStep(t('pro.pools.undo.colour', { what: presetLabel(p) }), () => {
    if (color) usePoolStore.getState().updatePreset(id, { color })
    else usePlaybackStore.setState({ presets: usePlaybackStore.getState().presets.map((x) => (x.id === id ? (({ color: _c, ...rest }) => rest)(x) : x)) })
  })
}

export function renumberPreset(id: string, number: number): boolean {
  const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
  if (!p) return false
  let ok = false
  historyStep(t('pro.pools.undo.renumber', { what: presetLabel(p) }), () => {
    ensureObjectNumbers()
    ok = usePoolStore.getState().renumberPreset(id, number)
  })
  return ok
}

/** Copy a preset to the next free number of its family (Mod+D) */
export function duplicatePreset(id: string): string | null {
  const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
  if (!p) return null
  ensureObjectNumbers()
  const { id: _id, number: _n, ...rest } = p
  return usePoolStore.getState().addPreset({ ...rest, values: structuredClone(p.values) })
}

export function deletePreset(id: string): Promise<boolean> {
  const p = usePlaybackStore.getState().presets.find((x) => x.id === id)
  if (!p) return Promise.resolve(false)
  return deleteWithUndo({ label: presetLabel(p), run: () => usePoolStore.getState().removePreset(id) })
}

// ---------------------------------------------------------------- groups

export function groupNumbers(groups: readonly Group[]): Map<string, number> {
  return numbersOf(groups)
}

export function groupLabel(g: Group, number?: number): string {
  const n = number ?? groupNumbers(usePatchStore.getState().groups).get(g.id) ?? 0
  return t('pro.pools.sel.group', { n, name: g.name })
}

function setGroups(update: (groups: Group[]) => Group[]): void {
  const { groups, patch } = usePatchStore.getState()
  const next = update(groups)
  // patch entries mirror group membership (groupIds)
  const member = new Map<string, Set<string>>()
  for (const g of next) for (const f of g.fixtureIds) (member.get(f) ?? member.set(f, new Set()).get(f)!).add(g.id)
  const groupIds = new Set(next.map((g) => g.id))
  const nextPatch = patch.map((p) => {
    const keep = p.groupIds.filter((gid) => !groupIds.has(gid) || member.get(p.id)?.has(gid))
    const add = [...(member.get(p.id) ?? [])].filter((gid) => !keep.includes(gid))
    if (add.length === 0 && keep.length === p.groupIds.length) return p
    return { ...p, groupIds: [...keep, ...add] }
  })
  usePatchStore.setState({ groups: next, patch: nextPatch })
}

/** Tap a group tile: select its fixtures (in the group's order) */
export function selectGroup(id: string): void {
  const g = usePatchStore.getState().groups.find((x) => x.id === id)
  if (!g) return
  if (g.fixtureIds.length === 0) {
    toast.info(t('pro.pools.toast.groupEmpty'))
    return
  }
  usePatchStore.getState().selectFixtures(g.fixtureIds)
  useSelectionStore.getState().setStep(null)
}

/** Store the fixture selection as group `number` (created when empty) */
export function storeGroupAt(number: number, mode: 'merge' | 'overwrite' = 'overwrite', name?: string): string | null {
  const selection = usePatchStore.getState().selectedFixtureIds
  if (selection.length === 0) {
    toast.warning(t('pro.pools.toast.selectFirst'), { description: t('pro.pools.toast.storeGroupHint') })
    return null
  }
  let id: string | null = null
  historyStep(t('pro.pools.undo.storeGroup', { n: number }), () => {
    ensureObjectNumbers()
    const { groups } = usePatchStore.getState()
    const existing = groups.find((g) => g.number === number)
    if (existing) {
      id = existing.id
      setGroups((list) => list.map((g) => (g.id === existing.id ? { ...g, fixtureIds: storeGroupFixtures(g.fixtureIds, selection, mode) } : g)))
    } else {
      const newId = uuidv4()
      id = newId
      const color = SWATCH_COLORS[(number - 1) % SWATCH_COLORS.length]
      setGroups((list) => [...list, { id: newId, name: name || t('pro.pools.defaults.group', { n: number }), color, fixtureIds: [...new Set(selection)], number }])
    }
  })
  const g = usePatchStore.getState().groups.find((x) => x.id === id)
  if (g) toast.success(t('pro.pools.toast.stored', { what: groupLabel(g, number) }))
  return id
}

export function renameGroup(id: string, name: string): void {
  const g = usePatchStore.getState().groups.find((x) => x.id === id)
  if (!g || g.name === name) return
  historyStep(t('pro.pools.undo.label', { what: groupLabel(g) }), () => usePatchStore.getState().updateGroup(id, { name }))
}

export function recolourGroup(id: string, color: string): void {
  const g = usePatchStore.getState().groups.find((x) => x.id === id)
  if (!g) return
  historyStep(t('pro.pools.undo.colour', { what: groupLabel(g) }), () => usePatchStore.getState().updateGroup(id, { color }))
}

/** Give a group another number (swaps with the group holding it) */
export function renumberGroup(id: string, number: number): boolean {
  if (!Number.isInteger(number) || number < 1 || number > MAX_OBJECT_NUMBER) return false
  const g = usePatchStore.getState().groups.find((x) => x.id === id)
  if (!g) return false
  historyStep(t('pro.pools.undo.renumber', { what: groupLabel(g) }), () => {
    ensureObjectNumbers()
    const groups = usePatchStore.getState().groups
    const me = groups.find((x) => x.id === id)!
    if (me.number === number) return
    const holder = groups.find((x) => x.id !== id && x.number === number)
    const old = me.number ?? nextObjectNumber(groups.map((x) => x.number))
    setGroups((list) => list.map((x) => (x.id === id ? { ...x, number } : holder && x.id === holder.id ? { ...x, number: old } : x)))
  })
  return true
}

export function deleteGroup(id: string): Promise<boolean> {
  const g = usePatchStore.getState().groups.find((x) => x.id === id)
  if (!g) return Promise.resolve(false)
  return deleteWithUndo({ label: groupLabel(g), run: () => usePatchStore.getState().removeGroup(id) })
}

// ---------------------------------------------------------------- macros

export function macroLabel(id: string): string {
  const m = usePoolStore.getState().macros.find((x) => x.id === id)
  return m ? t('pro.pools.sel.macro', { n: m.number, name: m.name || t('pro.pools.defaults.macro', { n: m.number }) }) : ''
}

/** New empty macro at `number`; returns its id */
export function newMacroAt(number: number): string {
  let id = ''
  historyStep(t('pro.pools.undo.newMacro', { n: number }), () => {
    id = usePoolStore.getState().addMacro({ number, name: '', lines: [] })
  })
  return id
}

export function runMacro(id: string): boolean {
  const m = usePoolStore.getState().macros.find((x) => x.id === id)
  if (!m) return false
  if (m.lines.every((l) => l.command.trim() === '')) {
    toast.info(t('pro.pools.toast.macroEmpty'))
    return false
  }
  return cliRunMacro(id)
}

export function stopMacro(id: string): void {
  cliStopMacro(id)
}

export { isMacroRunning }

export function updateMacro(id: string, updates: { name?: string; lines?: { command: string; wait?: number }[]; color?: string }): void {
  if (!usePoolStore.getState().macros.some((m) => m.id === id)) return
  historyStep(t('pro.pools.undo.editMacro', { what: macroLabel(id) }), () => usePoolStore.getState().updateMacro(id, updates))
}

export function recolourMacro(id: string, color: string | undefined): void {
  const m = usePoolStore.getState().macros.find((x) => x.id === id)
  if (!m) return
  historyStep(t('pro.pools.undo.colour', { what: macroLabel(id) }), () => {
    if (color) usePoolStore.getState().updateMacro(id, { color })
    else usePoolStore.setState({ macros: usePoolStore.getState().macros.map((x) => (x.id === id ? (({ color: _c, ...rest }) => rest)(x) : x)) })
  })
}

export function renumberMacro(id: string, number: number): boolean {
  let ok = false
  historyStep(t('pro.pools.undo.renumber', { what: macroLabel(id) }), () => { ok = usePoolStore.getState().renumberMacro(id, number) })
  return ok
}

export function duplicateMacro(id: string): string | null {
  const m = usePoolStore.getState().macros.find((x) => x.id === id)
  if (!m) return null
  const { id: _id, number: _n, ...rest } = m
  return usePoolStore.getState().addMacro({ ...rest, lines: m.lines.map((l) => ({ ...l })) })
}

export function deleteMacro(id: string): Promise<boolean> {
  if (!usePoolStore.getState().macros.some((m) => m.id === id)) return Promise.resolve(false)
  stopMacro(id)
  return deleteWithUndo({ label: macroLabel(id), run: () => usePoolStore.getState().removeMacro(id) })
}

// ---------------------------------------------------------------- speed masters

export function speedLabel(id: string): string {
  const m = usePoolStore.getState().speedMasters.find((x) => x.id === id)
  return m ? t('pro.pools.sel.speed', { n: m.number, name: m.name || t('pro.pools.defaults.speed', { n: m.number }) }) : ''
}

export function newSpeedMasterAt(number: number): string {
  let id = ''
  historyStep(t('pro.pools.undo.newSpeed', { n: number }), () => {
    id = usePoolStore.getState().addSpeedMaster({ number, name: '', bpm: 120 })
  })
  return id
}

export function tapSpeed(id: string): number | null {
  return tapSpeedMaster(id)
}

export function setSpeedBpm(id: string, bpm: number): void {
  usePoolStore.getState().setSpeedMasterBpm(id, bpm)
}

export function renameSpeedMaster(id: string, name: string): void {
  historyStep(t('pro.pools.undo.label', { what: speedLabel(id) }), () => usePoolStore.getState().updateSpeedMaster(id, { name }))
}

export function renumberSpeedMaster(id: string, number: number): boolean {
  if (!Number.isInteger(number) || number < 1 || number > MAX_OBJECT_NUMBER) return false
  const list = usePoolStore.getState().speedMasters
  const me = list.find((m) => m.id === id)
  if (!me || me.number === number) return false
  const holder = list.find((m) => m.id !== id && m.number === number)
  historyStep(t('pro.pools.undo.renumber', { what: speedLabel(id) }), () => {
    usePoolStore.getState().updateSpeedMaster(id, { number })
    if (holder) usePoolStore.getState().updateSpeedMaster(holder.id, { number: me.number })
  })
  return true
}

/** Make a chase / effect / scene follow (or stop following) a speed master */
export function linkToSpeedMaster(kind: 'chase' | 'effect' | 'cuelist', objectId: string, speedMasterId: string | undefined): void {
  historyStep(t('pro.pools.undo.link', { what: speedMasterId ? speedLabel(speedMasterId) : '' }), () => {
    if (kind === 'chase') {
      const pb = usePlaybackStore.getState()
      usePlaybackStore.setState({ chases: pb.chases.map((c) => (c.id === objectId ? withSpeed(c, speedMasterId) : c)) })
    } else if (kind === 'cuelist') {
      const pb = usePlaybackStore.getState()
      usePlaybackStore.setState({ cuelists: pb.cuelists.map((c) => (c.id === objectId ? withSpeed(c, speedMasterId) : c)) })
    } else {
      const fx = useEffectsStore.getState()
      useEffectsStore.setState({ effects: fx.effects.map((e) => (e.id === objectId ? withSpeed(e, speedMasterId) : e)) })
    }
  })
}

function withSpeed<T extends { speedMasterId?: string }>(obj: T, id: string | undefined): T {
  if (id) return { ...obj, speedMasterId: id }
  const { speedMasterId: _s, ...rest } = obj
  return rest as T
}

export function deleteSpeedMaster(id: string): Promise<boolean> {
  if (!usePoolStore.getState().speedMasters.some((m) => m.id === id)) return Promise.resolve(false)
  return deleteWithUndo({ label: speedLabel(id), run: () => usePoolStore.getState().removeSpeedMaster(id) })
}

// ---------------------------------------------------------------- executors

/** Put a pool object in an executor cell (page 0-based) */
export function assignToExecutor(kind: ExecutorTargetKind, id: string, page: number, col: number, row: number): void {
  const label = kind === 'macro' ? macroLabel(id) : kind === 'speed' ? speedLabel(id) : ''
  historyStep(t('pro.pools.undo.assign', { what: label }), () => {
    useExecutorStore.getState().assignCell(page, col, row, { kind, id, mode: kind === 'macro' ? 'trigger' : 'toggle' })
  })
  toast.success(t('pro.pools.assign.done', { page: page + 1, slot: col * 4 + row + 1 }))
}
