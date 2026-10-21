// ============================================================
// PhotonBoard — show → QLC+ workspace (.qxw) exporter
//
// Writes a workspace QLC+ 4.13 opens (same elements / attributes as
// QLC+'s own saveXML code; <!DOCTYPE Workspace> is mandatory):
//   patch       → <Fixture> (QLC+ definitions keep their QLC+ maker /
//                 model / mode names; PhotonBoard generic dimmers / RGB
//                 types → QLC+ built-in Generic / RGBPanel; other types
//                 keep their names — QLC+ uses a dimmer pack of the same
//                 size when it does not know them)
//   positions   → <Monitor> 2D items (front view)
//   groups      → <FixtureGroup>
//   cuelists    → <Scene> per cue (+ <Chaser> with per-step timing)
//   chases      → <Chaser> of scenes
//   effects     → <EFX> (pan / tilt or dimmer, sine shapes exactly)
//   timeline    → <Show> with tracks
//   presets     → <Palette> (universal dimmer / colour)
//   executors   → virtual console: one button (or cue list) per cell,
//                 a playback slider per column fader
//   MIDI        → widget inputs on a MIDI input line
// Pure module.
// ============================================================

import type { ImportWarning, ImportWarningLevel } from '../../../shared/interchange'
import type {
  Cue,
  CueChannelValue,
  Cuelist,
  Effect,
  EffectChannel,
  ExecutorCell,
  ExecutorPage,
  FixtureDefinition,
  FixtureMode,
  PatchEntry,
  ShowFile
} from '../../../shared/types'
import { normalizeShow } from '../../../shared/show-format'
import { efxFromAxes, lissajousAxis } from './efx'
import { asQlcGeneric } from './generic'
import { midiToQlcChannel, MIDI_OMNI } from './midi'
import { QLC_INFINITE } from './model'
import { XmlWriter, type Attrs } from './xml'

export const QLC_EXPORT_VERSION = '4.13.1'

interface FixtureOut {
  qlcId: number
  entry: PatchEntry
  def: FixtureDefinition | null
  mode: FixtureMode | null
  manufacturer: string
  model: string
  modeName: string
  channels: number
  heads: number
}

interface SceneOut {
  id: number
  name: string
  path: string
  fadeIn: number
  fadeOut: number
  values: Map<number, [number, number][]>
}

interface ChaserStepOut {
  fid: number
  fadeIn: number
  hold: number
  fadeOut: number
  note?: string
}

interface ChaserOut {
  id: number
  name: string
  path: string
  direction: 'Forward' | 'Backward'
  runOrder: 'Loop' | 'SingleShot' | 'PingPong' | 'Random'
  steps: ChaserStepOut[]
}

interface EfxFixtureOut {
  fixture: number
  mode: number
  startOffset: number
}

interface EfxOutFn {
  id: number
  name: string
  path: string
  fadeIn: number
  fadeOut: number
  duration: number
  runOrder: 'Loop' | 'SingleShot'
  fixtures: EfxFixtureOut[]
  algorithm: string
  direction: 'Forward' | 'Backward'
  startOffset: number
  width: number
  height: number
  xOffset: number
  yOffset: number
  xFrequency: number
  yFrequency: number
  xPhase: number
  yPhase: number
}

interface CollectionOut {
  id: number
  name: string
  path: string
  functions: number[]
}

interface ShowOut {
  id: number
  name: string
  tracks: { id: number; name: string; functions: { fid: number; start: number; duration: number; color?: string }[] }[]
}

type FunctionOut =
  | ({ kind: 'Scene' } & SceneOut)
  | ({ kind: 'Chaser' } & ChaserOut)
  | ({ kind: 'EFX' } & EfxOutFn)
  | ({ kind: 'Collection' } & CollectionOut)
  | ({ kind: 'Show' } & ShowOut)

interface VcWidgetOut {
  tag: 'Button' | 'CueList' | 'Slider' | 'Frame'
  caption: string
  x: number
  y: number
  w: number
  h: number
  color?: string
  functionId?: number
  action?: 'Toggle' | 'Flash' | 'Blackout'
  sliderMode?: 'Playback' | 'Level'
  levelChannels?: { fixture: number; channel: number }[]
  levelLow?: number
  levelHigh?: number
  input?: number
  /** Cue list inputs */
  nextInput?: number
  playbackInput?: number
  children?: VcWidgetOut[]
}

class ExportWarnings {
  readonly out: ImportWarning[] = []
  private lists = new Map<string, { level: ImportWarningLevel; message: string; items: string[] }>()
  add(level: ImportWarningLevel, code: string, message: string, params?: Record<string, string | number>): void {
    this.out.push(params ? { level, code, message, params } : { level, code, message })
  }
  item(level: ImportWarningLevel, code: string, message: string, item: string): void {
    const l = this.lists.get(code)
    if (l) { if (!l.items.includes(item)) l.items.push(item) } else this.lists.set(code, { level, message, items: [item] })
  }
  flush(): ImportWarning[] {
    for (const [code, l] of this.lists) {
      const shown = l.items.slice(0, 12).join(', ')
      const more = l.items.length > 12 ? ` (+${l.items.length - 12} more)` : ''
      this.out.push({ level: l.level, code, message: `${l.message}: ${shown}${more}`, params: { count: l.items.length, items: shown + more } })
    }
    this.lists.clear()
    return this.out
  }
}

function ms(seconds: number | undefined): number {
  const s = Number(seconds)
  return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : 0
}

function compactKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The maker name QLC+ uses for a definition converted from its library */
export function qlcManufacturerOf(def: FixtureDefinition): string {
  const path = def.catalog?.source === 'qlcplus' ? def.catalog.path : ''
  const m = /(?:^|\/)fixtures\/([^/]+)\/[^/]+\.qxf$/i.exec(path)
  if (!m) return def.manufacturer
  const folder = m[1].replace(/_/g, ' ')
  return compactKey(folder) === compactKey(def.manufacturer) ? def.manufacturer : folder
}

function qrgb(hex: string | undefined): number | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return undefined
  return (0xff000000 + parseInt(m[1], 16)) >>> 0
}

