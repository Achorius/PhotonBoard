import { beforeEach, describe, expect, it, vi } from 'vitest'

// The UI store reads the window at import time (no DOM under node)
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { normalizeShow } from '@shared/show-format'
import type { ShowFile } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { applyShowData, collectShowData } from './show-io'
import { collectStateSnapshot } from './state-snapshot'
import { MOVING_HEAD, patchEntry } from './testing/test-fixtures'

const DEMO_V2 = JSON.parse(readFileSync(resolve(__dirname, '../../../scripts/dev/demo-show.pbshow'), 'utf8'))

/** Saved file without its timestamp */
function saved(): Omit<ShowFile, 'modifiedAt'> {
  const { modifiedAt: _m, ...rest } = JSON.parse(JSON.stringify(collectShowData())) as ShowFile
  return rest
}

describe('show I/O v3', () => {
  beforeEach(() => {
    usePatchStore.setState({ fixtures: [], selectedFixtureIds: [] })
  })

  it('golden: the demo v2 show loads, saves as v3 and reloads identically', () => {
    applyShowData(DEMO_V2)
    const first = saved()
    expect(first.version).toBe('3')
    // v2 view of the file is the one we loaded
    const v2 = normalizeShow(DEMO_V2).show
    expect(first.executor!.grid).toEqual(DEMO_V2.executor.grid)
    expect(first.executor!.modes).toEqual(DEMO_V2.executor.modes)
    expect(first.executor!.columns).toEqual(DEMO_V2.executor.columns)
    expect(first.cuelists.map(c => c.cues)).toEqual(v2.cuelists.map(c => c.cues))
    expect(first.patch.map(p => p.fid)).toEqual(first.patch.map((_, i) => i + 1))
    // Reload what we saved: same file
    applyShowData(JSON.parse(JSON.stringify(collectShowData())))
    expect(saved()).toEqual(first)
  })

  it('saves pools, parked channels, group masters and executor pages', () => {
    applyShowData({ version: '2', name: 'T', patch: [], cuelists: [{ id: 'a', name: 'A', cues: [] }] })
    const pool = usePoolStore.getState()
    const macro = pool.addMacro({ name: 'Intro', lines: [{ command: 'Go Sequence 1', wait: 1 }] })
    const speed = pool.addSpeedMaster({ name: 'Main', bpm: 128 })
    usePoolStore.getState().addStagePage({ name: 'Live' })
    usePoolStore.getState().park([{ fixtureId: 'f', channelName: 'Dimmer', value: 0 }])
    usePoolStore.getState().setGroupMaster('g', 100)
    const ex = useExecutorStore.getState()
    const page = ex.addPage('Busk')
    useExecutorStore.getState().assignCell(page, 0, 0, { kind: 'macro', id: macro, mode: 'toggle' })
    const show = collectShowData()
    expect(show.macros).toEqual([{ id: macro, number: 1, name: 'Intro', lines: [{ command: 'Go Sequence 1', wait: 1 }] }])
    expect(show.speedMasters).toEqual([{ id: speed, number: 1, name: 'Main', bpm: 128 }])
    expect(show.stagePages![0]).toMatchObject({ name: 'Live', cols: 8, rows: 6, widgets: [] })
    expect(show.parked).toEqual([{ fixtureId: 'f', channelName: 'Dimmer', value: 0 }])
    expect(show.groupMasters).toEqual({ g: 100 })
    expect(show.executor!.pages).toHaveLength(2)
    expect(show.executor!.pages![1].cells[0][0]).toEqual({ kind: 'macro', id: macro, mode: 'toggle' })
    expect(show.executor!.grid[0][0]).toBe('a') // mirror of page 1

    // Load it back (group 'g' and fixture 'f' do not exist: cleaned)
    applyShowData(JSON.parse(JSON.stringify(show)))
    const after = usePoolStore.getState()
    expect(after.macros.map(m => m.name)).toEqual(['Intro'])
    expect(after.speedMasters[0].bpm).toBe(128)
    expect(after.parked).toEqual([])
    expect(after.groupMasters).toEqual({})
    expect(useExecutorStore.getState().pages[1].cells[0][0]?.id).toBe(macro)
  })

  it('re-resolves preset-referenced cue values when saving (v2 readers play `value`)', () => {
    usePatchStore.setState({ fixtures: [MOVING_HEAD] })
    applyShowData({
      version: '3',
      patch: [patchEntry('mh1', MOVING_HEAD, 0, 1)],
      presets: [{ id: 'red', name: 'Red', type: 'color', values: { mh1: { Red: 255, Green: 0 } } }],
      cuelists: [{
        id: 'a', name: 'A', cues: [{
          id: 'q', name: 'Q', number: 1,
          values: [{ fixtureId: 'mh1', channelName: 'Red', value: 255, presetId: 'red' }, { fixtureId: 'mh1', channelName: 'Dimmer', value: 200 }]
        }]
      }]
    })
    // Edit the preset: the cue follows on save
    usePoolStore.getState().updatePreset('red', { values: { mh1: { Red: 120, Green: 10 } } })
    const show = collectShowData()
    expect(show.cuelists[0].cues[0].values).toEqual([
      { fixtureId: 'mh1', channelName: 'Red', value: 120, presetId: 'red' },
      { fixtureId: 'mh1', channelName: 'Dimmer', value: 200 }
    ])
    // The running show is not modified by saving
    expect(usePlaybackStore.getState().cuelists[0].cues[0].values[0].value).toBe(255)
    // Deleting the preset keeps the value as a plain value
    usePoolStore.getState().removePreset('red')
    expect(usePlaybackStore.getState().cuelists[0].cues[0].values[0]).toEqual({ fixtureId: 'mh1', channelName: 'Red', value: 255 })
  })

  it('publishes executor pages, Pro flags and speed masters in the snapshot', () => {
    applyShowData({ version: '2', patch: [], cuelists: [{ id: 'a', name: 'A', cues: [] }] })
    useExecutorStore.getState().addPage('Two')
    usePoolStore.getState().addSpeedMaster({ name: 'S', bpm: 90 })
    useExecutorStore.getState().setPage(1)
    const snap = collectStateSnapshot()
    expect(snap.executorPage).toBe(1)
    expect(snap.pages.map(p => p.name)).toEqual(['', 'Two'])
    expect(snap.blind).toBe(false)
    expect(snap.highlight).toBe(false)
    expect(snap.speedMasters).toEqual([expect.objectContaining({ name: 'S', bpm: 90, number: 1 })])
    expect(snap.cliLog).toEqual([])
    expect(snap.executorGrid.flat().every(c => c === null)).toBe(true) // page 2 is empty
  })
})
