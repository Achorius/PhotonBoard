// ============================================================
// PhotonBoard — demo content bundled with the app (resources/demos)
//
//   npm run demos:build        (vite-node scripts/build-demos.ts)
//
// Writes:
//   resources/demos/*.pbshow          three fictitious shows (File › Open a demo…)
//   resources/demos/formats/*         one example file per import format,
//                                     made by OUR exporters from "Club Night"
//                                     (MVR, QLC+, USITT ASCII, CSV, GDTF) +
//                                     hand-made grandMA3 / grandMA2 XML samples
//                                     (scripts/demo-sources) + README.txt
//   resources/demos/demos.json        manifest read by the app (src/main/demos.ts)
//
// Every show uses built-in fixture types only (src/main/fixture-library.ts),
// so it opens on any machine without installing anything. The shows go
// through normalizeShow(): a warning stops the build. The outputs are
// committed; src/main/demos.test.ts re-imports every file.
// ============================================================

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type {
  Chase, Cue, CueChannelValue, CueFeature, CuePart, Cuelist, Effect, EffectChannel, ExecutorButtonFn, ExecutorCell, ExecutorColumnFader,
  ExecutorPage, ExecutorSceneMode, FixtureDefinition, Group, Macro, MountingLocation, PatchEntry, Preset, PresetType, RoomConfig,
  ShowFile, ShowTimeline, SpeedMaster, StagePage, StageWidget, StageWidgetKind
} from '../src/shared/types'
import { BUILTIN_FIXTURES } from '../src/main/fixture-library'
import { normalizeShow, SHOW_FORMAT_VERSION } from '../src/shared/show-format'
import '../src/main/interchange/formats'
import { getExporter } from '../src/main/interchange/registry'
import { writeMvr } from '../src/main/interchange/mvr'
import { writeGdtf } from '../src/main/interchange/gdtf'
import { APP_VERSION } from '../src/main/interchange/gdtf/app-info'
import type { DemoManifest } from '../src/shared/demos'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'demos')
const FORMATS = join(OUT, 'formats')
const SOURCES = join(ROOT, 'scripts', 'demo-sources')
/** Fixed dates: re-running the script gives the same shows */
const DATE = '2026-10-01T20:00:00.000Z'
const NOW = new Date(DATE)

const DEFS = new Map<string, FixtureDefinition>(BUILTIN_FIXTURES.map((f) => [f.id, f]))

// ---------------------------------------------------------------- show builder

interface Place { x: number; y: number; z: number; m?: MountingLocation; angle?: number }

class ShowBuilder {
  private seq = 0
  patch: PatchEntry[] = []
  groups: Group[] = []
  presets: Preset[] = []
  cuelists: Cuelist[] = []
  chases: Chase[] = []
  effects: Effect[] = []
  macros: Macro[] = []
  speedMasters: SpeedMaster[] = []
  stagePages: StagePage[] = []
  pages: ExecutorPage[] = []
  private presetNumbers = new Map<PresetType, number>()

  constructor(private prefix: string) {}

  id(kind: string): string {
    return `${this.prefix}-${kind}-${String(++this.seq).padStart(3, '0')}`
  }

  /** Channel names of a patched fixture (its mode) */
  channels(fixtureId: string): string[] {
    const p = this.patch.find((e) => e.id === fixtureId)
    if (!p) throw new Error(`${this.prefix}: unknown fixture ${fixtureId}`)
    const def = DEFS.get(p.fixtureDefId)!
    return def.modes.find((m) => m.name === p.modeName)!.channels
  }

  addFixtures(o: {
    def: string; mode: string; count: number; name: string | ((i: number) => string); universe: number; start: number
    fid: number; place: (i: number, n: number) => Place
  }): string[] {
    const def = DEFS.get(o.def)
    if (!def) throw new Error(`Not a built-in fixture type: ${o.def}`)
    const mode = def.modes.find((m) => m.name === o.mode)
    if (!mode) throw new Error(`${o.def} has no mode "${o.mode}"`)
    const ids: string[] = []
    for (let i = 0; i < o.count; i++) {
      const pos = o.place(i, o.count)
      const address = o.start + i * mode.channels.length
      if (address + mode.channels.length - 1 > 512) throw new Error(`${o.def} ${i + 1}: address ${address} overflows the universe`)
      const id = this.id('fx')
      this.patch.push({
        id,
        fixtureDefId: o.def,
        modeName: o.mode,
        universe: o.universe,
        address,
        name: typeof o.name === 'function' ? o.name(i) : o.count > 1 ? `${o.name} ${i + 1}` : o.name,
        groupIds: [],
        fid: o.fid + i,
        position3D: { x: pos.x, y: pos.y, z: pos.z },
        mountingLocation: pos.m ?? 'ceiling',
        ...(pos.angle !== undefined ? { mountingAngle: pos.angle } : {}),
        stagePosition: { x: Math.round(600 + pos.x * 52), y: Math.round(300 + pos.z * 34), rotation: 0 }
      })
      ids.push(id)
    }
    return ids
  }

  group(name: string, color: string, fixtureIds: string[]): Group {
    const g: Group = { id: this.id('grp'), name, color, fixtureIds: [...fixtureIds], number: this.groups.length + 1 }
    this.groups.push(g)
    for (const p of this.patch) if (fixtureIds.includes(p.id)) p.groupIds.push(g.id)
    return g
  }

  /** Cue values: every fixture × every channel, checked against the fixture's mode */
  v(ids: string[], values: Record<string, number> | ((fixtureId: string, i: number) => Record<string, number>)): CueChannelValue[] {
    return ids.flatMap((fixtureId, i) => {
      const vals = typeof values === 'function' ? values(fixtureId, i) : values
      const chans = this.channels(fixtureId)
      return Object.entries(vals).map(([channelName, value]) => {
        if (!chans.includes(channelName)) throw new Error(`${this.prefix}: ${fixtureId} has no channel "${channelName}"`)
        return { fixtureId, channelName, value: Math.round(Math.max(0, Math.min(255, value))) }
      })
    })
  }

  preset(type: PresetType, name: string, values: CueChannelValue[], color?: string): Preset {
    const number = (this.presetNumbers.get(type) ?? 0) + 1
    this.presetNumbers.set(type, number)
    const byFixture: Record<string, Record<string, number>> = {}
    for (const cv of values) (byFixture[cv.fixtureId] ??= {})[cv.channelName] = cv.value
    const p: Preset = { id: this.id('pre'), name, type, number, scope: 'selective', values: byFixture, ...(color ? { color } : {}) }
    this.presets.push(p)
    return p
  }

  /** Cue values taken from a preset (they follow the preset when it is updated) */
  fromPreset(p: Preset, ids?: string[]): CueChannelValue[] {
    const out: CueChannelValue[] = []
    for (const [fixtureId, chans] of Object.entries(p.values)) {
      if (ids && !ids.includes(fixtureId)) continue
      for (const [channelName, value] of Object.entries(chans)) out.push({ fixtureId, channelName, value, presetId: p.id })
    }
    return out
  }

  cue(name: string, values: CueChannelValue[], o: {
    fadeIn?: number; fadeOut?: number; delay?: number; follow?: number | null; color?: string
    featureTiming?: Partial<Record<CueFeature, { fade?: number; delay?: number }>>; parts?: CuePart[]; number?: number
  } = {}): Cue {
    return {
      id: this.id('cue'), name, number: o.number ?? 0, values,
      fadeIn: o.fadeIn ?? 2, fadeOut: o.fadeOut ?? 2, delay: o.delay ?? 0, followTime: o.follow ?? null,
      ...(o.color ? { color: o.color } : {}),
      ...(o.featureTiming ? { featureTiming: o.featureTiming } : {}),
      ...(o.parts ? { parts: o.parts } : {})
    }
  }

  cuelist(name: string, cues: Cue[], o: { loop?: boolean; priority?: number; effects?: Effect[]; tracking?: boolean } = {}): Cuelist {
    const cl: Cuelist = {
      id: this.id('seq'), name, number: this.cuelists.length + 1,
      cues: cues.map((c, i) => ({ ...c, number: c.number || i + 1 })),
      currentCueIndex: -1, isPlaying: false, isLooping: o.loop ?? false, priority: o.priority ?? 50, faderLevel: 255, flash: false,
      ...(o.tracking === false ? { tracking: false } : {}),
      ...(o.effects ? { effectSnapshots: o.effects } : {})
    }
    this.cuelists.push(cl)
    return cl
  }

  chase(name: string, steps: CueChannelValue[][], o: { bpm?: number; fade?: number; direction?: Chase['direction']; priority?: number; speed?: SpeedMaster } = {}): Chase {
    const c: Chase = {
      id: this.id('chase'), name, number: this.chases.length + 1,
      steps: steps.map((values) => ({ id: this.id('step'), values })),
      currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: o.bpm ?? 120, fadePercent: o.fade ?? 0,
      direction: o.direction ?? 'forward', faderLevel: 255, priority: o.priority ?? 50,
      ...(o.speed ? { speedMasterId: o.speed.id } : {})
    }
    this.chases.push(c)
    return c
  }

  effect(name: string, o: {
    fixtureIds: string[]; channelType: string; waveform?: Effect['waveform']; speed?: number; depth?: number; fan?: number
    channels?: EffectChannel[]; speedMaster?: SpeedMaster; multiplier?: number; spatial?: boolean
  }): Effect {
    for (const fid of o.fixtureIds) {
      const chans = this.channels(fid)
      for (const ct of o.channels?.map((c) => c.channelType) ?? [o.channelType]) {
        if (!chans.includes(ct)) throw new Error(`${this.prefix}: effect "${name}": ${fid} has no "${ct}"`)
      }
    }
    const e: Effect = {
      id: this.id('eff'), name, number: this.effects.length + 1,
      waveform: o.waveform ?? 'sine', speed: o.speed ?? 0.5, depth: o.depth ?? 200, offset: 0, channelType: o.channelType,
      fixtureIds: [...o.fixtureIds], fan: o.fan ?? 360, isRunning: false,
      ...(o.channels ? { channels: o.channels } : {}),
      ...(o.speedMaster ? { speedMasterId: o.speedMaster.id, speedMultiplier: o.multiplier ?? 1 } : {}),
      ...(o.spatial ? { spatialMode: 'spatial' as const, spatialAxis: 'x' as const } : {})
    }
    this.effects.push(e)
    return e
  }