export function exportQlcWorkspace(show: ShowFile, fixtureDefs: FixtureDefinition[]): { xml: string; warnings: ImportWarning[] } {
  // Same defaults / clean-up as a show load (v2 executor grids become pages, missing lists become empty)
  let clean = show
  try { clean = normalizeShow(show).show } catch { clean = show }
  return new WorkspaceExporter(clean, fixtureDefs).run()
}

class WorkspaceExporter {
  private warn = new ExportWarnings()
  private defs = new Map<string, FixtureDefinition>()
  private fixtures: FixtureOut[] = []
  private byPatchId = new Map<string, FixtureOut>()
  private functions: FunctionOut[] = []
  private nextFn = 0
  /** cuelist id → function a button starts; chaser id when it is a cue stack */
  private cuelistMain = new Map<string, { fid: number; chaser?: number; manual: boolean }>()
  private chaseMain = new Map<string, number>()
  private effectMain = new Map<string, number>()

  constructor(private show: ShowFile, defs: FixtureDefinition[]) {
    for (const d of defs) this.defs.set(d.id, d)
  }

  run(): { xml: string; warnings: ImportWarning[] } {
    this.buildFixtures()
    this.buildCuelists()
    this.buildChases()
    this.buildEffects()
    this.buildShow()
    this.reportUnsupported()
    const xml = this.write()
    return { xml, warnings: this.warn.flush() }
  }

  // ---------------------------------------------------------- fixtures

  private buildFixtures(): void {
    const fids = this.show.patch.map((p) => p.fid)
    const useFid = fids.every((f) => typeof f === 'number' && Number.isInteger(f) && f >= 1) && new Set(fids).size === fids.length
    this.show.patch.forEach((entry, index) => {
      const def = this.defs.get(entry.fixtureDefId) ?? null
      const mode = def ? def.modes.find((m) => m.name === entry.modeName) ?? def.modes[0] ?? null : null
      const qlcId = useFid ? (entry.fid as number) - 1 : index
      if (!def || !mode) {
        this.warn.item('warning', 'qlcplus.export.noDefinition', 'Fixtures without a definition were not exported', entry.name)
        return
      }
      let manufacturer = def.manufacturer
      let model = def.name
      let modeName = mode.name
      let channels = mode.channelCount || mode.channels.length
      let heads = mode.pixelLayout && mode.pixelLayout.cellCount > 1 ? mode.pixelLayout.cellCount : 1
      const generic = asQlcGeneric(def, mode)
      if (generic?.kind === 'dimmer') {
        manufacturer = 'Generic'; model = 'Generic'; modeName = `${generic.channels} Channel`; channels = generic.channels; heads = generic.channels
      } else if (generic?.kind === 'rgbpanel') {
        manufacturer = 'Generic'; model = 'RGBPanel'; modeName = generic.mode; channels = generic.channels; heads = generic.heads
      } else if (def.catalog?.source === 'qlcplus' || def.source === 'qlcplus') {
        manufacturer = qlcManufacturerOf(def)
      } else {
        this.warn.item('info', 'qlcplus.export.fixtureType',
          'Fixture types not from the QLC+ library keep their names; QLC+ uses them if it has the same definition, else a dimmer pack with the same channel count',
          `${def.manufacturer} ${def.name} (${mode.name})`)
      }
      if (entry.universe > 0 && entry.universe >= 64) this.warn.item('warning', 'qlcplus.export.universe', 'Universe out of range', entry.name)
      const out: FixtureOut = { qlcId, entry, def, mode, manufacturer, model, modeName, channels, heads }
      this.fixtures.push(out)
      this.byPatchId.set(entry.id, out)
    })
  }

  private channelIndex(fixtureId: string, channelName: string): { fx: FixtureOut; index: number } | null {
    const fx = this.byPatchId.get(fixtureId)
    if (!fx || !fx.mode) return null
    const index = fx.mode.channels.indexOf(channelName)
    return index >= 0 ? { fx, index } : null
  }

  // ---------------------------------------------------------- scenes / cuelists

  private addScene(name: string, path: string, values: CueChannelValue[], fadeIn: number, fadeOut: number): number {
    const id = this.nextFn++
    const byFixture = new Map<number, [number, number][]>()
    let dropped = 0
    for (const v of values) {
      const c = this.channelIndex(v.fixtureId, v.channelName)
      if (!c) { dropped++; continue }
      let list = byFixture.get(c.fx.qlcId)
      if (!list) { list = []; byFixture.set(c.fx.qlcId, list) }
      const at = list.findIndex(([ch]) => ch === c.index)
      const val = Math.max(0, Math.min(255, Math.round(v.value)))
      if (at >= 0) list[at] = [c.index, val]
      else list.push([c.index, val])
    }
    for (const l of byFixture.values()) l.sort((a, b) => a[0] - b[0])
    if (dropped) this.warn.item('warning', 'qlcplus.export.values', 'Values of unknown fixtures / channels were not exported', name)
    this.functions.push({ kind: 'Scene', id, name, path, fadeIn, fadeOut, values: byFixture })
    return id
  }

  private cueWarnings(cl: Cuelist, cue: Cue): void {
    if (cue.delay > 0) this.warn.item('info', 'qlcplus.export.delay', 'Cue delays are not carried by QLC+ chasers', `${cl.name} cue ${cue.number}`)
    if (cue.featureTiming && Object.keys(cue.featureTiming).length) this.warn.item('info', 'qlcplus.export.featureTiming', 'Per-feature cue timing is not carried', `${cl.name} cue ${cue.number}`)
    if (cue.parts && cue.parts.length) this.warn.item('info', 'qlcplus.export.parts', 'Cue parts are not carried', `${cl.name} cue ${cue.number}`)
    if (cue.values.some((v) => v.fade !== undefined || v.delay !== undefined)) this.warn.item('info', 'qlcplus.export.valueTiming', 'Per-value timing is not carried', `${cl.name} cue ${cue.number}`)
  }

