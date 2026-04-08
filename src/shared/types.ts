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

// --- USB DMX ---

export type UsbDmxDriver = 'enttec-open-dmx' | 'enttec-pro' | 'eurolite' | 'showtec' | 'beamz' | 'velleman' | 'stairville' | 'udmx' | 'generic-ftdi'

export interface UsbDmxConfig {
  driver: UsbDmxDriver
  portPath: string    // e.g., '/dev/tty.usbserial-XXX' or 'COM3'
  universe: number    // which universe this adapter handles (0-based)
  label?: string      // user-friendly label
}

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  vendorId?: string
  productId?: string
  friendlyName?: string
}

// --- DMX Output System ---

export type DmxOutputType = 'artnet' | 'usb-dmx'

export interface DmxOutputConfig {
  id: string
  type: DmxOutputType
  enabled: boolean
  artnet?: ArtNetConfig
  usbDmx?: UsbDmxConfig
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
  pixelLayout?: PixelLayout  // for multi-cell fixtures (LED bars, pixel strips)
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

// --- Multi-cell / Pixel fixtures ---

export interface PixelCell {
  index: number          // 0-based cell index
  channelOffset: number  // offset from mode start channel (0-based)
  channelNames: string[] // channel names in this cell (e.g., ['Red 1', 'Green 1', 'Blue 1'])
}

export interface PixelLayout {
  cellCount: number
  cells: PixelCell[]
  orientation: 'horizontal' | 'vertical' | 'grid'
  gridColumns?: number   // for grid layout
}

export type FixtureShape = 'par' | 'moving-head' | 'strip' | 'generic'
export type MountingLocation = 'ceiling' | 'floor' | 'wall-left' | 'wall-right' | 'wall-back'

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
  stageEdgeZ: number // metres, Z position of the upstage/audience divider (default 0)
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
  trussBars: defaultTrussBars(20, 15, 6),
  stageEdgeZ: 0
}

/**
 * Detect pixel layout from a mode's channel names.
 * Looks for numbered suffixes like "Red 1", "Green 1", "Blue 1", "Red 2", etc.
 * Returns a PixelLayout if cells are detected, undefined otherwise.
 */
export function detectPixelLayout(channels: string[]): PixelLayout | undefined {
  // Match channel names ending with a number: "Red 1", "Green 2", "Dimmer 3"
  const cellMap = new Map<number, { offset: number; names: string[] }>()
  const numbered = /^(.+?)\s+(\d+)$/

  for (let i = 0; i < channels.length; i++) {
    const match = channels[i].match(numbered)
    if (!match) continue
    const cellIndex = parseInt(match[2], 10)
    if (!cellMap.has(cellIndex)) {
      cellMap.set(cellIndex, { offset: i, names: [] })
    }
    cellMap.get(cellIndex)!.names.push(channels[i])
  }

  // Need at least 2 cells with consistent channel counts
  if (cellMap.size < 2) return undefined

  const cells = Array.from(cellMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, data]) => data)

  // Verify all cells have the same number of channels
  const channelsPerCell = cells[0].names.length
  if (channelsPerCell === 0) return undefined
  if (!cells.every(c => c.names.length === channelsPerCell)) return undefined

  const pixelCells: PixelCell[] = cells.map((c, i) => ({
    index: i,
    channelOffset: c.offset,
    channelNames: c.names
  }))

  return {
    cellCount: pixelCells.length,
    cells: pixelCells,
    orientation: 'horizontal'  // default for LED bars/strips
  }
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
  mountingLocation?: MountingLocation // where the fixture is mounted (default: ceiling)
  beamAngle?: number    // degrees, cone spread — defaults from fixture physical
  panInvert?: boolean   // invert pan direction for moving heads
  tiltInvert?: boolean  // invert tilt direction for moving heads
  pixelInvert?: boolean // reverse cell/pixel order for multi-cell fixtures
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

export type WaveformType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'random' | 'pulse' | 'bounce' | 'step' | 'custom'

/** Keyframe point for custom waveform curves (Avolites-style) */
export interface WaveformKeyframe {
  x: number  // 0-1 phase position
  y: number  // -1 to +1 value
}

/** Per-channel definition for compound (multi-channel) effects */
export interface EffectChannel {
  channelType: string        // 'Pan', 'Tilt', 'Red', etc.
  phaseOffset: number        // degrees, relative to main phase
  depth: number              // 0-255, per-channel amplitude
  frequencyMultiplier?: number // default 1, e.g. 2 for figure-8 tilt
  waveform?: WaveformType    // per-channel waveform override
}

export interface Effect {
  id: string
  name: string
  waveform: WaveformType
  speed: number // Hz
  depth: number // 0-255 amplitude
  offset: number // 0-360 phase offset
  channelType: string // Which channel type to affect (single-channel mode)
  fixtureIds: string[]
  fan: number // Phase spread across fixtures (0-360)
  isRunning: boolean
  channels?: EffectChannel[] // compound multi-channel effects (overrides channelType)
  oneShot?: boolean          // trigger once then auto-stop
  keyframes?: WaveformKeyframe[] // custom waveform curve points (used when waveform === 'custom')
}

// --- Timeline ---

export interface TimelineClip {
  id: string
  cuelistId: string       // reference to a cuelist/scene
  trackIndex: number      // which track row (0, 1, 2…)
  startTime: number       // seconds from timeline start
  duration: number        // seconds
  color?: string          // UI color for the clip block
}

export interface TimelineMarker {
  id: string
  time: number            // seconds
  name: string
  color?: string
}

export interface TimelineZone {
  id: string
  name: string
  startTime: number       // seconds
  endTime: number         // seconds
  color?: string
  order: number           // display order in sidebar (for reordering)
}

export interface TimelineState {
  clips: TimelineClip[]
  markers: TimelineMarker[]
  zones: TimelineZone[]
  trackCount: number
  isPlaying: boolean
  currentTime: number     // playhead position in seconds
  totalDuration: number   // total timeline length in seconds
  isLooping: boolean
}

// --- MIDI ---

export type MidiSourceType = 'cc' | 'note' | 'program'
export type MidiTargetType = 'channel' | 'cuelist_go' | 'cuelist_fader' | 'chase_toggle' | 'chase_bpm' | 'master' | 'effect_toggle' | 'flash' | 'blackout' | 'blinder' | 'strobe' | 'reset' | 'tap_tempo' | 'timeline_play' | 'timeline_stop' | 'timeline_rewind' | 'timeline_goto_marker' | 'timeline_goto_zone'

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
  dmxOutputs?: DmxOutputConfig[]
  patch: PatchEntry[]
  groups: Group[]
  presets: Preset[]
  cuelists: Cuelist[]
  chases: Chase[]
  effects: Effect[]
  midiMappings: MidiMapping[]
  stageLayout: StageLayout
  roomConfig?: RoomConfig
  timeline?: { clips: TimelineClip[]; markers: TimelineMarker[]; zones: TimelineZone[]; trackCount: number }
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

  // DMX Outputs (multi-output system)
  DMX_OUTPUTS_CONFIGURE: 'dmx-outputs:configure',
  DMX_OUTPUTS_GET_STATUS: 'dmx-outputs:get-status',
  DMX_OUTPUTS_SCAN_USB: 'dmx-outputs:scan-usb',

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
