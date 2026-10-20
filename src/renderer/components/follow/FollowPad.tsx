// Top view of the stage: drag the target with a finger / mouse, see the
// assigned fixtures and their beams. Arrow keys nudge (Shift = 50 cm).

import { useRef } from 'react'
import type React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn, palette, usePointerDrag, withAlpha } from '@renderer/components/ui'
import { formatDecimal, useT } from '@renderer/i18n'
import { useFollowStore } from '@renderer/stores/follow-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'

export interface PadFixture {
  id: string
  name: string
  x: number
  z: number
  assigned: boolean
}

export function FollowPad({ fixtures }: { fixtures: PadFixture[] }) {
  const t = useT()
  const room = useVisualizerStore(useShallow((s) => ({ width: s.roomConfig.width, depth: s.roomConfig.depth, height: s.roomConfig.height, edge: s.roomConfig.stageEdgeZ })))
  const { x, y, z, active } = useFollowStore(useShallow((s) => ({ x: s.targetX, y: s.targetY, z: s.targetZ, active: s.active })))
  const svgRef = useRef<SVGSVGElement>(null)

  const clampX = (v: number) => Math.max(-room.width / 2, Math.min(room.width / 2, v))
  const clampZ = (v: number) => Math.max(-room.depth / 2, Math.min(room.depth / 2, v))

  const toStage = (clientX: number, clientY: number): { x: number; z: number } | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: clampX(pt.x), z: clampZ(-pt.y) }
  }
  const moveTo = (clientX: number, clientY: number) => {
    const p = toStage(clientX, clientY)
    if (!p) return
    useFollowStore.getState().setTarget(Math.round(p.x * 100) / 100, useFollowStore.getState().targetY, Math.round(p.z * 100) / 100)
  }
  const fineStart = useRef<{ x: number; z: number } | null>(null)
  const drag = usePointerDrag({
    onStart: (s) => {
      fineStart.current = { x: useFollowStore.getState().targetX, z: useFollowStore.getState().targetZ }
      if (!s.fine) moveTo(s.x, s.y)
    },
    onMove: (s) => {
      if (!s.fine) { moveTo(s.x, s.y); return }
      // Precision (Shift / second finger): relative, quarter speed
      const svg = svgRef.current
      const ctm = svg?.getScreenCTM()
      if (!ctm) return
      const st = useFollowStore.getState()
      const mxM = (s.mx / ctm.a) * 0.25
      const myM = (s.my / ctm.d) * 0.25
      st.setTarget(clampX(st.targetX + mxM), st.targetY, clampZ(st.targetZ - myM))
    }
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 0.1
    const st = useFollowStore.getState()
    let nx = st.targetX
    let nz = st.targetZ
    if (e.key === 'ArrowLeft') nx -= step
    else if (e.key === 'ArrowRight') nx += step
    else if (e.key === 'ArrowUp') nz += step
    else if (e.key === 'ArrowDown') nz -= step
    else return
    e.preventDefault()
    e.stopPropagation()
    st.setTarget(clampX(nx), st.targetY, clampZ(nz))
  }

  const w = room.width
  const d = room.depth
  const grid: number[] = []
  for (let gx = Math.ceil(-w / 2); gx <= w / 2; gx++) grid.push(gx)
  const gridZ: number[] = []
  for (let gz = Math.ceil(-d / 2); gz <= d / 2; gz++) gridZ.push(gz)
  const r = Math.max(w, d) / 60
  const targetColor = active ? palette.goFg : palette.fgSecondary

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="pointer-events-none flex justify-center pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-fg-tertiary">{t('follow.pad.upstage')}</div>
      <div
        {...drag}
        data-follow-pad
        tabIndex={0}
        role="application"
        aria-label={t('follow.pad.targetAria')}
        onKeyDown={onKeyDown}
        className={cn(
          'relative min-h-0 flex-1 cursor-crosshair touch-none select-none rounded-lg outline-none ring-1 ring-inset focus-visible:ring-2 focus-visible:ring-info-fg',
          active ? 'ring-go/50' : 'ring-line'
        )}
      >
        <svg ref={svgRef} className="absolute inset-0 h-full w-full" viewBox={`${-w / 2 - r * 2} ${-d / 2 - r * 2} ${w + r * 4} ${d + r * 4}`} preserveAspectRatio="xMidYMid meet">
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={r} fill={palette.surface2} stroke={palette.line} strokeWidth={r * 0.15} />
          {grid.map((gx) => <line key={`x${gx}`} x1={gx} y1={-d / 2} x2={gx} y2={d / 2} stroke={gx === 0 ? palette.lineStrong : palette.lineSubtle} strokeWidth={r * (gx === 0 ? 0.12 : 0.08)} />)}
          {gridZ.map((gz) => <line key={`z${gz}`} x1={-w / 2} y1={gz} x2={w / 2} y2={gz} stroke={gz === 0 ? palette.lineStrong : palette.lineSubtle} strokeWidth={r * (gz === 0 ? 0.12 : 0.08)} />)}
          {/* Stage edge (audience side below) */}
          <line x1={-w / 2} y1={-room.edge} x2={w / 2} y2={-room.edge} stroke={palette.fgTertiary} strokeWidth={r * 0.15} strokeDasharray={`${r} ${r * 0.6}`} />
          <rect x={-w / 2} y={-room.edge} width={w} height={d / 2 + room.edge} fill={withAlpha(palette.surface0, 0.35)} />

          {/* Beams */}
          {fixtures.filter((f) => f.assigned).map((f) => (
            <line key={`b${f.id}`} x1={f.x} y1={-f.z} x2={x} y2={-z}
              stroke={active ? withAlpha(palette.goFg, 0.55) : withAlpha(palette.fgTertiary, 0.5)}
              strokeWidth={r * 0.18} strokeDasharray={active ? undefined : `${r * 0.6} ${r * 0.5}`} />
          ))}

          {/* Fixtures */}
          {fixtures.map((f) => (
            <g key={f.id}>
              <circle cx={f.x} cy={-f.z} r={f.assigned ? r * 0.9 : r * 0.6}
                fill={f.assigned ? palette.info : palette.surface4} stroke={f.assigned ? palette.infoFg : palette.lineStrong} strokeWidth={r * 0.15} />
            </g>
          ))}

          {/* Target */}
          <g>
            <circle cx={x} cy={-z} r={r * 2.4} fill={withAlpha(targetColor, active ? 0.18 : 0.08)} stroke={targetColor} strokeWidth={r * 0.2} />
            <line x1={x - r * 3.4} y1={-z} x2={x + r * 3.4} y2={-z} stroke={targetColor} strokeWidth={r * 0.16} />
            <line x1={x} y1={-z - r * 3.4} x2={x} y2={-z + r * 3.4} stroke={targetColor} strokeWidth={r * 0.16} />
            <circle cx={x} cy={-z} r={r * 0.5} fill={targetColor} />
          </g>
        </svg>
        <div className="pointer-events-none absolute left-3 top-2 rounded bg-surface-0/70 px-2 py-1 font-mono text-xs tabular text-fg-secondary">
          {t('follow.pad.readout', { x: formatDecimal(x, 2), z: formatDecimal(z, 2), h: formatDecimal(y, 2) })}
        </div>
      </div>
      <div className="pointer-events-none flex justify-center pt-1 text-2xs font-semibold uppercase tracking-[0.08em] text-fg-tertiary">{t('follow.pad.audience')}</div>
    </div>
  )
}
