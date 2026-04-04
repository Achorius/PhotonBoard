import { useEffect, useRef } from 'react'
import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { useDmxStore } from '../stores/dmx-store'
import { startFade, setFadeUpdateCallback, stopFade } from '../lib/cue-engine'

/**
 * Playback controller: wires cuelist GO/Stop actions to the cue-engine
 * and writes fade output to the DMX store.
 * Mount once in App.
 */
export function usePlaybackController(): void {
  const prevCueIndices = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    // Wire fade engine output → DMX store
    setFadeUpdateCallback((allValues) => {
      const dmx = useDmxStore.getState()
      const patch = usePatchStore.getState().patch
      const fixtures = usePatchStore.getState().fixtures

      for (const [, channelMap] of allValues) {
        for (const [key, value] of channelMap) {
          const [fixtureId, channelName] = key.split(':')
          const entry = patch.find(p => p.id === fixtureId)
          if (!entry) continue

          const def = fixtures.find(f => f.id === entry.fixtureDefId)
          if (!def) continue

          const mode = def.modes.find(m => m.name === entry.modeName)
          if (!mode) continue

          const chIndex = mode.channels.findIndex(
            ch => ch.toLowerCase() === channelName.toLowerCase()
          )
          if (chIndex === -1) continue

          const absChannel = entry.address - 1 + chIndex
          if (absChannel >= 0 && absChannel < 512) {
            dmx.setChannel(entry.universe, absChannel, value)
          }
        }
      }
    })

    // Subscribe to cuelist state changes to trigger fades
    const unsub = usePlaybackStore.subscribe((state, prevState) => {
      for (const cl of state.cuelists) {
        const prevIndex = prevCueIndices.current.get(cl.id) ?? -1
        const curIndex = cl.currentCueIndex

        if (curIndex !== prevIndex && curIndex >= 0 && curIndex < cl.cues.length) {
          // Cue index changed — start fade
          const toCue = cl.cues[curIndex]
          const fromCue = prevIndex >= 0 && prevIndex < cl.cues.length
            ? cl.cues[prevIndex]
            : null
          startFade(cl.id, fromCue, toCue)
        }

        if (!cl.isPlaying && prevIndex >= 0) {
          stopFade(cl.id)
        }

        prevCueIndices.current.set(cl.id, curIndex)
      }
    })

    return () => {
      unsub()
      setFadeUpdateCallback(() => {})
    }
  }, [])
}
