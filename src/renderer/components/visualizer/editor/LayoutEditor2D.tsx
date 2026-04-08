import React, { useRef, useEffect, useCallback, useState } from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { getFixtureDisplayColor } from '@renderer/lib/dmx-utils'
import { resolveChannels, getEffectiveColor } from '@renderer/lib/dmx-channel-resolver'
import type { PatchEntry, MountingLocation } from '@shared/types'

const METRE_TO_PX = 40  // 40px per metre at default zoom
const TRUSS_HIT_TOLERANCE = 8  // px tolerance for clicking on a truss line
const STAGE_EDGE_HIT_TOLERANCE = 8  // px tolerance for stage edge line

export function LayoutEditor2D() {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const containerRef= useRef<HTMLDivElement>(null)
  const draggingRef = useRef<{ id: string; offsetX: number; offsetZ: number; type: 'fixture' | 'truss' | 'stage-edge' } | null>(null)

  const { patch, fixtures, updateFixture } = usePatchStore()
  const {
    roomConfig, setRoomConfig, selectedFixtureId, selectFixture,
    selectedTrussId, selectTruss,
    addTrussBar, removeTrussBar, updateTrussBar,
    gridSize, snapToGrid
  } = useVisualizerStore()
  const { values } = useDmxStore()

  const [trussNameInput, setTrussNameInput] = useState('')
  const selectedTruss = roomConfig.trussBars.find(t => t.id === selectedTrussId)

  // Sync name input when selection changes
  useEffect(() => {
    if (selectedTruss) setTrussNameInput(selectedTruss.name)
  }, [selectedTrussId])

  const worldToCanvas = useCallback((wx: number, wz: number, W: number, H: number) => {
    const cx = W / 2 + wx * METRE_TO_PX
    const cy = H / 2 - wz * METRE_TO_PX  // +Z (upstage) → top of screen
    return { cx, cy }
  }, [])

  const canvasToWorld = useCallback((cx: number, cy: number) => {
    const container = containerRef.current
    if (!container) return { wx: 0, wz: 0 }
    const W = container.clientWidth, H = container.clientHeight
    let wx = (cx - W / 2) / METRE_TO_PX
    let wz = -(cy - H / 2) / METRE_TO_PX  // flip Z for stage-top orientation
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

    // Stage edge line (draggable)
    const stageEdgeZ = roomConfig.stageEdgeZ ?? 0
    const { cy: edgeCy } = worldToCanvas(0, stageEdgeZ, W, H)
    const isEdgeSelected = draggingRef.current?.type === 'stage-edge'
    ctx.strokeStyle = isEdgeSelected ? '#e85d04' : '#e85d0466'
    ctx.lineWidth = isEdgeSelected ? 2.5 : 1.5
    ctx.setLineDash([5, 5])
    ctx.beginPath(); ctx.moveTo(0, edgeCy); ctx.lineTo(W, edgeCy); ctx.stroke()
    ctx.setLineDash([])

    // Labels
    ctx.fillStyle = isEdgeSelected ? '#e85d04' : '#333'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('UPSTAGE', W / 2, edgeCy - 8)
    ctx.fillText('AUDIENCE', W / 2, edgeCy + 16)

    // Truss bars (drawn before fixtures so fixtures appear on top)
    for (const bar of roomConfig.trussBars) {
      const barHalfW = (bar.width ?? rw) / 2
      const leftPt = worldToCanvas(-barHalfW, bar.z, W, H)
      const rightPt = worldToCanvas(barHalfW, bar.z, W, H)
      const isSelectedTruss = bar.id === selectedTrussId

      ctx.strokeStyle = isSelectedTruss ? '#e85d04' : (bar.color ?? '#555577')
      ctx.lineWidth = isSelectedTruss ? 2.5 : 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(leftPt.cx, leftPt.cy)
      ctx.lineTo(rightPt.cx, rightPt.cy)
      ctx.stroke()
      ctx.setLineDash([])

      // Bar name label
      ctx.fillStyle = isSelectedTruss ? '#e85d04' : '#888'
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(bar.name, leftPt.cx + 4, leftPt.cy - 5)
    }

    // Fixtures (top-down, X=left-right, Z=front-back)
    for (const entry of patch) {
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      const pos = entry.position3D
      const wx = pos?.x ?? getAutoX(entry, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(entry, patch, roomConfig)
      const { cx: cxs, cy: cys } = worldToCanvas(wx, wz, W, H)
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

      // Fixture symbol — shape varies by mounting location
      const mount = entry.mountingLocation ?? 'ceiling'
      ctx.beginPath()
      if (isMovingHead) {
        // Diamond
        const r = 7
        ctx.moveTo(cxs, cys - r); ctx.lineTo(cxs + r, cys)
        ctx.lineTo(cxs, cys + r); ctx.lineTo(cxs - r, cys)
        ctx.closePath()
      } else if (mount === 'floor') {
        // Upward triangle for floor-mounted
        const r = 7
        ctx.moveTo(cxs, cys - r); ctx.lineTo(cxs + r, cys + r); ctx.lineTo(cxs - r, cys + r)
        ctx.closePath()
      } else if (mount.startsWith('wall')) {
        // Square for wall-mounted
        const r = 6
        ctx.rect(cxs - r, cys - r, r * 2, r * 2)
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

      // Mounting indicator for non-ceiling fixtures
      if (mount !== 'ceiling') {
        const mountLabel = mount === 'floor' ? 'FLR' : mount === 'wall-left' ? 'W-L' : mount === 'wall-right' ? 'W-R' : 'W-B'
        ctx.fillStyle = isSelected ? '#e85d0488' : '#55557788'
        ctx.font = '7px sans-serif'
        ctx.fillText(mountLabel, cxs, cys + 25)
      }

      // Name label
      ctx.fillStyle = isSelected ? '#fff' : '#888'
      ctx.font = '8px sans-serif'
      ctx.fillText(entry.name.length > 10 ? entry.name.slice(0, 9) + '…' : entry.name, cxs, cys - 11)
    }
  }, [patch, fixtures, roomConfig, selectedFixtureId, selectedTrussId, values, worldToCanvas, gridSize, snapToGrid])

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

  const hitTestFixture = (mx: number, my: number): PatchEntry | null => {
    const canvas = canvasRef.current!
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const entry of patch) {
      const pos = entry.position3D
      const wx = pos?.x ?? getAutoX(entry, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(entry, patch, roomConfig)
      const cx = W / 2 + wx * METRE_TO_PX
      const cy = H / 2 - wz * METRE_TO_PX  // flipped Z
      if (Math.hypot(mx - cx, my - cy) < 12) return entry
    }
    return null
  }

  const hitTestTruss = (mx: number, my: number): string | null => {
    const canvas = canvasRef.current!
    const W = canvas.clientWidth, H = canvas.clientHeight
    const { width: rw } = roomConfig
    for (const bar of roomConfig.trussBars) {
      const barHalfW = (bar.width ?? rw) / 2
      const leftPt = worldToCanvas(-barHalfW, bar.z, W, H)
      const rightPt = worldToCanvas(barHalfW, bar.z, W, H)
      // Check if click is near the horizontal truss line (within tolerance in Y, within X span)
      if (mx >= leftPt.cx - 4 && mx <= rightPt.cx + 4 &&
          Math.abs(my - leftPt.cy) < TRUSS_HIT_TOLERANCE) {
        return bar.id
      }
    }
    return null
  }

  const hitTestStageEdge = (my: number): boolean => {
    const canvas = canvasRef.current!
    const W = canvas.clientWidth, H = canvas.clientHeight
    const stageEdgeZ = roomConfig.stageEdgeZ ?? 0
    const { cy: edgeCy } = worldToCanvas(0, stageEdgeZ, W, H)
    return Math.abs(my - edgeCy) < STAGE_EDGE_HIT_TOLERANCE
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const { x, y } = getCanvasPos(e as any)

    // Fixtures take priority
    const hitFixture = hitTestFixture(x, y)
    if (hitFixture) {
      selectFixture(hitFixture.id)
      const pos = hitFixture.position3D
      const canvas = canvasRef.current!
      const W = canvas.clientWidth, H = canvas.clientHeight
      const wx = pos?.x ?? getAutoX(hitFixture, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(hitFixture, patch, roomConfig)
      const cx = W / 2 + wx * METRE_TO_PX
      const cy = H / 2 - wz * METRE_TO_PX  // flipped Z
      draggingRef.current = { id: hitFixture.id, offsetX: cx - x, offsetZ: cy - y, type: 'fixture' }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    // Check truss hit
    const hitTrussId = hitTestTruss(x, y)
    if (hitTrussId) {
      selectTruss(hitTrussId)
      const bar = roomConfig.trussBars.find(t => t.id === hitTrussId)!
      const canvas = canvasRef.current!
      const W = canvas.clientWidth, H = canvas.clientHeight
      const { cy: trussCy } = worldToCanvas(0, bar.z, W, H)
      draggingRef.current = { id: hitTrussId, offsetX: 0, offsetZ: trussCy - y, type: 'truss' }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    // Check stage edge hit
    if (hitTestStageEdge(y)) {
      const canvas = canvasRef.current!
      const W = canvas.clientWidth, H = canvas.clientHeight
      const stageEdgeZ = roomConfig.stageEdgeZ ?? 0
      const { cy: edgeCy } = worldToCanvas(0, stageEdgeZ, W, H)
      draggingRef.current = { id: 'stage-edge', offsetX: 0, offsetZ: edgeCy - y, type: 'stage-edge' }
      selectFixture(null)
      selectTruss(null)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    selectFixture(null)
    selectTruss(null)
  }, [patch, roomConfig, selectFixture, selectTruss, worldToCanvas])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const { x, y } = getCanvasPos(e as any)

    if (draggingRef.current.type === 'stage-edge') {
      // Move stage edge along Z axis
      const { wz } = canvasToWorld(0, y + draggingRef.current.offsetZ)
      setRoomConfig({ stageEdgeZ: wz })
      return
    }

    if (draggingRef.current.type === 'truss') {
      // Only move along Z axis
      const { wz } = canvasToWorld(0, y + draggingRef.current.offsetZ)
      updateTrussBar(draggingRef.current.id, { z: wz })
      return
    }

    const { wx, wz } = canvasToWorld(
      x + draggingRef.current.offsetX,
      y + draggingRef.current.offsetZ
    )
    const entry = patch.find(p => p.id === draggingRef.current!.id)
    const mount = entry?.mountingLocation ?? 'ceiling'
    const curY = entry?.position3D?.y ?? getDefaultY(mount, roomConfig.height)
    updateFixture(draggingRef.current.id, { position3D: { x: wx, y: curY, z: wz } })
  }, [patch, roomConfig, canvasToWorld, updateFixture, updateTrussBar, setRoomConfig])

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Truss toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d0d15] border-b border-[#1a1a2e] shrink-0 text-xs">
        <button
          onClick={addTrussBar}
          className="px-2 py-1 rounded bg-[#1a1a2e] hover:bg-[#252540] text-[#aaa] hover:text-white transition-colors"
        >
          + Add Bar
        </button>
        {selectedTruss && (
          <>
            <input
              type="text"
              value={trussNameInput}
              onChange={(e) => {
                setTrussNameInput(e.target.value)
                updateTrussBar(selectedTruss.id, { name: e.target.value })
              }}
              className="px-2 py-1 rounded bg-[#111118] border border-[#333355] text-[#ccc] w-28 text-xs"
              placeholder="Bar name"
            />
            <span className="text-[#666]">Z: {selectedTruss.z.toFixed(2)}m</span>
            <button
              onClick={() => removeTrussBar(selectedTruss.id)}
              className="px-2 py-1 rounded bg-[#2a1515] hover:bg-[#3a2020] text-[#e85d04] hover:text-[#ff7733] transition-colors ml-auto"
            >
              Delete Bar
            </button>
          </>
        )}
      </div>
      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ cursor: 'crosshair' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
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

function getDefaultY(mount: MountingLocation | undefined, roomHeight: number): number {
  switch (mount) {
    case 'floor': return 0.15
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return roomHeight * 0.6
    default: return roomHeight - 0.05
  }
}
