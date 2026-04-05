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
    // Access store state directly at call time
    const fullPatchState = usePatchStore.getState()
    const patch = [...fullPatchState.patch] // shallow copy to ensure serializable
    const groups = [...fullPatchState.groups]
    const { cuelists, chases } = usePlaybackStore.getState()
    const { showName } = useUiStore.getState()
    const { roomConfig } = useVisualizerStore.getState()
    console.log('[PhotonBoard] collectShowData — patch:', patch.length, 'groups:', groups.length, 'showName:', showName, 'storeKeys:', Object.keys(fullPatchState).join(','))
    if (patch.length > 0) {
      console.log('[PhotonBoard] First fixture:', JSON.stringify(patch[0]).slice(0, 100))
    } else {
      console.log('[PhotonBoard] WARNING: patch is EMPTY!')
    }
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
      cuelists: [...cuelists],
      chases: [...chases],
      effects: [],
      midiMappings: [],
      stageLayout: { width: 1200, height: 600, fixtures: [] },
      roomConfig: { ...roomConfig }
    }
  }, [])

  const applyShowData = useCallback((show: ShowFile) => {
    console.log('[PhotonBoard] Applying show data:', show.name, 'patch:', show.patch?.length, 'groups:', show.groups?.length)
    usePatchStore.getState().setPatch(show.patch || [])
    usePatchStore.getState().setGroups(show.groups || [])
    usePlaybackStore.getState().setCuelists(show.cuelists || [])
    usePlaybackStore.getState().setChases(show.chases || [])
    useUiStore.getState().setShowName(show.name || 'New Show')
    if (show.roomConfig) useVisualizerStore.getState().setRoomConfig(show.roomConfig)
    // Clear selections
    usePatchStore.getState().clearSelection()
    useVisualizerStore.getState().selectFixture(null)
  }, [])

  // Guards to prevent concurrent save/load operations
  const isSaving = React.useRef(false)
  const isLoading = React.useRef(false)

  const handleSave = useCallback(async () => {
    if (isSaving.current) {
      console.log('[PhotonBoard] Save already in progress, skipping')
      return
    }
    isSaving.current = true
    try {
      const show = collectShowData()
      console.log('[PhotonBoard] Saving show:', show.name, 'patch:', show.patch.length)
      const result = await window.photonboard.show.save(show)
      console.log('[PhotonBoard] Save result:', result)
      if (result && result.path) {
        const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || show.name
        useUiStore.getState().setShowName(fileName)
      }
    } catch (e) {
      console.error('[PhotonBoard] Save error:', e)
    } finally {
      isSaving.current = false
    }
  }, [collectShowData])

  const handleSaveAs = useCallback(async () => {
    if (isSaving.current) {
      console.log('[PhotonBoard] SaveAs already in progress, skipping')
      return
    }
    isSaving.current = true
    try {
      const show = collectShowData()
      const result = await window.photonboard.show.saveAs(show)
      console.log('[PhotonBoard] SaveAs result:', result)
      if (result && result.path) {
        const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || show.name
        useUiStore.getState().setShowName(fileName)
      }
    } catch (e) {
      console.error('[PhotonBoard] SaveAs error:', e)
    } finally {
      isSaving.current = false
    }
  }, [collectShowData])

  const handleLoad = useCallback(async () => {
    console.log('[PhotonBoard] handleLoad ENTERED, isLoading:', isLoading.current)
    if (isLoading.current) {
      console.log('[PhotonBoard] Load already in progress, skipping')
      return
    }
    isLoading.current = true
    try {
      console.log('[PhotonBoard] Calling show.load() IPC...')
      const result = await window.photonboard.show.load()
      console.log('[PhotonBoard] Load IPC returned:', result ? 'got result' : 'null/undefined')
      if (!result) {
        console.log('[PhotonBoard] Load cancelled (no result)')
        return
      }
      console.log('[PhotonBoard] Load result keys:', Object.keys(result).join(','), 'success:', result.success)
      // Handle both direct show object and wrapped result
      const show = result.show || (result as any)
      console.log('[PhotonBoard] Show object:', show ? 'exists' : 'null', 'name:', show?.name, 'patch:', show?.patch?.length, 'groups:', show?.groups?.length)
      if (show && show.patch) {
        // Use filename as show name if available
        if (result.path) {
          const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || show.name
          show.name = fileName
        }
        console.log('[PhotonBoard] Applying loaded show:', show.name, 'patch entries:', show.patch.length)
        applyShowData(show as ShowFile)
        console.log('[PhotonBoard] applyShowData done, reloading fixtures...')
        await usePatchStore.getState().loadFixtures()
        console.log('[PhotonBoard] Load complete!')
      } else {
        console.error('[PhotonBoard] Load failed - no show data in result:', JSON.stringify(result).slice(0, 200))
      }
    } catch (e) {
      console.error('[PhotonBoard] Load error:', e)
    } finally {
      isLoading.current = false
      console.log('[PhotonBoard] handleLoad EXITED, isLoading reset to false')
    }
  }, [applyShowData])

  const handleNew = useCallback(async () => {
    if (isLoading.current) {
      console.log('[PhotonBoard] New already in progress, skipping')
      return
    }
    isLoading.current = true
    try {
      const show = await window.photonboard.show.new()
      console.log('[PhotonBoard] New show:', show)
      if (show) {
        applyShowData(show as ShowFile)
      }
    } catch (e) {
      console.error('[PhotonBoard] New error:', e)
    } finally {
      isLoading.current = false
    }
  }, [applyShowData])

  // Sync selection between patch-store (multi) and visualizer-store (single)
  useEffect(() => {
    // When patch-store selection changes → update visualizer-store
    const unsubPatch = usePatchStore.subscribe(
      (s) => s.selectedFixtureIds,
      (ids) => {
        const vizId = useVisualizerStore.getState().selectedFixtureId
        if (ids.length === 1 && ids[0] !== vizId) {
          useVisualizerStore.getState().selectFixture(ids[0])
        } else if (ids.length === 0 && vizId !== null) {
          useVisualizerStore.getState().selectFixture(null)
        }
      }
    )
    // When visualizer-store selection changes → update patch-store
    const unsubViz = useVisualizerStore.subscribe(
      (s) => s.selectedFixtureId,
      (id) => {
        const patchIds = usePatchStore.getState().selectedFixtureIds
        if (id && !patchIds.includes(id)) {
          usePatchStore.getState().selectFixture(id, false)
        } else if (!id && patchIds.length > 0) {
          usePatchStore.getState().clearSelection()
        }
      }
    )
    return () => { unsubPatch(); unsubViz() }
  }, [])

  useEffect(() => {
    const init = async () => {
      await loadFixtures()
      initMidi()
      initMidiRouting()
      window.photonboard.artnet.configure([
        { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
        { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
        { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
      ])

      // Auto-load the last saved show
      try {
        const result = await window.photonboard.show.loadLast()
        console.log('[PhotonBoard] Auto-load result:', result)
        if (result && result.success && result.show) {
          // Use filename as show name
          if (result.path) {
            const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || result.show.name
            result.show.name = fileName
          }
          applyShowData(result.show as ShowFile)
          console.log('[PhotonBoard] Auto-loaded show:', result.show.name, 'patch:', result.show.patch?.length)
        }
      } catch (e) {
        console.error('[PhotonBoard] Auto-load failed:', e)
      }
    }
    init()
  }, [])

  // Register menu event handlers — onMenuEvent replaces (not accumulates) handlers
  useEffect(() => {
    window.photonboard.onMenuEvent('menu:new', handleNew)
    window.photonboard.onMenuEvent('menu:save', handleSave)
    window.photonboard.onMenuEvent('menu:save-as', handleSaveAs)
    window.photonboard.onMenuEvent('menu:load', handleLoad)
  }, [handleNew, handleSave, handleSaveAs, handleLoad])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // File shortcuts (Cmd+S/O/N) are handled by Electron menu accelerators → onMenuEvent
      // Only handle non-file shortcuts here

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
