import React, { useEffect } from 'react'
import { useUiStore, type ViewTab } from './stores/ui-store'
import { usePatchStore } from './stores/patch-store'
import { useDmxStore } from './stores/dmx-store'
import { useMidiStore } from './stores/midi-store'
import { usePlaybackStore } from './stores/playback-store'
import { initMidiRouting } from './lib/midi-manager'
import { startFollowGamepadLoop } from './stores/follow-store'
import { Toolbar } from './components/layout/Toolbar'
import { StatusBar } from './components/layout/StatusBar'
import { PatchPanel } from './components/layout/PatchPanel'
import { PatchView } from './components/patch/PatchView'
import { FixtureControlView } from './components/fixtures/FixtureControlView'
import { PlaybackView } from './components/playback/PlaybackView'
import { EffectsView } from './components/effects/EffectsView'
import { MidiView } from './components/midi/MidiView'
import { StageLayoutView } from './components/visualizer/StageLayoutView'
import { RemoteStageView } from './components/stage/RemoteStageView'
import { getDeviceProfile } from './lib/device-detect'
import { isPhone } from './stores/ui-store'

// Lazy-load 3D visualizer — never imported on ARM/mid-range devices
const VisualizerView = React.lazy(() =>
  import('./components/visualizer/VisualizerView').then(m => ({ default: m.VisualizerView }))
)
import { SettingsView } from './components/settings/SettingsView'
import { LiveView } from './components/live/LiveView'
import { ExecutorBar } from './components/layout/ExecutorBar'
import { FollowPanel } from './components/follow/FollowPanel'
import { usePlaybackController } from './hooks/usePlaybackController'
import { useRemoteSync } from './hooks/useRemoteSync'
import { useSelectionSync } from './hooks/useSelectionSync'
import { startMixer, stopMixer, clearProgrammer } from './lib/dmx-mixer'
import { getBridge, isRemoteMode } from './lib/runtime'
import { handleCommand } from './lib/command-handler'
import { startStateBroadcast } from './lib/state-snapshot'
import { installDirtyTracking, loadLastShow, newShow, openShow, saveShow } from './lib/show-io'

type WorkspaceTab = { id: ViewTab; label: string; shortcut: string }

const WORKSPACE_TABS: WorkspaceTab[] = [
  { id: 'visualizer',    label: '3D View',      shortcut: '1' },
  { id: 'stage-layout',  label: 'Stage Layout', shortcut: '2' },
  { id: 'live',          label: 'Timeline',     shortcut: '3' },
  { id: 'effects',       label: 'Effects',      shortcut: '4' },
  { id: 'playback',      label: 'Scenes',       shortcut: '5' },
  { id: 'fixtures',      label: 'Fixtures',     shortcut: '6' },
  { id: 'patch',         label: 'Patch',        shortcut: '7' },
  { id: 'midi',          label: 'MIDI',         shortcut: '8' },
  { id: 'follow',        label: 'Follow',       shortcut: '9' },
  { id: 'settings',      label: 'Settings',     shortcut: '0' },
]

/** Call an `on*` bridge listener and return its unsubscribe (older bridges return void). */
function listen(off: unknown): () => void {
  return () => { if (typeof off === 'function') off() }
}

export default function App() {
  const activeTab = useUiStore(s => s.activeTab)
  const setActiveTab = useUiStore(s => s.setActiveTab)
  const stageMode = useUiStore(s => s.stageMode)
  const setStageMode = useUiStore(s => s.setStageMode)

  usePlaybackController()
  useRemoteSync()
  useSelectionSync()

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
      listen(bridge.onMenuEvent('menu:new', () => { void newShow() })),
      listen(bridge.onMenuEvent('menu:save', () => { void saveShow() })),
      listen(bridge.onMenuEvent('menu:save-as', () => { void saveShow({ saveAs: true }) })),
      listen(bridge.onMenuEvent('menu:load', () => { void openShow() })),
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // File shortcuts (Cmd+S/O/N) are handled by Electron menu accelerators → onMenuEvent
      // Only handle non-file shortcuts here

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      const tab = WORKSPACE_TABS.find(t => t.shortcut === e.key)
      if (tab) {
        setActiveTab(tab.id)
        e.preventDefault()
      }

      if (e.key === 'Escape') {
        useDmxStore.getState().toggleBlackout()
      }

      if (e.key === 'Backspace') {
        clearProgrammer()
        e.preventDefault()
      }

      if (e.key === ' ' && activeTab === 'playback') {
        const cuelists = usePlaybackStore.getState().cuelists
        if (cuelists.length > 0) {
          usePlaybackStore.getState().goCuelist(cuelists[0].id)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, setActiveTab])

  const renderView = () => {
    switch (activeTab) {
      case 'patch':      return <PatchView />
      case 'fixtures':   return <FixtureControlView />
      case 'faders':     return <FixtureControlView /> // legacy: redirect to unified view
      case 'playback':   return <PlaybackView />
      case 'effects':    return <EffectsView />
      case 'midi':       return <MidiView />
      case 'visualizer': {
        const dev = getDeviceProfile()
        if (dev.isMidRange || dev.isLowEnd) return <StageLayoutView />
        return (
          <React.Suspense fallback={<div className="w-full h-full bg-surface-0" />}>
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

  // ---- Remote Stage Mode ----
  // Phone: always stage, no way out
  // Tablet: stage by default, button to switch to full app
  // Desktop browser: full app, Stage button to switch
  if (isRemoteMode() && stageMode) {
    // Phone: stage only, no toggle
    if (isPhone()) {
      return (
        <div className="h-screen w-screen bg-surface-0 text-gray-200 select-none">
          <RemoteStageView />
        </div>
      )
    }
    // Tablet / Desktop: stage with "App" button to switch back
    return (
      <div className="h-screen w-screen bg-surface-0 text-gray-200 select-none relative">
        <RemoteStageView />
        <button
          className="fixed top-3 right-3 z-50 px-3 py-1.5 text-xs font-bold rounded-lg bg-accent/90 text-white shadow-lg hover:bg-accent transition-colors"
          onClick={() => setStageMode(false)}
          style={{ backdropFilter: 'blur(8px)' }}
        >
          App ▸
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-surface-0 text-gray-200 select-none">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: persistent patch panel */}
        <PatchPanel />

        {/* Center: workspace */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Workspace tab bar */}
          <div className="flex items-center gap-0.5 px-2 py-1 border-b border-surface-3 bg-surface-1 shrink-0 overflow-x-auto">
            {WORKSPACE_TABS.map(({ id, label, shortcut }) => (
              <button
                key={id}
                className={`px-2.5 py-0.5 text-xs rounded transition-colors whitespace-nowrap ${
                  activeTab === id
                    ? 'bg-accent text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-3'
                }`}
                onClick={() => setActiveTab(id)}
                title={`${label} (${shortcut})`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* View content */}
          <main className="flex-1 overflow-hidden">
            {renderView()}
          </main>
        </div>
      </div>

      {/* Bottom: executor / playback bar */}
      <ExecutorBar />
      <StatusBar />
    </div>
  )
}
