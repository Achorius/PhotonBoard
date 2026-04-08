import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useEffectsStore } from '../../stores/effects-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { getWaveformValue } from '../../lib/effect-engine'
import { HSlider } from '../common/HSlider'
import { CurveEditor } from './CurveEditor'
import type { WaveformType, EffectChannel, CueChannelValue } from '@shared/types'

// ============================================================
// Effect Templates — rich presets with compound multi-channel support
// ============================================================

interface EffectTemplate {
  id: string
  label: string
  icon: string
  category: 'movement' | 'color' | 'intensity' | 'beam'
  description: string
  waveform: WaveformType
  defaultSpeed: number    // BPM
  defaultSize: number     // 0-100 (%)
  defaultSpread: number   // 0-360
  oneShot?: boolean
  // Single-channel mode (legacy)
  channels?: string[]
  // Compound multi-channel mode (preferred)
  compound?: EffectChannel[]
}

const EFFECT_TEMPLATES: EffectTemplate[] = [
  // ────────────── Movement ──────────────
  { id: 'sweep-lr', label: 'Sweep L↔R', icon: '↔', category: 'movement',
    description: 'Pan left to right',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 30, defaultSize: 80, defaultSpread: 0 },
  { id: 'sweep-ud', label: 'Sweep U↔D', icon: '↕', category: 'movement',
    description: 'Tilt up and down',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 60, defaultSpread: 0 },
  { id: 'circle', label: 'Circle', icon: '◯', category: 'movement',
    description: 'Circular pan + tilt (lissajous 1:1)',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0,
    compound: [
      { channelType: 'Pan', phaseOffset: 0, depth: 128 },
      { channelType: 'Tilt', phaseOffset: 90, depth: 128 },
    ] },
  { id: 'figure-8', label: 'Figure 8', icon: '∞', category: 'movement',
    description: 'Figure-8 pattern (lissajous 1:2)',
    waveform: 'sine', defaultSpeed: 12, defaultSize: 60, defaultSpread: 0,
    compound: [
      { channelType: 'Pan', phaseOffset: 0, depth: 128, frequencyMultiplier: 1 },
      { channelType: 'Tilt', phaseOffset: 0, depth: 100, frequencyMultiplier: 2 },
    ] },
  { id: 'ballyhoo', label: 'Ballyhoo', icon: '🎪', category: 'movement',
    description: 'Wide dramatic sweep (sine pan + triangle tilt)',
    waveform: 'sine', defaultSpeed: 8, defaultSize: 90, defaultSpread: 0,
    compound: [
      { channelType: 'Pan', phaseOffset: 0, depth: 200, waveform: 'sine' },
      { channelType: 'Tilt', phaseOffset: 45, depth: 120, waveform: 'triangle' },
    ] },
  { id: 'wave', label: 'Wave', icon: '〰', category: 'movement',
    description: 'Wave effect across fixtures',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 50, defaultSpread: 120 },
  { id: 'fan-out', label: 'Fan Out', icon: '⌘', category: 'movement',
    description: 'Fixtures spread apart then converge',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 15, defaultSize: 70, defaultSpread: 180 },
  { id: 'nod', label: 'Nod', icon: '↕', category: 'movement',
    description: 'Quick nod up-down (bounce waveform)',
    channels: ['Tilt'], waveform: 'bounce', defaultSpeed: 40, defaultSize: 40, defaultSpread: 0 },
  { id: 'step-position', label: 'Step Position', icon: '▦', category: 'movement',
    description: 'Snap between 4 discrete positions',
    waveform: 'step', defaultSpeed: 30, defaultSize: 60, defaultSpread: 90,
    compound: [
      { channelType: 'Pan', phaseOffset: 0, depth: 150, waveform: 'step' },
      { channelType: 'Tilt', phaseOffset: 90, depth: 100, waveform: 'step' },
    ] },
  { id: 'random-move', label: 'Random', icon: '⚡', category: 'movement',
    description: 'Random position changes',
    waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0,
    compound: [
      { channelType: 'Pan', phaseOffset: 0, depth: 128 },
      { channelType: 'Tilt', phaseOffset: 0, depth: 128 },
    ] },

  // ────────────── Color (RGB) ──────────────
  { id: 'rainbow', label: 'Rainbow', icon: '🌈', category: 'color',
    description: 'Cycle through RGB colors',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 120 },
  { id: 'color-chase', label: 'Color Chase', icon: '→', category: 'color',
    description: 'RGB colors ripple across fixtures',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 60 },
  { id: 'color-pulse', label: 'Color Pulse', icon: '♥', category: 'color',
    description: 'Pulsing RGB color shifts',
    channels: ['Red', 'Green', 'Blue'], waveform: 'triangle', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },
  { id: 'color-step', label: 'Color Step', icon: '▮', category: 'color',
    description: 'Hard step between saturated colors',
    channels: ['Red', 'Green', 'Blue'], waveform: 'step', defaultSpeed: 20, defaultSize: 100, defaultSpread: 120 },
  { id: 'fire', label: 'Fire', icon: '🔥', category: 'color',
    description: 'Random warm flicker (red/amber)',
    waveform: 'random', defaultSpeed: 80, defaultSize: 80, defaultSpread: 0,
    compound: [
      { channelType: 'Red', phaseOffset: 0, depth: 255 },
      { channelType: 'Green', phaseOffset: 0, depth: 80 },
      { channelType: 'Blue', phaseOffset: 0, depth: 10 },
    ] },

  // ────────────── Color (Wheel) ──────────────
  { id: 'wheel-cycle', label: 'Wheel Cycle', icon: '🎡', category: 'color',
    description: 'Cycle through color wheel slots',
    channels: ['Color Wheel'], waveform: 'sawtooth', defaultSpeed: 10, defaultSize: 50, defaultSpread: 0 },
  { id: 'wheel-chase', label: 'Wheel Chase', icon: '🔄', category: 'color',
    description: 'Color wheel ripple across fixtures',
    channels: ['Color Wheel'], waveform: 'sawtooth', defaultSpeed: 20, defaultSize: 50, defaultSpread: 90 },
  { id: 'wheel-step', label: 'Wheel Step', icon: '⬛', category: 'color',
    description: 'Step through wheel colors sharply',
    channels: ['Color Wheel'], waveform: 'square', defaultSpeed: 30, defaultSize: 50, defaultSpread: 0 },
  { id: 'wheel-random', label: 'Wheel Random', icon: '🎲', category: 'color',
    description: 'Random color wheel jumps',
    channels: ['Color Wheel'], waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0 },

  // ────────────── Intensity ──────────────
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
  { id: 'bump', label: 'Bump', icon: '💥', category: 'intensity',
    description: 'Fast attack, slow decay (one-shot)',
    channels: ['Dimmer'], waveform: 'pulse', defaultSpeed: 120, defaultSize: 100, defaultSpread: 0, oneShot: true },
  { id: 'strobe-burst', label: 'Strobe Burst', icon: '⚡', category: 'intensity',
    description: '3 fast flashes then stop',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 600, defaultSize: 100, defaultSpread: 0, oneShot: true },
  { id: 'wave-dim', label: 'Dim Wave', icon: '〰', category: 'intensity',
    description: 'Intensity wave across fixtures',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 120 },
  { id: 'bounce-dim', label: 'Bounce', icon: '⬇', category: 'intensity',
    description: 'Bouncing ball intensity decay',
    channels: ['Dimmer'], waveform: 'bounce', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },

  // ────────────── Beam ──────────────
  { id: 'zoom-breathe', label: 'Zoom Breathe', icon: '🔍', category: 'beam',
    description: 'Zoom in and out smoothly',
    channels: ['Zoom'], waveform: 'sine', defaultSpeed: 15, defaultSize: 80, defaultSpread: 0 },
  { id: 'zoom-pulse', label: 'Zoom Pulse', icon: '💫', category: 'beam',
    description: 'Quick zoom pulse (fast attack)',
    channels: ['Zoom'], waveform: 'pulse', defaultSpeed: 40, defaultSize: 90, defaultSpread: 0 },
  { id: 'iris-pulse', label: 'Iris Pulse', icon: '⊙', category: 'beam',
    description: 'Iris open/close pulsing',
    channels: ['Iris'], waveform: 'sine', defaultSpeed: 20, defaultSize: 80, defaultSpread: 0 },
  { id: 'focus-hunt', label: 'Focus Hunt', icon: '🎯', category: 'beam',
    description: 'Slow focus shift for texture',
    channels: ['Focus'], waveform: 'triangle', defaultSpeed: 6, defaultSize: 40, defaultSpread: 0 },
  { id: 'gobo-spin', label: 'Gobo Spin', icon: '◐', category: 'beam',
    description: 'Continuous gobo wheel rotation',
    channels: ['Gobo'], waveform: 'sawtooth', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0 },
  { id: 'prism-rotate', label: 'Prism Rotate', icon: '◇', category: 'beam',
    description: 'Prism rotation effect',
    channels: ['Prism'], waveform: 'sawtooth', defaultSpeed: 10, defaultSize: 60, defaultSpread: 0 },
  { id: 'frost-fade', label: 'Frost Fade', icon: '❄', category: 'beam',
    description: 'Fade frost in and out',
    channels: ['Frost'], waveform: 'sine', defaultSpeed: 8, defaultSize: 80, defaultSpread: 0 },
]

