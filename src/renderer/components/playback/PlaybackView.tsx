import React, { useState, useCallback } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { useEffectsStore } from '../../stores/effects-store'
import { Fader } from '../common/Fader'
import { HSlider } from '../common/HSlider'
import type { CueChannelValue, Effect } from '@shared/types'

// ============================================================
// PlaybackView — "Scenes" workflow with full editing
// ============================================================

export function PlaybackView() {
  const { cuelists, addCuelist, removeCuelist, goCuelist, goBackCuelist, stopCuelist, setCuelistFader, addCue, removeCue, updateCue } = usePlaybackStore()
  const { patch, selectedFixtureIds, getFixtureChannels } = usePatchStore()
  const { values } = useDmxStore()
  const effects = useEffectsStore(s => s.effects)
  const hasRunningEffects = effects.some(e => e.isRunning)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // -------------------------------------------------------------------
  // Capture current DMX + running effects
  // -------------------------------------------------------------------
  const captureDmxValues = useCallback(() => {
    const targetIds = selectedFixtureIds.length > 0 ? selectedFixtureIds : patch.map(p => p.id)
    const cueValues: CueChannelValue[] = []
    for (const id of targetIds) {
      const entry = patch.find(p => p.id === id)
      if (!entry) continue
      const channels = getFixtureChannels(entry)
      for (const ch of channels) {
        const val = values[entry.universe]?.[ch.absoluteChannel] ?? 0
        if (val > 0) {
          cueValues.push({ fixtureId: entry.id, channelName: ch.name, value: val })
        }
      }
    }
    return cueValues
  }, [patch, selectedFixtureIds, getFixtureChannels, values])

  const captureEffects = useCallback((): Effect[] => {
    return effects.filter(e => e.isRunning).map(e => ({ ...e }))
  }, [effects])

  // -------------------------------------------------------------------
  // Record new scene
  // -------------------------------------------------------------------
  const recordScene = useCallback(() => {
    const cueValues = captureDmxValues()
    const effectSnapshots = captureEffects()
    const effectLabel = effectSnapshots.length > 0 ? ` + ${effectSnapshots.length} fx` : ''

    const sceneNumber = cuelists.length + 1
    const sceneId = addCuelist(`Scene ${sceneNumber}${effectLabel}`)
    addCue(sceneId, `Look 1`, cueValues, 2, 2)

    if (effectSnapshots.length > 0) {
      usePlaybackStore.setState(s => ({
        cuelists: s.cuelists.map(cl =>
          cl.id === sceneId ? { ...cl, effectSnapshots } : cl
        )
      }))
    }
  }, [captureDmxValues, captureEffects, cuelists, addCuelist, addCue])

  // -------------------------------------------------------------------
  // Add step to existing scene
  // -------------------------------------------------------------------
  const addStepToScene = useCallback((sceneId: string) => {
    const cueValues = captureDmxValues()
    const scene = cuelists.find(c => c.id === sceneId)
    const stepNumber = (scene?.cues.length || 0) + 1
    addCue(sceneId, `Look ${stepNumber}`, cueValues, 2, 2)
  }, [captureDmxValues, cuelists, addCue])

  // -------------------------------------------------------------------
  // Re-record a step (replace its DMX values with current state)
  // -------------------------------------------------------------------
  const reRecordStep = useCallback((sceneId: string, cueId: string) => {
    const cueValues = captureDmxValues()
    updateCue(sceneId, cueId, { values: cueValues })
  }, [captureDmxValues, updateCue])

  // -------------------------------------------------------------------
  // Update scene effects (replace with current running effects)
  // -------------------------------------------------------------------
  const updateSceneEffects = useCallback((sceneId: string) => {
    const effectSnapshots = captureEffects()
    if (effectSnapshots.length === 0) return // Don't erase if nothing is running
    usePlaybackStore.setState(s => ({
      cuelists: s.cuelists.map(cl =>
        cl.id === sceneId ? { ...cl, effectSnapshots } : cl
      )
    }))
  }, [captureEffects])

  // -------------------------------------------------------------------
  // Edit a single effect snapshot within a scene
  // -------------------------------------------------------------------
  const updateSceneEffect = useCallback((sceneId: string, effectId: string, updates: Partial<Effect>) => {
    usePlaybackStore.setState(s => ({
      cuelists: s.cuelists.map(cl => {
        if (cl.id !== sceneId || !cl.effectSnapshots) return cl
        return {
          ...cl,
          effectSnapshots: cl.effectSnapshots.map(e =>
            e.id === effectId ? { ...e, ...updates } : e
          )
        }
      })
    }))
  }, [])

  // -------------------------------------------------------------------
  // Remove a single effect from a scene
  // -------------------------------------------------------------------
  const removeSceneEffect = useCallback((sceneId: string, effectId: string) => {
    usePlaybackStore.setState(s => ({
      cuelists: s.cuelists.map(cl => {
        if (cl.id !== sceneId || !cl.effectSnapshots) return cl
        return {
          ...cl,
          effectSnapshots: cl.effectSnapshots.filter(e => e.id !== effectId)
        }
      })
    }))
  }, [])

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
              <li><b>Set up your look</b> — adjust fixtures in the Live or 3D view</li>
              <li><b>Add effects</b> — go to Effects tab</li>
              <li><b>Hit REC</b> — saves DMX values + running effects</li>
              <li><b>Trigger</b> — GO in executor bar or MIDI</li>
            </ol>
          </div>
        </div>
      )}

      {/* Scene list */}
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {cuelists.map((scene, sceneIndex) => {
          const isExpanded = expandedId === scene.id
          const isActive = scene.isPlaying
          const fxCount = scene.effectSnapshots?.length ?? 0

          return (
            <div
              key={scene.id}
              className={`panel transition-colors ${isActive ? 'border-l-2 border-l-green-500' : ''}`}
            >
              {/* Scene header */}
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  className="text-[10px] text-gray-500 w-4"
                  onClick={() => setExpandedId(isExpanded ? null : scene.id)}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>

                <span className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${
                  isActive ? 'bg-green-600 text-white' : 'bg-surface-3 text-gray-400'
                }`}>
                  {sceneIndex + 1}
                </span>

                <input
                  className="bg-transparent border-none outline-none text-xs font-medium flex-1 min-w-0"
                  value={scene.name}
                  onChange={e => usePlaybackStore.getState().renameCuelist(scene.id, e.target.value)}
                />

                {/* Effect badge */}
                {fxCount > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-900/40 text-pink-300">
                    {fxCount} fx
                  </span>
                )}

                <button className="btn-ghost text-[10px] py-0.5" onClick={() => goBackCuelist(scene.id)} title="Previous step">◀</button>
                <button
                  className={`px-3 py-1 rounded text-[10px] font-bold transition-colors ${
                    isActive ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-accent text-white hover:bg-orange-500'
                  }`}
                  onClick={() => isActive ? stopCuelist(scene.id) : goCuelist(scene.id)}
                >
                  {isActive ? 'STOP' : 'GO'}
                </button>

                <button
                  className="px-2 py-0.5 rounded text-[10px] bg-red-900/40 text-red-300 hover:bg-red-800/40"
                  onClick={() => addStepToScene(scene.id)}
                  title="Record current DMX as a new step"
                >
                  + Step
                </button>

                <div className="w-20">
                  <Fader value={scene.faderLevel} onChange={(v) => setCuelistFader(scene.id, v)} vertical={false} showValue={false} />
                </div>

                <span className="text-[10px] font-mono text-gray-500 w-10 text-right">
                  {scene.currentCueIndex >= 0 ? `${scene.currentCueIndex + 1}` : '-'}/{scene.cues.length}
                </span>

                <button className="text-red-400 hover:text-red-300 text-[10px] px-1" onClick={() => removeCuelist(scene.id)}>x</button>
              </div>

              {/* Expanded: steps + effects editing */}
              {isExpanded && (
                <div className="border-t border-surface-3">
                  {/* Steps table */}
                  {scene.cues.length > 0 && (
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-gray-500 text-left bg-surface-2">
                            <th className="px-2 py-1 w-8">Step</th>
                            <th className="px-2 py-1">Name</th>
                            <th className="px-2 py-1 w-16">Fade In</th>
                            <th className="px-2 py-1 w-16">Fade Out</th>
                            <th className="px-2 py-1 w-14">Wait</th>
                            <th className="px-2 py-1 w-16">Auto</th>
                            <th className="px-2 py-1 w-10">Ch</th>
                            <th className="px-2 py-1 w-20">Actions</th>
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
                                  <input className="bg-transparent border-none outline-none w-10 text-inherit text-center font-mono"
                                    type="number" step={0.1} min={0} value={cue.fadeIn}
                                    onChange={e => updateCue(scene.id, cue.id, { fadeIn: parseFloat(e.target.value) || 0 })} />
                                  <span className="text-[9px] text-gray-600">s</span>
                                </div>
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5">
                                  <input className="bg-transparent border-none outline-none w-10 text-inherit text-center font-mono"
                                    type="number" step={0.1} min={0} value={cue.fadeOut}
                                    onChange={e => updateCue(scene.id, cue.id, { fadeOut: parseFloat(e.target.value) || 0 })} />
                                  <span className="text-[9px] text-gray-600">s</span>
                                </div>
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5">
                                  <input className="bg-transparent border-none outline-none w-8 text-inherit text-center font-mono"
                                    type="number" step={0.1} min={0} value={cue.delay}
                                    onChange={e => updateCue(scene.id, cue.id, { delay: parseFloat(e.target.value) || 0 })} />
                                  <span className="text-[9px] text-gray-600">s</span>
                                </div>
                              </td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-0.5 justify-center">
                                  {cue.followTime !== null ? (
                                    <>
                                      <input className="bg-transparent border-none outline-none w-8 text-inherit text-center font-mono"
                                        type="number" step={0.1} min={0} value={cue.followTime}
                                        onChange={e => updateCue(scene.id, cue.id, { followTime: parseFloat(e.target.value) || 0 })} />
                                      <button className="text-[8px] text-gray-600 hover:text-red-400"
                                        onClick={() => updateCue(scene.id, cue.id, { followTime: null })}>✕</button>
                                    </>
                                  ) : (
                                    <button className="text-[9px] text-gray-600 hover:text-accent"
                                      onClick={() => updateCue(scene.id, cue.id, { followTime: 0 })}>+ auto</button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-0.5 text-gray-500 text-center">{cue.values.length}</td>
                              <td className="px-2 py-0.5">
                                <div className="flex items-center gap-1">
                                  <button
                                    className="text-[9px] text-accent hover:text-orange-300 px-1"
                                    onClick={() => reRecordStep(scene.id, cue.id)}
                                    title="Replace this step with current DMX state"
                                  >
                                    REC
                                  </button>
                                  <button className="text-red-400 hover:text-red-300 text-[9px]"
                                    onClick={() => removeCue(scene.id, cue.id)}>x</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {scene.cues.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-gray-600">
                      No steps yet. Adjust your fixtures and click "+ Step".
                    </div>
                  )}

                  {/* ============ EFFECTS in this scene ============ */}
                  {fxCount > 0 && (
                    <div className="border-t border-surface-3 px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] uppercase text-pink-400 font-semibold">Effects in this scene</h4>
                        <button
                          className={`text-[9px] px-1.5 py-0.5 rounded ${
                            hasRunningEffects
                              ? 'text-accent hover:text-orange-300 hover:bg-surface-3'
                              : 'text-gray-600 cursor-not-allowed'
                          }`}
                          onClick={() => hasRunningEffects && updateSceneEffects(scene.id)}
                          disabled={!hasRunningEffects}
                          title={hasRunningEffects ? 'Replace scene effects with currently running effects' : 'No effects running — start effects in Effects tab first'}
                        >
                          Update FX from current
                        </button>
                      </div>

                      {scene.effectSnapshots!.map(fx => {
                        const bpm = Math.round(fx.speed * 60)
                        const sizePercent = Math.round((fx.depth / 255) * 100)

                        return (
                          <div key={fx.id} className="flex items-center gap-2 bg-surface-2 rounded px-2 py-1.5">
                            {/* Name */}
                            <input
                              className="bg-transparent border-none outline-none text-[11px] font-medium w-24 min-w-0"
                              value={fx.name}
                              onChange={e => updateSceneEffect(scene.id, fx.id, { name: e.target.value })}
                            />

                            {/* Channel type */}
                            <span className="text-[9px] text-gray-500 px-1 py-0.5 bg-surface-3 rounded">
                              {fx.channelType}
                            </span>

                            {/* Speed */}
                            <div className="flex items-center gap-0.5">
                              <span className="text-[9px] text-gray-500">BPM</span>
                              <input
                                className="bg-transparent border-none outline-none w-10 text-[11px] text-center font-mono"
                                type="number" min={1} max={600} value={bpm}
                                onChange={e => updateSceneEffect(scene.id, fx.id, { speed: (parseInt(e.target.value) || 60) / 60 })}
                              />
                            </div>

                            {/* Size */}
                            <div className="flex items-center gap-0.5 flex-1 min-w-0">
                              <span className="text-[9px] text-gray-500">Size</span>
                              <HSlider
                                value={sizePercent}
                                onChange={(v) => updateSceneEffect(scene.id, fx.id, { depth: Math.round((v / 100) * 255) })}
                                min={0} max={100}
                                color="#ec4899"
                                className="flex-1"
                              />
                              <span className="text-[9px] text-gray-500 w-7 text-right">{sizePercent}%</span>
                            </div>

                            {/* Spread */}
                            <div className="flex items-center gap-0.5">
                              <span className="text-[9px] text-gray-500">Spr</span>
                              <input
                                className="bg-transparent border-none outline-none w-8 text-[11px] text-center font-mono"
                                type="number" min={0} max={360} value={fx.fan}
                                onChange={e => updateSceneEffect(scene.id, fx.id, { fan: parseInt(e.target.value) || 0 })}
                              />
                              <span className="text-[9px] text-gray-500">°</span>
                            </div>

                            {/* Remove */}
                            <button
                              className="text-red-400 hover:text-red-300 text-[9px] px-1"
                              onClick={() => removeSceneEffect(scene.id, fx.id)}
                            >x</button>
                          </div>
                        )
                      })}

                      <div className="flex items-center gap-1 text-[9px] text-gray-600">
                        <span>{fxCount} effect{fxCount > 1 ? 's' : ''} — {scene.effectSnapshots!.map(e => e.fixtureIds.length).reduce((a, b) => a + b, 0)} fixtures</span>
                      </div>
                    </div>
                  )}

                  {/* Bottom controls: Loop + Auto-follow */}
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
                      onClick={() => { for (const cue of scene.cues) updateCue(scene.id, cue.id, { followTime: 0 }) }}
                      title="Auto-advance after each fade"
                    >
                      Auto-follow all
                    </button>
                    <button
                      className="text-[10px] text-gray-500 hover:text-accent px-1.5 py-0.5 rounded hover:bg-surface-3"
                      onClick={() => { for (const cue of scene.cues) updateCue(scene.id, cue.id, { followTime: null }) }}
                      title="Manual GO for each step"
                    >
                      Manual all
                    </button>
                    <button
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        hasRunningEffects
                          ? 'text-gray-500 hover:text-accent hover:bg-surface-3'
                          : 'text-gray-700 cursor-not-allowed'
                      }`}
                      onClick={() => hasRunningEffects && updateSceneEffects(scene.id)}
                      disabled={!hasRunningEffects}
                      title={hasRunningEffects ? 'Replace effects with currently running ones' : 'No effects running'}
                    >
                      Update FX
                    </button>
                    <span className="text-[10px] text-gray-600 ml-auto">
                      {scene.cues.length} step{scene.cues.length !== 1 ? 's' : ''}
                      {fxCount > 0 ? ` · ${fxCount} fx` : ''}
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
