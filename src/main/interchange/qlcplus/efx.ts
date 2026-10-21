// ============================================================
// PhotonBoard — QLC+ EFX ⇄ PhotonBoard effect math
//
// QLC+ EFX (engine/src/efx.cpp): a point (x, y) ∈ [-1, 1]² runs along
// an algorithm curve, θ ∈ [0, 2π) per loop; it is scaled by
// Width / Height (DMX, 0-127), rotated, and offset (0-255):
//   X = xOff + x·cosR·w + y·sinR·h ;  Y = yOff − x·sinR·w + y·cosR·h
// Fixtures are phase-shifted by their StartOffset (+ the EFX's) and,
// in Serial / Asymmetric propagation, by i/(n+1) of the loop.
//
// PhotonBoard effect (renderer/lib/effect-engine.ts): per channel
//   value = 128 + wave(m·p + offset + fan·i/n + φ)·depth/2  (pan / tilt)
//   value = (wave(…)+1)/2·depth                              (others)
//
// Import samples the exact QLC+ curve of each axis and fits it:
// a pure harmonic (sine, any frequency / phase — exact, also with
// rotation), else square / sawtooth / triangle / a custom keyframe
// shape. Export writes sine effects as Circle / Eight / Line /
// Lissajous with exact phases.
// Pure module.
// ============================================================

import type { EffectChannel, WaveformKeyframe, WaveformType } from '../../../shared/types'

const N = 360
const TWO_PI = Math.PI * 2

/** Unit curve point of a QLC+ algorithm at θ (EFX::calculatePoint) */
export function efxPoint(algorithm: string, theta: number, xFreq = 2, yFreq = 3, xPhaseDeg = 90, yPhaseDeg = 0): [number, number] {
  const it = ((theta % TWO_PI) + TWO_PI) % TWO_PI
  const xPhase = (xPhaseDeg * Math.PI) / 180
  const yPhase = (yPhaseDeg * Math.PI) / 180
  switch (algorithm) {
    case 'Eight': return [Math.cos(it * 2 + Math.PI / 2), Math.cos(it)]
    case 'Line': return [Math.cos(it), Math.cos(it)]
    case 'Line2': return [it / Math.PI - 1, it / Math.PI - 1]
    case 'Diamond': return [Math.pow(Math.cos(it - Math.PI / 2), 3), Math.pow(Math.cos(it), 3)]
    case 'Square':
      if (it < Math.PI / 2) return [(it * 2 / Math.PI) * 2 - 1, 1]
      if (it < Math.PI) return [1, (1 - (it - Math.PI / 2) * 2 / Math.PI) * 2 - 1]
      if (it < Math.PI * 1.5) return [(1 - (it - Math.PI) * 2 / Math.PI) * 2 - 1, -1]
      return [-1, ((it - Math.PI * 1.5) * 2 / Math.PI) * 2 - 1]
    case 'SquareChoppy': return [Math.round(Math.cos(it)), Math.round(Math.sin(it))]
    case 'SquareTrue':
      if (it < Math.PI / 2) return [1, 1]
      if (it < Math.PI) return [1, -1]
      if (it < Math.PI * 1.5) return [-1, -1]
      return [-1, 1]
    case 'Leaf': return [Math.pow(Math.cos(it + Math.PI / 2), 5), Math.cos(it)]
    case 'Lissajous': {
      const tri = (phase: number): number => {
        let i0 = (it + phase) / Math.PI
        const fff = Math.trunc(i0)
        i0 -= fff - (fff % 2)
        const forward = 1 - Math.floor(i0)
        const backward = 1 - forward
        i0 = i0 - Math.floor(i0)
        return (forward * i0 + backward * (1 - i0)) * 2 - 1
      }
      const x = xFreq > 0 ? Math.cos(xFreq * it - xPhase) : tri(xPhase)
      const y = yFreq > 0 ? Math.cos(yFreq * it - yPhase) : tri(yPhase)
      return [x, y]
    }
    case 'Circle':
    default:
      return [Math.cos(it + Math.PI / 2), Math.cos(it)]
  }
}

