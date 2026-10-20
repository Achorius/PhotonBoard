// ============================================================
// Rigging actions shared by the inspector, the plan's context menu and
// the 3D view: hang fixtures on a bar, change mount, flip, reset.
// ============================================================

import type { MountingLocation, PatchEntry, Position3D, TrussBar } from '@shared/types'
import { t, formatDecimal, type TFunction, type TranslationKey } from '@renderer/i18n'
import { formatShortcut } from '@renderer/components/ui/Kbd'
import { deleteWithUndo, type ConfirmDeleteOptions } from '@renderer/lib/selection-actions'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { cm, defaultHeight, distributeOnBar, fixturePosition, hangHeight } from '../scene/layout-math'

const MOUNTS: Array<{ value: MountingLocation; key: TranslationKey }> = [
  { value: 'ceiling', key: 'layout.mounts.ceiling' },
  { value: 'floor', key: 'layout.mounts.floor' },
  { value: 'wall-left', key: 'layout.mounts.wallLeft' },
  { value: 'wall-right', key: 'layout.mounts.wallRight' },
  { value: 'wall-back', key: 'layout.mounts.wallBack' }
]

/** Mount choices in the current language (build inside the component: depends on `t`) */
export function mountOptions(tr: TFunction = t): Array<{ value: MountingLocation; label: string }> {
  return MOUNTS.map((m) => ({ value: m.value, label: tr(m.key) }))
}

/** A length in metres for the UI: (2.5, 2) → "2.50 m" / "2,50 m" */
export function formatMetres(value: number, decimals = 2, tr: TFunction = t): string {
  return tr('layout.metres', { value: formatDecimal(value, decimals, tr.locale) })
}

/** Effective position of a fixture (explicit, or where auto-layout puts it) */
export function currentPosition(entry: PatchEntry): Position3D {
  const patch = usePatchStore.getState().patch
  const room = useVisualizerStore.getState().roomConfig
  const index = patch.findIndex((p) => p.id === entry.id)
  return fixturePosition(entry, Math.max(0, index), patch.length, room)
}

export function setPosition(entry: PatchEntry, patch: Partial<Position3D>): void {
  const pos = currentPosition(entry)
  usePatchStore.getState().updateFixture(entry.id, {
    position3D: { x: cm(patch.x ?? pos.x), y: cm(patch.y ?? pos.y), z: cm(patch.z ?? pos.z) }
  })
}

function entriesFor(ids: string[]): PatchEntry[] {
  const set = new Set(ids)
  return usePatchStore.getState().patch.filter((p) => set.has(p.id))
}

/**
 * Hang fixtures on a bar. Several fixtures are spread evenly across the bar
 * (keeping their left-to-right order); a single fixture keeps its X.
 */
export function hangOnBar(ids: string[], bar: TrussBar): void {
  const entries = entriesFor(ids)
  if (entries.length === 0) return
  const store = usePatchStore.getState()
  const y = cm(hangHeight(bar))
  if (entries.length === 1) {
    const pos = currentPosition(entries[0])
    const half = bar.width / 2
    store.updateFixture(entries[0].id, {
      mountingLocation: undefined,
      position3D: { x: cm(Math.max(-half, Math.min(half, pos.x))), y, z: cm(bar.z) }
    })
    return
  }
  const sorted = entries.map((e) => ({ e, x: currentPosition(e).x })).sort((a, b) => a.x - b.x)
  const xs = distributeOnBar(bar, sorted.length)
  sorted.forEach(({ e }, i) => {
    store.updateFixture(e.id, { mountingLocation: undefined, position3D: { x: cm(xs[i]), y, z: cm(bar.z) } })
  })
}

export function setMount(ids: string[], mount: MountingLocation): void {
  const room = useVisualizerStore.getState().roomConfig
  const store = usePatchStore.getState()
  for (const e of entriesFor(ids)) {
    const pos = currentPosition(e)
    const next: Position3D = { x: pos.x, y: defaultHeight(mount, room.height), z: pos.z }
    if (mount === 'wall-left') next.x = -room.width / 2 + 0.1
    else if (mount === 'wall-right') next.x = room.width / 2 - 0.1
    else if (mount === 'wall-back') next.z = room.depth / 2 - 0.1
    store.updateFixture(e.id, {
      mountingLocation: mount === 'ceiling' ? undefined : mount,
      position3D: { x: cm(next.x), y: cm(next.y), z: cm(next.z) }
    })
  }
}

