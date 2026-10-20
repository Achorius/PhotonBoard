import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const data = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v) },
      removeItem: (k: string) => { data.delete(k) }
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
  return data
})
import { usePoolStore, findPreset, nextPresetNumber, findMacro, ensureObjectNumbers } from './pool-store'
import { usePlaybackStore } from './playback-store'
import { usePatchStore } from './patch-store'
import { useEffectsStore } from './effects-store'
import { useExecutorStore } from './executor-store'
import { useProStore, CLI_LOG_LIMIT } from './pro-store'
import { useSelectionStore } from './selection-store'
import { useUiStore } from './ui-store'

beforeEach(() => {
  usePlaybackStore.setState({ cuelists: [], chases: [], presets: [] })
  useEffectsStore.setState({ effects: [] })
  usePatchStore.setState({ patch: [], groups: [] })
  usePoolStore.getState().loadPools({})
  useExecutorStore.getState().loadLayout(undefined)
})

describe('presets (one list: usePlaybackStore.presets)', () => {
  it('numbers per family, renumbers with swap, updates and deletes', () => {
    const pool = usePoolStore.getState()
    const c1 = pool.addPreset({ type: 'color', name: 'Red' })
    const c2 = pool.addPreset({ type: 'color', name: 'Blue' })
    const p1 = pool.addPreset({ type: 'position', name: 'Center', number: 5 })
    const c9 = pool.addPreset({ type: 'color', name: 'Taken', number: 1 }) // 1 is taken → next free
    const presets = usePlaybackStore.getState().presets
    expect(presets.map(p => [p.id, p.number])).toEqual([[c1, 1], [c2, 2], [p1, 5], [c9, 3]])
    expect(findPreset('color', 2)?.id).toBe(c2)
    expect(nextPresetNumber('color')).toBe(4)
    expect(nextPresetNumber('gobo')).toBe(1)

    expect(pool.renumberPreset(c1, 2)).toBe(true) // swap with Blue
    expect(findPreset('color', 2)?.id).toBe(c1)
    expect(findPreset('color', 1)?.id).toBe(c2)
    expect(pool.renumberPreset(c1, 0)).toBe(false)

    pool.updatePreset(c1, { scope: 'universal', universal: { red: 255 }, color: '#f00' })
    expect(usePlaybackStore.getState().presets.find(p => p.id === c1)).toMatchObject({ scope: 'universal', universal: { red: 255 }, color: '#f00', number: 2 })
    // Family change keeps the number only when free there
    pool.updatePreset(c2, { type: 'position' })
    expect(usePlaybackStore.getState().presets.find(p => p.id === c2)).toMatchObject({ type: 'position', number: 1 })
    pool.updatePreset(c9, { type: 'position' }) // 3 is free in position
    expect(usePlaybackStore.getState().presets.find(p => p.id === c9)?.number).toBe(3)

    pool.removePreset(p1)
    expect(usePlaybackStore.getState().presets.map(p => p.id)).not.toContain(p1)
  })

  it('legacy addPreset (playback store) numbers in the family too', () => {
    usePlaybackStore.getState().addPreset('A', 'gobo', {})
    const id = usePlaybackStore.getState().addPreset('B', 'gobo', {})
    expect(usePlaybackStore.getState().presets.find(p => p.id === id)?.number).toBe(2)
  })
})

