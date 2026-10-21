import { useMidiStore, setMidiRouter, setMappingResetFn, setMappingCleanupFn, setTimecodeProcessor, sameMidiTarget } from '../stores/midi-store'
import { useDmxStore, STROBE_RATE_MAX, STROBE_RATE_MIN } from '../stores/dmx-store'
import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { useEffectsStore } from '../stores/effects-store'
import { setProgrammerChannel, clearProgrammerChannel, getProgrammerValue, getMixValue } from './dmx-mixer'
import { toggleTimeline, rewindTimeline, setTimelineTime, stopTimeline } from './timeline-engine'
import { processMidiForTimecode } from './timecode-engine'
import { relativeDelta, sameMidiPort } from './midi-learn'
import { clockNow } from './runtime'
import type { MidiMapping, MidiSourceType } from '@shared/types'

let tapTempoTimes: number[] = []
let tapTempoCallback: ((bpm: number) => void) | null = null

// Track toggle states for toggle behavior (keyed by mapping id)
const toggleStates: Record<string, boolean> = {}

export function initMidiRouting(): void {
  // Wire MTC quarter-frame messages to timecode engine
  setTimecodeProcessor((status, data1, data2) => {
    processMidiForTimecode(status, data1, data2)
  })

  setMidiRouter((type, channel, number, value, deviceName) => {
    for (const mapping of useMidiStore.getState().mappings) {
      if (!mappingMatches(mapping, type, channel, number, deviceName)) continue
      try {
        routeMidiToTarget(mapping, value)
      } catch (e) {
        console.error('[MIDI] mapping failed:', mapping.name, e)
      }
    }
  })

  // Register cleanup: release the target when a mapping is removed.
  // The Grand Master is deliberately left where it is: removing a mapping
  // must never make the stage jump (e.g. GM at 30 % → full).
  setMappingResetFn((mapping: MidiMapping) => {
    if (mapping.target.type !== 'channel') return
    // Another mapping still drives this channel: keep its value
    const others = useMidiStore.getState().mappings.some((m) => m.id !== mapping.id && sameMidiTarget(m.target, mapping.target))
    if (others) return
    const addr = resolveChannelTarget(mapping)
    if (addr) clearProgrammerChannel(addr.universe, addr.channel)
  })

  setMappingCleanupFn((mappingId: string) => {
    delete toggleStates[mappingId]
  })

  // Controller profiles (APC mini…): routing layer before the mappings,
  // LED feedback, soft takeover. Loaded on demand: the layer pulls in the
  // show and UI stores, which plain MIDI routing (and its tests) never need.
  void import('./midi')
    .then((m) => { m.startMidiControllers() })
    .catch((e) => console.warn('[MIDI] controller profiles unavailable:', e))
}

/** Does an incoming message match a mapping's source? (device filter when set) */
export function mappingMatches(
  mapping: MidiMapping,
  type: MidiSourceType,
  channel: number,
  number: number,
  deviceName?: string
): boolean {
  const src = mapping.source
  if (src.type !== type || src.channel !== channel || src.number !== number) return false
  // Same device under another name (show made on a Mac, played on the Pi…)
  if (src.deviceName && deviceName && !sameMidiPort(src.deviceName, deviceName)) return false
  return true
}

/**
 * Value for a continuous control. Absolute: scale 0-127 to min..max.
 * Relative encoder: add the delta to `current` (the target's present value).
 */
export function resolveValue(mapping: MidiMapping, rawValue: number, current: number): number {
  const { options } = mapping
  const min = Number.isFinite(options?.min) ? options.min : 0
  const max = Number.isFinite(options?.max) ? options.max : 255
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)

  if (options?.encoding === 'relative') {
    // Encoders move 2 DMX steps per detent; inverted turns the direction
    const delta = relativeDelta(rawValue) * 2 * (options.inverted ? -1 : 1)
    return Math.round(Math.max(lo, Math.min(hi, current + delta)))
  }

  let value = min + (Math.max(0, Math.min(127, rawValue)) / 127) * (max - min)
  if (options?.inverted) value = max - (value - min)
  return Math.round(Math.max(lo, Math.min(hi, value)))
}

