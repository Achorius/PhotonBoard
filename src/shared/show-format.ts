// ============================================================
// PhotonBoard — Show file format
// Schema normalisation for .pbshow data: every load goes through
// normalizeShow(), which
//   - rejects data that is not a show (clear Error),
//   - migrates older format versions,
//   - fills a default for every missing field at every level,
//   - clamps numbers, drops malformed entries (with warnings),
//   - strips runtime-only state (playing scenes, flash, running
//     effects…) so loading a show never starts anything.
// Shared by the renderer (show-io) and main.
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_ROOM_CONFIG,
  PRESET_TYPES,
  defaultTrussBars,
  type Chase,
  type ChaseStep,
  type Cue,
  type CueChannelValue,
  type CueFeature,
  type CuePart,
  type Cuelist,
  type Effect,
  type EffectChannel,
  type ExecutorButtonFn,
  type ExecutorCell,
  type ExecutorColumn,
  type ExecutorColumnFader,
  type ExecutorPage,
  type ExecutorSceneMode,
  type ExecutorTargetKind,
  type Group,
  type Macro,
  type MacroLine,
  type MibSettings,
  type MidiMapping,
  type MidiSourceType,
  type MidiTargetType,
  type MountingLocation,
  type PatchEntry,
  type Preset,
  type PresetType,
  type RoomConfig,
  type ShowExecutorLayout,
  type ShowFile,
  type ShowTimecodeSettings,
  type ShowTimeline,
  type SpatialAxis,
  type SpeedMaster,
  type StageLayout,
  type StagePage,
  type StageWidget,
  type StageWidgetKind,
  type TimelineClip,
  type TimelineMarker,
  type TimelineZone,
  type TrussBar,
  type WaveformKeyframe,
  type WaveformType
} from './types'

/**
 * Current show format. v1 = "1.0.0" (≤ 0.1.x), v2 = executor layout, track names, no output config,
 * v3 = pro programming (object numbers, preset scopes / refs, cue timing per feature / parts,
 * executor pages, macros, speed masters, stage pages, park, group masters). Every v3 field is
 * optional and a v3 file keeps the v2 fields up to date (cue values resolved, executor grid =
 * page 1), so PhotonBoard 1.0 still plays it.
 */
export const SHOW_FORMAT_VERSION = 3

export const DEFAULT_CUE_FADE_IN = 2
export const DEFAULT_CUE_FADE_OUT = 2
export const DEFAULT_CUELIST_PRIORITY = 50
export const DEFAULT_TRACK_COUNT = 3

export const EXECUTOR_COLUMN_COUNT = 8
export const EXECUTOR_ROW_COUNT = 4
export const MAX_EXECUTOR_PAGES = 16
export const DEFAULT_EXECUTOR_COLUMN_COLORS = [
  '#e85d04', '#22c55e', '#3b82f6', '#a855f7',
  '#ef4444', '#eab308', '#06b6d4', '#f97316'
]

export interface NormalizeResult {
  show: ShowFile
  warnings: string[]
}

// ------------------------------------------------------------
// Primitive helpers
// ------------------------------------------------------------

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function int(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return Math.round(num(v, fallback, min, max))
}

