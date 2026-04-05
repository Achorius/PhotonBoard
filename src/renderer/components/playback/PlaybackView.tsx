import React, { useState } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { Fader } from '../common/Fader'
import type { CueChannelValue } from '@shared/types'

export function PlaybackView() {
  const { cuelists, chases, addCuelist, addChase } = usePlaybackStore()
  const [activeTab, setActiveTab] = useState<'cuelists' | 'chases'>('cuelists')

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-2 border-b border-surface-3">
        <button
          className={`px-3 py-1 text-xs rounded ${activeTab === 'cuelists' ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400'}`}
          onClick={() => setActiveTab('cuelists')}
        >
          Cuelists ({cuelists.length})
        </button>
        <button
          className={`px-3 py-1 text-xs rounded ${activeTab === 'chases' ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400'}`}
          onClick={() => setActiveTab('chases')}
        >
          Chases ({chases.length})
        </button>
        <div className="flex-1" />
        {activeTab === 'cuelists' && (
          <button className="btn-primary text-[10px] py-0.5" onClick={() => addCuelist(`Cuelist ${cuelists.length + 1}`)}>
            + Cuelist
          </button>
        )}
        {activeTab === 'chases' && (
          <button className="btn-primary text-[10px] py-0.5" onClick={() => addChase(`Chase ${chases.length + 1}`)}>
            + Chase
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'cuelists' ? <CuelistsPanel /> : <ChasesPanel />}
      </div>
    </div>
  )
}

