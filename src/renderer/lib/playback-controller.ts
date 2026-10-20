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
//
// Pro additions (inactive unless a show / an executor uses them):
//   - per-key timing tables built once per GO (feature timing, parts,
//     per-value fade / delay), cuelist rate × runtime rate fader
//   - tracking off, block cues, preset references resolved at GO time,
//     live preset update (re-GO in 0 s / retarget a running fade)
//   - Move-In-Black, follow 'after-go', pause / resume of a fade,
//     manual X-fade (column fader)
//   - speed masters drive chase BPM (effects: lib/pro/speed-masters)
//   - effective master = fader × column level of the executor it was
//     fired from / 255; priority mode swap / super → mixer layer flags
// ============================================================

import type { Chase, Cue, Cuelist, Effect, ExecutorTargetKind, FixtureDefinition, PatchEntry, Preset } from '@shared/types'
import { featureOfChannel } from '@shared/attribute-families'
import { usePlaybackStore, isFlashStarted } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import {
  CueEngine, applyMoveInBlack, buildCueTiming, computeTrackedState, mibTiming,
  type CueKeyMeta, type CueTiming, type CueValueResolver, type TrackOptions
} from './cue-engine'
import { ChaseEngine } from './chase-engine'
import { getFixtureIndex, splitCueKey, type FixtureIndex, type KeyMeta } from './fixture-index'
import * as mixer from './dmx-mixer'
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
import { resolvePreset } from './pro/preset-resolve'
import { clampRate, effectiveBpm } from './pro/speed-masters'
import type { ExecutorRef } from './pro/contracts'

export const CUELIST_LAYER_PREFIX = 'cuelist_'
export const CHASE_LAYER_PREFIX = 'chase_'
const SCENE_EFFECT_PREFIX = 'scene_'
const DEFAULT_CHASE_PRIORITY = 40

/**
 * Mixer layer flags (spec §4.2 — same values as dmx-mixer's LAYER_SWAP /
 * LAYER_SUPER, implemented by the mixer): swap = intensity claimed
 * LTP-style against lower layers, super = merged after the programmer.
 */
export const LAYER_SWAP = 1
export const LAYER_SUPER = 2

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

// ---------------------------------------------------------------
// Key features (per-feature timing) — memoised on the patch identity
// ---------------------------------------------------------------

let featurePatch: PatchEntry[] | null = null
let featureDefs: FixtureDefinition[] | null = null
let featureEntries = new Map<string, PatchEntry>()
let featureDefMap = new Map<string, FixtureDefinition>()
const featureCache = new Map<string, CueKeyMeta>()

/** KeyMeta + attribute feature of a cue key (only used when a GO has per-key timing) */
function cueKeyMeta(key: string): CueKeyMeta {
  const { patch, fixtures } = usePatchStore.getState()
  if (patch !== featurePatch || fixtures !== featureDefs) {
    featureCache.clear()
    featurePatch = patch
    featureDefs = fixtures
    featureEntries = new Map(patch.map(p => [p.id, p]))
    featureDefMap = new Map(fixtures.map(f => [f.id, f]))
  }
  const cached = featureCache.get(key)
  if (cached) return cached
  const [fixtureId, channelName] = splitCueKey(key)
  const entry = featureEntries.get(fixtureId)
  const def = entry ? featureDefMap.get(entry.fixtureDefId) : undefined
  const lower = channelName.toLowerCase()
  const ch = def?.channels[channelName] ?? (def ? Object.values(def.channels).find(c => c.name.toLowerCase() === lower) : undefined)
  const meta: CueKeyMeta = { ...keyMeta(key), feature: featureOfChannel(channelName, ch?.type, ch?.precedence) }
  featureCache.set(key, meta)
  return meta
}

// ---------------------------------------------------------------
// Preset references — resolved at GO time (memoised resolver)
// ---------------------------------------------------------------

let resolverFor: { presets: Preset[]; patch: PatchEntry[]; fixtures: FixtureDefinition[] } | null = null
let resolver: CueValueResolver | undefined

