// ============================================================
// One requestAnimationFrame loop for every live phase display in the
// Effects view (list rings, scope playhead, fan preview). Subscribers
// draw directly into the DOM / a canvas — React never re-renders per
// frame. The loop only runs while something is subscribed.
//
// Phase comes from the engine (exact). In a remote browser the engine
// runs on the console, so the phase is estimated locally from the
// effect's speed since it was seen starting.
// ============================================================

import { useEffect, useRef } from 'react'
import { getActiveEffects } from '@renderer/lib/effect-engine'
import { useEffectsStore } from '@renderer/stores/effects-store'

/** Accumulated cycles of a running effect, or null when stopped */
export type PhaseListener = (cycles: number | null) => void

const listeners = new Map<string, Set<PhaseListener>>()
const estimates = new Map<string, { cycles: number; last: number }>()
let raf = 0

function frame(now: number): void {
  raf = 0
  if (listeners.size === 0) return
  const active = getActiveEffects()
  const { effects } = useEffectsStore.getState()
  for (const [id, set] of listeners) {
    let cycles: number | null = null
    const running = active.get(id)
    if (running) {
      cycles = running.cycles
      estimates.delete(id)
    } else {
      const effect = effects.find((e) => e.id === id)
      if (effect?.isRunning) {
        const est = estimates.get(id) ?? { cycles: 0, last: now }
        const speed = Number(effect.speed)
        est.cycles += (Math.max(0, now - est.last) / 1000) * (Number.isFinite(speed) && speed > 0 ? speed : 0)
        est.last = now
        estimates.set(id, est)
        cycles = est.cycles
      } else {
        estimates.delete(id)
      }
    }
    for (const fn of set) fn(cycles)
  }
  raf = requestAnimationFrame(frame)
}

export function subscribePhase(id: string, fn: PhaseListener): () => void {
  let set = listeners.get(id)
  if (!set) {
    set = new Set()
    listeners.set(id, set)
  }
  set.add(fn)
  if (!raf) raf = requestAnimationFrame(frame)
  return () => {
    const s = listeners.get(id)
    s?.delete(fn)
    if (s && s.size === 0) listeners.delete(id)
    if (listeners.size === 0 && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
}

/**
 * Call `fn` every frame with the effect's phase while `active`
 * (pass active=false for a stopped effect: one null call, no loop).
 */
export function usePhase(id: string | null, active: boolean, fn: PhaseListener): void {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!id || !active) {
      fnRef.current(null)
      return
    }
    return subscribePhase(id, (c) => fnRef.current(c))
  }, [id, active])
}
