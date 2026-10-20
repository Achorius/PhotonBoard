import { useEffect } from 'react'
import { usePatchStore } from '../stores/patch-store'
import { useVisualizerStore } from '../stores/visualizer-store'

/**
 * Keep the patch selection (multi) and the visualizer selection (single) in
 * sync. Terminates: each side only writes when the other is out of step, and
 * the resulting change finds both sides consistent.
 */
export function useSelectionSync(): void {
  useEffect(() => {
    // Patch → visualizer
    const unsubPatch = usePatchStore.subscribe(
      (s) => s.selectedFixtureIds,
      (ids) => {
        const viz = useVisualizerStore.getState()
        if (ids.length === 1) {
          if (ids[0] !== viz.selectedFixtureId) viz.selectFixture(ids[0])
        } else if (ids.length === 0 && viz.selectedFixtureId !== null) {
          viz.selectFixture(null)
        } else if (ids.length > 1 && viz.selectedFixtureId !== null && !ids.includes(viz.selectedFixtureId)) {
          viz.selectFixture(null)
        }
      }
    )
    // Visualizer → patch
    const unsubViz = useVisualizerStore.subscribe(
      (s) => s.selectedFixtureId,
      (id) => {
        const patch = usePatchStore.getState()
        if (id) {
          if (!patch.selectedFixtureIds.includes(id)) patch.selectFixture(id, false)
        } else if (patch.selectedFixtureIds.length === 1) {
          patch.clearSelection()
        }
      }
    )
    return () => { unsubPatch(); unsubViz() }
  }, [])
}
