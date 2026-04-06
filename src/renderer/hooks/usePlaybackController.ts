import { useEffect, useRef } from 'react'
import { usePlaybackStore } from '../stores/playback-store'
import { setDmxProgrammerHook } from '../stores/dmx-store'
import { startFade, stopFade, setCuelistMaster } from '../lib/cue-engine'
import { startChase, stopChase } from '../lib/chase-engine'
import { startMixer, setProgrammerChannel } from '../lib/dmx-mixer'

/**
 * Playback controller: wires cuelist GO/Stop and chase toggle
 * to the cue-engine and chase-engine. Both engines feed the
 * central DMX mixer which handles HTP/LTP merging.
 *
 * Mount once in App.
 */
export function usePlaybackController(): void {
  const prevCueIndices = useRef<Map<string, number>>(new Map())
  const prevChasePlaying = useRef<Map<string, boolean>>(new Map())

  useEffect(() => {
    // Wire the programmer hook so manual fader changes go through the mixer
    setDmxProgrammerHook(setProgrammerChannel)

    // Start the central DMX mixer
    startMixer()

    // Subscribe to playback state changes
    const unsub = usePlaybackStore.subscribe((state, prevState) => {
      // --- Cuelists ---
      for (const cl of state.cuelists) {
        const prevIndex = prevCueIndices.current.get(cl.id) ?? -1
        const curIndex = cl.currentCueIndex

        if (curIndex !== prevIndex && curIndex >= 0 && curIndex < cl.cues.length) {
          const toCue = cl.cues[curIndex]
          const fromCue = prevIndex >= 0 && prevIndex < cl.cues.length
            ? cl.cues[prevIndex]
            : null
          startFade(cl.id, fromCue, toCue, cl.priority, cl.faderLevel)
        }

        if (!cl.isPlaying && prevIndex >= 0) {
          stopFade(cl.id)
        }

        prevCueIndices.current.set(cl.id, curIndex)
      }

      // Update cuelist master faders
      for (const cl of state.cuelists) {
        const prev = prevState?.cuelists?.find(p => p.id === cl.id)
        if (prev && prev.faderLevel !== cl.faderLevel) {
          setCuelistMaster(cl.id, cl.faderLevel)
        }
      }

      // --- Chases ---
      for (const ch of state.chases) {
        const wasPlaying = prevChasePlaying.current.get(ch.id) ?? false

        if (ch.isPlaying && !wasPlaying) {
          startChase(ch)
        } else if (!ch.isPlaying && wasPlaying) {
          stopChase(ch.id)
        }

        prevChasePlaying.current.set(ch.id, ch.isPlaying)
      }
    })

    return () => {
      unsub()
      setDmxProgrammerHook(null)
    }
  }, [])
}
