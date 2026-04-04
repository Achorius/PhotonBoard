import React, { useRef, useEffect, useCallback } from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { getFixtureDisplayColor } from '@renderer/lib/dmx-utils'
import { resolveChannels, getEffectiveColor } from '@renderer/lib/dmx-channel-resolver'
import type { PatchEntry } from '@shared/types'

const METRE_TO_PX = 40  // 40px per metre at default zoom

export function LayoutEditor2D() {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const containerRef= useRef<HTMLDivElement>(null)
  const draggingRef = useRef<{ id: string; offsetX: number; offsetZ: number } | null>(null)

  const { patch, fixtures, updateFixture } = usePatchStore()
  const { roomConfig, selectedFixtureId, selectFixture, gridSize, snapToGrid } = useVisualizerStore()
  const { values } = useDmxStore()

  const worldToCanvas = useCallback((wx: number, wz: number, canvas: HTMLCanvasElement) => {
    const cx = canvas.width  / 2 + wx * METRE_TO_PX
    const cy = canvas.height / 2 + wz * METRE_TO_PX
    return { cx, cy }
  }, [])

  const canvasToWorld = useCallback((cx: number, cy: number, canvas: HTMLCanvasElement) => {
    let wx = (cx - canvas.clientWidth  / 2) / METRE_TO_PX
    let wz = (cy - canvas.clientHeight / 2) / METRE_TO_PX
    if (snapToGrid) {
      wx = Math.round(wx / gridSize) * gridSize
      wz = Math.round(wz / gridSize) * gridSize
    }
    return { wx, wz }
  }, [snapToGrid, gridSize])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = container.clientWidth  * dpr
    canvas.height = container.clientHeight * dpr
    canvas.style.width  = container.clientWidth  + 'px'
    canvas.style.height = container.clientHeight + 'px'

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const W = container.clientWidth
    const H = container.clientHeight

    // Background
    ctx.fillStyle = '#07070d'
    ctx.fillRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#111118'
    ctx.lineWidth = 0.5
    const gridPx = gridSize * METRE_TO_PX
    const offX = (W / 2) % gridPx
    const offZ = (H / 2) % gridPx
    for (let x = offX; x < W; x += gridPx) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let z = offZ; z < H; z += gridPx) { ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(W, z); ctx.stroke() }

    // Room outline
    const { width: rw, depth: rd } = roomConfig
    ctx.strokeStyle = '#333355'
    ctx.lineWidth = 1.5
    ctx.strokeRect(W / 2 - rw / 2 * METRE_TO_PX, H / 2 - rd / 2 * METRE_TO_PX,
                   rw * METRE_TO_PX, rd * METRE_TO_PX)

    // Stage edge (Z = 0 line)
    ctx.strokeStyle = '#e85d0466'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 5])
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
    ctx.setLineDash([])

    // Labels
    ctx.fillStyle = '#333'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('← AUDIENCE', W / 2, H / 2 - 8)
    ctx.fillText('UPSTAGE →', W / 2, H / 2 + 16)

    // Fixtures (top-down, X=left-right, Z=front-back)
    for (const entry of patch) {
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      const pos = entry.position3D
      const wx = pos?.x ?? getAutoX(entry, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(entry, patch, roomConfig)
      const { cx, cy } = worldToCanvas(wx, wz, { width: W * dpr, height: H * dpr } as any)
      const cxs = cx / dpr
      const cys = cy / dpr
      const isMovingHead = def?.categories.includes('Moving Head')
      const isSelected = entry.id === selectedFixtureId

      // Beam glow
      const ch = resolveChannels(entry, def, values)
      const col = getEffectiveColor(ch)
      const dim = (col.r + col.g + col.b) / 3
      if (dim > 0.02 && isFinite(cxs) && isFinite(cys)) {
        const grad = ctx.createRadialGradient(cxs, cys, 0, cxs, cys, 20)
        const hex = `rgba(${Math.round(col.r*255)},${Math.round(col.g*255)},${Math.round(col.b*255)}`
        grad.addColorStop(0, `${hex},0.4)`)
        grad.addColorStop(1, `${hex},0)`)
        ctx.fillStyle = grad
        ctx.beginPath(); ctx.arc(cxs, cys, 20, 0, Math.PI * 2); ctx.fill()
      }

      // Fixture symbol
      ctx.beginPath()
      if (isMovingHead) {
        // Diamond
        const r = 7
        ctx.moveTo(cxs, cys - r); ctx.lineTo(cxs + r, cys)
        ctx.lineTo(cxs, cys + r); ctx.lineTo(cxs - r, cys)
        ctx.closePath()
      } else {
        ctx.arc(cxs, cys, 7, 0, Math.PI * 2)
      }

      const fillColor = dim > 0.02
        ? `rgb(${Math.round(col.r*255)},${Math.round(col.g*255)},${Math.round(col.b*255)})`
        : '#1a1a2a'
      ctx.fillStyle = fillColor
      ctx.fill()

      // Selection ring
      ctx.strokeStyle = isSelected ? '#e85d04' : '#444466'
      ctx.lineWidth = isSelected ? 2 : 1
      ctx.stroke()

      // Address label
      ctx.fillStyle = isSelected ? '#e85d04' : '#666'
      ctx.font = '8px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${entry.universe + 1}.${entry.address}`, cxs, cys + 17)

      // Name label
      ctx.fillStyle = isSelected ? '#fff' : '#888'
      ctx.font = '8px sans-serif'
      ctx.fillText(entry.name.length > 10 ? entry.name.slice(0, 9) + '…' : entry.name, cxs, cys - 11)
    }
  }, [patch, fixtures, roomConfig, selectedFixtureId, values, worldToCanvas, gridSize])

  // Redraw on changes
  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [draw])

  const getCanvasPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const hitTest = (mx: number, my: number): PatchEntry | null => {
    const canvas = canvasRef.current!
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const entry of patch) {
      const pos = entry.position3D
      const wx = pos?.x ?? getAutoX(entry, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(entry, patch, roomConfig)
      const cx = W / 2 + wx * METRE_TO_PX
      const cy = H / 2 + wz * METRE_TO_PX
      if (Math.hypot(mx - cx, my - cy) < 12) return entry
    }
    return null
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const { x, y } = getCanvasPos(e as any)
    const hit = hitTest(x, y)
    if (hit) {
      selectFixture(hit.id)
      const pos = hit.position3D
      const canvas = canvasRef.current!
      const W = canvas.clientWidth, H = canvas.clientHeight
      const wx = pos?.x ?? getAutoX(hit, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(hit, patch, roomConfig)
      const cx = W / 2 + wx * METRE_TO_PX
      const cy = H / 2 + wz * METRE_TO_PX
      draggingRef.current = { id: hit.id, offsetX: cx - x, offsetZ: cy - y }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } else {
      selectFixture(null)
    }
  }, [patch, roomConfig, selectFixture])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const { x, y } = getCanvasPos(e as any)
    const canvas = canvasRef.current!
    const { wx, wz } = canvasToWorld(
      x + draggingRef.current.offsetX,
      y + draggingRef.current.offsetZ,
      canvas
    )
    const entry = patch.find(p => p.id === draggingRef.current!.id)
    const curY = entry?.position3D?.y ?? (roomConfig.height - 0.05)
    updateFixture(draggingRef.current.id, { position3D: { x: wx, y: curY, z: wz } })
  }, [patch, roomConfig, canvasToWorld, updateFixture])

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  )
}

function getAutoX(entry: PatchEntry, patch: PatchEntry[], room: { width: number; depth: number; height: number }): number {
  const cols = Math.max(1, Math.ceil(Math.sqrt(patch.length * 1.5)))
  const i = patch.findIndex(p => p.id === entry.id)
  const col = i % cols
  const colCount = Math.min(cols, patch.length)
  return colCount > 1 ? (col / (colCount - 1) - 0.5) * room.width * 0.8 : 0
}

function getAutoZ(entry: PatchEntry, patch: PatchEntry[], room: { width: number; depth: number; height: number }): number {
  const cols = Math.max(1, Math.ceil(Math.sqrt(patch.length * 1.5)))
  const rows = Math.max(1, Math.ceil(patch.length / cols))
  const i = patch.findIndex(p => p.id === entry.id)
  const row = Math.floor(i / cols)
  return rows > 1 ? (row / (rows - 1) - 0.5) * room.depth * 0.6 : 0
}
