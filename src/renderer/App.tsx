import React, { useEffect } from 'react'
import { isPhone, useUiStore } from './stores/ui-store'
import { usePatchStore } from './stores/patch-store'
import { useMidiStore } from './stores/midi-store'
import { initMidiRouting } from './lib/midi-manager'
import { startFollowGamepadLoop } from './stores/follow-store'
import { Toolbar } from './components/layout/Toolbar'
import { NavRail } from './components/layout/NavRail'
import { StatusBar } from './components/layout/StatusBar'
import { PatchPanel } from './components/layout/PatchPanel'
import { ShortcutsDialog } from './components/layout/ShortcutsDialog'
import { RemoteAccess } from './components/layout/RemoteAccess'
import { BlackoutBanner } from './components/layout/MasterControls'
import { requestNewShow, requestOpenShow, requestSave, requestSaveAs } from './components/layout/file-actions'
import { DialogHost, Spinner, ToastHost, hasOpenOverlay } from './components/ui'
import { PatchView } from './components/patch/PatchView'
import { FixtureControlView } from './components/fixtures/FixtureControlView'
import { PlaybackView } from './components/playback/PlaybackView'
import { EffectsView } from './components/effects/EffectsView'
import { MidiView } from './components/midi/MidiView'
import { StageLayoutView } from './components/visualizer/StageLayoutView'
import { RemoteStageView } from './components/stage/RemoteStageView'
import { getDeviceProfile } from './lib/device-detect'
import { SettingsView } from './components/settings/SettingsView'
import { LiveView } from './components/live/LiveView'
import { PoolsView } from './components/pools/PoolsView'
import { PoolDialogHost } from './components/pools/PoolDialogs'
import { StagePagesView } from './components/stage/pages/StagePagesView'
import { isProOnlyTab } from './components/layout/workspace-tabs'
import { ExecutorBar } from './components/layout/ExecutorBar'
import { startExecutorAutoSync } from './stores/executor-store'
import { FollowPanel } from './components/follow/FollowPanel'
import { usePlaybackController } from './hooks/usePlaybackController'
import { useRemoteSync } from './hooks/useRemoteSync'
import { useSelectionSync } from './hooks/useSelectionSync'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useDensityController } from './hooks/useDensityController'
import { startMixer, stopMixer } from './lib/dmx-mixer'
import { getBridge, isRemoteMode } from './lib/runtime'
import { handleCommand } from './lib/command-handler'
import { startStateBroadcast } from './lib/state-snapshot'
import { installDirtyTracking, loadLastShow } from './lib/show-io'
import { installContentTracking, loadConsoleShow } from './lib/content-sync'
import { installHistory, redo, undo } from './lib/history'
import { getLocale, onLocaleChange, useT } from './i18n'
import { installPro } from './lib/pro/setup'

