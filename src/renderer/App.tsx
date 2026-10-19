import React, { useEffect } from 'react'
import { LuLayoutDashboard } from 'react-icons/lu'
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
import { Button, DialogHost, Spinner, ToastHost } from './components/ui'
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
import { ExecutorBar } from './components/layout/ExecutorBar'
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
      // Remote: fetch the console's show for display (patch, scenes, timeline…);
      // live state then arrives with the state broadcasts.
      await loadLastShow()
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
      // Application menu (and its Cmd/Ctrl accelerators): same flow as the File menu
      listen(bridge.onMenuEvent('menu:new', () => { void requestNewShow() })),
      listen(bridge.onMenuEvent('menu:save', () => { void requestSave() })),
      listen(bridge.onMenuEvent('menu:save-as', () => { void requestSaveAs() })),
      listen(bridge.onMenuEvent('menu:load', () => { void requestOpenShow() })),
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
    switch (activeTab) {
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
      case 'settings':   return <SettingsView />
      default:           return <StageLayoutView />
    }
  }

  const overlays = (
    <>
      <DialogHost />
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
          {!isPhone() && (
            <Button
              variant="secondary"
              icon={LuLayoutDashboard}
              onClick={() => useUiStore.getState().setStageMode(false)}
              className="fixed right-3 top-3 z-popover"
            >
              Full console
            </Button>
          )}
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
        <main className="min-w-0 flex-1 overflow-hidden" data-view={activeTab}>
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
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-fg-tertiary">
      <Spinner size={16} /> Loading view…
    </div>
  )
}
