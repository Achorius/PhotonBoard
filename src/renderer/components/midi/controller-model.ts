// Labels of controller controls and actions (Devices panel, controller map).

import type { TFunction } from '@renderer/i18n'
import type { ControlDef, ControllerAction, ControllerLayoutId, ControllerProfile } from '@renderer/lib/midi/controller-types'
import { buildBindings } from '@renderer/lib/midi/layouts'
import { resolveActionPage } from '@renderer/lib/midi/led-states'
import { parsePoolRef, resolveGroupRef, resolveMacroRef, resolvePresetRef } from '@renderer/lib/midi/pool-refs'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import type { ExecutorCell, MidiMapping } from '@shared/types'
import { useControllerStore } from '@renderer/stores/controller-store'
import { getProfile } from '@renderer/lib/midi/profiles'
import { sameMidiPort } from '@renderer/lib/midi-learn'

/** Name of what an executor cell holds ('' when unknown) */
export function cellName(cell: ExecutorCell): string {
  switch (cell.kind) {
    case 'cuelist': return usePlaybackStore.getState().cuelists.find((c) => c.id === cell.id)?.name ?? ''
    case 'chase': return usePlaybackStore.getState().chases.find((c) => c.id === cell.id)?.name ?? ''
    case 'effect': return useEffectsStore.getState().effects.find((e) => e.id === cell.id)?.name ?? ''
    case 'macro': return usePoolStore.getState().macros.find((m) => m.id === cell.id)?.name ?? ''
    case 'speed': return usePoolStore.getState().speedMasters.find((m) => m.id === cell.id)?.name ?? ''
    case 'group': return usePatchStore.getState().groups.find((g) => g.id === cell.id)?.name ?? ''
  }
}

export function controlLabel(c: ControlDef, t: TFunction): string {
  const m = /^(pad):(\d+):(\d+)$/.exec(c.id) ?? /^(track|scene|fader|encoder):(\d+)$/.exec(c.id)
  if (m?.[1] === 'pad') return t('pro.midi.map.control.pad', { col: Number(m[2]) + 1, row: Number(m[3]) + 1 })
  if (m) {
    const n = Number(m[2]) + 1
    if (m[1] === 'track') return t('pro.midi.map.control.track', { n })
    if (m[1] === 'scene') return t('pro.midi.map.control.scene', { n })
    if (m[1] === 'fader') return t('pro.midi.map.control.fader', { n })
    return t('pro.midi.map.control.encoder', { n })
  }
  return t('pro.midi.map.control.button', { id: c.id })
}

function refLabel(ref: string): string {
  const r = parsePoolRef(ref)
  return r ? String(r.n) : ref
}

/** Full description of an action (null = none) */
export function actionLabel(a: ControllerAction, t: TFunction): string {
  switch (a.type) {
    case 'executor':
    case 'select-executor': {
      if (a.type === 'select-executor') return t('pro.midi.map.action.selectExecutor')
      const ex = useExecutorStore.getState()
      const page = resolveActionPage(a.page, ex.currentPage, ex.pages.length)
      const shownPage = page < 0 ? (a.page === 'next' ? ex.currentPage + 2 : typeof a.page === 'number' ? a.page + 1 : 1) : page + 1
      if (page < 0) return t('pro.midi.map.action.executorNoPage', { page: shownPage })
      const slot = a.col * 4 + a.row + 1
      const cell = ex.pages[page]?.cells[a.col]?.[a.row]
      if (!cell) return t('pro.midi.map.action.executorEmpty', { page: shownPage, slot })
      return t('pro.midi.map.action.executor', { page: shownPage, slot, name: cellName(cell) })
    }
    case 'page':
      if (a.page === '-') return t('pro.midi.map.action.pagePrev')
      if (a.page === '+') return t('pro.midi.map.action.pageNext')
      return t('pro.midi.map.action.page', { n: a.page + 1 })
    case 'go-selected': return t('pro.midi.map.action.goSelected')
    case 'back-selected': return t('pro.midi.map.action.backSelected')
    case 'release-all': return t('pro.midi.map.action.releaseAll')
    case 'clear': return t('pro.midi.map.action.clear')
    case 'blackout': return t('pro.midi.map.action.blackout')
    case 'blinder': return t('pro.midi.map.action.blinder')
    case 'strobe': return t('pro.midi.map.action.strobe')
    case 'tap': return t('pro.midi.map.action.tap')
    case 'grand-master': return t('pro.midi.map.action.grandMaster')
    case 'xfade': return t('pro.midi.map.action.xfade')
    case 'column-fader': return t('pro.midi.map.action.columnFader', { n: a.col + 1 })
    case 'group': {
      const g = resolveGroupRef(usePatchStore.getState().groups, a.id)
      return t('pro.midi.map.action.group', { ref: g?.name ?? refLabel(a.id) })
    }
    case 'preset': {
      const p = resolvePresetRef(usePlaybackStore.getState().presets, a.id)
      return t('pro.midi.map.action.preset', { ref: p?.name ?? a.id.replace('#', ' ') })
    }
    case 'macro': {
      const m = resolveMacroRef(usePoolStore.getState().macros, a.id)
      return t('pro.midi.map.action.macro', { ref: m?.name ?? refLabel(a.id) })
    }
  }
}