  macro(name: string, lines: (string | { command: string; wait: number })[], color?: string): Macro {
    const m: Macro = {
      id: this.id('mac'), number: this.macros.length + 1, name,
      lines: lines.map((l) => (typeof l === 'string' ? { command: l } : l)),
      ...(color ? { color } : {})
    }
    this.macros.push(m)
    return m
  }

  speed(name: string, bpm: number): SpeedMaster {
    const s: SpeedMaster = { id: this.id('spd'), number: this.speedMasters.length + 1, name, bpm }
    this.speedMasters.push(s)
    return s
  }

  /** An executor page from columns of cells (top → bottom, max 4) */
  page(name: string, columns: { title: string; color: string; fader?: ExecutorColumnFader; cells: (Cell | null)[] }[]): ExecutorPage {
    if (columns.length > 8) throw new Error(`${this.prefix}: page "${name}" has more than 8 columns`)
    const cells: (ExecutorCell | null)[][] = Array.from({ length: 8 }, (_, col) =>
      Array.from({ length: 4 }, (_, row) => columns[col]?.cells[row] ?? null))
    const page: ExecutorPage = {
      id: `${this.prefix}-page-${this.pages.length + 1}`, name,
      cells,
      columns: Array.from({ length: 8 }, (_, col) => {
        const c = columns[col]
        return c ? { title: c.title, color: c.color, ...(c.fader ? { fader: c.fader } : {}) } : { title: '', color: '#6366f1' }
      })
    }
    this.pages.push(page)
    return page
  }

  stagePage(name: string, cols: number, rows: number, widgets: Omit<StageWidget, 'id'>[]): StagePage {
    const p: StagePage = { id: this.id('stage'), name, cols, rows, widgets: widgets.map((w) => ({ id: this.id('w'), ...w })) }
    this.stagePages.push(p)
    return p
  }

  build(name: string, extra: { roomConfig: RoomConfig; timeline?: ShowTimeline; groupMasters?: Record<string, number> }): ShowFile {
    const executorPages = this.pages
    return {
      version: String(SHOW_FORMAT_VERSION),
      name,
      createdAt: DATE,
      modifiedAt: DATE,
      patch: this.patch,
      groups: this.groups,
      presets: this.presets,
      cuelists: this.cuelists,
      chases: this.chases,
      effects: this.effects,
      midiMappings: [],
      stageLayout: {
        width: 1200,
        height: 600,
        fixtures: this.patch.map((p) => ({ patchId: p.id, x: p.stagePosition!.x, y: p.stagePosition!.y, rotation: 0, scale: 1 }))
      },
      roomConfig: extra.roomConfig,
      ...(extra.timeline ? { timeline: extra.timeline } : {}),
      // grid / columns / modes (the v2 mirror of page 1) are rebuilt by normalizeShow
      executor: { grid: [], columns: [], modes: [], pages: executorPages },
      macros: this.macros,
      speedMasters: this.speedMasters,
      stagePages: this.stagePages,
      ...(extra.groupMasters ? { groupMasters: extra.groupMasters } : {})
    }
  }
}

type Cell = ExecutorCell

const cell = (kind: ExecutorCell['kind'], obj: { id: string }, mode: ExecutorSceneMode = 'toggle', button?: ExecutorButtonFn): Cell =>
  ({ kind, id: obj.id, mode, ...(button ? { button } : {}) })
const seqCell = (cl: Cuelist, mode: ExecutorSceneMode = 'toggle', button?: ExecutorButtonFn) => cell('cuelist', cl, mode, button)
const goCell = (cl: Cuelist) => cell('cuelist', cl, 'toggle', 'go')

const spread = (i: number, n: number, width: number) => (n === 1 ? 0 : -width / 2 + (width * i) / (n - 1))
const w = (kind: StageWidgetKind, x: number, y: number, ww: number, h: number, extra: Partial<StageWidget> = {}): Omit<StageWidget, 'id'> =>
  ({ kind, x, y, w: ww, h, ...extra })

/** Named colours → RGB */
const COLORS = {
  Red: [255, 0, 0], Orange: [255, 90, 0], Yellow: [255, 200, 0], Green: [0, 255, 40], Cyan: [0, 230, 255],
  Blue: [0, 40, 255], 'Deep Blue': [20, 0, 255], Lavender: [150, 90, 255], Magenta: [255, 0, 200], White: [255, 255, 255]
} as const
type ColorName = keyof typeof COLORS
const SWATCH: Record<ColorName, string> = {
  Red: '#ef4444', Orange: '#f97316', Yellow: '#eab308', Green: '#22c55e', Cyan: '#06b6d4', Blue: '#3b82f6', 'Deep Blue': '#4f46e5',
  Lavender: '#a78bfa', Magenta: '#d946ef', White: '#e5e7eb'
}

/** Pan / tilt (8-bit) → values */
const pt = (pan: number, tilt: number) => ({ Pan: pan, Tilt: tilt })
/** Wheel slot n (0 = open) on the built-in gobo wheels (8 values per slot) */
const slot = (n: number) => n * 8 + 4
const SHUTTER_OPEN = 22

// ================================================================ Club Night

