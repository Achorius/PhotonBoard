// Intensity section: the master dimmer of the selection as a big fader,
// a large readout, quick levels (Full / 75 / 50 / 25 / Out) and release.

import { memo, useCallback } from 'react'
import type React from 'react'
import { LuEraser, LuSunDim } from 'react-icons/lu'
import { Button, Fader, IconButton, cn } from '@renderer/components/ui'
import { useT, type TFunction } from '@renderer/i18n'
import { releaseAttrs, setAttr, useAttrSummary, useAttrTouched } from './attr-actions'
import type { Attribute } from './programmer-model'
import { formatRange, percentSign, useProgrammerView } from './programmer-view-store'
import { useChannelMenu } from './channel-menu'
import { attrLabel } from './labels'
import { useUiStore } from '@renderer/stores/ui-store'
import { PresetChip } from './PresetRow'

const LEVELS: { pct: number; label: (t: TFunction) => string }[] = [
  { pct: 100, label: (t) => t('fixtures.intensity.full') },
  { pct: 75, label: () => '75' },
  { pct: 50, label: () => '50' },
  { pct: 25, label: () => '25' },
  { pct: 0, label: (t) => t('fixtures.intensity.out') }
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
  const t = useT()
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr)
  const touched = useAttrTouched(attr.targets)
  const openMenu = useChannelMenu()
  const proMode = useUiStore((s) => s.proMode)
  const onChange = useCallback((v: number) => setAttr(attr, v), [attr])
  const release = useCallback(() => releaseAttrs([attr]), [attr])
  const mixed = sum.min !== sum.max
  const level = (pct: number) => setAttr(attr, Math.round((pct / 100) * attr.max))
  const current = Math.round((sum.first / attr.max) * 100)
  const label = attrLabel(attr, t)

  return (
    <section
      aria-label={t('common.intensity')}
      data-feature="intensity"
      className="flex w-[176px] shrink-0 flex-col border-r border-line bg-surface-1 [[data-density=touch]_&]:w-[212px]"
      onContextMenu={(e) => openMenu(e, {
        fixtureId: attr.targets[0].fixtureId,
        fixtureName: firstName,
        channelName: label,
        parameter: attr.label,
        note: attr.fixtureIds.length > 1 ? t('common.fixtureCount', { count: attr.fixtureIds.length }) : undefined,
        onRelease: touched !== 'none' ? release : undefined
      })}
    >
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <LuSunDim size={14} aria-hidden className={touched !== 'none' ? 'text-accent-fg' : 'text-fg-tertiary'} />
        <h3 className={cn('flex-1 truncate text-2xs font-semibold uppercase tracking-[0.06em]', touched !== 'none' ? 'text-accent-fg' : 'text-fg-tertiary')}>
          {t('common.intensity')}
        </h3>
        {proMode && touched !== 'none' && <PresetChip targets={attr.targets} />}
        {touched !== 'none' && <IconButton icon={LuEraser} label={t('fixtures.release.intensity')} size="xs" onClick={release} className="text-accent-fg" />}
      </header>

      <div className="flex flex-col items-center gap-0.5 px-3 pb-1 pt-3">
        <div className={cn('font-mono text-2xl tabular leading-none', mixed ? 'text-warning-fg' : touched !== 'none' ? 'text-accent-fg' : 'text-fg-primary')}>
          {formatRange(sum.min, sum.max, attr.max, unit)}
          <span className="text-sm text-fg-tertiary">{unit === 'percent' ? percentSign() : ''}</span>
        </div>
        <div className="h-4 max-w-full truncate text-2xs text-fg-tertiary">
          {mixed
            ? t('fixtures.intensity.mixedLevels')
            : attr.fixtureIds.length < selectionCount
              ? t('fixtures.intensity.coverage', { count: attr.fixtureIds.length, total: selectionCount })
              : label}
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
            aria-label={t('fixtures.attr.selectionAria', { name: label })}
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
              {l.label(t)}
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
          {t('fixtures.intensity.more', { count: more })}
        </button>
      )}
    </section>
  )
})
