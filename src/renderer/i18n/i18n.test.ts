import { afterEach, describe, expect, it } from 'vitest'
import { en } from './en'
import { fr } from './fr'
import {
  decimalSeparator, formatDecimal, formatList, formatNumber, frenchTypography, getLocale, getT, hasTranslation,
  parseLocaleNumber, resolveLanguage, selectPlural, setLocale, t
} from './index'
import { formatBpm, formatHz, formatPercent, formatSeconds } from '@renderer/components/ui/format'

const NBSP = '\u00A0'
const NNBSP = '\u202F'

/** Every leaf path of a dictionary (plural objects count as one key) */
function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return []
  if (typeof (obj as { other?: unknown }).other === 'string') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix ? `${prefix}.${k}` : k] : keys(v, prefix ? `${prefix}.${k}` : k)
  )
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

function leaf(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj)
}

afterEach(() => setLocale('en'))

describe('dictionaries', () => {
  it('fr has exactly the keys of en', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort())
  })

  it('fr uses the same placeholders as en', () => {
    for (const key of keys(en)) {
      const e = leaf(en, key)
      const f = leaf(fr, key)
      const eText = typeof e === 'string' ? e : (e as { other: string }).other
      const fText = typeof f === 'string' ? f : (f as { other: string }).other
      expect(placeholders(fText), key).toEqual(placeholders(eText))
    }
  })

  it('no empty message', () => {
    for (const key of keys(fr)) {
      const f = leaf(fr, key)
      const text = typeof f === 'string' ? f : (f as { other: string }).other
      // Units like "%" are short but never empty
      expect(text.length, key).toBeGreaterThan(0)
    }
  })
})

describe('t()', () => {
  it('translates with the current locale and falls back to the key', () => {
    setLocale('en')
    expect(t('common.save')).toBe('Save')
    setLocale('fr')
    expect(getLocale()).toBe('fr')
    expect(t('common.save')).toBe('Enregistrer')
    expect(hasTranslation('common.save')).toBe(true)
    expect(hasTranslation('common.nope')).toBe(false)
    // @ts-expect-error unknown key (also a type error)
    expect(t('nope.never')).toBe('nope.never')
  })

  it('interpolates {name} and formats numbers for the locale', () => {
    expect(getT('en')('shell.status.midiInputs', { names: 'APC40' })).toBe('MIDI inputs: APC40')
    expect(getT('fr')('shell.status.midiInputs', { names: 'APC40' })).toBe(`Entrées MIDI${NBSP}: APC40`)
    expect(getT('fr')('units.fpsValue', { value: 1234.5 })).toBe(`1${NNBSP}234,5 fps`)
  })

  it('French plurals: 0 and 1 are singular', () => {
    const fr = getT('fr')
    expect(fr('common.fixtureCount', { count: 0 })).toBe('0 projecteur')
    expect(fr('common.fixtureCount', { count: 1 })).toBe('1 projecteur')
    expect(fr('common.fixtureCount', { count: 2 })).toBe('2 projecteurs')
    const en = getT('en')
    expect(en('common.fixtureCount', { count: 0 })).toBe('0 fixtures')
    expect(en('common.fixtureCount', { count: 1 })).toBe('1 fixture')
    expect(en('common.channelCount', { count: 3 })).toBe('3 channels')
    expect(fr('common.channelCount', { count: 3 })).toBe('3 canaux')
  })

  it('selectPlural: zero form wins for 0, missing categories fall back to other', () => {
    expect(selectPlural({ zero: 'none', one: 'one', other: 'many' }, 0, 'en')).toBe('none')
    expect(selectPlural({ one: 'un', other: 'plusieurs' }, 0, 'fr')).toBe('un')
    expect(selectPlural({ one: 'un', other: 'plusieurs' }, 1_000_000, 'fr')).toBe('plusieurs') // CLDR "many"
  })

  it('getT(locale) does not depend on the current locale', () => {
    setLocale('en')
    expect(getT('fr')('common.cancel')).toBe('Annuler')
  })
})

describe('French typography', () => {
  it('adds no-break spaces before : ; ! ? and inside « »', () => {
    expect(frenchTypography('Erreur : x')).toBe(`Erreur${NBSP}: x`)
    expect(frenchTypography('Erreur: x')).toBe(`Erreur${NBSP}: x`)
    expect(frenchTypography('Supprimer ?')).toBe(`Supprimer${NNBSP}?`)
    expect(frenchTypography('Supprimer?')).toBe(`Supprimer${NNBSP}?`)
    expect(frenchTypography('« {name} »')).toBe(`«${NBSP}{name}${NBSP}»`)
    expect(frenchTypography('Chargement...')).toBe('Chargement…')
  })

  it('leaves URLs, times and placeholders alone', () => {
    expect(frenchTypography('http://192.168.1.10:9091')).toBe('http://192.168.1.10:9091')
    expect(frenchTypography('01:05')).toBe('01:05')
    expect(frenchTypography('/?pin=1234')).toBe('/?pin=1234')
  })

  it('is applied to the French dictionary only', () => {
    expect(getT('fr')('file.unsaved.title', { name: 'Gala' })).toBe(`Enregistrer les modifications de «${NBSP}Gala${NBSP}»${NNBSP}?`)
    expect(getT('en')('file.unsaved.title', { name: 'Gala' })).toBe('Save changes to “Gala”?')
  })
})

describe('number & value formatting', () => {
  it('formatNumber / formatDecimal / separators', () => {
    expect(formatNumber(2.5, {}, 'fr')).toBe('2,5')
    expect(formatNumber(2.5, {}, 'en')).toBe('2.5')
    expect(formatDecimal(2.5, 1, 'fr')).toBe('2,5')
    expect(decimalSeparator('fr')).toBe(',')
    expect(parseLocaleNumber('2,5')).toBe(2.5)
    expect(parseLocaleNumber(' 2.5 ')).toBe(2.5)
    expect(Number.isNaN(parseLocaleNumber('abc'))).toBe(true)
    expect(formatList(['A', 'B', 'C'], 'conjunction', 'fr')).toBe('A, B et C')
  })

  it('format helpers follow the locale (decimal comma, spaces before units in French)', () => {
    expect(formatSeconds(2.5, 'en')).toBe('2.5s')
    expect(formatSeconds(2.5, 'fr')).toBe(`2,5${NNBSP}s`)
    expect(formatSeconds(0, 'fr')).toBe(`0${NNBSP}s`)
    expect(formatSeconds(65, 'fr')).toBe('1:05,0')
    expect(formatPercent(255, 255, 'en')).toBe('100%')
    expect(formatPercent(128, 255, 'fr')).toBe(`50${NNBSP}%`)
    expect(formatBpm(92.5, 'fr')).toBe(`92,5${NBSP}BPM`)
    expect(formatHz(0.5, 'en')).toBe('0.5 Hz')
    expect(formatHz(0.5, 'fr')).toBe(`0,5${NBSP}Hz`)
    // Default = current locale
    setLocale('fr')
    expect(formatSeconds(0.5)).toBe(`0,5${NNBSP}s`)
  })
})

describe('language preference', () => {
  it('explicit choices win over the system language', () => {
    expect(resolveLanguage('fr')).toBe('fr')
    expect(resolveLanguage('en')).toBe('en')
    expect(['fr', 'en']).toContain(resolveLanguage('auto'))
  })
})
