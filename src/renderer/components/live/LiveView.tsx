import React, { useState, useCallback, useMemo, memo } from 'react'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { resolveChannels, getEffectiveColor } from '../../lib/dmx-channel-resolver'

// ---------------------------------------------------------------------------
// Color presets for quick color selection
// ---------------------------------------------------------------------------
const COLOR_PRESETS = [
  { label: 'Red',     r: 255, g: 0,   b: 0   },
  { label: 'Green',   r: 0,   g: 255, b: 0   },
  { label: 'Blue',    r: 0,   g: 0,   b: 255 },
  { label: 'White',   r: 255, g: 255, b: 255 },
  { label: 'Amber',   r: 255, g: 191, b: 0   },
  { label: 'Cyan',    r: 0,   g: 255, b: 255 },
  { label: 'Magenta', r: 255, g: 0,   b: 255 },
  { label: 'Warm',    r: 255, g: 200, b: 120 },
  { label: 'Off',     r: 0,   g: 0,   b: 0   },
]

// ---------------------------------------------------------------------------
// Fixture tile (memoized)
// ---------------------------------------------------------------------------
interface TileProps {
  id: string
  name: string
  color: { r: number; g: number; b: number }
  dimmer: number
  selected: boolean
  onToggle: (id: string) => void
}

const FixtureTile = memo(function FixtureTile({ id, name, color, dimmer, selected, onToggle }: TileProps) {
  const cssColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`
  const intensity = dimmer / 255

  return (
    <button
      className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors cursor-pointer select-none
        ${selected ? 'ring-2 ring-accent bg-surface-3' : 'bg-surface-2 hover:bg-surface-3'}`}
      onClick={() => onToggle(id)}
    >
      <span className="text-[10px] text-gray-400 truncate w-full text-center">{name}</span>
      <div
        className="w-6 h-6 rounded-full border border-white/10"
        style={{ backgroundColor: cssColor, boxShadow: `0 0 8px ${cssColor}` }}
      />
      <span className="text-[10px] font-mono text-gray-400">D:{dimmer}</span>
      {/* Intensity bar */}
      <div className="w-full h-1 rounded-full bg-surface-4 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all"
          style={{ width: `${intensity * 100}%` }}
        />
      </div>
    </button>
  )
})

