// Display names of attribute families and well-known attributes in the
// UI language. The programmer model keeps its English canonical labels
// (MIDI learn parameter, tests); components translate at render time.
// Names of other channels come from the fixture data and stay as-is.

import type { TFunction } from '@renderer/i18n'
import type { fixtures as enFixtures } from '@renderer/i18n/en/fixtures'
import { STANDARD_COLOUR_WHEEL, type AttrRange, type Attribute, type Feature } from './programmer-model'

/** Colour name key (fixtures.colour.names.*) */
export type ColourName = keyof typeof enFixtures.colour.names

export function featureLabel(feature: Feature, t: TFunction): string {
  switch (feature) {
    case 'intensity': return t('common.intensity')
    case 'position': return t('common.position')
    case 'colour': return t('common.color')
    case 'beam': return t('common.beam')
    case 'control': return t('fixtures.features.control')
  }
}

type AttributeName = Exclude<keyof typeof enFixtures.attributes, 'cells'>

/** Canonical attribute key (programmer-model) → name key in fixtures.attributes */
const KNOWN: Record<string, AttributeName> = {
  dimmer: 'dimmer', pan: 'pan', tilt: 'tilt', red: 'red', green: 'green', blue: 'blue', white: 'white', amber: 'amber',
  uv: 'uv', lime: 'lime', cyan: 'cyan', magenta: 'magenta', yellow: 'yellow', 'color wheel': 'colorWheel',
  'color macro': 'colorMacro', 'color temperature': 'colorTemperature', cto: 'cto', ctb: 'ctb', shutter: 'shutter',
  strobe: 'strobe', gobo: 'gobo', 'gobo rotation': 'goboRotation', prism: 'prism', 'prism rotation': 'prismRotation',
  zoom: 'zoom', focus: 'focus', iris: 'iris', frost: 'frost', speed: 'speed'
}

/** Slots of the built-in standard colour wheel (used when the fixture data has none) → colour name key */
const STANDARD_SLOTS = new Map<AttrRange, ColourName>(
  STANDARD_COLOUR_WHEEL.map((r, i) => [r, (['open', 'red', 'orange', 'yellow', 'green', 'lightBlue', 'blue', 'magenta'] as const)[i]])
)

/** Label of a DMX range: the fixture data's own label, translated only for the built-in standard wheel */
export function rangeLabel(range: AttrRange, t: TFunction): string {
  const name = STANDARD_SLOTS.get(range)
  return name ? t(`fixtures.colour.names.${name}`) : range.label
}

/** Name of an attribute for display ("Colour wheel" / "Roue de couleurs"; data names unchanged) */
export function attrLabel(attr: Pick<Attribute, 'key' | 'label' | 'cells'>, t: TFunction): string {
  const base = attr.key.replace(/ cells$/, '')
  const known = KNOWN[base]
  if (!known) return attr.label
  const name = t(`fixtures.attributes.${known}`)
  return base !== attr.key ? t('fixtures.attributes.cells', { name }) : name
}
