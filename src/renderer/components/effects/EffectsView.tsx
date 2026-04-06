import React, { useMemo } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useEffectsStore } from '../../stores/effects-store'
import { HSlider } from '../common/HSlider'
import type { WaveformType } from '@shared/types'

// ============================================================
// Effect Templates — user-facing presets with clear lighting terms
// ============================================================

interface EffectTemplate {
  id: string
  label: string
  icon: string
  category: 'movement' | 'color' | 'intensity'
  description: string
  // Technical defaults (hidden from user)
  channels: string[]      // which channels this affects
  waveform: WaveformType
  defaultSpeed: number    // in BPM
  defaultSize: number     // 0-100 (%)
  defaultSpread: number   // 0-360
}

const EFFECT_TEMPLATES: EffectTemplate[] = [
  // --- Movement ---
  {
    id: 'sweep-lr', label: 'Sweep L↔R', icon: '↔', category: 'movement',
    description: 'Pan left to right',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 30, defaultSize: 80, defaultSpread: 0
  },
  {
    id: 'sweep-ud', label: 'Sweep U↔D', icon: '↕', category: 'movement',
    description: 'Tilt up and down',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 60, defaultSpread: 0
  },
  {
    id: 'circle', label: 'Circle', icon: '◯', category: 'movement',
    description: 'Circular pan + tilt movement',
    channels: ['Pan', 'Tilt'], waveform: 'sine', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0
  },
  {
    id: 'wave', label: 'Wave', icon: '〰', category: 'movement',
    description: 'Wave effect across fixtures',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 50, defaultSpread: 120
  },
  {
    id: 'fan-out', label: 'Fan Out', icon: '⌘', category: 'movement',
    description: 'Fixtures spread apart then converge',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 15, defaultSize: 70, defaultSpread: 180
  },
  {
    id: 'random-move', label: 'Random', icon: '⚡', category: 'movement',
    description: 'Random position changes',
    channels: ['Pan', 'Tilt'], waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0
  },

  // --- Color ---
  {
    id: 'rainbow', label: 'Rainbow', icon: '🌈', category: 'color',
    description: 'Cycle through all colors',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 120
  },
  {
    id: 'color-chase', label: 'Color Chase', icon: '→', category: 'color',
    description: 'Colors ripple across fixtures',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 60
  },
  {
    id: 'color-pulse', label: 'Color Pulse', icon: '♥', category: 'color',
    description: 'Pulsing color shifts',
    channels: ['Red', 'Green', 'Blue'], waveform: 'triangle', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0
  },

  // --- Intensity ---
  {
    id: 'pulse', label: 'Pulse', icon: '●', category: 'intensity',
    description: 'Smooth dimmer pulsing',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0
  },
  {
    id: 'strobe-fx', label: 'Strobe', icon: '⚡', category: 'intensity',
    description: 'Fast on/off flashing',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 0
  },
  {
    id: 'chase-intensity', label: 'Chase', icon: '→', category: 'intensity',
    description: 'Intensity chases across fixtures',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 120, defaultSize: 100, defaultSpread: 90
  },
  {
    id: 'random-flash', label: 'Random Flash', icon: '✦', category: 'intensity',
    description: 'Random fixture flashes',
    channels: ['Dimmer'], waveform: 'random', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0
  },
  {
    id: 'breathe', label: 'Breathe', icon: '◎', category: 'intensity',
    description: 'Slow breathing effect',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 10, defaultSize: 80, defaultSpread: 0
  },
]

const CATEGORY_LABELS: Record<string, string> = {
  movement: '🎯 Movement',
  color: '🎨 Color',
  intensity: '💡 Intensity',
}

const CATEGORY_COLORS: Record<string, string> = {
  movement: '#6366f1',
  color: '#ec4899',
  intensity: '#e85d04',
}

// ============================================================
// EffectsView
// ============================================================

