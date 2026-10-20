// ============================================================
// Table primitives — dense data (patch list, cue list, mappings).
// Sticky header, density-aware row height, hover / selected rows.
//   <Table><THead><Tr><Th>…</Th></Tr></THead><TBody>…</TBody></Table>
// Wrap in a scroll container (PanelBody) for the sticky header.
// ============================================================

import type React from 'react'
import { LuArrowDown, LuArrowUp } from 'react-icons/lu'
import { cn } from './cn'

export function Table({ className, zebra, ...rest }: React.ComponentPropsWithRef<'table'> & { zebra?: boolean }) {
  return (
    <table
      className={cn('w-full border-separate border-spacing-0 text-sm', zebra && '[&_tbody_tr:nth-child(even)]:bg-surface-2/40', className)}
      {...rest}
    />
  )
}

export function THead({ className, ...rest }: React.ComponentPropsWithRef<'thead'>) {
  return <thead className={cn('sticky top-0 z-10 bg-surface-1', className)} {...rest} />
}

export function TBody(props: React.ComponentPropsWithRef<'tbody'>) {
  return <tbody {...props} />
}

export interface TrProps extends React.ComponentPropsWithRef<'tr'> {
  selected?: boolean
  /** Row is clickable (hover state, pointer cursor) */
  interactive?: boolean
  /** Dim the row (disabled / not patched) */
  muted?: boolean
}

export function Tr({ selected, interactive, muted, className, ...rest }: TrProps) {
  return (
    <tr
      aria-selected={selected}
      className={cn(
        'h-row',
        interactive && 'cursor-pointer hover:bg-surface-2',
        selected && 'bg-info/15 hover:bg-info/20 [&>td:first-child]:shadow-[inset_2px_0_0_rgb(var(--pb-info-fg))]',
        muted && 'text-fg-tertiary',
        className
      )}
      {...rest}
    />
  )
}

export interface ThProps extends React.ComponentPropsWithRef<'th'> {
  align?: 'left' | 'right' | 'center'
  /** Sortable: current direction (or null) + click handler */
  sort?: 'asc' | 'desc' | null
  onSort?: () => void
}

export function Th({ align = 'left', sort, onSort, className, children, ...rest }: ThProps) {
  const content = onSort ? (
    // Buttons reset text-transform (preflight): inherit the caption style
    <button type="button" onClick={onSort} className="inline-flex items-center gap-1 [text-transform:inherit] hover:text-fg-primary">
      {children}
      {sort === 'asc' ? <LuArrowUp size={12} aria-hidden /> : sort === 'desc' ? <LuArrowDown size={12} aria-hidden /> : null}
    </button>
  ) : children
  return (
    <th
      scope="col"
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
      className={cn(
        'h-control-sm whitespace-nowrap border-b border-line px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className
      )}
      {...rest}
    >
      {content}
    </th>
  )
}

export interface TdProps extends React.ComponentPropsWithRef<'td'> {
  align?: 'left' | 'right' | 'center'
  /** Monospace + tabular (addresses, DMX values, times) */
  mono?: boolean
  /** Secondary text colour */
  muted?: boolean
}

export function Td({ align = 'left', mono, muted, className, ...rest }: TdProps) {
  return (
    <td
      className={cn(
        'border-b border-line-subtle px-3 align-middle',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        mono && 'font-mono text-xs tabular',
        muted && 'text-fg-tertiary',
        className
      )}
      {...rest}
    />
  )
}
