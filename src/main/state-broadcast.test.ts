import { describe, it, expect, vi, afterEach } from 'vitest'
import { ThrottledBroadcaster, slimStateForCompanion } from './state-broadcast'

afterEach(() => { vi.useRealTimers() })

describe('ThrottledBroadcaster', () => {
  it('serialises once per interval, sends the latest state, and skips unchanged states', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const serialize = vi.fn((s: number) => JSON.stringify(s))
    const b = new ThrottledBroadcaster<number>(100, serialize, (j) => sent.push(j))
    b.push(1); b.push(2); b.push(3)
    vi.advanceTimersByTime(0)
    expect(sent).toEqual(['3'])
    b.push(4); b.push(5)
    vi.advanceTimersByTime(50)
    expect(sent).toEqual(['3'])
    vi.advanceTimersByTime(60)
    expect(sent).toEqual(['3', '5'])
    b.push(5)
    vi.advanceTimersByTime(200)
    expect(sent).toEqual(['3', '5']) // unchanged
    expect(serialize).toHaveBeenCalledTimes(3)
  })

  it('does not serialise while nobody listens, but serves the latest state to a new client', () => {
    vi.useFakeTimers()
    let active = false
    const serialize = vi.fn((s: number) => JSON.stringify(s))
    const b = new ThrottledBroadcaster<number>(100, serialize, () => {}, () => active)
    b.push(1); b.push(2)
    vi.advanceTimersByTime(500)
    expect(serialize).not.toHaveBeenCalled()
    active = true
    expect(b.getLastJson()).toBe('2')
  })
})

describe('slimStateForCompanion', () => {
  it('drops DMX values and cue contents, keeps what Companion shows', () => {
    const slim = slimStateForCompanion({
      grandMaster: 200, blackout: true, showName: 'Gig', fixtureCount: 12,
      dmxValues: [[1, 2, 3]],
      cuelists: [{ id: 'c1', name: 'Intro', isPlaying: true, faderLevel: 128, currentCueIndex: 1, cues: [{ name: 'A', values: [1] }, { name: 'B', values: [2] }] }],
      groups: [{ id: 'g', name: 'Front', color: '#f00', fixtureCount: 4 }],
      selectedFixtureIds: ['a', 'b']
    })
    expect(JSON.stringify(slim)).not.toContain('values')
    expect(slim.cuelists[0]).toEqual({ id: 'c1', name: 'Intro', isPlaying: true, faderLevel: 128, currentCueIndex: 1, cueCount: 2, currentCueName: 'B' })
    expect(slim.selectedCount).toBe(2)
    expect(slim.blackout).toBe(true)
  })
  it('tolerates garbage', () => {
    expect(slimStateForCompanion(null).cuelists).toEqual([])
    expect(slimStateForCompanion({ cuelists: [null, { id: 3 }] }).cuelists).toEqual([])
  })
})
