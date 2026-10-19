import { useCallback, useEffect, useState } from 'react'
import { destroyVisualizerEngine, getVisualizerEngine, type VisualizerEngine } from './scene/VisualizerEngine'

export type SceneStatus = 'loading' | 'ready' | 'unsupported' | 'lost'

export interface ThreeSceneState {
  engine: VisualizerEngine | null
  status: SceneStatus
  error: string | null
  /** Tear the engine down and start a fresh one (after a lost context) */
  restart: () => void
}

/**
 * Attach the shared 3D engine to a container for the lifetime of the
 * component. The engine (and its WebGL context) outlives the component:
 * tab switches only detach the canvas; the engine frees everything itself
 * after a while without a view.
 */
export function useThreeScene(containerRef: React.RefObject<HTMLDivElement | null>): ThreeSceneState {
  const [engine, setEngine] = useState<VisualizerEngine | null>(null)
  const [status, setStatus] = useState<SceneStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let eng: VisualizerEngine
    try {
      eng = getVisualizerEngine()
    } catch (err) {
      console.error('[3D] WebGL unavailable:', err)
      setError(err instanceof Error ? err.message : String(err))
      setStatus('unsupported')
      return
    }
    setEngine(eng)
    if (eng.status === 'lost') {
      setStatus('lost')
      return
    }
    eng.attach(container)
    setStatus('ready')
    setError(null)
    const off = eng.onStatus((s) => { if (s === 'lost') setStatus('lost') })
    return () => {
      off()
      eng.detach(container)
    }
  }, [containerRef, generation])

  const restart = useCallback(() => {
    destroyVisualizerEngine()
    setEngine(null)
    setStatus('loading')
    setGeneration((g) => g + 1)
  }, [])

  return { engine, status, error, restart }
}
