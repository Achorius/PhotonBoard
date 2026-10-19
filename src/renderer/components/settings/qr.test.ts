import { describe, expect, it } from 'vitest'
import { encodeQr, qrToSvgPath } from './qr'

// Reference matrix produced by python-qrcode 8 (byte mode, ECC M, mask 6)
const REFERENCE = [
  '1111111011111100101111111',
  '1000001010000100001000001',
  '1011101011111100001011101',
  '1011101001001111101011101',
  '1011101010011000001011101',
  '1000001001111100001000001',
  '1111111010101010101111111',
  '0000000000100110000000000',
  '1001111111000001010010111',
  '0001110111100101110011110',
  '0000101010010111011111001',
  '1001000100001001010011111',
  '1111001011110010111000001',
  '1001100010101001000110010',
  '1110101000000101110001111',
  '1001010010101000100010101',
  '1000111010111110111110110',
  '0000000010110011100010010',
  '1111111010001110101011001',
  '1000001011110110100010001',
  '1011101010111001111111000',
  '1011101010001100001101011',
  '1011101000110010000010111',
  '1000001001011011011110111',
  '1111111010110011101001001'
]

const rows = (m: boolean[][]) => m.map((r) => r.map((v) => (v ? '1' : '0')).join(''))

describe('encodeQr', () => {
  it('matches a reference encoder module for module', () => {
    const qr = encodeQr('http://192.168.1.42:9091', 'M', { mask: 6 })
    expect(qr.version).toBe(2)
    expect(rows(qr.modules)).toEqual(REFERENCE)
  })

  it('picks the smallest version that fits and grows with the data', () => {
    expect(encodeQr('hi', 'M').version).toBe(1)
    const long = encodeQr('x'.repeat(200), 'M')
    expect(long.version).toBeGreaterThanOrEqual(7) // version-info blocks drawn
    expect(long.size).toBe(long.version * 4 + 17)
  })

  it('draws the three finder patterns', () => {
    const { modules, size } = encodeQr('http://10.0.0.5:9091/?pin=ABCD1234', 'M')
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      expect(modules[y][x]).toBe(true)
      expect(modules[y + 1][x + 1]).toBe(false)
      expect(modules[y + 3][x + 3]).toBe(true)
    }
  })

  it('throws when the text cannot fit', () => {
    expect(() => encodeQr('z'.repeat(4000), 'H')).toThrow()
  })

  it('renders an SVG path with a quiet zone', () => {
    const qr = encodeQr('a', 'L')
    expect(qrToSvgPath(qr, 4).startsWith('M4 4h1v1h-1z')).toBe(true)
  })
})
