// ============================================================
// PhotonBoard — QLC+ workspace (.qxw) importer
//
// QLC+ model → PhotonBoard show fragment:
//   Fixture (+ Generic dimmer packs / RGB panels) → patch
//   Monitor (2D / 3D positions)                  → position3D, room
//   FixtureGroup / ChannelsGroup                 → groups
//   Palette (QLC+ 5)                             → presets
//   Scene                                        → one-cue cuelist
//   Chaser / Sequence                            → cuelist (cue stack) or chase
//   EFX                                          → pan / tilt (dimmer) effect
//   RGBMatrix                                    → colour effect (approximation)
//   Collection                                   → one-cue cuelist + effects, or macro
//   Show                                         → timeline
//   Virtual console buttons / cue lists / sliders → executor pages + MIDI mappings
// Everything that cannot be carried is reported as an ImportWarning.
// Pure module (no Electron).
// ============================================================

import type { ImportContext, ImportedShowFragment, ImportWarning, ImportWarningLevel } from '../../../shared/interchange'
import { emptyFragment } from '../../../shared/interchange'
import {
  defaultTrussBars,
  type Chase,
  type ChaseStep,
  type Cue,
  type CueChannelValue,
  type Cuelist,
  type Effect,
  type EffectChannel,
  type ExecutorCell,
  type ExecutorPage,
  type FixtureDefinition,
  type FixtureMode,
  type Group,
  type Macro,
  type MidiMapping,
  type MidiTargetType,
  type PatchEntry,
  type Preset,
  type PresetType,
  type TimelineClip,
  type WaveformKeyframe,
  type WaveformType
} from '../../../shared/types'
import { createExecutorPage, executorLayoutFromPages, EXECUTOR_COLUMN_COUNT, EXECUTOR_ROW_COUNT, MAX_EXECUTOR_PAGES } from '../../../shared/show-format'
import { channelFromFit, fitAxis, sampleEfx, type EfxShapeParams } from './efx'
import { genericDimmerDefinition, rgbPanelDefinition, unknownFixtureDefinition } from './generic'
import { qlcChannelToMidi, MIDI_OMNI } from './midi'
import {
  decodeWorkspaceText,
  parseWorkspace,
  QLC_INFINITE,
  QLC_INVALID_ID,
  type QlcChaser,
  type QlcCollection,
  type QlcEfx,
  type QlcFixture,
  type QlcFunction,
  type QlcInputSource,
  type QlcRgbMatrix,
  type QlcScene,
  type QlcSceneValue,
  type QlcShow,
  type QlcVcWidget,
  type QlcWorkspace
} from './model'

export const QLC_FORMAT_ID = 'qlcplus-workspace'

const GROUP_COLORS = ['#e85d04', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#eab308', '#06b6d4', '#f97316', '#ec4899', '#84cc16']

// ------------------------------------------------------------ warnings

class Warnings {
  readonly out: ImportWarning[] = []
  private lists = new Map<string, { level: ImportWarningLevel; message: string; items: string[] }>()

  add(level: ImportWarningLevel, code: string, message: string, params?: Record<string, string | number>): void {
    const w: ImportWarning = { level, code, message }
    if (params) w.params = params
    this.out.push(w)
  }

  /** One warning per code listing the items ("… : A, B, C (+12 more)") */
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

// ------------------------------------------------------------ helpers

interface PatchedFixture {
  qlc: QlcFixture
  entry: PatchEntry
  def: FixtureDefinition | null
  mode: FixtureMode | null
}

type Target = { kind: 'cuelist' | 'chase' | 'effect' | 'macro'; id: string; name: string }

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function fileBaseName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.qxw$/i, '') || 'QLC+ workspace'
}