function optNum(v: unknown, min = -Infinity, max = Infinity): number | undefined {
  const n = num(v, NaN, min, max)
  return Number.isFinite(n) ? n : undefined
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function stringList(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string')
}

function dmx(v: unknown, fallback = 0): number {
  return int(v, fallback, 0, 255)
}

/** Ensures unique ids within one list; returns false to drop a duplicate. */
class IdRegistry {
  private readonly seen = new Set<string>()
  constructor(private readonly what: string, private readonly warnings: string[]) {}

  /** A valid unique id for the entry (generated when missing). Null = duplicate, drop it. */
  claim(raw: unknown, label: string): string | null {
    let id = typeof raw === 'string' && raw.length > 0 ? raw : ''
    if (!id) {
      id = uuidv4()
      this.warnings.push(`${this.what} "${label}" had no id — a new one was generated`)
    } else if (this.seen.has(id)) {
      this.warnings.push(`Duplicate ${this.what} id "${id}" ("${label}") — entry ignored`)
      return null
    }
    this.seen.add(id)
    return id
  }
}

// ------------------------------------------------------------
// Entity normalisers (exported for commands / tests)
// ------------------------------------------------------------

const PRESET_SCOPES = ['selective', 'global', 'universal'] as const
const CUE_FEATURES: readonly CueFeature[] = ['intensity', 'position', 'colour', 'beam', 'control']
const EXECUTOR_TARGET_KINDS: readonly ExecutorTargetKind[] = ['cuelist', 'chase', 'effect', 'macro', 'group', 'speed']
const EXECUTOR_BUTTON_FNS: readonly ExecutorButtonFn[] = ['toggle', 'go', 'goBack', 'flash', 'temp', 'off', 'select', 'swap', 'pause', 'learn']
const STAGE_WIDGET_KINDS: readonly StageWidgetKind[] = ['executor', 'fader', 'macro', 'preset', 'group', 'master', 'speed', 'go', 'clock', 'label']
/** Longest cue / value time (seconds) */
const MAX_TIME = 3600
/** Highest object number (fixture ID, group, sequence, preset slot, macro…) */
export const MAX_OBJECT_NUMBER = 99999
const WAVEFORMS: readonly WaveformType[] = ['sine', 'square', 'sawtooth', 'triangle', 'random', 'pulse', 'bounce', 'step', 'custom', 'constant']
const SPATIAL_AXES: readonly SpatialAxis[] = ['x', 'y', 'z', 'radial']
const MOUNTINGS: readonly MountingLocation[] = ['ceiling', 'floor', 'wall-left', 'wall-right', 'wall-back']
const CHASE_DIRECTIONS: readonly Chase['direction'][] = ['forward', 'backward', 'bounce', 'random']
const MIDI_SOURCE_TYPES: readonly MidiSourceType[] = ['cc', 'note', 'program']
const MIDI_TARGET_TYPES: readonly MidiTargetType[] = [
  'channel', 'cuelist_go', 'cuelist_fader', 'chase_toggle', 'chase_bpm', 'master', 'effect_toggle',
  'flash', 'blackout', 'blinder', 'strobe', 'reset', 'tap_tempo', 'timeline_play', 'timeline_stop',
  'timeline_rewind', 'timeline_goto_marker', 'timeline_goto_zone'
]
const SCENE_MODES: readonly ExecutorSceneMode[] = ['toggle', 'trigger', 'flash']

/** Positive integer object number, or undefined */
function objNumber(v: unknown): number | undefined {
  const n = optNum(v, 1, MAX_OBJECT_NUMBER)
  return n === undefined ? undefined : Math.round(n)
}

/** A time in seconds, or undefined */
function optTime(v: unknown): number | undefined {
  return optNum(v, 0, MAX_TIME)
}

export function normalizeChannelValues(raw: unknown): CueChannelValue[] {
  const out: CueChannelValue[] = []
  for (const v of arr(raw)) {
    if (!isObj(v) || typeof v.fixtureId !== 'string' || typeof v.channelName !== 'string') continue
    const value: CueChannelValue = { fixtureId: v.fixtureId, channelName: v.channelName, value: dmx(v.value) }
    const presetId = optStr(v.presetId)
    if (presetId) value.presetId = presetId
    const fade = optTime(v.fade)
    if (fade !== undefined) value.fade = fade
    const delay = optTime(v.delay)
    if (delay !== undefined) value.delay = delay
    const part = optNum(v.part, 0, 999)
    if (part !== undefined) value.part = Math.round(part)
    out.push(value)
  }
  return out
}

/** Record<string, number> of DMX values (preset value maps) */
function dmxRecord(raw: unknown): Record<string, number> {
  const clean: Record<string, number> = {}
  if (!isObj(raw)) return clean
  for (const [k, v] of Object.entries(raw)) {
    if (Number.isFinite(Number(v)) && v !== null && v !== '' && typeof v !== 'boolean') clean[k] = dmx(v)
  }
  return clean
}

/** Record<string, Record<string, number>> (preset values by fixture / by fixture type) */
function dmxRecord2(raw: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  if (!isObj(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    if (isObj(v)) out[k] = dmxRecord(v)
  }
  return out
}

function normalizePatchEntry(raw: Obj, id: string): PatchEntry {
  const entry: PatchEntry = {
    id,
    fixtureDefId: str(raw.fixtureDefId, ''),
    modeName: str(raw.modeName, ''),
    universe: int(raw.universe, 0, 0, 15),
    address: int(raw.address, 1, 1, 512),
    name: str(raw.name, 'Fixture'),
    groupIds: stringList(raw.groupIds)
  }
  const sp = raw.stagePosition
  if (isObj(sp)) entry.stagePosition = { x: num(sp.x, 0), y: num(sp.y, 0), rotation: num(sp.rotation, 0) }
  const p = raw.position3D
  if (isObj(p)) entry.position3D = { x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0) }
  const r = raw.rotation3D
  if (isObj(r)) entry.rotation3D = { rx: num(r.rx, 0), ry: num(r.ry, 0), rz: num(r.rz, 0) }
  const mountingAngle = optNum(raw.mountingAngle)
  if (mountingAngle !== undefined) entry.mountingAngle = mountingAngle
  const mountingPan = optNum(raw.mountingPan)
  if (mountingPan !== undefined) entry.mountingPan = mountingPan
  if (typeof raw.mountingLocation === 'string') entry.mountingLocation = oneOf(raw.mountingLocation, MOUNTINGS, 'ceiling')
  const beamAngle = optNum(raw.beamAngle, 0.1, 180)
  if (beamAngle !== undefined) entry.beamAngle = beamAngle
  if (typeof raw.panInvert === 'boolean') entry.panInvert = raw.panInvert
  if (typeof raw.tiltInvert === 'boolean') entry.tiltInvert = raw.tiltInvert
  if (typeof raw.pixelInvert === 'boolean') entry.pixelInvert = raw.pixelInvert
  const fid = objNumber(raw.fid)
  if (fid !== undefined) entry.fid = fid
  return entry
}

function normalizeGroup(raw: Obj, id: string): Group {
  const group: Group = {
    id,
    name: str(raw.name, 'Group'),
    color: str(raw.color, '#888888'),
    fixtureIds: stringList(raw.fixtureIds)
  }
  const parent = optStr(raw.parentGroupId)
  if (parent) group.parentGroupId = parent
  const number = objNumber(raw.number)
  if (number !== undefined) group.number = number
  return group
}

function normalizePreset(raw: Obj, id: string): Preset {
  const values: Record<string, Record<string, number>> = {}
  if (isObj(raw.values)) {
    for (const [fixtureId, chans] of Object.entries(raw.values)) {
      if (!isObj(chans)) continue
      const clean: Record<string, number> = {}
      for (const [ch, v] of Object.entries(chans)) {
        if (Number.isFinite(Number(v))) clean[ch] = dmx(v)
      }
      values[fixtureId] = clean
    }
  }
  const preset: Preset = { id, name: str(raw.name, 'Preset'), type: oneOf(raw.type, PRESET_TYPES, 'full'), values }
  const number = objNumber(raw.number)
  if (number !== undefined) preset.number = number
  if (typeof raw.scope === 'string') preset.scope = oneOf(raw.scope, PRESET_SCOPES, 'selective')
  if (isObj(raw.typeValues)) preset.typeValues = dmxRecord2(raw.typeValues)
  if (isObj(raw.universal)) preset.universal = dmxRecord(raw.universal)
  const color = optStr(raw.color)
  if (color) preset.color = color
  return preset
}

function normalizeFeatureTiming(raw: unknown): Cue['featureTiming'] | undefined {
  if (!isObj(raw)) return undefined
  const out: NonNullable<Cue['featureTiming']> = {}
  for (const f of CUE_FEATURES) {
    const t = raw[f]
    if (!isObj(t)) continue
    const entry: { fade?: number; delay?: number } = {}
    const fade = optTime(t.fade)
    if (fade !== undefined) entry.fade = fade
    const delay = optTime(t.delay)
    if (delay !== undefined) entry.delay = delay
    if (Object.keys(entry).length > 0) out[f] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeCueParts(raw: unknown): CuePart[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<number>()
  const parts: CuePart[] = []
  for (const p of raw) {
    if (!isObj(p)) continue
    const index = optNum(p.index, 0, 999)
    if (index === undefined || seen.has(Math.round(index))) continue
    const part: CuePart = { index: Math.round(index) }
    seen.add(part.index)
    const name = optStr(p.name)
    if (name) part.name = name
    const fade = optTime(p.fade)
    if (fade !== undefined) part.fade = fade
    const fadeOut = optTime(p.fadeOut)
    if (fadeOut !== undefined) part.fadeOut = fadeOut
    const delay = optTime(p.delay)
    if (delay !== undefined) part.delay = delay
    parts.push(part)
  }
  parts.sort((a, b) => a.index - b.index)
  return parts
}

function normalizeCue(raw: Obj, id: string, index: number): Cue {
  const followTime = raw.followTime === null || raw.followTime === undefined ? null : optNum(raw.followTime, 0, 86400) ?? null
  const cue: Cue = {
    id,
    name: str(raw.name, `Cue ${index + 1}`),
    number: num(raw.number, index + 1, 0),
    values: normalizeChannelValues(raw.values),
    fadeIn: num(raw.fadeIn, DEFAULT_CUE_FADE_IN, 0, 3600),
    fadeOut: num(raw.fadeOut, DEFAULT_CUE_FADE_OUT, 0, 3600),
    delay: num(raw.delay, 0, 0, 3600),
    followTime
  }
  const color = optStr(raw.color)
  if (color) cue.color = color
  const featureTiming = normalizeFeatureTiming(raw.featureTiming)
  if (featureTiming) cue.featureTiming = featureTiming
  const parts = normalizeCueParts(raw.parts)
  if (parts && parts.length > 0) cue.parts = parts
  if (typeof raw.followMode === 'string') cue.followMode = oneOf(raw.followMode, ['after-fade', 'after-go'] as const, 'after-fade')
  if (typeof raw.block === 'boolean') cue.block = raw.block
  return cue
}

function normalizeKeyframes(raw: unknown): WaveformKeyframe[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter(isObj)
    .map(k => ({ x: num(k.x, 0, 0, 1), y: num(k.y, 0, -1, 1) }))
}

function normalizeEffectChannels(raw: unknown): EffectChannel[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.filter(isObj).filter(c => typeof c.channelType === 'string').map(c => {
    const ch: EffectChannel = {
      channelType: c.channelType as string,
      phaseOffset: num(c.phaseOffset, 0),
      depth: dmx(c.depth, 255)
    }
    const fm = optNum(c.frequencyMultiplier, 0.01, 64)
    if (fm !== undefined) ch.frequencyMultiplier = fm
    if (typeof c.waveform === 'string') ch.waveform = oneOf(c.waveform, WAVEFORMS, 'sine')
    return ch
  })
}

/** Longest effect start / stop fade (seconds) */
const MAX_EFFECT_FADE = 600

/** Normalise an effect definition. Runtime state (isRunning) is always cleared. */
export function normalizeEffect(raw: unknown, id?: string): Effect | null {
  if (!isObj(raw)) return null
  const effect: Effect = {
    id: id ?? (optStr(raw.id) || uuidv4()),
    name: str(raw.name, 'Effect'),
    waveform: oneOf(raw.waveform, WAVEFORMS, 'sine'),
    speed: num(raw.speed, 1, 0, 100),
    depth: dmx(raw.depth, 255),
    offset: num(raw.offset, 0, -3600, 3600),
    channelType: str(raw.channelType, 'Dimmer'),
    fixtureIds: stringList(raw.fixtureIds),
    fan: num(raw.fan, 0, -3600, 3600),
    isRunning: false
  }
  const channels = normalizeEffectChannels(raw.channels)
  if (channels && channels.length > 0) effect.channels = channels
  if (typeof raw.oneShot === 'boolean') effect.oneShot = raw.oneShot
  const keyframes = normalizeKeyframes(raw.keyframes)
  if (keyframes) effect.keyframes = keyframes
  if (typeof raw.spatialMode === 'string') effect.spatialMode = oneOf(raw.spatialMode, ['index', 'spatial'] as const, 'index')
  if (typeof raw.spatialAxis === 'string') effect.spatialAxis = oneOf(raw.spatialAxis, SPATIAL_AXES, 'x')
  const fadeIn = optNum(raw.fadeIn, 0, MAX_EFFECT_FADE)
  if (fadeIn !== undefined) effect.fadeIn = fadeIn
  const fadeOut = optNum(raw.fadeOut, 0, MAX_EFFECT_FADE)
  if (fadeOut !== undefined) effect.fadeOut = fadeOut
  const number = objNumber(raw.number)
  if (number !== undefined) effect.number = number
  const speedMasterId = optStr(raw.speedMasterId)
  if (speedMasterId) effect.speedMasterId = speedMasterId
  const speedMultiplier = optNum(raw.speedMultiplier, 0.01, 64)
  if (speedMultiplier !== undefined) effect.speedMultiplier = speedMultiplier
  return effect
}

function normalizeMib(raw: unknown): MibSettings | undefined {
  if (!isObj(raw)) return undefined
  return { enabled: bool(raw.enabled, false), delay: num(raw.delay, 0, 0, MAX_TIME), fade: num(raw.fade, 0, 0, MAX_TIME) }
}

function normalizeCuelist(raw: Obj, id: string, warnings: string[]): Cuelist {
  const name = str(raw.name, 'Scene')
  const cueIds = new IdRegistry(`cue in "${name}"`, warnings)
  const cues: Cue[] = []
  arr(raw.cues).forEach((c) => {
    if (!isObj(c)) return
    const cueId = cueIds.claim(c.id, str(c.name, `Cue ${cues.length + 1}`))
    if (cueId) cues.push(normalizeCue(c, cueId, cues.length))
  })
  const cuelist: Cuelist = {
    id,
    name,
    cues,
    // Runtime state: a loaded show never plays by itself
    currentCueIndex: -1,
    isPlaying: false,
    isLooping: bool(raw.isLooping, false),
    priority: int(raw.priority, DEFAULT_CUELIST_PRIORITY, 0, 100),
    faderLevel: dmx(raw.faderLevel, 255),
    flash: false
  }
  if (Array.isArray(raw.effectSnapshots)) {
    cuelist.effectSnapshots = raw.effectSnapshots
      .map(e => normalizeEffect(e))
      .filter((e): e is Effect => e !== null)
  }
  const number = objNumber(raw.number)
  if (number !== undefined) cuelist.number = number
  if (typeof raw.tracking === 'boolean') cuelist.tracking = raw.tracking
  const mib = normalizeMib(raw.mib)
  if (mib) cuelist.mib = mib
  const rate = optNum(raw.rate, 0.25, 4)
  if (rate !== undefined) cuelist.rate = rate
  if (typeof raw.priorityMode === 'string') cuelist.priorityMode = oneOf(raw.priorityMode, ['normal', 'swap', 'super'] as const, 'normal')
  const speedMasterId = optStr(raw.speedMasterId)
  if (speedMasterId) cuelist.speedMasterId = speedMasterId
  return cuelist
}

function normalizeChase(raw: Obj, id: string, warnings: string[]): Chase {
  const name = str(raw.name, 'Chase')
  const stepIds = new IdRegistry(`step in "${name}"`, warnings)
  const steps: ChaseStep[] = []
  for (const s of arr(raw.steps)) {
    if (!isObj(s)) continue
    const stepId = stepIds.claim(s.id, `${name} step ${steps.length + 1}`)
    if (!stepId) continue
    const step: ChaseStep = { id: stepId, values: normalizeChannelValues(s.values) }
    const hold = optNum(s.holdTime, 0, 3600)
    if (hold !== undefined && hold > 0) step.holdTime = hold
    steps.push(step)
  }
  const chase: Chase = {
    id,
    name,
    steps,
    currentStepIndex: 0,
    isPlaying: false,
    isLooping: bool(raw.isLooping, true),
    bpm: num(raw.bpm, 120, 1, 999),
    fadePercent: num(raw.fadePercent, 0, 0, 100),
    direction: oneOf(raw.direction, CHASE_DIRECTIONS, 'forward'),
    faderLevel: dmx(raw.faderLevel, 255)
  }
  const priority = optNum(raw.priority, 0, 100)
  if (priority !== undefined) chase.priority = Math.round(priority)
  const number = objNumber(raw.number)
  if (number !== undefined) chase.number = number
  const speedMasterId = optStr(raw.speedMasterId)
  if (speedMasterId) chase.speedMasterId = speedMasterId
  return chase
}

// ------------------------------------------------------------
// v3: macros, speed masters, stage pages, park, group masters
// ------------------------------------------------------------

const MAX_MACRO_LINES = 1000
const MAX_COMMAND_LENGTH = 1000

export function normalizeMacro(raw: Obj, id: string): Macro {
  const lines: MacroLine[] = []
  for (const l of arr(raw.lines)) {
    if (lines.length >= MAX_MACRO_LINES) break
    const o = typeof l === 'string' ? { command: l } : isObj(l) ? l : null
    if (!o || typeof o.command !== 'string') continue
    const line: MacroLine = { command: o.command.slice(0, MAX_COMMAND_LENGTH) }
    const wait = optTime(o.wait)
    if (wait !== undefined && wait > 0) line.wait = wait
    lines.push(line)
  }
  const macro: Macro = { id, number: objNumber(raw.number) ?? 0, name: str(raw.name, 'Macro'), lines }
  const color = optStr(raw.color)
  if (color) macro.color = color
  return macro
}

export function normalizeSpeedMaster(raw: Obj, id: string): SpeedMaster {
  return { id, number: objNumber(raw.number) ?? 0, name: str(raw.name, 'Speed'), bpm: num(raw.bpm, 120, 1, 999) }
}

const MAX_STAGE_GRID = 32
const MAX_STAGE_WIDGETS = 512

function normalizeStageWidget(raw: Obj, id: string, cols: number, rows: number): StageWidget {
  const x = int(raw.x, 0, 0, cols - 1)
  const y = int(raw.y, 0, 0, rows - 1)
  const widget: StageWidget = {
    id,
    x,
    y,
    w: int(raw.w, 1, 1, cols - x),
    h: int(raw.h, 1, 1, rows - y),
    kind: oneOf(raw.kind, STAGE_WIDGET_KINDS, 'label')
  }
  const ref = optStr(raw.ref)
  if (ref) widget.ref = ref
  const label = typeof raw.label === 'string' ? raw.label : undefined
  if (label !== undefined) widget.label = label
  const color = optStr(raw.color)
  if (color) widget.color = color
  if (isObj(raw.options)) {
    const options: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(raw.options)) {
      if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) options[k] = v
    }
    widget.options = options
  }
  return widget
}

export function normalizeStagePage(raw: Obj, id: string, warnings: string[] = []): StagePage {
  const cols = int(raw.cols, 8, 1, MAX_STAGE_GRID)
  const rows = int(raw.rows, 6, 1, MAX_STAGE_GRID)
  const name = str(raw.name, 'Page')
  const ids = new IdRegistry(`widget in "${name}"`, warnings)
  const widgets: StageWidget[] = []
  for (const w of arr(raw.widgets)) {
    if (widgets.length >= MAX_STAGE_WIDGETS || !isObj(w)) continue
    const wid = ids.claim(w.id, 'widget')
    if (wid) widgets.push(normalizeStageWidget(w, wid, cols, rows))
  }
  return { id, name, cols, rows, widgets }
}

/** Parked values: one per fixture channel (last wins), only patched fixtures when `fixtureIds` is given */
export function normalizeParked(raw: unknown, fixtureIds?: Set<string>): CueChannelValue[] {
  const byKey = new Map<string, CueChannelValue>()
  for (const v of normalizeChannelValues(raw)) {
    if (fixtureIds && !fixtureIds.has(v.fixtureId)) continue
    const { presetId: _p, fade: _f, delay: _d, part: _pt, ...plain } = v
    byKey.set(`${v.fixtureId}:${v.channelName}`, plain)
  }
  return Array.from(byKey.values())
}

/** Group master levels (0-255) of existing groups */
export function normalizeGroupMasters(raw: unknown, groupIds?: Set<string>): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isObj(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (groupIds && !groupIds.has(id)) continue
    const level = optNum(v, 0, 255)
    if (level !== undefined) out[id] = Math.round(level)
  }
  return out
}

