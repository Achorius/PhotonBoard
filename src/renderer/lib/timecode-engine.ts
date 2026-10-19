// ============================================================
// PhotonBoard — Timecode Engine
// Receives MIDI Time Code (MTC) quarter-frame messages and converts
// them to absolute time. Can chase the timeline to an external source
// (DAW, QLab, media server…): start on lock, follow, stop after a
// dropout.
// ============================================================

import { setTimelineTime, startTimeline, stopTimeline, getTimelineState } from './timeline-engine'
import { clockNow } from './runtime'

// ── SMPTE Framerates ──
/** 29.97 = 29.97 drop-frame (MTC rate code 2) */
export type TimecodeFramerate = 24 | 25 | 29.97 | 30
export const FRAMERATES: TimecodeFramerate[] = [24, 25, 29.97, 30]

export interface TimecodePosition {
  hours: number
  minutes: number
  seconds: number
  frames: number
  framerate: TimecodeFramerate
}

export type MtcDirection = 'forward' | 'reverse'

export interface MtcFrame {
  position: TimecodePosition
  /** Position compensated for the 2 frames needed to transmit it */
  seconds: number
  direction: MtcDirection
}

const RATE_CODES: TimecodeFramerate[] = [24, 25, 29.97, 30]

// ── Conversions ──

/** Frame label → seconds. Handles 29.97 drop-frame labelling. */
export function timecodeToSeconds(pos: TimecodePosition): number {
  if (pos.framerate === 29.97) {
    const totalMinutes = 60 * pos.hours + pos.minutes
    const frameNumber = 108000 * pos.hours + 1800 * pos.minutes + 30 * pos.seconds + pos.frames -
      2 * (totalMinutes - Math.floor(totalMinutes / 10))
    return frameNumber * 1001 / 30000
  }
  return pos.hours * 3600 + pos.minutes * 60 + pos.seconds + pos.frames / pos.framerate
}

/** Seconds → frame label (29.97 uses drop-frame labelling). */
export function secondsToTimecode(totalSeconds: number, framerate: TimecodeFramerate = _framerate): TimecodePosition {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  if (framerate === 29.97) {
    let frameNumber = Math.floor(s * 30000 / 1001 + 1e-6)
    const framesPer10Min = 17982
    const framesPerMin = 1798
    const d = Math.floor(frameNumber / framesPer10Min)
    const m = frameNumber % framesPer10Min
    frameNumber += 18 * d + (m > 1 ? 2 * Math.floor((m - 2) / framesPerMin) : 0)
    return {
      hours: Math.floor(frameNumber / 108000) % 24,
      minutes: Math.floor(frameNumber / 1800) % 60,
      seconds: Math.floor(frameNumber / 30) % 60,
      frames: frameNumber % 30,
      framerate
    }
  }
  const fps = framerate
  const totalFrames = Math.floor(s * fps + 1e-6)
  return {
    hours: Math.floor(totalFrames / (3600 * fps)),
    minutes: Math.floor(totalFrames / (60 * fps)) % 60,
    seconds: Math.floor(totalFrames / fps) % 60,
    frames: totalFrames % fps,
    framerate
  }
}

/** Duration of one frame in seconds. */
export function frameDuration(framerate: TimecodeFramerate): number {
  return framerate === 29.97 ? 1001 / 30000 : 1 / framerate
}

export function formatTimecode(pos: TimecodePosition): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const sep = pos.framerate === 29.97 ? ';' : ':'
  return `${pad(pos.hours)}:${pad(pos.minutes)}:${pad(pos.seconds)}${sep}${pad(pos.frames)}`
}

export function formatSecondsAsTimecode(totalSeconds: number, framerate: TimecodeFramerate = _framerate): string {
  return formatTimecode(secondsToTimecode(totalSeconds, framerate))
}

// ── MTC quarter-frame assembly (pure) ──

/**
 * Assembles quarter-frame messages (F1 0nnn dddd) into full frames.
 * A frame is only produced from a complete, consecutive set of 8 pieces:
 * forward = pieces 0→7 (emitted on piece 7), reverse = 7→0 (emitted on 0).
 * Starting mid-sequence, gaps or direction changes reset the assembly, so
 * nibbles of two different timecodes are never mixed.
 */
export class MtcAssembler {
  private readonly data = new Uint8Array(8)
  private lastPiece = -1
  private count = 0
  private direction: MtcDirection = 'forward'

  reset(): void {
    this.lastPiece = -1
    this.count = 0
  }

  /** Feed the data byte of a 0xF1 message. Returns a frame when one completes. */
  push(dataByte: number): MtcFrame | null {
    const piece = (dataByte >> 4) & 0x07
    const nibble = dataByte & 0x0f
    const firstOf = (d: MtcDirection) => (d === 'forward' ? 0 : 7)
    const lastOf = (d: MtcDirection) => (d === 'forward' ? 7 : 0)

    let direction = this.direction
    let consecutive = false
    if (this.lastPiece !== -1) {
      if (piece === (this.lastPiece + 1) % 8) { direction = 'forward'; consecutive = true }
      else if (piece === (this.lastPiece + 7) % 8) { direction = 'reverse'; consecutive = true }
    }
    if (!consecutive || direction !== this.direction) {
      // Gap or direction change: restart (keeping the previous piece if it opened this direction)
      this.count = consecutive && this.lastPiece === firstOf(direction) ? 1 : 0
    }
    this.direction = direction
    this.lastPiece = piece
    this.data[piece] = nibble

    if (this.count === 0) {
      // A run must start at the first piece of its direction
      if (piece === firstOf(direction)) this.count = 1
      return null
    }
    this.count++
    if (this.count < 8 || piece !== lastOf(direction)) return null
    this.count = 0
    return this.assemble()
  }

