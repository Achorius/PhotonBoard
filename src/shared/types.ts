// ============================================================
// PhotonBoard - Shared Types (Main ↔ Renderer)
// ============================================================

// --- DMX Core ---

export const DMX_CHANNELS_PER_UNIVERSE = 512
export const MAX_UNIVERSES = 16
export const DMX_MIN = 0
export const DMX_MAX = 255

export interface DmxOutput {
  universes: Uint8Array[] // Array of 512-byte buffers
}

export interface ArtNetConfig {
  host: string // Target IP (e.g., '192.168.1.100' or '255.255.255.255')
  port: number // Default 6454
  universe: number // 0-15
  subnet: number // 0-15
  net: number // 0-127
}

// --- Fixture Definitions (OFL-compatible) ---

export interface FixtureCapability {
  dmxRange: [number, number]
  type: string
  label?: string
  color?: string
  colorTemperature?: string
  wheel?: string
  comment?: string
}

export interface FixtureChannel {
  name: string
  type: 'intensity' | 'color' | 'pan' | 'tilt' | 'gobo' | 'prism' | 'shutter' | 'strobe' | 'speed' | 'effect' | 'maintenance' | 'fog' | 'generic'
  defaultValue?: number
  highlightValue?: number
  fineChannelAliases?: string[]
  capabilities?: FixtureCapability[]
  precedence?: 'HTP' | 'LTP'
}

export interface FixtureMode {
  name: string
  shortName?: string
  channels: string[]
  channelCount: number
}

export interface FixturePhysical {
  dimensions?: [number, number, number]
  weight?: number
  power?: number
  DMXconnector?: string
  bulb?: {
    type?: string
    lumens?: number
    colorTemperature?: number
  }
  lens?: {
    degreesMinMax?: [number, number]
  }
}

export interface FixtureDefinition {
  id: string // unique key: manufacturer/model
  name: string
  manufacturer: string
  categories: string[]
  channels: Record<string, FixtureChannel>
  modes: FixtureMode[]
  physical?: FixturePhysical
}

// --- 3D Visualizer ---

export type FixtureShape = 'par' | 'moving-head' | 'strip' | 'generic'

export interface Position3D {
  x: number // metres, origin = stage centre floor
  y: number // height from floor
  z: number // depth (positive = upstage)
}

export interface Rotation3D {
  rx: number // radians
  ry: number // radians
  rz: number // radians
}

export interface TrussBar {
  id: string
  name: string        // e.g. "Bar 1", "FOH Truss"
  z: number           // position along depth axis (metres from center, + = upstage)
  y: number           // height (metres from floor), default = room height - 0.05
  width: number       // bar length in metres (default = room width)
  color?: string      // optional hex color for the bar
}

export interface RoomConfig {
  width: number  // metres
  depth: number  // metres
  height: number // metres
  trussBars: TrussBar[]
}

export function defaultTrussBars(roomWidth: number, roomDepth: number, roomHeight: number): TrussBar[] {
  return [
    { id: 'truss-0', name: 'Bar 1', z: -roomDepth * 0.3, y: roomHeight - 0.05, width: roomWidth },
    { id: 'truss-1', name: 'Bar 2', z: 0, y: roomHeight - 0.05, width: roomWidth },
    { id: 'truss-2', name: 'Bar 3', z: roomDepth * 0.3, y: roomHeight - 0.05, width: roomWidth },
  ]
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  width: 20, depth: 15, height: 6,
  trussBars: defaultTrussBars(20, 15, 6)
}

/** Map OFL categories to a simplified shape for 3D rendering */
export function getFixtureShape(categories: string[]): FixtureShape {
  if (categories.some(c => c === 'Moving Head')) return 'moving-head'
  if (categories.some(c => c === 'Pixel Bar' || c === 'Batten' || c === 'Strip')) return 'strip'
  if (categories.some(c => c === 'Dimmer' || c === 'Color Changer' || c === 'PAR')) return 'par'
  return 'par'
}

// --- Patch ---

export interface PatchEntry {
  id: string
  fixtureDefId: string
  modeName: string
  universe: number // 0-based
  address: number // 1-512
  name: string
  groupIds: string[]
  // Legacy 2D
  stagePosition?: { x: number; y: number; rotation: number }
  // 3D Visualizer
  position3D?: Position3D
  rotation3D?: Rotation3D
  mountingAngle?: number // degrees, 0 = straight down (for static fixtures)
  mountingPan?: number   // degrees, horizontal aim direction for static fixtures
  beamAngle?: number    // degrees, cone spread — defaults from fixture physical
  panInvert?: boolean   // invert pan direction for moving heads
  tiltInvert?: boolean  // invert tilt direction for moving heads
}

// --- Groups ---

export interface Group {
  id: string
  name: string
  color: string
  fixtureIds: string[] // PatchEntry ids
  parentGroupId?: string // for sub-groups
}

// --- Presets ---

export type PresetType = 'intensity' | 'color' | 'position' | 'gobo' | 'beam' | 'full'