// ------------------------------------------------------------
// Object numbers (fixture ID, group, sequence, preset slot, macro…)
// ------------------------------------------------------------

/**
 * Give every item a unique number (per `familyOf` when given): valid numbers
 * are kept (a duplicate loses its number), the others get the next free
 * number after the highest, in list order. For a list without numbers (v2
 * migration) that is list index + 1 (per family). Mutates the items.
 */
export function fillObjectNumbers<T>(
  list: T[],
  get: (item: T) => number | undefined,
  set: (item: T, n: number) => void,
  familyOf: (item: T) => string = () => ''
): void {
  const used = new Map<string, Set<number>>()
  const missing: T[] = []
  for (const item of list) {
    const fam = familyOf(item)
    let taken = used.get(fam)
    if (!taken) { taken = new Set(); used.set(fam, taken) }
    const n = get(item)
    if (n !== undefined && Number.isInteger(n) && n >= 1 && !taken.has(n)) taken.add(n)
    else missing.push(item)
  }
  const next = new Map<string, number>()
  for (const [fam, taken] of used) next.set(fam, taken.size > 0 ? Math.max(...taken) + 1 : 1)
  for (const item of missing) {
    const fam = familyOf(item)
    const n = Math.min(next.get(fam) ?? 1, MAX_OBJECT_NUMBER)
    set(item, n)
    next.set(fam, n + 1)
  }
}

