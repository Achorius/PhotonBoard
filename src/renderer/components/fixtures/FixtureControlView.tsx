import React from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { Fader } from '../common/Fader'
import { ColorPicker } from '../common/ColorPicker'
import { XYPad } from '../common/XYPad'
import { getChannelTypeColor } from '../../lib/fixture-library'

export function FixtureControlView() {
  const { patch, fixtures, selectedFixtureIds, selectFixture, selectAll, clearSelection, getFixtureChannels } = usePatchStore()
  const { values, setChannel } = useDmxStore()

  const selectedEntries = patch.filter(p => selectedFixtureIds.includes(p.id))
  const firstEntry = selectedEntries[0]
  const firstDef = firstEntry ? fixtures.find(f => f.id === firstEntry.fixtureDefId) : null

  // Detect channel types available
  const hasColor = firstDef && Object.values(firstDef.channels).some(ch => ch.type === 'color')
  const hasPanTilt = firstDef && Object.values(firstDef.channels).some(ch => ch.type === 'pan' || ch.type === 'tilt')

  return (
    <div className="flex h-full">
      {/* Fixture list */}
      <div className="w-52 border-r border-surface-3 flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>Fixtures</span>
          <div className="flex gap-1">
            <button className="text-[10px] text-accent hover:text-accent-light" onClick={selectAll}>All</button>
            <button className="text-[10px] text-gray-500 hover:text-gray-300" onClick={clearSelection}>None</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {patch.map(entry => {
            const isSelected = selectedFixtureIds.includes(entry.id)
            return (
              <button
                key={entry.id}
                className={`w-full text-left px-3 py-1.5 text-xs border-b border-surface-3 ${
                  isSelected ? 'bg-accent/10 text-accent' : 'text-gray-300 hover:bg-surface-2'
                }`}
                onClick={(e) => selectFixture(entry.id, e.metaKey || e.ctrlKey)}
              >
                <div className="font-medium">{entry.name}</div>
                <div className="text-[10px] text-gray-500">
                  U{entry.universe + 1}.{entry.address}
                </div>
              </button>
            )
          })}
          {patch.length === 0 && (
            <p className="text-[10px] text-gray-600 text-center py-4">No fixtures patched</p>
          )}
        </div>
      </div>

      {/* Control area */}
      <div className="flex-1 p-4 overflow-auto">
        {selectedEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            Select fixture(s) to control
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="text-sm text-gray-300">
              {selectedEntries.length === 1
                ? `${firstEntry!.name} — ${firstDef?.name || ''}`
                : `${selectedEntries.length} fixtures selected`
              }
            </div>

            <div className="flex gap-6 flex-wrap">
              {/* Channel faders */}
              <div className="space-y-2">
                <h3 className="text-[10px] text-gray-500 uppercase">Channels</h3>
                <div className="flex gap-1">
                  {firstEntry && getFixtureChannels(firstEntry).map(ch => {
                    const chDef = firstDef?.channels[ch.name]
                    const color = getChannelTypeColor(chDef?.type || 'generic')
                    // For multi-select, use first fixture's values as reference
                    const val = values[firstEntry.universe][ch.absoluteChannel] || 0

                    return (
                      <Fader
                        key={ch.name}
                        value={val}
                        onChange={(v) => {
                          // Apply to all selected fixtures
                          for (const entry of selectedEntries) {
                            const channels = getFixtureChannels(entry)
                            const targetCh = channels.find(c => c.name === ch.name)
                            if (targetCh) {
                              setChannel(entry.universe, targetCh.absoluteChannel, v)
                            }
                          }
                        }}
                        label={ch.name}
                        color={color}
                        size="lg"
                        onDoubleClick={() => {
                          for (const entry of selectedEntries) {
                            const channels = getFixtureChannels(entry)
                            const targetCh = channels.find(c => c.name === ch.name)
                            if (targetCh) {
                              setChannel(entry.universe, targetCh.absoluteChannel, val > 0 ? 0 : 255)
                            }
                          }
                        }}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Color picker */}
              {hasColor && firstEntry && (
                <div className="space-y-2">
                  <h3 className="text-[10px] text-gray-500 uppercase">Color</h3>
                  <ColorPicker
                    red={getChannelValue(firstEntry, 'Red', values, getFixtureChannels)}
                    green={getChannelValue(firstEntry, 'Green', values, getFixtureChannels)}
                    blue={getChannelValue(firstEntry, 'Blue', values, getFixtureChannels)}
                    white={firstDef?.channels['White'] ? getChannelValue(firstEntry, 'White', values, getFixtureChannels) : undefined}
                    onChange={(r, g, b, w) => {
                      for (const entry of selectedEntries) {
                        setChannelByName(entry, 'Red', r, values, setChannel, getFixtureChannels)
                        setChannelByName(entry, 'Green', g, values, setChannel, getFixtureChannels)
                        setChannelByName(entry, 'Blue', b, values, setChannel, getFixtureChannels)
                        if (w !== undefined) setChannelByName(entry, 'White', w, values, setChannel, getFixtureChannels)
                      }
                    }}
                  />
                </div>
              )}

              {/* Pan/Tilt */}
              {hasPanTilt && firstEntry && (
                <div className="space-y-2">
                  <h3 className="text-[10px] text-gray-500 uppercase">Position</h3>
                  <XYPad
                    x={getChannelValue(firstEntry, 'Pan', values, getFixtureChannels)}
                    y={getChannelValue(firstEntry, 'Tilt', values, getFixtureChannels)}
                    onChange={(pan, tilt) => {
                      for (const entry of selectedEntries) {
                        setChannelByName(entry, 'Pan', pan, values, setChannel, getFixtureChannels)
                        setChannelByName(entry, 'Tilt', tilt, values, setChannel, getFixtureChannels)
                      }
                    }}
                    size={180}
                    label="Pan / Tilt"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function getChannelValue(
  entry: any,
  channelName: string,
  values: number[][],
  getFixtureChannels: any
): number {
  const channels = getFixtureChannels(entry)
  const ch = channels.find((c: any) => c.name === channelName)
  if (!ch) return 0
  return values[entry.universe][ch.absoluteChannel] || 0
}

function setChannelByName(
  entry: any,
  channelName: string,
  value: number,
  values: number[][],
  setChannel: (u: number, ch: number, val: number) => void,
  getFixtureChannels: any
): void {
  const channels = getFixtureChannels(entry)
  const ch = channels.find((c: any) => c.name === channelName)
  if (ch) setChannel(entry.universe, ch.absoluteChannel, value)
}
