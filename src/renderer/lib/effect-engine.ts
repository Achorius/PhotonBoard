// ============================================================
// PhotonBoard — Effect Engine
// LFO waveform generator. Each running effect contributes one mixer
// layer ("effect_<id>"). Supports compound multi-channel effects,
// pixel fixtures, 3D spatial spreads and one-shot mode.
//
//  - Phase is accumulated (cycles += dt * speed): changing the speed
//    or any parameter of a running effect never restarts or jumps it.
//  - Fan spreads the phase over N fixtures as i/N of the fan angle, so
//    a 360° fan never gives the first and last fixture the same phase.
//  - "random" is sample-and-hold per cycle with a short glide.
//  - One-shot effects stop themselves after one cycle and notify
//    listeners (the effects store clears its isRunning flag).
//  - Driven by the mixer clock (registerFrameSource) — time injected.
// ============================================================

import type { Effect, EffectChannel, WaveformType, WaveformKeyframe, SpatialAxis, Position3D, PatchEntry, FixtureDefinition } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { setLayer, removeLayer, registerFrameSource, type LayerChannels } from './dmx-mixer'
import { isColorWheelChannel, COLOR_WHEEL_MAX_DMX, rgbToColorWheelDmx } from './dmx-channel-resolver'
import { clockNow } from './runtime'

// RGB channel types used for Color Wheel fallback detection
const RGB_CHANNEL_TYPES = new Set(['red', 'green', 'blue'])

// Channel type name mapping
const CHANNEL_TYPE_TO_NAME: Record<string, string> = {
  Dimmer: 'dimmer',
  Red: 'red',
  Green: 'green',
  Blue: 'blue',
  White: 'white',
  Pan: 'pan',
  Tilt: 'tilt',
  Gobo: 'gobo',
  Zoom: 'zoom',
  Focus: 'focus',
  Shutter: 'shutter',
  'Color Wheel': 'color wheel',
  Cyan: 'cyan',
  Magenta: 'magenta',
  Yellow: 'yellow',
  Prism: 'prism',
  Frost: 'frost',
  Iris: 'iris',
}

/** Extra channel names an effect target also drives (e.g. "Intensity" for Dimmer) */
const TARGET_ALIASES: Record<string, string[]> = {
  dimmer: ['dimmer', 'intensity']
}

/** Does a fixture channel name match an effect target ("dimmer", "red", "pan"…)? */
function matchesTarget(channelName: string, targetName: string): boolean {
  const n = channelName.toLowerCase()
  if (/\bfine\b/.test(n) && !/\bfine\b/.test(targetName)) return false
  return (TARGET_ALIASES[targetName] ?? [targetName]).some(alias => n.includes(alias))
}

// Position channels oscillate around center (128) instead of 0
const POSITION_CHANNELS = new Set(['pan', 'tilt'])

export const EFFECT_LAYER_PRIORITY = 20
export const EFFECT_LAYER_PREFIX = 'effect_'

interface RunningEffect {
  effect: Effect
  /** Accumulated cycles (phase in turns, not wrapped) */
  cycles: number
  lastUpdate: number
}

const activeEffects = new Map<string, RunningEffect>()
const completeListeners = new Set<(id: string) => void>()

// ------------------------------------------------------------
// Waveforms
// ------------------------------------------------------------

