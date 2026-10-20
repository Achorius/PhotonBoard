// ============================================================
// PhotonBoard — Remote Stage View (browser: phone / tablet).
// Same surface as the Electron Stage window, fed by the stores the
// remote bridge mirrors from the console. Store actions forward
// themselves to the console in remote mode (lib/runtime.ts); executor
// presses go as the 'executor' command (the console releases what this
// browser holds when it disconnects); page changes as
// 'set-executor-page' (hooks/useRemoteSync.ts).
//
//   phone  (< 640 px): 2 executor columns at a time ("column pairs"),
//                      executor page selector, GM bar + masters docked
//                      at the bottom for the thumb
//   tablet / desktop:  masters column + full 8 × 4 grid; Executors /
//                      Pages switch when the show has stage pages
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LuClapperboard, LuHand, LuLayoutDashboard, LuLayoutGrid, LuMove, LuSlidersVertical } from 'react-icons/lu'
import { Button, EmptyState, SegmentedControl, StatusDot, cn } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useRemoteConnection } from '@renderer/hooks/useRemoteConnection'
import { sendRemoteCommand } from '@renderer/lib/runtime'
import { useT } from '@renderer/i18n'
import { SceneGrid, STAGE_COLUMNS, type Cell, type StageGridMode } from './SceneGrid'
import { GrandMasterBar, GrandMasterFader, GroupStrip, MasterButtons, PlaybackButtons, StageClock, type StageGroup } from './StageControls'
import { PageSelector } from './PageSelector'
import { StagePagesPlayer } from './pages/StagePagesPlayer'
import { getStoreActions, useSurfaceData } from './pages/surface-store'
import { indexSurface, pageIsActive, resolveCell, type ResolvedCell, type SurfaceIndex } from './pages/surface-data'
import { EXEC_COLUMNS, EXEC_ROWS, stepPage } from './executor-surface'

const PHONE_BREAKPOINT = 640
const COLUMNS_PER_PAIR = 2
const PAIR_COUNT = STAGE_COLUMNS / COLUMNS_PER_PAIR
const VIEW_PREF = 'photonboard.remote.stageView'

type StageView = 'executors' | 'pages'

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < PHONE_BREAKPOINT)
  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth < PHONE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return phone
}

// ---- Actions (forwarded to the console by the stores / commands) ----

const swap = (from: Cell, to: Cell) => useExecutorStore.getState().swapCells(from, to)
const dmx = () => useDmxStore.getState()

// ---- Data hooks ----

function useSurface(): SurfaceIndex {
  const data = useSurfaceData()
  return useMemo(() => indexSurface(data), [data])
}

function useGroupSelection() {
  const groups = usePatchStore((s) => s.groups)
  const selection = usePatchStore((s) => s.selectedFixtureIds)
  const stageGroups = useMemo<StageGroup[]>(
    () => groups.filter((g) => !g.parentGroupId).map((g) => ({ id: g.id, name: g.name, color: g.color, fixtureCount: g.fixtureIds.length })),
    [groups]
  )
  // A group is "active" when the selection is exactly its fixtures
  const activeGroupId = useMemo(() => {
    if (selection.length === 0) return null
    const sel = new Set(selection)
    return groups.find((g) => !g.parentGroupId && g.fixtureIds.length === sel.size && g.fixtureIds.every((id) => sel.has(id)))?.id ?? null
  }, [groups, selection])

  const selectGroup = useCallback((id: string) => {
    const g = usePatchStore.getState().groups.find((x) => x.id === id)
    if (g) usePatchStore.setState({ selectedFixtureIds: [...g.fixtureIds] }) // local feedback
    sendRemoteCommand('select-group', id)
  }, [])
  const selectAll = useCallback(() => {
    usePatchStore.getState().selectAll()
    sendRemoteCommand('select-all')
  }, [])
  const clear = useCallback(() => {
    usePatchStore.getState().clearSelection()
    sendRemoteCommand('clear-selection')
  }, [])
  return { groups: stageGroups, activeGroupId, selectionCount: selection.length, selectGroup, selectAll, clear }
}

