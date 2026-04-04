import React from 'react'
import { usePlaybackStore } from '../../stores/playback-store'

const EXECUTOR_COUNT = 8

export function ExecutorBar() {
  const { cuelists, chases, goCuelist, goBackCuelist, stopCuelist, setCuelistFader, toggleChase, setChaseFader } = usePlaybackStore()

  // Merge cuelists and chases into a single executor list (cuelists first)
  const executors = [
    ...cuelists.map(cl => ({ type: 'cuelist' as const, id: cl.id, name: cl.name, isPlaying: cl.isPlaying, faderLevel: cl.faderLevel, cueInfo: `${cl.currentCueIndex >= 0 ? cl.currentCueIndex + 1 : 0}/${cl.cues.length}` })),
    ...chases.map(ch => ({ type: 'chase' as const, id: ch.id, name: ch.name, isPlaying: ch.isPlaying, faderLevel: ch.faderLevel, cueInfo: `${ch.bpm}bpm` }))
  ].slice(0, EXECUTOR_COUNT)

  const slots = Array.from({ length: EXECUTOR_COUNT }, (_, i) => executors[i] ?? null)

  return (
    <div className="h-24 bg-surface-1 border-t-2 border-surface-3 flex items-stretch gap-px px-px py-px shrink-0">
      {slots.map((ex, i) => {
        if (!ex) {
          return (
            <div
              key={i}
              className="flex-1 bg-surface-0 rounded flex flex-col items-center justify-center text-[9px] text-surface-4 min-w-0 border border-surface-2"
            >
              <span className="font-mono opacity-40">{i + 1}</span>
            </div>
          )
        }

        const isActive = ex.isPlaying
        return (
          <div
            key={ex.id}
            className={`flex-1 flex flex-col min-w-0 rounded border transition-colors ${
              isActive ? 'bg-surface-2 border-accent/50' : 'bg-surface-2 border-surface-3'
            }`}
          >
            {/* Name + cue info */}
            <div className="flex items-center justify-between px-1.5 pt-1">
              <span className="text-[9px] font-medium text-gray-300 truncate leading-tight" title={ex.name}>
                {ex.name}
              </span>
              <span className={`text-[8px] font-mono shrink-0 ml-1 ${isActive ? 'text-accent' : 'text-gray-600'}`}>
                {ex.cueInfo}
              </span>
            </div>

            {/* Fader */}
            <div className="flex items-center px-1.5 py-0.5">
              <input
                type="range"
                min={0}
                max={255}
                value={ex.faderLevel}
                onChange={e => {
                  const v = parseInt(e.target.value)
                  if (ex.type === 'cuelist') setCuelistFader(ex.id, v)
                  else setChaseFader(ex.id, v)
                }}
                className="flex-1 h-1"
                style={{ accentColor: isActive ? '#e85d04' : '#444' }}
              />
              <span className="text-[8px] font-mono text-gray-600 w-5 text-right shrink-0">
                {Math.round((ex.faderLevel / 255) * 100)}
              </span>
            </div>

            {/* Transport buttons */}
            <div className="flex gap-px px-1 pb-1">
              <button
                className="text-[9px] text-gray-500 hover:text-gray-300 px-1 py-0.5 rounded hover:bg-surface-3"
                onClick={() => ex.type === 'cuelist' && goBackCuelist(ex.id)}
                title="Back"
              >
                ◀
              </button>
              <button
                className={`flex-1 text-[10px] font-bold rounded py-0.5 transition-colors ${
                  isActive
                    ? 'bg-green-700 text-white hover:bg-green-600'
                    : 'bg-accent text-white hover:bg-orange-500'
                }`}
                onClick={() => {
                  if (ex.type === 'cuelist') goCuelist(ex.id)
                  else toggleChase(ex.id)
                }}
              >
                {ex.type === 'chase' && isActive ? '■' : 'GO'}
              </button>
              <button
                className="text-[9px] text-gray-500 hover:text-red-400 px-1 py-0.5 rounded hover:bg-surface-3"
                onClick={() => {
                  if (ex.type === 'cuelist') stopCuelist(ex.id)
                  else toggleChase(ex.id)
                }}
                title="Stop"
              >
                ■
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
