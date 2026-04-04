import React, { useState, useMemo } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { formatDmxAddress } from '../../lib/dmx-utils'

export function PatchView() {
  const { patch, fixtures, groups, addFixture, removeFixture, updateFixture, addGroup, removeGroup, addToGroup } = usePatchStore()
  const [showAddModal, setShowAddModal] = useState(false)

  return (
    <div className="flex h-full">
      {/* Patch table */}
      <div className="flex-1 flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>DMX Patch</span>
          <button className="btn-primary text-[10px] py-0.5" onClick={() => setShowAddModal(true)}>
            + Add Fixture
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="text-gray-500 text-left">
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">Mode</th>
                <th className="px-2 py-1.5 font-medium">Address</th>
                <th className="px-2 py-1.5 font-medium">Ch</th>
                <th className="px-2 py-1.5 font-medium">Groups</th>
                <th className="px-2 py-1.5 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {patch.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-600">
                    No fixtures patched. Click "+ Add Fixture" to start.
                  </td>
                </tr>
              ) : (
                patch
                  .sort((a, b) => a.universe - b.universe || a.address - b.address)
                  .map((entry, i) => {
                    const def = fixtures.find(f => f.id === entry.fixtureDefId)
                    const mode = def?.modes.find(m => m.name === entry.modeName)
                    const entryGroups = groups.filter(g => entry.groupIds.includes(g.id))

                    return (
                      <tr key={entry.id} className="border-t border-surface-3 hover:bg-surface-2/50">
                        <td className="px-2 py-1 text-gray-600">{i + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            className="bg-transparent border-none outline-none text-gray-200 w-full"
                            value={entry.name}
                            onChange={(e) => updateFixture(entry.id, { name: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1 text-gray-400 text-xs">{def?.name || '?'}</td>
                        <td className="px-2 py-1">
                          <select
                            className="bg-transparent border-none outline-none text-gray-400 text-xs cursor-pointer hover:text-gray-200"
                            value={entry.modeName}
                            onChange={e => updateFixture(entry.id, { modeName: e.target.value })}
                          >
                            {def?.modes.map(m => (
                              <option key={m.name} value={m.name} className="bg-surface-2">{m.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1 font-mono">
                          <div className="flex items-center gap-0.5">
                            <select
                              className="bg-transparent border-none outline-none text-accent text-xs cursor-pointer w-8"
                              value={entry.universe}
                              onChange={e => updateFixture(entry.id, { universe: parseInt(e.target.value) })}
                            >
                              <option value={0} className="bg-surface-2">U1</option>
                              <option value={1} className="bg-surface-2">U2</option>
                              <option value={2} className="bg-surface-2">U3</option>
                            </select>
                            <span className="text-gray-600 text-xs">.</span>
                            <input
                              className="bg-transparent border-none outline-none text-accent font-mono text-xs w-10 hover:bg-surface-3 rounded px-0.5"
                              type="number"
                              min={1}
                              max={512}
                              value={entry.address}
                              onChange={e => {
                                const v = parseInt(e.target.value)
                                if (v >= 1 && v <= 512) updateFixture(entry.id, { address: v })
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1 text-gray-500 text-xs">{mode?.channelCount || '?'}</td>
                        <td className="px-2 py-1">
                          <div className="flex gap-0.5">
                            {entryGroups.map(g => (
                              <span key={g.id} className="px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: g.color + '33', color: g.color }}>
                                {g.name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <button className="text-red-400 hover:text-red-300" onClick={() => removeFixture(entry.id)}>
                            Del
                          </button>
                        </td>
                      </tr>
                    )
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Groups panel */}
      <div className="w-56 border-l border-surface-3 flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>Groups</span>
          <button
            className="text-accent text-[10px] hover:text-accent-light"
            onClick={() => {
              const name = prompt('Group name:')
              if (name) addGroup(name, `hsl(${Math.random() * 360}, 70%, 60%)`)
            }}
          >
            + Add
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {groups.length === 0 ? (
            <p className="text-[10px] text-gray-600 text-center py-4">No groups</p>
          ) : (
            groups.map(g => (
              <div key={g.id} className="flex items-center gap-2 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                <span className="text-xs flex-1">{g.name}</span>
                <span className="text-[10px] text-gray-500">{g.fixtureIds.length}</span>
                <button className="text-[10px] text-red-400 hover:text-red-300" onClick={() => removeGroup(g.id)}>x</button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add fixture modal */}
      {showAddModal && (
        <AddFixtureModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}

function AddFixtureModal({ onClose }: { onClose: () => void }) {
  const { fixtures, addFixture } = usePatchStore()
  const [selectedDef, setSelectedDef] = useState<string>('')
  const [selectedMode, setSelectedMode] = useState<string>('')
  const [universe, setUniverse] = useState(0)
  const [address, setAddress] = useState(1)
  const [name, setName] = useState('')
  const [count, setCount] = useState(1)
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const source = search
      ? (() => {
          const s = search.toLowerCase()
          return fixtures.filter(f =>
            f.name.toLowerCase().includes(s) ||
            f.manufacturer.toLowerCase().includes(s) ||
            f.categories.some(c => c.toLowerCase().includes(s))
          )
        })()
      : fixtures
    const map = new Map<string, typeof fixtures>()
    for (const f of source) {
      const mfr = f.manufacturer || 'Other'
      if (!map.has(mfr)) map.set(mfr, [])
      map.get(mfr)!.push(f)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [fixtures, search])

  const currentDef = fixtures.find(f => f.id === selectedDef)

  const handleAdd = () => {
    if (!selectedDef || !selectedMode || !name) return
    addFixture(selectedDef, selectedMode, universe, address, name, count)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-1 border border-surface-3 rounded-lg w-[600px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-surface-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Fixture</h2>
          <button className="text-gray-500 hover:text-gray-300" onClick={onClose}>x</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Fixture list */}
          <div className="w-1/2 border-r border-surface-3 flex flex-col">
            <div className="p-2">
              <input
                className="input w-full"
                placeholder="Search fixtures..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-auto">
              {grouped.map(([mfr, mFixtures]) => (
                <div key={mfr}>
                  <div className="px-3 py-1 text-[9px] text-gray-500 uppercase tracking-wide bg-surface-0 sticky top-0">
                    {mfr}
                  </div>
                  {mFixtures.map(f => (
                    <button
                      key={f.id}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 ${
                        selectedDef === f.id ? 'bg-surface-2 text-accent' : 'text-gray-300'
                      }`}
                      onClick={() => {
                        setSelectedDef(f.id)
                        setSelectedMode(f.modes[0]?.name || '')
                        if (!name) setName(f.name)
                      }}
                    >
                      <div className="font-medium">{f.name}</div>
                      <div className="text-[10px] text-gray-500">{f.categories.join(', ')}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Config */}
          <div className="w-1/2 p-4 space-y-3">
            {currentDef ? (
              <>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Mode</label>
                  <select
                    className="input w-full mt-0.5"
                    value={selectedMode}
                    onChange={e => setSelectedMode(e.target.value)}
                  >
                    {currentDef.modes.map(m => (
                      <option key={m.name} value={m.name}>{m.name} ({m.channelCount} ch)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Name</label>
                  <input className="input w-full mt-0.5" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-500 uppercase">Universe</label>
                    <select className="input w-full mt-0.5" value={universe} onChange={e => setUniverse(parseInt(e.target.value))}>
                      <option value={0}>1</option>
                      <option value={1}>2</option>
                      <option value={2}>3</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-500 uppercase">Address</label>
                    <input className="input w-full mt-0.5" type="number" min={1} max={512} value={address} onChange={e => setAddress(parseInt(e.target.value) || 1)} />
                  </div>
                  <div className="w-16">
                    <label className="text-[10px] text-gray-500 uppercase">Count</label>
                    <input className="input w-full mt-0.5" type="number" min={1} max={64} value={count} onChange={e => setCount(parseInt(e.target.value) || 1)} />
                  </div>
                </div>
                <div className="text-[10px] text-gray-500">
                  Channels: {currentDef.modes.find(m => m.name === selectedMode)?.channels.join(', ')}
                </div>
                <button className="btn-primary w-full mt-4" onClick={handleAdd}>
                  Add {count > 1 ? `${count} Fixtures` : 'Fixture'}
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">Select a fixture type</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
