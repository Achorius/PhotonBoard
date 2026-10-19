// ============================================================
// PhotonBoard — Remote State Sync (browser side)
//   Pi → browser: state broadcasts are mirrored into the local stores
//   browser → Pi: store ACTIONS forward commands themselves when
//                 running remotely (see lib/runtime.ts); only the
//                 executor layout is forwarded from here.
// Only active in remote mode (browser, no Electron).
//
// Fields the user is changing right now (fader drags…) are held for a
// moment: broadcasts produced before the Pi received the change would
// otherwise make the control jump back.
// ============================================================

import { useEffect } from 'react'
import type { Chase, ChaseStep, Cue, Cuelist } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { decodeSnapshotDmx } from '@renderer/lib/state-snapshot'
import { isProgrammerChannelHeld } from '@renderer/lib/dmx-mixer'
import { onShowApplied, withoutDirtyTracking } from '@renderer/lib/show-io'
import { getBridge, isLocallyHeld, isRemoteMode, sendRemoteCommand } from '@renderer/lib/runtime'

/** True when running in browser (remote mode) */
export function isRemote(): boolean {
  return isRemoteMode()
}

/**
 * Guard flag: true while Pi state is being applied to the local stores, so
 * the browser → Pi subscription does not echo it back.
 */
let _applyingRemoteState = false

/** Last Pi broadcast, re-applied after a show is (re)loaded in the browser */
let lastRemoteState: unknown = null

type Obj = Record<string, any>

function hasId(v: unknown): v is Obj & { id: string } {
  return !!v && typeof v === 'object' && typeof (v as Obj).id === 'string'
}

function clampByte(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : fallback
}

function mirrorCues(raw: unknown, existing: Cue[] | undefined): Cue[] {
  if (!Array.isArray(raw)) return existing ?? []
  const byId = new Map((existing ?? []).map(c => [c.id, c]))
  return raw.filter(hasId).map((c: Obj, i: number) => {
    const prev = byId.get(c.id)
    const cue: Cue = {
      id: c.id,
      name: typeof c.name === 'string' ? c.name : `Cue ${i + 1}`,
      number: typeof c.number === 'number' ? c.number : i + 1,
      // The broadcast carries no channel values (slim snapshot)
      values: Array.isArray(c.values) ? c.values : prev?.values ?? [],
      fadeIn: typeof c.fadeIn === 'number' ? c.fadeIn : 0,
      fadeOut: typeof c.fadeOut === 'number' ? c.fadeOut : 0,
      delay: typeof c.delay === 'number' ? c.delay : 0,
      followTime: typeof c.followTime === 'number' ? c.followTime : null
    }
    if (typeof c.color === 'string') cue.color = c.color
    return cue
  })
}

