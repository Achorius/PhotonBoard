import React from 'react'
import { usePatchStore } from '../../stores/patch-store'
import type { WaveformType } from '@shared/types'
import { useEffectsStore } from '../../stores/effects-store'

const WAVEFORMS: WaveformType[] = ['sine', 'square', 'sawtooth', 'triangle', 'random']
const WAVEFORM_ICONS: Record<WaveformType, string> = {
  sine: '∿',
  square: '⊓',
  sawtooth: '⩘',
  triangle: '△',
  random: '?'
}

export function EffectsView() {
  const { patch, selectedFixtureIds } = usePatchStore()
  const { effects, addEffect, updateEffect, toggleEffect, removeEffect } = useEffectsStore()

  const addNewEffect = () => {
    const targetIds = selectedFixtureIds.length > 0 ? selectedFixtureIds : patch.map(p => p.id)
    addEffect(targetIds)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header flex items-center justify-between">
        <span>Effects Engine</span>
        <button className="btn-primary text-[10px] py-0.5" onClick={addNewEffect}>
          + Add Effect
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {effects.length === 0 ? (
          <div className="text-center text-gray-600 text-sm py-8">
            No effects. Select fixtures and click "+ Add Effect" to create LFO modulations.
          </div>
        ) : (
          effects.map(effect => (
            <div key={effect.id} className="panel p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  className="bg-transparent border-none outline-none text-sm font-medium flex-1"
                  value={effect.name}
                  onChange={e => updateEffect(effect.id, { name: e.target.value })}
                />
                <button
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    effect.isRunning ? 'bg-green-600 text-white' : 'bg-surface-3 text-gray-400'
                  }`}
                  onClick={() => toggleEffect(effect.id)}
                >
                  {effect.isRunning ? '■ Stop' : '▶ Run'}
                </button>
                <button className="text-red-400 hover:text-red-300 text-xs" onClick={() => removeEffect(effect.id)}>x</button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Waveform */}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase block mb-1">Waveform</label>
                  <div className="flex gap-1">
                    {WAVEFORMS.map(w => (
                      <button
                        key={w}
                        className={`w-8 h-8 rounded text-sm ${
                          effect.waveform === w ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400'
                        }`}
                        onClick={() => updateEffect(effect.id, { waveform: w })}
                        title={w}
                      >
                        {WAVEFORM_ICONS[w]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Speed */}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase block mb-1">Speed (Hz)</label>
                  <input
                    className="input w-full"
                    type="number"
                    step={0.1}
                    min={0.01}
                    max={20}
                    value={effect.speed}
                    onChange={e => updateEffect(effect.id, { speed: parseFloat(e.target.value) || 1 })}
                  />
                </div>

                {/* Depth */}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase block mb-1">Depth</label>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={effect.depth}
                    onChange={e => updateEffect(effect.id, { depth: parseInt(e.target.value) })}
                    className="w-full"
                  />
                  <span className="text-[10px] text-gray-500">{Math.round((effect.depth / 255) * 100)}%</span>
                </div>

                {/* Fan */}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase block mb-1">Fan (spread)</label>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={effect.fan}
                    onChange={e => updateEffect(effect.id, { fan: parseInt(e.target.value) })}
                    className="w-full"
                  />
                  <span className="text-[10px] text-gray-500">{effect.fan}°</span>
                </div>
              </div>

              {/* Channel target */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-gray-500 uppercase">Target Channel:</label>
                <select
                  className="input text-xs"
                  value={effect.channelType}
                  onChange={e => updateEffect(effect.id, { channelType: e.target.value })}
                >
                  <option value="Dimmer">Dimmer</option>
                  <option value="Red">Red</option>
                  <option value="Green">Green</option>
                  <option value="Blue">Blue</option>
                  <option value="White">White</option>
                  <option value="Pan">Pan</option>
                  <option value="Tilt">Tilt</option>
                </select>
                <span className="text-[10px] text-gray-500">{effect.fixtureIds.length} fixtures</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
