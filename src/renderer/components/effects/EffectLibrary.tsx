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
import { setProgrammerChannel } from '@renderer/lib/dmx-mixer'
import {
  CATEGORIES, CATEGORY_COLOR, EFFECT_TEMPLATES, effectFromTemplate, fixtureAttributes, templateCompat,
  type Compat, type EffectCategory, type EffectTemplate
} from './effect-templates'
import { TemplatePreview } from './effect-graphics'
import { useEffectsUiStore } from './effects-ui-store'

type CategoryFilter = 'all' | EffectCategory

/** Colour / intensity effects need light: open the dimmer of targets that are at 0 */
function openDimmers(targetIds: string[]): void {
  const { patch, fixtures } = usePatchStore.getState()
  const values = useDmxStore.getState().values
  const byId = new Map(patch.map((p) => [p.id, p]))
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  for (const id of targetIds) {
    const entry = byId.get(id)
    const mode = entry ? defs.get(entry.fixtureDefId)?.modes.find((m) => m.name === entry.modeName) : undefined
    if (!entry || !mode) continue
    const idx = mode.channels.findIndex((ch) => ch.toLowerCase() === 'dimmer' || ch.toLowerCase() === 'intensity')
    if (idx < 0) continue
    const abs = entry.address - 1 + idx
    if ((values[entry.universe]?.[abs] ?? 0) === 0) setProgrammerChannel(entry.universe, abs, 255)
  }
}

function applyTemplate(t: EffectTemplate): void {
  const targets = [...usePatchStore.getState().selectedFixtureIds]
  if (targets.length === 0) return
  if (t.category === 'color' || t.category === 'intensity' || t.category === 'spatial') openDimmers(targets)
  const id = useEffectsStore.getState().createEffect(effectFromTemplate(t, targets))
  useEffectsUiStore.getState().setEditing(id)
}

export function EffectLibrary({ className }: { className?: string }) {
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
    return new Map(EFFECT_TEMPLATES.map((t) => [t.id, templateCompat(t, targets)]))
  }, [patch, fixtures, selectedIds])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return EFFECT_TEMPLATES.filter((t) => (category === 'all' || t.category === category) &&
      (!q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)))
  }, [category, query])

  const tabs = useMemo(() => [
    { id: 'all' as CategoryFilter, label: 'All', icon: LuLibrary, badge: EFFECT_TEMPLATES.length },
    ...CATEGORIES.map((c) => ({ id: c.id as CategoryFilter, label: c.label, icon: effectCategoryIcon(c.id), badge: EFFECT_TEMPLATES.filter((t) => t.category === c.id).length }))
  ], [])

  return (
    <section aria-label="Effect library" className={cn('flex min-h-0 flex-col bg-surface-0', className)}>
      <header className="flex shrink-0 flex-col gap-1 bg-surface-1 px-3 pt-1.5">
        <div className="flex min-h-control items-center gap-2">
          <h2 className="text-sm font-semibold text-fg-primary">Library</h2>
          <span className={cn('min-w-0 flex-1 truncate text-xs', hasSelection ? 'text-fg-tertiary' : 'text-warning-fg')}>
            {hasSelection ? `Tap to run on ${selectedIds.length} fixture${selectedIds.length === 1 ? '' : 's'}` : 'No targets selected'}
          </span>
          <TextInput
            size="sm"
            icon={LuSearch}
            className="w-[180px] [[data-density=touch]_&]:w-[220px]"
            placeholder="Search effects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); e.currentTarget.blur() } }}
            aria-label="Search effects"
          />
        </div>
        <Tabs items={tabs} value={category} onChange={setCategory} size="sm" aria-label="Effect categories" className="scrollbar-none -mx-3 overflow-x-auto px-3" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {!hasSelection && <NoTargetsCallout />}
        {shown.length === 0 ? (
          <EmptyState
            icon={LuSearchX}
            title="No effect matches"
            description={`Nothing in this category matches “${query}”.`}
            action={<Button size="sm" variant="ghost" onClick={() => { setQuery(''); setCategory('all') }}>Show all effects</Button>}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 [[data-density=touch]_&]:grid-cols-[repeat(auto-fill,minmax(204px,1fr))] [[data-density=touch]_&]:gap-3">
            {shown.map((t) => (
              <TemplateCard key={t.id} template={t} compat={hasSelection ? compat.get(t.id) ?? 'none' : 'none'} noTargets={!hasSelection} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function NoTargetsCallout() {
  const patch = usePatchStore((s) => s.patch)
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/20 text-info-fg">
        <LuMousePointerClick size={18} aria-hidden />
      </span>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-fg-primary">No fixtures selected</p>
        <p className="text-xs text-fg-secondary">
          Effects run on the selected fixtures. Pick a group or fixtures under Targets (or in the fixture sidebar), then tap an effect.
        </p>
      </div>
      <Button size="sm" variant="primary" onClick={() => usePatchStore.getState().selectFixtures(patch.map((p) => p.id))}>
        Select all fixtures
      </Button>
    </div>
  )
}

const TemplateCard = memo(function TemplateCard({ template: t, compat, noTargets }: { template: EffectTemplate; compat: Compat; noTargets: boolean }) {
  const color = CATEGORY_COLOR[t.category]
  const Icon = t.icon
  const disabled = compat === 'none'
  const channels = useMemo(
    () => t.compound ?? (t.channels ?? ['Dimmer']).map((c, i, list) => ({ channelType: c, phaseOffset: (i * 360) / list.length, depth: 255 })),
    [t]
  )
  const reason = noTargets ? 'Select fixtures first' : disabled ? 'The selected fixtures lack the needed attributes' : undefined
  return (
    <button
      type="button"
      data-fx-template={t.id}
      disabled={disabled}
      onClick={() => applyTemplate(t)}
      title={reason ?? t.description}
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
            <span className="truncate text-sm font-medium text-fg-primary">{t.label}</span>
            {compat === 'partial' && <LuTriangleAlert size={12} aria-label="Some selected fixtures cannot run this" className="shrink-0 text-warning-fg" />}
          </span>
          <span className="truncate text-xs text-fg-tertiary">{disabled && !noTargets ? 'Not supported by the selection' : t.description}</span>
        </span>
      </div>
      <TemplatePreview waveform={t.waveform} channels={channels} color={color} />
      {(t.oneShot || t.spatialMode === 'spatial' || channels.length > 1) && (
        <span className="-mt-0.5 flex flex-wrap gap-1">
          {t.oneShot && <Badge size="xs">ONE-SHOT</Badge>}
          {t.spatialMode === 'spatial' && <Badge size="xs">3D · {t.spatialAxis?.toUpperCase()}</Badge>}
          {channels.length > 1 && <Badge size="xs">{channels.length} ATTRIBUTES</Badge>}
        </span>
      )}
    </button>
  )
})
