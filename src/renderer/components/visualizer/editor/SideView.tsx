import React, { useRef, useEffect, useCallback } from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import type { MountingLocation } from '@shared/types'

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
      const mount = entry.mountingLocation ?? 'ceiling'
      const pos = entry.position3D
      const ex = pos?.x ?? 0
      const ey = pos?.y ?? getDefaultY(mount, roomConfig.height)
      const cx = originX + ex * METRE_TO_PX
      const cy = floorY - ey * METRE_TO_PX
      const isSelected = entry.id === selectedFixtureId

      // Beam line direction depends on mounting location
      const tiltAngle = entry.mountingAngle ?? 0
      const tiltRad = tiltAngle * Math.PI / 180
      ctx.strokeStyle = isSelected ? '#e85d0460' : '#33335560'
      ctx.lineWidth = isSelected ? 1.5 : 0.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)

      if (mount === 'floor') {
        // Beam goes UP
        const beamLen = (rh - ey) * METRE_TO_PX / Math.max(0.01, Math.cos(tiltRad))
        const beamEndX = cx + Math.sin(tiltRad) * beamLen
        const beamEndY = floorY - rh * METRE_TO_PX
        ctx.lineTo(beamEndX, beamEndY)
      } else if (mount === 'wall-left') {
        // Beam goes RIGHT (inward)
        const beamLen = (rw / 2 + ex) * METRE_TO_PX
        ctx.lineTo(cx + beamLen, cy + Math.sin(tiltRad) * beamLen)
      } else if (mount === 'wall-right') {
        // Beam goes LEFT (inward)
        const beamLen = (rw / 2 - ex) * METRE_TO_PX
        ctx.lineTo(cx - beamLen, cy + Math.sin(tiltRad) * beamLen)
      } else if (mount === 'wall-back') {
        // Beam goes toward audience (Z-axis, we show as a short stub)
        const stubLen = 18
        ctx.lineTo(cx, cy + stubLen)
        ctx.moveTo(cx - 3, cy + stubLen - 4)
        ctx.lineTo(cx, cy + stubLen)
        ctx.lineTo(cx + 3, cy + stubLen - 4)
      } else {
        // Ceiling: beam goes DOWN (default)
        const beamLen = ey * METRE_TO_PX / Math.max(0.01, Math.cos(tiltRad))
        const beamEndX = cx + Math.sin(tiltRad) * beamLen
        ctx.lineTo(beamEndX, floorY)
      }
      ctx.stroke()

      // Fixture dot — shape indicates mounting
      ctx.beginPath()
      if (mount === 'floor') {
        // Upward triangle for floor
        const r = isSelected ? 5 : 4
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath()
      } else if (mount.startsWith('wall')) {
        // Square for wall
        const r = isSelected ? 5 : 4
        ctx.rect(cx - r, cy - r, r * 2, r * 2)
      } else {
        // Circle for ceiling
        ctx.arc(cx, cy, isSelected ? 5 : 4, 0, Math.PI * 2)
      }
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
      const mount = entry.mountingLocation ?? 'ceiling'
      const ex = entry.position3D?.x ?? 0
      const ey = entry.position3D?.y ?? getDefaultY(mount, roomConfig.height)
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

function getDefaultY(mount: MountingLocation | undefined, roomHeight: number): number {
  switch (mount) {
    case 'floor': return 0.15
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return roomHeight * 0.6
    default: return roomHeight - 0.05
  }
}