function sameCues(a: Cue[], b: Cue[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((c, i) => {
    const d = b[i]
    return c.id === d.id && c.name === d.name && c.number === d.number && c.fadeIn === d.fadeIn &&
      c.fadeOut === d.fadeOut && c.delay === d.delay && c.followTime === d.followTime && c.color === d.color
  })
}

function mirrorCuelists(raw: unknown[]): void {
  const local = usePlaybackStore.getState().cuelists
  const localById = new Map(local.map(cl => [cl.id, cl]))
  const next: Cuelist[] = raw
    .filter(hasId)
    .map((pi: Obj) => {
      const existing = localById.get(pi.id)
      const cues = mirrorCues(pi.cues, existing?.cues)
      const faderLevel = isLocallyHeld(`fader:${pi.id}`)
        ? existing?.faderLevel ?? 255
        : clampByte(pi.faderLevel, existing?.faderLevel ?? 255)
      return {
        id: pi.id,
        name: typeof pi.name === 'string' ? pi.name : existing?.name ?? 'Scene',
        cues: existing && sameCues(existing.cues, cues) ? existing.cues : cues,
        currentCueIndex: typeof pi.currentCueIndex === 'number' ? pi.currentCueIndex : existing?.currentCueIndex ?? -1,
        isPlaying: typeof pi.isPlaying === 'boolean' ? pi.isPlaying : existing?.isPlaying ?? false,
        isLooping: typeof pi.isLooping === 'boolean' ? pi.isLooping : existing?.isLooping ?? false,
        priority: typeof pi.priority === 'number' ? pi.priority : existing?.priority ?? 50,
        faderLevel,
        flash: typeof pi.flash === 'boolean' ? pi.flash : existing?.flash ?? false,
        goGeneration: existing?.goGeneration,
        effectSnapshots: existing?.effectSnapshots
      }
    })

  let changed = next.length !== local.length
  for (let i = 0; !changed && i < next.length; i++) {
    const a = next[i]
    const b = local[i]
    changed = !b || a.id !== b.id || a.name !== b.name || a.cues !== b.cues ||
      a.currentCueIndex !== b.currentCueIndex || a.isPlaying !== b.isPlaying ||
      a.isLooping !== b.isLooping || a.priority !== b.priority ||
      a.faderLevel !== b.faderLevel || a.flash !== b.flash
  }
  if (changed) usePlaybackStore.setState({ cuelists: next })
}

function mirrorChases(raw: unknown[]): void {
  const local = usePlaybackStore.getState().chases
  const localById = new Map(local.map(ch => [ch.id, ch]))
  const next: Chase[] = raw
    .filter(hasId)
    .map((pi: Obj) => {
      const existing = localById.get(pi.id)
      const stepCount = typeof pi.stepCount === 'number' ? Math.max(0, Math.floor(pi.stepCount)) : existing?.steps.length ?? 0
      const steps: ChaseStep[] = existing && existing.steps.length === stepCount
        ? existing.steps
        : Array.from({ length: stepCount }, (_, i) => existing?.steps[i] ?? { id: `${pi.id}-step-${i}`, values: [] })
      return {
        ...(existing ?? { isLooping: true, fadePercent: 0, direction: 'forward' as const }),
        id: pi.id,
        name: typeof pi.name === 'string' ? pi.name : existing?.name ?? 'Chase',
        steps,
        isPlaying: typeof pi.isPlaying === 'boolean' ? pi.isPlaying : existing?.isPlaying ?? false,
        bpm: isLocallyHeld(`chaseBpm:${pi.id}`) ? existing?.bpm ?? 120 : typeof pi.bpm === 'number' ? pi.bpm : existing?.bpm ?? 120,
        faderLevel: isLocallyHeld(`chaseFader:${pi.id}`)
          ? existing?.faderLevel ?? 255
          : clampByte(pi.faderLevel, existing?.faderLevel ?? 255),
        currentStepIndex: typeof pi.currentStepIndex === 'number' ? pi.currentStepIndex : existing?.currentStepIndex ?? 0
      }
    })
  let changed = next.length !== local.length
  for (let i = 0; !changed && i < next.length; i++) {
    const a = next[i]
    const b = local[i]
    changed = !b || a.id !== b.id || a.name !== b.name || a.steps !== b.steps || a.isPlaying !== b.isPlaying ||
      a.bpm !== b.bpm || a.faderLevel !== b.faderLevel || a.currentStepIndex !== b.currentStepIndex
  }
  if (changed) usePlaybackStore.setState({ chases: next })
}

function mirrorMasters(data: Obj): void {
  const dmx = useDmxStore.getState()
  const patch: Partial<{ grandMaster: number; blackout: boolean; blinder: boolean; strobe: boolean; strobeRate: number }> = {}
  if (typeof data.grandMaster === 'number' && !isLocallyHeld('grandMaster')) {
    const gm = clampByte(data.grandMaster, dmx.grandMaster)
    if (gm !== dmx.grandMaster) patch.grandMaster = gm
  }
  for (const key of ['blackout', 'blinder', 'strobe'] as const) {
    if (typeof data[key] === 'boolean' && data[key] !== dmx[key] && !isLocallyHeld(key)) patch[key] = data[key]
  }
  if (typeof data.strobeRate === 'number' && data.strobeRate !== dmx.strobeRate && !isLocallyHeld('strobeRate')) {
    patch.strobeRate = data.strobeRate
  }
  if (Object.keys(patch).length > 0) useDmxStore.setState(patch)
}

function mirrorDmx(data: Obj): void {
  let values = decodeSnapshotDmx(data.dmx)
  if (!values && Array.isArray(data.dmxValues)) {
    // Older consoles: number[][]
    values = data.dmxValues.map((universe: unknown) =>
      Array.isArray(universe) ? universe.map((v) => clampByte(v, 0)) : new Array(512).fill(0)
    )
  }
  if (!values) return
  // Keep channels the user is moving right now
  const current = useDmxStore.getState().values
  for (let u = 0; u < values.length; u++) {
    for (let ch = 0; ch < values[u].length; ch++) {
      if (isProgrammerChannelHeld(u, ch)) values[u][ch] = current[u]?.[ch] ?? values[u][ch]
    }
  }
  useDmxStore.setState({ values, universeCount: Math.max(useDmxStore.getState().universeCount, values.length) })
}

/** Apply one Pi state broadcast to the local stores. */
export function applyRemoteState(data: unknown): void {
  if (!data || typeof data !== 'object') return
  lastRemoteState = data
  const d = data as Obj
  _applyingRemoteState = true
  try {
    withoutDirtyTracking(() => {
      if (Array.isArray(d.cuelists)) mirrorCuelists(d.cuelists)
      if (Array.isArray(d.chases)) mirrorChases(d.chases)
      mirrorMasters(d)
      if (Array.isArray(d.executorGrid)) {
        useExecutorStore.getState().applyRemote({
          grid: d.executorGrid,
          columns: Array.isArray(d.executorColumns) ? d.executorColumns : undefined,
          modes: Array.isArray(d.executorModes) ? d.executorModes : undefined
        })
      }
      mirrorDmx(d)
      const ui = useUiStore.getState()
      if (typeof d.showName === 'string' && d.showName !== ui.showName) ui.setShowName(d.showName)
      if (typeof d.isDirty === 'boolean' && d.isDirty !== ui.isDirty) ui.setDirty(d.isDirty)
    })
  } catch (e) {
    console.error('[Remote] Failed to apply state:', e)
  } finally {
    _applyingRemoteState = false
  }
}

/**
 * Hook: bidirectional sync between a remote browser and the console.
 * Call once in the root App component.
 */
export function useRemoteSync(): void {
  // ---- Pi → browser ----
  useEffect(() => {
    if (!isRemoteMode()) return
    const off = getBridge()?.remote.onState(applyRemoteState) as unknown as (() => void) | undefined
    // Loading the show for display resets runtime fields: restore the Pi's live state
    const offApplied = onShowApplied(() => {
      if (lastRemoteState) applyRemoteState(lastRemoteState)
    })
    return () => { off?.(); offApplied() }
  }, [])

  // ---- browser → Pi: executor layout edits (drag & drop, titles, modes) ----
  useEffect(() => {
    if (!isRemoteMode()) return
    const unsub = useExecutorStore.subscribe((state, prev) => {
      if (_applyingRemoteState) return
      if (state.grid === prev.grid && state.columns === prev.columns && state.modes === prev.modes) return
      sendRemoteCommand('set-executor-layout', { grid: state.grid, columns: state.columns, modes: state.modes })
    })
    return unsub
  }, [])
}
