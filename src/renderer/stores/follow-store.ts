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
import { setProgrammerChannel } from '@renderer/lib/dmx-mixer'
import { useVisualizerStore } from './visualizer-store'
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

  setTarget: (x, y, z) => set({ targetX: x, targetY: y, targetZ: z }),

  activate: () => {
    try {
      const state = get()
      console.log('[Follow] activate() called, fixtureIds:', state.fixtureIds, 'already active:', state.active)
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
        console.log(`[Follow] saved ${entry.name}: pan=${ch.pan} tilt=${ch.tilt} dim=${ch.dimmer} pos3D=`, entry.position3D)
      }

      // Reset target to center stage floor
      const targetX = 0
      const targetY = 0
      const targetZ = 0
      console.log(`[Follow] Initial target: center stage floor (${targetX}, ${targetY}, ${targetZ})`)

      set({
        active: true,
        targetX,
        targetY,
        targetZ,
        savedChannels: saved
      })

      // Apply IK to all follow fixtures immediately
      const newState = get()
      console.log('[Follow] Applying initial DMX, active:', newState.active)
      applyFollowDmx(newState)
    } catch (e) {
      console.error('[Follow] activate() error:', e)
    }
  },

  deactivate: () => {
    const state = get()
    if (!state.active) return

    // Turn off follow fixtures (dimmer to 0) but keep pan/tilt position
    const patchStore = usePatchStore.getState()
    const dmxStore = useDmxStore.getState()
    for (const fid of state.fixtureIds) {
      const entry = patchStore.patch.find(p => p.id === fid)
      if (!entry) continue
      const channels = patchStore.getFixtureChannels(entry)
      const dimCh = channels.find(c => c.name.toLowerCase() === 'dimmer' || c.name.toLowerCase() === 'intensity')
      if (dimCh) setProgrammerChannel(entry.universe, dimCh.absoluteChannel, 0)
    }

    set({ active: false })
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
    if (!pos) {
      console.warn(`[Follow] ${entry.name} has no position3D — skipping IK`)
      continue
    }

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
    console.log(`[Follow] ${entry.name}: pan=${panDeg.toFixed(1)}° tilt=${tiltDeg.toFixed(1)}° → DMX pan=${panDmx.coarse}/${panDmx.fine} tilt=${tiltDmx.coarse}/${tiltDmx.fine} pos3D=${pos ? `${pos.x},${pos.y},${pos.z}` : 'NONE'} target=${state.targetX.toFixed(2)},${state.targetY.toFixed(2)},${state.targetZ.toFixed(2)} panCh=${panCh?.absoluteChannel} tiltCh=${tiltCh?.absoluteChannel}`)
    if (panCh) setProgrammerChannel(entry.universe, panCh.absoluteChannel, panDmx.coarse)
    if (panFineCh) setProgrammerChannel(entry.universe, panFineCh.absoluteChannel, panDmx.fine)
    if (tiltCh) setProgrammerChannel(entry.universe, tiltCh.absoluteChannel, tiltDmx.coarse)
    if (tiltFineCh) setProgrammerChannel(entry.universe, tiltFineCh.absoluteChannel, tiltDmx.fine)
    if (dimCh) setProgrammerChannel(entry.universe, dimCh.absoluteChannel, state.followDimmer)
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
      console.log('[Follow] Gamepad trigger pressed — activating')
      store.activate()
    } else if (!btn.pressed && store.active) {
      console.log('[Follow] Gamepad trigger released — deactivating')
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
  // Left stick: X = left/right, Y = up/down on stage wall
  // Right stick: Y = depth (closer/further from audience)
  const leftX = gpState.axes[XBOX_AXES.LEFT_X] ?? 0
  const leftY = gpState.axes[XBOX_AXES.LEFT_Y] ?? 0
  const rightY = gpState.axes[XBOX_AXES.RIGHT_Y] ?? 0

  const speed = store.sensitivity
  const dx = (store.invertX ? -leftX : leftX) * speed * dt
  const dy = (store.invertY ? -leftY : leftY) * speed * dt   // left stick Y → height
  const dz = (store.invertZ ? -rightY : rightY) * speed * dt // right stick Y → depth

  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(dz) > 0.001) {
    const { roomConfig } = useVisualizerStore.getState()
    const newX = Math.max(-roomConfig.width / 2, Math.min(roomConfig.width / 2, store.targetX + dx))
    const newY = Math.max(0, Math.min(roomConfig.height, store.targetY + dy))
    const newZ = Math.max(-roomConfig.depth / 2, Math.min(roomConfig.depth / 2, store.targetZ + dz))
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