// ---- Pieces ----

function ConnectionDot() {
  const t = useT()
  const state = useRemoteConnection()
  const ok = state === 'open'
  return (
    <StatusDot
      tone={ok ? 'go' : state === 'auth-required' ? 'danger' : 'warning'}
      pulse={!ok}
      size="md"
      label={ok ? t('shell.connection.connected') : state === 'auth-required' ? t('shell.connection.pinRequired') : t('shell.connection.reconnecting')}
    />
  )
}

function ShowTitle({ className }: { className?: string }) {
  const showName = useUiStore((s) => s.showName)
  return <h1 className={cn('min-w-0 truncate font-semibold text-fg-primary', className)}>{showName}</h1>
}

function BlackoutStrip() {
  const t = useT()
  const blackout = useDmxStore((s) => s.blackout)
  if (!blackout) return null
  return (
    <div role="alert" className="flex h-8 shrink-0 items-center justify-center gap-2 bg-danger text-xs font-bold uppercase tracking-[0.14em] text-on-danger">
      <span aria-hidden className="h-2 w-2 rounded-full bg-white animate-blink" />
      {t('common.blackout')}
    </div>
  )
}

function GridModeSwitch({ value, onChange, compact }: { value: StageGridMode; onChange: (m: StageGridMode) => void; compact?: boolean }) {
  const t = useT()
  const play = t('stage.gridModes.play')
  const levels = t('stage.gridModes.levels')
  const arrange = t('stage.gridModes.arrange')
  return (
    <SegmentedControl<StageGridMode>
      aria-label={t('stage.gridModeAria')}
      size={compact ? 'sm' : 'md'}
      value={value}
      onChange={onChange}
      items={[
        { value: 'play', label: compact ? undefined : play, icon: LuHand, title: play },
        { value: 'levels', label: compact ? undefined : levels, icon: LuSlidersVertical, title: levels },
        { value: 'arrange', label: compact ? undefined : arrange, icon: LuMove, title: arrange }
      ]}
    />
  )
}

function Masters({ layout }: { layout: 'column' | 'row' }) {
  const blackout = useDmxStore((s) => s.blackout)
  const blinder = useDmxStore((s) => s.blinder)
  const strobe = useDmxStore((s) => s.strobe)
  return (
    <MasterButtons
      layout={layout}
      blackout={blackout}
      blinder={blinder}
      strobe={strobe}
      onBlackout={() => dmx().toggleBlackout()}
      onBlinder={(on) => dmx().toggleBlinder(on)}
      onStrobe={(on) => dmx().toggleStrobe(on)}
    />
  )
}

function GrandMaster({ variant }: { variant: 'fader' | 'bar' }) {
  const gm = useDmxStore((s) => s.grandMaster)
  const set = useCallback((v: number) => dmx().setGrandMaster(v), [])
  return variant === 'bar' ? <GrandMasterBar value={gm} onChange={set} /> : <GrandMasterFader value={gm} onChange={set} />
}

function ReleaseClear() {
  const anyPlaying = usePlaybackStore((s) => s.cuelists.some((c) => c.isPlaying) || s.chases.some((c) => c.isPlaying))
  return (
    <PlaybackButtons
      anyPlaying={anyPlaying}
      onClear={() => sendRemoteCommand('clear-programmer')}
      onReleaseAll={() => usePlaybackStore.getState().releaseAll()}
    />
  )
}

/** Executor page selector (shown when the show has more than one page) */
function ExecPages({ index, variant, className }: { index: SurfaceIndex; variant: 'stage' | 'phone'; className?: string }) {
  const d = index.data
  if (d.executorPages.length <= 1) return null
  return (
    <PageSelector
      variant={variant}
      className={className}
      pages={d.executorPages}
      current={d.currentPage}
      activePages={d.executorPages.map((p) => pageIsActive(index, p))}
      onChange={getStoreActions().setPage}
    />
  )
}

