// ============================================================
// PhotonBoard — MIDI LED feedback engine
//
// Store changes request a frame; frames run at most every 33 ms
// (≤ 30 Hz) plus a 4 Hz heartbeat while a controller is connected
// (programmer state, fade ends, macros). Each frame:
//   1. one FeedbackSnapshot of the show state
//   2. per controller: LED map (led-states) → diff against what the
//      device shows → profile.encodeLeds(changes) → output
//      (hardware blink modes; soft blink for on/off-only devices)
//   3. encoders / motor faders: value CC when the value changed
//   4. user mappings with options.feedback: echo to the device's output
// A cache cleared on connect / reconnect / show load = full resend.
// ============================================================

import type { Chase, Cuelist, Effect, MidiMapping } from '@shared/types'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useControllerStore } from '@renderer/stores/controller-store'
import { getMixValue, getProgrammerValue, isProgrammerActive } from '@renderer/lib/dmx-mixer'
import { resolveChannelTarget } from '@renderer/lib/midi-manager'
import { getTimelineState } from '@renderer/lib/timeline-engine'
import { isMacroRunning } from '@renderer/lib/cli'
import { effectiveBpm } from '@renderer/lib/pro/speed-masters'
import { LED_TEST_MS, computeLeds, computePagePlaying, diffLeds, softBlinkLed, testPatternLed, type FeedbackSnapshot } from './led-states'
import { listControllers, outputForDevice, sendToController, setFeedbackRequester, type ControllerRuntime, type MidiOutputLike } from './controller-runtime'
import { faderLogicalLevel, getLastTap, hasGoTarget } from './controller-actions'
import { dmxToMidi } from './takeover'
import { mappingFeedbackMessage, mappingFeedbackMode, mappingFeedbackValue, type MappingFeedbackContext } from './mapping-feedback'

export const FEEDBACK_MIN_INTERVAL_MS = 33
const HEARTBEAT_MS = 250
const ANIMATION_MS = 33
const SOFT_BLINK_MS = 250

// ---------------- Fade tracking ----------------

/**
 * Knows which playing scenes are inside their GO fade: a GO (goGeneration
 * or cue index change) starts a window of delay + max(fade in, fade out),
 * divided by the scene's rate. The playback controller may provide the
 * exact answer through setFadingProbe().
 */
export class FadeTracker {
  private seen = new Map<string, { gen: number; cue: number; until: number }>()

  observe(cuelists: readonly Cuelist[], now: number): void {
    for (const cl of cuelists) {
      if (!cl.isPlaying) { this.seen.delete(cl.id); continue }
      const gen = cl.goGeneration ?? 0
      const prev = this.seen.get(cl.id)
      if (prev && prev.gen === gen && prev.cue === cl.currentCueIndex) continue
      const cue = cl.cues[cl.currentCueIndex]
      const rate = cl.rate && cl.rate > 0 ? cl.rate : 1
      const secs = cue ? ((cue.delay || 0) + Math.max(cue.fadeIn || 0, cue.fadeOut || 0)) / rate : 0
      this.seen.set(cl.id, { gen, cue: cl.currentCueIndex, until: now + secs * 1000 })
    }
    if (this.seen.size > cuelists.length) {
      for (const id of this.seen.keys()) if (!cuelists.some((c) => c.id === id)) this.seen.delete(id)
    }
  }

  isFading(id: string, now: number): boolean {
    const s = this.seen.get(id)
    return !!s && now < s.until
  }

  anyFading(now: number): boolean {
    for (const s of this.seen.values()) if (now < s.until) return true
    return false
  }

  clear(): void {
    this.seen.clear()
  }
}

const fades = new FadeTracker()
/** Exact answer of the cue engine; undefined = unknown (the fade-time tracker answers) */
let fadingProbe: ((cuelistId: string) => boolean | undefined) | null = null

/** The cue engine's exact answer (lib/midi/index wires playback-controller isCuelistFading) */
export function setFadingProbe(fn: ((cuelistId: string) => boolean | undefined) | null): void {
  fadingProbe = fn
}

// ---------------- Snapshot (identity-cached lookups) ----------------

let cuelistsRef: readonly Cuelist[] | null = null
let cuelistById = new Map<string, Cuelist>()
let chasesRef: readonly Chase[] | null = null
let chaseById = new Map<string, Chase>()
let effectsRef: readonly Effect[] | null = null
let effectRunning = new Map<string, boolean>()