export function EffectsView() {
  const { patch, selectedFixtureIds, groups } = usePatchStore()
  const { effects, addEffect, updateEffect, toggleEffect, removeEffect } = useEffectsStore()

  const selectedCount = selectedFixtureIds.length
  const hasSelection = selectedCount > 0

  // Resolve group name for effect's fixtures
  const getEffectTargetLabel = (fixtureIds: string[]): string => {
    if (fixtureIds.length === 0) return 'No fixtures'
    if (fixtureIds.length === patch.length) return 'All fixtures'
    // Check if matches a group
    for (const g of groups) {
      if (g.fixtureIds.length === fixtureIds.length &&
          g.fixtureIds.every(id => fixtureIds.includes(id))) {
        return g.name
      }
    }
    const names = fixtureIds
      .map(id => patch.find(p => p.id === id)?.name)
      .filter(Boolean)
    if (names.length <= 3) return names.join(', ')
    return `${names.length} fixtures`
  }

  const addFromTemplate = (template: EffectTemplate) => {
    const targetIds = hasSelection ? selectedFixtureIds : patch.map(p => p.id)

    // For multi-channel effects (circle, rainbow), create one effect per channel
    // with phase offsets to create the combined pattern
    for (let i = 0; i < template.channels.length; i++) {
      const channelType = template.channels[i]
      const isMultiChannel = template.channels.length > 1

      // For circle: Pan = sine, Tilt = sine with 90° offset
      // For rainbow: R/G/B = sine with 120° offsets
      let phaseOffset = 0
      if (isMultiChannel) {
        if (template.id === 'circle') {
          phaseOffset = i * 90 // 0° for Pan, 90° for Tilt = circle
        } else {
          phaseOffset = i * (360 / template.channels.length) // Even spacing
        }
      }

      addEffect(targetIds)
      // Get the just-added effect and configure it
      const allEffects = useEffectsStore.getState().effects
      const newEffect = allEffects[allEffects.length - 1]
      if (newEffect) {
        updateEffect(newEffect.id, {
          name: isMultiChannel ? `${template.label} (${channelType})` : template.label,
          waveform: template.waveform,
          speed: template.defaultSpeed / 60, // BPM → Hz
          depth: Math.round((template.defaultSize / 100) * 255),
          offset: phaseOffset,
          channelType,
          fan: template.defaultSpread,
          isRunning: true // Start immediately
        })
      }
    }
  }

  // Group active effects by category
  const categorizedTemplates = useMemo(() => {
    const cats: Record<string, EffectTemplate[]> = { movement: [], color: [], intensity: [] }
    for (const t of EFFECT_TEMPLATES) cats[t.category].push(t)
    return cats
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="panel-header flex items-center justify-between">
        <span>Effects</span>
        <span className="text-[10px] text-gray-500">
          {hasSelection ? `${selectedCount} fixtures selected` : 'Select fixtures first (Live or 3D view)'}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* ============ EFFECT PALETTE ============ */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-500 uppercase font-semibold">
            Add Effect {hasSelection ? '' : '(select fixtures first)'}
          </h3>

          {Object.entries(categorizedTemplates).map(([cat, templates]) => (
            <div key={cat}>
              <h4 className="text-[10px] text-gray-500 mb-1.5" style={{ color: CATEGORY_COLORS[cat] }}>
                {CATEGORY_LABELS[cat]}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {templates.map(template => (
                  <button
                    key={template.id}
                    className={`px-3 py-2 rounded-lg text-xs border transition-all ${
                      hasSelection
                        ? 'bg-surface-2 border-surface-3 hover:border-accent hover:bg-surface-3 text-gray-300'
                        : 'bg-surface-1 border-surface-2 text-gray-600 cursor-not-allowed'
                    }`}
                    onClick={() => hasSelection && addFromTemplate(template)}
                    disabled={!hasSelection}
                    title={template.description}
                  >
                    <span className="text-base mr-1.5">{template.icon}</span>
                    <span>{template.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ============ ACTIVE EFFECTS ============ */}
        {effects.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-gray-500 uppercase font-semibold">Active Effects</h3>

            {effects.map(effect => {
              const bpm = Math.round(effect.speed * 60)
              const sizePercent = Math.round((effect.depth / 255) * 100)
              const isRunning = effect.isRunning
              const categoryColor = getCategoryColor(effect.channelType)

              return (
                <div
                  key={effect.id}
                  className={`panel p-3 space-y-2 transition-colors ${
                    isRunning ? 'border-l-2' : 'opacity-60'
                  }`}
                  style={isRunning ? { borderLeftColor: categoryColor } : undefined}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-2">
                    <button
                      className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors ${
                        isRunning
                          ? 'bg-green-600 text-white hover:bg-green-500'
                          : 'bg-surface-3 text-gray-500 hover:bg-surface-4'
                      }`}
                      onClick={() => toggleEffect(effect.id)}
                      title={isRunning ? 'Stop' : 'Start'}
                    >
                      {isRunning ? '■' : '▶'}
                    </button>

                    <div className="flex-1 min-w-0">
                      <input
                        className="bg-transparent border-none outline-none text-sm font-medium w-full"
                        value={effect.name}
                        onChange={e => updateEffect(effect.id, { name: e.target.value })}
                      />
                      <span className="text-[10px] text-gray-500">{getEffectTargetLabel(effect.fixtureIds)}</span>
                    </div>

                    <button
                      className="text-red-400 hover:text-red-300 text-xs px-2"
                      onClick={() => removeEffect(effect.id)}
                    >
                      x
                    </button>
                  </div>

                  {/* Controls row */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* Speed (BPM) */}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Speed</label>
                      <div className="flex items-center gap-1">
                        <input
                          className="input w-14 text-center text-xs"
                          type="number"
                          min={1}
                          max={600}
                          value={bpm}
                          onChange={e => {
                            const newBpm = parseInt(e.target.value) || 60
                            updateEffect(effect.id, { speed: newBpm / 60 })
                          }}
                        />
                        <span className="text-[10px] text-gray-500">BPM</span>
                      </div>
                    </div>

                    {/* Size */}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Size</label>
                      <div className="flex items-center gap-1">
                        <HSlider
                          value={sizePercent}
                          onChange={(v) => updateEffect(effect.id, { depth: Math.round((v / 100) * 255) })}
                          min={0} max={100}
                          color={categoryColor}
                          className="flex-1"
                        />
                        <span className="text-[10px] text-gray-500 w-8 text-right">{sizePercent}%</span>
                      </div>
                    </div>

                    {/* Spread */}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Spread</label>
                      <div className="flex items-center gap-1">
                        <HSlider
                          value={effect.fan}
                          onChange={(v) => updateEffect(effect.id, { fan: v })}
                          min={0} max={360}
                          color={categoryColor}
                          className="flex-1"
                        />
                        <span className="text-[10px] text-gray-500 w-8 text-right">{effect.fan}°</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {effects.length === 0 && (
          <div className="text-center text-gray-600 text-sm py-4">
            Select fixtures in the Live or 3D view, then click an effect above to start.
          </div>
        )}
      </div>
    </div>
  )
}

function getCategoryColor(channelType: string): string {
  switch (channelType) {
    case 'Pan': case 'Tilt': return '#6366f1'
    case 'Red': case 'Green': case 'Blue': return '#ec4899'
    default: return '#e85d04'
  }
}
