import * as THREE from 'three'
import type { FixtureShape } from '@shared/types'

const BODY_COLOR = 0x6a6a8a  // brighter for visibility (was 0x3a3a55)
const SELECTED_COLOR = 0xe85d04
const LENS_COLOR = 0x222244

/** All Three.js objects belonging to one patched fixture */
export interface FixtureObjects {
  /** Root group — position this in the scene */
  group: THREE.Group
  /** The fixture housing mesh (recoloured on selection) */
  bodyMesh: THREE.Mesh
  /** For moving heads: the yoke sub-group that rotates on pan */
  yokeGroup: THREE.Group | null
  /** For moving heads: the head sub-group that rotates on tilt */
  headGroup: THREE.Group | null
  /** Beam cone mesh — additive transparent cone */
  coneMesh: THREE.Mesh
  /** Haze disc inside beam for atmospheric effect */
  hazeMesh: THREE.Mesh | null
  /** Actual Three.js SpotLight for illuminating surfaces */
  spotLight: THREE.SpotLight
  spotTarget: THREE.Object3D
  /** Lens flare disc at the aperture */
  lensMesh: THREE.Mesh
  shape: FixtureShape
}

const bodyMaterial = () =>
  new THREE.MeshBasicMaterial({ color: BODY_COLOR })

const coneMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })

const lensMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.5, 0.5, 0.65),
    transparent: true,
    opacity: 0.5,   // standby glow visible immediately (was 0.0)
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })

const hazeMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })

/**
 * Create all Three.js objects for one fixture.
 * The root group should be positioned and oriented by the caller.
 * By default, the fixture points downward (beam along -Y).
 */
