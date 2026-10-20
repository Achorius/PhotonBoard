import { describe, it, expect } from 'vitest'
import {
  normalizeShow,
  normalizeEffect,
  createEmptyShow,
  normalizeExecutorLayout,
  parseShowVersion,
  SHOW_FORMAT_VERSION,
  DEFAULT_TIMELINE_LENGTH,
  DEFAULT_CUE_FADE_IN,
  DEFAULT_CUE_FADE_OUT,
  EXECUTOR_COLUMN_COUNT,
  EXECUTOR_ROW_COUNT
} from './show-format'

/** A show as saved by PhotonBoard ≤ 0.1 (format "1.0.0"), runtime state included */
const V1_SHOW = {
  version: '1.0.0',
  name: 'Club Night',
  createdAt: '2025-01-01T00:00:00.000Z',
  modifiedAt: '2025-02-01T00:00:00.000Z',
  artnetConfig: [{ host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 }],
  patch: [
    { id: 'f1', fixtureDefId: 'generic/dimmer', modeName: 'Default', universe: 0, address: 1, name: 'Dim 1', groupIds: ['g1'] },
    { id: 'f2', fixtureDefId: 'generic/rgb', modeName: '3ch', universe: 0, address: 10, name: 'Par', groupIds: [] }
  ],
  groups: [{ id: 'g1', name: 'Front', color: '#f00', fixtureIds: ['f1', 'ghost'] }],
  presets: [],
  cuelists: [{
    id: 'cl1',
    name: 'Intro',
    cues: [
      { id: 'c1', name: 'Look 1', number: 1, values: [{ fixtureId: 'f1', channelName: 'Intensity', value: 255 }], fadeIn: 1, fadeOut: 3, delay: 0, followTime: null },
      { id: 'c2', name: 'Look 2', number: 2, values: [{ fixtureId: 'f1', channelName: 'Intensity', value: 300 }] }
    ],
    currentCueIndex: 1,
    isPlaying: true,
    isLooping: true,
    priority: 60,
    faderLevel: 200,
    flash: true,
    goGeneration: 12
  }],
  chases: [{
    id: 'ch1', name: 'Run', steps: [{ id: 's1', values: [] }], currentStepIndex: 3, isPlaying: true,
    isLooping: true, bpm: 128, fadePercent: 20, direction: 'bounce', faderLevel: 255
  }],
  effects: [],
  midiMappings: [],
  stageLayout: { width: 1200, height: 600, fixtures: [] },
  timeline: {
    clips: [
      { id: 'k1', cuelistId: 'cl1', trackIndex: 4, startTime: 0, duration: 10 },
      { id: 'k2', cuelistId: 'deleted-scene', trackIndex: 0, startTime: 5, duration: 5 }
    ],
    markers: [{ id: 'm1', time: 12, name: 'Drop' }],
    zones: [],
    trackCount: 2
  }
}