function buildSnapshot(now: number): FeedbackSnapshot {
  const ex = useExecutorStore.getState()
  const pb = usePlaybackStore.getState()
  const effects = useEffectsStore.getState().effects
  const dmx = useDmxStore.getState()
  const midi = useMidiStore.getState()
  if (pb.cuelists !== cuelistsRef) { cuelistsRef = pb.cuelists; cuelistById = new Map(pb.cuelists.map((c) => [c.id, c])) }
  if (pb.chases !== chasesRef) { chasesRef = pb.chases; chaseById = new Map(pb.chases.map((c) => [c.id, c])) }
  if (effects !== effectsRef) { effectsRef = effects; effectRunning = new Map(effects.map((e) => [e.id, e.isRunning])) }
  fades.observe(pb.cuelists, now)

  // Tap LED: blinks on the beat of the first running chase
  let tapOn = false
  const chase = pb.chases.find((c) => c.isPlaying)
  if (chase) {
    const bpm = effectiveBpm(chase)
    if (bpm > 0) {
      const beat = 60000 / bpm
      const phase = ((now - getLastTap().at) % beat + beat) % beat
      tapOn = phase < Math.min(120, beat / 3)
    }
  }

  const lookups = { cuelistById, chaseById, effectRunning }
  const pagePlaying = computePagePlaying(ex.pages, lookups)
  return {
    pages: ex.pages,
    currentPage: ex.currentPage,
    ...lookups,
    groups: usePatchStore.getState().groups,
    presets: pb.presets,
    macros: usePoolStore.getState().macros,
    selected: useProStore.getState().selectedExecutor,
    goTarget: hasGoTarget(),
    blackout: dmx.blackout,
    blinder: dmx.blinder,
    strobe: dmx.strobe,
    learnTargetId: midi.isLearning ? midi.learnTarget?.id ?? null : null,
    programmerActive: isProgrammerActive(),
    tapOn,
    pagePlaying,
    anythingPlaying: pagePlaying.some(Boolean) || pb.cuelists.some((c) => c.isPlaying) || pb.chases.some((c) => c.isPlaying),
    isFading: (id) => fadingProbe?.(id) ?? fades.isFading(id, now),
    isMacroRunning
  }
}

// ---------------- Per controller frame ----------------

/** LEDs + values of one controller. Returns true when it needs animation frames. */
export function renderController(c: ControllerRuntime, snap: FeedbackSnapshot, now: number): boolean {
  let animate = false
  const next = c.next
  if (c.testStart !== null) {
    const elapsed = now - c.testStart
    if (elapsed >= LED_TEST_MS) {
      c.testStart = null
      c.leds.clear() // full resend of the real state
      if (useControllerStore.getState().testing === c.port) useControllerStore.getState().setTesting(null)
      computeLeds(c.bindings, snap, c, next)
    } else {
      next.clear()
      for (const d of c.profile.controls) if (d.kind !== 'fader' && d.id !== 'shift') next.set(d.id, testPatternLed(d.id, elapsed))
      animate = true
    }
  } else {
    computeLeds(c.bindings, snap, c, next)
  }

  if (c.profile.softBlink) {
    const phaseOn = Math.floor(now / SOFT_BLINK_MS) % 2 === 0
    for (const [id, st] of next) {
      if (st.mode === 'blink' || st.mode === 'pulse') {
        animate = true
        next.set(id, softBlinkLed(st, phaseOn))
      }
    }
  }

  if (c.output) {
    const changes = diffLeds(c.leds, next)
    if (changes.length > 0) sendToController(c, c.profile.encodeLeds(changes))
    sendValues(c)
  }
  return animate
}

/** Encoders (LED rings) and motor faders follow their value */
function sendValues(c: ControllerRuntime): void {
  for (const b of c.bindings) {
    if (b.action.type !== 'column-fader' && b.action.type !== 'grand-master') continue
    const d = c.controlById.get(b.control)
    if (!d || d.type !== 'cc' || !(d.kind === 'encoder' || (d.kind === 'fader' && c.profile.motorFaders))) continue
    const level = faderLogicalLevel(b.action)
    if (level === null) continue
    const raw = dmxToMidi(level)
    if (c.values.get(d.id) === raw) continue
    c.values.set(d.id, raw)
    sendToController(c, [[0xb0 | (d.channel - 1), d.number, raw]])
  }
}

