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
  defaultTrussBars,
  type Chase,
  type ChaseStep,
  type Cue,
  type CueChannelValue,
  type Cuelist,
  type Effect,
  type EffectChannel,
  type ExecutorSceneMode,
  type Group,
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
  type ShowTimeline,
  type SpatialAxis,
  type StageLayout,
  type TimelineClip,
  type TimelineMarker,
  type TimelineZone,
  type TrussBar,
  type WaveformKeyframe,
  type WaveformType
} from './types'

/** Current show format. v1 = "1.0.0" (≤ 0.1.x), v2 = executor layout, track names, no output config. */
export const SHOW_FORMAT_VERSION = 2

export const DEFAULT_CUE_FADE_IN = 2
export const DEFAULT_CUE_FADE_OUT = 2
export const DEFAULT_CUELIST_PRIORITY = 50
export const DEFAULT_TRACK_COUNT = 3

export const EXECUTOR_COLUMN_COUNT = 8
export const EXECUTOR_ROW_COUNT = 4
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

const PRESET_TYPES: readonly PresetType[] = ['intensity', 'color', 'position', 'gobo', 'beam', 'full']
const WAVEFORMS: readonly WaveformType[] = ['sine', 'square', 'sawtooth', 'triangle', 'random', 'pulse', 'bounce', 'step', 'custom']
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

export function normalizeChannelValues(raw: unknown): CueChannelValue[] {
  const out: CueChannelValue[] = []
  for (const v of arr(raw)) {
    if (!isObj(v) || typeof v.fixtureId !== 'string' || typeof v.channelName !== 'string') continue
    out.push({ fixtureId: v.fixtureId, channelName: v.channelName, value: dmx(v.value) })
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
  return { id, name: str(raw.name, 'Preset'), type: oneOf(raw.type, PRESET_TYPES, 'full'), values }
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
  return effect
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
  return chase
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
  return { clips, markers, zones, trackCount, trackNames }
}

/** Default (empty) executor layout. */
export function defaultExecutorLayout(): ShowExecutorLayout {
  return {
    grid: Array.from({ length: EXECUTOR_COLUMN_COUNT }, () => Array.from({ length: EXECUTOR_ROW_COUNT }, () => null)),
    columns: DEFAULT_EXECUTOR_COLUMN_COLORS.map(color => ({ title: '', color })),
    modes: Array.from({ length: EXECUTOR_COLUMN_COUNT }, () => Array.from({ length: EXECUTOR_ROW_COUNT }, () => 'toggle' as ExecutorSceneMode))
  }
}

/**
 * Normalise an executor layout to 8×4. Cells pointing at unknown cuelists
 * (when `cuelistIds` is given) are emptied; each cuelist appears once.
 */
export function normalizeExecutorLayout(raw: unknown, cuelistIds?: Set<string>): ShowExecutorLayout {
  const layout = defaultExecutorLayout()
  const o = isObj(raw) ? raw : {}
  const placed = new Set<string>()
  const grid = arr(o.grid)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const column = arr(grid[col])
    for (let row = 0; row < EXECUTOR_ROW_COUNT; row++) {
      const id = column[row]
      if (typeof id !== 'string' || placed.has(id)) continue
      if (cuelistIds && !cuelistIds.has(id)) continue
      layout.grid[col][row] = id
      placed.add(id)
    }
  }
  const columns = arr(o.columns)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const c = columns[col]
    if (isObj(c)) layout.columns[col] = { title: str(c.title, ''), color: str(c.color, layout.columns[col].color) }
  }
  const modes = arr(o.modes)
  for (let col = 0; col < EXECUTOR_COLUMN_COUNT; col++) {
    const column = arr(modes[col])
    for (let row = 0; row < EXECUTOR_ROW_COUNT; row++) {
      layout.modes[col][row] = oneOf(column[row], SCENE_MODES, 'toggle')
    }
  }
  return layout
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
    executor: normalizeExecutorLayout(data.executor, cuelistIds)
  }
  return { show, warnings }
}

/** A brand-new empty show in the current format. */
export function createEmptyShow(name = 'New Show'): ShowFile {
  return normalizeShow({ version: String(SHOW_FORMAT_VERSION), name, patch: [] }).show
}
