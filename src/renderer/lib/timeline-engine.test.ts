import { describe, expect, it } from 'vitest'
import { clipFadeLevel } from './timeline-engine'

describe('clipFadeLevel', () => {
  const clip = { startTime: 10, duration: 10 }

  it('is full inside a clip without fades and 0 outside', () => {
    expect(clipFadeLevel(clip, 9.99)).toBe(0)
    expect(clipFadeLevel(clip, 10)).toBe(1)
    expect(clipFadeLevel(clip, 19.9)).toBe(1)
    expect(clipFadeLevel(clip, 20)).toBe(0)
  })

  it('ramps up during the fade-in and down during the fade-out', () => {
    const faded = { ...clip, fadeIn: 2, fadeOut: 4 }
    expect(clipFadeLevel(faded, 10)).toBe(0)
    expect(clipFadeLevel(faded, 11)).toBeCloseTo(0.5)
    expect(clipFadeLevel(faded, 12)).toBe(1)
    expect(clipFadeLevel(faded, 15)).toBe(1)
    expect(clipFadeLevel(faded, 18)).toBeCloseTo(0.5)
  })

  it('uses the lower ramp when fades overlap', () => {
    const overlap = { ...clip, fadeIn: 10, fadeOut: 10 }
    expect(clipFadeLevel(overlap, 15)).toBeCloseTo(0.5)
    expect(clipFadeLevel(overlap, 12)).toBeCloseTo(0.2)
  })
})
