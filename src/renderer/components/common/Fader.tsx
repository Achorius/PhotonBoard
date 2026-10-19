// Legacy fader API, kept for the views not yet migrated.
// New code: import { Fader, Slider } from '@renderer/components/ui'.
import { Fader as UiFader, Slider, cn } from '../ui'

/**
 * Fixed width / gap (px) for views that size fader columns from these
 * constants; the legacy wrapper pins this width in every density.
 */
export const FADER_WIDTH = 30
export const FADER_GAP = 6

interface FaderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label?: string
  color?: string
  vertical?: boolean
  showValue?: boolean
  onDoubleClick?: () => void
  className?: string
}

export function Fader({ value, onChange, min = 0, max = 255, label, color, vertical = true, showValue = true, onDoubleClick, className }: FaderProps) {
  if (!vertical) {
    return (
      <Slider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        color={color}
        showValue={showValue}
        onDoubleTap={onDoubleClick}
        aria-label={label}
        className={className}
      />
    )
  }
  return (
    <UiFader
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      label={label}
      color={color}
      readout={showValue ? 'percent' : false}
      onDoubleTap={onDoubleClick}
      className={cn('!w-[30px]', className)}
    />
  )
}
