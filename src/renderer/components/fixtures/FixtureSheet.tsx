import React, { useMemo } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { getChannelTypeColor, getChannelShortLabel } from '../../lib/fixture-library'

// ============================================================
// FixtureSheet — GrandMA3-style spreadsheet view
// Rows = patched fixtures, columns = channel values (live)
// ============================================================

/** All unique channel names across all fixtures, in a stable order */
function useColumnLayout() {
  const { patch, fixtures } = usePatchStore()
  return useMemo(() => {
    const seen = new Map<string, { type: string; order: number }>()
    let order = 0
    for (const entry of patch) {
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      if (!def) continue
      const mode = def.modes.find(m => m.name === entry.modeName)
      if (!mode) continue
      for (const chName of mode.channels) {
        if (!seen.has(chName)) {
          const chDef = def.channels[chName]
          seen.set(chName, { type: chDef?.type || 'other', order: order++ })
        }
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, info]) => ({ name, type: info.type }))
  }, [patch, fixtures])
}

function CellValue({ value, color }: { value: number; color: string }) {
  const pct = value / 255
  return (
    <td
      className="px-1.5 py-0.5 text-center font-mono text-[10px] border-r border-surface-3 relative"
      style={{ color: value > 0 ? color : '#555' }}
    >
      {/* Background intensity bar */}
      {value > 0 && (
        <div
          className="absolute inset-0 opacity-15"
          style={{ background: color, width: `${pct * 100}%` }}
        />
      )}
      <span className="relative">{value}</span>
    </td>
  )
}

export function FixtureSheet() {
  const { patch, fixtures, selectedFixtureIds, selectFixture } = usePatchStore()
  const { values } = useDmxStore()
  const columns = useColumnLayout()

  // Build row data: for each patched fixture, resolve its channel values
  const rows = useMemo(() => {
    return patch.map(entry => {
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      const mode = def?.modes.find(m => m.name === entry.modeName)
      const channelNames = mode?.channels || []

      // Map channel name → absolute DMX address for this fixture
      const chMap = new Map<string, number>()
      channelNames.forEach((name, i) => {
        chMap.set(name, entry.address - 1 + i)
      })

      return {
        id: entry.id,
        name: entry.name,
        universe: entry.universe,
        address: entry.address,
        fixtureName: def?.name || '?',
        channelMap: chMap,
        universeIdx: entry.universe,
      }
    })
  }, [patch, fixtures])

  if (patch.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No fixtures patched. Go to Patch tab to add fixtures.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-surface-3">
              <th className="px-2 py-1 text-left text-gray-500 font-medium w-8">#</th>
              <th className="px-2 py-1 text-left text-gray-500 font-medium min-w-[100px]">Name</th>
              <th className="px-2 py-1 text-left text-gray-500 font-medium w-16">Type</th>
              <th className="px-2 py-1 text-center text-gray-500 font-medium w-12">Uni</th>
              <th className="px-2 py-1 text-center text-gray-500 font-medium w-12">Addr</th>
              {columns.map(col => (
                <th
                  key={col.name}
                  className="px-1.5 py-1 text-center font-medium w-10 border-l border-surface-3"
                  style={{ color: getChannelTypeColor(col.type as any, col.name) }}
                  title={col.name}
                >
                  {getChannelShortLabel(col.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isSelected = selectedFixtureIds.includes(row.id)
              return (
                <tr
                  key={row.id}
                  className={`border-b border-surface-3/50 cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent/15' : 'hover:bg-surface-2'
                  }`}
                  onClick={(e) => selectFixture(row.id, e.ctrlKey || e.metaKey)}
                >
                  <td className="px-2 py-0.5 text-gray-600 font-mono">{i + 1}</td>
                  <td className={`px-2 py-0.5 font-medium truncate max-w-[160px] ${isSelected ? 'text-accent' : 'text-gray-300'}`}>
                    {row.name}
                  </td>
                  <td className="px-2 py-0.5 text-gray-500 truncate max-w-[100px]">{row.fixtureName}</td>
                  <td className="px-2 py-0.5 text-center text-gray-500">{row.universe + 1}</td>
                  <td className="px-2 py-0.5 text-center text-gray-400 font-mono">{row.address}</td>
                  {columns.map(col => {
                    const absChannel = row.channelMap.get(col.name)
                    if (absChannel === undefined) {
                      return <td key={col.name} className="border-l border-surface-3/50 bg-surface-0/50" />
                    }
                    const val = values[row.universeIdx]?.[absChannel] ?? 0
                    return (
                      <CellValue
                        key={col.name}
                        value={val}
                        color={getChannelTypeColor(col.type as any, col.name)}
                      />
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
