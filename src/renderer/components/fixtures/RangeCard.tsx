// An attribute with labelled DMX ranges (gobo / colour wheel slots,
// shutter Open / Closed / Strobe, prism, macros…): one button per range
// plus a slider for the raw value. Buttons set the centre of the range.

import { memo, useCallback } from 'react'
import { LuX } from 'react-icons/lu'
import { IconButton, Slider, cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { releaseAttrs, setAttr, setAttrDmx, useAttrSummary, useAttrTouched } from './attr-actions'
import { rangeValue, type Attribute } from './programmer-model'
import { formatAttrValue, formatRange, useProgrammerView } from './programmer-view-store'
import { useChannelMenu } from './channel-menu'
import { attrLabel, rangeLabel } from './labels'
import { useUiStore } from '@renderer/stores/ui-store'
import { PresetChip } from './PresetRow'

export interface RangeCardProps {
  attr: Attribute
  selectionCount: number
  firstName: string
  /** Swatch layout (colour wheel): colour chips with names */
  swatches?: boolean
  className?: string
}

export const RangeCard = memo(function RangeCard({ attr, selectionCount, firstName, swatches, className }: RangeCardProps) {
  const t = useT()
  const label = attrLabel(attr, t)
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr)
  const touched = useAttrTouched(attr.targets)
  const openMenu = useChannelMenu()
  const proMode = useUiStore((s) => s.proMode)
  const release = useCallback(() => releaseAttrs([attr]), [attr])
  const dmx = attr.fine ? Math.floor(sum.first / 256) : sum.first
  const mixed = sum.min !== sum.max
  const slots = attr.ranges.filter((r) => r.slot)
  const wide = attr.ranges.filter((r) => !r.slot)
  // Current slot: orange when it comes from the programmer, neutral when from playback
  const activeClass = touched !== 'none' ? 'bg-accent/15 text-fg-primary ring-accent' : 'bg-surface-5 text-fg-primary ring-fg-tertiary'
  const coverage = attr.fixtureIds.length < selectionCount ? `${attr.fixtureIds.length}/${selectionCount}` : null

  return (
    <section
      data-attr={attr.key}
      aria-label={label}
      onContextMenu={(e) => openMenu(e, {
        fixtureId: attr.targets[0].fixtureId,
        fixtureName: firstName,
        channelName: label,
        parameter: attr.label,
        note: attr.fixtureIds.length > 1 ? t('common.fixtureCount', { count: attr.fixtureIds.length }) : undefined,
        onRelease: touched !== 'none' ? release : undefined
      })}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg p-2.5 ring-1 ring-inset transition-colors duration-fast',
        touched !== 'none' ? 'bg-accent/[0.07] ring-accent/50' : 'bg-surface-2 ring-line-subtle',
        className
      )}
    >
      <header className="flex min-h-control-xs items-center gap-2">
        <span aria-hidden className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: attr.color }} />
        <h3 className={cn('min-w-0 flex-1 truncate text-xs font-semibold', touched !== 'none' ? 'text-accent-fg' : 'text-fg-primary')} title={label}>{label}</h3>
        {coverage && <span className="font-mono text-2xs tabular text-fg-tertiary" title={t('fixtures.attr.coverage', { count: attr.fixtureIds.length, total: selectionCount })}>{coverage}</span>}
        {proMode && touched !== 'none' && <PresetChip targets={attr.targets} />}
        <span className={cn('whitespace-nowrap font-mono text-xs tabular', mixed ? 'text-warning-fg' : 'text-fg-secondary')}>
          {formatRange(sum.min, sum.max, attr.max, unit, true)}
        </span>
        {touched !== 'none' && <IconButton icon={LuX} label={t('fixtures.release.attribute', { name: label })} size="xs" onClick={release} className="text-accent-fg" />}
      </header>

      {slots.length > 0 && (
        <div className={cn('grid gap-1', swatches ? 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(76px,1fr))]')}>
          {slots.map((r) => {
            const active = !mixed && dmx >= r.from && dmx <= r.to
            return (
              <button
                key={`${r.from}-${r.to}`}
                type="button"
                aria-pressed={active}
                title={`${rangeLabel(r, t)} (${r.from}–${r.to})`}
                onClick={() => setAttrDmx(attr, rangeValue(r))}
                className={cn(
                  'flex h-control-sm min-w-0 items-center gap-1.5 rounded px-2 text-xs ring-1 ring-inset transition-colors duration-fast',
                  active ? activeClass : 'bg-surface-3 text-fg-secondary ring-line hover:bg-surface-4 hover:text-fg-primary'
                )}
              >
                {r.swatch && <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-line-strong" style={{ backgroundColor: r.swatch }} />}
                <span className="truncate">{rangeLabel(r, t)}</span>
              </button>
            )
          })}
        </div>
      )}

      {wide.length > 0 && (
        <div className="flex flex-col gap-1">
          {wide.map((r) => {
            const active = !mixed && dmx >= r.from && dmx <= r.to
            return (
              <div key={`${r.from}-${r.to}`} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAttrDmx(attr, rangeValue(r))}
                  title={`${rangeLabel(r, t)} (${r.from}–${r.to})`}
                  className={cn(
                    'h-control-sm w-[112px] shrink-0 truncate rounded px-2 text-left text-xs ring-1 ring-inset transition-colors duration-fast',
                    active ? activeClass : 'bg-surface-3 text-fg-secondary ring-line hover:bg-surface-4 hover:text-fg-primary'
                  )}
                >
                  {rangeLabel(r, t)}
                </button>
                <Slider
                  value={active ? dmx : r.from}
                  min={r.from}
                  max={r.to}
                  onChange={(v) => setAttrDmx(attr, v)}
                  color={active ? attr.color : undefined}
                  aria-label={`${label}: ${rangeLabel(r, t)}`}
                  className="flex-1"
                />
              </div>
            )
          })}
        </div>
      )}

      <Slider
        value={sum.first}
        max={attr.max}
        onChange={(v) => setAttr(attr, v)}
        defaultValue={attr.defaultValue}
        color={attr.color}
        showValue={(v) => formatAttrValue(v, attr.max, unit, true)}
        aria-label={t('fixtures.attr.valueAria', { name: label })}
      />
    </section>
  )
})
