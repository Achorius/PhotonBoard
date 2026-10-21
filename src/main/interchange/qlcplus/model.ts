// ============================================================
// PhotonBoard — QLC+ workspace (.qxw) → typed model
//
// Mirrors what QLC+ itself reads (engine/src/doc.cpp, fixture.cpp,
// scene.cpp, chaser.cpp, chaserstep.cpp, sequence.cpp, efx.cpp,
// efxfixture.cpp, rgbmatrix.cpp, collection.cpp, show.cpp,
// track.cpp, showfunction.cpp, fixturegroup.cpp, channelsgroup.cpp,
// qlcpalette.cpp, universe.cpp, monitorproperties.cpp and
// ui/src/virtualconsole/*), including the QLC 3.x / early QLC+ 4
// legacy forms (<Value> scene values, <Bus> speeds, steps without
// timing attributes). Never throws for malformed content: missing
// numbers fall back to QLC+'s own defaults.
// Pure module.
// ============================================================

import { attr, child, childText, children, isNode, isTrue, list, parseXml, text, toFloat, toInt, type XNode } from './xml'

/** Function::infiniteSpeed() — (uint) -2 */
export const QLC_INFINITE = 4294967294
/** Function::defaultSpeed() — (uint) -1 */
export const QLC_DEFAULT_SPEED = 4294967295
/** Fixture::invalidId() / Function::invalidId() */
export const QLC_INVALID_ID = 4294967295
/** MasterTimer::frequency() — legacy bus values are in ticks */
const MASTER_TIMER_HZ = 50

export interface QlcSpeed {
  /** milliseconds (or 1/1000 beat when tempo is Beats); QLC_INFINITE = infinite */
  fadeIn: number
  fadeOut: number
  duration: number
}

export interface QlcPatchLine {
  plugin: string
  line?: number
  name?: string
  uid?: string
  profile?: string
  params: Record<string, string>
}

export interface QlcUniverse {
  id: number
  index: number
  name: string
  passthrough: boolean
  input?: QlcPatchLine
  outputs: QlcPatchLine[]
  feedback?: QlcPatchLine
}

export interface QlcFixture {
  id: number
  name: string
  manufacturer: string
  model: string
  mode: string
  universe: number
  /** 0-based DMX address */
  address: number
  channels: number
  crossUniverse: boolean
  /** RGB panel matrix size */
  width?: number
  height?: number
}

export interface QlcGroupHead {
  x: number
  y: number
  fixture: number
  head: number
}

export interface QlcFixtureGroup {
  id: number
  name: string
  sizeX: number
  sizeY: number
  heads: QlcGroupHead[]
}

export interface QlcSceneValue {
  fxi: number
  channel: number
  value: number
}

export interface QlcChannelsGroup {
  id: number
  name: string
  channels: { fxi: number; channel: number }[]
  input?: { universe: number; channel: number }
}

export interface QlcPalette {
  id: number
  type: string
  name: string
  value: string
}

interface QlcFunctionBase {
  id: number
  name: string
  path: string
  hidden: boolean
  /** 'Time' (default) or 'Beats' */
  tempo: 'Time' | 'Beats'
  speed: QlcSpeed
}

export interface QlcScene extends QlcFunctionBase {
  type: 'Scene'
  values: QlcSceneValue[]
  /** Fixture order of the FixtureVal elements */
  fixtures: number[]
}

export type QlcSpeedMode = 'Default' | 'Common' | 'PerStep'

export interface QlcStep {
  number: number
  fid: number
  fadeIn: number
  hold: number
  fadeOut: number
  duration: number
  note?: string
  /** Sequence steps: full channel set of the bound scene with this step's values */
  values?: QlcSceneValue[]
}

export interface QlcChaser extends QlcFunctionBase {
  type: 'Chaser' | 'Sequence'
  direction: 'Forward' | 'Backward'
  runOrder: 'Loop' | 'SingleShot' | 'PingPong' | 'Random'
  speedModes: { fadeIn: QlcSpeedMode; fadeOut: QlcSpeedMode; duration: QlcSpeedMode }
  steps: QlcStep[]
  /** Sequence only */
  boundScene?: number
}

export interface QlcEfxFixture {
  fixture: number
  head: number
  /** 0 = Position (pan/tilt), 1 = Dimmer, 2 = RGB */
  mode: number
  direction: 'Forward' | 'Backward'
  startOffset: number
}

export interface QlcEfx extends QlcFunctionBase {
  type: 'EFX'
  fixtures: QlcEfxFixture[]
  propagation: 'Parallel' | 'Serial' | 'Asymmetric'
  direction: 'Forward' | 'Backward'
  runOrder: QlcChaser['runOrder']
  algorithm: string
  width: number
  height: number
  rotation: number
  startOffset: number
  isRelative: boolean
  dimmerControl: boolean
  xOffset: number
  yOffset: number
  xFrequency: number
  yFrequency: number
  /** degrees */
  xPhase: number
  yPhase: number
}