export function createFixtureObjects(shape: FixtureShape, beamAngle = 25): FixtureObjects {
  const group = new THREE.Group()
  const beamAngleRad = THREE.MathUtils.degToRad(Math.min(beamAngle, 60))
  // Cone height so the base sits ~6m below (typical truss height)
  const coneHeight = 8
  const coneRadius = Math.tan(beamAngleRad / 2) * coneHeight

  let bodyMesh: THREE.Mesh
  let yokeGroup: THREE.Group | null = null
  let headGroup: THREE.Group | null = null
  let coneMesh: THREE.Mesh
  let hazeMesh: THREE.Mesh | null = null
  let lensMesh: THREE.Mesh

  if (shape === 'moving-head') {
    // --- Moving Head ---
    // Yoke (pan pivot)
    yokeGroup = new THREE.Group()
    group.add(yokeGroup)

    // Head (tilt pivot, child of yoke)
    headGroup = new THREE.Group()
    yokeGroup.add(headGroup)

    // Body (housing that stays at top)
    const baseGeo = new THREE.BoxGeometry(0.28, 0.14, 0.22)
    bodyMesh = new THREE.Mesh(baseGeo, bodyMaterial())
    bodyMesh.position.y = 0.07
    group.add(bodyMesh)

    // Yoke arms
    const armGeo = new THREE.BoxGeometry(0.04, 0.28, 0.04)
    const armMat = bodyMaterial()
    const armL = new THREE.Mesh(armGeo, armMat)
    armL.position.set(-0.16, -0.14, 0)
    group.add(armL)
    const armR = armL.clone()
    armR.position.x = 0.16
    group.add(armR)

    // Head drum
    const headDrumGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.18, 12)
    const headDrum = new THREE.Mesh(headDrumGeo, bodyMaterial())
    headDrum.rotation.x = Math.PI / 2
    headGroup.add(headDrum)

    // Lens
    const lensGeo = new THREE.CircleGeometry(0.10, 16)
    lensMesh = new THREE.Mesh(lensGeo, lensMaterial())
    lensMesh.position.z = -0.09 // front of head drum
    lensMesh.rotation.y = Math.PI
    headGroup.add(lensMesh)

    // Beam cone (child of head, pointing toward -Z in local space)
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 18, 1, true)
    coneGeo.translate(0, -coneHeight / 2, 0)
    coneGeo.rotateX(-Math.PI / 2)
    coneMesh = new THREE.Mesh(coneGeo, coneMaterial())
    coneMesh.position.z = -0.09
    coneMesh.renderOrder = 100
    headGroup.add(coneMesh)

    // Haze discs along beam for volumetric feel
    const hazeGeo = new THREE.PlaneGeometry(coneRadius * 1.2, coneRadius * 1.2)
    hazeMesh = new THREE.Mesh(hazeGeo, hazeMaterial())
    hazeMesh.position.z = -coneHeight * 0.4
    hazeMesh.rotation.y = Math.PI
    hazeMesh.renderOrder = 101
    headGroup.add(hazeMesh)
  } else if (shape === 'strip') {
    // --- LED Strip / Batten ---
    const stripGeo = new THREE.BoxGeometry(1.0, 0.06, 0.08)
    bodyMesh = new THREE.Mesh(stripGeo, bodyMaterial())
    group.add(bodyMesh)

    // Wide beam cone
    const coneGeo = new THREE.ConeGeometry(0.8, coneHeight, 18, 1, true)
    coneGeo.translate(0, -coneHeight / 2, 0)
    coneMesh = new THREE.Mesh(coneGeo, coneMaterial())
    coneMesh.position.y = -0.04
    coneMesh.renderOrder = 100
    group.add(coneMesh)

    const lensGeo = new THREE.PlaneGeometry(0.9, 0.04)
    lensMesh = new THREE.Mesh(lensGeo, lensMaterial())
    lensMesh.position.y = -0.04
    lensMesh.rotation.x = -Math.PI / 2
    group.add(lensMesh)
  } else {
    // --- PAR / Wash (default) ---
    const parBodyGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.22, 10)
    bodyMesh = new THREE.Mesh(parBodyGeo, bodyMaterial())
    group.add(bodyMesh)

    // Cone
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 18, 1, true)
    coneGeo.translate(0, -coneHeight / 2, 0)
    coneMesh = new THREE.Mesh(coneGeo, coneMaterial())
    coneMesh.position.y = -0.11
    coneMesh.renderOrder = 100
    group.add(coneMesh)

    // Haze disc
    const hazeGeo = new THREE.PlaneGeometry(coneRadius * 1.0, coneRadius * 1.0)
    hazeMesh = new THREE.Mesh(hazeGeo, hazeMaterial())
    hazeMesh.position.y = -coneHeight * 0.35
    hazeMesh.rotation.x = -Math.PI / 2
    hazeMesh.renderOrder = 101
    group.add(hazeMesh)

    const lensGeo = new THREE.CircleGeometry(0.14, 16)
    lensMesh = new THREE.Mesh(lensGeo, lensMaterial())
    lensMesh.position.y = -0.12
    lensMesh.rotation.x = Math.PI / 2
    lensMesh.rotation.z = Math.PI
    group.add(lensMesh)
  }

  // SpotLight — child of group, aimed downward
  const spotLight = new THREE.SpotLight(0xffffff, 0, 14, beamAngleRad * 1.1, 0.25, 1.5)
  spotLight.castShadow = false
  spotLight.userData.baseAngle = beamAngleRad * 1.1  // preserve for per-frame reset
  const spotTarget = new THREE.Object3D()
  spotTarget.position.set(0, -6, 0)
  group.add(spotLight)
  group.add(spotTarget)
  spotLight.target = spotTarget

  return {
    group,
    bodyMesh,
    yokeGroup,
    headGroup,
    coneMesh,
    hazeMesh,
    spotLight,
    spotTarget,
    lensMesh,
    shape
  }
}

export function setFixtureSelected(objects: FixtureObjects, selected: boolean): void {
  const color = selected ? SELECTED_COLOR : BODY_COLOR
  ;(objects.bodyMesh.material as THREE.MeshBasicMaterial).color.setHex(color)
}
