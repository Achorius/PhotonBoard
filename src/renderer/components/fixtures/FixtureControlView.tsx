import React from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { Fader, FADER_WIDTH, FADER_GAP } from '../common/Fader'
import { ColorPicker } from '../common/ColorPicker'
import { XYPad } from '../common/XYPad'
import { getChannelTypeColor, getChannelShortLabel } from '../../lib/fixture-library'

// Fixed section order for consistent layout across all fixture types
const SECTION_ORDER: { key: string; label: string; channelMatchers: string[] }[] = [
  { key: 'intensity', label: 'Intensity', channelMatchers: ['dimmer', 'intensity', 'dimmer fine', 'shutter', 'strobe', 'shutter/strobe'] },
  { key: 'color', label: 'Color', channelMatchers: ['red', 'green', 'blue', 'white', 'amber', 'uv', 'cyan', 'magenta', 'yellow', 'color wheel', 'color temperature', 'color macro', 'ct fine', 'color wheel effect'] },
  { key: 'position', label: 'Position', channelMatchers: ['pan', 'pan fine', 'tilt', 'tilt fine', 'speed', 'pan/tilt speed'] },
  { key: 'beam', label: 'Beam', channelMatchers: ['gobo', 'gobo rotation', 'prism', 'prism rotation', 'focus', 'zoom', 'zoom fine', 'iris'] },
  { key: 'other', label: 'Other', channelMatchers: [] }, // catch-all
]

function classifyChannel(name: string): string {
  const n = name.toLowerCase()
  for (const section of SECTION_ORDER) {
    if (section.key === 'other') continue
    if (section.channelMatchers.some(m => n === m || n.includes(m))) {
      return section.key
    }
  }
  return 'other'
}

export function FixtureControlView() {
  const { patch, fixtures, groups, selectedFixtureIds, selectFixture, selectAll, clearSelection, getFixtureChannels } = usePatchStore()
  const { values, setChannel } = useDmxStore()

  const selectGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    clearSelection()
    for (const fid of group.fixtureIds) selectFixture(fid, true)
  }

  const selectedEntries = patch.filter(p => selectedFixtureIds.includes(p.id))
  const firstEntry = selectedEntries[0]
  const firstDef = firstEntry ? fixtures.find(f => f.id === firstEntry.fixtureDefId) : null

  const firstChannels = firstEntry ? getFixtureChannels(firstEntry) : []
  const channelNames = new Set(firstChannels.map(c => c.name.toLowerCase()))
  const hasRGB = channelNames.has('red') && channelNames.has('green') && channelNames.has('blue')
  const hasPanTilt = channelNames.has('pan') || channelNames.has('tilt')

  // Group channels by section
  const sections = SECTION_ORDER.map(section => {
    const channels = firstChannels.filter(ch => classifyChannel(ch.name) === section.key)
    return { ...section, channels }
  }).filter(s => s.channels.length > 0)

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
          {groups.length > 0 && (
            <div className="px-2 py-1 border-b border-surface-3 space-y-0.5">
              <div className="text-[9px] text-gray-600 uppercase">Groups</div>
              <div className="flex flex-wrap gap-1">
                {groups.filter(g => !g.parentGroupId).map(g => (
                  <button
                    key={g.id}
                    className="px-1.5 py-0.5 rounded text-[10px] hover:opacity-80"
                    style={{ backgroundColor: g.color + '33', color: g.color }}
                    onClick={() => selectGroup(g.id)}
                  >
                    {g.name} ({g.fixtureIds.length})
                  </button>
                ))}
              </div>
            </div>
          )}
          {patch.map(entry => {
            const isSelected = selectedFixtureIds.includes(entry.id)
            return (
              <button
                key={entry.id}
                className={`w-full text-left px-3 py-1.5 text-xs border-b border-surface-3 ${
                  isSelected ? 'bg-accent/10 text-accent' : 'text-gray-300 hover:bg-surface-2'
                }`}
                onClick={(e) => selectFixture(entry.id, e.metaKey || e.ctrlKey || e.shiftKey)}
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
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="text-sm text-gray-300 mb-3 shrink-0">
              {selectedEntries.length === 1
                ? `${firstEntry!.name} — ${firstDef?.name || ''}`
                : `${selectedEntries.length} fixtures selected`
              }
            </div>

            {/* Fixed sections layout */}
            <div className="flex gap-4 flex-1 min-h-0">
              {/* Channel fader sections */}
              {sections.map(section => {
                const sectionWidth = section.channels.length * FADER_WIDTH + (section.channels.length - 1) * FADER_GAP + 16
                return (
                  <div key={section.key} className="flex flex-col shrink-0" style={{ width: sectionWidth }}>
                    <h3 className="text-[10px] text-gray-500 uppercase mb-2 text-center shrink-0">{section.label}</h3>
                    <div className="flex flex-1 min-h-0 justify-center" style={{ gap: FADER_GAP }}>
                      {section.channels.map(ch => {
                        const chDef = firstDef?.channels[ch.name]
                        const color = getChannelTypeColor(chDef?.type || 'generic')
                        const val = values[firstEntry!.universe][ch.absoluteChannel] || 0

                        return (
                          <Fader
                            key={ch.name}
                            value={val}
                            onChange={(v) => {
                              for (const entry of selectedEntries) {
                                const channels = getFixtureChannels(entry)
                                const targetCh = channels.find(c => c.name === ch.name)
                                if (targetCh) {
                                  setChannel(entry.universe, targetCh.absoluteChannel, v)
                                }
                              }
                            }}
                            label={getChannelShortLabel(ch.name)}
                            color={color}
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
                )
              })}

              {/* Separator */}
              {(hasRGB || hasPanTilt) && (
                <div className="w-px bg-surface-3 shrink-0 my-4" />
              )}

              {/* Color picker */}
              {hasRGB && firstEntry && (
                <div className="flex flex-col shrink-0">
                  <h3 className="text-[10px] text-gray-500 uppercase mb-2 text-center shrink-0">Color Picker</h3>
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
                <div className="flex flex-col shrink-0">
                  <h3 className="text-[10px] text-gray-500 uppercase mb-2 text-center shrink-0">Position</h3>
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