function rgbOf(qrgb: number | undefined): [number, number, number] {
  const v = (qrgb ?? 0xffffff) & 0xffffff
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

const PATH_CUELIST = /(^|\/|\b)(cue ?lists?|cue ?stacks?|sequences?|scenes)(\/|\b|$)/i
const PATH_CHASE = /(^|\/|\b)chases?(\/|\b|$)/i

// ------------------------------------------------------------ importer

export async function importQlcWorkspace(bytes: Uint8Array, fileName: string, ctx: ImportContext): Promise<ImportedShowFragment> {
  const ws = parseWorkspace(decodeWorkspaceText(bytes))
  return new WorkspaceImporter(ws, fileName, ctx).run()
}

class WorkspaceImporter {
  private frag: ImportedShowFragment
  private warn = new Warnings()
  private fixtures = new Map<number, PatchedFixture>()
  private fnById = new Map<number, QlcFunction>()
  private targets = new Map<number, Target[]>()
  private bpm: number
  private cuelistNumber = 1
  private chaseNumber = 1
  private effectNumber = 1
  private macroNumber = 1

  constructor(private ws: QlcWorkspace, fileName: string, private ctx: ImportContext) {
    this.frag = emptyFragment(QLC_FORMAT_ID, fileBaseName(fileName))
    const app = [ws.creator.name, ws.creator.version].filter(Boolean).join(' ')
    if (app) this.frag.sourceApp = app
    this.bpm = ws.beatBpm ?? 120
    for (const f of ws.functions) this.fnById.set(f.id, f)
  }

  async run(): Promise<ImportedShowFragment> {
    this.importIo()
    await this.importFixtures()
    this.importPositions()
    this.importGroups()
    this.importPalettes()
    this.importFunctions()
    this.importShows()
    this.importVirtualConsole()
    this.importMisc()
    this.frag.warnings = this.warn.flush()
    return this.frag
  }

  // ---------------------------------------------------------- I/O

  private importIo(): void {
    for (const u of this.ws.universes) {
      for (const o of u.outputs) {
        const p = o.params
        if (o.plugin === 'ArtNet') {
          const ip = p.outputIP || o.uid || o.name || ''
          const uni = p.outputUni !== undefined ? Number(p.outputUni) : u.index
          this.warn.add('info', 'qlcplus.output.artnet',
            `Universe ${u.index + 1} ("${u.name}") was sent by Art-Net${ip ? ` to ${ip}` : ''}, Art-Net universe ${uni}: configure the matching output in PhotonBoard (outputs are machine settings, not show data)`,
            { universe: u.index + 1, ip, artnetUniverse: uni })
        } else if (o.plugin === 'E1.31') {
          const target = p.multicast === '0' ? (p.ucastIP ?? '') : 'multicast'
          this.warn.add('info', 'qlcplus.output.e131',
            `Universe ${u.index + 1} ("${u.name}") was sent by sACN (E1.31)${target ? ` (${target})` : ''}${p.universe ? `, sACN universe ${p.universe}` : ''}: configure the output in PhotonBoard`,
            { universe: u.index + 1, target, sacnUniverse: p.universe ?? '' })
        } else {
          this.warn.add('info', 'qlcplus.output.other',
            `Universe ${u.index + 1} ("${u.name}") was sent to ${o.plugin}${o.name ? ` "${o.name}"` : ''}: configure the output in PhotonBoard`,
            { universe: u.index + 1, plugin: o.plugin, line: o.name ?? '' })
        }
      }
      if (u.passthrough) this.warn.item('info', 'qlcplus.passthrough', 'DMX input passthrough is not supported (universes)', String(u.index + 1))
    }
    const maxUniverse = Math.max(-1, ...this.ws.fixtures.map((f) => f.universe))
    if (maxUniverse >= 16) this.warn.add('warning', 'qlcplus.universeRange', `The workspace patches ${maxUniverse + 1} universes; PhotonBoard drives 16`, { count: maxUniverse + 1 })
  }

  // ---------------------------------------------------------- fixtures

  private embedded = new Map<string, FixtureDefinition>()

  private embed(def: FixtureDefinition): void {
    if (!this.embedded.has(def.id)) {
      this.embedded.set(def.id, def)
      this.frag.fixtures.push(def)
    }
  }

  private async resolve(manufacturer: string, model: string, channels: number): Promise<FixtureDefinition | null> {
    try {
      return await this.ctx.findFixture(manufacturer, model, channels > 0 ? channels : undefined)
    } catch {
      return null
    }
  }

  private async importFixtures(): Promise<void> {
    const cache = new Map<string, Promise<FixtureDefinition | null>>()
    for (const f of this.ws.fixtures) {
      if (this.fixtures.has(f.id)) {
        this.warn.item('warning', 'qlcplus.duplicateFixtureId', 'Fixtures with a duplicate ID were skipped', f.name || String(f.id))
        continue
      }
      let defId: string
      let modeName: string
      let def: FixtureDefinition | null = null
      let mode: FixtureMode | null = null
      if (f.model === 'Generic') {
        const g = genericDimmerDefinition(f.channels || 1)
        defId = g.id
        modeName = g.mode
        if (g.def) { this.embed(g.def); def = g.def; mode = g.def.modes[0] }
        else mode = { name: '1ch', channels: ['Dimmer'], channelCount: 1 }
      } else if (f.model === 'RGBPanel') {
        const g = rgbPanelDefinition(f.mode, f.channels)
        defId = g.id
        modeName = g.mode
        if (g.def) { this.embed(g.def); def = g.def; mode = g.def.modes[0] }
        else mode = g.id === 'generic/rgb'
          ? { name: '3ch', channels: ['Red', 'Green', 'Blue'], channelCount: 3 }
          : { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 }
      } else {
        const key = `${f.manufacturer}\u0000${f.model}`
        let p = cache.get(key)
        if (!p) { p = this.resolve(f.manufacturer, f.model, f.channels); cache.set(key, p) }
        const found = await p
        if (found) {
          const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
          mode = found.modes.find((m) => m.name === f.mode)
            ?? found.modes.find((m) => compact(m.name) === compact(f.mode))
            ?? null
          if (!mode) {
            const byCount = found.modes.filter((m) => m.channelCount === f.channels)
            if (byCount.length > 0) {
              mode = byCount[0]
              this.warn.item('info', 'qlcplus.modeByChannelCount',
                `Mode not found by name, matched by channel count (check the channel layout)`,
                `${f.name} (${f.manufacturer} ${f.model} "${f.mode}" → "${mode.name}")`)
            }
          } else if (f.channels > 0 && mode.channelCount !== f.channels) {
            this.warn.item('info', 'qlcplus.modeChannelCount', 'Mode channel count differs from the workspace', `${f.name} (${mode.channelCount} vs ${f.channels})`)
          }
          // Library / catalog definitions are referenced by id (the merge installs catalog ones)
          if (mode) def = found
        }
        if (def && mode) {
          defId = def.id
          modeName = mode.name
        } else {
          const u = unknownFixtureDefinition(f.manufacturer, f.model, f.mode, f.channels)
          this.embed(u)
          def = u
          mode = u.modes[0]
          defId = u.id
          modeName = mode.name
          this.warn.item('warning', 'qlcplus.fixtureNotFound',
            found ? 'Fixture mode not found: patched as generic channels' : 'Fixture type not found in the library / catalog: patched as generic channels (install the definition, then change the fixture type)',
            `${f.manufacturer} ${f.model}${f.mode ? ` (${f.mode})` : ''}`)
        }
      }
      const entry: PatchEntry = {
        id: `qlc-fx-${f.id}`,
        fixtureDefId: defId,
        modeName,
        universe: f.universe,
        address: Math.max(1, Math.min(512, f.address + 1)),
        name: f.name || (def?.name ?? f.model),
        groupIds: [],
        fid: f.id + 1
      }
      const count = mode?.channelCount ?? f.channels
      if (!f.crossUniverse && f.address + count > 512) {
        this.warn.item('warning', 'qlcplus.addressRange', 'Fixtures run past channel 512', f.name)
      }
      if (f.crossUniverse) this.warn.item('info', 'qlcplus.crossUniverse', 'Cross-universe fixtures are patched in their first universe only', f.name)
      this.frag.patch.push(entry)
      this.fixtures.set(f.id, { qlc: f, entry, def, mode })
    }
  }

  /** Channel name of a fixture-relative channel index */
  private channelName(fxi: number, channel: number): { fixtureId: string; channelName: string } | null {
    const fx = this.fixtures.get(fxi)
    if (!fx || !fx.mode) return null
    const name = fx.mode.channels[channel]
    if (name === undefined) return null
    return { fixtureId: fx.entry.id, channelName: name }
  }

  private values(values: QlcSceneValue[], what: string): CueChannelValue[] {
    const out: CueChannelValue[] = []
    let dropped = 0
    for (const v of values) {
      const ch = this.channelName(v.fxi, v.channel)
      if (!ch) { dropped++; continue }
      out.push({ fixtureId: ch.fixtureId, channelName: ch.channelName, value: Math.max(0, Math.min(255, v.value)) })
    }
    if (dropped > 0) this.warn.item('warning', 'qlcplus.droppedValues', 'Values for missing fixtures / channels were dropped', `${what} (${dropped})`)
    return out
  }

  // ---------------------------------------------------------- positions

  private importPositions(): void {
    const mon = this.ws.monitor
    if (!mon || mon.items.length === 0) return
    const unit = mon.gridUnits === 1 ? 0.3048 : 1
    const W = Math.max(1, mon.gridWidth * unit)
    const H = Math.max(1, mon.gridHeight * unit)
    const D = Math.max(1, mon.gridDepth * unit)
    const is3d = mon.pointOfView !== 0 || mon.items.some((i) => i.hasZ)
    let placed = 0
    let rotated = 0
    for (const item of mon.items) {
      if (item.head !== 0 || item.linked !== 0) continue
      const fx = this.fixtures.get(item.fixture)
      if (!fx) continue
      const x = round3(item.x / 1000 - W / 2)
      fx.entry.position3D = is3d
        ? { x, y: round3(item.y / 1000), z: round3(D / 2 - item.z / 1000) }
        : { x, y: round3(Math.max(0, H - item.y / 1000)), z: 0 }
      if (item.rx || item.ry || item.rz) rotated++
      placed++
    }
    if (placed === 0) return
    this.frag.roomConfig = { width: round3(W), depth: round3(D), height: round3(H), trussBars: defaultTrussBars(W, D, H), stageEdgeZ: 0 }
    this.warn.add('info', is3d ? 'qlcplus.positions3d' : 'qlcplus.positions2d',
      is3d
        ? `${placed} fixture positions imported from the 3D view (stage ${round3(W)} × ${round3(D)} m, ${round3(H)} m high)`
        : `${placed} fixture positions imported from the 2D monitor as a front view (QLC+'s own conversion); check the depth in the 3D view`,
      { count: placed })
    if (rotated > 0) this.warn.add('info', 'qlcplus.rotations', `${rotated} fixture rotations of the QLC+ monitor were not imported (set the mounting in the 3D view)`, { count: rotated })
  }

  // ---------------------------------------------------------- groups

  private importGroups(): void {
    let color = 0
    let maxNumber = 0
    for (const g of this.ws.fixtureGroups) {
      const heads = [...g.heads].sort((a, b) => a.y - b.y || a.x - b.x)
      const ids: string[] = []
      for (const h of heads) {
        const fx = this.fixtures.get(h.fixture)
        if (fx && !ids.includes(fx.entry.id)) ids.push(fx.entry.id)
      }
      const group: Group = { id: `qlc-grp-${g.id}`, name: g.name || `Group ${g.id + 1}`, color: GROUP_COLORS[color++ % GROUP_COLORS.length], fixtureIds: ids, number: g.id + 1 }
      maxNumber = Math.max(maxNumber, group.number!)
      this.frag.groups.push(group)
      if (heads.some((h) => h.head > 0)) this.warn.item('info', 'qlcplus.groupHeads', 'Groups made of fixture heads (pixels) became groups of whole fixtures', group.name)
    }
    for (const cg of this.ws.channelsGroups) {
      const ids: string[] = []
      for (const c of cg.channels) {
        const fx = this.fixtures.get(c.fxi)
        if (fx && !ids.includes(fx.entry.id)) ids.push(fx.entry.id)
      }
      if (ids.length === 0) continue
      this.frag.groups.push({ id: `qlc-chgrp-${cg.id}`, name: cg.name || `Channels ${cg.id + 1}`, color: GROUP_COLORS[color++ % GROUP_COLORS.length], fixtureIds: ids, number: ++maxNumber })
      this.warn.item('info', 'qlcplus.channelsGroups', 'Channel groups became fixture groups (the channel selection is not kept)', cg.name)
    }
    for (const g of this.frag.groups) {
      for (const id of g.fixtureIds) this.frag.patch.find((p) => p.id === id)?.groupIds.push(g.id)
    }
  }

  // ---------------------------------------------------------- palettes (QLC+ 5)

  private importPalettes(): void {
    const numbers: Partial<Record<PresetType, number>> = {}
    const next = (t: PresetType): number => (numbers[t] = (numbers[t] ?? 0) + 1)
    for (const p of this.ws.palettes) {
      const base = { id: `qlc-pal-${p.id}`, name: p.name || `Palette ${p.id + 1}`, values: {} as Preset['values'] }
      switch (p.type) {
        case 'Dimmer': {
          const v = Math.max(0, Math.min(255, Math.round(Number(p.value) || 0)))
          this.frag.presets.push({ ...base, type: 'intensity', number: next('intensity'), scope: 'universal', universal: { dimmer: v } })
          break
        }
        case 'Color': {
          const m = /^#?([0-9a-f]{6})/i.exec(p.value.trim())
          if (!m) { this.warn.item('warning', 'qlcplus.palette', 'Palettes not imported', p.name); break }
          const n = parseInt(m[1], 16)
          this.frag.presets.push({ ...base, type: 'color', number: next('color'), scope: 'universal', universal: { red: (n >> 16) & 255, green: (n >> 8) & 255, blue: n & 255 } })
          break
        }
        case 'Pan':
        case 'Tilt':
        case 'PanTilt': {
          const parts = p.value.split(',').map((s) => Number(s.trim()))
          const pan = p.type === 'Tilt' ? undefined : parts[0]
          const tilt = p.type === 'Pan' ? undefined : p.type === 'Tilt' ? parts[0] : parts[1]
          const typeValues: Record<string, Record<string, number>> = {}
          for (const fx of this.fixtures.values()) {
            if (!fx.def || !fx.mode || typeValues[fx.def.id]) continue
            const vals: Record<string, number> = {}
            const panCh = fx.mode.channels.find((c) => fx.def!.channels[c]?.type === 'pan' && !fx.def!.channels[c]?.fineOf)
            const tiltCh = fx.mode.channels.find((c) => fx.def!.channels[c]?.type === 'tilt' && !fx.def!.channels[c]?.fineOf)
            if (pan !== undefined && Number.isFinite(pan) && panCh) vals[panCh] = Math.max(0, Math.min(255, Math.round((pan / (fx.def.physical?.panRange || 540)) * 255)))
            if (tilt !== undefined && Number.isFinite(tilt) && tiltCh) vals[tiltCh] = Math.max(0, Math.min(255, Math.round((tilt / (fx.def.physical?.tiltRange || 270)) * 255)))
            if (Object.keys(vals).length) typeValues[fx.def.id] = vals
          }
          if (Object.keys(typeValues).length === 0) { this.warn.item('warning', 'qlcplus.palette', 'Palettes not imported', p.name); break }
          this.frag.presets.push({ ...base, type: 'position', number: next('position'), scope: 'global', typeValues })
          break
        }
        default:
          this.warn.item('warning', 'qlcplus.palette', 'Palettes not imported', `${p.name} (${p.type})`)
      }
    }
  }

  // ---------------------------------------------------------- functions

  private seconds(raw: number, fn: { tempo: 'Time' | 'Beats' }): number {
    if (raw >= QLC_INFINITE) return Infinity
    if (fn.tempo === 'Beats') return round3((raw / 1000) * (60 / this.bpm))
    return round3(raw / 1000)
  }

  private fade(raw: number, fn: { tempo: 'Time' | 'Beats' }): number {
    const s = this.seconds(raw, fn)
    return Number.isFinite(s) ? Math.min(3600, s) : 0
  }

  /** How each function is referenced */
  private usage(): { stepRefs: Set<number>; otherRefs: Set<number>; collectionRefs: Set<number>; cueListChasers: Set<number>; showRefs: Set<number> } {
    const stepRefs = new Set<number>()
    const otherRefs = new Set<number>()
    const collectionRefs = new Set<number>()
    const cueListChasers = new Set<number>()
    const showRefs = new Set<number>()
    for (const f of this.ws.functions) {
      if (f.type === 'Chaser') for (const s of f.steps) stepRefs.add(s.fid)
      if (f.type === 'Sequence' && f.boundScene !== undefined) stepRefs.add(f.boundScene)
      if (f.type === 'Collection') for (const id of f.functions) collectionRefs.add(id)
      if (f.type === 'Show') for (const t of f.tracks) for (const sf of t.functions) { showRefs.add(sf.fid); otherRefs.add(sf.fid) }
    }
    const walk = (w: QlcVcWidget): void => {
      if (w.functionId !== undefined && w.functionId !== QLC_INVALID_ID) otherRefs.add(w.functionId)
      if (w.playbackFunction !== undefined && w.playbackFunction !== QLC_INVALID_ID) otherRefs.add(w.playbackFunction)
      if (w.chaserId !== undefined && w.chaserId !== QLC_INVALID_ID) { otherRefs.add(w.chaserId); cueListChasers.add(w.chaserId) }
      for (const fid of w.functions ?? []) otherRefs.add(fid)
      for (const c of w.children ?? []) walk(c)
    }
    if (this.ws.virtualConsole) walk(this.ws.virtualConsole.root)
    if (this.ws.autostartFunction !== undefined) otherRefs.add(this.ws.autostartFunction)
    return { stepRefs, otherRefs, collectionRefs, cueListChasers, showRefs }
  }

  private collectionKind = new Map<number, 'cuelist' | 'macro'>()

  private kindOfCollection(c: QlcCollection, depth = 0): 'cuelist' | 'macro' {
    const known = this.collectionKind.get(c.id)
    if (known) return known
    if (depth > 8) return 'macro'
    let kind: 'cuelist' | 'macro' = 'cuelist'
    for (const id of c.functions) {
      const f = this.fnById.get(id)
      if (!f) continue
      if (f.type === 'Scene' || f.type === 'EFX' || f.type === 'RGBMatrix') continue
      if (f.type === 'Collection' && f.id !== c.id && this.kindOfCollection(f, depth + 1) === 'cuelist') continue
      kind = 'macro'
    }
    this.collectionKind.set(c.id, kind)
    return kind
  }

  private importFunctions(): void {
    const use = this.usage()
    const fns = [...this.ws.functions].sort((a, b) => a.id - b.id)
    const macroCollections: QlcCollection[] = []
    // Collections first decide which members must exist on their own
    const macroMembers = new Set<number>()
    for (const f of fns) {
      if (f.type !== 'Collection') continue
      if (this.kindOfCollection(f) === 'macro') { macroCollections.push(f); for (const id of f.functions) macroMembers.add(id) }
    }
    for (const f of fns) {
      switch (f.type) {
        case 'Scene': {
          const standalone = use.otherRefs.has(f.id) || macroMembers.has(f.id) || (!use.stepRefs.has(f.id) && !use.collectionRefs.has(f.id) && !f.hidden)
          if (standalone) this.addSceneCuelist(f)
          break
        }
        case 'Chaser':
        case 'Sequence': {
          const asCuelist = use.cueListChasers.has(f.id) || use.showRefs.has(f.id) || PATH_CUELIST.test(f.path)
            || (!PATH_CHASE.test(f.path) && (f.runOrder === 'SingleShot' || this.hasManualStep(f)))
          if (!f.steps.some((st) => st.values || this.fnById.get(st.fid)?.type === 'Scene')) {
            this.warn.item('warning', 'qlcplus.chaserNoScenes', 'Chasers of RGB matrices / EFX / other chasers were not imported (start those functions from executors instead)', f.name)
          } else if (asCuelist) this.addChaserCuelist(f)
          else this.addChase(f)
          if (use.stepRefs.has(f.id)) this.warn.item('warning', 'qlcplus.nestedChaser', 'Chasers used as steps of other chasers are not nested in PhotonBoard', f.name)
          break
        }
        case 'EFX':
          this.addEfx(f)
          break
        case 'RGBMatrix':
          this.addRgbMatrix(f)
          break
        case 'Collection':
          if (this.kindOfCollection(f) === 'cuelist') this.addCollectionCuelist(f)
          break
        case 'Show':
          break
        case 'Script':
          this.warn.item('warning', 'qlcplus.script', 'Scripts are not supported (rebuild them as macros)', f.name)
          break
        case 'Audio':
        case 'Video':
          this.warn.item('warning', 'qlcplus.media', 'Audio / video functions are not supported', f.name)
          break
        default:
          this.warn.item('warning', 'qlcplus.unknownFunction', 'Unknown function types skipped', `${f.name} (${(f as { source?: string }).source ?? '?'})`)
      }
    }
    // Macro collections last: they point at numbers of the objects above
    for (const c of macroCollections) this.addCollectionMacro(c)
  }

  private hasManualStep(f: QlcChaser): boolean {
    if (f.speedModes.duration === 'PerStep') return f.steps.some((s) => s.duration >= QLC_INFINITE || s.hold >= QLC_INFINITE)
    return f.speed.duration >= QLC_INFINITE
  }

  private newCuelist(id: string, name: string, cues: Cue[]): Cuelist {
    return {
      id, name, cues,
      currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
      number: this.cuelistNumber++
    }
  }

  private addSceneCuelist(s: QlcScene, idOverride?: string): Cuelist {
    const id = idOverride ?? `qlc-fn-${s.id}`
    const cue: Cue = {
      id: `${id}-c1`, name: s.name, number: 1,
      values: this.values(s.values, s.name),
      fadeIn: this.fade(s.speed.fadeIn, s), fadeOut: this.fade(s.speed.fadeOut, s), delay: 0, followTime: null
    }
    const cl = this.newCuelist(id, s.name, [cue])
    this.frag.cuelists.push(cl)
    this.targets.set(s.id, [{ kind: 'cuelist', id, name: s.name }])
    if (s.tempo === 'Beats') this.warn.item('info', 'qlcplus.beats', `Beat-based times converted at ${this.bpm} BPM`, s.name)
    return cl
  }

  /** Scene steps of a chaser / sequence, with their resolved timing (QLC+ ChaserRunner rules) */
  private stepsOf(f: QlcChaser): { name: string; values: CueChannelValue[]; fadeIn: number; fadeOut: number; duration: number }[] {
    const out: { name: string; values: CueChannelValue[]; fadeIn: number; fadeOut: number; duration: number }[] = []
    const steps = f.direction === 'Backward' ? [...f.steps].reverse() : f.steps
    steps.forEach((step, i) => {
      let values: CueChannelValue[]
      let sceneSpeed = { fadeIn: 0, fadeOut: 0 }
      let name = step.note || ''
      if (step.values) {
        values = this.values(step.values, `${f.name} step ${i + 1}`)
        if (!name) name = `Step ${i + 1}`
      } else {
        const fn = this.fnById.get(step.fid)
        if (!fn || fn.type !== 'Scene') {
          this.warn.item('warning', 'qlcplus.chaserStep', 'Chaser steps that are not scenes were skipped', `${f.name} step ${i + 1}${fn ? ` (${fn.type} "${fn.name}")` : ''}`)
          return
        }
        values = this.values(fn.values, fn.name)
        sceneSpeed = { fadeIn: fn.speed.fadeIn, fadeOut: fn.speed.fadeOut }
        if (!name) name = fn.name
      }
      const pick = (mode: string, common: number, perStep: number, own: number): number =>
        mode === 'Common' ? common : mode === 'PerStep' ? perStep : own
      const fadeIn = pick(f.speedModes.fadeIn, f.speed.fadeIn, step.fadeIn, sceneSpeed.fadeIn)
      const fadeOut = pick(f.speedModes.fadeOut, f.speed.fadeOut, step.fadeOut, sceneSpeed.fadeOut)
      const duration = f.speedModes.duration === 'PerStep' ? step.duration : f.speed.duration
      out.push({
        name,
        values,
        fadeIn: fadeIn >= QLC_INFINITE ? 0 : this.fade(fadeIn, f),
        fadeOut: fadeOut >= QLC_INFINITE ? 0 : this.fade(fadeOut, f),
        duration: this.seconds(duration, f)
      })
    })
    if (f.tempo === 'Beats') this.warn.item('info', 'qlcplus.beats', `Beat-based times converted at ${this.bpm} BPM`, f.name)
    return out
  }

  private addChaserCuelist(f: QlcChaser): Cuelist {
    const id = `qlc-fn-${f.id}`
    const steps = this.stepsOf(f)
    const cues: Cue[] = steps.map((s, i) => ({
      id: `${id}-c${i + 1}`,
      name: s.name,
      number: i + 1,
      values: s.values,
      fadeIn: s.fadeIn,
      fadeOut: s.fadeOut,
      delay: 0,
      followTime: Number.isFinite(s.duration) ? Math.min(86400, s.duration) : null,
      followMode: 'after-go' as const
    }))
    // A cue stack that loops back after its last auto-follow keeps QLC+'s Loop
    const cl = this.newCuelist(id, f.name, cues)
    cl.isLooping = f.runOrder !== 'SingleShot'
    cl.tracking = false
    if (f.runOrder === 'PingPong' || f.runOrder === 'Random') {
      this.warn.item('warning', 'qlcplus.runOrder', 'Ping-pong / random run order is not available on cue lists (plays forward, looping)', f.name)
    }
    this.frag.cuelists.push(cl)
    this.targets.set(f.id, [{ kind: 'cuelist', id, name: f.name }])
    return cl
  }

  private addChase(f: QlcChaser): void {
    const id = `qlc-fn-${f.id}`
    const steps = this.stepsOf(f)
    const durations = steps.map((s) => (Number.isFinite(s.duration) ? s.duration : 0))
    // Most common step time = the chase tempo; other steps override it
    const freq = new Map<number, number>()
    for (const d of durations) freq.set(d, (freq.get(d) ?? 0) + 1)
    const base = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0.5
    if (base <= 0.06) this.warn.item('info', 'qlcplus.fastChase', 'Chases faster than 999 BPM run at 999 BPM', f.name)
    const bpm = Math.max(1, Math.min(999, base > 0 ? 60 / base : 999))
    const ratios = steps.map((s, i) => (durations[i] > 0 ? Math.min(1, s.fadeIn / durations[i]) : 0))
    const fadePercent = ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) : 0
    if (ratios.some((r) => Math.abs(r * 100 - fadePercent) > 5)) this.warn.item('info', 'qlcplus.chaseFade', 'Chases with a different fade per step use their average fade', f.name)
    const chaseSteps: ChaseStep[] = steps.map((s, i) => {
      const step: ChaseStep = { id: `${id}-s${i + 1}`, values: s.values }
      if (Math.abs(durations[i] - base) > 0.0005 && durations[i] > 0) step.holdTime = durations[i]
      return step
    })
    const chase: Chase = {
      id,
      name: f.name,
      steps: chaseSteps,
      currentStepIndex: 0,
      isPlaying: false,
      isLooping: f.runOrder !== 'SingleShot',
      bpm: Math.round(bpm * 100) / 100,
      fadePercent: Math.max(0, Math.min(100, fadePercent)),
      direction: f.runOrder === 'PingPong' ? 'bounce' : f.runOrder === 'Random' ? 'random' : 'forward',
      faderLevel: 255,
      priority: 50,
      number: this.chaseNumber++
    }
    // stepsOf already reversed a Backward chaser
    this.frag.chases.push(chase)
    this.targets.set(f.id, [{ kind: 'chase', id, name: f.name }])
  }

  // ---------------------------------------------------------- EFX

  private addEfx(f: QlcEfx): void {
    const n = f.fixtures.length
    if (n === 0) { this.warn.item('warning', 'qlcplus.emptyEfx', 'EFX without fixtures skipped', f.name); return }
    const serial = f.propagation === 'Serial' || f.propagation === 'Asymmetric'
    type Member = { patchId: string; offset: number; reversed: boolean; mode: number }
    const members: Member[] = []
    f.fixtures.forEach((ef, index) => {
      const fx = this.fixtures.get(ef.fixture)
      if (!fx) return
      if (ef.head > 0) this.warn.item('info', 'qlcplus.efxHead', 'EFX on fixture heads became EFX on the whole fixture', f.name)
      // EFXFixture: θ = 2π(p + serial offset) is reversed first, the start offsets are added after
      // (EFX::calculatePoint), so they shift a reversed curve the other way
      const reversed = ef.direction !== f.direction
      const startShift = (ef.startOffset + f.startOffset) / 360
      const offset = (serial ? index / (n + 1) : 0) + (reversed && f.algorithm !== 'Line' ? -startShift : startShift)
      members.push({ patchId: fx.entry.id, offset, reversed, mode: ef.mode })
    })
    if (members.some((m) => m.mode === 2)) this.warn.item('warning', 'qlcplus.efxRgb', 'EFX in RGB mode are not supported', f.name)
    const loopMs = (() => {
      const d = f.speed.duration >= QLC_INFINITE ? 0 : f.speed.duration
      const fadeIn = f.speed.fadeIn >= QLC_INFINITE ? 0 : f.speed.fadeIn
      const loop = fadeIn < d ? d - fadeIn : d
      return f.tempo === 'Beats' ? (loop / 1000) * (60000 / this.bpm) : loop
    })()
    if (loopMs <= 0) this.warn.item('warning', 'qlcplus.efxSpeed', 'EFX with a zero duration run at 1 Hz', f.name)
    const speed = loopMs > 0 ? Math.min(100, round6(1000 / loopMs)) : 1
    if (f.isRelative) this.warn.item('info', 'qlcplus.efxRelative', 'Relative EFX run around the centre (PhotonBoard position effects are absolute)', f.name)
    if (f.dimmerControl) this.warn.item('info', 'qlcplus.efxDimmerControl', 'EFX dimmer control is not carried', f.name)
    if (f.runOrder === 'PingPong' || f.runOrder === 'Random') this.warn.item('info', 'qlcplus.efxRunOrder', 'EFX ping-pong / random run order plays as a loop', f.name)

    const groups: { key: string; mode: number; reversed: boolean; members: Member[] }[] = []
    for (const m of members) {
      if (m.mode === 2) continue
      const mode = m.mode === 1 ? 1 : 0
      const key = `${mode}:${m.reversed ? 'r' : 'f'}`
      let g = groups.find((x) => x.key === key)
      if (!g) { g = { key, mode, reversed: m.reversed, members: [] }; groups.push(g) }
      g.members.push(m)
    }
    const created: Target[] = []
    groups.forEach((g, gi) => {
      const shape: EfxShapeParams = {
        algorithm: f.algorithm, width: f.width, height: f.height, rotation: f.rotation,
        xFrequency: f.xFrequency, yFrequency: f.yFrequency, xPhase: f.xPhase, yPhase: f.yPhase,
        reversed: g.reversed
      }
      const first = g.members[0].offset
      const [xs, ys] = sampleEfx(shape, first)
      const channels: EffectChannel[] = []
      let keyframes: WaveformKeyframe[] | undefined
      let approx = false
      let multiFreq = false
      if (g.mode === 0) {
        const fx = fitAxis(xs)
        keyframes = fx.keyframes
        const fy = fitAxis(ys, keyframes)
        if (fy.keyframes) keyframes = fy.keyframes
        approx = fx.error > 0.05 || fy.error > 0.05
        if (fx.amplitude > 0) channels.push(channelFromFit('Pan', fx))
        if (fy.amplitude > 0) channels.push(channelFromFit('Tilt', fy))
        multiFreq = fx.m !== 1 || fy.m !== 1
        const cx = f.xOffset + fx.dc
        const cy = f.yOffset + fy.dc
        if (Math.abs(cx - 128) > 3 || Math.abs(cy - 128) > 3) {
          this.warn.item('warning', 'qlcplus.efxCentre', 'EFX centres other than the middle (128) are not representable: these run around the middle (store the position in the cue that starts them)',
            `${f.name} (${Math.round(cx)}, ${Math.round(cy)})`)
        }
      } else {
        const fy = fitAxis(ys)
        keyframes = fy.keyframes
        approx = fy.error > 0.05
        multiFreq = fy.m !== 1
        // QLC+: yOffset ± amplitude; PhotonBoard dimmer: 0…depth around depth/2
        const ch = channelFromFit('Dimmer', fy)
        ch.depth = Math.max(0, Math.min(255, Math.round(Math.min(255, f.yOffset + fy.dc + fy.amplitude))))
        if (Math.abs(f.yOffset + fy.dc - fy.amplitude) > 3) this.warn.item('info', 'qlcplus.efxDimmer', 'Dimmer EFX levels approximated', f.name)
        channels.push(ch)
      }
      if (approx) this.warn.item('info', 'qlcplus.efxShape', 'EFX shapes approximated', `${f.name} (${f.algorithm}${f.rotation ? `, rotation ${f.rotation}°` : ''})`)
      // Fan: fixture phases a + k·i  ⇒  fan = k·n·360
      const count = g.members.length
      let fan = 0
      if (count > 1) {
        const frac = (v: number): number => v - Math.floor(v)
        const diffs = g.members.slice(1).map((m, i) => frac(m.offset - g.members[i].offset))
        // the smallest equivalent step (a phase step of 0.75 is a step of −0.25)
        const signed = (d: number): number => (d > 0.5 + 1e-9 ? d - 1 : d)
        const k = signed(diffs[0])
        const linear = diffs.every((d) => Math.min(Math.abs(frac(d - k)), 1 - Math.abs(frac(d - k))) < 0.003)
        const step = linear ? k : signed(frac(g.members[count - 1].offset - first)) / (count - 1)
        fan = Math.round(step * count * 360 * 100) / 100
        if (fan > 3600) fan = fan % 360
        if (!linear) this.warn.item('info', 'qlcplus.efxOffsets', 'Uneven EFX fixture offsets became an even fan', f.name)
        if (multiFreq && fan !== 0) this.warn.item('info', 'qlcplus.efxFanFreq', 'EFX fixture offsets on multi-frequency shapes (eight, Lissajous) are approximated', f.name)
      }
      const suffix = groups.length > 1 ? (g.mode === 1 ? ' (dimmer)' : g.reversed ? ' (reverse)' : '') : ''
      const id = gi === 0 ? `qlc-fn-${f.id}` : `qlc-fn-${f.id}-${gi + 1}`
      const fade = (raw: number): number | undefined => {
        const s = this.fade(raw, f)
        return s > 0 ? Math.min(600, s) : undefined
      }
      const effect: Effect = {
        id,
        name: f.name + suffix,
        waveform: 'sine' as WaveformType,
        speed,
        depth: channels.reduce((m, c) => Math.max(m, c.depth), 0),
        offset: 0,
        channelType: g.mode === 1 ? 'Dimmer' : 'Pan',
        fixtureIds: g.members.map((m) => m.patchId).filter((v, i, a) => a.indexOf(v) === i),
        fan,
        isRunning: false,
        channels,
        number: this.effectNumber++
      }
      if (keyframes && channels.some((c) => c.waveform === 'custom')) effect.keyframes = keyframes
      const fi = fade(f.speed.fadeIn)
      if (fi) effect.fadeIn = fi
      const fo = fade(f.speed.fadeOut)
      if (fo) effect.fadeOut = fo
      if (f.runOrder === 'SingleShot') effect.oneShot = true
      this.frag.effects.push(effect)
      created.push({ kind: 'effect', id, name: effect.name })
    })
    if (groups.length > 1) this.warn.item('info', 'qlcplus.efxSplit', 'EFX with fixtures in different directions / modes became several effects', f.name)
    if (created.length) this.targets.set(f.id, created)
  }

  // ---------------------------------------------------------- RGB matrix

  private addRgbMatrix(f: QlcRgbMatrix): void {
    const grp = this.ws.fixtureGroups.find((g) => g.id === f.fixtureGroup)
    if (!grp) { this.warn.item('warning', 'qlcplus.rgbMatrixNoGroup', 'RGB matrices without a fixture group skipped', f.name); return }
    const ids: string[] = []
    for (const h of [...grp.heads].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const fx = this.fixtures.get(h.fixture)
      if (fx && !ids.includes(fx.entry.id)) ids.push(fx.entry.id)
    }
    if (ids.length === 0) { this.warn.item('warning', 'qlcplus.rgbMatrixNoGroup', 'RGB matrices without a fixture group skipped', f.name); return }
    const [r, g, b] = rgbOf(f.colors[0])
    const name = `${f.algorithmType} ${f.algorithmName}`.trim()
    const plain = f.algorithmType === 'Plain' || /^plain/i.test(f.algorithmName)
    let waveform: WaveformType = 'square'
    if (plain) waveform = 'constant'
    else if (/random|noise|sparkle|twinkle|strobe|flicker/i.test(f.algorithmName)) waveform = 'random'
    else if (/gradient|plasma|wave|sine|fade|breath|pulse|rainbow|fire/i.test(f.algorithmName)) waveform = 'sine'
    const stepMs = f.speed.duration >= QLC_INFINITE || f.speed.duration <= 0 ? 500 : (f.tempo === 'Beats' ? (f.speed.duration / 1000) * (60000 / this.bpm) : f.speed.duration)
    const mode = f.controlMode
    let channels: EffectChannel[]
    if (mode === 'RGB') {
      channels = ([['Red', r], ['Green', g], ['Blue', b]] as [string, number][])
        .filter(([, v]) => v > 0)
        .map(([type, v]) => ({ channelType: type, phaseOffset: 0, depth: v }))
      if (channels.length === 0) channels = [{ channelType: 'Dimmer', phaseOffset: 0, depth: 255 }]
    } else {
      const type = mode === 'Dimmer' ? 'Dimmer' : mode === 'Shutter' ? 'Shutter' : mode
      channels = [{ channelType: type, phaseOffset: 0, depth: Math.max(r, g, b) || 255 }]
    }
    const id = `qlc-fn-${f.id}`
    const steps = Math.max(1, ids.length)
    const effect: Effect = {
      id,
      name: f.name,
      waveform,
      speed: plain ? 1 : Math.min(100, round6(1000 / (stepMs * steps))),
      depth: channels.reduce((m, c) => Math.max(m, c.depth), 0),
      offset: 0,
      channelType: channels[0].channelType,
      fixtureIds: ids,
      fan: plain ? 0 : f.direction === 'Backward' ? -360 : 360,
      isRunning: false,
      channels,
      number: this.effectNumber++
    }
    if (f.runOrder === 'SingleShot') effect.oneShot = true
    this.frag.effects.push(effect)
    this.targets.set(f.id, [{ kind: 'effect', id, name: f.name }])
    if (!plain) {
      this.warn.item('warning', 'qlcplus.rgbMatrix', 'RGB matrix scripts became approximate colour effects (fan across the group, start colour only)', `${f.name} (${name || 'script'})`)
    } else if (f.colors[1] !== undefined) {
      this.warn.item('info', 'qlcplus.rgbMatrixColors', 'RGB matrix end / extra colours are not carried', f.name)
    }
  }

  // ---------------------------------------------------------- collections

  private collectionValues(c: QlcCollection, values: Map<string, CueChannelValue>, effects: Effect[], depth = 0): void {
    if (depth > 8) return
    for (const id of c.functions) {
      const f = this.fnById.get(id)
      if (!f) continue
      if (f.type === 'Scene') {
        for (const v of this.values(f.values, f.name)) values.set(`${v.fixtureId}\u0000${v.channelName}`, v)
      } else if (f.type === 'EFX' || f.type === 'RGBMatrix') {
        for (const t of this.targets.get(f.id) ?? []) {
          const e = this.frag.effects.find((x) => x.id === t.id)
          if (e) effects.push(e)
        }
      } else if (f.type === 'Collection' && f.id !== c.id) {
        this.collectionValues(f, values, effects, depth + 1)
      }
    }
  }

  private addCollectionCuelist(c: QlcCollection): void {
    const id = `qlc-fn-${c.id}`
    const values = new Map<string, CueChannelValue>()
    const effects: Effect[] = []
    this.collectionValues(c, values, effects)
    const fades = c.functions.map((fid) => this.fnById.get(fid)).filter((f): f is QlcScene => f?.type === 'Scene')
    const cue: Cue = {
      id: `${id}-c1`, name: c.name, number: 1, values: [...values.values()],
      fadeIn: fades.length ? Math.max(...fades.map((s) => this.fade(s.speed.fadeIn, s))) : 0,
      fadeOut: fades.length ? Math.max(...fades.map((s) => this.fade(s.speed.fadeOut, s))) : 0,
      delay: 0, followTime: null
    }
    const cl = this.newCuelist(id, c.name, [cue])
    if (effects.length) cl.effectSnapshots = effects.map((e, i) => ({ ...e, id: `${id}-fx${i + 1}`, isRunning: false, fixtureIds: [...e.fixtureIds] }))
    this.frag.cuelists.push(cl)
    this.targets.set(c.id, [{ kind: 'cuelist', id, name: c.name }])
  }

  private numberOf(t: Target): number | undefined {
    const list = t.kind === 'cuelist' ? this.frag.cuelists : t.kind === 'chase' ? this.frag.chases : t.kind === 'effect' ? this.frag.effects : this.frag.macros
    return (list as { id: string; number?: number }[]).find((o) => o.id === t.id)?.number
  }

  private addCollectionMacro(c: QlcCollection): void {
    const id = `qlc-fn-${c.id}`
    const macro: Macro = { id, number: this.macroNumber++, name: c.name, lines: [] }
    this.targets.set(c.id, [{ kind: 'macro', id, name: c.name }])
    for (const fid of c.functions) {
      const f = this.fnById.get(fid)
      if (f?.type === 'Collection' && !this.targets.has(fid) && this.kindOfCollection(f) === 'macro') {
        // nested macro collection defined later: number it now
        this.addCollectionMacro(f)
      }
      const ts = this.targets.get(fid)
      if (!f || !ts || ts.length === 0) {
        if (f) this.warn.item('warning', 'qlcplus.collectionMember', 'Collection members that cannot be started from a macro were skipped', `${c.name} → ${f.name}`)
        continue
      }
      for (const t of ts) {
        const num = this.numberOf(t)
        if (num === undefined) continue
        const keyword = t.kind === 'cuelist' ? 'Go Sequence' : t.kind === 'chase' ? 'Go Chase' : t.kind === 'effect' ? 'Go Effect' : 'Go Macro'
        macro.lines.push({ command: `${keyword} ${num}` })
      }
    }
    if (!this.frag.macros.some((m) => m.id === macro.id)) this.frag.macros.push(macro)
    this.warn.item('info', 'qlcplus.collectionMacro', 'Collections that start chasers became macros (Go … lines use the imported object numbers)', c.name)
  }

  // ---------------------------------------------------------- shows → timeline

  private wrapperCuelist(f: QlcFunction): string | null {
    const ts = this.targets.get(f.id) ?? []
    const cue = ts.find((t) => t.kind === 'cuelist')
    if (cue) return cue.id
    const effects = ts.filter((t) => t.kind === 'effect').map((t) => this.frag.effects.find((e) => e.id === t.id)).filter((e): e is Effect => !!e)
    const chase = ts.find((t) => t.kind === 'chase')
    if (chase) {
      // A timed chase on the timeline: replay it as a cue list
      const fn = this.fnById.get(f.id)
      if (fn && (fn.type === 'Chaser' || fn.type === 'Sequence')) {
        const id = `qlc-show-${f.id}`
        if (!this.frag.cuelists.some((c) => c.id === id)) {
          const steps = this.stepsOf(fn)
          const cl = this.newCuelist(id, `${fn.name} (timeline)`, steps.map((s, i) => ({
            id: `${id}-c${i + 1}`, name: s.name, number: i + 1, values: s.values, fadeIn: s.fadeIn, fadeOut: s.fadeOut, delay: 0,
            followTime: Number.isFinite(s.duration) ? s.duration : null, followMode: 'after-go' as const
          })))
          cl.isLooping = fn.runOrder !== 'SingleShot'
          cl.tracking = false
          this.frag.cuelists.push(cl)
        }
        return id
      }
    }
    if (effects.length) {
      const id = `qlc-show-${f.id}`
      if (!this.frag.cuelists.some((c) => c.id === id)) {
        const cl = this.newCuelist(id, `${f.name} (timeline)`, [{ id: `${id}-c1`, name: f.name, number: 1, values: [], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }])
        cl.effectSnapshots = effects.map((e, i) => ({ ...e, id: `${id}-fx${i + 1}`, isRunning: false, fixtureIds: [...e.fixtureIds] }))
        this.frag.cuelists.push(cl)
      }
      return id
    }
    return null
  }

  private totalDuration(f: QlcFunction): number {
    if (f.type === 'Chaser' || f.type === 'Sequence') {
      const total = this.stepsOf(f).reduce((s, st) => s + (Number.isFinite(st.duration) ? st.duration : 0), 0)
      return total > 0 ? total : 5
    }
    if (f.type === 'EFX') {
      const d = this.seconds(f.speed.duration, f)
      return Number.isFinite(d) && d > 0 ? d : 5
    }
    if (f.type === 'Scene') return Math.max(1, this.fade(f.speed.fadeIn, f) + this.fade(f.speed.fadeOut, f))
    return 5
  }

  private importShows(): void {
    const shows = this.ws.functions.filter((f): f is QlcShow => f.type === 'Show')
    const used = shows.find((s) => s.tracks.some((t) => t.functions.length > 0)) ?? shows[0]
    if (!used) return
    for (const s of shows) if (s !== used) this.warn.item('warning', 'qlcplus.extraShows', 'Only one show becomes the timeline; other shows were not imported', s.name)
    const clips: TimelineClip[] = []
    const trackNames: string[] = []
    let end = 0
    used.tracks.forEach((t, ti) => {
      trackNames.push(t.name)
      if (t.mute) this.warn.item('info', 'qlcplus.mutedTrack', 'Muted show tracks are imported unmuted', t.name)
      t.functions.forEach((sf, i) => {
        const f = this.fnById.get(sf.fid)
        if (!f) return
        if (f.type === 'Audio' || f.type === 'Video' || f.type === 'Script' || f.type === 'Show') {
          this.warn.item('warning', 'qlcplus.timelineMedia', 'Audio / video / script items of the show were skipped', f.name)
          return
        }
        const cuelistId = this.wrapperCuelist(f)
        if (!cuelistId) {
          this.warn.item('warning', 'qlcplus.timelineItem', 'Show items that cannot play on the timeline were skipped', f.name)
          return
        }
        const start = round3(sf.startTime / 1000)
        const duration = round3(sf.duration > 0 ? sf.duration / 1000 : this.totalDuration(f))
        const clip: TimelineClip = { id: `qlc-clip-${t.id}-${i + 1}`, cuelistId, trackIndex: ti, startTime: start, duration: Math.max(0.01, duration), name: f.name }
        if (sf.color && /^#[0-9a-f]{6}$/i.test(sf.color)) clip.color = sf.color.toLowerCase()
        clips.push(clip)
        end = Math.max(end, start + duration)
      })
    })
    this.frag.timeline = {
      clips,
      markers: [],
      zones: [],
      trackCount: Math.max(1, used.tracks.length),
      trackNames,
      length: Math.max(10, Math.ceil(end)),
      loop: false
    }
    this.warn.add('info', 'qlcplus.show', `Show "${used.name}" became the timeline (${clips.length} clips on ${used.tracks.length} tracks)`, { clips: clips.length, tracks: used.tracks.length })
  }

  // ---------------------------------------------------------- virtual console

  private midiLine(src: QlcInputSource, what: string): { line: number | undefined; feedback: boolean } | null {
    const u = this.ws.universes.find((x) => x.id === src.universe) ?? this.ws.universes[src.universe]
    const plugin = u?.input?.plugin
    if (plugin !== 'MIDI') {
      this.warn.item('warning', 'qlcplus.inputNotMidi', 'External inputs that are not MIDI were not imported', `${what}${plugin ? ` (${plugin})` : ''}`)
      return null
    }
    const mc = u?.input?.params.midichannel
    const line = mc !== undefined ? Number(mc) : undefined
    return { line: line !== undefined && Number.isFinite(line) ? line : undefined, feedback: u?.feedback?.plugin === 'MIDI' }
  }

  private addMidi(src: QlcInputSource | undefined, name: string, target: MidiMapping['target'], behavior: MidiMapping['options']['behavior'], range?: [number, number]): void {
    if (!src) return
    const line = this.midiLine(src, name)
    if (!line) return
    const midi = qlcChannelToMidi(src.channel, line.line)
    if (!midi) {
      this.warn.item('warning', 'qlcplus.midiMessage', 'MIDI aftertouch / pitch-bend / clock inputs are not supported', name)
      return
    }
    const mapping: MidiMapping = {
      id: `qlc-midi-${this.frag.midiMappings.length + 1}`,
      name,
      source: { type: midi.type, channel: midi.channel, number: midi.number },
      target,
      options: { min: range?.[0] ?? 0, max: range?.[1] ?? 255, inverted: false, encoding: 'absolute', behavior }
    }
    if (line.feedback && midi.type !== 'program') mapping.options.feedback = midi.type === 'note' ? 'note' : 'cc'
    if (line.line === MIDI_OMNI) this.warn.item('info', 'qlcplus.midiOmni', 'MIDI inputs in OMNI mode keep the channel they were learnt on', name)
    this.frag.midiMappings.push(mapping)
  }

  /** Leaves in console order: frames by position, children by page / rows / x */
  private leaves(w: QlcVcWidget, out: QlcVcWidget[] = []): QlcVcWidget[] {
    const kids = [...(w.children ?? [])].sort((a, b) => a.page - b.page || Math.round(a.absY / 16) - Math.round(b.absY / 16) || a.absX - b.absX)
    if (w.multipage && w.multipage.pages > 1) this.warn.item('info', 'qlcplus.vcPages', 'Multi-page frames were laid out page after page', w.caption || 'frame')
    if (w.solo) this.warn.item('info', 'qlcplus.soloFrame', 'Solo frames (one function at a time) are not enforced', w.caption || 'solo frame')
    if (w.inputs.enable || w.inputs.nextPage || w.inputs.previousPage) this.warn.item('info', 'qlcplus.frameInputs', 'Frame enable / page inputs were not imported', w.caption || 'frame')
    for (const k of kids) {
      if (k.children) this.leaves(k, out)
      else out.push(k)
    }
    return out
  }

  private importVirtualConsole(): void {
    const vc = this.ws.virtualConsole
    if (!vc) return
    const cells: { cell: ExecutorCell; fader: boolean; title: string }[] = []
    const fnTarget = (fid: number | undefined): Target | undefined => (fid === undefined || fid === QLC_INVALID_ID ? undefined : this.targets.get(fid)?.[0])
    const unsupported = new Map<string, number>()
    for (const w of this.leaves(vc.root)) {
      const label = w.caption || w.kind
      if (Object.keys(w.keys).length) this.warn.item('info', 'qlcplus.vcKeys', 'Keyboard shortcuts of console widgets were not imported', label)
      switch (w.kind) {
        case 'Button': {
          if (w.action === 'Blackout') {
            this.addMidi(w.inputs.main, label, { type: 'blackout' }, 'toggle')
            break
          }
          if (w.action === 'StopAll') {
            this.warn.item('info', 'qlcplus.stopAll', 'Stop-all buttons were not imported (use Release / Off)', label)
            break
          }
          const t = fnTarget(w.functionId)
          if (!t) {
            if (w.functionId !== undefined && w.functionId !== QLC_INVALID_ID) this.warn.item('warning', 'qlcplus.vcTarget', 'Console widgets whose function was not imported were skipped', label)
            break
          }
          const flash = w.action === 'Flash'
          cells.push({ cell: { kind: t.kind, id: t.id, mode: flash ? 'flash' : 'toggle' }, fader: false, title: label })
          if (t.kind === 'cuelist') this.addMidi(w.inputs.main, label, { type: 'cuelist_go', id: t.id }, flash ? 'flash' : 'toggle')
          else if (t.kind === 'chase') {
            if (flash) this.warn.item('info', 'qlcplus.chaseFlash', 'Flash buttons on chases toggle them', label)
            this.addMidi(w.inputs.main, label, { type: 'chase_toggle', id: t.id }, 'toggle')
          } else if (t.kind === 'effect') this.addMidi(w.inputs.main, label, { type: 'effect_toggle', id: t.id }, flash ? 'flash' : 'toggle')
          else if (w.inputs.main) this.warn.item('warning', 'qlcplus.midiMacro', 'MIDI inputs on macros are not supported (the executor cell can be learnt)', label)
          break
        }
        case 'CueList': {
          const t = fnTarget(w.chaserId)
          if (!t) { this.warn.item('warning', 'qlcplus.vcTarget', 'Console widgets whose function was not imported were skipped', label); break }
          cells.push({ cell: { kind: t.kind, id: t.id, mode: 'toggle', ...(t.kind === 'cuelist' ? { button: 'go' as const } : {}) }, fader: false, title: label })
          if (t.kind === 'cuelist') {
            this.addMidi(w.inputs.next, `${label} next`, { type: 'cuelist_go', id: t.id }, 'direct')
            this.addMidi(w.inputs.playback, `${label} play`, { type: 'cuelist_go', id: t.id }, 'toggle')
          }
          for (const role of ['previous', 'stop', 'crossleft', 'crossright']) {
            if (w.inputs[role]) this.warn.item('info', 'qlcplus.cueListInputs', 'Cue list previous / stop / crossfade inputs were not imported', `${label} ${role}`)
          }
          break
        }
        case 'Slider':
        case 'Knob': {
          const mode = w.sliderMode ?? 'Level'
          if (mode === 'Playback') {
            const t = fnTarget(w.playbackFunction)
            if (!t) {
              if (w.playbackFunction === undefined || w.playbackFunction === QLC_INVALID_ID) this.warn.item('info', 'qlcplus.vcEmpty', 'Console widgets without a function were skipped', label)
              else this.warn.item('warning', 'qlcplus.vcTarget', 'Console widgets whose function was not imported were skipped', label)
              break
            }
            cells.push({ cell: { kind: t.kind, id: t.id, mode: 'toggle' }, fader: true, title: label })
            if (t.kind === 'cuelist') {
              this.addMidi(w.inputs.main, label, { type: 'cuelist_fader', id: t.id }, 'direct')
              this.addMidi(w.inputs.flash, `${label} flash`, { type: 'flash', id: t.id }, 'flash')
            } else if (w.inputs.main) this.warn.item('info', 'qlcplus.midiFader', 'MIDI faders on chases / effects were not imported (use the executor fader)', label)
          } else if (mode === 'Level') {
            if (!w.inputs.main) {
              this.warn.item('info', 'qlcplus.levelSlider', 'Channel sliders without an external input were not imported (use the programmer)', label)
              break
            }
            for (const c of w.levelChannels ?? []) {
              const ch = this.channelName(c.fixture, c.channel)
              if (!ch) continue
              this.addMidi(w.inputs.main, `${label} ${ch.channelName}`, { type: 'channel', id: ch.fixtureId, parameter: ch.channelName }, 'direct', [w.levelLow ?? 0, w.levelHigh ?? 255])
            }
          } else {
            this.warn.item('warning', 'qlcplus.submaster', 'Submaster sliders are not supported', label)
          }
          break
        }
        case 'Label':
          break
        default:
          unsupported.set(w.kind, (unsupported.get(w.kind) ?? 0) + 1)
      }
    }
    for (const [kind, count] of unsupported) {
      const names: Record<string, string> = { XYPad: 'XY pads', SpeedDial: 'speed dials', Clock: 'clocks', AudioTriggers: 'audio triggers', Matrix: 'RGB matrix controls', Animation: 'animation widgets' }
      this.warn.add('warning', 'qlcplus.vcWidget', `${count} ${names[kind] ?? kind} of the virtual console were not imported`, { kind, count })
    }
    if (vc.grandMasterInput) this.addMidi(vc.grandMasterInput, 'Grand master', { type: 'master' }, 'direct')

    // Executor pages: row-major 8 × 4, like the QLC+ button grid
    if (cells.length === 0) return
    const pages: ExecutorPage[] = []
    const perPage = EXECUTOR_COLUMN_COUNT * EXECUTOR_ROW_COUNT
    const placed = new Map<string, { page: ExecutorPage; col: number; row: number }>()
    let dropped = 0
    let slot = 0
    for (const c of cells) {
      const key = `${c.cell.kind}:${c.cell.id}`
      const already = placed.get(key)
      if (already) {
        // A button and a slider on the same function: one cell with its fader
        const column = already.page.columns[already.col]
        if (c.fader && !column.fader) already.page.columns[already.col] = { ...column, fader: { kind: 'cell', row: already.row } }
        else this.warn.item('info', 'qlcplus.vcDuplicate', 'Several console widgets on the same function became one executor cell', c.title)
        continue
      }
      const pageIndex = Math.floor(slot / perPage)
      if (pageIndex >= MAX_EXECUTOR_PAGES) { dropped++; continue }
      let page = pages[pageIndex]
      if (!page) {
        page = createExecutorPage(`qlc-page-${pageIndex + 1}`, pageIndex === 0 ? 'QLC+' : `QLC+ ${pageIndex + 1}`)
        pages[pageIndex] = page
      }
      const inPage = slot % perPage
      const row = Math.floor(inPage / EXECUTOR_COLUMN_COUNT)
      const col = inPage % EXECUTOR_COLUMN_COUNT
      page.cells[col][row] = c.cell
      if (c.fader && !page.columns[col].fader) page.columns[col] = { ...page.columns[col], fader: { kind: 'cell', row } }
      placed.set(key, { page, col, row })
      slot++
    }
    if (dropped) this.warn.add('warning', 'qlcplus.executorPages', `${dropped} console widgets did not fit in ${MAX_EXECUTOR_PAGES} executor pages`, { count: dropped })
    this.frag.executor = executorLayoutFromPages(pages.filter(Boolean))
    this.warn.add('info', 'qlcplus.executors', `${cells.length - dropped} virtual console widgets became executor cells`, { count: cells.length - dropped })
  }

  // ---------------------------------------------------------- misc

  private importMisc(): void {
    if (this.ws.autostartFunction !== undefined && this.ws.autostartFunction !== QLC_INVALID_ID) {
      const f = this.fnById.get(this.ws.autostartFunction)
      if (f) this.warn.add('info', 'qlcplus.autostart', `The workspace started "${f.name}" on load; PhotonBoard never starts anything by itself`, { name: f.name })
    }
    if (this.ws.simpleDeskCueStacks > 0) this.warn.add('warning', 'qlcplus.simpleDesk', `${this.ws.simpleDeskCueStacks} Simple Desk cue stacks were not imported`, { count: this.ws.simpleDeskCueStacks })
    for (const tag of this.ws.unknownEngineTags) this.warn.item('info', 'qlcplus.unknownTag', 'Unknown workspace sections ignored', tag)
    if (this.ws.virtualConsole === undefined && this.ws.functions.length > 0) {
      this.warn.add('info', 'qlcplus.noConsole', 'The workspace has no virtual console: no executors were created')
    }
  }
}
