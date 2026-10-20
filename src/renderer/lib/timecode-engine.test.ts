import { describe, it, expect, afterEach } from 'vitest'
import {
  MtcAssembler,
  timecodeToSeconds,
  secondsToTimecode,
  formatTimecode,
  enableTimecode,
  setTimecodeChase,
  processMidiForTimecode,
  checkTimecodeDropout,
  type TimecodePosition
} from './timecode-engine'
import { getTimelineState, stopTimeline, setTimelineTime } from './timeline-engine'

const RATE_CODE: Record<number, number> = { 24: 0, 25: 1, 29.97: 2, 30: 3 }

/** The 8 quarter-frame data bytes (pieces 0..7) of a timecode */
function quarterFrames(pos: Omit<TimecodePosition, 'framerate'>, fps: 24 | 25 | 29.97 | 30): number[] {
  const nibbles = [
    pos.frames & 0x0f, pos.frames >> 4,
    pos.seconds & 0x0f, pos.seconds >> 4,
    pos.minutes & 0x0f, pos.minutes >> 4,
    pos.hours & 0x0f, (pos.hours >> 4) | (RATE_CODE[fps] << 1)
  ]
  return nibbles.map((n, piece) => (piece << 4) | n)
}

function feed(asm: MtcAssembler, bytes: number[]) {
  return bytes.map(b => asm.push(b)).filter(f => f !== null)
}

describe('MtcAssembler', () => {
  it('assembles a frame on piece 7 with +2 frame compensation', () => {
    const asm = new MtcAssembler()
    const frames = feed(asm, quarterFrames({ hours: 1, minutes: 2, seconds: 3, frames: 4 }, 25))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.position).toEqual({ hours: 1, minutes: 2, seconds: 3, frames: 4, framerate: 25 })
    expect(frames[0]!.direction).toBe('forward')
    expect(frames[0]!.seconds).toBeCloseTo(3723 + 6 / 25, 6)
  })

  it('never mixes nibbles of two timecodes when starting mid-sequence', () => {
    const asm = new MtcAssembler()
    const a = quarterFrames({ hours: 0, minutes: 0, seconds: 59, frames: 23 }, 25)
    const b = quarterFrames({ hours: 0, minutes: 1, seconds: 0, frames: 1 }, 25)
    const frames = feed(asm, [...a.slice(4), ...b])
    expect(frames).toHaveLength(1)
    expect(frames[0]!.position).toMatchObject({ minutes: 1, seconds: 0, frames: 1 })
  })

  it('emits one frame per complete sequence', () => {
    const asm = new MtcAssembler()
    const frames = feed(asm, [
      ...quarterFrames({ hours: 0, minutes: 0, seconds: 10, frames: 0 }, 30),
      ...quarterFrames({ hours: 0, minutes: 0, seconds: 10, frames: 2 }, 30)
    ])
    expect(frames.map(f => f!.position.frames)).toEqual([0, 2])
  })

  it('drops a sequence with a missing piece', () => {
    const asm = new MtcAssembler()
    const q = quarterFrames({ hours: 0, minutes: 0, seconds: 5, frames: 5 }, 25)
    expect(feed(asm, [...q.slice(0, 3), ...q.slice(4)])).toHaveLength(0)
  })

  it('detects reverse playback (pieces 7 → 0)', () => {
    const asm = new MtcAssembler()
    const frames = feed(asm, quarterFrames({ hours: 0, minutes: 0, seconds: 20, frames: 10 }, 25).reverse())
    expect(frames).toHaveLength(1)
    expect(frames[0]!.direction).toBe('reverse')
    expect(frames[0]!.position.seconds).toBe(20)
  })
})

describe('drop-frame (29.97)', () => {
  it('converts drop-frame labels to real time', () => {
    // 00:01:00;02 is frame 1800: labels ;00 and ;01 of minute 1 do not exist
    expect(timecodeToSeconds({ hours: 0, minutes: 1, seconds: 0, frames: 2, framerate: 29.97 })).toBeCloseTo(1800 * 1001 / 30000, 9)
    // 00:00:59;29 is frame 1799, the one right before
    expect(timecodeToSeconds({ hours: 0, minutes: 0, seconds: 59, frames: 29, framerate: 29.97 })).toBeCloseTo(1799 * 1001 / 30000, 9)
    // 00:10:00;00 is frame 17982 (no drop on multiples of 10 minutes)
    expect(timecodeToSeconds({ hours: 0, minutes: 10, seconds: 0, frames: 0, framerate: 29.97 })).toBeCloseTo(17982 * 1001 / 30000, 9)
  })

  it('round-trips labels', () => {
    const labels: Omit<TimecodePosition, 'framerate'>[] = [
      { hours: 0, minutes: 0, seconds: 59, frames: 29 },
      { hours: 0, minutes: 1, seconds: 0, frames: 2 },
      { hours: 0, minutes: 9, seconds: 59, frames: 29 },
      { hours: 0, minutes: 10, seconds: 0, frames: 0 },
      { hours: 1, minutes: 23, seconds: 45, frames: 12 }
    ]
    for (const l of labels) {
      const pos = { ...l, framerate: 29.97 as const }
      expect(secondsToTimecode(timecodeToSeconds(pos) + 1e-4, 29.97)).toEqual(pos)
    }
    expect(formatTimecode({ hours: 0, minutes: 1, seconds: 0, frames: 2, framerate: 29.97 })).toBe('00:01:00;02')
  })

  it('round-trips non-drop rates', () => {
    const pos: TimecodePosition = { hours: 2, minutes: 3, seconds: 4, frames: 23, framerate: 24 }
    expect(secondsToTimecode(timecodeToSeconds(pos) + 1e-6, 24)).toEqual(pos)
  })
})

describe('timecode chase', () => {
  afterEach(() => {
    setTimecodeChase(false)
    enableTimecode(false)
    stopTimeline()
    setTimelineTime(0)
  })

  it('starts the timeline on lock and stops it after a dropout', () => {
    enableTimecode(true)
    setTimecodeChase(true)
    let now = 1000
    for (const b of quarterFrames({ hours: 0, minutes: 0, seconds: 30, frames: 0 }, 25)) {
      processMidiForTimecode(0xf1, b, 0, now)
      now += 10
    }
    const state = getTimelineState()
    expect(state.isPlaying).toBe(true)
    expect(state.currentTime).toBeCloseTo(30 + 2 / 25, 3)

    checkTimecodeDropout(now + 200)
    expect(getTimelineState().isPlaying).toBe(true) // short gap: freewheel
    checkTimecodeDropout(now + 5000)
    expect(getTimelineState().isPlaying).toBe(false)
  })
})
