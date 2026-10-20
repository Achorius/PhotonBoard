// ============================================================
// Rigging actions shared by the inspector, the plan's context menu and
// the 3D view: hang fixtures on a bar, change mount, flip, reset.
// ============================================================

import type { MountingLocation, PatchEntry, Position3D, TrussBar } from '@shared/types'
import { confirm } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { cm, defaultHeight, distributeOnBar, fixturePosition, hangHeight } from '../scene/layout-math'

export const MOUNT_OPTIONS: Array<{ value: MountingLocation; label: string }> = [
  { value: 'ceiling', label: 'Ceiling / truss' },
  { value: 'floor', label: 'Floor' },
  { value: 'wall-left', label: 'Wall left' },
  { value: 'wall-right', label: 'Wall right' },
  { value: 'wall-back', label: 'Back wall' }
]

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

export async function resetPlacement(ids: string[]): Promise<void> {
  const entries = entriesFor(ids)
  if (entries.length === 0) return
  const ok = await confirm({
    title: entries.length === 1 ? `Reset “${entries[0].name}” placement?` : `Reset placement of ${entries.length} fixtures?`,
    message: 'Position, mount and aim go back to the automatic layout.',
    confirmLabel: 'Reset placement',
    tone: 'danger'
  })
  if (!ok) return
  const store = usePatchStore.getState()
  for (const e of entries) {
    store.updateFixture(e.id, { position3D: undefined, rotation3D: undefined, mountingAngle: undefined, mountingPan: undefined, mountingLocation: undefined })
  }
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

export async function deleteBar(bar: TrussBar): Promise<void> {
  const ok = await confirm({
    title: `Delete “${bar.name}”?`,
    message: 'Fixtures hung on it keep their position.',
    confirmLabel: 'Delete bar',
    tone: 'danger'
  })
  if (ok) useVisualizerStore.getState().removeTrussBar(bar.id)
}