/** Next free number of a list (highest + 1, at least 1) */
export function nextObjectNumber(numbers: Iterable<number | undefined>): number {
  let max = 0
  for (const n of numbers) if (typeof n === 'number' && Number.isFinite(n) && n > max) max = n
  return Math.min(Math.floor(max) + 1, MAX_OBJECT_NUMBER)
}

function normalizeMidiMapping(raw: Obj, id: string): MidiMapping | null {
  const source = isObj(raw.source) ? raw.source : {}
  const target = isObj(raw.target) ? raw.target : {}
  const options = isObj(raw.options) ? raw.options : {}
  if (typeof target.type !== 'string' || !(MIDI_TARGET_TYPES as readonly string[]).includes(target.type)) return null
  const sourceType = oneOf(source.type, MIDI_SOURCE_TYPES, 'cc')
  const mapping: MidiMapping = {
    id,
    name: str(raw.name, 'Mapping'),
    source: {
      type: sourceType,
      channel: int(source.channel, 1, 1, 16),
      number: int(source.number, 0, 0, 127)
    },
    target: { type: target.type as MidiTargetType },
    options: {
      min: num(options.min, 0, 0, 999),
      max: num(options.max, 255, 0, 999),
      inverted: bool(options.inverted, false),
      encoding: oneOf(options.encoding, ['absolute', 'relative'] as const, 'absolute'),
      behavior: oneOf(options.behavior, ['direct', 'toggle', 'trigger', 'flash'] as const, sourceType === 'cc' ? 'direct' : 'toggle')
    }
  }
  const deviceName = optStr(source.deviceName)
  if (deviceName) mapping.source.deviceName = deviceName
  const targetId = optStr(target.id)
  if (targetId) mapping.target.id = targetId
  const parameter = optStr(target.parameter)
  if (parameter) mapping.target.parameter = parameter
  if (options.feedback === 'note' || options.feedback === 'cc') mapping.options.feedback = options.feedback
  return mapping
}

