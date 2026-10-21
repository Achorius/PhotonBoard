// ============================================================
// PhotonBoard — stable name-based UUIDs (RFC 4122 version 5
// layout, SHA-1 of namespace + key). The same PhotonBoard object
// always exports with the same UUID, so MVR / GDTF consumers can
// track it across exports (MVR Annex B).
// ============================================================

import { createHash } from 'crypto'

export function stableUuid(namespace: string, key: string): string {
  const h = createHash('sha1').update(`${namespace}\u0000${key}`, 'utf8').digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = b.toString('hex').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Normalise "4A B1 94 62 …" / braces / lower case into the canonical upper-case form, or null */
export function normalizeUuid(raw: string | undefined | null): string | null {
  if (!raw) return null
  const hex = raw.replace(/[{}\s-]/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null
  if (/^0+$/.test(hex)) return null
  const u = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase()
  return UUID_RE.test(u) ? u : null
}
