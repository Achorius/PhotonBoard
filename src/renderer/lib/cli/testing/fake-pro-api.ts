// ============================================================
// PhotonBoard — FakeProApi: an in-memory ProApi for command line tests
//
// Complete test double of lib/pro/contracts.ts ProApi: plain arrays for
// the show, a Map programmer, snapshot-based undo (transaction / undo /
// redo), a scripted ask(), and a call log (`calls`) for assertions.
// Store / preset logic uses the pure store-ops (the same code the real
// API uses), selection steps use selection-tools.
//
// Used by *.test.ts only (never imported by the app).
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type {
  Chase, Cue, CueChannelValue, CueFeature, Cuelist, Effect, ExecutorButtonFn, ExecutorCell, ExecutorColumnFader, ExecutorPage,
  FixtureDefinition, Group, Macro, PatchEntry, Preset, PresetScope, PresetType, SpeedMaster
} from '@shared/types'
import { featureOfChannel, canonicalAttributeKey } from '@shared/attribute-families'
import { createExecutorPage } from '@shared/show-format'
import type {
  AlignMode, AskChoice, ClearStage, ExecutorRef, ExecutorTarget, ProApi, ProgTime, ProgrammerValueInput, StoreCueResult
} from '@renderer/lib/pro/contracts'
import { applyMatricks, type Matricks } from '@renderer/lib/pro/selection-tools'
import { storeIntoCue, storePreset as storePresetOp, type StoreOptions } from '@renderer/lib/pro/store-ops'
import type { ProgrammerMeta } from '@renderer/lib/pro/programmer-engine'
import { ALL_FIXTURES, DIMMER, DIMMER_16, MOVING_HEAD, RGB_PAR, patchEntry } from '@renderer/lib/testing/test-fixtures'

export interface FakeCall {
  method: string
  args: unknown[]
}

interface ProgValue {
  fixtureId: string
  channelName: string
  value: number
  meta?: ProgrammerMeta
}

/** Undoable content */
interface Content {
  groups: Group[]
  presets: Preset[]
  cuelists: Cuelist[]
  macros: Macro[]
  pages: ExecutorPage[]
  parked: CueChannelValue[]
  speedMasters: SpeedMaster[]
}

const pkey = (fixtureId: string, channelName: string) => `${fixtureId}\u0000${channelName}`
const clone = <T>(x: T): T => structuredClone(x)

export type AskHandler = (question: string, choices: AskChoice[], fallback?: string) => Promise<string | null>

export class FakeProApi implements ProApi {
  patch: PatchEntry[] = []
  defs: FixtureDefinition[] = [...ALL_FIXTURES]
  groups: Group[] = []
  presets: Preset[] = []
  cuelists: Cuelist[] = []
  chases: Chase[] = []
  effects: Effect[] = []
  macros: Macro[] = []
  speedMasters: SpeedMaster[] = []
  pages: ExecutorPage[] = [createExecutorPage('page-1')]
  currentPage = 0
  selection: string[] = []
  matricks: Matricks = {}
  step: number | null = null
  align: AlignMode | null = null
  programmer = new Map<string, ProgValue>()
  progTime: ProgTime | null = null
  /** Time passed with the last setAttributeValues / applyPreset */
  lastTime: ProgTime | undefined
  dmx = new Map<string, number>()
  highlight = false
  blind = false
  blackout = false
  grandMaster = 255
  parked: CueChannelValue[] = []
  groupMasters: Record<string, number> = {}
  selectedCuelist: string | null = null
  selectedExecutor: ExecutorRef | null = null
  paused = new Set<string>()
  runningMacros = new Set<string>()
  columnLevels = new Map<string, number>()
  calls: FakeCall[] = []
  questions: { question: string; choices: AskChoice[]; fallback?: string }[] = []
  /** Answer of ask() (or a handler) */
  askAnswer: string | null = 'merge'
  askHandler: AskHandler | null = null
  /** Called by runMacro (tests can run the macro runner from here) */
  onRunMacro: ((id: string) => void) | null = null

  private undoStack: { label: string; before: Content }[] = []
  private redoStack: { label: string; before: Content }[] = []
  private txDepth = 0

