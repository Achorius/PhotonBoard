import React, { useEffect, useCallback } from 'react'
import { useUiStore, type ViewTab } from './stores/ui-store'
import { usePatchStore } from './stores/patch-store'
import { useDmxStore } from './stores/dmx-store'
import { useMidiStore } from './stores/midi-store'
import { usePlaybackStore } from './stores/playback-store'
import { useVisualizerStore } from './stores/visualizer-store'
import type { ShowFile } from '@shared/types'
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
import { VisualizerView } from './components/visualizer/VisualizerView'
import { StageLayoutView } from './components/visualizer/StageLayoutView'
import { SettingsView } from './components/settings/SettingsView'
import { LiveView } from './components/live/LiveView'
import { ExecutorBar } from './components/layout/ExecutorBar'
import { FollowPanel } from './components/follow/FollowPanel'
import { usePlaybackController } from './hooks/usePlaybackController'
import { startMixer, stopMixer, clearProgrammer } from './lib/dmx-mixer'
import { getTimelineState, toggleTimeline } from './lib/timeline-engine'

const DEFAULT_ARTNET_CONFIG = [
  { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
  { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
  { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 },
]

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

export default function App() {
  const { activeTab, setActiveTab } = useUiStore()
  const { loadFixtures } = usePatchStore()
  const { initMidi } = useMidiStore()

  usePlaybackController()

  // Start the central DMX mixer (merges all sources: programmer, cues, chases, effects)
  useEffect(() => {
    startMixer()
    return () => stopMixer()
  }, [])

  // ---- Save / Load helpers ----
  const collectShowData = useCallback((): ShowFile => {
    // Access store state directly at call time
    const fullPatchState = usePatchStore.getState()
    const patch = [...fullPatchState.patch] // shallow copy to ensure serializable
    const groups = [...fullPatchState.groups]
    const { cuelists, chases } = usePlaybackStore.getState()
    const { showName } = useUiStore.getState()
    const { roomConfig } = useVisualizerStore.getState()
    return {
      version: '1.0.0',
      name: showName,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      artnetConfig: DEFAULT_ARTNET_CONFIG,
      patch,
      groups,
      presets: [],
      cuelists: [...cuelists],
      chases: [...chases],
      effects: [],
      midiMappings: [...useMidiStore.getState().mappings],
      stageLayout: { width: 1200, height: 600, fixtures: [] },
      roomConfig: { ...roomConfig },
      timeline: {
        clips: [...usePlaybackStore.getState().timelineClips],
        markers: [...usePlaybackStore.getState().timelineMarkers],
        zones: [...usePlaybackStore.getState().timelineZones],
        trackCount: usePlaybackStore.getState().timelineTrackCount
      }
    }
  }, [])

  const applyShowData = useCallback((show: ShowFile) => {
    usePatchStore.getState().setPatch(show.patch || [])
    usePatchStore.getState().setGroups(show.groups || [])
    usePlaybackStore.getState().setCuelists(show.cuelists || [])
    usePlaybackStore.getState().setChases(show.chases || [])
    useUiStore.getState().setShowName(show.name || 'New Show')
    if (show.midiMappings && show.midiMappings.length > 0) useMidiStore.getState().setMappings(show.midiMappings)
    if (show.roomConfig) useVisualizerStore.getState().setRoomConfig(show.roomConfig)
    if (show.timeline) {
      usePlaybackStore.getState().setTimelineClips(show.timeline.clips || [])
      usePlaybackStore.getState().setTimelineMarkers(show.timeline.markers || [])
      usePlaybackStore.getState().setTimelineZones(show.timeline.zones || [])
      if (show.timeline.trackCount) usePlaybackStore.getState().setTimelineTrackCount(show.timeline.trackCount)
    }
    // Clear selections
    usePatchStore.getState().clearSelection()
    useVisualizerStore.getState().selectFixture(null)
  }, [])

  // Guards to prevent concurrent save/load operations
  const isSaving = React.useRef(false)
  const isLoading = React.useRef(false)

  const handleSave = useCallback(async () => {
    if (isSaving.current) return
    isSaving.current = true
    useUiStore.getState().showStatus('Saving…', 'info', 0)
    try {
      const show = collectShowData()
      const result = await window.photonboard.show.save(show)
      if (result && result.path) {
        const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || show.name
        useUiStore.getState().setShowName(fileName)
        useUiStore.getState().showStatus(`Saved ✓ ${fileName}`, 'success', 2500)
      } else {
        useUiStore.getState().showStatus('Save cancelled', 'info', 2000)
      }
    } catch (e) {
      console.error('[PhotonBoard] Save error:', e)
      useUiStore.getState().showStatus('Save failed!', 'error', 3000)
    } finally {
      isSaving.current = false
    }
  }, [collectShowData])

  const handleSaveAs = useCallback(async () => {
    if (isSaving.current) return
    isSaving.current = true
    useUiStore.getState().showStatus('Save As…', 'info', 0)
    try {
      const show = collectShowData()
      const result = await window.photonboard.show.saveAs(show)
      if (result && result.path) {
        const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || show.name
        useUiStore.getState().setShowName(fileName)
        useUiStore.getState().showStatus(`Saved ✓ ${fileName}`, 'success', 2500)
      } else {
        useUiStore.getState().showStatus('Save cancelled', 'info', 2000)
      }
    } catch (e) {
      console.error('[PhotonBoard] SaveAs error:', e)
      useUiStore.getState().showStatus('Save failed!', 'error', 3000)
    } finally {
      isSaving.current = false
    }
  }, [collectShowData])

  const handleLoad = useCallback(async () => {
    if (isLoading.current) return
    isLoading.current = true
    useUiStore.getState().showStatus('Opening…', 'info', 0)
    try {
      const result = await window.photonboard.show.load()
      if (!result) {
        useUiStore.getState().showStatus('Load cancelled', 'info', 2000)
        return
      }
      // Handle both direct show object and wrapped result
      const show = result.show || (result as any)
      if (show && show.patch) {
        // Use filename as show name if available
        if (result.path) {
          const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || show.name
          show.name = fileName
        }
        applyShowData(show as ShowFile)
        await usePatchStore.getState().loadFixtures()
        usePatchStore.getState().initMovingHeadDefaults()
        useUiStore.getState().showStatus(`Loaded ✓ ${show.name}`, 'success', 2500)
      } else {
        console.error('[PhotonBoard] Load failed - no show data in result:', JSON.stringify(result).slice(0, 200))
        useUiStore.getState().showStatus('Load failed — empty file', 'error', 3000)
      }
    } catch (e) {
      console.error('[PhotonBoard] Load error:', e)
      useUiStore.getState().showStatus('Load failed!', 'error', 3000)
    } finally {
      isLoading.current = false
    }
  }, [applyShowData])

  const handleNew = useCallback(async () => {
    if (isLoading.current) return
    isLoading.current = true
    try {
      const show = await window.photonboard.show.new()
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
      startFollowGamepadLoop()  // Gamepad follow loop runs globally (not tied to Follow tab)
      window.photonboard.artnet.configure(DEFAULT_ARTNET_CONFIG)

      // Auto-load the last saved show
      try {
        const result = await window.photonboard.show.loadLast()
        if (result && result.success && result.show) {
          // Use filename as show name
          if (result.path) {
            const fileName = result.path.split('/').pop()?.replace('.pbshow', '') || result.show.name
            result.show.name = fileName
          }
          applyShowData(result.show as ShowFile)
          usePatchStore.getState().initMovingHeadDefaults()
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

  // ---- Collect state snapshot (shared by stage window + API) ----
  const collectState = () => {
    const { grandMaster, blackout, blinder, strobe } = useDmxStore.getState()
    const { cuelists } = usePlaybackStore.getState()
    const { showName } = useUiStore.getState()
    const { patch, groups, selectedFixtureIds } = usePatchStore.getState()
    const timelineState = getTimelineState()

    return {
      grandMaster,
      blackout,
      blinder,
      strobe,
      timelinePlaying: timelineState.isPlaying,
      showName,
      cuelists: cuelists.map(cl => ({
        id: cl.id,
        name: cl.name,
        isPlaying: cl.isPlaying,
        faderLevel: cl.faderLevel,
        currentCueIndex: cl.currentCueIndex,
        cueCount: cl.cues.length
      })),
      groups: groups.filter(g => !g.parentGroupId).map(g => ({
        id: g.id,
        name: g.name,
        color: g.color,
        fixtureCount: g.fixtureIds.length
      })),
      selectedFixtureIds,
      fixtureCount: patch.length
    }
  }

  // ---- Stage Window state sync bridge ----
  useEffect(() => {
    // Respond to state requests from main process (for stage window sync)
    window.photonboard.stage.onRequestState(() => {
      window.photonboard.stage.sendState(collectState())
    })

    // Respond to API state requests (for Companion / external controllers)
    window.photonboard.api.onRequestState(() => {
      window.photonboard.api.sendState(collectState())
    })

    // Handle commands from stage window
    window.photonboard.stage.onCommand((command: { type: string; payload?: any }) => {
      switch (command.type) {
        case 'set-grand-master':
          useDmxStore.getState().setGrandMaster(command.payload)
          break
        case 'toggle-blackout':
          useDmxStore.getState().toggleBlackout()
          break
        case 'toggle-blinder':
          useDmxStore.getState().toggleBlinder(command.payload)
          break
        case 'toggle-strobe':
          useDmxStore.getState().toggleStrobe(command.payload)
          break
        case 'toggle-timeline':
          toggleTimeline()
          break
        case 'go-cuelist':
          usePlaybackStore.getState().goCuelist(command.payload)
          break
        case 'stop-cuelist':
          usePlaybackStore.getState().stopCuelist(command.payload)
          break
        case 'set-cuelist-fader':
          usePlaybackStore.getState().setCuelistFader(command.payload.id, command.payload.level)
          break
        case 'select-group': {
          const { clearSelection, selectFixture } = usePatchStore.getState()
          const group = usePatchStore.getState().groups.find(g => g.id === command.payload)
          if (group) {
            clearSelection()
            for (const fid of group.fixtureIds) selectFixture(fid, true)
          }
          break
        }
        case 'select-all':
          usePatchStore.getState().selectAll()
          break
        case 'clear-selection':
          usePatchStore.getState().clearSelection()
          break
        case 'clear-programmer':
          clearProgrammer()
          break
      }
    })
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
  }, [activeTab])

  const renderView = () => {
    switch (activeTab) {
      case 'patch':      return <PatchView />
      case 'fixtures':   return <FixtureControlView />
      case 'faders':     return <FixtureControlView /> // legacy: redirect to unified view
      case 'playback':   return <PlaybackView />
      case 'effects':    return <EffectsView />
      case 'midi':       return <MidiView />
      case 'visualizer':    return <VisualizerView />
      case 'stage-layout': return <StageLayoutView />
      case 'live':         return <LiveView />
      case 'follow':       return <FollowPanel />
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