function clubNight(): ShowFile {
  const b = new ShowBuilder('club')
  const spots = b.addFixtures({ def: 'generic/moving-head-spot', mode: '13ch', count: 4, name: 'Spot', universe: 0, start: 1, fid: 101, place: (i, n) => ({ x: spread(i, n, 9), y: 5.9, z: 0 }) })
  const washes = b.addFixtures({ def: 'generic/moving-head-wash', mode: '11ch', count: 4, name: 'Wash', universe: 0, start: 61, fid: 201, place: (i, n) => ({ x: spread(i, n, 11), y: 5.9, z: 3 }) })
  const pars = b.addFixtures({ def: 'eurolite/led-par-64-rgba', mode: '8ch', count: 8, name: 'Par', universe: 0, start: 121, fid: 301, place: (i, n) => ({ x: spread(i, n, 13), y: 5.9, z: -3, angle: 30 }) })
  const bars = b.addFixtures({ def: 'generic/led-bar-rgb-8', mode: '26ch', count: 2, name: 'Bar', universe: 0, start: 201, fid: 401, place: (i) => ({ x: i === 0 ? -5 : 5, y: 0.1, z: 4, m: 'floor' }) })
  const strobes = b.addFixtures({ def: 'generic/strobe', mode: '2ch', count: 2, name: 'Strobe', universe: 0, start: 261, fid: 501, place: (i) => ({ x: i === 0 ? -3 : 3, y: 5.9, z: 3 }) })
  const hazer = b.addFixtures({ def: 'generic/hazer', mode: '2ch', count: 1, name: 'Hazer', universe: 0, start: 271, fid: 601, place: () => ({ x: 6, y: 0.1, z: 4.5, m: 'floor' }) })

  // Groups 1-8 = the "groups" row of an APC mini in the busk layout
  const gPars = b.group('Pars', '#ff7a1a', pars)
  const gOdd = b.group('Pars odd', '#fb923c', pars.filter((_, i) => i % 2 === 0))
  const gEven = b.group('Pars even', '#fdba74', pars.filter((_, i) => i % 2 === 1))
  const gSpots = b.group('Spots', '#3b82f6', spots)
  const gWashes = b.group('Washes', '#a855f7', washes)
  const gBars = b.group('Bars', '#14b8a6', bars)
  const gStrobes = b.group('Strobes', '#ec4899', strobes)
  b.group('Movers', '#6366f1', [...spots, ...washes])
  b.group('Atmos', '#94a3b8', hazer)

  const movers = [...spots, ...washes]
  const parRgb = ([r, g, bl]: readonly number[], amber = 0) => ({ Red: r, Green: g, Blue: bl, Amber: amber })
  const washRgb = ([r, g, bl]: readonly number[], white = 0) => ({ Red: r, Green: g, Blue: bl, White: white })
  const barRgb = (rgb: readonly number[]) => Object.fromEntries(Array.from({ length: 8 }, (_, c) => [[`Red ${c + 1}`, rgb[0]], [`Green ${c + 1}`, rgb[1]], [`Blue ${c + 1}`, rgb[2]]]).flat()) as Record<string, number>

  // Colour presets 1-8 (pars, washes, bars) — the "colour" row of the busk layout
  const colorNames: ColorName[] = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White']
  const colors = Object.fromEntries(colorNames.map((name) => {
    const rgb = COLORS[name]
    const white = name === 'White' ? 255 : 0
    const amber = name === 'Orange' || name === 'Yellow' ? 255 : 0
    return [name, b.preset('color', name, [...b.v(pars, parRgb(rgb, amber)), ...b.v(washes, washRgb(rgb, white)), ...b.v(bars, barRgb(rgb))], SWATCH[name])]
  })) as Record<ColorName, Preset>

  // Position presets 1-8 (spots + washes)
  const positions = [
    b.preset('position', 'Center', b.v(movers, pt(128, 128))),
    b.preset('position', 'Audience', b.v(movers, pt(128, 60))),
    b.preset('position', 'Floor', b.v(movers, pt(128, 200))),
    b.preset('position', 'Cross', b.v(movers, (_, i) => pt(i % 2 === 0 ? 100 : 156, 110))),
    b.preset('position', 'Fan out', b.v(movers, (_, i) => pt(80 + (i % 4) * 32, 100))),
    b.preset('position', 'Sky', b.v(movers, pt(128, 20))),
    b.preset('position', 'Left', b.v(movers, pt(70, 110))),
    b.preset('position', 'Right', b.v(movers, pt(186, 110)))
  ]
  const goboOpen = b.preset('gobo', 'Open', b.v(spots, { Gobo: slot(0) }))
  const goboDots = b.preset('gobo', 'Dots', b.v(spots, { Gobo: slot(2) }))
  b.preset('gobo', 'Breakup', b.v(spots, { Gobo: slot(5) }))

  const bpm = b.speed('BPM', 128)

  // Effects
  const fxParWave = b.effect('Par Dimmer Wave', { fixtureIds: pars, channelType: 'Dimmer', speed: 0.5, depth: 200, fan: 360, speedMaster: bpm, multiplier: 0.25 })
  const fxCircle = b.effect('Spot Circle', { fixtureIds: spots, channelType: 'Pan', speed: 0.25, depth: 70, fan: 90,
    channels: [{ channelType: 'Pan', phaseOffset: 0, depth: 70 }, { channelType: 'Tilt', phaseOffset: 90, depth: 50 }] })
  const fxNod = b.effect('Wash Tilt Nod', { fixtureIds: washes, channelType: 'Tilt', waveform: 'triangle', speed: 0.4, depth: 60, fan: 180 })
  const fxStrobe = b.effect('Strobe Random', { fixtureIds: strobes, channelType: 'Dimmer', waveform: 'random', speed: 4, depth: 255, fan: 180 })

  // Scenes
  const spotOpen = { Dimmer: 255, Shutter: SHUTTER_OPEN, Zoom: 90, Focus: 128 }
  const washOpen = { Dimmer: 255, Shutter: SHUTTER_OPEN }
  const warm = b.cuelist('Warm Wash', [b.cue('Amber', [...b.v(pars, { Dimmer: 230 }), ...b.fromPreset(colors.Orange, pars)], { fadeIn: 3 })])
  const cool = b.cuelist('Cool Blue', [b.cue('Blue', [...b.v(pars, { Dimmer: 220 }), ...b.fromPreset(colors.Blue, [...pars, ...washes]),
    ...b.v(washes, washOpen), ...b.fromPreset(positions[0], washes)], { fadeIn: 4 })])
  const red = b.cuelist('Red Alert', [b.cue('Red', [...b.v(pars, { Dimmer: 255 }), ...b.v(washes, washOpen), ...b.fromPreset(colors.Red, [...pars, ...washes])], { fadeIn: 1 })])
  const beams = b.cuelist('Spot Beams', [
    b.cue('Fan out', [...b.v(spots, spotOpen), ...b.fromPreset(goboDots), ...b.fromPreset(positions[4], spots)], { fadeIn: 2.5 }),
    b.cue('Cross', [...b.v(spots, { ...spotOpen, Prism: 140 }), ...b.fromPreset(goboOpen), ...b.fromPreset(positions[3], spots)], { fadeIn: 3 })
  ], { effects: [fxCircle] })
  const washUp = b.cuelist('Washes Up', [b.cue('White center', [...b.v(washes, washOpen), ...b.fromPreset(colors.White, washes), ...b.fromPreset(positions[0], washes)], { fadeIn: 2 })])
  const rainbow = b.cuelist('Bars Rainbow', [b.cue('Rainbow', b.v(bars, () => {
    const vals: Record<string, number> = { 'Master Dimmer': 255 }
    for (let c = 0; c < 8; c++) {
      const h = c / 8
      const f = (n: number) => Math.round(255 * Math.max(0, Math.min(1, Math.abs(((h * 6 + n) % 6) - 3) - 1)))
      vals[`Red ${c + 1}`] = f(0); vals[`Green ${c + 1}`] = f(4); vals[`Blue ${c + 1}`] = f(2)
    }
    return vals
  }), { fadeIn: 1 })])
  const hits = b.cuelist('Strobe Hits', [b.cue('Hit', b.v(strobes, { Dimmer: 255, Strobe: 200 }), { fadeIn: 0, fadeOut: 0 })], { priority: 90 })
  const blinder = b.cuelist('Pars Blinder', [b.cue('All white', [...b.v(pars, { Red: 255, Green: 255, Blue: 255, Amber: 255, Dimmer: 255 }), ...b.v(bars, { 'Master Dimmer': 255, ...barRgb(COLORS.White) })], { fadeIn: 0, fadeOut: 0.3 })], { priority: 80 })
  const haze = b.cuelist('Haze 40%', [b.cue('Haze', b.v(hazer, { 'Haze Output': 100, 'Fan Speed': 140 }), { fadeIn: 5 })])
  const intro = b.cuelist('Club Intro', [
    b.cue('Haze & dark', b.v(hazer, { 'Haze Output': 120, 'Fan Speed': 160 }), { fadeIn: 1, follow: 4 }),
    b.cue('Back light', [...b.v(washes, { ...washOpen, Dimmer: 160 }), ...b.fromPreset(colors.Magenta, washes), ...b.fromPreset(positions[5], washes)], { fadeIn: 6, follow: 8 }),
    b.cue('Reveal', [...b.v(washes, washOpen), ...b.fromPreset(colors.Magenta, washes), ...b.v(pars, { Dimmer: 200 }), ...b.fromPreset(colors.Blue, pars)], { fadeIn: 5 })
  ])
  const drop = b.cuelist('Drop', [b.cue('Everything', [...b.v(washes, washOpen), ...b.fromPreset(colors.White, [...washes, ...pars]), ...b.v(spots, spotOpen),
    ...b.v(pars, { Dimmer: 255 }), ...b.fromPreset(positions[1], movers)], { fadeIn: 0, fadeOut: 0.5 })], { priority: 85 })
  const ballad = b.cuelist('Ballad', [
    b.cue('Single spot', [...b.v([spots[1]], { ...spotOpen, Zoom: 30 }), ...b.fromPreset(positions[0], [spots[1]])], { fadeIn: 4 }),
    b.cue('Add wash', [...b.v(washes, { ...washOpen, Dimmer: 120 }), ...b.fromPreset(colors.Blue, washes)], { fadeIn: 6 }),
    b.cue('Warm up', [...b.v(washes, { ...washOpen, Dimmer: 180 }), ...b.fromPreset(colors.Orange, [...washes, ...pars]), ...b.v(pars, { Dimmer: 120 })], { fadeIn: 8 }),
    b.cue('Fade', b.v([...washes, ...pars, ...spots], { Dimmer: 0 }), { fadeIn: 10 })
  ])

  // Chases
  const parChase = b.chase('Par Chase', pars.map((p) => b.v([p], { Red: 255, Green: 40, Dimmer: 255 })), { bpm: 128, fade: 30, direction: 'bounce', priority: 40, speed: bpm })
  const colorChase = b.chase('Color Chase', (['Red', 'Magenta', 'Blue', 'Cyan'] as ColorName[]).map((c) => [...b.v(pars, { Dimmer: 255 }), ...b.v(pars, parRgb(COLORS[c]))]), { bpm: 64, fade: 60, speed: bpm })
  const barSweep = b.chase('Bars Sweep', Array.from({ length: 8 }, (_, c) => b.v(bars, { 'Master Dimmer': 255, [`Red ${c + 1}`]: 255, [`Green ${c + 1}`]: 255, [`Blue ${c + 1}`]: 255 })), { bpm: 240, fade: 20 })
  const strobeAlt = b.chase('Strobe Alternate', strobes.map((s) => b.v([s], { Dimmer: 255 })), { bpm: 240 })

  // Macros 1-8 (the last row of the busk layout)
  b.macro('Intro', ['Go Sequence 9', 'Go Sequence 10'], '#22c55e')
  b.macro('Party', ['Go Sequence 1', 'Go Chase 2', 'Go Effect 1'], '#f97316')
  b.macro('Movers show', ['Go Sequence 4', 'Go Effect 2', 'Go Effect 3'], '#3b82f6')
  b.macro('FX off', ['Off Effect 1', 'Off Effect 2', 'Off Effect 3', 'Off Effect 4'], '#64748b')
  b.macro('Release all', ['Release'], '#64748b')
  b.macro('Blackout on', ['Blackout On'], '#ef4444')
  b.macro('Blackout off', ['Blackout Off'], '#22c55e')
  b.macro('Page 2', ['Page 2'], '#6366f1')

  // Executors: page 1 = pad rows 1-4, page 2 = rows 5-8 of an APC mini ("2 pages" layout); faders 1-8 = column faders
  b.page('Club', [
    { title: 'Pars', color: '#ff7a1a', cells: [seqCell(warm), seqCell(cool), seqCell(red), cell('chase', parChase)] },
    { title: 'Washes', color: '#a855f7', cells: [seqCell(washUp), cell('effect', fxNod)] },
    { title: 'Spots', color: '#3b82f6', cells: [seqCell(beams), cell('effect', fxCircle)] },
    { title: 'Bars', color: '#14b8a6', cells: [seqCell(rainbow), cell('chase', barSweep)] },
    { title: 'Show', color: '#22c55e', cells: [goCell(intro), goCell(ballad), seqCell(drop, 'flash')] },
    { title: 'FX', color: '#eab308', cells: [cell('chase', colorChase), cell('effect', fxParWave)] },
    { title: 'Strobe', color: '#ec4899', cells: [seqCell(hits, 'trigger'), cell('chase', strobeAlt), cell('effect', fxStrobe), seqCell(blinder, 'flash')] },
    { title: 'Atmos', color: '#94a3b8', fader: { kind: 'speed', id: bpm.id }, cells: [seqCell(haze), null, null, cell('speed', bpm)] }
  ])
  b.page('Busk', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    title: b.groups[i].name,
    color: b.groups[i].color,
    fader: { kind: 'group' as const, id: b.groups[i].id },
    cells: [cell('macro', b.macros[i], 'trigger'), cell('group', b.groups[i])]
  })))

  b.stagePage('Club', 8, 4, [
    w('go', 0, 0, 2, 2, { ref: intro.id, label: 'Club Intro' }),
    w('executor', 2, 0, 1, 1, { ref: '1.1.1' }), w('executor', 3, 0, 1, 1, { ref: '1.1.2' }), w('executor', 4, 0, 1, 1, { ref: '1.1.3' }),
    w('executor', 2, 1, 1, 1, { ref: '1.3.1' }), w('executor', 3, 1, 1, 1, { ref: '1.4.1' }), w('executor', 4, 1, 1, 1, { ref: '1.5.3' }),
    w('fader', 5, 0, 1, 4, { ref: gPars.id, options: { target: 'group' } }),
    w('fader', 6, 0, 1, 4, { ref: gWashes.id, options: { target: 'group' } }),
    w('master', 7, 0, 1, 4, { options: { fn: 'gm' } }),
    w('speed', 0, 2, 2, 1, { ref: bpm.id }),
    w('master', 2, 2, 1, 1, { options: { fn: 'blackout' } }), w('master', 3, 2, 1, 1, { options: { fn: 'strobe' } }), w('master', 4, 2, 1, 1, { options: { fn: 'release' } }),
    w('group', 0, 3, 1, 1, { ref: gSpots.id }), w('group', 1, 3, 1, 1, { ref: gBars.id }), w('group', 2, 3, 1, 1, { ref: gStrobes.id }),
    w('group', 3, 3, 1, 1, { ref: gOdd.id }), w('group', 4, 3, 1, 1, { ref: gEven.id })
  ])

  return b.build('Club Night', {
    roomConfig: {
      width: 16, depth: 12, height: 6, stageEdgeZ: -2,
      trussBars: [
        { id: 'club-truss-1', name: 'Truss 1', z: -3, y: 5.95, width: 14 },
        { id: 'club-truss-2', name: 'Truss 2', z: 0, y: 5.95, width: 14 },
        { id: 'club-truss-3', name: 'Truss 3', z: 3, y: 5.95, width: 14 }
      ]
    } as RoomConfig
  })
}

