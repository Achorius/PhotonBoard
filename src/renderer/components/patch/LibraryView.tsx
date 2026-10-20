// ============================================================
// Library tab — browse fixture types (built-in, user, OFL, QLC+,
// GDTF), read their modes and channels, patch, edit, delete,
// import. Sources: the offline catalog (OFL + QLC+, shipped with
// the app — the primary one), the local library, and the Open
// Fixture Library website ("update from the internet").
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuCopy, LuFileUp, LuGlobe, LuLibrary, LuPackageSearch, LuPencil, LuPencilRuler, LuPlus, LuTrash2, LuTriangleAlert } from 'react-icons/lu'
import type { FixtureDefinition } from '@shared/types'
import { Badge, Button, EmptyState, ResizeHandle, Tabs, toast, useResizable } from '@renderer/components/ui'
import { t as tr, useT } from '@renderer/i18n'
import { deleteWithUndo, useSelectionActions } from '@renderer/lib/selection-actions'
import { usePatchStore } from '@renderer/stores/patch-store'
import { canImportFiles, importFixtureFiles } from './patch-hooks'
import { LibraryBrowser } from './LibraryBrowser'
import { FixtureDetails } from './FixtureDetails'
import { FixtureEditor, editorModeFor } from './FixtureEditor'
import { OFLSearchPanel } from './OFLSearchPanel'
import { CatalogPanel, CatalogPreview } from './CatalogPanel'
import { installFromCatalog, useCatalogInfo } from './catalog'

type EditorState = { fixture?: FixtureDefinition; asCopy: boolean } | null
type SourceTab = 'catalog' | 'library' | 'online'

const TAB_KEY = 'photonboard.patch.librarySource'

function readTab(): SourceTab {
  try {
    const v = window.localStorage.getItem(TAB_KEY)
    if (v === 'catalog' || v === 'library' || v === 'online') return v
  } catch { /* ignore */ }
  return 'catalog'
}

/** Remove a user fixture type file (not part of the show: no undo) */
async function removeDefinition(def: FixtureDefinition, onDone: () => void): Promise<void> {
  try {
    const res = await window.photonboard.fixtures.delete(def.id)
    if (res && res.success === false) { toast.error(tr('patch.library.notDeleted'), { description: res.error }); return }
    await usePatchStore.getState().loadFixtures()
    onDone()
  } catch (e) {
    toast.error(tr('patch.library.notDeleted'), { description: (e as Error).message })
  }
}

