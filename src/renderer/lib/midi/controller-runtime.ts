// ============================================================
// PhotonBoard — Controller runtime: connected profiles and routing
//
//   syncControllers(access)   recognise inputs (profile by port name),
//                             open their output, send init + fader
//                             position request, full LED resend
//   routeControllerMessage()  the profile layer of the MIDI routing:
//                             returns `consumed`; a user MidiMapping on
//                             the same (device, type, channel, number)
//                             wins (returns false), MIDI learn too
//   handleControllerSysex()   fader positions reply
//   controllerPortGone()      release every hold (flash, temp, blinder,
//                             strobe) of an unplugged controller
//   soft takeover             per fader, re-armed on page change / show
//                             load; ghosts published ≤ 10 Hz
//
// Pure decisions live in layouts / takeover / led-states; this module
// holds the per-controller state and talks to the stores.
// ============================================================

import type { MidiSourceType } from '@shared/types'
import { useControllerStore, ghostKey, GM_GHOST_KEY, type DetectedController } from '@renderer/stores/controller-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { mappingMatches } from '@renderer/lib/midi-manager'
import { sameMidiPort } from '@renderer/lib/midi-learn'
import type { ControlDef, ControlId, ControllerAction, ControllerBinding, ControllerProfile, ControllerSettings, LedState } from './controller-types'
import { buildBindings } from './layouts'
import { effectiveProfile, findOutputPort, matchProfile } from './profiles'
import { TAKEOVER_TOLERANCE, dmxToMidi, initialTakeover, midiToDmx, needsGhost, rearm, takeover, type TakeoverState } from './takeover'
import { faderLogicalLevel, performButton, performFader } from './controller-actions'
import { LED_OFF } from './led-colors'

// ---------------- Web MIDI shapes (the real API or a test fake) ----------------

export interface MidiPortLike {
  name?: string | null
  state?: string
  type?: string
}

export interface MidiOutputLike extends MidiPortLike {
  send(data: number[] | Uint8Array, timestamp?: number): void
}

export interface MidiAccessLike {
  inputs: { forEach(cb: (port: MidiPortLike) => void): void }
  outputs: { forEach(cb: (port: MidiOutputLike) => void): void }
  sysexEnabled?: boolean
}

// ---------------- Per controller state ----------------

export interface ControllerRuntime {
  /** Input port name */
  port: string
  settings: ControllerSettings
  /** Effective profile (options applied) */
  profile: ControllerProfile
  bindings: ControllerBinding[]
  bindingByControl: Map<ControlId, ControllerBinding>
  controlById: Map<ControlId, ControlDef>
  controlByMsg: Map<number, ControlDef>
  output: MidiOutputLike | null
  outputName: string | null
  shift: boolean
  /** Controls held down → their release */
  held: Map<ControlId, () => void>
  takeover: Map<ControlId, TakeoverState>
  /** Controls a user mapping takes over (LED left to the mapping) */
  overridden: Set<ControlId>
  /** LED states the device shows (diff cache) */
  leds: Map<ControlId, LedState>
  /** Value CCs sent to encoders / motor faders */
  values: Map<ControlId, number>
  /** Scratch map for the next LED frame */
  next: Map<ControlId, LedState>
  /** LED test running since (ms, Date.now) */
  testStart: number | null
}

/** Numeric key of a message: type, channel 1-16, number */
export function msgKey(type: 'note' | 'cc' | MidiSourceType, channel: number, number: number): number {
  return (type === 'cc' ? 4096 : type === 'program' ? 8192 : 0) + ((channel - 1) & 15) * 128 + (number & 127)
}

const controllers = new Map<string, ControllerRuntime>()
const outputsByName = new Map<string, MidiOutputLike>()
let lastAccess: MidiAccessLike | null = null
/** True while syncControllers runs (settings it creates must not trigger a resync) */
let syncing = false

let requestFeedback: () => void = () => {}

/** The feedback engine registers its scheduler here */
export function setFeedbackRequester(fn: () => void): void {
  requestFeedback = fn
}

export function listControllers(): IterableIterator<ControllerRuntime> {
  return controllers.values()
}

export function getController(port: string): ControllerRuntime | undefined {
  return controllers.get(port)
}

/** Output port for a device name (user mapping feedback): same name, else longest shared prefix */
export function outputForDevice(deviceName: string): MidiOutputLike | null {
  const exact = outputsByName.get(deviceName)
  if (exact) return exact
  let best: MidiOutputLike | null = null
  let bestLen = 5
  for (const [name, out] of outputsByName) {
    let i = 0
    while (i < name.length && i < deviceName.length && name[i] === deviceName[i]) i++
    if (i > bestLen) { best = out; bestLen = i }
  }
  return best
}

