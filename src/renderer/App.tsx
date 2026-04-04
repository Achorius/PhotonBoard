import React, { useEffect, useCallback } from 'react'
import { useUiStore, type ViewTab } from './stores/ui-store'
import { usePatchStore } from './stores/patch-store'
import { useMidiStore } from './stores/midi-store'
import { usePlaybackStore } from './stores/playback-store'
import { useVisualizerStore } from './stores/visualizer-store'
import type { ShowFile } from '@shared/types'
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
import { LiveView } from './components/live/LiveView'
import { ExecutorBar } from './components/layout/ExecutorBar'
import { usePlaybackController } from './hooks/usePlaybackController'

type WorkspaceTab = { id: ViewTab; label: string; shortcut: string }

const WORKSPACE_TABS: WorkspaceTab[] = [
  { id: 'visualizer', label: '3D',       shortcut: '1' },
  { id: 'fixtures',   label: 'Fixtures', shortcut: '2' },
  { id: 'faders',     label: 'Faders',   shortcut: '3' },
  { id: 'playback',   label: 'Playback', shortcut: '4' },
  { id: 'effects',    label: 'Effects',  shortcut: '5' },
  { id: 'patch',      label: 'Patch',    shortcut: '6' },
  { id: 'midi',       label: 'MIDI',     shortcut: '7' },
  { id: 'live',       label: 'Live',     shortcut: '8' },
  { id: 'settings',   label: 'Settings', shortcut: '9' },
]

export default function App() {
  const { activeTab, setActiveTab } = useUiStore()
  const { loadFixtures } = usePatchStore()
  const { initMidi } = useMidiStore()

  usePlaybackController()

  // ---- Save / Load helpers ----
  const collectShowData = useCallback((): ShowFile => {
    const { patch, groups } = usePatchStore.getState()
    const { cuelists, chases } = usePlaybackStore.getState()
    const { showName } = useUiStore.getState()
    const { roomConfig } = useVisualizerStore.getState()
    return {
      version: '1.0.0',
      name: showName,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      artnetConfig: [
        { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
        { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
        { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
      ],
      patch,
      groups,
      presets: [],
      cuelists,
      chases,
      effects: [],
      midiMappings: [],
      stageLayout: { width: 1200, height: 600, fixtures: [] },
      roomConfig
    }
  }, [])

  const applyShowData = useCallback((show: ShowFile) => {
    usePatchStore.getState().setPatch(show.patch || [])
    usePatchStore.getState().setGroups(show.groups || [])
    usePlaybackStore.getState().setCuelists(show.cuelists || [])
    usePlaybackStore.getState().setChases(show.chases || [])
    useUiStore.getState().setShowName(show.name || 'New Show')
    if (show.roomConfig) useVisualizerStore.getState().setRoomConfig(show.roomConfig)
  }, [])

  const handleSave = useCallback(async () => {
    const show = collectShowData()
    const result = await window.photonboard.show.save(show)
    if (result?.path) useUiStore.getState().setShowName(show.name)
  }, [collectShowData])

  const handleSaveAs = useCallback(async () => {
    const show = collectShowData()
    const result = await window.photonboard.show.saveAs(show)
    if (result?.path) useUiStore.getState().setShowName(show.name)
  }, [collectShowData])

  const handleLoad = useCallback(async () => {
    const result = await window.photonboard.show.load()
    if (result?.show) applyShowData(result.show)
  }, [applyShowData])

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
      // Cmd+S / Cmd+Shift+S / Cmd+O — always active, even in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (e.shiftKey) handleSaveAs()
        else handleSave()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault()
        handleLoad()
        return
      }

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
        const { usePlaybackStore: PBStore } = require('./stores/playback-store')
        const cuelists = PBStore.getState().cuelists
        if (cuelists.length > 0) {
          PBStore.getState().goCuelist(cuelists[0].id)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, handleSave, handleSaveAs, handleLoad])

  const renderView = () => {
    switch (activeTab) {
      case 'faders':     return <FadersView />
      case 'patch':      return <PatchView />
      case 'fixtures':   return <FixtureControlView />
      case 'playback':   return <PlaybackView />
      case 'effects':    return <EffectsView />
      case 'midi':       return <MidiView />
      case 'visualizer': return <VisualizerView />
      case 'live':       return <LiveView />
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
