// ============================================================
// Effects view — centre: the effect library. One tap on a template
// creates the effect on the selected fixtures, starts it and opens
// it in the editor.
// ============================================================

import { memo, useMemo, useState } from 'react'
import { LuLibrary, LuMousePointerClick, LuSearch, LuSearchX, LuTriangleAlert } from 'react-icons/lu'
import { Badge, Button, EmptyState, Tabs, TextInput, cn, effectCategoryIcon, withAlpha } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { showToast } from '@renderer/stores/toast-store'
import { t as translate, useT } from '@renderer/i18n'
import {
  CATEGORIES, CATEGORY_COLOR, EFFECT_TEMPLATES, categoryLabel, effectFromTemplate, fixtureAttributes, templateAttributes, templateCompat,
  templateDescription, templateLabel, withOpenDimmer, type Compat, type EffectCategory, type EffectTemplate
} from './effect-templates'
import { TemplatePreview } from './effect-graphics'
import { useEffectsUiStore } from './effects-ui-store'

type CategoryFilter = 'all' | EffectCategory

/**
 * Targets that have a dimmer channel, split by whether it is currently at 0
 * (pre-master mix). Fixtures without a dimmer (RGB-only) are left out.
 */
function dimmerState(targetIds: string[]): { dark: number; lit: number } {
  const { patch, fixtures } = usePatchStore.getState()
  const values = useDmxStore.getState().values
  const byId = new Map(patch.map((p) => [p.id, p]))
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  let dark = 0
  let lit = 0
  for (const id of targetIds) {
    const entry = byId.get(id)
    const mode = entry ? defs.get(entry.fixtureDefId)?.modes.find((m) => m.name === entry.modeName) : undefined
    if (!entry || !mode) continue
    const idx = mode.channels.findIndex((ch) => ch.toLowerCase() === 'dimmer' || ch.toLowerCase() === 'intensity')
    if (idx < 0) continue
    if ((values[entry.universe]?.[entry.address - 1 + idx] ?? 0) === 0) dark++
    else lit++
  }
  return { dark, lit }
}

function applyTemplate(t: EffectTemplate): void {
  const targets = [...usePatchStore.getState().selectedFixtureIds]
  if (targets.length === 0) return
  let init = effectFromTemplate(t, targets)
  // Templates that drive the dimmer (intensity, dim waves, strobes) need nothing:
  // the effect itself is the intensity.
  const drivesDimmer = templateAttributes(t).includes('dimmer')
  if (!drivesDimmer && (t.category === 'color' || t.category === 'spatial')) {
    const res = withOpenDimmer(init, dimmerState(targets))
    init = res.effect
    if (res.hint) {
      showToast('info', translate('effects.library.darkTargetsTitle'), { description: translate('effects.library.darkTargetsText') })
    }
  }
  const id = useEffectsStore.getState().createEffect(init)
  useEffectsUiStore.getState().setEditing(id)
}

