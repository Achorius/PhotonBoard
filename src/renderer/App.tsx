import React, { useEffect } from 'react'
import { useUiStore } from './stores/ui-store'
import { usePatchStore } from './stores/patch-store'
import { useMidiStore } from './stores/midi-store'
import { initMidiRouting } from './lib/midi-manager'
import { Toolbar } from './components/layout/Toolbar'
import { StatusBar } from './components/layout/StatusBar'
import { FadersView } from './components/faders/FadersView'
import { PatchView } from './components/patch/PatchView'
import { FixtureControlView } from './components/fixtures/FixtureControlView'
import { PlaybackView } from './components/playback/PlaybackView'
import { EffectsView } from './components/effects/EffectsView'
import { MidiView } from './components/midi/MidiView'
import { StageView } from './components/stage/StageView'
import { VisualizerView } from './components/visualizer/VisualizerView'
import { SettingsView } from './components/settings/SettingsView'
import { ExecutorBar } from './components/layout/ExecutorBar'

export default function App() {
  const { activeTab, setActiveTab } = useUiStore()
  const { loadFixtures } = usePatchStore()
  const { initMidi } = useMidiStore()

  // Initialize on mount
  useEffect(() => {
    loadFixtures()
    initMidi()
    initMidiRouting()

    // Configure default ArtNet
    window.photonboard.artnet.configure([
      { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
      { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
      { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
    ])
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab switching with number keys (not in input fields)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      const tabs = ['faders', 'patch', 'fixtures', 'playback', 'effects', 'midi', 'stage', 'visualizer', 'settings'] as const
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        setActiveTab(tabs[num - 1])
        e.preventDefault()
      }

      // Blackout on Escape
      if (e.key === 'Escape') {
        const { useDmxStore } = require('./stores/dmx-store')
        useDmxStore.getState().toggleBlackout()
      }

      // Space = GO on first cuelist
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
      case 'faders': return <FadersView />
      case 'patch': return <PatchView />
      case 'fixtures': return <FixtureControlView />
      case 'playback': return <PlaybackView />
      case 'effects': return <EffectsView />
      case 'midi': return <MidiView />
      case 'stage': return <StageView />
      case 'visualizer': return <VisualizerView />
      case 'settings': return <SettingsView />
      default: return <FadersView />
    }
  }

  return (
    <div className="flex flex-col h-screen bg-surface-0 text-gray-200">
      <Toolbar />
      <main className="flex-1 overflow-hidden">
        {renderView()}
      </main>
      <ExecutorBar />
      <StatusBar />
    </div>
  )
}
