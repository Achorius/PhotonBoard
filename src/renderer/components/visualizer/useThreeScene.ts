import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildRoom, setGridVisible } from './scene/RoomGeometry'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { getDeviceProfile } from '@renderer/lib/device-detect'

export interface ThreeRefs {
  sceneRef: React.MutableRefObject<THREE.Scene | null>
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>
  controlsRef: React.MutableRefObject<OrbitControls | null>
  roomGroupRef: React.MutableRefObject<THREE.Group | null>
  ambientRef: React.MutableRefObject<THREE.AmbientLight | null>
}

export function useThreeScene(containerRef: React.RefObject<HTMLDivElement>): ThreeRefs {
  const sceneRef    = useRef<THREE.Scene | null>(null)
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const roomGroupRef= useRef<THREE.Group | null>(null)
  const ambientRef  = useRef<THREE.AmbientLight | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ---- Renderer (adapt to device capabilities) ----
    const device = getDeviceProfile()
    const needsPerf = device.isLowEnd || device.isMidRange

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !needsPerf,
        alpha: false,
        powerPreference: needsPerf ? 'low-power' : 'high-performance',
        failIfMajorPerformanceCaveat: false  // Accept software renderers (Safari fallback)
      })
    } catch (err) {
      console.error('[3D] WebGL unavailable:', err)
      // Show fallback message in container
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#888;font-size:14px;text-align:center;padding:20px;">3D non disponible sur ce navigateur.<br>Utilisez l\'onglet Stage Layout.</div>'
      return () => {}
    }

    // Verify WebGL context was actually created
    const gl = renderer.getContext()
    if (!gl) {
      console.error('[3D] WebGL context is null')
      renderer.dispose()
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#888;font-size:14px;text-align:center;padding:20px;">3D non disponible.<br>Utilisez l\'onglet Stage Layout.</div>'
      return () => {}
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, device.maxPixelRatio))
    renderer.shadowMap.enabled = !needsPerf
    renderer.shadowMap.type = THREE.BasicShadowMap
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setClearColor(0x07070d, 1)
    container.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    // ---- Scene ----
    const scene = new THREE.Scene()

    // ---- Camera ----
    const rect = container.getBoundingClientRect()
    const aspect = rect.width / (rect.height || 1)
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200)
    camera.position.set(0, 3, -12)   // audience side (-Z)
    camera.lookAt(0, 3, 0)

    // ---- Lights ----
    const ambient = new THREE.AmbientLight(0x8080a0, 0.6)
    scene.add(ambient)
    ambientRef.current = ambient
    const dir = new THREE.DirectionalLight(0x8888c0, 0.35)
    dir.position.set(0, 10, 5)
    scene.add(dir)

    // ---- Orbit Controls ----
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 3, 0)
    controls.maxPolarAngle = Math.PI * 0.88
    controls.minDistance = 1
    controls.maxDistance = 80
    controls.update()

    // ---- Room ----
    const { roomConfig, showGrid } = useVisualizerStore.getState()
    const roomGroup = buildRoom(roomConfig)
    scene.add(roomGroup)
    setGridVisible(roomGroup, showGrid)

    // Assign to refs
    sceneRef.current    = scene
    cameraRef.current   = camera
    rendererRef.current = renderer
    controlsRef.current = controls
    roomGroupRef.current= roomGroup

    // Initial size — getBoundingClientRect may return 0 on first paint, defer
    const initW = rect.width || container.offsetWidth || 800
    const initH = rect.height || container.offsetHeight || 600
    renderer.setSize(initW, initH, false)
    camera.aspect = initW / (initH || 1)
    camera.updateProjectionMatrix()
    // Also sync after layout settles
    requestAnimationFrame(() => {
      const r2 = container.getBoundingClientRect()
      if (r2.width > 0 && r2.height > 0) {
        renderer.setSize(r2.width, r2.height, false)
        camera.aspect = r2.width / r2.height
        camera.updateProjectionMatrix()
      }
    })

    // ---- Resize ----
    const ro = new ResizeObserver(() => {
      const { width: w, height: h } = container.getBoundingClientRect()
      if (w < 1 || h < 1) return  // skip zero-size updates
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(container)

    // ---- React to store changes that need scene rebuild ----
    const unsub = useVisualizerStore.subscribe(
      (s) => ({ roomConfig: s.roomConfig, showGrid: s.showGrid, showRoom: s.showRoom }),
      ({ roomConfig: rc, showGrid: sg, showRoom: sr }) => {
        // Rebuild room
        if (roomGroupRef.current) scene.remove(roomGroupRef.current)
        const newRoom = buildRoom(rc)
        setGridVisible(newRoom, sg)
        newRoom.visible = sr
        scene.add(newRoom)
        roomGroupRef.current = newRoom
      },
      { equalityFn: shallowEq }
    )

    return () => {
      unsub()
      ro.disconnect()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      sceneRef.current    = null
      cameraRef.current   = null
      rendererRef.current = null
      controlsRef.current = null
      roomGroupRef.current= null
    }
  }, [])

  return { sceneRef, cameraRef, rendererRef, controlsRef, roomGroupRef, ambientRef }
}

function shallowEq(a: any, b: any): boolean {
  if (a === b) return true
  for (const k in a) { if (a[k] !== b[k]) return false }
  return true
}
