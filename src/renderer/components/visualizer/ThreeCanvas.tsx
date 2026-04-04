import React, { useRef } from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useThreeScene } from './useThreeScene'
import { useFixtureObjects } from './useFixtureObjects'
import { useDmxAnimation } from './useDmxAnimation'

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { patch, fixtures } = usePatchStore()
  const { roomConfig } = useVisualizerStore()

  const { sceneRef, cameraRef, rendererRef, controlsRef } = useThreeScene(containerRef)

  const objectMapRef = useFixtureObjects(sceneRef, patch, fixtures, roomConfig)

  useDmxAnimation(sceneRef, cameraRef, rendererRef, controlsRef, objectMapRef, patch, fixtures)

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#07070d', cursor: 'grab', minHeight: '200px', position: 'relative' }}
    />
  )
}