/**
 * Apply behavior mode (toggle/trigger/flash) to resolve a DMX value from a button press.
 * Returns the DMX value to apply, or null if the message should be ignored.
 */
function applyBehavior(mapping: MidiMapping, rawValue: number): number | null {
  const behavior = mapping.options?.behavior || 'direct'

  switch (behavior) {
    case 'toggle': {
      if (rawValue === 0) return null
      const wasOn = toggleStates[mapping.id] ?? false
      toggleStates[mapping.id] = !wasOn
      return wasOn ? mapping.options.min : mapping.options.max
    }
    case 'trigger':
      return rawValue > 0 ? mapping.options.max : mapping.options.min
    case 'flash':
      return rawValue > 0 ? 255 : 0
    case 'direct':
    default:
      return null
  }
}

/** DMX address of a 'channel' mapping's target (undefined when unpatched) */
export function resolveChannelTarget(mapping: MidiMapping): { universe: number; channel: number } | undefined {
  const { target } = mapping
  if (!target.id || !target.parameter) return undefined
  const patchStore = usePatchStore.getState()
  const entry = patchStore.patch.find(p => p.id === target.id)
  if (!entry) return undefined
  const ch = patchStore.getFixtureChannels(entry).find(c => c.name === target.parameter)
  return ch ? { universe: entry.universe, channel: ch.absoluteChannel } : undefined
}

function continuousValue(mapping: MidiMapping, rawValue: number, current: number): number | null {
  if ((mapping.options?.behavior || 'direct') !== 'direct') return applyBehavior(mapping, rawValue)
  return resolveValue(mapping, rawValue, current)
}

