import React, { useRef, useEffect, useCallback, useState } from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { getFixtureDisplayColor } from '@renderer/lib/dmx-utils'
import { resolveChannels, getEffectiveColor } from '@renderer/lib/dmx-channel-resolver'
import type { PatchEntry, MountingLocation } from '@shared/types'

const BASE_SCALE = 40   // 40px per metre at zoom=1
const TRUSS_HIT_TOLERANCE = 8
const STAGE_EDGE_HIT_TOLERANCE = 8
const MIN_ZOOM = 0.15
const MAX_ZOOM = 8
const FIT_PADDING = 60  // px padding when auto-fitting

export function LayoutEditor2D() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef  = useRef<{ id: string; offsetX: number; offsetZ: number; type: 'fixture' | 'truss' | 'stage-edge' } | null>(null)
  const panningRef   = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number; pointerId: number } | null>(null)
  const viewRef      = useRef({ panX: 0, panY: 0, zoom: 1 })
  const didFitRef    = useRef(false)
  const drawRef      = useRef<() => void>(() => {})

  const { patch, fixtures, updateFixture } = usePatchStore()
  const {
    roomConfig, setRoomConfig, selectedFixtureId, selectFixture,
    selectedTrussId, selectTruss,
    addTrussBar, removeTrussBar, updateTrussBar,
    gridSize, snapToGrid
  } = useVisualizerStore()
  // Read DMX values imperatively inside draw() to avoid re-creating draw/event handlers
  // at 60Hz when effects are running (which would break zoom/pan interaction).

  const [trussNameInput, setTrussNameInput] = useState('')
  const selectedTruss = roomConfig.trussBars.find(t => t.id === selectedTrussId)

  useEffect(() => {
    if (selectedTruss) setTrussNameInput(selectedTruss.name)
  }, [selectedTrussId])

  // ── Coordinate helpers ─────────────────────────────────────────────
  const getScale = useCallback(() => BASE_SCALE * viewRef.current.zoom, [])

  const worldToCanvas = useCallback((wx: number, wz: number, W: number, H: number) => {
    const scale = BASE_SCALE * viewRef.current.zoom
    const { panX, panY } = viewRef.current
    const cx = W / 2 + wx * scale + panX
    const cy = H / 2 - wz * scale + panY
    return { cx, cy }
  }, [])

  const canvasToWorld = useCallback((cx: number, cy: number) => {
    const container = containerRef.current
    if (!container) return { wx: 0, wz: 0 }
    const W = container.clientWidth, H = container.clientHeight
    const scale = BASE_SCALE * viewRef.current.zoom
    const { panX, panY } = viewRef.current
    let wx = (cx - W / 2 - panX) / scale
    let wz = -(cy - H / 2 - panY) / scale
    if (snapToGrid) {
      wx = Math.round(wx / gridSize) * gridSize
      wz = Math.round(wz / gridSize) * gridSize
    }
    return { wx, wz }
  }, [snapToGrid, gridSize])

  // ── Auto-fit room to canvas ────────────────────────────────────────
  const fitToView = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const W = container.clientWidth
    const H = container.clientHeight
    if (W === 0 || H === 0) return
    const { width: rw, depth: rd } = roomConfig
    const scaleX = (W - FIT_PADDING * 2) / rw
    const scaleY = (H - FIT_PADDING * 2) / rd
    const fitScale = Math.min(scaleX, scaleY)
    viewRef.current = { panX: 0, panY: 0, zoom: Math.max(MIN_ZOOM, fitScale / BASE_SCALE) }
  }, [roomConfig])

  // ── Draw ───────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    const W = container.clientWidth
    const H = container.clientHeight
    canvas.width  = W * dpr
    canvas.height = H * dpr

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const scale = BASE_SCALE * viewRef.current.zoom

    // Background
    ctx.fillStyle = '#07070d'
    ctx.fillRect(0, 0, W, H)

    // Grid — scaled & panned
    ctx.strokeStyle = '#111118'
    ctx.lineWidth = 0.5
    const gridPx = gridSize * scale
    if (gridPx > 4) { // only draw grid when it wouldn't be too dense
      const { panX, panY } = viewRef.current
      const offX = ((W / 2 + panX) % gridPx + gridPx) % gridPx
      const offZ = ((H / 2 + panY) % gridPx + gridPx) % gridPx
      for (let x = offX; x < W; x += gridPx) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
      for (let z = offZ; z < H; z += gridPx) { ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(W, z); ctx.stroke() }
    }

    // Room outline
    const { width: rw, depth: rd } = roomConfig
    const topLeft = worldToCanvas(-rw / 2, rd / 2, W, H)
    const roomW = rw * scale
    const roomH = rd * scale
    ctx.strokeStyle = '#333355'
    ctx.lineWidth = 1.5
    ctx.strokeRect(topLeft.cx, topLeft.cy, roomW, roomH)

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
    ctx.fillText('UPSTAGE', W / 2 + viewRef.current.panX, edgeCy - 8)
    ctx.fillText('AUDIENCE', W / 2 + viewRef.current.panX, edgeCy + 16)

    // Truss bars
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

      ctx.fillStyle = isSelectedTruss ? '#e85d04' : '#888'
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(bar.name, leftPt.cx + 4, leftPt.cy - 5)
    }

    // Fixtures
    for (const entry of patch) {
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      const pos = entry.position3D
      const wx = pos?.x ?? getAutoX(entry, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(entry, patch, roomConfig)
      const { cx: cxs, cy: cys } = worldToCanvas(wx, wz, W, H)
      const isMovingHead = def?.categories.includes('Moving Head')
      const isSelected = entry.id === selectedFixtureId

      // Skip fixtures completely off-screen (perf)
      if (cxs < -40 || cxs > W + 40 || cys < -40 || cys > H + 40) continue

      // Beam glow — read DMX state imperatively (not via React state) to avoid
      // re-creating draw() at 60Hz when effects run, which would break zoom/pan
      const dmxState = useDmxStore.getState()
      const ch = resolveChannels(entry, def, dmxState.values)
      const col = dmxState.blinder
        ? { r: 1, g: 1, b: 1 }
        : (dmxState.strobe && !dmxState._strobePhase)
          ? { r: 0, g: 0, b: 0 }
          : getEffectiveColor(ch)
      const dim = (col.r + col.g + col.b) / 3
      const glowAlpha = dmxState.blinder ? 0.8 : 0.4
      const glowRadius = dmxState.blinder ? 30 : 20
      if (dim > 0.02 && isFinite(cxs) && isFinite(cys)) {
        const grad = ctx.createRadialGradient(cxs, cys, 0, cxs, cys, glowRadius)
        const hex = `rgba(${Math.round(col.r*255)},${Math.round(col.g*255)},${Math.round(col.b*255)}`
        grad.addColorStop(0, `${hex},${glowAlpha})`)
        grad.addColorStop(1, `${hex},0)`)
        ctx.fillStyle = grad
        ctx.beginPath(); ctx.arc(cxs, cys, glowRadius, 0, Math.PI * 2); ctx.fill()
      }

      // Fixture symbol
      const mount = entry.mountingLocation ?? 'ceiling'
      ctx.beginPath()
      if (isMovingHead) {
        const r = 7
        ctx.moveTo(cxs, cys - r); ctx.lineTo(cxs + r, cys)
        ctx.lineTo(cxs, cys + r); ctx.lineTo(cxs - r, cys)
        ctx.closePath()
      } else if (mount === 'floor') {
        const r = 7
        ctx.moveTo(cxs, cys - r); ctx.lineTo(cxs + r, cys + r); ctx.lineTo(cxs - r, cys + r)
        ctx.closePath()
      } else if (mount.startsWith('wall')) {
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

    // Zoom indicator
    const zoomPct = Math.round(viewRef.current.zoom * 100)
    ctx.fillStyle = '#444'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`${zoomPct}%`, W - 8, H - 8)
  }, [patch, fixtures, roomConfig, selectedFixtureId, selectedTrussId, worldToCanvas, gridSize, snapToGrid])

  // Keep drawRef in sync so stable effects can call the latest draw without re-subscribing
  drawRef.current = draw

  // ── Initial fit + redraw on changes ────────────────────────────────
  useEffect(() => {
    if (!didFitRef.current && containerRef.current) {
      const W = containerRef.current.clientWidth
      if (W > 0) {
        fitToView()
        didFitRef.current = true
      }
    }
    draw()
  }, [draw, fitToView])

  // Subscribe to DMX store for beam glow updates — uses RAF to throttle redraws
  // without re-creating draw/event handlers (which would break zoom/pan during effects)
  useEffect(() => {
    let rafId = 0
    const unsub = useDmxStore.subscribe(() => {
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0
          drawRef.current()
        })
      }
    })
    return () => { unsub(); if (rafId) cancelAnimationFrame(rafId) }
  }, [])

  // Re-fit when room dimensions change
  useEffect(() => {
    fitToView()
    drawRef.current()
  }, [roomConfig.width, roomConfig.depth, fitToView])

  // ResizeObserver — re-fit on container resize (stable: no dependency on draw)
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      fitToView()
      drawRef.current()
    })
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [fitToView])

  // ── Wheel → zoom toward cursor (stable: uses drawRef, never re-registers) ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const container = containerRef.current!
      const W = container.clientWidth, H = container.clientHeight

      const oldScale = BASE_SCALE * viewRef.current.zoom
      // deltaY > 0 = scroll down = zoom out, deltaY < 0 = scroll up = zoom in
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewRef.current.zoom * zoomFactor))
      const newScale = BASE_SCALE * newZoom

      // Keep point under cursor fixed
      const { panX, panY } = viewRef.current
      const worldX = (mx - W / 2 - panX) / oldScale
      const worldZ = -(my - H / 2 - panY) / oldScale
      viewRef.current.zoom = newZoom
      viewRef.current.panX = mx - W / 2 - worldX * newScale
      viewRef.current.panY = my - H / 2 + worldZ * newScale

      drawRef.current()
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [])

  // ── Interaction helpers ────────────────────────────────────────────
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
      const { cx, cy } = worldToCanvas(wx, wz, W, H)
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

  // ── Pointer events ─────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const { x, y } = getCanvasPos(e as any)

    // Middle-click or shift+left → start panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      panningRef.current = {
        startX: e.clientX, startY: e.clientY,
        startPanX: viewRef.current.panX, startPanY: viewRef.current.panY,
        pointerId: e.pointerId
      }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }

    // Left click — fixture / truss / stage-edge interaction
    if (e.button !== 0) return

    const hitFixture = hitTestFixture(x, y)
    if (hitFixture) {
      selectFixture(hitFixture.id)
      const pos = hitFixture.position3D
      const canvas = canvasRef.current!
      const W = canvas.clientWidth, H = canvas.clientHeight
      const wx = pos?.x ?? getAutoX(hitFixture, patch, roomConfig)
      const wz = pos?.z ?? getAutoZ(hitFixture, patch, roomConfig)
      const { cx, cy } = worldToCanvas(wx, wz, W, H)
      draggingRef.current = { id: hitFixture.id, offsetX: cx - x, offsetZ: cy - y, type: 'fixture' }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

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
    // Panning
    if (panningRef.current) {
      const dx = e.clientX - panningRef.current.startX
      const dy = e.clientY - panningRef.current.startY
      viewRef.current.panX = panningRef.current.startPanX + dx
      viewRef.current.panY = panningRef.current.startPanY + dy
      drawRef.current()
      return
    }

    // Dragging fixture / truss / stage-edge
    if (!draggingRef.current) return
    const { x, y } = getCanvasPos(e as any)

    if (draggingRef.current.type === 'stage-edge') {
      const { wz } = canvasToWorld(0, y + draggingRef.current.offsetZ)
      setRoomConfig({ stageEdgeZ: wz })
      return
    }

    if (draggingRef.current.type === 'truss') {
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

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    panningRef.current = null
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
        <button
          onClick={() => { fitToView(); draw() }}
          className="px-2 py-1 rounded bg-[#1a1a2e] hover:bg-[#252540] text-[#aaa] hover:text-white transition-colors"
          title="Fit room to view (reset zoom & pan)"
        >
          Fit
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
      <div ref={containerRef} className="flex-1 relative overflow-hidden min-h-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: panningRef.current ? 'grabbing' : 'crosshair' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
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