function CuelistsPanel() {
  const { cuelists, goCuelist, goBackCuelist, stopCuelist, setCuelistFader, removeCuelist, addCue, removeCue, updateCue } = usePlaybackStore()
  const { patch, selectedFixtureIds, getFixtureChannels } = usePatchStore()
  const { values } = useDmxStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const recordCue = (cuelistId: string) => {
    // Record current DMX state of selected fixtures (or all if none selected)
    const targetIds = selectedFixtureIds.length > 0 ? selectedFixtureIds : patch.map(p => p.id)
    const cueValues: CueChannelValue[] = []

    for (const id of targetIds) {
      const entry = patch.find(p => p.id === id)
      if (!entry) continue
      const channels = getFixtureChannels(entry)
      for (const ch of channels) {
        const val = values[entry.universe][ch.absoluteChannel]
        if (val > 0) { // Only record non-zero values
          cueValues.push({ fixtureId: entry.id, channelName: ch.name, value: val })
        }
      }
    }

    const cuelist = cuelists.find(c => c.id === cuelistId)
    const cueName = `Cue ${(cuelist?.cues.length || 0) + 1}`
    addCue(cuelistId, cueName, cueValues)
  }

  if (cuelists.length === 0) {
    return <div className="text-center text-gray-600 text-sm py-8">No cuelists. Create one to start programming.</div>
  }

  return (
    <div className="space-y-2 p-2">
      {cuelists.map(cl => (
        <div key={cl.id} className="panel">
          {/* Cuelist header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-3">
            <button
              className="text-[10px] text-gray-500"
              onClick={() => setExpandedId(expandedId === cl.id ? null : cl.id)}
            >
              {expandedId === cl.id ? '▼' : '▶'}
            </button>

            <span className="text-xs font-medium flex-1">{cl.name}</span>

            {/* Transport */}
            <button className="btn-ghost text-[10px] py-0.5" onClick={() => goBackCuelist(cl.id)}>◀</button>
            <button
              className={`px-3 py-0.5 rounded text-[10px] font-bold ${
                cl.isPlaying ? 'bg-green-600 text-white' : 'bg-accent text-white'
              }`}
              onClick={() => goCuelist(cl.id)}
            >
              GO
            </button>
            <button className="btn-ghost text-[10px] py-0.5" onClick={() => stopCuelist(cl.id)}>■</button>

            {/* Record */}
            <button
              className="px-2 py-0.5 rounded text-[10px] bg-red-900/50 text-red-300 hover:bg-red-800/50"
              onClick={() => recordCue(cl.id)}
              title="Record current state as new cue"
            >
              ● REC
            </button>

            {/* Fader */}
            <div className="w-20">
              <Fader
                value={cl.faderLevel}
                onChange={(v) => setCuelistFader(cl.id, v)}
                vertical={false}
                showValue={false}
              />
            </div>

            {/* Current cue indicator */}
            <span className="text-[10px] font-mono text-gray-500 w-12 text-right">
              {cl.currentCueIndex >= 0 ? `${cl.currentCueIndex + 1}/${cl.cues.length}` : '-'}
            </span>

            <button className="text-red-400 hover:text-red-300 text-[10px]" onClick={() => removeCuelist(cl.id)}>x</button>
          </div>

          {/* Expanded cue list */}
          {expandedId === cl.id && (
            <div className="max-h-48 overflow-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-gray-500 text-left bg-surface-2">
                    <th className="px-2 py-1 w-8">#</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1 w-16">Fade In</th>
                    <th className="px-2 py-1 w-16">Fade Out</th>
                    <th className="px-2 py-1 w-16">Delay</th>
                    <th className="px-2 py-1 w-16">Follow</th>
                    <th className="px-2 py-1 w-10">Ch</th>
                    <th className="px-2 py-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {cl.cues.map((cue, i) => (
                    <tr
                      key={cue.id}
                      className={`border-t border-surface-3 ${
                        i === cl.currentCueIndex ? 'bg-accent/10 text-accent' : 'text-gray-300'
                      }`}
                    >
                      <td className="px-2 py-0.5 font-mono">{cue.number}</td>
                      <td className="px-2 py-0.5">
                        <input
                          className="bg-transparent border-none outline-none w-full text-inherit"
                          value={cue.name}
                          onChange={e => updateCue(cl.id, cue.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-0.5">
                        <input
                          className="bg-transparent border-none outline-none w-full text-inherit text-center font-mono"
                          type="number"
                          step={0.1}
                          min={0}
                          value={cue.fadeIn}
                          onChange={e => updateCue(cl.id, cue.id, { fadeIn: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-2 py-0.5">
                        <input
                          className="bg-transparent border-none outline-none w-full text-inherit text-center font-mono"
                          type="number"
                          step={0.1}
                          min={0}
                          value={cue.fadeOut}
                          onChange={e => updateCue(cl.id, cue.id, { fadeOut: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-2 py-0.5">
                        <input
                          className="bg-transparent border-none outline-none w-full text-inherit text-center font-mono"
                          type="number"
                          step={0.1}
                          min={0}
                          value={cue.delay}
                          onChange={e => updateCue(cl.id, cue.id, { delay: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-2 py-0.5 text-center font-mono text-gray-500">
                        {cue.followTime !== null ? `${cue.followTime}s` : '—'}
                      </td>
                      <td className="px-2 py-0.5 text-gray-500 text-center">{cue.values.length}</td>
                      <td className="px-2 py-0.5">
                        <button className="text-red-400 hover:text-red-300" onClick={() => removeCue(cl.id, cue.id)}>x</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ChasesPanel() {
  const { chases, toggleChase, setChaseBpm, setChaseFader, removeChase } = usePlaybackStore()

  if (chases.length === 0) {
    return <div className="text-center text-gray-600 text-sm py-8">No chases. Create one to start.</div>
  }

  return (
    <div className="space-y-2 p-2">
      {chases.map(ch => (
        <div key={ch.id} className="panel">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-xs font-medium flex-1">{ch.name}</span>

            <button
              className={`px-3 py-0.5 rounded text-[10px] font-bold ${
                ch.isPlaying ? 'bg-green-600 text-white' : 'bg-surface-3 text-gray-400'
              }`}
              onClick={() => toggleChase(ch.id)}
            >
              {ch.isPlaying ? '■ Stop' : '▶ Play'}
            </button>

            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">BPM:</span>
              <input
                className="input w-14 text-center text-[10px]"
                type="number"
                min={1}
                max={999}
                value={ch.bpm}
                onChange={e => setChaseBpm(ch.id, parseInt(e.target.value) || 120)}
              />
            </div>

            <div className="w-20">
              <Fader
                value={ch.faderLevel}
                onChange={(v) => setChaseFader(ch.id, v)}
                vertical={false}
                showValue={false}
              />
            </div>

            <span className="text-[10px] text-gray-500">{ch.steps.length} steps</span>
            <button className="text-red-400 hover:text-red-300 text-[10px]" onClick={() => removeChase(ch.id)}>x</button>
          </div>
        </div>
      ))}
    </div>
  )
}