/** Text field focused: the Edit menu's Undo / Redo act on the text, not on the show */
function isEditingText(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

// Lazy-load the 3D visualizer (three.js): not loaded until the 3D tab opens,
// never on weak GPUs (they get the 2D stage layout instead)
const VisualizerView = React.lazy(() =>
  import('./components/visualizer/VisualizerView').then(m => ({ default: m.VisualizerView }))
)

/** Call an `on*` bridge listener and return its unsubscribe (older bridges return void). */
function listen(off: unknown): () => void {
  return () => { if (typeof off === 'function') off() }
}

export default function App() {
  const activeTab = useUiStore(s => s.activeTab)
  const stageMode = useUiStore(s => s.stageMode)
  const sidebarOpen = useUiStore(s => s.sidebarOpen)
  const executorBarOpen = useUiStore(s => s.executorBarOpen)
  const proMode = useUiStore(s => s.proMode)
  // Pro-only views fall back to the programmer when the Pro view is turned off
  const view = !proMode && isProOnlyTab(activeTab) ? 'fixtures' : activeTab

  usePlaybackController()
  useRemoteSync()
  useSelectionSync()
  useDensityController()
  useKeyboardShortcuts()

  // Central DMX mixer (programmer, scenes, chases, effects, timeline → output).
  // In remote mode, DMX comes from the Pi — no local mixer.
  useEffect(() => {
    if (isRemoteMode()) return
    startMixer()
    return () => stopMixer()
  }, [])

  // Executor slots follow the scene list even when the executor bar is hidden
  useEffect(() => startExecutorAutoSync(), [])

  // Undo / redo of show content (console and remote: each device undoes its own edits)
  useEffect(() => installHistory(), [])

  // Pro layer: programmer engine (park, group masters, Blind), command line context
  // (real ProApi), column fader values, runtime object numbers
  useEffect(() => installPro(), [])

  // One-time init: fixture library, MIDI, gamepad, last show
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        await usePatchStore.getState().loadFixtures()
      } catch (e) {
        console.error('[Init] loadFixtures failed:', e)
      }
      if (cancelled) return
      try { await useMidiStore.getState().initMidi() } catch (e) { console.warn('[Init] MIDI init skipped:', e) }
      try { initMidiRouting() } catch (e) { console.warn('[Init] MIDI routing skipped:', e) }
      if (!isRemoteMode()) {
        try { startFollowGamepadLoop() } catch (e) { console.warn('[Init] Gamepad init skipped:', e) }
      }
      // Console: reload the last show (DMX outputs are machine config, applied by main).
      // Remote: the show the console is running NOW (unsaved edits included — never
      // a file, never echoed back); live state then arrives with the state broadcasts.
      if (isRemoteMode()) await loadConsoleShow()
      else await loadLastShow()
    }
    void init()
    return () => { cancelled = true }
  }, [])

  // Console only: dirty tracking, menu, commands, state broadcast
  useEffect(() => {
    if (isRemoteMode()) return
    const bridge = getBridge()
    if (!bridge) return
    const offs = [
      installDirtyTracking(),
      // Content revisions: remotes refetch what changed (lib/content-sync.ts)
      installContentTracking(),
      // Application menu (and its Cmd/Ctrl accelerators): same flow as the File menu
      listen(bridge.onMenuEvent('menu:new', () => { void requestNewShow() })),
      listen(bridge.onMenuEvent('menu:save', () => { void requestSave() })),
      listen(bridge.onMenuEvent('menu:save-as', () => { void requestSaveAs() })),
      listen(bridge.onMenuEvent('menu:load', () => { void requestOpenShow() })),
      // Edit menu (Mod+Z / redo accelerators): text undo inside a field, show undo elsewhere
      listen(bridge.onMenuEvent('menu:undo', () => { if (isEditingText()) document.execCommand('undo'); else if (!hasOpenOverlay()) undo() })),
      listen(bridge.onMenuEvent('menu:redo', () => { if (isEditingText()) document.execCommand('redo'); else if (!hasOpenOverlay()) redo() })),
      // Native menus (main process) follow the UI language
      (() => {
        bridge.app.setLanguage?.(getLocale())
        return onLocaleChange((locale) => bridge.app.setLanguage?.(locale))
      })(),
      // Commands from the Stage window, remote browsers, Companion and main
      listen(bridge.stage.onCommand((command) => {
        try {
          handleCommand(command)
        } catch (e) {
          console.error('[Command] failed:', command?.type, e)
        }
      })),
      startStateBroadcast()
    ]
    return () => { for (const off of offs) off() }
  }, [])

  const renderView = () => {
    switch (view) {
      case 'patch':      return <PatchView />
      case 'fixtures':   return <FixtureControlView />
      case 'faders':     return <FixtureControlView /> // legacy: redirect to unified view
      case 'playback':   return <PlaybackView />
      case 'effects':    return <EffectsView />
      case 'midi':       return <MidiView />
      case 'visualizer': {
        // Mid-range (Pi 5) runs the 3D view at medium quality
        if (getDeviceProfile().isLowEnd) return <StageLayoutView />
        return (
          <React.Suspense fallback={<ViewLoading />}>
            <VisualizerView />
          </React.Suspense>
        )
      }
      case 'stage-layout': return <StageLayoutView />
      case 'live':         return <LiveView />
      case 'follow':       return <FollowPanel />
      case 'pools':        return <PoolsView />
      case 'stage':        return <StagePagesView />
      case 'settings':   return <SettingsView />
      default:           return <StageLayoutView />
    }
  }

  const overlays = (
    <>
      <DialogHost />
      <PoolDialogHost />
      <ShortcutsDialog />
    </>
  )

  // ---- Remote Stage Mode ----
  // Phone: always stage, no way out
  // Tablet: stage by default, button to switch to full app
  // Desktop browser: full app, Stage button to switch
  if (isRemoteMode() && stageMode) {
    return (
      <div className="relative flex h-screen w-screen flex-col bg-surface-0 text-fg-primary">
        <RemoteAccess />
        <div className="relative min-h-0 flex-1">
          <RemoteStageView />
          {/* The masters (Blackout) sit at the bottom of the stage view */}
          <ToastHost placement="top" />
        </div>
        {overlays}
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-surface-0 text-fg-primary">
      <Toolbar />
      <BlackoutBanner />
      <RemoteAccess />
      <div className="relative flex min-h-0 flex-1">
        <NavRail />
        {sidebarOpen && <PatchPanel />}
        <main className="min-w-0 flex-1 overflow-hidden" data-view={view}>
          {renderView()}
        </main>
        {/* Over the view, above the executor + status bars */}
        <ToastHost />
      </div>
      {executorBarOpen && <ExecutorBar />}
      <StatusBar />
      {overlays}
    </div>
  )
}

function ViewLoading() {
  const t = useT()
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-fg-tertiary">
      <Spinner size={16} /> {t('shell.loadingView')}
    </div>
  )
}
