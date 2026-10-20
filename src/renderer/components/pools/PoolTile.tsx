// One numbered pool tile (grandMA style): number top-left, name, a
// preview (colour swatch, position dot, level bar, icon), the user
// colour as a top bar. Empty slots show "+". Tap = the pool's action;
// right-click / long-press = its menu (handled by the parent).

import { memo } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import {
  LuAperture, LuFocus, LuLayoutGrid, LuMove, LuPalette, LuPlus, LuSettings2, LuSunDim, LuCircleDot
} from 'react-icons/lu'
import type { PresetType } from '@shared/types'
import { cn, contextMenuHandlers, type MenuPoint } from '@renderer/components/ui'
import type { PresetPreview } from './pool-model'

export const FAMILY_ICONS: Record<PresetType, IconType> = {
  intensity: LuSunDim,
  position: LuMove,
  gobo: LuCircleDot,
  color: LuPalette,
  beam: LuAperture,
  focus: LuFocus,
  control: LuSettings2,
  full: LuLayoutGrid
}

export interface PoolTileProps {
  /** "4.2" / "3" */
  number: string
  name?: string
  subtitle?: React.ReactNode
  /** User colour (top bar) */
  color?: string
  preview?: React.ReactNode
  empty?: boolean
  /** In use: the programmer holds it / running / current selection */
  active?: boolean
  /** Keyboard target (Delete, F2, Mod+D) */
  selected?: boolean
  size?: 'md' | 'sm'
  ariaLabel: string
  title?: string
  onTap: () => void
  onMenu?: (e: MenuPoint) => void
  className?: string
  'data-slot'?: string
}

export const PoolTile = memo(function PoolTile({
  number, name, subtitle, color, preview, empty, active, selected, size = 'md', ariaLabel, title, onTap, onMenu, className, ...data
}: PoolTileProps) {
  const handlers = onMenu ? contextMenuHandlers(onMenu) : {}
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      aria-pressed={active || undefined}
      data-slot={data['data-slot']}
      data-empty={empty || undefined}
      onClick={onTap}
      {...handlers}
      className={cn(
        'group relative flex shrink-0 select-none flex-col overflow-hidden rounded-lg text-left transition-colors duration-fast',
        size === 'md'
          ? 'h-[60px] w-[96px] px-2 pb-1.5 pt-1.5 [[data-density=touch]_&]:h-[72px] [[data-density=touch]_&]:w-[112px]'
          : 'h-[48px] w-[76px] px-1.5 pb-1 pt-1 [[data-density=touch]_&]:h-[56px] [[data-density=touch]_&]:w-[88px]',
        empty
          ? 'border border-dashed border-line bg-transparent text-fg-tertiary hover:border-line-strong hover:bg-surface-2 hover:text-fg-primary'
          : 'bg-surface-2 text-fg-primary ring-1 ring-inset ring-line-subtle hover:bg-surface-3',
        active && !empty && 'bg-accent/15 ring-accent/70',
        selected && 'outline outline-2 -outline-offset-2 outline-info-fg',
        className
      )}
    >
      {color && !empty && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: color }} />}
      <span className={cn('font-mono text-2xs leading-none tabular', active && !empty ? 'text-accent-fg' : 'text-fg-tertiary')}>{number}</span>
      {empty ? (
        <span className="flex flex-1 items-center justify-center">
          <LuPlus size={size === 'md' ? 18 : 14} aria-hidden />
        </span>
      ) : (
        <>
          <span className={cn('mt-0.5 line-clamp-2 min-w-0 break-words pr-5 text-xs font-medium leading-tight', !name && 'text-fg-tertiary')}>{name}</span>
          {subtitle && <span className="mt-auto truncate text-2xs leading-tight text-fg-tertiary">{subtitle}</span>}
          {preview && <span aria-hidden className="absolute right-1.5 top-1.5 flex items-center justify-center">{preview}</span>}
        </>
      )}
    </button>
  )
})

/** Mini preview of a preset (top-right of its tile) */
export function PresetPreviewMark({ preview, type, size = 18 }: { preview: PresetPreview; type: PresetType; size?: number }) {
  switch (preview.kind) {
    case 'colour':
      return <span className="block rounded-full ring-1 ring-inset ring-black/30" style={{ width: size, height: size, backgroundColor: preview.css }} />
    case 'position':
      return (
        <span className="relative block rounded-sm bg-surface-0 ring-1 ring-inset ring-line" style={{ width: size, height: size }}>
          <span
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${10 + preview.x * 80}%`, top: `${10 + (1 - preview.y) * 80}%` }}
          />
        </span>
      )
    case 'level':
      return (
        <span className="relative block w-1.5 overflow-hidden rounded-full bg-surface-0 ring-1 ring-inset ring-line" style={{ height: size }}>
          <span className="absolute inset-x-0 bottom-0 bg-accent" style={{ height: `${Math.round(preview.value * 100)}%` }} />
        </span>
      )
    default: {
      const Icon = FAMILY_ICONS[type]
      return <Icon size={14} className="text-fg-tertiary" />
    }
  }
}
