// ============================================================
// Patch maths: channel footprints, DMX address conflicts, free
// address search and multi-fixture planning (auto-addressing,
// name patterns). Pure functions — unit tested in patch-utils.test.ts.
// Universes are 0-based, addresses 1…512 (like PatchEntry).
// ============================================================

import { DMX_CHANNELS_PER_UNIVERSE, MAX_UNIVERSES, type FixtureDefinition, type PatchEntry } from '@shared/types'

export const UNIVERSE_SIZE = DMX_CHANNELS_PER_UNIVERSE

/** Fields of a PatchEntry that matter for addressing */
export type Footprint = Pick<PatchEntry, 'id' | 'universe' | 'address'> & { count: number }

/** Channel count of a patched fixture (1 when the definition or mode is missing) */
export function entryChannelCount(entry: Pick<PatchEntry, 'fixtureDefId' | 'modeName'>, defs: Map<string, FixtureDefinition>): number {
  const mode = defs.get(entry.fixtureDefId)?.modes.find((m) => m.name === entry.modeName)
  return Math.max(1, mode?.channelCount ?? mode?.channels.length ?? 1)
}

export function footprints(patch: readonly PatchEntry[], defs: Map<string, FixtureDefinition>): Footprint[] {
  return patch.map((p) => ({ id: p.id, universe: p.universe, address: p.address, count: entryChannelCount(p, defs) }))
}

/** True when two footprints share at least one DMX slot */
export function overlaps(a: { universe: number; address: number; count: number }, b: { universe: number; address: number; count: number }): boolean {
  return a.universe === b.universe && a.address <= b.address + b.count - 1 && b.address <= a.address + a.count - 1
}

/** Last address of a footprint is past 512 */
export function overflows(f: { address: number; count: number }): boolean {
  return f.address < 1 || f.address + f.count - 1 > UNIVERSE_SIZE
}

export interface ConflictInfo {
  /** ids of the fixtures overlapping this one */
  with: string[]
  /** footprint runs past channel 512 */
  overflow: boolean
}

/**
 * Every fixture that overlaps another (or runs past 512).
 * Sweep per universe: O(n log n) for the usual non-overlapping patch.
 */
export function findConflicts(items: readonly Footprint[]): Map<string, ConflictInfo> {
  const out = new Map<string, ConflictInfo>()
  const get = (id: string) => {
    let c = out.get(id)
    if (!c) { c = { with: [], overflow: false }; out.set(id, c) }
    return c
  }
  const byUniverse = new Map<number, Footprint[]>()
  for (const f of items) {
    if (overflows(f)) get(f.id).overflow = true
    const list = byUniverse.get(f.universe)
    if (list) list.push(f)
    else byUniverse.set(f.universe, [f])
  }
  for (const list of byUniverse.values()) {
    const sorted = [...list].sort((a, b) => a.address - b.address)
    const active: Footprint[] = []
    for (const f of sorted) {
      // Drop ranges that end before this one starts
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].address + active[i].count - 1 < f.address) active.splice(i, 1)
      }
      for (const other of active) {
        get(f.id).with.push(other.id)
        get(other.id).with.push(f.id)
      }
      active.push(f)
    }
  }
  return out
}

/** Slot occupancy of one universe: index 0…511 → ids using that slot */
export function occupancy(items: readonly Footprint[], universe: number): string[][] {
  const slots: string[][] = Array.from({ length: UNIVERSE_SIZE }, () => [])
  for (const f of items) {
    if (f.universe !== universe) continue
    const start = Math.max(1, f.address)
    const end = Math.min(UNIVERSE_SIZE, f.address + f.count - 1)
    for (let a = start; a <= end; a++) slots[a - 1].push(f.id)
  }
  return slots
}

/**
 * First address ≥ `from` where `count` slots are free in `universe`,
 * ignoring fixtures in `exclude`. null when nothing fits before 512.
 */
export function findFreeAddress(
  items: readonly Footprint[],
  universe: number,
  count: number,
  from = 1,
  exclude?: ReadonlySet<string>
): number | null {
  const used = new Uint8Array(UNIVERSE_SIZE + 2)
  for (const f of items) {
    if (f.universe !== universe || exclude?.has(f.id)) continue
    const start = Math.max(1, f.address)
    const end = Math.min(UNIVERSE_SIZE, f.address + f.count - 1)
    for (let a = start; a <= end; a++) used[a] = 1
  }
  let run = 0
  for (let a = Math.max(1, from); a <= UNIVERSE_SIZE; a++) {
    run = used[a] ? 0 : run + 1
    if (run >= count) return a - count + 1
  }
  return null
}

/** Channels used / free and the largest free block of a universe */
export function universeStats(items: readonly Footprint[], universe: number): { used: number; largestFree: number; fixtures: number } {
  const slots = occupancy(items, universe)
  let used = 0
  let run = 0
  let largestFree = 0
  for (const s of slots) {
    if (s.length > 0) { used++; run = 0 } else { run++; largestFree = Math.max(largestFree, run) }
  }
  return { used, largestFree, fixtures: items.filter((f) => f.universe === universe).length }
}

