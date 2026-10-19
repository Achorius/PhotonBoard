import { describe, expect, it } from 'vitest'
import {
  expandNamePattern, findConflicts, findFreeAddress, nextName, occupancy, planFixtures, planReaddress, universeStats, type Footprint
} from './patch-utils'

const fp = (id: string, universe: number, address: number, count: number): Footprint => ({ id, universe, address, count })

describe('findConflicts', () => {
  it('reports overlapping fixtures on the same universe only', () => {
    const c = findConflicts([fp('a', 0, 1, 10), fp('b', 0, 10, 5), fp('c', 1, 1, 10), fp('d', 0, 15, 2)])
    expect(c.get('a')?.with).toEqual(['b'])
    expect(c.get('b')?.with).toEqual(['a'])
    expect(c.has('c')).toBe(false)
    expect(c.has('d')).toBe(false)
  })

  it('flags footprints running past 512', () => {
    const c = findConflicts([fp('a', 0, 510, 4)])
    expect(c.get('a')?.overflow).toBe(true)
  })

  it('finds every pair inside a stack of overlaps', () => {
    const c = findConflicts([fp('a', 0, 1, 20), fp('b', 0, 5, 2), fp('c', 0, 6, 2)])
    expect(c.get('a')?.with.sort()).toEqual(['b', 'c'])
    expect(c.get('b')?.with.sort()).toEqual(['a', 'c'])
  })
})

describe('findFreeAddress', () => {
  const items = [fp('a', 0, 1, 10), fp('b', 0, 14, 4)]
  it('returns the first gap large enough', () => {
    expect(findFreeAddress(items, 0, 3)).toBe(11)
    expect(findFreeAddress(items, 0, 4)).toBe(18)
    expect(findFreeAddress(items, 1, 4)).toBe(1)
  })
  it('honours from and exclude', () => {
    expect(findFreeAddress(items, 0, 2, 12)).toBe(12)
    expect(findFreeAddress(items, 0, 10, 1, new Set(['a']))).toBe(1)
  })
  it('returns null when nothing fits', () => {
    expect(findFreeAddress([fp('a', 0, 1, 512)], 0, 1)).toBeNull()
  })
})

describe('names', () => {
  it('expands {n} and padded variants', () => {
    expect(expandNamePattern('Spot {n}', 3, 4)).toBe('Spot 3')
    expect(expandNamePattern('Par {nn}', 3, 4)).toBe('Par 03')
    expect(expandNamePattern('Wash', 2, 4)).toBe('Wash 2')
    expect(expandNamePattern('Wash', 1, 1)).toBe('Wash')
  })
  it('finds the next free numbered name', () => {
    expect(nextName('Spot 4', new Set(['Spot 5']))).toBe('Spot 6')
    expect(nextName('Hazer', new Set())).toBe('Hazer 2')
  })
})

describe('planFixtures', () => {
  const existing = [fp('a', 0, 1, 10)]
  const base = { count: 3, channels: 4, universe: 0, address: 1, gap: 0, avoidConflicts: true, namePattern: 'Spot {n}', startNumber: 1 }

  it('auto-addresses around existing fixtures', () => {
    const plan = planFixtures(existing, base)
    expect(plan.map((p) => p.address)).toEqual([11, 15, 19])
    expect(plan.map((p) => p.name)).toEqual(['Spot 1', 'Spot 2', 'Spot 3'])
    expect(plan.every((p) => p.conflictWith.length === 0 && !p.overflow)).toBe(true)
  })

  it('leaves gaps between fixtures', () => {
    const plan = planFixtures([], { ...base, gap: 2 })
    expect(plan.map((p) => p.address)).toEqual([1, 7, 13])
  })

  it('reports conflicts when placing literally', () => {
    const plan = planFixtures(existing, { ...base, count: 4, avoidConflicts: false })
    expect(plan.map((p) => p.address)).toEqual([1, 5, 9, 13])
    expect(plan[2].conflictWith).toEqual(['a'])
    expect(plan[3].conflictWith).toEqual([])
  })

  it('continues on the next universe when the first is full', () => {
    const plan = planFixtures([fp('a', 0, 1, 506)], { ...base, count: 2, channels: 4 })
    expect(plan[0]).toMatchObject({ universe: 0, address: 507 })
    expect(plan[1]).toMatchObject({ universe: 1, address: 1 })
  })

  it('reports overflow past 512 when placing literally', () => {
    const plan = planFixtures([], { ...base, address: 510, avoidConflicts: false, count: 1 })
    expect(plan[0].overflow).toBe(true)
  })
})

describe('planReaddress', () => {
  it('packs moved fixtures after the start, skipping fixed ones', () => {
    const all = [fp('a', 0, 1, 4), fp('b', 0, 5, 4), fp('x', 0, 20, 4)]
    const out = planReaddress(all, [all[0], all[1]], 0, 17, 0, true)
    expect(out.map((o) => o.address)).toEqual([24, 28])
  })
})

describe('occupancy / stats', () => {
  it('counts used channels and the largest free block', () => {
    const items = [fp('a', 0, 1, 10), fp('b', 0, 101, 10)]
    expect(occupancy(items, 0)[0]).toEqual(['a'])
    expect(universeStats(items, 0)).toEqual({ used: 20, largestFree: 402, fixtures: 2 })
  })
})