export const EFX_ALGORITHMS = ['Circle', 'Eight', 'Line', 'Line2', 'Diamond', 'Square', 'SquareChoppy', 'SquareTrue', 'Leaf', 'Lissajous'] as const

export interface EfxShapeParams {
  algorithm: string
  width: number
  height: number
  rotation: number
  xFrequency: number
  yFrequency: number
  xPhase: number
  yPhase: number
  /** Iterator reversed (fixture direction ≠ EFX direction) */
  reversed: boolean
}

/** DMX deviation (around the offsets) of both axes at loop fraction p ∈ [0, 1) */
export function efxDeviation(s: EfxShapeParams, p: number): [number, number] {
  let it = p * TWO_PI
  if (s.reversed) it = s.algorithm === 'Line' ? (it > Math.PI ? it - Math.PI : it + Math.PI) : TWO_PI - it
  const [x, y] = efxPoint(s.algorithm, it, s.xFrequency, s.yFrequency, s.xPhase, s.yPhase)
  const r = (s.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [x * cos * s.width + y * sin * s.height, -x * sin * s.width + y * cos * s.height]
}

// ---------------------------------------------------------------- waveform model (effect-engine.ts)

function wave(w: WaveformType, p: number, keyframes?: WaveformKeyframe[]): number {
  const x = p - Math.floor(p)
  switch (w) {
    case 'sine': return Math.sin(x * TWO_PI)
    case 'square': return x < 0.5 ? 1 : -1
    case 'sawtooth': return 2 * x - 1
    case 'triangle': return x < 0.5 ? 4 * x - 1 : 3 - 4 * x
    case 'custom': return interpolate(x, keyframes)
    default: return 0
  }
}

function interpolate(x: number, k?: WaveformKeyframe[]): number {
  if (!k || k.length === 0) return 0
  if (x <= k[0].x) return k[0].y
  for (let i = 0; i + 1 < k.length; i++) {
    if (x <= k[i + 1].x) {
      const span = k[i + 1].x - k[i].x
      const t = span > 0 ? (x - k[i].x) / span : 0
      return k[i].y + (k[i + 1].y - k[i].y) * t
    }
  }
  return k[k.length - 1].y
}

// ---------------------------------------------------------------- fitting

export interface AxisFit {
  waveform: WaveformType
  /** Frequency multiplier (harmonic) */
  m: number
  /** Degrees, PhotonBoard convention (added to m·p) */
  phase: number
  /** Peak deviation in DMX units */
  amplitude: number
  /** Mean of the signal (DMX units, shifts the centre) */
  dc: number
  /** Normalised RMS error of the fit (0 = exact) */
  error: number
}

function rms(a: number[]): number {
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length))
}

/** Best (phase, amplitude ≥ 0) of `shape(m·p + phase)` against samples */
function fitShape(samples: number[], shape: (p: number) => number, m: number): { phase: number; amplitude: number; error: number } {
  const norm = rms(samples) || 1
  let best = { phase: 0, amplitude: 0, error: Infinity }
  const basis = new Array<number>(N)
  for (let deg = 0; deg < 360; deg++) {
    let dot = 0
    let bb = 0
    for (let i = 0; i < N; i++) {
      const b = shape(m * (i / N) + deg / 360)
      basis[i] = b
      dot += b * samples[i]
      bb += b * b
    }
    if (bb === 0) continue
    const amp = dot / bb
    if (amp < 0) continue
    let err = 0
    for (let i = 0; i < N; i++) {
      const d = samples[i] - amp * basis[i]
      err += d * d
    }
    err = Math.sqrt(err / N) / norm
    if (err < best.error - 1e-9) best = { phase: deg, amplitude: amp, error: err }
  }
  return best
}

