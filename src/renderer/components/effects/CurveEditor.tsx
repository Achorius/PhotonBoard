// ============================================================
// CurveEditor — custom waveform keyframes (x: phase 0..1, y: -1..+1).
//  - tap empty space to add a point (and keep dragging it)
//  - drag a handle to move it; the first / last points stay on the edges
//  - double-tap a handle (or select it + Delete) to remove it
//  - pointer capture; pointercancel / lost capture reverts the drag
//  - optional snap to the grid (16 × 8)
// Handles have a large invisible hit area for fingers.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuMagnet, LuRotateCcw, LuTrash2 } from 'react-icons/lu'
import type { WaveformKeyframe } from '@shared/types'
import { getWaveformValue } from '@renderer/lib/effect-engine'
import { Button, NumberField, ToggleButton, cn, palette, useDensity } from '@renderer/components/ui'
import { DEFAULT_KEYFRAMES } from './effect-templates'

interface CurveEditorProps {
  keyframes: WaveformKeyframe[] | undefined
  onChange: (keyframes: WaveformKeyframe[]) => void
  color?: string
  height?: number
  className?: string
}

const GRID_X = 16
const GRID_Y = 8
const DOUBLE_TAP_MS = 320
/** Keep keyframes at least this far apart in x (stable ordering) */
const MIN_GAP = 0.005

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const sortKfs = (k: WaveformKeyframe[]) => [...k].sort((a, b) => a.x - b.x)

