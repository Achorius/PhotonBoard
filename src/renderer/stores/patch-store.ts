import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { v4 as uuidv4 } from 'uuid'
import type { PatchEntry, FixtureDefinition, Group, PixelLayout } from '@shared/types'
import { footprintChanged, releaseFootprints } from '@renderer/lib/programmer-utils'
import { isRemoteMode } from '@renderer/lib/runtime'

/** A fixture to patch: everything but the id (generated) and groups (see addFixtures) */
export type NewPatchEntry = Omit<PatchEntry, 'id' | 'groupIds'> & { groupIds?: string[] }

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
  /** Patch several fixtures in one update (each with its own address / name). Returns the new ids. */
  addFixtures: (entries: NewPatchEntry[], groupId?: string) => string[]
  /** Remove several fixtures in one update (groups and selection follow) */
  removeFixtures: (ids: string[]) => void
  /** Apply per-fixture changes in one update (re-address, rename, mode change, group drags) */
  updateFixtures: (updates: Record<string, Partial<PatchEntry>>) => void
  selectFixture: (id: string, multi?: boolean) => void
  /** Replace the selection (range select, lasso…) */
  selectFixtures: (ids: string[]) => void
  selectAll: () => void
  clearSelection: () => void
  getFixtureDef: (fixtureDefId: string) => FixtureDefinition | undefined
  getFixtureChannels: (patchEntry: PatchEntry) => { name: string; absoluteChannel: number; type: string }[]
  getFixturePixelLayout: (patchEntry: PatchEntry) => PixelLayout | undefined

  // Groups
  addGroup: (name: string, color: string, parentGroupId?: string) => void
  removeGroup: (id: string) => void
  /** Rename / recolour a group */
  updateGroup: (id: string, updates: Partial<Pick<Group, 'name' | 'color'>>) => void
  addToGroup: (groupId: string, fixtureIds: string[]) => void
  removeFromGroup: (groupId: string, fixtureIds: string[]) => void
  moveToGroup: (fixtureIds: string[], fromGroupId: string, toGroupId: string) => void
  moveSubgroup: (subgroupId: string, newParentId: string | undefined) => void
  selectGroup: (groupId: string) => void

  /**
   * @deprecated Pan/tilt centring (and every other channel default) is now
   * produced by the mixer from the fixture definitions; kept as a no-op.
   */
  initMovingHeadDefaults: () => void

  // Import
  setPatch: (patch: PatchEntry[]) => void
  setGroups: (groups: Group[]) => void
  setFixtures: (fixtures: FixtureDefinition[]) => void
}

/**
 * Programmer values are stored by absolute DMX address: when fixtures are
 * deleted or moved (address, universe, fixture type or mode), release the
 * values at their OLD footprint so they never drive what is patched there
 * next. Console only (a remote browser's programmer lives on the console).
 */
function releaseOldFootprints(state: { fixtures: FixtureDefinition[] }, entries: PatchEntry[]): void {
  if (entries.length === 0 || isRemoteMode()) return
  try {
    releaseFootprints(entries, state.fixtures)
  } catch (e) {
    console.error('[Patch] releasing programmer values failed:', e)
  }
}

