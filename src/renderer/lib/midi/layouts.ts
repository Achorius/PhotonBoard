// ============================================================
// PhotonBoard — Controller layouts: what each control of a profile does
//
// "executors-2pages" (default)
//   pad rows 1-4  executors of the current page P (row 1 = top row)
//   pad rows 5-8  executors of page P + 1
//   faders 1-8    column faders of page P · fader 9 = Grand Master
//   track 1-8     page select 1-8 (Shift + ▲/◀ = page −, Shift + ▼/▶ = page +)
//   scene 1-8     GO · Back · Release all · Blackout · Blinder (hold) ·
//                 Strobe (hold) · Tap · Clear programmer
//   Shift + pad   select the executor as GO / Back target
// "executors-busk"
//   pad rows 1-4 current page; row 5 groups 1-8; row 6 colour presets
//   1-8; row 7 position presets 1-8; row 8 macros 1-8. Everything else
//   as above.
//
// Grids with fewer rows keep what fits; profiles without track / scene
// buttons simply have no binding for them.
// ============================================================

import type { ControlId, ControllerAction, ControllerBinding, ControllerLayoutId, ControllerProfile } from './controller-types'

export const CONTROLLER_LAYOUTS: readonly ControllerLayoutId[] = ['executors-2pages', 'executors-busk']

/** Executor rows per page */
const EXEC_ROWS = 4
/** Columns of a page */
const EXEC_COLS = 8

/** Scene buttons, top → bottom */
export const SCENE_ROLES: readonly ControllerAction[] = [
  { type: 'go-selected' },
  { type: 'back-selected' },
  { type: 'release-all' },
  { type: 'blackout' },
  { type: 'blinder' },
  { type: 'strobe' },
  { type: 'tap' },
  { type: 'clear' }
]

/** What a pad does in a layout (null = nothing) */
export function padAction(layout: ControllerLayoutId, col: number, rowFromTop: number): ControllerAction | null {
  if (col < 0 || col >= EXEC_COLS || rowFromTop < 0) return null
  if (rowFromTop < EXEC_ROWS) return { type: 'executor', page: 'current', col, row: rowFromTop }
  const n = col + 1
  if (layout === 'executors-busk') {
    switch (rowFromTop) {
      case 4: return { type: 'group', id: `#${n}` }
      case 5: return { type: 'preset', id: `color#${n}` }
      case 6: return { type: 'preset', id: `position#${n}` }
      case 7: return { type: 'macro', id: `#${n}` }
      default: return null
    }
  }
  const row = rowFromTop - EXEC_ROWS
  return row < EXEC_ROWS ? { type: 'executor', page: 'next', col, row } : null
}

/** Bindings of a profile in a layout */
export function buildBindings(profile: ControllerProfile, layout: ControllerLayoutId): ControllerBinding[] {
  const ids = new Set<ControlId>(profile.controls.map((c) => c.id))
  const out: ControllerBinding[] = []

  if (profile.grid) {
    for (let row = 0; row < profile.grid.rows; row++) {
      for (let col = 0; col < profile.grid.cols; col++) {
        const id = profile.grid.pad(col, row)
        if (!ids.has(id)) continue
        const action = padAction(layout, col, row)
        if (!action) continue
        const binding: ControllerBinding = { control: id, action }
        if (action.type === 'executor') binding.shiftAction = { type: 'select-executor', page: action.page, col: action.col, row: action.row }
        out.push(binding)
      }
    }
  }

  for (let i = 0; i < 8; i++) {
    const id = `track:${i}`
    if (!ids.has(id)) continue
    const binding: ControllerBinding = { control: id, action: { type: 'page', page: i } }
    // APC mini: Shift + track 1-4 = ▲ ▼ ◀ ▶
    if (i === 0 || i === 2) binding.shiftAction = { type: 'page', page: '-' }
    else if (i === 1 || i === 3) binding.shiftAction = { type: 'page', page: '+' }
    out.push(binding)
  }
  if (ids.has('page:-')) out.push({ control: 'page:-', action: { type: 'page', page: '-' } })
  if (ids.has('page:+')) out.push({ control: 'page:+', action: { type: 'page', page: '+' } })

  SCENE_ROLES.forEach((action, i) => {
    const id = `scene:${i}`
    if (ids.has(id)) out.push({ control: id, action })
  })

  for (let i = 0; i < EXEC_COLS; i++) {
    if (ids.has(`fader:${i}`)) out.push({ control: `fader:${i}`, action: { type: 'column-fader', col: i } })
    else if (ids.has(`encoder:${i}`)) out.push({ control: `encoder:${i}`, action: { type: 'column-fader', col: i } })
  }
  if (ids.has('fader:8')) out.push({ control: 'fader:8', action: { type: 'grand-master' } })
  // Crossfader (APC40 mk2 & co.): manual X-fade of the GO target
  if (ids.has('xfade')) out.push({ control: 'xfade', action: { type: 'xfade' } })
  return out
}
