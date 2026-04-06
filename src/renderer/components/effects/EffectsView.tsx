import React, { useMemo, useState, useCallback } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
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
  channels: string[]
  waveform: WaveformType
  defaultSpeed: number    // BPM
  defaultSize: number     // 0-100 (%)
  defaultSpread: number   // 0-360
}

const EFFECT_TEMPLATES: EffectTemplate[] = [
  // --- Movement ---
  { id: 'sweep-lr', label: 'Sweep L↔R', icon: '↔', category: 'movement',
    description: 'Pan left to right',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 30, defaultSize: 80, defaultSpread: 0 },
  { id: 'sweep-ud', label: 'Sweep U↔D', icon: '↕', category: 'movement',
    description: 'Tilt up and down',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 60, defaultSpread: 0 },
  { id: 'circle', label: 'Circle', icon: '◯', category: 'movement',
    description: 'Circular pan + tilt movement',
    channels: ['Pan', 'Tilt'], waveform: 'sine', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0 },
  { id: 'wave', label: 'Wave', icon: '〰', category: 'movement',
    description: 'Wave effect across fixtures',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 50, defaultSpread: 120 },
  { id: 'fan-out', label: 'Fan Out', icon: '⌘', category: 'movement',
    description: 'Fixtures spread apart then converge',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 15, defaultSize: 70, defaultSpread: 180 },
  { id: 'random-move', label: 'Random', icon: '⚡', category: 'movement',
    description: 'Random position changes',
    channels: ['Pan', 'Tilt'], waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0 },

  // --- Color ---
  { id: 'rainbow', label: 'Rainbow', icon: '🌈', category: 'color',
    description: 'Cycle through all colors',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 120 },
  { id: 'color-chase', label: 'Color Chase', icon: '→', category: 'color',
    description: 'Colors ripple across fixtures',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 60 },
  { id: 'color-pulse', label: 'Color Pulse', icon: '♥', category: 'color',
    description: 'Pulsing color shifts',
    channels: ['Red', 'Green', 'Blue'], waveform: 'triangle', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },

  // --- Intensity ---
  { id: 'pulse', label: 'Pulse', icon: '●', category: 'intensity',
    description: 'Smooth dimmer pulsing',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0 },
  { id: 'strobe-fx', label: 'Strobe', icon: '⚡', category: 'intensity',
    description: 'Fast on/off flashing',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 0 },
  { id: 'chase-intensity', label: 'Chase', icon: '→', category: 'intensity',
    description: 'Intensity chases across fixtures',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 120, defaultSize: 100, defaultSpread: 90 },
  { id: 'random-flash', label: 'Random Flash', icon: '✦', category: 'intensity',
    description: 'Random fixture flashes',
    channels: ['Dimmer'], waveform: 'random', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0 },
  { id: 'breathe', label: 'Breathe', icon: '◎', category: 'intensity',
    description: 'Slow breathing effect',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 10, defaultSize: 80, defaultSpread: 0 },
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
  const { patch, groups, selectedFixtureIds, selectFixture, selectGroup, clearSelection } = usePatchStore()
  const { effects, addEffect, updateEffect, toggleEffect, removeEffect } = useEffectsStore()

  const selectedIds = useMemo(() => new Set(selectedFixtureIds), [selectedFixtureIds])
  const hasSelection = selectedFixtureIds.length > 0

  // Resolve target label for an effect
  const getEffectTargetLabel = useCallback((fixtureIds: string[]): string => {
    if (fixtureIds.length === 0) return 'No fixtures'
    if (fixtureIds.length === patch.length) return 'All fixtures'
    for (const g of groups) {
      if (g.fixtureIds.length === fixtureIds.length &&
          g.fixtureIds.every(id => fixtureIds.includes(id))) {
        return g.name
      }
    }
    const names = fixtureIds.map(id => patch.find(p => p.id === id)?.name).filter(Boolean)
    if (names.length <= 3) return names.join(', ')
    return `${names.length} fixtures`
  }, [patch, groups])

  const addFromTemplate = useCallback((template: EffectTemplate) => {
    const targetIds = hasSelection ? [...selectedFixtureIds] : patch.map(p => p.id)
    const { fixtures } = usePatchStore.getState()
    const dmxStore = useDmxStore.getState()

    // For color and intensity effects, ensure dimmers are on for target fixtures
    if (template.category === 'color' || template.category === 'intensity') {
      for (const fxId of targetIds) {
        const entry = patch.find(p => p.id === fxId)
        if (!entry) continue
        const def = fixtures.find(f => f.id === entry.fixtureDefId)
        if (!def) continue
        const mode = def.modes.find(m => m.name === entry.modeName)
        if (!mode) continue

        // Find dimmer channel and set to 255 if currently 0
        const dimmerIdx = mode.channels.findIndex(ch =>
          ch.toLowerCase() === 'dimmer' || ch.toLowerCase() === 'intensity'
        )
        if (dimmerIdx >= 0) {
          const absChannel = entry.address - 1 + dimmerIdx
          const currentVal = dmxStore.values[entry.universe]?.[absChannel] ?? 0
          if (currentVal === 0) {
            dmxStore.setChannel(entry.universe, absChannel, 255)
          }
        }
      }
    }

    for (let i = 0; i < template.channels.length; i++) {
      const channelType = template.channels[i]
      const isMultiChannel = template.channels.length > 1

      let phaseOffset = 0
      if (isMultiChannel) {
        if (template.id === 'circle') {
          phaseOffset = i * 90
        } else {
          phaseOffset = i * (360 / template.channels.length)
        }
      }

      addEffect(targetIds)
      const allEffects = useEffectsStore.getState().effects
      const newEffect = allEffects[allEffects.length - 1]
      if (newEffect) {
        updateEffect(newEffect.id, {
          name: isMultiChannel ? `${template.label} (${channelType})` : template.label,
          waveform: template.waveform,
          speed: template.defaultSpeed / 60,
          depth: Math.round((template.defaultSize / 100) * 255),
          offset: phaseOffset,
          channelType,
          fan: template.defaultSpread,
          isRunning: true
        })
      }
    }
  }, [hasSelection, selectedFixtureIds, patch, addEffect, updateEffect])

  const categorizedTemplates = useMemo(() => {
    const cats: Record<string, EffectTemplate[]> = { movement: [], color: [], intensity: [] }
    for (const t of EFFECT_TEMPLATES) cats[t.category].push(t)
    return cats
  }, [])

  // Stop all effects
  const stopAll = useCallback(() => {
    for (const e of effects) {
      if (e.isRunning) toggleEffect(e.id)
    }
  }, [effects, toggleEffect])

  // Remove all effects
  const removeAll = useCallback(() => {
    for (const e of [...effects]) {
      removeEffect(e.id)
    }
  }, [effects, removeEffect])

  return (
    <div className="flex h-full overflow-hidden">
      {/* ============ LEFT: Fixture/Group Selector ============ */}
      <div className="w-48 shrink-0 border-r border-surface-3 bg-surface-1 flex flex-col overflow-y-auto">
        <div className="p-2 border-b border-surface-3">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-1">Apply effects to</h3>
          <button
            className={`w-full text-left text-xs px-2 py-1 rounded mb-0.5 transition-colors ${
              selectedFixtureIds.length === patch.length ? 'bg-accent text-white' : 'text-gray-400 hover:bg-surface-3'
            }`}
            onClick={() => {
              // Select all fixtures
              clearSelection()
              for (const p of patch) selectFixture(p.id, true)
            }}
          >
            All Fixtures ({patch.length})
          </button>
          {groups.map(g => (
            <button
              key={g.id}
              className={`w-full text-left text-xs px-2 py-1 rounded mb-0.5 flex items-center gap-1.5 transition-colors ${
                g.fixtureIds.every(id => selectedIds.has(id)) && g.fixtureIds.length > 0
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:bg-surface-3'
              }`}
              onClick={() => selectGroup(g.id)}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
              <span className="truncate">{g.name}</span>
              <span className="ml-auto text-[10px] text-gray-500">{g.fixtureIds.length}</span>
            </button>
          ))}
        </div>

        <div className="p-2 border-b border-surface-3">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-1">Fixtures</h3>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {patch.map(p => (
              <button
                key={p.id}
                className={`w-full text-left text-[11px] px-2 py-0.5 rounded truncate transition-colors ${
                  selectedIds.has(p.id) ? 'bg-accent/30 text-accent' : 'text-gray-500 hover:bg-surface-3'
                }`}
                onClick={() => selectFixture(p.id, true)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        {effects.length > 0 && (
          <div className="p-2">
            <h3 className="text-[10px] uppercase text-gray-500 font-semibold mb-1">Quick Actions</h3>
            <button
              className="w-full text-left text-xs px-2 py-1 rounded mb-0.5 text-gray-400 hover:bg-surface-3"
              onClick={stopAll}
            >
              ■ Stop All Effects
            </button>
            <button
              className="w-full text-left text-xs px-2 py-1 rounded mb-0.5 text-red-400 hover:bg-surface-3"
              onClick={removeAll}
            >
              x Remove All
            </button>
          </div>
        )}
      </div>

      {/* ============ MAIN AREA ============ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="panel-header flex items-center justify-between">
          <span>Effects</span>
          <span className="text-[10px] text-gray-500">
            {hasSelection ? `${selectedFixtureIds.length} fixtures selected` : 'Select fixtures on the left'}
          </span>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-4">
          {/* ============ EFFECT PALETTE ============ */}
          <div className="space-y-3">
            {Object.entries(categorizedTemplates).map(([cat, templates]) => (
              <div key={cat}>
                <h4 className="text-[11px] font-medium mb-1.5" style={{ color: CATEGORY_COLORS[cat] }}>
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
              <h3 className="text-xs text-gray-500 uppercase font-semibold">
                Active Effects ({effects.filter(e => e.isRunning).length} running)
              </h3>

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
                            type="number" min={1} max={600}
                            value={bpm}
                            onChange={e => updateEffect(effect.id, { speed: (parseInt(e.target.value) || 60) / 60 })}
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
              Select fixtures or a group on the left, then click an effect to start.
            </div>
          )}
        </div>
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
