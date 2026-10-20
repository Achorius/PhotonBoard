// ============================================================
// Stage pages — user touch pages (grandMA "user pages"): a grid of
// widgets (executors, faders, macros, presets, groups, masters, speed
// masters, GO / Back, clock, labels) stored in the show
// (pool-store.stagePages) and played on:
//   - the in-app "Stage" view (StagePagesView, this file: play + designer)
//   - the Stage window (Executors / Pages toggle) and the tablet remote
//     (StagePagesPlayer: play only)
// Designer (Arrange): long-press-then-drag like the executor bar, corner
// handle to resize, tap an empty cell to add, inspector on the right.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LuCheck, LuChevronDown, LuEllipsisVertical, LuGrid3X3, LuLayoutDashboard, LuMove, LuPencil, LuPlus, LuSparkles, LuTrash2
} from 'react-icons/lu'
import { v4 as uuidv4 } from 'uuid'
import type { StagePage, StageWidget, StageWidgetKind } from '@shared/types'
import {
  Button, DropdownMenu, EmptyState, IconButton, Tabs, cn, prompt, toast, useContextMenu, type MenuEntry
} from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import { historyStep } from '@renderer/lib/history'
import { deleteWithUndo, useSelectionActions } from '@renderer/lib/selection-actions'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useDensity } from '@renderer/stores/ui-store'
import { getStoreActions, useSurfaceData } from './surface-store'
import { indexSurface, type SurfaceIndex } from './surface-data'
import type { SurfaceActions } from './surface-actions'
import { StagePageGrid } from './StagePageGrid'
import { WidgetInspector } from './WidgetInspector'
import { WIDGET_ICON } from './widget-icons'
import {
  STAGE_GRID_MAX, STAGE_GRID_MIN, WIDGET_DEFAULT_SIZE, WIDGET_KINDS, findFreeSpot, fitWidgetsToGrid, starterWidgets, type Rect, type StarterSource
} from './page-layout'
import { encodeExecRef } from '../executor-surface'
import type { WidgetContext } from './StageWidgets'
import { STAGE_PAGE_PREF, stagePageName, useCurrentStagePage } from './StagePagesPlayer'

export { StagePagesPlayer, stagePageName } from './StagePagesPlayer'

const useCurrentPage = useCurrentStagePage
const PAGE_PREF = STAGE_PAGE_PREF

// ---------------------------------------------------------------
// Store operations (one undo step each)
// ---------------------------------------------------------------

function createPage(starter: StarterSource | null): string {
  const n = usePoolStore.getState().stagePages.length + 1
  let id = ''
  historyStep(t('pro.stage.undo.addStagePage'), () => {
    const widgets: StageWidget[] = starter ? starterWidgets(starter).map((w) => ({ ...w, id: uuidv4() })) : []
    id = usePoolStore.getState().addStagePage({ name: t('pro.defaults.stagePage', { n }), cols: 8, rows: 6, widgets })
  })
  return id
}

function addWidget(page: StagePage, kind: StageWidgetKind, at?: { x: number; y: number }): string | null {
  const size = WIDGET_DEFAULT_SIZE[kind]
  const spot = findFreeSpot(page, size.w, size.h, at)
  if (!spot) { toast.warning(t('pro.stage.designer.pageFull')); return null }
  const widget: Omit<StageWidget, 'id'> = { kind, ...spot }
  if (kind === 'executor') widget.ref = encodeExecRef({ page: 'current', col: 0, row: 0 })
  if (kind === 'master') widget.options = { fn: 'gm' }
  if (kind === 'fader') widget.options = { target: 'gm' }
  let id: string | null = null
  historyStep(t('pro.stage.undo.addWidget'), () => { id = usePoolStore.getState().addStageWidget(page.id, widget, uuidv4()) })
  return id
}

function duplicateWidget(page: StagePage, w: StageWidget): string | null {
  const spot = findFreeSpot(page, w.w, w.h, { x: w.x + w.w, y: w.y })
  if (!spot) { toast.warning(t('pro.stage.designer.pageFull')); return null }
  const { id: _id, ...rest } = w
  let id: string | null = null
  historyStep(t('pro.stage.undo.addWidget'), () => { id = usePoolStore.getState().addStageWidget(page.id, { ...rest, ...spot, options: rest.options ? { ...rest.options } : undefined }, uuidv4()) })
  return id
}

function widgetLabel(w: StageWidget): string {
  return t('pro.stage.designer.widgetLabel', { kind: t(`pro.stage.widgetKinds.${w.kind}`) })
}

function deleteWidget(page: StagePage, w: StageWidget): void {
  void deleteWithUndo({ label: widgetLabel(w), run: () => usePoolStore.getState().removeStageWidget(page.id, w.id), confirm: false })
}

