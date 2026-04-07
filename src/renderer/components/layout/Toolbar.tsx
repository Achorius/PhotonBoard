import React, { useState, useEffect } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useMidiStore } from '../../stores/midi-store'
import { HSlider } from '../common/HSlider'
import { toggleTimeline, getTimelineState } from '../../lib/timeline-engine'

export function Toolbar() {
  const { showName, activeTab, setActiveTab } = useUiStore()
  const { grandMaster, setGrandMaster, blackout, toggleBlackout } = useDmxStore()
  const { isLearning, learnTarget, cancelLearn, startLearn } = useMidiStore()

  const [timelinePlaying, setTimelinePlaying] = useState(false)

  useEffect(() => {
    // We piggyback on the timeline engine callback — but LiveView also sets one.
    // Use a polling approach instead to not conflict.
    const interval = setInterval(() => {
      const state = getTimelineState()
      setTimelinePlaying(state.isPlaying)
    }, 200)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="h-9 bg-surface-1 border-b border-surface-3 flex items-center px-3 gap-2 shrink-0 titlebar-drag">
      {/* macOS traffic lights space */}
      <div className="w-16 shrink-0" />

      {/* Show name — centered via absolute positioning */}
      <div className="absolute left-0 right-0 flex justify-center pointer-events-none">
        <span className="text-sm text-gray-200 font-medium truncate max-w-64">
          {showName}
        </span>
      </div>

      <div className="flex-1" />

      {/* Grand Master */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <span className="text-[10px] text-gray-500 uppercase font-medium">GM</span>
        <HSlider
          value={grandMaster}
          onChange={setGrandMaster}
          color="#e85d04"
          className="w-24"
        />
        <span className="text-[10px] font-mono text-gray-400 w-8 text-right">
          {Math.round((grandMaster / 255) * 100)}%
        </span>
      </div>

      {/* MIDI Learn button */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${
          isLearning
            ? 'bg-purple-600 text-white animate-pulse'
            : 'bg-purple-700/30 text-purple-400 border border-purple-600/40 hover:bg-purple-700/50'
        }`}
        onClick={() => {
          try {
            if (isLearning) cancelLearn()
            else startLearn({ type: 'master', label: 'Grand Master' })
          } catch (e) {
            console.error('[MIDI] Toolbar learn error:', e)
          }
        }}
        title={isLearning ? `Learning: ${learnTarget?.label || '...'} — Click to cancel` : 'MIDI Learn (maps to Grand Master)'}
      >
        {isLearning ? `MIDI ● ${learnTarget?.label || '...'}` : 'MIDI Learn'}
      </button>

      {/* Live button — toggles timeline playback */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${
          timelinePlaying
            ? 'bg-green-600 text-white animate-pulse'
            : 'bg-green-700/30 text-green-400 border border-green-600/40 hover:bg-green-700/50'
        }`}
        onClick={toggleTimeline}
        title={timelinePlaying ? 'Stop timeline' : 'Play timeline'}
      >
        Live
      </button>

      {/* Blackout */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${
          blackout
            ? 'bg-red-600 text-white animate-pulse'
            : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
        }`}
        onClick={toggleBlackout}
      >
        Blackout
      </button>
    </div>
  )
}