function normalizeStageLayout(raw: unknown): StageLayout {
  const o = isObj(raw) ? raw : {}
  const layout: StageLayout = {
    width: num(o.width, 1200, 1),
    height: num(o.height, 600, 1),
    fixtures: arr(o.fixtures).filter(isObj).filter(f => typeof f.patchId === 'string').map(f => ({
      patchId: f.patchId as string,
      x: num(f.x, 0),
      y: num(f.y, 0),
      rotation: num(f.rotation, 0),
      scale: num(f.scale, 1, 0.01, 100)
    }))
  }
  const bg = optStr(o.backgroundImage)
  if (bg) layout.backgroundImage = bg
  return layout
}

function normalizeRoomConfig(raw: unknown): RoomConfig {
  const o = isObj(raw) ? raw : {}
  const width = num(o.width, DEFAULT_ROOM_CONFIG.width, 1, 500)
  const depth = num(o.depth, DEFAULT_ROOM_CONFIG.depth, 1, 500)
  const height = num(o.height, DEFAULT_ROOM_CONFIG.height, 1, 100)
  const bars: TrussBar[] = Array.isArray(o.trussBars)
    ? o.trussBars.filter(isObj).map((b, i) => {
      const bar: TrussBar = {
        id: optStr(b.id) || `truss-${i}`,
        name: str(b.name, `Bar ${i + 1}`),
        z: num(b.z, 0),
        y: num(b.y, height - 0.05),
        width: num(b.width, width, 0.1)
      }
      const color = optStr(b.color)
      if (color) bar.color = color
      return bar
    })
    : defaultTrussBars(width, depth, height)
  return { width, depth, height, trussBars: bars, stageEdgeZ: num(o.stageEdgeZ, 0) }
}

function normalizeTimeline(raw: unknown, cuelistIds: Set<string>, warnings: string[]): ShowTimeline {
  const o = isObj(raw) ? raw : {}
  const clipIds = new IdRegistry('timeline clip', warnings)
  const clips: TimelineClip[] = []
  for (const c of arr(o.clips)) {
    if (!isObj(c) || typeof c.cuelistId !== 'string') continue
    if (!cuelistIds.has(c.cuelistId)) {
      warnings.push(`Timeline clip references a missing scene (${c.cuelistId}) — clip removed`)
      continue
    }
    const id = clipIds.claim(c.id, 'clip')
    if (!id) continue
    const clip: TimelineClip = {
      id,
      cuelistId: c.cuelistId,
      trackIndex: int(c.trackIndex, 0, 0, 999),
      startTime: num(c.startTime, 0, 0),
      duration: num(c.duration, 1, 0.01)
    }
    const color = optStr(c.color)
    if (color) clip.color = color
    const name = optStr(c.name)
    if (name) clip.name = name
    const fadeIn = num(c.fadeIn, 0, 0)
    if (fadeIn > 0) clip.fadeIn = Math.min(fadeIn, clip.duration)
    const fadeOut = num(c.fadeOut, 0, 0)
    if (fadeOut > 0) clip.fadeOut = Math.min(fadeOut, clip.duration)
    clips.push(clip)
  }
  const markerIds = new IdRegistry('timeline marker', warnings)
  const markers: TimelineMarker[] = []
  for (const m of arr(o.markers)) {
    if (!isObj(m)) continue
    const id = markerIds.claim(m.id, str(m.name, 'marker'))
    if (!id) continue
    const marker: TimelineMarker = { id, time: num(m.time, 0, 0), name: str(m.name, 'Marker') }
    const color = optStr(m.color)
    if (color) marker.color = color
    markers.push(marker)
  }
  markers.sort((a, b) => a.time - b.time)
  const zoneIds = new IdRegistry('timeline zone', warnings)
  const zones: TimelineZone[] = []
  for (const z of arr(o.zones)) {
    if (!isObj(z)) continue
    const id = zoneIds.claim(z.id, str(z.name, 'zone'))
    if (!id) continue
    const start = num(z.startTime, 0, 0)
    const zone: TimelineZone = {
      id,
      name: str(z.name, 'Zone'),
      startTime: start,
      endTime: Math.max(start, num(z.endTime, start, 0)),
      order: int(z.order, zones.length, 0)
    }
    const color = optStr(z.color)
    if (color) zone.color = color
    zones.push(zone)
  }
  zones.sort((a, b) => a.order - b.order)
  const maxTrack = clips.reduce((m, c) => Math.max(m, c.trackIndex + 1), 0)
  const trackCount = Math.max(int(o.trackCount, DEFAULT_TRACK_COUNT, 1, 999), maxTrack)
  const trackNames = arr(o.trackNames).slice(0, trackCount).map(n => (typeof n === 'string' ? n : ''))
  return {
    clips, markers, zones, trackCount, trackNames,
    length: num(o.length, DEFAULT_TIMELINE_LENGTH, 10, MAX_TIMELINE_LENGTH),
    loop: bool(o.loop, false),
    timecode: normalizeTimecodeSettings(o.timecode)
  }
}

export const DEFAULT_TIMELINE_LENGTH = 120
const MAX_TIMELINE_LENGTH = 36000
const TIMECODE_FPS = [24, 25, 29.97, 30] as const

function normalizeTimecodeSettings(raw: unknown): ShowTimecodeSettings {
  const o = isObj(raw) ? raw : {}
  return {
    source: oneOf(o.source, ['internal', 'mtc'] as const, 'internal'),
    fps: TIMECODE_FPS.find(f => f === o.fps) ?? 25,
    chase: bool(o.chase, false),
    dropoutMs: num(o.dropoutMs, 1000, 100, 10000),
    offset: num(o.offset, 0, -MAX_TIMELINE_LENGTH, MAX_TIMELINE_LENGTH)
  }
}

/** Ids each executor cell kind may point at (a kind left out is not checked) */
export type ExecutorRefIds = Partial<Record<ExecutorTargetKind, Set<string>>>

const COLUMN_FADER_KINDS = ['column', 'cell', 'grandmaster', 'speed', 'group', 'rate', 'xfade'] as const

function emptyCells<T>(fill: () => T): T[][] {
  return Array.from({ length: EXECUTOR_COLUMN_COUNT }, () => Array.from({ length: EXECUTOR_ROW_COUNT }, fill))
}

function defaultExecutorColumns(): ExecutorColumn[] {
  return DEFAULT_EXECUTOR_COLUMN_COLORS.map(color => ({ title: '', color }))
}

/** An empty executor page (8 × 4) */
export function createExecutorPage(id: string, name = ''): ExecutorPage {
  return { id, name, cells: emptyCells<ExecutorCell | null>(() => null), columns: defaultExecutorColumns() }
}