  private assemble(): MtcFrame {
    const d = this.data
    const frames = d[0] | ((d[1] & 0x01) << 4)
    const seconds = d[2] | ((d[3] & 0x03) << 4)
    const minutes = d[4] | ((d[5] & 0x03) << 4)
    const hours = d[6] | ((d[7] & 0x01) << 4)
    const framerate = RATE_CODES[(d[7] >> 1) & 0x03]
    const position: TimecodePosition = { hours, minutes, seconds, frames, framerate }
    // The time refers to the moment piece 0 (forward) was sent: 8 quarter frames
    // (= 2 frames) have elapsed since.
    const comp = 2 * frameDuration(framerate) * (this.direction === 'forward' ? 1 : -1)
    return {
      position,
      seconds: Math.max(0, timecodeToSeconds(position) + comp),
      direction: this.direction
    }
  }
}

// ── Engine state ──

let _enabled = false
let _framerate: TimecodeFramerate = 25
let _offset = 0 // seconds offset applied to incoming timecode
let _lastPosition: TimecodePosition = { hours: 0, minutes: 0, seconds: 0, frames: 0, framerate: 25 }
let _receiving = false
let _lastMessageTime = 0
let _chase = false
let _dropoutMs = 1000
/** True while the timeline runs because timecode started it */
let _startedByTimecode = false

const assembler = new MtcAssembler()

let _onTimecodeUpdate: ((pos: TimecodePosition, totalSeconds: number) => void) | null = null
let _onStatusChange: ((receiving: boolean) => void) | null = null

let _watchdogTimer: ReturnType<typeof setInterval> | null = null

// ── Public API ──

export function enableTimecode(enabled: boolean): void {
  _enabled = enabled
  assembler.reset()
  if (enabled) {
    startWatchdog()
  } else {
    stopWatchdog()
    signalLost()
  }
}

export function isTimecodeEnabled(): boolean {
  return _enabled
}

export function isTimecodeReceiving(): boolean {
  return _receiving
}

/** Manual framerate (used for display / when no MTC is received). */
export function setTimecodeFramerate(fps: TimecodeFramerate): void {
  _framerate = fps
  _lastPosition.framerate = fps
}

export function getTimecodeFramerate(): TimecodeFramerate {
  return _framerate
}

export function setTimecodeOffset(seconds: number): void {
  if (Number.isFinite(seconds)) _offset = seconds
}

export function getTimecodeOffset(): number {
  return _offset
}

/**
 * Chase mode: the timeline follows incoming timecode — it starts when timecode
 * locks, resyncs on drift, and stops after a dropout of `getTimecodeDropoutMs()`.
 */
export function setTimecodeChase(on: boolean): void {
  _chase = on
  if (!on) _startedByTimecode = false
}

export function isTimecodeChase(): boolean {
  return _chase
}

/** Dropout timeout before the chased timeline stops (ms, default 1000). */
export function setTimecodeDropoutMs(ms: number): void {
  if (Number.isFinite(ms)) _dropoutMs = Math.max(100, Math.min(10000, ms))
}

export function getTimecodeDropoutMs(): number {
  return _dropoutMs
}

export function getTimecodePosition(): TimecodePosition {
  return { ..._lastPosition }
}

export function setTimecodeUpdateCallback(cb: (pos: TimecodePosition, totalSeconds: number) => void): void {
  _onTimecodeUpdate = cb
}

export function setTimecodeStatusCallback(cb: (receiving: boolean) => void): void {
  _onStatusChange = cb
}

/**
 * Feed a raw MIDI message to the timecode engine.
 * Returns true if the message was a timecode message (consumed).
 */
export function processMidiForTimecode(status: number, data1: number, _data2: number, now = clockNow()): boolean {
  if (!_enabled) return false
  if (status !== 0xf1) return false

  _lastMessageTime = now
  if (!_receiving) {
    _receiving = true
    _onStatusChange?.(true)
  }
  const frame = assembler.push(data1)
  if (frame) applyFrame(frame)
  return true
}

function applyFrame(frame: MtcFrame): void {
  _framerate = frame.position.framerate
  _lastPosition = frame.position
  const totalSeconds = frame.seconds + _offset
  _onTimecodeUpdate?.(_lastPosition, totalSeconds)

  const state = getTimelineState()
  const tolerance = 2 * frameDuration(_framerate)

  if (_chase && frame.direction === 'forward') {
    if (!state.isPlaying) {
      setTimelineTime(totalSeconds)
      startTimeline()
      _startedByTimecode = true
    } else if (Math.abs(state.currentTime - totalSeconds) > tolerance) {
      setTimelineTime(totalSeconds)
    }
    return
  }

  if (state.isPlaying) {
    if (Math.abs(state.currentTime - totalSeconds) > tolerance) setTimelineTime(totalSeconds)
  } else {
    // Not playing: follow the position (scrub)
    setTimelineTime(totalSeconds)
  }
}

function signalLost(): void {
  assembler.reset()
  if (_receiving) {
    _receiving = false
    _onStatusChange?.(false)
  }
  if (_startedByTimecode) {
    _startedByTimecode = false
    if (getTimelineState().isPlaying) stopTimeline()
  }
}

/** Check for a dropout (exported for tests; normally run by the watchdog). */
export function checkTimecodeDropout(now = clockNow()): void {
  if (_receiving && now - _lastMessageTime > _dropoutMs) signalLost()
}

// ── Watchdog ──

function startWatchdog(): void {
  if (_watchdogTimer) return
  _watchdogTimer = setInterval(() => checkTimecodeDropout(), 100)
}

function stopWatchdog(): void {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer)
    _watchdogTimer = null
  }
}