  private log(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args })
  }

  /** Calls of one method */
  callsOf(method: string): unknown[][] {
    return this.calls.filter(c => c.method === method).map(c => c.args)
  }

  /** Every undo step label, oldest first */
  get undoLabels(): string[] {
    return this.undoStack.map(s => s.label)
  }

  private content(): Content {
    return clone({ groups: this.groups, presets: this.presets, cuelists: this.cuelists, macros: this.macros, pages: this.pages, parked: this.parked, speedMasters: this.speedMasters })
  }

  private restore(c: Content): void {
    const x = clone(c)
    this.groups = x.groups
    this.presets = x.presets
    this.cuelists = x.cuelists
    this.macros = x.macros
    this.pages = x.pages
    this.parked = x.parked
    this.speedMasters = x.speedMasters
  }

  /** A content change: one undo step unless inside a transaction */
  private edit<T>(label: string, fn: () => T): T {
    return this.transaction(label, fn)
  }

  // ---------------------------------------------------------------- read model
  getPatch(): readonly PatchEntry[] { return this.patch }
  getFixtureDefs(): readonly FixtureDefinition[] { return this.defs }
  getGroups(): readonly Group[] { return this.groups }
  getPresets(): readonly Preset[] { return this.presets }
  getCuelists(): readonly Cuelist[] { return this.cuelists }
  getChases(): readonly Chase[] { return this.chases }
  getEffects(): readonly Effect[] { return this.effects }
  getMacros(): readonly Macro[] { return this.macros }
  getSpeedMasters(): readonly SpeedMaster[] { return this.speedMasters }
  getExecutorPages(): readonly ExecutorPage[] { return this.pages }

  // ---------------------------------------------------------------- selection
  getSelection(): string[] { return [...this.selection] }
  setSelection(fixtureIds: string[]): void {
    this.log('setSelection', fixtureIds)
    this.selection = [...fixtureIds]
    this.step = null
  }
  selectStep(direction: 'next' | 'prev' | 'all'): void {
    this.log('selectStep', direction)
    if (direction === 'all') this.step = null
    else if (direction === 'next') this.step = this.step === null ? 0 : this.step + 1
    else this.step = this.step === null ? -1 : this.step - 1
  }
  getActiveSelection(): string[] { return applyMatricks(this.selection, this.matricks, this.step).active }
  getMatricks(): Matricks { return this.matricks }
  setMatricks(m: Matricks): void { this.matricks = { ...m } }
  setAlign(align: AlignMode | null): void { this.log('setAlign', align); this.align = align }
  /** Optional extension read by the command line fans */
  getAlign(): AlignMode | null { return this.align }

  // ---------------------------------------------------------------- programmer
  setAttributeValues(values: ProgrammerValueInput[], time?: ProgTime): void {
    this.log('setAttributeValues', values, time)
    this.lastTime = time
    for (const v of values) {
      const pv: ProgValue = { fixtureId: v.fixtureId, channelName: v.channelName, value: v.value }
      if (v.meta) pv.meta = v.meta
      this.programmer.set(pkey(v.fixtureId, v.channelName), pv)
    }
  }

  /** Programmer value of a fixture channel (undefined when not held) */
  value(fixtureId: string, channelName: string): number | undefined {
    return this.programmer.get(pkey(fixtureId, channelName))?.value
  }

  private channelsOf(fixtureId: string): { name: string; type?: FixtureDefinition['channels'][string]['type'] }[] {
    const p = this.patch.find(x => x.id === fixtureId)
    const def = p && this.defs.find(d => d.id === p.fixtureDefId)
    const mode = def?.modes.find(md => md.name === p!.modeName)
    return mode ? mode.channels.map(name => ({ name, type: def!.channels[name]?.type })) : []
  }

  applyPreset(presetId: string, fixtureIds: string[], time?: ProgTime): number {
    this.log('applyPreset', presetId, fixtureIds, time)
    this.lastTime = time
    const preset = this.presets.find(p => p.id === presetId)
    if (!preset) return 0
    let n = 0
    for (const id of fixtureIds) {
      const entry = this.patch.find(p => p.id === id)
      const sel = preset.values[id] ?? {}
      const glob = (entry && preset.typeValues?.[entry.fixtureDefId]) ?? {}
      for (const ch of this.channelsOf(id)) {
        const v = sel[ch.name] ?? glob[ch.name] ?? preset.universal?.[canonicalAttributeKey(ch.name)]
        if (v === undefined) continue
        this.programmer.set(pkey(id, ch.name), { fixtureId: id, channelName: ch.name, value: v, meta: { presetId } })
        n++
      }
    }
    return n
  }
  releaseFixtures(fixtureIds: string[]): void {
    this.log('releaseFixtures', fixtureIds)
    const drop = new Set(fixtureIds)
    for (const [k, v] of this.programmer) if (drop.has(v.fixtureId)) this.programmer.delete(k)
  }
  clear(stage?: ClearStage): ClearStage {
    const s: ClearStage = stage ?? (this.selection.length ? 'selection' : this.programmer.size ? 'values' : 'all')
    this.log('clear', s)
    if (s === 'selection' || s === 'all') { this.selection = []; this.step = null }
    if (s === 'values' || s === 'all') this.programmer.clear()
    return s
  }
  getProgrammerValues(opts: { withMeta?: boolean; fixtureIds?: string[] } = {}): CueChannelValue[] {
    const only = opts.fixtureIds ? new Set(opts.fixtureIds) : null
    const out: CueChannelValue[] = []
    for (const v of this.programmer.values()) {
      if (only && !only.has(v.fixtureId)) continue
      const c: CueChannelValue = { fixtureId: v.fixtureId, channelName: v.channelName, value: v.value }
      if (opts.withMeta && v.meta?.presetId) c.presetId = v.meta.presetId
      out.push(c)
    }
    return out
  }
  getProgTime(): ProgTime | null { return this.progTime }
  setProgTime(time: ProgTime | null): void { this.log('setProgTime', time); this.progTime = time }
  setDmx(universe: number, channel: number, value: number): void {
    this.log('setDmx', universe, channel, value)
    this.dmx.set(`${universe}.${channel}`, value)
  }

  // ---------------------------------------------------------------- presets
  storePreset(type: PresetType, number: number, opts: { scope?: PresetScope; mode?: StoreOptions['mode']; name?: string; fixtureIds?: string[] } = {}): Preset | null {
    this.log('storePreset', type, number, opts)
    const values = this.getProgrammerValues(opts.fixtureIds ? { fixtureIds: opts.fixtureIds } : {})
    if (!values.length) return null
    return this.edit('storePreset', () => {
      const existing = this.presets.find(p => p.type === type && p.number === number) ?? null
      const base = existing && opts.mode === 'overwrite' ? { ...existing, values: {}, typeValues: {}, universal: {} } : existing
      const next = storePresetOp(base, type, values, opts.scope ?? existing?.scope, this.patch)
      next.number = number
      next.name = opts.name ?? (existing?.name || `Preset ${number}`)
      if (existing) this.presets = this.presets.map(p => (p.id === existing.id ? next : p))
      else this.presets = [...this.presets, next]
      return next
    })
  }
  updatePresetsFromProgrammer(): number {
    this.log('updatePresetsFromProgrammer')
    const byPreset = new Map<string, CueChannelValue[]>()
    for (const v of this.programmer.values()) {
      if (!v.meta?.presetId) continue
      const list = byPreset.get(v.meta.presetId) ?? []
      list.push({ fixtureId: v.fixtureId, channelName: v.channelName, value: v.value })
      byPreset.set(v.meta.presetId, list)
    }
    if (!byPreset.size) return 0
    return this.edit('updatePresets', () => {
      let n = 0
      this.presets = this.presets.map(p => {
        const vals = byPreset.get(p.id)
        if (!vals) return p
        n++
        return storePresetOp(p, p.type, vals, p.scope, this.patch)
      })
      return n
    })
  }
  updatePreset(id: string, updates: Partial<Omit<Preset, 'id'>>): void {
    this.log('updatePreset', id, updates)
    this.edit('updatePreset', () => { this.presets = this.presets.map(p => (p.id === id ? { ...p, ...updates } : p)) })
  }
  deletePreset(id: string): void {
    this.log('deletePreset', id)
    this.edit('deletePreset', () => { this.presets = this.presets.filter(p => p.id !== id) })
  }
  copyPreset(id: string, toNumber: number): string | null {
    this.log('copyPreset', id, toNumber)
    const src = this.presets.find(p => p.id === id)
    if (!src) return null
    return this.edit('copyPreset', () => {
      const copy = { ...clone(src), id: uuidv4(), number: toNumber }
      this.presets = [...this.presets.filter(p => !(p.type === src.type && p.number === toNumber)), copy]
      return copy.id
    })
  }
  movePreset(id: string, toNumber: number): boolean {
    this.log('movePreset', id, toNumber)
    if (!this.presets.some(p => p.id === id)) return false
    this.edit('movePreset', () => { this.presets = this.presets.map(p => (p.id === id ? { ...p, number: toNumber } : p)) })
    return true
  }

  // ---------------------------------------------------------------- sequences & cues
  getSelectedCuelist(): string | null { return this.selectedCuelist }
  selectCuelist(id: string | null): void { this.log('selectCuelist', id); this.selectedCuelist = id }
  createCuelist(name?: string, number?: number): string {
    this.log('createCuelist', name, number)
    return this.edit('createCuelist', () => {
      const n = number ?? Math.max(0, ...this.cuelists.map((c, i) => c.number ?? i + 1)) + 1
      const cl = makeCuelist(uuidv4(), name ?? `Scene ${n}`, n, [])
      this.cuelists = [...this.cuelists, cl]
      return cl.id
    })
  }
  storeCue(cuelistId: string | null, cueNumber: number | null, opts: StoreOptions): StoreCueResult | null {
    this.log('storeCue', cuelistId, cueNumber, opts)
    const id = cuelistId ?? this.selectedCuelist
    const cl = this.cuelists.find(c => c.id === id)
    if (!cl) return null
    const values = this.getProgrammerValues({ withMeta: true })
    return this.edit('storeCue', () => {
      const num = cueNumber ?? Math.floor(Math.max(0, ...cl.cues.map(c => c.number))) + 1
      const index = cl.cues.findIndex(c => c.number === num)
      const meta = (f: string, ch: string) => ({ feature: this.featureOf(f, ch) })
      let next: Cuelist
      let cueId: string
      if (index >= 0) {
        next = storeIntoCue(cl, index, values, opts, meta)
        cueId = cl.cues[index].id
      } else {
        const cue = makeCue(uuidv4(), num, [])
        const cues = [...cl.cues, cue].sort((a, b) => a.number - b.number)
        next = storeIntoCue({ ...cl, cues }, cues.indexOf(cue), values, { ...opts, mode: 'merge' }, meta)
        cueId = cue.id
      }
      this.cuelists = this.cuelists.map(c => (c.id === cl.id ? next : c))
      return { cuelistId: cl.id, cueId, existed: index >= 0 }
    })
  }
  updateCuesFromProgrammer(opts?: Partial<StoreOptions>): number {
    this.log('updateCuesFromProgrammer', opts)
    const values = this.getProgrammerValues().filter(v => !this.programmer.get(pkey(v.fixtureId, v.channelName))?.meta?.presetId)
    const byKey = new Map(values.map(v => [pkey(v.fixtureId, v.channelName), v.value]))
    let n = 0
    this.edit('updateCues', () => {
      this.cuelists = this.cuelists.map(cl => {
        const cue = cl.isPlaying ? cl.cues[cl.currentCueIndex] : undefined
        if (!cue) return cl
        let changed = false
        const vals = cue.values.map(v => {
          const nv = byKey.get(pkey(v.fixtureId, v.channelName))
          if (nv === undefined || nv === v.value) return v
          changed = true
          return { ...v, value: nv }
        })
        if (!changed) return cl
        n++
        return { ...cl, cues: cl.cues.map(c => (c.id === cue.id ? { ...c, values: vals } : c)) }
      })
    })
    return n
  }
  deleteCue(cuelistId: string, cueId: string): void {
    this.log('deleteCue', cuelistId, cueId)
    this.edit('deleteCue', () => { this.cuelists = this.cuelists.map(c => (c.id === cuelistId ? { ...c, cues: c.cues.filter(q => q.id !== cueId) } : c)) })
  }
  updateCue(cuelistId: string, cueId: string, updates: { name?: string; fadeIn?: number; fadeOut?: number; delay?: number; followTime?: number | null; color?: string }): void {
    this.log('updateCue', cuelistId, cueId, updates)
    this.edit('updateCue', () => {
      this.cuelists = this.cuelists.map(c => (c.id === cuelistId ? { ...c, cues: c.cues.map(q => (q.id === cueId ? { ...q, ...updates } : q)) } : c))
    })
  }
  copyCue(cuelistId: string, cueId: string, toNumber: number, toCuelistId?: string): string | null {
    this.log('copyCue', cuelistId, cueId, toNumber, toCuelistId)
    const src = this.cuelists.find(c => c.id === cuelistId)?.cues.find(q => q.id === cueId)
    const dest = toCuelistId ?? cuelistId
    if (!src || !this.cuelists.some(c => c.id === dest)) return null
    return this.edit('copyCue', () => {
      const copy: Cue = { ...clone(src), id: uuidv4(), number: toNumber }
      this.cuelists = this.cuelists.map(c => (c.id === dest
        ? { ...c, cues: [...c.cues.filter(q => q.number !== toNumber), copy].sort((a, b) => a.number - b.number) }
        : c))
      return copy.id
    })
  }
  moveCue(cuelistId: string, cueId: string, toNumber: number): boolean {
    this.log('moveCue', cuelistId, cueId, toNumber)
    const cl = this.cuelists.find(c => c.id === cuelistId)
    if (!cl?.cues.some(q => q.id === cueId)) return false
    this.edit('moveCue', () => {
      this.cuelists = this.cuelists.map(c => (c.id === cuelistId
        ? { ...c, cues: c.cues.filter(q => q.id === cueId || q.number !== toNumber).map(q => (q.id === cueId ? { ...q, number: toNumber } : q)).sort((a, b) => a.number - b.number) }
        : c))
    })
    return true
  }
  deleteCuelist(id: string): void {
    this.log('deleteCuelist', id)
    this.edit('deleteCuelist', () => { this.cuelists = this.cuelists.filter(c => c.id !== id) })
  }
  renameCuelist(id: string, name: string): void {
    this.log('renameCuelist', id, name)
    this.edit('renameCuelist', () => { this.cuelists = this.cuelists.map(c => (c.id === id ? { ...c, name } : c)) })
  }
  private playback(id: string, fn: (c: Cuelist) => Cuelist): void {
    this.cuelists = this.cuelists.map(c => (c.id === id ? fn(c) : c))
  }
  go(cuelistId: string): void {
    this.log('go', cuelistId)
    this.playback(cuelistId, c => ({ ...c, isPlaying: true, currentCueIndex: Math.min(c.cues.length - 1, c.currentCueIndex + 1) }))
  }
  goBack(cuelistId: string): void {
    this.log('goBack', cuelistId)
    this.playback(cuelistId, c => ({ ...c, currentCueIndex: Math.max(0, c.currentCueIndex - 1) }))
  }
  goto(cuelistId: string, cueNumber: number): boolean {
    this.log('goto', cuelistId, cueNumber)
    const i = this.cuelists.find(c => c.id === cuelistId)?.cues.findIndex(q => q.number === cueNumber) ?? -1
    if (i < 0) return false
    this.playback(cuelistId, c => ({ ...c, isPlaying: true, currentCueIndex: i }))
    return true
  }
  off(cuelistId: string): void {
    this.log('off', cuelistId)
    this.playback(cuelistId, c => ({ ...c, isPlaying: false, currentCueIndex: -1 }))
  }
  pause(cuelistId: string): void { this.log('pause', cuelistId); this.paused.add(cuelistId) }
  releaseAll(): void {
    this.log('releaseAll')
    this.cuelists = this.cuelists.map(c => ({ ...c, isPlaying: false, currentCueIndex: -1 }))
    this.chases = this.chases.map(c => ({ ...c, isPlaying: false }))
  }

  // ---------------------------------------------------------------- executors
  getCurrentExecutorPage(): number { return this.currentPage }
  setExecutorPage(page: number): void {
    this.log('setExecutorPage', page)
    while (this.pages.length <= page && this.pages.length < 16) this.pages.push(createExecutorPage(`page-${this.pages.length + 1}`))
    this.currentPage = Math.max(0, Math.min(this.pages.length - 1, page))
  }
  executorPress(ref: ExecutorRef, phase: 'down' | 'up', opts?: { fn?: ExecutorButtonFn }): void { this.log('executorPress', ref, phase, opts) }
  columnFader(page: number, col: number, level: number): void {
    this.log('columnFader', page, col, level)
    this.columnLevels.set(`${page}.${col}`, level)
  }
  assignExecutor(ref: ExecutorRef, target: ExecutorTarget | null, opts?: { button?: ExecutorButtonFn; fader?: ExecutorColumnFader }): void {
    this.log('assignExecutor', ref, target, opts)
    this.edit('assignExecutor', () => {
      const pages = clone(this.pages)
      const page = pages[ref.page]
      if (!page) return
      let cell: ExecutorCell | null = null
      if (target) {
        cell = { kind: target.kind, id: target.id, mode: 'toggle' }
        if (opts?.button) cell.button = opts.button
      }
      page.cells[ref.col][ref.row] = cell
      this.pages = pages
    })
  }
  /** Cell of an executor (tests) */
  cell(page: number, col: number, row: number): ExecutorCell | null {
    return this.pages[page]?.cells[col]?.[row] ?? null
  }
  getSelectedExecutor(): ExecutorRef | null { return this.selectedExecutor }
  selectExecutor(ref: ExecutorRef | null): void { this.log('selectExecutor', ref); this.selectedExecutor = ref }

  // ---------------------------------------------------------------- macros
  runMacro(id: string): void {
    this.log('runMacro', id)
    this.runningMacros.add(id)
    this.onRunMacro?.(id)
  }
  stopMacro(id: string): void { this.log('stopMacro', id); this.runningMacros.delete(id) }
  storeMacro(number: number, lines: Macro['lines'], name?: string): string {
    this.log('storeMacro', number, lines, name)
    return this.edit('storeMacro', () => {
      const existing = this.macros.find(x => x.number === number)
      const macro: Macro = { id: existing?.id ?? uuidv4(), number, name: name ?? `Macro ${number}`, lines: clone(lines) }
      this.macros = existing ? this.macros.map(x => (x.id === existing.id ? macro : x)) : [...this.macros, macro]
      return macro.id
    })
  }
  updateMacro(id: string, updates: Partial<Omit<Macro, 'id'>>): void {
    this.log('updateMacro', id, updates)
    this.edit('updateMacro', () => { this.macros = this.macros.map(x => (x.id === id ? { ...x, ...updates } : x)) })
  }
  deleteMacro(id: string): void {
    this.log('deleteMacro', id)
    this.edit('deleteMacro', () => { this.macros = this.macros.filter(x => x.id !== id) })
  }

  // ---------------------------------------------------------------- groups
  storeGroup(number: number, fixtureIds: string[], opts: { name?: string; mode?: 'merge' | 'overwrite' | 'remove' } = {}): string {
    this.log('storeGroup', number, fixtureIds, opts)
    return this.edit('storeGroup', () => {
      const i = this.groups.findIndex((g, idx) => (g.number ?? idx + 1) === number)
      const existing = i >= 0 ? this.groups[i] : null
      let ids: string[]
      if (!existing || opts.mode === 'overwrite') ids = [...fixtureIds]
      else if (opts.mode === 'remove') ids = existing.fixtureIds.filter(id => !fixtureIds.includes(id))
      else ids = [...existing.fixtureIds, ...fixtureIds.filter(id => !existing.fixtureIds.includes(id))]
      const group: Group = { id: existing?.id ?? uuidv4(), name: opts.name ?? existing?.name ?? `Group ${number}`, color: existing?.color ?? '#888888', fixtureIds: ids, number }
      this.groups = existing ? this.groups.map(g => (g.id === existing.id ? group : g)) : [...this.groups, group]
      return group.id
    })
  }
  deleteGroup(id: string): void {
    this.log('deleteGroup', id)
    this.edit('deleteGroup', () => { this.groups = this.groups.filter(g => g.id !== id) })
  }
  renameGroup(id: string, name: string): void {
    this.log('renameGroup', id, name)
    this.edit('renameGroup', () => { this.groups = this.groups.map(g => (g.id === id ? { ...g, name } : g)) })
  }
  setGroupMaster(id: string, level: number): void { this.log('setGroupMaster', id, level); this.groupMasters[id] = level }

  // ---------------------------------------------------------------- chases / effects / speed
  toggleChase(id: string, on?: boolean): void {
    this.log('toggleChase', id, on)
    this.chases = this.chases.map(c => (c.id === id ? { ...c, isPlaying: on ?? !c.isPlaying } : c))
  }
  setEffectRunning(id: string, on: boolean): void {
    this.log('setEffectRunning', id, on)
    this.effects = this.effects.map(e => (e.id === id ? { ...e, isRunning: on } : e))
  }
  setSpeedMasterBpm(id: string, bpm: number): void {
    this.log('setSpeedMasterBpm', id, bpm)
    this.speedMasters = this.speedMasters.map(s => (s.id === id ? { ...s, bpm } : s))
  }
  tapSpeedMaster(id: string): void { this.log('tapSpeedMaster', id) }

  // ---------------------------------------------------------------- park / highlight / blind / masters
  park(values: CueChannelValue[]): void {
    this.log('park', values)
    this.edit('park', () => {
      const keys = new Set(values.map(v => pkey(v.fixtureId, v.channelName)))
      this.parked = [...this.parked.filter(v => !keys.has(pkey(v.fixtureId, v.channelName))), ...clone(values)]
    })
  }
  unpark(fixtureIds: string[]): void {
    this.log('unpark', fixtureIds)
    this.edit('unpark', () => { this.parked = this.parked.filter(v => !fixtureIds.includes(v.fixtureId)) })
  }
  isHighlight(): boolean { return this.highlight }
  setHighlight(on: boolean): void { this.log('setHighlight', on); this.highlight = on }
  isBlind(): boolean { return this.blind }
  setBlind(on: boolean): void { this.log('setBlind', on); this.blind = on }
  setBlackout(on?: boolean): void { this.log('setBlackout', on); this.blackout = on ?? !this.blackout }
  setGrandMaster(level: number): void { this.log('setGrandMaster', level); this.grandMaster = level }

  // ---------------------------------------------------------------- undo & UI
  transaction<T>(label: string, fn: () => T): T {
    if (this.txDepth > 0) return fn()
    const before = this.content()
    const beforeJson = JSON.stringify(before)
    this.txDepth++
    try {
      return fn()
    } finally {
      this.txDepth--
      if (JSON.stringify(this.content()) !== beforeJson) {
        this.undoStack.push({ label, before })
        this.redoStack = []
      }
    }
  }
  undo(): string | null {
    const step = this.undoStack.pop()
    if (!step) return null
    this.redoStack.push({ label: step.label, before: this.content() })
    this.restore(step.before)
    return step.label
  }
  redo(): string | null {
    const step = this.redoStack.pop()
    if (!step) return null
    this.undoStack.push({ label: step.label, before: this.content() })
    this.restore(step.before)
    return step.label
  }
  ask(question: string, choices: AskChoice[], fallback?: string): Promise<string | null> {
    this.log('ask', question, choices, fallback)
    const q: { question: string; choices: AskChoice[]; fallback?: string } = { question, choices }
    if (fallback !== undefined) q.fallback = fallback
    this.questions.push(q)
    return this.askHandler ? this.askHandler(question, choices, fallback) : Promise.resolve(this.askAnswer)
  }
  featureOf(fixtureId: string, channelName: string): CueFeature {
    const ch = this.channelsOf(fixtureId).find(c => c.name === channelName)
    return featureOfChannel(channelName, ch?.type)
  }
}

