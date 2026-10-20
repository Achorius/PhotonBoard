// ============================================================
// Undo-history gate (no imports: safe from the design system).
// While held — a pointer drag on a fader, a scrub, a clip being
// moved — edits keep accumulating in ONE undo step, however long
// the gesture pauses. usePointerDrag holds it for every drag.
// ============================================================

let holds = 0
const releaseListeners = new Set<() => void>()

/** Keep the current undo step open until the returned function is called (idempotent). */
export function holdHistory(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    if (holds === 0) for (const l of releaseListeners) l()
  }
}

export function isHistoryHeld(): boolean {
  return holds > 0
}

/** Called when the last hold is released. Returns an unsubscribe function. */
export function onHistoryRelease(listener: () => void): () => void {
  releaseListeners.add(listener)
  return () => { releaseListeners.delete(listener) }
}