export function LibraryView({ onPatch }: { onPatch: (defId: string) => void }) {
  const t = useT()
  const fixtures = usePatchStore((s) => s.fixtures)
  const patch = usePatchStore((s) => s.patch)
  const catalog = useCatalogInfo()
  const catalogOff = catalog?.available === false
  const [tab, setTabState] = useState<SourceTab>(readTab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [catalogSeed, setCatalogSeed] = useState({ text: '', n: 0 })
  const [editor, setEditor] = useState<EditorState>(null)
  const side = useResizable({ initial: 360, min: 280, max: 560, storageKey: 'patch.library' })
  const rootRef = useRef<HTMLDivElement>(null)

  const setTab = (next: SourceTab) => {
    setTabState(next)
    try { window.localStorage.setItem(TAB_KEY, next) } catch { /* ignore */ }
  }
  const shownTab: SourceTab = tab === 'catalog' && catalogOff ? 'library' : tab
  useEffect(() => { if (catalogOff && tab === 'catalog') setTabState('library') }, [catalogOff, tab])

  const def = useMemo(() => fixtures.find((f) => f.id === selectedId) ?? null, [fixtures, selectedId])
  const patchedCount = useMemo(() => (def ? patch.filter((p) => p.fixtureDefId === def.id).length : 0), [patch, def])
  const builtin = !!def && (!def.source || def.source === 'builtin')

  const deleteLabel = (d: FixtureDefinition) => tr('patch.selection.fixtureType', { name: d.name })
  const deleteConfirm = () => ({ message: tr('patch.library.deleteMessage'), confirmLabel: tr('patch.library.deleteAction') })
  const runDelete = (d: FixtureDefinition) => { void removeDefinition(d, () => setSelectedId((cur) => (cur === d.id ? null : cur))) }

  const remove = (d: FixtureDefinition) => {
    if (patchedCount > 0) {
      toast.warning(t('patch.library.inUse', { name: d.name }), { description: t('patch.library.inUseDescription', { count: patchedCount }) })
      return
    }
    void deleteWithUndo({ label: deleteLabel(d), confirm: deleteConfirm(), run: () => runDelete(d) })
  }

  // Delete key on a selected user fixture type (built-in and patched types cannot be deleted)
  useSelectionActions(shownTab === 'library' && def && !builtin ? {
    label: () => deleteLabel(def),
    canDelete: () => patchedCount === 0,
    delete: () => runDelete(def),
    confirmDelete: deleteConfirm()
  } : null, { scope: rootRef })

  const importFiles = async () => {
    const ids = await importFixtureFiles()
    if (ids.length > 0) { setSelectedId(ids[0]); setTab('library') }
  }

  const openCatalog = (text = '') => {
    setCatalogSeed((s) => ({ text, n: s.n + 1 }))
    setTab('catalog')
  }

  // Right pane: catalog preview while browsing the catalog, else the selected library type
  let details: React.ReactNode
  if (shownTab === 'catalog') {
    details = previewId ? (
      <CatalogPreview
        id={previewId}
        renderActions={(d) => {
          const local = fixtures.find((f) => f.id === d.id)
          return local ? (
            <>
              <Badge tone="go">{t('patch.shared.inLibrary')}</Badge>
              <Button size="sm" variant="ghost" icon={LuLibrary} onClick={() => { setSelectedId(local.id); setTab('library') }}>{t('patch.view.tabs.library')}</Button>
              <Button size="sm" variant="primary" icon={LuPlus} onClick={() => onPatch(local.id)}>{t('patch.shared.patchEllipsis')}</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" icon={LuPlus} onClick={() => { void installFromCatalog(d).then((x) => { if (x) setSelectedId(x.id) }) }}>{t('patch.library.addToLibrary')}</Button>
              <Button size="sm" variant="primary" icon={LuPlus} onClick={() => { void installFromCatalog(d).then((x) => { if (x) onPatch(x.id) }) }}>{t('patch.shared.patchEllipsis')}</Button>
            </>
          )
        }}
      />
    ) : (
      <EmptyState icon={LuPackageSearch} title={t('patch.library.previewTitle')} description={t('patch.library.previewDescription')} />
    )
  } else if (def) {
    details = (
      <FixtureDetails
        def={def}
        patchedCount={patchedCount}
        actions={(
          <>
            {builtin ? (
              <Button size="sm" variant="ghost" icon={LuCopy} onClick={() => setEditor(editorModeFor(def))} tooltip={t('patch.library.editCopyTooltip')}>{t('patch.library.editCopy')}</Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" icon={LuPencil} onClick={() => setEditor(editorModeFor(def))}>{t('common.edit')}</Button>
                <Button
                  size="sm"
                  variant="danger-outline"
                  icon={LuTrash2}
                  tooltip={patchedCount > 0 ? t('patch.library.deleteBlockedTooltip') : t('patch.library.deleteTooltip')}
                  shortcut={patchedCount > 0 ? undefined : 'Backspace'}
                  onClick={() => remove(def)}
                >
                  {t('common.delete')}
                </Button>
              </>
            )}
            <Button size="sm" variant="primary" icon={LuPlus} onClick={() => onPatch(def.id)}>{t('patch.shared.patchEllipsis')}</Button>
          </>
        )}
      />
    )
  } else {
    details = (
      <EmptyState
        icon={LuLibrary}
        title={t('patch.library.selectTitle')}
        description={t('patch.library.selectDescription')}
        action={!catalogOff ? <Button variant="secondary" icon={LuPackageSearch} onClick={() => openCatalog()}>{t('patch.library.browseCatalog')}</Button> : undefined}
      />
    )
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <div className="flex shrink-0 flex-col border-r border-line bg-surface-1" style={{ width: side.size }}>
        <div className="flex h-control-lg shrink-0 items-center gap-1 border-b border-line-subtle px-2">
          <Button size="sm" variant="ghost" icon={LuPencilRuler} onClick={() => setEditor({ asCopy: false })}>{t('patch.shared.newType')}</Button>
          {canImportFiles() && <Button size="sm" variant="ghost" icon={LuFileUp} onClick={() => { void importFiles() }} tooltip={t('patch.library.importTooltip')}>{t('common.import')}</Button>}
        </div>
        <div className="shrink-0 px-2.5 pt-1">
          <Tabs
            size="sm"
            fit
            aria-label={t('patch.library.tabsAria')}
            value={shownTab}
            onChange={setTab}
            items={[
              ...(catalogOff ? [] : [{ id: 'catalog' as const, label: t('patch.add.tabs.catalog'), icon: LuPackageSearch, 'data-source-tab': 'catalog' }]),
              { id: 'library' as const, label: t('patch.add.tabs.library'), icon: LuLibrary, 'data-source-tab': 'library' },
              { id: 'online' as const, label: t('patch.add.tabs.online'), icon: LuGlobe, 'data-source-tab': 'online' }
            ]}
          />
        </div>
        {catalogOff && (
          <p className="flex shrink-0 items-center gap-1.5 px-3 pt-1.5 text-2xs text-warning-fg" title={catalog?.error}>
            <LuTriangleAlert size={12} aria-hidden className="shrink-0" />
            <span className="truncate">{t('patch.add.catalogUnavailable')}{catalog?.error ? ` — ${catalog.error}` : ''}</span>
          </p>
        )}
        {shownTab === 'catalog' ? (
          <CatalogPanel
            key={catalogSeed.n}
            className="flex-1"
            info={catalog}
            initialText={catalogSeed.text}
            previewId={previewId}
            onPreview={(e) => setPreviewId(e.id)}
            onFixtureDownloaded={(d) => { setSelectedId(d.id); setPreviewId(d.id) }}
            onUse={(d) => onPatch(d.id)}
            useLabel={t('patch.shared.patchEllipsis')}
          />
        ) : shownTab === 'library' ? (
          <LibraryBrowser
            className="flex-1"
            selectedId={selectedId}
            onSelect={(d) => setSelectedId(d.id)}
            onActivate={(d) => onPatch(d.id)}
            onSearchCatalog={catalogOff ? undefined : (q) => openCatalog(q)}
            emptyAction={!catalogOff ? <Button size="sm" variant="primary" icon={LuPackageSearch} onClick={() => openCatalog()}>{t('patch.library.browseCatalog')}</Button> : undefined}
          />
        ) : (
          <OFLSearchPanel
            className="flex-1"
            onOpenCatalog={catalogOff ? undefined : () => openCatalog()}
            onFixtureDownloaded={(d) => { setSelectedId(d.id); setTab('library') }}
          />
        )}
      </div>
      <ResizeHandle {...side.handleProps} />
      <div className="min-w-0 flex-1">{details}</div>

      {editor && (
        <FixtureEditor
          fixture={editor.fixture}
          asCopy={editor.asCopy}
          onClose={() => setEditor(null)}
          onSaved={(d) => { setSelectedId(d.id); setTab('library') }}
        />
      )}
    </div>
  )
}
