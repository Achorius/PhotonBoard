import React from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useDmxStore } from '../../stores/dmx-store'

export function Toolbar() {
  const { showName } = useUiStore()
  const { grandMaster, setGrandMaster, blackout, toggleBlackout } = useDmxStore()

  return (
    <div className="h-9 bg-surface-1 border-b border-surface-3 flex items-center px-3 gap-3 shrink-0 titlebar-drag">
      {/* macOS traffic lights space */}
      <div className="w-16 shrink-0" />

      {/* Show name */}
      <span className="text-xs text-gray-400 titlebar-no-drag truncate max-w-40 font-medium">
        {showName}
      </span>

      <div className="flex-1" />

      {/* Grand Master */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <span className="text-[10px] text-gray-500 uppercase font-medium">GM</span>
        <input
          type="range"
          min={0}
          max={255}
          value={grandMaster}
          onChange={(e) => setGrandMaster(parseInt(e.target.value))}
          className="w-24 h-1.5"
          style={{ accentColor: '#e85d04' }}
        />
        <span className="text-[10px] font-mono text-gray-400 w-8 text-right">
          {Math.round((grandMaster / 255) * 100)}%
        </span>
      </div>

      {/* Blackout */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${
          blackout
            ? 'bg-red-600 text-white animate-pulse'
            : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
        }`}
        onClick={toggleBlackout}
      >
        BO
      </button>
    </div>
  )
}
