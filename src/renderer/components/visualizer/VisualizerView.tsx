import React, { useState, useCallback, useMemo } from 'react'
import { useVisualizerStore, type VisualizerSubTab } from '@renderer/stores/visualizer-store'
import { ThreeCanvas } from './ThreeCanvas'
import { LayoutEditor2D } from './editor/LayoutEditor2D'
import { SideView } from './editor/SideView'
import { FixturePropertiesPanel } from './editor/FixturePropertiesPanel'
import { exportStagePDF } from '@renderer/lib/pdf-export'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'

export function VisualizerView() {
  const {
    subTab, setSubTab,
    roomConfig, setRoomConfig,
    showBeams, setShowBeams,
    showRoom, setShowRoom,
    showGrid, setShowGrid,
    shadowsEnabled, setShadowsEnabled,
    snapToGrid, setSnapToGrid
  } = useVisualizerStore()

  const { patch, fixtures, selectedFixtureIds, getFixtureChannels, groups, selectGroup, clearSelection, selectAll } = usePatchStore()
  const { values, setChannel } = useDmxStore()
  const { showName } = useUiStore()
  const [showControls, setShowControls] = useState(true)

  const selectedEntries = patch.filter(p => selectedFixtureIds.includes(p.id))

  // Helper to find channel by name
  const findCh = useCallback((channels: { name: string; absoluteChannel: number }[], ...names: string[]) => {
    return channels.find(c => names.some(n => c.name.toLowerCase() === n))
  }, [])

  // Apply a value to a named channel on all selected fixtures
  const setNamedChannel = useCallback((channelName: string, value: number) => {
    const names = [channelName.toLowerCase()]
    for (const entry of selectedEntries) {
      const channels = getFixtureChannels(entry)
      const ch = findCh(channels, ...names)
      if (ch) setChannel(entry.universe, ch.absoluteChannel, value)
    }
  }, [selectedEntries, getFixtureChannels, setChannel, findCh])

  const setRGB = useCallback((r: number, g: number, b: number) => {
    for (const entry of selectedEntries) {
      const channels = getFixtureChannels(entry)
      const rCh = findCh(channels, 'red', 'r')
      const gCh = findCh(channels, 'green', 'g')
      const bCh = findCh(channels, 'blue', 'b')
      const dimCh = findCh(channels, 'dimmer', 'intensity')
      if (rCh) setChannel(entry.universe, rCh.absoluteChannel, r)
      if (gCh) setChannel(entry.universe, gCh.absoluteChannel, g)
      if (bCh) setChannel(entry.universe, bCh.absoluteChannel, b)
      if (dimCh && (r > 0 || g > 0 || b > 0)) {
        const cur = values[entry.universe]?.[dimCh.absoluteChannel] ?? 0
        if (cur === 0) setChannel(entry.universe, dimCh.absoluteChannel, 255)
      }
    }
  }, [selectedEntries, getFixtureChannels, setChannel, findCh, values])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-3 bg-surface-1 flex-wrap">
        {/* Sub-tabs */}
        <div className="flex gap-0.5 mr-2">
          {(['3d', 'layout'] as VisualizerSubTab[]).map(tab => (
            <button
              key={tab}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                subTab === tab ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
              }`}
              onClick={() => setSubTab(tab)}
            >
              {tab === '3d' ? '3D View' : 'Stage Layout'}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-surface-3" />

        {/* Room dimensions */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">Room:</span>
          {(['width', 'depth', 'height'] as const).map(dim => (
            <label key={dim} className="flex items-center gap-0.5">
              <span className="text-[10px] text-gray-600">{dim[0].toUpperCase()}</span>
              <input
                type="number"
                min={2} max={100} step={0.5}
                value={roomConfig[dim]}
                onChange={e => setRoomConfig({ [dim]: parseFloat(e.target.value) || 10 })}
                className="input w-12 text-[10px] py-0.5 text-center"
              />
              <span className="text-[10px] text-gray-600">m</span>
            </label>
          ))}
        </div>

        <div className="w-px h-4 bg-surface-3" />

        {/* Toggles */}
        <div className="flex items-center gap-2">
          {[
            { label: 'Beams', value: showBeams, set: setShowBeams },
            { label: 'Room',  value: showRoom,  set: setShowRoom  },
            { label: 'Grid',  value: showGrid,  set: setShowGrid  },
            { label: 'Snap',  value: snapToGrid, set: setSnapToGrid }
          ].map(({ label, value, set }) => (
            <button
              key={label}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                value ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-surface-3 text-gray-500'
              }`}
              onClick={() => set(!value)}
            >
              {label}
            </button>
          ))}
          {subTab === '3d' && (
            <button
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                shadowsEnabled ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30' : 'bg-surface-3 text-gray-500'
              }`}
              onClick={() => setShadowsEnabled(!shadowsEnabled)}
              title="Shadows are GPU-intensive"
            >
              Shadows
            </button>
          )}
        </div>

        <div className="flex-1" />

        {subTab === '3d' && (
          <span className="text-[10px] text-gray-600">
            Orbit: drag · Zoom: scroll · Pan: right-drag
          </span>
        )}
        {subTab === 'layout' && (
          <button
            className="px-2 py-0.5 rounded text-[10px] bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={() => exportStagePDF(patch, fixtures, roomConfig, showName, groups)}
          >
            Export PDF
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          {subTab === '3d' ? (
            <div className="relative w-full h-full flex">
              <ThreeCanvas />
              {/* 3D properties overlay */}
              <FixtureProps3D />
            </div>
          ) : (
            <div className="flex h-full">
              {/* Left: top-down + side view */}
              <div className="flex-1 flex flex-col min-w-0">
                <LayoutEditor2D />
                <div className="h-px bg-surface-3" />
                <SideView className="h-36 shrink-0" />
              </div>
              {/* Right: properties */}
              <div className="w-60 border-l border-surface-3 shrink-0">
                <div className="panel-header">Properties</div>
                <FixturePropertiesPanel />
              </div>
            </div>
          )}
        </div>

        {/* Quick DMX controls for selected fixtures */}
        {selectedEntries.length > 0 && showControls && (
          <div className="shrink-0 border-t border-surface-3 bg-surface-1 px-3 py-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-accent font-semibold">{selectedEntries.length} fixture{selectedEntries.length > 1 ? 's' : ''}</span>

              {/* Group quick-select */}
              {groups.length > 0 && (
                <div className="flex gap-1 ml-2">
                  {groups.filter(g => !g.parentGroupId).map(g => {
                    const isEmpty = g.fixtureIds.length === 0
                    return (
                      <button
                        key={g.id}
                        className={`px-1.5 py-0.5 rounded text-[9px] ${isEmpty ? 'opacity-40 cursor-default' : 'hover:opacity-80'}`}
                        style={{ backgroundColor: g.color + '33', color: g.color }}
                        onClick={() => !isEmpty && selectGroup(g.id)}
                        title={isEmpty ? `${g.name} (empty — add fixtures to this group)` : `Select ${g.name} (${g.fixtureIds.length})`}
                      >
                        {g.name} {!isEmpty && <span className="opacity-60">({g.fixtureIds.length})</span>}
                      </button>
                    )
                  })}
                  <button className="px-1.5 py-0.5 rounded text-[9px] text-gray-500 hover:text-gray-300 bg-surface-3" onClick={selectAll}>All</button>
                  <button className="px-1.5 py-0.5 rounded text-[9px] text-gray-500 hover:text-gray-300 bg-surface-3" onClick={clearSelection}>None</button>
                </div>
              )}

              <div className="flex-1" />

              {/* Color presets */}
              <div className="flex gap-0.5">
                {[
                  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 },
                  { r: 255, g: 255, b: 255 }, { r: 255, g: 191, b: 0 }, { r: 0, g: 255, b: 255 },
                  { r: 255, g: 0, b: 255 }, { r: 255, g: 200, b: 120 }, { r: 0, g: 0, b: 0 }
                ].map(({ r, g, b }, i) => (
                  <button
                    key={i}
                    className="w-5 h-5 rounded border border-white/10 hover:scale-110 transition-transform"
                    style={{ backgroundColor: `rgb(${r},${g},${b})` }}
                    onClick={() => setRGB(r, g, b)}
                  />
                ))}
              </div>

              <button className="text-[10px] text-gray-500 hover:text-gray-300" onClick={() => setShowControls(false)}>x</button>
            </div>

            {/* Sliders row */}
            <div className="flex items-center gap-4">
              {[
                { label: 'Dim', name: 'dimmer', color: '#e85d04', alt: ['intensity'] },
                { label: 'Pan', name: 'pan', color: '#6366f1', alt: [] },
                { label: 'Tilt', name: 'tilt', color: '#6366f1', alt: [] },
                { label: 'Zoom', name: 'zoom', color: '#22c55e', alt: [] },
              ].map(({ label, name, color, alt }) => {
                // Read first selected fixture's value
                const first = selectedEntries[0]
                const chs = first ? getFixtureChannels(first) : []
                const ch = findCh(chs, name, ...alt)
                if (!ch) return null
                const val = values[first.universe]?.[ch.absoluteChannel] ?? 0
                return (
                  <div key={name} className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0 w-7">{label}</span>
                    <input
                      type="range" min={0} max={255} value={val}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        for (const entry of selectedEntries) {
                          const channels = getFixtureChannels(entry)
                          const c = findCh(channels, name, ...alt)
                          if (c) setChannel(entry.universe, c.absoluteChannel, v)
                        }
                      }}
                      className="flex-1 h-1.5 min-w-0" style={{ accentColor: color }}
                    />
                    <span className="text-[10px] font-mono text-gray-400 w-6 text-right shrink-0">{val}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {selectedEntries.length > 0 && !showControls && (
          <button
            className="shrink-0 border-t border-surface-3 bg-surface-1 px-3 py-1 text-[10px] text-accent hover:text-accent-light text-center"
            onClick={() => setShowControls(true)}
          >
            Show controls ({selectedEntries.length} fixtures)
          </button>
        )}
      </div>
    </div>
  )
}

/** Compact fixture properties panel overlaid on 3D view */
function FixtureProps3D() {
  const { selectedFixtureId, roomConfig } = useVisualizerStore()
  const { patch, fixtures, updateFixture } = usePatchStore()

  const entry = useMemo(() => patch.find(p => p.id === selectedFixtureId), [patch, selectedFixtureId])
  const def = useMemo(() => entry ? fixtures.find(f => f.id === entry.fixtureDefId) : null, [entry, fixtures])

  if (!entry) return null

  const isMovingHead = def?.categories.includes('Moving Head') ?? false
  const pos = entry.position3D ?? { x: 0, y: roomConfig.height - 0.05, z: 0 }
  const mountingAngle = entry.mountingAngle ?? 0
  const mountingPan = entry.mountingPan ?? 0
  const beamAngle = entry.beamAngle ?? def?.physical?.lens?.degreesMinMax?.[1] ?? 25

  const updatePos = (key: 'x' | 'y' | 'z', value: number) => {
    updateFixture(entry.id, { position3D: { ...pos, [key]: value } })
  }

  return (
    <div className="absolute top-2 right-2 w-52 bg-surface-1/95 backdrop-blur border border-surface-3 rounded-lg p-3 space-y-3 z-10 shadow-xl">
      {/* Header */}
      <div>
        <div className="text-xs font-semibold text-gray-200 truncate">{entry.name}</div>
        <div className="text-[9px] text-gray-500">{def?.name} — U{entry.universe + 1}.{entry.address}</div>
      </div>

      {/* Position */}
      <div className="space-y-1">
        <div className="text-[9px] text-gray-500 uppercase">Position</div>
        {([
          { label: 'X', key: 'x' as const, min: -50, max: 50 },
          { label: 'Y', key: 'y' as const, min: 0, max: 20 },
          { label: 'Z', key: 'z' as const, min: -50, max: 50 },
        ]).map(({ label, key, min, max }) => (
          <div key={key} className="flex items-center gap-1">
            <span className="text-[9px] text-gray-500 w-3">{label}</span>
            <input
              type="range" min={min} max={max} step={0.1}
              value={pos[key]}
              onChange={e => updatePos(key, parseFloat(e.target.value))}
              className="flex-1 h-1"
            />
            <span className="text-[9px] font-mono text-accent w-10 text-right">{pos[key].toFixed(1)}m</span>
          </div>
        ))}
      </div>

      {/* Aim / Tilt for static fixtures */}
      {!isMovingHead && (
        <div className="space-y-1">
          <div className="text-[9px] text-gray-500 uppercase">Aim</div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-gray-500 w-8">Tilt</span>
            <input
              type="range" min={-90} max={90} step={1}
              value={mountingAngle}
              onChange={e => updateFixture(entry.id, { mountingAngle: parseInt(e.target.value) })}
              className="flex-1 h-1"
            />
            <span className="text-[9px] font-mono text-accent w-8 text-right">{mountingAngle}°</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-gray-500 w-8">Dir</span>
            <input
              type="range" min={-180} max={180} step={1}
              value={mountingPan}
              onChange={e => updateFixture(entry.id, { mountingPan: parseInt(e.target.value) })}
              className="flex-1 h-1"
            />
            <span className="text-[9px] font-mono text-accent w-8 text-right">{mountingPan}°</span>
          </div>
        </div>
      )}

      {/* Pan/Tilt Invert for moving heads */}
      {isMovingHead && (
        <div className="space-y-1">
          <div className="text-[9px] text-gray-500 uppercase">Invert</div>
          <div className="flex gap-3">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={entry.panInvert ?? false}
                onChange={e => updateFixture(entry.id, { panInvert: e.target.checked })}
                className="accent-accent w-3 h-3" />
              <span className="text-[9px] text-gray-400">Pan</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={entry.tiltInvert ?? false}
                onChange={e => updateFixture(entry.id, { tiltInvert: e.target.checked })}
                className="accent-accent w-3 h-3" />
              <span className="text-[9px] text-gray-400">Tilt</span>
            </label>
          </div>
        </div>
      )}

      {/* Beam angle */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-gray-500 w-8">Beam</span>
        <input
          type="range" min={2} max={90} step={1}
          value={beamAngle}
          onChange={e => updateFixture(entry.id, { beamAngle: parseInt(e.target.value) })}
          className="flex-1 h-1"
        />
        <span className="text-[9px] font-mono text-accent w-8 text-right">{beamAngle}°</span>
      </div>

      {/* Quick placement */}
      <div className="flex gap-1">
        <button className="btn-secondary text-[8px] flex-1 py-0.5"
          onClick={() => updatePos('y', roomConfig.height - 0.05)}>Ceiling</button>
        <button className="btn-secondary text-[8px] flex-1 py-0.5"
          onClick={() => updatePos('y', 4)}>4m</button>
        <button className="btn-ghost text-[8px] flex-1 py-0.5 text-red-400"
          onClick={() => updateFixture(entry.id, { position3D: undefined, mountingAngle: undefined, mountingPan: undefined })}>Reset</button>
      </div>
    </div>
  )
}
