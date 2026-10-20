import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from './cn'
import { Button, type ButtonProps, type ButtonSize } from './Button'

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'iconRight' | 'children' | 'tooltip'> {
  icon: IconType
  /** Accessible name — also the tooltip unless `tooltip` is set */
  label: string
  tooltip?: React.ReactNode
}

const SQUARE: Record<ButtonSize, string> = {
  xs: 'w-control-xs px-0',
  sm: 'w-control-sm px-0',
  md: 'w-control px-0',
  lg: 'w-control-lg px-0'
}

/** Square icon-only button. Always has a label (aria-label + tooltip). */
export function IconButton({ icon, label, tooltip, size = 'md', variant = 'ghost', className, ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      size={size}
      variant={variant}
      icon={icon}
      aria-label={label}
      tooltip={tooltip ?? label}
      className={cn(SQUARE[size], className)}
    />
  )
}
