// ============================================================
// Button — every clickable action in the app.
//   variant: idle look       (primary | secondary | ghost | outline | danger | danger-outline | success)
//   tone + active: toggles   (active → solid tone fill, aria-pressed)
//   onPress/onRelease: hold  (momentary: Blinder, Strobe, Flash — works on touch)
// ============================================================

import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from './cn'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'
import { usePress, type PressHandlers } from './usePress'
import type { Tone } from './tokens'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-outline' | 'success'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<React.ComponentPropsWithRef<'button'>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon (Lucide from react-icons/lu) */
  icon?: IconType
  /** Trailing icon (e.g. chevron for menus) */
  iconRight?: IconType
  children?: React.ReactNode
  /** Busy: spinner instead of the icon, clicks ignored */
  loading?: boolean
  /** Toggle state: solid `tone` fill + aria-pressed */
  active?: boolean
  /** Colour used when `active` (default accent) */
  tone?: Tone
  /** Momentary mode: fires on press (pointer/key down) … */
  onPress?: () => void
  /** … and once on release (pointer up / cancel / blur / unmount) */
  onRelease?: () => void
  /** Tooltip text (hover / keyboard focus; never on touch) */
  tooltip?: React.ReactNode
  /** Shortcut shown in the tooltip, e.g. "Mod+S" */
  shortcut?: string
  fullWidth?: boolean
  /** Count / dot pinned to the top-right corner */
  badge?: React.ReactNode
  /** Class for the label span — e.g. 'hidden xl:inline' for icon-only buttons on narrow screens */
  labelClassName?: string
}

export const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: 'h-control-xs px-2 text-2xs gap-1 rounded-sm',
  sm: 'h-control-sm px-2.5 text-xs gap-1.5 rounded',
  md: 'h-control px-3 text-sm gap-2 rounded',
  lg: 'h-control-lg px-4 text-base gap-2 rounded-lg'
}

export const ICON_SIZE: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 16, lg: 18 }

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active font-semibold',
  secondary: 'bg-surface-3 text-fg-primary shadow-raised hover:bg-surface-4 active:bg-surface-5',
  ghost: 'bg-transparent text-fg-secondary hover:bg-surface-3 hover:text-fg-primary active:bg-surface-4',
  outline: 'bg-transparent text-fg-primary border border-line-strong hover:bg-surface-3 active:bg-surface-4',
  danger: 'bg-danger text-on-danger hover:brightness-110 active:brightness-95 font-semibold',
  'danger-outline': 'bg-danger/10 text-danger-fg ring-1 ring-inset ring-danger/70 hover:bg-danger/20 active:bg-danger/30',
  success: 'bg-go text-on-go hover:brightness-110 active:brightness-95 font-semibold'
}

/** Solid fill for an active toggle */
export const TONE_ACTIVE: Record<Tone, string> = {
  neutral: 'bg-surface-5 text-fg-primary',
  accent: 'bg-accent text-on-accent',
  go: 'bg-go text-on-go',
  danger: 'bg-danger text-on-danger',
  warning: 'bg-warning text-on-warning',
  info: 'bg-info text-on-info',
  midi: 'bg-midi text-on-midi'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  children,
  loading = false,
  active,
  tone = 'accent',
  onPress,
  onRelease,
  tooltip,
  shortcut,
  fullWidth,
  badge,
  labelClassName,
  className,
  disabled,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const hold = !!(onPress || onRelease)
  const [pressHandlers, pressed] = usePress({
    onPress: () => onPress?.(),
    onRelease: () => onRelease?.(),
    disabled: disabled || loading || !hold
  })
  const isOn = active || (hold && pressed)
  const iconSize = ICON_SIZE[size]

  const button = (
    <button
      type={type}
      disabled={disabled}
      aria-pressed={active === undefined && !hold ? undefined : isOn}
      aria-busy={loading || undefined}
      data-active={isOn || undefined}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,color,box-shadow,filter] duration-fast',
        'disabled:pointer-events-none disabled:opacity-40',
        BUTTON_SIZE[size],
        isOn ? TONE_ACTIVE[tone] : VARIANT[variant],
        fullWidth && 'w-full',
        hold && 'touch-none',
        className
      )}
      {...rest}
      {...(hold ? mergeHandlers(pressHandlers, rest) : null)}
      onClick={loading || hold ? undefined : onClick}
    >
      {loading ? <Spinner size={iconSize} /> : Icon && <Icon size={iconSize} aria-hidden className="shrink-0" />}
      {children !== undefined && children !== null && children !== false && <span className={cn('truncate', labelClassName)}>{children}</span>}
      {IconRight && <IconRight size={iconSize} aria-hidden className="shrink-0 opacity-70" />}
      {badge !== undefined && badge !== null && badge !== false && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-on-accent">
          {badge}
        </span>
      )}
    </button>
  )

  return tooltip || shortcut ? <Tooltip content={tooltip} shortcut={shortcut}>{button}</Tooltip> : button
}

/** Hold handlers first, then any same-named handler the caller passed */
function mergeHandlers(hold: PressHandlers, rest: Record<string, unknown>): Record<string, (e: any) => void> {
  const out: Record<string, (e: any) => void> = {}
  for (const [name, fn] of Object.entries(hold) as [string, (e: any) => void][]) {
    const user = rest[name]
    out[name] = typeof user === 'function' ? (e) => { fn(e); user(e) } : fn
  }
  return out
}