export function CurveEditor({ keyframes, onChange, color = palette.accent, height = 150, className }: CurveEditorProps) {
  const density = useDensity()
  const touch = density === 'touch'
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [selected, setSelected] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snap, setSnap] = useState(true)
  const kfs = useMemo(() => sortKfs(keyframes && keyframes.length > 0 ? keyframes : DEFAULT_KEYFRAMES), [keyframes])
  const gesture = useRef<{ pointerId: number; index: number; before: WaveformKeyframe[]; list: WaveformKeyframe[] } | null>(null)
  const lastTap = useRef<{ t: number; index: number } | null>(null)
  const h = touch ? Math.round(height * 1.25) : height
  const handleR = touch ? 8 : 5
  const hitR = touch ? 24 : 12

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the selection valid when the points change from outside
  useEffect(() => {
    if (selected !== null && selected >= kfs.length) setSelected(null)
  }, [kfs.length, selected])

  const toPx = (k: WaveformKeyframe) => ({ x: k.x * width, y: ((1 - k.y) / 2) * h })
  const fromPx = (px: number, py: number, fine = false): WaveformKeyframe => {
    let x = clamp(px / width, 0, 1)
    let y = clamp(1 - (py / h) * 2, -1, 1)
    if (snap && !fine) {
      x = Math.round(x * GRID_X) / GRID_X
      y = Math.round(((y + 1) / 2) * GRID_Y) / GRID_Y * 2 - 1
    }
    return { x, y }
  }

  /** Move point `i` to `p`, keeping the edges fixed and the order stable */
  const placed = (list: WaveformKeyframe[], i: number, p: WaveformKeyframe): WaveformKeyframe[] => {
    const last = list.length - 1
    let x = p.x
    if (i === 0) x = 0
    else if (i === last) x = 1
    else x = clamp(x, list[i - 1].x + MIN_GAP, list[i + 1].x - MIN_GAP)
    return list.map((k, j) => (j === i ? { x, y: p.y } : k))
  }

  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { px: e.clientX - r.left, py: e.clientY - r.top }
  }

  const hitTest = (px: number, py: number): number => {
    let best = -1
    let bestD = hitR * hitR
    kfs.forEach((k, i) => {
      const p = toPx(k)
      const d = (p.x - px) ** 2 + (p.y - py) ** 2
      if (d <= bestD) { best = i; bestD = d }
    })
    return best
  }

  const removePoint = (i: number) => {
    if (i <= 0 || i >= kfs.length - 1 || kfs.length <= 2) return
    onChange(kfs.filter((_, j) => j !== i))
    setSelected(null)
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (gesture.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const { px, py } = local(e)
    let index = hitTest(px, py)
    let list = kfs
    if (index >= 0) {
      const now = e.timeStamp
      if (lastTap.current && lastTap.current.index === index && now - lastTap.current.t < DOUBLE_TAP_MS) {
        lastTap.current = null
        removePoint(index)
        return
      }
      lastTap.current = { t: now, index }
    } else {
      // New point between its neighbours
      const p = fromPx(px, py, e.shiftKey)
      if (p.x <= 0 || p.x >= 1) return
      const next = sortKfs([...kfs, p])
      index = next.indexOf(p)
      const tooClose = (index > 0 && p.x - next[index - 1].x < MIN_GAP) || (index < next.length - 1 && next[index + 1].x - p.x < MIN_GAP)
      if (tooClose) return
      list = next
      onChange(next)
      lastTap.current = null
    }
    gesture.current = { pointerId: e.pointerId, index, before: kfs, list }
    setSelected(index)
    setDragging(true)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer gone */ }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    const { px, py } = local(e)
    g.list = placed(g.list, g.index, fromPx(px, py, e.shiftKey))
    onChange(g.list)
  }

  const end = (e: React.PointerEvent<SVGSVGElement>, canceled: boolean) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    setDragging(false)
    try { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
    if (canceled) onChange(g.before)
  }

  const curve = useMemo(() => {
    const steps = Math.max(48, Math.round(width / 2))
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const p = i / steps
      const v = getWaveformValue('custom', p, kfs)
      d += `${i === 0 ? 'M' : 'L'}${(p * width).toFixed(1)} ${(((1 - v) / 2) * h).toFixed(1)}`
    }
    return d
  }, [kfs, width, h])

  const sel = selected !== null ? kfs[selected] : null
  const selIsEdge = selected === 0 || selected === kfs.length - 1

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div ref={wrapRef} className="overflow-hidden rounded border border-line bg-surface-0">
        <svg
          width={width}
          height={h}
          className={cn('block touch-none select-none', dragging ? 'cursor-grabbing' : 'cursor-crosshair')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => end(e, false)}
          onPointerCancel={(e) => end(e, true)}
          onLostPointerCapture={(e) => end(e, false)}
          role="application"
          aria-label="Custom waveform editor"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
              e.preventDefault()
              e.stopPropagation()
              removePoint(selected)
            }
          }}
        >
          {/* Grid */}
          {Array.from({ length: GRID_X - 1 }, (_, i) => {
            const x = Math.round(((i + 1) / GRID_X) * width) + 0.5
            return <line key={`x${i}`} x1={x} x2={x} y1={0} y2={h} stroke={(i + 1) % 4 === 0 ? palette.line : palette.lineSubtle} strokeWidth={1} />
          })}
          {Array.from({ length: GRID_Y - 1 }, (_, i) => {
            const y = Math.round(((i + 1) / GRID_Y) * h) + 0.5
            return <line key={`y${i}`} x1={0} x2={width} y1={y} y2={y} stroke={i + 1 === GRID_Y / 2 ? palette.lineStrong : palette.lineSubtle} strokeWidth={1} />
          })}

          <path d={curve} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

          {kfs.map((k, i) => {
            const p = toPx(k)
            const isSel = i === selected
            return (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={hitR} fill="transparent" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isSel ? handleR + 1.5 : handleR}
                  fill={isSel ? palette.fgPrimary : color}
                  stroke={isSel ? color : palette.surface0}
                  strokeWidth={2}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleButton size="sm" variant="ghost" tone="info" icon={LuMagnet} pressed={snap} onPressedChange={setSnap} tooltip="Snap points to the grid (Shift = free)">
          Snap
        </ToggleButton>
        {sel ? (
          <>
            <NumberField
              size="sm"
              className="w-[92px]"
              label="X"
              value={Math.round(sel.x * 100)}
              min={0}
              max={100}
              unit="%"
              disabled={selIsEdge}
              onChange={(v) => selected !== null && onChange(placed(kfs, selected, { x: v / 100, y: sel.y }))}
            />
            <NumberField
              size="sm"
              className="w-[92px]"
              label="Y"
              value={Math.round(sel.y * 100)}
              min={-100}
              max={100}
              unit="%"
              onChange={(v) => selected !== null && onChange(placed(kfs, selected, { x: sel.x, y: v / 100 }))}
            />
            <Button size="sm" variant="ghost" icon={LuTrash2} disabled={selIsEdge || kfs.length <= 2} onClick={() => selected !== null && removePoint(selected)}>
              Delete point
            </Button>
          </>
        ) : (
          <span className="text-xs text-fg-tertiary">Tap to add a point · drag to move · double-tap to remove</span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={LuRotateCcw} onClick={() => { setSelected(null); onChange(DEFAULT_KEYFRAMES) }}>
          Reset
        </Button>
      </div>
    </div>
  )
}
