// ============================================================
// Patch table columns: header names (EN / FR / console wordings:
// grandMA, Eos, MagicQ, Lightwright, Vectorworks, Capture…) → fields,
// and a content-based guess when the file has no header row.
// ============================================================

import type { TabularField } from '../../../shared/interchange'

/** Compact header key: accents removed, lower case, letters and digits only ("N° Projo" → "nprojo") */
export function headerKey(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, '')
}

/** Header synonyms, compact (see headerKey) */
const SYNONYMS: Record<TabularField, string[]> = {
  fid: [
    'fid', 'fixtureid', 'fixid', 'fixtureno', 'fixtureno#', 'fixturenumber', 'fixturenum', 'fixno', 'fixnum', 'fixture#', 'fix#',
    'id', 'no', 'num', 'number', 'nr', '#', 'n', 'unitnumber', 'unitno', 'unit#', 'unit', 'channel', 'chan', 'ch', 'chno', 'channelnumber',
    'numero', 'nprojo', 'nprojecteur', 'numprojo', 'numeroprojecteur', 'circuit', 'circ', 'head', 'headno', 'headnumber'
  ],
  name: ['name', 'label', 'fixturename', 'fixturelabel', 'userlabel', 'nom', 'libelle', 'designation', 'nomprojecteur', 'headname', 'purpose', 'usage', 'fonction'],
  manufacturer: ['manufacturer', 'manuf', 'mfr', 'mfg', 'make', 'maker', 'brand', 'vendor', 'fabricant', 'marque', 'constructeur', 'fixturemanufacturer'],
  model: ['model', 'modele', 'fixturemodel', 'product', 'produit', 'modelname', 'reference', 'ref'],
  fixtureType: [
    'type', 'fixturetype', 'instrumenttype', 'instrument', 'device', 'devicetype', 'typeprojecteur', 'projecteur', 'appareil', 'headtype', 'fixture',
    'symbolname', 'unittype', 'lighttype', 'typedeprojecteur'
  ],
  mode: ['mode', 'dmxmode', 'personality', 'personnalite', 'modedmx', 'fixturemode', 'profile', 'profil'],
  channels: [
    'channels', 'channelcount', 'chcount', 'nbch', 'nbchannels', '#ch', '#channels', 'footprint', 'dmxfootprint', 'canaux', 'nbcanaux',
    'nombredecanaux', 'numberofchannels', 'width', 'dmxchannels', 'ch#'
  ],
  universe: ['universe', 'univ', 'uni', 'u', 'univers', 'line', 'dmxuniverse', 'dmxline', 'artnetuniverse', 'port', 'dmxport'],
  address: [
    'address', 'addr', 'adr', 'adresse', 'dmx', 'dmxaddress', 'dmxadr', 'dmxaddr', 'startaddress', 'startchannel', 'dmxchannel', 'patch',
    'adressedmx', 'dmxstart', 'start', 'absoluteaddress', 'absolute', 'dmxpatch', 'universeaddress', 'adresseabsolue'
  ],
  x: ['x', 'posx', 'positionx', 'locx', 'locationx', 'xpos', 'xlocation', 'xm', 'xmm', 'xcm', 'xft', 'xin'],
  y: ['y', 'posy', 'positiony', 'locy', 'locationy', 'ypos', 'ylocation', 'ym', 'ymm', 'ycm', 'yft', 'yin'],
  z: ['z', 'posz', 'positionz', 'locz', 'locationz', 'zpos', 'zlocation', 'zm', 'zmm', 'zcm', 'zft', 'zin', 'height', 'hauteur', 'trimheight'],
  rotX: ['rotx', 'rotationx', 'xrot', 'xrotation', 'rx', 'tiltangle'],
  rotY: ['roty', 'rotationy', 'yrot', 'yrotation', 'ry'],
  rotZ: ['rotz', 'rotationz', 'zrot', 'zrotation', 'rz', 'rotation', 'orientation', 'panangle'],
  groups: ['group', 'groups', 'groupe', 'groupes', 'layer', 'layers', 'calque', 'class', 'classe', 'groupname'],
  position: ['position', 'hangingposition', 'hangposition', 'pos', 'location', 'emplacement', 'lieu', 'perche', 'porteuse', 'pipe', 'truss', 'pont']
}

