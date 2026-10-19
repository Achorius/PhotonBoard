import { afterEach, describe, expect, it } from 'vitest'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { MIN_FOLLOW_MS, startPlaybackController } from './playback-controller'
import { runMixerFrame } from './dmx-mixer'
import { clockNow } from './runtime'

describe('auto-follow', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    usePlaybackStore.getState().releaseAll()
    stop?.()
    stop = null
    usePlaybackStore.setState({ cuelists: [] })
  })

  it('a looping scene of 0-fade / 0-follow cues does not GO on every frame', () => {
    usePlaybackStore.setState({ cuelists: [], chases: [] })
    stop = startPlaybackController()
    const pb = usePlaybackStore.getState()
    const id = pb.addCuelist('Spin')
    pb.addCue(id, 'Q1', [{ fixtureId: 'f', channelName: 'Dimmer', value: 255 }], 0, 0)
    pb.addCue(id, 'Q2', [{ fixtureId: 'f', channelName: 'Dimmer', value: 0 }], 0, 0)
    const cues = usePlaybackStore.getState().cuelists[0].cues
    for (const c of cues) usePlaybackStore.getState().updateCue(id, c.id, { followTime: 0 })
    usePlaybackStore.getState().setCuelistLooping(id, true)

    const changes: number[] = []
    let last = -2
    const unsub = usePlaybackStore.subscribe((s) => {
      const idx = s.cuelists.find((c) => c.id === id)?.currentCueIndex ?? -1
      if (idx !== last) { last = idx; changes.push(t) }
    })
    const t0 = clockNow() + 1000
    let t = t0
    usePlaybackStore.getState().goCuelist(id)
    // 1 s of frames at 40 Hz
    for (let i = 0; i < 40; i++) {
      t = t0 + i * 25
      runMixerFrame(t)
    }
    unsub()
    expect(changes.length).toBeGreaterThan(2) // it still loops…
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i] - changes[i - 1]).toBeGreaterThanOrEqual(MIN_FOLLOW_MS) // …but never faster than the minimum
    }
  })
})