function Grid({ index, mode, size, visibleColumns, className }: { index: SurfaceIndex; mode: StageGridMode; size: 'sm' | 'md'; visibleColumns?: number[]; className?: string }) {
  const t = useT()
  const d = index.data
  const pageIndex = d.currentPage
  const page = d.executorPages[pageIndex]
  const cells = useMemo(() => Array.from({ length: EXEC_COLUMNS }, (_, col) =>
    Array.from({ length: EXEC_ROWS }, (_, row) => resolveCell(index, page?.cells[col]?.[row]))), [index, page])
  const hasCells = cells.some((col) => col.some(Boolean))
  if (!hasCells && d.cuelists.length === 0) {
    return (
      <div className={cn('flex min-h-0 flex-1 rounded-lg border border-dashed border-line', className)}>
        <EmptyState icon={LuClapperboard} title={t('stage.noScenes')} description={t('stage.noScenesRemote')} />
      </div>
    )
  }
  const actions = getStoreActions()
  const pageCount = d.executorPages.length
  const selected = d.selectedExecutor && d.selectedExecutor.page === pageIndex ? d.selectedExecutor : null
  return (
    <SceneGrid
      className={className}
      size={size}
      cells={cells}
      columns={page?.columns ?? []}
      mode={mode}
      visibleColumns={visibleColumns}
      selected={selected}
      onPress={(cell, phase) => actions.executor({ page: pageIndex, col: cell.col, row: cell.row }, phase)}
      onLevel={(cell: ResolvedCell, level) => { if (cell.kind === 'cuelist' || cell.kind === 'chase') actions.level(cell.kind, cell.id, level) }}
      onSwap={swap}
      onSwipe={pageCount > 1 ? (step) => actions.setPage(stepPage(pageIndex, step, pageCount)) : undefined}
    />
  )
}

function ModeHint({ mode }: { mode: StageGridMode }) {
  const t = useT()
  if (mode === 'play') return null
  return (
    <p className={cn('shrink-0 text-center text-xs', mode === 'arrange' ? 'text-info-fg' : 'text-fg-tertiary')}>
      {mode === 'arrange' ? t('stage.arrangeHintShort') : t('stage.levelsHintShort')}
    </p>
  )
}

// ---- Phone ----