/** Id of the n-th page when a file has none (deterministic: loading the same file twice gives the same ids) */
export function defaultExecutorPageId(index: number): string {
  return `page-${index + 1}`
}

/**
 * The v2 view of a page: cuelist cells only (grid / modes) + column titles
 * and colours. Used as the saved mirror of pages[0] and as the executor
 * store's view of the current page.
 */
export function executorPageToLegacy(page: ExecutorPage): Pick<ShowExecutorLayout, 'grid' | 'columns' | 'modes'> {
  const grid = emptyCells<string | null>(() => null)
  const modes = emptyCells<ExecutorSceneMode>(() => 'toggle')
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    for (let row = 0; row < EXECUTOR_ROW_COUNT; row++) {
      const cell = page.cells[col]?.[row]
      if (cell && cell.kind === 'cuelist') {
        grid[col][row] = cell.id
        modes[col][row] = cell.mode
      }
    }
  }
  const columns = defaultExecutorColumns().map((d, col) => {
    const c = page.columns[col]
    return c ? { title: c.title, color: c.color } : d
  })
  return { grid, columns, modes }
}

function normalizeColumnFader(raw: unknown, refs?: ExecutorRefIds): ExecutorColumnFader | undefined {
  if (!isObj(raw) || typeof raw.kind !== 'string' || !(COLUMN_FADER_KINDS as readonly string[]).includes(raw.kind)) return undefined
  switch (raw.kind) {
    case 'column': return { kind: 'column' }
    case 'grandmaster': return { kind: 'grandmaster' }
    case 'cell':
    case 'rate':
    case 'xfade':
      return { kind: raw.kind, row: int(raw.row, 0, 0, EXECUTOR_ROW_COUNT - 1) }
    default: {
      const id = optStr(raw.id)
      if (!id) return undefined
      const ids = raw.kind === 'speed' ? refs?.speed : refs?.group
      if (ids && !ids.has(id)) return undefined
      return { kind: raw.kind as 'speed' | 'group', id }
    }
  }
}

function normalizeExecutorCell(raw: unknown, refs?: ExecutorRefIds): ExecutorCell | null {
  if (!isObj(raw)) return null
  const id = optStr(raw.id)
  if (!id || typeof raw.kind !== 'string' || !(EXECUTOR_TARGET_KINDS as readonly string[]).includes(raw.kind)) return null
  const kind = raw.kind as ExecutorTargetKind
  const ids = refs?.[kind]
  if (ids && !ids.has(id)) return null
  const cell: ExecutorCell = { kind, id, mode: oneOf(raw.mode, SCENE_MODES, 'toggle') }
  if (typeof raw.button === 'string' && (EXECUTOR_BUTTON_FNS as readonly string[]).includes(raw.button)) cell.button = raw.button as ExecutorButtonFn
  return cell
}

/**
 * Normalise one executor page to 8 × 4. Cells pointing at missing objects
 * (kinds named in `refs`) are emptied; an object appears once per page.
 */
export function normalizeExecutorPage(raw: unknown, id: string, refs?: ExecutorRefIds): ExecutorPage {
  const o = isObj(raw) ? raw : {}
  const page = createExecutorPage(id, typeof o.name === 'string' ? o.name : '')
  const placed = new Set<string>()
  const cells = arr(o.cells)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const column = arr(cells[col])
    for (let row = 0; row < EXECUTOR_ROW_COUNT; row++) {
      const cell = normalizeExecutorCell(column[row], refs)
      if (!cell) continue
      const key = `${cell.kind}:${cell.id}`
      if (placed.has(key)) continue
      placed.add(key)
      page.cells[col][row] = cell
    }
  }
  const columns = arr(o.columns)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const c = columns[col]
    if (!isObj(c)) continue
    const column: ExecutorColumn = { title: str(c.title, ''), color: str(c.color, page.columns[col].color) }
    const fader = normalizeColumnFader(c.fader, refs)
    if (fader) column.fader = fader
    page.columns[col] = column
  }
  return page
}

/** Page 1 of a v2 layout (grid / columns / modes). */
function legacyExecutorPage(o: Obj, id: string, refs?: ExecutorRefIds): ExecutorPage {
  const page = createExecutorPage(id)
  const cuelistIds = refs?.cuelist
  const placed = new Set<string>()
  const grid = arr(o.grid)
  const modes = arr(o.modes)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const column = arr(grid[col])
    const modeColumn = arr(modes[col])
    for (let row = 0; row < EXECUTOR_ROW_COUNT; row++) {
      const cid = column[row]
      if (typeof cid !== 'string' || placed.has(cid)) continue
      if (cuelistIds && !cuelistIds.has(cid)) continue
      page.cells[col][row] = { kind: 'cuelist', id: cid, mode: oneOf(modeColumn[row], SCENE_MODES, 'toggle') }
      placed.add(cid)
    }
  }
  const columns = arr(o.columns)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const c = columns[col]
    if (isObj(c)) page.columns[col] = { title: str(c.title, ''), color: str(c.color, page.columns[col].color) }
  }
  return page
}

/** Pages + their v2 mirror (grid / columns / modes = pages[0]). */
export function executorLayoutFromPages(pages: ExecutorPage[]): ShowExecutorLayout {
  const list = pages.length > 0 ? pages : [createExecutorPage(defaultExecutorPageId(0))]
  return { ...executorPageToLegacy(list[0]), pages: list }
}

/** Default (empty) executor layout: one empty page. */
export function defaultExecutorLayout(): ShowExecutorLayout {
  return executorLayoutFromPages([createExecutorPage(defaultExecutorPageId(0))])
}

/**
 * Normalise an executor layout. v3 (`pages` present): pages are the truth
 * (max MAX_EXECUTOR_PAGES, 8 × 4 each) and grid / columns / modes are
 * rebuilt as their mirror. v2: page 1 is built from grid / columns / modes.
 * Cells pointing at unknown objects (`cuelistIds`, `refs`) are emptied; an
 * object appears once per page.
 */
export function normalizeExecutorLayout(raw: unknown, cuelistIds?: Set<string>, refs?: ExecutorRefIds): ShowExecutorLayout {
  const o = isObj(raw) ? raw : {}
  const allRefs: ExecutorRefIds | undefined = cuelistIds ? { ...refs, cuelist: cuelistIds } : refs
  const rawPages = arr(o.pages).filter(isObj)
  if (rawPages.length === 0) return executorLayoutFromPages([legacyExecutorPage(o, defaultExecutorPageId(0), allRefs)])
  const seen = new Set<string>()
  const pages = rawPages.slice(0, MAX_EXECUTOR_PAGES).map((p, i) => {
    let id = optStr(p.id) ?? ''
    if (!id || seen.has(id)) {
      id = defaultExecutorPageId(i)
      if (seen.has(id)) id = uuidv4()
    }
    seen.add(id)
    return normalizeExecutorPage(p, id, allRefs)
  })
  return executorLayoutFromPages(pages)
}

/** Parse the major format version ("1.0.0" → 1, "2" → 2, 2 → 2). */
export function parseShowVersion(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return 1
}