// ================================================================ Théâtre – soirée simple

function theatre(): ShowFile {
  const b = new ShowBuilder('theatre')
  // Conventional lights on a dimmer pack (1 channel each), LED cyclorama
  const faceNames = ['Face jardin 1', 'Face jardin 2', 'Face centre 1', 'Face centre 2', 'Face cour 1', 'Face cour 2']
  const face = b.addFixtures({ def: 'generic/dimmer', mode: '1ch', count: 6, name: (i) => faceNames[i], universe: 0, start: 1, fid: 1,
    place: (i, n) => ({ x: spread(i, n, 8), y: 6.8, z: -6, angle: 40 }) })
  const contres = b.addFixtures({ def: 'generic/dimmer', mode: '1ch', count: 4, name: 'PC contre', universe: 0, start: 7, fid: 7,
    place: (i, n) => ({ x: spread(i, n, 8), y: 6.8, z: 2.5, angle: 25 }) })
  const latNames = ['Latéral jardin 1', 'Latéral jardin 2', 'Latéral cour 1', 'Latéral cour 2']
  const lat = b.addFixtures({ def: 'generic/dimmer', mode: '1ch', count: 4, name: (i) => latNames[i], universe: 0, start: 11, fid: 11,
    place: (i) => ({ x: i < 2 ? -6.5 : 6.5, y: 2.2, z: -1 + (i % 2) * 2.5, m: 'floor', angle: 70 }) })
  const douche = b.addFixtures({ def: 'generic/dimmer', mode: '1ch', count: 1, name: 'Douche centre', universe: 0, start: 15, fid: 15,
    place: () => ({ x: 0, y: 6.8, z: 0 }) })
  const salle = b.addFixtures({ def: 'generic/dimmer', mode: '1ch', count: 2, name: 'Salle', universe: 0, start: 16, fid: 16,
    place: (i) => ({ x: i === 0 ? -4 : 4, y: 6.8, z: -9 }) })
  const cyclo = b.addFixtures({ def: 'generic/rgbw', mode: '4ch', count: 4, name: 'Cyclo', universe: 0, start: 21, fid: 21,
    place: (i, n) => ({ x: spread(i, n, 9), y: 0.1, z: 4.2, m: 'floor', angle: 20 }) })

  // Groups by stage area (jardin = stage left seen from the audience)
  const gFace = b.group('Face', '#eab308', face)
  const gContres = b.group('Contres', '#3b82f6', contres)
  const gLat = b.group('Latéraux', '#a855f7', lat)
  const gJardin = b.group('Jardin', '#22c55e', [face[0], face[1], contres[0], lat[0], lat[1]])
  b.group('Centre', '#f97316', [face[2], face[3], contres[1], contres[2], douche[0]])
  const gCour = b.group('Cour', '#06b6d4', [face[4], face[5], contres[3], lat[2], lat[3]])
  const gCyclo = b.group('Cyclo', '#6366f1', cyclo)
  const gSalle = b.group('Salle', '#94a3b8', salle)

  const D = (ids: string[], level: number) => b.v(ids, { Dimmer: level })
  const rgbw = ([r, g, bl]: readonly number[], white = 0) => ({ Red: r, Green: g, Blue: bl, White: white })
  const cycloDay = b.preset('color', 'Ciel de jour', b.v(cyclo, rgbw([90, 160, 255], 120)), '#60a5fa')
  const cycloEvening = b.preset('color', 'Coucher de soleil', b.v(cyclo, rgbw([255, 80, 10], 0)), '#f97316')
  const cycloNight = b.preset('color', 'Nuit', b.v(cyclo, rgbw([10, 0, 140], 0)), '#312e81')
  b.preset('color', 'Blanc', b.v(cyclo, rgbw([255, 255, 255], 255)), '#e5e7eb')
  b.preset('intensity', 'Face 70 %', D(face, 178))
  b.preset('intensity', 'Plein feu', D([...face, ...contres, ...lat, ...douche], 255))

  const scene = (ids: string[], level: number) => D(ids, level)
  const spectacle = b.cuelist('Spectacle', [
    b.cue('Entrée public', [...scene(salle, 255), ...scene(face, 50)], { fadeIn: 3, color: '#94a3b8' }),
    b.cue('Noir salle', [...scene(salle, 0), ...scene(face, 0)], { fadeIn: 5, fadeOut: 5 }),
    b.cue('Ouverture', [...scene(face, 180), ...scene(contres, 130), ...b.fromPreset(cycloDay)], { fadeIn: 3, delay: 1, color: '#22c55e' }),
    b.cue('Scène 1 – jour', [...scene(face, 200), ...scene(contres, 150), ...scene(lat, 120), ...b.fromPreset(cycloDay)], { fadeIn: 4 }),
    b.cue('Scène 2 – soir', [...scene(face, 140), ...scene(contres, 180), ...scene(lat, 160), ...b.fromPreset(cycloEvening)], { fadeIn: 8, fadeOut: 6, color: '#f97316' }),
    b.cue('Monologue', [...scene(douche, 255), ...scene(face, 40), ...scene(contres, 60), ...scene(lat, 0)], { fadeIn: 6 }),
    b.cue('Nuit', [...scene(face, 60), ...scene(contres, 80), ...scene(douche, 0), ...b.fromPreset(cycloNight)], { fadeIn: 7, color: '#4f46e5' }),
    b.cue('Final', [...scene(face, 255), ...scene(contres, 255), ...scene(lat, 200), ...b.fromPreset(cycloDay)], { fadeIn: 2 }),
    b.cue('Saluts', [...scene(face, 230), ...scene(contres, 200), ...scene(lat, 0)], { fadeIn: 1.5, follow: 8 }),
    b.cue('Noir final', [...scene([...face, ...contres, ...lat, ...douche], 0), ...b.v(cyclo, rgbw([0, 0, 0], 0))], { fadeIn: 3 }),
    b.cue('Salle', scene(salle, 255), { fadeIn: 5, color: '#94a3b8' })
  ])
  const service = b.cuelist('Service (plein feu)', [b.cue('Plein feu', [...scene([...face, ...contres, ...lat, ...douche], 255), ...b.v(cyclo, rgbw([255, 255, 255], 255))], { fadeIn: 2 })])
  const salleSeq = b.cuelist('Lumière salle', [b.cue('Salle', scene(salle, 255), { fadeIn: 3 })])
  const faceSeule = b.cuelist('Face seule', [b.cue('Face 70 %', scene(face, 178), { fadeIn: 2 })])

  b.macro('Début du spectacle', ['Go Sequence 1'], '#22c55e')
  b.macro('Tout éteindre', ['Release'], '#64748b')

  b.page('Conduite', [
    { title: 'Conduite', color: '#22c55e', cells: [goCell(spectacle)] },
    { title: 'Salle', color: '#94a3b8', cells: [seqCell(salleSeq)] },
    { title: 'Service', color: '#e5e7eb', cells: [seqCell(service), seqCell(faceSeule)] },
    { title: 'Face', color: gFace.color, fader: { kind: 'group', id: gFace.id }, cells: [cell('group', gFace)] },
    { title: 'Contres', color: gContres.color, fader: { kind: 'group', id: gContres.id }, cells: [cell('group', gContres)] },
    { title: 'Latéraux', color: gLat.color, fader: { kind: 'group', id: gLat.id }, cells: [cell('group', gLat)] },
    { title: 'Cyclo', color: gCyclo.color, fader: { kind: 'group', id: gCyclo.id }, cells: [cell('group', gCyclo)] },
    { title: 'Salle', color: gSalle.color, fader: { kind: 'group', id: gSalle.id }, cells: [cell('group', gSalle)] }
  ])

  b.stagePage('Régie', 6, 4, [
    w('go', 0, 0, 3, 2, { ref: spectacle.id, label: 'Spectacle' }),
    w('clock', 3, 0, 3, 1),
    w('master', 3, 1, 1, 1, { options: { fn: 'blackout' } }),
    w('executor', 4, 1, 1, 1, { ref: '1.2.1' }),
    w('executor', 5, 1, 1, 1, { ref: '1.3.1' }),
    w('fader', 0, 2, 1, 2, { ref: gFace.id, options: { target: 'group' } }),
    w('fader', 1, 2, 1, 2, { ref: gContres.id, options: { target: 'group' } }),
    w('fader', 2, 2, 1, 2, { ref: gLat.id, options: { target: 'group' } }),
    w('fader', 3, 2, 1, 2, { ref: gCyclo.id, options: { target: 'group' } }),
    w('fader', 4, 2, 1, 2, { ref: gSalle.id, options: { target: 'group' } }),
    w('master', 5, 2, 1, 2, { options: { fn: 'gm' } })
  ])
  void gJardin; void gCour

  return b.build('Théâtre – soirée simple', {
    roomConfig: {
      width: 14, depth: 14, height: 7, stageEdgeZ: -2,
      trussBars: [
        { id: 'theatre-face', name: 'Pont face', z: -6, y: 6.85, width: 10 },
        { id: 'theatre-perche-1', name: 'Perche 1', z: 0, y: 6.85, width: 10 },
        { id: 'theatre-perche-2', name: 'Perche 2', z: 2.5, y: 6.85, width: 10 }
      ]
    } as RoomConfig
  })
}

