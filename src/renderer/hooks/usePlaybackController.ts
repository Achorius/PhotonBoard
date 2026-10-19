import { useEffect } from 'react'
import { startPlaybackController } from '../lib/playback-controller'
import { isRemoteMode } from '../lib/runtime'

/**
 * Playback controller hook: wires scene GO/Back/Stop, faders and flash to the
 * cue engine, and chases to the chase engine (see lib/playback-controller).
 * Mount once in App. Disabled in remote mode — the Pi plays the show.
 */
export function usePlaybackController(): void {
  useEffect(() => {
    if (isRemoteMode()) return
    return startPlaybackController()
  }, [])
}
