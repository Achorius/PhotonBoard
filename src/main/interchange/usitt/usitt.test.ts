import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { FixtureDefinition, ShowFile } from '../../../shared/types'
import { createEmptyShow } from '../../../shared/show-format'
import { detectImporter, getExporter } from '../registry'
import { usittExporter, usittImporter } from './index'
import { parseLevel, parseTime, readUsitt } from './read'

const FIX = join(__dirname, '../../../../test-fixtures/interchange/usitt')
const read = (p: string) => new Uint8Array(readFileSync(join(FIX, p)))
const noCtx = {
  async findFixture() { return null },
  async parseGdtf() { return null },
  async parseQxf() { return null }
}

describe('USITT ASCII tokens', () => {
  it('parses levels and times', () => {
    expect(parseLevel('FL')).toBe(255)
    expect(parseLevel('Hff')).toBe(255)
    expect(parseLevel('H80')).toBe(128)
    expect(parseLevel('50')).toBe(128)
    expect(parseLevel('100')).toBe(255)
    expect(parseLevel('x')).toBeNull()
    expect(parseTime('2.5')).toBe(2.5)
    expect(parseTime('1:30')).toBe(90)
    expect(parseTime('abc')).toBeUndefined()
  })
})

describe('USITT ASCII import', () => {
  it('detects USITT files', () => {
    expect(usittImporter.detect('show.asc', read('etc-expression-style.asc'))).toBe(1)
    expect(usittImporter.detect('show.txt', read('standard-sequences.asc'))).toBe(1)
    expect(usittImporter.detect('notes.txt', new TextEncoder().encode('Hello world\nnothing here'))).toBe(0)
    expect(usittImporter.detect('a.asc', new Uint8Array([0, 1, 2, 3, 0, 0, 0, 0, 1, 2]))).toBe(0)
    expect(detectImporter('show.asc', read('etc-expression-style.asc'))?.importer.info.id).toBe('usitt-ascii')
  })

  it('imports an ETC Expression style file (patch, cues, groups, subs, moving lights)', async () => {
    const frag = await usittImporter.parse(read('etc-expression-style.asc'), 'expression.asc', noCtx)
    expect(frag.format).toBe('usitt-ascii')
    expect(frag.sourceApp).toBe('ETC Expression (Vsn 3.11)')
    // Conventional channels: patch "ch<dimmer"
    const ch = (n: number) => frag.patch.find(p => p.id === `usitt-ch-${n}`)!
    expect(ch(1)).toMatchObject({ fixtureDefId: 'usitt/dimmer', universe: 0, address: 1, fid: 1, name: 'Channel 1' })
    expect(ch(6)).toMatchObject({ universe: 1, address: 1 }) // dimmer 513
    expect(ch(7)).toMatchObject({ universe: 1, address: 2 })
    // Channel 99 is used but not patched → parked on the next universe, placeholder
    expect(ch(99)).toMatchObject({ universe: 2, address: 1 })
    expect(frag.placeholderFixtureIds).toEqual(['usitt-ch-99'])
    // Moving light from $MlPers / $MlPatch
    const ml = frag.patch.find(p => p.id === 'usitt-ml-1')!
    expect(ml).toMatchObject({ universe: 0, address: 201, fid: 101, name: 'TinySpot 1' })
    const tiny = frag.fixtures.find(f => f.id === ml.fixtureDefId)!
    expect(tiny.modes[0].channels).toEqual(['Pan', 'Pan fine', 'Tilt', 'Tilt fine', 'Color Wheel', 'Dimmer'])
    expect(tiny.channels.Pan.defaultValue).toBe(128)
    expect(tiny.channels['Pan fine'].fineOf).toBe('Pan')
    // Desk channel 101 is the ML, not a dimmer
    expect(frag.patch.find(p => p.id === 'usitt-ch-101')).toBeUndefined()

    const cl = frag.cuelists[0]
    expect(cl.tracking).toBe(false)
    expect(cl.cues.map(c => [c.number, c.name, c.fadeIn, c.fadeOut, c.delay])).toEqual([
      [1, 'Preset', 3, 5, 0], [2, 'House to half', 3, 3, 1], [2.5, 'Followed', 90, 0, 0]
    ])
    const c1 = cl.cues[0]
    const v = (fixtureId: string, channel: string) => c1.values.find(x => x.fixtureId === fixtureId && x.channelName === channel)?.value
    expect(v('usitt-ch-1', 'Dimmer')).toBe(255)
    expect(v('usitt-ch-2', 'Dimmer')).toBe(128)
    expect(v('usitt-ch-3', 'Dimmer')).toBe(0x33)
    expect(v('usitt-ml-1', 'Pan')).toBe(255)
    expect(v('usitt-ml-1', 'Tilt')).toBe(128)
    expect(v('usitt-ml-1', 'Dimmer')).toBe(255)
    expect(cl.cues[1].block).toBe(true)

    // Group 1 at full → group only; group 2 at 50 % → group + preset
    expect(frag.groups.map(g => [g.name, g.fixtureIds.length])).toEqual([['Front', 3], ['Group 2', 2]])
    expect(frag.presets).toHaveLength(1)
    expect(frag.presets[0].values['usitt-ch-4'].Dimmer).toBe(128)
    // Sub → one-cue cuelist
    const sub = frag.cuelists.find(c => c.name === 'Sub 1')!
    expect(sub.cues[0].values).toHaveLength(2)

    const codes = frag.warnings.map(w => w.code)
    for (const c of ['usitt.multiDimmer', 'usitt.proportionalPatch', 'usitt.unpatchedChannels', 'usitt.subs', 'usitt.ignoredKeywords', 'usitt.mlAssumed']) {
      expect(codes).toContain(c)
    }
  })

  it('imports standard keywords, extensions, parts and default 1:1 patch', async () => {
    const frag = await usittImporter.parse(read('standard-sequences.asc'), 'seq.asc', noCtx)
    expect(frag.patch.find(p => p.fid === 4)).toMatchObject({ universe: 0, address: 4 })
    expect(frag.placeholderFixtureIds?.length).toBe(frag.patch.length)
    expect(frag.warnings.map(w => w.code)).toContain('usitt.defaultPatch')
    expect(frag.cuelists.map(c => [c.number, c.name, c.cues.length])).toEqual([[1, 'Cue list 1', 3], [2, 'Chaser', 2]])
    const [c1, c2, c3] = frag.cuelists[0].cues
    expect(c1.name).toBe('Préparation') // $$TEXT wins over TEXT
    expect(c1.values.map(v => v.value)).toEqual([255, 128, 0x7f])
    expect(c2).toMatchObject({ fadeIn: 2.5, delay: 1, fadeOut: 4, followTime: 3, followMode: 'after-go' })
    expect(c2.parts).toEqual([{ index: 1, fade: 8 }])
    expect(c2.values.find(v => v.fixtureId === 'usitt-ch-5')).toMatchObject({ value: 255, part: 1 })
    expect(c2.values.find(v => v.fixtureId === 'usitt-ch-1')?.value).toBe(0)
    expect(c3.name).toBe('Back to one')
    expect(frag.warnings.map(w => w.code)).toContain('usitt.link')
    expect(frag.groups[0]).toMatchObject({ name: 'Specials', number: 7 })
  })

  it('rejects files that are not USITT and survives garbage lines', async () => {
    await expect(usittImporter.parse(new TextEncoder().encode('just text'), 'x.txt', noCtx)).rejects.toThrow()
    const doc = readUsitt('CUE 1\nCHAN 1/50 2/zz abc\nWHATEVER 1 2\nCUE x\nCHAN 3/10\n')
    expect(doc.cues).toHaveLength(1)
    expect(doc.cues[0].levels).toEqual([{ channel: 1, value: 128 }])
    expect(doc.warnings.some(w => w.code === 'usitt.badLevel')).toBe(true)
  })
})

