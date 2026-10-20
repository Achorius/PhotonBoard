// ============================================================
// PhotonBoard — Selection tools (pure): MAtricks and fans
//
// grandMA-style MAtricks on an ordered selection, then a phase 0…1
// per active fixture that fans ("At 0 Thru 100") spread values over.
//
// Order of operations (same as a grandMA):
//   1. invert       reverse the selection order
//   2. interleave   keep every `width`-th fixture from `index`
//                   (index < 0: no filtering)
//   3. wings        split into N wings; odd wings are mirrored, so a
//                   fan goes out from the centre (or in) symmetrically
//   4. groups       inside a wing, the phase restarts every `groups`
//                   fixtures (grandMA "Groups" = fixtures per group)
//   5. blocks       `blocks` consecutive fixtures share one phase
//   6. step         Next / Prev: one block at a time (null = all);
//                   a stepped fixture keeps its phase in the selection
// ============================================================

import type { AlignMode } from './contracts'

/** grandMA-style selection grid */
export interface Matricks {
  /** Every `width`-th fixture, starting at `index` (0-based; index < 0 = all) */
  interleave?: { width: number; index: number }
  /** Fixtures per block (same phase inside a block; Next / Prev step by block) */
  blocks?: number
  /** Fixtures per group: the phase restarts every `groups` fixtures */
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

/** A positive integer setting, or `fallback` */
function count(v: number | undefined, fallback = 1): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback
}

function mod(i: number, n: number): number {
  return ((Math.trunc(i) % n) + n) % n
}

/** True when no MAtricks setting changes anything */
export function isMatricksEmpty(m: Matricks): boolean {
  return !m.invert && count(m.blocks) === 1 && count(m.groups, 0) === 0 && count(m.wings) === 1 &&
    !(m.interleave && count(m.interleave.width) >= 2)
}

/** The selection after invert + interleave (the fixtures MAtricks works on) */
export function matricksOrder(selection: readonly string[], m: Matricks): string[] {
  let list = [...selection]
  if (m.invert) list.reverse()
  const width = m.interleave ? count(m.interleave.width) : 1
  if (width >= 2 && Number.isFinite(m.interleave!.index) && m.interleave!.index >= 0) {
    const index = mod(m.interleave!.index, width)
    list = list.filter((_, i) => i % width === index)
  }
  return list
}

/** Number of Next / Prev positions (blocks) of a selection under MAtricks */
export function matricksStepCount(selection: readonly string[], m: Matricks): number {
  const n = matricksOrder(selection, m).length
  return n === 0 ? 0 : Math.ceil(n / count(m.blocks))
}

/** Phase of every fixture of an ordered list (wings → groups → blocks) */
function phasesOf(list: readonly string[], m: Matricks): Map<string, number> {
  const n = list.length
  const phase = new Map<string, number>()
  if (n === 0) return phase
  const wings = Math.min(count(m.wings), n)
  const wingSize = Math.ceil(n / wings)
  const groups = count(m.groups, 0)
  const blocks = count(m.blocks)
  for (let i = 0; i < n; i++) {
    const wing = Math.floor(i / wingSize)
    const wingLen = Math.min(wingSize, n - wing * wingSize)
    let e = i - wing * wingSize
    if (wing % 2 === 1) e = wingLen - 1 - e
    let len = wingLen
    if (groups >= 1) {
      e = e % groups
      len = Math.min(groups, wingLen)
    }
    const unit = Math.floor(e / blocks)
    const units = Math.ceil(len / blocks)
    const p = units > 1 ? unit / (units - 1) : 0
    if (!phase.has(list[i])) phase.set(list[i], p)
  }
  return phase
}

/**
 * Apply MAtricks and the current step to an ordered selection.
 * `step` null = every fixture; else the block at that step (wraps).
 */
export function applyMatricks(selection: string[], m: Matricks, step: number | null): MatricksResult {
  const list = matricksOrder(selection, m)
  const all = phasesOf(list, m)
  if (step === null || list.length === 0 || !Number.isFinite(step)) return { active: list, phase: all }
  const blocks = count(m.blocks)
  const s = mod(step, Math.ceil(list.length / blocks))
  const active = list.slice(s * blocks, s * blocks + blocks)
  const phase = new Map<string, number>()
  for (const id of active) phase.set(id, all.get(id) ?? 0)
  return { active, phase }
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