export interface Preset {
  id: string
  name: string
  type: PresetType
  values: Record<string, Record<string, number>> // fixtureId → { channelName → value }
}

// --- Cues & Cuelists ---

export interface CueChannelValue {
  fixtureId: string
  channelName: string
  value: number
}

export interface Cue {
  id: string
  name: string
  number: number // Cue number (e.g., 1, 1.5, 2)
  values: CueChannelValue[]
  fadeIn: number // seconds
  fadeOut: number // seconds
  delay: number // seconds
  followTime: number | null // null = manual GO, number = auto-follow seconds
  color?: string // UI color tag
}

export interface Cuelist {
  id: string
  name: string
  cues: Cue[]
  currentCueIndex: number
  isPlaying: boolean
  isLooping: boolean
  priority: number // 0-100, higher wins in LTP
  faderLevel: number // 0-255, master level for this cuelist
  flash: boolean
  goGeneration?: number // bumped on each GO to force re-trigger
  effectSnapshots?: Effect[] // Effects captured at record time, restarted on GO
}

// --- Chases ---

export interface Chase {
  id: string
  name: string
  steps: ChaseStep[]
  currentStepIndex: number
  isPlaying: boolean
  isLooping: boolean
  bpm: number
  fadePercent: number // 0-100, percentage of step time used for fade
  direction: 'forward' | 'backward' | 'bounce' | 'random'
  faderLevel: number
  priority?: number // 0-100, defaults to 50
}

export interface ChaseStep {
  id: string
  values: CueChannelValue[]
  holdTime?: number // Override step time (seconds)
}

// --- Effects ---

export type WaveformType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'random'

export interface Effect {
  id: string
  name: string
  waveform: WaveformType
  speed: number // Hz
  depth: number // 0-255 amplitude
  offset: number // 0-360 phase offset
  channelType: string // Which channel type to affect
  fixtureIds: string[]
  fan: number // Phase spread across fixtures (0-360)
  isRunning: boolean
}

// --- MIDI ---

export type MidiSourceType = 'cc' | 'note' | 'program'
export type MidiTargetType = 'channel' | 'cuelist_go' | 'cuelist_fader' | 'chase_toggle' | 'chase_bpm' | 'master' | 'effect_toggle' | 'flash' | 'blackout' | 'tap_tempo'

export interface MidiMapping {
  id: string
  name: string
  source: {
    deviceName?: string
    type: MidiSourceType
    channel: number // 1-16
    number: number // CC# or note#
  }
  target: {
    type: MidiTargetType
    id?: string // cuelist/chase/fixture id
    parameter?: string // channel name
  }
  options: {
    min: number
    max: number
    inverted: boolean
    encoding: 'absolute' | 'relative' // absolute = 0-127 fader, relative = encoder (1=CW, 127=CCW)
    behavior: 'direct' | 'toggle' | 'trigger' | 'flash' // direct = continuous, toggle = on/off on press, trigger = momentary, flash = full while held
  }
}

export interface MidiDevice {
  id: string
  name: string
  manufacturer: string
  type: 'input' | 'output'
  connected: boolean
}

// --- Stage Layout ---

export interface StageLayout {
  width: number
  height: number
  backgroundImage?: string
  fixtures: StageFixture[]
}

export interface StageFixture {
  patchId: string
  x: number
  y: number
  rotation: number
  scale: number
}

// --- Show File ---

export interface ShowFile {
  version: string
  name: string
  createdAt: string
  modifiedAt: string
  artnetConfig: ArtNetConfig[]
  patch: PatchEntry[]
  groups: Group[]
  presets: Preset[]
  cuelists: Cuelist[]
  chases: Chase[]
  effects: Effect[]
  midiMappings: MidiMapping[]
  stageLayout: StageLayout
  roomConfig?: RoomConfig
}

// --- IPC Channel Names ---

export const IPC = {
  // DMX
  DMX_SET_CHANNEL: 'dmx:set-channel',
  DMX_SET_CHANNELS: 'dmx:set-channels',
  DMX_GET_VALUES: 'dmx:get-values',
  DMX_BLACKOUT: 'dmx:blackout',

  // ArtNet
  ARTNET_CONFIGURE: 'artnet:configure',
  ARTNET_GET_STATUS: 'artnet:get-status',

  // Show
  SHOW_NEW: 'show:new',
  SHOW_SAVE: 'show:save',
  SHOW_LOAD: 'show:load',
  SHOW_SAVE_AS: 'show:save-as',
  SHOW_GET_RECENT: 'show:get-recent',

  // Fixtures
  FIXTURES_SCAN: 'fixtures:scan',
  FIXTURES_GET_ALL: 'fixtures:get-all',
  FIXTURES_IMPORT: 'fixtures:import',

  // Show helpers
  SHOW_GET_PATH: 'show:get-path',
  SHOW_REVEAL: 'show:reveal',
  SHOW_LOAD_LAST: 'show:load-last',

  // App
  APP_GET_VERSION: 'app:get-version',
  APP_QUIT: 'app:quit'
} as const
