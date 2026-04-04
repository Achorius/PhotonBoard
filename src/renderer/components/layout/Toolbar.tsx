import React, { useCallback } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { useVisualizerStore } from '../../stores/visualizer-store'
import type { ShowFile } from '@shared/types'

function collectShowData(): ShowFile {
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
}

function applyShowData(show: ShowFile): void {
  usePatchStore.getState().setPatch(show.patch || [])
  usePatchStore.getState().setGroups(show.groups || [])
  usePlaybackStore.getState().setCuelists(show.cuelists || [])
  usePlaybackStore.getState().setChases(show.chases || [])
  useUiStore.getState().setShowName(show.name || 'New Show')
  if (show.roomConfig) useVisualizerStore.getState().setRoomConfig(show.roomConfig)
}

export function Toolbar() {
  const { showName } = useUiStore()
  const { grandMaster, setGrandMaster, blackout, toggleBlackout } = useDmxStore()

  const handleSave = useCallback(async () => {
    const show = collectShowData()
    const result = await window.photonboard.show.save(show)
    if (result?.path) {
      useUiStore.getState().setShowName(show.name)
    }
  }, [])

  const handleSaveAs = useCallback(async () => {
    const show = collectShowData()
    const result = await window.photonboard.show.saveAs(show)
    if (result?.path) {
      useUiStore.getState().setShowName(show.name)
    }
  }, [])

  const handleLoad = useCallback(async () => {
    const result = await window.photonboard.show.load()
    if (result?.show) {
      applyShowData(result.show)
    }
  }, [])

  return (
    <div className="h-9 bg-surface-1 border-b border-surface-3 flex items-center px-3 gap-2 shrink-0 titlebar-drag">
      {/* macOS traffic lights space */}
      <div className="w-16 shrink-0" />

      {/* Show name */}
      <span className="text-xs text-gray-400 titlebar-no-drag truncate max-w-36 font-medium">
        {showName}
      </span>

      {/* Save / Load */}
      <div className="flex items-center gap-0.5 titlebar-no-drag">
        <button
          className="px-2 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200 transition-colors"
          onClick={handleSave}
          title="Save show (quick save)"
        >
          Save
        </button>
        <button
          className="px-2 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200 transition-colors"
          onClick={handleSaveAs}
          title="Save show as…"
        >
          Save As
        </button>
        <button
          className="px-2 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200 transition-colors"
          onClick={handleLoad}
          title="Load show"
        >
          Load
        </button>
      </div>

      <div className="flex-1" />

      {/* Grand Master */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <span className="text-[10px] text-gray-500 uppercase font-medium">GM</span>
        <input
          type="range"
          min={0}
          max={255}
          value={grandMaster}
          onChange={(e) => setGrandMaster(parseInt(e.target.value))}
          className="w-24 h-1.5"
          style={{ accentColor: '#e85d04' }}
        />
        <span className="text-[10px] font-mono text-gray-400 w-8 text-right">
          {Math.round((grandMaster / 255) * 100)}%
        </span>
      </div>

      {/* Blackout */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${
          blackout
            ? 'bg-red-600 text-white animate-pulse'
            : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
        }`}
        onClick={toggleBlackout}
      >
        BO
      </button>
    </div>
  )
}
