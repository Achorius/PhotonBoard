// Pools › Presets: one row per family (Dimmer, Position, Gobo, Colour,
// Beam, Focus, Control, All), grandMA-style numbered tiles with a
// colour swatch / position dot / level preview. Tap = apply to the
// selection; tap "+" = store the programmer there; right-click or
// long-press = Store (scope) / Update / Label / Colour / Renumber / Delete.

import { memo, useMemo } from 'react'
import type { FixtureDefinition, PatchEntry, Preset, PresetType } from '@shared/types'
import { PRESET_FAMILY_NUMBER } from '@shared/types'
import { useContextMenu, type MenuPoint } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePresetMeta } from '@renderer/components/fixtures/preset-meta'
import { POOL_FAMILIES, numbersOf, poolSlots, presetPreview, presetRef } from './pool-model'
import { applyPresetToSelection } from './pool-actions'
import { presetMenu, storePresetHere } from './preset-menu'
import { FAMILY_ICONS, PoolTile, PresetPreviewMark } from './PoolTile'
import { usePoolsView } from './pools-view-store'

export function PresetPool() {
  const t = useT()
  const presets = usePlaybackStore((s) => s.presets)
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const ctx = useContextMenu()
  const numbers = useMemo(() => numbersOf(presets, (p) => p.type), [presets])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      <p className="max-w-3xl text-xs text-fg-tertiary">{t('pro.pools.hint.presets')}</p>
      {POOL_FAMILIES.map((type) => (
        <FamilyRow
          key={type}
          type={type}
          presets={presets}
          numbers={numbers}
          patch={patch}
          fixtures={fixtures}
          onMenu={(e, number, preset) => ctx.open(e, presetMenu(type, number, preset))}
        />
      ))}
      {ctx.menu}
    </div>
  )
}

interface FamilyRowProps {
  type: PresetType
  presets: Preset[]
  numbers: Map<string, number>
  patch: PatchEntry[]
  fixtures: FixtureDefinition[]
  onMenu: (e: MenuPoint, number: number, preset: Preset | null) => void
}

const FamilyRow = memo(function FamilyRow({ type, presets, numbers, patch, fixtures, onMenu }: FamilyRowProps) {
  const t = useT()
  const family = useMemo(() => presets.filter((p) => p.type === type), [presets, type])
  const slots = useMemo(() => poolSlots(family, numbers, { min: 12, spare: 2 }), [family, numbers])
  const previews = useMemo(() => new Map(family.map((p) => [p.id, presetPreview(p, patch, fixtures)])), [family, patch, fixtures])
  const inUse = usePresetMeta((s) => s.ids)
  const selected = usePoolsView((s) => (s.selected?.kind === 'preset' ? s.selected.id : null))
  const Icon = FAMILY_ICONS[type]
  const label = t(`pro.pools.families.${type}`)

  return (
    <section aria-label={t('pro.pools.familyAria', { family: label })} data-family={type} className="flex items-stretch gap-2">
      <div className="flex w-[92px] shrink-0 flex-col justify-center gap-1 rounded-lg bg-surface-1 px-2 ring-1 ring-inset ring-line-subtle [[data-density=touch]_&]:w-[108px]">
        <Icon size={16} aria-hidden className="text-fg-tertiary" />
        <span className="truncate text-xs font-semibold text-fg-primary">{label}</span>
        <span className="font-mono text-2xs tabular text-fg-tertiary">{PRESET_FAMILY_NUMBER[type]}</span>
      </div>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
        {slots.map(({ number, item }) => {
          const ref = presetRef({ type, number })
          if (!item) {
            return (
              <PoolTile
                key={`empty-${number}`}
                number={ref}
                empty
                data-slot={ref}
                ariaLabel={t('pro.pools.emptySlot', { ref })}
                title={t('pro.pools.emptySlotHint')}
                onTap={() => { void storePresetHere(type, number) }}
                onMenu={(e) => onMenu(e, number, null)}
              />
            )
          }
          const scope = item.scope && item.scope !== 'selective' ? t(`pro.pools.scope.short.${item.scope}`) : undefined
          return (
            <PoolTile
              key={item.id}
              number={ref}
              name={item.name}
              subtitle={scope}
              color={item.color}
              data-slot={ref}
              active={inUse.has(item.id)}
              selected={selected === item.id}
              preview={<PresetPreviewMark preview={previews.get(item.id) ?? { kind: 'none' }} type={type} />}
              ariaLabel={item.name ? `${ref} ${item.name}` : ref}
              onTap={() => {
                usePoolsView.getState().select('preset', item.id)
                applyPresetToSelection(item.id)
              }}
              onMenu={(e) => {
                usePoolsView.getState().select('preset', item.id)
                onMenu(e, number, item)
              }}
            />
          )
        })}
      </div>
    </section>
  )
})