const DIMMER: FixtureDefinition = {
  id: 'generic/dimmer', name: 'Dimmer', manufacturer: 'Generic', categories: ['Dimmer'],
  channels: { Intensity: { name: 'Intensity', type: 'intensity' } },
  modes: [{ name: '1ch', channels: ['Intensity'], channelCount: 1 }]
}
const SPOT: FixtureDefinition = {
  id: 'demo/spot', name: 'Spot', manufacturer: 'Demo', categories: ['Moving Head'],
  channels: {
    Pan: { name: 'Pan', type: 'pan' }, Tilt: { name: 'Tilt', type: 'tilt' },
    Dimmer: { name: 'Dimmer', type: 'intensity' }, 'Dimmer fine': { name: 'Dimmer fine', type: 'intensity', fineOf: 'Dimmer' }
  },
  modes: [{ name: 'Std', channels: ['Pan', 'Tilt', 'Dimmer', 'Dimmer fine'], channelCount: 4 }]
}
const RGB: FixtureDefinition = {
  id: 'demo/rgb', name: 'RGB', manufacturer: 'Demo', categories: ['Color Changer'],
  channels: { Red: { name: 'Red', type: 'color' }, Green: { name: 'Green', type: 'color' }, Blue: { name: 'Blue', type: 'color' } },
  modes: [{ name: '3ch', channels: ['Red', 'Green', 'Blue'], channelCount: 3 }]
}