// ---------------- User mapping feedback ----------------

/** Last value sent per output and message key */
let mappingSent = new WeakMap<MidiOutputLike, Map<number, number>>()

function mappingContext(): MappingFeedbackContext {
  const pb = usePlaybackStore.getState()
  const dmx = useDmxStore.getState()
  return {
    cuelist: (id) => cuelistById.get(id) ?? pb.cuelists.find((c) => c.id === id),
    chase: (id) => chaseById.get(id) ?? pb.chases.find((c) => c.id === id),
    effectRunning: (id) => effectRunning.get(id),
    grandMaster: dmx.grandMaster,
    blackout: dmx.blackout,
    blinder: dmx.blinder,
    strobe: dmx.strobe,
    timelinePlaying: getTimelineState().isPlaying,
    channelValue: (m: MidiMapping) => {
      const addr = resolveChannelTarget(m)
      return addr ? getProgrammerValue(addr.universe, addr.channel) ?? getMixValue(addr.universe, addr.channel) : undefined
    }
  }
}

export function renderMappingFeedback(mappings: readonly MidiMapping[]): void {
  let ctx: MappingFeedbackContext | null = null
  for (const m of mappings) {
    const mode = mappingFeedbackMode(m)
    if (!mode || !m.source.deviceName) continue
    const out = outputForDevice(m.source.deviceName)
    if (!out) continue
    ctx ??= mappingContext()
    const raw = mappingFeedbackValue(m, ctx)
    if (raw === null) continue
    const msg = mappingFeedbackMessage(m, mode, raw)
    let sent = mappingSent.get(out)
    if (!sent) { sent = new Map(); mappingSent.set(out, sent) }
    const key = (msg[0] << 8) | msg[1]
    if (sent.get(key) === msg[2]) continue
    sent.set(key, msg[2])
    try { out.send(msg) } catch (e) { console.warn('[MIDI] feedback send failed:', e) }
  }
}

/** Forget what user-mapping feedback sent (full resend) */
export function invalidateMappingFeedback(): void {
  mappingSent = new WeakMap()
}

// ---------------- Scheduler ----------------

let timer: ReturnType<typeof setTimeout> | null = null
let timerDue = 0
let lastRun = 0
let running = false

function hasWork(): boolean {
  for (const c of listControllers()) if (c.output) return true
  return useMidiStore.getState().mappings.some((m) => mappingFeedbackMode(m) !== undefined)
}

export function runFeedbackFrame(now = Date.now()): void {
  timer = null
  lastRun = now
  if (!hasWork()) return
  const snap = buildSnapshot(now)
  let animate = false
  for (const c of listControllers()) {
    if (c.settings.enabled && renderController(c, snap, now)) animate = true
  }
  // The Tap LED needs frames while a chase runs
  if (usePlaybackStore.getState().chases.some((ch) => ch.isPlaying)) animate = true
  renderMappingFeedback(useMidiStore.getState().mappings)
  if (running) schedule(animate || fades.anyFading(now) ? ANIMATION_MS : HEARTBEAT_MS)
}

function schedule(minDelay: number): void {
  if (!running) return
  const now = Date.now()
  const due = Math.max(now + minDelay, lastRun + FEEDBACK_MIN_INTERVAL_MS)
  if (timer) {
    if (timerDue <= due) return // a sooner frame is already planned
    clearTimeout(timer)
  }
  timerDue = due
  timer = setTimeout(() => runFeedbackFrame(), Math.max(0, due - now))
}

/** A store changed: a frame within 33 ms (≤ 30 Hz) */
export function requestFeedbackFrame(): void {
  schedule(0)
}

export function startFeedback(): () => void {
  if (running) return stopFeedback
  running = true
  setFeedbackRequester(requestFeedbackFrame)
  requestFeedbackFrame()
  return stopFeedback
}

export function stopFeedback(): void {
  running = false
  if (timer) clearTimeout(timer)
  timer = null
  setFeedbackRequester(() => {})
}

/** Tests */
export function __resetFeedbackForTests(): void {
  stopFeedback()
  fades.clear()
  fadingProbe = null
  cuelistsRef = null
  chasesRef = null
  effectsRef = null
  lastRun = 0
}

