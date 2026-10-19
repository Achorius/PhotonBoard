// One programmer attribute as a console fader strip: short label,
// live value (% or DMX, range when the selection is mixed), the fader,
// and a release button while the attribute is in the programmer.
// Subscribes only to its own value and touched state.

import { memo, useCallback } from 'react'
import { LuX } from 'react-icons/lu'
import { Fader, IconButton, cn } from '@renderer/components/ui'
import { releaseAttrs, setAttr, useAttrSummary, useAttrTouched } from './attr-actions'
import type { Attribute } from './programmer-model'
import { formatRange, useProgrammerView } from './programmer-view-store'
import { useChannelMenu } from './channel-menu'

export interface AttributeFaderProps {
  attr: Attribute
  /** Number of selected fixtures (coverage "2/4" when not all have it) */
  selectionCount: number
  /** Name of the first fixture (MIDI learn target) */
  firstName: string
  /** Label shown instead of the attribute short name */
  label?: string
  className?: string
}

export const AttributeFader = memo(function AttributeFader({ attr, selectionCount, firstName, label, className }: AttributeFaderProps) {
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr)
  const touched = useAttrTouched(attr.targets)
  const openMenu = useChannelMenu()
  const onChange = useCallback((v: number) => setAttr(attr, v), [attr])
  const release = useCallback(() => releaseAttrs([attr]), [attr])
  const mixed = sum.min !== sum.max
  const coverage = attr.fixtureIds.length < selectionCount ? `${attr.fixtureIds.length}/${selectionCount}` : null

  return (
    <div
      data-attr={attr.key}
      title={`${attr.label}${attr.fine ? ' (16-bit)' : ''}${attr.cells ? ' — all cells' : ''}`}
      onContextMenu={(e) => openMenu(e, {
        fixtureId: attr.targets[0].fixtureId,
        fixtureName: firstName,
        channelName: attr.label,
        note: attr.fixtureIds.length > 1 ? `${attr.fixtureIds.length} fixtures` : undefined,
        onRelease: touched !== 'none' ? release : undefined
      })}
      className={cn(
        'flex h-full w-[52px] shrink-0 flex-col items-center gap-1 rounded-lg px-1 pb-1 pt-1.5 ring-1 ring-inset transition-colors duration-fast [[data-density=touch]_&]:w-[64px]',
        touched !== 'none' ? 'bg-accent/10 ring-accent/50' : 'bg-surface-2 ring-line-subtle',
        className
      )}
    >
      <span className={cn('w-full truncate text-center text-2xs font-semibold uppercase tracking-[0.04em]', touched !== 'none' ? 'text-accent-fg' : 'text-fg-secondary')}>
        {label ?? attr.short}
      </span>
      <span
        className={cn('h-4 w-full truncate text-center font-mono text-2xs leading-4 tabular', mixed ? 'text-warning-fg' : sum.first > 0 ? 'text-fg-primary' : 'text-fg-tertiary')}
        aria-label={mixed ? 'Mixed values' : undefined}
      >
        {formatRange(sum.min, sum.max, attr.max, unit)}
      </span>
      <div className="flex min-h-0 w-full flex-1 justify-center">
        <Fader
          value={sum.first}
          onChange={onChange}
          max={attr.max}
          defaultValue={attr.defaultValue}
          color={attr.color}
          readout={false}
          aria-label={attr.label}
        />
      </div>
      <div className="flex h-control-sm w-full items-center justify-center">
        {touched !== 'none' ? (
          <IconButton icon={LuX} label={`Release ${attr.label}`} size="sm" variant="ghost" onClick={release} className="text-accent-fg" />
        ) : coverage ? (
          <span className="font-mono text-2xs tabular text-fg-tertiary" title={`${attr.fixtureIds.length} of ${selectionCount} selected fixtures`}>{coverage}</span>
        ) : null}
      </div>
    </div>
  )
})

/** Horizontal bank of attribute faders that scrolls sideways */
export function AttributeFaderBank({ attrs, selectionCount, firstName, className }: {
  attrs: Attribute[]
  selectionCount: number
  firstName: string
  className?: string
}) {
  return (
    <div className={cn('flex min-h-0 gap-1.5 overflow-x-auto overflow-y-hidden pb-1', className)}>
      {attrs.map((a) => (
        <AttributeFader key={a.key} attr={a} selectionCount={selectionCount} firstName={firstName} />
      ))}
    </div>
  )
}