// ================================================================ Concert Pro

function concertPro(): ShowFile {
  const b = new ShowBuilder('concert')
  // Universe 1: movers · universe 2: LED, blinders, strobes, front, bars, haze
  const spots = b.addFixtures({ def: 'robe/robin-600e-spot', mode: '21ch', count: 8, name: 'Spot', universe: 0, start: 1, fid: 101, place: (i, n) => ({ x: spread(i, n, 14), y: 7.4, z: 0 }) })
  const washes = b.addFixtures({ def: 'martin/mac-aura-xb', mode: '14ch', count: 8, name: 'Aura', universe: 0, start: 201, fid: 201, place: (i, n) => ({ x: spread(i, n, 14), y: 7.4, z: 3.5 }) })
  const beams = b.addFixtures({ def: 'clay-paky/sharpy', mode: '16ch', count: 6, name: 'Sharpy', universe: 0, start: 321, fid: 301, place: (i, n) => ({ x: spread(i, n, 12), y: 0.2, z: 5, m: 'floor' }) })
  const pars = b.addFixtures({ def: 'chauvet-dj/slimpar-pro-h', mode: '12ch', count: 12, name: 'LED Par', universe: 1, start: 1, fid: 401, place: (i, n) => ({ x: spread(i, n, 15), y: 7.4, z: -2, angle: 30 }) })
  const blinders = b.addFixtures({ def: 'generic/blinder-2', mode: '2ch', count: 4, name: 'Blinder', universe: 1, start: 161, fid: 501, place: (i, n) => ({ x: spread(i, n, 12), y: 7.4, z: -2.2, angle: 60 }) })
  const strobes = b.addFixtures({ def: 'generic/strobe', mode: '2ch', count: 4, name: 'Strobe', universe: 1, start: 181, fid: 601, place: (i, n) => ({ x: spread(i, n, 12), y: 7.4, z: 0.3 }) })
  const front = b.addFixtures({ def: 'etc/source-four-led-s2-lustr', mode: '5ch', count: 6, name: 'Front', universe: 1, start: 201, fid: 701, place: (i, n) => ({ x: spread(i, n, 10), y: 7.4, z: -7, angle: 45 }) })
  const bars = b.addFixtures({ def: 'generic/led-bar-rgb-8', mode: '26ch', count: 4, name: 'Bar', universe: 1, start: 241, fid: 801, place: (i, n) => ({ x: spread(i, n, 12), y: 0.1, z: -1, m: 'floor' }) })
  const hazers = b.addFixtures({ def: 'generic/hazer', mode: '2ch', count: 2, name: 'Hazer', universe: 1, start: 361, fid: 901, place: (i) => ({ x: i === 0 ? -8 : 8, y: 0.1, z: 5.5, m: 'floor' }) })

  const gSpots = b.group('Spots', '#3b82f6', spots)
  b.group('Spots L', '#60a5fa', spots.slice(0, 4))
  b.group('Spots R', '#93c5fd', spots.slice(4))
  const gWashes = b.group('Auras', '#a855f7', washes)
  const gBeams = b.group('Sharpys', '#06b6d4', beams)
  const gPars = b.group('LED Pars', '#ff7a1a', pars)
  b.group('Pars odd', '#fb923c', pars.filter((_, i) => i % 2 === 0))
  b.group('Pars even', '#fdba74', pars.filter((_, i) => i % 2 === 1))
  const gBlinders = b.group('Blinders', '#eab308', blinders)
  const gStrobes = b.group('Strobes', '#ec4899', strobes)
  const gFront = b.group('Front', '#fde68a', front)
  const gBars = b.group('Bars', '#14b8a6', bars)
  b.group('Atmos', '#94a3b8', hazers)

  const movers = [...spots, ...washes, ...beams]
  const cmy = ([r, g, bl]: readonly number[]) => ({ Cyan: 255 - r, Magenta: 255 - g, Yellow: 255 - bl })
  const auraRgb = ([r, g, bl]: readonly number[], white = 0) => ({ Red: r, Green: g, Blue: bl, White: white })
  const parRgb = ([r, g, bl]: readonly number[], name: ColorName) => ({
    Red: r, Green: g, Blue: bl, Amber: name === 'Orange' || name === 'Yellow' ? 255 : 0, White: name === 'White' ? 255 : 0, UV: name === 'Deep Blue' || name === 'Lavender' ? 255 : 0
  })
  const frontRgb = ([r, g, bl]: readonly number[]) => ({ Red: r, Green: g, Blue: bl })
  const barRgb = (rgb: readonly number[]) => Object.fromEntries(Array.from({ length: 8 }, (_, c) => [[`Red ${c + 1}`, rgb[0]], [`Green ${c + 1}`, rgb[1]], [`Blue ${c + 1}`, rgb[2]]]).flat()) as Record<string, number>
  const SHARPY_WHEEL: Partial<Record<ColorName, number>> = { Red: slot(1), Orange: slot(2), Yellow: slot(3), Green: slot(4), Cyan: slot(5), Blue: slot(6), Magenta: slot(7), White: slot(0) }

  // Colour pool 1-10
  const colorNames: ColorName[] = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Deep Blue', 'Lavender', 'Magenta', 'White']
  const colors = Object.fromEntries(colorNames.map((name) => {
    const rgb = COLORS[name]
    const values = [
      ...b.v(spots, cmy(rgb)), ...b.v(washes, auraRgb(rgb, name === 'White' ? 255 : 0)), ...b.v(pars, parRgb(rgb, name)), ...b.v(bars, barRgb(rgb)),
      ...(SHARPY_WHEEL[name] !== undefined ? b.v(beams, { 'Color Wheel': SHARPY_WHEEL[name]! }) : [])
    ]
    return [name, b.preset('color', name, values, SWATCH[name])]
  })) as Record<ColorName, Preset>
  // Position pool 1-8
  const pos = {
    center: b.preset('position', 'Center', b.v(movers, pt(128, 128))),
    audience: b.preset('position', 'Audience', b.v(movers, pt(128, 60))),
    floor: b.preset('position', 'Floor', b.v(movers, pt(128, 200))),
    cross: b.preset('position', 'Cross', b.v(movers, (_, i) => pt(i % 2 === 0 ? 96 : 160, 110))),
    fan: b.preset('position', 'Fan', b.v(movers, (_, i) => pt(64 + (i % 8) * 18, 96))),
    sky: b.preset('position', 'Sky', b.v(movers, pt(128, 16))),
    drums: b.preset('position', 'Drums', b.v(movers, pt(128, 150))),
    vocal: b.preset('position', 'Lead vocal', b.v(movers, (_, i) => pt(118 + (i % 2) * 20, 140)))
  }
  // Gobo pool 1-6, beam pool 1-4, intensity pool 1-3
  const goboNames = ['Open', 'Dots', 'Breakup', 'Lines', 'Star', 'Ring']
  const gobos = goboNames.map((name, n) => b.preset('gobo', name, b.v([...spots, ...beams], { Gobo: slot(n) })))
  const prism = b.preset('beam', 'Prism', b.v([...spots, ...beams], { Prism: 140 }))
  b.preset('beam', 'Frost', b.v([...spots, ...beams], { Frost: 200 }))
  const tight = b.preset('beam', 'Tight', [...b.v(spots, { Zoom: 0, Iris: 120 }), ...b.v(washes, { Zoom: 0 })])
  const wide = b.preset('beam', 'Wide', [...b.v(spots, { Zoom: 255, Iris: 0 }), ...b.v(washes, { Zoom: 255 })])
  b.preset('intensity', 'Full', b.v([...spots, ...washes, ...beams, ...pars, ...front], { Dimmer: 255 }))
  b.preset('intensity', 'Half', b.v([...spots, ...washes, ...beams, ...pars, ...front], { Dimmer: 128 }))

  const song = b.speed('Song BPM', 124)
  const slow = b.speed('Slow FX', 30)

  // Effects
  const fxParWave = b.effect('Pars Dim Wave', { fixtureIds: pars, channelType: 'Dimmer', speed: 0.5, depth: 200, fan: 360, speedMaster: song, multiplier: 0.25, spatial: true })
  const fxColourWave = b.effect('Pars Colour Wave', { fixtureIds: pars, channelType: 'Red', speed: 0.3, depth: 255, fan: 360,
    channels: [{ channelType: 'Red', phaseOffset: 0, depth: 255 }, { channelType: 'Blue', phaseOffset: 180, depth: 255 }], speedMaster: slow, multiplier: 1 })
  const fxCircle = b.effect('Spot Circle', { fixtureIds: spots, channelType: 'Pan', speed: 0.2, depth: 60, fan: 180,
    channels: [{ channelType: 'Pan', phaseOffset: 0, depth: 60 }, { channelType: 'Tilt', phaseOffset: 90, depth: 40 }], speedMaster: slow, multiplier: 0.5 })
  const fxSweep = b.effect('Sharpy Fan Sweep', { fixtureIds: beams, channelType: 'Pan', waveform: 'triangle', speed: 0.25, depth: 90, fan: 120, speedMaster: song, multiplier: 0.125 })
  const fxTilt = b.effect('Aura Tilt Wave', { fixtureIds: washes, channelType: 'Tilt', speed: 0.3, depth: 50, fan: 360, spatial: true })
  const fxStrobe = b.effect('Strobe Random', { fixtureIds: strobes, channelType: 'Dimmer', waveform: 'random', speed: 6, depth: 255, fan: 360 })

  // Sequences (per-feature timing, cue parts, preset references)
  const spotOpen = { Dimmer: 255, Shutter: SHUTTER_OPEN, Power: 0 }
  const auraOpen = { Dimmer: 255, Shutter: SHUTTER_OPEN }
  const beamOpen = { Dimmer: 255, Shutter: SHUTTER_OPEN }
  const frontLevel = (l: number) => b.v(front, { Dimmer: l, ...frontRgb([255, 230, 200]) })
  const opener = b.cuelist('Opener', [
    b.cue('Dark stage, haze', b.v(hazers, { 'Haze Output': 140, 'Fan Speed': 180 }), { fadeIn: 2, follow: 5 }),
    b.cue('Silhouettes', [...b.v(washes, { ...auraOpen, Dimmer: 180 }), ...b.fromPreset(colors['Deep Blue'], washes), ...b.fromPreset(pos.sky, washes)],
      { fadeIn: 6, featureTiming: { colour: { fade: 2 }, position: { fade: 0 } } }),
    b.cue('Beams up', [...b.v(beams, beamOpen), ...b.fromPreset(colors.White, beams), ...b.fromPreset(pos.fan, beams), ...b.fromPreset(gobos[0], beams)],
      { fadeIn: 3, featureTiming: { position: { fade: 5, delay: 1 }, intensity: { fade: 2 } } }),
    b.cue('Band reveal', [
      ...frontLevel(200).map((v) => ({ ...v, part: 1 })),
      ...b.v(spots, spotOpen), ...b.fromPreset(colors.White, spots), ...b.fromPreset(pos.vocal, spots), ...b.fromPreset(tight)
    ], { fadeIn: 3, parts: [{ index: 0, name: 'Spots' }, { index: 1, name: 'Front', fade: 4, delay: 2 }] })
  ])
  const neon = b.cuelist('Song 1 – Neon', [
    b.cue('Verse', [...b.v(pars, { Dimmer: 200 }), ...b.fromPreset(colors.Magenta, pars), ...b.v(washes, auraOpen), ...b.fromPreset(colors.Cyan, washes), ...b.fromPreset(pos.cross, washes), ...frontLevel(150)],
      { fadeIn: 2, featureTiming: { position: { fade: 3 } } }),
    b.cue('Pre-chorus', [...b.fromPreset(colors.Blue, pars), ...b.v(spots, spotOpen), ...b.fromPreset(colors.Magenta, spots), ...b.fromPreset(pos.fan, spots), ...b.fromPreset(gobos[1], spots)],
      { fadeIn: 1.5, featureTiming: { colour: { fade: 0.5 }, position: { fade: 2.5, delay: 0.5 } } }),
    b.cue('Chorus', [...b.v(pars, { Dimmer: 255 }), ...b.fromPreset(colors.White, pars), ...b.v(beams, beamOpen), ...b.fromPreset(colors.Magenta, beams), ...b.fromPreset(pos.audience, beams), ...b.fromPreset(prism)],
      { fadeIn: 0.5, featureTiming: { intensity: { fade: 0 }, position: { fade: 1 } } }),
    b.cue('Bridge', [...b.v(beams, { Dimmer: 0 }), ...b.fromPreset(colors.Lavender, [...pars, ...washes]), ...b.fromPreset(pos.center, spots)], { fadeIn: 4 }),
    b.cue('Outro', b.v([...pars, ...washes, ...spots, ...beams], { Dimmer: 0 }), { fadeIn: 6 })
  ])
  const ballad = b.cuelist('Song 2 – Ballad', [
    b.cue('Intro', [...b.v([spots[3], spots[4]], { ...spotOpen, Dimmer: 200 }), ...b.fromPreset(colors.White, [spots[3], spots[4]]), ...b.fromPreset(pos.vocal, [spots[3], spots[4]]), ...b.fromPreset(tight)], { fadeIn: 5 }),
    b.cue('Verse', [...b.v(washes, { ...auraOpen, Dimmer: 140 }), ...b.fromPreset(colors['Deep Blue'], washes), ...frontLevel(120)], { fadeIn: 8, follow: 20 }),
    b.cue('Chorus', [...b.fromPreset(colors.Orange, [...washes, ...pars]), ...b.v(pars, { Dimmer: 160 }), ...b.fromPreset(wide)], { fadeIn: 6 }),
    b.cue('Last note', b.v([...washes, ...pars, ...front], { Dimmer: 0 }), { fadeIn: 10, delay: 2 })
  ])
  const rock = b.cuelist('Song 3 – Rock', [
    b.cue('Riff', [...b.v(beams, beamOpen), ...b.fromPreset(colors.Red, [...beams, ...pars, ...washes]), ...b.fromPreset(pos.cross, beams), ...b.v(pars, { Dimmer: 255 })], { fadeIn: 0.3 }),
    b.cue('Verse', [...b.v(beams, { Dimmer: 0 }), ...b.v(washes, auraOpen), ...b.fromPreset(pos.drums, washes), ...frontLevel(180)], { fadeIn: 1, featureTiming: { position: { fade: 2 } } }),
    b.cue('Solo', [...b.v(spots, spotOpen), ...b.fromPreset(colors.White, spots), ...b.fromPreset(pos.vocal, spots), ...b.fromPreset(gobos[4], spots)], { fadeIn: 1 }),
    b.cue('Final hit', [...b.v(blinders, { 'Cell 1': 255, 'Cell 2': 255 }), ...b.v(strobes, { Dimmer: 255, Strobe: 230 })], { fadeIn: 0, fadeOut: 2 })
  ])
  const encore = b.cuelist('Encore', [
    b.cue('All in', [...b.v([...spots, ...washes, ...beams], { Dimmer: 255, Shutter: SHUTTER_OPEN }), ...b.fromPreset(colors.White), ...b.fromPreset(pos.audience), ...b.v(pars, { Dimmer: 255 }), ...frontLevel(255)], { fadeIn: 1 }),
    b.cue('Thank you', [...frontLevel(255), ...b.v([...spots, ...washes, ...beams, ...pars], { Dimmer: 0 })], { fadeIn: 3 })
  ])
  const walkIn = b.cuelist('Walk-in', [b.cue('Preset', [...b.v(washes, { ...auraOpen, Dimmer: 90 }), ...b.fromPreset(colors['Deep Blue'], washes), ...b.fromPreset(pos.floor, washes),
    ...b.v(bars, { 'Master Dimmer': 120 }), ...b.fromPreset(colors.Lavender, bars)], { fadeIn: 5 })])
  const frontLight = b.cuelist('Front Light', [b.cue('Front 80 %', frontLevel(204), { fadeIn: 2 })])
  const blinderHit = b.cuelist('Blinders', [b.cue('Hit', b.v(blinders, { 'Cell 1': 255, 'Cell 2': 255 }), { fadeIn: 0, fadeOut: 0.5 })], { priority: 90 })
  const strobeHit = b.cuelist('Strobe Hit', [b.cue('Hit', b.v(strobes, { Dimmer: 255, Strobe: 220 }), { fadeIn: 0, fadeOut: 0 })], { priority: 90 })
  const haze = b.cuelist('Haze', [b.cue('Haze 50 %', b.v(hazers, { 'Haze Output': 128, 'Fan Speed': 150 }), { fadeIn: 5 })])
  const beamsFan = b.cuelist('Sharpy Fan', [b.cue('Fan', [...b.v(beams, beamOpen), ...b.fromPreset(colors.White, beams), ...b.fromPreset(pos.fan, beams)], { fadeIn: 2 })], { effects: [fxSweep] })
  const specials = b.cuelist('Spot Specials', [
    b.cue('Vocal', [...b.v([spots[3], spots[4]], spotOpen), ...b.fromPreset(pos.vocal, [spots[3], spots[4]])], { fadeIn: 1 }),
    b.cue('Drums', [...b.v([spots[0], spots[7]], spotOpen), ...b.fromPreset(pos.drums, [spots[0], spots[7]])], { fadeIn: 1 }),
    b.cue('Guitar', [...b.v([spots[1], spots[6]], spotOpen), ...b.v([spots[1], spots[6]], pt(80, 140))], { fadeIn: 1 })
  ], { tracking: false })

  // Chases
  const rainbow = b.chase('Pars Rainbow', (['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta'] as ColorName[]).map((c) => [...b.v(pars, { Dimmer: 255 }), ...b.v(pars, parRgb(COLORS[c], c))]), { bpm: 62, fade: 50, speed: song })
  const strobeRun = b.chase('Strobe Run', strobes.map((s) => b.v([s], { Dimmer: 255 })), { bpm: 248, speed: song })
  const barSweep = b.chase('Bars Sweep', Array.from({ length: 8 }, (_, c) => b.v(bars, { 'Master Dimmer': 255, [`Red ${c + 1}`]: 255, [`Green ${c + 1}`]: 120, [`Blue ${c + 1}`]: 0 })), { bpm: 248, fade: 20, direction: 'bounce' })
  const blinderChase = b.chase('Blinder Hits', blinders.map((x) => b.v([x], { 'Cell 1': 255, 'Cell 2': 255 })), { bpm: 124, direction: 'random', priority: 80 })

  // Macros
  b.macro('Show start', ['Go Sequence 10', { command: 'Go Sequence 6', wait: 1 }], '#22c55e')
  b.macro('Band on', ['Off Sequence 6', 'Go Sequence 1'], '#3b82f6')
  b.macro('FX off', ['Off Effect 1', 'Off Effect 2', 'Off Effect 3', 'Off Effect 4', 'Off Effect 5', 'Off Effect 6'], '#64748b')
  b.macro('Release all', ['Release'], '#64748b')
  b.macro('Blackout on', ['Blackout On'], '#ef4444')
  b.macro('Blackout off', ['Blackout Off'], '#22c55e')
  b.macro('Show page', ['Page 1'], '#6366f1')
  b.macro('Busk page', ['Page 2'], '#6366f1')

  b.page('Show', [
    { title: 'Opener', color: '#22c55e', cells: [goCell(opener), seqCell(walkIn)] },
    { title: 'Song 1', color: '#d946ef', cells: [goCell(neon), cell('effect', fxParWave)] },
    { title: 'Song 2', color: '#4f46e5', cells: [goCell(ballad), cell('effect', fxColourWave)] },
    { title: 'Song 3', color: '#ef4444', cells: [goCell(rock), cell('chase', strobeRun)] },
    { title: 'Encore', color: '#f97316', cells: [goCell(encore), seqCell(frontLight)] },
    { title: 'Hits', color: '#eab308', cells: [seqCell(blinderHit, 'flash'), seqCell(strobeHit, 'trigger'), cell('chase', blinderChase)] },
    { title: 'Atmos', color: '#94a3b8', cells: [seqCell(haze)] },
    { title: 'Speed', color: '#06b6d4', fader: { kind: 'speed', id: song.id }, cells: [cell('speed', song), cell('speed', slow)] }
  ])
  b.page('Busk', [
    { title: 'Pars', color: gPars.color, fader: { kind: 'group', id: gPars.id }, cells: [cell('chase', rainbow), cell('effect', fxParWave), cell('group', gPars)] },
    { title: 'Spots', color: gSpots.color, fader: { kind: 'group', id: gSpots.id }, cells: [seqCell(specials, 'toggle', 'go'), cell('effect', fxCircle), cell('group', gSpots)] },
    { title: 'Sharpys', color: gBeams.color, fader: { kind: 'group', id: gBeams.id }, cells: [seqCell(beamsFan), cell('effect', fxSweep), cell('group', gBeams)] },
    { title: 'Auras', color: gWashes.color, fader: { kind: 'group', id: gWashes.id }, cells: [cell('effect', fxTilt), null, cell('group', gWashes)] },
    { title: 'Bars', color: gBars.color, fader: { kind: 'group', id: gBars.id }, cells: [cell('chase', barSweep), null, cell('group', gBars)] },
    { title: 'Strobes', color: gStrobes.color, fader: { kind: 'group', id: gStrobes.id }, cells: [cell('effect', fxStrobe), null, cell('group', gStrobes)] },
    { title: 'Front', color: gFront.color, fader: { kind: 'group', id: gFront.id }, cells: [null, null, cell('group', gFront)] },
    { title: 'Slow FX', color: '#06b6d4', fader: { kind: 'speed', id: slow.id }, cells: [cell('speed', slow)] }
  ])
  b.page('Macros', b.macros.map((m) => ({ title: m.name, color: m.color ?? '#6366f1', cells: [cell('macro', m, 'trigger')] })))

  b.stagePage('Live', 8, 6, [
    w('go', 0, 0, 2, 2, { label: 'GO' }),
    w('executor', 2, 0, 1, 1, { ref: '1.1.1' }), w('executor', 3, 0, 1, 1, { ref: '1.2.1' }), w('executor', 4, 0, 1, 1, { ref: '1.3.1' }),
    w('executor', 5, 0, 1, 1, { ref: '1.4.1' }), w('executor', 6, 0, 1, 1, { ref: '1.5.1' }),
    w('executor', 2, 1, 1, 1, { ref: '1.6.1' }), w('executor', 3, 1, 1, 1, { ref: '1.6.2' }), w('executor', 4, 1, 1, 1, { ref: '1.7.1' }),
    w('clock', 5, 1, 2, 1),
    w('master', 7, 0, 1, 4, { options: { fn: 'gm' } }),
    w('fader', 0, 2, 1, 4, { ref: '1.1', options: { target: 'column' } }),
    w('fader', 1, 2, 1, 4, { ref: '1.2', options: { target: 'column' } }),
    w('fader', 2, 2, 1, 4, { ref: '1.3', options: { target: 'column' } }),
    w('fader', 3, 2, 1, 4, { ref: '1.4', options: { target: 'column' } }),
    w('speed', 4, 2, 3, 1, { ref: song.id }),
    w('master', 4, 3, 1, 1, { options: { fn: 'blinder' } }), w('master', 5, 3, 1, 1, { options: { fn: 'strobe' } }), w('master', 6, 3, 1, 1, { options: { fn: 'blackout' } }),
    w('master', 4, 4, 2, 1, { options: { fn: 'release' } }), w('master', 6, 4, 2, 1, { options: { fn: 'clear' } }),
    w('label', 4, 5, 4, 1, { label: 'Concert Pro — Live' })
  ])
  b.stagePage('Busk', 8, 5, [
    ...colorNames.slice(0, 8).map((name, i) => w('preset', i, 0, 1, 1, { ref: colors[name].id })),
    ...Object.values(pos).map((p, i) => w('preset', i, 1, 1, 1, { ref: p.id })),
    ...gobos.slice(0, 6).map((p, i) => w('preset', i, 2, 1, 1, { ref: p.id })),
    w('speed', 6, 2, 2, 1, { ref: slow.id }),
    ...[gSpots, gWashes, gBeams, gPars, gBlinders, gStrobes, gFront, gBars].map((g, i) => w('group', i, 3, 1, 1, { ref: g.id })),
    ...b.macros.map((m, i) => w('macro', i, 4, 1, 1, { ref: m.id }))
  ])

  const clip = (cl: Cuelist, trackIndex: number, startTime: number, duration: number, color: string) => ({ id: b.id('clip'), cuelistId: cl.id, trackIndex, startTime, duration, color })
  const timeline: ShowTimeline = {
    trackCount: 3,
    trackNames: ['Songs', 'Movers', 'Specials'],
    length: 240,
    clips: [
      clip(opener, 0, 0, 30, '#22c55e'), clip(neon, 0, 30, 70, '#d946ef'), clip(ballad, 0, 100, 60, '#4f46e5'), clip(rock, 0, 160, 60, '#ef4444'),
      clip(beamsFan, 1, 40, 30, '#06b6d4'), clip(specials, 1, 170, 40, '#3b82f6'),
      clip(haze, 2, 0, 120, '#94a3b8'), clip(blinderHit, 2, 95, 2, '#eab308'), clip(strobeHit, 2, 218, 2, '#ec4899')
    ],
    markers: [
      { id: b.id('mk'), time: 0, name: 'Opener', color: '#22c55e' },
      { id: b.id('mk'), time: 30, name: 'Neon', color: '#d946ef' },
      { id: b.id('mk'), time: 100, name: 'Ballad', color: '#4f46e5' },
      { id: b.id('mk'), time: 160, name: 'Rock', color: '#ef4444' }
    ],
    zones: [
      { id: b.id('zone'), name: 'Act 1', startTime: 0, endTime: 100, color: '#22c55e', order: 0 },
      { id: b.id('zone'), name: 'Act 2', startTime: 100, endTime: 220, color: '#3b82f6', order: 1 }
    ]
  }

  return b.build('Concert Pro', {
    timeline,
    roomConfig: {
      width: 20, depth: 16, height: 8, stageEdgeZ: -2,
      trussBars: [
        { id: 'concert-foh', name: 'FOH', z: -7, y: 7.45, width: 14 },
        { id: 'concert-truss-1', name: 'Truss 1', z: -2, y: 7.45, width: 17 },
        { id: 'concert-truss-2', name: 'Truss 2', z: 0, y: 7.45, width: 17 },
        { id: 'concert-truss-3', name: 'Truss 3', z: 3.5, y: 7.45, width: 17 }
      ]
    } as RoomConfig
  })
}