describe('macros, speed masters, stage pages', () => {
  it('macro CRUD and numbers', () => {
    const pool = usePoolStore.getState()
    const a = pool.addMacro({ name: 'A', lines: [{ command: 'Clear' }] })
    const b = pool.addMacro({ name: 'B', number: 7 })
    expect(usePoolStore.getState().macros.map(m => m.number)).toEqual([1, 7])
    expect(findMacro(7)?.id).toBe(b)
    usePoolStore.getState().updateMacro(a, { name: 'AA', lines: [{ command: 'Go', wait: 1 }] })
    expect(usePoolStore.getState().macros[0]).toMatchObject({ name: 'AA', number: 1, lines: [{ command: 'Go', wait: 1 }] })
    expect(usePoolStore.getState().renumberMacro(a, 7)).toBe(true)
    expect(usePoolStore.getState().macros.map(m => m.number)).toEqual([7, 1])
    usePoolStore.getState().removeMacro(b)
    expect(usePoolStore.getState().macros.map(m => m.id)).toEqual([a])
  })

  it('removing a speed master detaches scenes, chases, effects, executor cells and faders', () => {
    const s = usePoolStore.getState().addSpeedMaster({ name: 'S', bpm: 2000 })
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(999)
    usePlaybackStore.setState({
      cuelists: [{ id: 'a', name: 'A', cues: [], currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, speedMasterId: s }],
      chases: [{ id: 'c', name: 'C', steps: [], currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 120, fadePercent: 0, direction: 'forward', faderLevel: 255, speedMasterId: s }]
    })
    useEffectsStore.setState({ effects: [{ id: 'e', name: 'E', waveform: 'sine', speed: 1, depth: 255, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0, isRunning: false, speedMasterId: s }] })
    useExecutorStore.getState().assignCell(0, 1, 1, { kind: 'speed', id: s, mode: 'toggle' })
    useExecutorStore.getState().setColumnFader(0, 2, { kind: 'speed', id: s })
    usePoolStore.getState().setSpeedMasterBpm(s, 90)
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(90)
    usePoolStore.getState().removeSpeedMaster(s)
    expect(usePoolStore.getState().speedMasters).toEqual([])
    expect(usePlaybackStore.getState().cuelists[0].speedMasterId).toBeUndefined()
    expect(usePlaybackStore.getState().chases[0].speedMasterId).toBeUndefined()
    expect(useEffectsStore.getState().effects[0].speedMasterId).toBeUndefined()
    expect(useExecutorStore.getState().pages[0].cells[1][1]).toBeNull()
    expect(useExecutorStore.getState().pages[0].columns[2].fader).toBeUndefined()
  })

  it('stage pages and widgets', () => {
    const pool = usePoolStore.getState()
    const p = pool.addStagePage({ name: 'Live', cols: 4, rows: 2 })
    const w = usePoolStore.getState().addStageWidget(p, { x: 0, y: 0, w: 2, h: 1, kind: 'go', label: 'GO' })!
    expect(usePoolStore.getState().addStageWidget('nope', { x: 0, y: 0, w: 1, h: 1, kind: 'clock' })).toBeNull()
    usePoolStore.getState().updateStageWidget(p, w, { label: 'Next' })
    usePoolStore.getState().updateStagePage(p, { name: 'Show' })
    expect(usePoolStore.getState().stagePages[0]).toMatchObject({ name: 'Show', cols: 4, rows: 2, widgets: [{ id: w, label: 'Next', kind: 'go' }] })
    usePoolStore.getState().removeStageWidget(p, w)
    expect(usePoolStore.getState().stagePages[0].widgets).toEqual([])
    usePoolStore.getState().removeStagePage(p)
    expect(usePoolStore.getState().stagePages).toEqual([])
  })
})

describe('park and group masters', () => {
  it('parks (one value per channel), unparks by fixture or all', () => {
    const pool = usePoolStore.getState()
    pool.park([{ fixtureId: 'a', channelName: 'Dimmer', value: 10 }, { fixtureId: 'b', channelName: 'Pan', value: 300 }])
    usePoolStore.getState().park([{ fixtureId: 'a', channelName: 'Dimmer', value: 20 }])
    expect(usePoolStore.getState().parked).toEqual([
      { fixtureId: 'a', channelName: 'Dimmer', value: 20 }, { fixtureId: 'b', channelName: 'Pan', value: 255 }
    ])
    const before = usePoolStore.getState().parked
    usePoolStore.getState().park([{ fixtureId: 'a', channelName: 'Dimmer', value: 20 }])
    expect(usePoolStore.getState().parked).toBe(before)
    usePoolStore.getState().unpark(['a'])
    expect(usePoolStore.getState().parked.map(v => v.fixtureId)).toEqual(['b'])
    usePoolStore.getState().unpark()
    expect(usePoolStore.getState().parked).toEqual([])
  })

  it('group masters are clamped', () => {
    usePoolStore.getState().setGroupMaster('g', 300)
    usePoolStore.getState().setGroupMaster('h', -4)
    expect(usePoolStore.getState().groupMasters).toEqual({ g: 255, h: 0 })
  })
})

