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
  /** For multi-cell fixtures: per-cell lens meshes for individual color */
  cellLenses?: THREE.Mesh[]
  /** For multi-cell fixtures: per-cell cone meshes */
  cellCones?: THREE.Mesh[]
}

const bodyMaterial = () =>
  new THREE.MeshBasicMaterial({ color: BODY_COLOR })

/**
 * Volumetric beam shader — gradient falloff along beam + Fresnel edge softness.
 * Replaces the flat-opacity MeshBasicMaterial for realistic QLC+-style beams.
 */
const BEAM_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`

const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGoboIndex;
uniform float uGoboRotation;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

// Procedural gobo pattern on cone surface.
// The cone surface is the SHELL of the beam — every fragment is at the beam edge.
// 'angle' is the angular position around the beam (0–2π from vUv.x).
// For patterns that need radial info, we fake an interior view by treating
// the cone surface as a 2D projection of the gobo disc.
// Returns 0.0 (blocked) to 1.0 (open).
float goboPattern(float idx, float angle, float t) {
  // Convert to 2D cartesian on unit disc for patterns that need it
  // Use vUv.x as angle, and a fixed radius of ~0.7 to represent beam edge view
  float px = cos(angle);
  float py = sin(angle);

  // Gobo 1: Radial stripes (6 segments) — classic slot pattern
  if (idx < 1.5) {
    float seg = sin(6.0 * angle);
    return smoothstep(-0.1, 0.2, seg);
  }
  // Gobo 2: Three-segment (tri pattern)
  if (idx < 2.5) {
    float seg = sin(3.0 * angle);
    return smoothstep(-0.05, 0.3, seg);
  }
  // Gobo 3: 4-point star — four bright lobes
  if (idx < 3.5) {
    float star = cos(4.0 * angle);
    return smoothstep(-0.1, 0.3, star);
  }
  // Gobo 4: Spiral (3 arms winding along beam)
  if (idx < 4.5) {
    float spiral = sin(3.0 * angle - t * 12.0);
    return smoothstep(-0.15, 0.25, spiral);
  }
  // Gobo 5: 8 radial lines (narrow bright spokes)
  if (idx < 5.5) {
    float seg = cos(8.0 * angle);
    return smoothstep(0.2, 0.5, seg);
  }
  // Gobo 6: Alternating bands (angular checkerboard effect)
  if (idx < 6.5) {
    float ang = sin(5.0 * angle);
    float axial = sin(t * 15.0);
    float checker = ang * axial;
    return smoothstep(-0.1, 0.2, checker);
  }
  // Gobo 7: Broken segments with gaps
  if (idx < 7.5) {
    float seg = sin(4.0 * angle);
    float gap = smoothstep(0.8, 0.9, abs(cos(2.0 * angle)));
    return smoothstep(-0.1, 0.3, seg) * (1.0 - gap);
  }
  return 1.0;
}

void main() {
  // vUv.y = 1.0 at fixture lens (cone tip), 0.0 at far end (cone base)
  float t = 1.0 - vUv.y; // 0 = fixture, 1 = far end

  // Exponential decay along beam length — bright near source, fades out
  float axialFade = exp(-t * 3.0);

  // Soft cutoff before the very end to avoid hard circular edge
  float endFade = smoothstep(1.0, 0.75, t);

  // Fresnel edge softness — makes beam edges translucent, center brighter
  float fresnel = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float edgeSoft = pow(fresnel, 0.6);

  // Gobo pattern — procedural generation on cone surface
  float goboAlpha = 1.0;
  if (uGoboIndex > 0.5) {
    float angle = vUv.x * 6.28318 + uGoboRotation;
    float pattern = goboPattern(uGoboIndex, angle, t);
    // Strong contrast: blocked areas go very dark, open areas stay full
    goboAlpha = mix(0.02, 1.0, pattern);
    // Near the lens tip, blend to uniform (pattern too small to resolve)
    goboAlpha = mix(1.0, goboAlpha, smoothstep(0.0, 0.08, t));
    // Softer Fresnel when gobo active so pattern shows better at grazing angles
    edgeSoft = pow(fresnel, 0.35);
  }

  float alpha = uOpacity * axialFade * endFade * edgeSoft * goboAlpha;

  gl_FragColor = vec4(uColor, alpha);
}
`

const coneMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uGoboIndex: { value: 0.0 },
      uGoboRotation: { value: 0.0 }
    },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
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
export function createFixtureObjects(shape: FixtureShape, beamAngle = 25, fixtureY?: number, roomDiagonal?: number, cellCount = 1): FixtureObjects {
  const group = new THREE.Group()
  const beamAngleRad = THREE.MathUtils.degToRad(Math.min(beamAngle, 60))
  // Cone height = room diagonal so beams can reach any corner even when tilted
  const coneHeight = Math.max(6, roomDiagonal ?? 30)
  const coneRadius = Math.tan(beamAngleRad / 2) * coneHeight

  let bodyMesh: THREE.Mesh
  let yokeGroup: THREE.Group | null = null
  let headGroup: THREE.Group | null = null
  let coneMesh: THREE.Mesh
  let hazeMesh: THREE.Mesh | null = null
  let lensMesh: THREE.Mesh
  let cellLenses: THREE.Mesh[] | undefined
  let cellCones: THREE.Mesh[] | undefined

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
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 48, 1, true)
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
    const stripWidth = 1.0
    const stripGeo = new THREE.BoxGeometry(stripWidth, 0.06, 0.08)
    bodyMesh = new THREE.Mesh(stripGeo, bodyMaterial())
    group.add(bodyMesh)

    // Wide beam cone (overall glow)
    const coneGeo = new THREE.ConeGeometry(0.8, coneHeight, 48, 1, true)
    coneGeo.translate(0, -coneHeight / 2, 0)
    coneMesh = new THREE.Mesh(coneGeo, coneMaterial())
    coneMesh.position.y = -0.04
    coneMesh.renderOrder = 100
    group.add(coneMesh)

    // Per-cell lens segments and mini cones
    const effectiveCells = Math.max(1, cellCount)
    if (effectiveCells > 1) {
      cellLenses = []
      cellCones = []
      const cellWidth = (stripWidth * 0.9) / effectiveCells
      const startX = -((effectiveCells - 1) * cellWidth) / 2

      for (let c = 0; c < effectiveCells; c++) {
        const cx = startX + c * cellWidth

        // Cell lens
        const cellLensGeo = new THREE.PlaneGeometry(cellWidth * 0.85, 0.035)
        const cellLensMesh = new THREE.Mesh(cellLensGeo, lensMaterial())
        cellLensMesh.position.set(cx, -0.04, 0)
        cellLensMesh.rotation.x = -Math.PI / 2
        group.add(cellLensMesh)
        cellLenses.push(cellLensMesh)

        // Cell cone
        const cellConeRadius = cellWidth * 0.6
        const cellConeGeo = new THREE.ConeGeometry(cellConeRadius, coneHeight * 0.6, 8, 1, true)
        cellConeGeo.translate(0, -coneHeight * 0.3, 0)
        const cellConeMesh = new THREE.Mesh(cellConeGeo, coneMaterial())
        cellConeMesh.position.set(cx, -0.04, 0)
        cellConeMesh.renderOrder = 100
        group.add(cellConeMesh)
        cellCones.push(cellConeMesh)
      }
    }

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
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 48, 1, true)
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

  // SpotLight — for moving heads, attach to headGroup so it follows pan/tilt
  const spotLight = new THREE.SpotLight(0xffffff, 0, 14, beamAngleRad * 1.1, 0.25, 1.5)
  spotLight.castShadow = false
  spotLight.userData.baseAngle = beamAngleRad * 1.1  // preserve for per-frame reset
  const spotTarget = new THREE.Object3D()
  if (headGroup) {
    // Moving head: spotlight follows the head's orientation
    spotTarget.position.set(0, 0, 6)  // Target along +Z (beam direction in head space after rotateX)
    headGroup.add(spotLight)
    headGroup.add(spotTarget)
  } else {
    // Static fixture: spotlight points straight down from fixture body
    spotTarget.position.set(0, -6, 0)
    group.add(spotLight)
    group.add(spotTarget)
  }
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
    shape,
    cellLenses,
    cellCones
  }
}

export function setFixtureSelected(objects: FixtureObjects, selected: boolean): void {
  const color = selected ? SELECTED_COLOR : BODY_COLOR
  ;(objects.bodyMesh.material as THREE.MeshBasicMaterial).color.setHex(color)
}
