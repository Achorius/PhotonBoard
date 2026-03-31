import React, { useCallback, useRef } from 'react'

interface ColorPickerProps {
  red: number
  green: number
  blue: number
  white?: number
  onChange: (r: number, g: number, b: number, w?: number) => void
}

const PRESET_COLORS = [
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Magenta', r: 255, g: 0, b: 255 },
  { name: 'Yellow', r: 255, g: 255, b: 0 },
  { name: 'Orange', r: 255, g: 128, b: 0 },
  { name: 'Pink', r: 255, g: 105, b: 180 },
  { name: 'Warm', r: 255, g: 180, b: 100 },
  { name: 'Cool', r: 150, g: 200, b: 255 },
  { name: 'White', r: 255, g: 255, b: 255 },
  { name: 'Off', r: 0, g: 0, b: 0 }
]

export function ColorPicker({ red, green, blue, white, onChange }: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDragging = useRef(false)

  const drawWheel = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = canvas.width
    const center = size / 2
    const radius = center - 4

    // Draw color wheel
    for (let angle = 0; angle < 360; angle++) {
      const startAngle = ((angle - 1) * Math.PI) / 180
      const endAngle = ((angle + 1) * Math.PI) / 180
      ctx.beginPath()
      ctx.moveTo(center, center)
      ctx.arc(center, center, radius, startAngle, endAngle)
      ctx.closePath()

      const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius)
      gradient.addColorStop(0, 'white')
      gradient.addColorStop(1, `hsl(${angle}, 100%, 50%)`)
      ctx.fillStyle = gradient
      ctx.fill()
    }

    // Draw current color indicator
    const hue = rgbToHue(red, green, blue)
    const sat = rgbToSaturation(red, green, blue)
    const indicatorAngle = (hue * Math.PI) / 180
    const indicatorRadius = (sat / 100) * radius
    const ix = center + Math.cos(indicatorAngle) * indicatorRadius
    const iy = center + Math.sin(indicatorAngle) * indicatorRadius

    ctx.beginPath()
    ctx.arc(ix, iy, 6, 0, Math.PI * 2)
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(ix, iy, 4, 0, Math.PI * 2)
    ctx.fillStyle = `rgb(${red},${green},${blue})`
    ctx.fill()
  }, [red, green, blue])

  const handleCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      canvasRef.current = canvas
      drawWheel(canvas)
    }
  }, [drawWheel])

  const pickColor = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const scale = canvas.width / rect.width
    const sx = x * scale
    const sy = y * scale

    const center = canvas.width / 2
    const dx = sx - center
    const dy = sy - center
    const dist = Math.sqrt(dx * dx + dy * dy)
    const radius = center - 4

    if (dist > radius) return

    let angle = (Math.atan2(dy, dx) * 180) / Math.PI
    if (angle < 0) angle += 360
    const saturation = Math.min(100, (dist / radius) * 100)

    const [r, g, b] = hslToRgb(angle, saturation, 50)
    onChange(r, g, b, white)
  }, [onChange, white])

  return (
    <div className="flex flex-col gap-3">
      {/* Color wheel */}
      <canvas
        ref={handleCanvasRef}
        width={180}
        height={180}
        className="cursor-crosshair rounded-full"
        style={{ width: 180, height: 180 }}
        onPointerDown={(e) => { isDragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); pickColor(e) }}
        onPointerMove={(e) => { if (isDragging.current) pickColor(e) }}
        onPointerUp={() => { isDragging.current = false }}
      />

      {/* Current color preview */}
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded border border-surface-4"
          style={{ backgroundColor: `rgb(${red},${green},${blue})` }}
        />
        <div className="text-xs font-mono text-gray-400">
          R:{red} G:{green} B:{blue}{white !== undefined ? ` W:${white}` : ''}
        </div>
      </div>

      {/* RGB sliders */}
      <div className="space-y-1">
        {[
          { label: 'R', value: red, color: '#ff3333', set: (v: number) => onChange(v, green, blue, white) },
          { label: 'G', value: green, color: '#33ff33', set: (v: number) => onChange(red, v, blue, white) },
          { label: 'B', value: blue, color: '#3388ff', set: (v: number) => onChange(red, green, v, white) },
          ...(white !== undefined ? [{ label: 'W', value: white, color: '#ffffff', set: (v: number) => onChange(red, green, blue, v) }] : [])
        ].map(({ label, value, color, set }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] font-mono w-3" style={{ color }}>{label}</span>
            <input
              type="range"
              min={0}
              max={255}
              value={value}
              onChange={(e) => set(parseInt(e.target.value))}
              className="flex-1 h-2"
              style={{ accentColor: color }}
            />
            <span className="text-[10px] font-mono w-7 text-right text-gray-400">{value}</span>
          </div>
        ))}
      </div>

      {/* Preset colors */}
      <div className="grid grid-cols-6 gap-1">
        {PRESET_COLORS.map(({ name, r, g, b }) => (
          <button
            key={name}
            className="w-6 h-6 rounded border border-surface-4 hover:border-gray-400 transition-colors"
            style={{ backgroundColor: `rgb(${r},${g},${b})` }}
            onClick={() => onChange(r, g, b, white)}
            title={name}
          />
        ))}
      </div>
    </div>
  )
}

function rgbToHue(r: number, g: number, b: number): number {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0
  if (max !== min) {
    const d = max - min
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return h
}

function rgbToSaturation(r: number, g: number, b: number): number {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === 0) return 0
  return ((max - min) / max) * 100
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