// ---------------------------------------------------------------- builders

export function makeCue(id: string, number: number, values: CueChannelValue[], name = ''): Cue {
  return { id, name: name || `Cue ${number}`, number, values, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }
}

export function makeCuelist(id: string, name: string, number: number | undefined, cues: Cue[]): Cuelist {
  const cl: Cuelist = { id, name, cues, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false }
  if (number !== undefined) cl.number = number
  return cl
}

/**
 * A small standard show:
 *   fixtures  1-4 moving heads mh1-4 · 5-8 dimmers d5-8 · 9-10 RGB pars (no dimmer) p9-10
 *             11 16-bit dimmer d11 · fid 101 dimmer d101 · one without fid (list position 13) d13
 *   groups    1 "Spots" (mh1-4) · 2 "Wash" (d5-8) · (no number, position 3) "Pars" (p9, p10)
 *   presets   0.1 "Look" · 1.1 "Half" (dimmers) · 2.1 "Center" · 4.1 "Red" · 4.2 "Blue" (moving heads)
 *   sequences 1 "Intro" (cues 1 2 3) · 2 "Verse" (1 1.5 2) · (no number, position 3) "Chorus" (1)
 *   chase 1 "Rainbow" · effect 1 "Circle" · macros 1 "Reset", 2 "Loop" (runs itself) · speed 1 "Main"
 *   executors page 1: 1.1 = Intro, 1.2 = chase Rainbow, 1.5 = Verse; page 2 empty
 */
