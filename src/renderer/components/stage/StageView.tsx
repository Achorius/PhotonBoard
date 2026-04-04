import React, { useRef, useEffect, useCallback } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { getFixtureDisplayColor } from '../../lib/dmx-utils'

export function StageView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { patch, fixtures, selectedFixtureIds, selectFixture, getFixtureChannels } = usePatchStore()
  const { values } = useDmxStore()

  const drawStage = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)

    const w = rect.width
    const h = rect.height

    // Background
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, w, h)

    // Stage outline
    const margin = 40
    const stageW = w - margin * 2
    const stageH = h - margin * 2
    ctx.strokeStyle = '#222230'
    ctx.lineWidth = 1
    ctx.strokeRect(margin, margin, stageW, stageH)

    // Stage label
    ctx.fillStyle = '#333'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('STAGE', w / 2, h - margin / 2 + 4)
    ctx.fillText('AUDIENCE', w / 2, margin / 2 + 4)

    // Draw grid
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 0.5
    for (let x = margin; x <= w - margin; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, margin)
      ctx.lineTo(x, h - margin)
      ctx.stroke()
    }
    for (let y = margin; y <= h - margin; y += 40) {
      ctx.beginPath()
      ctx.moveTo(margin, y)
      ctx.lineTo(w - margin, y)
      ctx.stroke()
    }

    // Draw fixtures
    if (patch.length === 0) {
      ctx.fillStyle = '#444'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Patch some fixtures to see them here', w / 2, h / 2)
      return
    }

    // Auto-layout: distribute fixtures evenly
    const cols = Math.ceil(Math.sqrt(patch.length * 1.5))
    const rows = Math.ceil(patch.length / cols)
    const cellW = stageW / (cols + 1)
    const cellH = stageH / (rows + 1)

    patch.forEach((entry, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = margin + cellW * (col + 1)
      const cy = margin + cellH * (row + 1)

      // Get fixture color from DMX values
      const channels = getFixtureChannels(entry)
      const channelValues: Record<string, number> = {}
      for (const ch of channels) {
        channelValues[ch.name] = values[entry.universe][ch.absoluteChannel] || 0
      }
      const color = getFixtureDisplayColor(channelValues)
      const isSelected = selectedFixtureIds.includes(entry.id)
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      const isMovingHead = def?.categories.includes('Moving Head')

      // Beam glow
      const dimmer = channelValues['Dimmer'] ?? channelValues['Intensity'] ?? 0
      if (dimmer > 0) {
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30)
        gradient.addColorStop(0, color + '88')
        gradient.addColorStop(1, color + '00')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(cx, cy, 30, 0, Math.PI * 2)
        ctx.fill()
      }

      // Fixture body
      if (isMovingHead) {
        // Moving head: triangle shape
        ctx.fillStyle = dimmer > 0 ? color : '#333'
        ctx.beginPath()
        ctx.moveTo(cx, cy - 10)
        ctx.lineTo(cx - 8, cy + 8)
        ctx.lineTo(cx + 8, cy + 8)
        ctx.closePath()
        ctx.fill()
      } else {
        // Par/wash: circle
        ctx.fillStyle = dimmer > 0 ? color : '#333'
        ctx.beginPath()
        ctx.arc(cx, cy, 8, 0, Math.PI * 2)
        ctx.fill()
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = '#e85d04'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cx, cy, 14, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Label
      ctx.fillStyle = isSelected ? '#e85d04' : '#666'
      ctx.font = '8px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(entry.name, cx, cy + 22)
    })
  }, [patch, fixtures, selectedFixtureIds, values])

  // Redraw on state changes
  useEffect(() => {
    drawStage()
    const interval = setInterval(drawStage, 100) // Refresh at 10fps for live updates
    return () => clearInterval(interval)
  }, [drawStage])

  // Handle resize
  useEffect(() => {
    const observer = new ResizeObserver(drawStage)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [drawStage])

  // Handle click on fixture
  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const margin = 40
    const stageW = rect.width - margin * 2
    const stageH = rect.height - margin * 2
    const cols = Math.ceil(Math.sqrt(patch.length * 1.5))
    const rows = Math.ceil(patch.length / cols)
    const cellW = stageW / (cols + 1)
    const cellH = stageH / (rows + 1)

    for (let i = 0; i < patch.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = margin + cellW * (col + 1)
      const cy = margin + cellH * (row + 1)

      if (Math.abs(x - cx) < 15 && Math.abs(y - cy) < 15) {
        selectFixture(patch[i].id, e.metaKey || e.ctrlKey || e.shiftKey)
        return
      }
    }
  }, [patch, selectFixture])

  return (
    <div ref={containerRef} className="w-full h-full" onClick={handleClick}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
