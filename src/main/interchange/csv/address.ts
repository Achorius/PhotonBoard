// ============================================================
// DMX address notations found in patch tables:
//   "1.001", "1/1", "1:1", "U2.017", "2-017"  universe + address (1-based universe)
//   "513"                                       absolute address (universe 2, address 1)
//   "17" + a universe column                    address within that universe
// ============================================================

import { DMX_CHANNELS_PER_UNIVERSE } from '../../../shared/types'

export interface ParsedAddress {
  /** As written: 1-based unless the file uses universe 0 */
  universe?: number
  address: number
  /** "513" style: universe derived from the absolute address (0-based) */
  absolute?: boolean
}

/** Parse one address cell; null when it is not an address */
export function parseAddressCell(raw: string): ParsedAddress | null {
  const s = String(raw ?? '').trim().replace(/^(u|univ|universe|uni)\s*/i, '')
  if (!s) return null
  let m = /^(\d{1,5})\s*[./:]\s*(\d{1,3})$/.exec(s) ?? /^(\d{1,5})\s*-\s*(\d{3})$/.exec(s)
  if (m) {
    const address = parseInt(m[2], 10)
    if (address < 1 || address > DMX_CHANNELS_PER_UNIVERSE) return null
    return { universe: parseInt(m[1], 10), address }
  }
  m = /^(\d{1,7})$/.exec(s)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n < 1) return null
    if (n > DMX_CHANNELS_PER_UNIVERSE) return { address: n, absolute: true }
    return { address: n }
  }
  return null
}

/** Parse a universe cell ("2", "U2", "Univ 2") */
export function parseUniverseCell(raw: string): number | null {
  const m = /^(?:u|univ|universe|uni|univers)?\s*(\d{1,5})$/i.exec(String(raw ?? '').trim())
  return m ? parseInt(m[1], 10) : null
}

/** Absolute address (1-based, "513") → 0-based universe + address */
export function splitAbsolute(n: number): { universe: number; address: number } {
  return { universe: Math.floor((n - 1) / DMX_CHANNELS_PER_UNIVERSE), address: ((n - 1) % DMX_CHANNELS_PER_UNIVERSE) + 1 }
}
