/**
 * FollowStore — Follow-Subject mode (pursuit/follow spot)
 *
 * Multiple fixtures converge their beams on a single "target point" on stage.
 * A gamepad joystick moves the target point; holding a trigger activates tracking.
 */
import { create } from 'zustand'
import { gamepadManager, XBOX_BUTTONS, XBOX_AXES, type GamepadState } from '@renderer/lib/gamepad-manager'
import { usePatchStore } from './patch-store'
import { useDmxStore } from './dmx-store'
import { resolveChannels } from '@renderer/lib/dmx-channel-resolver'

// ── IK helpers ──────────────────────────────────────────────────────

/** Convert pan degrees to 16-bit DMX (coarse + fine) */
function panDegToDmx(degrees: number, range = 540): { coarse: number; fine: number } {
  const raw = Math.max(0, Math.min(1, (degrees + range / 2) / range))
  const dmx16 = raw * 65535
  const coarse = Math.min(255, Math.floor(dmx16 / 256))
  const fine = Math.min(255, Math.round(dmx16 % 256))
  return { coarse, fine }
}

/** Convert tilt degrees to 16-bit DMX (coarse + fine) */
function tiltDegToDmx(degrees: number, range = 270): { coarse: number; fine: number } {
  const raw = Math.max(0, Math.min(1, (degrees + range / 2) / range))
  const dmx16 = raw * 65535
  const coarse = Math.min(255, Math.floor(dmx16 / 256))
  const fine = Math.min(255, Math.round(dmx16 % 256))
  return { coarse, fine }
}

/** Calculate the pan/tilt angles for a fixture at `fixturePos` aiming at `target` */
function calcPanTilt(
  fixturePos: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  panInvert: boolean,
  tiltInvert: boolean
): { panDeg: number; tiltDeg: number } {
  const dx = target.x - fixturePos.x
  const dy = target.y - fixturePos.y   // negative when target is below
  const dz = target.z - fixturePos.z

  // Pan: horizontal angle from +Z axis (upstage)
  let panDeg = Math.atan2(dx, dz) * (180 / Math.PI)
  if (panInvert) panDeg = -panDeg

  // Tilt: angle from horizontal downward
  // 0° = horizontal, -90° = straight down, +90° = straight up
  const horizontalDist = Math.sqrt(dx * dx + dz * dz)
  let tiltDeg = Math.atan2(dy, horizontalDist) * (180 / Math.PI)
  if (tiltInvert) tiltDeg = -tiltDeg

  return { panDeg, tiltDeg }
}

// ── Types ───────────────────────────────────────────────────────────

interface SavedFixtureChannels {
  pan: number
  panFine: number
  tilt: number
  tiltFine: number
  dimmer: number
}

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
  /** Left stick axis for X movement */
  axisX: number
  /** Left stick axis for Z movement */
  axisZ: number
  /** Right stick axis for Y (height) adjustment */
  axisY: number
  /** Invert X axis */
  invertX: boolean
  /** Invert Z axis */
  invertZ: boolean
  /** Invert Y axis */
  invertY: boolean
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
  /** Saved channel values before follow override (for restore) */
  savedChannels: Record<string, SavedFixtureChannels>

  // Actions
  setConfig: (config: Partial<FollowConfig>) => void
  addFixture: (id: string) => void
  removeFixture: (id: string) => void
  setTarget: (x: number, y: number, z: number) => void
  activate: () => void
  deactivate: () => void
  toggleActive: () => void
}

// ── Store ───────────────────────────────────────────────────────────

export const useFollowStore = create<FollowState>((set, get) => ({
  // Config
  fixtureIds: [],
  activateButton: XBOX_BUTTONS.LT,
  activateMode: 'hold',
  sensitivity: 4,          // metres/s at full stick
  targetHeight: 1.5,       // chest height
  followDimmer: 255,
  axisX: XBOX_AXES.LEFT_X,
  axisZ: XBOX_AXES.LEFT_Y,
  axisY: XBOX_AXES.RIGHT_Y,
  invertX: false,
  invertZ: true,            // push stick forward → upstage (+Z)
  invertY: false,

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

  setTarget: (x, y, z) => set({ targetX: x, targetY: y, targetZ: z }),

  activate: () => {
    const state = get()
    if (state.active || state.fixtureIds.length === 0) return

    // Save current pan/tilt/dimmer for each fixture
    const patchStore = usePatchStore.getState()
    const dmxStore = useDmxStore.getState()
    const saved: Record<string, SavedFixtureChannels> = {}

    for (const fid of state.fixtureIds) {
      const entry = patchStore.patch.find(p => p.id === fid)
      if (!entry) continue
      const def = patchStore.getFixtureDef(entry.fixtureDefId)
      if (!def) continue
      const ch = resolveChannels(entry, def, dmxStore.values)
      saved[fid] = {
        pan: ch.pan, panFine: ch.panFine,
        tilt: ch.tilt, tiltFine: ch.tiltFine,
        dimmer: ch.dimmer
      }
    }

    // Reset target to center stage at configured height
    set({
      active: true,
      targetX: 0,
      targetY: state.targetHeight,
      targetZ: 0,
      savedChannels: saved
    })

    // Set dimmer on follow fixtures
    applyFollowDmx(get())
  },

  deactivate: () => {
    const state = get()
    if (!state.active) return

    // Restore saved channels
    const patchStore = usePatchStore.getState()
    const dmxStore = useDmxStore.getState()

    for (const fid of state.fixtureIds) {
      const entry = patchStore.patch.find(p => p.id === fid)
      if (!entry) continue
      const saved = state.savedChannels[fid]
      if (!saved) continue

      const channels = patchStore.getFixtureChannels(entry)
      const panCh = channels.find(c => c.name.toLowerCase() === 'pan')
      const panFineCh = channels.find(c => c.name.toLowerCase() === 'pan fine')
      const tiltCh = channels.find(c => c.name.toLowerCase() === 'tilt')
      const tiltFineCh = channels.find(c => c.name.toLowerCase() === 'tilt fine')
      const dimCh = channels.find(c => c.name.toLowerCase() === 'dimmer' || c.name.toLowerCase() === 'intensity')

      if (panCh) dmxStore.setChannel(entry.universe, panCh.absoluteChannel, saved.pan)
      if (panFineCh) dmxStore.setChannel(entry.universe, panFineCh.absoluteChannel, saved.panFine)
      if (tiltCh) dmxStore.setChannel(entry.universe, tiltCh.absoluteChannel, saved.tilt)
      if (tiltFineCh) dmxStore.setChannel(entry.universe, tiltFineCh.absoluteChannel, saved.tiltFine)
      if (dimCh) dmxStore.setChannel(entry.universe, dimCh.absoluteChannel, saved.dimmer)
    }

    set({ active: false, savedChannels: {} })
  },

  toggleActive: () => {
    const state = get()
    if (state.active) state.deactivate()
    else state.activate()
  }
}))

