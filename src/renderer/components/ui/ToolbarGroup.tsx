import type React from 'react'
import { cn } from './cn'

export interface ToolbarGroupProps extends React.ComponentPropsWithRef<'div'> {
  /** Small caption before the group (e.g. "Masters") */
  label?: React.ReactNode
  /** Visually join the buttons (shared border, no gaps) */
  attached?: boolean
}

/** Row of related controls inside a toolbar or panel header. */
export function ToolbarGroup({ label, attached, className, children, ...rest }: ToolbarGroupProps) {
  return (
    <div role="group" className={cn('flex shrink-0 items-center', attached ? 'gap-px overflow-hidden rounded [&>*]:rounded-none' : 'gap-1', className)} {...rest}>
      {label && <span className="mr-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{label}</span>}
      {children}
    </div>
  )
}

/** Thin separator between toolbar groups / list sections */
export function Divider({ orientation = 'vertical', className }: { orientation?: 'vertical' | 'horizontal'; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('shrink-0 bg-line', orientation === 'vertical' ? 'mx-1 h-5 w-px self-center' : 'my-1 h-px w-full', className)}
    />
  )
}
