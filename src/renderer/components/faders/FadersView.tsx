import React, { useMemo } from 'react'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { useUiStore } from '../../stores/ui-store'
import { Fader } from '../common/Fader'
import { getChannelTypeColor, getChannelShortLabel } from '../../lib/fixture-library'

export function FadersView() {
  const { values, setChannel } = useDmxStore()
  const { patch, fixtures, groups, selectedFixtureIds, selectFixture, clearSelection, addToGroup, getFixtureChannels } = usePatchStore()
  const { selectedUniverse, setSelectedUniverse } = useUiStore()

  const hasPatch = patch.length > 0

  const selectGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    // Select all fixtures in the group (first fixture sets selection, rest are multi)
    clearSelection()
    for (const fid of group.fixtureIds) {
      selectFixture(fid, true)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Universe selector top bar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-surface-3">
        <span className="text-[10px] text-gray-500 uppercase">Univ</span>
        {[0, 1, 2].map(u => (
          <button
            key={u}
            className={`px-2 py-0.5 text-xs rounded ${
              selectedUniverse === u ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
            }`}
            onClick={() => setSelectedUniverse(u)}
          >
            {u + 1}
          </button>
        ))}
        <div className="w-px h-4 bg-surface-3 mx-1" />
        {selectedFixtureIds.length > 0 && (
          <span className="text-[10px] text-accent">{selectedFixtureIds.length} selected</span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600">
          {hasPatch ? 'Fixture Faders' : 'Raw DMX — 64ch shown'}
        </span>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* ---- Left: Groups panel ---- */}
        <div className="w-28 shrink-0 border-r border-surface-3 flex flex-col bg-surface-1">
          <div className="px-2 py-1 text-[9px] text-gray-500 uppercase border-b border-surface-3">Groups</div>
          <div className="flex-1 overflow-y-auto p-1 space-y-px">
            <button
              className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
                selectedFixtureIds.length === 0
                  ? 'bg-accent/20 text-accent'
                  : 'text-gray-400 hover:bg-surface-3'
              }`}
              onClick={() => clearSelection()}
            >
              All ({patch.length})
            </button>
            {groups.map(g => {
              const count = g.fixtureIds.filter(id => patch.some(p => p.id === id)).length
              const isSelected = g.fixtureIds.length > 0 &&
                g.fixtureIds.every(id => selectedFixtureIds.includes(id))
              return (
                <button
                  key={g.id}
                  className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors flex items-center gap-1 ${
                    isSelected ? 'bg-surface-3 text-gray-200' : 'text-gray-400 hover:bg-surface-3'
                  }`}
                  onClick={() => selectGroup(g.id)}
                >
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="truncate flex-1">{g.name}</span>
                  <span className="text-gray-600 shrink-0">{count}</span>
                </button>
              )
            })}
            {groups.length === 0 && (
              <p className="text-[9px] text-gray-700 text-center pt-2 px-1">No groups.<br/>Create them in Patch.</p>
            )}
          </div>
        </div>

        {/* ---- Right: Faders ---- */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-2">
          {hasPatch ? (
            <FixtureFaders
              universe={selectedUniverse}
              values={values}
              setChannel={setChannel}
            />
          ) : (
            <RawChannelFaders
              universe={selectedUniverse}
              values={values[selectedUniverse]}
              setChannel={(ch, val) => setChannel(selectedUniverse, ch, val)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function FixtureFaders({
  universe,
  values,
  setChannel
}: {
  universe: number
  values: number[][]
  setChannel: (u: number, ch: number, val: number) => void
}) {
  const { patch, fixtures, selectedFixtureIds, selectFixture, getFixtureChannels } = usePatchStore()

  const fixturesInUniverse = useMemo(() =>
    patch.filter(p => p.universe === universe),
    [patch, universe]
  )

  // Build unified channel info for multi-select group view
  const selectedEntries = useMemo(() =>
    selectedFixtureIds.map(id => patch.find(p => p.id === id)).filter(Boolean) as typeof patch,
    [patch, selectedFixtureIds]
  )

  const unifiedChannels = useMemo(() => {
    if (selectedEntries.length < 2) return null

    // Get channel lists for each selected fixture
    const allChannelSets = selectedEntries.map(entry => {
      const channels = getFixtureChannels(entry)
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      return channels.map(ch => ({
        ...ch,
        type: def?.channels[ch.name]?.type || 'generic'
      }))
    })

    // Find channel names common to ALL selected fixtures (case-insensitive)
    const firstNames = allChannelSets[0].map(ch => ch.name.toLowerCase())
    const commonNames = firstNames.filter(name =>
      allChannelSets.every(chs => chs.some(c => c.name.toLowerCase() === name))
    )

    // Build unified channel descriptors using the first fixture's channel info for type/color
    return commonNames.map(name => {
      const refCh = allChannelSets[0].find(c => c.name.toLowerCase() === name)!
      return {
        name: refCh.name,
        type: refCh.type
      }
    })
  }, [selectedEntries, fixtures, getFixtureChannels])

  if (fixturesInUniverse.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        No fixtures patched on Universe {universe + 1}
      </div>
    )
  }

  // --- Unified group fader view (multiple fixtures selected) ---
  if (unifiedChannels && unifiedChannels.length > 0 && selectedEntries.length > 1) {
    // For the displayed value, use the first selected fixture's current value
    const firstEntry = selectedEntries[0]
    const firstChannels = getFixtureChannels(firstEntry)

    return (
      <div className="flex gap-1 h-full">
        <div className="flex flex-col bg-surface-2 rounded border border-accent p-1.5 min-w-fit">
          {/* Group header */}
          <div className="text-[9px] text-center text-accent truncate max-w-40 mb-1">
            Group ({selectedEntries.length} fixtures)
          </div>
          <div className="text-[8px] text-center text-gray-600 mb-1">
            {selectedEntries.map(e => e.name).join(', ')}
          </div>

          {/* Unified channel faders */}
          <div className="flex gap-0.5 flex-1 items-end">
            {unifiedChannels.map(uch => {
              const color = getChannelTypeColor(uch.type)
              // Read value from first selected fixture
              const refCh = firstChannels.find(c => c.name.toLowerCase() === uch.name.toLowerCase())
              const displayValue = refCh ? (values[firstEntry.universe]?.[refCh.absoluteChannel] || 0) : 0

              return (
                <Fader
                  key={uch.name}
                  value={displayValue}
                  onChange={(val) => {
                    // Apply to ALL selected fixtures
                    for (const entry of selectedEntries) {
                      const chs = getFixtureChannels(entry)
                      const match = chs.find(c => c.name.toLowerCase() === uch.name.toLowerCase())
                      if (match) setChannel(entry.universe, match.absoluteChannel, val)
                    }
                  }}
                  label={getChannelShortLabel(uch.name)}
                  color={color}
                  size="sm"
                  showValue={false}
                />
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // --- Per-fixture fader view (single or no selection) ---
  return (
    <div className="flex gap-1 h-full">
      {fixturesInUniverse.map(entry => {
        const channels = getFixtureChannels(entry)
        const isSelected = selectedFixtureIds.includes(entry.id)
        const def = fixtures.find(f => f.id === entry.fixtureDefId)

        return (
          <div
            key={entry.id}
            className={`flex flex-col bg-surface-2 rounded border p-1.5 min-w-fit cursor-pointer transition-colors ${
              isSelected ? 'border-accent' : 'border-surface-3 hover:border-surface-4'
            }`}
            onClick={(e) => selectFixture(entry.id, e.metaKey || e.ctrlKey || e.shiftKey)}
          >
            {/* Fixture name */}
            <div className="text-[9px] text-center text-gray-400 truncate max-w-24 mb-1" title={entry.name}>
              {entry.name}
            </div>
            <div className="text-[8px] text-center text-gray-600 mb-1">
              {universe + 1}.{entry.address}
            </div>

            {/* Channel faders */}
            <div className="flex gap-0.5 flex-1 items-end">
              {channels.map(ch => {
                const chDef = def?.channels[ch.name]
                const color = getChannelTypeColor(chDef?.type || 'generic')
                return (
                  <Fader
                    key={ch.absoluteChannel}
                    value={values[universe][ch.absoluteChannel] || 0}
                    onChange={(val) => {
                      setChannel(universe, ch.absoluteChannel, val)
                    }}
                    label={getChannelShortLabel(ch.name)}
                    color={color}
                    size="sm"
                    showValue={false}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RawChannelFaders({
  universe,
  values,
  setChannel
}: {
  universe: number
  values: number[]
  setChannel: (ch: number, val: number) => void
}) {
  // Show first 64 channels (paginated would be better for 512)
  const channelCount = 64

  return (
    <div className="flex gap-0.5 h-full items-end">
      {Array.from({ length: channelCount }, (_, i) => (
        <Fader
          key={i}
          value={values[i] || 0}
          onChange={(val) => setChannel(i, val)}
          label={`${i + 1}`}
          color="#e85d04"
          size="sm"
          showValue={false}
          onDoubleClick={() => setChannel(i, values[i] > 0 ? 0 : 255)}
        />
      ))}
    </div>
  )
}