export function createFakeShow(): FakeProApi {
  const api = new FakeProApi()
  api.defs = [MOVING_HEAD, DIMMER, RGB_PAR, DIMMER_16]
  api.patch = [
    patchEntry('mh1', MOVING_HEAD, 0, 1, { fid: 1, name: 'Spot 1' }),
    patchEntry('mh2', MOVING_HEAD, 0, 13, { fid: 2, name: 'Spot 2' }),
    patchEntry('mh3', MOVING_HEAD, 0, 25, { fid: 3, name: 'Spot 3' }),
    patchEntry('mh4', MOVING_HEAD, 0, 37, { fid: 4, name: 'Spot 4' }),
    patchEntry('d5', DIMMER, 0, 101, { fid: 5 }),
    patchEntry('d6', DIMMER, 0, 102, { fid: 6 }),
    patchEntry('d7', DIMMER, 0, 103, { fid: 7 }),
    patchEntry('d8', DIMMER, 0, 104, { fid: 8 }),
    patchEntry('p9', RGB_PAR, 0, 110, { fid: 9 }),
    patchEntry('p10', RGB_PAR, 0, 113, { fid: 10 }),
    patchEntry('d11', DIMMER_16, 0, 120, { fid: 11 }),
    patchEntry('d101', DIMMER, 1, 1, { fid: 101 }),
    patchEntry('d13', DIMMER, 1, 2)
  ]
  api.groups = [
    { id: 'g-spots', name: 'Spots', color: '#f00', fixtureIds: ['mh1', 'mh2', 'mh3', 'mh4'], number: 1 },
    { id: 'g-wash', name: 'Wash', color: '#0f0', fixtureIds: ['d5', 'd6', 'd7', 'd8'], number: 2 },
    { id: 'g-pars', name: 'Pars', color: '#00f', fixtureIds: ['p9', 'p10', 'gone'] }
  ]
  const mh = (ch: string, v: number) => Object.fromEntries(['mh1', 'mh2', 'mh3', 'mh4'].map(id => [id, { [ch]: v }]))
  api.presets = [
    { id: 'pr-look', name: 'Look', type: 'full', number: 1, values: { mh1: { Dimmer: 255, Red: 255 } } },
    { id: 'pr-half', name: 'Half', type: 'intensity', number: 1, values: Object.fromEntries(['d5', 'd6', 'd7', 'd8'].map(id => [id, { Intensity: 128 }])) },
    { id: 'pr-center', name: 'Center', type: 'position', number: 1, values: Object.fromEntries(['mh1', 'mh2', 'mh3', 'mh4'].map(id => [id, { Pan: 128, Tilt: 128 }])) },
    { id: 'pr-red', name: 'Red', type: 'color', number: 1, values: mh('Red', 255) },
    { id: 'pr-blue', name: 'Blue', type: 'color', number: 2, values: mh('Blue', 255) }
  ]
  api.cuelists = [
    makeCuelist('cl-intro', 'Intro', 1, [
      makeCue('q-i1', 1, [{ fixtureId: 'd5', channelName: 'Intensity', value: 255 }]),
      makeCue('q-i2', 2, [{ fixtureId: 'd6', channelName: 'Intensity', value: 200 }]),
      makeCue('q-i3', 3, [])
    ]),
    makeCuelist('cl-verse', 'Verse', 2, [makeCue('q-v1', 1, []), makeCue('q-v15', 1.5, []), makeCue('q-v2', 2, [])]),
    makeCuelist('cl-chorus', 'Chorus', undefined, [makeCue('q-c1', 1, [])])
  ]
  api.chases = [{
    id: 'ch-rainbow', name: 'Rainbow', steps: [], currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 120, fadePercent: 0,
    direction: 'forward', faderLevel: 255, number: 1
  }]
  api.effects = [{
    id: 'fx-circle', name: 'Circle', waveform: 'sine', speed: 1, depth: 255, offset: 0, channelType: 'Pan', fixtureIds: ['mh1'], fan: 0,
    isRunning: false, number: 1
  }]
  api.macros = [
    { id: 'm-reset', number: 1, name: 'Reset', lines: [{ command: 'ClearAll' }, { command: 'Fixture 1 Thru 4 At 0' }] },
    { id: 'm-loop', number: 2, name: 'Loop', lines: [{ command: 'Macro 2' }] }
  ]
  api.speedMasters = [{ id: 'sm-main', number: 1, name: 'Main', bpm: 120 }]
  const p1 = createExecutorPage('page-1')
  p1.cells[0][0] = { kind: 'cuelist', id: 'cl-intro', mode: 'toggle' }
  p1.cells[0][1] = { kind: 'chase', id: 'ch-rainbow', mode: 'toggle' }
  p1.cells[1][0] = { kind: 'cuelist', id: 'cl-verse', mode: 'toggle' }
  api.pages = [p1, createExecutorPage('page-2')]
  api.calls = []
  return api
}
