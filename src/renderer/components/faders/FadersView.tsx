import React, { useMemo } from 'react'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { useUiStore } from '../../stores/ui-store'
import { Fader } from '../common/Fader'
import { getChannelTypeColor, getChannelShortLabel } from '../../lib/fixture-library'

export function FadersView() {
  const { values, setChannel } = useDmxStore()
  const { patch, fixtures, selectedFixtureIds, selectFixture, getFixtureChannels } = usePatchStore()
  const { selectedUniverse, setSelectedUniverse } = useUiStore()

  const hasPatch = patch.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Universe selector */}
      <div className="flex items-center gap-2 p-2 border-b border-surface-3">
        <span className="text-xs text-gray-500">Universe:</span>
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
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600">
          {hasPatch ? 'Fixture Faders' : 'Raw DMX Channels'}
        </span>
      </div>

      {/* Faders area */}
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

  if (fixturesInUniverse.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        No fixtures patched on Universe {universe + 1}
      </div>
    )
  }

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
            onClick={(e) => selectFixture(entry.id, e.metaKey || e.ctrlKey)}
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
                    onChange={(val) => setChannel(universe, ch.absoluteChannel, val)}
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