function resizeGrid(page: StagePage, cols: number, rows: number): void {
  const c = Math.max(STAGE_GRID_MIN, Math.min(STAGE_GRID_MAX, Math.round(cols)))
  const r = Math.max(STAGE_GRID_MIN, Math.min(STAGE_GRID_MAX, Math.round(rows)))
  if (c === page.cols && r === page.rows) return
  const fitted = fitWidgetsToGrid(page.widgets, c, r)
  const dropped = page.widgets.length - fitted.length
  historyStep(t('pro.stage.undo.gridSize'), () => {
    const pool = usePoolStore.getState()
    pool.updateStagePage(page.id, { cols: c, rows: r })
    const kept = new Set(fitted.map((w) => w.id))
    for (const w of page.widgets) if (!kept.has(w.id)) pool.removeStageWidget(page.id, w.id)
    for (const w of fitted) pool.updateStageWidget(page.id, w.id, { x: w.x, y: w.y, w: w.w, h: w.h })
  })
  if (dropped > 0) toast.warning(t('pro.stage.designer.widgetsDropped', { count: dropped }))
}

async function renamePage(page: StagePage, index: number): Promise<void> {
  const name = await prompt({
    title: t('pro.stage.designer.renameTitle'),
    label: t('pro.stage.designer.renameLabel'),
    defaultValue: page.name,
    placeholder: stagePageName(page, index),
    confirmLabel: t('common.rename')
  })
  if (name === null) return
  historyStep(t('pro.stage.undo.renameStagePage'), () => usePoolStore.getState().updateStagePage(page.id, { name: name.trim() }))
}

function deletePage(page: StagePage, index: number): void {
  void deleteWithUndo({
    label: t('pro.stage.designer.pageLabel', { name: stagePageName(page, index) }),
    run: () => usePoolStore.getState().removeStagePage(page.id)
  })
}

const GRID_PRESETS: [number, number][] = [[4, 3], [6, 4], [8, 6], [10, 6], [12, 8], [16, 9]]

// ---------------------------------------------------------------
// In-app view: play + designer
// ---------------------------------------------------------------