export const usePatchStore = create<PatchState>()(subscribeWithSelector((set, get) => ({
  patch: [],
  fixtures: [],
  groups: [],
  selectedFixtureIds: [],

  loadFixtures: async () => {
    const fixtures = await window.photonboard.fixtures.getAll()
    if (Array.isArray(fixtures)) set({ fixtures })
  },

  addFixture: (fixtureDefId, modeName, universe, address, name, count = 1, groupId?) => {
    const def = get().fixtures.find((f) => f.id === fixtureDefId)
    if (!def) { console.error('[PhotonBoard] addFixture: fixture def not found:', fixtureDefId); return }
    const mode = def.modes.find((m) => m.name === modeName)
    if (!mode) { console.error('[PhotonBoard] addFixture: mode not found:', modeName, 'available:', def.modes.map(m => m.name)); return }

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
    // No DMX writes here: the mixer outputs every channel's default
    // (pan/tilt centred) as soon as the patch changes.
  },

  removeFixture: (id) => {
    releaseOldFootprints(get(), get().patch.filter((p) => p.id === id))
    set((state) => ({
      patch: state.patch.filter((p) => p.id !== id),
      groups: state.groups.some((g) => g.fixtureIds.includes(id))
        ? state.groups.map((g) => (g.fixtureIds.includes(id) ? { ...g, fixtureIds: g.fixtureIds.filter((f) => f !== id) } : g))
        : state.groups,
      selectedFixtureIds: state.selectedFixtureIds.filter((sid) => sid !== id)
    }))
  },

  updateFixture: (id, updates) => {
    releaseOldFootprints(get(), get().patch.filter((p) => p.id === id && footprintChanged(p, updates)))
    set((state) => ({
      patch: state.patch.map((p) => (p.id === id ? { ...p, ...updates } : p))
    }))
  },

  addFixtures: (entries, groupId) => {
    const fixtures = get().fixtures
    const created: PatchEntry[] = []
    for (const e of entries) {
      const def = fixtures.find((f) => f.id === e.fixtureDefId)
      if (!def || !def.modes.some((m) => m.name === e.modeName)) {
        console.error('[PhotonBoard] addFixtures: unknown fixture or mode:', e.fixtureDefId, e.modeName)
        continue
      }
      const groupIds = [...new Set([...(e.groupIds ?? []), ...(groupId ? [groupId] : [])])]
      created.push({ ...e, id: uuidv4(), groupIds })
    }
    if (created.length === 0) return []
    set((state) => ({
      patch: [...state.patch, ...created],
      groups: state.groups.some((g) => created.some((c) => c.groupIds.includes(g.id)))
        ? state.groups.map((g) => {
            const add = created.filter((c) => c.groupIds.includes(g.id)).map((c) => c.id)
            return add.length > 0 ? { ...g, fixtureIds: [...new Set([...g.fixtureIds, ...add])] } : g
          })
        : state.groups
    }))
    return created.map((c) => c.id)
  },

  removeFixtures: (ids) => {
    if (ids.length === 0) return
    const gone = new Set(ids)
    releaseOldFootprints(get(), get().patch.filter((p) => gone.has(p.id)))
    set((state) => ({
      patch: state.patch.filter((p) => !gone.has(p.id)),
      groups: state.groups.some((g) => g.fixtureIds.some((f) => gone.has(f)))
        ? state.groups.map((g) => (g.fixtureIds.some((f) => gone.has(f)) ? { ...g, fixtureIds: g.fixtureIds.filter((f) => !gone.has(f)) } : g))
        : state.groups,
      selectedFixtureIds: state.selectedFixtureIds.some((sid) => gone.has(sid))
        ? state.selectedFixtureIds.filter((sid) => !gone.has(sid))
        : state.selectedFixtureIds
    }))
  },

  updateFixtures: (updates) => {
    if (Object.keys(updates).length === 0) return
    releaseOldFootprints(get(), get().patch.filter((p) => updates[p.id] && footprintChanged(p, updates[p.id])))
    set((state) => ({
      patch: state.patch.map((p) => (updates[p.id] ? { ...p, ...updates[p.id] } : p))
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

  selectFixtures: (ids) => {
    set({ selectedFixtureIds: [...new Set(ids)] })
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

  getFixturePixelLayout: (patchEntry) => {
    const def = get().fixtures.find((f) => f.id === patchEntry.fixtureDefId)
    if (!def) return undefined
    const mode = def.modes.find((m) => m.name === patchEntry.modeName)
    return mode?.pixelLayout
  },

  addGroup: (name, color, parentGroupId?) => {
    set((state) => ({
      groups: [...state.groups, { id: uuidv4(), name, color, fixtureIds: [], parentGroupId }]
    }))
  },

  removeGroup: (id) => {
    set((state) => ({
      // Sub-groups move up to the removed group's parent (instead of becoming unreachable orphans)
      groups: state.groups
        .filter((g) => g.id !== id)
        .map((g) => (g.parentGroupId === id ? { ...g, parentGroupId: state.groups.find((x) => x.id === id)?.parentGroupId } : g)),
      patch: state.patch.map((p) => ({
        ...p,
        groupIds: p.groupIds.filter((gid) => gid !== id)
      }))
    }))
  },

  updateGroup: (id, updates) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, ...updates } : g))
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
    if (group && group.fixtureIds.length > 0) {
      set({ selectedFixtureIds: [...group.fixtureIds] })
    }
  },

  initMovingHeadDefaults: () => {},

  setPatch: (patch) => {
    set({ patch })
  },
  setGroups: (groups) => set({ groups }),
  setFixtures: (fixtures) => set({ fixtures })
})))

// ---- Selector hooks ----

/** Selected fixture ids (re-renders only when the selection changes). */
export function useSelectedFixtureIds(): string[] {
  return usePatchStore((s) => s.selectedFixtureIds)
}

/** Patch + library + groups, without re-rendering on selection changes. */
export function usePatchData() {
  return usePatchStore(useShallow((s) => ({ patch: s.patch, fixtures: s.fixtures, groups: s.groups })))
}
