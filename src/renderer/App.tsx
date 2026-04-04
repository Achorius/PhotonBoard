import React, { useEffect } from 'react'
import { useUiStore, type ViewTab } from './stores/ui-store'
import { usePatchStore } from './stores/patch-store'
import { useMidiStore } from './stores/midi-store'
import { initMidiRouting } from './lib/midi-manager'
import { Toolbar } from './components/layout/Toolbar'
import { StatusBar } from './components/layout/StatusBar'
import { PatchPanel } from './components/layout/PatchPanel'
import { FadersView } from './components/faders/FadersView'
import { PatchView } from './components/patch/PatchView'
import { FixtureControlView } from './components/fixtures/FixtureControlView'
import { PlaybackView } from './components/playback/PlaybackView'
import { EffectsView } from './components/effects/EffectsView'
import { MidiView } from './components/midi/MidiView'
import { VisualizerView } from './components/visualizer/VisualizerView'
import { SettingsView } from './components/settings/SettingsView'
import { ExecutorBar } from './components/layout/ExecutorBar'

type WorkspaceTab = { id: ViewTab; label: string; shortcut: string }

const WORKSPACE_TABS: WorkspaceTab[] = [
  { id: 'visualizer', label: '3D',       shortcut: '1' },
  { id: 'fixtures',   label: 'Fixtures', shortcut: '2' },
  { id: 'faders',     label: 'Faders',   shortcut: '3' },
  { id: 'playback',   label: 'Playback', shortcut: '4' },
  { id: 'effects',    label: 'Effects',  shortcut: '5' },
  { id: 'patch',      label: 'Patch',    shortcut: '6' },
  { id: 'midi',       label: 'MIDI',     shortcut: '7' },
  { id: 'settings',   label: 'Settings', shortcut: '8' },
]

export default function App() {
  const { activeTab, setActiveTab } = useUiStore()
  const { loadFixtures } = usePatchStore()
  const { initMidi } = useMidiStore()

  useEffect(() => {
    loadFixtures()
    initMidi()
    initMidiRouting()
    window.photonboard.artnet.configure([
      { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
      { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
      { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
    ])
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      const num = parseInt(e.key)
      if (num >= 1 && num <= WORKSPACE_TABS.length) {
        setActiveTab(WORKSPACE_TABS[num - 1].id)
        e.preventDefault()
      }

      if (e.key === 'Escape') {
        const { useDmxStore } = require('./stores/dmx-store')
        useDmxStore.getState().toggleBlackout()
      }

      if (e.key === ' ' && activeTab === 'playback') {
        const { usePlaybackStore } = require('./stores/playback-store')
        const cuelists = usePlaybackStore.getState().cuelists
        if (cuelists.length > 0) {
          usePlaybackStore.getState().goCuelist(cuelists[0].id)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab])

  const renderView = () => {
    switch (activeTab) {
      case 'faders':     return <FadersView />
      case 'patch':      return <PatchView />
      case 'fixtures':   return <FixtureControlView />
      case 'playback':   return <PlaybackView />
      case 'effects':    return <EffectsView />
      case 'midi':       return <MidiView />
      case 'visualizer': return <VisualizerView />
      case 'settings':   return <SettingsView />
      default:           return <VisualizerView />
    }
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
          <div className="flex items-center gap-0.5 px-2 py-1 border-b border-surface-3 bg-surface-1 shrink-0">
            {WORKSPACE_TABS.map(({ id, label, shortcut }) => (
              <button
                key={id}
                className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
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