function safeSend(c: { output: MidiOutputLike | null }, data: number[]): void {
  if (!c.output) return
  try {
    c.output.send(data)
  } catch (e) {
    console.warn('[MIDI] send failed:', e)
  }
}

/** Send through a controller's output */
export function sendToController(c: ControllerRuntime, messages: readonly number[][]): void {
  for (const m of messages) safeSend(c, m)
}

function applyProfile(c: ControllerRuntime, profile: ControllerProfile, settings: ControllerSettings): void {
  c.profile = profile
  c.settings = settings
  c.bindings = buildBindings(profile, settings.layout)
  c.bindingByControl = new Map(c.bindings.map((b) => [b.control, b]))
  c.controlById = new Map(profile.controls.map((d) => [d.id, d]))
  c.controlByMsg = new Map(profile.controls.map((d) => [msgKey(d.type, d.channel, d.number), d]))
  updateOverrides(c)
}

function createRuntime(port: string, profile: ControllerProfile, settings: ControllerSettings): ControllerRuntime {
  const c: ControllerRuntime = {
    port, settings, profile, bindings: [], bindingByControl: new Map(), controlById: new Map(), controlByMsg: new Map(),
    output: null, outputName: null, shift: false, held: new Map(), takeover: new Map(), overridden: new Set(),
    leds: new Map(), values: new Map(), next: new Map(), testStart: null
  }
  applyProfile(c, profile, settings)
  return c
}

/** Controls whose message a user mapping also matches */
export function updateOverrides(c: ControllerRuntime): void {
  c.overridden.clear()
  const mappings = useMidiStore.getState().mappings
  if (mappings.length === 0) return
  for (const d of c.profile.controls) {
    if (mappings.some((m) => mappingMatches(m, d.type, d.channel, d.number, c.port))) c.overridden.add(d.id)
  }
}

/** Run every pending release of a controller (button up, disconnect) */
export function releaseHolds(c: ControllerRuntime): void {
  const releases = [...c.held.values()]
  c.held.clear()
  c.shift = false
  for (const r of releases) {
    try { r() } catch (e) { console.error('[MIDI] release failed:', e) }
  }
}

/** Forget the device's LED / value caches: the next frame resends everything */
export function invalidateController(c: ControllerRuntime): void {
  c.leds.clear()
  c.values.clear()
}

function connect(port: string, base: ControllerProfile, settings: ControllerSettings, output: MidiOutputLike | null, outputName: string | null): void {
  const profile = effectiveProfile(base, settings)
  let c = controllers.get(port)
  if (!c) {
    c = createRuntime(port, profile, settings)
    controllers.set(port, c)
  } else if (c.profile !== profile || c.settings.layout !== settings.layout) {
    applyProfile(c, profile, settings)
  } else {
    c.settings = settings
  }
  if (settings.takeover === 'jump') c.takeover.clear()
  c.output = output
  c.outputName = outputName
  // (Re)connect: mode switch, full LED resend, fader positions
  invalidateController(c)
  for (const msg of c.profile.init ?? []) safeSend(c, msg)
  if (c.profile.requestFaderPositions) safeSend(c, [...c.profile.requestFaderPositions])
}

function disconnect(port: string, stillConnected: boolean): void {
  const c = controllers.get(port)
  if (!c) return
  releaseHolds(c)
  if (stillConnected && c.output) {
    // Disabled: switch its LEDs off
    const off: [ControlId, LedState][] = c.profile.controls.filter((d) => d.kind !== 'fader').map((d) => [d.id, LED_OFF])
    sendToController(c, c.profile.encodeLeds(off))
  }
  controllers.delete(port)
}

/**
 * Recognise controllers among the connected ports and (re)connect them.
 * Called after every MIDI (re)initialisation and when settings change.
 */
export function syncControllers(access: MidiAccessLike | null): void {
  syncing = true
  try {
    doSync(access)
  } finally {
    syncing = false
  }
}

