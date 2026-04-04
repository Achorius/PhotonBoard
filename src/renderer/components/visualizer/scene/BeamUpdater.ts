import * as THREE from 'three'
import type { FixtureObjects } from './FixtureModel'
import type { ResolvedChannels } from '@renderer/lib/dmx-channel-resolver'
import { getEffectiveColor, dmxToPanDeg, dmxToTiltDeg } from '@renderer/lib/dmx-channel-resolver'

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
  // dimmer is guaranteed >= 255 for fixtures without a dedicated dimmer channel
  // (see resolveChannels fix), so effectiveDim correctly scales color fixtures too
  const gm = grandMaster / 255
  const effectiveDim = blackout ? 0 : (channels.dimmer / 255) * gm

  // --- Beam color (resolved in 0-1 range) ---
  const { r, g, b } = getEffectiveColor(channels)
  const col = new THREE.Color(r, g, b)

  const coneMat = objects.coneMesh.material as THREE.MeshBasicMaterial
  const lensMat = objects.lensMesh.material as THREE.MeshBasicMaterial

  const hasBeam = r > 0 || g > 0 || b > 0
  if (showBeams) {
    coneMat.color.copy(col)
    coneMat.opacity = effectiveDim * 0.22
    objects.coneMesh.visible = effectiveDim > 0.005 && hasBeam
  } else {
    objects.coneMesh.visible = false
  }

  // Lens glow
  if (hasBeam) {
    lensMat.color.copy(col)
    lensMat.opacity = Math.min(0.95, effectiveDim * 1.4)
  } else {
    // Standby: clearly visible glow to show fixture position
    lensMat.color.setRGB(0.5, 0.5, 0.65)
    lensMat.opacity = 0.5
  }

  // SpotLight
  objects.spotLight.color.copy(col)
  objects.spotLight.intensity = effectiveDim * 4.0

  // --- Moving head pan/tilt ---
  if (objects.shape === 'moving-head' && objects.yokeGroup && objects.headGroup) {
    const panDeg  = dmxToPanDeg(channels.pan, channels.panFine)
    const tiltDeg = dmxToTiltDeg(channels.tilt, channels.tiltFine)
    objects.yokeGroup.rotation.y = THREE.MathUtils.degToRad(panDeg)
    objects.headGroup.rotation.x = THREE.MathUtils.degToRad(tiltDeg)
  }
}