  private buildCuelists(): void {
    const list = [...this.show.cuelists].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9))
    for (const cl of list) {
      if (cl.cues.length === 0) { this.warn.item('info', 'qlcplus.export.emptyCuelist', 'Empty cue lists were not exported', cl.name); continue }
      let main: number
      let chaserId: number | undefined
      let manual = false
      if (cl.cues.length === 1) {
        const cue = cl.cues[0]
        this.cueWarnings(cl, cue)
        main = this.addScene(cl.name, '', cue.values, ms(cue.fadeIn), ms(cue.fadeOut))
      } else {
        const folder = `PhotonBoard/Cue lists/${cl.name.replace(/\//g, '-')}`
        const tracking = cl.tracking !== false
        const state = new Map<string, CueChannelValue>()
        const steps: ChaserStepOut[] = []
        for (const cue of cl.cues) {
          this.cueWarnings(cl, cue)
          let values = cue.values
          if (tracking) {
            for (const v of cue.values) state.set(`${v.fixtureId}\u0000${v.channelName}`, v)
            values = [...state.values()]
          }
          const fid = this.addScene(`${cl.name} · ${cue.number}${cue.name ? ` ${cue.name}` : ''}`, folder, values, ms(cue.fadeIn), ms(cue.fadeOut))
          const fadeIn = ms(cue.fadeIn)
          let hold: number
          if (cue.followTime === null || cue.followTime === undefined) { hold = QLC_INFINITE; manual = true }
          else if (cue.followMode === 'after-go') {
            hold = ms(cue.followTime) - fadeIn
            if (hold < 0) { this.warn.item('info', 'qlcplus.export.follow', 'Follow times shorter than the fade were lengthened to the fade', `${cl.name} cue ${cue.number}`); hold = 0 }
          } else hold = ms(cue.followTime)
          steps.push({ fid, fadeIn, hold, fadeOut: ms(cue.fadeOut), note: cue.name || undefined })
        }
        if (tracking) this.warn.item('info', 'qlcplus.export.tracking', 'Tracking cue lists were written with every tracked value stored in each step', cl.name)
        chaserId = this.nextFn++
        this.functions.push({ kind: 'Chaser', id: chaserId, name: cl.name, path: 'PhotonBoard/Cue lists', direction: 'Forward', runOrder: cl.isLooping ? 'Loop' : 'SingleShot', steps })
        main = chaserId
      }
      // Effects recorded with the cue list start with it: collection
      const fx: number[] = []
      for (const e of cl.effectSnapshots ?? []) {
        const id = this.addEfx(e, `PhotonBoard/Cue lists/${cl.name.replace(/\//g, '-')}`)
        if (id !== null) fx.push(id)
      }
      if (fx.length) {
        const cid = this.nextFn++
        this.functions.push({ kind: 'Collection', id: cid, name: cl.name, path: 'PhotonBoard/Cue lists', functions: [main, ...fx] })
        main = cid
      }
      if (cl.mib?.enabled) this.warn.item('info', 'qlcplus.export.mib', 'Move-in-black is not carried', cl.name)
      this.cuelistMain.set(cl.id, { fid: main, chaser: fx.length ? undefined : chaserId, manual })
    }
  }

  // ---------------------------------------------------------- chases

  private buildChases(): void {
    const list = [...this.show.chases].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9))
    for (const ch of list) {
      if (ch.steps.length === 0) { this.warn.item('info', 'qlcplus.export.emptyChase', 'Empty chases were not exported', ch.name); continue }
      const folder = `PhotonBoard/Chases/${ch.name.replace(/\//g, '-')}`
      const base = 60 / Math.max(1, ch.bpm || 120)
      const steps: ChaserStepOut[] = ch.steps.map((s, i) => {
        const dur = s.holdTime && s.holdTime > 0 ? s.holdTime : base
        const fadeIn = Math.round(dur * 1000 * Math.max(0, Math.min(100, ch.fadePercent)) / 100)
        const fid = this.addScene(`${ch.name} · ${i + 1}`, folder, s.values, 0, 0)
        return { fid, fadeIn, hold: Math.max(0, Math.round(dur * 1000) - fadeIn), fadeOut: 0 }
      })
      const id = this.nextFn++
      let runOrder: ChaserOut['runOrder'] = ch.direction === 'bounce' ? 'PingPong' : ch.direction === 'random' ? 'Random' : 'Loop'
      if (!ch.isLooping) {
        if (runOrder !== 'Loop') this.warn.item('info', 'qlcplus.export.chaseOnce', 'Non-looping bounce / random chases play once forward', ch.name)
        runOrder = 'SingleShot'
      }
      this.functions.push({ kind: 'Chaser', id, name: ch.name, path: 'PhotonBoard/Chases', direction: ch.direction === 'backward' ? 'Backward' : 'Forward', runOrder, steps })
      this.chaseMain.set(ch.id, id)
      if (ch.speedMasterId) this.warn.item('info', 'qlcplus.export.speedMaster', 'Speed masters are not carried', ch.name)
    }
  }

  // ---------------------------------------------------------- effects

  private addEfx(effect: Effect, path: string): number | null {
    const channels: EffectChannel[] = effect.channels && effect.channels.length
      ? effect.channels
      : [{ channelType: effect.channelType, phaseOffset: 0, depth: effect.depth, frequencyMultiplier: 1 }]
    const pan = channels.find((c) => /^pan$/i.test(c.channelType.trim()))
    const tilt = channels.find((c) => /^tilt$/i.test(c.channelType.trim()))
    const dim = channels.find((c) => /^(dimmer|intensity)$/i.test(c.channelType.trim()))
    const used = pan || tilt ? [pan, tilt].filter(Boolean) as EffectChannel[] : dim ? [dim] : []
    if (used.length === 0) {
      this.warn.item('warning', 'qlcplus.export.effect', 'Effects that are not pan / tilt or dimmer movements were not exported (QLC+ EFX)', effect.name)
      return null
    }
    if (channels.length > used.length) this.warn.item('info', 'qlcplus.export.effectChannels', 'Only the pan / tilt (or dimmer) part of effects was exported', effect.name)
    // Two squares a quarter apart = QLC+ "SquareTrue" (exact)
    const waveOf = (c: EffectChannel): string => c.waveform ?? effect.waveform
    const squareTrue = !!pan && !!tilt && waveOf(pan) === 'square' && waveOf(tilt) === 'square' &&
      Math.round(pan.frequencyMultiplier ?? 1) === 1 && Math.round(tilt.frequencyMultiplier ?? 1) === 1 &&
      Math.abs(((((tilt.phaseOffset - pan.phaseOffset) % 360) + 360) % 360) - 90) < 1
    for (const c of used) {
      const w = waveOf(c)
      if (w !== 'sine' && !squareTrue) this.warn.item('warning', 'qlcplus.export.effectWave', 'Non-sine effect waveforms were exported as sine (QLC+ Lissajous)', `${effect.name} (${w})`)
      const f = c.frequencyMultiplier ?? 1
      if (Math.abs(f - Math.round(f)) > 0.01 || f < 1) this.warn.item('info', 'qlcplus.export.effectFreq', 'Fractional frequency multipliers were rounded', effect.name)
    }
    if (effect.spatialMode === 'spatial') this.warn.item('info', 'qlcplus.export.spatial', 'Spatial fans were exported as fans in fixture order', effect.name)
    if (effect.speedMasterId) this.warn.item('info', 'qlcplus.export.speedMaster', 'Speed masters are not carried', effect.name)
    const fixtures = effect.fixtureIds.map((id) => this.byPatchId.get(id)).filter((f): f is FixtureOut => !!f)
    if (fixtures.length === 0) {
      this.warn.item('warning', 'qlcplus.export.effectFixtures', 'Effects without exported fixtures were skipped', effect.name)
      return null
    }
    const n = fixtures.length
    const fan = Number(effect.fan) || 0
    const multi = used.some((c) => Math.round(c.frequencyMultiplier ?? 1) !== 1)
    if (multi && fan !== 0) this.warn.item('info', 'qlcplus.export.effectFan', 'Fans on multi-frequency effects are approximated by QLC+ start offsets', effect.name)
    const offset = Number(effect.offset) || 0
    let shape
    let xOffset = 128
    let yOffset = 128
    let mode = 0
    if (squareTrue) {
      // SquareTrue: x = square(p), y = square(p + ¼); a start offset δ shifts both
      const delta = ((((pan!.phaseOffset + offset) % 360) + 360) % 360)
      shape = {
        algorithm: 'SquareTrue', direction: 'Forward' as const, startOffset: Math.round(delta) % 360,
        width: Math.min(127, Math.round(pan!.depth / 2)), height: Math.min(127, Math.round(tilt!.depth / 2)),
        xFrequency: 2, yFrequency: 3, xPhase: 90, yPhase: 0
      }
    } else if (pan || tilt) {
      shape = efxFromAxes(pan ? lissajousAxis(pan, offset) : null, tilt ? lissajousAxis(tilt, offset) : null)
    } else {
      // Dimmer: QLC+ dimmer = yOffset + h·cos(…); PhotonBoard = depth/2 + depth/2·sin(…)
      const y = lissajousAxis(dim!, offset)
      shape = efxFromAxes(null, y)
      yOffset = Math.max(0, Math.min(255, Math.round(dim!.depth / 2)))
      xOffset = 0
      mode = 1
    }
    const speed = Number(effect.speed) > 0 ? Number(effect.speed) : 1
    const fadeIn = ms(effect.fadeIn)
    const id = this.nextFn++
    this.functions.push({
      kind: 'EFX',
      id,
      name: effect.name,
      path,
      fadeIn,
      fadeOut: ms(effect.fadeOut),
      duration: Math.max(1, Math.round(1000 / speed)) + fadeIn,
      runOrder: effect.oneShot ? 'SingleShot' : 'Loop',
      // A reversed curve (fixture direction ≠ EFX direction) is shifted the other way by start offsets
      fixtures: fixtures.map((f, i) => {
        const deg = ((fan * i) / n) * (shape.direction === 'Backward' && shape.algorithm !== 'Line' ? -1 : 1)
        return { fixture: f.qlcId, mode, startOffset: Math.round(((deg % 360) + 360) % 360) % 360 }
      }),
      algorithm: shape.algorithm,
      direction: shape.direction,
      startOffset: shape.startOffset,
      width: shape.width,
      height: shape.height,
      xOffset,
      yOffset,
      xFrequency: shape.xFrequency,
      yFrequency: shape.yFrequency,
      xPhase: shape.xPhase,
      yPhase: shape.yPhase
    })
    return id
  }

  private buildEffects(): void {
    const list = [...this.show.effects].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9))
    for (const e of list) {
      const id = this.addEfx(e, 'PhotonBoard/Effects')
      if (id !== null) this.effectMain.set(e.id, id)
    }
  }

  // ---------------------------------------------------------- timeline

  private buildShow(): void {
    const tl = this.show.timeline
    if (!tl || tl.clips.length === 0) return
    const tracks: ShowOut['tracks'] = []
    const count = Math.max(tl.trackCount, ...tl.clips.map((c) => c.trackIndex + 1))
    for (let i = 0; i < count; i++) tracks.push({ id: i, name: tl.trackNames?.[i] || `Track ${i + 1}`, functions: [] })
    for (const clip of [...tl.clips].sort((a, b) => a.startTime - b.startTime)) {
      const main = this.cuelistMain.get(clip.cuelistId)
      if (!main) { this.warn.item('warning', 'qlcplus.export.clip', 'Timeline clips of cue lists that were not exported were skipped', clip.name ?? clip.cuelistId); continue }
      if (clip.fadeIn || clip.fadeOut) this.warn.item('info', 'qlcplus.export.clipFade', 'Timeline clip fades are not carried', clip.name ?? clip.cuelistId)
      const fn: ShowOut['tracks'][number]['functions'][number] = { fid: main.fid, start: ms(clip.startTime), duration: Math.max(1, ms(clip.duration)) }
      if (clip.color && /^#[0-9a-f]{6}$/i.test(clip.color)) fn.color = clip.color.toLowerCase()
      tracks[clip.trackIndex]?.functions.push(fn)
    }
    if ((tl.markers?.length ?? 0) > 0 || (tl.zones?.length ?? 0) > 0) this.warn.add('info', 'qlcplus.export.markers', 'Timeline markers and zones are not carried')
    if (tl.timecode?.source === 'mtc') this.warn.add('info', 'qlcplus.export.timecode', 'MIDI timecode settings are not carried')
    const id = this.nextFn++
    this.functions.push({ kind: 'Show', id, name: this.show.name || 'Timeline', tracks })
  }

  private reportUnsupported(): void {
    for (const m of this.show.macros ?? []) this.warn.item('warning', 'qlcplus.export.macro', 'Macros have no QLC+ equivalent and were not exported', m.name)
    for (const p of this.show.presets) {
      if (!this.paletteOf(p)) this.warn.item('info', 'qlcplus.export.preset', 'Presets other than universal dimmer / colour presets were not exported (their values are in the cues)', p.name)
    }
    if ((this.show.speedMasters?.length ?? 0) > 0) this.warn.add('info', 'qlcplus.export.speedMasters', 'Speed masters are not carried')
    if ((this.show.stagePages?.length ?? 0) > 0) this.warn.add('info', 'qlcplus.export.stagePages', 'Stage pages are not carried (executor cells are exported as virtual console buttons)')
    if ((this.show.parked?.length ?? 0) > 0) this.warn.add('info', 'qlcplus.export.parked', 'Parked channels are not carried')
    this.warn.add('info', 'qlcplus.export.outputs', 'DMX outputs are machine settings: patch the universes to your interfaces in QLC+ (Inputs/Outputs)')
  }

  private paletteOf(p: ShowFile['presets'][number]): { type: string; value: string } | null {
    if (p.scope !== 'universal' || !p.universal) return null
    const u = p.universal
    const keys = Object.keys(u)
    if (keys.length === 1 && keys[0] === 'dimmer') return { type: 'Dimmer', value: String(Math.round(u.dimmer)) }
    if (keys.every((k) => k === 'red' || k === 'green' || k === 'blue') && keys.length > 0) {
      const hex = (v: number | undefined): string => Math.max(0, Math.min(255, Math.round(v ?? 0))).toString(16).padStart(2, '0')
      return { type: 'Color', value: `#${hex(u.red)}${hex(u.green)}${hex(u.blue)}` }
    }
    return null
  }

  // ---------------------------------------------------------- virtual console

  private widgetFor(cell: ExecutorCell, label: string): VcWidgetOut | null {
    const base = { caption: label, x: 0, y: 0, w: 80, h: 50 }
    const action = cell.mode === 'flash' || cell.mode === 'trigger' || cell.button === 'flash' || cell.button === 'temp' ? 'Flash' : 'Toggle'
    if (cell.kind === 'cuelist') {
      const m = this.cuelistMain.get(cell.id)
      if (!m) return null
      if (m.chaser !== undefined && (m.manual || cell.button === 'go' || cell.button === 'goBack')) {
        return { ...base, tag: 'CueList', functionId: m.chaser, w: 300, h: 220 }
      }
      return { ...base, tag: 'Button', functionId: m.fid, action }
    }
    if (cell.kind === 'chase') {
      const id = this.chaseMain.get(cell.id)
      return id === undefined ? null : { ...base, tag: 'Button', functionId: id, action }
    }
    if (cell.kind === 'effect') {
      const id = this.effectMain.get(cell.id)
      return id === undefined ? null : { ...base, tag: 'Button', functionId: id, action }
    }
    return null
  }

  private nameOf(cell: ExecutorCell): string {
    const lists: Record<string, { id: string; name: string }[]> = {
      cuelist: this.show.cuelists, chase: this.show.chases, effect: this.show.effects, macro: this.show.macros ?? [], group: this.show.groups, speed: this.show.speedMasters ?? []
    }
    return lists[cell.kind]?.find((o) => o.id === cell.id)?.name ?? cell.kind
  }

  private buildConsole(): { frames: VcWidgetOut[]; midiFrame: VcWidgetOut | null; gmInput?: number; midiLine?: number; feedback: boolean } {
    const frames: VcWidgetOut[] = []
    const pages: ExecutorPage[] = this.show.executor?.pages ?? []
    // Widgets per target, to attach MIDI inputs
    const widgetsByFn = new Map<number, VcWidgetOut[]>()
    const register = (w: VcWidgetOut): void => {
      if (w.functionId === undefined) return
      const l = widgetsByFn.get(w.functionId)
      if (l) l.push(w)
      else widgetsByFn.set(w.functionId, [w])
    }
    let y = 0
    pages.forEach((page, pi) => {
      const children: VcWidgetOut[] = []
      let rowHeights = [60, 60, 60, 60]
      const colX = (c: number): number => 10 + c * 90
      for (let col = 0; col < page.cells.length; col++) {
        const colFader = page.columns[col]?.fader
        const sliderRow = colFader?.kind === 'cell' ? colFader.row : colFader?.kind === 'column' ? 0 : -1
        for (let row = 0; row < (page.cells[col]?.length ?? 0); row++) {
          const cell = page.cells[col][row]
          if (!cell) continue
          const w = this.widgetFor(cell, this.nameOf(cell))
          // A scene with a playback slider: the slider (which starts / stops it) stands for the cell
          if (w && row === sliderRow && cell.kind === 'cuelist' && w.tag === 'Button') continue
          if (!w) {
            this.warn.item('info', 'qlcplus.export.cell', 'Executor cells of macros / groups / speed masters (or of objects not exported) were not exported', this.nameOf(cell))
            continue
          }
          w.color = page.columns[col]?.color
          w.x = colX(col)
          w.y = 30 + row * 60
          if (w.tag === 'CueList') rowHeights = rowHeights.map((h, r) => (r === row ? Math.max(h, w.h + 10) : h))
          children.push(w)
          register(w)
        }
        const fader = page.columns[col]?.fader
        const faderRow = fader?.kind === 'cell' ? fader.row : fader?.kind === 'column' ? 0 : -1
        const fcell = faderRow >= 0 ? page.cells[col]?.[faderRow] : null
        if (fcell) {
          const t = this.widgetFor(fcell, this.nameOf(fcell))
          const fid = t?.tag === 'CueList' ? this.cuelistMain.get(fcell.id)?.fid : t?.functionId
          if (fid !== undefined) {
            const s: VcWidgetOut = { tag: 'Slider', caption: this.nameOf(fcell), x: colX(col), y: 0, w: 80, h: 200, sliderMode: 'Playback', functionId: fid }
            children.push(s)
            register(s)
          }
        } else if (fader && fader.kind !== 'column') {
          this.warn.item('info', 'qlcplus.export.fader', 'Executor faders other than playback faders were not exported', page.name || `Page ${pi + 1}`)
        }
      }
      if (children.length === 0) return
      // Lay rows out (cue list widgets are taller), faders below the buttons
      const rowY: number[] = []
      let acc = 30
      for (let r = 0; r < 4; r++) { rowY.push(acc); acc += rowHeights[r] }
      for (const c of children) {
        if (c.tag === 'Slider') c.y = acc + 10
        else c.y = rowY[Math.round((c.y - 30) / 60)] ?? c.y
      }
      const height = acc + (children.some((c) => c.tag === 'Slider') ? 220 : 10)
      frames.push({ tag: 'Frame', caption: page.name || `Page ${pi + 1}`, x: 10, y: 10 + y, w: 10 + 8 * 90 + 10, h: height, children })
      y += height + 10
    })

    // ---- MIDI ----
    const mappings = this.show.midiMappings ?? []
    if (mappings.length === 0) return { frames, midiFrame: null, feedback: false }
    const channels = new Set(mappings.map((m) => m.source.channel))
    const line = channels.size === 1 ? Math.max(0, Math.min(15, [...channels][0] - 1)) : MIDI_OMNI
    const feedback = mappings.some((m) => m.options.feedback)
    const extra: VcWidgetOut[] = []
    let gmInput: number | undefined
    const free = (fid: number, want: (w: VcWidgetOut) => boolean): VcWidgetOut | undefined => widgetsByFn.get(fid)?.find((w) => want(w))
    const addExtra = (w: VcWidgetOut): void => {
      const i = extra.length
      w.x = 10 + (i % 8) * 90
      w.y = 30 + Math.floor(i / 8) * (w.tag === 'Slider' ? 210 : 60)
      extra.push(w)
    }
    for (const m of mappings) {
      const ch = midiToQlcChannel(m.source, line)
      const t = m.target
      const label = m.name || t.type
      const fnOf = (): number | undefined => {
        if (!t.id) return undefined
        return this.cuelistMain.get(t.id)?.fid ?? this.chaseMain.get(t.id) ?? this.effectMain.get(t.id)
      }
      switch (t.type) {
        case 'cuelist_go':
        case 'flash':
        case 'chase_toggle':
        case 'effect_toggle': {
          const fid = fnOf()
          if (fid === undefined) { this.warn.item('warning', 'qlcplus.export.midi', 'MIDI mappings whose target was not exported were skipped', label); break }
          const flash = t.type === 'flash' || m.options.behavior === 'flash' || m.options.behavior === 'trigger'
          const direct = t.type === 'cuelist_go' && m.options.behavior === 'direct'
          const cueWidget = t.type === 'cuelist_go' ? widgetsByFn.get(this.cuelistMain.get(t.id!)?.chaser ?? -1)?.find((w) => w.tag === 'CueList') : undefined
          if (cueWidget && direct && cueWidget.nextInput === undefined) { cueWidget.nextInput = ch; break }
          if (cueWidget && !direct && !flash && cueWidget.playbackInput === undefined) { cueWidget.playbackInput = ch; break }
          const w = free(fid, (x) => x.tag === 'Button' && x.input === undefined && (x.action === 'Flash') === flash)
          if (w) { w.input = ch; break }
          addExtra({ tag: 'Button', caption: label, x: 0, y: 0, w: 80, h: 50, functionId: fid, action: flash ? 'Flash' : 'Toggle', input: ch })
          break
        }
        case 'cuelist_fader': {
          const fid = fnOf()
          if (fid === undefined) { this.warn.item('warning', 'qlcplus.export.midi', 'MIDI mappings whose target was not exported were skipped', label); break }
          const w = free(fid, (x) => x.tag === 'Slider' && x.input === undefined)
          if (w) { w.input = ch; break }
          addExtra({ tag: 'Slider', caption: label, x: 0, y: 0, w: 80, h: 200, sliderMode: 'Playback', functionId: fid, input: ch })
          break
        }
        case 'master':
          if (gmInput === undefined) gmInput = ch
          else this.warn.item('info', 'qlcplus.export.midi', 'MIDI mappings not exported', label)
          break
        case 'channel': {
          const c = t.id && t.parameter ? this.channelIndex(t.id, t.parameter) : null
          if (!c) { this.warn.item('warning', 'qlcplus.export.midi', 'MIDI mappings whose target was not exported were skipped', label); break }
          addExtra({
            tag: 'Slider', caption: label, x: 0, y: 0, w: 80, h: 200, sliderMode: 'Level',
            levelChannels: [{ fixture: c.fx.qlcId, channel: c.index }],
            levelLow: Math.max(0, Math.min(255, Math.round(m.options.min))), levelHigh: Math.max(0, Math.min(255, Math.round(m.options.max))), input: ch
          })
          break
        }
        case 'blackout':
          addExtra({ tag: 'Button', caption: label, x: 0, y: 0, w: 80, h: 50, action: 'Blackout', input: ch })
          break
        default:
          this.warn.item('warning', 'qlcplus.export.midiTarget', 'MIDI mappings with no QLC+ equivalent were not exported', `${label} (${t.type})`)
      }
      if (m.options.encoding === 'relative') this.warn.item('info', 'qlcplus.export.relative', 'Relative (encoder) MIDI mappings were exported as absolute', label)
    }
    let midiFrame: VcWidgetOut | null = null
    if (extra.length) {
      const rows = Math.ceil(extra.length / 8)
      midiFrame = { tag: 'Frame', caption: 'MIDI', x: 10, y: 10 + y, w: 10 + 8 * 90 + 10, h: 40 + rows * 210, children: extra }
    }
    this.warn.add('info', 'qlcplus.export.midiLine', `MIDI inputs use input line 0 of universe 1${line === MIDI_OMNI ? ' in OMNI mode' : `, MIDI channel ${line + 1}`}: pick your controller in QLC+ Inputs/Outputs`, { channel: line === MIDI_OMNI ? 'OMNI' : line + 1 })
    return { frames, midiFrame, gmInput, midiLine: line, feedback }
  }

  // ---------------------------------------------------------- writing

  private write(): string {
    const console = this.buildConsole()
    const x = new XmlWriter()
    x.raw('<?xml version="1.0" encoding="UTF-8"?>')
    x.raw('<!DOCTYPE Workspace>')
    x.start('Workspace', { xmlns: 'http://www.qlcplus.org/Workspace', CurrentWindow: 'VirtualConsole' })
    x.start('Creator')
    x.el('Name', 'Q Light Controller Plus')
    x.el('Version', QLC_EXPORT_VERSION)
    x.el('Author', 'PhotonBoard export')
    x.end()

    x.start('Engine')
    // ---- I/O ----
    x.start('InputOutputMap')
    x.el('BeatGenerator', undefined, { BeatType: 'Disabled', BPM: 0 })
    const universes = Math.max(4, ...this.fixtures.map((f) => f.entry.universe + 1))
    for (let u = 0; u < universes; u++) {
      x.start('Universe', { Name: `Universe ${u + 1}`, ID: u })
      if (u === 0 && console.midiLine !== undefined) {
        x.start('Input', { Plugin: 'MIDI', Line: 0 })
        if (console.midiLine !== 0) x.el('PluginParameters', undefined, { midichannel: console.midiLine })
        x.end()
        if (console.feedback) {
          x.start('Feedback', { Plugin: 'MIDI', Line: 0 })
          if (console.midiLine !== 0) x.el('PluginParameters', undefined, { midichannel: console.midiLine })
          x.end()
        }
      }
      x.end()
    }
    x.end()

    // ---- fixtures ----
    for (const f of this.fixtures) {
      x.start('Fixture')
      x.el('Manufacturer', f.manufacturer)
      x.el('Model', f.model)
      x.el('Mode', f.modeName)
      x.el('ID', f.qlcId)
      x.el('Name', f.entry.name)
      x.el('Universe', f.entry.universe)
      x.el('Address', Math.max(0, f.entry.address - 1))
      x.el('Channels', f.channels)
      x.end()
    }

    // ---- groups ----
    this.show.groups.forEach((g, gi) => {
      const members = g.fixtureIds.map((id) => this.byPatchId.get(id)).filter((f): f is FixtureOut => !!f)
      const totalHeads = members.reduce((s, f) => s + f.heads, 0)
      x.start('FixtureGroup', { ID: gi })
      x.el('Name', g.name)
      x.el('Size', undefined, { X: Math.max(1, totalHeads), Y: 1 })
      let col = 0
      for (const f of members) {
        for (let h = 0; h < f.heads; h++) x.el('Head', h, { X: col++, Y: 0, Fixture: f.qlcId })
      }
      x.end()
    })

    // ---- palettes ----
    let paletteId = 0
    for (const p of this.show.presets) {
      const pal = this.paletteOf(p)
      if (pal) x.el('Palette', undefined, { ID: paletteId++, Type: pal.type, Name: p.name, Value: pal.value })
    }

    // ---- functions ----
    for (const fn of this.functions) this.writeFunction(x, fn)

    // ---- monitor (2D, front view) ----
    this.writeMonitor(x)
    x.end() // Engine

    // ---- virtual console ----
    x.start('VirtualConsole')
    x.start('Frame', { Caption: '' })
    this.writeAppearance(x)
    let wid = 0
    const writeWidget = (w: VcWidgetOut): void => {
      const common: Attrs = { Caption: w.caption, ID: wid++ }
      if (w.tag === 'Frame') {
        x.start('Frame', common)
        this.writeAppearance(x)
        x.el('WindowState', undefined, { Visible: 'True', X: w.x, Y: w.y, Width: w.w, Height: w.h })
        x.el('AllowChildren', 'True')
        x.el('AllowResize', 'True')
        x.el('ShowHeader', 'True')
        x.el('ShowEnableButton', 'False')
        x.el('Collapsed', 'False')
        x.el('Disabled', 'False')
        for (const c of w.children ?? []) writeWidget(c)
        x.end()
      } else if (w.tag === 'Button') {
        x.start('Button', { ...common, Icon: '' })
        x.el('WindowState', undefined, { Visible: 'True', X: w.x, Y: w.y, Width: w.w, Height: w.h })
        this.writeAppearance(x, w.color)
        x.el('Function', undefined, { ID: w.functionId ?? 4294967295 })
        x.el('Action', w.action ?? 'Toggle')
        x.el('Intensity', 100, { Adjust: 'False' })
        if (w.input !== undefined) x.el('Input', undefined, { Universe: 0, Channel: w.input })
        x.end()
      } else if (w.tag === 'CueList') {
        x.start('CueList', common)
        x.el('WindowState', undefined, { Visible: 'True', X: w.x, Y: w.y, Width: w.w, Height: w.h })
        this.writeAppearance(x, w.color)
        x.el('Chaser', w.functionId ?? 4294967295)
        x.el('NextPrevBehavior', 0)
        x.start('Next')
        if (w.nextInput !== undefined) x.el('Input', undefined, { Universe: 0, Channel: w.nextInput })
        x.end()
        x.start('Previous').end()
        x.start('Playback')
        if (w.playbackInput !== undefined) x.el('Input', undefined, { Universe: 0, Channel: w.playbackInput })
        x.end()
        x.start('Stop').end()
        x.end()
      } else {
        x.start('Slider', { ...common, WidgetStyle: 'Slider', InvertedAppearance: 'false' })
        x.el('WindowState', undefined, { Visible: 'True', X: w.x, Y: w.y, Width: w.w, Height: w.h })
        this.writeAppearance(x, w.color)
        if (w.input !== undefined) x.el('Input', undefined, { Universe: 0, Channel: w.input })
        const level = w.sliderMode === 'Level'
        x.el('SliderMode', level ? 'Level' : 'Playback', level ? { ValueDisplayStyle: 'Exact', ClickAndGoType: 'None', Monitor: 'false' } : { ValueDisplayStyle: 'Exact', ClickAndGoType: 'None' })
        x.start('Level', { LowLimit: w.levelLow ?? 0, HighLimit: w.levelHigh ?? 255, Value: 0 })
        for (const c of w.levelChannels ?? []) x.el('Channel', c.channel, { Fixture: c.fixture })
        x.end()
        x.start('Playback')
        x.el('Function', level ? 4294967295 : w.functionId ?? 4294967295)
        x.end()
        x.end()
      }
    }
    for (const f of console.frames) writeWidget(f)
    if (console.midiFrame) writeWidget(console.midiFrame)
    x.end() // root Frame
    x.start('Properties')
    x.el('Size', undefined, { Width: 1920, Height: 1080 })
    x.start('GrandMaster', { ChannelMode: 'Intensity', ValueMode: 'Reduce', SliderMode: 'Normal' })
    if (console.gmInput !== undefined) x.el('Input', undefined, { Universe: 0, Channel: console.gmInput })
    x.end()
    x.end() // Properties
    x.end() // VirtualConsole

    x.start('SimpleDesk')
    x.start('Engine').end()
    x.end()
    x.end() // Workspace
    return x.toString()
  }

  private writeAppearance(x: XmlWriter, color?: string): void {
    x.start('Appearance')
    x.el('FrameStyle', 'None')
    x.el('ForegroundColor', 'Default')
    const bg = qrgb(color)
    x.el('BackgroundColor', bg !== undefined ? bg : 'Default')
    x.el('BackgroundImage', 'None')
    x.el('Font', 'Default')
    x.end()
  }

  private commonAttrs(fn: { id: number; name: string; path?: string }, type: string): Attrs {
    const a: Attrs = { ID: fn.id, Type: type, Name: fn.name }
    if (fn.path) a.Path = fn.path
    return a
  }

  private writeFunction(x: XmlWriter, fn: FunctionOut): void {
    switch (fn.kind) {
      case 'Scene': {
        x.start('Function', this.commonAttrs(fn, 'Scene'))
        x.el('Speed', undefined, { FadeIn: fn.fadeIn, FadeOut: fn.fadeOut, Duration: 0 })
        for (const [fxi, vals] of fn.values) x.el('FixtureVal', vals.map(([c, v]) => `${c},${v}`).join(','), { ID: fxi })
        x.end()
        break
      }
      case 'Chaser': {
        x.start('Function', this.commonAttrs(fn, 'Chaser'))
        x.el('Speed', undefined, { FadeIn: 0, FadeOut: 0, Duration: 0 })
        x.el('Direction', fn.direction)
        x.el('RunOrder', fn.runOrder)
        x.el('SpeedModes', undefined, { FadeIn: 'PerStep', FadeOut: 'PerStep', Duration: 'PerStep' })
        fn.steps.forEach((s, i) => {
          const a: Attrs = { Number: i, FadeIn: s.fadeIn, Hold: s.hold, FadeOut: s.fadeOut }
          if (s.note) a.Note = s.note
          x.el('Step', s.fid, a)
        })
        x.end()
        break
      }
      case 'EFX': {
        x.start('Function', this.commonAttrs(fn, 'EFX'))
        for (const f of fn.fixtures) {
          x.start('Fixture')
          x.el('ID', f.fixture)
          x.el('Head', 0)
          x.el('Mode', f.mode)
          x.el('Direction', 'Forward')
          x.el('StartOffset', f.startOffset)
          x.end()
        }
        x.el('PropagationMode', 'Parallel')
        x.el('Speed', undefined, { FadeIn: fn.fadeIn, FadeOut: fn.fadeOut, Duration: fn.duration })
        x.el('Direction', fn.direction)
        x.el('RunOrder', fn.runOrder)
        x.el('Algorithm', fn.algorithm)
        x.el('Width', fn.width)
        x.el('Height', fn.height)
        x.el('Rotation', 0)
        x.el('StartOffset', fn.startOffset)
        x.el('IsRelative', 0)
        x.el('DimmerControl', 0)
        x.start('Axis', { Name: 'X' })
        x.el('Offset', fn.xOffset)
        x.el('Frequency', fn.xFrequency)
        x.el('Phase', fn.xPhase)
        x.end()
        x.start('Axis', { Name: 'Y' })
        x.el('Offset', fn.yOffset)
        x.el('Frequency', fn.yFrequency)
        x.el('Phase', fn.yPhase)
        x.end()
        x.end()
        break
      }
      case 'Collection': {
        x.start('Function', this.commonAttrs(fn, 'Collection'))
        fn.functions.forEach((fid, i) => x.el('Step', fid, { Number: i }))
        x.end()
        break
      }
      case 'Show': {
        x.start('Function', this.commonAttrs(fn, 'Show'))
        x.el('TimeDivision', undefined, { Type: 'Time', BPM: 120 })
        for (const t of fn.tracks) {
          x.start('Track', { ID: t.id, Name: t.name, isMute: 0 })
          for (const sf of t.functions) {
            const a: Attrs = { ID: sf.fid, StartTime: sf.start, Duration: sf.duration }
            if (sf.color) a.Color = sf.color
            x.el('ShowFunction', undefined, a)
          }
          x.end()
        }
        x.end()
        break
      }
    }
  }

  private writeMonitor(x: XmlWriter): void {
    const placed = this.fixtures.filter((f) => f.entry.position3D)
    if (placed.length === 0) return
    const room = this.show.roomConfig
    const W = Math.max(1, Math.ceil(room?.width ?? Math.max(5, ...placed.map((f) => Math.abs(f.entry.position3D!.x) * 2 + 1))))
    const H = Math.max(1, Math.ceil(room?.height ?? Math.max(3, ...placed.map((f) => f.entry.position3D!.y + 0.5))))
    const D = Math.max(1, Math.ceil(room?.depth ?? 5))
    x.start('Monitor', { DisplayMode: 1, ShowLabels: 1 })
    x.el('ChannelStyle', 0)
    x.el('ValueStyle', 0)
    x.el('Grid', undefined, { Width: W, Height: H, Depth: D, Units: 0 })
    for (const f of placed) {
      const p = f.entry.position3D!
      // Front view: X from the left edge, Y from the top (QLC+ 2D monitor, mm)
      x.el('FxItem', undefined, { ID: f.qlcId, XPos: Math.round((p.x + W / 2) * 1000), YPos: Math.round(Math.max(0, H - p.y) * 1000) })
    }
    x.end()
    this.warn.add('info', 'qlcplus.export.positions', 'Fixture positions were written to the 2D monitor as a front view (depth is not carried)')
  }
}