function presetResolver(): CueValueResolver | undefined {
  const { presets } = usePlaybackStore.getState()
  const { patch, fixtures } = usePatchStore.getState()
  if (resolverFor && resolverFor.presets === presets && resolverFor.patch === patch && resolverFor.fixtures === fixtures) return resolver
  resolverFor = { presets, patch, fixtures }
  if (presets.length === 0) {
    resolver = undefined
    return resolver
  }
  const presetMap = new Map(presets.map(p => [p.id, p]))
  const patchMap = new Map(patch.map(p => [p.id, p]))
  const defMap = new Map(fixtures.map(d => [d.id, d]))
  resolver = (cv) => {
    const preset = cv.presetId ? presetMap.get(cv.presetId) : undefined
    const entry = patchMap.get(cv.fixtureId)
    if (!preset || !entry) return undefined
    return resolvePreset(preset, entry, defMap.get(entry.fixtureDefId), cv.channelName)
  }
  return resolver
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

// ---------------------------------------------------------------
// Pro runtime state (never saved)
// ---------------------------------------------------------------

/** Paused cuelists and the follow time they still had to wait (ms, -1 = none) */
const pausedCuelists = new Map<string, number>()
/** Cuelists whose next GO is driven by the X-fade fader */
const manualArmed = new Set<string>()
/** X-fade fader state per cuelist */
const xfade = new Map<string, { last: number; dir: 1 | -1 | 0 }>()
/** Runtime rate (rate faders): 'cuelist:id' / 'chase:id' → rate */
const runtimeRates = new Map<string, number>()
/** Cuelists whose swap button is held */
const swapHeld = new Set<string>()
/** Layer flags last sent to the mixer per layer id */
const appliedFlags = new Map<string, number>()
/** Column levels (column faders of kind 'column'): 'page:col' → 0-255 (default 255) */
const columnLevels = new Map<string, number>()
/** Executor an object was last fired from: 'kind:id' → ref */
const firedFrom = new Map<string, ExecutorRef>()
/** Column scale per object (id → 0-255, one map per kind: no per-frame key strings), invalidated when pages / levels change */
const columnScaleCache = new Map<ExecutorTargetKind, Map<string, number>>()
const columnListeners = new Set<() => void>()
let columnVersion = 0

function rateKey(kind: 'cuelist' | 'chase', id: string): string {
  return `${kind}:${id}`
}

/** Playback rate of a cuelist: its own rate × the runtime rate fader */
export function cuelistRate(cl: Pick<Cuelist, 'id' | 'rate'>): number {
  return clampRate(cl.rate) * (runtimeRates.get(rateKey('cuelist', cl.id)) ?? 1)
}

/** Column scale (0-255) for an object fired from / placed on an executor */
function columnScale(kind: ExecutorTargetKind, id: string): number {
  if (columnLevels.size === 0) return 255
  let cache = columnScaleCache.get(kind)
  if (!cache) {
    cache = new Map()
    columnScaleCache.set(kind, cache)
  }
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const ex = useExecutorStore.getState()
  let ref: ExecutorRef | null = firedFrom.get(`${kind}:${id}`) ?? null
  if (ref) {
    const cell = ex.pages[ref.page]?.cells[ref.col]?.[ref.row]
    if (!cell || cell.kind !== kind || cell.id !== id) ref = null
  }
  if (!ref) ref = ex.findCell(kind, id)
  let scale = 255
  if (ref) {
    const fader = ex.pages[ref.page]?.columns[ref.col]?.fader
    if (!fader || fader.kind === 'column') scale = columnLevels.get(`${ref.page}:${ref.col}`) ?? 255
  }
  cache.set(id, scale)
  return scale
}

function scaled(level: number, scale: number): number {
  return scale >= 255 ? level : Math.round((level * scale) / 255)
}

/** Layer master of a cuelist: flash = full, else fader × column level / 255 */
function cuelistMaster(cl: Cuelist): number {
  return cl.flash ? 255 : scaled(cl.faderLevel, columnScale('cuelist', cl.id))
}

function chaseMaster(ch: Chase): number {
  return scaled(ch.faderLevel, columnScale('chase', ch.id))
}

function chasePriority(ch: Chase): number {
  return ch.priority ?? DEFAULT_CHASE_PRIORITY
}

/** Mixer layer flags of a cuelist (priority mode + held swap button) */
export function cuelistLayerFlags(cl: Pick<Cuelist, 'priorityMode'>, swap = false): number {
  let flags = 0
  if (cl.priorityMode === 'swap' || swap) flags |= LAYER_SWAP
  if (cl.priorityMode === 'super') flags |= LAYER_SUPER
  return flags
}

type LayerFlagsSink = (layerId: string, flags: number) => void

/** Default: the mixer's setLayerFlags (WP2) when it exists */
function defaultFlagsSink(layerId: string, flags: number): void {
  const fn: unknown = Reflect.get(mixer, 'setLayerFlags')
  if (typeof fn === 'function') (fn as LayerFlagsSink)(layerId, flags)
}

let flagsSink: LayerFlagsSink = defaultFlagsSink

/** Where layer flags go (integration / tests); null = the mixer's setLayerFlags */
export function setLayerFlagsHandler(fn: LayerFlagsSink | null): void {
  flagsSink = fn ?? defaultFlagsSink
}

function applyFlags(layerId: string, flags: number): void {
  if (flags === 0 && !appliedFlags.has(layerId)) return
  flagsSink(layerId, flags)
  if (flags === 0) appliedFlags.delete(layerId)
  else appliedFlags.set(layerId, flags)
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
  appliedFlags.delete(cuelistLayerId(id))
  stopEffectsWithPrefix(sceneEffectPrefix(id))
  followDue.delete(id)
  pausedCuelists.delete(id)
  manualArmed.delete(id)
}

const SNAP: CueTiming = { fadeIn: 0, fadeOut: 0, delay: 0 }

function trackOptions(cl: Cuelist): TrackOptions {
  return { tracking: cl.tracking, resolve: presetResolver() }
}

function nextCueIndex(cl: Cuelist, index: number): number {
  if (index + 1 < cl.cues.length) return index + 1
  return cl.isLooping && cl.cues.length > 1 ? 0 : -1
}

/** Target of cue `index` (tracked state + Move-In-Black pre-positions) */
function cueTarget(cl: Cuelist, index: number): { target: Map<string, number>; mib: Map<string, number> | null } {
  const opts = trackOptions(cl)
  const target = computeTrackedState(cl.cues, index, opts)
  if (!cl.mib?.enabled) return { target, mib: null }
  const mib = applyMoveInBlack(cl.cues, index, keyMeta, { ...opts, nextIndex: nextCueIndex(cl, index) })
  for (const [key, value] of mib) target.set(key, value)
  return { target, mib: mib.size > 0 ? mib : null }
}

/** Timing of a GO to `cue` (rate, per-key tables, MIB moves) */
function cueTiming(cl: Cuelist, cue: Cue, target: Map<string, number>, mib: Map<string, number> | null): CueTiming {
  const rate = cuelistRate(cl)
  const keys = new Set(target.keys())
  const current = cueEngine.getOutput(cl.id)
  if (current) for (const key of current.keys()) keys.add(key)
  let timing = buildCueTiming(cue, keys, cueKeyMeta, rate)
  if (mib && cl.mib) timing = mibTiming(timing, mib.keys(), cl.mib, keys, keyMeta, rate)
  return timing
}

function hasFollow(cue: Cue): boolean {
  return typeof cue.followTime === 'number' && Number.isFinite(cue.followTime) && cue.followTime >= 0
}

function goToCue(cl: Cuelist, wasPlaying: boolean, now: number): void {
  const cue = cl.cues[cl.currentCueIndex]
  if (!cue) return
  const snap = !wasPlaying && isFlashStarted(cl.id)
  const manual = manualArmed.delete(cl.id)
  const { target, mib } = cueTarget(cl, cl.currentCueIndex)
  cueEngine.go(cl.id, target, snap ? SNAP : cueTiming(cl, cue, target, mib), now, manual && !snap ? { manual: true } : undefined)
  followDue.delete(cl.id)
  pausedCuelists.delete(cl.id)
  // Follow counted from the GO
  if (!snap && cue.followMode === 'after-go' && hasFollow(cue)) {
    followDue.set(cl.id, now + Math.max(MIN_FOLLOW_MS, ((cue.followTime as number) * 1000) / cuelistRate(cl)))
  }
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
        if (cue) cueEngine.go(cl.id, cueTarget(cl, cl.currentCueIndex).target, SNAP, now)
      }
      if (!prev || prev.master !== master) setLayerMaster(cuelistLayerId(cl.id), master)
      if (!prev || prev.priority !== cl.priority) setLayerPriority(cuelistLayerId(cl.id), cl.priority)
      if (mixer.hasLayer(cuelistLayerId(cl.id))) applyFlags(cuelistLayerId(cl.id), cuelistLayerFlags(cl, swapHeld.has(cl.id)))
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
    xfade.delete(id)
    runtimeRates.delete(rateKey('cuelist', id))
  }
}