/** Keyframes (33 points) of a signal's shape normalised to ±1 */
export function keyframesOf(samples: number[]): WaveformKeyframe[] {
  const peak = Math.max(...samples.map(Math.abs)) || 1
  const out: WaveformKeyframe[] = []
  for (let k = 0; k <= 32; k++) {
    const i = Math.min(N - 1, Math.round((k / 32) * N)) % N
    const v = k === 32 ? samples[0] : samples[i]
    out.push({ x: k / 32, y: Math.max(-1, Math.min(1, v / peak)) })
  }
  return out
}

/**
 * Fit one axis signal (N samples of the DMX deviation over one loop).
 * `customKeyframes`: an effect-wide custom shape already chosen (may be reused).
 */
export function fitAxis(raw: number[], customKeyframes?: WaveformKeyframe[]): AxisFit & { keyframes?: WaveformKeyframe[] } {
  const dc = raw.reduce((s, v) => s + v, 0) / raw.length
  const samples = raw.map((v) => v - dc)
  const energy = rms(samples)
  if (energy < 0.25) return { waveform: 'sine', m: 1, phase: 0, amplitude: 0, dc, error: 0 }
  // Harmonic analysis
  let bestK = 1
  let bestMag = -1
  const coeffs: { re: number; im: number }[] = []
  for (let k = 1; k <= 8; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < N; i++) {
      const a = (TWO_PI * k * i) / N
      re += samples[i] * Math.cos(a)
      im -= samples[i] * Math.sin(a)
    }
    re = (2 * re) / N
    im = (2 * im) / N
    coeffs[k] = { re, im }
    const mag = Math.hypot(re, im)
    if (mag > bestMag) { bestMag = mag; bestK = k }
  }
  {
    // samples ≈ A·cos(kθ + φ) = A·sin(kθ + φ + 90°)
    const { re, im } = coeffs[bestK]
    const A = Math.hypot(re, im)
    const phi = Math.atan2(im, re)
    let err = 0
    for (let i = 0; i < N; i++) {
      const d = samples[i] - A * Math.cos((TWO_PI * bestK * i) / N + phi)
      err += d * d
    }
    err = Math.sqrt(err / N) / energy
    if (err < 0.02) {
      const phase = ((((phi * 180) / Math.PI + 90) % 360) + 360) % 360
      return { waveform: 'sine', m: bestK, phase: Math.round(phase * 100) / 100, amplitude: A, dc, error: err }
    }
  }
  // Other shapes, at the fundamental of the dominant harmonic
  const m = bestK
  const candidates: (AxisFit & { keyframes?: WaveformKeyframe[] })[] = []
  for (const w of ['square', 'triangle', 'sawtooth', 'sine'] as WaveformType[]) {
    const f = fitShape(samples, (p) => wave(w, p), m)
    candidates.push({ waveform: w, m, phase: f.phase, amplitude: f.amplitude, dc, error: f.error })
  }
  if (customKeyframes) {
    const f = fitShape(samples, (p) => wave('custom', p, customKeyframes), m)
    candidates.push({ waveform: 'custom', m, phase: f.phase, amplitude: f.amplitude, dc, error: f.error })
  }
  candidates.sort((a, b) => a.error - b.error)
  if (candidates[0].error < 0.05 || customKeyframes) return candidates[0]
  // A custom shape from this axis (exact, one per effect)
  const period = Math.max(1, Math.round(N / m))
  const one = samples.slice(0, period)
  const resampled = Array.from({ length: N }, (_, i) => one[Math.floor((i / N) * one.length)])
  const keyframes = keyframesOf(resampled)
  const f = fitShape(samples, (p) => wave('custom', p, keyframes), m)
  const custom = { waveform: 'custom' as WaveformType, m, phase: f.phase, amplitude: f.amplitude, dc, error: f.error, keyframes }
  return custom.error < candidates[0].error ? custom : candidates[0]
}

/** Samples of both axes of an EFX shape over one loop */
export function sampleEfx(s: EfxShapeParams, shift = 0): [number[], number[]] {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < N; i++) {
    const [x, y] = efxDeviation(s, i / N + shift)
    xs.push(x)
    ys.push(y)
  }
  return [xs, ys]
}

