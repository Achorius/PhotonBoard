import { useMidiStore, setMidiRouter } from '../stores/midi-store'
import { useDmxStore } from '../stores/dmx-store'
import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { midiToDmx } from './dmx-utils'

let tapTempoTimes: number[] = []
let tapTempoCallback: ((bpm: number) => void) | null = null

// Track current accumulated values for relative encoders (keyed by mapping id)
const relativeValues: Record<string, number> = {}

// Track toggle states for toggle behavior (keyed by mapping id)
const toggleStates: Record<string, boolean> = {}

export function initMidiRouting(): void {
  setMidiRouter((type, channel, number, value) => {
    const mappings = useMidiStore.getState().mappings

    for (const mapping of mappings) {
      if (mapping.source.type !== type) continue
      if (mapping.source.channel !== channel) continue
      if (mapping.source.number !== number) continue

      routeMidiToTarget(mapping, value)
    }
  })
}

function resolveValue(mapping: any, rawValue: number): number {
  const { options } = mapping
  const encoding = options?.encoding || 'absolute'

  if (encoding === 'relative') {
    // Relative encoder: two's complement
    // 1-63 = clockwise (increment), 65-127 = counter-clockwise (decrement)
    let delta: number
    if (rawValue <= 63) {
      delta = rawValue // positive increment
    } else {
      delta = rawValue - 128 // negative (127 → -1, 126 → -2, etc.)
    }

    // Scale delta: multiply by 2 for faster response
    delta *= 2

    // Get or init current accumulated value
    const current = relativeValues[mapping.id] ?? 0
    let newVal = current + delta

    // Clamp to min/max
    newVal = Math.max(options.min, Math.min(options.max, newVal))
    if (options.inverted) newVal = options.max - (newVal - options.min)
    relativeValues[mapping.id] = options.inverted ? (options.max - (newVal - options.min)) : newVal

    // Store the uninverted value for next iteration
    relativeValues[mapping.id] = current + delta
    relativeValues[mapping.id] = Math.max(options.min, Math.min(options.max, relativeValues[mapping.id]))

    return Math.round(options.inverted ? (options.max - (relativeValues[mapping.id] - options.min)) : relativeValues[mapping.id])
  }

  // Absolute: scale raw 0-127 to min-max range
  const range = options.max - options.min
  let value = options.min + (rawValue / 127) * range
  if (options.inverted) value = options.max - (value - options.min)
  return Math.round(value)
}

/**
 * Apply behavior mode (toggle/trigger/flash) to resolve a DMX value from a button press.
 * Returns the DMX value to apply, or null if the message should be ignored.
 */
function applyBehavior(mapping: any, rawValue: number): number | null {
  const behavior = mapping.options?.behavior || 'direct'

  switch (behavior) {
    case 'toggle': {
      // Only react on note-on / CC > 0 (button press)
      if (rawValue === 0) return null
      const wasOn = toggleStates[mapping.id] ?? false
      toggleStates[mapping.id] = !wasOn
      return wasOn ? mapping.options.min : mapping.options.max
    }
    case 'trigger': {
      // On while held, off on release
      return rawValue > 0 ? mapping.options.max : mapping.options.min
    }
    case 'flash': {
      // Full value while held, 0 on release
      return rawValue > 0 ? 255 : 0
    }
    case 'direct':
    default:
      return null // handled by resolveValue
  }
}

function routeMidiToTarget(mapping: any, rawValue: number): void {
  const { target, options } = mapping
  const behavior = options?.behavior || 'direct'

  switch (target.type) {
    case 'channel': {
      if (!target.id || !target.parameter) break
      const patchStore = usePatchStore.getState()
      const entry = patchStore.patch.find(p => p.id === target.id)
      if (!entry) break
      const channels = patchStore.getFixtureChannels(entry)
      const ch = channels.find(c => c.name === target.parameter)
      if (ch) {
        let dmxValue: number
        if (behavior !== 'direct') {
          const bval = applyBehavior(mapping, rawValue)
          if (bval === null) break // ignore (e.g. note-off in toggle mode)
          dmxValue = bval
        } else {
          dmxValue = resolveValue(mapping, rawValue)
        }
        useDmxStore.getState().setChannel(entry.universe, ch.absoluteChannel, dmxValue)
      }
      break
    }

    case 'cuelist_go': {
      if (rawValue > 0) {
        usePlaybackStore.getState().goCuelist(target.id!)
      }
      break
    }

    case 'cuelist_fader': {
      if (behavior !== 'direct') {
        const bval = applyBehavior(mapping, rawValue)
        if (bval !== null) usePlaybackStore.getState().setCuelistFader(target.id!, bval)
      } else {
        const faderVal = resolveValue(mapping, rawValue)
        usePlaybackStore.getState().setCuelistFader(target.id!, faderVal)
      }
      break
    }

    case 'chase_toggle': {
      if (rawValue > 0) {
        usePlaybackStore.getState().toggleChase(target.id!)
      }
      break
    }

    case 'chase_bpm': {
      const encoding = options?.encoding || 'absolute'
      if (encoding === 'relative') {
        const current = relativeValues[mapping.id] ?? 120
        let delta = rawValue <= 63 ? rawValue : rawValue - 128
        relativeValues[mapping.id] = Math.max(30, Math.min(300, current + delta))
        usePlaybackStore.getState().setChaseBpm(target.id!, Math.round(relativeValues[mapping.id]))
      } else {
        const bpm = 30 + (rawValue / 127) * 270
        usePlaybackStore.getState().setChaseBpm(target.id!, Math.round(bpm))
      }
      break
    }

    case 'master': {
      if (behavior !== 'direct') {
        const bval = applyBehavior(mapping, rawValue)
        if (bval !== null) useDmxStore.getState().setGrandMaster(bval)
      } else {
        const masterVal = resolveValue(mapping, rawValue)
        useDmxStore.getState().setGrandMaster(masterVal)
      }
      break
    }

    case 'blackout': {
      if (rawValue > 0) {
        useDmxStore.getState().toggleBlackout()
      }
      break
    }

    case 'flash': {
      usePlaybackStore.getState().flashCuelist(target.id!, rawValue > 0)
      break
    }

    case 'tap_tempo': {
      if (rawValue > 0) handleTapTempo()
      break
    }
  }
}

function handleTapTempo(): void {
  const now = performance.now()
  tapTempoTimes.push(now)

  // Keep only last 8 taps
  if (tapTempoTimes.length > 8) tapTempoTimes.shift()
  // Reset if gap > 3 seconds
  if (tapTempoTimes.length >= 2) {
    const lastGap = tapTempoTimes[tapTempoTimes.length - 1] - tapTempoTimes[tapTempoTimes.length - 2]
    if (lastGap > 3000) {
      tapTempoTimes = [now]
      return
    }
  }

  if (tapTempoTimes.length >= 2) {
    const intervals: number[] = []
    for (let i = 1; i < tapTempoTimes.length; i++) {
      intervals.push(tapTempoTimes[i] - tapTempoTimes[i - 1])
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const bpm = Math.round(60000 / avgInterval)
    if (tapTempoCallback) tapTempoCallback(bpm)
  }
}

export function setTapTempoCallback(cb: (bpm: number) => void): void {
  tapTempoCallback = cb
}
