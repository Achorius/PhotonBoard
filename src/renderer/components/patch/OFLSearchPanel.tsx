// ============================================================
// Open Fixture Library — online search + download into the user
// library ("update from the internet": the offline catalog is the
// primary source). States: idle, searching (the first search
// downloads the OFL index and can take a while), results, no
// results, error (from the main process), offline.
// ============================================================

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { LuCheck, LuCloudDownload, LuGlobe, LuPackageSearch, LuRefreshCw, LuSearch, LuSearchX, LuServerCrash, LuWifiOff } from 'react-icons/lu'
import type { FixtureDefinition, OFLSearchResult } from '@shared/types'
import { Badge, Button, EmptyState, Skeleton, Spinner, TextInput, cn, fixtureCategoryIcon, toast } from '@renderer/components/ui'
import { t as tr, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'

const SLOW_MS = 2500

function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  // Electron prefixes IPC errors: "Error invoking remote method 'x': Error: …"
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim() || tr('patch.shared.unknownError')
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

type Status = 'idle' | 'searching' | 'done' | 'error'

export function OFLSearchPanel({ onFixtureDownloaded, onOpenCatalog, className }: {
  /** Called after a download (the library is already reloaded) — or when "Use" is pressed on a fixture already in the library */
  onFixtureDownloaded: (def: FixtureDefinition) => void
  /** Switch to the offline catalog (offered when there is no internet) */
  onOpenCatalog?: () => void
  className?: string
}) {
  const t = useT()
  const fixtures = usePatchStore((s) => s.fixtures)
  const online = useOnline()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OFLSearchResult[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<Set<string>>(() => new Set())
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  const search = useCallback(async (q: string) => {
    const id = ++seq.current
    if (!q.trim()) { setStatus('idle'); setResults([]); setError(null); return }
    setStatus('searching')
    setError(null)
    setSlow(false)
    const slowTimer = setTimeout(() => { if (seq.current === id) setSlow(true) }, SLOW_MS)
    try {
      const res = await window.photonboard.fixtures.oflSearch(q.trim())
      if (seq.current !== id) return
      setResults(Array.isArray(res) ? res : [])
      setStatus('done')
    } catch (e) {
      if (seq.current !== id) return
      setResults([])
      setError(errorMessage(e))
      setStatus('error')
    } finally {
      clearTimeout(slowTimer)
      if (seq.current === id) setSlow(false)
    }
  }, [])

  const onInput = (value: string) => {
    setQuery(value)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void search(value) }, 400)
  }

  const download = useCallback(async (r: OFLSearchResult) => {
    const key = `${r.manufacturerKey}/${r.fixtureKey}`
    setDownloading((s) => new Set(s).add(key))
    try {
      const def = await window.photonboard.fixtures.oflDownload(r.manufacturerKey, r.fixtureKey)
      await usePatchStore.getState().loadFixtures()
      toast.success(tr('patch.online.added', { name: def?.name ?? r.name }), {
        description: tr('patch.online.addedDescription', { modes: tr('patch.shared.modeCount', { count: def?.modes.length ?? 0 }), maker: r.manufacturer })
      })
      if (def) onFixtureDownloaded(def)
    } catch (e) {
      toast.error(tr('patch.online.downloadFailed', { name: r.name }), { description: errorMessage(e) })
    } finally {
      setDownloading((s) => { const n = new Set(s); n.delete(key); return n })
    }
  }, [onFixtureDownloaded])

  const local = new Map(fixtures.map((f) => [f.id, f]))
  const catalogButton = onOpenCatalog
    ? <Button size="sm" variant="primary" icon={LuPackageSearch} onClick={onOpenCatalog}>{t('patch.online.openCatalog')}</Button>
    : null

  let body: React.ReactNode
  if (!online && status !== 'done') {
    body = (
      <EmptyState
        size="sm"
        icon={LuWifiOff}
        title={t('patch.online.offlineTitle')}
        description={t('patch.online.offlineDescription')}
        action={(
          <>
            {catalogButton}
            {query && <Button size="sm" variant="secondary" icon={LuRefreshCw} onClick={() => { void search(query) }}>{t('patch.online.tryAgain')}</Button>}
          </>
        )}
      />
    )
  } else if (status === 'idle') {
    body = (
      <EmptyState
        size="sm"
        icon={LuGlobe}
        title={t('patch.online.idleTitle')}
        description={t('patch.online.idleDescription')}
        action={onOpenCatalog ? <Button size="sm" variant="ghost" icon={LuPackageSearch} onClick={onOpenCatalog}>{t('patch.online.openCatalog')}</Button> : undefined}
      />
    )
  } else if (status === 'searching') {
    body = (
      <div className="flex flex-col gap-3 p-3" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-fg-secondary">
          <Spinner size={14} />
          {slow ? t('patch.online.slow') : t('patch.online.searching')}
        </div>
        <Skeleton lines={4} />
      </div>
    )
  } else if (status === 'error') {
    body = (
      <EmptyState
        size="sm"
        icon={LuServerCrash}
        title={t('patch.online.errorTitle')}
        description={error ?? undefined}
        action={(
          <>
            <Button size="sm" variant="secondary" icon={LuRefreshCw} onClick={() => { void search(query) }}>{t('patch.online.tryAgain')}</Button>
            {catalogButton}
          </>
        )}
      />
    )
  } else if (results.length === 0) {
    body = (
      <EmptyState
        size="sm"
        icon={LuSearchX}
        title={t('patch.online.noResultsTitle')}
        description={t('patch.online.noResultsDescription', { query: query.trim() })}
        action={<Button size="sm" variant="ghost" icon={LuRefreshCw} onClick={() => { void search(query) }}>{t('patch.online.searchAgain')}</Button>}
      />
    )
  } else {
    body = (
      <>
        <div className="sticky top-0 z-[1] flex h-control-xs items-center border-b border-line-subtle bg-surface-1 px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
          {results.length >= 50 ? t('patch.online.resultsBest', { count: results.length }) : t('patch.online.results', { count: results.length })}
        </div>
        {results.map((r) => {
          const key = `${r.manufacturerKey}/${r.fixtureKey}`
          return (
            <OFLResultRow
              key={key}
              result={r}
              local={local.get(key)}
              busy={downloading.has(key)}
              onDownload={download}
              onUse={onFixtureDownloaded}
            />
          )
        })}
      </>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 border-b border-line-subtle p-2.5">
        <TextInput
          size="sm"
          icon={LuSearch}
          placeholder={t('patch.online.searchPlaceholder')}
          value={query}
          onChange={(e) => onInput(e.target.value)}
          onClear={() => onInput('')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (debounce.current) clearTimeout(debounce.current); void search(query) }
            else if (e.key === 'Escape' && query) { e.stopPropagation(); onInput('') }
          }}
          trailing={status === 'searching' ? <Spinner size={12} className="text-fg-tertiary" /> : undefined}
          aria-label={t('patch.online.searchAria')}
          data-autofocus=""
        />
      </div>
      <div role="list" aria-label={t('patch.online.listAria')} className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  )
}

