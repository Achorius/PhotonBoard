import { useMidiStore, setMidiRouter } from '../stores/midi-store'
import { useDmxStore } from '../stores/dmx-store'
import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { midiToDmx } from './dmx-utils'

let tapTempoTimes: number[] = []
let tapTempoCallback: ((bpm: number) => void) | null = null

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

function routeMidiToTarget(mapping: any, rawValue: number): void {
  const { target, options } = mapping

  // Apply min/max/invert
  let value = rawValue
  if (mapping.source.type === 'cc') {
    const range = options.max - options.min
    value = options.min + (rawValue / 127) * range
    if (options.inverted) value = options.max - (value - options.min)
    value = Math.round(value)
  }

  switch (target.type) {
    case 'channel': {
      if (!target.id || !target.parameter) break
      const patchStore = usePatchStore.getState()
      const entry = patchStore.patch.find(p => p.id === target.id)
      if (!entry) break
      const channels = patchStore.getFixtureChannels(entry)
      const ch = channels.find(c => c.name === target.parameter)
      if (ch) {
        useDmxStore.getState().setChannel(entry.universe, ch.absoluteChannel, midiToDmx(rawValue))
      }
      break
    }

    case 'cuelist_go': {
      if (mapping.source.type === 'note' && rawValue > 0) {
        usePlaybackStore.getState().goCuelist(target.id!)
      }
      break
    }

    case 'cuelist_fader': {
      usePlaybackStore.getState().setCuelistFader(target.id!, midiToDmx(rawValue))
      break
    }

    case 'chase_toggle': {
      if (mapping.source.type === 'note' && rawValue > 0) {
        usePlaybackStore.getState().toggleChase(target.id!)
      }
      break
    }

    case 'chase_bpm': {
      const bpm = 30 + (rawValue / 127) * 270 // 30-300 BPM range
      usePlaybackStore.getState().setChaseBpm(target.id!, Math.round(bpm))
      break
    }

    case 'master': {
      useDmxStore.getState().setGrandMaster(midiToDmx(rawValue))
      break
    }

    case 'blackout': {
      if (mapping.source.type === 'note' && rawValue > 0) {
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
