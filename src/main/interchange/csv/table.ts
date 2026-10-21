// ============================================================
// CSV / TSV text → rows. Encoding (UTF-8 with or without BOM, else
// Windows-1252 as written by a French Excel), delimiter detection
// (, ; tab) and RFC 4180 quoting.
// ============================================================

export type Delimiter = ',' | ';' | '\t'

const DELIMITERS: Delimiter[] = ['\t', ';', ',']

/** Bytes → text: UTF-8 (BOM stripped), falling back to Windows-1252 */
export function decodeText(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      text = new TextDecoder('windows-1252').decode(bytes)
    } catch {
      text = new TextDecoder('latin1').decode(bytes)
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Occurrences of `d` outside quotes in one line */
function countOutsideQuotes(line: string, d: string): number {
  let n = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === d && !quoted) n++
  }
  return n
}

/**
 * The delimiter that splits the first lines most consistently (same count
 * on most lines, at least 1). Excel's "sep=;" first line wins.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0).slice(0, 30)
  const sep = /^sep=(.)\s*$/i.exec(lines[0] ?? '')
  if (sep && (DELIMITERS as string[]).includes(sep[1])) return sep[1] as Delimiter
  let best: { d: Delimiter; score: number } = { d: ',', score: -1 }
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d))
    if (counts.length === 0) continue
    const freq = new Map<number, number>()
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1)
    if (freq.size === 0) continue
    // the most common count, weighted by how many lines share it and how many columns it gives
    let modeCount = 0
    let modeLines = 0
    for (const [c, n] of freq) if (n > modeLines || (n === modeLines && c > modeCount)) { modeCount = c; modeLines = n }
    const score = modeLines / counts.length * 100 + Math.min(modeCount, 30)
    if (score > best.score) best = { d, score }
  }
  return best.d
}

/** RFC 4180 rows (quoted fields, doubled quotes, newlines inside quotes) */
export function parseRows(text: string, delimiter: Delimiter, maxRows = 100_000): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const n = text.length
  const endRow = () => {
    row.push(field)
    field = ''
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row)
    row = []
  }
  while (i < n) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field.trim() === '') { field = ''; quoted = true; i++; continue }
    if (c === delimiter) { row.push(field); field = ''; i++; continue }
    if (c === '\r' || c === '\n') {
      endRow()
      if (rows.length >= maxRows) return rows
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) endRow()
  // Excel "sep=;" hint line
  if (rows.length > 0 && rows[0].length <= 2 && /^sep=.?$/i.test(rows[0].join(delimiter).trim())) rows.shift()
  return rows.map((r) => r.map((f) => f.trim()))
}

/** Quote a cell when needed */
export function csvCell(value: string | number | undefined | null, delimiter: Delimiter): string {
  const s = value === undefined || value === null ? '' : String(value)
  if (s.includes('"') || s.includes(delimiter) || /[\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
