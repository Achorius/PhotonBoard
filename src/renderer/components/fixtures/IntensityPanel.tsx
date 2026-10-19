// Intensity section: the master dimmer of the selection as a big fader,
// a large readout, quick levels (Full / 75 / 50 / 25 / Out) and release.

import { memo, useCallback } from 'react'
import type React from 'react'
import { LuEraser, LuSunDim } from 'react-icons/lu'
import { Button, Fader, IconButton, cn } from '@renderer/components/ui'
import { releaseAttrs, setAttr, useAttrSummary, useAttrTouched } from './attr-actions'
import type { Attribute } from './programmer-model'
import { formatRange, useProgrammerView } from './programmer-view-store'
import { useChannelMenu } from './channel-menu'

const LEVELS: { pct: number; label: string }[] = [
  { pct: 100, label: 'Full' },
  { pct: 75, label: '75' },
  { pct: 50, label: '50' },
  { pct: 25, label: '25' },
  { pct: 0, label: 'Out' }
]

export interface IntensityPanelProps {
  attr: Attribute
  /** Other intensity attributes (cell dimmers…), shown as a hint */
  more: number
  selectionCount: number
  firstName: string
  onShowAll: () => void
}

export const IntensityPanel = memo(function IntensityPanel({ attr, more, selectionCount, firstName, onShowAll }: IntensityPanelProps) {
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr)
  const touched = useAttrTouched(attr.targets)
  const openMenu = useChannelMenu()
  const onChange = useCallback((v: number) => setAttr(attr, v), [attr])
  const release = useCallback(() => releaseAttrs([attr]), [attr])
  const mixed = sum.min !== sum.max
  const level = (pct: number) => setAttr(attr, Math.round((pct / 100) * attr.max))
  const current = Math.round((sum.first / attr.max) * 100)

  return (
    <section
      aria-label="Intensity"
      data-feature="intensity"
      className="flex w-[176px] shrink-0 flex-col border-r border-line bg-surface-1 [[data-density=touch]_&]:w-[212px]"
      onContextMenu={(e) => openMenu(e, {
        fixtureId: attr.targets[0].fixtureId,
        fixtureName: firstName,
        channelName: attr.label,
        note: attr.fixtureIds.length > 1 ? `${attr.fixtureIds.length} fixtures` : undefined,
        onRelease: touched !== 'none' ? release : undefined
      })}
    >
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <LuSunDim size={14} aria-hidden className={touched !== 'none' ? 'text-accent-fg' : 'text-fg-tertiary'} />
        <h3 className={cn('flex-1 text-2xs font-semibold uppercase tracking-[0.06em]', touched !== 'none' ? 'text-accent-fg' : 'text-fg-tertiary')}>
          Intensity
        </h3>
        {touched !== 'none' && <IconButton icon={LuEraser} label="Release intensity" size="xs" onClick={release} className="text-accent-fg" />}
      </header>

      <div className="flex flex-col items-center gap-0.5 px-3 pb-1 pt-3">
        <div className={cn('font-mono text-2xl tabular leading-none', mixed ? 'text-warning-fg' : touched !== 'none' ? 'text-accent-fg' : 'text-fg-primary')}>
          {formatRange(sum.min, sum.max, attr.max, unit)}
          <span className="text-sm text-fg-tertiary">{unit === 'percent' ? '%' : ''}</span>
        </div>
        <div className="h-4 text-2xs text-fg-tertiary">
          {mixed ? 'Mixed levels' : attr.fixtureIds.length < selectionCount ? `${attr.fixtureIds.length} of ${selectionCount} have a dimmer` : attr.label}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 px-3 pb-3 pt-1">
        <div className="flex min-h-0 flex-1 justify-center" style={{ '--pb-fader-w': '56px', '--pb-fader-cap-h': '22px' } as React.CSSProperties}>
          <Fader
            value={sum.first}
            onChange={onChange}
            max={attr.max}
            defaultValue={0}
            color={attr.color}
            readout={false}
            aria-label={`${attr.label} (selection)`}
          />
        </div>
        <div className="flex w-[64px] shrink-0 flex-col justify-between gap-1 py-0.5 [[data-density=touch]_&]:w-[76px]">
          {LEVELS.map((l) => (
            <Button
              key={l.pct}
              size="sm"
              variant="secondary"
              active={!mixed && current === l.pct && touched !== 'none'}
              tone="accent"
              onClick={() => level(l.pct)}
              className={cn('w-full', (l.pct === 100 || l.pct === 0) && 'font-semibold')}
            >
              {l.label}
            </Button>
          ))}
        </div>
      </div>

      {more > 0 && (
        <button
          type="button"
          onClick={onShowAll}
          className="mx-3 mb-3 rounded px-2 py-1 text-left text-2xs text-fg-tertiary ring-1 ring-inset ring-line-subtle hover:bg-surface-2 hover:text-fg-primary"
        >
          +{more} more intensity channel{more > 1 ? 's' : ''} in All
        </button>
      )}
    </section>
  )
})
