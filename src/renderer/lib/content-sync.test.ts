import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The UI store reads the window at import time (no DOM under node)
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import type { Cuelist } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { installDirtyTracking } from './show-io'
import {
  applyContentFromRemote, collectCurrentContent, getContentState, installContentTracking, planContentFetch, sectionsToApply, withContentBump
} from './content-sync'
import { CONTENT_SECTIONS } from '@shared/show-format'

function cuelist(id: string, extra: Partial<Cuelist> = {}): Cuelist {
  return {
    id, name: id, cues: [{ id: `${id}-q1`, name: 'Q1', number: 1, values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 200 }], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }],
    currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...extra
  }
}

const rev = (s: string) => getContentState().sections[s]

describe('console: merging a remote edit', () => {
  let offs: (() => void)[] = []
  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [cuelist('a', { isPlaying: true, currentCueIndex: 0, faderLevel: 90 }), cuelist('b')], chases: [] })
    useEffectsStore.setState({ effects: [] })
    useUiStore.getState().setDirty(false)
    offs = [installContentTracking(), installDirtyTracking()]
  })
  afterEach(() => { for (const off of offs) off() })

  it('keeps playback running, marks the show dirty and attributes the revision', () => {
    const before = rev('cuelists').rev
    const ok = applyContentFromRemote({
      origin: 'remote-1',
      seq: 7,
      sections: { cuelists: { upsert: [{ ...cuelist('a'), name: 'Opening' }, cuelist('new')], remove: ['b'] } }
    })
    expect(ok).toBe(true)
    const list = usePlaybackStore.getState().cuelists
    expect(list.map(c => c.id)).toEqual(['a', 'new'])
    expect(list[0].name).toBe('Opening')
    expect(list[0].isPlaying).toBe(true)
    expect(list[0].currentCueIndex).toBe(0)
    expect(list[0].faderLevel).toBe(90)
    expect(useUiStore.getState().isDirty).toBe(true)
    // Exactly one revision, produced by that remote
    expect(rev('cuelists')).toEqual({ rev: before + 1, by: 'remote-1', seq: 7 })
    expect(collectCurrentContent('remote-1', ['cuelists']).appliedSeq).toBe(7)
  })

  it('a local console edit bumps without an origin; runtime changes do not bump', () => {
    const before = rev('cuelists').rev
    usePlaybackStore.getState().setCuelistFader('a', 10)
    usePlaybackStore.getState().stopCuelist('a')
    expect(rev('cuelists').rev).toBe(before)
    usePlaybackStore.getState().renameCuelist('b', 'Finale')
    expect(rev('cuelists')).toEqual({ rev: before + 1 })
  })

  it('a section the remote sent is bumped once even when nothing changed', () => {
    const before = rev('cuelists').rev
    applyContentFromRemote({ origin: 'r', seq: 1, sections: { cuelists: { upsert: [cuelist('b')] } } })
    expect(rev('cuelists')).toEqual({ rev: before + 1, by: 'r', seq: 1 })
  })

  it('refuses malformed payloads', () => {
    expect(applyContentFromRemote(null)).toBe(false)
    expect(applyContentFromRemote({ origin: 'r', seq: 1, sections: { nope: {} } })).toBe(false)
  })

  it('get-current carries the content without runtime state', () => {
    const res = collectCurrentContent(undefined, ['cuelists', 'executor'])
    expect(res.success).toBe(true)
    const cls = res.show!.cuelists as Cuelist[]
    expect(cls[0].isPlaying).toBe(false)
    expect(res.show!.executor).toBeDefined()
    expect(res.show!.patch).toBeUndefined()
    expect(res.content!.sections.cuelists.rev).toBe(rev('cuelists').rev)
  })

  it('withContentBump bumps the named section exactly once', () => {
    const before = rev('chases').rev
    withContentBump(['chases'], () => {
      usePlaybackStore.getState().addChase('One')
      usePlaybackStore.getState().addChase('Two')
    })
    expect(rev('chases')).toEqual({ rev: before + 1 })
  })
})

describe('remote: what to fetch after a console revision', () => {
  const epoch = 'E'
  const state = (sections: Record<string, { rev: number; by?: string; seq?: number }>) => ({
    epoch,
    sections: Object.fromEntries(CONTENT_SECTIONS.map(s => [s, sections[s] ?? { rev: 0 }]))
  })
  const known = (rev: Record<string, number>, inFlight: Record<string, number[]> = {}, stale = new Map<string, number>()) =>
    ({ epoch, rev, inFlight, stale })

  it('adopts its own edit without fetching (no echo, no round trip)', () => {
    const plan = planContentFetch(state({ cuelists: { rev: 5, by: 'me', seq: 3 } }), known({ cuelists: 4 }, { cuelists: [3] }), 'me')
    expect(plan.fetch).toEqual([])
    expect(plan.adopt).toEqual([{ section: 'cuelists', rev: 5, seq: 3 }])
  })

  it('fetches a revision it did not produce, or when another change slipped in between', () => {
    expect(planContentFetch(state({ cuelists: { rev: 5 } }), known({ cuelists: 4 }), 'me').fetch).toEqual(['cuelists'])
    expect(planContentFetch(state({ cuelists: { rev: 5, by: 'other', seq: 3 } }), known({ cuelists: 4 }, { cuelists: [3] }), 'me').fetch).toEqual(['cuelists'])
    // Console edit (rev 5) + ours (rev 6): rev moved by 2 for 1 send of ours
    expect(planContentFetch(state({ cuelists: { rev: 6, by: 'me', seq: 3 } }), known({ cuelists: 4 }, { cuelists: [3] }), 'me').fetch).toEqual(['cuelists'])
  })

  it('ignores older broadcasts, refetches everything after a console restart', () => {
    expect(planContentFetch(state({ cuelists: { rev: 3 } }), known({ cuelists: 4 }), 'me').fetch).toEqual([])
    const plan = planContentFetch({ epoch: 'other', sections: {} }, known({}), 'me')
    expect(plan.fetch).toEqual([...CONTENT_SECTIONS])
  })

  it('waits for in-flight edits before refetching a stale section', () => {
    const stale = new Map([['cuelists', 5]])
    expect(planContentFetch(state({ cuelists: { rev: 5 } }), known({ cuelists: 4 }, { cuelists: [9] }, stale), 'me').fetch).toEqual([])
    expect(planContentFetch(state({ cuelists: { rev: 6, by: 'me', seq: 9 } }), known({ cuelists: 4 }, { cuelists: [9] }, stale), 'me').fetch).toEqual(['cuelists'])
  })

  it('does not apply fetched sections that would undo an edit still in flight', () => {
    expect(sectionsToApply(['cuelists', 'patch'], 4, { cuelists: [5] })).toEqual({ apply: ['patch'], skip: ['cuelists'] })
    expect(sectionsToApply(['cuelists'], 5, { cuelists: [5] })).toEqual({ apply: ['cuelists'], skip: [] })
  })
})
