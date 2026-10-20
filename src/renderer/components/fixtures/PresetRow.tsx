// Pro view: preset rows of the attribute panels — the first 8 presets
// of a family as small tiles (tap = apply to the selection; right-click
// / long-press = the pool menu), "+" = store the selection's values of
// that family as a new preset, and a link to the Pools view.
// Also the "P4.2" chip of attributes whose values come from a preset.

import { memo, useMemo } from 'react'
import { LuLayers } from 'react-icons/lu'
import type { Preset, PresetType } from '@shared/types'
import { Badge, IconButton, useContextMenu, cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { nextPresetNumber } from '@renderer/stores/pool-store'
import { numbersOf, presetPreview, presetRef } from '@renderer/components/pools/pool-model'
import { applyPresetToSelection, storePresetAt } from '@renderer/components/pools/pool-actions'
import { presetMenu } from '@renderer/components/pools/preset-menu'
import { PoolTile, PresetPreviewMark } from '@renderer/components/pools/PoolTile'
import { usePoolsView } from '@renderer/components/pools/pools-view-store'
import { usePresetChip, usePresetMeta } from './preset-meta'
import type { AttrTarget } from './programmer-model'

/** Tiles per family row in the programmer */
export const PRESET_ROW_SIZE = 8

/** The first `PRESET_ROW_SIZE` presets of a family, by number */
export function firstPresets(presets: readonly Preset[], type: PresetType, numbers: ReadonlyMap<string, number>): Preset[] {
  return presets
    .filter((p) => p.type === type)
    .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0))
    .slice(0, PRESET_ROW_SIZE)
}

export function PresetRows({ families, className }: { families: PresetType[]; className?: string }) {
  const ctx = useContextMenu()
  if (families.length === 0) return null
  return (
    <div className={cn('flex shrink-0 flex-col gap-1.5', className)} data-preset-rows={families.join(',')}>
      {families.map((type) => (
        <PresetRow key={type} type={type} onMenu={(e, number, preset) => ctx.open(e, presetMenu(type, number, preset))} />
      ))}
      {ctx.menu}
    </div>
  )
}

const PresetRow = memo(function PresetRow({ type, onMenu }: {
  type: PresetType
  onMenu: (e: { clientX: number; clientY: number; preventDefault: () => void }, number: number, preset: Preset | null) => void
}) {
  const t = useT()
  const presets = usePlaybackStore((s) => s.presets)
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const inUse = usePresetMeta((s) => s.ids)
  const numbers = useMemo(() => numbersOf(presets, (p) => p.type), [presets])
  const shown = useMemo(() => firstPresets(presets, type, numbers), [presets, type, numbers])
  const family = t(`pro.pools.families.${type}`)
  const next = nextPresetNumber(type, presets)
  const nextRef = presetRef({ type, number: next })

  return (
    <section aria-label={t('pro.programmer.presets.aria', { family })} data-preset-family={type} className="flex min-w-0 items-center gap-1.5">
      <span className="w-[64px] shrink-0 truncate text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary [[data-density=touch]_&]:w-[76px]" title={family}>{family}</span>
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {shown.map((p) => {
          const number = numbers.get(p.id) ?? 0
          const ref = presetRef(p, number)
          return (
            <PoolTile
              key={p.id}
              size="sm"
              number={ref}
              name={p.name}
              color={p.color}
              active={inUse.has(p.id)}
              preview={<PresetPreviewMark preview={presetPreview(p, patch, fixtures)} type={type} size={14} />}
              ariaLabel={p.name ? `${ref} ${p.name}` : ref}
              onTap={() => applyPresetToSelection(p.id)}
              onMenu={(e) => onMenu(e, number, p)}
            />
          )
        })}
        <PoolTile
          size="sm"
          number={nextRef}
          empty
          ariaLabel={t('pro.programmer.presets.store')}
          title={t('pro.programmer.presets.storeTitle', { family, ref: nextRef })}
          onTap={() => { storePresetAt(type, next) }}
          onMenu={(e) => onMenu(e, next, null)}
        />
        <IconButton
          icon={LuLayers}
          size="sm"
          variant="ghost"
          label={t('pro.programmer.presets.openTitle')}
          onClick={() => {
            usePoolsView.getState().setTab('presets')
            useUiStore.getState().setActiveTab('pools')
          }}
        />
      </div>
    </section>
  )
})

/** "P4.2" chip of an attribute whose programmer values come from one preset (Pro view only) */
export const PresetChip = memo(function PresetChip({ targets, className }: { targets: readonly AttrTarget[]; className?: string }) {
  const t = useT()
  const chip = usePresetChip(targets, t('pro.programmer.presets.chipSeveral'))
  if (!chip) return null
  const several = chip === t('pro.programmer.presets.chipSeveral')
  return (
    <Badge
      size="xs"
      mono
      tone="accent"
      className={cn('shrink-0', className)}
      title={several ? t('pro.programmer.presets.severalPresets') : t('pro.programmer.presets.fromPreset', { ref: chip.slice(1) })}
    >
      {chip}
    </Badge>
  )
})