describe('object numbers of runtime-created objects', () => {
  it('new scenes / chases are numbered; ensureObjectNumbers fills the rest, keeping identities', () => {
    const pb = usePlaybackStore.getState()
    pb.addCuelist('A')
    const b = pb.addCuelist('B')
    usePlaybackStore.getState().duplicateCuelist(b)
    pb.addChase('C')
    expect(usePlaybackStore.getState().cuelists.map(c => c.number)).toEqual([1, 2, 3])
    expect(usePlaybackStore.getState().chases[0].number).toBe(1)

    usePatchStore.setState({
      patch: [
        { id: 'f1', fixtureDefId: 'd', modeName: 'm', universe: 0, address: 1, name: 'F1', groupIds: [], fid: 10 },
        { id: 'f2', fixtureDefId: 'd', modeName: 'm', universe: 0, address: 2, name: 'F2', groupIds: [] }
      ],
      groups: [{ id: 'g', name: 'G', color: '#fff', fixtureIds: [] }]
    })
    const f1 = usePatchStore.getState().patch[0]
    const cuelists = usePlaybackStore.getState().cuelists
    ensureObjectNumbers()
    expect(usePatchStore.getState().patch.map(p => p.fid)).toEqual([10, 11])
    expect(usePatchStore.getState().patch[0]).toBe(f1)
    expect(usePatchStore.getState().groups[0].number).toBe(1)
    expect(usePlaybackStore.getState().cuelists).toBe(cuelists) // nothing missing there
  })
})

describe('pro runtime stores', () => {
  it('pro-store: blind / highlight / prog time / log / selected executor', () => {
    const pro = useProStore.getState()
    pro.setBlind()
    pro.setHighlight(true)
    pro.setProgTime({ fade: 2, delay: -1 })
    expect(useProStore.getState()).toMatchObject({ blind: true, highlight: true, progTime: { fade: 2, delay: 0 } })
    pro.setProgTime({ fade: 0, delay: 0 })
    expect(useProStore.getState().progTime).toBeNull()
    for (let i = 0; i < CLI_LOG_LIMIT + 5; i++) pro.appendCliLog({ text: `L${i}`, ok: true, message: '', level: 'info' })
    const log = useProStore.getState().cliLog
    expect(log).toHaveLength(CLI_LOG_LIMIT)
    expect(log[log.length - 1].text).toBe(`L${CLI_LOG_LIMIT + 4}`)
    pro.selectExecutor({ page: 0, col: 1, row: 2 })
    const ref = useProStore.getState().selectedExecutor
    pro.selectExecutor({ page: 0, col: 1, row: 2 })
    expect(useProStore.getState().selectedExecutor).toBe(ref)
    pro.clearCliLog()
    expect(useProStore.getState().cliLog).toEqual([])
  })

  it('selection-store: step walks and wraps', () => {
    const sel = useSelectionStore.getState()
    sel.stepBy(1, 3)
    expect(useSelectionStore.getState().step).toBe(0)
    useSelectionStore.getState().stepBy(-1, 3)
    expect(useSelectionStore.getState().step).toBe(2)
    useSelectionStore.getState().stepBy(1, 3)
    expect(useSelectionStore.getState().step).toBe(0)
    useSelectionStore.getState().setMatricks({ invert: true })
    useSelectionStore.getState().setAlign('<>')
    useSelectionStore.getState().reset()
    expect(useSelectionStore.getState()).toMatchObject({ matricks: {}, step: null, align: null })
  })

  it('ui-store: Pro mode defaults off and is remembered on this machine', () => {
    expect(useUiStore.getState().proMode).toBe(false)
    useUiStore.getState().setProMode(true)
    expect(useUiStore.getState().proMode).toBe(true)
    expect(storage.get('photonboard.ui.pro')).toBe('true')
    useUiStore.getState().setProMode()
    expect(useUiStore.getState().proMode).toBe(false)
    expect(storage.get('photonboard.ui.pro')).toBe('false')
  })
})