export interface QlcRgbMatrix extends QlcFunctionBase {
  type: 'RGBMatrix'
  algorithmType: string
  algorithmName: string
  /** QRgb values (0xAARRGGBB); index 0 = start colour */
  colors: (number | undefined)[]
  controlMode: string
  fixtureGroup: number
  direction: 'Forward' | 'Backward'
  runOrder: QlcChaser['runOrder']
  properties: Record<string, string>
}

export interface QlcCollection extends QlcFunctionBase {
  type: 'Collection'
  functions: number[]
}

export interface QlcShowFunction {
  fid: number
  startTime: number
  duration: number
  color?: string
}

export interface QlcTrack {
  id: number
  name: string
  sceneId?: number
  mute: boolean
  functions: QlcShowFunction[]
}

export interface QlcShow extends QlcFunctionBase {
  type: 'Show'
  timeType: string
  bpm: number
  tracks: QlcTrack[]
}

export interface QlcOtherFunction extends QlcFunctionBase {
  type: 'Script' | 'Audio' | 'Video' | 'Undefined'
  source?: string
}

export type QlcFunction = QlcScene | QlcChaser | QlcEfx | QlcRgbMatrix | QlcCollection | QlcShow | QlcOtherFunction

export interface QlcMonitorItem {
  fixture: number
  head: number
  linked: number
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  hasZ: boolean
  hidden: boolean
  invertedPan: boolean
  invertedTilt: boolean
  gelColor?: string
}

export interface QlcMonitor {
  gridWidth: number
  gridHeight: number
  gridDepth: number
  /** 0 = metres, 1 = feet */
  gridUnits: number
  /** 0 Undefined (2D), 1 Top, 2 Front, 3 Right, 4 Left */
  pointOfView: number
  items: QlcMonitorItem[]
}

// ---- Virtual console ----

export interface QlcInputSource {
  universe: number
  /** raw input channel (MIDI: CC 0-127, notes 128-255, …; page in bits 16+, OMNI channel in bits 12-15) */
  channel: number
}

export interface QlcVcWidget {
  kind: string
  id?: number
  caption: string
  page: number
  x: number
  y: number
  width: number
  height: number
  /** Absolute position on the console (frames' offsets added) */
  absX: number
  absY: number
  /** Inputs by role: 'main', 'next', 'previous', 'playback', 'stop', 'flash', 'enable', … */
  inputs: Record<string, QlcInputSource>
  keys: Record<string, string>
  backgroundColor?: number
  // Button
  functionId?: number
  action?: string
  // Slider
  sliderMode?: string
  levelChannels?: { fixture: number; channel: number }[]
  levelLow?: number
  levelHigh?: number
  playbackFunction?: number
  playbackFlash?: boolean
  // Cue list
  chaserId?: number
  // Frames
  children?: QlcVcWidget[]
  multipage?: { pages: number; current: number }
  solo?: boolean
  /** Speed dial / XY pad / matrix etc.: referenced functions */
  functions?: number[]
}

export interface QlcVirtualConsole {
  root: QlcVcWidget
  grandMasterInput?: QlcInputSource
  width?: number
  height?: number
}

export interface QlcWorkspace {
  creator: { name: string; version: string; author: string }
  universes: QlcUniverse[]
  beatBpm?: number
  fixtures: QlcFixture[]
  fixtureGroups: QlcFixtureGroup[]
  channelsGroups: QlcChannelsGroup[]
  palettes: QlcPalette[]
  functions: QlcFunction[]
  monitor?: QlcMonitor
  virtualConsole?: QlcVirtualConsole
  autostartFunction?: number
  simpleDeskCueStacks: number
  /** Unknown / unsupported engine tags (names) */
  unknownEngineTags: string[]
}

// ------------------------------------------------------------ parsing

function int(v: string | undefined, fallback: number): number {
  return toInt(v, fallback)
}

function uint(v: string | undefined, fallback: number): number {
  const n = toInt(v, fallback)
  return n < 0 ? fallback : n
}

function direction(s: string): 'Forward' | 'Backward' {
  return s.trim() === 'Backward' ? 'Backward' : 'Forward'
}

function runOrder(s: string): QlcChaser['runOrder'] {
  const t = s.trim()
  return t === 'PingPong' || t === 'SingleShot' || t === 'Random' ? t : 'Loop'
}

function speedMode(s: string | undefined): QlcSpeedMode {
  return s === 'Common' || s === 'PerStep' ? s : 'Default'
}

function parsePatchLine(node: XNode): QlcPatchLine {
  const params: Record<string, string> = {}
  const pp = child(node, 'PluginParameters')
  if (pp) {
    for (const [k, v] of Object.entries(pp)) {
      if (k.startsWith('@_')) params[k.slice(2)] = String(v)
    }
  }
  const line = attr(node, 'Line')
  return {
    plugin: attr(node, 'Plugin') ?? 'None',
    line: line === undefined ? undefined : uint(line, 0),
    name: attr(node, 'Name'),
    uid: attr(node, 'UID'),
    profile: attr(node, 'Profile'),
    params
  }
}