function routeMidiToTarget(mapping: MidiMapping, rawValue: number): void {
  const { target, options } = mapping
  const playback = usePlaybackStore.getState()

  switch (target.type) {
    case 'channel': {
      const addr = resolveChannelTarget(mapping)
      if (!addr) break
      const current = getProgrammerValue(addr.universe, addr.channel) ?? getMixValue(addr.universe, addr.channel) ?? 0
      const v = continuousValue(mapping, rawValue, current)
      if (v !== null) setProgrammerChannel(addr.universe, addr.channel, v)
      break
    }

    case 'cuelist_go': {
      if (!target.id) break
      const goBehavior = options?.behavior || 'toggle'
      if (goBehavior === 'trigger') {
        // Play while held
        if (rawValue > 0) playback.goCuelist(target.id)
        else playback.stopCuelist(target.id)
      } else if (goBehavior === 'flash') {
        playback.flashCuelist(target.id, rawValue > 0)
      } else if (goBehavior === 'direct') {
        // Plain GO button
        if (rawValue > 0) playback.goCuelist(target.id)
      } else if (rawValue > 0) {
        // Toggle (default): GO if stopped, STOP if playing
        const scene = playback.cuelists.find(c => c.id === target.id)
        if (scene?.isPlaying) playback.stopCuelist(target.id)
        else playback.goCuelist(target.id)
      }
      break
    }

    case 'cuelist_fader': {
      if (!target.id) break
      const current = playback.cuelists.find(c => c.id === target.id)?.faderLevel ?? 0
      const v = continuousValue(mapping, rawValue, current)
      if (v !== null) playback.setCuelistFader(target.id, v)
      break
    }

    case 'chase_toggle': {
      if (rawValue > 0 && target.id) playback.toggleChase(target.id)
      break
    }

    case 'chase_bpm': {
      if (!target.id) break
      const chase = playback.chases.find(c => c.id === target.id)
      if (!chase) break
      if (options?.encoding === 'relative') {
        playback.setChaseBpm(target.id, Math.max(30, Math.min(300, chase.bpm + relativeDelta(rawValue))))
      } else {
        playback.setChaseBpm(target.id, Math.round(30 + (Math.max(0, Math.min(127, rawValue)) / 127) * 270))
      }
      break
    }

    case 'master': {
      const v = continuousValue(mapping, rawValue, useDmxStore.getState().grandMaster)
      if (v !== null) useDmxStore.getState().setGrandMaster(v)
      break
    }

    case 'effect_toggle': {
      if (!target.id) break
      const effects = useEffectsStore.getState()
      const behavior = options?.behavior || 'toggle'
      if (behavior === 'trigger' || behavior === 'flash') {
        // Run while held
        effects.setEffectRunning(target.id, rawValue > 0)
      } else if (rawValue > 0) {
        effects.toggleEffect(target.id)
      }
      break
    }

    case 'blackout': {
      if (rawValue > 0) useDmxStore.getState().toggleBlackout()
      break
    }

    case 'blinder': {
      // Hold = blinder on, release = blinder off
      useDmxStore.getState().toggleBlinder(rawValue > 0)
      break
    }

    case 'strobe': {
      // Hold = strobe on, release = strobe off
      useDmxStore.getState().toggleStrobe(rawValue > 0)
      break
    }

    case 'strobe_rate': {
      // Fader: 1-25 Hz over its travel; encoder: ±1 Hz per detent
      const dmx = useDmxStore.getState()
      if (options?.encoding === 'relative') dmx.setStrobeRate(dmx.strobeRate + relativeDelta(rawValue) * (options.inverted ? -1 : 1))
      else {
        const f = Math.max(0, Math.min(127, rawValue)) / 127
        dmx.setStrobeRate(Math.round(STROBE_RATE_MIN + (options?.inverted ? 1 - f : f) * (STROBE_RATE_MAX - STROBE_RATE_MIN)))
      }
      break
    }

    case 'reset': {
      if (rawValue > 0) useDmxStore.getState().resetAll()
      break
    }

    case 'flash': {
      if (target.id) playback.flashCuelist(target.id, rawValue > 0)
      break
    }

    case 'tap_tempo': {
      if (rawValue > 0) handleTapTempo(target.id)
      break
    }

    case 'timeline_play': {
      if (rawValue > 0) toggleTimeline()
      break
    }

    case 'timeline_stop': {
      if (rawValue > 0) stopTimeline()
      break
    }

    case 'timeline_rewind': {
      if (rawValue > 0) rewindTimeline()
      break
    }

    case 'timeline_goto_marker': {
      if (rawValue > 0 && target.id) {
        const marker = playback.timelineMarkers.find(m => m.id === target.id)
        if (marker) setTimelineTime(marker.time)
      }
      break
    }

    case 'timeline_goto_zone': {
      if (rawValue > 0 && target.id) {
        const zone = playback.timelineZones.find(z => z.id === target.id)
        if (zone) setTimelineTime(zone.startTime)
      }
      break
    }
  }
}

/** Average the last taps into a BPM (null until two taps within 3 s). */
export function computeTapTempo(times: number[]): number | null {
  if (times.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1])
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
  if (!(avg > 0)) return null
  return Math.round(60000 / avg)
}

/**
 * Register a tap. Applies the tempo to `chaseId`, or to every playing chase
 * when no chase is given, and notifies the tap-tempo callback. Returns the
 * tempo (null until two taps).
 */
export function handleTapTempo(chaseId?: string, now = clockNow()): number | null {
  const last = tapTempoTimes[tapTempoTimes.length - 1]
  if (last !== undefined && now - last > 3000) tapTempoTimes = []
  tapTempoTimes.push(now)
  if (tapTempoTimes.length > 8) tapTempoTimes.shift()

  const bpm = computeTapTempo(tapTempoTimes)
  if (bpm === null) return null
  const playback = usePlaybackStore.getState()
  const targets = chaseId ? [chaseId] : playback.chases.filter(c => c.isPlaying).map(c => c.id)
  for (const id of targets) playback.setChaseBpm(id, bpm)
  tapTempoCallback?.(bpm)
  return bpm
}

export function setTapTempoCallback(cb: (bpm: number) => void): void {
  tapTempoCallback = cb
}
