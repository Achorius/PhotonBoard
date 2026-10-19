// Per-viewer preferences of the Fixtures / programmer view (remembered
// in localStorage when available): view mode, feature tab, value unit.

import { create } from 'zustand'
import { formatPercent } from '@renderer/components/ui'

export type ProgrammerMode = 'attributes' | 'faders' | 'sheet' | 'dmx'
export type FeatureTab = 'position' | 'colour' | 'beam' | 'control' | 'all'
export type ValueUnit = 'percent' | 'dmx'

interface ProgrammerViewState {
  mode: ProgrammerMode
  tab: FeatureTab
  unit: ValueUnit
  /** Position pad in fine (slow, relative) mode */
  fineXY: boolean
  setMode: (mode: ProgrammerMode) => void
  setTab: (tab: FeatureTab) => void
  setUnit: (unit: ValueUnit) => void
  setFineXY: (fine: boolean) => void
}

const KEY = 'photonboard.programmer.'

function read<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(KEY + name) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function write(name: string, value: string): void {
  try { localStorage.setItem(KEY + name, value) } catch { /* storage unavailable */ }
}

export const useProgrammerView = create<ProgrammerViewState>((set) => ({
  mode: read<ProgrammerMode>('mode', 'attributes', ['attributes', 'faders', 'sheet', 'dmx']),
  tab: read<FeatureTab>('tab', 'position', ['position', 'colour', 'beam', 'control', 'all']),
  unit: read<ValueUnit>('unit', 'percent', ['percent', 'dmx']),
  fineXY: false,
  setMode: (mode) => { write('mode', mode); set({ mode }) },
  setTab: (tab) => { write('tab', tab); set({ tab }) },
  setUnit: (unit) => { write('unit', unit); set({ unit }) },
  setFineXY: (fineXY) => set({ fineXY })
}))

/**
 * Format a value of an attribute range (max 255, or 65535 for 16-bit):
 * percent "75" / "75.4" (16-bit), DMX "191" / "191.4" (coarse.fraction).
 */
export function formatAttrValue(value: number, max: number, unit: ValueUnit, withSign = false): string {
  if (unit === 'dmx') {
    if (max > 255) return (Math.floor((value / 256) * 10) / 10).toFixed(1)
    return String(Math.round(value))
  }
  if (max > 255) {
    const p = Math.round((value / max) * 1000) / 10
    return withSign ? `${p.toFixed(1)}%` : p.toFixed(1)
  }
  const pct = formatPercent(value, max)
  return withSign ? pct : pct.slice(0, -1)
}

/** "75" or "20–80" for mixed values */
export function formatRange(min: number, max: number, rangeMax: number, unit: ValueUnit): string {
  if (min === max) return formatAttrValue(min, rangeMax, unit)
  const a = formatAttrValue(min, rangeMax, unit)
  const b = formatAttrValue(max, rangeMax, unit)
  return `${a}–${b}`
}
