// ============================================================
// PhotonBoard — Timeline Engine
// Global playback engine for the DAW-style timeline.
// Runs independently of which tab is displayed, on the mixer clock.
//
// The timeline only ever touches what IT started: each active clip
// owns the layer "timeline_<clipId>" and the effects whose ids start
// with "timeline_<clipId>_". Seeking, looping and stopping release
// exactly those — live effects and cuelist fades are never touched.
// ============================================================

import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { setLayer, setLayerMaster, removeLayer, registerFrameSource } from './dmx-mixer'
import { startEffect, stopEffectsWithPrefix } from './effect-engine'
import { computeTrackedState } from './cue-engine'
import { getFixtureIndex } from './fixture-index'
import { clockNow, isRemoteMode, sendRemoteCommand, sendRemoteCommandThrottled } from './runtime'
import type { TimelineClip } from '@shared/types'

export const TIMELINE_LAYER_PREFIX = 'timeline_'
const TIMELINE_LAYER_PRIORITY = 50

let lastTime = 0
const activeClipIds = new Set<string>()

// ── State stored globally (survives tab switches) ──
let _isPlaying = false
let _currentTime = 0
let _isLooping = false
let _totalDuration = 120
let _onUpdate: ((time: number, playing: boolean) => void) | null = null
const stateListeners = new Set<(playing: boolean) => void>()

/** Single UI callback (LiveView playhead). Replaces the previous one. */
export function setTimelineUpdateCallback(cb: (time: number, playing: boolean) => void) {
  _onUpdate = cb
}

/** Listen for play/stop changes (state broadcast, toolbar). Returns an unsubscribe fn. */
export function onTimelinePlayStateChange(listener: (playing: boolean) => void): () => void {
  stateListeners.add(listener)
  return () => { stateListeners.delete(listener) }
}

function setPlaying(playing: boolean): void {
  if (_isPlaying === playing) return
  _isPlaying = playing
  for (const l of stateListeners) {
    try { l(playing) } catch (e) { console.error('[Timeline] listener failed:', e) }
  }
}

export function getTimelineState() {
  return { isPlaying: _isPlaying, currentTime: _currentTime, isLooping: _isLooping, totalDuration: _totalDuration }
}

export function setTimelineLooping(v: boolean) { _isLooping = v }
export function setTimelineTotalDuration(v: number) {
  if (Number.isFinite(v)) _totalDuration = Math.max(10, v)
}

function clipLayerId(clipId: string): string {
  return `${TIMELINE_LAYER_PREFIX}${clipId}`
}

function clipEffectPrefix(clipId: string): string {
  return `${TIMELINE_LAYER_PREFIX}${clipId}_`
}

function isClipActiveAt(clip: TimelineClip, t: number): boolean {
  return t >= clip.startTime && t < clip.startTime + clip.duration
}