function doSync(access: MidiAccessLike | null): void {
  lastAccess = access
  outputsByName.clear()
  const inputNames: string[] = []
  if (access) {
    access.outputs.forEach((o) => { if (o.name && o.state !== 'disconnected') outputsByName.set(o.name, o) })
    access.inputs.forEach((i) => { if (i.name && i.state !== 'disconnected') inputNames.push(i.name) })
  }
  const store = useControllerStore.getState()
  const mappings = useMidiStore.getState().mappings
  const detected: DetectedController[] = []
  const taken = new Set<string>()
  const seen = new Set<string>()
  for (const name of inputNames) {
    const profile = matchProfile(name)
    if (!profile || seen.has(name)) continue
    seen.add(name)
    // A device the user already mapped by hand starts with its profile off
    const handMapped = mappings.some((m) => !!m.source.deviceName && sameMidiPort(m.source.deviceName, name))
    const settings = store.ensureSettings(name, {
      profileId: profile.id,
      layout: profile.defaultLayouts[0] ?? 'executors-2pages',
      takeover: profile.motorFaders ? 'jump' : 'pickup',
      enabled: !handMapped
    })
    const outName = findOutputPort(profile, name, [...outputsByName.keys()], taken)
    if (outName) taken.add(outName)
    detected.push({ port: name, profileId: profile.id, outputPort: outName, connected: true })
    if (settings.enabled) connect(name, profile, settings, outName ? outputsByName.get(outName) ?? null : null, outName)
    else disconnect(name, true)
  }
  for (const port of [...controllers.keys()]) if (!seen.has(port)) disconnect(port, false)
  useControllerStore.getState().setDetected(detected)
  scheduleGhosts()
  requestFeedback()
}

/** Re-run the sync with the last access (settings changed) */
export function resyncControllers(): void {
  if (!syncing) syncControllers(lastAccess)
}

/** A port disappeared: release its holds now (the reinit follows later) */
export function controllerPortGone(name: string, type?: string): void {
  if (type === 'output') {
    outputsByName.delete(name)
    for (const c of controllers.values()) if (c.outputName === name) c.output = null
    return
  }
  const c = controllers.get(name)
  if (c) {
    releaseHolds(c)
    controllers.delete(name)
  }
  const detected = useControllerStore.getState().detected
  if (detected.some((d) => d.port === name && d.connected)) {
    useControllerStore.getState().setDetected(detected.map((d) => (d.port === name ? { ...d, connected: false } : d)))
  }
  scheduleGhosts()
}

// ---------------- Routing ----------------

/**
 * The profile layer. Returns true when the message was consumed (the user
 * mapping router must not see it).
 */
export function routeControllerMessage(type: MidiSourceType, channel: number, number: number, value: number, deviceName?: string): boolean {
  if (!deviceName || type === 'program') return false
  const c = controllers.get(deviceName)
  if (!c || !c.settings.enabled) return false
  const control = c.controlByMsg.get(msgKey(type, channel, number))
  if (!control) return false
  // MIDI learn sees the raw message; a user mapping on this control wins
  if (useMidiStore.getState().isLearning) return false
  if (c.overridden.has(control.id)) return false

  if (control.id === 'shift') {
    c.shift = value > 0
    return true
  }
  const binding = c.bindingByControl.get(control.id)
  if (!binding) return false

  if (control.kind === 'fader' || control.kind === 'encoder') {
    handleFader(c, control, binding, value)
    return true
  }

  if (value <= 0) {
    const release = c.held.get(control.id)
    if (release) {
      c.held.delete(control.id)
      release()
      requestFeedback()
    }
    return true
  }
  if (c.held.has(control.id)) return true // repeated press without release
  const action = c.shift && binding.shiftAction ? binding.shiftAction : binding.action
  const release = performButton(action, `midi:${c.port}`)
  if (release) c.held.set(control.id, release)
  requestFeedback()
  return true
}

/** A fader moved but waits to pick up its value (soft takeover) */
export interface PickupWait {
  port: string
  control: ControlDef
  action: ControllerAction
  /** Value the fader must reach (0-255) */
  level: number
  /** Where the fader is (0-255) */
  physical: number
}

let pickupNotifier: ((w: PickupWait) => void) | null = null
/** port + control already notified since its last pickup / re-arm */
const pickupNotified = new Set<string>()

/** Called once per fader each time it waits for pickup (the app shows a toast) */
export function setPickupNotifier(fn: ((w: PickupWait) => void) | null): void {
  pickupNotifier = fn
}