// ================================================================ manifest texts

const SHOW_TEXTS: Record<string, { file: string; description: { en: string; fr: string } }> = {
  'club-night': {
    file: 'Club Night.pbshow',
    description: {
      en: 'A small club rig on one universe: LED pars, moving heads, LED bars, strobes and haze. Colour and position presets, chases, effects and two executor pages ready for an APC mini (8×8 pads + faders).',
      fr: 'Un petit kit de club sur un univers : PAR LED, lyres, barres LED, strobes et machine à brume. Presets couleur et position, chases, effets et deux pages d’exécuteurs prêtes pour un APC mini (8×8 pads + faders).'
    }
  },
  theatre: {
    file: 'Théâtre – soirée simple.pbshow',
    description: {
      en: 'A simple theatre evening: front, back and side lights on dimmers plus an LED cyclorama. One cue list with timed fades (house in, blackout, scenes, bows), groups by stage area and group faders.',
      fr: 'Une soirée de théâtre simple : face, contres et latéraux sur gradateurs, cyclo LED. Une conduite avec des temps de montée / descente (entrée public, noir salle, scènes, saluts), des groupes par zone et des faders de groupe.'
    }
  },
  'concert-pro': {
    file: 'Concert Pro.pbshow',
    description: {
      en: 'A bigger concert rig over two universes (54 fixtures): spots, washes, beams, LED pars, blinders, strobes, front and bars. Preset pools, songs with per-feature timing and cue parts, effects on speed masters, three executor pages, Stage pages, macros and a timeline.',
      fr: 'Un kit de concert plus grand sur deux univers (54 projecteurs) : spots, wash, beams, PAR LED, blinders, strobes, face et barres. Pools de presets, morceaux avec temps par famille et parts de cue, effets sur masters de vitesse, trois pages d’exécuteurs, pages Stage, macros et timeline.'
    }
  }
}

