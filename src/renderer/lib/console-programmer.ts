// ============================================================
// PhotonBoard — Programmer summary shared with remotes
// The programmer lives in the console's mixer. Remotes record with the
// CONSOLE's programmer, so the state snapshot carries a summary (channel
// count per fixture) that remote views (Record popover, programmer chip)
// display instead of their local copy.
// ============================================================

import { create } from 'zustand'
import { recordFromProgrammer } from './programmer-utils'

export interface ProgrammerSummary {
  /** Programmer channels that belong to a patched fixture */
  channels: number
  /** fixture id → channel count */
  fixtures: Record<string, number>
}

const EMPTY: ProgrammerSummary = { channels: 0, fixtures: {} }

/** Console: summary of the programmer (resolved through the patch). */
export function computeProgrammerSummary(): ProgrammerSummary {
  const values = recordFromProgrammer()
  if (values.length === 0) return EMPTY
  const fixtures: Record<string, number> = {}
  for (const v of values) fixtures[v.fixtureId] = (fixtures[v.fixtureId] ?? 0) + 1
  return { channels: values.length, fixtures }
}

/** Remote: the console's programmer as last broadcast */
export const useConsoleProgrammer = create<ProgrammerSummary>(() => EMPTY)

export function mirrorProgrammerSummary(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const r = raw as { channels?: unknown; fixtures?: unknown }
  if (typeof r.channels !== 'number' || !r.fixtures || typeof r.fixtures !== 'object') return
  const fixtures: Record<string, number> = {}
  for (const [id, n] of Object.entries(r.fixtures as Record<string, unknown>)) {
    if (typeof n === 'number' && n > 0) fixtures[id] = n
  }
  const cur = useConsoleProgrammer.getState()
  const same = cur.channels === r.channels &&
    Object.keys(cur.fixtures).length === Object.keys(fixtures).length &&
    Object.entries(fixtures).every(([id, n]) => cur.fixtures[id] === n)
  if (!same) useConsoleProgrammer.setState({ channels: r.channels, fixtures }, true)
}

/** Counts of a summary, optionally limited to some fixtures. */
export function summaryCounts(summary: ProgrammerSummary, limit?: ReadonlySet<string> | null): { fixtureCount: number; channelCount: number } {
  let fixtureCount = 0
  let channelCount = 0
  for (const [id, n] of Object.entries(summary.fixtures)) {
    if (limit && !limit.has(id)) continue
    fixtureCount++
    channelCount += n
  }
  return { fixtureCount, channelCount }
}
