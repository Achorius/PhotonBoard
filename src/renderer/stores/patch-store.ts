import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { PatchEntry, FixtureDefinition, Group } from '@shared/types'

interface PatchState {
  patch: PatchEntry[]
  fixtures: FixtureDefinition[]
  groups: Group[]
  selectedFixtureIds: string[]

  // Actions
  loadFixtures: () => Promise<void>
  addFixture: (fixtureDefId: string, modeName: string, universe: number, address: number, name: string, count?: number, groupId?: string) => void
  removeFixture: (id: string) => void
  updateFixture: (id: string, updates: Partial<PatchEntry>) => void
  selectFixture: (id: string, multi?: boolean) => void
  selectAll: () => void
  clearSelection: () => void
  getFixtureDef: (fixtureDefId: string) => FixtureDefinition | undefined
  getFixtureChannels: (patchEntry: PatchEntry) => { name: string; absoluteChannel: number; type: string }[]

  // Groups
  addGroup: (name: string, color: string, parentGroupId?: string) => void
  removeGroup: (id: string) => void
  addToGroup: (groupId: string, fixtureIds: string[]) => void
  removeFromGroup: (groupId: string, fixtureIds: string[]) => void
  moveToGroup: (fixtureIds: string[], fromGroupId: string, toGroupId: string) => void
  moveSubgroup: (subgroupId: string, newParentId: string | undefined) => void
  selectGroup: (groupId: string) => void

  // Import
  setPatch: (patch: PatchEntry[]) => void
  setGroups: (groups: Group[]) => void
  setFixtures: (fixtures: FixtureDefinition[]) => void
}

export const usePatchStore = create<PatchState>((set, get) => ({
  patch: [],
  fixtures: [],
  groups: [],
  selectedFixtureIds: [],

  loadFixtures: async () => {
    const fixtures = await window.photonboard.fixtures.getAll()
    set({ fixtures })
  },

  addFixture: (fixtureDefId, modeName, universe, address, name, count = 1, groupId?) => {
    const def = get().fixtures.find((f) => f.id === fixtureDefId)
    if (!def) return
    const mode = def.modes.find((m) => m.name === modeName)
    if (!mode) return

    const newEntries: PatchEntry[] = []
    for (let i = 0; i < count; i++) {
      const addr = address + i * mode.channelCount
      if (addr + mode.channelCount - 1 > 512) break
      newEntries.push({
        id: uuidv4(),
        fixtureDefId,
        modeName,
        universe,
        address: addr,
        name: count > 1 ? `${name} ${i + 1}` : name,
        groupIds: groupId ? [groupId] : []
      })
    }

    set((state) => {
      const newPatch = [...state.patch, ...newEntries]
      // Also update the group's fixtureIds if a group was specified
      const newGroups = groupId
        ? state.groups.map((g) =>
            g.id === groupId
              ? { ...g, fixtureIds: [...g.fixtureIds, ...newEntries.map((e) => e.id)] }
              : g
          )
        : state.groups
      return { patch: newPatch, groups: newGroups }
    })
  },

  removeFixture: (id) => {
    set((state) => ({
      patch: state.patch.filter((p) => p.id !== id),
      selectedFixtureIds: state.selectedFixtureIds.filter((sid) => sid !== id)
    }))
  },

  updateFixture: (id, updates) => {
    set((state) => ({
      patch: state.patch.map((p) => (p.id === id ? { ...p, ...updates } : p))
    }))
  },

  selectFixture: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const isSelected = state.selectedFixtureIds.includes(id)
        return {
          selectedFixtureIds: isSelected
            ? state.selectedFixtureIds.filter((sid) => sid !== id)
            : [...state.selectedFixtureIds, id]
        }
      }
      return { selectedFixtureIds: [id] }
    })
  },

  selectAll: () => {
    set((state) => ({ selectedFixtureIds: state.patch.map((p) => p.id) }))
  },

  clearSelection: () => {
    set({ selectedFixtureIds: [] })
  },

  getFixtureDef: (fixtureDefId) => {
    return get().fixtures.find((f) => f.id === fixtureDefId)
  },

  getFixtureChannels: (patchEntry) => {
    const def = get().fixtures.find((f) => f.id === patchEntry.fixtureDefId)
    if (!def) return []
    const mode = def.modes.find((m) => m.name === patchEntry.modeName)
    if (!mode) return []

    return mode.channels.map((chName, index) => ({
      name: chName,
      absoluteChannel: patchEntry.address - 1 + index, // 0-indexed DMX channel
      type: def.channels[chName]?.type || 'generic'
    }))
  },

  addGroup: (name, color, parentGroupId?) => {
    set((state) => ({
      groups: [...state.groups, { id: uuidv4(), name, color, fixtureIds: [], parentGroupId }]
    }))
  },

  removeGroup: (id) => {
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      patch: state.patch.map((p) => ({
        ...p,
        groupIds: p.groupIds.filter((gid) => gid !== id)
      }))
    }))
  },

  addToGroup: (groupId, fixtureIds) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId
          ? { ...g, fixtureIds: [...new Set([...g.fixtureIds, ...fixtureIds])] }
          : g
      ),
      patch: state.patch.map((p) =>
        fixtureIds.includes(p.id) && !p.groupIds.includes(groupId)
          ? { ...p, groupIds: [...p.groupIds, groupId] }
          : p
      )
    }))
  },

  removeFromGroup: (groupId, fixtureIds) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId
          ? { ...g, fixtureIds: g.fixtureIds.filter((fid) => !fixtureIds.includes(fid)) }
          : g
      ),
      patch: state.patch.map((p) =>
        fixtureIds.includes(p.id)
          ? { ...p, groupIds: p.groupIds.filter((gid) => gid !== groupId) }
          : p
      )
    }))
  },

  moveToGroup: (fixtureIds, fromGroupId, toGroupId) => {
    // Remove from old group and add to new group in one operation
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id === fromGroupId) {
          return { ...g, fixtureIds: g.fixtureIds.filter((fid) => !fixtureIds.includes(fid)) }
        }
        if (g.id === toGroupId) {
          return { ...g, fixtureIds: [...new Set([...g.fixtureIds, ...fixtureIds])] }
        }
        return g
      }),
      patch: state.patch.map((p) => {
        if (!fixtureIds.includes(p.id)) return p
        const gids = p.groupIds.filter((gid) => gid !== fromGroupId)
        if (!gids.includes(toGroupId)) gids.push(toGroupId)
        return { ...p, groupIds: gids }
      })
    }))
  },

  moveSubgroup: (subgroupId, newParentId) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === subgroupId ? { ...g, parentGroupId: newParentId } : g
      )
    }))
  },

  selectGroup: (groupId) => {
    const group = get().groups.find((g) => g.id === groupId)
    if (group) {
      set({ selectedFixtureIds: [...group.fixtureIds] })
    }
  },

  setPatch: (patch) => {
    console.log('[PhotonBoard] setPatch called with', patch.length, 'entries', new Error().stack?.split('\n')[2]?.trim())
    set({ patch })
  },
  setGroups: (groups) => set({ groups }),
  setFixtures: (fixtures) => set({ fixtures })
}))
