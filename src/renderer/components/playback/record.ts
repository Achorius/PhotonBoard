// ============================================================
// Recording helpers for the Scenes view: capture the programmer
// (or, when it is empty, the live output of the fixtures) and
// write it into scenes, cues, chases and chase steps.
// Everything reads stores with getState() at call time — nothing
// here subscribes.
//
// Remote (browser): the programmer lives on the console. capture()
// reports the console's programmer (snapshot summary), and the record
// actions ask the console to record with its OWN programmer ('record'
// command, executed by performRecord below); the remote shows the new
// scene / cue at once and gets the real values from the console.
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { CueChannelValue, Effect } from '@shared/types'
import type { RecordCommandPayload } from '@shared/remote-commands'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { recordFromProgrammer } from '@renderer/lib/programmer-utils'
// The pro programmer engine (fades, preset refs) registers its overlay with
// programmer-utils when it loads: recording sees target values and meta.
import '@renderer/lib/pro/programmer-engine'
import { clearProgrammer } from '@renderer/lib/dmx-mixer'
import { cueKey } from '@renderer/lib/fixture-index'
import { isRemoteMode, sendRemoteCommand } from '@renderer/lib/runtime'
import { summaryCounts, useConsoleProgrammer } from '@renderer/lib/console-programmer'
import { runAsConsoleContent } from '@renderer/lib/content-sync'
import { t } from '@renderer/i18n'

export interface Capture {
  values: CueChannelValue[]
  /** programmer = touched channels only · output = live output of the fixtures (programmer empty) */
  source: 'programmer' | 'output'
  fixtureCount: number
  channelCount: number
  /** Running effects (snapshotted into new scenes) */
  effects: Effect[]
  /** The capture is limited to the selected fixtures */
  selectedOnly: boolean
  /** The fixtures it is limited to (selectedOnly) */
  fixtureIds?: string[]
}

export function countFixtures(values: CueChannelValue[]): number {
  return new Set(values.map((v) => v.fixtureId)).size
}

/** "4 fixtures · 28 channels" (toast descriptions) */
export function captureSummary(cap: Pick<Capture, 'fixtureCount' | 'channelCount'>): string {
  return t('scenes.toast.captureSummary', {
    fixtures: t('common.fixtureCount', { count: cap.fixtureCount }),
    channels: t('common.channelCount', { count: cap.channelCount })
  })
}

/** Live output (non-zero channels) of the fixtures, from the published pre-master mix */
function captureOutput(limit: Set<string> | null): CueChannelValue[] {
  const { patch, getFixtureChannels } = usePatchStore.getState()
  const dmx = useDmxStore.getState().values
  const values: CueChannelValue[] = []
  for (const entry of patch) {
    if (limit && !limit.has(entry.id)) continue
    for (const ch of getFixtureChannels(entry)) {
      const v = dmx[entry.universe]?.[ch.absoluteChannel] ?? 0
      if (v > 0) values.push({ fixtureId: entry.id, channelName: ch.name, value: v })
    }
  }
  return values
}

/**
 * What a record would store right now.
 * `selectedOnly`: limit to the selected fixtures (ignored without a selection).
 * `fixtureIds`: explicit limit (a remote's selection, recorded on the console).
 */
export function capture(selectedOnly: boolean, fixtureIds?: string[]): Capture {
  const { selectedFixtureIds } = usePatchStore.getState()
  const limitIds = fixtureIds ?? (selectedOnly && selectedFixtureIds.length > 0 ? selectedFixtureIds : null)
  const limit = limitIds && limitIds.length > 0 ? new Set(limitIds) : null
  const meta = { selectedOnly: !!limit, ...(limit ? { fixtureIds: Array.from(limit) } : {}) }
  const effects = useEffectsStore.getState().effects.filter((e) => e.isRunning).map((e) => ({ ...e, fixtureIds: [...e.fixtureIds] }))

  if (isRemoteMode()) {
    // The console records with ITS programmer: show what it holds (values follow from the console)
    const counts = summaryCounts(useConsoleProgrammer.getState(), limit)
    if (counts.channelCount > 0) return { values: [], source: 'programmer', ...counts, effects, ...meta }
  } else {
    // withMeta: preset references and per-value programmer timing go into the cue
    const programmer = recordFromProgrammer({ withMeta: true })
    if (programmer.length > 0) {
      const values = limit ? programmer.filter((v) => limit.has(v.fixtureId)) : programmer
      return { values, source: 'programmer', fixtureCount: countFixtures(values), channelCount: values.length, effects, ...meta }
    }
  }

  // Programmer empty: the live output (non-zero channels) of the selected / all fixtures
  const values = captureOutput(limit)
  return { values, source: 'output', fixtureCount: countFixtures(values), channelCount: values.length, effects, ...meta }
}

