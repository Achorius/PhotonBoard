import React, { useState, useEffect, useCallback } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useMidiStore } from '../../stores/midi-store'
import { useFollowStore } from '../../stores/follow-store'
import { HSlider } from '../common/HSlider'
import { toggleTimeline, getTimelineState } from '../../lib/timeline-engine'
import { clearProgrammer, isProgrammerActive } from '../../lib/dmx-mixer'
import type { MidiTargetType } from '@shared/types'

export function Toolbar() {
  const { showName, activeTab, setActiveTab } = useUiStore()
  const { grandMaster, setGrandMaster, blackout, toggleBlackout, blinder, toggleBlinder, strobe, toggleStrobe } = useDmxStore()
  const followActive = useFollowStore(s => s.active)
  const { mappings, isLearning, learnTarget, cancelLearn, startLearn } = useMidiStore()

  const [timelinePlaying, setTimelinePlaying] = useState(false)
  const [progActive, setProgActive] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setTimelinePlaying(getTimelineState().isPlaying)
      setProgActive(isProgrammerActive())
    }, 200)
    return () => clearInterval(interval)
  }, [])

  // MIDI learn helpers
  const hasMidi = (type: MidiTargetType) =>
    mappings.some(m => m.target.type === type)
  const isLearningTarget = (type: MidiTargetType) =>
    isLearning && learnTarget?.type === type

  const handleMidiLearn = useCallback((e: React.MouseEvent, type: MidiTargetType, label: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (isLearning && learnTarget?.type === type) {
      cancelLearn()
    } else {
      startLearn({ type, label })
    }
  }, [isLearning, learnTarget, cancelLearn, startLearn])

  // MIDI indicator style for buttons
  const midiRing = (type: MidiTargetType) => {
    if (isLearningTarget(type)) return 'ring-2 ring-purple-500 animate-pulse'
    if (hasMidi(type)) return 'ring-1 ring-purple-500/50'
    return ''
  }

  return (
    <div className="h-9 bg-surface-1 border-b border-surface-3 flex items-center px-3 gap-2 shrink-0 titlebar-drag">
      {/* macOS traffic lights space */}
      <div className="w-16 shrink-0" />

      {/* Show name — centered between left margin and GM */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <span className="text-sm text-gray-200 font-medium truncate max-w-64 titlebar-drag">
          {showName}
        </span>
      </div>

      {/* Grand Master */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <span className="text-xs text-gray-400 uppercase font-semibold tracking-wider">GM</span>
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
        className={`px-2 py-1 text-[11px] font-bold rounded titlebar-no-drag transition-colors ${
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
        title={isLearning ? `Learning: ${learnTarget?.label || '...'} — Click to cancel` : 'MIDI Learn (maps to Grand Master) — Right-click any button to MIDI Learn it'}
      >
        {isLearning ? `MIDI ● ${learnTarget?.label || '...'}` : 'MIDI Learn'}
      </button>

      {/* Live button — toggles timeline playback */}
      <button
        className={`px-2 py-1 text-[11px] font-bold rounded titlebar-no-drag transition-colors ${midiRing('timeline_play')} ${
          timelinePlaying
            ? 'bg-green-600 text-white animate-pulse'
            : 'bg-green-700/30 text-green-400 border border-green-600/40 hover:bg-green-700/50'
        }`}
        onClick={toggleTimeline}
        onContextMenu={(e) => handleMidiLearn(e, 'timeline_play', 'Live / Timeline')}
        title={`${timelinePlaying ? 'Stop timeline' : 'Play timeline'} — Right-click: MIDI Learn`}
      >
        Live
      </button>

      {/* Clear Programmer */}
      <button
        className={`px-2 py-1 text-[11px] font-bold rounded titlebar-no-drag transition-colors ${
          progActive
            ? 'bg-orange-600/80 text-white hover:bg-orange-500'
            : 'bg-surface-3 text-gray-500 cursor-default'
        }`}
        onClick={() => { clearProgrammer(); setProgActive(false) }}
        disabled={!progActive}
        title="Clear Programmer — release all manual values (Backspace)"
      >
        Clear
      </button>

      {/* Blinder */}
      <button
        className={`px-2 py-1 text-[11px] font-bold rounded titlebar-no-drag transition-colors ${midiRing('blinder')} ${
          blinder
            ? 'bg-yellow-400 text-black'
            : 'bg-surface-3 text-gray-400 hover:bg-yellow-600/40 hover:text-yellow-200'
        }`}
        onMouseDown={() => toggleBlinder(true)}
        onMouseUp={() => toggleBlinder(false)}
        onMouseLeave={() => blinder && toggleBlinder(false)}
        onContextMenu={(e) => handleMidiLearn(e, 'blinder', 'Blinder')}
        title="Blinder — Hold: full white flash all fixtures — Right-click: MIDI Learn"
      >
        Blinder
      </button>

      {/* Strobe */}
      <button
        className={`px-2 py-1 text-[11px] font-bold rounded titlebar-no-drag transition-colors ${midiRing('strobe')} ${
          strobe
            ? 'bg-cyan-400 text-black animate-pulse'
            : 'bg-surface-3 text-gray-400 hover:bg-cyan-700/40 hover:text-cyan-200'
        }`}
        onMouseDown={() => toggleStrobe(true)}
        onMouseUp={() => toggleStrobe(false)}
        onMouseLeave={() => strobe && toggleStrobe(false)}
        onContextMenu={(e) => handleMidiLearn(e, 'strobe', 'Strobe')}
        title="Strobe — Hold: strobe active fixtures — Right-click: MIDI Learn"
      >
        Strobe
      </button>

      {/* Follow indicator (only when tracking) */}
      {followActive && (
        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-green-600/80 text-white animate-pulse titlebar-no-drag cursor-pointer"
          onClick={() => setActiveTab('follow')}
        >
          FOLLOW
        </span>
      )}

      {/* Blackout */}
      <button
        className={`px-2 py-1 text-[11px] font-bold rounded titlebar-no-drag transition-colors ${midiRing('blackout')} ${
          blackout
            ? 'bg-red-600 text-white animate-pulse'
            : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
        }`}
        onClick={toggleBlackout}
        onContextMenu={(e) => handleMidiLearn(e, 'blackout', 'Blackout')}
        title="Blackout — Right-click: MIDI Learn"
      >
        Blackout
      </button>

    </div>
  )
}