/** Deterministic pseudo-random in [-1, 1] for (seed, cycle). */
function noise(seed: number, cycle: number): number {
  let h = (seed ^ Math.imul(cycle | 0, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return (h / 0xffffffff) * 2 - 1
}

/** Small string hash for random seeds. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x2c
  }
  return h >>> 0
}

/** Fraction of a random cycle spent gliding to the next value. */
const RANDOM_GLIDE = 0.25

export interface RandomSample {
  seed: number
  /** Integer cycle number (sample index) */
  cycle: number
}

/**
 * Waveform value (-1..+1) at `phase` (0..1 within the cycle).
 * For 'random', pass `random` to get sample-and-hold per cycle (the value is
 * held, then glides to the next cycle's value over the last quarter).
 */
export function getWaveformValue(
  waveform: WaveformType,
  phase: number,
  keyframes?: WaveformKeyframe[],
  random?: RandomSample
): number {
  const p = Number.isFinite(phase) ? phase - Math.floor(phase) : 0
  switch (waveform) {
    case 'sine':
      return Math.sin(p * 2 * Math.PI)
    case 'square':
      return p < 0.5 ? 1 : -1
    case 'sawtooth':
      return 2 * p - 1
    case 'triangle':
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
    case 'random': {
      const seed = random?.seed ?? 1
      const cycle = random?.cycle ?? 0
      const a = noise(seed, cycle)
      if (p < 1 - RANDOM_GLIDE) return a
      const b = noise(seed, cycle + 1)
      const t = (p - (1 - RANDOM_GLIDE)) / RANDOM_GLIDE
      return a + (b - a) * t * t * (3 - 2 * t)
    }
    case 'pulse':
      return Math.exp(-p * 5) * 2 - 1
    case 'bounce':
      return Math.abs(Math.sin(p * Math.PI * 3)) * Math.exp(-p * 2) * 2 - 1
    case 'step': {
      const steps = 4
      return Math.min(steps - 1, Math.floor(p * steps)) / (steps - 1) * 2 - 1
    }
    case 'custom':
      return interpolateKeyframes(p, keyframes)
    case 'constant':
      return 1
    default:
      return 0
  }
}

/** Catmull-Rom spline interpolation through keyframe points */
function interpolateKeyframes(phase: number, keyframes?: WaveformKeyframe[]): number {
  if (!keyframes || keyframes.length === 0) return 0
  if (keyframes.length === 1) return keyframes[0].y

  const sorted = [...keyframes].sort((a, b) => a.x - b.x)
  if (phase <= sorted[0].x) return sorted[0].y
  if (phase >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y

  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1].x < phase) i++

  const p0 = sorted[Math.max(0, i - 1)]
  const p1 = sorted[i]
  const p2 = sorted[Math.min(sorted.length - 1, i + 1)]
  const p3 = sorted[Math.min(sorted.length - 1, i + 2)]

  const segLen = p2.x - p1.x
  if (segLen === 0) return p1.y
  const t = (phase - p1.x) / segLen

  const t2 = t * t
  const t3 = t2 * t
  const y = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  )
  return Math.max(-1, Math.min(1, y))
}

// ------------------------------------------------------------
// Pure frame computation
// ------------------------------------------------------------

function getSpatialCoord(pos: Position3D, axis: SpatialAxis): number {
  switch (axis) {
    case 'x': return pos.x
    case 'y': return pos.y
    case 'z': return pos.z
    case 'radial': return Math.sqrt(pos.x * pos.x + pos.z * pos.z)
  }
}

/**
 * Phase spread (0..1 of the fan) for each fixture.
 * Index mode: i / n — wrapping, so a 360° fan spreads evenly.
 * Spatial mode: normalised position along the axis, scaled by (n-1)/n
 * so the two extremes don't land on the same phase at 360°.
 */
export function computeFanPositions(
  fixtureIds: string[],
  patch: PatchEntry[],
  spatial: boolean,
  axis: SpatialAxis = 'x'
): Map<string, number> {
  const result = new Map<string, number>()
  const n = fixtureIds.length
  if (n <= 1) {
    for (const id of fixtureIds) result.set(id, 0)
    return result
  }
  if (!spatial) {
    fixtureIds.forEach((id, i) => result.set(id, i / n))
    return result
  }
  const byId = new Map(patch.map(p => [p.id, p]))
  const coords = fixtureIds.map((id, i) => {
    const pos = byId.get(id)?.position3D
    return { id, value: pos ? getSpatialCoord(pos, axis) : i }
  })
  const min = Math.min(...coords.map(c => c.value))
  const max = Math.max(...coords.map(c => c.value))
  const range = max - min
  const scale = (n - 1) / n
  for (const c of coords) result.set(c.id, range > 0 ? ((c.value - min) / range) * scale : 0)
  return result
}

function isPositionChannel(channelType: string): boolean {
  return POSITION_CHANNELS.has(channelType.toLowerCase())
}

/** Convert waveform value (-1..+1) to DMX (0..255) with correct centering */
function waveToValue(waveValue: number, depth: number, centerAt128: boolean): number {
  const d = Math.max(0, Math.min(255, Number.isFinite(depth) ? depth : 0))
  const w = Number.isFinite(waveValue) ? waveValue : 0
  if (centerAt128) return Math.round(Math.max(0, Math.min(255, 128 + w * (d / 2))))
  return Math.round(Math.max(0, Math.min(255, ((w + 1) / 2) * d)))
}

