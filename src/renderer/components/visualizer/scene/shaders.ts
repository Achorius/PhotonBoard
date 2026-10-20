// ============================================================
// Beam + light-pool shaders. Both are compiled once (shared program)
// and only ever change uniforms at runtime — never defines, maps or
// light counts — so switching gobos / colours never recompiles.
// ============================================================

import * as THREE from 'three'

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
uniform float uLength;
uniform float uGoboIndex;
uniform float uGoboRotation;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

// Procedural gobo slices on the beam shell (0 = blocked, 1 = open)
float goboPattern(float idx, float angle) {
  if (idx < 1.5) return smoothstep(-0.1, 0.2, sin(6.0 * angle));
  if (idx < 2.5) return smoothstep(-0.05, 0.3, sin(3.0 * angle));
  if (idx < 3.5) return smoothstep(-0.1, 0.3, cos(4.0 * angle));
  if (idx < 4.5) return smoothstep(-0.15, 0.25, sin(3.0 * angle + vUv.y * 9.0));
  if (idx < 5.5) return smoothstep(0.2, 0.5, cos(8.0 * angle));
  if (idx < 6.5) return smoothstep(-0.1, 0.2, sin(5.0 * angle) * sin(vUv.y * 14.0));
  float seg = sin(4.0 * angle);
  float gap = smoothstep(0.8, 0.9, abs(cos(2.0 * angle)));
  return smoothstep(-0.1, 0.3, seg) * (1.0 - gap);
}

void main() {
  float t = 1.0 - vUv.y;            // 0 at the lens, 1 where the beam lands
  float dist = t * uLength;          // metres from the lens
  float axial = 0.18 + 0.82 * exp(-dist * 0.2);
  float endFade = 1.0 - 0.55 * smoothstep(0.82, 1.0, t);
  float fres = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float edge = pow(fres, 1.5);
  float gobo = 1.0;
  if (uGoboIndex > 0.5) {
    float pattern = goboPattern(uGoboIndex, vUv.x * 6.28318 + uGoboRotation);
    gobo = mix(1.0, mix(0.05, 1.0, pattern), smoothstep(0.0, 0.08, t));
    edge = pow(fres, 0.8);
  }
  gl_FragColor = vec4(uColor, uOpacity * axial * endFade * edge * gobo);
}
`

export function createBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uOpacity: { value: 0 },
      uLength: { value: 10 },
      uGoboIndex: { value: 0 },
      uGoboRotation: { value: 0 }
    },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  })
}

const POOL_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const POOL_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uRotation;
uniform float uSoftness;
uniform vec3 uMin;
uniform vec3 uMax;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  // Clip to the room so pools never spill past a wall edge into the void
  if (any(lessThan(vWorld, uMin)) || any(greaterThan(vWorld, uMax))) discard;
  vec2 p = vUv - 0.5;
  float c = cos(uRotation);
  float s = sin(uRotation);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float r = length(p) * 2.0;
  float mask = 1.0 - smoothstep(1.0 - uSoftness, 1.0, r);
  float g = texture2D(uMap, p + 0.5).r;
  float hot = 0.7 + 0.3 * (1.0 - r * r);
  gl_FragColor = vec4(uColor, uIntensity * mask * g * hot);
}
`

/** Light pool where a beam lands (floor / walls / ceiling), with gobo projection */
export function createPoolMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uIntensity: { value: 0 },
      uRotation: { value: 0 },
      uSoftness: { value: 0.35 },
      uMin: { value: new THREE.Vector3(-1e3, -1e3, -1e3) },
      uMax: { value: new THREE.Vector3(1e3, 1e3, 1e3) }
    },
    vertexShader: POOL_VERTEX,
    fragmentShader: POOL_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })
}
