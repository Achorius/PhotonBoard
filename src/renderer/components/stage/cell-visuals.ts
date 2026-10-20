// ============================================================
// How an executor cell reads on every surface: kind icon, name
// (also for a missing object), button-function badge.
// ============================================================

import type { IconType } from 'react-icons'
import { LuClapperboard, LuGauge, LuListOrdered, LuRepeat, LuSparkles, LuUsers } from 'react-icons/lu'
import type { ExecutorButtonFn, ExecutorTargetKind } from '@shared/types'
import { t } from '@renderer/i18n'
import { FN_BADGE } from './executor-surface'

export const KIND_ICON: Record<ExecutorTargetKind, IconType> = {
  cuelist: LuClapperboard,
  chase: LuRepeat,
  effect: LuSparkles,
  macro: LuListOrdered,
  group: LuUsers,
  speed: LuGauge
}

/** "Scene", "Chase"… (current language) */
export function kindLabel(kind: ExecutorTargetKind): string {
  return t(`pro.stage.kinds.${kind}`)
}

/** Name shown on a cell ("Missing scene" when the object was deleted) */
export function cellName(cell: { kind: ExecutorTargetKind; name: string; missing?: boolean }): string {
  if (cell.missing) return t('pro.stage.missingObject', { kind: kindLabel(cell.kind) })
  return cell.name || t('common.untitled')
}

/**
 * Badge for the button function: the mode badges TRIG / FLASH as today,
 * plus GO, GO-, OFF, SEL… for Pro functions. null = plain toggle.
 */
export function fnBadge(fn: ExecutorButtonFn, kind: ExecutorTargetKind): string | null {
  if (fn === 'toggle') return null
  if (kind === 'macro' || kind === 'group' || kind === 'speed') return fn === 'off' || fn === 'select' ? FN_BADGE[fn] : null
  return FN_BADGE[fn]
}

/** Badge tone: flash = warning, held = info, others neutral */
export function fnBadgeTone(fn: ExecutorButtonFn): 'warning' | 'info' | 'neutral' {
  if (fn === 'flash' || fn === 'swap') return 'warning'
  if (fn === 'temp') return 'info'
  return 'neutral'
}