/** A few characters for the face of a control on the map ('' = nothing) */
export function actionShort(a: ControllerAction, t: TFunction): string {
  switch (a.type) {
    case 'executor': {
      const ex = useExecutorStore.getState()
      const page = resolveActionPage(a.page, ex.currentPage, ex.pages.length)
      const cell = page < 0 ? null : ex.pages[page]?.cells[a.col]?.[a.row]
      return cell ? cellName(cell) : ''
    }
    case 'page':
      if (a.page === '-') return t('pro.midi.map.short.prev')
      if (a.page === '+') return t('pro.midi.map.short.next')
      return String(a.page + 1)
    case 'go-selected': return t('pro.midi.map.short.go')
    case 'back-selected': return t('pro.midi.map.short.back')
    case 'release-all': return t('pro.midi.map.short.release')
    case 'clear': return t('pro.midi.map.short.clear')
    case 'blackout': return t('pro.midi.map.short.blackout')
    case 'blinder': return t('pro.midi.map.short.blinder')
    case 'strobe': return t('pro.midi.map.short.strobe')
    case 'tap': return t('pro.midi.map.short.tap')
    case 'grand-master': return t('pro.midi.map.short.gm')
    case 'xfade': return t('pro.midi.map.short.xfade')
    case 'column-fader': {
      const ex = useExecutorStore.getState()
      return ex.pages[ex.currentPage]?.columns[a.col]?.title || String(a.col + 1)
    }
    case 'group': return resolveGroupRef(usePatchStore.getState().groups, a.id)?.name ?? ''
    case 'preset': return resolvePresetRef(usePlaybackStore.getState().presets, a.id)?.name ?? ''
    case 'macro': return resolveMacroRef(usePoolStore.getState().macros, a.id)?.name ?? ''
    case 'select-executor': return ''
  }
}

/** Name of the enabled controller profile whose control this mapping takes over (null = none) */
export function overriddenProfileName(mapping: MidiMapping): string | null {
  const { detected, settings } = useControllerStore.getState()
  const src = mapping.source
  for (const d of detected) {
    if (src.deviceName && !sameMidiPort(src.deviceName, d.port)) continue
    if (!settings.find((s) => s.port === d.port)?.enabled) continue
    const profile = getProfile(d.profileId)
    if (profile?.controls.some((c) => c.type === src.type && c.channel === src.channel && c.number === src.number)) return profile.name
  }
  return null
}

/**
 * Plain-language summary of what a profile's faders and side buttons do in a
 * layout (the pads are described by the layout hint). Controls a user
 * mapping takes over are listed apart: the mapping wins on them.
 */
export function profileSummary(profile: ControllerProfile, layout: ControllerLayoutId, t: TFunction, overridden: ReadonlySet<string> = new Set()): string[] {
  const bindings = buildBindings(profile, layout)
  const byControl = new Map(bindings.map((b) => [b.control, b]))
  const controls = new Map(profile.controls.map((c) => [c.id, c]))
  const lines: string[] = []

  // Faders / encoders on column faders: one line for the run, then the others one by one
  const cols: number[] = []
  const others: string[] = []
  for (const c of profile.controls) {
    if (c.kind !== 'fader' && c.kind !== 'encoder') continue
    const b = byControl.get(c.id)
    if (!b || overridden.has(c.id)) continue
    if (b.action.type === 'column-fader' && /^(fader|encoder):\d+$/.test(c.id)) cols.push(Number(c.id.split(':')[1]) + 1)
    else others.push(t('pro.midi.controllers.drivesControl', { control: controlLabel(c, t), action: actionLabel(b.action, t) }))
  }
  if (cols.length > 0) lines.push(t('pro.midi.controllers.drivesFaders', { from: Math.min(...cols), to: Math.max(...cols) }))
  lines.push(...others)

  const scenes = profile.controls
    .filter((c) => c.id.startsWith('scene:') && !overridden.has(c.id))
    .map((c) => byControl.get(c.id))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map((b) => actionLabel(b.action, t))
  if (scenes.length > 0) lines.push(t('pro.midi.controllers.drivesScenes', { list: scenes.join(' · ') }))

  const pages = profile.controls
    .map((c) => byControl.get(c.id))
    .filter((b) => b?.action.type === 'page' && typeof b.action.page === 'number' && b.control.startsWith('track:'))
    .map((b) => (b!.action as { page: number }).page + 1)
  if (pages.length > 0) lines.push(t('pro.midi.controllers.drivesTracks', { from: Math.min(...pages), to: Math.max(...pages) }))

  const taken = [...overridden].map((id) => controls.get(id)).filter((c): c is ControlDef => !!c).map((c) => controlLabel(c, t))
  if (taken.length > 0) lines.push(t('pro.midi.controllers.drivesOverridden', { list: taken.join(', ') }))
  return lines
}


/** Profile controls a user mapping takes over on this port */
export function overriddenControls(profile: ControllerProfile, port: string, mappings: readonly MidiMapping[]): Set<string> {
  const out = new Set<string>()
  for (const c of profile.controls) {
    if (mappings.some((m) => m.source.type === c.type && m.source.channel === c.channel && m.source.number === c.number
      && (!m.source.deviceName || sameMidiPort(m.source.deviceName, port)))) out.add(c.id)
  }
  return out
}
