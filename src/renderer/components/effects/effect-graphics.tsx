// ============================================================
// Effect visuals: static waveform glyphs (SVG), the live output
// scope and the per-fixture phase (fan) preview. The live ones draw
// on a canvas from the shared phase ticker — no React render per frame.
// ============================================================

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { Effect, EffectChannel, WaveformKeyframe, WaveformType } from '@shared/types'
import { computeFanPositions, getWaveformValue, hashSeed } from '@renderer/lib/effect-engine'
import { usePatchStore } from '@renderer/stores/patch-store'
import { SWATCH_COLORS, palette, withAlpha } from '@renderer/components/ui'
import { effectChannels } from './effect-templates'
import { usePhase } from './phase-ticker'

// ------------------------------------------------------------
// Colours
// ------------------------------------------------------------

const ATTRIBUTE_COLORS: Record<string, string> = {
  Dimmer: SWATCH_COLORS[2],
  Red: SWATCH_COLORS[1],
  Green: SWATCH_COLORS[4],
  Blue: SWATCH_COLORS[7],
  White: palette.fgPrimary,
  Cyan: SWATCH_COLORS[6],
  Magenta: SWATCH_COLORS[10],
  Yellow: SWATCH_COLORS[3],
  'Color Wheel': SWATCH_COLORS[10],
  Pan: SWATCH_COLORS[5],
  Tilt: SWATCH_COLORS[9],
  Shutter: SWATCH_COLORS[3]
}

export function attributeColor(type: string): string {
  return ATTRIBUTE_COLORS[type] ?? SWATCH_COLORS[8]
}

const isCentered = (type: string) => type === 'Pan' || type === 'Tilt'

/** Output (0..1 of full DMX) of one attribute at an absolute phase — mirrors the engine's mapping */
function outputAt(effect: Pick<Effect, 'waveform' | 'keyframes' | 'id'>, ch: EffectChannel, absPhase: number, salt: number, normalized = false): number {
  const waveform = ch.waveform ?? effect.waveform
  const cycle = Math.floor(absPhase)
  const w = getWaveformValue(waveform, absPhase - cycle, effect.keyframes,
    waveform === 'random' ? { seed: hashSeed(effect.id, salt, ch.channelType), cycle } : undefined)
  if (normalized) return (w + 1) / 2
  const d = Math.max(0, Math.min(255, ch.depth)) / 255
  return isCentered(ch.channelType) ? 0.5 + (w * d) / 2 : ((w + 1) / 2) * d
}

// ------------------------------------------------------------
// Static glyph (SVG) — template cards, waveform picker
// ------------------------------------------------------------

function glyphPath(waveform: WaveformType, w: number, h: number, opts: { keyframes?: WaveformKeyframe[]; phase?: number; freq?: number; cycles?: number } = {}): string {
  const { keyframes, phase = 0, freq = 1, cycles = 1 } = opts
  const n = 48
  const pad = 2
  let d = ''
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * cycles
    const abs = u * freq + phase
    const cycle = Math.floor(abs)
    const v = getWaveformValue(waveform, abs - cycle, keyframes, waveform === 'random' ? { seed: 7, cycle } : undefined)
    const x = (i / n) * w
    const y = pad + ((1 - v) / 2) * (h - pad * 2)
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

/** Small waveform drawing in currentColor */
export const WaveGlyph = memo(function WaveGlyph({ waveform, keyframes, width = 40, height = 16, cycles = 1, className }: {
  waveform: WaveformType
  keyframes?: WaveformKeyframe[]
  width?: number
  height?: number
  cycles?: number
  className?: string
}) {
  const d = useMemo(() => glyphPath(waveform, width, height, { keyframes, cycles }), [waveform, keyframes, width, height, cycles])
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
})

/** Template preview: every attribute of the template, one cycle */
export const TemplatePreview = memo(function TemplatePreview({ waveform, channels, color, height = 28 }: {
  waveform: WaveformType
  channels: EffectChannel[]
  color: string
  height?: number
}) {
  const width = 120
  const paths = useMemo(
    () => channels.slice(0, 3).map((c) => glyphPath(c.waveform ?? waveform, width, height, { phase: (c.phaseOffset || 0) / 360, freq: c.frequencyMultiplier ?? 1 })),
    [channels, waveform, height]
  )
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
      <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke={palette.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeOpacity={i === 0 ? 1 : 0.45} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
    </svg>
  )
})

// ------------------------------------------------------------
// Canvas helper
// ------------------------------------------------------------

/** Size the backing store to the CSS box × DPR; returns a ready context and the CSS size */
function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const dpr = window.devicePixelRatio || 1
  const bw = Math.max(1, Math.round(w * dpr))
  const bh = Math.max(1, Math.round(h * dpr))
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { ctx, w, h }
}