const CATEGORY_LABELS: Record<string, string> = {
  movement: '🎯 Movement',
  color: '🎨 Color',
  intensity: '💡 Intensity',
  beam: '🔦 Beam',
}

const CATEGORY_COLORS: Record<string, string> = {
  movement: '#6366f1',
  color: '#ec4899',
  intensity: '#e85d04',
  beam: '#22d3ee',
}

const WAVEFORM_LABELS: Record<WaveformType, string> = {
  sine: 'Sine',
  square: 'Square',
  sawtooth: 'Saw',
  triangle: 'Triangle',
  random: 'Random',
  pulse: 'Pulse',
  bounce: 'Bounce',
  step: 'Step',
  custom: 'Custom',
}

// ============================================================
// Waveform Preview — small canvas showing the curve shape
// ============================================================

function WaveformPreview({ waveform, color, width = 60, height = 24, keyframes }: {
  waveform: WaveformType, color: string, width?: number, height?: number, keyframes?: import('@shared/types').WaveformKeyframe[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()

    // Waveform curve
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x < width; x++) {
      const phase = x / width
      const val = waveform === 'random'
        ? Math.sin(phase * 13.7) * Math.cos(phase * 7.3) // deterministic "random" for preview
        : getWaveformValue(waveform, phase, keyframes)
      const y = height / 2 - val * (height / 2 - 2)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [waveform, color, width, height, keyframes])

  return <canvas ref={canvasRef} style={{ width, height }} className="rounded" />
}

// ============================================================
// EffectsView
// ============================================================

export function EffectsView() {
  const { patch, groups, selectedFixtureIds, selectFixture, selectGroup, clearSelection } = usePatchStore()
  const { effects, addEffect, updateEffect, toggleEffect, removeEffect, checkOneShotCompleted } = useEffectsStore()

  const selectedIds = useMemo(() => new Set(selectedFixtureIds), [selectedFixtureIds])
  const hasSelection = selectedFixtureIds.length > 0
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  // Poll for one-shot effect completions
  useEffect(() => {
    const interval = setInterval(checkOneShotCompleted, 100)
    return () => clearInterval(interval)
  }, [checkOneShotCompleted])

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

    // Compound effect: single effect with multiple channels
    if (template.compound) {
      const channels: EffectChannel[] = template.compound.map(ch => ({
        ...ch,
        depth: Math.round((template.defaultSize / 100) * ch.depth),
      }))

      addEffect(targetIds)
      const allEffects = useEffectsStore.getState().effects
      const newEffect = allEffects[allEffects.length - 1]
      if (newEffect) {
        updateEffect(newEffect.id, {
          name: template.label,
          waveform: template.waveform,
          speed: template.defaultSpeed / 60,
          depth: Math.round((template.defaultSize / 100) * 255),
          offset: 0,
          channelType: template.compound[0].channelType,
          channels,
          fan: template.defaultSpread,
          isRunning: true,
          oneShot: template.oneShot,
        })
      }
      return
    }

    // Legacy single/multi-channel mode
    const templateChannels = template.channels || []
    for (let i = 0; i < templateChannels.length; i++) {
      const channelType = templateChannels[i]
      const isMultiChannel = templateChannels.length > 1

      let phaseOffset = 0
      if (isMultiChannel) {
        phaseOffset = i * (360 / templateChannels.length)
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
          isRunning: true,
          oneShot: template.oneShot,
        })
      }
    }
  }, [hasSelection, selectedFixtureIds, patch, addEffect, updateEffect])

  const categorizedTemplates = useMemo(() => {
    const cats: Record<string, EffectTemplate[]> = { movement: [], color: [], intensity: [], beam: [] }
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

  // Save current effects + DMX state as a new scene
  const [sceneSaved, setSceneSaved] = useState(false)
  const saveAsScene = useCallback(() => {
    const runningEffects = effects.filter(e => e.isRunning)
    if (runningEffects.length === 0) return

    const patchStore = usePatchStore.getState()
    const dmxStore = useDmxStore.getState()
    const playbackStore = usePlaybackStore.getState()

    const fixtureIdSet = new Set<string>()
    for (const fx of runningEffects) {
      for (const id of fx.fixtureIds) fixtureIdSet.add(id)
    }

    const cueValues: CueChannelValue[] = []
    for (const fixtureId of fixtureIdSet) {
      const entry = patchStore.patch.find(p => p.id === fixtureId)
      if (!entry) continue
      const channels = patchStore.getFixtureChannels(entry)
      for (const ch of channels) {
        const val = dmxStore.values[entry.universe]?.[ch.absoluteChannel] ?? 0
        if (val > 0) {
          cueValues.push({ fixtureId, channelName: ch.name, value: val })
        }
      }
    }

    const effectNames = runningEffects.map(e => e.name)
    const sceneName = effectNames.length <= 2
      ? effectNames.join(' + ')
      : `${effectNames[0]} +${effectNames.length - 1} effects`

    const cuelistId = playbackStore.addCuelist(sceneName)
    playbackStore.addCue(cuelistId, 'Cue 1', cueValues)

    const effectSnapshots = runningEffects.map(fx => ({ ...fx }))
    usePlaybackStore.setState((state) => ({
      cuelists: state.cuelists.map(cl =>
        cl.id === cuelistId ? { ...cl, effectSnapshots } : cl
      )
    }))

    setSceneSaved(true)
    setTimeout(() => setSceneSaved(false), 2000)
  }, [effects])

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
            {effects.some(e => e.isRunning) && (
              <button
                className={`w-full text-left text-xs px-2 py-1.5 rounded mb-1 font-medium transition-colors ${
                  sceneSaved
                    ? 'bg-green-600/30 text-green-400'
                    : 'bg-accent/20 text-accent hover:bg-accent/30'
                }`}
                onClick={saveAsScene}
              >
                {sceneSaved ? 'Scene created!' : 'Save as Scene'}
              </button>
            )}
            <button
              className="w-full text-left text-xs px-2 py-1 rounded mb-0.5 text-gray-400 hover:bg-surface-3"
              onClick={stopAll}
            >
              Stop All Effects
            </button>
            <button
              className="w-full text-left text-xs px-2 py-1 rounded mb-0.5 text-red-400 hover:bg-surface-3"
              onClick={removeAll}
            >
              Remove All
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

        <div className="flex-1 overflow-auto p-3 space-y-3">
          {/* ============ EFFECT PALETTE — Dropdown menus ============ */}
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(categorizedTemplates).map(([cat, templates]) => (
              <div key={cat} className="relative">
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    openCategory === cat
                      ? 'border-accent bg-surface-3 text-white'
                      : hasSelection
                        ? 'border-surface-3 bg-surface-2 text-gray-300 hover:border-accent hover:bg-surface-3'
                        : 'border-surface-2 bg-surface-1 text-gray-600 cursor-not-allowed'
                  }`}
                  onClick={() => hasSelection && setOpenCategory(openCategory === cat ? null : cat)}
                  disabled={!hasSelection}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                  {CATEGORY_LABELS[cat]}
                  <span className="text-[9px] text-gray-500 ml-0.5">{openCategory === cat ? '▲' : '▼'}</span>
                </button>

                {/* Dropdown panel */}
                {openCategory === cat && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpenCategory(null)} />
                    <div className="absolute top-full left-0 mt-1 z-20 bg-surface-2 border border-surface-3 rounded-lg shadow-xl min-w-[240px] py-1 overflow-hidden max-h-[400px] overflow-y-auto">
                      {templates.map(template => (
                        <button
                          key={template.id}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-gray-300 hover:bg-surface-3 hover:text-white transition-colors"
                          onClick={() => {
                            addFromTemplate(template)
                            setOpenCategory(null)
                          }}
                        >
                          <span className="text-base w-6 text-center shrink-0">{template.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium flex items-center gap-1.5">
                              {template.label}
                              {template.oneShot && (
                                <span className="text-[9px] bg-yellow-600/30 text-yellow-400 px-1 rounded">1x</span>
                              )}
                              {template.compound && (
                                <span className="text-[9px] bg-indigo-600/30 text-indigo-400 px-1 rounded">multi</span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 leading-tight">{template.description}</div>
                          </div>
                          <WaveformPreview waveform={template.waveform} color={CATEGORY_COLORS[cat]} width={40} height={18} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
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
                const isCompound = effect.channels && effect.channels.length > 0
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
                        <div className="flex items-center gap-1.5">
                          <input
                            className="bg-transparent border-none outline-none text-sm font-medium flex-1 min-w-0"
                            value={effect.name}
                            onChange={e => updateEffect(effect.id, { name: e.target.value })}
                          />
                          {effect.oneShot && (
                            <span className="text-[9px] bg-yellow-600/30 text-yellow-400 px-1 rounded shrink-0">1x</span>
                          )}
                          {isCompound && (
                            <span className="text-[9px] bg-indigo-600/30 text-indigo-400 px-1 rounded shrink-0">
                              {effect.channels!.map(c => c.channelType).join('+')}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-500">{getEffectTargetLabel(effect.fixtureIds)}</span>
                      </div>

                      <WaveformPreview waveform={effect.waveform} color={categoryColor} keyframes={effect.keyframes} />

                      <button
                        className="text-red-400 hover:text-red-300 text-xs px-2"
                        onClick={() => removeEffect(effect.id)}
                      >
                        x
                      </button>
                    </div>

                    {/* Controls row */}
                    <div className="grid grid-cols-4 gap-3">
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
                            onChange={(v) => {
                              const newDepth = Math.round((v / 100) * 255)
                              const updates: Partial<typeof effect> = { depth: newDepth }
                              // Scale compound channel depths proportionally
                              if (effect.channels) {
                                const ratio = v / Math.max(1, sizePercent)
                                updates.channels = effect.channels.map(ch => ({
                                  ...ch,
                                  depth: Math.min(255, Math.round(ch.depth * ratio))
                                }))
                              }
                              updateEffect(effect.id, updates)
                            }}
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

                      {/* Waveform selector */}
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Waveform</label>
                        <select
                          className="input w-full text-xs"
                          value={effect.waveform}
                          onChange={e => {
                            const wf = e.target.value as WaveformType
                            const updates: Record<string, any> = { waveform: wf }
                            // Initialize default keyframes when switching to custom
                            if (wf === 'custom' && !effect.keyframes?.length) {
                              updates.keyframes = [
                                { x: 0, y: -1 }, { x: 0.25, y: 1 },
                                { x: 0.5, y: -1 }, { x: 0.75, y: 1 }, { x: 1, y: -1 },
                              ]
                            }
                            updateEffect(effect.id, updates)
                          }}
                        >
                          {Object.entries(WAVEFORM_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* One-shot toggle */}
                    <div className="flex items-center gap-3 pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={effect.oneShot ?? false}
                          onChange={e => updateEffect(effect.id, { oneShot: e.target.checked })}
                          className="accent-accent"
                        />
                        <span className="text-[10px] text-gray-400">One-shot (trigger once)</span>
                      </label>
                    </div>

                    {/* Curve editor for custom waveform */}
                    {effect.waveform === 'custom' && (
                      <div className="pt-1">
                        <CurveEditor
                          keyframes={effect.keyframes}
                          onChange={(keyframes) => updateEffect(effect.id, { keyframes })}
                          color={categoryColor}
                        />
                      </div>
                    )}
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
    case 'Zoom': case 'Iris': case 'Focus': case 'Gobo': case 'Prism': case 'Frost': return '#22d3ee'
    default: return '#e85d04'
  }
}
