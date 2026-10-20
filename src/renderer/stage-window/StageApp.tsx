// ============================================================
// Stage window — second screen / stage-side touchscreen (Electron).
// Always touch density. State arrives from the console renderer:
//   - the slim state snapshot (lib/state-snapshot.ts, ~30 Hz, deduped)
//   - the touch surface data (`{ __stageSurface }`: every executor page
//     with its cells, stage pages, pools) when something changed
//     (components/stage/pages/stage-surface-broadcast.ts)
// Every action is a command (shared/remote-commands.ts) executed by the
// console renderer; executor cells go through 'executor' (the same
// executorPress as the executor bar, MIDI and the command line).
// Held cells / Blinder / Strobe are released on unmount AND when the
// window closes (pagehide).
// Language: the snapshot's `language` (the console's UI language);
// before the first snapshot, the choice shared through localStorage.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuClapperboard, LuHand, LuLayoutDashboard, LuLayoutGrid, LuMove, LuSlidersVertical, LuX } from 'react-icons/lu'
import type { StateSnapshot } from '@renderer/lib/state-snapshot'
import { EmptyState, IconButton, SegmentedControl, Spinner, cn } from '@renderer/components/ui'
import { SceneGrid, type Cell, type StageGridMode } from '@renderer/components/stage/SceneGrid'
import { GrandMasterFader, GroupStrip, MasterButtons, PlaybackButtons, StageClock } from '@renderer/components/stage/StageControls'
import { PageSelector } from '@renderer/components/stage/PageSelector'
import { StagePagesPlayer } from '@renderer/components/stage/pages/StagePagesPlayer'
import {
  indexSurface, isStageSurfaceMessage, pageIsActive, resolveCell, surfaceFromSnapshot, STAGE_SURFACE_KEY,
  type ResolvedCell, type SurfaceData
} from '@renderer/components/stage/pages/surface-data'
import { createCommandActions, type SurfaceActions } from '@renderer/components/stage/pages/surface-actions'
import { EXEC_COLUMNS, EXEC_ROWS } from '@renderer/components/stage/executor-surface'
import { setLocale, useT } from '@renderer/i18n'

type StageState = Omit<StateSnapshot, 'dmx'>
type StageView = 'executors' | 'pages'

interface StageCommand {
  type: string
  payload?: unknown
}

declare global {
  interface Window {
    stageApi?: {
      onStateSync: (callback: (state: StageState) => void) => (() => void) | void
      sendCommand: (command: StageCommand) => void
      close: () => void
    }
  }
}

/** Ignore incoming values for a control the operator moved this recently (sync round-trip) */
const LOCAL_HOLD_MS = 500
const FADER_SEND_MS = 30
const VIEW_PREF = 'photonboard.stage.view'

function send(type: string, payload?: unknown) {
  window.stageApi?.sendCommand({ type, payload })
}

function readView(): StageView {
  try { return localStorage.getItem(VIEW_PREF) === 'pages' ? 'pages' : 'executors' } catch { return 'executors' }
}

/** Per-key leading + trailing throttle for fader commands */
function useThrottledSend() {
  const slots = useRef(new Map<string, { last: number; timer: ReturnType<typeof setTimeout> | null; type: string; payload: unknown }>())
  useEffect(() => () => { for (const s of slots.current.values()) if (s.timer) clearTimeout(s.timer) }, [])
  return useCallback((key: string, type: string, payload: unknown) => {
    let s = slots.current.get(key)
    if (!s) { s = { last: 0, timer: null, type, payload }; slots.current.set(key, s) }
    s.type = type
    s.payload = payload
    const now = performance.now()
    const wait = s.last + FADER_SEND_MS - now
    if (wait <= 0 && !s.timer) { s.last = now; send(type, payload); return }
    if (s.timer) return
    const slot = s
    slot.timer = setTimeout(() => { slot.timer = null; slot.last = performance.now(); send(slot.type, slot.payload) }, Math.max(0, wait))
  }, [])
}

