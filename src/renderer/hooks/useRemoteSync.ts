// ============================================================
// PhotonBoard — Remote State Sync
// Bidirectional sync between Mac browser ↔ Pi:
//   Pi → Mac: state broadcasts update local cuelist/DMX stores
//   Mac → Pi: cuelist actions are forwarded as commands
// Only active in remote mode (browser, no Electron).
//
// Guard: _applyingRemoteState prevents feedback loops.
// When the Pi broadcasts state → Mac updates stores → the store
// subscription would send commands back to Pi → infinite loop.
// The flag suppresses outgoing commands during inbound state apply.
// ============================================================

import { useEffect } from 'react'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'

const pb = () => (window as any).photonboard

/** True when running in browser (remote mode) */
export function isRemote(): boolean {
  return !!pb()?.remote?.isRemote
}

/**
 * Guard flag: set to true while applying remote state into local stores.
 * While true, the Mac → Pi subscription ignores changes (they came from Pi).
 */
let _applyingRemoteState = false

/**
 * Hook: bidirectional sync between Mac browser and Pi.
 * Call once in the root App component.
 */
export function useRemoteSync(): void {
  // ---- Pi → Mac: sync state broadcasts into local stores ----
  useEffect(() => {
    if (!isRemote()) return

    const unsub = pb().remote.onState((data: any) => {
      if (!data) return

      _applyingRemoteState = true
      try {
        // Sync cuelist play/fader states
        const piCuelists = data.cuelists
        if (piCuelists && Array.isArray(piCuelists)) {
          const local = usePlaybackStore.getState().cuelists
          let changed = false
          const updated = local.map(cl => {
            const pi = piCuelists.find((p: any) => p.id === cl.id)
            if (!pi) return cl
            if (cl.isPlaying !== pi.isPlaying || cl.faderLevel !== pi.faderLevel) {
              changed = true
              return { ...cl, isPlaying: pi.isPlaying, faderLevel: pi.faderLevel }
            }
            return cl
          })
          if (changed) usePlaybackStore.setState({ cuelists: updated })
        }

        // Sync grand master
        if (data.grandMaster !== undefined) {
          if (useDmxStore.getState().grandMaster !== data.grandMaster) {
            useDmxStore.setState({ grandMaster: data.grandMaster })
          }
        }

        // Sync blackout
        if (data.blackout !== undefined) {
          if (useDmxStore.getState().blackout !== data.blackout) {
            useDmxStore.setState({ blackout: data.blackout })
          }
        }

        // Sync DMX values (for 3D visualizer on Mac)
        if (data.dmxValues && Array.isArray(data.dmxValues)) {
          useDmxStore.setState({ values: data.dmxValues })
        }
      } finally {
        _applyingRemoteState = false
      }
    })

    return unsub
  }, [])

  // ---- Mac → Pi: intercept local cuelist actions, relay as commands ----
  useEffect(() => {
    if (!isRemote()) return

    // Subscribe to playback store changes and forward to Pi
    const unsub = usePlaybackStore.subscribe(
      (state, prev) => {
        // Skip if this change came from a Pi state broadcast
        if (_applyingRemoteState) return

        for (const cl of state.cuelists) {
          const prevCl = prev.cuelists.find(p => p.id === cl.id)
          if (!prevCl) continue

          // Detect play state changes (user toggled a scene)
          if (cl.isPlaying && !prevCl.isPlaying) {
            pb().remote.sendCommand('go-cuelist', cl.id)
          } else if (!cl.isPlaying && prevCl.isPlaying) {
            pb().remote.sendCommand('stop-cuelist', cl.id)
          }

          // Detect fader changes
          if (cl.faderLevel !== prevCl.faderLevel) {
            pb().remote.sendCommand('set-cuelist-fader', { id: cl.id, level: cl.faderLevel })
          }
        }
      }
    )

    // Subscribe to DMX store for grand master / blackout changes
    const unsubDmx = useDmxStore.subscribe(
      (state, prev) => {
        // Skip if this change came from a Pi state broadcast
        if (_applyingRemoteState) return

        if (state.grandMaster !== prev.grandMaster) {
          pb().remote.sendCommand('set-grand-master', state.grandMaster)
        }
        if (state.blackout !== prev.blackout) {
          pb().remote.sendCommand('set-blackout', state.blackout)
        }
      }
    )

    return () => { unsub(); unsubDmx() }
  }, [])
}