export function EffectLibrary({ className }: { className?: string }) {
  const t = useT()
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [query, setQuery] = useState('')
  const hasSelection = selectedIds.length > 0

  const compat = useMemo(() => {
    const defs = new Map(fixtures.map((f) => [f.id, f]))
    const byId = new Map(patch.map((p) => [p.id, p]))
    const targets = selectedIds.map((id) => byId.get(id)).filter((p) => p !== undefined).map((p) => fixtureAttributes(p, defs))
    return new Map(EFFECT_TEMPLATES.map((tpl) => [tpl.id, templateCompat(tpl, targets)]))
  }, [patch, fixtures, selectedIds])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return EFFECT_TEMPLATES.filter((tpl) => (category === 'all' || tpl.category === category) &&
      (!q || templateLabel(tpl).toLowerCase().includes(q) || templateDescription(tpl).toLowerCase().includes(q)))
  }, [category, query, t])

  const tabs = useMemo(() => [
    { id: 'all' as CategoryFilter, label: t('effects.library.all'), icon: LuLibrary, badge: EFFECT_TEMPLATES.length },
    ...CATEGORIES.map((c) => ({ id: c as CategoryFilter, label: categoryLabel(c), icon: effectCategoryIcon(c), badge: EFFECT_TEMPLATES.filter((tpl) => tpl.category === c).length }))
  ], [t])

  return (
    <section aria-label={t('effects.library.region')} className={cn('flex min-h-0 flex-col bg-surface-0', className)}>
      <header className="flex shrink-0 flex-col gap-1 bg-surface-1 px-3 pt-1.5">
        <div className="flex min-h-control items-center gap-2">
          <h2 className="text-sm font-semibold text-fg-primary">{t('effects.library.title')}</h2>
          <span className={cn('min-w-0 flex-1 truncate text-xs', hasSelection ? 'text-fg-tertiary' : 'text-warning-fg')}>
            {hasSelection ? t('effects.library.tapToRun', { count: selectedIds.length }) : t('effects.library.noTargets')}
          </span>
          <TextInput
            size="sm"
            icon={LuSearch}
            className="w-[180px] [[data-density=touch]_&]:w-[220px]"
            placeholder={t('effects.library.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); e.currentTarget.blur() } }}
            aria-label={t('effects.library.search')}
          />
        </div>
        <Tabs items={tabs} value={category} onChange={setCategory} size="sm" aria-label={t('effects.library.categoriesLabel')} className="scrollbar-none -mx-3 overflow-x-auto px-3" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {!hasSelection && <NoTargetsCallout />}
        {shown.length === 0 ? (
          <EmptyState
            icon={LuSearchX}
            title={t('effects.library.noMatchTitle')}
            description={t('effects.library.noMatchText', { query })}
            action={<Button size="sm" variant="ghost" onClick={() => { setQuery(''); setCategory('all') }}>{t('effects.library.showAll')}</Button>}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 [[data-density=touch]_&]:grid-cols-[repeat(auto-fill,minmax(204px,1fr))] [[data-density=touch]_&]:gap-3">
            {shown.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} compat={hasSelection ? compat.get(tpl.id) ?? 'none' : 'none'} noTargets={!hasSelection} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function NoTargetsCallout() {
  const t = useT()
  const patch = usePatchStore((s) => s.patch)
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/20 text-info-fg">
        <LuMousePointerClick size={18} aria-hidden />
      </span>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-fg-primary">{t('effects.library.noSelectionTitle')}</p>
        <p className="text-xs text-fg-secondary">
          {t('effects.library.noSelectionText')}
        </p>
      </div>
      <Button size="sm" variant="primary" onClick={() => usePatchStore.getState().selectFixtures(patch.map((p) => p.id))}>
        {t('effects.library.selectAll')}
      </Button>
    </div>
  )
}

const TemplateCard = memo(function TemplateCard({ template: tpl, compat, noTargets }: { template: EffectTemplate; compat: Compat; noTargets: boolean }) {
  const t = useT()
  const label = templateLabel(tpl)
  const description = templateDescription(tpl)
  const color = CATEGORY_COLOR[tpl.category]
  const Icon = tpl.icon
  const disabled = compat === 'none'
  const channels = useMemo(
    () => tpl.compound ?? (tpl.channels ?? ['Dimmer']).map((c, i, list) => ({ channelType: c, phaseOffset: (i * 360) / list.length, depth: 255 })),
    [tpl]
  )
  const reason = noTargets ? t('effects.library.selectFirst') : disabled ? t('effects.library.unsupported') : undefined
  return (
    <button
      type="button"
      data-fx-template={tpl.id}
      disabled={disabled}
      onClick={() => applyTemplate(tpl)}
      title={reason ?? `${label} — ${description}`}
      className={cn(
        'group flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface-1 p-2.5 text-left transition-colors duration-fast',
        'hover:border-line-strong hover:bg-surface-2 active:bg-surface-3 disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface-1',
        '[[data-density=touch]_&]:p-3'
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded [[data-density=touch]_&]:h-10 [[data-density=touch]_&]:w-10"
          style={{ backgroundColor: withAlpha(color, 0.16), color }}
        >
          <Icon size={16} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-fg-primary">{label}</span>
            {compat === 'partial' && <LuTriangleAlert size={12} aria-label={t('effects.library.partial')} className="shrink-0 text-warning-fg" />}
          </span>
          <span className="truncate text-xs text-fg-tertiary">{disabled && !noTargets ? t('effects.library.unsupportedShort') : description}</span>
        </span>
      </div>
      <TemplatePreview waveform={tpl.waveform} channels={channels} color={color} />
      {(tpl.oneShot || tpl.spatialMode === 'spatial' || channels.length > 1) && (
        <span className="-mt-0.5 flex flex-wrap gap-1">
          {tpl.oneShot && <Badge size="xs">{t('effects.library.oneShotBadge')}</Badge>}
          {tpl.spatialMode === 'spatial' && <Badge size="xs">3D · {tpl.spatialAxis?.toUpperCase()}</Badge>}
          {channels.length > 1 && <Badge size="xs">{t('effects.library.attributesBadge', { count: channels.length })}</Badge>}
        </span>
      )}
    </button>
  )
})