export function StageApp() {
  const t = useT()
  const [state, setState] = useState<StageState | null>(null)
  const [surface, setSurface] = useState<SurfaceData | null>(null)
  const [gridMode, setGridMode] = useState<StageGridMode>('play')
  const [view, setView] = useState<StageView>(readView)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const held = useRef(new Map<string, { value: number; t: number }>())
  const sendThrottled = useThrottledSend()
  /** What this window holds down right now (released when it closes) */
  const holds = useRef(new Map<string, StageCommand>())

  // State sync, deduplicated: the console answers every 33 ms, mostly unchanged
  useEffect(() => {
    let last = ''
    let lastSurface = ''
    const off = window.stageApi?.onStateSync((next) => {
      const json = JSON.stringify(next)
      if (isStageSurfaceMessage(next)) {
        if (json === lastSurface) return
        lastSurface = json
        setSurface(next[STAGE_SURFACE_KEY])
        return
      }
      if (json === last) return
      last = json
      if (next.language === 'fr' || next.language === 'en') setLocale(next.language)
      setState(next)
    })
    return () => { if (typeof off === 'function') off() }
  }, [])

  // ESC closes the stage window (it is frameless and full screen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        window.stageApi?.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Closing the window never leaves a TRIG / FLASH cell, Blinder or Strobe on
  useEffect(() => {
    const releaseAll = () => {
      for (const cmd of holds.current.values()) send(cmd.type, cmd.payload)
      holds.current.clear()
    }
    window.addEventListener('pagehide', releaseAll)
    window.addEventListener('beforeunload', releaseAll)
    return () => {
      window.removeEventListener('pagehide', releaseAll)
      window.removeEventListener('beforeunload', releaseAll)
      releaseAll()
    }
  }, [])

  const hold = (key: string, remote: number): number => {
    const h = held.current.get(key)
    if (h && performance.now() - h.t < LOCAL_HOLD_MS) return h.value
    return remote
  }
  const setLocal = (key: string, value: number) => {
    held.current.set(key, { value, t: performance.now() })
    setTick((n) => n + 1)
  }

  // Surface: the console's when it sent one, else rebuilt from the snapshot (current page, scenes only)
  const data = useMemo<SurfaceData | null>(() => {
    if (!state) return null
    if (!surface) return surfaceFromSnapshot(state)
    // Masters and the page come with the snapshot (fresher): keep them
    return {
      ...surface,
      currentPage: Math.min(state.executorPage ?? surface.currentPage, surface.executorPages.length - 1),
      grandMaster: state.grandMaster,
      blackout: state.blackout,
      blinder: state.blinder,
      strobe: state.strobe
    }
  }, [state, surface])
  const index = useMemo(() => (data ? indexSurface(data) : null), [data])
  const latestData = useRef(data)
  latestData.current = data

  // Actions as commands; holds are tracked for the window-close release
  const actions = useMemo<SurfaceActions>(() => {
    const base = createCommandActions(send, sendThrottled, (p) => latestData.current?.executorPages[p])
    return {
      ...base,
      executor: (ref, phase) => {
        const key = `exec:${ref.page}:${ref.col}:${ref.row}`
        if (phase === 'down') holds.current.set(key, { type: 'executor', payload: { ...ref, phase: 'up' } })
        else holds.current.delete(key)
        base.executor(ref, phase)
      },
      blinder: (on) => {
        if (on) holds.current.set('blinder', { type: 'toggle-blinder', payload: false })
        else holds.current.delete('blinder')
        base.blinder(on)
      },
      strobe: (on) => {
        if (on) holds.current.set('strobe', { type: 'toggle-strobe', payload: false })
        else holds.current.delete('strobe')
        base.strobe(on)
      },
      grandMaster: (v) => { setLocal('gm', v); base.grandMaster(v) },
      level: (kind, id, v) => { setLocal(`level:${id}`, v); base.level(kind, id, v) }
    }
  }, [sendThrottled])

  // Forget the highlighted group when the selection no longer matches it
  const selectionCount = state?.selectedFixtureIds.length ?? 0
  useEffect(() => {
    if (!activeGroup || !state) return
    const g = state.groups.find((x) => x.id === activeGroup)
    if (!g || g.fixtureCount !== selectionCount) setActiveGroup(null)
  }, [activeGroup, selectionCount, state])

  if (!state || !data || !index) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-surface-0 text-fg-secondary">
        <Spinner size={24} />
        <span className="text-base">{t('stage.waiting')}</span>
        <span className="text-sm text-fg-tertiary">{t('stage.escToClose')}</span>
      </div>
    )
  }

  const pageIndex = data.currentPage
  const page = data.executorPages[pageIndex]
  const pageCount = data.executorPages.length
  const hasStagePages = data.stagePages.length > 0
  const shownView: StageView = hasStagePages ? view : 'executors'
  const grandMaster = hold('gm', state.grandMaster)
  const anyPlaying = state.cuelists.some((c) => c.isPlaying) || (state.chases ?? []).some((c) => c.isPlaying)
  const selected = data.selectedExecutor && data.selectedExecutor.page === pageIndex ? data.selectedExecutor : null

  // Cells of the shown page, with the faders the operator is moving held locally
  const cells: (ResolvedCell | null)[][] = Array.from({ length: EXEC_COLUMNS }, (_, col) => Array.from({ length: EXEC_ROWS }, (_, row) => {
    const c = resolveCell(index, page?.cells[col]?.[row])
    if (c && c.level !== undefined && (c.kind === 'cuelist' || c.kind === 'chase')) {
      const v = hold(`level:${c.id}`, c.level)
      if (v !== c.level) return { ...c, level: v }
    }
    return c
  }))
  const hasCells = cells.some((col) => col.some(Boolean))

  const changeView = (v: StageView) => {
    setView(v)
    try { localStorage.setItem(VIEW_PREF, v) } catch { /* ignore */ }
  }

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-surface-0 text-fg-primary">
      <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-line bg-surface-1 px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="rounded-sm bg-accent/15 px-2 py-1 text-2xs font-bold uppercase tracking-[0.12em] text-accent-fg">{t('stage.badge')}</span>
          <h1 className="truncate text-xl font-semibold">{state.showName}</h1>
          {state.isDirty && <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title={t('stage.unsavedOnConsole')} aria-label={t('stage.unsaved')} />}
          <span className="hidden whitespace-nowrap text-sm text-fg-tertiary 2xl:inline">
            {t('stage.summary', { fixtures: t('common.fixtureCount', { count: state.fixtureCount }), scenes: t('common.sceneCount', { count: state.cuelists.length }) })}
          </span>
        </div>
        {hasStagePages && (
          <SegmentedControl<StageView>
            aria-label={t('pro.stage.view.aria')}
            size="md"
            value={shownView}
            onChange={changeView}
            items={[
              { value: 'executors', label: t('pro.stage.view.executors'), icon: LuLayoutGrid },
              { value: 'pages', label: t('pro.stage.view.pages'), icon: LuLayoutDashboard }
            ]}
          />
        )}
        {shownView === 'executors' && pageCount > 1 && (
          <PageSelector
            variant="stage"
            pages={data.executorPages}
            current={pageIndex}
            activePages={data.executorPages.map((p) => pageIsActive(index, p))}
            onChange={actions.setPage}
          />
        )}
        {shownView === 'executors' && (
          <SegmentedControl<StageGridMode>
            aria-label={t('stage.gridModeAria')}
            size="md"
            value={gridMode}
            onChange={setGridMode}
            items={[
              { value: 'play', label: t('stage.gridModes.play'), icon: LuHand },
              { value: 'levels', label: t('stage.gridModes.levels'), icon: LuSlidersVertical },
              { value: 'arrange', label: t('stage.gridModes.arrange'), icon: LuMove }
            ]}
          />
        )}
        <span aria-hidden className="h-8 w-px bg-line" />
        <StageClock size="lg" />
        <IconButton icon={LuX} label={t('stage.close')} size="lg" variant="ghost" onClick={() => window.stageApi?.close()} />
      </header>

      {state.blackout && (
        <div role="alert" className="flex h-9 shrink-0 items-center justify-center gap-2 bg-danger text-sm font-bold uppercase tracking-[0.14em] text-on-danger">
          <span aria-hidden className="h-2 w-2 rounded-full bg-white animate-blink" />
          {t('stage.blackoutDark')}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside aria-label={t('stage.mastersAria')} className="flex w-[260px] shrink-0 flex-col gap-4 border-r border-line bg-surface-1 p-4">
          <GrandMasterFader size="lg" value={grandMaster} onChange={actions.grandMaster} />
          <MasterButtons
            layout="column"
            size="lg"
            blackout={state.blackout}
            blinder={state.blinder}
            strobe={state.strobe}
            onBlackout={actions.blackout}
            onBlinder={actions.blinder}
            onStrobe={actions.strobe}
          />
          <PlaybackButtons
            timelinePlaying={state.timelinePlaying}
            onTimeline={() => send('toggle-timeline')}
            onClear={actions.clear}
            onReleaseAll={actions.releaseAll}
            anyPlaying={anyPlaying}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {shownView === 'pages' ? (
            <StagePagesPlayer pages={data.stagePages} index={index} actions={actions} size="lg" prefKey="photonboard.stage.stagePage" />
          ) : (
            <>
              <GroupStrip
                size="lg"
                groups={state.groups}
                activeGroupId={activeGroup}
                selectionCount={selectionCount}
                onSelectGroup={(id) => { setActiveGroup(id); send('select-group', id) }}
                onSelectAll={() => { setActiveGroup(null); send('select-all') }}
                onClear={() => { setActiveGroup(null); send('clear-selection') }}
              />
              {!hasCells && state.cuelists.length === 0 ? (
                <div className="flex min-h-0 flex-1 rounded-lg border border-dashed border-line">
                  <EmptyState icon={LuClapperboard} title={t('stage.noScenes')} description={t('stage.noScenesConsole')} />
                </div>
              ) : (
                <SceneGrid
                  size="lg"
                  cells={cells}
                  columns={page?.columns ?? state.executorColumns}
                  mode={gridMode}
                  selected={selected}
                  onPress={(cell: Cell, phase) => actions.executor({ page: pageIndex, col: cell.col, row: cell.row }, phase)}
                  onLevel={(cell, level) => { if (cell.kind === 'cuelist' || cell.kind === 'chase') actions.level(cell.kind, cell.id, level) }}
                  onSwap={(from, to) => send('swap-cells', { from, to })}
                  onSwipe={pageCount > 1 ? (step) => actions.setPage(Math.max(0, Math.min(pageCount - 1, pageIndex + step))) : undefined}
                />
              )}
              {gridMode !== 'play' && (
                <p className={cn('shrink-0 text-center text-sm', gridMode === 'arrange' ? 'text-info-fg' : 'text-fg-tertiary')}>
                  {gridMode === 'arrange' ? t('stage.arrangeHint') : t('stage.levelsHint')}
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
