// ============================================================
// Keyboard actions on the selection of the stage layout and the 3D view
// (Delete / Backspace, Mod+D, F2 / Enter — see lib/selection-actions.ts).
//
//   Truss bar selected   Delete removes the bar (confirm + Undo), Mod+D
//                        duplicates it just upstage, F2 renames it.
//   Fixture(s) selected  Delete RESETS THEIR PLACEMENT (back to the
//                        automatic layout; confirm + Undo). It never
//                        removes fixtures from the patch: that is a Patch
//                        view operation, and a plan / 3D view only shows
//                        where patched fixtures hang. F2 renames a single
//                        fixture; Mod+D does nothing (duplicating a fixture
//                        needs a DMX address: Patch view).
//
// Same precedence as the layout inspector: several fixtures, then the
// inspected fixture, then the selected bar. Rendered as a leaf (returns
// null) so selection changes do not re-render the whole view.
// ============================================================

import type { RefObject } from 'react'
import { t, useT } from '@renderer/i18n'
import { prompt } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useSelectionActions, type SelectionActions } from '@renderer/lib/selection-actions'
import { barLabel, clearPlacement, deleteBarConfirm, duplicateBar, placementLabel, resetPlacementConfirm } from './rig-actions'

export async function renameBarPrompt(barId: string): Promise<void> {
  const bar = useVisualizerStore.getState().roomConfig.trussBars.find((b) => b.id === barId)
  if (!bar) return
  const name = await prompt({ title: t('layout.bar.rename'), label: t('common.name'), defaultValue: bar.name, confirmLabel: t('common.rename') })
  if (name && name.trim()) useVisualizerStore.getState().updateTrussBar(bar.id, { name: name.trim() })
}

async function renameFixturePrompt(id: string): Promise<void> {
  const entry = usePatchStore.getState().patch.find((p) => p.id === id)
  if (!entry) return
  const name = await prompt({ title: t('layout.fixture.renameTitle'), label: t('common.name'), defaultValue: entry.name, confirmLabel: t('common.rename') })
  if (name && name.trim()) usePatchStore.getState().updateFixture(entry.id, { name: name.trim() })
}

export function RigSelectionActions({ scope, bars }: {
  scope: RefObject<HTMLElement | null>
  /** Bars can be selected (stage layout); false in the 3D view */
  bars: boolean
}) {
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const inspectedId = useVisualizerStore((s) => s.selectedFixtureId)
  const barId = useVisualizerStore((s) => (bars ? s.selectedTrussId : null))
  useT() // confirm texts below follow a language change

  let actions: SelectionActions | null = null
  const fixtureIds = selectedIds.length > 1 ? selectedIds : inspectedId ? [inspectedId] : !bars || !barId ? selectedIds : []
  if (fixtureIds.length > 0) {
    const ids = [...fixtureIds]
    const entries = () => {
      const set = new Set(ids)
      return usePatchStore.getState().patch.filter((p) => set.has(p.id))
    }
    actions = {
      label: () => placementLabel(entries()),
      canDelete: () => entries().length > 0,
      delete: () => clearPlacement(ids),
      confirmDelete: resetPlacementConfirm(entries()),
      canRename: () => ids.length === 1,
      rename: () => void renameFixturePrompt(ids[0])
    }
  } else if (barId) {
    const bar = () => useVisualizerStore.getState().roomConfig.trussBars.find((b) => b.id === barId)
    actions = {
      label: () => { const b = bar(); return b ? barLabel(b) : '' },
      canDelete: () => !!bar(),
      delete: () => useVisualizerStore.getState().removeTrussBar(barId),
      confirmDelete: deleteBarConfirm(),
      canDuplicate: () => !!bar(),
      duplicate: () => { const b = bar(); if (b) duplicateBar(b) },
      canRename: () => !!bar(),
      rename: () => void renameBarPrompt(barId)
    }
  }
  useSelectionActions(actions, { scope })
  return null
}
