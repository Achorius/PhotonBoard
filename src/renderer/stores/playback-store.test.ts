import { beforeEach, describe, expect, it } from 'vitest'
import { selectGoTargetCuelistId, usePlaybackStore } from './playback-store'

function scene(cueCount: number) {
  const pb = usePlaybackStore.getState()
  const id = pb.addCuelist('Test')
  for (let i = 0; i < cueCount; i++) pb.addCue(id, `Q${i + 1}`, [{ fixtureId: 'f', channelName: `c${i}`, value: 10 * i }])
  return id
}

const cues = (id: string) => usePlaybackStore.getState().cuelists.find((c) => c.id === id)!

describe('playback store — scene editor additions', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [], chases: [], selectedCuelistId: null, selectedChaseId: null })
  })

  it('moveCue reorders and numbers the moved cue between its neighbours', () => {
    const id = scene(3)
    usePlaybackStore.getState().moveCue(id, 0, 2)
    const cl = cues(id)
    expect(cl.cues.map((c) => c.name)).toEqual(['Q2', 'Q3', 'Q1'])
    expect(cl.cues.map((c) => c.number)).toEqual([2, 3, 4])
    usePlaybackStore.getState().moveCue(id, 2, 1)
    expect(cues(id).cues.map((c) => c.number)).toEqual([2, 2.5, 3])
    usePlaybackStore.getState().moveCue(id, 2, 0)
    expect(cues(id).cues.map((c) => c.name)).toEqual(['Q3', 'Q2', 'Q1'])
    expect(cues(id).cues.map((c) => c.number)).toEqual([1, 2, 2.5])
  })

  it('moveCue keeps the playing cue playing', () => {
    const id = scene(3)
    usePlaybackStore.getState().goToCue(id, 1)
    usePlaybackStore.getState().moveCue(id, 1, 2)
    const cl = cues(id)
    expect(cl.cues[cl.currentCueIndex].name).toBe('Q2')
  })

  it('removeCue keeps the current cue and stops an emptied scene', () => {
    const id = scene(3)
    usePlaybackStore.getState().goToCue(id, 2)
    usePlaybackStore.getState().removeCue(id, cues(id).cues[0].id)
    expect(cues(id).cues[cues(id).currentCueIndex].name).toBe('Q3')
    for (const c of [...cues(id).cues]) usePlaybackStore.getState().removeCue(id, c.id)
    expect(cues(id).isPlaying).toBe(false)
    expect(cues(id).currentCueIndex).toBe(-1)
  })

  it('duplicateCuelist copies cues with new ids, stopped, after the source', () => {
    const id = scene(2)
    usePlaybackStore.getState().goCuelist(id)
    const copy = usePlaybackStore.getState().duplicateCuelist(id)!
    const list = usePlaybackStore.getState().cuelists
    expect(list.map((c) => c.id)).toEqual([id, copy])
    expect(list[1].isPlaying).toBe(false)
    expect(list[1].cues[0].id).not.toBe(list[0].cues[0].id)
    expect(list[1].cues.map((c) => c.name)).toEqual(['Q1', 'Q2'])
  })

  it('GO target is the selected scene, else the first', () => {
    const a = scene(1)
    const b = scene(1)
    expect(selectGoTargetCuelistId(usePlaybackStore.getState())).toBe(a)
    usePlaybackStore.getState().selectCuelist(b)
    expect(selectGoTargetCuelistId(usePlaybackStore.getState())).toBe(b)
    usePlaybackStore.getState().removeCuelist(b)
    expect(selectGoTargetCuelistId(usePlaybackStore.getState())).toBe(a)
  })

  it('moveChaseStep reorders steps', () => {
    const pb = usePlaybackStore.getState()
    const id = pb.addChase('C')
    pb.addChaseStep(id, [{ fixtureId: 'a', channelName: 'x', value: 1 }])
    pb.addChaseStep(id, [{ fixtureId: 'b', channelName: 'x', value: 2 }])
    const [s1, s2] = usePlaybackStore.getState().chases[0].steps
    usePlaybackStore.getState().moveChaseStep(id, 0, 1)
    expect(usePlaybackStore.getState().chases[0].steps.map((s) => s.id)).toEqual([s2.id, s1.id])
  })
})
