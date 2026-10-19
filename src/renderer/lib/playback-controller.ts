// ============================================================
// PhotonBoard — Playback controller
// Wires the playback store (scenes = cuelists, chases) to the cue
// and chase engines and the mixer:
//   - GO / Back / jump → tracked crossfade (cue engine)
//   - Stop, removal, show change → layer released, scene effects
//     stopped, pending follow cancelled (nothing is left orphaned)
//   - Fader / flash / priority → layer master & priority, applied
//     immediately (also when no fade is running)
//   - Auto-follow / loop timing runs on the mixer clock
// Never runs in remote mode (the Pi plays the show).
// ============================================================

import type { Chase, Cuelist, Effect } from '@shared/types'
import { usePlaybackStore, isFlashStarted } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { CueEngine, computeTrackedState } from './cue-engine'
import { ChaseEngine } from './chase-engine'
import { getFixtureIndex, type FixtureIndex, type KeyMeta } from './fixture-index'
import {
  getMixValue,
  registerFrameSource,
  removeLayer,
  removeLayersWithPrefix,
  setLayer,
  setLayerMaster,
  setLayerPriority,
  touchLayer
} from './dmx-mixer'
import { startEffect, stopEffectsWithPrefix } from './effect-engine'
import { clockNow, isRemoteMode } from './runtime'

export const CUELIST_LAYER_PREFIX = 'cuelist_'
export const CHASE_LAYER_PREFIX = 'chase_'
const SCENE_EFFECT_PREFIX = 'scene_'
const DEFAULT_CHASE_PRIORITY = 40

export function cuelistLayerId(id: string): string {
  return `${CUELIST_LAYER_PREFIX}${id}`
}

export function chaseLayerId(id: string): string {
  return `${CHASE_LAYER_PREFIX}${id}`
}

function currentIndex(): FixtureIndex {
  const { patch, fixtures } = usePatchStore.getState()
  return getFixtureIndex(patch, fixtures)
}

function keyMeta(key: string): KeyMeta {
  return currentIndex().meta(key)
}

/** Live value of a channel that a cuelist starts to control (LTP channels fade from here). */
function liveValue(key: string): number | undefined {
  const addr = currentIndex().resolve(key)
  return addr ? getMixValue(addr.universe, addr.channel) : undefined
}

const cueEngine = new CueEngine({ meta: keyMeta, startValue: liveValue })
const chaseEngine = new ChaseEngine(keyMeta)

interface CuelistSnapshot {
  index: number
  gen: number
  playing: boolean
  cues: Cuelist['cues']
  master: number
  priority: number
}

const prevCuelists = new Map<string, CuelistSnapshot>()
const prevChases = new Map<string, { playing: boolean; master: number; priority: number }>()
/** Pending auto-follow / loop GO: cuelist id → due time (mixer clock) */
const followDue = new Map<string, number>()

function cuelistMaster(cl: Cuelist): number {
  return cl.flash ? 255 : cl.faderLevel
}

function chasePriority(ch: Chase): number {
  return ch.priority ?? DEFAULT_CHASE_PRIORITY
}

// ---------------------------------------------------------------
// Scene effects
// ---------------------------------------------------------------

function sceneEffectPrefix(cuelistId: string): string {
  return `${SCENE_EFFECT_PREFIX}${cuelistId}_`
}

function startSceneEffects(cuelistId: string, snapshots: Effect[]): void {
  stopEffectsWithPrefix(sceneEffectPrefix(cuelistId))
  for (const snap of snapshots) {
    startEffect({ ...snap, id: `${sceneEffectPrefix(cuelistId)}${snap.id}`, isRunning: true }, { restart: true })
  }
}

// ---------------------------------------------------------------
// Cuelists
// ---------------------------------------------------------------

function releaseCuelist(id: string): void {
  cueEngine.stop(id)
  removeLayer(cuelistLayerId(id))
  stopEffectsWithPrefix(sceneEffectPrefix(id))
  followDue.delete(id)
}

function goToCue(cl: Cuelist, wasPlaying: boolean, now: number): void {
  const cue = cl.cues[cl.currentCueIndex]
  if (!cue) return
  const snap = !wasPlaying && isFlashStarted(cl.id)
  cueEngine.go(
    cl.id,
    computeTrackedState(cl.cues, cl.currentCueIndex),
    snap ? { fadeIn: 0, fadeOut: 0, delay: 0 } : { fadeIn: cue.fadeIn, fadeOut: cue.fadeOut, delay: cue.delay },
    now
  )
  followDue.delete(cl.id)
  // Latest GO takes precedence on LTP channels
  touchLayer(cuelistLayerId(cl.id), now)
  if (!wasPlaying && cl.effectSnapshots && cl.effectSnapshots.length > 0) {
    startSceneEffects(cl.id, cl.effectSnapshots)
  }
}

function syncCuelists(cuelists: Cuelist[], now: number): void {
  const seen = new Set<string>()
  for (const cl of cuelists) {
    seen.add(cl.id)
    const prev = prevCuelists.get(cl.id)
    const gen = cl.goGeneration ?? 0
    const master = cuelistMaster(cl)
    const playing = cl.isPlaying && cl.currentCueIndex >= 0 && cl.currentCueIndex < cl.cues.length

    if (playing) {
      const triggered = !prev || !prev.playing || prev.index !== cl.currentCueIndex || prev.gen !== gen
      if (triggered) {
        goToCue(cl, !!prev?.playing, now)
      } else if (prev && prev.cues !== cl.cues && !cueEngine.isFading(cl.id)) {
        // Live edit of a playing scene: show the edited state at once
        const cue = cl.cues[cl.currentCueIndex]
        if (cue) cueEngine.go(cl.id, computeTrackedState(cl.cues, cl.currentCueIndex), { fadeIn: 0, fadeOut: 0, delay: 0 }, now)
      }
      if (!prev || prev.master !== master) setLayerMaster(cuelistLayerId(cl.id), master)
      if (!prev || prev.priority !== cl.priority) setLayerPriority(cuelistLayerId(cl.id), cl.priority)
    } else if (prev?.playing) {
      releaseCuelist(cl.id)
    }

    prevCuelists.set(cl.id, { index: cl.currentCueIndex, gen, playing, cues: cl.cues, master, priority: cl.priority })
  }

  // Removed cuelists (delete, show load, remote replace)
  for (const id of Array.from(prevCuelists.keys())) {
    if (seen.has(id)) continue
    releaseCuelist(id)
    prevCuelists.delete(id)
  }
}