export function flipFixtures(ids: string[]): void {
  const store = usePatchStore.getState()
  for (const e of entriesFor(ids)) {
    const pan = e.mountingPan ?? 0
    let next = pan + 180
    if (next > 180) next -= 360
    store.updateFixture(e.id, { mountingPan: next })
  }
}

/** Selection label for "Delete …?" / "Deleted: …": what Delete removes in the plan / 3D is the placement */
export function placementLabel(entries: PatchEntry[]): string {
  return entries.length === 1
    ? t('layout.selection.placementOne', { name: entries[0].name })
    : t('layout.selection.placementMany', { count: entries.length })
}

/** Confirm dialog of a placement reset (Delete key, inspector button, context menu) */
export function resetPlacementConfirm(entries: PatchEntry[]): ConfirmDeleteOptions {
  return {
    title: entries.length === 1
      ? t('layout.actions.resetTitleOne', { name: entries[0].name })
      : t('layout.actions.resetTitleMany', { count: entries.length }),
    message: t('layout.actions.resetMessage', { count: entries.length }),
    confirmLabel: t('layout.actions.resetPlacement')
  }
}

/** Back to the automatic layout (synchronous; no confirm) */
export function clearPlacement(ids: string[]): void {
  const store = usePatchStore.getState()
  for (const e of entriesFor(ids)) {
    store.updateFixture(e.id, { position3D: undefined, rotation3D: undefined, mountingAngle: undefined, mountingPan: undefined, mountingLocation: undefined })
  }
}

/**
 * Reset placement (confirm, one undo step, Undo toast). The fixtures stay
 * patched: deleting a fixture is a Patch operation, never a plan one.
 */
export async function resetPlacement(ids: string[]): Promise<void> {
  const entries = entriesFor(ids)
  if (entries.length === 0) return
  const targetIds = entries.map((e) => e.id)
  await deleteWithUndo({ label: placementLabel(entries), run: () => clearPlacement(targetIds), confirm: resetPlacementConfirm(entries) })
}

/** Fixtures hanging on a bar */
export function fixturesOnBar(bar: TrussBar, patch: PatchEntry[]): PatchEntry[] {
  const room = useVisualizerStore.getState().roomConfig
  return patch.filter((p, i) => {
    if (p.mountingLocation && p.mountingLocation !== 'ceiling') return false
    const pos = fixturePosition(p, i, patch.length, room)
    return Math.abs(pos.z - bar.z) < 0.08 && bar.y - pos.y > -0.1 && bar.y - pos.y < 0.9
  })
}

/** Selection label of a truss bar: en 'truss bar “Bar 1”', fr 'le pont « Bar 1 »' */
export function barLabel(bar: TrussBar): string {
  return t('layout.selection.bar', { name: bar.name })
}

/** Confirm dialog of a bar deletion */
export function deleteBarConfirm(): ConfirmDeleteOptions {
  return { message: t('layout.bar.deleteMessage', { keys: formatShortcut('Mod+Z') }), confirmLabel: t('layout.bar.delete') }
}

/** Delete a truss bar (confirm, one undo step, Undo toast). Fixtures hung on it stay where they are. */
export async function deleteBar(bar: TrussBar): Promise<void> {
  await deleteWithUndo({ label: barLabel(bar), run: () => useVisualizerStore.getState().removeTrussBar(bar.id), confirm: deleteBarConfirm() })
}

/** Copy of a bar just upstage of it (selected). Synchronous: one undo step via duplicateSelection / historyStep. */
export function duplicateBar(bar: TrussBar): void {
  const room = useVisualizerStore.getState().roomConfig
  const z = bar.z + 0.5 <= room.depth / 2 ? bar.z + 0.5 : bar.z - 0.5
  useVisualizerStore.getState().addTrussBar({
    name: t('layout.bar.copyName', { name: bar.name }), z: cm(z), y: bar.y, width: bar.width, color: bar.color
  })
}
