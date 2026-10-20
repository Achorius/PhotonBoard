// ============================================================
// Section view (seen from stage left): depth (audience left → upstage
// right) against height. Shows trusses, fixtures at their hanging height
// and where static fixtures focus. Drag a fixture up / down to set its
// height; tap selects.
// ============================================================

import { useCallback, useEffect, useRef } from 'react'
import type { FixtureDefinition } from '@shared/types'
import { palette, withAlpha } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useCanvasSize } from '@renderer/hooks/useCanvasSize'
import { getEffectiveColor, resolveChannels } from '@renderer/lib/dmx-channel-resolver'
import { aimDirection, clamp, cm, describeFixture, fixturePosition, rayToRoom, snap } from '../scene/layout-math'

interface Dot { id: string; x: number; y: number }

export function SideView({ className = '' }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // draw synchronously on resize: a resized canvas is blank until redrawn
  const size = useCanvasSize(wrapRef, canvasRef, () => draw())
  const frame = useRef({ ox: 0, oy: 0, s: 1 })
  const dots = useRef<Dot[]>([])
  const raf = useRef(0)
  const drag = useRef<{ id: string; pointerId: number; sy: number; y0: number; moved: boolean; mods: boolean } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h, dpr } = size.current
    if (w < 2 || h < 2) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const touch = document.documentElement.dataset.density === 'touch'
    const UI = '"Inter Variable", Inter, system-ui, sans-serif'
    const MONO = '"JetBrains Mono Variable", ui-monospace, monospace'
    const { patch, fixtures, selectedFixtureIds } = usePatchStore.getState()
    const vis = useVisualizerStore.getState()
    const room = vis.roomConfig
    const dmx = useDmxStore.getState()
    const selected = new Set(selectedFixtureIds)
    const defs = new Map<string, FixtureDefinition>(fixtures.map((f) => [f.id, f]))

    // Fit depth × height
    const padL = touch ? 44 : 38, padR = 16, padT = touch ? 30 : 26, padB = touch ? 22 : 18
    const s = Math.max(4, Math.min((w - padL - padR) / room.depth, (h - padT - padB) / room.height))
    const ox = padL + (w - padL - padR - room.depth * s) / 2 + (room.depth / 2) * s
    const oy = padT + (h - padT - padB - room.height * s) / 2 + room.height * s
    frame.current = { ox, oy, s }
    const X = (z: number) => ox + z * s
    const Y = (y: number) => oy - y * s

    ctx.fillStyle = palette.surface0
    ctx.fillRect(0, 0, w, h)

    const hd = room.depth / 2
    // Room section
    ctx.fillStyle = palette.surface1
    ctx.fillRect(X(-hd), Y(room.height), room.depth * s, room.height * s)
    // Height grid
    ctx.strokeStyle = palette.lineSubtle
    ctx.lineWidth = 1
    ctx.font = `500 ${touch ? 11 : 10}px ${MONO}`
    ctx.fillStyle = palette.fgTertiary
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const hStep = room.height * s > 140 ? 1 : 2
    ctx.beginPath()
    for (let y = 0; y <= room.height + 1e-6; y += hStep) {
      const sy = Math.round(Y(y)) + 0.5
      ctx.moveTo(X(-hd), sy); ctx.lineTo(X(hd), sy)
      ctx.fillText(`${y} m`, X(-hd) - 6, sy)
    }
    ctx.stroke()
    // Walls / floor / ceiling (audience side open)
    ctx.strokeStyle = palette.lineStrong
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(X(-hd), Y(0)); ctx.lineTo(X(hd), Y(0)); ctx.lineTo(X(hd), Y(room.height)); ctx.lineTo(X(-hd), Y(room.height))
    ctx.stroke()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = palette.line
    ctx.beginPath(); ctx.moveTo(X(-hd), Y(0)); ctx.lineTo(X(-hd), Y(room.height)); ctx.stroke()
    ctx.setLineDash([])
    // Stage edge
    const ez = clamp(room.stageEdgeZ ?? 0, -hd, hd)
    ctx.strokeStyle = withAlpha(palette.accent, 0.8)
    ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(X(ez), Y(0) + 4); ctx.lineTo(X(ez), Y(room.height)); ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `600 ${touch ? 12 : 11}px ${UI}`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = palette.fgDisabled
    ctx.fillText('AUDIENCE', X(-hd) + 6, Y(0) - 6)
    ctx.textAlign = 'right'
    ctx.fillText('UPSTAGE', X(hd) - 6, Y(0) - 6)
    ctx.textAlign = 'left'
    ctx.fillStyle = palette.fgTertiary
    ctx.fillText('SECTION · seen from stage left', 8, touch ? 18 : 16)

    // Truss bars (cross-section)
    for (const bar of room.trussBars) {
      const sel = bar.id === vis.selectedTrussId
      const bx = X(bar.z), by = Y(bar.y)
      const q = Math.max(5, 0.15 * s)
      ctx.fillStyle = sel ? palette.info : bar.color ?? palette.fgDisabled
      ctx.fillRect(bx - q, by - q * 0.6, q * 2, q * 1.2)
    }

    // Fixtures: beams first, then dots
    const list: Dot[] = []
    const items = patch.map((entry, i) => ({ entry, def: defs.get(entry.fixtureDefId), pos: fixturePosition(entry, i, patch.length, room) }))
    for (const { entry, def, pos } of items) {
      const spec = describeFixture(entry, def)
      if (!spec.emits || spec.kind === 'moving-head') continue
      const d = aimDirection(entry)
      const hit = rayToRoom(pos, d, room, true)
      const t = hit ? hit.t : room.height
      const sel = selected.has(entry.id)
      let col: string = palette.fgDisabled
      if (!dmx.blackout) {
        const c = getEffectiveColor(resolveChannels(entry, def, dmx.values))
        if (Math.max(c.r, c.g, c.b) > 0.05) col = `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`
      }
      ctx.strokeStyle = sel ? palette.infoFg : col
      ctx.globalAlpha = sel ? 0.9 : 0.35
      ctx.lineWidth = sel ? 1.5 : 1
      ctx.beginPath(); ctx.moveTo(X(pos.z), Y(pos.y)); ctx.lineTo(X(pos.z + d.z * t), Y(pos.y + d.y * t)); ctx.stroke()
      ctx.globalAlpha = 1
    }
    const r = touch ? 6 : 4.5
    for (const { entry, pos } of items) {
      const sel = selected.has(entry.id)
      const x = X(pos.z), y = Y(pos.y)
      ctx.beginPath()
      ctx.arc(x, y, sel ? r + 1.5 : r, 0, Math.PI * 2)
      ctx.fillStyle = sel ? palette.info : palette.surface4
      ctx.fill()
      ctx.strokeStyle = sel ? palette.infoFg : palette.fgTertiary
      ctx.lineWidth = 1
      ctx.stroke()
      if (sel) {
        ctx.font = `600 ${touch ? 12 : 11}px ${MONO}`
        ctx.fillStyle = palette.infoFg
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${pos.y.toFixed(2)} m`, x + r + 6, y)
      }
      list.push({ id: entry.id, x, y })
    }
    dots.current = list
  }, [])

  const requestDraw = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => { raf.current = 0; draw() })
  }, [draw])

  useEffect(() => {
    const unsubs = [
      usePatchStore.subscribe((s) => s.patch, requestDraw),
      usePatchStore.subscribe((s) => s.selectedFixtureIds, requestDraw),
      useVisualizerStore.subscribe((s) => s.roomConfig, requestDraw),
      useVisualizerStore.subscribe((s) => s.selectedTrussId, requestDraw),
      useDmxStore.subscribe(requestDraw)
    ]
    return () => {
      unsubs.forEach((u) => u())
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [requestDraw])

  const pick = (sx: number, sy: number): string | null => {
    const touch = document.documentElement.dataset.density === 'touch'
    const sel = new Set(usePatchStore.getState().selectedFixtureIds)
    let best: { id: string; d: number } | null = null
    for (const d of dots.current) {
      const dist = Math.hypot(sx - d.x, sy - d.y) - (sel.has(d.id) ? 3 : 0)
      if (dist <= (touch ? 20 : 11) && (!best || dist < best.d)) best = { id: d.id, d: dist }
    }
    return best?.id ?? null
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const p = local(e)
    const id = pick(p.x, p.y)
    if (!id) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const store = usePatchStore.getState()
    const idx = store.patch.findIndex((x) => x.id === id)
    const pos = fixturePosition(store.patch[idx], idx, store.patch.length, useVisualizerStore.getState().roomConfig)
    drag.current = { id, pointerId: e.pointerId, sy: p.y, y0: pos.y, moved: false, mods: e.ctrlKey || e.metaKey || e.shiftKey }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const p = local(e)
    if (!d.moved && Math.abs(p.y - d.sy) < (e.pointerType === 'mouse' ? 4 : 9)) return
    if (!d.moved) {
      d.moved = true
      const store = usePatchStore.getState()
      if (!store.selectedFixtureIds.includes(d.id)) store.selectFixture(d.id, false)
    }
    const room = useVisualizerStore.getState().roomConfig
    const y = clamp(snap(d.y0 - (p.y - d.sy) / frame.current.s, 0.05), 0, room.height)
    const store = usePatchStore.getState()
    const idx = store.patch.findIndex((x) => x.id === d.id)
    if (idx < 0) return
    const pos = fixturePosition(store.patch[idx], idx, store.patch.length, room)
    store.updateFixture(d.id, { position3D: { x: pos.x, y: cm(y), z: pos.z } })
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (!d.moved && !cancelled) {
      const touch = document.documentElement.dataset.density === 'touch'
      usePatchStore.getState().selectFixture(d.id, d.mods || touch)
    }
  }

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-surface-0 ${className}`}>
      <canvas
        ref={canvasRef}
        aria-label="Section view: drag a fixture up or down to change its height"
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        onLostPointerCapture={(e) => onPointerEnd(e, true)}
      />
    </div>
  )
}
