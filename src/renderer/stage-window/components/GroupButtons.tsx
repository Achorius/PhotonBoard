import React from 'react'

interface GroupInfo {
  id: string
  name: string
  color: string
  fixtureCount: number
}

interface Props {
  groups: GroupInfo[]
  selectedFixtureIds: string[]
  onSelectGroup: (id: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
}

export function GroupButtons({ groups, selectedFixtureIds, onSelectGroup, onSelectAll, onClearSelection }: Props) {
  const hasSelection = selectedFixtureIds.length > 0

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b-2 border-surface-3 bg-surface-1 overflow-x-auto">
      <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider shrink-0">Groups</span>

      {groups.filter(g => g.fixtureCount > 0).map(g => (
        <button
          key={g.id}
          className="shrink-0 px-4 py-2 rounded-lg text-xs font-bold transition-all active:scale-95"
          style={{
            backgroundColor: g.color + '25',
            color: g.color,
            border: `2px solid ${g.color}40`
          }}
          onClick={() => onSelectGroup(g.id)}
        >
          {g.name}
          <span className="ml-1 opacity-50">({g.fixtureCount})</span>
        </button>
      ))}

      <div className="w-px h-6 bg-surface-3 shrink-0" />

      <button
        className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-surface-3 text-gray-400 active:bg-accent active:text-white active:scale-95 transition-all"
        onClick={onSelectAll}
      >
        ALL
      </button>

      {hasSelection && (
        <button
          className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-surface-3 text-gray-500 active:bg-surface-4 active:scale-95 transition-all"
          onClick={onClearSelection}
        >
          NONE
        </button>
      )}

      {hasSelection && (
        <span className="shrink-0 text-[10px] text-accent font-bold ml-auto">
          {selectedFixtureIds.length} sel.
        </span>
      )}
    </div>
  )
}
