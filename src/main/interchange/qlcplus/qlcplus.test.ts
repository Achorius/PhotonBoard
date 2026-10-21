import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { ImportContext, ImportedShowFragment } from '../../../shared/interchange'
import type { FixtureDefinition, ShowFile } from '../../../shared/types'
import { normalizeShow } from '../../../shared/show-format'
import { FixtureCatalog } from '../../fixture-catalog'
import { BUILTIN_FIXTURES } from '../../fixture-library'
import { compactKey, slugify } from '../../fixture-convert-common'
import { getExporter, getImporter, detectImporter } from '../registry'
import '../formats'
import { detectQlcWorkspace } from './index'
import { exportQlcWorkspace, qlcManufacturerOf } from './export'
import { importQlcWorkspace } from './import'
import { parseWorkspace, NotAWorkspaceError, QLC_INFINITE } from './model'
import { channelFromFit, efxFromAxes, fitAxis, lissajousAxis, sampleEfx } from './efx'
import { midiToQlcChannel, qlcChannelToMidi, MIDI_OMNI } from './midi'
import { asQlcGeneric, rgbPanelDefinition } from './generic'

const FIXTURES_DIR = resolve(__dirname, '../../../../test-fixtures/interchange/qlcplus')
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(FIXTURES_DIR, name)))

// ---- a host-like ImportContext: built-in library + offline catalog ----

const catalog = new FixtureCatalog([resolve(__dirname, '../../../../resources/fixture-library')])
const resolvedDefs = new Map<string, FixtureDefinition>()
for (const d of BUILTIN_FIXTURES) resolvedDefs.set(d.id, d)

const ctx: ImportContext = {
  async findFixture(manufacturer, model) {
    const builtin = BUILTIN_FIXTURES.find((d) => compactKey(d.manufacturer) === compactKey(manufacturer) && compactKey(d.name) === compactKey(model))
    if (builtin) return builtin
    const id = await catalog.resolveId(`qlc/${slugify(manufacturer) || 'unknown'}/${slugify(model) || 'fixture'}`)
    let def = id ? await catalog.get(id) : null
    if (!def) {
      const r = await catalog.search({ text: model, manufacturer, limit: 10 })
      const hit = r.entries.find((e) => compactKey(e.name) === compactKey(model))
      def = hit ? await catalog.get(hit.id) : null
    }
    if (def) resolvedDefs.set(def.id, def)
    return def
  },
  async parseGdtf() { return null },
  async parseQxf() { return null }
}

const importFile = (name: string): Promise<ImportedShowFragment> => importQlcWorkspace(read(name), name, ctx)

/** A show built from a fragment (what the merge step does for "open as new show") */
function showOf(frag: ImportedShowFragment): ShowFile {
  const { show } = normalizeShow({
    version: 3,
    name: frag.name,
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    patch: frag.patch,
    groups: frag.groups,
    presets: frag.presets,
    cuelists: frag.cuelists,
    chases: frag.chases,
    effects: frag.effects,
    midiMappings: frag.midiMappings,
    stageLayout: { width: 1200, height: 600, fixtures: [] },
    roomConfig: frag.roomConfig,
    timeline: frag.timeline,
    executor: frag.executor,
    macros: frag.macros
  })
  return show
}

function defsOf(frag: ImportedShowFragment): FixtureDefinition[] {
  const out = new Map<string, FixtureDefinition>()
  for (const d of frag.fixtures) out.set(d.id, d)
  for (const p of frag.patch) {
    const d = resolvedDefs.get(p.fixtureDefId)
    if (d) out.set(d.id, d)
  }
  return [...out.values()]
}

/** Seconds from a cue's GO to the next automatic GO (Infinity = manual) */
function goNext(c: { followTime: number | null; followMode?: string; fadeIn: number }): number {
  if (c.followTime === null) return Infinity
  return c.followMode === 'after-go' ? c.followTime : c.followTime + c.fadeIn
}

/** The DMX state a cue list's cue n leaves (tracking aware) */
function cueState(show: ShowFile, cuelistName: string, cueIndex: number): Record<string, number> {
  const cl = show.cuelists.find((c) => c.name === cuelistName)!
  const state: Record<string, number> = {}
  const name = (fixtureId: string): string => show.patch.find((p) => p.id === fixtureId)?.name ?? fixtureId
  for (let i = 0; i <= cueIndex; i++) {
    if (cl.tracking === false && i < cueIndex) continue
    for (const v of cl.cues[i].values) state[`${name(v.fixtureId)}/${v.channelName}`] = v.value
  }
  return state
}

beforeAll(async () => {
  await catalog.load()
})

// ------------------------------------------------------------------ units

describe('QLC+ MIDI channel numbering', () => {
  it('maps CC, notes and program changes like plugins/midi/src/common/midiprotocol.cpp', () => {
    expect(qlcChannelToMidi(7, undefined)).toEqual({ type: 'cc', channel: 1, number: 7 })
    expect(qlcChannelToMidi(128 + 60, 2)).toEqual({ type: 'note', channel: 3, number: 60 })
    expect(qlcChannelToMidi(384 + 5, 0)).toEqual({ type: 'program', channel: 1, number: 5 })
    // OMNI: channel in bits 12-15
    expect(qlcChannelToMidi((9 << 12) | (128 + 36), MIDI_OMNI)).toEqual({ type: 'note', channel: 10, number: 36 })
    // multipage frame page in bits 16+
    expect(qlcChannelToMidi((2 << 16) | 20, 0)).toEqual({ type: 'cc', channel: 1, number: 20 })
    expect(qlcChannelToMidi(513, 0)).toBeNull()
    expect(midiToQlcChannel({ type: 'note', channel: 10, number: 36 }, MIDI_OMNI)).toBe((9 << 12) | 164)
    expect(midiToQlcChannel({ type: 'cc', channel: 3, number: 20 }, 2)).toBe(20)
  })
})

