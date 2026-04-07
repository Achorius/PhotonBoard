// ============================================================
// PhotonBoard — Timeline Engine
// Global playback engine for the DAW-style timeline.
// Runs independently of which tab is displayed.
// ============================================================

import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { useDmxStore } from '../stores/dmx-store'
import { startEffect, stopEffect, stopAllEffects } from './effect-engine'
import { stopAllFades } from './cue-engine'
import type { TimelineClip } from '@shared/types'

let raf: number | null = null
let lastTime = 0
const activeClipIds = new Set<string>()

// ── State stored globally (survives tab switches) ──
let _isPlaying = false
let _currentTime = 0
let _isLooping = false
let _totalDuration = 120
let _onUpdate: ((time: number, playing: boolean) => void) | null = null

export function setTimelineUpdateCallback(cb: (time: number, playing: boolean) => void) {
  _onUpdate = cb
}

export function getTimelineState() {
  return { isPlaying: _isPlaying, currentTime: _currentTime, isLooping: _isLooping, totalDuration: _totalDuration }
}

export function setTimelineLooping(v: boolean) { _isLooping = v }
export function setTimelineTotalDuration(v: number) { _totalDuration = Math.max(10, v) }

export function setTimelineTime(t: number) {
  _currentTime = Math.max(0, t)
  activeClipIds.clear()
  _onUpdate?.(_currentTime, _isPlaying)
}

function triggerClip(clip: TimelineClip) {
  const store = usePlaybackStore.getState()
  const cuelist = store.cuelists.find(c => c.id === clip.cuelistId)
  if (!cuelist || cuelist.cues.length === 0) return

  const patchStore = usePatchStore.getState()
  const dmxStore = useDmxStore.getState()

  for (const cue of cuelist.cues) {
    for (const cv of cue.values) {
      const entry = patchStore.patch.find(p => p.id === cv.fixtureId)
      if (!entry) continue
      const channels = patchStore.getFixtureChannels(entry)
      const ch = channels.find((c: any) => c.name === cv.channelName)
      if (ch) dmxStore.setChannel(entry.universe, ch.absoluteChannel, cv.value)
    }
  }

  if (cuelist.effectSnapshots) {
    for (const fx of cuelist.effectSnapshots) {
      startEffect({ ...fx, isRunning: true })
    }
  }
}

function releaseClip(clip: TimelineClip) {
  const store = usePlaybackStore.getState()
  const cuelist = store.cuelists.find(c => c.id === clip.cuelistId)
  if (!cuelist) return
  if (cuelist.effectSnapshots) {
    for (const fx of cuelist.effectSnapshots) {
      stopEffect(fx.id)
    }
  }
}

function tick() {
  if (!_isPlaying) return

  const now = performance.now()
  const dt = (now - lastTime) / 1000
  lastTime = now

  _currentTime += dt
  const clips = usePlaybackStore.getState().timelineClips

  for (const clip of clips) {
    const wasActive = activeClipIds.has(clip.id)
    const isActive = _currentTime >= clip.startTime && _currentTime < clip.startTime + clip.duration
    if (isActive && !wasActive) {
      triggerClip(clip)
      activeClipIds.add(clip.id)
    }
    if (!isActive && wasActive) {
      releaseClip(clip)
      activeClipIds.delete(clip.id)
    }
  }

  // End of timeline
  const maxEnd = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), _totalDuration)
  if (_currentTime >= maxEnd) {
    if (_isLooping) {
      _currentTime = 0
      activeClipIds.clear()
      stopAllEffects()
    } else {
      stopTimeline()
    }
  }

  _onUpdate?.(_currentTime, _isPlaying)
  if (_isPlaying) {
    raf = requestAnimationFrame(tick)
  }
}

export function startTimeline() {
  if (_isPlaying) return
  _isPlaying = true
  lastTime = performance.now()

  // Trigger clips that are already active at current time
  const clips = usePlaybackStore.getState().timelineClips
  activeClipIds.clear()
  for (const clip of clips) {
    if (_currentTime >= clip.startTime && _currentTime < clip.startTime + clip.duration) {
      triggerClip(clip)
      activeClipIds.add(clip.id)
    }
  }

  _onUpdate?.(_currentTime, _isPlaying)
  raf = requestAnimationFrame(tick)
}

export function stopTimeline() {
  _isPlaying = false
  if (raf) {
    cancelAnimationFrame(raf)
    raf = null
  }
  activeClipIds.clear()
  stopAllEffects()
  stopAllFades()
  _onUpdate?.(_currentTime, _isPlaying)
}

export function toggleTimeline() {
  if (_isPlaying) stopTimeline()
  else startTimeline()
}

export function rewindTimeline() {
  _currentTime = 0
  activeClipIds.clear()
  stopAllEffects()
  _onUpdate?.(_currentTime, _isPlaying)
}

export function getActiveClipIds(): Set<string> {
  return new Set(activeClipIds)
}
