// ============================================================
// Stage layout view: top-view plan editor + section view + inspector.
// Also what the "3D" tab shows on weak GPUs (see App.tsx).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LuAlignHorizontalSpaceAround, LuCable, LuFileDown, LuFlipHorizontal2, LuGrid3X3, LuLayoutGrid, LuMagnet, LuPanelBottom,
  LuPlus, LuRotateCcw, LuScan, LuX, LuZoomIn, LuZoomOut
} from 'react-icons/lu'
import {
  Button, Divider, EmptyState, IconButton, Section, Select, ToggleButton, ToolbarGroup, formatPercent, toast
} from '@renderer/components/ui'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { exportStagePDF } from '@renderer/lib/pdf-export'
import { formatNumber, useT, type TFunction } from '@renderer/i18n'
import { LayoutEditor2D, type LayoutEditorHandle } from './editor/LayoutEditor2D'
import { SideView } from './editor/SideView'
import { FixturePropertiesPanel } from './editor/FixturePropertiesPanel'
import { RoomPropertiesPanel, TrussPropertiesPanel } from './editor/RigPanels'
import { flipFixtures, formatMetres, hangOnBar, mountOptions, resetPlacement, setMount } from './editor/rig-actions'
import { RigSelectionActions } from './editor/RigSelectionActions'
import { SelectionControls } from './SelectionControls'

const GRID_SIZES = [0.1, 0.25, 0.5, 1]

function gridOptions(t: TFunction) {
  return GRID_SIZES.map((m) => ({
    value: String(m),
    label: m < 1 ? t('layout.centimetres', { value: formatNumber(m * 100, {}, t.locale) }) : formatMetres(m, 0, t)
  }))
}

