// ============================================================
// Minimal QR code encoder (byte mode, versions 1-40, ECC L/M/Q/H).
// Offline and dependency-free: used for the web-remote URL in
// Settings. Follows ISO/IEC 18004 (structure after Nayuki's
// reference implementation). Unit-tested against python-qrcode.
// ============================================================

export type QrEcc = 'L' | 'M' | 'Q' | 'H'

export interface QrCode {
  version: number
  size: number
  mask: number
  ecc: QrEcc
  /** modules[y][x] — true = dark */
  modules: boolean[][]
}

// Index 0 unused (versions are 1-based)
const ECC_CODEWORDS_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
}

const NUM_ECC_BLOCKS: Record<QrEcc, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
}

const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 }

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0
}

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function numDataCodewords(ver: number, ecc: QrEcc): number {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ECC_BLOCKS[ecc][ver]
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

// ---- Reed-Solomon over GF(2^8), polynomial 0x11D ----

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

/**
 * Encode `text` (UTF-8, byte mode) into the smallest version that fits.
 * `mask` forces a mask pattern (tests); otherwise the lowest-penalty one is used.
 */
export function encodeQr(text: string, ecc: QrEcc = 'M', opts: { mask?: number; minVersion?: number } = {}): QrCode {
  const bytes = utf8Bytes(text)
  let version = Math.max(1, opts.minVersion ?? 1)
  for (; ; version++) {
    if (version > 40) throw new Error('Text too long for a QR code')
    const countBits = version <= 9 ? 8 : 16
    const needed = 4 + countBits + bytes.length * 8
    if (bytes.length < 1 << countBits && needed <= numDataCodewords(version, ecc) * 8) break
  }

  // ---- Data bits ----
  const bits: number[] = []
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  push(0b0100, 4)
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  const capacity = numDataCodewords(version, ecc) * 8
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    data.push(b)
  }

  // ---- ECC + interleave ----
  const numBlocks = NUM_ECC_BLOCKS[ecc][version]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version]
  const rawCodewords = Math.floor(numRawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(blockEccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1))
    k += dat.length
    const eccBytes = rsRemainder(dat, divisor)
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(eccBytes))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i])
    })
  }

  // ---- Function patterns ----
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunction[y][x] = true }

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0)
    setFn(i, 6, i % 2 === 0)
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4)
      }
    }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const align = alignmentPositions(version, size)
  const n = align.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  const drawFormat = (mask: number) => {
    const fmt = (ECC_FORMAT_BITS[ecc] << 3) | mask
    let rem = fmt
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const fbits = ((fmt << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(fbits, i))
    setFn(8, 7, getBit(fbits, 6))
    setFn(8, 8, getBit(fbits, 7))
    setFn(7, 8, getBit(fbits, 8))
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(fbits, i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(fbits, i))
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(fbits, i))
    setFn(8, size - 8, true)
  }
  drawFormat(0) // reserve the area

  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const vbits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = getBit(vbits, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFn(a, b, bit)
      setFn(b, a, bit)
    }
  }

  // ---- Codewords (zig-zag) ----
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7))
          bitIndex++
        }
      }
    }
  }

  // ---- Mask ----
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue
        let invert: boolean
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break
          case 1: invert = y % 2 === 0; break
          case 2: invert = x % 3 === 0; break
          case 3: invert = (x + y) % 3 === 0; break
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
        }
        if (invert) modules[y][x] = !modules[y][x]
      }
    }
  }

  let mask = opts.mask ?? -1
  if (mask < 0) {
    let best = Infinity
    for (let m = 0; m < 8; m++) {
      applyMask(m)
      drawFormat(m)
      const p = penalty(modules)
      if (p < best) { best = p; mask = m }
      applyMask(m) // undo (XOR)
    }
  }
  applyMask(mask)
  drawFormat(mask)
  return { version, size, mask, ecc, modules }
}

/** Standard mask penalty (rules N1-N4) */
function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  const line = (get: (i: number) => boolean) => {
    let runColor = get(0)
    let run = 1
    for (let i = 1; i <= size; i++) {
      const c = i < size ? get(i) : !runColor
      if (i < size && c === runColor) { run++; continue }
      if (run >= 5) score += 3 + (run - 5)
      runColor = c
      run = 1
    }
    // Finder-like 1:1:3:1:1 with 4 light modules on one side
    const at = (i: number) => (i >= 0 && i < size ? get(i) : false)
    for (let i = 0; i + 6 < size; i++) {
      if (at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6)) {
        const before = !at(i - 1) && !at(i - 2) && !at(i - 3) && !at(i - 4)
        const after = !at(i + 7) && !at(i + 8) && !at(i + 9) && !at(i + 10)
        if (before || after) score += 40
      }
    }
  }
  for (let y = 0; y < size; y++) line((i) => m[y][i])
  for (let x = 0; x < size; x++) line((i) => m[i][x])
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }
  }
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  score += Math.max(0, k) * 10
  return score
}

/** SVG path ("M x y h1 v1 h-1 z" per dark module) offset by a quiet zone */
export function qrToSvgPath(qr: QrCode, border = 4): string {
  const parts: string[] = []
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) parts.push(`M${x + border} ${y + border}h1v1h-1z`)
    }
  }
  return parts.join('')
}