/**
 * Shortest time between a cue completing and the automatic GO that follows
 * it. A looping scene whose cues all have 0 fade and 0 follow would
 * otherwise GO on every mixer frame (store update per frame + flicker).
 */
export const MIN_FOLLOW_MS = 50

function onCueComplete(cuelistId: string, now: number): void {
  const cl = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)
  if (!cl || !cl.isPlaying) return
  const cue = cl.cues[cl.currentCueIndex]
  if (!cue) return
  const follow = hasFollow(cue)
  if (follow && cue.followMode === 'after-go') return // scheduled at the GO
  const isLast = cl.currentCueIndex >= cl.cues.length - 1
  if (!follow && !(isLast && cl.isLooping && cl.cues.length > 1)) return
  const followMs = follow ? ((cue.followTime as number) * 1000) / cuelistRate(cl) : 0
  followDue.set(cuelistId, now + Math.max(MIN_FOLLOW_MS, followMs))
}

// ---------------------------------------------------------------
// Live preset update
// ---------------------------------------------------------------

/** Ids of presets that differ between two preset lists (changed, added or removed) */
export function changedPresetIds(next: readonly Preset[], prev: readonly Preset[]): Set<string> {
  const changed = new Set<string>()
  const before = new Map(prev.map(p => [p.id, p]))
  for (const p of next) {
    if (before.get(p.id) !== p) changed.add(p.id)
    before.delete(p.id)
  }
  for (const id of before.keys()) changed.add(id)
  return changed
}

