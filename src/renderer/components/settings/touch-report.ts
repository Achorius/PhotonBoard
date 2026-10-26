// Touchscreens section (Settings › Display › Touchscreens): pure helpers.

import type { TouchOutput, TouchPanel, TouchPanelSettings } from '@shared/photonboard-api'

/** A report line worth the operator's attention (the helper marks them with ⚠ or NONE) */
export function isWarningLine(line: string): boolean {
  return line.includes('⚠') || /\bNONE\b/.test(line)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** File name on the USB stick: PhotonBoard-diagnostic-tactile-<yyyy-mm-dd-hhmm>.txt (local time) */
export function touchReportFileName(date: Date = new Date()): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `PhotonBoard-diagnostic-tactile-${stamp}.txt`
}

// ---------------------------------------------------------------
// Touch setup section
// ---------------------------------------------------------------

/** "Screen N" of an output: its place in the list main sends (screen order) */
export function screenNumber(outputs: Pick<TouchOutput, 'name'>[], name: string): number {
  const i = outputs.findIndex((o) => o.name === name)
  return i < 0 ? 0 : i + 1
}

/** Output rectangles in % of the desktop (to-scale diagram) */
export function diagramRects(outputs: TouchOutput[], desktop: { width: number; height: number }): { name: string; left: number; top: number; width: number; height: number }[] {
  const W = desktop.width || Math.max(1, ...outputs.map((o) => o.x + o.width))
  const H = desktop.height || Math.max(1, ...outputs.map((o) => o.y + o.height))
  const pct = (v: number, total: number) => Math.round((v / total) * 10000) / 100
  return outputs.map((o) => ({ name: o.name, left: pct(o.x, W), top: pct(o.y, H), width: pct(o.width, W), height: pct(o.height, H) }))
}

/** A panel's settings as the controls show them (saved, else the defaults with its current screen) */
export function panelSettings(panel: Pick<TouchPanel, 'saved' | 'output'>): TouchPanelSettings {
  return panel.saved ?? { output: null, rotation: 0, invertX: false, invertY: false, calibration: null }
}
