// ============================================================
// PhotonBoard — Remote Stage View (browser: phone / tablet).
// Same surface as the Electron Stage window, fed by the stores the
// remote bridge mirrors from the console. Store actions forward
// themselves to the console in remote mode (lib/runtime.ts).
//
//   phone  (< 640 px): 2 executor columns per page, GM bar + masters
//                      docked at the bottom for the thumb
//   tablet / desktop:  masters column + full 8 × 4 grid
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LuClapperboard, LuHand, LuLayoutDashboard, LuMove, LuSlidersVertical } from 'react-icons/lu'
import { Button, EmptyState, SegmentedControl, StatusDot, cn } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useRemoteConnection } from '@renderer/hooks/useRemoteConnection'
import { sendRemoteCommand } from '@renderer/lib/runtime'
import { SceneGrid, STAGE_COLUMNS, type Cell, type SceneMode, type StageGridMode, type StageScene } from './SceneGrid'
import { GrandMasterBar, GrandMasterFader, GroupStrip, MasterButtons, PlaybackButtons, StageClock, type StageGroup } from './StageControls'

const PHONE_BREAKPOINT = 640
const COLUMNS_PER_PAGE = 2
const PAGE_COUNT = STAGE_COLUMNS / COLUMNS_PER_PAGE

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < PHONE_BREAKPOINT)
  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth < PHONE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return phone
}

// ---- Actions (forwarded to the console by the stores) ----

const fire = (scene: StageScene, mode: SceneMode, phase: 'down' | 'up') => {
  const pb = usePlaybackStore.getState()
  if (mode === 'flash') pb.flashCuelist(scene.id, phase === 'down')
  else if (mode === 'trigger') {
    if (phase === 'down') pb.goCuelist(scene.id)
    else pb.stopCuelist(scene.id)
  } else if (phase === 'down') {
    if (scene.isPlaying) pb.stopCuelist(scene.id)
    else pb.goCuelist(scene.id)
  }
}
const setLevel = (id: string, level: number) => usePlaybackStore.getState().setCuelistFader(id, level)
const swap = (from: Cell, to: Cell) => useExecutorStore.getState().swapCells(from, to)
const dmx = () => useDmxStore.getState()

// ---- Data hooks (narrow selectors) ----

function useStageScenes(): ReadonlyMap<string, StageScene> {
  const cuelists = usePlaybackStore((s) => s.cuelists)
  return useMemo(() => new Map(cuelists.map((c) => [c.id, {
    id: c.id,
    name: c.name,
    isPlaying: c.isPlaying,
    faderLevel: c.faderLevel,
    currentCueIndex: c.currentCueIndex,
    cueCount: c.cues.length,
    cueName: c.isPlaying ? c.cues[c.currentCueIndex]?.name : undefined,
    flash: c.flash
  }])), [cuelists])
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
  const state = useRemoteConnection()
  const ok = state === 'open'
  return (
    <StatusDot
      tone={ok ? 'go' : state === 'auth-required' ? 'danger' : 'warning'}
      pulse={!ok}
      size="md"
      label={ok ? 'Connected to the console' : state === 'auth-required' ? 'PIN required' : 'Reconnecting to the console'}
    />
  )
}

function ShowTitle({ className }: { className?: string }) {
  const showName = useUiStore((s) => s.showName)
  return <h1 className={cn('min-w-0 truncate font-semibold text-fg-primary', className)}>{showName}</h1>
}

function BlackoutStrip() {
  const blackout = useDmxStore((s) => s.blackout)
  if (!blackout) return null
  return (
    <div role="alert" className="flex h-8 shrink-0 items-center justify-center gap-2 bg-danger text-xs font-bold uppercase tracking-[0.14em] text-on-danger">
      <span aria-hidden className="h-2 w-2 rounded-full bg-white animate-blink" />
      Blackout
    </div>
  )
}

