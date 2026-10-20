// ============================================================
// PhotonBoard — Show I/O
// (De)serialisation of the whole console state and the user-facing
// New / Open / Save / Save As actions, usable from anywhere (menu,
// toolbar, Settings, remote commands).
//
// Every action resolves to a ShowIoResult — it never throws — and
// updates the status bar, the show name and the dirty flag. A closed
// dialog is reported as 'canceled', distinct from an 'error'.
//
// Loading a show (file, startup, remote upload) always:
//   1. normalises it (src/shared/show-format.ts) — may refuse it,
//   2. stops all playback, chases, timeline, effects, follow, clears
//      the programmer and resets the mixer,
//   3. replaces every store — nothing from the previous show leaks,
//      and nothing starts playing by itself.
// ============================================================

import type { Chase, Cuelist, Effect, ShowFile, ShowTimeline } from '@shared/types'
import { createEmptyShow, normalizeShow, SHOW_FORMAT_VERSION } from '@shared/show-format'
import type { ShowLoadResult, ShowSaveResult } from '@shared/photonboard-api'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useFollowStore } from '@renderer/stores/follow-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { resetMixer } from './dmx-mixer'
import { resetPlayback } from './playback-controller'
import {
  getTimelineState, onTimelineSettingsChange, resetTimeline, setTimelineLooping, setTimelineTotalDuration
} from './timeline-engine'
import {
  enableTimecode, getTimecodeDropoutMs, getTimecodeFramerate, getTimecodeOffset, isTimecodeChase, isTimecodeEnabled,
  onTimecodeSettingsChange, setTimecodeChase, setTimecodeDropoutMs, setTimecodeFramerate, setTimecodeOffset
} from './timecode-engine'
import { stopAllEffects } from './effect-engine'
import { getBridge, isRemoteMode, runRemotePreflight } from './runtime'
import { t } from '@renderer/i18n'

export type ShowIoStatus = 'ok' | 'canceled' | 'error' | 'busy'

export interface ShowIoResult {
  status: ShowIoStatus
  /** Show name after the operation */
  name?: string
  path?: string
  /** Human-readable reason when status is 'error' */
  error?: string
  /** Non-fatal remarks (recovered from backup, cleaned-up data…) */
  warnings?: string[]
}

let busy = false
let createdAt: string | null = null
const appliedListeners = new Set<(show: ShowFile) => void>()
/** >0 while a show is being applied: store changes are not user edits */
let applying = 0

// ---------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------

function stripCuelistRuntime(cl: Cuelist): Cuelist {
  const { goGeneration: _gen, ...rest } = cl
  return {
    ...rest,
    currentCueIndex: -1,
    isPlaying: false,
    flash: false,
    effectSnapshots: cl.effectSnapshots?.map(e => ({ ...e, isRunning: false }))
  }
}

function stripChaseRuntime(ch: Chase): Chase {
  return { ...ch, isPlaying: false, currentStepIndex: 0 }
}

function stripEffectRuntime(e: Effect): Effect {
  return { ...e, isRunning: false }
}

