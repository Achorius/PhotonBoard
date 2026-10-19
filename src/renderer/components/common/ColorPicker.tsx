// ============================================================
// ColorPicker — RGB(W) picker: hue/saturation wheel, brightness,
// per-channel sliders and preset swatches. Values are DMX 0-255.
// Pointer events with capture + cancel handling (ColourWheel, Slider).
// The programmer view composes ColourWheel directly; this is the
// self-contained picker for other views.
// ============================================================

import { memo, useRef } from 'react'
import { Slider, cn } from '../ui'
import { ColourWheel } from '../fixtures/ColourWheel'
import { hsvToRgb, rgbToHsv } from '../fixtures/colour-math'

interface ColorPickerProps {
  red: number
  green: number
  blue: number
  white?: number
  onChange: (r: number, g: number, b: number, w?: number) => void
  /** Wheel diameter in px (default 180) */
  size?: number
  /** Show the preset swatches (default true) */
  presets?: boolean
  /** Show the per-channel sliders (default true) */
  sliders?: boolean
  className?: string
}

/** Preset colours (content colours sent to fixtures, not UI chrome) */
export const PRESET_COLORS = [
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Orange', r: 255, g: 128, b: 0 },
  { name: 'Yellow', r: 255, g: 255, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Magenta', r: 255, g: 0, b: 255 },
  { name: 'Pink', r: 255, g: 105, b: 180 },
  { name: 'Warm', r: 255, g: 180, b: 100 },
  { name: 'Cool', r: 150, g: 200, b: 255 },
  { name: 'White', r: 255, g: 255, b: 255 },
  { name: 'Off', r: 0, g: 0, b: 0 }
]

const CHANNELS = [
  { key: 'r', label: 'R', color: 'rgb(255 60 60)' },
  { key: 'g', label: 'G', color: 'rgb(60 220 90)' },
  { key: 'b', label: 'B', color: 'rgb(60 140 255)' },
  { key: 'w', label: 'W', color: 'rgb(230 230 230)' }
] as const

export const ColorPicker = memo(function ColorPicker({
  red, green, blue, white, onChange, size = 180, presets = true, sliders = true, className
}: ColorPickerProps) {
  const hsv = rgbToHsv(red, green, blue)
  // Keep the hue while the colour is grey / black (it is not recoverable from RGB)
  const lastHue = useRef(hsv.h)
  if (hsv.s > 0.01 && hsv.v > 0.01) lastHue.current = hsv.h
  const brightness = hsv.v > 0 ? hsv.v : 1

  const values = { r: red, g: green, b: blue, w: white ?? 0 }
  const setOne = (key: 'r' | 'g' | 'b' | 'w', v: number) => {
    const next = { ...values, [key]: v }
    onChange(next.r, next.g, next.b, white !== undefined ? next.w : undefined)
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ColourWheel
        hue={lastHue.current}
        sat={hsv.v > 0 ? hsv.s : 0}
        value={brightness}
        size={size}
        onChange={(h, s) => {
          const [r, g, b] = hsvToRgb(h, s, brightness)
          onChange(r, g, b, white)
        }}
      />
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 shrink-0 rounded ring-1 ring-inset ring-line-strong" style={{ backgroundColor: `rgb(${red} ${green} ${blue})` }} />
        <span className="font-mono text-2xs tabular text-fg-secondary">
          R {red} · G {green} · B {blue}{white !== undefined ? ` · W ${white}` : ''}
        </span>
      </div>
      {sliders && (
        <div className="flex flex-col gap-1">
          {CHANNELS.filter((c) => c.key !== 'w' || white !== undefined).map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <span className="w-3 font-mono text-2xs text-fg-secondary">{c.label}</span>
              <Slider value={values[c.key]} onChange={(v) => setOne(c.key, v)} color={c.color} showValue={(v) => String(v)} className="flex-1" aria-label={c.label} />
            </div>
          ))}
        </div>
      )}
      {presets && (
        <div className="grid grid-cols-6 gap-1">
          {PRESET_COLORS.map(({ name, r, g, b }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={name}
              className="h-control-sm rounded ring-1 ring-inset ring-line-strong transition-shadow duration-fast hover:ring-fg-secondary"
              style={{ backgroundColor: `rgb(${r} ${g} ${b})` }}
              onClick={() => onChange(r, g, b, white !== undefined ? (r === 255 && g === 255 && b === 255 ? 255 : 0) : undefined)}
            />
          ))}
        </div>
      )}
    </div>
  )
})
