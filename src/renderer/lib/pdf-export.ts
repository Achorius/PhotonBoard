import { jsPDF } from 'jspdf'
import type { PatchEntry, FixtureDefinition, RoomConfig, Group } from '@shared/types'
import { getFixtureShape } from '@shared/types'

const MARGIN = 20
const TITLE_HEIGHT = 30

/**
 * Export the stage layout as a PDF lighting plot.
 * Uses jsPDF to draw vector shapes for each fixture type.
 */
export function exportStagePDF(
  patch: PatchEntry[],
  fixtures: FixtureDefinition[],
  roomConfig: RoomConfig,
  showName: string,
  groups: Group[] = []
): void {
  const { width: roomW, depth: roomD, height: roomH } = roomConfig

  // A4 portrait
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // Reserve space: title + plan + legend + patch table
  // Estimate table height: header + rows (3.5mm per row), capped to leave room for the plan
  const tableRowH = 3.5
  const tableHeaderH = 5
  const tableEstH = Math.min(tableHeaderH + patch.length * tableRowH + 8, pageH * 0.35)
  const legendH = 14

  // Scale: fit room into available area above the table
  const drawW = pageW - MARGIN * 2
  const drawH = pageH - MARGIN * 2 - TITLE_HEIGHT - legendH - tableEstH
  const scale = Math.min(drawW / roomW, drawH / roomD)
  const offsetX = MARGIN + (drawW - roomW * scale) / 2
  const offsetY = MARGIN + TITLE_HEIGHT + (drawH - roomD * scale) / 2

  // --- Title ---
  doc.setFontSize(16)
  doc.setTextColor(0)
  doc.text(showName || 'Lighting Plot', pageW / 2, MARGIN + 8, { align: 'center' })
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(
    `Room: ${roomW}m x ${roomD}m x ${roomH}m  |  ${patch.length} fixtures  |  ${new Date().toLocaleDateString()}`,
    pageW / 2, MARGIN + 15, { align: 'center' }
  )

  // --- Room outline ---
  doc.setDrawColor(100)
  doc.setLineWidth(0.5)
  doc.rect(offsetX, offsetY, roomW * scale, roomD * scale)

  // Stage edge (center horizontal line)
  doc.setDrawColor(200, 100, 0)
  doc.setLineWidth(0.3)
  doc.setLineDashPattern([3, 2], 0)
  const stageY = offsetY + roomD * scale / 2
  doc.line(offsetX, stageY, offsetX + roomW * scale, stageY)
  doc.setLineDashPattern([], 0)

  // Labels — stage at top, audience at bottom
  doc.setFontSize(6)
  doc.setTextColor(150)
  doc.text('UPSTAGE', offsetX + roomW * scale / 2, stageY - 2, { align: 'center' })
  doc.text('AUDIENCE', offsetX + roomW * scale / 2, stageY + 5, { align: 'center' })

  // Truss lines from roomConfig
  doc.setDrawColor(160, 160, 180)
  doc.setLineWidth(0.3)
  const trussBars = roomConfig.trussBars ?? []
  for (const bar of trussBars) {
    const barHalfW = (bar.width ?? roomW) / 2
    const ty = offsetY + (roomD / 2 - bar.z) * scale  // flipped Z
    const leftX = offsetX + (roomW / 2 - barHalfW) * scale
    const rightX = offsetX + (roomW / 2 + barHalfW) * scale
    doc.line(leftX + 2, ty, rightX - 2, ty)
    doc.setFontSize(5)
    doc.setTextColor(120)
    doc.text(bar.name, leftX, ty - 1)
  }

  // --- Fixtures ---
  const autoPositions = computeAutoPositions(patch, roomConfig)

  for (let i = 0; i < patch.length; i++) {
    const entry = patch[i]
    const def = fixtures.find(f => f.id === entry.fixtureDefId)
    const shape = getFixtureShape(def?.categories || [])
    const pos = entry.position3D
    const wx = pos?.x ?? autoPositions[i].x
    const wz = pos?.z ?? autoPositions[i].z

    // Convert world coords to PDF coords (flip Z: +Z upstage = top of page)
    const px = offsetX + (roomW / 2 + wx) * scale
    const py = offsetY + (roomD / 2 - wz) * scale
    const iconSize = 4 // mm

    // Draw fixture icon — USITT-style lighting plot symbols
    doc.setLineWidth(0.3)
    doc.setDrawColor(30)
    drawFixtureIcon(doc, px, py, iconSize, shape, def?.categories || [])

    // Labels
    doc.setFontSize(5)
    doc.setTextColor(0)
    doc.text(entry.name, px, py + iconSize / 2 + 3, { align: 'center' })
    doc.setFontSize(4)
    doc.setTextColor(100)
    doc.text(`U${entry.universe + 1}.${entry.address}`, px, py + iconSize / 2 + 6, { align: 'center' })
  }

  // --- Legend + Scale (compact row below the plan) ---
  const planBottom = offsetY + roomD * scale + 4
  doc.setFontSize(6)
  doc.setTextColor(80)

  const legendItems = [
    { label: 'PAR / Wash', draw: (x: number, y: number) => drawFixtureIcon(doc, x, y, 3, 'par', ['PAR']) },
    { label: 'Moving Head', draw: (x: number, y: number) => drawFixtureIcon(doc, x, y, 3, 'moving-head', ['Moving Head']) },
    { label: 'Fresnel', draw: (x: number, y: number) => drawFixtureIcon(doc, x, y, 3, 'par', ['Fresnel']) },
    { label: 'Strip / Batten', draw: (x: number, y: number) => drawFixtureIcon(doc, x, y, 3, 'strip', ['Pixel Bar']) },
    { label: 'Profile', draw: (x: number, y: number) => drawFixtureIcon(doc, x, y, 3, 'par', ['Profile']) },
  ]

  let lx = MARGIN
  for (const item of legendItems) {
    item.draw(lx + 3, planBottom + 1)
    doc.setFontSize(5)
    doc.setTextColor(60)
    doc.text(item.label, lx + 7, planBottom + 2.5)
    lx += 30
  }
  doc.setFontSize(5)
  doc.setTextColor(100)
  doc.text(`Scale: 1m = ${scale.toFixed(1)}mm`, pageW - MARGIN, planBottom + 2.5, { align: 'right' })

  // --- Patch Table (below legend) ---
  const tableTop = planBottom + 8
  const totalW = pageW - MARGIN * 2
  // Fixed-width columns, name gets the remaining space
  const fixedW = { num: 7, mfr: 28, type: 30, mode: 18, addr: 17, chCount: 8, group: 22 }
  const nameW = totalW - fixedW.num - fixedW.mfr - fixedW.type - fixedW.mode - fixedW.addr - fixedW.chCount - fixedW.group

  let cx = MARGIN
  const colX = {
    num: cx,      name: (cx += fixedW.num),
    mfr: (cx += nameW), type: (cx += fixedW.mfr),
    mode: (cx += fixedW.type), addr: (cx += fixedW.mode),
    chCount: (cx += fixedW.addr), group: (cx += fixedW.chCount),
  }

  const rowH = 3.5
  let ty = tableTop

  // Table title
  doc.setFontSize(7)
  doc.setTextColor(0)
  doc.text('Patch List', MARGIN, ty)
  ty += 4

  // Header row
  const drawTableHeader = (y: number) => {
    doc.setFillColor(230, 230, 240)
    doc.rect(MARGIN, y - 2.5, totalW, 4, 'F')
    doc.setFontSize(5.5)
    doc.setTextColor(40)
    doc.text('#', colX.num + 1, y)
    doc.text('Name', colX.name + 1, y)
    doc.text('Manufacturer', colX.mfr + 1, y)
    doc.text('Type', colX.type + 1, y)
    doc.text('Mode', colX.mode + 1, y)
    doc.text('Addr', colX.addr + 1, y)
    doc.text('Ch', colX.chCount + 1, y)
    doc.text('Group', colX.group + 1, y)
  }
  drawTableHeader(ty)
  ty += rowH + 1

  // Header line
  doc.setDrawColor(180)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, ty - rowH + 0.5, MARGIN + totalW, ty - rowH + 0.5)

  // Sort fixtures by universe then address
  const sorted = [...patch].sort((a, b) => a.universe - b.universe || a.address - b.address)

  for (let i = 0; i < sorted.length; i++) {
    // Check page overflow — add new page if needed
    if (ty > pageH - 12) {
      doc.addPage()
      ty = MARGIN + 5
      drawTableHeader(ty)
      ty += rowH + 1
      doc.setDrawColor(180)
      doc.setLineWidth(0.2)
      doc.line(MARGIN, ty - rowH + 0.5, MARGIN + totalW, ty - rowH + 0.5)
    }

    const entry = sorted[i]
    const def = fixtures.find(f => f.id === entry.fixtureDefId)
    const mode = def?.modes.find(m => m.name === entry.modeName)
    const entryGroups = groups
      .filter(g => entry.groupIds?.includes(g.id))
      .map(g => g.name)

    // Alternating row background
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 252)
      doc.rect(MARGIN, ty - 2.5, totalW, rowH, 'F')
    }

    doc.setFontSize(5)
    doc.setTextColor(80)
    doc.text(`${i + 1}`, colX.num + 1, ty)

    doc.setTextColor(20)
    doc.text(entry.name.substring(0, 22), colX.name + 1, ty)

    doc.setTextColor(100)
    doc.text((def?.manufacturer || '').substring(0, 18), colX.mfr + 1, ty)

    doc.setTextColor(80)
    doc.text((def?.name || '?').substring(0, 20), colX.type + 1, ty)

    doc.setTextColor(100)
    doc.text((entry.modeName || '').substring(0, 10), colX.mode + 1, ty)

    doc.setTextColor(0)
    doc.setFontSize(5.5)
    doc.text(`U${entry.universe + 1}.${String(entry.address).padStart(3, '0')}`, colX.addr + 1, ty)

    doc.setFontSize(5)
    doc.setTextColor(100)
    doc.text(`${mode?.channelCount || '?'}`, colX.chCount + 1, ty)

    doc.setTextColor(80)
    doc.text(entryGroups.join(', ').substring(0, 16), colX.group + 1, ty)

    ty += rowH
  }

  // Table bottom border
  doc.setDrawColor(180)
  doc.setLineWidth(0.15)
  doc.line(MARGIN, ty - rowH + 3, MARGIN + totalW, ty - rowH + 3)

  // Footer
  doc.setFontSize(5)
  doc.setTextColor(150)
  doc.text('Generated by PhotonBoard', pageW / 2, pageH - 5, { align: 'center' })

  // Save
  doc.save(`${showName || 'LightingPlot'}_${new Date().toISOString().slice(0, 10)}.pdf`)
}

