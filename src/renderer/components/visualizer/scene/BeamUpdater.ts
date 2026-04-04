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
  const { r, g, b } = getEffectiveColor(channels)
  const gm = grandMaster / 255
  const dimNorm = blackout ? 0 : Math.min(1, (channels.dimmer / 255) * gm || gm)

  // If no dedicated dimmer channel, use color brightness
  const hasRGB = channels.red > 0 || channels.green > 0 || channels.blue > 0 ||
                 channels.white > 0 || channels.amber > 0
  const effectiveDim = channels.dimmer > 0 ? dimNorm : (hasRGB ? gm : 0)

  // --- Beam color ---
  const col = new THREE.Color(r, g, b)
  if (!col.r && !col.g && !col.b) col.setRGB(effectiveDim, effectiveDim, effectiveDim)

  const coneMat = objects.coneMesh.material as THREE.MeshBasicMaterial
  const lensMat = objects.lensMesh.material as THREE.MeshBasicMaterial

  if (showBeams) {
    coneMat.color.copy(col)
    coneMat.opacity = effectiveDim * 0.10
    objects.coneMesh.visible = effectiveDim > 0.01
  } else {
    objects.coneMesh.visible = false
  }

  // Lens glow
  lensMat.color.copy(col)
  lensMat.opacity = effectiveDim * 0.9

  // SpotLight
  objects.spotLight.color.copy(col)
  objects.spotLight.intensity = effectiveDim * 3.5

  // --- Moving head pan/tilt ---
  if (objects.shape === 'moving-head' && objects.yokeGroup && objects.headGroup) {
    const panDeg  = dmxToPanDeg(channels.pan, channels.panFine)
    const tiltDeg = dmxToTiltDeg(channels.tilt, channels.tiltFine)
    objects.yokeGroup.rotation.y = THREE.MathUtils.degToRad(panDeg)
    objects.headGroup.rotation.x = THREE.MathUtils.degToRad(tiltDeg)
  }
}