const OFLResultRow = memo(function OFLResultRow({ result: r, local, busy, onDownload, onUse }: {
  result: OFLSearchResult
  local: FixtureDefinition | undefined
  busy: boolean
  onDownload: (r: OFLSearchResult) => void
  onUse: (def: FixtureDefinition) => void
}) {
  const t = useT() // memo leaf: re-render on a language change
  const Icon = fixtureCategoryIcon(r.categories)
  return (
    <div role="listitem" className="flex min-h-row items-center gap-2.5 border-b border-line-subtle px-3 py-1.5 last:border-b-0">
      <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg-primary">{r.name}</span>
        <span className="truncate text-xs text-fg-tertiary">{r.manufacturer}{r.categories.length > 0 ? ` · ${r.categories.slice(0, 2).join(', ')}` : ''}</span>
      </div>
      {local ? (
        <>
          <Badge size="xs" tone="go" icon={LuCheck} title={t('patch.shared.inLibrary')}><span className="sr-only">{t('patch.shared.inLibrary')}</span></Badge>
          <Button size="sm" variant="ghost" onClick={() => onUse(local)}>{t('patch.shared.use')}</Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" icon={LuCloudDownload} loading={busy} onClick={() => onDownload(r)}>
          {busy ? t('patch.online.adding') : t('common.add')}
        </Button>
      )}
    </div>
  )
})
