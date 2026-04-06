// ============================================================
// PhotonBoard — Cue Engine
// Fade interpolation between cues using requestAnimationFrame.
// Writes directly to DMX store.
// ============================================================

import type { Cue } from '@shared/types'

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
}

const activeFades: Map<string, FadeState> = new Map()
let animationFrame: number | null = null
let onUpdate: ((values: Map<string, Map<string, number>>) => void) | null = null
let onComplete: ((cuelistId: string) => void) | null = null

export function setFadeUpdateCallback(cb: (values: Map<string, Map<string, number>>) => void): void {
  onUpdate = cb
}

export function setFadeCompleteCallback(cb: (cuelistId: string) => void): void {
  onComplete = cb
}

export function startFade(
  cuelistId: string,
  fromCue: Cue | null,
  toCue: Cue
): void {
  activeFades.set(cuelistId, {
    cuelistId,
    fromCue,
    toCue,
    startTime: performance.now(),
    fadeIn: toCue.fadeIn * 1000,
    fadeOut: toCue.fadeOut * 1000,
    delay: toCue.delay * 1000,
    progress: 0,
    complete: false
  })

  if (!animationFrame) {
    animationFrame = requestAnimationFrame(updateFades)
  }
}

export function stopFade(cuelistId: string): void {
  activeFades.delete(cuelistId)
  if (activeFades.size === 0 && animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

export function stopAllFades(): void {
  activeFades.clear()
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

function updateFades(): void {
  const now = performance.now()
  const allValues = new Map<string, Map<string, number>>()

  for (const [id, fade] of activeFades) {
    const elapsed = now - fade.startTime
    const delayedElapsed = elapsed - fade.delay

    if (delayedElapsed < 0) {
      // Still in delay phase — use from values
      if (fade.fromCue) {
        const vals = new Map<string, number>()
        for (const cv of fade.fromCue.values) {
          vals.set(`${cv.fixtureId}:${cv.channelName}`, cv.value)
        }
        allValues.set(id, vals)
      }
      continue
    }

    const fadeDuration = Math.max(fade.fadeIn, fade.fadeOut, 1)
    const progress = Math.min(1, delayedElapsed / fadeDuration)
    fade.progress = progress

    const vals = new Map<string, number>()

    // Build "from" lookup
    const fromMap = new Map<string, number>()
    if (fade.fromCue) {
      for (const cv of fade.fromCue.values) {
        fromMap.set(`${cv.fixtureId}:${cv.channelName}`, cv.value)
      }
    }

    // Interpolate to "to" values
    for (const cv of fade.toCue.values) {
      const key = `${cv.fixtureId}:${cv.channelName}`
      const fromVal = fromMap.get(key) ?? 0
      const toVal = cv.value

      // Ease function (smooth step)
      const t = progress * progress * (3 - 2 * progress)
      const value = fromVal + (toVal - fromVal) * t
      vals.set(key, Math.round(value))
      fromMap.delete(key)
    }

    // Fade out channels that are in "from" but not in "to"
    for (const [key, fromVal] of fromMap) {
      const fadeOutProgress = Math.min(1, delayedElapsed / Math.max(fade.fadeOut, 1))
      const t = fadeOutProgress * fadeOutProgress * (3 - 2 * fadeOutProgress)
      vals.set(key, Math.round(fromVal * (1 - t)))
    }

    allValues.set(id, vals)

    if (progress >= 1) {
      fade.complete = true
      activeFades.delete(id)
      // Notify controller that this cuelist's fade finished
      if (onComplete) onComplete(id)
    }
  }

  if (onUpdate && allValues.size > 0) {
    onUpdate(allValues)
  }

  if (activeFades.size > 0) {
    animationFrame = requestAnimationFrame(updateFades)
  } else {
    animationFrame = null
  }
}

export function getActiveFades(): Map<string, FadeState> {
  return new Map(activeFades)
}

export function snapToCue(cuelistId: string, cue: Cue): Map<string, number> {
  activeFades.delete(cuelistId)
  const vals = new Map<string, number>()
  for (const cv of cue.values) {
    vals.set(`${cv.fixtureId}:${cv.channelName}`, cv.value)
  }
  return vals
}
