// ============================================================
// Offline fixture catalog — 2,000+ fixtures from the Open Fixture
// Library and QLC+, shipped with the app (no internet needed).
// Search (local, debounced), manufacturer / category filters,
// paged results ("Show more"), preview, add to the library.
// The search runs in the main process; only one page of rows is
// rendered at a time, so it stays fast on the Pi.
// ============================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuCheck, LuCircleAlert, LuPackageX, LuPlus, LuRefreshCw, LuSearch, LuSearchX } from 'react-icons/lu'
import type { FixtureCatalogEntry, FixtureCatalogInfo, FixtureDefinition } from '@shared/types'
import { Badge, Button, EmptyState, Select, Skeleton, Spinner, TextInput, cn, fixtureCategoryIcon, toast } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { catalogCredits, catalogErrorText, installFromCatalog } from './catalog'
import { FixtureDetails } from './FixtureDetails'

const PAGE = 60
const DEBOUNCE_MS = 150
const MAX_CHIPS = 2

type Query = { text?: string; manufacturer?: string; category?: string }

export function CatalogPanel({ info, initialText = '', previewId, onPreview, onFixtureDownloaded, onUse, useLabel, className }: {
  /** From useCatalogInfo(): null while loading */
  info: FixtureCatalogInfo | null
  initialText?: string
  /** Entry shown in the preview pane (highlighted) */
  previewId?: string | null
  /** Tap on a row: preview it */
  onPreview?: (entry: FixtureCatalogEntry) => void
  /** After "Add" (installed + library reloaded), and "Use" on a fixture already in the library */
  onFixtureDownloaded: (def: FixtureDefinition) => void
  /** Overrides "Use" for fixtures already in the library */
  onUse?: (def: FixtureDefinition) => void
  /** Label of the button of fixtures already in the library (default "Use") */
  useLabel?: string
  className?: string
}) {
  const t = useT()
  const fixtures = usePatchStore((s) => s.fixtures)
  const installed = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const [text, setText] = useState(initialText)
  const [debounced, setDebounced] = useState(initialText)
  const [manufacturer, setManufacturer] = useState('')
  const [category, setCategory] = useState('')
  const [entries, setEntries] = useState<FixtureCatalogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const [attempt, setAttempt] = useState(0)
  const seq = useRef(0)
  const query = useRef<Query>({})
  const listRef = useRef<HTMLDivElement>(null)
  const available = info?.available === true

  useEffect(() => {
    if (text === debounced) return
    const id = setTimeout(() => setDebounced(text), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text, debounced])

  // First page for the current search + filters (a newer search wins)
  useEffect(() => {
    if (!available) return
    const id = ++seq.current
    const q: Query = { text: debounced.trim() || undefined, manufacturer: manufacturer || undefined, category: category || undefined }
    query.current = q
    setStatus('loading')
    window.photonboard.fixtures.catalogSearch({ ...q, limit: PAGE, offset: 0 }).then((res) => {
      if (seq.current !== id) return
      setEntries(res.entries)
      setTotal(res.total)
      setStatus('done')
      setError(null)
      listRef.current?.scrollTo({ top: 0 })
    }).catch((e: unknown) => {
      if (seq.current !== id) return
      setError(catalogErrorText(e))
      setStatus('error')
    })
  }, [available, debounced, manufacturer, category, attempt])

  const showMore = async () => {
    const id = seq.current
    setLoadingMore(true)
    try {
      const res = await window.photonboard.fixtures.catalogSearch({ ...query.current, limit: PAGE, offset: entries.length })
      if (seq.current !== id) return
      setEntries((prev) => [...prev, ...res.entries])
      setTotal(res.total)
    } catch (e) {
      toast.error(t('patch.catalog.errorTitle'), { description: catalogErrorText(e) })
    } finally {
      setLoadingMore(false)
    }
  }

  const add = useCallback(async (entry: FixtureCatalogEntry) => {
    setBusy((s) => new Set(s).add(entry.id))
    try {
      const def = await installFromCatalog(entry)
      if (def) onFixtureDownloaded(def)
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(entry.id); return n })
    }
  }, [onFixtureDownloaded])

  const use = useCallback((def: FixtureDefinition) => (onUse ?? onFixtureDownloaded)(def), [onUse, onFixtureDownloaded])

  const filtered = !!text.trim() || !!manufacturer || !!category
  const reset = () => { setText(''); setDebounced(''); setManufacturer(''); setCategory('') }

  const makerOptions = useMemo(
    () => [{ value: '', label: t('patch.library.allMakers') }, ...(info?.manufacturers ?? []).map((m) => ({ value: m.name, label: `${m.name} (${m.count})` }))],
    [info, t]
  )
  const categoryOptions = useMemo(
    () => [{ value: '', label: t('patch.library.allCategories') }, ...(info?.categories ?? []).map((c) => ({ value: c.name, label: `${c.name} (${c.count})` }))],
    [info, t]
  )

  if (info && !info.available) {
    return (
      <div className={cn('flex min-h-0 flex-col', className)}>
        <EmptyState
          size="sm"
          icon={LuPackageX}
          title={t('patch.catalog.unavailableTitle')}
          description={t('patch.catalog.unavailableDescription', { error: info.error ?? t('patch.shared.unknownError') })}
        />
      </div>
    )
  }

  let body: React.ReactNode
  if (status === 'error') {
    body = (
      <EmptyState
        size="sm"
        icon={LuCircleAlert}
        title={t('patch.catalog.errorTitle')}
        description={error ?? undefined}
        action={<Button size="sm" variant="secondary" icon={LuRefreshCw} onClick={() => setAttempt((n) => n + 1)}>{t('patch.catalog.tryAgain')}</Button>}
      />
    )
  } else if (!info || (status === 'loading' && entries.length === 0)) {
    body = (
      <div className="flex flex-col gap-3 p-3" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-fg-secondary"><Spinner size={14} />{t('patch.catalog.loading')}</div>
        <Skeleton lines={5} />
      </div>
    )
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        size="sm"
        icon={LuSearchX}
        title={t('patch.catalog.noMatchTitle')}
        description={debounced.trim() ? t('patch.catalog.noMatchQuery', { query: debounced.trim() }) : t('patch.catalog.noMatchFilters')}
        action={filtered ? <Button size="sm" variant="ghost" onClick={reset}>{t('patch.catalog.clearFilters')}</Button> : undefined}
      />
    )
  } else {
    body = (
      <>
        {entries.map((e) => (
          <CatalogRow
            key={e.id}
            entry={e}
            local={installed.get(e.id)}
            busy={busy.has(e.id)}
            selected={previewId === e.id}
            useLabel={useLabel}
            onPreview={onPreview}
            onAdd={add}
            onUse={use}
          />
        ))}
        {entries.length < total && (
          <div className="flex justify-center p-2.5">
            <Button variant="secondary" className="w-full" loading={loadingMore} onClick={() => { void showMore() }}>
              {t('patch.catalog.showMore')}
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-catalog="">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle p-2.5">
        <TextInput
          size="sm"
          icon={LuSearch}
          placeholder={t('patch.catalog.searchPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onClear={() => { setText(''); setDebounced('') }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setDebounced(text)
            else if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); setDebounced('') }
          }}
          trailing={status === 'loading' && entries.length > 0 ? <Spinner size={12} className="text-fg-tertiary" /> : undefined}
          aria-label={t('patch.catalog.searchAria')}
          disabled={!available}
          data-autofocus=""
        />
        <div className="grid grid-cols-2 gap-2">
          <Select size="sm" aria-label={t('patch.catalog.manufacturerAria')} value={manufacturer} onChange={setManufacturer} options={makerOptions} disabled={!available} />
          <Select size="sm" aria-label={t('patch.catalog.categoryAria')} value={category} onChange={setCategory} options={categoryOptions} disabled={!available} />
        </div>
      </div>

      <div ref={listRef} role="list" aria-label={t('patch.catalog.listAria')} aria-busy={status === 'loading'} className="min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>

      {info?.available && (
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-line-subtle px-3 py-1.5 text-2xs text-fg-tertiary">
          {status === 'done' && (
            <span className="tabular">
              {entries.length < total
                ? t('patch.catalog.resultsOf', { shown: entries.length, count: total })
                : t('patch.catalog.results', { count: total })}
            </span>
          )}
          <span className="line-clamp-2" data-catalog-credits="">{catalogCredits(info)}</span>
        </div>
      )}
    </div>
  )
}