function normalizeList<T>(
  raw: unknown,
  what: string,
  warnings: string[],
  label: (o: Obj) => string,
  build: (o: Obj, id: string) => T | null
): T[] {
  if (raw !== undefined && !Array.isArray(raw)) warnings.push(`"${what}" is not a list — ignored`)
  const ids = new IdRegistry(what, warnings)
  const out: T[] = []
  let malformed = 0
  for (const item of arr(raw)) {
    if (!isObj(item)) { malformed++; continue }
    const id = ids.claim(item.id, label(item))
    if (!id) continue
    const built = build(item, id)
    if (built) out.push(built)
    else malformed++
  }
  if (malformed > 0) warnings.push(`${malformed} malformed ${what} entr${malformed === 1 ? 'y' : 'ies'} ignored`)
  return out
}

// ------------------------------------------------------------
// normalizeShow
// ------------------------------------------------------------

/**
 * Turn anything read from a .pbshow (object or JSON text) into a complete,
 * current-version ShowFile. Throws an Error with a user-readable message when
 * the data is not a PhotonBoard show.
 */
export function normalizeShow(raw: unknown): NormalizeResult {
  let data: unknown = raw
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      throw new Error('Not a PhotonBoard show: the file is not valid JSON')
    }
  }
  if (!isObj(data)) throw new Error('Not a PhotonBoard show: expected an object')
  const looksLikeShow = 'version' in data || Array.isArray(data.patch) || Array.isArray(data.cuelists)
  if (!looksLikeShow) throw new Error('Not a PhotonBoard show: no patch, scenes or version found')
  if (data.patch !== undefined && !Array.isArray(data.patch)) throw new Error('Corrupted show: "patch" is not a list')
  if (data.cuelists !== undefined && !Array.isArray(data.cuelists)) throw new Error('Corrupted show: "cuelists" is not a list')

  const warnings: string[] = []
  const version = parseShowVersion(data.version)
  if (version > SHOW_FORMAT_VERSION) {
    warnings.push(`This show was saved by a newer PhotonBoard (format v${version}); unknown data may be lost when saving`)
  }

  const patch = normalizeList(data.patch, 'fixture', warnings, o => str(o.name, 'fixture'), normalizePatchEntry)
  const fixtureIds = new Set(patch.map(p => p.id))

  const groups = normalizeList(data.groups, 'group', warnings, o => str(o.name, 'group'), normalizeGroup)
  const groupIds = new Set(groups.map(g => g.id))
  for (const g of groups) {
    const before = g.fixtureIds.length
    g.fixtureIds = Array.from(new Set(g.fixtureIds.filter(id => fixtureIds.has(id))))
    if (g.fixtureIds.length !== before) warnings.push(`Group "${g.name}" referenced missing fixtures — cleaned up`)
    if (g.parentGroupId && !groupIds.has(g.parentGroupId)) delete g.parentGroupId
  }
  for (const p of patch) p.groupIds = p.groupIds.filter(id => groupIds.has(id))

  const presets = normalizeList(data.presets, 'preset', warnings, o => str(o.name, 'preset'), normalizePreset)
  const cuelists = normalizeList(data.cuelists, 'scene', warnings, o => str(o.name, 'scene'), (o, id) => normalizeCuelist(o, id, warnings))
  const cuelistIds = new Set(cuelists.map(c => c.id))
  const chases = normalizeList(data.chases, 'chase', warnings, o => str(o.name, 'chase'), (o, id) => normalizeChase(o, id, warnings))
  const effects = normalizeList(data.effects, 'effect', warnings, o => str(o.name, 'effect'), (o, id) => normalizeEffect(o, id))
  const midiMappings = normalizeList(data.midiMappings, 'MIDI mapping', warnings, o => str(o.name, 'mapping'), normalizeMidiMapping)
  const macros = normalizeList(data.macros, 'macro', warnings, o => str(o.name, 'macro'), normalizeMacro)
  const speedMasters = normalizeList(data.speedMasters, 'speed master', warnings, o => str(o.name, 'speed master'), normalizeSpeedMaster)
  const stagePages = normalizeList(data.stagePages, 'stage page', warnings, o => str(o.name, 'stage page'), (o, id) => normalizeStagePage(o, id, warnings))

  // v3 references: a missing preset keeps the (resolved) value, a missing speed master is dropped
  cleanProReferences({ presets, cuelists, chases, effects, speedMasters }, warnings)

  // Object numbers (v2 → v3 migration: list order; later: next free number)
  numberShowObjects({ patch, groups, presets, cuelists, chases, effects, macros, speedMasters })

  if (version < 2) {
    // v1 visualizer leaned ceiling and back-wall fixtures the other way for a
    // positive tilt; flip so existing rigs keep pointing where they did
    for (const p of patch) {
      const m = p.mountingLocation ?? 'ceiling'
      if (p.mountingAngle && (m === 'ceiling' || m === 'wall-back')) p.mountingAngle = -p.mountingAngle
    }
  }

  if (version < 2 && (Array.isArray(data.artnetConfig) || Array.isArray(data.dmxOutputs))) {
    // v1 shows carried the DMX output config; it is machine config now
    warnings.push('Legacy DMX output settings in the show were ignored (outputs are configured per machine)')
  }

  const now = new Date().toISOString()
  const show: ShowFile = {
    version: String(SHOW_FORMAT_VERSION),
    name: str(data.name, '').trim() || 'Untitled Show',
    createdAt: str(data.createdAt, now),
    modifiedAt: str(data.modifiedAt, now),
    patch,
    groups,
    presets,
    cuelists,
    chases,
    effects,
    midiMappings,
    stageLayout: normalizeStageLayout(data.stageLayout),
    roomConfig: normalizeRoomConfig(data.roomConfig),
    timeline: normalizeTimeline(data.timeline, cuelistIds, warnings),
    executor: normalizeExecutorLayout(data.executor, cuelistIds, {
      chase: new Set(chases.map(c => c.id)),
      effect: new Set(effects.map(e => e.id)),
      macro: new Set(macros.map(m => m.id)),
      group: groupIds,
      speed: new Set(speedMasters.map(m => m.id))
    }),
    macros,
    speedMasters,
    stagePages,
    parked: normalizeParked(data.parked, fixtureIds),
    groupMasters: normalizeGroupMasters(data.groupMasters, groupIds)
  }
  return { show, warnings }
}

/**
 * Number every numbered object of a show in place (see fillObjectNumbers):
 * fixture IDs, groups, sequences, chases, effects, macros, speed masters,
 * and presets per family ("Preset 4.2").
 */
