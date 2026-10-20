// Icon of each stage widget kind (designer palette, inspector).

import type { IconType } from 'react-icons'
import {
  LuClock, LuGauge, LuListOrdered, LuPalette, LuPower, LuSlidersVertical, LuSquarePlay, LuType, LuUsers, LuLayoutGrid
} from 'react-icons/lu'
import type { StageWidgetKind } from '@shared/types'

export const WIDGET_ICON: Record<StageWidgetKind, IconType> = {
  executor: LuLayoutGrid,
  go: LuSquarePlay,
  fader: LuSlidersVertical,
  master: LuPower,
  group: LuUsers,
  preset: LuPalette,
  macro: LuListOrdered,
  speed: LuGauge,
  clock: LuClock,
  label: LuType
}
