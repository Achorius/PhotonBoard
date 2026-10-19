// ============================================================
// Recording helpers for the Scenes view: capture the programmer
// (or, when it is empty, the live output of the fixtures) and
// write it into scenes, cues, chases and chase steps.
// Everything reads stores with getState() at call time — nothing
// here subscribes.
// ============================================================

import type { CueChannelValue, Effect } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { recordFromProgrammer } from '@renderer/lib/programmer-utils'
import { clearProgrammer } from '@renderer/lib/dmx-mixer'
import { cueKey } from '@renderer/lib/fixture-index'

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
}

export function countFixtures(values: CueChannelValue[]): number {
  return new Set(values.map((v) => v.fixtureId)).size
}

/**
 * What a record would store right now.
 * `selectedOnly`: limit to the selected fixtures (ignored without a selection).
 */
export function capture(selectedOnly: boolean): Capture {
  const { patch, selectedFixtureIds, getFixtureChannels } = usePatchStore.getState()
  const limit = selectedOnly && selectedFixtureIds.length > 0 ? new Set(selectedFixtureIds) : null
  const effects = useEffectsStore.getState().effects.filter((e) => e.isRunning).map((e) => ({ ...e, fixtureIds: [...e.fixtureIds] }))

  const programmer = recordFromProgrammer()
  if (programmer.length > 0) {
    const values = limit ? programmer.filter((v) => limit.has(v.fixtureId)) : programmer
    return { values, source: 'programmer', fixtureCount: countFixtures(values), channelCount: values.length, effects, selectedOnly: !!limit }
  }

  // Programmer empty: the live output (non-zero channels) of the selected / all fixtures
  const dmx = useDmxStore.getState().values
  const values: CueChannelValue[] = []
  for (const entry of patch) {
    if (limit && !limit.has(entry.id)) continue
    for (const ch of getFixtureChannels(entry)) {
      const v = dmx[entry.universe]?.[ch.absoluteChannel] ?? 0
      if (v > 0) values.push({ fixtureId: entry.id, channelName: ch.name, value: v })
    }
  }
  return { values, source: 'output', fixtureCount: countFixtures(values), channelCount: values.length, effects, selectedOnly: !!limit }
}

/** `overlay` wins on the channels both contain; the others are kept */
export function mergeValues(base: CueChannelValue[], overlay: CueChannelValue[]): CueChannelValue[] {
  const map = new Map<string, CueChannelValue>()
  for (const v of base) map.set(cueKey(v.fixtureId, v.channelName), v)
  for (const v of overlay) map.set(cueKey(v.fixtureId, v.channelName), { ...v })
  return Array.from(map.values())
}

function nextSceneName(): string {
  const names = new Set(usePlaybackStore.getState().cuelists.map((c) => c.name))
  let n = usePlaybackStore.getState().cuelists.length + 1
  while (names.has(`Scene ${n}`)) n++
  return `Scene ${n}`
}

function nextChaseName(): string {
  const names = new Set(usePlaybackStore.getState().chases.map((c) => c.name))
  let n = usePlaybackStore.getState().chases.length + 1
  while (names.has(`Chase ${n}`)) n++
  return `Chase ${n}`
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

export function recordNewScene(cap: Capture, opts: { name?: string; includeEffects: boolean }): string {
  const pb = usePlaybackStore.getState()
  const id = pb.addCuelist(opts.name?.trim() || nextSceneName())
  pb.addCue(id, 'Cue 1', cap.values)
  if (opts.includeEffects && cap.effects.length > 0) pb.updateCuelist(id, { effectSnapshots: cap.effects })
  pb.selectCuelist(id)
  return id
}

/** Appends a cue; returns its id */
export function recordAddCue(cuelistId: string, cap: Capture, name?: string): string | null {
  const pb = usePlaybackStore.getState()
  const cl = pb.cuelists.find((c) => c.id === cuelistId)
  if (!cl) return null
  pb.addCue(cuelistId, name?.trim() || `Cue ${cl.cues.length + 1}`, cap.values)
  const after = usePlaybackStore.getState().cuelists.find((c) => c.id === cuelistId)
  return after?.cues[after.cues.length - 1]?.id ?? null
}

/** merge: the capture is added to / overrides the cue's channels · replace: the cue becomes the capture */
export function recordUpdateCue(cuelistId: string, cueId: string, cap: Capture, mode: 'merge' | 'replace'): void {
  const pb = usePlaybackStore.getState()
  const cue = pb.cuelists.find((c) => c.id === cuelistId)?.cues.find((q) => q.id === cueId)
  if (!cue) return
  pb.updateCue(cuelistId, cueId, { values: mode === 'merge' ? mergeValues(cue.values, cap.values) : cap.values })
}

export function recordNewChase(cap: Capture, name?: string): string {
  const pb = usePlaybackStore.getState()
  const id = pb.addChase(name?.trim() || nextChaseName())
  pb.addChaseStep(id, cap.values)
  pb.selectChase(id)
  return id
}

export function recordAddStep(chaseId: string, cap: Capture): void {
  usePlaybackStore.getState().addChaseStep(chaseId, cap.values)
}

export function recordUpdateStep(chaseId: string, stepId: string, cap: Capture, mode: 'merge' | 'replace'): void {
  const pb = usePlaybackStore.getState()
  const step = pb.chases.find((c) => c.id === chaseId)?.steps.find((s) => s.id === stepId)
  if (!step) return
  pb.updateChaseStep(chaseId, stepId, { values: mode === 'merge' ? mergeValues(step.values, cap.values) : cap.values })
}

export function clearProgrammerAfterRecord(): void {
  clearProgrammer()
}

/** "4 fixtures · 28 ch" */
export function describeValues(values: CueChannelValue[]): string {
  if (values.length === 0) return 'Empty'
  const f = countFixtures(values)
  return `${f} fixture${f === 1 ? '' : 's'} · ${values.length} ch`
}
