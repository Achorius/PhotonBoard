import React from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { HSlider } from '../common/HSlider'

const EXECUTOR_COUNT = 8

export function ExecutorBar() {
  const { cuelists, goCuelist, goBackCuelist, stopCuelist, setCuelistFader } = usePlaybackStore()

  // Map scenes to executor slots
  const scenes = cuelists.slice(0, EXECUTOR_COUNT)
  const slots = Array.from({ length: EXECUTOR_COUNT }, (_, i) => scenes[i] ?? null)

  return (
    <div className="h-24 bg-surface-1 border-t-2 border-surface-3 flex items-stretch gap-px px-px py-px shrink-0">
      {slots.map((scene, i) => {
        if (!scene) {
          return (
            <div
              key={i}
              className="flex-1 bg-surface-0 rounded flex flex-col items-center justify-center text-[9px] text-surface-4 min-w-0 border border-surface-2"
            >
              <span className="font-mono opacity-40">{i + 1}</span>
            </div>
          )
        }

        const isActive = scene.isPlaying
        const stepInfo = scene.currentCueIndex >= 0
          ? `${scene.currentCueIndex + 1}/${scene.cues.length}`
          : `${scene.cues.length} step${scene.cues.length !== 1 ? 's' : ''}`

        return (
          <div
            key={scene.id}
            className={`flex-1 flex flex-col min-w-0 rounded border transition-colors ${
              isActive ? 'bg-surface-2 border-green-500/50' : 'bg-surface-2 border-surface-3'
            }`}
          >
            {/* Name + step info */}
            <div className="flex items-center justify-between px-1.5 pt-1">
              <span className="text-[9px] font-medium text-gray-300 truncate leading-tight" title={scene.name}>
                {scene.name}
              </span>
              <span className={`text-[8px] font-mono shrink-0 ml-1 ${isActive ? 'text-green-400' : 'text-gray-600'}`}>
                {stepInfo}
              </span>
            </div>

            {/* Fader */}
            <div className="flex items-center px-1.5 py-0.5">
              <HSlider
                value={scene.faderLevel}
                onChange={(v) => setCuelistFader(scene.id, v)}
                color={isActive ? '#22c55e' : '#444'}
                className="flex-1"
              />
              <span className="text-[8px] font-mono text-gray-600 w-5 text-right shrink-0">
                {Math.round((scene.faderLevel / 255) * 100)}
              </span>
            </div>

            {/* Transport buttons */}
            <div className="flex gap-px px-1 pb-1">
              <button
                className="text-[9px] text-gray-500 hover:text-gray-300 px-1 py-0.5 rounded hover:bg-surface-3"
                onClick={() => goBackCuelist(scene.id)}
                title="Previous step"
              >
                ◀
              </button>
              <button
                className={`flex-1 text-[10px] font-bold rounded py-0.5 transition-colors ${
                  isActive
                    ? 'bg-red-700 text-white hover:bg-red-600'
                    : 'bg-accent text-white hover:bg-orange-500'
                }`}
                onClick={() => isActive ? stopCuelist(scene.id) : goCuelist(scene.id)}
              >
                {isActive ? 'STOP' : 'GO'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
