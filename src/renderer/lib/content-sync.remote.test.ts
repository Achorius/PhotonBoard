import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// A remote browser: window.photonboard is the WebSocket bridge (isRemote)
const bridge = vi.hoisted(() => {
  const sent: { type: string; payload: any }[] = []
  const getCurrent = { impl: async (_opts: any): Promise<any> => ({ success: false }) }
  const api = {
    sent,
    getCurrent,
    photonboard: {
      remote: {
        isRemote: true,
        sendCommand: (type: string, payload: unknown) => { sent.push({ type, payload }) },
        onConnectionChange: (cb: (s: string) => void) => { cb('open'); return () => {} },
        getConnectionState: () => 'open'
      },
      show: { getCurrent: (opts: unknown) => getCurrent.impl(opts) }
    }
  }
  const g = globalThis as Record<string, unknown>
  g.window = {
    photonboard: api.photonboard,
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
  return api
})

import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { CONTENT_SECTIONS } from '@shared/show-format'
import {
  flushContentNow, getRemoteOrigin, installRemoteContentSync, loadConsoleShow, onConsoleContentState, runAsConsoleContent
} from './content-sync'

const consoleShow = {
  version: '2',
  name: 'Live show',
  patch: [],
  cuelists: [
    { id: 'a', name: 'Opening', cues: [{ id: 'q1', name: 'Q1', number: 1, values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 200 }] }] },
    { id: 'b', name: 'Finale', cues: [] }
  ],
  executor: { grid: [['b', 'a']], columns: [{ title: 'MAIN', color: '#f00' }], modes: [] }
}
const revs = (over: Record<string, { rev: number; by?: string; seq?: number }> = {}) => ({
  epoch: 'console-1',
  sections: Object.fromEntries(CONTENT_SECTIONS.map(s => [s, over[s] ?? { rev: 1 }]))
})
const contentCommands = () => bridge.sent.filter(c => c.type === 'apply-show-content')

let stop: () => void
beforeAll(() => { stop = installRemoteContentSync() })
afterAll(() => stop())

describe('remote content sync', () => {
  it('boots from the console CURRENT show and never echoes it back', async () => {
    const calls: any[] = []
    bridge.getCurrent.impl = async (opts) => { calls.push(opts); return { success: true, show: consoleShow, content: revs(), appliedSeq: 0 } }
    const res = await loadConsoleShow()
    expect(res.status).toBe('ok')
    expect(calls[0].origin).toBe(getRemoteOrigin())
    expect(usePlaybackStore.getState().cuelists.map(c => c.name)).toEqual(['Opening', 'Finale'])
    // The console's (unsaved) executor layout is what we show…
    expect(useExecutorStore.getState().grid[0].slice(0, 2)).toEqual(['b', 'a'])
    expect(useExecutorStore.getState().columns[0].title).toBe('MAIN')
    // …and nothing goes back (the old bug: the boot load sent the file's layout to the console)
    await new Promise(r => setTimeout(r, 200))
    flushContentNow()
    expect(contentCommands()).toHaveLength(0)
    expect(bridge.sent.filter(c => c.type === 'set-executor-layout')).toHaveLength(0)
  })

  it('runtime state mirrored from broadcasts is not an edit', () => {
    usePlaybackStore.setState({ cuelists: usePlaybackStore.getState().cuelists.map(c => ({ ...c, isPlaying: true, currentCueIndex: 0, faderLevel: 12 })) })
    flushContentNow()
    expect(contentCommands()).toHaveLength(0)
  })

  it('sends a local edit as a diff, then adopts its own revision without refetching', async () => {
    const calls: any[] = []
    bridge.getCurrent.impl = async (opts) => { calls.push(opts); return { success: false } }
    usePlaybackStore.getState().renameCuelist('b', 'Encore')
    flushContentNow()
    const [cmd] = contentCommands()
    expect(cmd.payload.origin).toBe(getRemoteOrigin())
    expect(Object.keys(cmd.payload.sections)).toEqual(['cuelists'])
    expect(cmd.payload.sections.cuelists.upsert.map((c: any) => c.name)).toEqual(['Encore'])
    expect(cmd.payload.sections.cuelists.remove).toBeUndefined()

    onConsoleContentState(revs({ cuelists: { rev: 2, by: getRemoteOrigin(), seq: cmd.payload.seq } }))
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toHaveLength(0)
  })

  it('fetches a console change and applies it under the guard', async () => {
    bridge.sent.length = 0
    bridge.getCurrent.impl = async (opts) => ({
      success: true,
      show: { cuelists: [...consoleShow.cuelists.map(c => (c.id === 'b' ? { ...c, name: 'Encore' } : c)), { id: 'c', name: 'Added on console', cues: [] }] },
      content: revs({ cuelists: { rev: 3 } }),
      appliedSeq: 1,
      _opts: opts
    })
    onConsoleContentState(revs({ cuelists: { rev: 3 } }))
    await vi.waitFor(() => expect(usePlaybackStore.getState().cuelists.map(c => c.id)).toEqual(['a', 'b', 'c']))
    // Runtime state of the scenes that stay is kept (it comes from the broadcasts)
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(true)
    await new Promise(r => setTimeout(r, 200))
    flushContentNow()
    expect(contentCommands()).toHaveLength(0)
  })

  it('an optimistic local copy of a console action is not sent', () => {
    runAsConsoleContent(['cuelists'], () => { usePlaybackStore.getState().addCuelist('Recording…', 'rec-1') })
    flushContentNow()
    expect(contentCommands()).toHaveLength(0)
  })

  it('a command never overtakes a pending edit', () => {
    bridge.sent.length = 0
    usePlaybackStore.getState().addCuelist('Fresh', 'fresh-1')
    usePlaybackStore.getState().goCuelist('fresh-1')
    expect(bridge.sent.map(c => c.type)).toEqual(['apply-show-content', 'go-cuelist'])
  })
})