/** Redraw on resize (and call `draw` with the latest phase) */
function useCanvasDraw(draw: (canvas: HTMLCanvasElement) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ro = new ResizeObserver(() => drawRef.current(canvas))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])
  const redraw = useCallback(() => { if (ref.current) drawRef.current(ref.current) }, [])
  return [ref, redraw] as const
}

// ------------------------------------------------------------
// Live output scope
// ------------------------------------------------------------

/**
 * One cycle of the effect's output for the first target (y = DMX 0..100 %),
 * one curve per attribute, with a playhead at the current phase.
 */
export const WaveformScope = memo(function WaveformScope({ effect, className }: { effect: Effect; className?: string }) {
  const cyclesRef = useRef<number | null>(null)
  const channels = useMemo(() => effectChannels(effect), [effect])

  const [ref, redraw] = useCanvasDraw((canvas) => {
    const c = prepare(canvas)
    if (!c) return
    const { ctx, w, h } = c
    const pad = 6
    const plotH = h - pad * 2
    const yOf = (v: number) => pad + (1 - v) * plotH

    // Grid
    ctx.lineWidth = 1
    ctx.strokeStyle = palette.lineSubtle
    ctx.beginPath()
    for (let i = 1; i < 8; i++) {
      const x = Math.round((i / 8) * w) + 0.5
      ctx.moveTo(x, 0); ctx.lineTo(x, h)
    }
    for (const v of [0.25, 0.75]) {
      const y = Math.round(yOf(v)) + 0.5
      ctx.moveTo(0, y); ctx.lineTo(w, y)
    }
    ctx.stroke()
    ctx.strokeStyle = palette.line
    ctx.beginPath()
    for (const v of [0, 0.5, 1]) {
      const y = Math.round(yOf(v)) + 0.5
      ctx.moveTo(0, y); ctx.lineTo(w, y)
    }
    ctx.stroke()

    const cycles = cyclesRef.current
    const base = Math.floor(cycles ?? 0)
    const head = cycles === null ? null : cycles - base
    const offset = (Number(effect.offset) || 0) / 360

    channels.forEach((ch, ci) => {
      const color = attributeColor(ch.channelType)
      const fm = ch.frequencyMultiplier ?? 1
      const ph = (Number(ch.phaseOffset) || 0) / 360
      ctx.strokeStyle = color
      ctx.globalAlpha = ci === 0 ? 1 : 0.8
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const steps = Math.max(32, Math.min(400, Math.round(w / 2)))
      for (let i = 0; i <= steps; i++) {
        const u = i / steps
        const v = outputAt(effect, ch, (base + u) * fm + offset + ph, 0)
        const x = u * w
        if (i === 0) ctx.moveTo(x, yOf(v))
        else ctx.lineTo(x, yOf(v))
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    })

    if (head !== null) {
      const x = head * w
      ctx.strokeStyle = withAlpha(palette.fgPrimary, 0.5)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, h)
      ctx.stroke()
      channels.forEach((ch) => {
        const fm = ch.frequencyMultiplier ?? 1
        const ph = (Number(ch.phaseOffset) || 0) / 360
        const v = outputAt(effect, ch, (cycles as number) * fm + offset + ph, 0)
        ctx.fillStyle = attributeColor(ch.channelType)
        ctx.strokeStyle = palette.surface0
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x, yOf(v), 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
    }
  })

  usePhase(effect.id, effect.isRunning, (c) => {
    cyclesRef.current = c
    redraw()
  })
  useEffect(redraw, [effect, channels, redraw])

  return <canvas ref={ref} className={className} aria-label="Effect output preview" role="img" />
})

// ------------------------------------------------------------
// Fan (phase spread) preview
// ------------------------------------------------------------

const MAX_FAN_FIXTURES = 64

/**
 * Per-fixture output bars (live) over a 0–360° ruler that marks each
 * fixture's phase offset — what "spread" does at a glance.
 */
export const FanPreview = memo(function FanPreview({ effect, className }: { effect: Effect; className?: string }) {
  const patch = usePatchStore((s) => s.patch)
  const cyclesRef = useRef<number | null>(null)
  const ids = useMemo(() => effect.fixtureIds.slice(0, MAX_FAN_FIXTURES), [effect.fixtureIds])
  const positions = useMemo(
    () => computeFanPositions(effect.fixtureIds, patch, effect.spatialMode === 'spatial', effect.spatialAxis ?? 'x'),
    [effect.fixtureIds, patch, effect.spatialMode, effect.spatialAxis]
  )
  const ch = useMemo(() => effectChannels(effect)[0], [effect])

  const [ref, redraw] = useCanvasDraw((canvas) => {
    const c = prepare(canvas)
    if (!c) return
    const { ctx, w, h } = c
    const n = ids.length
    if (n === 0) return
    const rulerH = 16
    const barsH = h - rulerH - 4
    const gap = n > 24 ? 1 : 3
    const bw = Math.max(1, (w - gap * (n - 1)) / n)
    const fan = (Number(effect.fan) || 0) / 360
    const offset = (Number(effect.offset) || 0) / 360
    const cycles = cyclesRef.current ?? 0
    const color = attributeColor(ch.channelType)
    const fm = ch.frequencyMultiplier ?? 1
    const ph = (Number(ch.phaseOffset) || 0) / 360

    ids.forEach((id, i) => {
      const pos = positions.get(id) ?? 0
      const v = outputAt(effect, ch, cycles * fm + offset + fan * pos + ph, i, true)
      const x = i * (bw + gap)
      ctx.fillStyle = palette.surface2
      ctx.fillRect(x, 0, bw, barsH)
      ctx.fillStyle = cyclesRef.current === null ? withAlpha(color, 0.55) : color
      const bh = Math.max(1, v * barsH)
      ctx.fillRect(x, barsH - bh, bw, bh)
    })

    // Ruler: 0..360° of phase, one dot per fixture (first fixture highlighted)
    const ry = h - rulerH / 2
    ctx.font = '10px "JetBrains Mono Variable", monospace'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = palette.fgTertiary
    ctx.textAlign = 'left'
    ctx.fillText('0°', 0, ry)
    ctx.textAlign = 'right'
    ctx.fillText('360°', w, ry)
    const x0 = 20
    const x1 = w - 30
    ctx.strokeStyle = palette.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, Math.round(ry) + 0.5)
    ctx.lineTo(x1, Math.round(ry) + 0.5)
    ctx.stroke()
    ids.forEach((id, i) => {
      const deg = (((Number(effect.fan) || 0) * (positions.get(id) ?? 0)) % 360 + 360) % 360
      const x = x0 + (deg / 360) * (x1 - x0)
      ctx.fillStyle = i === 0 ? color : palette.fgSecondary
      ctx.beginPath()
      ctx.arc(x, ry, i === 0 ? 3.5 : 2.5, 0, Math.PI * 2)
      ctx.fill()
    })
  })

  usePhase(effect.id, effect.isRunning, (c) => {
    cyclesRef.current = c
    redraw()
  })
  useEffect(redraw, [effect, positions, ch, ids, redraw])

  return <canvas ref={ref} className={className} aria-label="Phase spread across fixtures" role="img" />
})

// ------------------------------------------------------------
// Phase ring (running list)
// ------------------------------------------------------------

const RING_R = 8
const RING_C = 2 * Math.PI * RING_R

/** Small ring that sweeps with the effect's phase (DOM writes only) */
export const PhaseRing = memo(function PhaseRing({ id, running, color }: { id: string; running: boolean; color: string }) {
  const arc = useRef<SVGCircleElement>(null)
  usePhase(id, running, (cycles) => {
    const el = arc.current
    if (!el) return
    const frac = cycles === null ? 0 : cycles - Math.floor(cycles)
    el.style.strokeDashoffset = String(RING_C * (1 - frac))
  })
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden className="shrink-0 -rotate-90">
      <circle cx={10} cy={10} r={RING_R} fill="none" stroke="rgb(var(--pb-surface-4))" strokeWidth={2.5} />
      <circle
        ref={arc}
        cx={10}
        cy={10}
        r={RING_R}
        fill="none"
        stroke={running ? color : 'transparent'}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C}
      />
    </svg>
  )
})
