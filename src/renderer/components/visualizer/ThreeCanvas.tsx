import { useEffect, useRef } from 'react'
import { LuMonitorX, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'
import { Button, EmptyState, Spinner } from '@renderer/components/ui'
import { useUiStore } from '@renderer/stores/ui-store'
import { useThreeScene } from './useThreeScene'
import type { VisualizerEngine } from './scene/VisualizerEngine'

/** Host element for the shared WebGL canvas, with loading / unsupported / lost states */
export function ThreeCanvas({ onEngine }: { onEngine?: (engine: VisualizerEngine | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { engine, status, error, restart } = useThreeScene(containerRef)

  useEffect(() => {
    onEngine?.(status === 'ready' ? engine : null)
  }, [engine, status, onEngine])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0 touch-none select-none" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center"><Spinner /></div>
      )}
      {status === 'unsupported' && (
        <div className="absolute inset-0 bg-surface-0">
          <EmptyState
            icon={LuMonitorX}
            title="3D is not available here"
            description={`This device could not start WebGL${error ? ` (${error})` : ''}. The stage layout shows the same rig in 2D.`}
            action={<Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('stage-layout')}>Open stage layout</Button>}
          />
        </div>
      )}
      {status === 'lost' && (
        <div className="absolute inset-0 bg-surface-0">
          <EmptyState
            icon={LuTriangleAlert}
            title="The 3D view was interrupted"
            description="The graphics context was lost (GPU reset or memory pressure). Restart the 3D view to continue."
            action={<Button variant="primary" icon={LuRefreshCw} onClick={restart}>Restart 3D</Button>}
          />
        </div>
      )}
    </div>
  )
}