describe('QLC+ EFX math', () => {
  const base = { width: 100, height: 60, rotation: 0, xFrequency: 2, yFrequency: 3, xPhase: 90, yPhase: 0, reversed: false }

  it('fits a circle exactly as two sines 90° apart', () => {
    const [xs, ys] = sampleEfx({ ...base, algorithm: 'Circle' })
    const fx = fitAxis(xs)
    const fy = fitAxis(ys)
    expect(fx.waveform).toBe('sine')
    expect(fx.m).toBe(1)
    expect(fx.amplitude).toBeCloseTo(100, 1)
    expect(fy.amplitude).toBeCloseTo(60, 1)
    // x = cos(θ+90°) = sin(θ+180°) ; y = cos θ = sin(θ+90°)
    expect(fx.phase).toBeCloseTo(180, 0)
    expect(fy.phase).toBeCloseTo(90, 0)
    expect(channelFromFit('Pan', fx).depth).toBe(200)
  })

  it('folds a rotation into the sine phases (still exact)', () => {
    const [xs] = sampleEfx({ ...base, algorithm: 'Circle', rotation: 45 })
    const f = fitAxis(xs)
    expect(f.waveform).toBe('sine')
    expect(f.error).toBeLessThan(0.01)
  })

  it('recognises the eight (pan at twice the tilt frequency) and true squares', () => {
    const [xs, ys] = sampleEfx({ ...base, algorithm: 'Eight' })
    expect(fitAxis(xs).m).toBe(2)
    expect(fitAxis(ys).m).toBe(1)
    const [sx, sy] = sampleEfx({ ...base, algorithm: 'SquareTrue' })
    const fx = fitAxis(sx)
    const fy = fitAxis(sy)
    expect(fx.waveform).toBe('square')
    expect(fy.waveform).toBe('square')
    expect(fx.error).toBeLessThan(0.05)
    // y is x shifted by a quarter
    expect(((fy.phase - fx.phase) % 360 + 360) % 360).toBeCloseTo(90, -1)
  })

  it('uses one custom shape for diamonds', () => {
    const [xs, ys] = sampleEfx({ ...base, algorithm: 'Diamond' })
    const fx = fitAxis(xs)
    expect(fx.waveform).toBe('custom')
    const fy = fitAxis(ys, fx.keyframes)
    expect(fy.waveform).toBe('custom')
    expect(fy.error).toBeLessThan(0.08)
  })

  it('writes PhotonBoard sines back as Circle / Eight / Lissajous', () => {
    const circle = efxFromAxes(lissajousAxis({ channelType: 'Pan', phaseOffset: 180, depth: 200 }, 0), lissajousAxis({ channelType: 'Tilt', phaseOffset: 90, depth: 120 }, 0))
    expect(circle).toMatchObject({ algorithm: 'Circle', direction: 'Forward', startOffset: 0, width: 100, height: 60 })
    const eight = efxFromAxes(lissajousAxis({ channelType: 'Pan', phaseOffset: 180, depth: 160, frequencyMultiplier: 2 }, 0), lissajousAxis({ channelType: 'Tilt', phaseOffset: 90, depth: 80 }, 0))
    expect(eight.algorithm).toBe('Eight')
    const liss = efxFromAxes(lissajousAxis({ channelType: 'Pan', phaseOffset: 10, depth: 100, frequencyMultiplier: 3 }, 0), lissajousAxis({ channelType: 'Tilt', phaseOffset: 0, depth: 100, frequencyMultiplier: 2 }, 0))
    expect(liss).toMatchObject({ algorithm: 'Lissajous', xFrequency: 3, yFrequency: 2 })
    // and the Lissajous re-imports to the same sines
    const [xs, ys] = sampleEfx({ algorithm: liss.algorithm, width: liss.width, height: liss.height, rotation: 0, xFrequency: liss.xFrequency, yFrequency: liss.yFrequency, xPhase: liss.xPhase, yPhase: liss.yPhase, reversed: false })
    expect(fitAxis(xs)).toMatchObject({ waveform: 'sine', m: 3 })
    expect(fitAxis(xs).phase).toBeCloseTo(10, 0)
    expect(fitAxis(ys).phase).toBeCloseTo(0, 0)
  })
})

describe('QLC+ generic fixtures', () => {
  it('builds RGB panels like Fixture::genericRGBPanelDef', () => {
    const { def } = rgbPanelDefinition('BGR', 9)
    expect(def!.modes[0].channels).toEqual(['Blue 1', 'Green 1', 'Red 1', 'Blue 2', 'Green 2', 'Red 2', 'Blue 3', 'Green 3', 'Red 3'])
    expect(def!.modes[0].pixelLayout?.cellCount).toBe(3)
    expect(rgbPanelDefinition('RGB', 3).id).toBe('generic/rgb')
    const rgb16 = rgbPanelDefinition('RGB 16bit', 6).def!
    expect(rgb16.channels['Red 1 fine'].fineOf).toBe('Red 1')
  })

  it('exports PhotonBoard generic types as QLC+ built-ins', () => {
    const rgb = BUILTIN_FIXTURES.find((d) => d.id === 'generic/rgb')!
    expect(asQlcGeneric(rgb, rgb.modes[0])).toEqual({ kind: 'rgbpanel', mode: 'RGB', channels: 3, heads: 1 })
    const bar = BUILTIN_FIXTURES.find((d) => d.id === 'generic/led-bar-rgb-8')!
    expect(asQlcGeneric(bar, bar.modes[0])).toMatchObject({ kind: 'rgbpanel', heads: 8 })
    const dim = BUILTIN_FIXTURES.find((d) => d.id === 'generic/dimmer')!
    expect(asQlcGeneric(dim, dim.modes[0])).toEqual({ kind: 'dimmer', channels: 1 })
    const spot = BUILTIN_FIXTURES.find((d) => d.id === 'generic/moving-head-spot')!
    expect(asQlcGeneric(spot, spot.modes[0])).toBeNull()
  })

  it('names QLC+ catalog fixtures with QLC+ spelling', () => {
    expect(qlcManufacturerOf({ id: 'x', name: 'Mega Pixel', manufacturer: 'ADJ', categories: [], channels: {}, modes: [], catalog: { source: 'qlcplus', path: 'resources/fixtures/American_DJ/American-DJ-Mega-Pixel.qxf', revision: 'r', license: 'Apache-2.0' } }))
      .toBe('American DJ')
    expect(qlcManufacturerOf({ id: 'x', name: 'X', manufacturer: 'Eurolite', categories: [], channels: {}, modes: [], catalog: { source: 'qlcplus', path: 'resources/fixtures/Eurolite/Eurolite-X.qxf', revision: 'r', license: 'Apache-2.0' } }))
      .toBe('Eurolite')
  })
})

