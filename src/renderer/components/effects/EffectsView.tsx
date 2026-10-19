// ============================================================
// Effects view
//   left   — targets (all / groups / fixtures → shared selection)
//   centre — effect library (top) + the show's effects (bottom)
//   right  — parameters of the effect being edited
// ============================================================

import { LuCable, LuPlus } from 'react-icons/lu'
import { Button, EmptyState, ResizeHandle, useResizable } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { TargetPane } from './TargetPane'
import { EffectLibrary } from './EffectLibrary'
import { EffectList } from './EffectList'
import { EffectEditor } from './EffectEditor'

export function EffectsView() {
  const hasFixtures = usePatchStore((s) => s.patch.length > 0)
  const list = useResizable({ initial: 300, min: 150, max: 720, storageKey: 'effects.list', direction: -1, orientation: 'vertical' })

  if (!hasFixtures) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0">
        <EmptyState
          icon={LuCable}
          title="No fixtures patched"
          description="Effects move, colour and pulse patched fixtures. Add fixtures in Patch first."
          action={<Button variant="primary" icon={LuPlus} onClick={() => useUiStore.getState().setActiveTab('patch')}>Add fixtures</Button>}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-surface-0">
      <TargetPane />
      <div className="flex min-w-0 flex-1 flex-col">
        <EffectLibrary className="min-h-[160px] flex-1" />
        <ResizeHandle {...list.handleProps} />
        <EffectList className="shrink-0 border-t border-line" style={{ height: list.size, maxHeight: '60%' }} />
      </div>
      <EffectEditor />
    </div>
  )
}
