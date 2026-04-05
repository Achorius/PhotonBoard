import React, { useState, useMemo } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { formatDmxAddress } from '../../lib/dmx-utils'

export function PatchView() {
  const { patch, fixtures, groups, addFixture, removeFixture, updateFixture, addGroup, removeGroup, addToGroup, removeFromGroup, moveToGroup, moveSubgroup, selectedFixtureIds } = usePatchStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [showGroupInput, setShowGroupInput] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full">
      {/* Patch table */}
      <div className="flex-1 flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>DMX Patch</span>
          <div className="flex gap-1">
            <button
              className="btn-secondary text-[10px] py-0.5"
              onClick={async () => {
                const results = await window.photonboard.fixtures.import()
                if (results) {
                  const { loadFixtures } = usePatchStore.getState()
                  loadFixtures()
                }
              }}
              title="Import fixture from OFL JSON file"
            >
              Import Fixture
            </button>
            <button className="btn-primary text-[10px] py-0.5" onClick={() => setShowAddModal(true)}>
              + Add Fixture
            </button>
          </div>
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
                      <tr
                        key={entry.id}
                        className="border-t border-surface-3 hover:bg-surface-2/50 cursor-grab"
                        draggable
                        onDragStart={e => {
                          const ids = selectedFixtureIds.includes(entry.id)
                            ? selectedFixtureIds
                            : [entry.id]
                          e.dataTransfer.setData('fixture-ids', JSON.stringify(ids))
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                      >
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
            onClick={() => { setShowGroupInput(''); setNewGroupName('') }}
          >
            + Add
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {showGroupInput === '' && (
            <div className="flex items-center gap-1 mb-1">
              <input
                className="input flex-1 text-xs py-0.5"
                placeholder="Group name..."
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newGroupName.trim()) {
                    addGroup(newGroupName.trim(), `hsl(${Math.random() * 360}, 70%, 60%)`)
                    setShowGroupInput(null); setNewGroupName('')
                  }
                  if (e.key === 'Escape') setShowGroupInput(null)
                }}
                autoFocus
              />
              <button className="text-[10px] text-green-400" onClick={() => {
                if (newGroupName.trim()) {
                  addGroup(newGroupName.trim(), `hsl(${Math.random() * 360}, 70%, 60%)`)
                  setShowGroupInput(null); setNewGroupName('')
                }
              }}>OK</button>
            </div>
          )}
          {groups.length === 0 && showGroupInput === null ? (
            <p className="text-[10px] text-gray-600 text-center py-4">No groups</p>
          ) : (
            <GroupTree
              groups={groups}
              parentId={undefined}
              depth={0}
              selectedFixtureIds={selectedFixtureIds}
              patch={patch}
              showGroupInput={showGroupInput}
              newGroupName={newGroupName}
              setNewGroupName={setNewGroupName}
              setShowGroupInput={setShowGroupInput}
              addGroup={addGroup}
              removeGroup={removeGroup}
              addToGroup={addToGroup}
              removeFromGroup={removeFromGroup}
              moveToGroup={moveToGroup}
              moveSubgroup={moveSubgroup}
              expandedGroups={expandedGroups}
              toggleExpanded={toggleExpanded}
            />
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

function GroupTree({
  groups, parentId, depth, selectedFixtureIds, patch,
  showGroupInput, newGroupName, setNewGroupName, setShowGroupInput,
  addGroup, removeGroup, addToGroup, removeFromGroup, moveToGroup, moveSubgroup,
  expandedGroups, toggleExpanded
}: {
  groups: any[]; parentId: string | undefined; depth: number
  selectedFixtureIds: string[]; patch: any[]
  showGroupInput: string | null; newGroupName: string
  setNewGroupName: (v: string) => void; setShowGroupInput: (v: string | null) => void
  addGroup: (name: string, color: string, parentGroupId?: string) => void
  removeGroup: (id: string) => void
  addToGroup: (groupId: string, fixtureIds: string[]) => void
  removeFromGroup: (groupId: string, fixtureIds: string[]) => void
  moveToGroup: (fixtureIds: string[], fromGroupId: string, toGroupId: string) => void
  moveSubgroup: (subgroupId: string, newParentId: string | undefined) => void
  expandedGroups: Set<string>; toggleExpanded: (id: string) => void
}) {
  const children = groups.filter(g => g.parentGroupId === parentId)
  return (
    <>
      {children.map(g => {
        const isExpanded = expandedGroups.has(g.id)
        const fixturesInGroup = patch.filter((p: any) => g.fixtureIds.includes(p.id))
        return (
          <div key={g.id} style={{ marginLeft: depth * 12 }}>
            <div
              className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 group/item cursor-pointer"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('subgroup-id', g.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={e => {
                e.preventDefault()
                e.currentTarget.classList.add('ring-1', 'ring-accent')
              }}
              onDragLeave={e => { e.currentTarget.classList.remove('ring-1', 'ring-accent') }}
              onDrop={e => {
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.classList.remove('ring-1', 'ring-accent')
                // Handle subgroup drop
                const subgroupId = e.dataTransfer.getData('subgroup-id')
                if (subgroupId && subgroupId !== g.id) {
                  moveSubgroup(subgroupId, g.id)
                  return
                }
                // Handle fixture drop — check if it's a move from another group
                try {
                  const fromGroupId = e.dataTransfer.getData('from-group-id')
                  const ids = JSON.parse(e.dataTransfer.getData('fixture-ids'))
                  if (Array.isArray(ids)) {
                    if (fromGroupId && fromGroupId !== g.id) {
                      moveToGroup(ids, fromGroupId, g.id)
                    } else {
                      addToGroup(g.id, ids)
                    }
                  }
                } catch {}
              }}
              onClick={() => toggleExpanded(g.id)}
            >
              <span className="text-[10px] text-gray-500 w-3">{isExpanded ? '▾' : '▸'}</span>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
              <span className="text-xs flex-1 truncate">{g.name}</span>
              <span className="text-[10px] text-gray-500">{g.fixtureIds.length}</span>
              <button
                className="text-[10px] text-gray-500 hover:text-gray-300 opacity-0 group-hover/item:opacity-100"
                title="Add sub-group"
                onClick={(e) => { e.stopPropagation(); setShowGroupInput(g.id); setNewGroupName('') }}
              >+sub</button>
              <button
                className="text-[10px] text-red-400 hover:text-red-300 opacity-0 group-hover/item:opacity-100"
                onClick={(e) => { e.stopPropagation(); removeGroup(g.id) }}
              >x</button>
            </div>

            {/* Fixtures inside group (when expanded) */}
            {isExpanded && fixturesInGroup.length > 0 && (
              <div className="ml-5 mt-0.5 space-y-0.5">
                {fixturesInGroup.map((f: any) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-gray-400 hover:bg-surface-3 group/fix"
                    draggable
                    onDragStart={e => {
                      const ids = selectedFixtureIds.includes(f.id) ? selectedFixtureIds : [f.id]
                      e.dataTransfer.setData('fixture-ids', JSON.stringify(ids))
                      e.dataTransfer.setData('from-group-id', g.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  >
                    <span className="flex-1 truncate">{f.name}</span>
                    <button
                      className="text-red-400 hover:text-red-300 opacity-0 group-hover/fix:opacity-100"
                      title="Remove from group"
                      onClick={() => removeFromGroup(g.id, [f.id])}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {showGroupInput === g.id && (
              <div className="flex items-center gap-1 mt-1" style={{ marginLeft: 12 }}>
                <input
                  className="input flex-1 text-xs py-0.5"
                  placeholder="Sub-group name..."
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newGroupName.trim()) {
                      addGroup(newGroupName.trim(), g.color, g.id)
                      setShowGroupInput(null); setNewGroupName('')
                    }
                    if (e.key === 'Escape') setShowGroupInput(null)
                  }}
                  autoFocus
                />
                <button className="text-[10px] text-green-400" onClick={() => {
                  if (newGroupName.trim()) {
                    addGroup(newGroupName.trim(), g.color, g.id)
                    setShowGroupInput(null); setNewGroupName('')
                  }
                }}>OK</button>
              </div>
            )}
            <GroupTree
              groups={groups} parentId={g.id} depth={depth + 1}
              selectedFixtureIds={selectedFixtureIds} patch={patch}
              showGroupInput={showGroupInput} newGroupName={newGroupName}
              setNewGroupName={setNewGroupName} setShowGroupInput={setShowGroupInput}
              addGroup={addGroup} removeGroup={removeGroup} addToGroup={addToGroup}
              removeFromGroup={removeFromGroup} moveToGroup={moveToGroup} moveSubgroup={moveSubgroup}
              expandedGroups={expandedGroups} toggleExpanded={toggleExpanded}
            />
          </div>
        )
      })}
    </>
  )
}

function AddFixtureModal({ onClose }: { onClose: () => void }) {
  const { fixtures, patch, groups, addFixture } = usePatchStore()
  const [selectedDef, setSelectedDef] = useState<string>('')
  const [selectedMode, setSelectedMode] = useState<string>('')
  const [universe, setUniverse] = useState(0)
  const [address, setAddress] = useState(1)
  const [addressManuallySet, setAddressManuallySet] = useState(false)
  const [name, setName] = useState('')
  const [count, setCount] = useState(1)
  const [search, setSearch] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')

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

  // Auto-compute first free address when fixture/universe/mode changes
  const firstFreeAddress = useMemo(() => {
    const mode = currentDef?.modes.find(m => m.name === selectedMode)
    const channelCount = mode?.channelCount || 1
    const occupied = new Set<number>()
    for (const entry of patch) {
      if (entry.universe !== universe) continue
      const def = fixtures.find(f => f.id === entry.fixtureDefId)
      const m = def?.modes.find(m => m.name === entry.modeName)
      const cnt = m?.channelCount || 1
      for (let i = 0; i < cnt; i++) occupied.add(entry.address - 1 + i)
    }
    for (let addr = 1; addr <= 512 - channelCount + 1; addr++) {
      let fits = true
      for (let i = 0; i < channelCount; i++) {
        if (occupied.has(addr - 1 + i)) { fits = false; break }
      }
      if (fits) return addr
    }
    return 1
  }, [currentDef, selectedMode, universe, patch, fixtures])

  // Apply auto-address unless user manually typed an address
  React.useEffect(() => {
    if (!addressManuallySet) setAddress(firstFreeAddress)
  }, [firstFreeAddress, addressManuallySet])

  // Build flat list of groups with hierarchy labels for the dropdown
  const groupOptions = useMemo(() => {
    const result: { id: string; label: string }[] = []
    const buildTree = (parentId: string | undefined, prefix: string) => {
      const children = groups.filter(g => g.parentGroupId === parentId)
      for (const g of children) {
        result.push({ id: g.id, label: prefix + g.name })
        buildTree(g.id, prefix + '  ')
      }
    }
    buildTree(undefined, '')
    return result
  }, [groups])

  const handleAdd = () => {
    if (!selectedDef || !selectedMode || !name) return
    addFixture(selectedDef, selectedMode, universe, address, name, count, selectedGroupId || undefined)
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
                    <input className="input w-full mt-0.5" type="number" min={1} max={512} value={address} onChange={e => { setAddressManuallySet(true); setAddress(parseInt(e.target.value) || 1) }} />
                  </div>
                  <div className="w-16">
                    <label className="text-[10px] text-gray-500 uppercase">Count</label>
                    <input className="input w-full mt-0.5" type="number" min={1} max={64} value={count} onChange={e => setCount(parseInt(e.target.value) || 1)} />
                  </div>
                </div>
                {groupOptions.length > 0 && (
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase">Group</label>
                    <select
                      className="input w-full mt-0.5"
                      value={selectedGroupId}
                      onChange={e => setSelectedGroupId(e.target.value)}
                    >
                      <option value="">— No group —</option>
                      {groupOptions.map(g => (
                        <option key={g.id} value={g.id}>{g.label}</option>
                      ))}
                    </select>
                  </div>
                )}
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
