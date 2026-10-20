// ============================================================
// Shared derived data and actions for the Patch view.
// ============================================================

import { useCallback, useMemo, useRef } from 'react'
import type { FixtureDefinition, Group, PatchEntry } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { isRemoteMode } from '@renderer/lib/runtime'
import { SWATCH_COLORS, toast } from '@renderer/components/ui'
import { t } from '@renderer/i18n'
import { findConflicts, footprints, planFixtures, nextName, type ConflictInfo, type Footprint } from './patch-utils'

export function useFixtureDefs(): Map<string, FixtureDefinition> {
  const fixtures = usePatchStore((s) => s.fixtures)
  return useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
}

export interface PatchAnalysis {
  patch: PatchEntry[]
  defs: Map<string, FixtureDefinition>
  items: Footprint[]
  byId: Map<string, Footprint>
  conflicts: Map<string, ConflictInfo>
  /** Fixture number (1-based position in the patch, as in the sidebar) */
  numbers: Map<string, number>
  universes: number[]
}

/** Patch + footprints + conflicts (recomputed only when the patch or library changes) */
export function usePatchAnalysis(): PatchAnalysis {
  const patch = usePatchStore((s) => s.patch)
  const defs = useFixtureDefs()
  return useMemo(() => {
    const items = footprints(patch, defs)
    return {
      patch,
      defs,
      items,
      byId: new Map(items.map((f) => [f.id, f])),
      conflicts: findConflicts(items),
      numbers: new Map(patch.map((p, i) => [p.id, i + 1])),
      universes: [...new Set(patch.map((p) => p.universe))].sort((a, b) => a - b)
    }
  }, [patch, defs])
}

/** Groups per fixture id (chips in tables) — recomputed when groups change */
export function useGroupsByFixture(): Map<string, Group[]> {
  const groups = usePatchStore((s) => s.groups)
  return useMemo(() => {
    const map = new Map<string, Group[]>()
    for (const g of groups) {
      for (const id of g.fixtureIds) {
        const list = map.get(id)
        if (list) list.push(g)
        else map.set(id, [g])
      }
    }
    return map
  }, [groups])
}

export function useIsTouch(): boolean {
  return useUiStore((s) => s.density === 'touch')
}

type Modifiers = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

/**
 * Row selection with the console conventions (same as the fixture sidebar):
 * click = select · Ctrl/Cmd = add/remove · Shift = range · touch: a tap adds/removes.
 */
export function useRowSelection(orderedIds: string[]) {
  const touch = useIsTouch()
  const anchor = useRef<string | null>(null)
  const order = useRef(orderedIds)
  order.current = orderedIds
  return useCallback((id: string, e: Modifiers) => {
    const store = usePatchStore.getState()
    if (e.shiftKey && anchor.current) {
      const ids = order.current
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        store.selectFixtures(e.metaKey || e.ctrlKey ? [...store.selectedFixtureIds, ...range] : range)
        return
      }
    }
    anchor.current = id
    store.selectFixture(id, touch || e.metaKey || e.ctrlKey)
  }, [touch])
}

export function nextGroupColor(groups: readonly Group[]): string {
  const used = new Set(groups.map((g) => g.color.toLowerCase()))
  return SWATCH_COLORS.find((c) => !used.has(c.toLowerCase())) ?? SWATCH_COLORS[groups.length % SWATCH_COLORS.length]
}

export const canImportFiles = () => !isRemoteMode()

/** File dialog → import GDTF / QXF / OFL JSON / … into the user library. Returns imported ids. */
export async function importFixtureFiles(): Promise<string[]> {
  let results
  try {
    results = await window.photonboard.fixtures.import()
  } catch (e) {
    toast.error(t('patch.hooks.importFailed'), { description: (e as Error).message })
    return []
  }
  if (!results || results.length === 0) return []
  const ok = results.filter((r) => r.success && r.fixture)
  const failed = results.filter((r) => !r.success)
  await usePatchStore.getState().loadFixtures()
  if (ok.length > 0) {
    toast.success(ok.length === 1 ? t('patch.hooks.importedOne', { name: ok[0].fixture!.name }) : t('patch.hooks.importedMany', { count: ok.length }), {
      description: ok.length > 1
        ? ok.map((r) => r.fixture!.name).join(', ')
        : `${ok[0].fixture!.manufacturer} · ${t('patch.shared.modeCount', { count: ok[0].fixture!.modes.length })}`
    })
  }
  if (failed.length > 0) {
    toast.error(t('patch.hooks.importFailedFiles', { count: failed.length }), {
      description: failed.map((r) => r.error ?? t('patch.hooks.unknownFormat')).join(' · ')
    })
  }
  return ok.map((r) => r.fixture!.id)
}

/**
 * Duplicate fixtures: same type / mode / groups, next free name and the next
 * free address after the original (continuing on the next universe if full).
 */
export function duplicateFixtures(ids: string[]): string[] {
  const store = usePatchStore.getState()
  const defs = new Map(store.fixtures.map((f) => [f.id, f]))
  const items = footprints(store.patch, defs)
  const names = new Set(store.patch.map((p) => p.name))
  const placed: Footprint[] = [...items]
  const created: Parameters<typeof store.addFixtures>[0] = []
  for (const id of ids) {
    const src = store.patch.find((p) => p.id === id)
    const fp = items.find((f) => f.id === id)
    if (!src || !fp) continue
    const [plan] = planFixtures(placed, {
      count: 1, channels: fp.count, universe: src.universe, address: src.address + fp.count, gap: 0,
      avoidConflicts: true, namePattern: nextName(src.name, names), startNumber: 1
    })
    if (!plan || plan.overflow) continue
    names.add(plan.name)
    placed.push({ id: `__dup${created.length}`, universe: plan.universe, address: plan.address, count: fp.count })
    const { id: _id, groupIds, position3D, ...rest } = src
    created.push({
      ...rest,
      groupIds: [...groupIds],
      name: plan.name,
      universe: plan.universe,
      address: plan.address,
      // Next to the original in the 3D / layout views (unplaced fixtures keep the auto layout)
      position3D: position3D ? { ...position3D, x: position3D.x + 0.5 } : undefined
    })
  }
  const newIds = store.addFixtures(created)
  if (newIds.length > 0) store.selectFixtures(newIds)
  if (newIds.length < ids.length) toast.warning(t('patch.hooks.notDuplicated', { count: ids.length - newIds.length }), { description: t('patch.hooks.noFreeAddresses') })
  else toast.success(newIds.length === 1 ? t('patch.hooks.duplicatedAs', { name: created[0].name }) : t('patch.hooks.duplicatedMany', { count: newIds.length }))
  return newIds
}
