import { useEffect, useRef } from 'react'
import { usePlaybackStore } from '../stores/playback-store'
import { usePatchStore } from '../stores/patch-store'
import { useDmxStore } from '../stores/dmx-store'
import { startFade, setFadeUpdateCallback, setFadeCompleteCallback, stopFade } from '../lib/cue-engine'
import { startChase, stopChase } from '../lib/chase-engine'

/**
 * Playback controller: wires scene GO/Stop to the cue-engine
 * and chase toggle to the chase-engine.
 * Handles auto-advance (loop + followTime).
 * Mount once in App.
 */
export function usePlaybackController(): void {
  // Track both index AND generation so re-triggers on same index work
  const prevState = useRef<Map<string, { index: number; gen: number }>>(new Map())
  const prevChasePlaying = useRef<Map<string, boolean>>(new Map())
  const followTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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

    // Handle fade completion → auto-advance for loop/followTime
    setFadeCompleteCallback((cuelistId) => {
      const state = usePlaybackStore.getState()
      const cl = state.cuelists.find(c => c.id === cuelistId)
      if (!cl || !cl.isPlaying) return

      const currentCue = cl.cues[cl.currentCueIndex]
      if (!currentCue) return

      // Check if there's a followTime on this cue
      const hasFollowTime = currentCue.followTime !== null && currentCue.followTime !== undefined
      // Check if we should auto-advance (loop or followTime)
      const isLastStep = cl.currentCueIndex >= cl.cues.length - 1
      const shouldAutoAdvance = hasFollowTime || (isLastStep && cl.isLooping) || (!isLastStep)

      if (!shouldAutoAdvance) return

      // For looping on last step or followTime: schedule next GO
      const waitTime = hasFollowTime ? (currentCue.followTime! * 1000) : 0

      // Only auto-advance if looping or not at last step, or followTime is set
      if (isLastStep && !cl.isLooping && !hasFollowTime) return
      if (!isLastStep && !hasFollowTime) return // Non-last step without followTime = manual GO

      // Clear any existing timer for this cuelist
      const existingTimer = followTimers.current.get(cuelistId)
      if (existingTimer) clearTimeout(existingTimer)

      const timer = setTimeout(() => {
        followTimers.current.delete(cuelistId)
        // Re-check state in case stop was pressed during wait
        const currentState = usePlaybackStore.getState()
        const currentCl = currentState.cuelists.find(c => c.id === cuelistId)
        if (currentCl && currentCl.isPlaying) {
          usePlaybackStore.getState().goCuelist(cuelistId)
        }
      }, waitTime)

      followTimers.current.set(cuelistId, timer)
    })

    // Subscribe to playback state changes
    const unsub = usePlaybackStore.subscribe((state) => {
      // --- Scenes (Cuelists) ---
      for (const cl of state.cuelists) {
        const prev = prevState.current.get(cl.id) ?? { index: -1, gen: -1 }
        const curIndex = cl.currentCueIndex
        const curGen = cl.goGeneration ?? 0

        // Trigger fade if index or generation changed
        const changed = curIndex !== prev.index || curGen !== prev.gen
        if (changed && curIndex >= 0 && curIndex < cl.cues.length && cl.isPlaying) {
          const toCue = cl.cues[curIndex]
          const fromCue = prev.index >= 0 && prev.index < cl.cues.length
            ? cl.cues[prev.index]
            : null
          startFade(cl.id, fromCue, toCue)
        }

        // Stop: isPlaying went from true to false
        if (!cl.isPlaying && prev.index >= 0) {
          stopFade(cl.id)
          // Clear any pending auto-advance timer
          const timer = followTimers.current.get(cl.id)
          if (timer) {
            clearTimeout(timer)
            followTimers.current.delete(cl.id)
          }
        }

        prevState.current.set(cl.id, { index: curIndex, gen: curGen })
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
      setFadeUpdateCallback(() => {})
      setFadeCompleteCallback(() => {})
      // Clear all follow timers
      for (const timer of followTimers.current.values()) {
        clearTimeout(timer)
      }
      followTimers.current.clear()
    }
  }, [])
}
