import React, { useMemo, useState, useRef, useEffect } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useUiStore } from '../../stores/ui-store'
import { useMidiStore } from '../../stores/midi-store'
import { Fader, FADER_WIDTH, FADER_GAP } from '../common/Fader'
import { ColorPicker } from '../common/ColorPicker'
import { XYPad } from '../common/XYPad'
import { getChannelTypeColor, getChannelShortLabel } from '../../lib/fixture-library'
import { isColorWheelChannel, COLOR_WHEEL_MAX_DMX } from '../../lib/dmx-channel-resolver'
import type { MidiTargetType } from '@shared/types'

// Context menu for MIDI Learn
function MidiContextMenu({ x, y, items, onClose }: {
  x: number; y: number
  items: { label: string; onClick: () => void }[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface-1 border border-surface-3 rounded shadow-xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-accent/20 hover:text-accent"
          onClick={() => { item.onClick(); onClose() }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function FixtureControlView() {
  const { patch, fixtures, groups, selectedFixtureIds, selectFixture, selectAll, clearSelection, getFixtureChannels } = usePatchStore()
  const { values, setChannel } = useDmxStore()
  const { selectedUniverse, setSelectedUniverse } = useUiStore()
  const { startLearn } = useMidiStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: { label: string; onClick: () => void }[] } | null>(null)

  const hasPatch = patch.length > 0

  const selectGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    clearSelection()
    for (const fid of group.fixtureIds) selectFixture(fid, true)
  }

  // Selected entries for detail panel
  const selectedEntries = patch.filter(p => selectedFixtureIds.includes(p.id))
  const firstEntry = selectedEntries[0]
  const firstDef = firstEntry ? fixtures.find(f => f.id === firstEntry.fixtureDefId) : null
  const firstChannels = firstEntry ? getFixtureChannels(firstEntry) : []
  const channelNames = new Set(firstChannels.map(c => c.name.toLowerCase()))
  const hasRGB = channelNames.has('red') && channelNames.has('green') && channelNames.has('blue')
  const hasPanTilt = channelNames.has('pan') || channelNames.has('tilt')

  // Auto-switch universe when selected fixture is on a different one
  const prevSelectedRef = useRef(selectedFixtureIds)
  useEffect(() => {
    if (selectedFixtureIds.length > 0 && selectedFixtureIds !== prevSelectedRef.current) {
      const firstSelected = patch.find(p => p.id === selectedFixtureIds[0])
      if (firstSelected && firstSelected.universe !== selectedUniverse) {
        setSelectedUniverse(firstSelected.universe)
      }
    }
    prevSelectedRef.current = selectedFixtureIds
  }, [selectedFixtureIds, patch, selectedUniverse, setSelectedUniverse])

  // Fixtures in current universe for fader overview
  const fixturesInUniverse = useMemo(() =>
    patch.filter(p => p.universe === selectedUniverse),
    [patch, selectedUniverse]
  )

  // Unified channels for multi-select group view
  const unifiedChannels = useMemo(() => {
    if (selectedEntries.length < 2) return null
    const allChannelSets = selectedEntries.map(entry => {
      const channels = getFixtureChannels(entry)
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      return channels.map(ch => ({
        ...ch,
        type: def?.channels[ch.name]?.type || 'generic'
      }))
    })
    const firstNames = allChannelSets[0].map(ch => ch.name.toLowerCase())
    const commonNames = firstNames.filter(name =>
      allChannelSets.every(chs => chs.some(c => c.name.toLowerCase() === name))
    )
    return commonNames.map(name => {
      const refCh = allChannelSets[0].find(c => c.name.toLowerCase() === name)!
      return { name: refCh.name, type: refCh.type }
    })
  }, [selectedEntries, fixtures, getFixtureChannels])

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: universe selector */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-surface-3 shrink-0">
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
        <div className="flex gap-1">
          <button className="text-[10px] text-accent hover:text-accent-light" onClick={selectAll}>All</button>
          <button className="text-[10px] text-gray-500 hover:text-gray-300" onClick={clearSelection}>None</button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* ---- Left: Groups ---- */}
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
            {groups.filter(g => !g.parentGroupId).map(g => {
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
              <p className="text-[9px] text-gray-700 text-center pt-2 px-1">No groups.<br/>Create in Patch.</p>
            )}
          </div>
        </div>

        {/* ---- Center: Fixture fader columns ---- */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-2 border-r border-surface-3">
          {hasPatch ? (
            fixturesInUniverse.length > 0 ? (
              // Multi-select unified OR per-fixture columns
              unifiedChannels && unifiedChannels.length > 0 && selectedEntries.length > 1 ? (
                <UnifiedGroupFaders
                  selectedEntries={selectedEntries}
                  unifiedChannels={unifiedChannels}
                  values={values}
                  setChannel={setChannel}
                  getFixtureChannels={getFixtureChannels}
                  startLearn={startLearn}
                  contextMenu={contextMenu}
                  setContextMenu={setContextMenu}
                />
              ) : (
                <PerFixtureFaders
                  fixturesInUniverse={fixturesInUniverse}
                  universe={selectedUniverse}
                  values={values}
                  setChannel={setChannel}
                  getFixtureChannels={getFixtureChannels}
                  selectedFixtureIds={selectedFixtureIds}
                  selectFixture={selectFixture}
                  fixtures={fixtures}
                  startLearn={startLearn}
                  contextMenu={contextMenu}
                  setContextMenu={setContextMenu}
                />
              )
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                No fixtures on Universe {selectedUniverse + 1}
              </div>
            )
          ) : (
            <RawChannelFaders
              universe={selectedUniverse}
              values={values[selectedUniverse]}
              setChannel={(ch, val) => setChannel(selectedUniverse, ch, val)}
            />
          )}
        </div>

        {/* ---- Right: Detail panel (Color Picker + XY Pad + Info) ---- */}
        {selectedEntries.length > 0 && (hasRGB || hasPanTilt) && (
          <div className="w-56 shrink-0 flex flex-col bg-surface-1 overflow-y-auto p-3 gap-4">
            {/* Fixture info header */}
            <div className="text-center">
              <div className="text-xs text-gray-300 font-medium truncate">
                {selectedEntries.length === 1
                  ? firstEntry!.name
                  : `${selectedEntries.length} fixtures`
                }
              </div>
              {selectedEntries.length === 1 && firstDef && (
                <div className="text-[9px] text-gray-500 truncate">{firstDef.name}</div>
              )}
            </div>

            {/* Color picker */}
            {hasRGB && firstEntry && (
              <div className="flex flex-col items-center">
                <h3 className="text-[10px] text-gray-500 uppercase mb-2">Color</h3>
                <ColorPicker
                  red={getChannelValue(firstEntry, 'Red', values, getFixtureChannels)}
                  green={getChannelValue(firstEntry, 'Green', values, getFixtureChannels)}
                  blue={getChannelValue(firstEntry, 'Blue', values, getFixtureChannels)}
                  white={firstDef?.channels['White'] ? getChannelValue(firstEntry, 'White', values, getFixtureChannels) : undefined}
                  onChange={(r, g, b, w) => {
                    for (const entry of selectedEntries) {
                      setChannelByName(entry, 'Red', r, setChannel, getFixtureChannels)
                      setChannelByName(entry, 'Green', g, setChannel, getFixtureChannels)
                      setChannelByName(entry, 'Blue', b, setChannel, getFixtureChannels)
                      if (w !== undefined) setChannelByName(entry, 'White', w, setChannel, getFixtureChannels)
                    }
                  }}
                />
              </div>
            )}

            {/* Pan/Tilt pad */}
            {hasPanTilt && firstEntry && (
              <div className="flex flex-col items-center">
                <h3 className="text-[10px] text-gray-500 uppercase mb-2">Position</h3>
                <XYPad
                  x={getChannelValue(firstEntry, 'Pan', values, getFixtureChannels)}
                  y={getChannelValue(firstEntry, 'Tilt', values, getFixtureChannels)}
                  onChange={(pan, tilt) => {
                    for (const entry of selectedEntries) {
                      setChannelByName(entry, 'Pan', pan, setChannel, getFixtureChannels)
                      setChannelByName(entry, 'Tilt', tilt, setChannel, getFixtureChannels)
                    }
                  }}
                  size={180}
                  label="Pan / Tilt"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <MidiContextMenu
          x={contextMenu.x} y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ---- Unified Group Faders (multi-select) ----
function UnifiedGroupFaders({
  selectedEntries, unifiedChannels, values, setChannel, getFixtureChannels,
  startLearn, contextMenu, setContextMenu
}: any) {
  const firstEntry = selectedEntries[0]
  const firstChannels = getFixtureChannels(firstEntry)
  const groupColWidth = unifiedChannels.length * FADER_WIDTH + (unifiedChannels.length - 1) * FADER_GAP + 16

  return (
    <div className="flex gap-2 h-full">
      <div className="flex flex-col bg-surface-2 rounded border border-accent px-2 py-1.5" style={{ width: groupColWidth }}>
        <div className="text-[9px] text-center text-accent truncate mb-0.5 shrink-0">
          Group ({selectedEntries.length} fixtures)
        </div>
        <div className="text-[8px] text-center text-gray-600 mb-1 shrink-0 truncate">
          {selectedEntries.map((e: any) => e.name).join(', ')}
        </div>
        <div className="flex flex-1 min-h-0 justify-center" style={{ gap: FADER_GAP }}>
          {unifiedChannels.map((uch: any) => {
            const color = getChannelTypeColor(uch.type, uch.name)
            const refCh = firstChannels.find((c: any) => c.name.toLowerCase() === uch.name.toLowerCase())
            const displayValue = refCh ? (values[firstEntry.universe]?.[refCh.absoluteChannel] || 0) : 0
            return (
              <div
                key={uch.name}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      {
                        label: `MIDI Learn: ${firstEntry.name} → ${uch.name}`,
                        onClick: () => startLearn({
                          type: 'channel' as MidiTargetType,
                          id: firstEntry.id,
                          parameter: uch.name,
                          label: `${firstEntry.name} → ${uch.name}`
                        })
                      },
                      {
                        label: 'MIDI Learn: Grand Master',
                        onClick: () => startLearn({ type: 'master' as MidiTargetType, label: 'Grand Master' })
                      }
                    ]
                  })
                }}
              >
                <Fader
                  value={displayValue}
                  max={isColorWheelChannel(uch.name) ? COLOR_WHEEL_MAX_DMX : 255}
                  onChange={(val: number) => {
                    for (const entry of selectedEntries) {
                      const chs = getFixtureChannels(entry)
                      const match = chs.find((c: any) => c.name.toLowerCase() === uch.name.toLowerCase())
                      if (match) setChannel(entry.universe, match.absoluteChannel, val)
                    }
                  }}
                  label={getChannelShortLabel(uch.name)}
                  color={color}
                  showValue={true}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---- Per-Fixture Fader Columns ----
function PerFixtureFaders({
  fixturesInUniverse, universe, values, setChannel, getFixtureChannels,
  selectedFixtureIds, selectFixture, fixtures, startLearn, contextMenu, setContextMenu
}: any) {
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll selected fixture into view
  useEffect(() => {
    if (selectedFixtureIds.length > 0) {
      const firstId = selectedFixtureIds[0]
      const el = columnRefs.current.get(firstId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [selectedFixtureIds])

  return (
    <div className="flex gap-2 h-full">
      {fixturesInUniverse.map((entry: any) => {
        const channels = getFixtureChannels(entry)
        const isSelected = selectedFixtureIds.includes(entry.id)
        const def = fixtures.find((f: any) => f.id === entry.fixtureDefId)
        const colWidth = channels.length * FADER_WIDTH + (channels.length - 1) * FADER_GAP + 16

        return (
          <div
            key={entry.id}
            ref={(el) => { if (el) columnRefs.current.set(entry.id, el); else columnRefs.current.delete(entry.id) }}
            className={`flex flex-col bg-surface-2 rounded border px-2 py-1.5 cursor-pointer transition-colors ${
              isSelected ? 'border-accent' : 'border-surface-3 hover:border-surface-4'
            }`}
            style={{ width: colWidth }}
            onClick={(e) => selectFixture(entry.id, e.metaKey || e.ctrlKey || e.shiftKey)}
          >
            <div className="text-[9px] text-center text-gray-400 truncate mb-0.5 shrink-0" title={entry.name}>
              {entry.name}
            </div>
            <div className="text-[8px] text-center text-gray-600 mb-1 shrink-0">
              {universe + 1}.{entry.address}
            </div>
            <div className="flex flex-1 min-h-0 justify-center" style={{ gap: FADER_GAP }}>
              {channels.map((ch: any) => {
                const chDef = def?.channels[ch.name]
                const color = getChannelTypeColor(chDef?.type || 'generic', ch.name)
                return (
                  <div
                    key={ch.absoluteChannel}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({
                        x: e.clientX, y: e.clientY,
                        items: [
                          {
                            label: `MIDI Learn: ${entry.name} → ${ch.name}`,
                            onClick: () => startLearn({
                              type: 'channel' as MidiTargetType,
                              id: entry.id,
                              parameter: ch.name,
                              label: `${entry.name} → ${ch.name}`
                            })
                          },
                          {
                            label: 'MIDI Learn: Grand Master',
                            onClick: () => startLearn({ type: 'master' as MidiTargetType, label: 'Grand Master' })
                          },
                          {
                            label: 'MIDI Learn: Blackout',
                            onClick: () => startLearn({ type: 'blackout' as MidiTargetType, label: 'Blackout' })
                          }
                        ]
                      })
                    }}
                  >
                    <Fader
                      value={values[universe][ch.absoluteChannel] || 0}
                      max={isColorWheelChannel(ch.name) ? COLOR_WHEEL_MAX_DMX : 255}
                      onChange={(val: number) => setChannel(universe, ch.absoluteChannel, val)}
                      label={getChannelShortLabel(ch.name)}
                      color={color}
                      showValue={true}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Raw DMX Faders (no patch) ----
function RawChannelFaders({
  universe, values, setChannel
}: {
  universe: number; values: number[]; setChannel: (ch: number, val: number) => void
}) {
  const channelCount = 64
  return (
    <div className="flex h-full" style={{ gap: FADER_GAP }}>
      {Array.from({ length: channelCount }, (_, i) => (
        <Fader
          key={i}
          value={values[i] || 0}
          onChange={(val) => setChannel(i, val)}
          label={`${i + 1}`}
          color="#e85d04"
          showValue={false}
          onDoubleClick={() => setChannel(i, values[i] > 0 ? 0 : 255)}
        />
      ))}
    </div>
  )
}

// ---- Helpers ----
function getChannelValue(entry: any, channelName: string, values: number[][], getFixtureChannels: any): number {
  const channels = getFixtureChannels(entry)
  const ch = channels.find((c: any) => c.name === channelName)
  if (!ch) return 0
  return values[entry.universe][ch.absoluteChannel] || 0
}

function setChannelByName(
  entry: any, channelName: string, value: number,
  setChannel: (u: number, ch: number, val: number) => void,
  getFixtureChannels: any
): void {
  const channels = getFixtureChannels(entry)
  const ch = channels.find((c: any) => c.name === channelName)
  if (ch) setChannel(entry.universe, ch.absoluteChannel, value)
}