export function StagePagesView() {
  const tr = useT()
  const density = useDensity()
  const data = useSurfaceData()
  const index = useMemo(() => indexSurface(data), [data])
  const actions = getStoreActions()
  const pages = data.stagePages
  const [page, choose] = useCurrentPage(pages, PAGE_PREF)
  const pageIndex = page ? pages.indexOf(page) : -1
  const [arranging, setArranging] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const addMenu = useContextMenu()
  const viewRef = useRef<HTMLDivElement>(null)
  const size = density === 'touch' ? 'lg' : 'md'
  const ctx = useMemo<WidgetContext>(() => ({ index, actions, size, interactive: !arranging }), [index, actions, size, arranging])
  const selected = page?.widgets.find((w) => w.id === selectedId) ?? null

  useEffect(() => { if (!arranging) setSelectedId(null) }, [arranging])
  useEffect(() => { setSelectedId(null) }, [page?.id])

  // Delete / Mod+D on the selected widget (designer)
  useSelectionActions(arranging && page && selected ? {
    label: () => widgetLabel(selected),
    confirmDelete: false,
    delete: () => usePoolStore.getState().removeStageWidget(page.id, selected.id),
    duplicate: () => { const id = duplicateWidget(page, selected); if (id) setSelectedId(id) }
  } : null, { scope: viewRef })

  const newPage = (starter: boolean) => {
    const id = createPage(starter ? { groups: data.groups, presets: data.presets, macros: data.macros } : null)
    if (id) { choose(id); if (!starter) setArranging(true) }
  }

  const newPageMenu = (): MenuEntry[] => [
    { label: tr('pro.stage.designer.starterPage'), icon: LuSparkles, description: tr('pro.stage.designer.starterHint'), onSelect: () => newPage(true) },
    { label: tr('pro.stage.designer.emptyPage'), icon: LuGrid3X3, onSelect: () => newPage(false) }
  ]
  const pageMenu = (): MenuEntry[] => page ? [
    { label: tr('pro.stage.designer.rename'), icon: LuPencil, onSelect: () => { void renamePage(page, pageIndex) } },
    {
      label: tr('pro.stage.designer.gridSize'),
      icon: LuGrid3X3,
      description: tr('pro.stage.designer.gridValue', { cols: page.cols, rows: page.rows }),
      submenu: GRID_PRESETS.map(([c, r]): MenuEntry => ({
        label: tr('pro.stage.designer.gridValue', { cols: c, rows: r }),
        checked: page.cols === c && page.rows === r,
        onSelect: () => resizeGrid(page, c, r)
      }))
    },
    { type: 'separator' },
    { label: tr('pro.stage.designer.deletePage'), icon: LuTrash2, danger: true, onSelect: () => deletePage(page, pageIndex) }
  ] : []

  const openAddMenu = (x: number, y: number, anchor: DOMRect) => {
    if (!page) return
    addMenu.open({ clientX: anchor.left + 8, clientY: anchor.top + 8, preventDefault: () => {} }, [
      { type: 'label', label: tr('pro.stage.designer.addWidget') },
      ...WIDGET_KINDS.map((k): MenuEntry => ({
        label: tr(`pro.stage.widgetKinds.${k}`),
        icon: WIDGET_ICON[k],
        description: tr(`pro.stage.widgetHints.${k}`),
        onSelect: () => { const id = addWidget(page, k, { x, y }); if (id) setSelectedId(id) }
      }))
    ])
  }

  const onCommit = (id: string, rect: Rect) => {
    if (!page) return
    const w = page.widgets.find((x) => x.id === id)
    if (!w || (w.x === rect.x && w.y === rect.y && w.w === rect.w && w.h === rect.h)) return
    const moved = w.w === rect.w && w.h === rect.h
    historyStep(moved ? tr('pro.stage.undo.moveWidget') : tr('pro.stage.undo.resizeWidget'), () => {
      usePoolStore.getState().updateStageWidget(page.id, id, rect)
    })
  }

  return (
    <div ref={viewRef} className="flex h-full min-h-0 flex-col">
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line px-3">
        <LuLayoutDashboard size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <h2 className="shrink-0 text-sm font-semibold text-fg-primary">{tr('pro.stage.designer.title')}</h2>
        {pages.length > 0 && page && (
          <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
            <Tabs
              variant="pill"
              size="sm"
              aria-label={tr('pro.stage.designer.pagesAria')}
              items={pages.map((p, i) => ({ id: p.id, label: stagePageName(p, i), badge: p.widgets.length || undefined }))}
              value={page.id}
              onChange={choose}
            />
          </div>
        )}
        {!(pages.length > 0 && page) && <span className="flex-1" />}
        {page && (
          <Button
            size="sm"
            tone="info"
            variant={arranging ? 'primary' : 'secondary'}
            active={arranging}
            icon={arranging ? LuCheck : LuMove}
            onClick={() => setArranging((a) => !a)}
            tooltip={arranging ? tr('pro.stage.designer.doneTooltip') : tr('pro.stage.designer.arrangeTooltip')}
          >
            {arranging ? tr('common.done') : tr('pro.stage.designer.arrange')}
          </Button>
        )}
        <DropdownMenu
          items={newPageMenu}
          placement="bottom-end"
          trigger={(p) => (
            <Button {...p} size="sm" variant="ghost" icon={LuPlus} iconRight={LuChevronDown} labelClassName="hidden lg:inline" aria-label={tr('pro.stage.designer.newPage')}>
              {tr('pro.stage.designer.newPage')}
            </Button>
          )}
        />
        {page && (
          <DropdownMenu
            items={pageMenu}
            placement="bottom-end"
            trigger={(p) => <IconButton {...p} icon={LuEllipsisVertical} size="sm" label={tr('pro.stage.designer.pageOptions')} />}
          />
        )}
      </header>

      {!page ? (
        <EmptyState
          icon={LuLayoutDashboard}
          title={tr('pro.stage.designer.emptyTitle')}
          description={tr('pro.stage.designer.emptyDescription')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={LuSparkles} onClick={() => newPage(true)}>{tr('pro.stage.designer.starterPage')}</Button>
              <Button variant="secondary" icon={LuGrid3X3} onClick={() => newPage(false)}>{tr('pro.stage.designer.emptyPage')}</Button>
            </div>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
            <StagePageGrid
              page={page}
              ctx={ctx}
              arranging={arranging}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCommit={onCommit}
              onAddAt={openAddMenu}
            />
            {arranging && (
              <p className="shrink-0 text-center text-xs text-info-fg">{tr('pro.stage.designer.arrangeHint')}</p>
            )}
          </div>
          {arranging && (
            <aside aria-label={tr('pro.stage.designer.inspectorAria')} className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-1 p-3 [[data-density=touch]_&]:w-[340px]">
              {selected ? (
                <WidgetInspector
                  page={page}
                  widget={selected}
                  index={index}
                  onDelete={() => { deleteWidget(page, selected); setSelectedId(null) }}
                  onDuplicate={() => { const id = duplicateWidget(page, selected); if (id) setSelectedId(id) }}
                />
              ) : (
                <WidgetPalette onAdd={(k) => { const id = addWidget(page, k); if (id) setSelectedId(id) }} />
              )}
            </aside>
          )}
        </div>
      )}
      {addMenu.menu}
    </div>
  )
}

/** Inspector with nothing selected: add a widget */
function WidgetPalette({ onAdd }: { onAdd: (kind: StageWidgetKind) => void }) {
  const tr = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-fg-primary">{tr('pro.stage.designer.addWidget')}</p>
        <p className="text-xs text-fg-tertiary">{tr('pro.stage.designer.paletteHint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {WIDGET_KINDS.map((k) => {
          const Icon = WIDGET_ICON[k]
          return (
            <button
              key={k}
              type="button"
              onClick={() => onAdd(k)}
              title={tr(`pro.stage.widgetHints.${k}`)}
              className="flex h-control-lg min-w-0 items-center gap-2 rounded-md border border-line-subtle bg-surface-2 px-2.5 text-left text-sm text-fg-primary transition-colors duration-fast hover:bg-surface-3 active:bg-surface-4"
            >
              <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
              <span className="truncate">{tr(`pro.stage.widgetKinds.${k}`)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default StagePagesView
