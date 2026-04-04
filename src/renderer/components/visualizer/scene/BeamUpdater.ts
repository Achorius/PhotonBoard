import * as THREE from 'three'
import type { FixtureObjects } from './FixtureModel'
import type { ResolvedChannels } from '@renderer/lib/dmx-channel-resolver'
import { dmxToPanDeg, dmxToTiltDeg } from '@renderer/lib/dmx-channel-resolver'

/**
 * Update a fixture's Three.js objects every frame based on current DMX values.
 * Called inside the rAF loop — no allocations, no React.
 */
export function updateFixtureObjects(
  objects: FixtureObjects,
  channels: ResolvedChannels,
  grandMaster: number,
  blackout: boolean,
  showBeams: boolean
): void {
  const gm = grandMaster / 255
  const effectiveDim = blackout ? 0 : (channels.dimmer / 255) * gm

  // --- Beam color (raw RGB, without dimmer applied — dimmer is handled via effectiveDim) ---
  const hasColorChannels = channels.red > 0 || channels.green > 0 || channels.blue > 0 ||
                           channels.white > 0 || channels.amber > 0 || channels.uv > 0 ||
                           channels.cyan > 0 || channels.magenta > 0 || channels.yellow > 0

  let r: number, g: number, b: number
  if (hasColorChannels) {
    const cyanSub = channels.cyan / 255
    const magentaSub = channels.magenta / 255
    const yellowSub = channels.yellow / 255
    r = Math.min(1, (channels.red / 255 + channels.white / 510 + channels.amber / 510) * (1 - cyanSub))
    g = Math.min(1, (channels.green / 255 + channels.white / 510) * (1 - magentaSub))
    b = Math.min(1, (channels.blue / 255 + channels.uv / 510) * (1 - yellowSub))
  } else if (channels.hasDimmerChannel) {
    // Dimmer-only fixture: white beam
    r = 1; g = 1; b = 1
  } else {
    r = 0; g = 0; b = 0
  }

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
    const panDeg  = dmxToPanDeg(channels.pan, channels.panFine)
    const tiltDeg = dmxToTiltDeg(channels.tilt, channels.tiltFine)
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
