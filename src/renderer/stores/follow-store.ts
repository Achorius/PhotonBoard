/**
 * FollowStore — Follow-Subject mode (pursuit/follow spot)
 *
 * Multiple fixtures converge their beams on a single "target point" on stage.
 * A gamepad joystick moves the target point; holding a trigger activates tracking.
 */
import { create } from 'zustand'
import { gamepadManager, XBOX_BUTTONS, XBOX_AXES, type GamepadState } from '@renderer/lib/gamepad-manager'
import { usePatchStore } from './patch-store'
import { setProgrammerChannel, clearProgrammerChannel, getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { useVisualizerStore } from './visualizer-store'
import { unitToDmx16 } from '@renderer/lib/dmx-channel-resolver'
import type { FixtureDefinition } from '@shared/types'

// ── IK helpers ──────────────────────────────────────────────────────

const DEFAULT_PAN_RANGE = 540
const DEFAULT_TILT_RANGE = 270

/** Convert degrees (centred on 0) to 16-bit DMX for a given travel range */
export function degreesToDmx16(degrees: number, range: number): { coarse: number; fine: number } {
  const r = Number.isFinite(range) && range > 0 ? range : 360
  return unitToDmx16((degrees + r / 2) / r)
}

function panTiltRanges(def: FixtureDefinition | undefined): { pan: number; tilt: number } {
  const pan = Number(def?.physical?.panRange)
  const tilt = Number(def?.physical?.tiltRange)
  return {
    pan: Number.isFinite(pan) && pan > 0 ? pan : DEFAULT_PAN_RANGE,
    tilt: Number.isFinite(tilt) && tilt > 0 ? tilt : DEFAULT_TILT_RANGE
  }
}

/**
 * Calculate the pan/tilt angles for a fixture at `fixturePos` aiming at `target`.
 *
 * The DMX/3D convention (from BeamUpdater) is:
 *   yokeGroup.rotation.y = degToRad(panDeg)   → 0° = facing +Z (upstage)
 *   headGroup.rotation.x = degToRad(90 - tiltDeg) → 0° = beam straight down, 90° = horizontal
 *
 * So we compute:
 *   panDeg  = atan2(dx, dz) — horizontal angle from +Z
 *   tiltDeg = atan2(horizontalDist, -dy) — angle from straight down (0° = down, 90° = horizontal)
 */
function calcPanTilt(
  fixturePos: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  panInvert: boolean,
  tiltInvert: boolean
): { panDeg: number; tiltDeg: number } {
  const dx = target.x - fixturePos.x
  const dy = target.y - fixturePos.y   // negative when target is below fixture
  const dz = target.z - fixturePos.z

  // Pan: horizontal angle from +Z axis (upstage)
  let panDeg = Math.atan2(dx, dz) * (180 / Math.PI)
  if (panInvert) panDeg = -panDeg

  // Tilt: angle from straight down (-Y axis)
  // 0° = beam straight down, 90° = beam horizontal, 180° = beam straight up
  const horizontalDist = Math.sqrt(dx * dx + dz * dz)
  let tiltDeg = Math.atan2(horizontalDist, -dy) * (180 / Math.PI)
  if (tiltInvert) tiltDeg = -tiltDeg

  return { panDeg, tiltDeg }
}

// ── Types ───────────────────────────────────────────────────────────

/**
 * Programmer value a follow channel had before follow took it over
 * ("universe:channel" → value, or null when the programmer did not hold it).
 */
type SavedProgrammer = Record<string, number | null>

export interface FollowConfig {
  /** Fixture IDs in the follow group */
  fixtureIds: string[]
  /** Gamepad button index that activates follow (default: LT = 6) */
  activateButton: number
  /** Whether activation is momentary (hold) or toggle */
  activateMode: 'hold' | 'toggle'
  /** Joystick sensitivity — metres per second at full stick deflection */
  sensitivity: number
  /** Default target height in metres (1.5 = chest height) */
  targetHeight: number
  /** Dimmer value to apply to follow fixtures (0-255) */
  followDimmer: number
  /** Invert X axis (left stick horizontal) */
  invertX: boolean
  /** Invert Y axis (left stick vertical → up/down) */
  invertY: boolean
  /** Invert Z axis (right stick vertical → depth) */
  invertZ: boolean
}

interface FollowState extends FollowConfig {
  /** Follow mode is active (tracking) */
  active: boolean
  /** Target point on stage */
  targetX: number
  targetY: number
  targetZ: number
  /** Gamepad info */
  gamepadConnected: boolean
  gamepadName: string
  /** Programmer values of the follow channels before activation (restored on release) */
  savedChannels: SavedProgrammer

  // Actions
  setConfig: (config: Partial<FollowConfig>) => void
  addFixture: (id: string) => void
  removeFixture: (id: string) => void
  setTarget: (x: number, y: number, z: number) => void
  activate: () => void
  deactivate: () => void
  reset: () => void
  toggleActive: () => void
}

// ── Store ───────────────────────────────────────────────────────────

export const useFollowStore = create<FollowState>((set, get) => ({
  // Config
  fixtureIds: [],
  activateButton: XBOX_BUTTONS.LT,
  activateMode: 'hold',
  sensitivity: 8,          // metres/s at full stick
  targetHeight: 1.5,       // chest height
  followDimmer: 255,
  invertX: true,             // invert left/right to match stage perspective
  invertY: true,            // push stick up → target goes up (stick Y axis is inverted)
  invertZ: true,            // push stick forward → closer to audience

  // State
  active: false,
  targetX: 0,
  targetY: 1.5,
  targetZ: 0,
  gamepadConnected: false,
  gamepadName: '',
  savedChannels: {},

  setConfig: (config) => set(config),

  addFixture: (id) => set(s => ({
    fixtureIds: s.fixtureIds.includes(id) ? s.fixtureIds : [...s.fixtureIds, id]
  })),

  removeFixture: (id) => set(s => ({
    fixtureIds: s.fixtureIds.filter(f => f !== id)
  })),

  setTarget: (x, y, z) => {
    set({ targetX: x, targetY: y, targetZ: z })
    if (get().active) applyFollowDmx(get())
  },

  activate: () => {
    try {
      const state = get()
      if (state.active || state.fixtureIds.length === 0) return

      // Remember what the programmer held on the channels follow is about to drive
      const saved: SavedProgrammer = {}
      for (const ch of followChannels(state.fixtureIds)) {
        const key = `${ch.universe}:${ch.channel}`
        if (!(key in saved)) saved[key] = getProgrammerValue(ch.universe, ch.channel) ?? null
      }

      // Start from centre stage floor
      set({ active: true, targetX: 0, targetY: 0, targetZ: 0, savedChannels: saved })
      applyFollowDmx(get())
    } catch (e) {
      console.error('[Follow] activate() error:', e)
    }
  },

  deactivate: () => {
    const state = get()
    if (!state.active) return

    // Give the channels back: restore what the programmer held before, release the rest
    for (const [key, value] of Object.entries(state.savedChannels)) {
      const [u, ch] = key.split(':').map(Number)
      if (!Number.isInteger(u) || !Number.isInteger(ch)) continue
      if (value === null) clearProgrammerChannel(u, ch)
      else setProgrammerChannel(u, ch, value)
    }
    set({ active: false, savedChannels: {} })
  },

  /** Drop follow without touching DMX (show load: the programmer is cleared anyway). */
  reset: () => set({ active: false, savedChannels: {} }),

  toggleActive: () => {
    const state = get()
    if (state.active) state.deactivate()
    else state.activate()
  }
}))

// ── DMX output ──────────────────────────────────────────────────────

interface FollowChannel {
  universe: number
  channel: number
}

function findChannels(fixtureId: string) {
  const patchStore = usePatchStore.getState()
  const entry = patchStore.patch.find(p => p.id === fixtureId)
  if (!entry) return null
  const channels = patchStore.getFixtureChannels(entry)
  const byName = (...names: string[]) => channels.find(c => names.includes(c.name.toLowerCase()))
  return {
    entry,
    def: patchStore.getFixtureDef(entry.fixtureDefId),
    pan: byName('pan'),
    panFine: byName('pan fine', 'pan 16-bit', 'pan (fine)'),
    tilt: byName('tilt'),
    tiltFine: byName('tilt fine', 'tilt 16-bit', 'tilt (fine)'),
    dimmer: byName('dimmer', 'intensity')
  }
}

/** Every DMX channel follow writes for these fixtures. */
function followChannels(fixtureIds: string[]): FollowChannel[] {
  const out: FollowChannel[] = []
  for (const fid of fixtureIds) {
    const f = findChannels(fid)
    if (!f) continue
    for (const ch of [f.pan, f.panFine, f.tilt, f.tiltFine, f.dimmer]) {
      if (ch) out.push({ universe: f.entry.universe, channel: ch.absoluteChannel })
    }
  }
  return out
}

/** Apply pan/tilt/dimmer DMX values for all follow fixtures aiming at the target */
function applyFollowDmx(state: FollowState) {
  for (const fid of state.fixtureIds) {
    const f = findChannels(fid)
    if (!f) continue
    const pos = f.entry.position3D
    if (!pos) continue // no 3D position: cannot aim

    const { panDeg, tiltDeg } = calcPanTilt(
      pos,
      { x: state.targetX, y: state.targetY, z: state.targetZ },
      f.entry.panInvert ?? false,
      f.entry.tiltInvert ?? false
    )
    const ranges = panTiltRanges(f.def)
    const panDmx = degreesToDmx16(panDeg, ranges.pan)
    const tiltDmx = degreesToDmx16(tiltDeg, ranges.tilt)
    const u = f.entry.universe

    if (f.pan) setProgrammerChannel(u, f.pan.absoluteChannel, panDmx.coarse)
    if (f.panFine) setProgrammerChannel(u, f.panFine.absoluteChannel, panDmx.fine)
    if (f.tilt) setProgrammerChannel(u, f.tilt.absoluteChannel, tiltDmx.coarse)
    if (f.tiltFine) setProgrammerChannel(u, f.tiltFine.absoluteChannel, tiltDmx.fine)
    if (f.dimmer) setProgrammerChannel(u, f.dimmer.absoluteChannel, state.followDimmer)
  }
}

// ── Gamepad loop ────────────────────────────────────────────────────

let lastTimestamp = 0
let lastButtonPressed = false
let unsubGamepad: (() => void) | null = null

function onGamepadFrame(gpState: GamepadState) {
  const store = useFollowStore.getState()

  // Update connection info
  if (gpState.connected !== store.gamepadConnected || gpState.id !== store.gamepadName) {
    useFollowStore.setState({ gamepadConnected: gpState.connected, gamepadName: gpState.id })
  }

  if (!gpState.connected) return

  // Check activation button
  const btn = gpState.buttons[store.activateButton]
  if (!btn) return

  if (store.activateMode === 'hold') {
    // Hold to activate (edges only, so a follow started from the UI is not cancelled)
    if (btn.pressed && !lastButtonPressed && !store.active) store.activate()
    else if (!btn.pressed && lastButtonPressed && store.active) store.deactivate()
  } else if (btn.pressed && !lastButtonPressed) {
    // Toggle on the rising edge
    store.toggleActive()
  }
  lastButtonPressed = btn.pressed

  const current = useFollowStore.getState()
  if (!current.active) {
    lastTimestamp = 0
    return
  }

  // Delta time for velocity-based movement
  const now = performance.now()
  const dt = lastTimestamp > 0 ? Math.min((now - lastTimestamp) / 1000, 0.1) : 1 / 60
  lastTimestamp = now

  // Read joystick axes
  // Left stick: X = left/right, Y = up/down on stage wall
  // Right stick: Y = depth (closer/further from audience)
  const leftX = gpState.axes[XBOX_AXES.LEFT_X] ?? 0
  const leftY = gpState.axes[XBOX_AXES.LEFT_Y] ?? 0
  const rightY = gpState.axes[XBOX_AXES.RIGHT_Y] ?? 0

  const speed = current.sensitivity
  const dx = (current.invertX ? -leftX : leftX) * speed * dt
  const dy = (current.invertY ? -leftY : leftY) * speed * dt   // left stick Y → height
  const dz = (current.invertZ ? -rightY : rightY) * speed * dt // right stick Y → depth

  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(dz) > 0.001) {
    const { roomConfig } = useVisualizerStore.getState()
    const newX = Math.max(-roomConfig.width / 2, Math.min(roomConfig.width / 2, current.targetX + dx))
    const newY = Math.max(0, Math.min(roomConfig.height, current.targetY + dy))
    const newZ = Math.max(-roomConfig.depth / 2, Math.min(roomConfig.depth / 2, current.targetZ + dz))
    useFollowStore.setState({ targetX: newX, targetY: newY, targetZ: newZ })
    applyFollowDmx(useFollowStore.getState())
  }
}

/** Start the gamepad follow loop */
export function startFollowGamepadLoop() {
  if (unsubGamepad) return
  unsubGamepad = gamepadManager.subscribe(onGamepadFrame)
}

/** Stop the gamepad follow loop */
export function stopFollowGamepadLoop() {
  if (unsubGamepad) {
    unsubGamepad()
    unsubGamepad = null
  }
}
