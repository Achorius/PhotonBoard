// ============================================================
// PhotonBoard — Device Detection
// Detects hardware capabilities to adjust performance settings.
// Three tiers:
//   - Desktop (Intel/AMD/NVIDIA): full quality
//   - ARM capable (Pi 5 VideoCore VII): reduced 3D, full UI
//   - Low-end (Mali-400, software renderers): heavily throttled
// ============================================================

interface DeviceProfile {
  /** True only on genuinely weak GPUs (Mali-400, llvmpipe, swiftshader) */
  isLowEnd: boolean
  /** True on ARM GPUs that work but can't handle desktop-grade 3D */
  isMidRange: boolean
  /** True on any ARM architecture (Pi 5 included) */
  isArm: boolean
  /** Recommended max pixel ratio */
  maxPixelRatio: number
  /** Recommended 3D visualizer FPS */
  visualizerFps: number
  /** Recommended DMX mixer interval in ms (0 = use rAF) */
  mixerIntervalMs: number
  /** Recommended stage sync interval in ms */
  stageSyncMs: number
}

let cached: DeviceProfile | null = null

export function getDeviceProfile(): DeviceProfile {
  if (cached) return cached

  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() ?? ''

  // ARM CPU: "Linux aarch64" / "Linux armv7l" (navigator.platform is not
  // reduced on Linux, unlike the UA string). Apple Silicon reports as Intel.
  const isArm = /aarch64|arm64|armv\d|\barm\b/.test(`${platform} ${ua}`)

  // Detect GPU via WebGL renderer string, then release the probe context
  // (browsers cap live WebGL contexts; the 3D view needs one)
  let gpuRenderer = ''
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl && gl instanceof WebGLRenderingContext) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) {
        gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)?.toLowerCase() ?? ''
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch { /* ignore */ }

  // Truly weak GPUs — heavily throttled
  const isLowEnd =
    gpuRenderer.includes('mali-4') ||
    gpuRenderer.includes('mali-t') ||
    gpuRenderer.includes('llvmpipe') ||
    gpuRenderer.includes('software')

  // Mid-range: GPUs that run the 3D view at reduced quality —
  // Pi 5 VideoCore VII (v3d), SwiftShader, ANGLE on ARM, any ARM Linux
  const isLinux = platform.includes('linux') || ua.includes('linux')
  const isMidRange = !isLowEnd && (
    gpuRenderer.includes('v3d') ||
    gpuRenderer.includes('videocore') ||
    gpuRenderer.includes('swiftshader') ||
    (isArm && gpuRenderer.includes('angle')) ||
    (isArm && isLinux)
  )

  // Desktop: everything else (Intel, AMD, NVIDIA, Apple Silicon)
  const isDesktop = !isLowEnd && !isMidRange

  cached = {
    isLowEnd,
    isMidRange,
    isArm,
    maxPixelRatio: isDesktop ? 2 : 1,
    visualizerFps: isLowEnd ? 15 : isMidRange ? 24 : 40,
    mixerIntervalMs: isLowEnd ? 33 : 0,
    stageSyncMs: isLowEnd ? 50 : 33,
  }

  return cached
}