/** Snapshot of the current show (no runtime state, no DMX output config). */
export function collectShowData(): ShowFile {
  const { patch, groups } = usePatchStore.getState()
  const pb = usePlaybackStore.getState()
  const now = new Date().toISOString()
  return {
    version: String(SHOW_FORMAT_VERSION),
    name: useUiStore.getState().showName,
    createdAt: createdAt ?? now,
    modifiedAt: now,
    patch: patch.map(p => ({ ...p, groupIds: [...p.groupIds] })),
    groups: groups.map(g => ({ ...g, fixtureIds: [...g.fixtureIds] })),
    presets: pb.presets.map(p => ({ ...p })),
    cuelists: pb.cuelists.map(stripCuelistRuntime),
    chases: pb.chases.map(stripChaseRuntime),
    effects: useEffectsStore.getState().effects.map(stripEffectRuntime),
    midiMappings: useMidiStore.getState().mappings.map(m => ({ ...m })),
    stageLayout: { width: 1200, height: 600, fixtures: [] },
    roomConfig: { ...useVisualizerStore.getState().roomConfig },
    timeline: {
      clips: [...pb.timelineClips],
      markers: [...pb.timelineMarkers],
      zones: [...pb.timelineZones],
      trackCount: pb.timelineTrackCount,
      trackNames: [...pb.timelineTrackNames],
      length: getTimelineState().totalDuration,
      loop: getTimelineState().isLooping,
      timecode: {
        source: isTimecodeEnabled() ? 'mtc' : 'internal',
        fps: getTimecodeFramerate(),
        chase: isTimecodeChase(),
        dropoutMs: getTimecodeDropoutMs(),
        offset: getTimecodeOffset()
      }
    },
    executor: useExecutorStore.getState().getLayout()
  }
}

/** Timeline length / loop and timecode settings (engine state, saved with the show) */
function applyTimelineSettings(tl: ShowTimeline): void {
  if (tl.length !== undefined) setTimelineTotalDuration(tl.length)
  setTimelineLooping(tl.loop ?? false)
  // Remote browsers only display the console's timeline: no MIDI timecode input there
  const tc = tl.timecode
  if (!tc || isRemoteMode()) return
  setTimecodeFramerate(tc.fps)
  setTimecodeChase(tc.chase)
  setTimecodeDropoutMs(tc.dropoutMs)
  setTimecodeOffset(tc.offset)
  enableTimecode(tc.source === 'mtc')
}

/**
 * Stop everything that produces light: playback, chases, timeline, effects,
 * follow, programmer; reset the mixer to the patch defaults.
 */
export function resetRuntimeState(): void {
  if (!isRemoteMode()) {
    resetPlayback()
    resetTimeline()
    stopAllEffects()
  }
  useFollowStore.getState().reset()
  resetMixer() // removes every layer, programmer included
}

/**
 * Replace the whole console state with a show. Throws (with a readable
 * message) when the data is not a show. Never starts playback.
 */
export function applyShowData(raw: unknown, opts: { name?: string } = {}): { show: ShowFile; warnings: string[] } {
  const { show, warnings } = normalizeShow(raw)
  if (opts.name) show.name = opts.name

  applying++
  try {
    resetRuntimeState()

    const patchStore = usePatchStore.getState()
    patchStore.setPatch(show.patch)
    patchStore.setGroups(show.groups)
    patchStore.clearSelection()

    const pb = usePlaybackStore.getState()
    pb.setCuelists(show.cuelists)
    pb.setChases(show.chases)
    pb.setPresets(show.presets)
    const tl = show.timeline!
    pb.setTimelineClips(tl.clips)
    pb.setTimelineMarkers(tl.markers)
    pb.setTimelineZones(tl.zones)
    pb.setTimelineTrackCount(tl.trackCount)
    pb.setTimelineTrackNames(tl.trackNames ?? [])
    applyTimelineSettings(tl)

    useEffectsStore.getState().setEffects(show.effects)
    useMidiStore.getState().setMappings(show.midiMappings)
    useVisualizerStore.getState().setRoomConfig(show.roomConfig!)
    useVisualizerStore.getState().selectFixture(null)

    const cuelistIds = show.cuelists.map(c => c.id)
    const executor = useExecutorStore.getState()
    executor.loadLayout(show.executor, cuelistIds)
    executor.syncCuelists(cuelistIds) // place scenes that have no slot yet (v1 shows)

    const ui = useUiStore.getState()
    ui.setShowName(show.name)
    ui.setDirty(false)
    createdAt = show.createdAt
  } finally {
    applying--
  }

  if (warnings.length > 0) console.warn('[Show] Loaded with warnings:', warnings)
  for (const listener of appliedListeners) {
    try { listener(show) } catch (e) { console.error('[Show] applied listener failed:', e) }
  }
  return { show, warnings }
}

