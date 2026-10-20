// ============================================================
// Stage window — second screen / stage-side touchscreen (Electron).
// Always touch density. State arrives from the console renderer as
// the slim state snapshot (lib/state-snapshot.ts, ~30 Hz, deduped
// here); every action is a command (shared/remote-commands.ts)
// executed by the console renderer.
// Language: the snapshot's `language` (the console's UI language);
// before the first snapshot, the choice shared through localStorage.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuClapperboard, LuHand, LuMove, LuSlidersVertical, LuX } from 'react-icons/lu'
import type { StateSnapshot } from '@renderer/lib/state-snapshot'
import { EmptyState, IconButton, SegmentedControl, Spinner, cn } from '@renderer/components/ui'
import { SceneGrid, type SceneMode, type StageGridMode, type StageScene } from '@renderer/components/stage/SceneGrid'
import { GrandMasterFader, GroupStrip, MasterButtons, PlaybackButtons, StageClock } from '@renderer/components/stage/StageControls'
import { setLocale, useT } from '@renderer/i18n'

type StageState = Omit<StateSnapshot, 'dmx'>

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

function send(type: string, payload?: unknown) {
  window.stageApi?.sendCommand({ type, payload })
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
  const [gridMode, setGridMode] = useState<StageGridMode>('play')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const held = useRef(new Map<string, { value: number; t: number }>())
  const sendThrottled = useThrottledSend()

  // State sync, deduplicated: the console answers every 33 ms, mostly unchanged
  useEffect(() => {
    let last = ''
    const off = window.stageApi?.onStateSync((next) => {
      const json = JSON.stringify(next)
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

  const hold = (key: string, remote: number): number => {
    const h = held.current.get(key)
    if (h && performance.now() - h.t < LOCAL_HOLD_MS) return h.value
    return remote
  }
  const setLocal = (key: string, value: number) => {
    held.current.set(key, { value, t: performance.now() })
    setTick((t) => t + 1)
  }

  const scenes = useMemo(() => {
    const map = new Map<string, StageScene>()
    for (const c of state?.cuelists ?? []) {
      map.set(c.id, {
        id: c.id,
        name: c.name,
        isPlaying: c.isPlaying,
        faderLevel: c.faderLevel,
        currentCueIndex: c.currentCueIndex,
        cueCount: c.cueCount ?? c.cues?.length ?? 0,
        cueName: c.isPlaying ? c.cues?.[c.currentCueIndex]?.name : undefined,
        flash: c.flash
      })
    }
    return map
  }, [state?.cuelists])

  // Faders the operator is moving show the local value until the console catches up
  let scenesWithHeld: ReadonlyMap<string, StageScene> = scenes
  for (const [key, h] of held.current) {
    if (!key.startsWith('level:') || performance.now() - h.t >= LOCAL_HOLD_MS) continue
    const id = key.slice(6)
    const s = scenesWithHeld.get(id)
    if (!s) continue
    if (scenesWithHeld === scenes) scenesWithHeld = new Map(scenes)
    ;(scenesWithHeld as Map<string, StageScene>).set(id, { ...s, faderLevel: h.value })
  }

  const onFire = useCallback((scene: StageScene, mode: SceneMode, phase: 'down' | 'up') => {
    if (mode === 'flash') send('flash-cuelist', { id: scene.id, on: phase === 'down' })
    else if (mode === 'trigger') send(phase === 'down' ? 'go-cuelist' : 'stop-cuelist', scene.id)
    else if (phase === 'down') send(scene.isPlaying ? 'stop-cuelist' : 'go-cuelist', scene.id)
  }, [])

  const onLevel = useCallback((id: string, level: number) => {
    setLocal(`level:${id}`, level)
    sendThrottled(`level:${id}`, 'set-cuelist-fader', { id, level })
  }, [sendThrottled])

  const onSwap = useCallback((from: { col: number; row: number }, to: { col: number; row: number }) => {
    send('swap-cells', { from, to })
  }, [])

  // Forget the highlighted group when the selection no longer matches it
  const selectionCount = state?.selectedFixtureIds.length ?? 0
  useEffect(() => {
    if (!activeGroup || !state) return
    const g = state.groups.find((x) => x.id === activeGroup)
    if (!g || g.fixtureCount !== selectionCount) setActiveGroup(null)
  }, [activeGroup, selectionCount, state])

  if (!state) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-surface-0 text-fg-secondary">
        <Spinner size={24} />
        <span className="text-base">{t('stage.waiting')}</span>
        <span className="text-sm text-fg-tertiary">{t('stage.escToClose')}</span>
      </div>
    )
  }

  const grandMaster = hold('gm', state.grandMaster)
  const anyPlaying = state.cuelists.some((c) => c.isPlaying) || (state.chases ?? []).some((c) => c.isPlaying)

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-surface-0 text-fg-primary">
      <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-line bg-surface-1 px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="rounded-sm bg-accent/15 px-2 py-1 text-2xs font-bold uppercase tracking-[0.12em] text-accent-fg">{t('stage.badge')}</span>
          <h1 className="truncate text-xl font-semibold">{state.showName}</h1>
          {state.isDirty && <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title={t('stage.unsavedOnConsole')} aria-label={t('stage.unsaved')} />}
          <span className="hidden whitespace-nowrap text-sm text-fg-tertiary xl:inline">
            {t('stage.summary', { fixtures: t('common.fixtureCount', { count: state.fixtureCount }), scenes: t('common.sceneCount', { count: state.cuelists.length }) })}
          </span>
        </div>
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
          <GrandMasterFader
            size="lg"
            value={grandMaster}
            onChange={(v) => { setLocal('gm', v); sendThrottled('gm', 'set-grand-master', v) }}
          />
          <MasterButtons
            layout="column"
            size="lg"
            blackout={state.blackout}
            blinder={state.blinder}
            strobe={state.strobe}
            onBlackout={() => send('toggle-blackout')}
            onBlinder={(on) => send('toggle-blinder', on)}
            onStrobe={(on) => send('toggle-strobe', on)}
          />
          <PlaybackButtons
            timelinePlaying={state.timelinePlaying}
            onTimeline={() => send('toggle-timeline')}
            onClear={() => send('clear-programmer')}
            onReleaseAll={() => send('release-all')}
            anyPlaying={anyPlaying}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <GroupStrip
            size="lg"
            groups={state.groups}
            activeGroupId={activeGroup}
            selectionCount={selectionCount}
            onSelectGroup={(id) => { setActiveGroup(id); send('select-group', id) }}
            onSelectAll={() => { setActiveGroup(null); send('select-all') }}
            onClear={() => { setActiveGroup(null); send('clear-selection') }}
          />
          {state.cuelists.length === 0 ? (
            <div className="flex min-h-0 flex-1 rounded-lg border border-dashed border-line">
              <EmptyState
                icon={LuClapperboard}
                title={t('stage.noScenes')}
                description={t('stage.noScenesConsole')}
              />
            </div>
          ) : (
            <SceneGrid
              size="lg"
              grid={state.executorGrid}
              columns={state.executorColumns}
              modes={state.executorModes}
              scenes={scenesWithHeld}
              mode={gridMode}
              onFire={onFire}
              onLevel={onLevel}
              onSwap={onSwap}
            />
          )}
          {gridMode !== 'play' && (
            <p className={cn('shrink-0 text-center text-sm', gridMode === 'arrange' ? 'text-info-fg' : 'text-fg-tertiary')}>
              {gridMode === 'arrange'
                ? t('stage.arrangeHint')
                : t('stage.levelsHint')}
            </p>
          )}
        </main>
      </div>
    </div>
  )
}
