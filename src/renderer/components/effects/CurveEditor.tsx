import React, { useRef, useCallback, useEffect, useState } from 'react'
import type { WaveformKeyframe } from '@shared/types'
import { getWaveformValue } from '@renderer/lib/effect-engine'

const POINT_RADIUS = 5
const DEFAULT_KEYFRAMES: WaveformKeyframe[] = [
  { x: 0, y: -1 },
  { x: 0.25, y: 1 },
  { x: 0.5, y: -1 },
  { x: 0.75, y: 1 },
  { x: 1, y: -1 },
]

interface CurveEditorProps {
  keyframes: WaveformKeyframe[] | undefined
  onChange: (keyframes: WaveformKeyframe[]) => void
  color?: string
  width?: number
  height?: number
}

export function CurveEditor({
  keyframes,
  onChange,
  color = '#e85d04',
  width = 320,
  height = 140,
}: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const kfs = keyframes && keyframes.length > 0 ? keyframes : DEFAULT_KEYFRAMES

  // Coordinate transforms
  const toCanvas = useCallback((kf: WaveformKeyframe) => ({
    cx: kf.x * width,
    cy: (1 - (kf.y + 1) / 2) * height, // y: -1=bottom, +1=top
  }), [width, height])

  const fromCanvas = useCallback((cx: number, cy: number): WaveformKeyframe => ({
    x: Math.max(0, Math.min(1, cx / width)),
    y: Math.max(-1, Math.min(1, 1 - (cy / height) * 2)),
  }), [width, height])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(0, 0, width, height)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 0.5
    for (let i = 1; i < 4; i++) {
      const gx = (i / 4) * width
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke()
    }
    for (let i = 1; i < 4; i++) {
      const gy = (i / 4) * height
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke()
    }

    // Center line (y=0)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()

    // Interpolated curve (using the engine's actual interpolation)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    const steps = width
    for (let px = 0; px <= steps; px++) {
      const phase = px / steps
      const val = getWaveformValue('custom', phase, kfs)
      const cy = (1 - (val + 1) / 2) * height
      if (px === 0) ctx.moveTo(px, cy)
      else ctx.lineTo(px, cy)
    }
    ctx.stroke()

    // Keyframe points
    const sorted = [...kfs].sort((a, b) => a.x - b.x)
    for (let i = 0; i < sorted.length; i++) {
      const { cx, cy } = toCanvas(sorted[i])
      ctx.fillStyle = dragIdx === i ? '#fff' : color
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }, [kfs, dragIdx, color, width, height, toCanvas])

  const getCanvasPos = useCallback((e: React.MouseEvent): { cx: number; cy: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
    }
  }, [])

  const findPointAt = useCallback((cx: number, cy: number): number => {
    const sorted = [...kfs].sort((a, b) => a.x - b.x)
    for (let i = 0; i < sorted.length; i++) {
      const p = toCanvas(sorted[i])
      const dx = cx - p.cx
      const dy = cy - p.cy
      if (dx * dx + dy * dy < (POINT_RADIUS + 4) ** 2) return i
    }
    return -1
  }, [kfs, toCanvas])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const { cx, cy } = getCanvasPos(e)
    const sorted = [...kfs].sort((a, b) => a.x - b.x)

    // Double-click: delete point (min 2 points)
    if (e.detail === 2) {
      const idx = findPointAt(cx, cy)
      if (idx >= 0 && sorted.length > 2) {
        const newKfs = sorted.filter((_, i) => i !== idx)
        onChange(newKfs)
        return
      }
    }

    const idx = findPointAt(cx, cy)
    if (idx >= 0) {
      // Start dragging existing point
      setDragIdx(idx)
    } else {
      // Add new point
      const kf = fromCanvas(cx, cy)
      const newKfs = [...sorted, kf].sort((a, b) => a.x - b.x)
      onChange(newKfs)
      // Find new index and start dragging
      const newIdx = newKfs.findIndex(k => k.x === kf.x && k.y === kf.y)
      setDragIdx(newIdx)
    }
  }, [kfs, getCanvasPos, findPointAt, fromCanvas, onChange])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragIdx === null) return
    const { cx, cy } = getCanvasPos(e)
    const kf = fromCanvas(cx, cy)
    const sorted = [...kfs].sort((a, b) => a.x - b.x)

    // Lock first/last point x positions
    if (dragIdx === 0) kf.x = 0
    if (dragIdx === sorted.length - 1) kf.x = 1

    const newKfs = sorted.map((k, i) => i === dragIdx ? kf : k)
    onChange(newKfs.sort((a, b) => a.x - b.x))
  }, [dragIdx, kfs, getCanvasPos, fromCanvas, onChange])

  const handleMouseUp = useCallback(() => {
    setDragIdx(null)
  }, [])

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={{ width, height, cursor: dragIdx !== null ? 'grabbing' : 'crosshair' }}
        className="rounded-lg border border-surface-3"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-gray-600">Click to add points, double-click to remove, drag to edit</span>
        <button
          className="text-[9px] text-gray-500 hover:text-gray-300"
          onClick={() => onChange(DEFAULT_KEYFRAMES)}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
