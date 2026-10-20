import { LuCheck } from 'react-icons/lu'
import { cn } from './cn'
import { prefersDarkText } from './tokens'

export interface ColorSwatchProps {
  color: string
  /** Accessible name ("Red", "#ff0000") */
  label?: string
  selected?: boolean
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE = { sm: 'h-5 w-5', md: 'h-7 w-7', lg: 'h-control w-control' }

/** Colour chip: palette pickers, group/column colours, cue colour tags. */
export function ColorSwatch({ color, label, selected, onClick, size = 'md', className }: ColorSwatchProps) {
  const cls = cn(
    'relative inline-flex shrink-0 items-center justify-center rounded ring-1 ring-inset ring-white/10',
    SIZE[size],
    selected && 'outline outline-2 outline-offset-2 outline-fg-primary',
    onClick && 'transition-transform duration-fast hover:scale-110',
    className
  )
  const check = selected && <LuCheck size={size === 'sm' ? 10 : 14} strokeWidth={3} aria-hidden className={prefersDarkText(color) ? 'text-black/80' : 'text-white'} />
  if (!onClick) return <span role="img" aria-label={label ?? color} className={cls} style={{ backgroundColor: color }}>{check}</span>
  return (
    <button type="button" aria-label={label ?? color} aria-pressed={selected} onClick={onClick} className={cls} style={{ backgroundColor: color }}>
      {check}
    </button>
  )
}

export interface SwatchPickerProps {
  colors: readonly string[]
  value?: string
  onChange: (color: string) => void
  columns?: number
  size?: ColorSwatchProps['size']
  className?: string
}

/** Grid of swatches (single choice) */
export function SwatchPicker({ colors, value, onChange, columns = 6, size = 'md', className }: SwatchPickerProps) {
  return (
    <div role="group" className={cn('grid gap-1.5', className)} style={{ gridTemplateColumns: `repeat(${columns}, max-content)` }}>
      {colors.map((c) => (
        <ColorSwatch key={c} color={c} size={size} selected={value?.toLowerCase() === c.toLowerCase()} onClick={() => onChange(c)} />
      ))}
    </div>
  )
}
