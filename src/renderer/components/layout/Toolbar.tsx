import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useMidiStore } from '../../stores/midi-store'
import { HSlider } from '../common/HSlider'
import { toggleTimeline, getTimelineState } from '../../lib/timeline-engine'
import type { MidiTargetType } from '@shared/types'

export function Toolbar() {
  const { showName, activeTab, setActiveTab } = useUiStore()
  const { grandMaster, setGrandMaster, blackout, toggleBlackout, blinder, toggleBlinder, strobe, toggleStrobe, resetAll } = useDmxStore()
  const { mappings, isLearning, learnTarget, cancelLearn, startLearn } = useMidiStore()

  const [timelinePlaying, setTimelinePlaying] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      const state = getTimelineState()
      setTimelinePlaying(state.isPlaying)
    }, 200)
    return () => clearInterval(interval)
  }, [])

  // Strobe engine — flashes active channels on/off at strobeRate Hz
  const strobeRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const strobePhase = useRef(false)

  useEffect(() => {
    if (strobe) {
      const rate = useDmxStore.getState().strobeRate
      const intervalMs = Math.round(1000 / (rate * 2)) // half period for on/off

      strobeRef.current = setInterval(() => {
        const state = useDmxStore.getState()
        strobePhase.current = !strobePhase.current

        for (let u = 0; u < state.universeCount; u++) {
          const channels: Record<number, number> = {}
          for (let ch = 0; ch < 512; ch++) {
            if (state.values[u][ch] > 0) {
              // Only strobe channels that are currently active
              const gm = state.grandMaster / 255
              channels[ch] = strobePhase.current ? Math.round(state.values[u][ch] * gm) : 0
            }
          }
          if (Object.keys(channels).length > 0) {
            window.photonboard.dmx.setChannels(u, channels)
          }
        }
      }, intervalMs)
    } else {
      // Strobe off — restore normal output
      if (strobeRef.current) {
        clearInterval(strobeRef.current)
        strobeRef.current = null
      }
      strobePhase.current = false
      // Restore values
      const state = useDmxStore.getState()
      if (!state.blackout && !state.blinder) {
        const gm = state.grandMaster / 255
        for (let u = 0; u < state.universeCount; u++) {
          const channels: Record<number, number> = {}
          for (let ch = 0; ch < 512; ch++) {
            channels[ch] = Math.round(state.values[u][ch] * gm)
          }
          window.photonboard.dmx.setChannels(u, channels)
        }
      }
    }
    return () => {
      if (strobeRef.current) {
        clearInterval(strobeRef.current)
        strobeRef.current = null
      }
    }
  }, [strobe])

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
        title={isLearning ? `Learning: ${learnTarget?.label || '...'} — Click to cancel` : 'MIDI Learn (maps to Grand Master) — Right-click any button to MIDI Learn it'}
      >
        {isLearning ? `MIDI ● ${learnTarget?.label || '...'}` : 'MIDI Learn'}
      </button>

      {/* Live button — toggles timeline playback */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${midiRing('timeline_play')} ${
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

      {/* Reset */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${midiRing('reset')} bg-surface-3 text-gray-400 hover:bg-yellow-700/40 hover:text-yellow-300`}
        onClick={resetAll}
        onContextMenu={(e) => handleMidiLearn(e, 'reset', 'Reset')}
        title="Reset all channels to zero, GM to 100% — Right-click: MIDI Learn"
      >
        Reset
      </button>

      {/* Blinder */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${midiRing('blinder')} ${
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
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${midiRing('strobe')} ${
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

      {/* Blackout */}
      <button
        className={`px-3 py-1 text-xs font-bold rounded titlebar-no-drag transition-colors ${midiRing('blackout')} ${
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
