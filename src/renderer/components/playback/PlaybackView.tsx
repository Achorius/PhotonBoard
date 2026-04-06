import React, { useState, useCallback } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useEffectsStore } from '../../stores/effects-store'
import { Fader } from '../common/Fader'
import { HSlider } from '../common/HSlider'
import type { CueChannelValue } from '@shared/types'

// ============================================================
// PlaybackView — Simplified "Scenes" workflow
//
// A Scene = snapshot of everything currently happening:
//   - Static DMX values (positions, colors, dimmers)
//   - Effects that are running
//
// Workflow:
//   1. Set up fixtures in Live / 3D view
//   2. Add effects in Effects tab
//   3. Come here → hit REC → scene is saved
//   4. Scene appears in executor bar (bottom) → trigger with GO
// ============================================================

export function PlaybackView() {
  const { cuelists, addCuelist, removeCuelist, goCuelist, goBackCuelist, stopCuelist, setCuelistFader, addCue, removeCue, updateCue } = usePlaybackStore()
  const { patch, selectedFixtureIds, getFixtureChannels } = usePatchStore()
  const { values } = useDmxStore()
  const effects = useEffectsStore(s => s.effects)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // -------------------------------------------------------------------
  // Record current state as a new scene (cuelist with a single cue)
  // or add a step to an existing scene
  // -------------------------------------------------------------------
  const recordScene = useCallback(() => {
    // Capture current DMX state for all fixtures (or selected)
    const targetIds = selectedFixtureIds.length > 0 ? selectedFixtureIds : patch.map(p => p.id)
    const cueValues: CueChannelValue[] = []

    for (const id of targetIds) {
      const entry = patch.find(p => p.id === id)
      if (!entry) continue
      const channels = getFixtureChannels(entry)
      for (const ch of channels) {
        const val = values[entry.universe][ch.absoluteChannel]
        if (val > 0) {
          cueValues.push({ fixtureId: entry.id, channelName: ch.name, value: val })
        }
      }
    }

    // Count running effects for the name
    const runningEffects = effects.filter(e => e.isRunning)
    const effectLabel = runningEffects.length > 0
      ? ` + ${runningEffects.length} effect${runningEffects.length > 1 ? 's' : ''}`
      : ''

    // Create a new scene (cuelist with one cue)
    const sceneNumber = cuelists.length + 1
    const sceneId = addCuelist(`Scene ${sceneNumber}${effectLabel}`)
    addCue(sceneId, `Look 1`, cueValues, 2, 2)
  }, [patch, selectedFixtureIds, getFixtureChannels, values, effects, cuelists, addCuelist, addCue])

  // Add a step (cue) to an existing scene
  const addStepToScene = useCallback((sceneId: string) => {
    const targetIds = selectedFixtureIds.length > 0 ? selectedFixtureIds : patch.map(p => p.id)
    const cueValues: CueChannelValue[] = []

    for (const id of targetIds) {
      const entry = patch.find(p => p.id === id)
      if (!entry) continue
      const channels = getFixtureChannels(entry)
      for (const ch of channels) {
        const val = values[entry.universe][ch.absoluteChannel]
        if (val > 0) {
          cueValues.push({ fixtureId: entry.id, channelName: ch.name, value: val })
        }
      }
    }

    const scene = cuelists.find(c => c.id === sceneId)
    const stepNumber = (scene?.cues.length || 0) + 1
    addCue(sceneId, `Look ${stepNumber}`, cueValues, 2, 2)
  }, [patch, selectedFixtureIds, getFixtureChannels, values, cuelists, addCue])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="panel-header flex items-center justify-between">
        <span>Scenes</span>
        <button
          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-500 transition-colors flex items-center gap-1.5"
          onClick={recordScene}
          title="Record current state as a new scene"
        >
          <span className="text-sm">●</span> REC New Scene
        </button>
      </div>

      {/* How it works */}
      {cuelists.length === 0 && (
        <div className="p-4 space-y-3">
          <div className="panel p-4 space-y-2 text-sm text-gray-400">
            <p className="font-medium text-gray-300">How it works:</p>
            <ol className="list-decimal ml-4 space-y-1 text-[12px]">
              <li><b>Set up your look</b> — adjust fixtures in the Live or 3D view (colors, positions, dimmers)</li>
              <li><b>Add effects</b> — go to Effects tab, add movement or color effects</li>
              <li><b>Hit REC</b> — saves everything into a Scene</li>
              <li><b>Trigger it</b> — use the executor bar at the bottom (or MIDI)</li>
            </ol>
            <p className="text-[11px] text-gray-500 mt-2">
              Each scene can have multiple steps (looks). Add steps to create sequences that advance with GO.
            </p>
          </div>
        </div>
      )}

      {/* Scene list */}
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {cuelists.map((scene, sceneIndex) => {
          const isExpanded = expandedId === scene.id
          const isActive = scene.isPlaying

          return (
            <div
              key={scene.id}
              className={`panel transition-colors ${isActive ? 'border-l-2 border-l-green-500' : ''}`}
            >
              {/* Scene header */}
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Expand toggle */}
                <button
                  className="text-[10px] text-gray-500 w-4"
                  onClick={() => setExpandedId(isExpanded ? null : scene.id)}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>

                {/* Scene number badge */}
                <span className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${
                  isActive ? 'bg-green-600 text-white' : 'bg-surface-3 text-gray-400'
                }`}>
                  {sceneIndex + 1}
                </span>

                {/* Editable name */}
                <input
                  className="bg-transparent border-none outline-none text-xs font-medium flex-1 min-w-0"
                  value={scene.name}
                  onChange={e => usePlaybackStore.getState().renameCuelist(scene.id, e.target.value)}
                />

                {/* Transport */}
                <button className="btn-ghost text-[10px] py-0.5" onClick={() => goBackCuelist(scene.id)} title="Previous step">◀</button>
                <button
                  className={`px-3 py-1 rounded text-[10px] font-bold transition-colors ${
                    isActive ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-accent text-white hover:bg-orange-500'
                  }`}
                  onClick={() => goCuelist(scene.id)}
                >
                  GO
                </button>
                <button
                  className="btn-ghost text-[10px] py-0.5 hover:text-red-400"
                  onClick={() => stopCuelist(scene.id)}
                  title="Stop"
                >
                  ■
                </button>

                {/* Add step */}
                <button
                  className="px-2 py-0.5 rounded text-[10px] bg-red-900/40 text-red-300 hover:bg-red-800/40"
                  onClick={() => addStepToScene(scene.id)}
                  title="Record current state as a new step in this scene"
                >
                  + Step
                </button>

                {/* Fader */}
                <div className="w-20">
                  <Fader
                    value={scene.faderLevel}
                    onChange={(v) => setCuelistFader(scene.id, v)}
                    vertical={false}
                    showValue={false}
                  />
                </div>

                {/* Step indicator */}
                <span className="text-[10px] font-mono text-gray-500 w-10 text-right">
                  {scene.currentCueIndex >= 0 ? `${scene.currentCueIndex + 1}` : '-'}/{scene.cues.length}
                </span>

                {/* Delete */}
                <button
                  className="text-red-400 hover:text-red-300 text-[10px] px-1"
                  onClick={() => removeCuelist(scene.id)}
                >
                  x
                </button>
              </div>

              {/* Expanded: steps list with timing */}
              {isExpanded && (
                <div className="border-t border-surface-3">
                  {scene.cues.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-gray-600">
                      No steps yet. Adjust your fixtures and click "+ Step" to add looks.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-gray-500 text-left bg-surface-2">
                            <th className="px-2 py-1 w-8">Step</th>
                            <th className="px-2 py-1">Name</th>
                            <th className="px-2 py-1 w-20">Fade In</th>
                            <th className="px-2 py-1 w-20">Fade Out</th>
                            <th className="px-2 py-1 w-16">Wait</th>
                            <th className="px-2 py-1 w-16">Auto</th>
                            <th className="px-2 py-1 w-10">Ch</th>
                            <th className="px-2 py-1 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {scene.cues.map((cue, i) => (
                            <tr
                              key={cue.id}
                              className={`border-t border-surface-3 ${
                                i === scene.currentCueIndex ? 'bg-green-900/20 text-green-400' : 'text-gray-300'
                              }`}
                            >
                              <td className="px-2 py-0.5 font-mono">{i + 1}</td>
                              <td className="px-2 py-0.5">
                                <input
                                  className="bg-transparent border-none outline-none w-full text-inherit"
                                  value={cue.name}
                                  onChange={e => updateCue(scene.id, cue.id, { name: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5">
                                  <input
                                    className="bg-transparent border-none outline-none w-10 text-inherit text-center font-mono"
                                    type="number" step={0.1} min={0}
                                    value={cue.fadeIn}
                                    onChange={e => updateCue(scene.id, cue.id, { fadeIn: parseFloat(e.target.value) || 0 })}
                                  />
                                  <span className="text-[9px] text-gray-600">s</span>
                                </div>
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5">
                                  <input
                                    className="bg-transparent border-none outline-none w-10 text-inherit text-center font-mono"
                                    type="number" step={0.1} min={0}
                                    value={cue.fadeOut}
                                    onChange={e => updateCue(scene.id, cue.id, { fadeOut: parseFloat(e.target.value) || 0 })}
                                  />
                                  <span className="text-[9px] text-gray-600">s</span>
                                </div>
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5">
                                  <input
                                    className="bg-transparent border-none outline-none w-10 text-inherit text-center font-mono"
                                    type="number" step={0.1} min={0}
                                    value={cue.delay}
                                    onChange={e => updateCue(scene.id, cue.id, { delay: parseFloat(e.target.value) || 0 })}
                                  />
                                  <span className="text-[9px] text-gray-600">s</span>
                                </div>
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5 justify-center">
                                  {cue.followTime !== null ? (
                                    <>
                                      <input
                                        className="bg-transparent border-none outline-none w-8 text-inherit text-center font-mono"
                                        type="number" step={0.1} min={0}
                                        value={cue.followTime}
                                        onChange={e => updateCue(scene.id, cue.id, { followTime: parseFloat(e.target.value) || 0 })}
                                      />
                                      <button
                                        className="text-[8px] text-gray-600 hover:text-red-400"
                                        onClick={() => updateCue(scene.id, cue.id, { followTime: null })}
                                        title="Remove auto-follow"
                                      >✕</button>
                                    </>
                                  ) : (
                                    <button
                                      className="text-[9px] text-gray-600 hover:text-accent"
                                      onClick={() => updateCue(scene.id, cue.id, { followTime: 0 })}
                                      title="Enable auto-follow (advance after fade)"
                                    >
                                      + auto
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-0.5 text-gray-500 text-center">{cue.values.length}</td>
                              <td className="px-2 py-0.5">
                                <button className="text-red-400 hover:text-red-300" onClick={() => removeCue(scene.id, cue.id)}>x</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Loop toggle + Auto-follow all steps */}
                  <div className="px-3 py-1.5 flex items-center gap-3 border-t border-surface-3">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scene.isLooping}
                        onChange={e => usePlaybackStore.setState(s => ({
                          cuelists: s.cuelists.map(c => c.id === scene.id ? { ...c, isLooping: e.target.checked } : c)
                        }))}
                        className="rounded"
                      />
                      Loop
                    </label>
                    <button
                      className="text-[10px] text-gray-500 hover:text-accent px-1.5 py-0.5 rounded hover:bg-surface-3"
                      onClick={() => {
                        // Set followTime=0 on all cues → auto-advance immediately after fade
                        for (const cue of scene.cues) {
                          updateCue(scene.id, cue.id, { followTime: 0 })
                        }
                      }}
                      title="Set all steps to auto-advance immediately after fade completes"
                    >
                      Auto-follow all
                    </button>
                    <button
                      className="text-[10px] text-gray-500 hover:text-accent px-1.5 py-0.5 rounded hover:bg-surface-3"
                      onClick={() => {
                        // Clear followTime on all cues → manual GO only
                        for (const cue of scene.cues) {
                          updateCue(scene.id, cue.id, { followTime: null })
                        }
                      }}
                      title="Set all steps to require manual GO"
                    >
                      Manual all
                    </button>
                    <span className="text-[10px] text-gray-600 ml-auto">
                      {scene.cues.length} step{scene.cues.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
