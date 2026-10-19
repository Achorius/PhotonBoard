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

describe('timeline seek', () => {
  it('keeps clips that span the seek running (effects keep their phase)', async () => {
    const { usePlaybackStore } = await import('@renderer/stores/playback-store')
    const { startTimeline, stopTimeline, setTimelineTime, getActiveClipIds, resetTimeline } = await import('./timeline-engine')
    const { getActiveEffects, updateEffects, stopAllEffects } = await import('./effect-engine')
    const { clockNow } = await import('./runtime')

    const pb = usePlaybackStore.getState()
    const a = pb.addCuelist('A')
    pb.addCue(a, 'Q1', [{ fixtureId: 'f', channelName: 'Dimmer', value: 255 }])
    const b = pb.addCuelist('B')
    pb.addCue(b, 'Q1', [{ fixtureId: 'f', channelName: 'Dimmer', value: 100 }])
    const fx = { id: 'fx1', name: 'Pulse', waveform: 'sine' as const, speed: 1, depth: 255, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0, isRunning: true }
    usePlaybackStore.setState((s) => ({
      cuelists: s.cuelists.map((c) => (c.id === a ? { ...c, effectSnapshots: [fx] } : c)),
      timelineClips: [
        { id: 'clipA', cuelistId: a, trackIndex: 0, startTime: 0, duration: 10 },
        { id: 'clipB', cuelistId: b, trackIndex: 1, startTime: 8, duration: 10 }
      ]
    }))

    try {
      resetTimeline()
      setTimelineTime(2)
      startTimeline()
      expect([...getActiveClipIds()]).toEqual(['clipA'])
      updateEffects(clockNow() + 500)
      const before = getActiveEffects().get('timeline_clipA_fx1')!.cycles
      expect(before).toBeGreaterThan(0)

      // Small timecode correction inside clip A: nothing restarts
      setTimelineTime(2.1)
      expect([...getActiveClipIds()]).toEqual(['clipA'])
      expect(getActiveEffects().get('timeline_clipA_fx1')!.cycles).toBe(before)

      // Seek into the overlap: A keeps running, B starts
      setTimelineTime(9)
      expect([...getActiveClipIds()].sort()).toEqual(['clipA', 'clipB'])
      expect(getActiveEffects().get('timeline_clipA_fx1')!.cycles).toBe(before)

      // Seek past A: only A is released
      setTimelineTime(12)
      expect([...getActiveClipIds()]).toEqual(['clipB'])
      expect(getActiveEffects().has('timeline_clipA_fx1')).toBe(false)
    } finally {
      stopTimeline()
      stopAllEffects()
    }
  })
})