function demoShow(): ShowFile {
  const show = createEmptyShow('Démo')
  show.patch = [
    { id: 'a', fixtureDefId: DIMMER.id, modeName: '1ch', universe: 0, address: 10, name: 'Front', groupIds: [], fid: 1 },
    { id: 'b', fixtureDefId: SPOT.id, modeName: 'Std', universe: 1, address: 1, name: 'Spot', groupIds: [], fid: 101 },
    { id: 'c', fixtureDefId: RGB.id, modeName: '3ch', universe: 0, address: 100, name: 'LED', groupIds: [] }
  ]
  show.groups = [{ id: 'g', name: 'All', color: '#fff', fixtureIds: ['a', 'b', 'c'], number: 3 }]
  show.cuelists = [
    {
      id: 'l1', name: 'Main', number: 1, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
      cues: [
        { id: 'q1', name: 'Ouverture', number: 1, fadeIn: 3, fadeOut: 4, delay: 0, followTime: null,
          values: [{ fixtureId: 'a', channelName: 'Intensity', value: 255 }, { fixtureId: 'b', channelName: 'Dimmer', value: 128 },
            { fixtureId: 'b', channelName: 'Pan', value: 10 }, { fixtureId: 'c', channelName: 'Red', value: 255 }] },
        // tracking: 'a' stays at full, 'b' goes out
        { id: 'q2', name: 'Two', number: 2.5, fadeIn: 2, fadeOut: 2, delay: 1, followTime: 5, followMode: 'after-go',
          values: [{ fixtureId: 'b', channelName: 'Dimmer', value: 0 }],
          featureTiming: { intensity: { fade: 6 }, position: { fade: 1 } } },
        { id: 'q3', name: 'Parts', number: 3, fadeIn: 1, fadeOut: 1, delay: 0, followTime: null, parts: [{ index: 1, fade: 9 }],
          values: [{ fixtureId: 'b', channelName: 'Dimmer', value: 200, part: 1 }] }
      ]
    },
    {
      id: 'l2', name: 'Second', number: 2, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
      cues: [{ id: 'z1', name: 'Z', number: 1, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null, values: [{ fixtureId: 'a', channelName: 'Intensity', value: 51 }] }]
    }
  ]
  show.effects = [{ id: 'e', name: 'fx', waveform: 'sine', speed: 1, depth: 255, offset: 0, channelType: 'Pan', fixtureIds: ['b'], fan: 0, isRunning: false }]
  return show
}

describe('USITT ASCII export', () => {
  it('is registered and writes a standard file', async () => {
    expect(getExporter('usitt-ascii')).toBe(usittExporter)
    const { bytes, warnings } = await usittExporter.write(demoShow(), [DIMMER, SPOT, RGB])
    const text = new TextDecoder().decode(bytes)
    const lines = text.split('\r\n')
    expect(lines.every(l => l.length <= 80)).toBe(true)
    expect([...text].every(c => c.charCodeAt(0) < 128)).toBe(true)
    expect(text).toContain('IDENT 3:0')
    expect(text).toContain('MANUFACTURER PhotonBoard')
    // Spot intensity is at universe 2 address 1 + offset 2 → dimmer 515
    expect(text).toContain('PATCH 1 1<10@FL 101<515@FL')
    expect(text).not.toMatch(/<100@/) // RGB fixture has no intensity
    expect(text).toContain('CUE 1\r\n  TEXT Ouverture\r\n  UP 3\r\n  DOWN 4\r\n  CHAN 1/HFF 101/H80')
    // cue 2.5: tracked look (1 stays up), 101 written at 0, intensity timing used, FOLLOWON from the GO
    expect(text).toContain('CUE 2.5\r\n  TEXT Two\r\n  UP 6 1\r\n  DOWN 2 1\r\n  FOLLOWON 5\r\n  CHAN 1/HFF 101/H00')
    expect(text).toContain('  PART 1\r\n    UP 9\r\n    DOWN 1\r\n    CHAN 101/HC8')
    expect(text).toContain('$SEQUENCE 2 0 Second')
    expect(text).toContain('$CUE 2 1')
    expect(text).toContain('GROUP 3\r\n  TEXT All\r\n  CHAN 1/HFF 101/HFF 102/HFF')
    expect(text).toMatch(/ENDDATA\r\n$/)
    const codes = warnings.map(w => w.code)
    for (const c of ['usitt.noIntensity', 'usitt.nonIntensity', 'usitt.extraLists', 'usitt.notRepresentable', 'usitt.featureTiming']) {
      expect(codes).toContain(c)
    }
  })

  it('round-trips patch, cues and groups through import', async () => {
    const { bytes } = await usittExporter.write(demoShow(), [DIMMER, SPOT, RGB])
    const frag = await usittImporter.parse(bytes, 'roundtrip.asc', noCtx)
    expect(frag.sourceApp).toBe('PhotonBoard')
    const f1 = frag.patch.find(p => p.fid === 1)!
    expect(f1).toMatchObject({ universe: 0, address: 10 })
    expect(frag.patch.find(p => p.fid === 101)).toMatchObject({ universe: 1, address: 3 })
    const main = frag.cuelists.find(c => c.number === 1)!
    expect(main.cues.map(c => c.number)).toEqual([1, 2.5, 3])
    expect(main.cues[1]).toMatchObject({ name: 'Two', fadeIn: 6, delay: 1, followTime: 5 })
    expect(main.cues[0].values.find(v => v.fixtureId === f1.id)?.value).toBe(255)
    expect(frag.cuelists.find(c => c.number === 2)!.cues[0].values[0].value).toBe(51)
    expect(frag.groups[0]).toMatchObject({ name: 'All', number: 3 })
  })
})