function computeAutoPositions(
  patch: PatchEntry[],
  room: RoomConfig
): { x: number; z: number }[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(patch.length * 1.5)))
  const rows = Math.max(1, Math.ceil(patch.length / cols))
  return patch.map((_, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const colCount = Math.min(cols, patch.length)
    return {
      x: colCount > 1 ? (col / (colCount - 1) - 0.5) * room.width * 0.8 : 0,
      z: rows > 1 ? (row / (rows - 1) - 0.5) * room.depth * 0.6 : 0
    }
  })
}

/**
 * Draw USITT-style lighting fixture symbols on the PDF.
 * Industry-standard symbols for lighting plots.
 */
function drawFixtureIcon(
  doc: jsPDF,
  cx: number, cy: number,
  size: number,
  shape: string,
  categories: string[]
): void {
  const r = size / 2
  const isMovingHead = categories.some(c => c === 'Moving Head')
  const isFresnel = categories.some(c => c.toLowerCase().includes('fresnel'))
  const isProfile = categories.some(c =>
    c.toLowerCase().includes('profile') || c.toLowerCase().includes('ellipsoidal') || c.toLowerCase().includes('leko')
  )
  const isBlinder = categories.some(c => c.toLowerCase().includes('blinder'))
  const isStrobe = categories.some(c => c.toLowerCase().includes('strobe'))

  doc.setLineWidth(0.3)
  doc.setDrawColor(30)

  if (shape === 'moving-head') {
    // Moving head: circle with yoke arms and crosshair
    doc.setFillColor(240, 240, 250)
    doc.circle(cx, cy, r, 'FD')
    // Crosshair inside circle
    doc.setLineWidth(0.2)
    doc.line(cx - r * 0.6, cy, cx + r * 0.6, cy)
    doc.line(cx, cy - r * 0.6, cx, cy + r * 0.6)
    // Yoke arms
    doc.setLineWidth(0.4)
    doc.line(cx - r - 0.8, cy - r * 0.5, cx - r - 0.8, cy + r * 0.5)
    doc.line(cx + r + 0.8, cy - r * 0.5, cx + r + 0.8, cy + r * 0.5)
    // Connect arms
    doc.line(cx - r, cy, cx - r - 0.8, cy)
    doc.line(cx + r, cy, cx + r + 0.8, cy)
  } else if (shape === 'strip') {
    // LED strip/batten: long rectangle with LED dots
    doc.setFillColor(230, 230, 245)
    const w = size * 2.5, h = size * 0.5
    doc.rect(cx - w / 2, cy - h / 2, w, h, 'FD')
    // LED cells inside
    doc.setLineWidth(0.15)
    const cells = 5
    const cellW = w / cells
    for (let i = 1; i < cells; i++) {
      const lx = cx - w / 2 + i * cellW
      doc.line(lx, cy - h / 2, lx, cy + h / 2)
    }
  } else if (isFresnel) {
    // Fresnel: circle with concentric rings (fresnel lens)
    doc.setFillColor(235, 235, 250)
    doc.circle(cx, cy, r, 'FD')
    doc.setLineWidth(0.15)
    doc.circle(cx, cy, r * 0.65, 'S')
    doc.circle(cx, cy, r * 0.35, 'S')
  } else if (isProfile) {
    // Profile/ERS: ellipse with lens barrel
    doc.setFillColor(235, 235, 250)
    doc.ellipse(cx, cy, r, r * 0.75, 'FD')
    // Lens barrel pointing down (toward audience)
    doc.setFillColor(200, 200, 215)
    doc.rect(cx - r * 0.25, cy + r * 0.75, r * 0.5, r * 0.8, 'FD')
  } else if (isBlinder) {
    // Blinder: double rectangle
    doc.setFillColor(240, 240, 250)
    const bw = size * 0.8
    doc.rect(cx - bw - 0.3, cy - r * 0.6, bw, size * 0.6, 'FD')
    doc.rect(cx + 0.3, cy - r * 0.6, bw, size * 0.6, 'FD')
  } else if (isStrobe) {
    // Strobe: rectangle with zigzag
    doc.setFillColor(250, 250, 250)
    doc.rect(cx - r, cy - r * 0.5, size, r, 'FD')
    doc.setLineWidth(0.2)
    // Lightning bolt
    doc.line(cx - r * 0.3, cy - r * 0.3, cx + r * 0.1, cy)
    doc.line(cx + r * 0.1, cy, cx - r * 0.1, cy)
    doc.line(cx - r * 0.1, cy, cx + r * 0.3, cy + r * 0.3)
  } else {
    // PAR / Wash: circle with small dot in center (standard PAR symbol)
    doc.setFillColor(235, 235, 250)
    doc.circle(cx, cy, r, 'FD')
    doc.setFillColor(80, 80, 100)
    doc.circle(cx, cy, r * 0.2, 'F')
  }
}