function hasFades(clip: TimelineClip): boolean {
  return (clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0
}

/** Level 0…1 of a clip at time `t` from its fade-in / fade-out ramps (1 without fades). */
export function clipFadeLevel(clip: Pick<TimelineClip, 'startTime' | 'duration' | 'fadeIn' | 'fadeOut'>, t: number): number {
  const end = clip.startTime + clip.duration
  if (t < clip.startTime || t >= end) return 0
  let level = 1
  const fadeIn = clip.fadeIn ?? 0
  const fadeOut = clip.fadeOut ?? 0
  if (fadeIn > 0) level = Math.min(level, (t - clip.startTime) / fadeIn)
  if (fadeOut > 0) level = Math.min(level, (end - t) / fadeOut)
  return Math.max(0, Math.min(1, level))
}

function triggerClip(clip: TimelineClip, t: number) {
  const cuelist = usePlaybackStore.getState().cuelists.find(c => c.id === clip.cuelistId)
  activeClipIds.add(clip.id)
  if (!cuelist || cuelist.cues.length === 0) return

  const { patch, fixtures } = usePatchStore.getState()
  const index = getFixtureIndex(patch, fixtures)
  const state = computeTrackedState(cuelist.cues, cuelist.cues.length - 1)
  const master = hasFades(clip) ? clipFadeLevel(clip, t) * 255 : 255
  setLayer(clipLayerId(clip.id), index.toLayer(state), TIMELINE_LAYER_PRIORITY, master)

  for (const fx of cuelist.effectSnapshots ?? []) {
    // Own id per clip instance: releasing the clip never kills a live effect
    startEffect({ ...fx, id: `${clipEffectPrefix(clip.id)}${fx.id}`, isRunning: true }, { restart: true })
  }
}

function releaseClip(clipId: string) {
  stopEffectsWithPrefix(clipEffectPrefix(clipId))
  removeLayer(clipLayerId(clipId))
  activeClipIds.delete(clipId)
}

function releaseAllClips() {
  for (const clipId of Array.from(activeClipIds)) releaseClip(clipId)
}

/** Trigger/release clips so that exactly the clips active at `t` are running. */
function syncClips(t: number) {
  const clips = usePlaybackStore.getState().timelineClips
  const known = new Set<string>()
  for (const clip of clips) {
    known.add(clip.id)
    const wasActive = activeClipIds.has(clip.id)
    const isActive = isClipActiveAt(clip, t)
    if (isActive && !wasActive) triggerClip(clip, t)
    else if (!isActive && wasActive) releaseClip(clip.id)
    else if (isActive && hasFades(clip)) setLayerMaster(clipLayerId(clip.id), clipFadeLevel(clip, t) * 255)
  }
  // Clips deleted while active
  for (const clipId of Array.from(activeClipIds)) {
    if (!known.has(clipId)) releaseClip(clipId)
  }
}

/** Seek. Releases the clips that were running; while playing, starts the ones at `t`. */
export function setTimelineTime(t: number) {
  if (!Number.isFinite(t)) return
  if (isRemoteMode()) {
    sendRemoteCommandThrottled('timelineTime', 'set-timeline-time', t, 100)
    return
  }
  _currentTime = Math.max(0, t)
  releaseAllClips()
  if (_isPlaying) syncClips(_currentTime)
  _onUpdate?.(_currentTime, _isPlaying)
}

/** Advance the playhead to `now` (mixer frame source). */
export function tickTimeline(now: number) {
  if (!_isPlaying) return

  const dt = Math.max(0, now - lastTime) / 1000
  lastTime = now
  _currentTime += dt

  syncClips(_currentTime)

  const clips = usePlaybackStore.getState().timelineClips
  const maxEnd = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), _totalDuration)
  if (_currentTime >= maxEnd) {
    if (_isLooping) {
      _currentTime = 0
      releaseAllClips()
      syncClips(0)
    } else {
      stopTimeline()
      return
    }
  }

  _onUpdate?.(_currentTime, _isPlaying)
}

export function startTimeline() {
  if (isRemoteMode()) {
    sendRemoteCommand('start-timeline')
    return
  }
  if (_isPlaying) return
  setPlaying(true)
  lastTime = clockNow()
  releaseAllClips()
  syncClips(_currentTime)
  _onUpdate?.(_currentTime, _isPlaying)
}

export function stopTimeline() {
  if (isRemoteMode()) {
    sendRemoteCommand('stop-timeline')
    return
  }
  setPlaying(false)
  // Release only what the timeline started; fixtures return to the other sources
  releaseAllClips()
  _onUpdate?.(_currentTime, _isPlaying)
}

export function toggleTimeline() {
  if (isRemoteMode()) {
    sendRemoteCommand('toggle-timeline')
    return
  }
  if (_isPlaying) stopTimeline()
  else startTimeline()
}

export function rewindTimeline() {
  if (isRemoteMode()) {
    sendRemoteCommand('rewind-timeline')
    return
  }
  _currentTime = 0
  releaseAllClips()
  if (_isPlaying) {
    lastTime = clockNow()
    syncClips(0)
  }
  _onUpdate?.(_currentTime, _isPlaying)
}

/** Stop and rewind without notifying remote peers (show load / new show). */
export function resetTimeline() {
  setPlaying(false)
  releaseAllClips()
  _currentTime = 0
  _onUpdate?.(_currentTime, _isPlaying)
}

export function getActiveClipIds(): Set<string> {
  return new Set(activeClipIds)
}

registerFrameSource('timeline', tickTimeline, 20)
