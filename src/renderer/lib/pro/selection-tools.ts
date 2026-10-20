// ============================================================
// PhotonBoard — Selection tools (pure): MAtricks and fans
//
// WP0 contract with a BASIC implementation (WP2 completes it):
//   applyMatricks: `step` (Next / Prev walk) and `invert` only;
//     interleave / blocks / groups / wings are accepted but ignored.
//   fanValues: linear fans for the four align modes.
// ============================================================

import type { AlignMode } from './contracts'

/** grandMA-style selection grid */
export interface Matricks {
  /** Every `width`-th fixture, starting at `index` (0-based) */
  interleave?: { width: number; index: number }
  /** Fixtures per block (same phase inside a block) */
  blocks?: number
  /** Number of groups the selection is split into (phase restarts per group) */
  groups?: number
  /** Mirror the phase across this many wings */
  wings?: number
  /** Reverse the selection order */
  invert?: boolean
}

export interface MatricksResult {
  /** Fixture ids the next value applies to, in order */
  active: string[]
  /** Phase 0…1 of each active fixture (fans) */
  phase: Map<string, number>
}

/**
 * Apply MAtricks and the current step to an ordered selection.
 * `step` null = every fixture; else the fixture at that step (wraps).
 */
export function applyMatricks(selection: string[], m: Matricks, step: number | null): MatricksResult {
  let list = [...selection]
  if (m.invert) list.reverse()
  if (step !== null && list.length > 0) {
    const i = ((Math.trunc(step) % list.length) + list.length) % list.length
    list = [list[i]]
  }
  const phase = new Map<string, number>()
  const n = list.length
  list.forEach((id, i) => phase.set(id, n > 1 ? i / (n - 1) : 0))
  return { active: list, phase }
}

/**
 * Values from `from` to `to` spread over the phases:
 *   '<'  first fixture = from … last = to
 *   '>'  first = to … last = from
 *   '<>' from at both ends, to in the middle
 *   '><' to at both ends, from in the middle
 */
export function fanValues(phase: Map<string, number>, from: number, to: number, align: AlignMode): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, p] of phase) {
    let t: number
    switch (align) {
      case '>': t = 1 - p; break
      case '<>': t = 1 - Math.abs(2 * p - 1); break
      case '><': t = Math.abs(2 * p - 1); break
      default: t = p
    }
    out.set(id, from + (to - from) * t)
  }
  return out
}
