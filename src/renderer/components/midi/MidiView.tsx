import React from 'react'
import { useMidiStore } from '../../stores/midi-store'

export function MidiView() {
  const { devices, mappings, isLearning, learnTarget, lastMessage, apiStatus, apiError, startLearn, cancelLearn, removeMapping, initMidi } = useMidiStore()

  const inputs = devices.filter(d => d.type === 'input')
  const outputs = devices.filter(d => d.type === 'output')

  return (
    <div className="flex h-full">
      {/* Devices & Monitor */}
      <div className="w-64 border-r border-surface-3 flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>MIDI Devices</span>
          <button className="text-[10px] text-gray-500 hover:text-gray-300" onClick={() => initMidi()}>Rescan</button>
        </div>
        {/* API Status */}
        {apiStatus !== 'available' && (
          <div className={`px-2 py-1.5 text-[10px] border-b ${
            apiStatus === 'pending' ? 'bg-yellow-900/20 border-yellow-800/30 text-yellow-400' :
            'bg-red-900/20 border-red-800/30 text-red-400'
          }`}>
            {apiStatus === 'pending' && 'Initializing MIDI...'}
            {apiStatus === 'unavailable' && 'Web MIDI API not available'}
            {apiStatus === 'error' && `MIDI Error: ${apiError}`}
          </div>
        )}
        <div className="p-2 space-y-2 border-b border-surface-3">
          <div>
            <h4 className="text-[10px] text-gray-500 uppercase mb-1">Inputs</h4>
            {inputs.length === 0 ? (
              <p className="text-[10px] text-gray-600">No MIDI input detected</p>
            ) : (
              inputs.map(d => (
                <div key={d.id} className="flex items-center gap-1 text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full ${d.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{d.name}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <h4 className="text-[10px] text-gray-500 uppercase mb-1">Outputs</h4>
            {outputs.length === 0 ? (
              <p className="text-[10px] text-gray-600">No MIDI output detected</p>
            ) : (
              outputs.map(d => (
                <div key={d.id} className="flex items-center gap-1 text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full ${d.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{d.name}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* MIDI Monitor */}
        <div className="panel-header">Monitor</div>
        <div className="p-2 flex-1">
          {lastMessage ? (
            <div className="bg-surface-2 rounded p-2 font-mono text-xs space-y-1">
              <div className="text-gray-400">Type: <span className="text-accent">{lastMessage.type.toUpperCase()}</span></div>
              <div className="text-gray-400">Channel: <span className="text-white">{lastMessage.channel}</span></div>
              <div className="text-gray-400">{lastMessage.type === 'cc' ? 'CC#' : 'Note'}: <span className="text-white">{lastMessage.number}</span></div>
              <div className="text-gray-400">Value: <span className="text-white">{lastMessage.value}</span></div>
            </div>
          ) : (
            <p className="text-[10px] text-gray-600 text-center py-4">Move a fader or press a button...</p>
          )}
        </div>

        {/* MIDI Learn status */}
        {isLearning && (
          <div className="p-2 bg-accent/10 border-t border-accent/30">
            <div className="text-xs text-accent font-medium animate-pulse">MIDI Learn Active</div>
            <div className="text-[10px] text-gray-400 mt-1">Target: {learnTarget?.label}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Move a control on your MIDI device...</div>
            <button className="btn-ghost text-[10px] mt-1" onClick={cancelLearn}>Cancel</button>
          </div>
        )}
      </div>

      {/* Mappings */}
      <div className="flex-1 flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>MIDI Mappings</span>
          <div className="flex gap-1">
            <button
              className={`px-2 py-0.5 rounded text-[10px] ${
                isLearning ? 'bg-red-600 text-white animate-pulse' : 'bg-accent text-white'
              }`}
              onClick={() => {
                if (isLearning) cancelLearn()
                else startLearn({ type: 'master', label: 'Grand Master' })
              }}
            >
              {isLearning ? '● Learning...' : 'Quick Learn'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="text-gray-500 text-left">
                <th className="px-3 py-1.5 font-medium">Name</th>
                <th className="px-3 py-1.5 font-medium">Source</th>
                <th className="px-3 py-1.5 font-medium">Target</th>
                <th className="px-3 py-1.5 font-medium">Range</th>
                <th className="px-3 py-1.5 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-600">
                    No MIDI mappings. Use "Quick Learn" or right-click on a control to map it.
                  </td>
                </tr>
              ) : (
                mappings.map(m => (
                  <tr key={m.id} className="border-t border-surface-3 hover:bg-surface-2/50">
                    <td className="px-3 py-1.5">{m.name}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">
                      {m.source.type.toUpperCase()} Ch{m.source.channel} #{m.source.number}
                    </td>
                    <td className="px-3 py-1.5 text-gray-400">
                      {m.target.type}{m.target.parameter ? ` → ${m.target.parameter}` : ''}
                    </td>
                    <td className="px-3 py-1.5 text-gray-500">
                      {m.options.min}-{m.options.max}{m.options.inverted ? ' (inv)' : ''}{m.options.encoding === 'relative' ? ' ↻' : ''}
                    </td>
                    <td className="px-3 py-1.5">
                      <button className="text-red-400 hover:text-red-300" onClick={() => removeMapping(m.id)}>x</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