/** Does any cue of a cuelist reference one of these presets? */
export function cuelistReferencesPresets(cl: Cuelist, presetIds: Set<string>): boolean {
  if (presetIds.size === 0) return false
  for (const cue of cl.cues) {
    for (const cv of cue.values) if (cv?.presetId && presetIds.has(cv.presetId)) return true
  }
  return false
}

function onPresetsChanged(next: Preset[], prev: Preset[], now: number): void {
  const changed = changedPresetIds(next, prev)
  if (changed.size === 0) return
  for (const cl of usePlaybackStore.getState().cuelists) {
    if (!cueEngine.has(cl.id) || !prevCuelists.get(cl.id)?.playing) continue
    if (!cuelistReferencesPresets(cl, changed)) continue
    const { target } = cueTarget(cl, cl.currentCueIndex)
    if (cueEngine.isFading(cl.id)) cueEngine.retarget(cl.id, target, now)
    else cueEngine.go(cl.id, target, SNAP, now)
  }
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
    const master = chaseMaster(ch)
    if (playing && !prev?.playing) {
      chaseEngine.start(ch, now)
      touchLayer(chaseLayerId(ch.id), now)
    } else if (!playing && prev?.playing) {
      chaseEngine.stop(ch.id)
      removeLayer(chaseLayerId(ch.id))
    }
    if (playing) {
      if (!prev || prev.master !== master) setLayerMaster(chaseLayerId(ch.id), master)
      if (!prev || prev.priority !== chasePriority(ch)) setLayerPriority(chaseLayerId(ch.id), chasePriority(ch))
    }
    prevChases.set(ch.id, { playing, master, priority: chasePriority(ch) })
  }
  for (const id of Array.from(prevChases.keys())) {
    if (seen.has(id)) continue
    chaseEngine.stop(id)
    removeLayer(chaseLayerId(id))
    prevChases.delete(id)
    runtimeRates.delete(rateKey('chase', id))
  }
}

