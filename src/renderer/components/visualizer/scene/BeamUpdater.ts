import * as THREE from 'three'
import type { FixtureObjects } from './FixtureModel'
import type { ResolvedChannels } from '@renderer/lib/dmx-channel-resolver'
import { dmxToPanDeg, dmxToTiltDeg, getEffectiveColor } from '@renderer/lib/dmx-channel-resolver'

export interface FixtureUpdateOptions {
  panInvert?: boolean
  tiltInvert?: boolean
}

/**
 * Update a fixture's Three.js objects every frame based on current DMX values.
 * Called inside the rAF loop — no allocations, no React.
 */
export function updateFixtureObjects(
  objects: FixtureObjects,
  channels: ResolvedChannels,
  grandMaster: number,
  blackout: boolean,
  showBeams: boolean,
  options?: FixtureUpdateOptions
): void {
  const gm = grandMaster / 255
  const effectiveDim = blackout ? 0 : (channels.dimmer / 255) * gm

  // --- Beam color via centralized resolver (handles RGB, CMY, color wheel, dimmer-only) ---
  // getEffectiveColor returns dimmer-applied values, but we handle dimmer separately via effectiveDim
  // So we call it with dimmer=255 to get the raw beam color at full intensity
  const colorResult = getEffectiveColor({
    ...channels,
    dimmer: 255,            // override: we apply dimmer via effectiveDim below
    hasDimmerChannel: true  // keep true so dimmer-only fixtures return white beam
  })
  const r = colorResult.r
  const g = colorResult.g
  const b = colorResult.b

  const col = new THREE.Color(r, g, b)

  const coneMat = objects.coneMesh.material as THREE.MeshBasicMaterial
  const lensMat = objects.lensMesh.material as THREE.MeshBasicMaterial

  const hasBeam = r > 0 || g > 0 || b > 0

  // --- Gobo: slightly reduce opacity ---
  const goboActive = channels.gobo > 10
  const goboFactor = goboActive ? 0.65 : 1.0

  if (showBeams) {
    coneMat.color.copy(col)
    coneMat.opacity = effectiveDim * 0.35 * goboFactor
    objects.coneMesh.visible = effectiveDim > 0.005 && hasBeam
  } else {
    objects.coneMesh.visible = false
  }

  // Haze disc
  if (objects.hazeMesh) {
    const hazeMat = objects.hazeMesh.material as THREE.MeshBasicMaterial
    if (showBeams && effectiveDim > 0.005 && hasBeam) {
      hazeMat.color.copy(col)
      hazeMat.opacity = effectiveDim * 0.10 * goboFactor
      objects.hazeMesh.visible = true
    } else {
      objects.hazeMesh.visible = false
    }
  }

  // Lens glow
  if (hasBeam) {
    lensMat.color.copy(col)
    lensMat.opacity = Math.min(0.95, effectiveDim * 1.4)
  } else {
    lensMat.color.setRGB(0.5, 0.5, 0.65)
    lensMat.opacity = 0.5
  }

  // SpotLight — reset angle to base value, then apply gobo/zoom
  const baseAngle = objects.spotLight.userData.baseAngle as number | undefined
  if (baseAngle !== undefined) {
    objects.spotLight.angle = baseAngle
  }
  objects.spotLight.color.copy(col)
  objects.spotLight.intensity = effectiveDim * 4.0
  objects.spotLight.penumbra = goboActive ? 0.5 : 0.25

  // --- Zoom ---
  if (channels.zoom !== 128) {
    const zoomFactor = 0.5 + (channels.zoom / 255) * 1.5
    objects.coneMesh.scale.set(zoomFactor, zoomFactor, 1)
    objects.spotLight.angle = (baseAngle ?? objects.spotLight.angle) * zoomFactor
  } else {
    objects.coneMesh.scale.set(1, 1, 1)
  }

  // --- Moving head pan/tilt ---
  if (objects.shape === 'moving-head' && objects.yokeGroup && objects.headGroup) {
    let panDeg  = dmxToPanDeg(channels.pan, channels.panFine)
    let tiltDeg = dmxToTiltDeg(channels.tilt, channels.tiltFine)
    // Apply invert if configured
    if (options?.panInvert) panDeg = -panDeg
    if (options?.tiltInvert) tiltDeg = -tiltDeg
    objects.yokeGroup.rotation.y = THREE.MathUtils.degToRad(panDeg)
    // Offset tilt by -90° so center position (tilt=128) points beam straight down
    objects.headGroup.rotation.x = THREE.MathUtils.degToRad(tiltDeg - 90)
  }

  // --- Shutter/strobe ---
  // Many fixtures use 'Shutter' channel for strobe (range ~64-95), check both
  const strobeValue = channels.strobe > 10 ? channels.strobe
    : (channels.shutter >= 64 && channels.shutter <= 200) ? channels.shutter : 0
  if (strobeValue > 10) {
    const strobeRate = strobeValue / 255
    const strobeOn = Math.sin(performance.now() * strobeRate * 0.05) > 0
    if (!strobeOn) {
      coneMat.opacity = 0
      objects.coneMesh.visible = false
      objects.spotLight.intensity = 0
      if (objects.hazeMesh) objects.hazeMesh.visible = false
    }
  }
}
