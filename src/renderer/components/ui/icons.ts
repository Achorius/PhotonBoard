// ============================================================
// Icon set: Lucide via react-icons/lu — import icons directly:
//   import { LuPlay } from 'react-icons/lu'
// Sizes: 12 (xs controls) · 14 (sm / inline) · 16 (default) · 18-20 (nav, touch)
// No emoji anywhere in the UI. Helpers below map domain types to icons.
// ============================================================

import type { IconType } from 'react-icons'
import {
  LuAperture, LuBlend, LuBox, LuCircleDot, LuCloudFog, LuCrosshair, LuDisc3, LuFocus, LuGauge, LuLamp,
  LuLampCeiling, LuLightbulb, LuMove, LuMoveHorizontal, LuPalette, LuRows3, LuSparkles, LuSun, LuSunDim,
  LuTriangle, LuWrench, LuZap
} from 'react-icons/lu'
import type { FixtureChannel } from '@shared/types'

/** Fixture type from its OFL categories (patch lists, sidebars) */
export function fixtureCategoryIcon(categories: readonly string[] | undefined): IconType {
  const c = categories ?? []
  if (c.includes('Moving Head') || c.includes('Scanner')) return LuLampCeiling
  if (c.some((x) => x === 'Pixel Bar' || x === 'Batten' || x === 'Strip' || x === 'Matrix')) return LuRows3
  if (c.includes('Strobe')) return LuZap
  if (c.includes('Blinder')) return LuSun
  if (c.includes('Fog') || c.includes('Hazer')) return LuCloudFog
  if (c.includes('Dimmer')) return LuLightbulb
  if (c.includes('Laser')) return LuCrosshair
  if (c.includes('Effect')) return LuSparkles
  if (c.includes('Color Changer') || c.includes('PAR')) return LuLamp
  return LuBox
}

/** Channel type (fader labels, channel lists) */
export function channelTypeIcon(type: FixtureChannel['type']): IconType {
  switch (type) {
    case 'intensity': return LuSunDim
    case 'color': return LuPalette
    case 'pan': return LuMoveHorizontal
    case 'tilt': return LuMove
    case 'gobo': return LuDisc3
    case 'prism': return LuTriangle
    case 'shutter':
    case 'strobe': return LuZap
    case 'speed': return LuGauge
    case 'effect': return LuSparkles
    case 'fog': return LuCloudFog
    case 'maintenance': return LuWrench
    default: return LuCircleDot
  }
}

/** Effect library categories */
export function effectCategoryIcon(category: 'movement' | 'color' | 'intensity' | 'beam' | 'spatial' | string): IconType {
  switch (category) {
    case 'movement': return LuMove
    case 'color': return LuPalette
    case 'intensity': return LuSunDim
    case 'beam': return LuAperture
    case 'spatial': return LuBlend
    default: return LuFocus
  }
}