/** Called after every show is applied (load, new, upload, remote adopt). Returns an unsubscribe fn. */
export function onShowApplied(listener: (show: ShowFile) => void): () => void {
  appliedListeners.add(listener)
  return () => { appliedListeners.delete(listener) }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** "…/Shows/My Show.pbshow" → "My Show" */
export function showNameFromPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const base = path.split(/[\\/]/).pop() ?? ''
  const name = base.replace(/\.pbshow$/i, '').trim()
  return name || undefined
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : t('file.errors.unknown')
}

/** Operation names shown in status messages ("Save failed: …") */
type ShowOp = 'save' | 'saveAs' | 'open' | 'newShow' | 'autoLoad' | 'upload'
const opLabel = (op: ShowOp) => t(`file.ops.${op}`)

function status(message: string, type: 'info' | 'success' | 'error', duration = 3000): void {
  useUiStore.getState().showStatus(message, type, duration)
}

async function exclusive(op: ShowOp, fn: () => Promise<ShowIoResult>): Promise<ShowIoResult> {
  if (busy) {
    status(t('file.busy'), 'info', 2000)
    return { status: 'busy' }
  }
  busy = true
  try {
    return await fn()
  } catch (e) {
    const error = errorMessage(e)
    console.error(`[Show] ${op} failed:`, e)
    status(t('file.failed', { op: opLabel(op), error }), 'error', 5000)
    return { status: 'error', error }
  } finally {
    busy = false
  }
}

function requireBridge() {
  const bridge = getBridge()
  if (!bridge) throw new Error(t('file.errors.notConnected'))
  return bridge
}

/** Apply a load result coming from main; reports errors / cancel / warnings. */
async function adoptLoadResult(result: ShowLoadResult | null | undefined, op: ShowOp): Promise<ShowIoResult> {
  if (!result || result.canceled) {
    status(t('file.canceled', { op: opLabel(op) }), 'info', 2000)
    return { status: 'canceled' }
  }
  if (!result.success || !result.show) {
    const error = result.error || t('file.errors.unreadable')
    status(t('file.failed', { op: opLabel(op), error }), 'error', 5000)
    return { status: 'error', error }
  }
  let applied: { show: ShowFile; warnings: string[] }
  try {
    applied = applyShowData(result.show, { name: showNameFromPath(result.path) })
  } catch (e) {
    const error = errorMessage(e)
    status(t('file.failed', { op: opLabel(op), error }), 'error', 5000)
    return { status: 'error', error }
  }
  await refreshFixtureLibrary()

  const warnings = [...(result.warning ? [result.warning] : []), ...applied.warnings]
  const name = applied.show.name
  if (warnings.length > 1) {
    status(t('file.loadedWithWarnings', { name, warning: warnings[0], count: warnings.length - 1 }), 'info', 6000)
  } else if (warnings.length === 1) {
    status(t('file.loadedWithWarning', { name, warning: warnings[0] }), 'info', 6000)
  } else {
    status(t('file.loaded', { name }), 'success', 2500)
  }
  return { status: 'ok', name: applied.show.name, path: result.path, warnings }
}

async function refreshFixtureLibrary(): Promise<void> {
  try {
    await usePatchStore.getState().loadFixtures()
  } catch (e) {
    console.warn('[Show] Fixture library refresh failed:', e)
  }
}

// ---------------------------------------------------------------
// User actions
// ---------------------------------------------------------------

export function hasUnsavedChanges(): boolean {
  return useUiStore.getState().isDirty
}

export interface SaveShowOptions {
  /** Ask for a file name (Electron dialog) / save under `name` (remote) */
  saveAs?: boolean
  /** Remote Save As: show name to save under */
  name?: string
  /** Remote Save As: replace an existing show of that name */
  overwrite?: boolean
  /** Answer to a main-process 'save-show' request (remote client pressed Save) */
  requestId?: string
}

