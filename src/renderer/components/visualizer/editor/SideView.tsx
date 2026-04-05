import React, { useRef, useEffect, useCallback } from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'

const METRE_TO_PX = 30

export function SideView({ className = '' }: { className?: string }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { patch, fixtures } = usePatchStore()
  const { roomConfig, selectedFixtureId, selectFixture } = useVisualizerStore()

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

    ctx.fillStyle = '#060608'
    ctx.fillRect(0, 0, W, H)

    const { width: rw, height: rh } = roomConfig
    // Floor Y in canvas
    const floorY = H - 20
    const originX = W / 2

    // Room box
    ctx.strokeStyle = '#333355'
    ctx.lineWidth = 1
    ctx.strokeRect(originX - rw / 2 * METRE_TO_PX, floorY - rh * METRE_TO_PX,
                   rw * METRE_TO_PX, rh * METRE_TO_PX)

    // Floor line
    ctx.strokeStyle = '#1a1a2a'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W, floorY); ctx.stroke()

    // Height ruler
    for (let m = 0; m <= Math.ceil(rh); m++) {
      const y = floorY - m * METRE_TO_PX
      ctx.strokeStyle = '#1a1a2a'
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(originX - rw / 2 * METRE_TO_PX - 8, y)
      ctx.lineTo(originX - rw / 2 * METRE_TO_PX, y); ctx.stroke()
      ctx.fillStyle = '#444'
      ctx.font = '8px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`${m}m`, originX - rw / 2 * METRE_TO_PX - 10, y + 3)
    }

    // Label
    ctx.fillStyle = '#333'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('SIDE VIEW (X / Height)', 4, 12)

    // Fixtures
    for (const entry of patch) {
      const pos = entry.position3D
      const ex = pos?.x ?? 0
      const ey = pos?.y ?? (roomConfig.height - 0.05)
      const cx = originX + ex * METRE_TO_PX
      const cy = floorY - ey * METRE_TO_PX
      const isSelected = entry.id === selectedFixtureId

      // Beam line (tilted if mounting angle set)
      const tiltAngle = entry.mountingAngle ?? 0
      const tiltRad = tiltAngle * Math.PI / 180
      const beamLen = ey * METRE_TO_PX / Math.max(0.01, Math.cos(tiltRad))
      const beamEndX = cx + Math.sin(tiltRad) * beamLen
      const beamEndY = floorY
      ctx.strokeStyle = isSelected ? '#e85d0460' : '#33335560'
      ctx.lineWidth = isSelected ? 1.5 : 0.5
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(beamEndX, beamEndY); ctx.stroke()

      // Fixture dot
      ctx.beginPath()
      ctx.arc(cx, cy, isSelected ? 5 : 4, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? '#e85d04' : '#2a2a44'
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#e85d04' : '#555577'
      ctx.lineWidth = 1
      ctx.stroke()

      // Height label
      if (isSelected) {
        ctx.fillStyle = '#e85d04'
        ctx.font = '8px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`${ey.toFixed(1)}m`, cx + 6, cy + 3)
      }
    }
  }, [patch, roomConfig, selectedFixtureId])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [draw])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const floorY = rect.height - 20
    const originX = rect.width / 2
    for (const entry of patch) {
      const ex = entry.position3D?.x ?? 0
      const ey = entry.position3D?.y ?? (roomConfig.height - 0.05)
      const cx = originX + ex * METRE_TO_PX
      const cy = floorY - ey * METRE_TO_PX
      if (Math.hypot(mx - cx, e.clientY - rect.top - cy) < 10) {
        selectFixture(entry.id)
        return
      }
    }
    selectFixture(null)
  }, [patch, roomConfig, selectFixture])

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0" onClick={handleClick} style={{ cursor: 'pointer' }} />
    </div>
  )
}
