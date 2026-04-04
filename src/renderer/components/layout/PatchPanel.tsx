import React, { useState } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useUiStore } from '../../stores/ui-store'

export function PatchPanel() {
  const { patch, fixtures, selectedFixtureIds, selectFixture, clearSelection } = usePatchStore()
  const { setActiveTab } = useUiStore()
  const [universeFilter, setUniverseFilter] = useState<number | null>(null)

  const displayed = (universeFilter !== null
    ? patch.filter(p => p.universe === universeFilter)
    : patch
  ).slice().sort((a, b) => a.universe - b.universe || a.address - b.address)

  return (
    <div className="w-48 shrink-0 border-r border-surface-3 flex flex-col bg-surface-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-surface-3">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
          Patch  <span className="text-gray-600 font-normal">({patch.length})</span>
        </span>
        <button
          className="text-accent text-xs font-bold hover:text-orange-400 leading-none"
          onClick={() => setActiveTab('patch')}
          title="Open Patch editor"
        >
          ⊕
        </button>
      </div>

      {/* Universe filter */}
      <div className="flex gap-px px-1.5 py-1 border-b border-surface-3">
        {([null, 0, 1, 2] as const).map((u, i) => (
          <button
            key={i}
            className={`flex-1 py-0.5 rounded text-[9px] font-medium transition-colors ${
              universeFilter === u
                ? 'bg-accent text-white'
                : 'bg-surface-3 text-gray-500 hover:bg-surface-4'
            }`}
            onClick={() => setUniverseFilter(u)}
          >
            {u === null ? 'All' : `U${u + 1}`}
          </button>
        ))}
      </div>

      {/* Fixture list */}
      <div className="flex-1 overflow-y-auto">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-6">
            <p className="text-[10px] text-gray-600 text-center px-2">
              {patch.length === 0 ? 'No fixtures patched.' : 'No fixtures on this universe.'}
            </p>
            {patch.length === 0 && (
              <button
                className="text-[10px] text-accent hover:text-orange-400"
                onClick={() => setActiveTab('patch')}
              >
                Open Patch →
              </button>
            )}
          </div>
        ) : (
          displayed.map(entry => {
            const def = fixtures.find(f => f.id === entry.fixtureDefId)
            const isSelected = selectedFixtureIds.includes(entry.id)
            return (
              <button
                key={entry.id}
                className={`w-full text-left px-2 py-1 border-b border-surface-2 transition-colors ${
                  isSelected
                    ? 'bg-accent/15 border-l-2 border-l-accent'
                    : 'hover:bg-surface-2 border-l-2 border-l-transparent'
                }`}
                onClick={(e) => selectFixture(entry.id, e.metaKey || e.ctrlKey)}
              >
                <div className={`text-[11px] font-medium truncate ${isSelected ? 'text-accent' : 'text-gray-200'}`}>
                  {entry.name}
                </div>
                <div className="text-[9px] text-gray-500 font-mono">
                  U{entry.universe + 1}.{String(entry.address).padStart(3, '0')}
                  {def && <span className="ml-1 text-gray-600">· {def.name}</span>}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Footer */}
      {selectedFixtureIds.length > 0 && (
        <div className="px-2 py-1 border-t border-surface-3 flex items-center justify-between">
          <span className="text-[9px] text-accent">{selectedFixtureIds.length} selected</span>
          <button
            className="text-[9px] text-gray-600 hover:text-gray-400"
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
