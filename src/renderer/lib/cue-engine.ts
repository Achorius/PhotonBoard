// ============================================================
// PhotonBoard — Cue Engine
// Fade interpolation between cues using requestAnimationFrame.
// Outputs to the DMX Mixer as named layers (one per cuelist).
// ============================================================

import type { Cue, CueChannelValue } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { setLayer, removeLayer } from './dmx-mixer'

export interface FadeState {
  cuelistId: string
  fromCue: Cue | null
  toCue: Cue
  startTime: number
  fadeIn: number
  fadeOut: number
  delay: number
  progress: number // 0-1
  complete: boolean
  priority: number
  master: number
}

const activeFades: Map<string, FadeState> = new Map()
// After a fade completes, keep the final cue values as a "held" layer
const heldCues: Map<string, { cue: Cue; priority: number; master: number }> = new Map()
let animationFrame: number | null = null

/**
 * Start a crossfade from one cue to another.
 */
export function startFade(
  cuelistId: string,
  fromCue: Cue | null,
  toCue: Cue,
  priority: number = 50,
  master: number = 255
): void {
  // Remove held state — we're now fading
  heldCues.delete(cuelistId)

  activeFades.set(cuelistId, {
    cuelistId,
    fromCue,
    toCue,
    startTime: performance.now(),
    fadeIn: toCue.fadeIn * 1000,
    fadeOut: toCue.fadeOut * 1000,
    delay: toCue.delay * 1000,
    progress: 0,
    complete: false,
    priority,
    master
  })

  if (!animationFrame) {
    animationFrame = requestAnimationFrame(updateFades)
  }
}

/**
 * Stop a cuelist fade and release its mixer layer.
 */
export function stopFade(cuelistId: string): void {
  activeFades.delete(cuelistId)
  heldCues.delete(cuelistId)
  removeLayer(`cuelist:${cuelistId}`)

  if (activeFades.size === 0 && animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

export function stopAllFades(): void {
  for (const id of activeFades.keys()) {
    removeLayer(`cuelist:${id}`)
  }
  for (const id of heldCues.keys()) {
    removeLayer(`cuelist:${id}`)
  }
  activeFades.clear()
  heldCues.clear()
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

/**
 * Update the master fader level for a cuelist.
 */
export function setCuelistMaster(cuelistId: string, master: number): void {
  const fade = activeFades.get(cuelistId)
  if (fade) fade.master = master

  const held = heldCues.get(cuelistId)
  if (held) {
    held.master = master
    // Re-push held cue with new master
    pushCueToMixer(cuelistId, held.cue, held.priority, master)
  }
}

/**
 * Snap to a cue immediately (no fade). Pushes directly to mixer.
 */
export function snapToCue(cuelistId: string, cue: Cue, priority: number = 50, master: number = 255): void {
  activeFades.delete(cuelistId)
  heldCues.set(cuelistId, { cue, priority, master })
  pushCueToMixer(cuelistId, cue, priority, master)
}

export function getActiveFades(): Map<string, FadeState> {
  return new Map(activeFades)
}

// --------------- Internal ---------------

function updateFades(): void {
  const now = performance.now()

  for (const [id, fade] of activeFades) {
    const elapsed = now - fade.startTime
    const delayedElapsed = elapsed - fade.delay

    if (delayedElapsed < 0) {
      // Still in delay phase — show from cue
      if (fade.fromCue) {
        pushCueToMixer(id, fade.fromCue, fade.priority, fade.master)
      }
      continue
    }

    const fadeDuration = Math.max(fade.fadeIn, fade.fadeOut, 1)
    const progress = Math.min(1, delayedElapsed / fadeDuration)
    fade.progress = progress

    // Smooth step easing
    const t = progress * progress * (3 - 2 * progress)

    // Build interpolated values
    const fromMap = new Map<string, number>()
    if (fade.fromCue) {
      for (const cv of fade.fromCue.values) {
        fromMap.set(`${cv.fixtureId}:${cv.channelName}`, cv.value)
      }
    }

    const interpolated: CueChannelValue[] = []

    // Fade in "to" values
    for (const cv of fade.toCue.values) {
      const key = `${cv.fixtureId}:${cv.channelName}`
      const fromVal = fromMap.get(key) ?? 0
      const value = Math.round(fromVal + (cv.value - fromVal) * t)
      interpolated.push({ fixtureId: cv.fixtureId, channelName: cv.channelName, value })
      fromMap.delete(key)
    }

    // Fade out channels only in "from"
    for (const [key, fromVal] of fromMap) {
      const fadeOutProgress = Math.min(1, delayedElapsed / Math.max(fade.fadeOut, 1))
      const tOut = fadeOutProgress * fadeOutProgress * (3 - 2 * fadeOutProgress)
      const [fixtureId, channelName] = key.split(':')
      interpolated.push({ fixtureId, channelName, value: Math.round(fromVal * (1 - tOut)) })
    }

    // Push to mixer
    const layerChannels = cueValuesToChannels(interpolated)
    setLayer(`cuelist:${id}`, layerChannels, fade.priority, fade.master)

    if (progress >= 1) {
      fade.complete = true
      activeFades.delete(id)
      // Hold final state
      heldCues.set(id, { cue: fade.toCue, priority: fade.priority, master: fade.master })
    }
  }

  // Also re-push held cues (in case master changed via mixer)
  // This is lightweight since we only create the Map, mixer does the diff
  // Actually we skip this — held cues are static and only re-pushed on master change

  if (activeFades.size > 0) {
    animationFrame = requestAnimationFrame(updateFades)
  } else {
    animationFrame = null
  }
}

function pushCueToMixer(cuelistId: string, cue: Cue, priority: number, master: number): void {
  const layerChannels = cueValuesToChannels(cue.values)
  setLayer(`cuelist:${cuelistId}`, layerChannels, priority, master)
}

function cueValuesToChannels(values: CueChannelValue[]): Map<number, Map<number, number>> {
  const result = new Map<number, Map<number, number>>()
  const patchStore = usePatchStore.getState()

  for (const cv of values) {
    const entry = patchStore.patch.find(p => p.id === cv.fixtureId)
    if (!entry) continue

    const def = patchStore.fixtures.find(f => f.id === entry.fixtureDefId)
    if (!def) continue

    const mode = def.modes.find(m => m.name === entry.modeName)
    if (!mode) continue

    const chIndex = mode.channels.findIndex(
      ch => ch.toLowerCase() === cv.channelName.toLowerCase()
    )
    if (chIndex === -1) continue

    const absChannel = entry.address - 1 + chIndex
    if (absChannel < 0 || absChannel >= 512) continue

    let uniMap = result.get(entry.universe)
    if (!uniMap) {
      uniMap = new Map()
      result.set(entry.universe, uniMap)
    }
    uniMap.set(absChannel, cv.value)
  }

  return result
}