/** Save the current show (Save, or Save As with `saveAs`). */
export function saveShow(opts: SaveShowOptions = {}): Promise<ShowIoResult> {
  const op: ShowOp = opts.saveAs ? 'saveAs' : 'save'
  return exclusive(op, async () => {
    const bridge = requireBridge()
    // Remote: the console saves ITS show — send our pending edits first (same socket, in order)
    runRemotePreflight()
    status(opts.saveAs ? t('file.savingAs') : t('file.saving'), 'info', 0)
    const show = collectShowData()
    let result: ShowSaveResult | null
    if (opts.saveAs) {
      result = await bridge.show.saveAs(show, { name: opts.name, overwrite: opts.overwrite })
    } else {
      result = await bridge.show.save(show, opts.requestId ? { requestId: opts.requestId } : undefined)
    }
    if (!result || result.canceled) {
      status(t('file.canceled', { op: opLabel(op) }), 'info', 2000)
      return { status: 'canceled' }
    }
    if (!result.success) {
      const error = result.exists
        ? t('file.errors.exists')
        : result.error || t('file.errors.notWritten')
      status(t('file.failed', { op: opLabel(op), error }), 'error', 5000)
      return { status: 'error', error }
    }
    const name = showNameFromPath(result.path) ?? show.name
    const ui = useUiStore.getState()
    ui.setShowName(name)
    ui.setDirty(false)
    status(t('file.saved', { name }), 'success', 2500)
    return { status: 'ok', name, path: result.path }
  })
}

/** Open a show with the file dialog (Electron only). */
export function openShow(): Promise<ShowIoResult> {
  return exclusive('open', async () => {
    if (isRemoteMode()) {
      const error = t('file.errors.remoteOpen')
      status(error, 'info', 3000)
      return { status: 'error', error }
    }
    status(t('file.opening'), 'info', 0)
    return adoptLoadResult(await requireBridge().show.load(), 'open')
  })
}

/** Names of the shows in the shows folder(s). */
export async function listShows(): Promise<string[]> {
  try {
    const names = await requireBridge().show.list()
    return Array.isArray(names) ? names.filter(n => typeof n === 'string') : []
  } catch (e) {
    console.warn('[Show] list failed:', e)
    return []
  }
}

/**
 * Open a show from the shows folder by name. On the remote this also makes
 * the console (Pi) load it.
 */
export function openShowByName(name: string): Promise<ShowIoResult> {
  return exclusive('open', async () => {
    status(t('file.openingName', { name }), 'info', 0)
    const result = await requireBridge().show.loadByName(name, { apply: isRemoteMode() })
    return adoptLoadResult(result, 'open')
  })
}

/** Start a new empty show (patch, scenes, timeline… everything cleared). */
export function newShow(): Promise<ShowIoResult> {
  return exclusive('newShow', async () => {
    if (isRemoteMode()) {
      const error = t('file.errors.remoteNew')
      status(error, 'info', 3000)
      return { status: 'error', error }
    }
    const fresh = await requireBridge().show.new()
    const { show } = applyShowData(fresh ?? createEmptyShow(t('file.defaultShowName')), { name: fresh?.name || t('file.defaultShowName') })
    status(t('file.newShowDone'), 'success', 2000)
    return { status: 'ok', name: show.name }
  })
}

/** Startup: reload the last show if there is one (silent when there is none). */
export function loadLastShow(): Promise<ShowIoResult> {
  return exclusive('autoLoad', async () => {
    const result = await requireBridge().show.loadLast()
    if (!result || (!result.success && !result.error)) return { status: 'canceled' }
    return adoptLoadResult(result, 'autoLoad')
  })
}

/** Remote: upload a .pbshow from the browser; the console adopts it. */
export function uploadShowFile(file: File, opts: { overwrite?: boolean } = {}): Promise<ShowIoResult> {
  return exclusive('upload', async () => {
    status(t('file.uploading'), 'info', 0)
    const text = await file.text()
    normalizeShow(text) // refuse obvious garbage before sending it
    const result = await requireBridge().show.upload(text, file.name, opts)
    return adoptLoadResult(result, 'upload')
  })
}

