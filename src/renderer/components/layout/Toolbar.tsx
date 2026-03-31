import React from 'react'
import { useUiStore, type ViewTab } from '../../stores/ui-store'
import { useDmxStore } from '../../stores/dmx-store'

const TABS: { id: ViewTab; label: string; shortcut: string }[] = [
  { id: 'faders', label: 'Faders', shortcut: '1' },
  { id: 'patch', label: 'Patch', shortcut: '2' },
  { id: 'fixtures', label: 'Fixtures', shortcut: '3' },
  { id: 'playback', label: 'Playback', shortcut: '4' },
  { id: 'effects', label: 'Effects', shortcut: '5' },
  { id: 'midi', label: 'MIDI', shortcut: '6' },
  { id: 'stage', label: 'Stage', shortcut: '7' },
  { id: 'settings', label: 'Settings', shortcut: '8' }
]

export function Toolbar() {
  const { activeTab, setActiveTab, showName } = useUiStore()
  const { grandMaster, setGrandMaster, blackout, toggleBlackout } = useDmxStore()

  return (
    <div className="h-10 bg-surface-1 border-b border-surface-3 flex items-center px-2 gap-1 titlebar-drag">
      {/* Spacer for traffic lights */}
      <div className="w-16 shrink-0" />

      {/* Show name */}
      <span className="text-xs text-gray-400 mr-3 titlebar-no-drag truncate max-w-32">
        {showName}
      </span>

      {/* Tab buttons */}
      <div className="flex items-center gap-0.5 titlebar-no-drag">
        {TABS.map(({ id, label, shortcut }) => (
          <button
            key={id}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              activeTab === id
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-surface-3'
            }`}
            onClick={() => setActiveTab(id)}
            title={`${label} (${shortcut})`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Grand Master */}
      <div className="flex items-center gap-2 titlebar-no-drag mr-2">
        <span className="text-[10px] text-gray-500 uppercase">GM</span>
        <input
          type="range"
          min={0}
          max={255}
          value={grandMaster}
          onChange={(e) => setGrandMaster(parseInt(e.target.value))}
          className="w-20 h-1.5"
          style={{ accentColor: '#e85d04' }}
        />
        <span className="text-[10px] font-mono text-gray-400 w-8">
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