const CatalogRow = memo(function CatalogRow({ entry, local, busy, selected, useLabel, onPreview, onAdd, onUse }: {
  entry: FixtureCatalogEntry
  local: FixtureDefinition | undefined
  busy: boolean
  selected: boolean
  useLabel?: string
  onPreview?: (entry: FixtureCatalogEntry) => void
  onAdd: (entry: FixtureCatalogEntry) => void
  onUse: (def: FixtureDefinition) => void
}) {
  const t = useT() // memo leaf: re-render on a language change
  const Icon = fixtureCategoryIcon(entry.categories)
  const chips = entry.modes.slice(0, MAX_CHIPS)
  const more = entry.modes.length - chips.length
  const sub = [entry.manufacturer, entry.categories.slice(0, 2).join(', ')].filter(Boolean).join(' · ')
  return (
    <div
      role="listitem"
      data-catalog-id={entry.id}
      className={cn(
        'relative flex items-center gap-2 border-b border-line-subtle pr-2.5 [contain-intrinsic-size:auto_64px] [content-visibility:auto]',
        selected ? 'bg-info/15' : 'hover:bg-surface-2'
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-info-fg" />}
      <button
        type="button"
        aria-pressed={onPreview ? selected : undefined}
        onClick={() => onPreview?.(entry)}
        onDoubleClick={() => (local ? onUse(local) : onAdd(entry))}
        className="flex min-h-row min-w-0 flex-1 items-start gap-2.5 self-stretch py-2 pl-3 text-left outline-offset-[-2px]"
      >
        <Icon size={16} aria-hidden className={cn('mt-0.5 shrink-0', selected ? 'text-info-fg' : 'text-fg-tertiary')} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm text-fg-primary">{entry.name}</span>
            <Badge size="xs" tone={entry.source === 'ofl' ? 'go' : 'info'}>{entry.source === 'ofl' ? 'OFL' : 'QLC+'}</Badge>
          </span>
          {sub && <span className="truncate text-xs text-fg-tertiary">{sub}</span>}
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {local && <Badge size="xs" tone="go" icon={LuCheck}>{t('patch.shared.inLibrary')}</Badge>}
            {chips.map((m, i) => (
              // The mode name truncates, the channel count stays readable
              <span
                key={`${i}-${m.name}`}
                title={t('patch.catalog.modeChip', { name: m.name, count: m.channelCount })}
                className="inline-flex min-w-0 max-w-[160px] shrink items-center whitespace-pre rounded-sm bg-surface-3 px-1.5 text-2xs leading-4 text-fg-secondary"
              >
                {t.rich('patch.catalog.modeChip', { name: <span className="min-w-0 truncate">{m.name}</span>, count: m.channelCount })}
              </span>
            ))}
            {more > 0 && <span className="shrink-0 text-2xs tabular text-fg-tertiary">{t('patch.catalog.moreModes', { count: more })}</span>}
          </span>
        </span>
      </button>
      {local ? (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => onUse(local)}>{useLabel ?? t('patch.shared.use')}</Button>
      ) : (
        <Button size="sm" variant="secondary" className="shrink-0" icon={LuPlus} loading={busy} onClick={() => onAdd(entry)}>
          {busy ? t('patch.catalog.adding') : t('common.add')}
        </Button>
      )}
    </div>
  )
})

/** Read-only details of a catalog fixture (loaded on demand; nothing is installed) */
export function CatalogPreview({ id, renderActions }: { id: string; renderActions: (def: FixtureDefinition) => React.ReactNode }) {
  const t = useT()
  const [state, setState] = useState<{ id: string; def: FixtureDefinition | null; error?: string } | null>(null)
  useEffect(() => {
    let alive = true
    window.photonboard.fixtures.catalogGet(id)
      .then((def) => { if (alive) setState({ id, def }) })
      .catch((e: unknown) => { if (alive) setState({ id, def: null, error: catalogErrorText(e) }) })
    return () => { alive = false }
  }, [id])
  if (!state || state.id !== id) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-fg-tertiary" aria-busy="true">
        <Spinner size={14} />{t('patch.catalog.previewLoading')}
      </div>
    )
  }
  if (!state.def) {
    return <EmptyState icon={LuCircleAlert} title={t('patch.catalog.previewFailed')} description={state.error} />
  }
  return <FixtureDetails def={state.def} patchedCount={0} actions={renderActions(state.def)} />
}
