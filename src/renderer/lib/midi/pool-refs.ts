// ============================================================
// PhotonBoard — Pool references of controller actions (pure)
//
// Busk layouts bind pads to "group 3", "colour preset 2", "macro 5"
// without knowing the show: the reference is resolved when pressed /
// lit. '#n' = number n (fallback: n-th in list order); 'family#n' for
// presets ('color#2', 'position#1'); anything else is an object id.
// ============================================================

import type { Group, Macro, Preset, PresetType } from '@shared/types'

const PRESET_TYPES: readonly PresetType[] = ['intensity', 'color', 'position', 'gobo', 'beam', 'focus', 'control', 'full']

/** Parse '#3' → { n: 3 }, 'color#2' → { family: 'color', n: 2 }; null for a plain id */
export function parsePoolRef(ref: string): { family?: string; n: number } | null {
  const m = /^([a-z]*)#(\d+)$/i.exec(ref)
  if (!m) return null
  const n = Number(m[2])
  if (!Number.isInteger(n) || n < 1) return null
  return m[1] ? { family: m[1].toLowerCase(), n } : { n }
}

function byNumber<T extends { id: string; number?: number }>(list: readonly T[], ref: string): T | undefined {
  const r = parsePoolRef(ref)
  if (!r) return list.find((x) => x.id === ref)
  return list.find((x) => x.number === r.n) ?? (list.some((x) => typeof x.number === 'number') ? undefined : list[r.n - 1])
}

export function resolveGroupRef(groups: readonly Group[], ref: string): Group | undefined {
  return byNumber(groups, ref)
}

export function resolveMacroRef(macros: readonly Macro[], ref: string): Macro | undefined {
  return byNumber(macros, ref)
}

export function resolvePresetRef(presets: readonly Preset[], ref: string): Preset | undefined {
  const r = parsePoolRef(ref)
  if (!r) return presets.find((p) => p.id === ref)
  const family = (r.family === 'colour' ? 'color' : r.family) as PresetType | undefined
  if (!family || !PRESET_TYPES.includes(family)) return undefined
  const ofFamily = presets.filter((p) => p.type === family)
  return ofFamily.find((p) => p.number === r.n) ?? (ofFamily.some((p) => typeof p.number === 'number') ? undefined : ofFamily[r.n - 1])
}