function onCueComplete(cuelistId: string, now: number): void {
  const cl = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)
  if (!cl || !cl.isPlaying) return
  const cue = cl.cues[cl.currentCueIndex]
  if (!cue) return
  const hasFollow = typeof cue.followTime === 'number' && Number.isFinite(cue.followTime) && cue.followTime >= 0
  const isLast = cl.currentCueIndex >= cl.cues.length - 1
  if (!hasFollow && !(isLast && cl.isLooping && cl.cues.length > 1)) return
  followDue.set(cuelistId, now + (hasFollow ? (cue.followTime as number) * 1000 : 0))
}

// ---------------------------------------------------------------
// Chases
// ---------------------------------------------------------------

function syncChases(chases: Chase[], now: number): void {
  const seen = new Set<string>()
  for (const ch of chases) {
    seen.add(ch.id)
    const prev = prevChases.get(ch.id)
    const playing = ch.isPlaying && ch.steps.length > 0
    if (playing && !prev?.playing) {
      chaseEngine.start(ch, now)
      touchLayer(chaseLayerId(ch.id), now)
    } else if (!playing && prev?.playing) {
      chaseEngine.stop(ch.id)
      removeLayer(chaseLayerId(ch.id))
    }
    if (playing) {
      if (!prev || prev.master !== ch.faderLevel) setLayerMaster(chaseLayerId(ch.id), ch.faderLevel)
      if (!prev || prev.priority !== chasePriority(ch)) setLayerPriority(chaseLayerId(ch.id), chasePriority(ch))
    }
    prevChases.set(ch.id, { playing, master: ch.faderLevel, priority: chasePriority(ch) })
  }
  for (const id of Array.from(prevChases.keys())) {
    if (seen.has(id)) continue
    chaseEngine.stop(id)
    removeLayer(chaseLayerId(id))
    prevChases.delete(id)
  }
}

// ---------------------------------------------------------------
// Frame
// ---------------------------------------------------------------

function onFrame(now: number): void {
  const store = usePlaybackStore.getState()

  // Auto-follow / loop
  for (const [id, due] of Array.from(followDue)) {
    if (now < due) continue
    followDue.delete(id)
    const cl = store.cuelists.find(c => c.id === id)
    if (cl?.isPlaying) store.goCuelist(id)
  }

  const index = currentIndex()
  const latest = usePlaybackStore.getState()

  // Cue fades
  const { changed, completed } = cueEngine.update(now)
  for (const [id, values] of changed) {
    const cl = latest.cuelists.find(c => c.id === id)
    if (!cl) continue
    setLayer(cuelistLayerId(id), index.toLayer(values), cl.priority, cuelistMaster(cl))
  }
  for (const id of completed) onCueComplete(id, now)

  // Chases
  for (const ch of latest.chases) {
    if (!chaseEngine.isRunning(ch.id)) continue
    const frame = chaseEngine.update(ch, now)
    if (!frame) continue
    setLayer(chaseLayerId(ch.id), index.toLayer(frame.values), chasePriority(ch), ch.faderLevel)
    if (ch.currentStepIndex !== frame.stepIndex) latest.setChaseStep(ch.id, frame.stepIndex)
  }
}

// ---------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------

let stopFn: (() => void) | null = null

/**
 * Start the controller (idempotent) and sync it with the current store.
 * Returns a stop function. Engine state and the last-seen store snapshot are
 * kept across stop/start, so a React StrictMode remount neither re-triggers
 * nor drops anything.
 */
export function startPlaybackController(): () => void {
  if (isRemoteMode()) return () => {}
  if (stopFn) return stopFn

  const state = usePlaybackStore.getState()
  const now = clockNow()
  syncCuelists(state.cuelists, now)
  syncChases(state.chases, now)

  const unsubStore = usePlaybackStore.subscribe((s, prev) => {
    const t = clockNow()
    if (s.cuelists !== prev.cuelists) syncCuelists(s.cuelists, t)
    if (s.chases !== prev.chases) syncChases(s.chases, t)
  })
  const unregister = registerFrameSource('playback', onFrame, 10)

  stopFn = () => {
    unsubStore()
    unregister()
    stopFn = null
  }
  return stopFn
}

/**
 * Release every cuelist and chase output immediately (show load / new show).
 * The store is not modified; the caller replaces it.
 */
export function resetPlayback(): void {
  for (const id of Array.from(prevCuelists.keys())) stopEffectsWithPrefix(sceneEffectPrefix(id))
  cueEngine.stopAll()
  chaseEngine.stopAll()
  removeLayersWithPrefix(CUELIST_LAYER_PREFIX)
  removeLayersWithPrefix(CHASE_LAYER_PREFIX)
  stopEffectsWithPrefix(SCENE_EFFECT_PREFIX)
  followDue.clear()
  prevCuelists.clear()
  prevChases.clear()
}
