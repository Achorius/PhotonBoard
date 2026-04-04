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
  addFixture: (fixtureDefId: string, modeName: string, universe: number, address: number, name: string, count?: number) => void
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

  addFixture: (fixtureDefId, modeName, universe, address, name, count = 1) => {
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
        groupIds: []
      })
    }

    set((state) => ({ patch: [...state.patch, ...newEntries] }))
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

  setPatch: (patch) => set({ patch }),
  setGroups: (groups) => set({ groups }),
  setFixtures: (fixtures) => set({ fixtures })
}))
