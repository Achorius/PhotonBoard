import { useEffect, useRef } from 'react'
import { LuMonitorX, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'
import { Button, EmptyState, Spinner } from '@renderer/components/ui'
import { useUiStore } from '@renderer/stores/ui-store'
import { useT } from '@renderer/i18n'
import { useThreeScene } from './useThreeScene'
import type { VisualizerEngine } from './scene/VisualizerEngine'

/** Host element for the shared WebGL canvas, with loading / unsupported / lost states */
export function ThreeCanvas({ onEngine }: { onEngine?: (engine: VisualizerEngine | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { engine, status, error, restart } = useThreeScene(containerRef)
  const t = useT()

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
            title={t('visualizer.canvas.unsupportedTitle')}
            description={error ? t('visualizer.canvas.unsupportedTextError', { error }) : t('visualizer.canvas.unsupportedText')}
            action={<Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('stage-layout')}>{t('visualizer.crash.openLayout')}</Button>}
          />
        </div>
      )}
      {status === 'lost' && (
        <div className="absolute inset-0 bg-surface-0">
          <EmptyState
            icon={LuTriangleAlert}
            title={t('visualizer.canvas.lostTitle')}
            description={t('visualizer.canvas.lostText')}
            action={<Button variant="primary" icon={LuRefreshCw} onClick={restart}>{t('visualizer.canvas.restart')}</Button>}
          />
        </div>
      )}
    </div>
  )
}