function handleFader(c: ControllerRuntime, control: ControlDef, binding: ControllerBinding, raw: number): void {
  const action = binding.action
  const logical = faderLogicalLevel(action)
  const jump = c.settings.takeover === 'jump' || control.kind === 'encoder' || !!c.profile.motorFaders || logical === null
  if (jump) {
    c.takeover.set(control.id, { synced: true, lastPhysical: raw, lastLogical: raw })
    performFader(action, midiToDmx(raw))
  } else {
    const r = takeover(c.takeover.get(control.id) ?? initialTakeover(), raw, dmxToMidi(logical), TAKEOVER_TOLERANCE)
    c.takeover.set(control.id, r.state)
    const key = `${c.port}\u0000${control.id}`
    if (r.apply) {
      pickupNotified.delete(key)
      performFader(action, midiToDmx(raw))
    } else if (!pickupNotified.has(key)) {
      // Tell the operator ONCE why the fader does nothing yet (the ghost on
      // the on-screen fader shows where it is)
      pickupNotified.add(key)
      try { pickupNotifier?.({ port: c.port, control, action, level: logical, physical: midiToDmx(raw) }) } catch (e) { console.error('[MIDI] pickup notice failed:', e) }
    }
  }
  c.values.set(control.id, raw)
  scheduleGhosts()
}

/** SysEx from a controller input (fader positions reply) */
export function handleControllerSysex(data: ArrayLike<number>, deviceName: string): void {
  const c = controllers.get(deviceName)
  const positions = c?.profile.parseFaderPositions?.(data)
  if (!c || !positions) return
  for (const [id, raw] of positions) {
    const binding = c.bindingByControl.get(id)
    if (!binding) continue
    const logical = faderLogicalLevel(binding.action)
    const within = logical !== null && Math.abs(dmxToMidi(logical) - raw) <= TAKEOVER_TOLERANCE
    c.takeover.set(id, { synced: within, lastPhysical: raw, lastLogical: within ? raw : null })
  }
  scheduleGhosts()
}

/** Page change / show load: every column fader must pick up again */
export function rearmFaders(includeMaster: boolean): void {
  pickupNotified.clear()
  for (const c of controllers.values()) {
    for (const [id, st] of c.takeover) {
      const b = c.bindingByControl.get(id)
      if (!b) continue
      if (b.action.type === 'column-fader' || (includeMaster && b.action.type === 'grand-master')) c.takeover.set(id, rearm(st))
    }
  }
  scheduleGhosts()
}

/** Start the "Test LEDs" pattern on a controller */
export function testControllerLeds(port: string): void {
  const c = controllers.get(port)
  if (!c) return
  c.testStart = Date.now()
  useControllerStore.getState().setTesting(port)
  requestFeedback()
}

// ---------------- Ghosts (≤ 10 Hz) ----------------

const GHOST_INTERVAL_MS = 100
let ghostTimer: ReturnType<typeof setTimeout> | null = null
let lastGhostRun = 0

/** Ghost positions of faders that have not picked up their value */
export function computeGhosts(): Record<string, number> {
  const out: Record<string, number> = {}
  const page = useExecutorStore.getState().currentPage
  for (const c of controllers.values()) {
    if (c.settings.takeover === 'jump' || c.profile.motorFaders) continue
    for (const [id, st] of c.takeover) {
      const b = c.bindingByControl.get(id)
      if (!b || st.lastPhysical === null) continue
      if (b.action.type !== 'column-fader' && b.action.type !== 'grand-master') continue
      const logical = faderLogicalLevel(b.action)
      if (logical === null || !needsGhost(st, dmxToMidi(logical))) continue
      const key = b.action.type === 'grand-master' ? GM_GHOST_KEY : ghostKey(page, b.action.col)
      out[key] = midiToDmx(st.lastPhysical)
    }
  }
  return out
}

function publishGhosts(): void {
  ghostTimer = null
  lastGhostRun = Date.now()
  useControllerStore.getState().setGhosts(computeGhosts())
}

export function scheduleGhosts(): void {
  if (ghostTimer) return
  if (controllers.size === 0) {
    if (Object.keys(useControllerStore.getState().ghosts).length > 0) useControllerStore.getState().setGhosts({})
    return
  }
  const wait = Math.max(0, lastGhostRun + GHOST_INTERVAL_MS - Date.now())
  ghostTimer = setTimeout(publishGhosts, wait)
}

// ---------------- Tests ----------------

export function __resetControllersForTests(): void {
  controllers.clear()
  outputsByName.clear()
  lastAccess = null
  if (ghostTimer) clearTimeout(ghostTimer)
  ghostTimer = null
  lastGhostRun = 0
  requestFeedback = () => {}
  pickupNotifier = null
  pickupNotified.clear()
}