// ------------------------------------------------------------------ detection / robustness

describe('QLC+ workspace detection and robustness', () => {
  it('registers and detects', () => {
    expect(getImporter('qlcplus-workspace')).toBeDefined()
    expect(getExporter('qlcplus-workspace')).toBeDefined()
    expect(detectQlcWorkspace('show.qxw', read('qlcplus-Sample.qxw'))).toBe(1)
    expect(detectQlcWorkspace('show.xml', new TextEncoder().encode('<?xml version="1.0"?><FixtureDefinition/>'))).toBe(0)
    expect(detectImporter('x.qxw', read('minidesk.qxw'))?.importer.info.id).toBe('qlcplus-workspace')
  })

  it('rejects other XML as "not this format"', async () => {
    await expect(importQlcWorkspace(new TextEncoder().encode('<FixtureDefinition><Model>x</Model></FixtureDefinition>'), 'x.qxw', ctx)).rejects.toBeInstanceOf(NotAWorkspaceError)
  })

  it('survives garbage values', async () => {
    const xml = `<!DOCTYPE Workspace><Workspace><Engine>
      <Fixture><Manufacturer>Generic</Manufacturer><Model>Generic</Model><ID>x</ID><Channels>-3</Channels></Fixture>
      <Fixture><Manufacturer>Generic</Manufacturer><Model>Generic</Model><ID>3</ID><Channels>abc</Channels><Address>900</Address></Fixture>
      <Function ID="1" Type="Scene" Name="S"><FixtureVal ID="3">0,999,1,,5,7,a,b</FixtureVal><FixtureVal>1,2</FixtureVal></Function>
      <Function ID="2" Type="Chaser" Name="C"><Step>1</Step><Step Number="zz">77</Step></Function>
      <Function ID="3" Type="EFX" Name="E"><Fixture><ID>3</ID></Fixture><Width>abc</Width></Function>
      <Function ID="4" Type="Show" Name="Sh"><Track ID="0" isMute="0"><ShowFunction ID="1" StartTime="-5"/></Track></Function>
      <Function ID="5" Type="Weird" Name="W"/>
    </Engine><VirtualConsole><Frame><Button><Function ID="1"/><Input Universe="9" Channel="3"/></Button></Frame></VirtualConsole></Workspace>`
    const frag = await importQlcWorkspace(new TextEncoder().encode(xml), 'bad.qxw', ctx)
    expect(frag.patch).toHaveLength(1)
    expect(frag.cuelists.length).toBeGreaterThan(0)
    expect(frag.warnings.length).toBeGreaterThan(0)
    expect(() => showOf(frag)).not.toThrow()
  })
})

// ------------------------------------------------------------------ real workspaces

describe('QLC+ sample workspaces (real files)', () => {
  it('imports the official QLC+ Sample.qxw (QLC+ 4.0.2)', async () => {
    const frag = await importFile('qlcplus-Sample.qxw')
    expect(frag.sourceApp).toBe('Q Light Controller Plus 4.0.2')
    expect(frag.patch).toHaveLength(13)
    const scan = frag.patch.find((p) => p.name === 'DJScan250 #1')!
    expect(scan).toMatchObject({ universe: 0, address: 23, fid: 5 })
    // DJScan250 is in the catalog (OFL "DJ-Scan 250", 6 channels): matched by channel count
    expect(scan.fixtureDefId).not.toMatch(/^qlcplus-unknown/)
    // Generic dimmer packs became 6-channel dimmer definitions
    const dimmer = frag.patch.find((p) => p.name === '6 ch Dimmer #1')!
    expect(dimmer.fixtureDefId).toBe('qlcplus-generic/dimmer-6ch')
    expect(frag.fixtures.find((d) => d.id === 'qlcplus-generic/dimmer-6ch')!.modes[0].pixelLayout?.cellCount).toBe(6)
    // 13 chasers: timed loops → chases; 96 scenes; 5 EFX
    expect(frag.chases.length + frag.cuelists.filter((c) => c.cues.length > 1).length).toBe(13)
    expect(frag.effects.length).toBeGreaterThanOrEqual(5)
    const circle = frag.effects.find((e) => e.name === 'SC Circle 1')!
    expect(circle.fixtureIds).toHaveLength(6)
    expect(circle.speed).toBeCloseTo(1000 / 19000, 4)
    expect(circle.channels!.map((c) => c.channelType)).toEqual(['Pan', 'Tilt'])
    expect(circle.channels![0].depth).toBe(100)
    expect(circle.fadeIn).toBe(1)
    const red = frag.cuelists.find((c) => c.name === 'Led All Red')!
    expect(red.cues[0].values.length).toBe(22)
    // Virtual console buttons → executor cells
    const cells = frag.executor!.pages!.flatMap((p) => p.cells.flat()).filter(Boolean)
    expect(cells.length).toBeGreaterThan(10)
    expect(() => showOf(frag)).not.toThrow()
    const { warnings } = normalizeShow({ ...showOf(frag) })
    expect(warnings.filter((w) => /missing|removed|dropped/i.test(w))).toEqual([])
  })

  it('imports a sACN console with level sliders (tigoe, QLC+ 4.12.1)', async () => {
    const frag = await importFile('tigoe-virtual-console.qxw')
    expect(frag.patch).toHaveLength(1)
    expect(frag.patch[0].fixtureDefId).toBe('qlcplus-generic/dimmer-110ch')
    expect(frag.warnings.find((w) => w.code === 'qlcplus.output.e131')?.params).toMatchObject({ universe: 1, target: 'multicast', sacnUniverse: '1' })
    expect(frag.warnings.some((w) => w.code === 'qlcplus.output.plugin' && w.params?.plugin === 'DMX USB')).toBe(true)
    // its sliders listen to sACN input, not MIDI: reported, not mapped
    expect(frag.midiMappings).toHaveLength(0)
    expect(frag.warnings.some((w) => w.code === 'qlcplus.levelSlider' || w.code === 'qlcplus.inputNotMidi')).toBe(true)
  })

  it('imports RGB matrices, chasers and channel groups (QLC+ 4.5)', async () => {
    const frag = await importFile('plugz-fanfare-abattoir.qxw')
    expect(frag.effects.length).toBeGreaterThanOrEqual(10)
    expect(frag.warnings.some((w) => w.code === 'qlcplus.rgbMatrix')).toBe(true)
    expect(frag.groups.some((g) => g.id.startsWith('qlc-chgrp-'))).toBe(true)
    expect(() => showOf(frag)).not.toThrow()
  })

  it('imports a theatre workspace with channel-group sliders (QLC+ 4.5)', async () => {
    const frag = await importFile('plugz-theatre.qxw')
    expect(frag.cuelists.length).toBeGreaterThan(0)
    expect(frag.groups.length).toBeGreaterThan(0)
  })

  it('imports a QLC 3.2 workspace (legacy <Value> scenes, <Bus> speeds)', async () => {
    const frag = await importFile('r26d-big-e-ranch.qxw')
    expect(frag.sourceApp).toMatch(/^Q Light Controller 3\.2/)
    expect(frag.patch.length).toBeGreaterThan(5)
    const withValues = frag.cuelists.filter((c) => c.cues.some((q) => q.values.length > 0))
    expect(withValues.length).toBeGreaterThan(50)
    expect(frag.effects.length).toBeGreaterThanOrEqual(2)
    expect(frag.executor?.pages?.length).toBeGreaterThan(1)
    expect(() => showOf(frag)).not.toThrow()
  })

  it('imports a QLC+ 4.14 workspace', async () => {
    const frag = await importFile('minidesk.qxw')
    expect(frag.sourceApp).toBe('Q Light Controller Plus 4.14.3')
    expect(frag.cuelists).toHaveLength(2)
    expect(frag.warnings.some((w) => w.code === 'qlcplus.fixtureNotFound')).toBe(true)
  })
})

