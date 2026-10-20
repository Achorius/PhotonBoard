import { beforeEach, describe, expect, it } from 'vitest'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import {
  addTrack, fitFades, formatBars, formatShortTime, removeTrack, rulerTicks, snapStep, snapTime, snapWithEdges, splitClip, swapTracks
} from './timeline-model'

describe('snapping', () => {
  it('derives grid steps from the mode and tempo', () => {
    expect(snapStep('off', 120)).toBe(0)
    expect(snapStep('0.25', 120)).toBe(0.25)
    expect(snapStep('beat', 120)).toBeCloseTo(0.5)
    expect(snapStep('bar', 120)).toBeCloseTo(2)
  })

  it('snaps to the grid, and to close edges first', () => {
    expect(snapTime(1.13, 0.25)).toBe(1.25)
    expect(snapTime(-3, 1)).toBe(0)
    expect(snapWithEdges(4.93, 1, [4.9], 0.1)).toBe(4.9)
    expect(snapWithEdges(4.7, 1, [4.9], 0.1)).toBe(5)
  })
})

describe('formatting', () => {
  it('prints short times', () => {
    expect(formatShortTime(0)).toBe('0:00')
    expect(formatShortTime(24)).toBe('0:24')
    expect(formatShortTime(65.5)).toBe('1:05.5')
  })

  it('prints bar.beat.sixteenth positions', () => {
    expect(formatBars(0, 120)).toBe('001.1.1')
    expect(formatBars(2, 120)).toBe('002.1.1')
    expect(formatBars(2.75, 120)).toBe('002.2.3')
  })

  it('labels major ruler ticks', () => {
    const ticks = rulerTicks(0, 60, 10, 'time', 120)
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toContain('0:10')
    const bars = rulerTicks(0, 16, 20, 'bars', 120)
    expect(bars.find((t) => t.major && t.t === 0)?.label).toBe('1')
  })
})

describe('clip and track edits', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ timelineClips: [], timelineTrackCount: 3, timelineTrackNames: ['A', 'B', 'C'] })
  })

  it('keeps fades inside the clip', () => {
    expect(fitFades({ duration: 2, fadeIn: 3, fadeOut: 1 })).toEqual({ fadeIn: 2, fadeOut: 0 })
    expect(fitFades({ duration: 10, fadeIn: 2, fadeOut: 2 })).toEqual({})
  })

  it('splits a clip at a time, giving the fades to the outer halves', () => {
    const store = usePlaybackStore.getState()
    const id = store.addTimelineClip({ cuelistId: 's', trackIndex: 0, startTime: 10, duration: 10, fadeIn: 1, fadeOut: 2 })
    const right = splitClip(id, 14)
    const clips = usePlaybackStore.getState().timelineClips
    const l = clips.find((c) => c.id === id)!
    const r = clips.find((c) => c.id === right)!
    expect([l.startTime, l.duration, l.fadeIn, l.fadeOut]).toEqual([10, 4, 1, undefined])
    expect([r.startTime, r.duration, r.fadeIn, r.fadeOut]).toEqual([14, 6, undefined, 2])
  })

  it('inserts, swaps and removes tracks with their clips and names', () => {
    const store = usePlaybackStore.getState()
    const a = store.addTimelineClip({ cuelistId: 's', trackIndex: 1, startTime: 0, duration: 1 })
    addTrack(0)
    expect(usePlaybackStore.getState().timelineTrackNames).toEqual(['A', '', 'B', 'C'])
    expect(usePlaybackStore.getState().timelineClips.find((c) => c.id === a)?.trackIndex).toBe(2)
    swapTracks(2, 3)
    expect(usePlaybackStore.getState().timelineTrackNames).toEqual(['A', '', 'C', 'B'])
    expect(usePlaybackStore.getState().timelineClips.find((c) => c.id === a)?.trackIndex).toBe(3)
    removeTrack(1)
    expect(usePlaybackStore.getState().timelineTrackNames).toEqual(['A', 'C', 'B'])
    expect(usePlaybackStore.getState().timelineTrackCount).toBe(3)
    expect(usePlaybackStore.getState().timelineClips.find((c) => c.id === a)?.trackIndex).toBe(2)
  })
})