describe('normalizeShow', () => {
  it('migrates a v1 show to the current version', () => {
    const { show, warnings } = normalizeShow(V1_SHOW)
    expect(show.version).toBe(String(SHOW_FORMAT_VERSION))
    expect(show.name).toBe('Club Night')
    expect(show.createdAt).toBe(V1_SHOW.createdAt)
    expect('artnetConfig' in show).toBe(false)
    expect(warnings.some(w => /output/i.test(w))).toBe(true)
  })

  it('keeps v1 static fixture aim (tilt sign) for ceiling and back-wall mounts', () => {
    const fixture = (id: string, mountingLocation: string | undefined, mountingAngle: number) =>
      ({ id, fixtureDefId: 'd', modeName: 'm', universe: 0, address: 1, name: id, groupIds: [], mountingLocation, mountingAngle })
    const raw = { version: '1.0.0', patch: [fixture('a', undefined, 20), fixture('b', 'wall-back', -15), fixture('c', 'floor', 10)] }
    expect(normalizeShow(raw).show.patch.map(p => p.mountingAngle)).toEqual([-20, 15, 10])
    expect(normalizeShow({ ...raw, version: '2' }).show.patch.map(p => p.mountingAngle)).toEqual([20, -15, 10])
  })

  it('strips runtime state so nothing starts on load', () => {
    const { show } = normalizeShow(V1_SHOW)
    const cl = show.cuelists[0]
    expect(cl.isPlaying).toBe(false)
    expect(cl.currentCueIndex).toBe(-1)
    expect(cl.flash).toBe(false)
    expect(cl.goGeneration).toBeUndefined()
    expect(cl.faderLevel).toBe(200) // settings are kept
    expect(cl.priority).toBe(60)
    expect(cl.isLooping).toBe(true)
    expect(show.chases[0].isPlaying).toBe(false)
    expect(show.chases[0].currentStepIndex).toBe(0)
  })

  it('fills defaults in partial cues and clamps values', () => {
    const { show } = normalizeShow(V1_SHOW)
    const cue = show.cuelists[0].cues[1]
    expect(cue.fadeIn).toBe(DEFAULT_CUE_FADE_IN)
    expect(cue.fadeOut).toBe(DEFAULT_CUE_FADE_OUT)
    expect(cue.delay).toBe(0)
    expect(cue.followTime).toBeNull()
    expect(cue.values[0].value).toBe(255)
  })

  it('cleans references and fills the new v2 sections', () => {
    const { show, warnings } = normalizeShow(V1_SHOW)
    expect(show.groups[0].fixtureIds).toEqual(['f1'])
    expect(show.timeline!.clips.map(c => c.id)).toEqual(['k1'])
    expect(show.timeline!.trackCount).toBe(5) // grows to fit clip on track 4
    expect(show.timeline!.trackNames).toEqual([])
    expect(show.executor!.grid).toHaveLength(EXECUTOR_COLUMN_COUNT)
    expect(show.executor!.grid[0]).toHaveLength(EXECUTOR_ROW_COUNT)
    expect(show.roomConfig!.trussBars.length).toBeGreaterThan(0)
    expect(warnings.some(w => /missing scene/.test(w))).toBe(true)
  })

  it('fills every missing array / section of a minimal show', () => {
    const { show } = normalizeShow({ version: '1.0.0', patch: [] })
    expect(show.name).toBe('Untitled Show')
    for (const key of ['groups', 'presets', 'cuelists', 'chases', 'effects', 'midiMappings'] as const) {
      expect(show[key]).toEqual([])
    }
    expect(show.stageLayout).toEqual({ width: 1200, height: 600, fixtures: [] })
    expect(show.timeline).toMatchObject({ clips: [], markers: [], zones: [], trackCount: 3, trackNames: [], length: DEFAULT_TIMELINE_LENGTH, loop: false })
  })

  it('accepts JSON text', () => {
    expect(normalizeShow(JSON.stringify(V1_SHOW)).show.patch).toHaveLength(2)
  })

  it('repairs malformed entries instead of crashing', () => {
    const { show, warnings } = normalizeShow({
      version: '2',
      patch: [
        { fixtureDefId: 'x', modeName: 'm', universe: 99, address: 0, name: 'No id' },
        'garbage',
        { id: 'dup', fixtureDefId: 'x', modeName: 'm', universe: 0, address: 1 },
        { id: 'dup', fixtureDefId: 'x', modeName: 'm', universe: 0, address: 2 }
      ],
      cuelists: [{ id: 'c', cues: [{ values: 'nope', fadeIn: -3, fadeOut: 'abc', delay: Infinity }] }],
      effects: [{ id: 'e', isRunning: true, speed: NaN, waveform: 'bogus' }],
      midiMappings: [{ id: 'm', source: { type: 'cc', channel: 99, number: 300 }, target: { type: 'master' } }, { id: 'n', target: { type: 'nope' } }]
    })
    expect(show.patch).toHaveLength(2)
    expect(show.patch[0].id).toBeTruthy()
    expect(show.patch[0].universe).toBe(15)
    expect(show.patch[0].address).toBe(1)
    const cue = show.cuelists[0].cues[0]
    expect(cue.values).toEqual([])
    expect(cue.fadeIn).toBe(0)
    expect(cue.fadeOut).toBe(DEFAULT_CUE_FADE_OUT)
    expect(cue.delay).toBe(0)
    expect(show.effects[0]).toMatchObject({ isRunning: false, speed: 1, waveform: 'sine' })
    expect(show.midiMappings).toHaveLength(1)
    expect(show.midiMappings[0].source).toMatchObject({ channel: 16, number: 127 })
    expect(show.midiMappings[0].options).toMatchObject({ encoding: 'absolute', behavior: 'direct' })
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('keeps the MIDI feedback option of user mappings (and drops bad values)', () => {
    const { show } = normalizeShow({
      version: '3',
      patch: [],
      midiMappings: [
        { id: 'a', source: { type: 'note', channel: 1, number: 36 }, target: { type: 'blackout' }, options: { behavior: 'toggle', feedback: 'note' } },
        { id: 'b', source: { type: 'cc', channel: 1, number: 7 }, target: { type: 'master' }, options: { feedback: 'cc' } },
        { id: 'c', source: { type: 'cc', channel: 1, number: 8 }, target: { type: 'master' }, options: { feedback: 'sysex' } }
      ]
    })
    expect(show.midiMappings.map((m) => m.options.feedback)).toEqual(['note', 'cc', undefined])
    expect('feedback' in show.midiMappings[2].options).toBe(false)
    // round trip
    const again = normalizeShow(JSON.parse(JSON.stringify(show))).show
    expect(again.midiMappings[0].options.feedback).toBe('note')
  })

  it('rejects things that are not shows with a clear error', () => {
    expect(() => normalizeShow(null)).toThrow(/Not a PhotonBoard show/)
    expect(() => normalizeShow(42)).toThrow(/Not a PhotonBoard show/)
    expect(() => normalizeShow([1, 2])).toThrow(/Not a PhotonBoard show/)
    expect(() => normalizeShow('{not json')).toThrow(/not valid JSON/)
    expect(() => normalizeShow({ hello: 'world' })).toThrow(/Not a PhotonBoard show/)
    expect(() => normalizeShow({ version: '1', patch: 'x' })).toThrow(/patch/)
  })

  it('warns about shows from a newer version', () => {
    expect(normalizeShow({ version: '99', patch: [] }).warnings.some(w => /newer/.test(w))).toBe(true)
  })

  it('is idempotent', () => {
    const once = normalizeShow(V1_SHOW).show
    const twice = normalizeShow(JSON.parse(JSON.stringify(once))).show
    expect(twice).toEqual(once)
  })
})

describe('effect fades', () => {
  const base = { name: 'Pulse', waveform: 'sine', speed: 1, depth: 255, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0 }

  it('keeps start / stop fade times (seconds)', () => {
    const fx = normalizeEffect({ ...base, fadeIn: 1.5, fadeOut: 3 }, 'e1')!
    expect(fx.fadeIn).toBe(1.5)
    expect(fx.fadeOut).toBe(3)
  })

  it('leaves them out of older shows and clamps bad values', () => {
    const old = normalizeEffect(base, 'e1')!
    expect('fadeIn' in old).toBe(false)
    expect('fadeOut' in old).toBe(false)
    const bad = normalizeEffect({ ...base, fadeIn: -2, fadeOut: 'x' }, 'e1')!
    expect(bad.fadeIn).toBe(0)
    expect('fadeOut' in bad).toBe(false)
  })

  it('keeps an explicit zero (overrides an older per-console value)', () => {
    expect(normalizeEffect({ ...base, fadeIn: 0 }, 'e1')!.fadeIn).toBe(0)
  })

  it('survives a show round-trip', () => {
    const { show } = normalizeShow({ ...V1_SHOW, effects: [{ ...base, id: 'fx1', fadeIn: 2, fadeOut: 0.5 }] })
    expect(show.effects[0]).toMatchObject({ id: 'fx1', fadeIn: 2, fadeOut: 0.5, isRunning: false })
    expect(normalizeShow(JSON.parse(JSON.stringify(show))).show.effects).toEqual(show.effects)
  })
})

describe('timeline settings', () => {
  it('defaults length, loop and timecode for older shows', () => {
    const tl = normalizeShow(V1_SHOW).show.timeline!
    expect(tl.length).toBe(DEFAULT_TIMELINE_LENGTH)
    expect(tl.loop).toBe(false)
    expect(tl.timecode).toEqual({ source: 'internal', fps: 25, chase: false, dropoutMs: 1000, offset: 0 })
  })

  it('keeps saved settings', () => {
    const timecode = { source: 'mtc', fps: 29.97, chase: true, dropoutMs: 2500, offset: -3.5 }
    const tl = normalizeShow({ ...V1_SHOW, timeline: { ...V1_SHOW.timeline, length: 300, loop: true, timecode } }).show.timeline!
    expect(tl.length).toBe(300)
    expect(tl.loop).toBe(true)
    expect(tl.timecode).toEqual(timecode)
  })

  it('clamps invalid settings', () => {
    const timecode = { source: 'ltc', fps: 50, chase: 'yes', dropoutMs: 5, offset: 'later' }
    const tl = normalizeShow({ ...V1_SHOW, timeline: { ...V1_SHOW.timeline, length: 2, loop: 1, timecode } }).show.timeline!
    expect(tl.length).toBe(10)
    expect(tl.loop).toBe(false)
    expect(tl.timecode).toEqual({ source: 'internal', fps: 25, chase: false, dropoutMs: 100, offset: 0 })
  })
})

describe('helpers', () => {
  it('parses versions', () => {
    expect(parseShowVersion('1.0.0')).toBe(1)
    expect(parseShowVersion('2')).toBe(2)
    expect(parseShowVersion(3)).toBe(3)
    expect(parseShowVersion(undefined)).toBe(1)
  })

  it('normalises executor layouts to 8×4 and drops unknown / duplicate scenes', () => {
    const layout = normalizeExecutorLayout({ grid: [['a', 'x', 'a'], [null, 'b']], modes: [['flash', 'weird']] }, new Set(['a', 'b']))
    expect(layout.grid[0]).toEqual(['a', null, null, null])
    expect(layout.grid[1]).toEqual([null, 'b', null, null])
    expect(layout.modes[0]).toEqual(['flash', 'toggle', 'toggle', 'toggle'])
    expect(layout.columns).toHaveLength(EXECUTOR_COLUMN_COUNT)
  })

  it('creates an empty show', () => {
    const show = createEmptyShow('Blank')
    expect(show.name).toBe('Blank')
    expect(show.patch).toEqual([])
  })
})