/** BPM a chase plays at this frame; undefined = its own BPM (fast path) */
function chaseBpm(ch: Chase): number | undefined {
  const rate = runtimeRates.get(rateKey('chase', ch.id))
  if (!ch.speedMasterId && rate === undefined) return undefined
  return effectiveBpm(ch, undefined, rate ?? 1)
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
    const layerId = cuelistLayerId(id)
    setLayer(layerId, index.toLayer(values), cl.priority, cuelistMaster(cl))
    applyFlags(layerId, cuelistLayerFlags(cl, swapHeld.has(id)))
  }
  for (const id of completed) onCueComplete(id, now)

  // Chases
  for (const ch of latest.chases) {
    if (!chaseEngine.isRunning(ch.id)) continue
    const frame = chaseEngine.update(ch, now, chaseBpm(ch))
    if (!frame) continue
    setLayer(chaseLayerId(ch.id), index.toLayer(frame.values), chasePriority(ch), chaseMaster(ch))
    if (ch.currentStepIndex !== frame.stepIndex) latest.setChaseStep(ch.id, frame.stepIndex)
  }
}

// ---------------------------------------------------------------
// Pro controls (executor buttons / column faders / command line)
// ---------------------------------------------------------------

/** Re-send every playing layer's master and flags (column levels / pages / swap changed) */
function refreshMasters(): void {
  columnScaleCache.clear()
  const { cuelists, chases } = usePlaybackStore.getState()
  for (const cl of cuelists) {
    const prev = prevCuelists.get(cl.id)
    if (!prev?.playing) continue
    const master = cuelistMaster(cl)
    if (prev.master !== master) {
      setLayerMaster(cuelistLayerId(cl.id), master)
      prev.master = master
    }
    if (mixer.hasLayer(cuelistLayerId(cl.id))) applyFlags(cuelistLayerId(cl.id), cuelistLayerFlags(cl, swapHeld.has(cl.id)))
  }
  for (const ch of chases) {
    const prev = prevChases.get(ch.id)
    if (!prev?.playing) continue
    const master = chaseMaster(ch)
    if (prev.master !== master) {
      setLayerMaster(chaseLayerId(ch.id), master)
      prev.master = master
    }
  }
}

function notifyColumns(): void {
  columnVersion++
  for (const fn of columnListeners) {
    try { fn() } catch (e) { console.error('[Playback] column listener failed:', e) }
  }
}

/** Level (0-255) of a column fader of kind 'column' — 255 until moved */
export function getColumnLevel(page: number, col: number): number {
  return columnLevels.get(`${page}:${col}`) ?? 255
}

/** Set a column level: scales the master of every scene / chase fired from (or placed in) that column */
export function setColumnLevel(page: number, col: number, level: number): void {
  const v = Math.max(0, Math.min(255, Math.round(Number.isFinite(level) ? level : 0)))
  const key = `${page}:${col}`
  if ((columnLevels.get(key) ?? 255) === v && columnLevels.has(key)) return
  columnLevels.set(key, v)
  refreshMasters()
  notifyColumns()
}

/** Column levels changed (useSyncExternalStore: subscribe + getColumnLevelsVersion) */
export function subscribeColumnLevels(fn: () => void): () => void {
  columnListeners.add(fn)
  return () => { columnListeners.delete(fn) }
}

export function getColumnLevelsVersion(): number {
  return columnVersion
}

/** Remember the executor an object was fired from (its column level scales it) */
export function noteFiredFrom(kind: ExecutorTargetKind, id: string, ref: ExecutorRef): void {
  const key = `${kind}:${id}`
  const cur = firedFrom.get(key)
  if (cur && cur.page === ref.page && cur.col === ref.col && cur.row === ref.row) return
  firedFrom.set(key, { page: ref.page, col: ref.col, row: ref.row })
  if (columnLevels.size > 0) refreshMasters()
}

/** Runtime rate of a cuelist / chase (rate fader); 1 = none */
export function setRuntimeRate(kind: 'cuelist' | 'chase', id: string, rate: number): void {
  const r = clampRate(rate)
  if (r === 1) runtimeRates.delete(rateKey(kind, id))
  else runtimeRates.set(rateKey(kind, id), r)
}

export function getRuntimeRate(kind: 'cuelist' | 'chase', id: string): number {
  return runtimeRates.get(rateKey(kind, id)) ?? 1
}