/**
 * Adopt a show that main already loaded on behalf of a remote client
 * ('apply-show' command). Never throws.
 */
export async function adoptRemoteShow(raw: unknown): Promise<ShowIoResult> {
  try {
    const { show, warnings } = applyShowData(raw)
    await refreshFixtureLibrary()
    status(t('file.remoteShowLoaded', { name: show.name }), 'success', 3000)
    return { status: 'ok', name: show.name, warnings }
  } catch (e) {
    const error = errorMessage(e)
    status(t('file.remoteShowRefused', { error }), 'error', 5000)
    return { status: 'error', error }
  }
}

// ---------------------------------------------------------------
// Dirty tracking
// ---------------------------------------------------------------

function sameList<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !same(a[i], b[i])) return false
  }
  return true
}

const sameCuelist = (a: Cuelist, b: Cuelist) =>
  a.id === b.id && a.name === b.name && a.cues === b.cues && a.isLooping === b.isLooping &&
  a.priority === b.priority && a.faderLevel === b.faderLevel && a.effectSnapshots === b.effectSnapshots

const sameChase = (a: Chase, b: Chase) =>
  a.id === b.id && a.name === b.name && a.steps === b.steps && a.isLooping === b.isLooping &&
  a.bpm === b.bpm && a.fadePercent === b.fadePercent && a.direction === b.direction &&
  a.faderLevel === b.faderLevel && a.priority === b.priority

const sameEffect = (a: Effect, b: Effect) =>
  JSON.stringify(stripEffectRuntime(a)) === JSON.stringify(stripEffectRuntime(b))

/**
 * Mark the show dirty whenever show data (not runtime state such as playing
 * scenes or a running effect) changes. Returns an uninstall function.
 */
export function installDirtyTracking(): () => void {
  const markDirty = () => {
    if (applying > 0) return
    const ui = useUiStore.getState()
    if (!ui.isDirty) ui.setDirty(true)
  }
  const unsubs = [
    usePatchStore.subscribe((s, p) => {
      if (s.patch !== p.patch || s.groups !== p.groups) markDirty()
    }),
    usePlaybackStore.subscribe((s, p) => {
      if (
        !sameList(s.cuelists, p.cuelists, sameCuelist) ||
        !sameList(s.chases, p.chases, sameChase) ||
        s.presets !== p.presets ||
        s.timelineClips !== p.timelineClips ||
        s.timelineMarkers !== p.timelineMarkers ||
        s.timelineZones !== p.timelineZones ||
        s.timelineTrackCount !== p.timelineTrackCount ||
        s.timelineTrackNames !== p.timelineTrackNames
      ) markDirty()
    }),
    useEffectsStore.subscribe((s, p) => {
      if (!sameList(s.effects, p.effects, sameEffect)) markDirty()
    }),
    useMidiStore.subscribe((s, p) => {
      if (s.mappings !== p.mappings) markDirty()
    }),
    useVisualizerStore.subscribe((s, p) => {
      if (s.roomConfig !== p.roomConfig) markDirty()
    }),
    useExecutorStore.subscribe((s, p) => {
      if (s.grid !== p.grid || s.columns !== p.columns || s.modes !== p.modes) markDirty()
    }),
    onTimelineSettingsChange(markDirty),
    onTimecodeSettingsChange(markDirty)
  ]
  return () => { for (const u of unsubs) u() }
}

/** True while a show is applied or state mirrored from the console is written: not a user edit. */
export function isApplyingShow(): boolean {
  return applying > 0
}

/** Run `fn` without marking the show dirty (e.g. state mirrored from the Pi). */
export function withoutDirtyTracking<T>(fn: () => T): T {
  applying++
  try {
    return fn()
  } finally {
    applying--
  }
}
