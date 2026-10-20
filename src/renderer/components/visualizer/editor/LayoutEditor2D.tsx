// ============================================================
// Stage plan (top view) — canvas editor.
//
// Draws: rulers, grid, room + stage area, centre line, stage edge, truss
// bars, focus lines and fixture symbols by type with their number and
// live colour / intensity.
//
// Input (pointer events only, mouse + fingers):
//   tap fixture / bar          select (Ctrl/Cmd/Shift or touch density: add/remove)
//   drag fixture               move it (the whole selection if it is selected)
//   drag bar / stage edge      move it in depth
//   drag empty space           pan          · two fingers: pinch-zoom + pan
//   wheel / trackpad pinch     zoom at the cursor
//   long-press / right-click   context menu (hang on bar, mount, flip, reset…)
//   keys (canvas focused)      arrows nudge · F fit · + / - zoom · Esc deselect
//   Delete / F2 / Mod+D        selection actions (editor/RigSelectionActions): a bar is
//                              deleted / renamed / duplicated; fixtures get their placement
//                              reset (never removed from the patch)
//
// The canvas reads the stores imperatively and redraws at most once per
// animation frame (DMX ~25 Hz); React only renders the wrapper.
// ============================================================

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import {
  LuAlignHorizontalSpaceAround, LuCopy, LuFlipHorizontal2, LuListChecks, LuMaximize, LuPencil, LuPlus, LuRotateCcw, LuTrash2
} from 'react-icons/lu'
import type { FixtureDefinition, PatchEntry, RoomConfig, TrussBar } from '@shared/types'
import { palette, useContextMenu, withAlpha, type MenuEntry } from '@renderer/components/ui'
import { decimalSeparator, t, useT } from '@renderer/i18n'
import { historyStep } from '@renderer/lib/history'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useCanvasSize } from '@renderer/hooks/useCanvasSize'
import { resolveChannels, getEffectiveColor } from '@renderer/lib/dmx-channel-resolver'
import {
  aimDirection, clamp, cm, describeFixture, fixturePosition, rayToRoom, snap, type FixtureKind, type Vec3
} from '../scene/layout-math'
import {
  barLabel, deleteBar, duplicateBar, fixturesOnBar, flipFixtures, formatMetres, hangOnBar, mountOptions, resetPlacement, setMount
} from './rig-actions'
import { renameBarPrompt } from './RigSelectionActions'

const MIN_SCALE = 6 // px per metre
const MAX_SCALE = 400
const FIT_PAD = 36
const LONG_PRESS_MS = 520

export interface LayoutEditorHandle {
  fit: () => void
  zoomBy: (factor: number) => void
}

interface Props {
  /** Reports px-per-metre after zoom changes (for the zoom readout) */
  onScaleChange?: (pxPerMetre: number, fitScale: number) => void
}

type Hit =
  | { kind: 'fixture'; id: string }
  | { kind: 'bar'; id: string }
  | { kind: 'edge' }
  | null

type Gesture =
  | { type: 'pending'; hit: Hit; sx: number; sy: number; pointerId: number; mods: boolean; timer: number }
  | { type: 'fixtures'; ids: string[]; primary: string; origins: Map<string, Vec3>; anchor: { x: number; z: number }; pointerId: number }
  | { type: 'bar'; id: string; z0: number; anchorZ: number; riders: Array<{ id: string; pos: Vec3 }>; pointerId: number }
  | { type: 'edge'; z0: number; anchorZ: number; pointerId: number }
  | { type: 'pan'; sx: number; sy: number; panX: number; panY: number; pointerId: number }
  | { type: 'pinch'; dist: number; midX: number; midY: number; scale: number; panX: number; panY: number }
  | { type: 'idle' }

interface Shape { kind: 'fixture'; id: string; x: number; y: number; r: number }
interface BarShape { id: string; x0: number; x1: number; y: number; h: number }

