// ============================================================
// Fixture library list — built-in, user, OFL / QLC+ (catalog)
// and GDTF fixtures, searchable, filterable by source /
// manufacturer / category, grouped by manufacturer. Used by the
// Library tab and the "Add fixtures" dialog.
// ============================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuLibrary, LuPackageSearch, LuSearch, LuSearchX } from 'react-icons/lu'
import type { FixtureDefinition } from '@shared/types'
import { Badge, Button, EmptyState, SegmentedControl, Select, TextInput, cn, fixtureCategoryIcon } from '@renderer/components/ui'
import { t as tr, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'

type SourceFilter = 'all' | 'builtin' | 'user' | 'catalog'

/** Grouping key for fixtures without a manufacturer (shown as "Other") */
const NO_MAKER = '\u0000'

export type SourceTone = 'neutral' | 'accent' | 'go' | 'info'

/** Badge for where a definition comes from (translated with the current locale) */
export function sourceLabel(def: Pick<FixtureDefinition, 'source'>): { label: string; tone: SourceTone; builtin: boolean } {
  switch (def.source) {
    case 'user': return { label: tr('patch.library.source.user'), tone: 'accent', builtin: false }
    case 'ofl': return { label: tr('patch.library.source.ofl'), tone: 'go', builtin: false }
    case 'qlcplus': return { label: tr('patch.library.source.qlcplus'), tone: 'info', builtin: false }
    case 'gdtf': return { label: tr('patch.library.source.gdtf'), tone: 'info', builtin: false }
    default: return { label: tr('patch.library.source.builtin'), tone: 'neutral', builtin: true }
  }
}

function matchesSource(def: FixtureDefinition, f: SourceFilter): boolean {
  if (f === 'all') return true
  if (f === 'builtin') return !def.source || def.source === 'builtin'
  if (f === 'user') return def.source === 'user' || def.source === 'gdtf'
  // Open Fixture Library downloads and the offline catalog (OFL + QLC+)
  return def.source === 'ofl' || def.source === 'qlcplus'
}

export function LibraryBrowser({ selectedId, onSelect, onActivate, emptyAction, onSearchCatalog, className }: {
  selectedId: string | null
  onSelect: (def: FixtureDefinition) => void
  /** Double-click / Enter on an item (e.g. patch it) */
  onActivate?: (def: FixtureDefinition) => void
  /** Shown in the empty-library state (catalog / import) */
  emptyAction?: React.ReactNode
  /** "Search the catalog" when nothing matches here (receives the search text) */
  onSearchCatalog?: (query: string) => void
  className?: string
}) {
  const t = useT()
  const fixtures = usePatchStore((s) => s.fixtures)
  const patch = usePatchStore((s) => s.patch)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [manufacturer, setManufacturer] = useState('')
  const [category, setCategory] = useState('')

  const usage = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of patch) map.set(p.fixtureDefId, (map.get(p.fixtureDefId) ?? 0) + 1)
    return map
  }, [patch])

  const manufacturers = useMemo(() => [...new Set(fixtures.map((f) => f.manufacturer || NO_MAKER))].sort((a, b) => a.localeCompare(b)), [fixtures])
  const categories = useMemo(() => [...new Set(fixtures.flatMap((f) => f.categories))].sort((a, b) => a.localeCompare(b)), [fixtures])

  const grouped = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = fixtures.filter((f) => {
      if (!matchesSource(f, source)) return false
      if (manufacturer && (f.manufacturer || NO_MAKER) !== manufacturer) return false
      if (category && !f.categories.includes(category)) return false
      if (terms.length === 0) return true
      const hay = `${f.manufacturer} ${f.name} ${f.categories.join(' ')} ${f.modes.map((m) => m.name).join(' ')}`.toLowerCase()
      return terms.every((term) => hay.includes(term))
    })
    const map = new Map<string, FixtureDefinition[]>()
    for (const f of list) {
      const m = f.manufacturer || NO_MAKER
      const arr = map.get(m)
      if (arr) arr.push(f)
      else map.set(m, [f])
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [fixtures, query, source, manufacturer, category])

  // Bring a preselected type into view (Library → Patch…, downloads)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    if (!el || !listRef.current) return
    const list = listRef.current.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top < list.top + 24 || r.bottom > list.bottom) el.scrollIntoView({ block: 'center' })
  }, [selectedId])

  const total = grouped.reduce((n, [, l]) => n + l.length, 0)
  const filtered = !!query || source !== 'all' || !!manufacturer || !!category
  const reset = () => { setQuery(''); setSource('all'); setManufacturer(''); setCategory('') }
  const makerLabel = (m: string) => (m === NO_MAKER ? t('patch.library.otherMaker') : m)
  const searchCatalog = onSearchCatalog && query.trim() ? () => onSearchCatalog(query.trim()) : undefined

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle p-2.5">
        <TextInput
          size="sm"
          icon={LuSearch}
          placeholder={t('patch.library.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } }}
          aria-label={t('patch.library.searchAria')}
          data-autofocus=""
        />
        <SegmentedControl
          size="xs"
          fullWidth
          aria-label={t('patch.library.sourceAria')}
          value={source}
          onChange={setSource}
          items={[
            { value: 'all', label: t('common.all') },
            { value: 'builtin', label: t('patch.library.source.builtin') },
            { value: 'user', label: t('patch.library.source.user') },
            { value: 'catalog', label: t('patch.library.catalogFilter') }
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <Select
            size="sm"
            aria-label={t('patch.library.manufacturer')}
            value={manufacturer}
            onChange={setManufacturer}
            options={[{ value: '', label: t('patch.library.allMakers') }, ...manufacturers.map((m) => ({ value: m, label: makerLabel(m) }))]}
          />
          <Select
            size="sm"
            aria-label={t('patch.library.category')}
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: t('patch.library.allCategories') }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      </div>

      <div ref={listRef} role="listbox" aria-label={t('patch.library.listAria')} className="min-h-0 flex-1 overflow-y-auto" data-library-list="">
        {fixtures.length === 0 ? (
          <EmptyState size="sm" icon={LuLibrary} title={t('patch.library.emptyTitle')} description={t('patch.library.emptyDescription')} action={emptyAction} />
        ) : total === 0 ? (
          <EmptyState
            size="sm"
            icon={LuSearchX}
            title={t('patch.library.noMatchTitle')}
            description={query ? t('patch.library.noMatchQuery', { query }) : t('patch.library.noMatchFilters')}
            action={filtered ? (
              <>
                {searchCatalog && <Button size="sm" variant="secondary" icon={LuPackageSearch} onClick={searchCatalog}>{t('patch.library.searchCatalog')}</Button>}
                <Button size="sm" variant="ghost" onClick={reset}>{t('patch.library.clearFilters')}</Button>
              </>
            ) : undefined}
          />
        ) : grouped.map(([mfr, list]) => (
          <div key={mfr} role="group" aria-label={makerLabel(mfr)}>
            <div className="sticky top-0 z-[1] flex h-control-xs items-center justify-between border-b border-line-subtle bg-surface-1 px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
              <span className="truncate">{makerLabel(mfr)}</span>
              <span className="tabular">{list.length}</span>
            </div>
            {list.map((f) => (
              <LibraryItem key={f.id} def={f} used={usage.get(f.id) ?? 0} selected={f.id === selectedId} onSelect={onSelect} onActivate={onActivate} />
            ))}
          </div>
        ))}
      </div>
      {fixtures.length > 0 && (
        <div className="flex h-control-sm shrink-0 items-center border-t border-line-subtle px-3 text-2xs tabular text-fg-tertiary">
          {filtered ? t('patch.library.countFiltered', { shown: total, count: fixtures.length }) : t('patch.library.countAll', { count: fixtures.length })}
        </div>
      )}
    </div>
  )
}

const LibraryItem = memo(function LibraryItem({ def, used, selected, onSelect, onActivate }: {
  def: FixtureDefinition
  used: number
  selected: boolean
  onSelect: (def: FixtureDefinition) => void
  onActivate?: (def: FixtureDefinition) => void
}) {
  const t = useT() // memo leaf: re-render on a language change
  const Icon = fixtureCategoryIcon(def.categories)
  const src = sourceLabel(def)
  const channels = def.modes.map((m) => m.channelCount)
  const min = Math.min(...channels)
  const max = Math.max(...channels)
  const chText = channels.length === 0
    ? t('patch.library.noModes')
    : min === max ? t('units.channelsShortValue', { count: min }) : t('patch.library.channelRange', { min, max })
  const patched = t('patch.shared.patchedCount', { count: used })
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(def)}
      onDoubleClick={() => onActivate?.(def)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (selected && onActivate) onActivate(def); else onSelect(def) }
        else if (e.key === ' ') { e.preventDefault(); onSelect(def) }
      }}
      className={cn(
        'relative flex min-h-row cursor-pointer items-center gap-2.5 px-3 py-1.5 outline-offset-[-2px]',
        selected ? 'bg-info/15' : 'hover:bg-surface-2'
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-info-fg" />}
      <Icon size={16} aria-hidden className={cn('shrink-0', selected ? 'text-info-fg' : 'text-fg-tertiary')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg-primary">{def.name}</span>
        <span className="truncate text-xs text-fg-tertiary">
          {[def.categories.slice(0, 2).join(', '), t('patch.shared.modeCount', { count: def.modes.length }), chText].filter(Boolean).join(' · ')}
        </span>
      </span>
      {used > 0 && <Badge size="xs" tone="info" title={patched}>{patched}</Badge>}
      {!src.builtin && <Badge size="xs" tone={src.tone}>{src.label}</Badge>}
    </div>
  )
})
