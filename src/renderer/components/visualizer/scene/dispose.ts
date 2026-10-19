import * as THREE from 'three'

/** Shared resources (geometry cache, gobo / glow textures) carry userData.shared and are never freed here */
function isShared(x: unknown, keep?: ReadonlySet<unknown>): boolean {
  return !!keep?.has(x) || !!(x as { userData?: { shared?: boolean } }).userData?.shared
}

/**
 * Free the GPU resources of an object tree: geometries, materials and the
 * textures they own. Shared geometries / textures survive.
 */
export function disposeObject(root: THREE.Object3D, keep?: ReadonlySet<unknown>): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    // Sprites all share one module-level quad: never dispose it
    if (mesh.geometry && !(obj as THREE.Sprite).isSprite && !isShared(mesh.geometry, keep)) mesh.geometry.dispose()
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material
    if (mat) {
      for (const m of Array.isArray(mat) ? mat : [mat]) disposeMaterial(m, keep)
    }
    const light = obj as THREE.SpotLight
    if (light.isLight && light.shadow?.map) {
      light.shadow.map.dispose()
      light.shadow.map = null
    }
  })
}

export function disposeMaterial(material: THREE.Material, keep?: ReadonlySet<unknown>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture && !isShared(value, keep)) value.dispose()
  }
  const uniforms = (material as THREE.ShaderMaterial).uniforms
  if (uniforms) {
    for (const u of Object.values(uniforms)) {
      if (u.value instanceof THREE.Texture && !isShared(u.value, keep)) u.value.dispose()
    }
  }
  material.dispose()
}