export const LayoutEditor2D = memo(forwardRef<LayoutEditorHandle, Props>(function LayoutEditor2D({ onScaleChange }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ panX: 0, panY: 0, scale: 0 })
  const size = useCanvasSize(wrapRef, canvasRef, ({ w, h }) => {
    if (view.current.scale === 0 && w > 0 && h > 0) {
      const saved = useVisualizerStore.getState().layoutView
      if (saved.zoom > 0) view.current = { panX: saved.panX, panY: saved.panY, scale: saved.zoom }
      else fit()
    }
    reportScale()
    // draw synchronously: a resized canvas is blank until redrawn
    draw()
  })
  const raf = useRef(0)
  const shapes = useRef<{ fixtures: Shape[]; bars: BarShape[]; edgeY: number; roomX0: number; roomX1: number }>({ fixtures: [], bars: [], edgeY: -1, roomX0: 0, roomX1: 0 })
  const gesture = useRef<Gesture>({ type: 'idle' })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastPointerType = useRef('mouse')
  const hover = useRef<string | null>(null)
  const pendingMove = useRef<(() => void) | null>(null)
  const onScaleRef = useRef(onScaleChange)
  onScaleRef.current = onScaleChange
  const ctxMenu = useContextMenu()
  const tr = useT()

  const isTouch = () => document.documentElement.dataset.density === 'touch'
  const rulers = () => (isTouch() ? { top: 24, left: 34 } : { top: 20, left: 30 })

  // ── coordinates ────────────────────────────────────────────────────
  const toScreen = (x: number, z: number) => {
    const { w, h } = size.current
    const { panX, panY, scale } = view.current
    return { x: w / 2 + panX + x * scale, y: h / 2 + panY - z * scale }
  }
  const toWorld = (sx: number, sy: number) => {
    const { w, h } = size.current
    const { panX, panY, scale } = view.current
    return { x: (sx - w / 2 - panX) / scale, z: -(sy - h / 2 - panY) / scale }
  }

  const fitScale = () => {
    const { w, h } = size.current
    const room = useVisualizerStore.getState().roomConfig
    const r = rulers()
    return clamp(Math.min((w - r.left - FIT_PAD * 2) / room.width, (h - r.top - FIT_PAD * 2) / room.depth), MIN_SCALE, MAX_SCALE)
  }

  const reported = useRef(0)
  /** Report zoom changes at most once per frame (from the draw loop) */
  const reportScale = () => requestDraw()

  const requestDraw = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      if (pendingMove.current) {
        const fn = pendingMove.current
        pendingMove.current = null
        fn()
      }
      draw()
      if (view.current.scale !== reported.current) {
        reported.current = view.current.scale
        onScaleRef.current?.(view.current.scale, fitScale())
      }
    })
  }, [])

  const fit = useCallback(() => {
    const r = rulers()
    view.current = { panX: r.left / 2, panY: r.top / 2, scale: fitScale() }
    reportScale()
    requestDraw()
  }, [requestDraw])

  const zoomAt = (factor: number, sx: number, sy: number) => {
    const before = toWorld(sx, sy)
    const scale = clamp(view.current.scale * factor, MIN_SCALE, MAX_SCALE)
    const { w, h } = size.current
    view.current.scale = scale
    view.current.panX = sx - w / 2 - before.x * scale
    view.current.panY = sy - h / 2 + before.z * scale
    reportScale()
    requestDraw()
  }

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (f: number) => zoomAt(f, size.current.w / 2 + rulers().left / 2, size.current.h / 2 + rulers().top / 2)
  }), [fit])

  // ── draw ───────────────────────────────────────────────────────────
  function draw() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h, dpr } = size.current
    if (w < 2 || h < 2) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { patch, fixtures, selectedFixtureIds } = usePatchStore.getState()
    const vis = useVisualizerStore.getState()
    const room = vis.roomConfig
    const dmx = useDmxStore.getState()
    const touch = isTouch()
    const R = rulers()
    const scale = view.current.scale
    const selected = new Set(selectedFixtureIds)
    const defs = new Map<string, FixtureDefinition>(fixtures.map((f) => [f.id, f]))
    const UI = '"Inter Variable", Inter, system-ui, sans-serif'
    const MONO = '"JetBrains Mono Variable", ui-monospace, monospace'

    ctx.fillStyle = palette.surface0
    ctx.fillRect(0, 0, w, h)

    const hw = room.width / 2, hd = room.depth / 2
    const tl = toScreen(-hw, hd)
    const br = toScreen(hw, -hd)
    const stageZ = clamp(room.stageEdgeZ ?? 0, -hd, hd)
    const edgeY = toScreen(0, stageZ).y

    // Room + stage area
    ctx.fillStyle = palette.surface1
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
    ctx.fillStyle = palette.surface2
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, edgeY - tl.y)

    // Grid (clipped to the room)
    ctx.save()
    ctx.beginPath()
    ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
    ctx.clip()
    const gridLines = (step: number, color: string, width: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      for (let x = Math.ceil(-hw / step) * step; x <= hw + 1e-6; x += step) {
        const sx = Math.round(toScreen(x, 0).x) + 0.5
        ctx.moveTo(sx, tl.y); ctx.lineTo(sx, br.y)
      }
      for (let z = Math.ceil(-hd / step) * step; z <= hd + 1e-6; z += step) {
        const sy = Math.round(toScreen(0, z).y) + 0.5
        ctx.moveTo(tl.x, sy); ctx.lineTo(br.x, sy)
      }
      ctx.stroke()
    }
    if (vis.showGrid) {
      if (vis.gridSize * scale >= 9 && vis.gridSize < 1) gridLines(vis.gridSize, withAlpha(palette.lineSubtle, 0.8), 1)
      if (scale >= 7) gridLines(1, palette.lineSubtle, 1)
      gridLines(5, palette.line, 1)
    }
    // Centre line
    ctx.setLineDash([10, 4, 2, 4])
    ctx.strokeStyle = palette.lineStrong
    ctx.lineWidth = 1
    const cx0 = Math.round(toScreen(0, 0).x) + 0.5
    ctx.beginPath(); ctx.moveTo(cx0, tl.y); ctx.lineTo(cx0, br.y); ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // Area labels
    ctx.font = `600 ${touch ? 12 : 11}px ${UI}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = palette.fgDisabled
    ctx.textAlign = 'left'
    if (edgeY - tl.y > 40) ctx.fillText(t('layout.plan.stage'), tl.x + 10, tl.y + 14)
    if (br.y - edgeY > 40) ctx.fillText(t('layout.plan.audience'), tl.x + 10, br.y - 14)
    ctx.textAlign = 'center'
    if (tl.y - R.top > 16) ctx.fillText(t('layout.plan.centreLine'), cx0, tl.y - 10)

    // Room outline + dimensions
    ctx.strokeStyle = palette.lineStrong
    ctx.lineWidth = 1.5
    ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(br.x - tl.x), Math.round(br.y - tl.y))
    ctx.font = `500 ${touch ? 12 : 11}px ${MONO}`
    ctx.fillStyle = palette.fgTertiary
    ctx.textBaseline = 'alphabetic'
    if (h - br.y > 26) {
      // Width dimension line under the room
      const dy = br.y + 16
      ctx.strokeStyle = palette.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(tl.x, dy); ctx.lineTo(br.x, dy)
      ctx.moveTo(tl.x, dy - 4); ctx.lineTo(tl.x, dy + 4)
      ctx.moveTo(br.x, dy - 4); ctx.lineTo(br.x, dy + 4)
      ctx.stroke()
      const label = formatMetres(room.width, 1)
      const lw = ctx.measureText(label).width + 10
      ctx.fillStyle = palette.surface0
      ctx.fillRect((tl.x + br.x) / 2 - lw / 2, dy - 8, lw, 16)
      ctx.fillStyle = palette.fgTertiary
      ctx.textBaseline = 'middle'
      ctx.fillText(label, (tl.x + br.x) / 2, dy)
      ctx.textBaseline = 'alphabetic'
    }
    ctx.save()
    ctx.translate(br.x + 16, (tl.y + br.y) / 2)
    ctx.rotate(Math.PI / 2)
    ctx.fillText(formatMetres(room.depth, 1), 0, 0)
    ctx.restore()

    // Stage edge (draggable)
    const edgeActive = gesture.current.type === 'edge'
    ctx.strokeStyle = edgeActive ? palette.accentFg : withAlpha(palette.accent, 0.85)
    ctx.lineWidth = edgeActive ? 2.5 : 1.5
    ctx.setLineDash([8, 5])
    ctx.beginPath(); ctx.moveTo(tl.x - 8, edgeY); ctx.lineTo(br.x + 8, edgeY); ctx.stroke()
    ctx.setLineDash([])
    {
      ctx.font = `600 ${touch ? 12 : 11}px ${UI}`
      const edgeLabel = t('layout.plan.stageEdge')
      const pw = ctx.measureText(edgeLabel).width + 12
      const px = tl.x - 8
      const style = { bg: palette.surface0, fg: palette.accentFg, border: withAlpha(palette.accent, 0.6), font: `600 ${touch ? 12 : 11}px ${UI}` }
      if (px - pw > R.left + 4) pill(ctx, edgeLabel, px, edgeY, { ...style, align: 'right' })
      else pill(ctx, edgeLabel, br.x + 8, edgeY, { ...style, align: 'left' })
    }

    // Truss bars
    const bars: BarShape[] = []
    for (const bar of room.trussBars) {
      const isSel = bar.id === vis.selectedTrussId
      const a = toScreen(-bar.width / 2, bar.z)
      const b = toScreen(bar.width / 2, bar.z)
      const th = Math.max(touch ? 8 : 6, 0.3 * scale)
      const color = isSel ? palette.infoFg : bar.color ?? palette.fgTertiary
      if (isSel) {
        ctx.fillStyle = withAlpha(palette.info, 0.18)
        ctx.fillRect(a.x - 4, a.y - th / 2 - 4, b.x - a.x + 8, th + 8)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = isSel ? 1.6 : 1.2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y - th / 2); ctx.lineTo(b.x, b.y - th / 2)
      ctx.moveTo(a.x, a.y + th / 2); ctx.lineTo(b.x, b.y + th / 2)
      ctx.stroke()
      // lacing
      ctx.lineWidth = 0.8
      ctx.strokeStyle = withAlpha(isSel ? palette.infoFg : bar.color ?? palette.fgTertiary, 0.6)
      ctx.beginPath()
      const segs = Math.max(2, Math.round((b.x - a.x) / Math.max(th * 1.4, 6)))
      for (let i = 0; i < segs; i++) {
        const x0 = a.x + ((b.x - a.x) * i) / segs
        const x1 = a.x + ((b.x - a.x) * (i + 1)) / segs
        const up = i % 2 === 0
        ctx.moveTo(x0, a.y + (up ? th / 2 : -th / 2))
        ctx.lineTo(x1, a.y + (up ? -th / 2 : th / 2))
      }
      ctx.stroke()
      ctx.fillStyle = color
      ctx.fillRect(a.x - 2, a.y - th / 2 - 1, 3, th + 2)
      ctx.fillRect(b.x - 1, b.y - th / 2 - 1, 3, th + 2)
      const pillStyle = {
        bg: isSel ? palette.info : palette.surface0, fg: isSel ? palette.fgPrimary : palette.fgSecondary,
        border: isSel ? palette.infoFg : palette.line, font: `500 ${touch ? 12 : 11}px ${UI}`
      }
      const text = t('layout.fixture.barOption', { name: bar.name, height: formatMetres(bar.y) })
      ctx.font = pillStyle.font
      const pw = ctx.measureText(text).width + 12
      const px = Math.min(a.x, tl.x) - 8
      if (px - pw > R.left + 4) pill(ctx, text, px, a.y, { ...pillStyle, align: 'right' })
      else pill(ctx, text, a.x, a.y - th / 2 - (touch ? 13 : 12), { ...pillStyle, align: 'left' })
      bars.push({ id: bar.id, x0: a.x, x1: b.x, y: a.y, h: th })
    }

    // Fixtures
    const list: Shape[] = []
    const baseR = clamp(0.2 * scale, touch ? 12 : 9, touch ? 20 : 17)
    const items = patch.map((entry, i) => {
      const def = defs.get(entry.fixtureDefId)
      return { entry, def, i, spec: describeFixture(entry, def), pos: fixturePosition(entry, i, patch.length, room) }
    })

    // Focus lines of the selected static fixtures aimed off-vertical
    for (const it of items) {
      const { entry, pos, spec } = it
      if (spec.kind === 'moving-head' || !spec.emits || !selected.has(entry.id)) continue
      if (!entry.mountingAngle && !(entry.mountingLocation ?? '').startsWith('wall')) continue
      const d = aimDirection(entry)
      const hit = rayToRoom(pos, d, room, true)
      if (!hit) continue
      const fx = pos.x + d.x * hit.t, fz = pos.z + d.z * hit.t
      const a = toScreen(pos.x, pos.z), b = toScreen(fx, fz)
      const sel = selected.has(entry.id)
      ctx.strokeStyle = sel ? withAlpha(palette.infoFg, 0.85) : withAlpha(palette.fgTertiary, 0.35)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = sel ? palette.infoFg : withAlpha(palette.fgTertiary, 0.5)
      ctx.fill()
    }

    const labels: Array<{ id: string; x: number; y: number; name: string; tag: string | null; sel: boolean; maxW: number }> = []
    for (const it of items) {
      const { entry, def, i, spec, pos } = it
      const p = toScreen(pos.x, pos.z)
      if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) continue
      const sel = selected.has(entry.id)
      const hov = hover.current === entry.id
      // live colour / intensity (post grand master / blackout)
      let col = { r: 0, g: 0, b: 0 }
      if (dmx.blinder) col = { r: 1, g: 1, b: 1 }
      else if (!dmx.blackout && !(dmx.strobe && !dmx._strobePhase)) {
        const c = getEffectiveColor(resolveChannels(entry, def, dmx.values))
        const gm = dmx.grandMaster / 255
        col = { r: c.r * gm, g: c.g * gm, b: c.b * gm }
      }
      const level = Math.max(col.r, col.g, col.b)
      const lit = level > 0.03
      const fill = lit ? `rgb(${Math.round(col.r * 255)} ${Math.round(col.g * 255)} ${Math.round(col.b * 255)})` : palette.surface3
      const r = baseR

      if (lit) {
        const glow = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.8)
        glow.addColorStop(0, `rgb(${Math.round(col.r * 255)} ${Math.round(col.g * 255)} ${Math.round(col.b * 255)} / ${0.45 * level})`)
        glow.addColorStop(1, 'rgb(0 0 0 / 0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.8, 0, Math.PI * 2); ctx.fill()
      }

      if (sel) {
        ctx.fillStyle = withAlpha(palette.info, 0.25)
        symbolPath(ctx, spec.kind, p.x, p.y, r + 5, spec.length * scale)
        ctx.fill()
      }
      symbolPath(ctx, spec.kind, p.x, p.y, r, spec.length * scale)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = sel ? 2 : 1.25
      ctx.strokeStyle = sel ? palette.infoFg : hov ? palette.fgSecondary : palette.fgDisabled
      ctx.stroke()
      if (spec.kind === 'moving-head') {
        // yoke arms
        ctx.beginPath()
        ctx.moveTo(p.x - r - 3, p.y - r * 0.55); ctx.lineTo(p.x - r - 3, p.y + r * 0.55)
        ctx.moveTo(p.x + r + 3, p.y - r * 0.55); ctx.lineTo(p.x + r + 3, p.y + r * 0.55)
        ctx.lineWidth = 2
        ctx.stroke()
      }
      // number
      const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b
      ctx.fillStyle = lit && lum > 0.45 ? palette.surface0 : palette.fgPrimary
      ctx.font = `700 ${Math.round(clamp(r * 0.9, 10, 15))}px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), p.x, p.y + 0.5)
      // name + mount tag: drawn after every symbol, without overlaps
      if (scale >= 22 || sel) {
        const below = spec.kind === 'strip' ? r * 0.7 + 4 : r + 5
        const mount = entry.mountingLocation
        labels.push({ id: entry.id, x: p.x, y: p.y + below, name: entry.name, tag: mount && mount !== 'ceiling' ? t(mount === 'floor' ? 'layout.plan.floorTag' : 'layout.plan.wallTag') : null, sel, maxW: Math.max(56, 1.6 * scale) })
      }
      list.push({ kind: 'fixture', id: entry.id, x: p.x, y: p.y, r: spec.kind === 'strip' ? Math.max(r, (spec.length * scale) / 2) : r })
    }

    // Fixture names: selected first, skip any that would collide
    const taken = list.map((f) => ({ id: f.id, x0: f.x - f.r, x1: f.x + f.r, y0: f.y - f.r, y1: f.y + f.r }))
    labels.sort((a, b) => Number(b.sel) - Number(a.sel))
    const nameFont = (sel: boolean) => `${sel ? 600 : 500} ${touch ? 12 : 11}px ${UI}`
    const lineH = touch ? 15 : 13
    for (const l of labels) {
      ctx.font = nameFont(l.sel)
      const text = truncate(ctx, l.name, l.maxW)
      const tw = ctx.measureText(text).width
      const rect = { id: l.id, x0: l.x - tw / 2 - 2, x1: l.x + tw / 2 + 2, y0: l.y, y1: l.y + lineH * (l.tag ? 2 : 1) }
      if (!l.sel && taken.some((o) => o.id !== l.id && o.x0 < rect.x1 && o.x1 > rect.x0 && o.y0 < rect.y1 && o.y1 > rect.y0)) continue
      taken.push(rect)
      ctx.fillStyle = l.sel ? palette.fgPrimary : palette.fgSecondary
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(text, l.x, l.y)
      if (l.tag) {
        ctx.font = `600 ${touch ? 11 : 10}px ${UI}`
        ctx.fillStyle = palette.fgTertiary
        ctx.fillText(l.tag, l.x, l.y + lineH)
      }
    }

    // Rulers (on top)
    drawRulers(ctx, w, h, R, room, touch, MONO, selected, items)

    shapes.current = { fixtures: list, bars, edgeY, roomX0: tl.x, roomX1: br.x }
  }

  function drawRulers(
    ctx: CanvasRenderingContext2D, w: number, h: number, R: { top: number; left: number }, room: RoomConfig, touch: boolean, MONO: string,
    selected: Set<string>, items: Array<{ entry: PatchEntry; pos: Vec3 }>
  ) {
    const scale = view.current.scale
    const steps = [0.5, 1, 2, 5, 10, 20]
    const step = steps.find((s) => s * scale >= (touch ? 56 : 46)) ?? 50
    ctx.fillStyle = palette.surface1
    ctx.fillRect(0, 0, w, R.top)
    ctx.fillRect(0, 0, R.left, h)
    ctx.strokeStyle = palette.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, R.top - 0.5); ctx.lineTo(w, R.top - 0.5)
    ctx.moveTo(R.left - 0.5, 0); ctx.lineTo(R.left - 0.5, h)
    ctx.stroke()

    ctx.font = `500 ${touch ? 11 : 10}px ${MONO}`
    ctx.fillStyle = palette.fgTertiary
    ctx.strokeStyle = palette.lineStrong
    const x0 = toWorld(R.left, 0).x, x1 = toWorld(w, 0).x
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.beginPath()
    for (let x = Math.ceil(x0 / (step / 5)) * (step / 5); x <= x1; x += step / 5) {
      const sx = Math.round(toScreen(x, 0).x) + 0.5
      const major = Math.abs(x / step - Math.round(x / step)) < 1e-6
      ctx.moveTo(sx, R.top); ctx.lineTo(sx, R.top - (major ? 8 : 4))
      if (major) ctx.fillText(fmtM(x), sx + 3, 3)
    }
    const zTop = toWorld(0, R.top).z, zBottom = toWorld(0, h).z
    for (let z = Math.ceil(zBottom / (step / 5)) * (step / 5); z <= zTop; z += step / 5) {
      const sy = Math.round(toScreen(0, z).y) + 0.5
      if (sy < R.top) continue
      const major = Math.abs(z / step - Math.round(z / step)) < 1e-6
      ctx.moveTo(R.left, sy); ctx.lineTo(R.left - (major ? 8 : 4), sy)
      if (major) {
        ctx.save()
        ctx.translate(3, sy - 3)
        ctx.rotate(-Math.PI / 2)
        ctx.textBaseline = 'top'
        ctx.fillText(fmtM(z), 0, 0)
        ctx.restore()
      }
    }
    ctx.stroke()

    // Selection markers on the rulers
    ctx.fillStyle = palette.infoFg
    for (const it of items) {
      if (!selected.has(it.entry.id)) continue
      const p = toScreen(it.pos.x, it.pos.z)
      if (p.x > R.left) { ctx.beginPath(); ctx.moveTo(p.x, R.top - 1); ctx.lineTo(p.x - 4, R.top - 7); ctx.lineTo(p.x + 4, R.top - 7); ctx.fill() }
      if (p.y > R.top) { ctx.beginPath(); ctx.moveTo(R.left - 1, p.y); ctx.lineTo(R.left - 7, p.y - 4); ctx.lineTo(R.left - 7, p.y + 4); ctx.fill() }
    }

    // Corner
    ctx.fillStyle = palette.surface2
    ctx.fillRect(0, 0, R.left - 1, R.top - 1)
    ctx.fillStyle = palette.fgTertiary
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t('layout.plan.metreUnit'), R.left / 2, R.top / 2)
  }

  // ── hit testing ────────────────────────────────────────────────────
  const hitTest = (sx: number, sy: number): Hit => {
    const touch = isTouch()
    const s = shapes.current
    const list = s.fixtures
    const sel = new Set(usePatchStore.getState().selectedFixtureIds)
    let best: { id: string; d: number } | null = null
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i]
      const d = Math.hypot(sx - f.x, sy - f.y)
      const reach = Math.max(f.r + 4, touch ? 24 : 14)
      if (d <= reach && (!best || d < best.d - (sel.has(f.id) ? 4 : 0))) best = { id: f.id, d }
    }
    if (best) return { kind: 'fixture', id: best.id }
    for (const b of s.bars) {
      const tol = b.h / 2 + (touch ? 12 : 6)
      if (sx >= b.x0 - 6 && sx <= b.x1 + 6 && Math.abs(sy - b.y) <= tol) return { kind: 'bar', id: b.id }
    }
    if (s.edgeY >= 0 && Math.abs(sy - s.edgeY) <= (touch ? 14 : 7) && sx >= s.roomX0 - 10 && sx <= s.roomX1 + 10) return { kind: 'edge' }
    return null
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── gestures ───────────────────────────────────────────────────────
  const snapStep = () => {
    const v = useVisualizerStore.getState()
    return v.snapToGrid ? v.gridSize : 0.01
  }

  const beginDrag = (g: Extract<Gesture, { type: 'pending' }>) => {
    const hit = g.hit
    const anchor = toWorld(g.sx, g.sy)
    if (hit?.kind === 'fixture') {
      const store = usePatchStore.getState()
      let ids = store.selectedFixtureIds.includes(hit.id) ? [...store.selectedFixtureIds] : [hit.id]
      if (!store.selectedFixtureIds.includes(hit.id)) {
        if (g.mods) { store.selectFixture(hit.id, true); ids = [...store.selectedFixtureIds, hit.id] } else store.selectFixture(hit.id, false)
      }
      const room = useVisualizerStore.getState().roomConfig
      const origins = new Map<string, Vec3>()
      store.patch.forEach((p, i) => { if (ids.includes(p.id)) origins.set(p.id, fixturePosition(p, i, store.patch.length, room)) })
      gesture.current = { type: 'fixtures', ids, primary: hit.id, origins, anchor, pointerId: g.pointerId }
    } else if (hit?.kind === 'bar') {
      const vis = useVisualizerStore.getState()
      const bar = vis.roomConfig.trussBars.find((b) => b.id === hit.id)
      if (!bar) { gesture.current = { type: 'idle' }; return }
      vis.selectTruss(bar.id)
      const patch = usePatchStore.getState().patch
      const riders = fixturesOnBar(bar, patch).filter((e) => e.position3D).map((e) => ({ id: e.id, pos: { ...e.position3D! } }))
      gesture.current = { type: 'bar', id: bar.id, z0: bar.z, anchorZ: anchor.z, riders, pointerId: g.pointerId }
    } else if (hit?.kind === 'edge') {
      const room = useVisualizerStore.getState().roomConfig
      gesture.current = { type: 'edge', z0: room.stageEdgeZ ?? 0, anchorZ: anchor.z, pointerId: g.pointerId }
    } else {
      gesture.current = { type: 'pan', sx: g.sx, sy: g.sy, panX: view.current.panX, panY: view.current.panY, pointerId: g.pointerId }
    }
  }

  const applyMove = (sx: number, sy: number) => {
    const g = gesture.current
    if (g.type === 'pan') {
      view.current.panX = g.panX + (sx - g.sx)
      view.current.panY = g.panY + (sy - g.sy)
      requestDraw()
      return
    }
    const wpt = toWorld(sx, sy)
    if (g.type === 'fixtures') {
      const o = g.origins.get(g.primary)
      if (!o) return
      const step = snapStep()
      let tx = snap(o.x + (wpt.x - g.anchor.x), step)
      let tz = snap(o.z + (wpt.z - g.anchor.z), step)
      // Magnet: ceiling fixtures stick to a nearby bar
      const vis = useVisualizerStore.getState()
      const room = vis.roomConfig
      if (o.y > room.height * 0.5) {
        for (const bar of room.trussBars) {
          if (Math.abs(tz - bar.z) < 0.3 && Math.abs(tx) <= bar.width / 2 + 0.3) { tz = bar.z; break }
        }
      }
      tx = clamp(tx, -room.width / 2 - 1, room.width / 2 + 1)
      tz = clamp(tz, -room.depth / 2 - 1, room.depth / 2 + 1)
      const dx = tx - o.x, dz = tz - o.z
      const updates: Record<string, Partial<PatchEntry>> = {}
      for (const [id, p] of g.origins) updates[id] = { position3D: { x: cm(p.x + dx), y: cm(p.y), z: cm(p.z + dz) } }
      pendingMove.current = () => usePatchStore.getState().updateFixtures(updates)
      requestDraw()
    } else if (g.type === 'bar') {
      const room = useVisualizerStore.getState().roomConfig
      const z = clamp(snap(g.z0 + (wpt.z - g.anchorZ), snapStep()), -room.depth / 2, room.depth / 2)
      const dz = z - g.z0
      pendingMove.current = () => {
        useVisualizerStore.getState().updateTrussBar(g.id, { z: cm(z) })
        if (g.riders.length) {
          const updates: Record<string, Partial<PatchEntry>> = {}
          for (const r of g.riders) updates[r.id] = { position3D: { x: r.pos.x, y: r.pos.y, z: cm(r.pos.z + dz) } }
          usePatchStore.getState().updateFixtures(updates)
        }
      }
      requestDraw()
    } else if (g.type === 'edge') {
      const room = useVisualizerStore.getState().roomConfig
      const z = clamp(snap(g.z0 + (wpt.z - g.anchorZ), snapStep()), -room.depth / 2, room.depth / 2)
      pendingMove.current = () => useVisualizerStore.getState().setRoomConfig({ stageEdgeZ: cm(z) })
      requestDraw()
    }
  }

  const startPinch = () => {
    const pts = [...pointers.current.values()]
    if (pts.length < 2) return
    const g = gesture.current
    if (g.type === 'pending') window.clearTimeout(g.timer)
    const [a, b] = pts
    gesture.current = {
      type: 'pinch', dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2,
      scale: view.current.scale, panX: view.current.panX, panY: view.current.panY
    }
  }

  const applyPinch = () => {
    const g = gesture.current
    if (g.type !== 'pinch') return
    const pts = [...pointers.current.values()]
    if (pts.length < 2) return
    const [a, b] = pts
    const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2
    const { w, h } = size.current
    // World point that was under the start midpoint
    const wx = (g.midX - w / 2 - g.panX) / g.scale
    const wz = -(g.midY - h / 2 - g.panY) / g.scale
    const scale = clamp(g.scale * (dist / g.dist), MIN_SCALE, MAX_SCALE)
    view.current = { scale, panX: midX - w / 2 - wx * scale, panY: midY - h / 2 + wz * scale }
    reportScale()
    requestDraw()
  }

  const tap = (g: Extract<Gesture, { type: 'pending' }>) => {
    const hit = g.hit
    const vis = useVisualizerStore.getState()
    const store = usePatchStore.getState()
    if (hit?.kind === 'fixture') {
      store.selectFixture(hit.id, g.mods || isTouch())
    } else if (hit?.kind === 'bar') {
      vis.selectTruss(hit.id)
    } else if (!hit) {
      store.clearSelection()
      vis.selectFixture(null)
      vis.selectTruss(null)
    }
  }

  // ── context menu ───────────────────────────────────────────────────
  const openMenu = (clientX: number, clientY: number, hit: Hit) => {
    const at = { clientX, clientY, preventDefault: () => {} }
    const vis = useVisualizerStore.getState()
    const store = usePatchStore.getState()
    const bars = [...vis.roomConfig.trussBars].sort((a, b) => a.z - b.z)
    let items: MenuEntry[]
    if (hit?.kind === 'fixture') {
      let ids = store.selectedFixtureIds.includes(hit.id) ? store.selectedFixtureIds : [hit.id]
      if (!store.selectedFixtureIds.includes(hit.id)) { store.selectFixture(hit.id, false); ids = [hit.id] }
      const entry = store.patch.find((p) => p.id === hit.id)
      const single = ids.length === 1
      items = [
        { type: 'label', label: single ? entry?.name ?? t('layout.menu.fixtureFallback') : t('common.fixtureCount', { count: ids.length }) },
        {
          label: t(single ? 'layout.menu.hangOnBar' : 'layout.menu.hangOnBarSpread'),
          icon: LuAlignHorizontalSpaceAround,
          disabled: bars.length === 0,
          submenu: bars.map((b) => ({ label: t('layout.fixture.barOption', { name: b.name, height: formatMetres(b.y) }), onSelect: () => hangOnBar(ids, b) }))
        },
        {
          label: t('layout.menu.mount'),
          submenu: mountOptions().map((m) => ({
            label: m.label,
            checked: single ? (entry?.mountingLocation ?? 'ceiling') === m.value : undefined,
            onSelect: () => setMount(ids, m.value)
          }))
        },
        { label: t('layout.actions.flip'), icon: LuFlipHorizontal2, onSelect: () => flipFixtures(ids) },
        { type: 'separator' },
        { label: t('layout.actions.resetPlacementEllipsis'), icon: LuRotateCcw, danger: true, shortcut: 'Delete', onSelect: () => void resetPlacement(ids) }
      ]
    } else if (hit?.kind === 'bar') {
      const bar = vis.roomConfig.trussBars.find((b) => b.id === hit.id)
      if (!bar) return
      vis.selectTruss(bar.id)
      const riders = fixturesOnBar(bar, store.patch)
      items = [
        { type: 'label', label: bar.name },
        { label: t('layout.menu.selectOnBar'), icon: LuListChecks, disabled: riders.length === 0, onSelect: () => usePatchStore.getState().selectFixtures(riders.map((r) => r.id)) },
        { label: t('layout.menu.spreadEvenly'), icon: LuAlignHorizontalSpaceAround, disabled: riders.length < 2, onSelect: () => hangOnBar(riders.map((r) => r.id), bar) },
        { label: t('common.renameEllipsis'), icon: LuPencil, shortcut: 'F2', onSelect: () => void renameBarPrompt(bar.id) },
        {
          label: t('common.duplicate'), icon: LuCopy, shortcut: 'Mod+D',
          onSelect: () => { historyStep(t('shell.editMenu.duplicateWhat', { what: barLabel(bar) }), () => duplicateBar(bar)) }
        },
        { type: 'separator' },
        { label: t('layout.bar.deleteEllipsis'), icon: LuTrash2, danger: true, shortcut: 'Delete', onSelect: () => void deleteBar(bar) }
      ]
    } else {
      const local0 = local({ clientX, clientY })
      const z = cm(snap(toWorld(local0.x, local0.y).z, 0.25))
      items = [
        { label: t('layout.menu.addBarAt', { z: formatMetres(z) }), icon: LuPlus, onSelect: () => vis.addTrussBar({ z }) },
        { label: t('layout.menu.fit'), icon: LuMaximize, shortcut: 'F', onSelect: fit },
        { type: 'separator' },
        { label: t('layout.menu.snap'), checked: vis.snapToGrid, onSelect: () => vis.setSnapToGrid(!vis.snapToGrid) }
      ]
    }
    ctxMenu.open(at, items)
  }

  // ── pointer handlers ───────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    lastPointerType.current = e.pointerType
    if (e.button === 2) return // context menu event handles it
    canvas.setPointerCapture(e.pointerId)
    canvas.focus({ preventScroll: true })
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 2) { startPinch(); return }
    if (pointers.current.size > 2) return
    if (e.button === 1) {
      gesture.current = { type: 'pan', sx: p.x, sy: p.y, panX: view.current.panX, panY: view.current.panY, pointerId: e.pointerId }
      e.preventDefault()
      return
    }
    const hit = hitTest(p.x, p.y)
    const mods = e.ctrlKey || e.metaKey || e.shiftKey
    const timer = e.pointerType === 'mouse' ? 0 : window.setTimeout(() => {
      const g = gesture.current
      if (g.type === 'pending' && g.pointerId === e.pointerId) {
        gesture.current = { type: 'idle' }
        openMenu(e.clientX, e.clientY, hit)
      }
    }, LONG_PRESS_MS)
    gesture.current = { type: 'pending', hit, sx: p.x, sy: p.y, pointerId: e.pointerId, mods, timer }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (g.type === 'pinch') { applyPinch(); return }
    if (g.type === 'idle') {
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        const hit = hitTest(p.x, p.y)
        const id = hit?.kind === 'fixture' ? hit.id : null
        e.currentTarget.style.cursor = hit?.kind === 'fixture' ? 'move' : hit ? 'ns-resize' : 'grab'
        if (id !== hover.current) { hover.current = id; requestDraw() }
      }
      return
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return
    if (g.type === 'pending') {
      const threshold = e.pointerType === 'mouse' ? 4 : 9
      if (Math.hypot(p.x - g.sx, p.y - g.sy) < threshold) return
      window.clearTimeout(g.timer)
      beginDrag(g)
      if (gesture.current.type === 'pan') e.currentTarget.style.cursor = 'grabbing'
    }
    applyMove(p.x, p.y)
  }

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g.type === 'pinch') {
      if (pointers.current.size < 2) gesture.current = { type: 'idle' }
      return
    }
    if (g.type === 'pending' && g.pointerId === e.pointerId) {
      window.clearTimeout(g.timer)
      gesture.current = { type: 'idle' }
      if (!cancelled) tap(g)
      requestDraw()
      return
    }
    if ('pointerId' in g && g.pointerId === e.pointerId) {
      gesture.current = { type: 'idle' }
      if (e.pointerType === 'mouse') e.currentTarget.style.cursor = 'grab'
      requestDraw()
    }
  }

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (lastPointerType.current !== 'mouse') return // long-press timer owns touch / pen
    const p = local(e)
    const g = gesture.current
    if (g.type === 'pending') window.clearTimeout(g.timer)
    gesture.current = { type: 'idle' }
    openMenu(e.clientX, e.clientY, hitTest(p.x, p.y))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const vis = useVisualizerStore.getState()
    const store = usePatchStore.getState()
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    const dir = arrows[e.key]
    if (dir) {
      const step = e.altKey ? 0.01 : (vis.snapToGrid ? vis.gridSize : 0.1) * (e.shiftKey ? 4 : 1)
      if (store.selectedFixtureIds.length) {
        const room = vis.roomConfig
        const updates: Record<string, Partial<PatchEntry>> = {}
        store.patch.forEach((p, i) => {
          if (!store.selectedFixtureIds.includes(p.id)) return
          const pos = fixturePosition(p, i, store.patch.length, room)
          updates[p.id] = { position3D: { x: cm(pos.x + dir[0] * step), y: pos.y, z: cm(pos.z + dir[1] * step) } }
        })
        store.updateFixtures(updates)
      } else if (vis.selectedTrussId && dir[1] !== 0) {
        const bar = vis.roomConfig.trussBars.find((b) => b.id === vis.selectedTrussId)
        if (bar) vis.updateTrussBar(bar.id, { z: cm(bar.z + dir[1] * step) })
      } else {
        view.current.panX -= dir[0] * 40
        view.current.panY += dir[1] * 40
        requestDraw()
      }
    } else if ((e.key === 'f' || e.key === 'F') && !e.repeat) fit()
    else if (e.key === '+' || e.key === '=') zoomAt(1.25, size.current.w / 2, size.current.h / 2)
    else if (e.key === '-' || e.key === '_') zoomAt(0.8, size.current.w / 2, size.current.h / 2)
    else if (e.key === 'Escape') { store.clearSelection(); vis.selectFixture(null); vis.selectTruss(null) }
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  // ── effects ────────────────────────────────────────────────────────
  // Redraw on any relevant store change (coalesced to one frame)
  useEffect(() => {
    const unsubs = [
      useDmxStore.subscribe(requestDraw),
      usePatchStore.subscribe((s) => s.patch, requestDraw),
      usePatchStore.subscribe((s) => s.fixtures, requestDraw),
      usePatchStore.subscribe((s) => s.selectedFixtureIds, requestDraw),
      useVisualizerStore.subscribe(requestDraw)
    ]
    const onDensity = new MutationObserver(requestDraw)
    onDensity.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })
    return () => {
      unsubs.forEach((u) => u())
      onDensity.disconnect()
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [requestDraw])

  // The canvas words (STAGE, AUDIENCE…) follow a language change
  useEffect(() => { requestDraw() }, [tr, requestDraw])

  // Wheel zoom (non-passive so the page never scrolls)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Persist the view for the next visit; cancel a pending long-press
  useEffect(() => () => {
    const g = gesture.current
    if (g.type === 'pending') window.clearTimeout(g.timer)
    const { panX, panY, scale } = view.current
    if (scale > 0) useVisualizerStore.getState().setLayoutView({ panX, panY, zoom: scale })
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-surface-0">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label={tr('layout.plan.aria')}
        className="absolute inset-0 h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info-fg/50"
        style={{ cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onLostPointerCapture={(e) => { if (pointers.current.has(e.pointerId)) endPointer(e, true) }}
        onPointerLeave={() => { if (hover.current) { hover.current = null; requestDraw() } }}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      />
      {ctxMenu.menu}
    </div>
  )
}))