const LOOKUP = new Map<string, TabularField>()
for (const [field, keys] of Object.entries(SYNONYMS) as [TabularField, string[]][]) {
  for (const k of keys) if (!LOOKUP.has(k)) LOOKUP.set(k, field)
}

/** Unit suffix in a header ("X (mm)", "Height [ft]") → factor to metres */
export function headerUnitFactor(header: string): number {
  const h = String(header ?? '').toLowerCase()
  if (/\bmm\b|\(mm\)|\[mm\]/.test(h)) return 0.001
  if (/\bcm\b|\(cm\)|\[cm\]/.test(h)) return 0.01
  if (/\bft\b|feet|\(ft\)|'/.test(h)) return 0.3048
  if (/\bin\b|inch|\(in\)|"/.test(h)) return 0.0254
  return 1
}

/** Field of one header cell (null = unknown) */
export function fieldOfHeader(header: string): TabularField | null {
  const key = headerKey(header)
  if (!key) return null
  const direct = LOOKUP.get(key)
  if (direct) return direct
  // "X (m)", "Position X", "DMX Address" → without the unit / leading words
  const noUnit = headerKey(String(header).replace(/[([].*?[)\]]/g, ''))
  if (noUnit && LOOKUP.has(noUnit)) return LOOKUP.get(noUnit)!
  if (/^(fixture|fix|unit|head)?(id|no|num|number)$/.test(key)) return 'fid'
  if (/address|adresse/.test(key)) return 'address'
  if (/universe|univers/.test(key)) return 'universe'
  if (/manufacturer|fabricant|marque/.test(key)) return 'manufacturer'
  if (/channelcount|footprint|nbcanaux/.test(key)) return 'channels'
  return null
}

const ADDRESS_LIKE = /^(?:[uU]?\d{1,3}\s*[./:]\s*\d{1,3}|\d{1,5})$/

function columnValues(rows: string[][], col: number): string[] {
  return rows.map((r) => (r[col] ?? '').trim()).filter((v) => v !== '')
}

/** True when the first row reads as headers (words, at least two known) */
export function looksLikeHeader(row: string[]): boolean {
  const known = row.filter((c) => fieldOfHeader(c) !== null).length
  const numeric = row.filter((c) => /^-?\d+([.,]\d+)?$/.test(c.trim())).length
  return known >= 2 || (known >= 1 && numeric === 0)
}

/**
 * Columns of a table: from the headers when there are some, otherwise from
 * the content (a number column 1-9999 = fixture id, "1.001" / 1-512 = address,
 * text = name / type). Each field maps to one column at most.
 */
export function detectColumns(headers: string[] | null, dataRows: string[][]): { columns: (TabularField | null)[]; confident: boolean } {
  const width = Math.max(headers?.length ?? 0, ...dataRows.slice(0, 50).map((r) => r.length), 0)
  const columns: (TabularField | null)[] = new Array(width).fill(null)
  const taken = new Set<TabularField>()
  if (headers) {
    headers.forEach((h, i) => {
      const f = fieldOfHeader(h)
      if (f && !taken.has(f)) { columns[i] = f; taken.add(f) }
    })
    // "Channel" means the fixture number in Eos / Lightwright, unless an explicit id column exists too
    const hasType = taken.has('model') || taken.has('fixtureType') || taken.has('name')
    const hasPatch = taken.has('address')
    return { columns, confident: hasPatch && hasType }
  }
  // No header: guess from the values
  const sample = dataRows.slice(0, 50)
  for (let c = 0; c < width; c++) {
    const vals = columnValues(sample, c)
    if (vals.length === 0) continue
    const allAddress = vals.every((v) => ADDRESS_LIKE.test(v))
    const dotted = vals.some((v) => /[./:]/.test(v))
    const allInt = vals.every((v) => /^\d+$/.test(v))
    const textual = vals.some((v) => /[a-zA-Z]{2,}/.test(v))
    if (allAddress && dotted && !taken.has('address')) { columns[c] = 'address'; taken.add('address'); continue }
    if (allInt && !taken.has('fid') && c === 0) { columns[c] = 'fid'; taken.add('fid'); continue }
    if (allInt && !taken.has('address')) { columns[c] = 'address'; taken.add('address'); continue }
    if (textual && !taken.has('name')) { columns[c] = 'name'; taken.add('name'); continue }
    if (textual && !taken.has('fixtureType')) { columns[c] = 'fixtureType'; taken.add('fixtureType'); continue }
  }
  return { columns, confident: false }
}