/** Effect channel from an axis fit (pan / tilt are centred at 128: depth = 2·amplitude) */
export function channelFromFit(channelType: string, fit: AxisFit): EffectChannel {
  const ch: EffectChannel = {
    channelType,
    phaseOffset: Math.round(fit.phase * 100) / 100,
    depth: Math.max(0, Math.min(255, Math.round(fit.amplitude * 2)))
  }
  if (fit.m !== 1) ch.frequencyMultiplier = fit.m
  if (fit.waveform !== 'sine') ch.waveform = fit.waveform
  return ch
}

// ---------------------------------------------------------------- export (PhotonBoard → EFX)

export interface EfxAxisOut {
  /** Frequency (integer ≥ 1) */
  f: number
  /** QLC+ Lissajous phase φ (degrees): value = cos(f·θ − φ) */
  phase: number
  /** Width / height (0-127) */
  size: number
}

/** PhotonBoard sine channel (phaseOffset, effect offset) → Lissajous axis */
export function lissajousAxis(ch: EffectChannel, effectOffsetDeg: number): EfxAxisOut {
  const f = Math.max(1, Math.round(ch.frequencyMultiplier ?? 1))
  // sin(2π(f·p) + a) = cos(fθ + a − 90°) = cos(fθ − φ)  ⇒  φ = 90° − a
  const a = (Number(ch.phaseOffset) || 0) + effectOffsetDeg
  const phase = ((((90 - a) % 360) + 360) % 360)
  return { f, phase: Math.round(phase) % 360, size: Math.max(0, Math.min(127, Math.round(ch.depth / 2))) }
}

export interface EfxOut {
  algorithm: 'Circle' | 'Eight' | 'Line' | 'Lissajous'
  direction: 'Forward' | 'Backward'
  /** EFX StartOffset (degrees) */
  startOffset: number
  width: number
  height: number
  xFrequency: number
  yFrequency: number
  xPhase: number
  yPhase: number
}

const near = (a: number, b: number): boolean => {
  const d = ((((a - b) % 360) + 540) % 360) - 180
  return Math.abs(d) < 0.75
}

/** Pick the friendliest QLC+ algorithm that draws exactly the same pan / tilt curves */
export function efxFromAxes(x: EfxAxisOut | null, y: EfxAxisOut | null): EfxOut {
  const xs = x ?? { f: 1, phase: 90, size: 0 }
  const ys = y ?? { f: 1, phase: 0, size: 0 }
  const base: EfxOut = {
    algorithm: 'Lissajous', direction: 'Forward', startOffset: 0,
    width: xs.size, height: ys.size,
    xFrequency: xs.f, yFrequency: ys.f, xPhase: xs.phase, yPhase: ys.phase
  }
  if (xs.size > 0 && ys.size > 0 && ys.f === 1) {
    // y = cos(θ + δ) ⇒ δ = −φy
    const delta = ((360 - ys.phase) % 360 + 360) % 360
    const fwd = { ...base, startOffset: Math.round(delta) % 360 }
    // Circle: x = cos(θ + δ + 90°) ⇒ φx = −(δ + 90)
    if (xs.f === 1 && near(xs.phase, -(delta + 90))) return { ...fwd, algorithm: 'Circle' }
    // Circle backward (θ → −θ): x = cos(θ − δ' − 90), y = cos(θ − δ') ⇒ δ' = φy, φx = δ' + 90
    if (xs.f === 1 && near(xs.phase, ys.phase + 90)) return { ...base, algorithm: 'Circle', direction: 'Backward', startOffset: Math.round(ys.phase) % 360 }
    // Eight: x = cos(2θ + 2δ + 90°)
    if (xs.f === 2 && near(xs.phase, -(2 * delta + 90))) return { ...fwd, algorithm: 'Eight' }
    // Line: x = y = cos(θ + δ) (same size handled by width/height)
    if (xs.f === 1 && near(xs.phase, ys.phase)) return { ...fwd, algorithm: 'Line' }
  }
  return base
}