export function numberShowObjects(lists: {
  patch?: PatchEntry[]; groups?: Group[]; presets?: Preset[]; cuelists?: Cuelist[]; chases?: Chase[]
  effects?: Effect[]; macros?: Macro[]; speedMasters?: SpeedMaster[]
}): void {
  if (lists.patch) fillObjectNumbers(lists.patch, p => p.fid, (p, n) => { p.fid = n })
  const byNumber = <T extends { number?: number }>(list: T[] | undefined, familyOf?: (x: T) => string) => {
    if (list) fillObjectNumbers(list, x => x.number || undefined, (x, n) => { x.number = n }, familyOf)
  }
  byNumber(lists.groups)
  byNumber(lists.presets, p => p.type)
  byNumber(lists.cuelists)
  byNumber(lists.chases)
  byNumber(lists.effects)
  byNumber(lists.macros)
  byNumber(lists.speedMasters)
}

function cleanProReferences(
  lists: { presets: Preset[]; cuelists: Cuelist[]; chases: Chase[]; effects: Effect[]; speedMasters: SpeedMaster[] },
  warnings: string[]
): void {
  const presetIds = new Set(lists.presets.map(p => p.id))
  const speedIds = new Set(lists.speedMasters.map(m => m.id))
  let dropped = 0
  const clean = (values: CueChannelValue[]) => {
    for (const v of values) {
      if (v.presetId && !presetIds.has(v.presetId)) { delete v.presetId; dropped++ }
    }
  }
  for (const cl of lists.cuelists) {
    for (const cue of cl.cues) clean(cue.values)
    if (cl.speedMasterId && !speedIds.has(cl.speedMasterId)) delete cl.speedMasterId
  }
  for (const ch of lists.chases) {
    for (const step of ch.steps) clean(step.values)
    if (ch.speedMasterId && !speedIds.has(ch.speedMasterId)) delete ch.speedMasterId
  }
  for (const e of lists.effects) {
    if (e.speedMasterId && !speedIds.has(e.speedMasterId)) delete e.speedMasterId
  }
  if (dropped > 0) warnings.push(`${dropped} value${dropped === 1 ? '' : 's'} referenced a missing preset — kept as plain values`)
}

/** A brand-new empty show in the current format. */
export function createEmptyShow(name = 'New Show'): ShowFile {
  return normalizeShow({ version: String(SHOW_FORMAT_VERSION), name, patch: [] }).show
}

// ------------------------------------------------------------
// Show content sections (remote editing)
// A remote browser edits its copy of the show and sends the changed
// SECTIONS to the console, which merges them into the running show.
// The incoming data goes through the very same normalisers as a show
// file, so a section can never carry something a .pbshow could not.
// ------------------------------------------------------------

/** Sections of the show a remote can edit (and the console versions) */
export const CONTENT_SECTIONS = [
  'patch', 'groups', 'presets', 'cuelists', 'chases', 'effects', 'midiMappings',
  // v3 — before 'executor': sections are applied in this order and executor cells may point at macros / speed masters
  'macros', 'speedMasters', 'stagePages', 'parked',
  'executor', 'timeline', 'roomConfig'
] as const
export type ContentSection = (typeof CONTENT_SECTIONS)[number]

/** Sections made of id'd items: sent as a diff */
export const LIST_SECTIONS = ['patch', 'groups', 'presets', 'cuelists', 'chases', 'effects', 'midiMappings', 'macros', 'speedMasters', 'stagePages'] as const
export type ListSection = (typeof LIST_SECTIONS)[number]

export function isContentSection(v: unknown): v is ContentSection {
  return typeof v === 'string' && (CONTENT_SECTIONS as readonly string[]).includes(v)
}

export function isListSection(v: unknown): v is ListSection {
  return typeof v === 'string' && (LIST_SECTIONS as readonly string[]).includes(v)
}

/** Timeline section: the timeline without its timecode settings (machine/console side) */
export type TimelineContent = Omit<ShowTimeline, 'timecode'> & { length: number; loop: boolean }

export interface ContentItems {
  patch: PatchEntry
  groups: Group
  presets: Preset
  cuelists: Cuelist
  chases: Chase
  effects: Effect
  midiMappings: MidiMapping
  macros: Macro
  speedMasters: SpeedMaster
  stagePages: StagePage
}

export interface ContentValues {
  executor: ShowExecutorLayout
  timeline: TimelineContent
  roomConfig: RoomConfig
  parked: CueChannelValue[]
}

/**
 * Normalise the items of a list section exactly like a show load does
 * (runtime state stripped, numbers clamped, malformed / duplicate entries dropped).
 */
export function normalizeSectionItems<S extends ListSection>(section: S, raw: unknown): ContentItems[S][] {
  const warnings: string[] = []
  const name = (o: Obj, fallback: string) => str(o.name, fallback)
  let out: unknown[]
  switch (section) {
    case 'patch': out = normalizeList(raw, 'fixture', warnings, o => name(o, 'fixture'), normalizePatchEntry); break
    case 'groups': out = normalizeList(raw, 'group', warnings, o => name(o, 'group'), normalizeGroup); break
    case 'presets': out = normalizeList(raw, 'preset', warnings, o => name(o, 'preset'), normalizePreset); break
    case 'cuelists': out = normalizeList(raw, 'scene', warnings, o => name(o, 'scene'), (o, id) => normalizeCuelist(o, id, warnings)); break
    case 'chases': out = normalizeList(raw, 'chase', warnings, o => name(o, 'chase'), (o, id) => normalizeChase(o, id, warnings)); break
    case 'effects': out = normalizeList(raw, 'effect', warnings, o => name(o, 'effect'), (o, id) => normalizeEffect(o, id)); break
    case 'midiMappings': out = normalizeList(raw, 'MIDI mapping', warnings, o => name(o, 'mapping'), normalizeMidiMapping); break
    case 'macros': {
      const macros = normalizeList(raw, 'macro', warnings, o => name(o, 'macro'), normalizeMacro)
      numberShowObjects({ macros })
      out = macros
      break
    }
    case 'speedMasters': {
      const speedMasters = normalizeList(raw, 'speed master', warnings, o => name(o, 'speed master'), normalizeSpeedMaster)
      numberShowObjects({ speedMasters })
      out = speedMasters
      break
    }
    case 'stagePages': out = normalizeList(raw, 'stage page', warnings, o => name(o, 'stage page'), (o, id) => normalizeStagePage(o, id, warnings)); break
    default: out = []
  }
  return out as ContentItems[S][]
}

/**
 * Normalise a whole-value section. `cuelistIds` = the scenes it may
 * reference; `refs` = the other objects executor cells may point at.
 */
export function normalizeSectionValue<S extends keyof ContentValues>(
  section: S, raw: unknown, cuelistIds: Set<string>, refs?: ExecutorRefIds
): ContentValues[S] {
  if (section === 'executor') return normalizeExecutorLayout(raw, cuelistIds, refs) as ContentValues[S]
  if (section === 'roomConfig') return normalizeRoomConfig(raw) as ContentValues[S]
  if (section === 'parked') return normalizeParked(raw) as ContentValues[S]
  const { timecode: _tc, ...timeline } = normalizeTimeline(raw, cuelistIds, [])
  return { ...timeline, length: timeline.length ?? DEFAULT_TIMELINE_LENGTH, loop: timeline.loop ?? false } as ContentValues[S]
}