/** Which 2 of the 8 executor columns the phone shows (not executor pages) */
function ColumnPairTabs({ pair, onChange, columns }: { pair: number; onChange: (p: number) => void; columns: readonly { color: string }[] }) {
  const t = useT()
  return (
    <div role="tablist" aria-label={t('stage.columnPairsAria')} className="grid grid-cols-4 gap-1 rounded-lg bg-surface-0 p-1 ring-1 ring-inset ring-line">
      {Array.from({ length: PAIR_COUNT }, (_, p) => {
        const cols = [p * COLUMNS_PER_PAIR, p * COLUMNS_PER_PAIR + 1]
        const active = p === pair
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t('stage.columnPairAria', { a: cols[0] + 1, b: cols[1] + 1 })}
            onClick={() => onChange(p)}
            className={cn(
              'flex h-control flex-col items-center justify-center gap-1 rounded-md transition-colors duration-fast',
              active ? 'bg-surface-3 text-fg-primary shadow-raised' : 'text-fg-tertiary active:bg-surface-2'
            )}
          >
            <span className="flex gap-1">
              {cols.map((c) => <span key={c} aria-hidden className="h-1.5 w-4 rounded-full" style={{ backgroundColor: columns[c]?.color, opacity: active ? 1 : 0.55 }} />)}
            </span>
            <span className="font-mono text-2xs tabular">{cols[0] + 1}–{cols[1] + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

function PhoneStage() {
  const [pair, setPair] = useState(0)
  const [mode, setMode] = useState<StageGridMode>('play')
  const groups = useGroupSelection()
  const index = useSurface()
  const page = index.data.executorPages[index.data.currentPage]
  const visible = useMemo(() => [pair * COLUMNS_PER_PAIR, pair * COLUMNS_PER_PAIR + 1], [pair])
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-0">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface-1 px-3 pt-[env(safe-area-inset-top)]">
        <ConnectionDot />
        <ShowTitle className="flex-1 text-base" />
        <StageClock size="sm" seconds={false} />
        <GridModeSwitch value={mode} onChange={setMode} compact />
      </header>
      <BlackoutStrip />
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3">
        <ExecPages index={index} variant="phone" />
        <ColumnPairTabs pair={pair} onChange={setPair} columns={page?.columns ?? []} />
        <GroupStrip
          groups={groups.groups}
          activeGroupId={groups.activeGroupId}
          selectionCount={groups.selectionCount}
          onSelectGroup={groups.selectGroup}
          onSelectAll={groups.selectAll}
          onClear={groups.clear}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2">
        <Grid index={index} mode={mode} size="sm" visibleColumns={visible} />
        <ModeHint mode={mode} />
      </div>
      <footer className="flex shrink-0 flex-col gap-3 border-t border-line bg-surface-1 px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <GrandMaster variant="bar" />
        <Masters layout="row" />
      </footer>
    </div>
  )
}

// ---- Tablet / desktop browser ----

function readView(): StageView {
  try { return localStorage.getItem(VIEW_PREF) === 'pages' ? 'pages' : 'executors' } catch { return 'executors' }
}

function TabletStage() {
  const t = useT()
  const [mode, setMode] = useState<StageGridMode>('play')
  const [view, setView] = useState<StageView>(readView)
  const groups = useGroupSelection()
  const index = useSurface()
  const hasPages = index.data.stagePages.length > 0
  const shown: StageView = hasPages ? view : 'executors'
  const narrow = typeof window !== 'undefined' && window.innerWidth < 1100
  const changeView = (v: StageView) => {
    setView(v)
    try { localStorage.setItem(VIEW_PREF, v) } catch { /* ignore */ }
  }
  return (
    <div className="flex h-full w-full overflow-hidden bg-surface-0">
      <aside aria-label={t('stage.mastersAria')} className="flex w-[200px] shrink-0 flex-col gap-3 border-r border-line bg-surface-1 p-3 lg:w-[232px]">
        <GrandMaster variant="fader" />
        <Masters layout="column" />
        <ReleaseClear />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4">
          <ConnectionDot />
          <ShowTitle className="flex-1 text-lg" />
          {hasPages && (
            <SegmentedControl<StageView>
              aria-label={t('pro.stage.view.aria')}
              size="md"
              value={shown}
              onChange={changeView}
              items={[
                { value: 'executors', label: narrow ? undefined : t('pro.stage.view.executors'), icon: LuLayoutGrid, title: t('pro.stage.view.executors') },
                { value: 'pages', label: narrow ? undefined : t('pro.stage.view.pages'), icon: LuLayoutDashboard, title: t('pro.stage.view.pages') }
              ]}
            />
          )}
          {shown === 'executors' && <GridModeSwitch value={mode} onChange={setMode} compact={narrow} />}
          <StageClock size="md" />
          <Button
            variant="secondary"
            icon={LuLayoutDashboard}
            onClick={() => useUiStore.getState().setStageMode(false)}
            labelClassName="hidden lg:inline"
            aria-label={t('stage.fullConsole')}
          >
            {t('stage.fullConsole')}
          </Button>
        </header>
        <BlackoutStrip />
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {shown === 'pages' ? (
            <StagePagesPlayer pages={index.data.stagePages} index={index} actions={getStoreActions()} size="md" prefKey="photonboard.remote.stagePage" />
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <GroupStrip
                    groups={groups.groups}
                    activeGroupId={groups.activeGroupId}
                    selectionCount={groups.selectionCount}
                    onSelectGroup={groups.selectGroup}
                    onSelectAll={groups.selectAll}
                    onClear={groups.clear}
                  />
                </div>
                <ExecPages index={index} variant="phone" className="w-[208px] shrink-0" />
              </div>
              <Grid index={index} mode={mode} size="md" />
              <ModeHint mode={mode} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function RemoteStageView() {
  return useIsPhone() ? <PhoneStage /> : <TabletStage />
}