function parseUniverses(io: XNode | undefined): { universes: QlcUniverse[]; bpm?: number } {
  const universes: QlcUniverse[] = []
  if (!io) return { universes }
  children(io, 'Universe').forEach((u, index) => {
    const outputs = children(u, 'Output').map(parsePatchLine)
    const input = child(u, 'Input')
    const feedback = child(u, 'Feedback')
    universes.push({
      id: uint(attr(u, 'ID'), index),
      index,
      name: attr(u, 'Name') ?? `Universe ${index + 1}`,
      passthrough: isTrue(attr(u, 'Passthrough')),
      input: input ? parsePatchLine(input) : undefined,
      outputs,
      feedback: feedback ? parsePatchLine(feedback) : undefined
    })
  })
  const beat = child(io, 'BeatGenerator')
  const bpm = beat ? toInt(attr(beat, 'BPM'), 0) : 0
  return { universes, bpm: bpm > 0 ? bpm : undefined }
}

function parseFixture(node: XNode): QlcFixture | null {
  const id = uint(childText(node, 'ID'), QLC_INVALID_ID)
  if (id === QLC_INVALID_ID) return null
  const width = childText(node, 'Width')
  const height = childText(node, 'Height')
  return {
    id,
    name: childText(node, 'Name'),
    manufacturer: childText(node, 'Manufacturer'),
    model: childText(node, 'Model'),
    mode: childText(node, 'Mode'),
    universe: uint(childText(node, 'Universe'), 0),
    address: uint(childText(node, 'Address'), 0),
    channels: uint(childText(node, 'Channels'), 0),
    crossUniverse: node.CrossUniverse !== undefined,
    width: width ? uint(width, 0) : undefined,
    height: height ? uint(height, 0) : undefined
  }
}

function parseFixtureGroup(node: XNode): QlcFixtureGroup {
  const size = child(node, 'Size')
  return {
    id: uint(attr(node, 'ID'), 0),
    name: childText(node, 'Name'),
    sizeX: uint(attr(size, 'X'), 0),
    sizeY: uint(attr(size, 'Y'), 0),
    heads: children(node, 'Head').map((h) => ({
      x: int(attr(h, 'X'), 0),
      y: int(attr(h, 'Y'), 0),
      fixture: uint(attr(h, 'Fixture'), QLC_INVALID_ID),
      head: uint(text(h).trim(), 0)
    })).filter((h) => h.fixture !== QLC_INVALID_ID)
  }
}

function parseChannelsGroup(node: XNode): QlcChannelsGroup {
  const nums = text(node).split(',').map((s) => s.trim()).filter((s) => s !== '').map((s) => uint(s, -1))
  const channels: { fxi: number; channel: number }[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (nums[i] >= 0 && nums[i + 1] >= 0) channels.push({ fxi: nums[i], channel: nums[i + 1] })
  }
  const iu = attr(node, 'InputUniverse')
  const ic = attr(node, 'InputChannel')
  return {
    id: uint(attr(node, 'ID'), 0),
    name: attr(node, 'Name') ?? '',
    channels,
    input: iu !== undefined && ic !== undefined ? { universe: uint(iu, 0), channel: uint(ic, 0) } : undefined
  }
}

function parseSpeed(node: XNode, legacyBus: (role: string) => number | undefined, defaults: QlcSpeed): QlcSpeed {
  const sp = child(node, 'Speed')
  if (sp) {
    return {
      fadeIn: uint(attr(sp, 'FadeIn'), 0),
      fadeOut: uint(attr(sp, 'FadeOut'), 0),
      duration: uint(attr(sp, 'Duration'), 0)
    }
  }
  const speed = { ...defaults }
  const fade = legacyBus('Fade')
  const hold = legacyBus('Hold')
  if (fade !== undefined) { speed.fadeIn = fade; speed.fadeOut = fade }
  if (hold !== undefined) speed.duration = hold
  return speed
}

