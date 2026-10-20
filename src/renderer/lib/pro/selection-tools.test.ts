import { describe, expect, it } from 'vitest'
import { applyMatricks, fanValues, isMatricksEmpty, matricksOrder, matricksStepCount } from './selection-tools'

const sel = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const phases = (m: Parameters<typeof applyMatricks>[1], step: number | null = null, list = sel) =>
  Object.fromEntries([...applyMatricks(list, m, step).phase].map(([k, v]) => [k, Math.round(v * 1000) / 1000]))

describe('MAtricks', () => {
  it('no MAtricks: everything, linear phase in selection order', () => {
    expect(isMatricksEmpty({})).toBe(true)
    expect(applyMatricks(sel, {}, null).active).toEqual(sel)
    expect(phases({}, null, ['x', 'y', 'z'])).toEqual({ x: 0, y: 0.5, z: 1 })
    expect(applyMatricks([], {}, 2)).toEqual({ active: [], phase: new Map() })
  })

  it('interleave keeps every n-th fixture from the index', () => {
    expect(matricksOrder(sel, { interleave: { width: 2, index: 0 } })).toEqual(['a', 'c', 'e', 'g'])
    expect(matricksOrder(sel, { interleave: { width: 3, index: 4 } })).toEqual(['b', 'e', 'h'])
    expect(matricksOrder(sel, { interleave: { width: 2, index: -1 } })).toEqual(sel) // grid only
    expect(phases({ interleave: { width: 2, index: 1 } })).toEqual({ b: 0, d: 0.333, f: 0.667, h: 1 })
    expect(isMatricksEmpty({ interleave: { width: 2, index: 0 } })).toBe(false)
  })

  it('blocks share a phase', () => {
    expect(phases({ blocks: 2 })).toEqual({ a: 0, b: 0, c: 0.333, d: 0.333, e: 0.667, f: 0.667, g: 1, h: 1 })
  })

  it('groups restart the phase every n fixtures', () => {
    expect(phases({ groups: 4 })).toEqual({ a: 0, b: 0.333, c: 0.667, d: 1, e: 0, f: 0.333, g: 0.667, h: 1 })
    expect(phases({ groups: 2 })).toEqual({ a: 0, b: 1, c: 0, d: 1, e: 0, f: 1, g: 0, h: 1 })
  })

  it('wings mirror the phase', () => {
    expect(phases({ wings: 2 })).toEqual({ a: 0, b: 0.333, c: 0.667, d: 1, e: 1, f: 0.667, g: 0.333, h: 0 })
    // odd count: the middle fixture belongs to the first wing
    expect(phases({ wings: 2 }, null, ['a', 'b', 'c', 'd', 'e'])).toEqual({ a: 0, b: 0.5, c: 1, d: 1, e: 0 })
    expect(phases({ wings: 4 }, null, ['a', 'b', 'c', 'd'])).toEqual({ a: 0, b: 0, c: 0, d: 0 })
  })

  it('combined: invert, wings and blocks', () => {
    expect(applyMatricks(sel, { invert: true }, null).active).toEqual([...sel].reverse())
    expect(phases({ wings: 2, blocks: 2 })).toEqual({ a: 0, b: 0, c: 1, d: 1, e: 1, f: 1, g: 0, h: 0 })
  })

  it('step walks blocks and keeps the fixture phase', () => {
    expect(applyMatricks(sel, {}, 0).active).toEqual(['a'])
    expect(phases({}, 7)).toEqual({ h: 1 })
    expect(applyMatricks(sel, { blocks: 3 }, 2).active).toEqual(['g', 'h'])
    expect(applyMatricks(sel, { blocks: 3 }, 3).active).toEqual(['a', 'b', 'c'])
    expect(matricksStepCount(sel, { blocks: 3 })).toBe(3)
    expect(matricksStepCount(sel, { interleave: { width: 2, index: 0 } })).toBe(4)
    expect(matricksStepCount([], {})).toBe(0)
  })

  it('ignores nonsense settings', () => {
    expect(applyMatricks(sel, { blocks: 0, groups: -2, wings: Number.NaN }, null).active).toEqual(sel)
    expect(applyMatricks(sel, {}, Number.NaN).active).toEqual(sel)
  })
})

describe('fans', () => {
  const { phase } = applyMatricks(['a', 'b', 'c', 'd', 'e'], {}, null)
  const fan = (align: Parameters<typeof fanValues>[3]) => [...fanValues(phase, 0, 100, align).values()]
  it('the four align modes', () => {
    expect(fan('<')).toEqual([0, 25, 50, 75, 100])
    expect(fan('>')).toEqual([100, 75, 50, 25, 0])
    expect(fan('<>')).toEqual([0, 50, 100, 50, 0])
    expect(fan('><')).toEqual([100, 50, 0, 50, 100])
  })
  it('with wings the fan goes out from the centre', () => {
    const w = applyMatricks(['a', 'b', 'c', 'd'], { wings: 2 }, null).phase
    expect([...fanValues(w, 0, 90, '<').values()]).toEqual([0, 90, 90, 0])
  })
})