// ── DMX output ──────────────────────────────────────────────────────

/** Apply pan/tilt/dimmer DMX values for all follow fixtures aiming at the target */
function applyFollowDmx(state: FollowState) {
  const patchStore = usePatchStore.getState()
  const dmxStore = useDmxStore.getState()

  for (const fid of state.fixtureIds) {
    const entry = patchStore.patch.find(p => p.id === fid)
    if (!entry) continue
    const def = patchStore.getFixtureDef(entry.fixtureDefId)
    if (!def) continue

    // Fixture 3D position
    const pos = entry.position3D
    if (!pos) continue   // can't calculate IK without a position

    const fixturePos = { x: pos.x, y: pos.y, z: pos.z }
    const target = { x: state.targetX, y: state.targetY, z: state.targetZ }

    // Calculate required pan/tilt
    const { panDeg, tiltDeg } = calcPanTilt(
      fixturePos, target,
      entry.panInvert ?? false,
      entry.tiltInvert ?? false
    )

    // Convert to DMX
    const panDmx = panDegToDmx(panDeg)
    const tiltDmx = tiltDegToDmx(tiltDeg)

    // Find channel addresses
    const channels = patchStore.getFixtureChannels(entry)
    const panCh = channels.find(c => c.name.toLowerCase() === 'pan')
    const panFineCh = channels.find(c => c.name.toLowerCase() === 'pan fine')
    const tiltCh = channels.find(c => c.name.toLowerCase() === 'tilt')
    const tiltFineCh = channels.find(c => c.name.toLowerCase() === 'tilt fine')
    const dimCh = channels.find(c => c.name.toLowerCase() === 'dimmer' || c.name.toLowerCase() === 'intensity')

    // Write DMX
    if (panCh) dmxStore.setChannel(entry.universe, panCh.absoluteChannel, panDmx.coarse)
    if (panFineCh) dmxStore.setChannel(entry.universe, panFineCh.absoluteChannel, panDmx.fine)
    if (tiltCh) dmxStore.setChannel(entry.universe, tiltCh.absoluteChannel, tiltDmx.coarse)
    if (tiltFineCh) dmxStore.setChannel(entry.universe, tiltFineCh.absoluteChannel, tiltDmx.fine)
    if (dimCh) dmxStore.setChannel(entry.universe, dimCh.absoluteChannel, state.followDimmer)
  }
}

// ── Gamepad loop ────────────────────────────────────────────────────

let lastTimestamp = 0
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
    // Hold to activate
    if (btn.pressed && !store.active) {
      store.activate()
    } else if (!btn.pressed && store.active) {
      store.deactivate()
    }
  } else {
    // Toggle on press (rising edge)
    // We'd need edge detection — skip for now, hold mode is primary
  }

  if (!store.active) {
    lastTimestamp = gpState.timestamp
    return
  }

  // Delta time for velocity-based movement
  const now = performance.now()
  const dt = lastTimestamp > 0 ? Math.min((now - lastTimestamp) / 1000, 0.1) : 1 / 60
  lastTimestamp = now

  // Read joystick axes
  const axX = gpState.axes[store.axisX] ?? 0
  const axZ = gpState.axes[store.axisZ] ?? 0
  const axY = gpState.axes[store.axisY] ?? 0

  const speed = store.sensitivity
  const dx = (store.invertX ? -axX : axX) * speed * dt
  const dz = (store.invertZ ? -axZ : axZ) * speed * dt
  const dy = (store.invertY ? -axY : axY) * speed * dt

  if (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001 || Math.abs(dy) > 0.0001) {
    const newX = store.targetX + dx
    const newY = Math.max(0, Math.min(8, store.targetY + dy))
    const newZ = store.targetZ + dz
    useFollowStore.setState({ targetX: newX, targetY: newY, targetZ: newZ })

    // Apply to DMX
    applyFollowDmx({ ...store, targetX: newX, targetY: newY, targetZ: newZ })
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