function parseSceneValues(fn: XNode): { values: QlcSceneValue[]; fixtures: number[] } {
  const values: QlcSceneValue[] = []
  const fixtures: number[] = []
  const seen = new Map<string, number>()
  const set = (v: QlcSceneValue): void => {
    const key = `${v.fxi}:${v.channel}`
    const at = seen.get(key)
    if (at !== undefined) values[at] = v
    else { seen.set(key, values.length); values.push(v) }
  }
  for (const v of children(fn, 'Value')) {
    const fxi = uint(attr(v, 'Fixture'), QLC_INVALID_ID)
    const channel = uint(attr(v, 'Channel'), QLC_INVALID_ID)
    if (fxi === QLC_INVALID_ID || channel === QLC_INVALID_ID) continue
    if (!fixtures.includes(fxi)) fixtures.push(fxi)
    set({ fxi, channel, value: clampByte(uint(text(v).trim(), 0)) })
  }
  for (const fv of children(fn, 'FixtureVal')) {
    const fxi = uint(attr(fv, 'ID'), QLC_INVALID_ID)
    if (fxi === QLC_INVALID_ID) continue
    if (!fixtures.includes(fxi)) fixtures.push(fxi)
    const parts = text(fv).split(',').map((s) => s.trim())
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const channel = uint(parts[i], -1)
      const value = toInt(parts[i + 1], -1)
      if (channel < 0 || value < 0) continue
      set({ fxi, channel, value: value & 0xff })
    }
  }
  return { values, fixtures }
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function parseStep(node: XNode, index: number, sceneValues?: QlcSceneValue[]): QlcStep {
  const fadeInA = attr(node, 'FadeIn')
  const holdA = attr(node, 'Hold')
  const fadeOutA = attr(node, 'FadeOut')
  const durationA = attr(node, 'Duration')
  const fadeIn = fadeInA !== undefined ? uint(fadeInA, 0) : 0
  let hold = holdA !== undefined ? uint(holdA, 0) : 0
  let duration = durationA !== undefined ? uint(durationA, 0) : 0
  // chaserstep.cpp: Hold wins; (int) < 0 means infinite
  if (holdA !== undefined) duration = hold >= 0x80000000 ? hold : fadeIn + hold
  else hold = duration >= 0x80000000 ? duration : Math.max(0, duration - fadeIn)
  const step: QlcStep = {
    number: toInt(attr(node, 'Number'), index),
    fid: QLC_INVALID_ID,
    fadeIn,
    hold,
    fadeOut: fadeOutA !== undefined ? uint(fadeOutA, 0) : 0,
    duration
  }
  const note = attr(node, 'Note')
  if (note) step.note = note
  if (attr(node, 'Values') !== undefined) {
    // fixtureID:channel,value,channel,value:fixtureID:…
    const values = (sceneValues ?? []).map((v) => ({ ...v }))
    const content = text(node).trim()
    if (content) {
      const chunks = content.split(':')
      for (let f = 0; f + 1 < chunks.length; f += 2) {
        const fxi = uint(chunks[f].trim(), QLC_INVALID_ID)
        if (fxi === QLC_INVALID_ID) continue
        const arr = chunks[f + 1].split(',').map((s) => s.trim())
        for (let i = 0; i + 1 < arr.length; i += 2) {
          const channel = uint(arr[i], -1)
          if (channel < 0) continue
          const value = toInt(arr[i + 1], 0) & 0xff
          const at = values.findIndex((v) => v.fxi === fxi && v.channel === channel)
          if (at >= 0) values[at] = { fxi, channel, value }
          else values.push({ fxi, channel, value })
        }
      }
    }
    step.values = values
  } else {
    step.fid = uint(text(node).trim(), QLC_INVALID_ID)
  }
  return step
}

function sortSteps(steps: QlcStep[]): QlcStep[] {
  // Chaser::loadXML inserts by Number; keep file order for duplicates
  const out: QlcStep[] = []
  for (const s of steps) {
    if (s.number >= out.length || s.number < 0) out.push(s)
    else out.splice(s.number, 0, s)
  }
  return out
}