export function StageLayoutView() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const editor = useRef<LayoutEditorHandle>(null)
  // Zoom changes stream at pointer rate: only the readout re-renders
  const zoomListener = useRef<((scale: number, fit: number) => void) | null>(null)
  const onScale = useCallback((scale: number, fit: number) => zoomListener.current?.(scale, fit), [])
  // The section view eats plan height: on by default on desktops, off on the touch kiosk
  const [showSection, setShowSection] = useState(() => useUiStore.getState().density !== 'touch')
  const snapToGrid = useVisualizerStore((s) => s.snapToGrid)
  const gridSize = useVisualizerStore((s) => s.gridSize)
  const showGrid = useVisualizerStore((s) => s.showGrid)
  const selectedFixtureId = useVisualizerStore((s) => s.selectedFixtureId)
  const selectedTrussId = useVisualizerStore((s) => s.selectedTrussId)
  const bars = useVisualizerStore((s) => s.roomConfig.trussBars)
  const selectedCount = usePatchStore((s) => s.selectedFixtureIds.length)
  const patchCount = usePatchStore((s) => s.patch.length)
  const bar = bars.find((b) => b.id === selectedTrussId)
  const vis = useVisualizerStore.getState()

  const exportPdf = () => {
    try {
      const { patch, fixtures, groups } = usePatchStore.getState()
      exportStagePDF(patch, fixtures, useVisualizerStore.getState().roomConfig, useUiStore.getState().showName, groups)
      toast.success(t('layout.toolbar.exported'))
    } catch (err) {
      toast.error(t('layout.toolbar.exportFailed'), { description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <RigSelectionActions scope={rootRef} bars />
      <header className="flex h-control-lg shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface-1 px-3">
        <LuLayoutGrid size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <h1 className="shrink-0 text-sm font-semibold text-fg-primary">{t('layout.title')}</h1>
        <Divider />
        <Button size="sm" variant="ghost" icon={LuPlus} onClick={() => vis.addTrussBar()}>{t('layout.toolbar.addBar')}</Button>
        <Divider />
        <ToolbarGroup aria-label={t('layout.toolbar.gridGroup')}>
          <ToggleButton size="sm" variant="ghost" tone="neutral" icon={LuGrid3X3} pressed={showGrid} onPressedChange={vis.setShowGrid} tooltip={t('layout.toolbar.gridHint')} labelClassName="hidden 2xl:inline">{t('layout.toolbar.grid')}</ToggleButton>
          <ToggleButton size="sm" variant="ghost" tone="neutral" icon={LuMagnet} pressed={snapToGrid} onPressedChange={vis.setSnapToGrid} tooltip={t('layout.toolbar.snapHint')}>{t('layout.toolbar.snap')}</ToggleButton>
          <Select size="sm" aria-label={t('layout.toolbar.gridSize')} value={String(gridSize)} options={gridOptions(t)} onChange={(v) => vis.setGridSize(Number(v))} className="w-[88px] [[data-density=touch]_&]:w-[104px]" />
        </ToolbarGroup>
        <Divider />
        <ZoomControls editor={editor} listener={zoomListener} />
        <div className="flex-1" />
        <ToggleButton size="sm" variant="ghost" tone="neutral" icon={LuPanelBottom} pressed={showSection} onPressedChange={setShowSection} tooltip={t('layout.toolbar.sectionHint')}>{t('layout.toolbar.section')}</ToggleButton>
        <Button size="sm" variant="ghost" icon={LuFileDown} onClick={exportPdf} tooltip={t('layout.toolbar.exportPdfHint')}>{t('layout.toolbar.exportPdf')}</Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <LayoutEditor2D ref={editor} onScaleChange={onScale} />
            {patchCount === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                <div className="pointer-events-auto rounded-lg border border-line bg-surface-overlay shadow-popover">
                  <EmptyState
                    size="sm"
                    icon={LuCable}
                    title={t('layout.empty.title')}
                    description={t('layout.empty.description')}
                    action={<Button size="sm" variant="primary" icon={LuPlus} onClick={() => useUiStore.getState().setActiveTab('patch')}>{t('layout.empty.action')}</Button>}
                  />
                </div>
              </div>
            )}
          </div>
          {showSection && <SideView className="h-48 shrink-0 border-t border-line [[data-density=touch]_&]:h-56" />}
        </div>
        <aside aria-label={t('layout.inspector')} className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-1 [[data-density=touch]_&]:w-80">
          {selectedCount > 1 ? (
            <MultiSelectionPanel />
          ) : selectedFixtureId ? (
            <FixturePropertiesPanel onClose={() => usePatchStore.getState().clearSelection()} />
          ) : bar ? (
            <TrussPropertiesPanel bar={bar} />
          ) : (
            <RoomPropertiesPanel />
          )}
        </aside>
      </div>
      <SelectionControls />
    </div>
  )
}

function ZoomControls({ editor, listener }: {
  editor: React.RefObject<LayoutEditorHandle | null>
  listener: React.MutableRefObject<((scale: number, fit: number) => void) | null>
}) {
  const [pct, setPct] = useState(100)
  const t = useT()
  useEffect(() => {
    listener.current = (scale, fit) => setPct(Math.round((scale / fit) * 100))
    return () => { listener.current = null }
  }, [listener])
  return (
    <ToolbarGroup aria-label={t('layout.toolbar.zoomGroup')}>
      <IconButton size="sm" icon={LuZoomOut} label={t('layout.toolbar.zoomOut')} onClick={() => editor.current?.zoomBy(0.8)} />
      <span className="w-12 text-center font-mono text-xs tabular text-fg-secondary">{formatPercent(pct, 100, t.locale)}</span>
      <IconButton size="sm" icon={LuZoomIn} label={t('layout.toolbar.zoomIn')} onClick={() => editor.current?.zoomBy(1.25)} />
      <Button size="sm" variant="ghost" icon={LuScan} onClick={() => editor.current?.fit()} tooltip={t('layout.toolbar.fitHint')} shortcut="F">{t('layout.toolbar.fit')}</Button>
    </ToolbarGroup>
  )
}

/** Bulk rigging for several selected fixtures */
function MultiSelectionPanel() {
  const ids = usePatchStore((s) => s.selectedFixtureIds)
  const bars = useVisualizerStore((s) => s.roomConfig.trussBars)
  const sortedBars = useMemo(() => [...bars].sort((a, b) => a.z - b.z), [bars])
  const t = useT()
  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-primary">{t('layout.multi.title', { count: ids.length })}</h3>
        <IconButton icon={LuX} label={t('layout.multi.clearSelection')} size="sm" onClick={() => usePatchStore.getState().clearSelection()} />
      </header>
      <Section title={t('layout.multi.hangOnBar')}>
        {sortedBars.length === 0 ? (
          <p className="text-xs text-fg-tertiary">{t('layout.multi.noBars')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {sortedBars.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => hangOnBar(ids, b)}
                className="flex h-control-sm items-center gap-2 rounded bg-surface-2 px-2.5 text-left text-sm text-fg-primary transition-colors duration-fast hover:bg-surface-3 active:bg-surface-4"
              >
                <LuAlignHorizontalSpaceAround size={14} aria-hidden className="shrink-0 text-fg-tertiary" />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{formatMetres(b.y, 2, t)}</span>
              </button>
            ))}
            <p className="text-2xs text-fg-tertiary">{t('layout.multi.spreadHint')}</p>
          </div>
        )}
      </Section>
      <Section title={t('layout.multi.mount')}>
        <Select size="sm" aria-label={t('layout.multi.mountAll')} value="" options={[{ value: '', label: t('layout.multi.setMount'), disabled: true }, ...mountOptions(t)]} onChange={(m) => { if (m) setMount(ids, m) }} />
      </Section>
      <div className="flex flex-col gap-1.5 px-3 py-3">
        <Button size="sm" icon={LuFlipHorizontal2} onClick={() => flipFixtures(ids)}>{t('layout.actions.flip')}</Button>
        <Button size="sm" variant="danger-outline" icon={LuRotateCcw} tooltip={t('layout.actions.resetHint')} shortcut="Delete" onClick={() => void resetPlacement(ids)}>{t('layout.actions.resetPlacement')}</Button>
      </div>
    </div>
  )
}
