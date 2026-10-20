// ============================================================
// PhotonBoard — Soft takeover (fader pickup), pure
//
// A physical fader that does not match the value it drives (page
// change, the value moved on screen, show load, controller plugged in)
// must not make the stage jump. Until the fader "picks up" the value —
// it comes within `tolerance` of it, or crosses it — its moves are
// ignored. All values are on the MIDI scale 0-127.
//
// Re-armed (synced = false) on page change and show load by the
// caller; a change of the value by another source is detected here
// (the value is no longer what this fader last applied).
// ============================================================

export interface TakeoverState {
  /** The fader drives the value */
  synced: boolean
  /** Last known physical position (null = never seen) */
  lastPhysical: number | null
  /** Value this fader last applied (null = none yet) */
  lastLogical: number | null
}

export const TAKEOVER_TOLERANCE = 2

export function initialTakeover(lastPhysical: number | null = null): TakeoverState {
  return { synced: false, lastPhysical, lastLogical: null }
}

/** Unsync (page change, show load): the next moves must pick the value up again */
export function rearm(s: TakeoverState): TakeoverState {
  return s.synced ? { synced: false, lastPhysical: s.lastPhysical, lastLogical: null } : s
}

/** Has the value moved away from what this fader last applied? */
function drifted(s: TakeoverState, logical: number, tolerance: number): boolean {
  return s.lastLogical !== null && Math.abs(logical - s.lastLogical) > tolerance
}

/**
 * A physical move. `apply` = send `physical` to the target. Syncs when the
 * fader is within tolerance of the value or crossed it since its last move.
 */
export function takeover(s: TakeoverState, physical: number, logical: number, tolerance = TAKEOVER_TOLERANCE): { apply: boolean; state: TakeoverState } {
  let synced = s.synced && !drifted(s, logical, tolerance)
  if (!synced) {
    if (Math.abs(physical - logical) <= tolerance) synced = true
    else if (s.lastPhysical !== null && (s.lastPhysical - logical) * (physical - logical) <= 0) synced = true
  }
  if (synced) return { apply: true, state: { synced: true, lastPhysical: physical, lastLogical: physical } }
  return { apply: false, state: { synced: false, lastPhysical: physical, lastLogical: null } }
}

/** Should a ghost (physical position) be drawn for this fader? */
export function needsGhost(s: TakeoverState, logical: number, tolerance = TAKEOVER_TOLERANCE): boolean {
  if (s.lastPhysical === null) return false
  if (s.synced && !drifted(s, logical, tolerance)) return false
  return Math.abs(s.lastPhysical - logical) > tolerance
}

export function dmxToMidi(v: number): number {
  return Math.max(0, Math.min(127, Math.round((v * 127) / 255)))
}

export function midiToDmx(v: number): number {
  return Math.max(0, Math.min(255, Math.round((v * 255) / 127)))
}
