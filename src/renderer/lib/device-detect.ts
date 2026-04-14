// ============================================================
// PhotonBoard — Device Detection
// Detects hardware capabilities to adjust performance settings.
// Pi 5 (VideoCore VII, 8-16GB) is capable — only truly weak
// GPUs (Mali-400, software renderers) get throttled.
// ============================================================

interface DeviceProfile {
  /** True only on genuinely weak GPUs (Mali-400, llvmpipe, swiftshader) */
  isLowEnd: boolean
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

  // Detect ARM architecture
  const isArm = platform.includes('arm') ||
    platform.includes('aarch64') ||
    ua.includes('aarch64') ||
    ua.includes('armv')

  // Detect GPU via WebGL renderer string
  let gpuRenderer = ''
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl && gl instanceof WebGLRenderingContext) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) {
        gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)?.toLowerCase() ?? ''
      }
    }
  } catch { /* ignore */ }

  // Only truly weak GPUs are "low-end":
  // - Mali-400 (Pi 3 and older)
  // - llvmpipe / swiftshader (software rendering fallbacks)
  // Pi 5's VideoCore VII is NOT in this list — it handles antialias and shadows fine.
  const isLowEnd =
    gpuRenderer.includes('mali-4') ||
    gpuRenderer.includes('mali-t') ||
    gpuRenderer.includes('llvmpipe') ||
    gpuRenderer.includes('swiftshader') ||
    gpuRenderer.includes('software')

  cached = {
    isLowEnd,
    isArm,
    maxPixelRatio: isLowEnd ? 1 : 2,
    visualizerFps: isLowEnd ? 20 : 40,
    mixerIntervalMs: isLowEnd ? 33 : 0,  // 30Hz on weak GPU, rAF (~60Hz) elsewhere
    stageSyncMs: isLowEnd ? 50 : 33,      // 20Hz on weak GPU, 30Hz elsewhere
  }

  if (isLowEnd) {
    console.log('[Device] Low-end GPU detected — throttling enabled:', {
      platform,
      gpu: gpuRenderer || 'unknown',
      profile: cached
    })
  } else if (isArm) {
    console.log('[Device] ARM device with capable GPU — running at full quality:', {
      gpu: gpuRenderer || 'unknown'
    })
  }

  return cached
}
