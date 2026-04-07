import React, { useCallback, useMemo, useState } from 'react'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { LayoutEditor2D } from './editor/LayoutEditor2D'
import { SideView } from './editor/SideView'
import { FixturePropertiesPanel } from './editor/FixturePropertiesPanel'
import { exportStagePDF } from '@renderer/lib/pdf-export'
import { HSlider } from '../common/HSlider'
import { rgbToColorWheelDmx } from '@renderer/lib/dmx-channel-resolver'

export function StageLayoutView() {
  const {
    roomConfig, setRoomConfig,
    showBeams, setShowBeams,
    showRoom, setShowRoom,
    showGrid, setShowGrid,
    snapToGrid, setSnapToGrid
  } = useVisualizerStore()

  const { patch, fixtures, selectedFixtureIds, getFixtureChannels, groups, selectGroup, clearSelection, selectAll } = usePatchStore()
  const { values, setChannel } = useDmxStore()
  const { showName } = useUiStore()
  const [showControls, setShowControls] = useState(true)

  const selectedEntries = patch.filter(p => selectedFixtureIds.includes(p.id))

  const findCh = useCallback((channels: { name: string; absoluteChannel: number }[], ...names: string[]) => {
    return channels.find(c => names.some(n => c.name.toLowerCase() === n))
  }, [])

  const setRGB = useCallback((r: number, g: number, b: number) => {
    for (const entry of selectedEntries) {
      const channels = getFixtureChannels(entry)
      const rCh = findCh(channels, 'red', 'r')
      const gCh = findCh(channels, 'green', 'g')
      const bCh = findCh(channels, 'blue', 'b')
      const dimCh = findCh(channels, 'dimmer', 'intensity')

      if (rCh && gCh && bCh) {
        setChannel(entry.universe, rCh.absoluteChannel, r)
        setChannel(entry.universe, gCh.absoluteChannel, g)
        setChannel(entry.universe, bCh.absoluteChannel, b)
      } else {
        const cwCh = findCh(channels, 'color wheel', 'color', 'colour wheel', 'color wheel effect')
        if (cwCh) {
          setChannel(entry.universe, cwCh.absoluteChannel, rgbToColorWheelDmx(r, g, b))
        }
      }

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
        </div>

        <div className="flex-1" />

        <button
          className="px-2 py-0.5 rounded text-[10px] bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
          onClick={() => exportStagePDF(patch, fixtures, roomConfig, showName, groups)}
        >
          Export PDF
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
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
                        title={isEmpty ? `${g.name} (empty)` : `Select ${g.name} (${g.fixtureIds.length})`}
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
                const first = selectedEntries[0]
                const chs = first ? getFixtureChannels(first) : []
                const ch = findCh(chs, name, ...alt)
                if (!ch) return null
                const val = values[first.universe]?.[ch.absoluteChannel] ?? 0
                return (
                  <div key={name} className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0 w-7">{label}</span>
                    <HSlider
                      value={val}
                      onChange={(v) => {
                        for (const entry of selectedEntries) {
                          const channels = getFixtureChannels(entry)
                          const c = findCh(channels, name, ...alt)
                          if (c) setChannel(entry.universe, c.absoluteChannel, v)
                        }
                      }}
                      color={color}
                      className="flex-1 min-w-0"
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
