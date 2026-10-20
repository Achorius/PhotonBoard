import type { CueFeature } from '@shared/types'
import { t } from '@renderer/i18n'

/** "Intensity", "Position", "Colour", "Beam", "Control" in the current language (call at render time) */
export function featureLabel(f: CueFeature): string {
  switch (f) {
    case 'intensity': return t('common.intensity')
    case 'position': return t('common.position')
    case 'colour': return t('common.color')
    case 'beam': return t('common.beam')
    default: return t('pro.scenes.features.control')
  }
}