/** Remote: ask the console to record (with its own programmer / output) */
function sendRecord(cap: Capture, payload: Omit<RecordCommandPayload, 'fixtureIds'>): void {
  sendRemoteCommand('record', { ...payload, ...(cap.fixtureIds ? { fixtureIds: cap.fixtureIds } : {}) } satisfies RecordCommandPayload)
}

/** `overlay` wins on the channels both contain; the others are kept */
export function mergeValues(base: CueChannelValue[], overlay: CueChannelValue[]): CueChannelValue[] {
  const map = new Map<string, CueChannelValue>()
  for (const v of base) map.set(cueKey(v.fixtureId, v.channelName), v)
  for (const v of overlay) map.set(cueKey(v.fixtureId, v.channelName), { ...v })
  return Array.from(map.values())
}

/** Default names are show data: written in the operator's language when created */
function nextSceneName(): string {
  const names = new Set(usePlaybackStore.getState().cuelists.map((c) => c.name))
  let n = usePlaybackStore.getState().cuelists.length + 1
  while (names.has(t('scenes.defaults.sceneName', { n }))) n++
  return t('scenes.defaults.sceneName', { n })
}

function nextChaseName(): string {
  const names = new Set(usePlaybackStore.getState().chases.map((c) => c.name))
  let n = usePlaybackStore.getState().chases.length + 1
  while (names.has(t('scenes.defaults.chaseName', { n }))) n++
  return t('scenes.defaults.chaseName', { n })
}

/** Empty scene (no cue yet); selected */
export function createEmptyScene(): string {
  const pb = usePlaybackStore.getState()
  const id = pb.addCuelist(nextSceneName())
  pb.selectCuelist(id)
  return id
}

/** Empty chase (no step yet); selected */
export function createEmptyChase(): string {
  const pb = usePlaybackStore.getState()
  const id = pb.addChase(nextChaseName())
  pb.selectChase(id)
  return id
}

interface RecordIds {
  /** Scene / chase id (new ones get it) */
  id?: string
  /** New cue / step id */
  itemId?: string
  /** Select the result in the Scenes view (local UI only) */
  select?: boolean
}

function newSceneLocal(cap: Capture, opts: { name?: string; includeEffects: boolean }, ids: Required<Pick<RecordIds, 'id' | 'itemId'>>, select: boolean): void {
  const pb = usePlaybackStore.getState()
  pb.addCuelist(opts.name?.trim() || nextSceneName(), ids.id)
  pb.addCue(ids.id, t('scenes.defaults.cueName', { n: 1 }), cap.values, undefined, undefined, ids.itemId)
  if (opts.includeEffects && cap.effects.length > 0) pb.updateCuelist(ids.id, { effectSnapshots: cap.effects })
  if (select) pb.selectCuelist(ids.id)
}

export function recordNewScene(cap: Capture, opts: { name?: string; includeEffects: boolean }, ids: RecordIds = {}): string {
  const id = ids.id ?? uuidv4()
  const itemId = ids.itemId ?? uuidv4()
  if (isRemoteMode()) {
    // Shown at once; the console's recording (its values) replaces it right after
    const name = opts.name?.trim() || nextSceneName()
    runAsConsoleContent(['cuelists'], () => newSceneLocal(cap, { ...opts, name }, { id, itemId }, false))
    usePlaybackStore.getState().selectCuelist(id)
    sendRecord(cap, { action: 'new-scene', targetId: id, itemId, name, includeEffects: opts.includeEffects })
    return id
  }
  newSceneLocal(cap, opts, { id, itemId }, ids.select ?? true)
  return id
}

/** Appends a cue; returns its id */
export function recordAddCue(cuelistId: string, cap: Capture, name?: string, ids: RecordIds = {}): string | null {
  const pb = usePlaybackStore.getState()
  const cl = pb.cuelists.find((c) => c.id === cuelistId)
  if (!cl) return null
  const itemId = ids.itemId ?? uuidv4()
  const cueName = name?.trim() || t('scenes.defaults.cueName', { n: cl.cues.length + 1 })
  if (isRemoteMode()) {
    runAsConsoleContent(['cuelists'], () => usePlaybackStore.getState().addCue(cuelistId, cueName, cap.values, undefined, undefined, itemId))
    sendRecord(cap, { action: 'add-cue', targetId: cuelistId, itemId, name: cueName })
    return itemId
  }
  pb.addCue(cuelistId, cueName, cap.values, undefined, undefined, itemId)
  return itemId
}