// ── drawing helpers ──────────────────────────────────────────────────

/** Plan symbol outline (path only) */
function symbolPath(ctx: CanvasRenderingContext2D, kind: FixtureKind, x: number, y: number, r: number, lengthPx: number): void {
  ctx.beginPath()
  switch (kind) {
    case 'strip': {
      const w = Math.max(r * 2.6, lengthPx)
      const h = r * 1.3
      ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(4, h / 3))
      break
    }
    case 'strobe':
    case 'blinder': {
      const w = r * 2.3, h = r * 1.55
      ctx.roundRect(x - w / 2, y - h / 2, w, h, 3)
      break
    }
    case 'hazer': {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3
        const px = x + Math.cos(a) * r * 1.08, py = y + Math.sin(a) * r * 1.08
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      break
    }
    case 'moving-head':
      ctx.arc(x, y, r, 0, Math.PI * 2)
      break
    default: {
      // PAR / profile: can with a lens notch towards downstage
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
  }
}

function pill(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  o: { bg: string; fg: string; border: string; font: string; align: 'left' | 'center' | 'right' }
): void {
  ctx.font = o.font
  const padX = 6
  const w = ctx.measureText(text).width + padX * 2
  const h = 20
  const left = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2
  ctx.beginPath()
  ctx.roundRect(left, y - h / 2, w, h, 4)
  ctx.fillStyle = o.bg
  ctx.fill()
  ctx.strokeStyle = o.border
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = o.fg
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, left + padX, y + 0.5)
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

function fmtM(v: number): string {
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', decimalSeparator())
}
