// ============================================================
// PhotonBoard — Procedural Gobo Textures
// Generates gobo patterns as Three.js DataTextures using Canvas.
// White = light passes through, Black = blocked.
// ============================================================

import * as THREE from 'three'

const GOBO_SIZE = 256
const GOBO_COUNT = 7

let _cache: THREE.DataTexture[] | null = null

/**
 * Get gobo texture by index (1-7). Returns null for 0 (open).
 */
export function getGoboTexture(index: number): THREE.DataTexture | null {
  if (index <= 0 || index > GOBO_COUNT) return null
  if (!_cache) _cache = generateAllGobos()
  return _cache[index - 1]
}

/**
 * Resolve a gobo DMX value (0-255) to a gobo index (0 = open, 1-7 = gobos).
 */
export function dmxToGoboIndex(dmxValue: number): number {
  if (dmxValue <= 7) return 0   // Open
  if (dmxValue <= 15) return 1  // Gobo 1
  if (dmxValue <= 23) return 2  // Gobo 2
  if (dmxValue <= 31) return 3  // Gobo 3
  if (dmxValue <= 39) return 4  // Gobo 4
  if (dmxValue <= 47) return 5  // Gobo 5
  if (dmxValue <= 55) return 6  // Gobo 6
  if (dmxValue <= 63) return 7  // Gobo 7
  // 64-127: gobo shake (use last selected gobo — handled by caller)
  // 128-255: gobo scroll (animated — handled by caller)
  if (dmxValue <= 127) return Math.floor((dmxValue - 64) / 9) + 1
  return Math.floor(((dmxValue - 128) % 112) / 16) + 1
}

/**
 * Check if DMX value indicates gobo rotation.
 */
export function isGoboRotating(dmxValue: number, goboRotation: number): boolean {
  return goboRotation > 0
}

function generateAllGobos(): THREE.DataTexture[] {
  return [
    generateGobo1(), // thick ring / breakup
    generateGobo2(), // tri-dots
    generateGobo3(), // 4-point star
    generateGobo4(), // spiral/swirl
    generateGobo5(), // radial lines
    generateGobo6(), // dots grid
    generateGobo7(), // broken circle
  ]
}

function createCanvas(): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(GOBO_SIZE, GOBO_SIZE)
  const ctx = canvas.getContext('2d')!
  // Start black (blocked)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, GOBO_SIZE, GOBO_SIZE)
  return { canvas, ctx }
}

function canvasToTexture(canvas: OffscreenCanvas): THREE.DataTexture {
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.getImageData(0, 0, GOBO_SIZE, GOBO_SIZE)
  // Convert RGBA to single-channel (use red channel as alpha)
  const data = new Uint8Array(GOBO_SIZE * GOBO_SIZE * 4)
  for (let i = 0; i < imageData.data.length; i += 4) {
    const brightness = imageData.data[i] // red channel
    data[i] = 255     // r
    data[i + 1] = 255 // g
    data[i + 2] = 255 // b
    data[i + 3] = brightness // alpha = brightness
  }
  const tex = new THREE.DataTexture(data, GOBO_SIZE, GOBO_SIZE, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  return tex
}

const C = GOBO_SIZE / 2
const R = GOBO_SIZE / 2 - 8

// ── Gobo 1: Thick ring (breakup) ──
function generateGobo1(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(C, C, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(C, C, R * 0.55, 0, Math.PI * 2)
  ctx.fill()
  return canvasToTexture(canvas)
}

// ── Gobo 2: Triangle of 3 dots ──
function generateGobo2(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.fillStyle = '#fff'
  const dotR = R * 0.3
  const dist = R * 0.45
  for (let i = 0; i < 3; i++) {
    const angle = (i * 120 - 90) * (Math.PI / 180)
    ctx.beginPath()
    ctx.arc(C + Math.cos(angle) * dist, C + Math.sin(angle) * dist, dotR, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvasToTexture(canvas)
}

// ── Gobo 3: 4-point star ──
function generateGobo3(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  const points = 4
  const outerR = R * 0.95
  const innerR = R * 0.25
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI / points) - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const x = C + Math.cos(angle) * r
    const y = C + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  return canvasToTexture(canvas)
}

// ── Gobo 4: Spiral/swirl ──
function generateGobo4(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = R * 0.18
  ctx.lineCap = 'round'
  const arms = 3
  for (let a = 0; a < arms; a++) {
    ctx.beginPath()
    const baseAngle = (a * 360 / arms) * (Math.PI / 180)
    for (let t = 0; t <= 1; t += 0.01) {
      const angle = baseAngle + t * Math.PI * 1.5
      const r = t * R * 0.9
      const x = C + Math.cos(angle) * r
      const y = C + Math.sin(angle) * r
      if (t === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return canvasToTexture(canvas)
}

// ── Gobo 5: Radial lines (fan) ──
function generateGobo5(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.fillStyle = '#fff'
  const lineCount = 8
  for (let i = 0; i < lineCount; i++) {
    const angle = (i * 360 / lineCount) * (Math.PI / 180)
    const halfWidth = (Math.PI / lineCount) * 0.45
    ctx.beginPath()
    ctx.moveTo(C, C)
    ctx.arc(C, C, R, angle - halfWidth, angle + halfWidth)
    ctx.closePath()
    ctx.fill()
  }
  return canvasToTexture(canvas)
}

// ── Gobo 6: Dots grid ──
function generateGobo6(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.fillStyle = '#fff'
  const gridSize = 5
  const spacing = GOBO_SIZE / (gridSize + 1)
  const dotR = spacing * 0.28
  for (let row = 1; row <= gridSize; row++) {
    for (let col = 1; col <= gridSize; col++) {
      const x = col * spacing
      const y = row * spacing
      const dist = Math.sqrt((x - C) ** 2 + (y - C) ** 2)
      if (dist < R - dotR) {
        ctx.beginPath()
        ctx.arc(x, y, dotR, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  return canvasToTexture(canvas)
}

// ── Gobo 7: Broken circle (gap ring) ──
function generateGobo7(): THREE.DataTexture {
  const { canvas, ctx } = createCanvas()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = R * 0.15
  ctx.lineCap = 'round'
  const gaps = 4
  const gapAngle = 0.25 // radians
  for (let i = 0; i < gaps; i++) {
    const start = (i * Math.PI * 2 / gaps) + gapAngle / 2
    const end = ((i + 1) * Math.PI * 2 / gaps) - gapAngle / 2
    ctx.beginPath()
    ctx.arc(C, C, R * 0.7, start, end)
    ctx.stroke()
  }
  // Small center dot
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(C, C, R * 0.12, 0, Math.PI * 2)
  ctx.fill()
  return canvasToTexture(canvas)
}
