// Legacy slider API, kept for the views not yet migrated.
// New code: import { Slider } from '@renderer/components/ui'.
import { Slider } from '../ui'

interface HSliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  color?: string
  className?: string
}

export function HSlider({ value, onChange, min = 0, max = 255, step = 1, color, className }: HSliderProps) {
  return <Slider value={value} onChange={onChange} min={min} max={max} step={step} color={color} className={className} />
}