function addToLayerMap(map: LayerChannels, universe: number, channel: number, value: number): void {
  let uniMap = map.get(universe)
  if (!uniMap) {
    uniMap = new Map()
    map.set(universe, uniMap)
  }
  const existing = uniMap.get(channel) ?? 0
  uniMap.set(channel, Math.min(255, existing + value))
}

/**
 * Compute the mixer layer of an effect at an accumulated phase of `cycles`
 * (pure: no store, no clock).
 */
export function computeEffectLayer(
  effect: Effect,
  cycles: number,
  patch: PatchEntry[],
  fixtures: FixtureDefinition[]
): LayerChannels {
  const layerChannels: LayerChannels = new Map()
  const byId = new Map(patch.map(p => [p.id, p]))
  const defs = new Map(fixtures.map(f => [f.id, f]))

  const effectChannels: EffectChannel[] = effect.channels && effect.channels.length > 0
    ? effect.channels
    : [{ channelType: effect.channelType, phaseOffset: 0, depth: effect.depth, frequencyMultiplier: 1 }]

  const fan = (Number(effect.fan) || 0) / 360
  const baseOffset = (Number(effect.offset) || 0) / 360
  const fanPositions = computeFanPositions(effect.fixtureIds, patch, effect.spatialMode === 'spatial', effect.spatialAxis ?? 'x')
  const effectHasRgb = effectChannels.some(ech =>
    RGB_CHANNEL_TYPES.has((CHANNEL_TYPE_TO_NAME[ech.channelType] || ech.channelType).toLowerCase())
  )

  effect.fixtureIds.forEach((fixtureId, fixtureIndex) => {
    const entry = byId.get(fixtureId)
    const def = entry ? defs.get(entry.fixtureDefId) : undefined
    const mode = def?.modes.find(m => m.name === entry!.modeName)
    if (!entry || !def || !mode) return

    const fixturePhase = fan * (fanPositions.get(fixtureId) ?? 0)
    const phaseOf = (ech: EffectChannel, extra: number): number =>
      cycles * (ech.frequencyMultiplier ?? 1) + baseOffset + fixturePhase + extra + (Number(ech.phaseOffset) || 0) / 360
    const sample = (ech: EffectChannel, absPhase: number, salt: string | number): number => {
      const waveform = ech.waveform ?? effect.waveform
      const cycle = Math.floor(absPhase)
      return getWaveformValue(waveform, absPhase - cycle, effect.keyframes,
        waveform === 'random' ? { seed: hashSeed(effect.id, fixtureIndex, ech.channelType, salt), cycle } : undefined)
    }

    const modeChLower = mode.channels.map(ch => ch.toLowerCase())
    const fixtureHasRgb = modeChLower.some(ch => ch.includes('red')) &&
      modeChLower.some(ch => ch.includes('green')) &&
      modeChLower.some(ch => ch.includes('blue'))
    const colorWheelIdx = modeChLower.findIndex(ch => ch === 'color wheel' || ch === 'color' || ch === 'colour wheel')

    // Effect uses RGB but the fixture only has a colour wheel → nearest slot
    // (the other attributes, e.g. an open dimmer, still run below)
    const wheelFallback = effectHasRgb && !fixtureHasRgb && colorWheelIdx !== -1
    if (wheelFallback) {
      const rgb: Record<string, number> = { red: 0, green: 0, blue: 0 }
      for (const ech of effectChannels) {
        const chName = (CHANNEL_TYPE_TO_NAME[ech.channelType] || ech.channelType).toLowerCase()
        if (!RGB_CHANNEL_TYPES.has(chName)) continue
        rgb[chName] = waveToValue(sample(ech, phaseOf(ech, 0), 0), ech.depth, false)
      }
      const absChannel = entry.address - 1 + colorWheelIdx
      if (absChannel >= 0 && absChannel < 512) {
        addToLayerMap(layerChannels, entry.universe, absChannel, rgbToColorWheelDmx(rgb.red, rgb.green, rgb.blue))
      }
    }

    for (const ech of effectChannels) {
      const targetName = CHANNEL_TYPE_TO_NAME[ech.channelType] || ech.channelType.toLowerCase()
      if (wheelFallback && RGB_CHANNEL_TYPES.has(targetName)) continue
      const centered = isPositionChannel(ech.channelType)
      const pixelLayout = mode.pixelLayout

      if (pixelLayout && pixelLayout.cellCount > 1) {
        for (let cellIdx = 0; cellIdx < pixelLayout.cellCount; cellIdx++) {
          const cell = pixelLayout.cells[cellIdx]
          if (!cell) continue
          const effectiveCellIdx = entry.pixelInvert ? pixelLayout.cellCount - 1 - cellIdx : cellIdx
          const cellPhase = fan * (effectiveCellIdx / pixelLayout.cellCount)
          const cellChIndex = cell.channelNames.findIndex(ch => matchesTarget(ch, targetName))
          if (cellChIndex === -1) continue
          const absChannel = entry.address - 1 + cell.channelOffset + cellChIndex
          const channelName = cell.channelNames[cellChIndex]
          const maxValue = isColorWheelChannel(channelName) ? COLOR_WHEEL_MAX_DMX : ech.depth
          const value = waveToValue(sample(ech, phaseOf(ech, cellPhase), cellIdx), maxValue, centered)
          if (absChannel >= 0 && absChannel < 512) addToLayerMap(layerChannels, entry.universe, absChannel, value)
        }
      } else {
        const chIndex = mode.channels.findIndex(ch => matchesTarget(ch, targetName))
        if (chIndex === -1) continue
        const channelName = mode.channels[chIndex]
        const maxValue = isColorWheelChannel(channelName) ? COLOR_WHEEL_MAX_DMX : ech.depth
        const value = waveToValue(sample(ech, phaseOf(ech, 0), 0), maxValue, centered)
        const absChannel = entry.address - 1 + chIndex
        if (absChannel >= 0 && absChannel < 512) addToLayerMap(layerChannels, entry.universe, absChannel, value)
      }
    }
  })

  return layerChannels
}