interface FormatText { format: string; description: { en: string; fr: string } }

// ================================================================ build

function writeShow(id: string, show: ShowFile): { show: ShowFile; bytes: number } {
  const { show: normalized, warnings } = normalizeShow(show)
  if (warnings.length) throw new Error(`${show.name}: normalizeShow warnings:\n  ${warnings.join('\n  ')}`)
  const text = JSON.stringify(normalized, null, 2) + '\n'
  writeFileSync(join(OUT, SHOW_TEXTS[id].file), text)
  return { show: normalized, bytes: Buffer.byteLength(text) }
}

function fixturesOf(show: ShowFile): FixtureDefinition[] {
  const used = new Set(show.patch.map((p) => p.fixtureDefId))
  return BUILTIN_FIXTURES.filter((f) => used.has(f.id))
}

async function exportWith(format: string, show: ShowFile, file: string): Promise<void> {
  const exporter = getExporter(format)
  if (!exporter) throw new Error(`No exporter for ${format}`)
  const { bytes, warnings } = await exporter.write(show, fixturesOf(show))
  const serious = warnings.filter((w) => w.level === 'error')
  if (serious.length) throw new Error(`${format}: ${serious.map((w) => w.message ?? w.code).join('; ')}`)
  writeFileSync(join(FORMATS, file), bytes)
}