// ------------------------------------------------------------------ detailed mapping

describe('QLC+ 4.13 workspace mapping (hand-made sample)', () => {
  let frag: ImportedShowFragment
  beforeAll(async () => { frag = await importFile('photonboard-modern.qxw') })

  it('patches fixtures, generic types and unknown types', () => {
    const byName = (n: string) => frag.patch.find((p) => p.name === n)!
    expect(byName('Dimmer pack & FOH')).toMatchObject({ fixtureDefId: 'qlcplus-generic/dimmer-4ch', address: 1, universe: 0, fid: 1 })
    expect(byName('Pixel bar')).toMatchObject({ fixtureDefId: 'qlcplus-generic/rgbpanel-rgb-4', address: 11 })
    expect(byName('Par L').fixtureDefId).toBe('qlc/eurolite/led-par56')
    expect(byName('Scan 1').universe).toBe(1)
    expect(byName('Mystery').fixtureDefId).toMatch(/^qlcplus-unknown\//)
    expect(frag.warnings.find((w) => w.code === 'qlcplus.fixtureNotFound')?.message).toContain('Nobody Mystery Box 3000')
  })

  it('reports outputs with their addresses', () => {
    const art = frag.warnings.find((w) => w.code === 'qlcplus.output.artnet')!
    expect(art.params).toMatchObject({ universe: 1, ip: '2.0.0.50', artnetUniverse: 3 })
    expect(frag.warnings.find((w) => w.code === 'qlcplus.output.e131')?.params).toMatchObject({ target: '10.0.0.9', sacnUniverse: '7' })
  })

  it('imports 3D monitor positions', () => {
    const s1 = frag.patch.find((p) => p.name === 'Scan 1')!
    expect(s1.position3D).toEqual({ x: -3, y: 4.5, z: 3 })
    expect(frag.roomConfig).toMatchObject({ width: 10, depth: 8, height: 5 })
    expect(frag.warnings.some((w) => w.code === 'qlcplus.rotations')).toBe(true)
  })

  it('imports groups, channel groups and palettes', () => {
    const scanners = frag.groups.find((g) => g.name === 'Scanners')!
    expect(scanners.fixtureIds).toEqual(['qlc-fx-4', 'qlc-fx-5', 'qlc-fx-6', 'qlc-fx-7'])
    expect(frag.patch.find((p) => p.id === 'qlc-fx-4')!.groupIds).toContain(scanners.id)
    expect(frag.groups.find((g) => g.name === 'Par reds')!.fixtureIds).toEqual(['qlc-fx-2', 'qlc-fx-3'])
    expect(frag.presets.find((p) => p.name === 'Half')).toMatchObject({ type: 'intensity', scope: 'universal', universal: { dimmer: 128 } })
    expect(frag.presets.find((p) => p.name === 'Amber')).toMatchObject({ type: 'color', universal: { red: 255, green: 191, blue: 0 } })
    expect(frag.presets.find((p) => p.name === 'Centre')?.scope).toBe('global')
    expect(frag.warnings.find((w) => w.code === 'qlcplus.palette')?.message).toContain('Gobo 2')
  })

  it('turns scenes into one-cue cue lists with their fades', () => {
    const red = frag.cuelists.find((c) => c.name === 'Pars red')!
    expect(red.cues).toHaveLength(1)
    expect(red.cues[0]).toMatchObject({ fadeIn: 1.5, fadeOut: 2, followTime: null })
    const parL = frag.patch.find((p) => p.name === 'Par L')!
    const def = resolvedDefs.get(parL.fixtureDefId)!
    const ch1 = def.modes.find((m) => m.name === parL.modeName)!.channels[1]
    expect(red.cues[0].values).toContainEqual({ fixtureId: parL.id, channelName: ch1, value: 255 })
    // scenes used only as chaser / sequence steps are not duplicated as cue lists
    expect(frag.cuelists.some((c) => c.name === 'Seq bound scene')).toBe(false)
  })

  it('turns a cue stack chaser into a cue list with per-step timing', () => {
    const act = frag.cuelists.find((c) => c.name === 'Act 1')!
    expect(act.cues.map((c) => c.name)).toEqual(['Preset', 'Pars red', 'Out'])
    expect(act.cues[0]).toMatchObject({ fadeIn: 3, fadeOut: 1, followTime: null })
    expect(act.cues[1]).toMatchObject({ fadeIn: 2, followTime: 7, followMode: 'after-go' })
    expect(act.isLooping).toBe(false)
    expect(act.tracking).toBe(false)
  })

  it('turns a timed chaser into a chase (ping-pong → bounce)', () => {
    const chase = frag.chases.find((c) => c.name === 'Red blue chase')!
    expect(chase).toMatchObject({ bpm: 120, fadePercent: 50, direction: 'bounce', isLooping: true })
    expect(chase.steps).toHaveLength(2)
  })

  it('turns a timed sequence into a chase of its step values', () => {
    const seq = frag.chases.find((c) => c.name === 'Dimmer sequence')!
    expect(seq.steps).toHaveLength(2)
    expect(seq.bpm).toBe(60)
    expect(seq.fadePercent).toBe(10)
    expect(seq.steps[0].values).toEqual([
      { fixtureId: 'qlc-fx-0', channelName: 'Dimmer 1', value: 255 },
      { fixtureId: 'qlc-fx-0', channelName: 'Dimmer 2', value: 0 }
    ])
    expect(seq.steps[1].values.find((v) => v.channelName === 'Dimmer 2')!.value).toBe(255)
  })

  it('turns EFX into pan / tilt effects with fan and splits directions', () => {
    const circle = frag.effects.find((e) => e.name === 'Scan circle')!
    expect(circle.speed).toBeCloseTo(0.25, 3)
    // Asymmetric propagation: fixture i at i/(n+1) of the loop ⇒ fan = 360·n/(n+1)
    expect(circle.fan).toBeCloseTo(270, 1)
    expect(circle.channels).toEqual([
      { channelType: 'Pan', phaseOffset: 180, depth: 200 },
      { channelType: 'Tilt', phaseOffset: 90, depth: 120 }
    ])
    const eights = frag.effects.filter((e) => e.name.startsWith('Scan eight'))
    expect(eights).toHaveLength(2)
    expect(eights[0].fadeIn).toBe(1)
    expect(eights[0].speed).toBeCloseTo(0.5, 3)
    expect(eights[0].channels![0].frequencyMultiplier).toBe(2)
    expect(frag.warnings.find((w) => w.code === 'qlcplus.efxCentre')?.message).toContain('Scan eight')
    const square = frag.effects.find((e) => e.name === 'Square sweep')!
    expect(square.channels!.map((c) => c.waveform)).toEqual(['square', 'square'])
  })

  it('approximates RGB matrices and maps collections', () => {
    const bar = frag.effects.find((e) => e.name === 'Bar stripes')!
    expect(bar.channels).toEqual([{ channelType: 'Red', phaseOffset: 0, depth: 255 }])
    expect(bar.fixtureIds).toEqual(['qlc-fx-1'])
    const merged = frag.cuelists.find((c) => c.name === 'Red with circle')!
    expect(merged.cues[0].values.length).toBe(8)
    expect(merged.effectSnapshots?.map((e) => e.name)).toEqual(['Scan circle'])
    const party = frag.macros.find((m) => m.name === 'Party')!
    const chaseNo = frag.chases.find((c) => c.name === 'Red blue chase')!.number
    const fxNo = frag.effects.find((e) => e.name === 'Bar stripes')!.number
    expect(party.lines.map((l) => l.command)).toEqual([`Go Chase ${chaseNo}`, `Go Effect ${fxNo}`])
  })

  it('turns the show into the timeline', () => {
    const tl = frag.timeline!
    expect(tl.trackNames).toEqual(['Front', 'Movers'])
    expect(tl.clips).toHaveLength(3)
    const warm = tl.clips.find((c) => c.name === 'Front warm')!
    expect(warm).toMatchObject({ trackIndex: 0, startTime: 0, duration: 8, color: '#4080ff' })
    const fx = tl.clips.find((c) => c.name === 'Scan circle')!
    const wrapper = frag.cuelists.find((c) => c.id === fx.cuelistId)!
    expect(wrapper.effectSnapshots?.[0].name).toBe('Scan circle')
    expect(frag.warnings.find((w) => w.code === 'qlcplus.timelineMedia')?.message).toContain('Intro music')
  })

  it('turns the virtual console into executors and MIDI mappings', () => {
    const page = frag.executor!.pages![0]
    const row0 = page.cells.map((col) => col[0])
    expect(row0.slice(0, 5).map((c) => c?.kind)).toEqual(['cuelist', 'cuelist', 'chase', 'effect', 'macro'])
    expect(row0[1]?.mode).toBe('flash')
    const cueCell = page.cells.flat().find((c) => c?.id === 'qlc-fn-4')!
    expect(cueCell.button).toBe('go')
    const col = page.cells.findIndex((c) => c.some((x) => x?.id === 'qlc-fn-2'))
    expect(page.columns[col].fader).toEqual({ kind: 'cell', row: 0 })

    const m = (name: string) => frag.midiMappings.find((x) => x.name === name)!
    expect(m('Red')).toMatchObject({ source: { type: 'note', channel: 3, number: 56 }, target: { type: 'cuelist_go', id: 'qlc-fn-0' }, options: { behavior: 'toggle', feedback: 'note' } })
    expect(m('Blue flash').options.behavior).toBe('flash')
    expect(m('Circle').target).toEqual({ type: 'effect_toggle', id: 'qlc-fn-8' })
    expect(m('BO').target.type).toBe('blackout')
    expect(m('Act 1 next')).toMatchObject({ source: { type: 'note', number: 72 }, target: { type: 'cuelist_go', id: 'qlc-fn-4' }, options: { behavior: 'direct' } })
    expect(m('Front')).toMatchObject({ source: { type: 'cc', number: 48 }, target: { type: 'cuelist_fader', id: 'qlc-fn-2' } })
    const parL = frag.patch.find((p) => p.name === 'Par L')!
    expect(m(`Par L red ${frag.midiMappings.find((x) => x.name.startsWith('Par L red'))!.target.parameter}`)).toMatchObject({ target: { type: 'channel', id: parL.id }, options: { max: 200 } })
    expect(m('Grand master')).toMatchObject({ source: { type: 'cc', number: 56 }, target: { type: 'master' } })
    expect(frag.warnings.some((w) => w.code === 'qlcplus.vcWidget' && w.params?.kind === 'XYPad')).toBe(true)
    expect(frag.warnings.some((w) => w.code === 'qlcplus.cueListInputs')).toBe(true)
  })

  it('reports what is not carried', () => {
    const codes = new Set(frag.warnings.map((w) => w.code))
    for (const c of ['qlcplus.script', 'qlcplus.autostart', 'qlcplus.efxSplit']) expect(codes).toContain(c)
  })

  it('normalises without losing references', () => {
    const show = showOf(frag)
    expect(show.cuelists).toHaveLength(frag.cuelists.length)
    expect(show.timeline!.clips).toHaveLength(3)
    expect(show.executor!.pages![0].cells.flat().filter(Boolean)).toHaveLength(frag.executor!.pages![0].cells.flat().filter(Boolean).length)
  })
})

// ------------------------------------------------------------------ export / round trip

describe('QLC+ export and round trip', () => {
  it('writes a workspace QLC+ accepts (DOCTYPE, namespace, engine order)', async () => {
    const frag = await importFile('photonboard-modern.qxw')
    const { xml } = exportQlcWorkspace(showOf(frag), defsOf(frag))
    expect(xml).toContain('<Algorithm>SquareTrue</Algorithm>')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n<Workspace xmlns="http://www.qlcplus.org/Workspace"')).toBe(true)
    expect(xml).toContain('<Manufacturer>Generic</Manufacturer>\n   <Model>RGBPanel</Model>\n   <Mode>RGB</Mode>')
    expect(xml).toContain('<Name>Dimmer pack &amp; FOH</Name>')
    // QLC+ library fixture keeps its QLC+ names
    expect(xml).toContain('<Manufacturer>Eurolite</Manufacturer>\n   <Model>LED PAR56</Model>\n   <Mode>Mode 1</Mode>')
    const ws = parseWorkspace(xml)
    expect(ws.fixtures).toHaveLength(9)
    expect(ws.functions.filter((f) => f.type === 'Show')).toHaveLength(1)
  })

  it('round-trips the hand-made workspace: import(export(import(qxw))) ≈ import(qxw)', async () => {
    const a = await importFile('photonboard-modern.qxw')
    const showA = showOf(a)
    const { xml, warnings } = exportQlcWorkspace(showA, defsOf(a))
    expect(warnings.some((w) => w.code === 'qlcplus.export.macro')).toBe(true)
    const b = await importQlcWorkspace(new TextEncoder().encode(xml), 'roundtrip.qxw', ctx)
    const showB = showOf(b)

    // patch
    const key = (s: ShowFile) => s.patch.map((p) => [p.fid, p.name, p.universe, p.address, p.fixtureDefId, p.modeName].join('|')).sort()
    expect(key(showB)).toEqual(key(showA))
    // groups
    const groups = (s: ShowFile) => s.groups.map((g) => [g.name, g.fixtureIds.map((id) => s.patch.find((p) => p.id === id)!.name).join(',')].join(':')).sort()
    expect(groups(showB)).toEqual(groups(showA))
    // cue lists: same names, same cues, same values & timing
    for (const cl of showA.cuelists.filter((c) => !c.id.startsWith('qlc-show-'))) {
      const other = showB.cuelists.find((c) => c.name === cl.name)
      expect(other, cl.name).toBeDefined()
      expect(other!.cues.length).toBe(cl.cues.length)
      cl.cues.forEach((cue, i) => {
        expect(other!.cues[i].fadeIn).toBeCloseTo(cue.fadeIn, 3)
        expect(other!.cues[i].fadeOut).toBeCloseTo(cue.fadeOut, 3)
        expect(goNext(other!.cues[i])).toBeCloseTo(goNext(cue), 3)
        expect(cueState(showB, cl.name, i)).toEqual(cueState(showA, cl.name, i))
      })
      expect(other!.isLooping).toBe(cl.isLooping)
      expect((other!.effectSnapshots ?? []).map((e) => e.name)).toEqual((cl.effectSnapshots ?? []).map((e) => e.name))
    }
    // chases
    for (const ch of showA.chases) {
      const other = showB.chases.find((c) => c.name === ch.name)!
      expect(other).toMatchObject({ bpm: ch.bpm, fadePercent: ch.fadePercent, direction: ch.direction, isLooping: ch.isLooping })
      expect(other.steps.map((s) => s.values.length)).toEqual(ch.steps.map((s) => s.values.length))
    }
    // effects (pan / tilt): same channels within a degree / DMX step
    for (const e of showA.effects.filter((x) => x.channels?.every((c) => /pan|tilt/i.test(c.channelType) && (c.waveform ?? 'sine') === 'sine'))) {
      const other = showB.effects.find((x) => x.name === e.name)!
      expect(other, e.name).toBeDefined()
      expect(other.speed).toBeCloseTo(e.speed, 2)
      expect(other.fixtureIds.length).toBe(e.fixtureIds.length)
      expect(other.fan).toBeCloseTo(e.fan, 0)
      e.channels!.forEach((c, i) => {
        const o = other.channels![i]
        expect(o.channelType).toBe(c.channelType)
        expect(o.frequencyMultiplier ?? 1).toBe(c.frequencyMultiplier ?? 1)
        expect(Math.abs(o.depth - c.depth)).toBeLessThanOrEqual(2)
        const d = ((((o.phaseOffset + (other.offset ?? 0)) - (c.phaseOffset + (e.offset ?? 0))) % 360) + 540) % 360 - 180
        expect(Math.abs(d)).toBeLessThan(1.5)
      })
    }
    const sq = showB.effects.find((x) => x.name === 'Square sweep')!
    const sqA = showA.effects.find((x) => x.name === 'Square sweep')!
    expect(sq.channels!.map((c) => [c.waveform, c.depth])).toEqual(sqA.channels!.map((c) => [c.waveform, c.depth]))
    expect(sq.channels!.map((c) => Math.round(c.phaseOffset))).toEqual(sqA.channels!.map((c) => Math.round(c.phaseOffset)))
    // timeline
    const clips = (s: ShowFile) => s.timeline!.clips.map((c) => [c.trackIndex, c.startTime, c.duration, s.cuelists.find((x) => x.id === c.cuelistId)!.cues.length].join('|')).sort()
    expect(clips(showB)).toEqual(clips(showA))
    // executors: same kinds of cells in the same order
    const cells = (s: ShowFile) => s.executor!.pages!.flatMap((p) => p.cells.flat()).filter(Boolean).map((c) => c!.kind).join(',')
    expect(cells(showB).split(',').filter((k) => k !== 'macro')).toEqual(cells(showA).split(',').filter((k) => k !== 'macro'))
    // MIDI
    const midi = (s: ShowFile) => s.midiMappings.map((m) => [m.source.type, m.source.channel, m.source.number, m.target.type].join('|')).sort()
    expect(midi(showB)).toEqual(midi(showA))
    // universal presets
    expect(showB.presets.filter((p) => p.scope === 'universal').map((p) => p.name).sort()).toEqual(showA.presets.filter((p) => p.scope === 'universal').map((p) => p.name).sort())
  })

  it('round-trips a PhotonBoard show (builtin + catalog fixtures, tracking cue list, chase, effect, timeline, executors, MIDI)', async () => {
    const mac = await ctx.findFixture('Martin', 'MAC250+')
    expect(mac?.catalog?.source).toBe('qlcplus')
    const macMode = mac!.modes[0]
    const pan = macMode.channels.find((c) => mac!.channels[c].type === 'pan' && !mac!.channels[c].fineOf)!
    const tilt = macMode.channels.find((c) => mac!.channels[c].type === 'tilt' && !mac!.channels[c].fineOf)!
    const { show } = normalizeShow({
      version: 3, name: 'Round trip', createdAt: '', modifiedAt: '',
      patch: [
        { id: 'p1', fixtureDefId: 'generic/rgb', modeName: '3ch', universe: 0, address: 1, name: 'Par 1', groupIds: ['g1'], fid: 101, position3D: { x: -2, y: 3, z: 0 } },
        { id: 'p2', fixtureDefId: 'generic/rgb', modeName: '3ch', universe: 0, address: 4, name: 'Par 2', groupIds: ['g1'], fid: 102, position3D: { x: 2, y: 3, z: 0 } },
        { id: 'm1', fixtureDefId: mac!.id, modeName: macMode.name, universe: 1, address: 1, name: 'Spot 1', groupIds: [], fid: 201 },
        { id: 'm2', fixtureDefId: mac!.id, modeName: macMode.name, universe: 1, address: 21, name: 'Spot 2', groupIds: [], fid: 202 }
      ],
      groups: [{ id: 'g1', name: 'Pars', color: '#ff0000', fixtureIds: ['p1', 'p2'] }],
      presets: [{ id: 'pr1', name: 'Full', type: 'intensity', values: {}, scope: 'universal', universal: { dimmer: 255 } }],
      cuelists: [
        {
          id: 'cl1', name: 'Main', isLooping: false, cues: [
            { id: 'c1', name: 'Red', number: 1, fadeIn: 2, fadeOut: 1, delay: 0, followTime: null, values: [{ fixtureId: 'p1', channelName: 'Red', value: 255 }, { fixtureId: 'p2', channelName: 'Red', value: 200 }] },
            { id: 'c2', name: 'Blue', number: 2, fadeIn: 1, fadeOut: 1, delay: 0, followTime: 4, values: [{ fixtureId: 'p1', channelName: 'Blue', value: 255 }] },
            { id: 'c3', name: 'Spots', number: 3, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null, values: [{ fixtureId: 'm1', channelName: pan, value: 100 }, { fixtureId: 'm2', channelName: tilt, value: 50 }] }
          ]
        },
        { id: 'cl2', name: 'Look', cues: [{ id: 'c', name: 'Look', number: 1, fadeIn: 0.5, fadeOut: 0.5, delay: 0, followTime: null, values: [{ fixtureId: 'p2', channelName: 'Green', value: 128 }] }] }
      ],
      chases: [{ id: 'ch1', name: 'Flicker', bpm: 240, fadePercent: 25, direction: 'backward', isLooping: true, faderLevel: 255, steps: [
        { id: 's1', values: [{ fixtureId: 'p1', channelName: 'Red', value: 255 }] },
        { id: 's2', values: [{ fixtureId: 'p2', channelName: 'Red', value: 255 }], holdTime: 1 }
      ] }],
      effects: [
        { id: 'fx1', name: 'Circle', waveform: 'sine', speed: 0.5, depth: 200, offset: 30, channelType: 'Pan', fixtureIds: ['m1', 'm2'], fan: 180, isRunning: false,
          channels: [{ channelType: 'Pan', phaseOffset: 0, depth: 200 }, { channelType: 'Tilt', phaseOffset: 90, depth: 100 }] },
        { id: 'fx2', name: 'Rainbow', waveform: 'sine', speed: 1, depth: 255, offset: 0, channelType: 'Red', fixtureIds: ['p1', 'p2'], fan: 360, isRunning: false }
      ],
      midiMappings: [
        { id: 'mm1', name: 'Go main', source: { type: 'note', channel: 1, number: 60 }, target: { type: 'cuelist_go', id: 'cl1' }, options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct' } },
        { id: 'mm2', name: 'Look fader', source: { type: 'cc', channel: 1, number: 7 }, target: { type: 'cuelist_fader', id: 'cl2' }, options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct' } },
        { id: 'mm3', name: 'GM', source: { type: 'cc', channel: 1, number: 8 }, target: { type: 'master' }, options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct' } }
      ],
      stageLayout: { width: 1200, height: 600, fixtures: [] },
      roomConfig: { width: 10, depth: 8, height: 6, trussBars: [], stageEdgeZ: 0 },
      timeline: { clips: [{ id: 't1', cuelistId: 'cl2', trackIndex: 1, startTime: 4, duration: 6, color: '#00ff00' }], markers: [], zones: [], trackCount: 2, trackNames: ['A', 'B'] },
      executor: { grid: [], columns: [], modes: [], pages: [{ id: 'pg', name: 'Main', columns: [{ title: '', color: '#e85d04', fader: { kind: 'cell', row: 0 } }], cells: [[{ kind: 'cuelist', id: 'cl2', mode: 'toggle' }, { kind: 'cuelist', id: 'cl1', mode: 'toggle', button: 'go' }], [{ kind: 'chase', id: 'ch1', mode: 'flash' }, { kind: 'effect', id: 'fx1', mode: 'toggle' }]] }] },
      macros: [{ id: 'mac', number: 1, name: 'M', lines: [{ command: 'Go 1' }] }]
    })
    const defs = [BUILTIN_FIXTURES.find((d) => d.id === 'generic/rgb')!, mac!]
    const { xml, warnings } = exportQlcWorkspace(show, defs)
    expect(xml).toContain('<Manufacturer>Martin</Manufacturer>\n   <Model>MAC250+</Model>')
    expect(xml).toContain('<Algorithm>Circle</Algorithm>')
    expect(warnings.some((w) => w.code === 'qlcplus.export.effect' && !!w.message?.includes('Rainbow'))).toBe(true)
    expect(warnings.some((w) => w.code === 'qlcplus.export.macro')).toBe(true)

    const back = showOf(await importQlcWorkspace(new TextEncoder().encode(xml), 'rt.qxw', ctx))
    // patch: fixture numbers, addresses, types
    expect(back.patch.map((p) => [p.fid, p.name, p.universe, p.address, p.fixtureDefId]).sort()).toEqual([
      [101, 'Par 1', 0, 1, 'generic/rgb'], [102, 'Par 2', 0, 4, 'generic/rgb'], [201, 'Spot 1', 1, 1, mac!.id], [202, 'Spot 2', 1, 21, mac!.id]
    ].sort())
    // 2D monitor keeps x / height
    expect(back.patch.find((p) => p.name === 'Par 1')!.position3D).toMatchObject({ x: -2, y: 3 })
    expect(back.groups.find((g) => g.name === 'Pars')!.fixtureIds.map((id) => back.patch.find((p) => p.id === id)!.name)).toEqual(['Par 1', 'Par 2'])
    // tracking cue list: same output state per cue
    const main = back.cuelists.find((c) => c.name === 'Main')!
    expect(main.cues.map((c) => [c.name, c.fadeIn, c.fadeOut, goNext(c)])).toEqual([['Red', 2, 1, Infinity], ['Blue', 1, 1, 5], ['Spots', 0, 0, Infinity]])
    for (let i = 0; i < 3; i++) expect(cueState(back, 'Main', i)).toEqual(cueState(show, 'Main', i))
    expect(main.isLooping).toBe(false)
    expect(back.cuelists.find((c) => c.name === 'Look')!.cues[0]).toMatchObject({ fadeIn: 0.5, fadeOut: 0.5 })
    // chase
    expect(back.chases.find((c) => c.name === 'Flicker')).toMatchObject({ bpm: 240, fadePercent: 25, isLooping: true })
    const flick = back.chases.find((c) => c.name === 'Flicker')!
    expect(flick.steps.map((s) => s.holdTime)).toEqual([1, undefined])
    // effect
    const circle = back.effects.find((e) => e.name === 'Circle')!
    expect(circle.speed).toBeCloseTo(0.5, 3)
    expect(circle.fan).toBeCloseTo(180, 0)
    expect(circle.channels!.map((c) => c.depth)).toEqual([200, 100])
    expect(((circle.channels![0].phaseOffset - 30) % 360 + 360) % 360).toBeCloseTo(0, 0)
    expect(((circle.channels![1].phaseOffset - 120) % 360 + 360) % 360).toBeCloseTo(0, 0)
    // timeline
    expect(back.timeline!.clips).toHaveLength(1)
    expect(back.timeline!.clips[0]).toMatchObject({ trackIndex: 1, startTime: 4, duration: 6, color: '#00ff00' })
    expect(back.timeline!.trackNames).toEqual(['A', 'B'])
    // executors
    const cells = back.executor!.pages!.flatMap((p) => p.cells.flat()).filter(Boolean)
    expect(cells.map((c) => c!.kind).sort()).toEqual(['chase', 'cuelist', 'cuelist', 'effect'])
    expect(cells.find((c) => c!.kind === 'chase')!.mode).toBe('flash')
    expect(cells.find((c) => c!.kind === 'cuelist' && back.cuelists.find((x) => x.id === c!.id)!.name === 'Main')!.button).toBe('go')
    // MIDI
    expect(back.midiMappings.map((m) => [m.name.replace(/ (next|play)$/, ''), m.source.type, m.source.number, m.target.type]).sort()).toEqual([
      ['Grand master', 'cc', 8, 'master'], ['Look', 'cc', 7, 'cuelist_fader'], ['Main', 'note', 60, 'cuelist_go']
    ])
    // presets
    expect(back.presets.find((p) => p.name === 'Full')).toMatchObject({ scope: 'universal', universal: { dimmer: 255 } })
  })

  it('exports every sample workspace and re-imports it', async () => {
    for (const name of ['qlcplus-Sample.qxw', 'plugz-fanfare-abattoir.qxw', 'r26d-big-e-ranch.qxw', 'tigoe-virtual-console.qxw']) {
      const a = await importFile(name)
      const showA = showOf(a)
      const { xml } = exportQlcWorkspace(showA, defsOf(a))
      const b = await importQlcWorkspace(new TextEncoder().encode(xml), name, ctx)
      expect(b.patch.length, name).toBe(a.patch.length)
      const sceneCount = (f: ImportedShowFragment) => f.cuelists.reduce((s, c) => s + c.cues.length, 0)
      expect(sceneCount(b), name).toBeGreaterThanOrEqual(sceneCount(a) - a.cuelists.filter((c) => c.cues.length === 0).length)
      expect(b.chases.length, name).toBe(a.chases.length)
    }
  })

  it('writes infinite holds for manual cues', () => {
    const { xml } = exportQlcWorkspace(normalizeShow({
      version: 3, name: 'x', patch: [{ id: 'p', fixtureDefId: 'generic/dimmer', modeName: '1ch', universe: 0, address: 5, name: 'D', groupIds: [] }],
      cuelists: [{ id: 'c', name: 'Q', cues: [
        { id: 'a', name: 'A', number: 1, fadeIn: 1, fadeOut: 1, delay: 0, followTime: null, values: [{ fixtureId: 'p', channelName: 'Dimmer', value: 10 }] },
        { id: 'b', name: 'B', number: 2, fadeIn: 1, fadeOut: 1, delay: 2, followTime: null, values: [] }
      ] }]
    }).show, BUILTIN_FIXTURES)
    expect(xml).toContain(`Hold="${QLC_INFINITE}"`)
    expect(xml).toContain('<Model>Generic</Model>\n   <Mode>1 Channel</Mode>')
  })
})