/** merge: the capture is added to / overrides the cue's channels · replace: the cue becomes the capture */
export function recordUpdateCue(cuelistId: string, cueId: string, cap: Capture, mode: 'merge' | 'replace'): void {
  if (isRemoteMode()) {
    sendRecord(cap, { action: 'update-cue', targetId: cuelistId, itemId: cueId, mode })
    return
  }
  const pb = usePlaybackStore.getState()
  const cue = pb.cuelists.find((c) => c.id === cuelistId)?.cues.find((q) => q.id === cueId)
  if (!cue) return
  pb.updateCue(cuelistId, cueId, { values: mode === 'merge' ? mergeValues(cue.values, cap.values) : cap.values })
}

export function recordNewChase(cap: Capture, name?: string, ids: RecordIds = {}): string {
  const id = ids.id ?? uuidv4()
  const itemId = ids.itemId ?? uuidv4()
  const chaseName = name?.trim() || nextChaseName()
  const local = () => {
    const pb = usePlaybackStore.getState()
    pb.addChase(chaseName, id)
    pb.addChaseStep(id, cap.values, itemId)
  }
  if (isRemoteMode()) {
    runAsConsoleContent(['chases'], local)
    usePlaybackStore.getState().selectChase(id)
    sendRecord(cap, { action: 'new-chase', targetId: id, itemId, name: chaseName })
    return id
  }
  local()
  if (ids.select ?? true) usePlaybackStore.getState().selectChase(id)
  return id
}

export function recordAddStep(chaseId: string, cap: Capture, ids: RecordIds = {}): void {
  const itemId = ids.itemId ?? uuidv4()
  if (isRemoteMode()) {
    if (!usePlaybackStore.getState().chases.some((c) => c.id === chaseId)) return
    runAsConsoleContent(['chases'], () => usePlaybackStore.getState().addChaseStep(chaseId, cap.values, itemId))
    sendRecord(cap, { action: 'add-step', targetId: chaseId, itemId })
    return
  }
  usePlaybackStore.getState().addChaseStep(chaseId, cap.values, itemId)
}

export function recordUpdateStep(chaseId: string, stepId: string, cap: Capture, mode: 'merge' | 'replace'): void {
  if (isRemoteMode()) {
    sendRecord(cap, { action: 'update-step', targetId: chaseId, itemId: stepId, mode })
    return
  }
  const pb = usePlaybackStore.getState()
  const step = pb.chases.find((c) => c.id === chaseId)?.steps.find((s) => s.id === stepId)
  if (!step) return
  pb.updateChaseStep(chaseId, stepId, { values: mode === 'merge' ? mergeValues(step.values, cap.values) : cap.values })
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128

/**
 * Console: execute a remote's 'record' command with the console's own
 * programmer (or live output). Returns the section it changed, or null when
 * the command is malformed / there is nothing to record.
 */
export function performRecord(raw: unknown): 'cuelists' | 'chases' | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<RecordCommandPayload>
  if (!isId(p.targetId)) return null
  const fixtureIds = Array.isArray(p.fixtureIds) ? p.fixtureIds.filter(isId) : undefined
  const cap = capture(!!fixtureIds, fixtureIds && fixtureIds.length > 0 ? fixtureIds : undefined)
  const name = typeof p.name === 'string' ? p.name.slice(0, 200) : undefined
  const itemId = isId(p.itemId) ? p.itemId : undefined
  const mode = p.mode === 'replace' ? 'replace' : 'merge'
  if (cap.channelCount === 0) {
    console.warn('[Record] remote record: nothing to record on the console')
    return p.action === 'new-chase' || p.action === 'add-step' || p.action === 'update-step' ? 'chases' : 'cuelists'
  }
  const pb = usePlaybackStore.getState()
  switch (p.action) {
    case 'new-scene':
      if (pb.cuelists.some((c) => c.id === p.targetId)) return 'cuelists'
      recordNewScene(cap, { name, includeEffects: p.includeEffects === true }, { id: p.targetId, itemId, select: false })
      return 'cuelists'
    case 'add-cue':
      recordAddCue(p.targetId, cap, name, { itemId })
      return 'cuelists'
    case 'update-cue':
      if (itemId) recordUpdateCue(p.targetId, itemId, cap, mode)
      return 'cuelists'
    case 'new-chase':
      if (pb.chases.some((c) => c.id === p.targetId)) return 'chases'
      recordNewChase(cap, name, { id: p.targetId, itemId, select: false })
      return 'chases'
    case 'add-step':
      recordAddStep(p.targetId, cap, { itemId })
      return 'chases'
    case 'update-step':
      if (itemId) recordUpdateStep(p.targetId, itemId, cap, mode)
      return 'chases'
    default:
      return null
  }
}

export function clearProgrammerAfterRecord(): void {
  clearProgrammer()
}

/** "4 fixtures · 28 ch" */
export function describeValues(values: CueChannelValue[]): string {
  if (values.length === 0) return t('scenes.record.emptyValues')
  return t('scenes.record.describeValues', { fixtures: t('common.fixtureCount', { count: countFixtures(values) }), count: values.length })
}