const README = `PhotonBoard — fichiers exemples d’import / example import files
==================================================================

FRANÇAIS
--------
Ces fichiers montrent ce que PhotonBoard sait importer (Fichier › Importer…,
ou « Essayer avec un fichier exemple » dans l’assistant d’import).
Ils sont fictifs et libres de droits.

  Club Night.mvr            MVR (My Virtual Rig) : patch, positions 3D et types
                            de projecteurs GDTF intégrés.
                            Lu aussi par Vectorworks, grandMA3, Capture, Depence…
  Club Night.qxw            Espace de travail QLC+ : projecteurs, groupes, scènes,
                            chases, effets, console virtuelle.
  Club Night.asc            USITT ASCII : patch, groupes et cues (ETC Eos /
                            Expression, Strand, ChamSys, grandMA2…).
  Club Night - patch.csv    Patch en tableau (CSV) : nom, type, univers, adresse,
                            mode… (Excel, Numbers, LightWright).
  *.gdtf                    Un type de projecteur au format GDTF (GDTF Share).
  grandMA3 - theatre.xml    Exemple d’export XML grandMA3 fait à la main :
                            patch, groupe, presets, séquence avec parts, macro.
  grandMA2 - theatre.xml    Exemple d’export XML grandMA2 fait à la main :
                            couche de projecteurs, groupe, preset, séquence, effet.

Les fichiers Club Night ont été écrits par les exports de PhotonBoard à partir
de la démo « Club Night » (Fichier › Ouvrir une démo…).

ENGLISH
-------
These files show what PhotonBoard can import (File › Import…, or
"Try with an example file" in the import wizard). They are fictitious and
free to use.

  Club Night.mvr            MVR (My Virtual Rig): patch, 3D positions and embedded
                            GDTF fixture types (Vectorworks, grandMA3, Capture,
                            Depence…).
  Club Night.qxw            QLC+ workspace: fixtures, groups, scenes, chases,
                            effects, virtual console.
  Club Night.asc            USITT ASCII: patch, groups and cues (ETC Eos /
                            Expression, Strand, ChamSys, grandMA2…).
  Club Night - patch.csv    Patch as a table (CSV): name, type, universe,
                            address, mode… (Excel, Numbers, LightWright).
  *.gdtf                    One fixture type in GDTF (GDTF Share).
  grandMA3 - theatre.xml    Hand-made grandMA3 XML export sample: patch, group,
                            presets, a sequence with parts, a macro.
  grandMA2 - theatre.xml    Hand-made grandMA2 XML export sample: fixture layer,
                            group, preset, sequence, effect.

The Club Night files were written by PhotonBoard's own exporters from the
"Club Night" demo show (File › Open a demo…).
`

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(FORMATS, { recursive: true })

  const built: Record<string, ShowFile> = {}
  const shows: DemoManifest['shows'] = []
  for (const [id, make] of [['club-night', clubNight], ['theatre', theatre], ['concert-pro', concertPro]] as const) {
    const { show } = writeShow(id, make())
    built[id] = show
    shows.push({
      id,
      file: SHOW_TEXTS[id].file,
      name: show.name,
      description: SHOW_TEXTS[id].description,
      fixtures: show.patch.length,
      universes: new Set(show.patch.map((p) => p.universe)).size
    })
  }

  // ---- example files for the import wizard
  const club = built['club-night']
  const formats: (FormatText & { file: string })[] = []
  const mvr = writeMvr(club, fixturesOf(club), { now: NOW })
  writeFileSync(join(FORMATS, 'Club Night.mvr'), mvr.bytes)
  formats.push({ file: 'Club Night.mvr', format: 'mvr', description: {
    en: 'MVR scene: patch, 3D positions and embedded GDTF fixture types (Vectorworks, grandMA3, Capture…).',
    fr: 'Scène MVR : patch, positions 3D et types de projecteurs GDTF intégrés (Vectorworks, grandMA3, Capture…).'
  } })
  await exportWith('qlcplus-workspace', club, 'Club Night.qxw')
  formats.push({ file: 'Club Night.qxw', format: 'qlcplus-workspace', description: {
    en: 'QLC+ workspace: fixtures, groups, scenes, chases, effects and the virtual console.',
    fr: 'Espace de travail QLC+ : projecteurs, groupes, scènes, chases, effets et console virtuelle.'
  } })
  await exportWith('usitt-ascii', club, 'Club Night.asc')
  formats.push({ file: 'Club Night.asc', format: 'usitt-ascii', description: {
    en: 'USITT ASCII: patch, groups and cues, as written by ETC, Strand or ChamSys consoles.',
    fr: 'USITT ASCII : patch, groupes et cues, comme les écrivent les consoles ETC, Strand ou ChamSys.'
  } })
  await exportWith('csv-patch', club, 'Club Night - patch.csv')
  formats.push({ file: 'Club Night - patch.csv', format: 'csv-patch', description: {
    en: 'Patch as a spreadsheet (CSV): name, fixture type, universe, address and mode.',
    fr: 'Patch en tableau (CSV) : nom, type de projecteur, univers, adresse et mode.'
  } })
  const spotDef = DEFS.get('generic/moving-head-spot')!
  const gdtf = writeGdtf(spotDef, { now: NOW, appVersion: APP_VERSION })
  writeFileSync(join(FORMATS, gdtf.fileName), gdtf.bytes)
  formats.push({ file: gdtf.fileName, format: 'gdtf', description: {
    en: 'One fixture type in GDTF: a moving head spot with its modes, wheels and physical data.',
    fr: 'Un type de projecteur au format GDTF : une lyre spot avec ses modes, roues et données physiques.'
  } })
  for (const [src, file, format, description] of [
    ['grandma3-theatre.xml', 'grandMA3 - theatre.xml', 'ma3-xml', {
      en: 'Hand-made grandMA3 XML export: patch, a group, presets, a sequence with cue parts and a macro.',
      fr: 'Export XML grandMA3 fait à la main : patch, un groupe, des presets, une séquence avec parts de cue et une macro.'
    }],
    ['grandma2-theatre.xml', 'grandMA2 - theatre.xml', 'ma2-xml', {
      en: 'Hand-made grandMA2 XML export: a fixture layer, a group, a preset, a sequence and an effect.',
      fr: 'Export XML grandMA2 fait à la main : une couche de projecteurs, un groupe, un preset, une séquence et un effet.'
    }]
  ] as const) {
    copyFileSync(join(SOURCES, src), join(FORMATS, file))
    formats.push({ file, format, description })
  }
  writeFileSync(join(FORMATS, 'README.txt'), README)

  const ids = new Set(formats.map((f) => f.file.toLowerCase()))
  if (ids.size !== formats.length) throw new Error('Two example files have the same name')
  const manifest: DemoManifest = {
    version: 1,
    shows,
    formats: formats.map((f) => ({ id: f.file.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), file: `formats/${f.file}`, format: f.format, description: f.description }))
  }
  writeFileSync(join(OUT, 'demos.json'), JSON.stringify(manifest, null, 2) + '\n')

  let total = 0
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const size = statSync(p).size
      total += size
      console.log(`  ${(size / 1024).toFixed(1).padStart(7)} KB  ${p.slice(OUT.length + 1)}`)
    }
  }
  walk(OUT)
  console.log(`resources/demos: ${(total / 1024).toFixed(0)} KB`)
  if (total > 2 * 1024 * 1024) throw new Error('Demo content is over 2 MB')
  if (!existsSync(join(OUT, 'demos.json'))) throw new Error('manifest missing')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