function parseFunction(fn: XNode, buses: Map<number, number>, scenesById: Map<number, QlcScene>): QlcFunction | null {
  const id = uint(attr(fn, 'ID'), QLC_INVALID_ID)
  if (id === QLC_INVALID_ID) return null
  const type = attr(fn, 'Type') ?? 'Undefined'
  const legacyBus = (role: string): number | undefined => {
    for (const b of children(fn, 'Bus')) {
      const r = attr(b, 'Role') ?? 'Fade'
      if (r !== role) continue
      const busId = uint(text(b).trim(), -1)
      // Bus default values are 0 when the workspace does not define them
      const ticks = buses.get(busId) ?? 0
      return Math.floor(ticks / MASTER_TIMER_HZ) * 1000
    }
    return undefined
  }
  const base = {
    id,
    name: attr(fn, 'Name') ?? `Function ${id}`,
    path: attr(fn, 'Path') ?? '',
    hidden: attr(fn, 'Hidden') !== undefined,
    tempo: (childText(fn, 'Tempo') === 'Beats' ? 'Beats' : 'Time') as 'Time' | 'Beats'
  }
  switch (type) {
    case 'Scene': {
      const { values, fixtures } = parseSceneValues(fn)
      return { ...base, type: 'Scene', speed: parseSpeed(fn, legacyBus, { fadeIn: 0, fadeOut: 0, duration: 0 }), values, fixtures }
    }
    case 'Chaser':
    case 'Sequence': {
      const modes = child(fn, 'SpeedModes')
      const boundScene = type === 'Sequence' ? uint(attr(fn, 'BoundScene'), QLC_INVALID_ID) : undefined
      // Sequence::loadXML: steps start from the bound scene's channels (sorted by fixture, channel)
      const bound = boundScene !== undefined ? scenesById.get(boundScene) : undefined
      const base0 = bound ? [...bound.values].sort((a, b) => a.fxi - b.fxi || a.channel - b.channel) : undefined
      const steps = sortSteps(children(fn, 'Step').map((s, i) => parseStep(s, i, base0)))
      if (type === 'Sequence') for (const s of steps) s.fid = boundScene ?? QLC_INVALID_ID
      const chaser: QlcChaser = {
        ...base,
        type,
        speed: parseSpeed(fn, legacyBus, { fadeIn: 0, fadeOut: 0, duration: 0 }),
        direction: direction(childText(fn, 'Direction')),
        runOrder: runOrder(childText(fn, 'RunOrder')),
        speedModes: {
          fadeIn: speedMode(attr(modes, 'FadeIn')),
          fadeOut: speedMode(attr(modes, 'FadeOut')),
          // Chaser constructor: hold mode Common
          duration: modes ? (attr(modes, 'Duration') === 'PerStep' ? 'PerStep' : 'Common') : 'Common'
        },
        steps
      }
      if (boundScene !== undefined) chaser.boundScene = boundScene
      return chaser
    }
    case 'EFX': {
      const axes = children(fn, 'Axis')
      const axis = (name: string): XNode | undefined => axes.find((a) => attr(a, 'Name') === name)
      const x = axis('X')
      const y = axis('Y')
      const fixtures: QlcEfxFixture[] = children(fn, 'Fixture').map((f) => ({
        fixture: uint(childText(f, 'ID'), QLC_INVALID_ID),
        head: uint(childText(f, 'Head'), 0),
        mode: uint(childText(f, 'Mode'), 0),
        direction: direction(childText(f, 'Direction')),
        startOffset: int(childText(f, 'StartOffset'), 0)
      })).filter((f) => f.fixture !== QLC_INVALID_ID)
      const prop = childText(fn, 'PropagationMode')
      return {
        ...base,
        type: 'EFX',
        speed: parseSpeed(fn, legacyBus, { fadeIn: 0, fadeOut: 0, duration: 20000 }),
        fixtures,
        propagation: prop === 'Serial' || prop === 'Asymmetric' ? prop : 'Parallel',
        direction: direction(childText(fn, 'Direction')),
        runOrder: runOrder(childText(fn, 'RunOrder')),
        algorithm: childText(fn, 'Algorithm') || 'Circle',
        width: clamp(int(childText(fn, 'Width'), 127), 0, 127),
        height: clamp(int(childText(fn, 'Height'), 127), 0, 127),
        rotation: clamp(int(childText(fn, 'Rotation'), 0), 0, 359),
        startOffset: clamp(int(childText(fn, 'StartOffset'), 0), 0, 359),
        isRelative: isTrue(childText(fn, 'IsRelative')),
        dimmerControl: isTrue(childText(fn, 'DimmerControl')),
        xOffset: clamp(int(childText(x, 'Offset'), 127), 0, 255),
        yOffset: clamp(int(childText(y, 'Offset'), 127), 0, 255),
        xFrequency: clamp(int(childText(x, 'Frequency'), 2), 0, 32),
        yFrequency: clamp(int(childText(y, 'Frequency'), 3), 0, 32),
        xPhase: clamp(int(childText(x, 'Phase'), 90), 0, 359),
        yPhase: clamp(int(childText(y, 'Phase'), 0), 0, 359)
      }
    }
    case 'RGBMatrix': {
      const algo = child(fn, 'Algorithm')
      const colors: (number | undefined)[] = []
      const mono = childText(fn, 'MonoColor')
      const endc = childText(fn, 'EndColor')
      if (mono) colors[0] = uint(mono, 0)
      if (endc) colors[1] = uint(endc, 0)
      for (const c of children(fn, 'Color')) {
        const idx = uint(attr(c, 'Index'), -1)
        if (idx >= 0 && idx < 16) colors[idx] = uint(text(c).trim(), 0)
      }
      const properties: Record<string, string> = {}
      for (const p of children(fn, 'Property')) {
        const n = attr(p, 'Name')
        if (n) properties[n] = attr(p, 'Value') ?? ''
      }
      return {
        ...base,
        type: 'RGBMatrix',
        speed: parseSpeed(fn, legacyBus, { fadeIn: 0, fadeOut: 0, duration: 500 }),
        algorithmType: attr(algo, 'Type') ?? '',
        algorithmName: text(algo).trim(),
        colors,
        controlMode: childText(fn, 'ControlMode') || 'RGB',
        fixtureGroup: uint(childText(fn, 'FixtureGroup'), QLC_INVALID_ID),
        direction: direction(childText(fn, 'Direction')),
        runOrder: runOrder(childText(fn, 'RunOrder')),
        properties
      }
    }
    case 'Collection': {
      const steps = sortSteps(children(fn, 'Step').map((s, i) => ({
        number: toInt(attr(s, 'Number'), i), fid: uint(text(s).trim(), QLC_INVALID_ID), fadeIn: 0, hold: 0, fadeOut: 0, duration: 0
      })))
      return { ...base, type: 'Collection', speed: { fadeIn: 0, fadeOut: 0, duration: 0 }, functions: steps.map((s) => s.fid).filter((f) => f !== QLC_INVALID_ID) }
    }
    case 'Show': {
      const td = child(fn, 'TimeDivision')
      const tracks: QlcTrack[] = []
      for (const t of children(fn, 'Track')) {
        const tid = toInt(attr(t, 'ID'), -1)
        if (tid < 0) continue
        const sceneA = attr(t, 'SceneID')
        const functions: QlcShowFunction[] = children(t, 'ShowFunction').map((sf) => {
          const color = attr(sf, 'Color')
          return {
            fid: uint(attr(sf, 'ID'), QLC_INVALID_ID),
            startTime: uint(attr(sf, 'StartTime'), 0),
            duration: uint(attr(sf, 'Duration'), 0),
            ...(color ? { color } : {})
          }
        }).filter((sf) => sf.fid !== QLC_INVALID_ID)
        // LEGACY <Functions>1,2,3</Functions>
        for (const legacy of children(t, 'Functions')) {
          for (const s of text(legacy).split(',')) {
            const fid = uint(s.trim(), QLC_INVALID_ID)
            if (fid !== QLC_INVALID_ID) functions.push({ fid, startTime: 0, duration: 0 })
          }
        }
        tracks.push({
          id: tid,
          name: attr(t, 'Name') ?? `Track ${tracks.length + 1}`,
          sceneId: sceneA !== undefined ? uint(sceneA, QLC_INVALID_ID) : undefined,
          mute: toInt(attr(t, 'isMute'), 0) !== 0,
          functions
        })
      }
      return {
        ...base,
        type: 'Show',
        speed: { fadeIn: 0, fadeOut: 0, duration: 0 },
        timeType: attr(td, 'Type') ?? 'Time',
        bpm: uint(attr(td, 'BPM'), 120),
        tracks
      }
    }
    case 'Script':
    case 'Audio':
    case 'Video':
      return { ...base, type, speed: parseSpeed(fn, legacyBus, { fadeIn: 0, fadeOut: 0, duration: 0 }), source: childText(fn, 'Source') || undefined }
    default:
      return { ...base, type: 'Undefined', speed: { fadeIn: 0, fadeOut: 0, duration: 0 }, source: type }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function parseMonitor(node: XNode | undefined): QlcMonitor | undefined {
  if (!node) return undefined
  const grid = child(node, 'Grid')
  const h = uint(attr(grid, 'Height'), 3)
  const items: QlcMonitorItem[] = children(node, 'FxItem').map((it) => {
    const legacyRot = attr(it, 'Rotation')
    return {
      fixture: uint(attr(it, 'ID'), QLC_INVALID_ID),
      head: uint(attr(it, 'Head'), 0),
      linked: uint(attr(it, 'Linked'), 0),
      x: toFloat(attr(it, 'XPos'), 0),
      y: toFloat(attr(it, 'YPos'), 0),
      z: toFloat(attr(it, 'ZPos'), 0),
      hasZ: attr(it, 'ZPos') !== undefined,
      rx: toFloat(attr(it, 'XRot'), 0),
      ry: legacyRot !== undefined ? toFloat(legacyRot, 0) : toFloat(attr(it, 'YRot'), 0),
      rz: toFloat(attr(it, 'ZRot'), 0),
      hidden: attr(it, 'Hidden') !== undefined,
      invertedPan: attr(it, 'InvertedPan') !== undefined,
      invertedTilt: attr(it, 'InvertedTilt') !== undefined,
      gelColor: attr(it, 'GelColor')
    }
  }).filter((i) => i.fixture !== QLC_INVALID_ID)
  return {
    gridWidth: uint(attr(grid, 'Width'), 5),
    gridHeight: h,
    gridDepth: uint(attr(grid, 'Depth'), h),
    gridUnits: uint(attr(grid, 'Units'), 0),
    pointOfView: uint(attr(grid, 'POV'), 0),
    items
  }
}

// ---- Virtual console ----

const VC_WIDGET_TAGS = ['Frame', 'SoloFrame', 'Button', 'Slider', 'Knob', 'CueList', 'XYPad', 'Label', 'SpeedDial', 'AudioTriggers', 'Clock', 'Matrix', 'Animation'] as const

function inputOf(node: XNode | undefined): QlcInputSource | undefined {
  const inp = child(node, 'Input')
  if (!inp) return undefined
  const u = attr(inp, 'Universe')
  const c = attr(inp, 'Channel')
  if (u === undefined || c === undefined) return undefined
  const universe = uint(u, QLC_INVALID_ID)
  const channel = uint(c, QLC_INVALID_ID)
  if (universe === QLC_INVALID_ID || channel === QLC_INVALID_ID) return undefined
  return { universe, channel }
}

function colorOf(appearance: XNode | undefined): number | undefined {
  const bg = childText(appearance, 'BackgroundColor')
  if (!bg || bg === 'Default') return undefined
  const n = uint(bg, -1)
  return n >= 0 ? n : undefined
}

function parseVcWidget(tag: string, node: XNode, offX: number, offY: number): QlcVcWidget {
  const ws = child(node, 'WindowState')
  const x = int(attr(ws, 'X'), 0)
  const y = int(attr(ws, 'Y'), 0)
  const w: QlcVcWidget = {
    kind: tag,
    caption: attr(node, 'Caption') ?? '',
    page: uint(attr(node, 'Page'), 0),
    x,
    y,
    width: int(attr(ws, 'Width'), 0),
    height: int(attr(ws, 'Height'), 0),
    absX: offX + x,
    absY: offY + y,
    inputs: {},
    keys: {}
  }
  const id = attr(node, 'ID')
  if (id !== undefined) w.id = uint(id, 0)
  const bg = colorOf(child(node, 'Appearance'))
  if (bg !== undefined) w.backgroundColor = bg
  const main = inputOf(node)
  if (main) w.inputs.main = main
  const key = childText(node, 'Key')
  if (key) w.keys.main = key

  switch (tag) {
    case 'Button': {
      w.functionId = uint(attr(child(node, 'Function'), 'ID'), QLC_INVALID_ID)
      w.action = childText(node, 'Action') || 'Toggle'
      break
    }
    case 'Slider':
    case 'Knob': {
      w.sliderMode = childText(node, 'SliderMode') || 'Level'
      const level = child(node, 'Level')
      w.levelLow = uint(attr(level, 'LowLimit'), 0)
      w.levelHigh = uint(attr(level, 'HighLimit'), 255)
      w.levelChannels = children(level, 'Channel').map((c) => ({ fixture: uint(attr(c, 'Fixture'), QLC_INVALID_ID), channel: uint(text(c).trim(), QLC_INVALID_ID) }))
        .filter((c) => c.fixture !== QLC_INVALID_ID && c.channel !== QLC_INVALID_ID)
      const pb = child(node, 'Playback')
      w.playbackFunction = uint(childText(pb, 'Function'), QLC_INVALID_ID)
      const flash = child(pb, 'Flash')
      if (flash) {
        w.playbackFlash = true
        const fi = inputOf(flash)
        if (fi) w.inputs.flash = fi
      }
      // Older QLC: <Bus> slider mode
      break
    }
    case 'CueList': {
      // <Chaser> (4.x) or legacy <Function>
      const ch = childText(node, 'Chaser') || childText(node, 'Function')
      w.chaserId = uint(ch, QLC_INVALID_ID)
      for (const role of ['Next', 'Previous', 'Playback', 'Stop', 'CrossLeft', 'CrossRight']) {
        const src = inputOf(child(node, role))
        if (src) w.inputs[role.toLowerCase()] = src
        const k = childText(child(node, role), 'Key')
        if (k) w.keys[role.toLowerCase()] = k
      }
      break
    }
    case 'SpeedDial':
    case 'XYPad':
    case 'Matrix':
    case 'Animation': {
      const fns: number[] = []
      for (const f of children(node, 'Function')) {
        const fid = uint(attr(f, 'ID') ?? text(f).trim(), QLC_INVALID_ID)
        if (fid !== QLC_INVALID_ID) fns.push(fid)
      }
      const single = uint(childText(node, 'Function'), QLC_INVALID_ID)
      if (single !== QLC_INVALID_ID && !fns.includes(single)) fns.push(single)
      if (fns.length) w.functions = fns
      break
    }
    default:
      break
  }

  if (tag === 'Frame' || tag === 'SoloFrame') {
    w.solo = tag === 'SoloFrame'
    const mp = child(node, 'Multipage')
    if (mp) w.multipage = { pages: uint(attr(mp, 'PagesNum'), 1), current: uint(attr(mp, 'CurrentPage'), 0) }
    const enable = inputOf(child(node, 'Enable'))
    if (enable) w.inputs.enable = enable
    const next = inputOf(child(node, 'Next'))
    if (next) w.inputs.nextPage = next
    const prev = inputOf(child(node, 'Previous'))
    if (prev) w.inputs.previousPage = prev
    w.children = []
    for (const childTag of VC_WIDGET_TAGS) {
      for (const c of children(node, childTag)) w.children.push(parseVcWidget(childTag, c, w.absX, w.absY))
    }
  }
  return w
}

function parseVirtualConsole(node: XNode | undefined): QlcVirtualConsole | undefined {
  if (!node) return undefined
  const rootFrame = child(node, 'Frame')
  const root = rootFrame ? parseVcWidget('Frame', rootFrame, 0, 0) : { kind: 'Frame', caption: '', page: 0, x: 0, y: 0, width: 0, height: 0, absX: 0, absY: 0, inputs: {}, keys: {}, children: [] }
  // The bottom frame has no WindowState offset
  root.absX = 0
  root.absY = 0
  const props = child(node, 'Properties')
  const size = child(props, 'Size')
  const gm = child(props, 'GrandMaster')
  const vc: QlcVirtualConsole = { root }
  const gmInput = inputOf(gm)
  if (gmInput) vc.grandMasterInput = gmInput
  if (size) {
    vc.width = uint(attr(size, 'Width'), 0)
    vc.height = uint(attr(size, 'Height'), 0)
  }
  return vc
}

/** Decode the file bytes (UTF-8, optional BOM; UTF-16 BOM tolerated) */
export function decodeWorkspaceText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  return new TextDecoder('utf-8').decode(bytes.subarray(start))
}

export class NotAWorkspaceError extends Error {}

/** Parse a workspace. Throws NotAWorkspaceError when the XML is not a QLC+ / QLC workspace. */
export function parseWorkspace(xmlText: string): QlcWorkspace {
  let doc: XNode
  try {
    doc = parseXml(xmlText)
  } catch (e) {
    throw new NotAWorkspaceError(`Not a QLC+ workspace: ${(e as Error).message}`)
  }
  const ws = doc.Workspace
  if (!isNode(ws)) throw new NotAWorkspaceError('Not a QLC+ workspace (no <Workspace> element)')
  const engine = child(ws, 'Engine') ?? {}
  const creator = child(ws, 'Creator')

  const buses = new Map<number, number>()
  for (const b of children(engine, 'Bus')) {
    const id = uint(attr(b, 'ID'), -1)
    if (id >= 0) buses.set(id, uint(childText(b, 'Value'), 0))
  }

  const { universes, bpm } = parseUniverses(child(engine, 'InputOutputMap'))
  const fixtures = children(engine, 'Fixture').map(parseFixture).filter((f): f is QlcFixture => f !== null)
  const fixtureGroups = children(engine, 'FixtureGroup').map(parseFixtureGroup)
  const channelsGroups = children(engine, 'ChannelsGroup').map(parseChannelsGroup)
  const palettes: QlcPalette[] = children(engine, 'Palette').map((p) => ({
    id: uint(attr(p, 'ID'), 0),
    type: attr(p, 'Type') ?? '',
    name: attr(p, 'Name') ?? '',
    value: attr(p, 'Value') ?? ''
  }))

  // Scenes first: sequences read their bound scene's channels
  const fnNodes = children(engine, 'Function')
  const scenesById = new Map<number, QlcScene>()
  for (const fn of fnNodes) {
    if (attr(fn, 'Type') !== 'Scene') continue
    const s = parseFunction(fn, buses, scenesById)
    if (s && s.type === 'Scene') scenesById.set(s.id, s)
  }
  const functions: QlcFunction[] = []
  const ids = new Set<number>()
  for (const fn of fnNodes) {
    const f = attr(fn, 'Type') === 'Scene' ? scenesById.get(uint(attr(fn, 'ID'), QLC_INVALID_ID)) ?? null : parseFunction(fn, buses, scenesById)
    if (!f || ids.has(f.id)) continue
    ids.add(f.id)
    functions.push(f)
  }

  const knownEngine = new Set(['Fixture', 'FixtureGroup', 'ChannelsGroup', 'Palette', 'Function', 'Bus', 'InputOutputMap', 'Monitor'])
  const unknownEngineTags = Object.keys(engine).filter((k) => !k.startsWith('@_') && k !== '#text' && !knownEngine.has(k))

  const autostart = attr(engine, 'Autostart')
  const simpleDesk = child(ws, 'SimpleDesk')
  const sdEngine = child(simpleDesk, 'Engine')
  return {
    creator: { name: childText(creator, 'Name'), version: childText(creator, 'Version'), author: childText(creator, 'Author') },
    universes,
    beatBpm: bpm,
    fixtures,
    fixtureGroups,
    channelsGroups,
    palettes,
    functions,
    monitor: parseMonitor(child(engine, 'Monitor')),
    virtualConsole: parseVirtualConsole(child(ws, 'VirtualConsole')),
    autostartFunction: autostart !== undefined ? uint(autostart, QLC_INVALID_ID) : undefined,
    simpleDeskCueStacks: children(sdEngine, 'CueStack').filter((cs) => list((cs as XNode).Cue).length > 0).length,
    unknownEngineTags
  }
}