// ---- Names ----

/**
 * Expand a name pattern. `{n}` = running number, `{nn}`/`{nnn}` zero-padded.
 * Without a placeholder, " {n}" is appended when several fixtures are created.
 */
export function expandNamePattern(pattern: string, n: number, total: number): string {
  const base = pattern.trim() || 'Fixture'
  if (/\{n+\}/.test(base)) return base.replace(/\{(n+)\}/g, (_m, ns: string) => String(n).padStart(ns.length, '0'))
  return total > 1 ? `${base} ${n}` : base
}

/** "Spot 4" → { stem: "Spot", n: 4 } (for the next number of a duplicated fixture) */
export function splitTrailingNumber(name: string): { stem: string; n: number | null } {
  const m = /^(.*?)(\s*)(\d+)$/.exec(name.trim())
  if (!m) return { stem: name.trim(), n: null }
  return { stem: m[1] + m[2], n: Number(m[3]) }
}

/** Next unused "Stem N" name (Spot 4 → Spot 5 when Spot 5 is free) */
export function nextName(name: string, taken: ReadonlySet<string>): string {
  const { stem, n } = splitTrailingNumber(name)
  const base = n === null ? `${stem} ` : stem
  let i = (n ?? 1) + 1
  while (taken.has(`${base}${i}`)) i++
  return `${base}${i}`
}

// ---- Planning several fixtures ----

export interface PlanOptions {
  count: number
  /** Channels of the mode */
  channels: number
  universe: number
  /** First address requested */
  address: number
  /** Empty channels left between consecutive fixtures */
  gap: number
  /** Skip occupied slots (and continue on the next universe when full) */
  avoidConflicts: boolean
  namePattern: string
  /** First value of {n} */
  startNumber: number
}

export interface PlannedFixture {
  index: number
  name: string
  universe: number
  address: number
  /** Overlaps an existing fixture (only when avoidConflicts is off) */
  conflictWith: string[]
  /** Does not fit before channel 512 */
  overflow: boolean
}

/** Addresses and names for N new fixtures, checked against the existing patch. */
export function planFixtures(existing: readonly Footprint[], o: PlanOptions): PlannedFixture[] {
  const count = Math.max(0, Math.floor(o.count))
  const ch = Math.max(1, Math.floor(o.channels))
  const gap = Math.max(0, Math.floor(o.gap))
  const placed: Footprint[] = [...existing]
  const out: PlannedFixture[] = []
  let universe = o.universe
  let cursor = Math.max(1, Math.floor(o.address))

  for (let i = 0; i < count; i++) {
    const name = expandNamePattern(o.namePattern, o.startNumber + i, count)
    let address = cursor
    let overflow = false
    if (o.avoidConflicts) {
      let found = findFreeAddress(placed, universe, ch, cursor)
      while (found === null && universe + 1 < MAX_UNIVERSES) {
        universe++
        found = findFreeAddress(placed, universe, ch, 1)
      }
      if (found === null) { overflow = true; address = cursor } else address = found
    } else if (address + ch - 1 > UNIVERSE_SIZE) {
      overflow = true
    }
    const fp: Footprint = { id: `__new${i}`, universe, address, count: ch }
    const conflictWith = overflow ? [] : existing.filter((e) => overlaps(e, fp)).map((e) => e.id)
    out.push({ index: i, name, universe, address, conflictWith, overflow })
    placed.push(fp)
    cursor = address + ch + gap
  }
  return out
}

/**
 * Re-address fixtures one after another from `start` (keeping their order),
 * skipping slots used by fixtures that are not being moved.
 */
export function planReaddress(
  all: readonly Footprint[],
  moving: readonly Footprint[],
  universe: number,
  start: number,
  gap: number,
  avoidConflicts: boolean
): { id: string; universe: number; address: number; overflow: boolean; conflict: boolean }[] {
  const movingIds = new Set(moving.map((m) => m.id))
  const fixed = all.filter((f) => !movingIds.has(f.id))
  const placed: Footprint[] = [...fixed]
  const out: { id: string; universe: number; address: number; overflow: boolean; conflict: boolean }[] = []
  let cursor = Math.max(1, Math.floor(start))
  for (const m of moving) {
    let address = cursor
    let overflow = false
    if (avoidConflicts) {
      const found = findFreeAddress(placed, universe, m.count, cursor)
      if (found === null) overflow = true
      else address = found
    } else if (address + m.count - 1 > UNIVERSE_SIZE) overflow = true
    const fp: Footprint = { id: m.id, universe, address, count: m.count }
    const conflict = !overflow && fixed.some((f) => overlaps(f, fp))
    out.push({ id: m.id, universe, address, overflow, conflict })
    placed.push(fp)
    cursor = address + m.count + Math.max(0, gap)
  }
  return out
}