// ------------------------------------------------------------
// Runtime
// ------------------------------------------------------------

export interface StartEffectOptions {
  /** Restart the phase from 0 (re-trigger). Default: keep the phase of a running effect. */
  restart?: boolean
  now?: number
}

/**
 * Start an effect, or update the definition of a running one (phase kept,
 * so dragging a speed/size slider never restarts it).
 */
export function startEffect(effect: Effect, opts: StartEffectOptions = {}): void {
  const now = opts.now ?? clockNow()
  const existing = activeEffects.get(effect.id)
  if (existing && !opts.restart) {
    existing.effect = { ...effect, isRunning: true }
    return
  }
  activeEffects.set(effect.id, { effect: { ...effect, isRunning: true }, cycles: 0, lastUpdate: now })
}

export function stopEffect(id: string): void {
  activeEffects.delete(id)
  removeLayer(`${EFFECT_LAYER_PREFIX}${id}`)
}

/** Stop every effect whose id starts with `prefix` (e.g. one timeline clip or scene). */
export function stopEffectsWithPrefix(prefix: string): void {
  for (const id of Array.from(activeEffects.keys())) {
    if (id.startsWith(prefix)) stopEffect(id)
  }
}

export function stopAllEffects(): void {
  for (const id of Array.from(activeEffects.keys())) stopEffect(id)
}

export function isEffectRunning(id: string): boolean {
  return activeEffects.has(id)
}

export function getActiveEffects(): Map<string, { effect: Effect; cycles: number }> {
  return new Map(Array.from(activeEffects, ([id, r]) => [id, { effect: r.effect, cycles: r.cycles }]))
}

/** Listen for effects that stopped by themselves (one-shot). Returns an unsubscribe fn. */
export function onEffectComplete(listener: (id: string) => void): () => void {
  completeListeners.add(listener)
  return () => { completeListeners.delete(listener) }
}

/** Advance every running effect to `now` and push its layer to the mixer. */
export function updateEffects(now: number): void {
  if (activeEffects.size === 0) return
  const { patch, fixtures } = usePatchStore.getState()
  const completed: string[] = []

  for (const [id, running] of activeEffects) {
    const dt = Math.max(0, now - running.lastUpdate) / 1000
    running.lastUpdate = now
    const speed = Number(running.effect.speed)
    running.cycles += dt * (Number.isFinite(speed) && speed > 0 ? speed : 0)

    if (running.effect.oneShot && running.cycles >= 1) {
      completed.push(id)
      continue
    }
    setLayer(`${EFFECT_LAYER_PREFIX}${id}`, computeEffectLayer(running.effect, running.cycles, patch, fixtures), EFFECT_LAYER_PRIORITY)
  }

  for (const id of completed) {
    stopEffect(id)
    for (const listener of completeListeners) {
      try { listener(id) } catch (e) { console.error('[Effects] complete listener failed:', e) }
    }
  }
}

registerFrameSource('effects', updateEffects, 30)