/** Hold (true) / release (false) a cuelist's swap button: its layer gets the swap flag */
export function setSwapHold(cuelistId: string, on: boolean): void {
  if (on) swapHeld.add(cuelistId)
  else swapHeld.delete(cuelistId)
  const cl = usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)
  if (cl && mixer.hasLayer(cuelistLayerId(cuelistId))) applyFlags(cuelistLayerId(cuelistId), cuelistLayerFlags(cl, on))
}

/**
 * Pause (true) / resume (false) / toggle (undefined) a playing cuelist:
 * its running fade freezes and a pending follow waits. Returns the new
 * state (false when the cuelist is not playing). A GO clears the pause.
 */
export function pauseCuelist(id: string, paused?: boolean, now: number = clockNow()): boolean {
  if (!cueEngine.has(id)) return false
  const isPaused = pausedCuelists.has(id)
  const want = paused ?? !isPaused
  if (want === isPaused) return isPaused
  if (want) {
    cueEngine.pause(id, now)
    const due = followDue.get(id)
    pausedCuelists.set(id, due === undefined ? -1 : Math.max(0, due - now))
    followDue.delete(id)
  } else {
    cueEngine.resume(id, now)
    const remaining = pausedCuelists.get(id) ?? -1
    pausedCuelists.delete(id)
    if (remaining >= 0) followDue.set(id, now + remaining)
  }
  return want
}

export function isCuelistPaused(id: string): boolean {
  return pausedCuelists.has(id)
}

/** A cuelist's crossfade is running (LED feedback) */
export function isCuelistFading(id: string): boolean {
  return cueEngine.isFading(id)
}

/** Pause / resume / toggle a running chase (holds its step). Returns the new state. */
export function pauseChase(id: string, paused?: boolean): boolean {
  return chaseEngine.setPaused(id, paused)
}

export function isChasePaused(id: string): boolean {
  return chaseEngine.isPaused(id)
}

/**
 * X-fade fader (0-255) of a cuelist: moving it away from an end starts a
 * GO whose crossfade follows the fader (0→255 or 255→0); reaching the
 * other end completes it. Per-key timing keeps its proportions.
 */
export function crossfadeFader(cuelistId: string, level: number): void {
  const v = Math.max(0, Math.min(255, Number.isFinite(level) ? level : 0))
  const state = xfade.get(cuelistId)
  if (!state) {
    xfade.set(cuelistId, { last: v, dir: 0 })
    return
  }
  const last = state.last
  state.last = v
  if (state.dir !== 0 && cueEngine.isManual(cuelistId)) {
    cueEngine.setManualProgress(cuelistId, state.dir === 1 ? v / 255 : 1 - v / 255)
    return
  }
  state.dir = 0
  const dir: 1 | -1 | 0 = last <= 0 && v > last ? 1 : last >= 255 && v < last ? -1 : 0
  if (dir === 0) return
  const pb = usePlaybackStore.getState()
  const cl = pb.cuelists.find(c => c.id === cuelistId)
  if (!cl || cl.cues.length === 0) return
  manualArmed.add(cuelistId)
  pb.goCuelist(cuelistId)
  if (!manualArmed.has(cuelistId) && cueEngine.isManual(cuelistId)) {
    state.dir = dir
    cueEngine.setManualProgress(cuelistId, dir === 1 ? v / 255 : 1 - v / 255)
  } else {
    manualArmed.delete(cuelistId) // GO not processed here (controller stopped / remote)
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
    if (s.presets !== prev.presets) onPresetsChanged(s.presets, prev.presets, t)
  })
  const unsubExecutors = useExecutorStore.subscribe((s, prev) => {
    if (columnLevels.size === 0) return
    if (s.pages !== prev.pages || s.currentPage !== prev.currentPage) refreshMasters()
  })
  const unregister = registerFrameSource('playback', onFrame, 10)

  stopFn = () => {
    unsubStore()
    unsubExecutors()
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
  pausedCuelists.clear()
  manualArmed.clear()
  xfade.clear()
  runtimeRates.clear()
  swapHeld.clear()
  appliedFlags.clear()
  firedFrom.clear()
  columnScaleCache.clear()
}