// ---------------------------------------------------------------------------
// LiveView
// ---------------------------------------------------------------------------
export function LiveView() {
  const { patch, groups, fixtures, getFixtureChannels, selectedFixtureIds, selectFixture, selectGroup, clearSelection } = usePatchStore()
  const { values: dmxValues, setChannel, toggleBlackout, blackout } = useDmxStore()

  const selectedIds = useMemo(() => new Set(selectedFixtureIds), [selectedFixtureIds])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null) // null = all

  // Toggle fixture selection (multi-select always on)
  const handleToggle = useCallback((id: string) => {
    selectFixture(id, true)
  }, [selectFixture])

  // Select group = auto-select all its fixtures
  const handleGroupClick = useCallback((groupId: string | null) => {
    setActiveGroupId(groupId)
    if (groupId) {
      selectGroup(groupId)
    } else {
      clearSelection()
    }
  }, [selectGroup, clearSelection])

  // Filtered fixtures based on active group
  const visibleFixtures = useMemo(() => {
    if (!activeGroupId) return patch
    const group = groups.find((g) => g.id === activeGroupId)
    if (!group) return patch
    return patch.filter((p) => group.fixtureIds.includes(p.id))
  }, [patch, groups, activeGroupId])

  // Resolve per-fixture data
  const fixtureData = useMemo(() => {
    return visibleFixtures.map((entry) => {
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      const resolved = resolveChannels(entry, def, dmxValues)
      const color = getEffectiveColor(resolved)
      return { id: entry.id, name: entry.name, color, dimmer: resolved.dimmer, entry, def }
    })
  }, [visibleFixtures, fixtures, dmxValues])

  // ----------- Quick actions -----------

  // Helper: find a channel by name (case-insensitive) with aliases
  const findChannel = useCallback((channels: { name: string; absoluteChannel: number; type: string }[], ...names: string[]) => {
    return channels.find((c) => names.some((n) => c.name.toLowerCase() === n))
  }, [])

  const setDimmerForAll = useCallback((value: number) => {
    const targets = selectedIds.size > 0
      ? patch.filter((p) => selectedIds.has(p.id))
      : patch

    for (const entry of targets) {
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      if (!def) continue
      const channels = getFixtureChannels(entry)
      const dimCh = findChannel(channels, 'dimmer', 'intensity', 'master dimmer', 'master', 'brightness')
      if (dimCh) setChannel(entry.universe, dimCh.absoluteChannel, value)
    }
  }, [patch, fixtures, selectedIds, getFixtureChannels, setChannel, findChannel])

  const applyColorPreset = useCallback((preset: typeof COLOR_PRESETS[number]) => {
    const targets = patch.filter((p) => selectedIds.has(p.id))
    for (const entry of targets) {
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      if (!def) continue
      const channels = getFixtureChannels(entry)
      const rCh = findChannel(channels, 'red', 'r')
      const gCh = findChannel(channels, 'green', 'g')
      const bCh = findChannel(channels, 'blue', 'b')
      const dimCh = findChannel(channels, 'dimmer', 'intensity', 'master dimmer', 'master', 'brightness')
      if (rCh) setChannel(entry.universe, rCh.absoluteChannel, preset.r)
      if (gCh) setChannel(entry.universe, gCh.absoluteChannel, preset.g)
      if (bCh) setChannel(entry.universe, bCh.absoluteChannel, preset.b)
      // Auto-set dimmer to full if applying a non-off color and dimmer is at 0
      if (dimCh && (preset.r > 0 || preset.g > 0 || preset.b > 0)) {
        const currentDim = dmxValues[entry.universe]?.[dimCh.absoluteChannel] ?? 0
        if (currentDim === 0) setChannel(entry.universe, dimCh.absoluteChannel, 255)
      }
    }
  }, [patch, fixtures, selectedIds, getFixtureChannels, setChannel, dmxValues, findChannel])

  // Apply a single channel value to selected fixtures (match by name)
  const setChannelForSelected = useCallback((channelName: string, value: number) => {
    const targets = patch.filter((p) => selectedIds.has(p.id))
    const aliases: Record<string, string[]> = {
      pan: ['pan'], tilt: ['tilt'], zoom: ['zoom'], focus: ['focus'],
      strobe: ['strobe'], shutter: ['shutter', 'shutter/strobe'],
      gobo: ['gobo', 'gobo wheel', 'gobo 1'], prism: ['prism'],
    }
    const names = aliases[channelName] || [channelName]
    for (const entry of targets) {
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      if (!def) continue
      const channels = getFixtureChannels(entry)
      const ch = findChannel(channels, ...names)
      if (ch) setChannel(entry.universe, ch.absoluteChannel, value)
    }
  }, [patch, fixtures, selectedIds, getFixtureChannels, setChannel, findChannel])

  const setDimmerForSelected = useCallback((value: number) => {
    const targets = patch.filter((p) => selectedIds.has(p.id))
    for (const entry of targets) {
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      if (!def) continue
      const channels = getFixtureChannels(entry)
      const dimCh = findChannel(channels, 'dimmer', 'intensity', 'master dimmer', 'master', 'brightness')
      if (dimCh) setChannel(entry.universe, dimCh.absoluteChannel, value)
    }
  }, [patch, fixtures, selectedIds, getFixtureChannels, setChannel, findChannel])

  const [dimmerSlider, setDimmerSlider] = useState(255)
  const [panSlider, setPanSlider] = useState(128)
  const [tiltSlider, setTiltSlider] = useState(128)
  const [zoomSlider, setZoomSlider] = useState(128)
  const [strobeSlider, setStrobeSlider] = useState(0)

  const handleDimmerSlider = useCallback((val: number) => {
    setDimmerSlider(val)
    setDimmerForSelected(val)
  }, [setDimmerForSelected])

  return (
    <div className="flex h-full overflow-hidden">
      {/* ============ LEFT SIDEBAR ============ */}
      <div className="w-48 shrink-0 border-r border-surface-3 bg-surface-1 flex flex-col overflow-y-auto">
        {/* Groups */}
        <div className="p-2 border-b border-surface-3">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-1">Groups</h3>
          <button
            className={`w-full text-left text-xs px-2 py-1 rounded mb-0.5 transition-colors ${
              activeGroupId === null ? 'bg-accent text-white' : 'text-gray-400 hover:bg-surface-3'
            }`}
            onClick={() => handleGroupClick(null)}
          >
            All Fixtures ({patch.length})
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              className={`w-full text-left text-xs px-2 py-1 rounded mb-0.5 flex items-center gap-1.5 transition-colors ${
                activeGroupId === g.id ? 'bg-accent text-white' : 'text-gray-400 hover:bg-surface-3'
              }`}
              onClick={() => handleGroupClick(g.id)}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
              <span className="truncate">{g.name}</span>
              <span className="ml-auto text-[10px] text-gray-500">{g.fixtureIds.length}</span>
            </button>
          ))}
        </div>

        {/* Quick actions */}
        <div className="p-2">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-1">Quick Actions</h3>
          <button
            className={`w-full text-left text-xs px-2 py-1 rounded mb-0.5 transition-colors ${
              blackout ? 'bg-red-600 text-white animate-pulse' : 'text-gray-400 hover:bg-surface-3'
            }`}
            onClick={toggleBlackout}
          >
            Blackout
          </button>
          <button
            className="w-full text-left text-xs px-2 py-1 rounded mb-0.5 text-gray-400 hover:bg-surface-3 transition-colors"
            onClick={() => setDimmerForAll(255)}
          >
            All Full
          </button>
          <button
            className="w-full text-left text-xs px-2 py-1 rounded mb-0.5 text-gray-400 hover:bg-surface-3 transition-colors"
            onClick={() => setDimmerForAll(0)}
          >
            All Off
          </button>
        </div>
      </div>

      {/* ============ MAIN AREA ============ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fixture tiles grid */}
        <div
          className="flex-1 overflow-y-auto p-3"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: '8px',
            alignContent: 'start',
          }}
        >
          {fixtureData.map((fd) => (
            <FixtureTile
              key={fd.id}
              id={fd.id}
              name={fd.name}
              color={fd.color}
              dimmer={fd.dimmer}
              selected={selectedIds.has(fd.id)}
              onToggle={handleToggle}
            />
          ))}
          {fixtureData.length === 0 && (
            <div className="col-span-full text-center text-gray-500 text-sm py-12">
              No fixtures patched. Go to Patch to add fixtures.
            </div>
          )}
        </div>

        {/* ============ BOTTOM CONTROL BAR (when selection active) ============ */}
        {selectedIds.size > 0 && (
          <div className="shrink-0 border-t border-surface-3 bg-surface-1 p-2 space-y-2">
            {/* Row 1: Color presets + dimmer + quick buttons */}
            <div className="flex items-center gap-3">
              {/* Color presets */}
              <div className="flex items-center gap-1">
                {COLOR_PRESETS.map((preset) => {
                  const bg = `rgb(${preset.r}, ${preset.g}, ${preset.b})`
                  return (
                    <button
                      key={preset.label}
                      className="w-6 h-6 rounded border border-white/10 hover:scale-110 transition-transform"
                      style={{ backgroundColor: bg }}
                      title={preset.label}
                      onClick={() => applyColorPreset(preset)}
                    />
                  )
                })}
              </div>

              <div className="w-px h-6 bg-surface-3" />

              {/* Dimmer slider */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0">Dim</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={dimmerSlider}
                  onChange={(e) => handleDimmerSlider(parseInt(e.target.value))}
                  className="flex-1 h-1.5 min-w-0"
                  style={{ accentColor: '#e85d04' }}
                />
                <span className="text-[10px] font-mono text-gray-400 w-8 text-right shrink-0">
                  {Math.round((dimmerSlider / 255) * 100)}%
                </span>
              </div>

              <div className="w-px h-6 bg-surface-3" />

              {/* Quick intensity buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  className="px-2 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200 transition-colors"
                  onClick={() => { setDimmerSlider(255); setDimmerForSelected(255) }}
                >
                  Full
                </button>
                <button
                  className="px-2 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200 transition-colors"
                  onClick={() => { setDimmerSlider(128); setDimmerForSelected(128) }}
                >
                  Half
                </button>
                <button
                  className="px-2 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200 transition-colors"
                  onClick={() => { setDimmerSlider(0); setDimmerForSelected(0) }}
                >
                  Off
                </button>
              </div>

              <span className="text-[10px] text-gray-500 shrink-0">{selectedIds.size} sel.</span>
            </div>

            {/* Row 2: Pan / Tilt / Zoom / Strobe */}
            <div className="flex items-center gap-3">
              {/* Pan */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0 w-8">Pan</span>
                <input
                  type="range" min={0} max={255} value={panSlider}
                  onChange={(e) => { const v = parseInt(e.target.value); setPanSlider(v); setChannelForSelected('pan', v) }}
                  className="flex-1 h-1.5 min-w-0" style={{ accentColor: '#6366f1' }}
                />
                <span className="text-[10px] font-mono text-gray-400 w-6 text-right shrink-0">{panSlider}</span>
              </div>
              {/* Tilt */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0 w-8">Tilt</span>
                <input
                  type="range" min={0} max={255} value={tiltSlider}
                  onChange={(e) => { const v = parseInt(e.target.value); setTiltSlider(v); setChannelForSelected('tilt', v) }}
                  className="flex-1 h-1.5 min-w-0" style={{ accentColor: '#6366f1' }}
                />
                <span className="text-[10px] font-mono text-gray-400 w-6 text-right shrink-0">{tiltSlider}</span>
              </div>
              {/* Zoom */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0 w-8">Zoom</span>
                <input
                  type="range" min={0} max={255} value={zoomSlider}
                  onChange={(e) => { const v = parseInt(e.target.value); setZoomSlider(v); setChannelForSelected('zoom', v) }}
                  className="flex-1 h-1.5 min-w-0" style={{ accentColor: '#22c55e' }}
                />
                <span className="text-[10px] font-mono text-gray-400 w-6 text-right shrink-0">{zoomSlider}</span>
              </div>
              {/* Strobe */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] text-gray-500 uppercase font-medium shrink-0 w-8">Strobe</span>
                <input
                  type="range" min={0} max={255} value={strobeSlider}
                  onChange={(e) => { const v = parseInt(e.target.value); setStrobeSlider(v); setChannelForSelected('strobe', v); setChannelForSelected('shutter', v) }}
                  className="flex-1 h-1.5 min-w-0" style={{ accentColor: '#ef4444' }}
                />
                <span className="text-[10px] font-mono text-gray-400 w-6 text-right shrink-0">{strobeSlider}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