function GridModeSwitch({ value, onChange, compact }: { value: StageGridMode; onChange: (m: StageGridMode) => void; compact?: boolean }) {
  return (
    <SegmentedControl<StageGridMode>
      aria-label="Scene grid mode"
      size={compact ? 'sm' : 'md'}
      value={value}
      onChange={onChange}
      items={[
        { value: 'play', label: compact ? undefined : 'Play', icon: LuHand, title: 'Play' },
        { value: 'levels', label: compact ? undefined : 'Levels', icon: LuSlidersVertical, title: 'Levels' },
        { value: 'arrange', label: compact ? undefined : 'Arrange', icon: LuMove, title: 'Arrange' }
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

function Grid({ mode, size, visibleColumns, className }: { mode: StageGridMode; size: 'sm' | 'md'; visibleColumns?: number[]; className?: string }) {
  const grid = useExecutorStore((s) => s.grid)
  const columns = useExecutorStore((s) => s.columns)
  const modes = useExecutorStore((s) => s.modes)
  const scenes = useStageScenes()
  if (scenes.size === 0) {
    return (
      <div className={cn('flex min-h-0 flex-1 rounded-lg border border-dashed border-line', className)}>
        <EmptyState
          icon={LuClapperboard}
          title="No scenes in this show"
          description="Scenes recorded on the console appear here automatically."
        />
      </div>
    )
  }
  return (
    <SceneGrid
      className={className}
      size={size}
      grid={grid}
      columns={columns}
      modes={modes}
      scenes={scenes}
      mode={mode}
      visibleColumns={visibleColumns}
      onFire={fire}
      onLevel={setLevel}
      onSwap={swap}
    />
  )
}

function ModeHint({ mode }: { mode: StageGridMode }) {
  if (mode === 'play') return null
  return (
    <p className={cn('shrink-0 text-center text-xs', mode === 'arrange' ? 'text-info-fg' : 'text-fg-tertiary')}>
      {mode === 'arrange' ? 'Arrange — drag a scene onto another cell. Nothing fires.' : 'Levels — scene master faders. Double-tap = full.'}
    </p>
  )
}

// ---- Phone ----

function PageTabs({ page, onChange }: { page: number; onChange: (p: number) => void }) {
  const columns = useExecutorStore((s) => s.columns)
  return (
    <div role="tablist" aria-label="Executor columns" className="grid grid-cols-4 gap-1 rounded-lg bg-surface-0 p-1 ring-1 ring-inset ring-line">
      {Array.from({ length: PAGE_COUNT }, (_, p) => {
        const cols = [p * COLUMNS_PER_PAGE, p * COLUMNS_PER_PAGE + 1]
        const active = p === page
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`Columns ${cols[0] + 1} and ${cols[1] + 1}`}
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
  const [page, setPage] = useState(0)
  const [mode, setMode] = useState<StageGridMode>('play')
  const groups = useGroupSelection()
  const visible = useMemo(() => [page * COLUMNS_PER_PAGE, page * COLUMNS_PER_PAGE + 1], [page])
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
        <PageTabs page={page} onChange={setPage} />
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
        <Grid mode={mode} size="sm" visibleColumns={visible} />
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

function TabletStage() {
  const [mode, setMode] = useState<StageGridMode>('play')
  const groups = useGroupSelection()
  return (
    <div className="flex h-full w-full overflow-hidden bg-surface-0">
      <aside aria-label="Masters" className="flex w-[200px] shrink-0 flex-col gap-3 border-r border-line bg-surface-1 p-3 lg:w-[232px]">
        <GrandMaster variant="fader" />
        <Masters layout="column" />
        <ReleaseClear />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4">
          <ConnectionDot />
          <ShowTitle className="flex-1 text-lg" />
          <GridModeSwitch value={mode} onChange={setMode} compact={typeof window !== 'undefined' && window.innerWidth < 1100} />
          <StageClock size="md" />
          <Button
            variant="secondary"
            icon={LuLayoutDashboard}
            onClick={() => useUiStore.getState().setStageMode(false)}
            labelClassName="hidden lg:inline"
            aria-label="Full console"
          >
            Full console
          </Button>
        </header>
        <BlackoutStrip />
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <GroupStrip
            groups={groups.groups}
            activeGroupId={groups.activeGroupId}
            selectionCount={groups.selectionCount}
            onSelectGroup={groups.selectGroup}
            onSelectAll={groups.selectAll}
            onClear={groups.clear}
          />
          <Grid mode={mode} size="md" />
          <ModeHint mode={mode} />
        </div>
      </div>
    </div>
  )
}

export function RemoteStageView() {
  return useIsPhone() ? <PhoneStage /> : <TabletStage />
}
