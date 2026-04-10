// ============================================================
// PhotonBoard — Timecode Engine
// Receives MIDI Time Code (MTC) quarter-frame messages and
// converts them to absolute time. Can sync the timeline engine
// to external timecode sources (DAW, QLab, media server, etc.)
// ============================================================

import { setTimelineTime, startTimeline, stopTimeline, getTimelineState } from './timeline-engine'

// ── SMPTE Framerates ──
export type TimecodeFramerate = 24 | 25 | 29.97 | 30
export const FRAMERATES: TimecodeFramerate[] = [24, 25, 29.97, 30]

export interface TimecodePosition {
  hours: number
  minutes: number
  seconds: number
  frames: number
  framerate: TimecodeFramerate
}

// ── State ──
let _enabled = false
let _framerate: TimecodeFramerate = 25
let _offset = 0 // seconds offset to apply to incoming timecode
let _lastPosition: TimecodePosition = { hours: 0, minutes: 0, seconds: 0, frames: 0, framerate: 25 }
let _receiving = false
let _lastMessageTime = 0

// MTC quarter-frame assembly (8 pieces = 1 full frame)
const _quarterFrameData = new Uint8Array(8)
let _quarterFrameCount = 0

// Callbacks
let _onTimecodeUpdate: ((pos: TimecodePosition, totalSeconds: number) => void) | null = null
let _onStatusChange: ((receiving: boolean) => void) | null = null

// Watchdog timer — detect when MTC stops arriving
let _watchdogTimer: ReturnType<typeof setInterval> | null = null

// ── Public API ──

export function enableTimecode(enabled: boolean): void {
  _enabled = enabled
  if (enabled) {
    startWatchdog()
  } else {
    stopWatchdog()
    _receiving = false
    _onStatusChange?.(false)
  }
}

export function isTimecodeEnabled(): boolean {
  return _enabled
}

export function isTimecodeReceiving(): boolean {
  return _receiving
}

export function setTimecodeFramerate(fps: TimecodeFramerate): void {
  _framerate = fps
  _lastPosition.framerate = fps
}

export function getTimecodeFramerate(): TimecodeFramerate {
  return _framerate
}

export function setTimecodeOffset(seconds: number): void {
  _offset = seconds
}

export function getTimecodeOffset(): number {
  return _offset
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
 * Call this from the MIDI message handler for every message.
 * Returns true if the message was a timecode message (consumed).
 */
export function processMidiForTimecode(status: number, data1: number, _data2: number): boolean {
  if (!_enabled) return false

  // MTC Quarter Frame: status = 0xF1
  if (status === 0xf1) {
    processQuarterFrame(data1)
    return true
  }

  // Full Frame (SysEx): F0 7F 7F 01 01 hh mm ss ff F7
  // Not handled here since sysex:false in requestMIDIAccess
  // Could be added later if sysex is enabled

  return false
}

/**
 * Convert a TimecodePosition to total seconds.
 */
export function timecodeToSeconds(pos: TimecodePosition): number {
  return pos.hours * 3600 + pos.minutes * 60 + pos.seconds + pos.frames / pos.framerate
}

/**
 * Convert total seconds to a TimecodePosition.
 */
export function secondsToTimecode(totalSeconds: number, framerate: TimecodeFramerate = _framerate): TimecodePosition {
  const s = Math.max(0, totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = Math.floor(s % 60)
  const frames = Math.floor((s % 1) * framerate)
  return { hours, minutes, seconds, frames, framerate }
}

/**
 * Format a TimecodePosition as "HH:MM:SS:FF"
 */
export function formatTimecode(pos: TimecodePosition): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(pos.hours)}:${pad(pos.minutes)}:${pad(pos.seconds)}:${pad(pos.frames)}`
}

/**
 * Format total seconds as timecode string.
 */
export function formatSecondsAsTimecode(totalSeconds: number, framerate: TimecodeFramerate = _framerate): string {
  return formatTimecode(secondsToTimecode(totalSeconds, framerate))
}

// ── MTC Quarter Frame Processing ──

function processQuarterFrame(data: number): void {
  const piece = (data >> 4) & 0x07 // bits 6-4: piece number (0-7)
  const nibble = data & 0x0f       // bits 3-0: data nibble

  _quarterFrameData[piece] = nibble
  _quarterFrameCount++
  _lastMessageTime = performance.now()

  if (!_receiving) {
    _receiving = true
    _onStatusChange?.(true)
  }

  // After 8 pieces we have a complete frame
  if (_quarterFrameCount >= 8) {
    _quarterFrameCount = 0
    assembleFullFrame()
  }
}

function assembleFullFrame(): void {
  // MTC quarter frame layout:
  // Piece 0: frames low nibble
  // Piece 1: frames high nibble (bits 0-0 only, bit 1 = frame type flag)
  // Piece 2: seconds low nibble
  // Piece 3: seconds high nibble (bits 0-1 only)
  // Piece 4: minutes low nibble
  // Piece 5: minutes high nibble (bits 0-1 only)
  // Piece 6: hours low nibble
  // Piece 7: hours high nibble (bit 0 only) + framerate type (bits 1-2)

  const frames = (_quarterFrameData[0]) | ((_quarterFrameData[1] & 0x01) << 4)
  const seconds = (_quarterFrameData[2]) | ((_quarterFrameData[3] & 0x03) << 4)
  const minutes = (_quarterFrameData[4]) | ((_quarterFrameData[5] & 0x03) << 4)
  const hours = (_quarterFrameData[6]) | ((_quarterFrameData[7] & 0x01) << 4)

  // Framerate from bits 1-2 of piece 7
  const rateType = (_quarterFrameData[7] >> 1) & 0x03
  const detectedRate: TimecodeFramerate = rateType === 0 ? 24 : rateType === 1 ? 25 : rateType === 2 ? 29.97 : 30
  _framerate = detectedRate

  _lastPosition = { hours, minutes, seconds, frames, framerate: detectedRate }
  const totalSeconds = timecodeToSeconds(_lastPosition) + _offset

  _onTimecodeUpdate?.(_lastPosition, totalSeconds)

  // Sync timeline to timecode position
  const state = getTimelineState()
  if (state.isPlaying) {
    // Only sync if drift is significant (> 1 frame)
    const drift = Math.abs(state.currentTime - totalSeconds)
    if (drift > 1 / detectedRate) {
      setTimelineTime(totalSeconds)
    }
  } else {
    // If timeline not playing, just set position (scrub mode)
    setTimelineTime(totalSeconds)
  }
}

// ── Watchdog ──

function startWatchdog(): void {
  if (_watchdogTimer) return
  _watchdogTimer = setInterval(() => {
    if (_receiving && performance.now() - _lastMessageTime > 500) {
      // No MTC for 500ms — signal lost
      _receiving = false
      _quarterFrameCount = 0
      _onStatusChange?.(false)
    }
  }, 250)
}

function stopWatchdog(): void {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer)
    _watchdogTimer = null
  }
}
