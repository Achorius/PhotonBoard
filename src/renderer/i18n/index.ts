// ============================================================
// PhotonBoard i18n — small typed translation layer (no dependency).
//
//   React:      const t = useT();  t('common.save')
//               t('shell.fixtureCount', { count })        plurals
//               t.rich('settings.x', { port: <b>9090</b> }) React nodes
//   Non-React:  import { t } from '@renderer/i18n'          (stores, lib,
//               toasts, confirm dialogs — evaluated when called)
//
// Dictionaries: en.ts (source of truth, aggregates en/<area>.ts) and
// fr.ts (typed against en: a missing key does not compile).
// French typography (non-breaking spaces before : ; ! ? and inside
// « », "..." → "…") is applied once when the dictionary loads, so
// translators type ordinary spaces.
//
// Locale: chosen per machine (Settings › Display), stored in
// localStorage ('photonboard.ui.language': 'auto' | 'fr' | 'en').
// 'auto' = French on the Pi kiosk, else the system / browser
// language when it is French, else English. Applied to <html lang>.
// Changing it re-renders every component that called useT() /
// useLocale() — no reload.
// ============================================================

import { createElement, Fragment, type ReactNode } from 'react'
import { create } from 'zustand'
import { isElectronRuntime } from '@renderer/lib/runtime'
import { en } from './en'
import { fr } from './fr'
import type { Locale, PluralForms, TParams, Translation, TranslationKey } from './types'

export type { Locale, PluralForms, TParams, Translation, TranslationKey } from './types'

export const LOCALES: readonly Locale[] = ['fr', 'en']
/** Language names shown in the language picker (each in its own language, no flags) */
export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', en: 'English' }

export type LanguagePreference = 'auto' | Locale
export const LANGUAGE_PREFERENCE_KEY = 'photonboard.ui.language'

// ---------------------------------------------------------------
// Dictionaries (flattened once: 'a.b.c' → string | PluralForms)
// ---------------------------------------------------------------

type Entry = string | PluralForms

const NBSP = '\u00A0'
const NNBSP = '\u202F'

/**
 * French typography for a message template: no-break space before ":" and
 * inside « », narrow no-break space before ; ! ?, "..." → "…".
 * Placeholders ({name}) and URLs ("http://") are left alone.
 */
export function frenchTypography(s: string): string {
  return s
    .replace(/\.\.\./g, '…')
    // A missing space is added too ("Erreur: x" → "Erreur : x", "Supprimer?" → "Supprimer ?")
    .replace(/([^\s\d]):(?=\s|$)/g, `$1${NBSP}:`)
    .replace(/ :(?=\s|$|[^/\w])/g, `${NBSP}:`)
    .replace(/([^\s(])([;!?])(?=\s|$)/g, `$1${NNBSP}$2`)
    .replace(/ ([;!?])/g, `${NNBSP}$1`)
    .replace(/«\s?/g, `«${NBSP}`)
    .replace(/\s?»/g, `${NBSP}»`)
}

function isPlural(v: unknown): v is PluralForms {
  return typeof v === 'object' && v !== null && typeof (v as PluralForms).other === 'string'
}

function flatten(dict: unknown, fix: (s: string) => string, prefix = '', out = new Map<string, Entry>()): Map<string, Entry> {
  if (typeof dict !== 'object' || dict === null) return out
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, fix(v))
    else if (isPlural(v)) {
      const forms: PluralForms = { other: fix(v.other) }
      for (const cat of ['zero', 'one', 'two', 'few', 'many'] as const) {
        const f = v[cat]
        if (typeof f === 'string') forms[cat] = fix(f)
      }
      out.set(key, forms)
    } else flatten(v, fix, key, out)
  }
  return out
}

const identity = (s: string) => s

const DICTIONARIES: Record<Locale, Map<string, Entry>> = {
  en: flatten(en, identity),
  fr: flatten(fr satisfies Translation, frenchTypography)
}

// ---------------------------------------------------------------
// Locale detection & preference (localStorage may be unavailable)
// ---------------------------------------------------------------

function isLocale(v: unknown): v is Locale {
  return v === 'fr' || v === 'en'
}

/** The Pi 5 kiosk (Electron on ARM Linux) ships for French-speaking venues: French by default. */
export function isPiKiosk(): boolean {
  if (!isElectronRuntime() || typeof navigator === 'undefined') return false
  const arch = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  return arch.includes('linux') && /aarch64|arm64|armv\d/.test(arch)
}

/** Locale for 'auto': Pi kiosk → fr; system / browser language French → fr; else en. */
export function detectSystemLocale(): Locale {
  if (isPiKiosk()) return 'fr'
  if (typeof navigator === 'undefined') return 'en'
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  const first = (langs.find(Boolean) ?? '').toLowerCase()
  return first.startsWith('fr') ? 'fr' : 'en'
}

export function readLanguagePreference(): LanguagePreference {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY)
    return raw === 'auto' || isLocale(raw) ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeLanguagePreference(pref: LanguagePreference): void {
  try { window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, pref) } catch { /* private mode */ }
}

export function resolveLanguage(pref: LanguagePreference): Locale {
  return pref === 'auto' ? detectSystemLocale() : pref
}

// ---------------------------------------------------------------
// Current locale (zustand: React subscribes, lib code reads)
// ---------------------------------------------------------------

interface LocaleState {
  locale: Locale
}

export const useLocaleStore = create<LocaleState>(() => ({ locale: resolveLanguage(readLanguagePreference()) }))

const listeners = new Set<(locale: Locale) => void>()

function applyHtmlLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
applyHtmlLang(useLocaleStore.getState().locale)

export function getLocale(): Locale {
  return useLocaleStore.getState().locale
}

/** Switch the UI language now (does not store a preference — see setLanguagePreference in ui-store). */
export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === getLocale()) return
  useLocaleStore.setState({ locale })
  applyHtmlLang(locale)
  for (const l of listeners) {
    try { l(locale) } catch (e) { console.error('[i18n] locale listener failed:', e) }
  }
}

/** Called after every language change. Returns an unsubscribe function. */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Another window (Stage window, second tab) changed the preference, or the
// system language changed while on 'auto': follow it.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === LANGUAGE_PREFERENCE_KEY) setLocale(resolveLanguage(readLanguagePreference()))
  })
  window.addEventListener('languagechange', () => {
    if (readLanguagePreference() === 'auto') setLocale(detectSystemLocale())
  })
}

// ---------------------------------------------------------------
// Number formatting (cached Intl objects per locale)
// ---------------------------------------------------------------

const numberFormats = new Map<string, Intl.NumberFormat>()
const pluralRules = new Map<Locale, Intl.PluralRules>()

function numberFormat(locale: Locale, opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${locale}|${opts.minimumFractionDigits ?? ''}|${opts.maximumFractionDigits ?? ''}|${opts.useGrouping ?? ''}`
  let f = numberFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', opts)
    numberFormats.set(key, f)
  }
  return f
}

/** 1234.5 → "1,234.5" (en) / "1 234,5" (fr). Default: up to 2 decimals. */
export function formatNumber(value: number, opts: { min?: number; max?: number; grouping?: boolean } = {}, locale: Locale = getLocale()): string {
  if (!Number.isFinite(value)) return '–'
  return numberFormat(locale, {
    minimumFractionDigits: opts.min ?? 0,
    maximumFractionDigits: Math.max(opts.max ?? 2, opts.min ?? 0),
    useGrouping: opts.grouping ?? true
  }).format(value)
}

/** Fixed decimals with the locale's decimal separator, no grouping: (2.5, 1) → "2.5" / "2,5". */
export function formatDecimal(value: number, decimals: number, locale: Locale = getLocale()): string {
  if (!Number.isFinite(value)) return ''
  const s = value.toFixed(decimals)
  return locale === 'fr' ? s.replace('.', ',') : s
}

/** "," in French, "." in English */
export function decimalSeparator(locale: Locale = getLocale()): string {
  return locale === 'fr' ? ',' : '.'
}

/** Parse a number typed by the operator: accepts "2,5", "2.5" and a trailing unit ("2,5 s"). NaN when invalid. */
export function parseLocaleNumber(raw: string): number {
  const s = raw.trim().replace(/[\s\u00A0\u202F]/g, '').replace(',', '.')
  return s === '' ? NaN : parseFloat(s)
}

/** "A, B and C" / "A, B et C" */
export function formatList(items: string[], type: 'conjunction' | 'disjunction' = 'conjunction', locale: Locale = getLocale()): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type }).format(items)
  } catch {
    return items.join(', ')
  }
}

function pluralCategory(count: number, locale: Locale): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules.select(count)
}

/** Pick the plural form for `count` (French: 0 and 1 are singular). */
export function selectPlural(forms: PluralForms, count: number, locale: Locale = getLocale()): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero
  const cat = pluralCategory(Math.abs(count), locale)
  return (cat !== 'zero' ? forms[cat] : undefined) ?? forms.other
}

// ---------------------------------------------------------------
// Translate
// ---------------------------------------------------------------

const warned = new Set<string>()

function lookup(key: string, locale: Locale): Entry | undefined {
  const hit = DICTIONARIES[locale].get(key)
  if (hit !== undefined) return hit
  const fallback = DICTIONARIES.en.get(key)
  if (fallback === undefined && !warned.has(key)) {
    warned.add(key)
    console.warn(`[i18n] missing key "${key}"`)
  }
  return fallback
}

function formatParam(v: TParams[string], locale: Locale): string {
  if (typeof v === 'number') return formatNumber(v, { max: 2 }, locale)
  return v == null ? '' : v
}

function message(key: string, params: TParams | undefined, locale: Locale): string {
  const entry = lookup(key, locale)
  if (entry === undefined) return key
  const count = params?.count
  const template = typeof entry === 'string' ? entry : selectPlural(entry, typeof count === 'number' ? count : Number(count) || 0, locale)
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? formatParam(params[name], locale) : m))
}

/** Interpolation with React nodes: placeholders become the given nodes. */
function richMessage(key: string, params: Record<string, ReactNode>, locale: Locale, pluralCount?: number): ReactNode {
  const entry = lookup(key, locale)
  if (entry === undefined) return key
  const count = pluralCount ?? params.count
  const template = typeof entry === 'string' ? entry : selectPlural(entry, typeof count === 'number' ? count : 0, locale)
  const parts = template.split(/(\{\w+\})/g)
  return createElement(Fragment, null, ...parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part)
    if (!m || !(m[1] in params)) return part
    const v = params[m[1]]
    return createElement(Fragment, { key: i }, typeof v === 'number' ? formatNumber(v, { max: 2 }, locale) : v)
  }))
}

export interface TFunction {
  (key: TranslationKey, params?: TParams): string
  /**
   * Same message with React nodes in the placeholders: t.rich('x', { port: <b>9090</b> }).
   * Plurals: pass the number as `count` (formatted), or as the 3rd argument when
   * {count} is a styled node: t.rich('common.fixtureCount', { count: <b>{n}</b> }, n)
   */
  rich: (key: TranslationKey, params: Record<string, ReactNode>, count?: number) => ReactNode
  /** Locale this function translates to */
  locale: Locale
}

function makeT(locale: Locale | null): TFunction {
  const fn = ((key: TranslationKey, params?: TParams) => message(key, params, locale ?? getLocale())) as TFunction
  fn.rich = (key, params, count) => richMessage(key, params, locale ?? getLocale(), count)
  Object.defineProperty(fn, 'locale', { get: () => locale ?? getLocale() })
  return fn
}

/**
 * Translate with the CURRENT locale (non-React code: stores, lib, toasts,
 * dialogs). In components use useT() so they re-render on a language change.
 */
export const t: TFunction = makeT(null)

const boundT: Record<Locale, TFunction> = { fr: makeT('fr'), en: makeT('en') }

/** Translator for a given locale (tests, exports in a fixed language). */
export function getT(locale: Locale): TFunction {
  return boundT[locale]
}

/**
 * Hook: the translate function for the current locale. Its identity changes
 * with the language, so `useMemo(…, [t])` recomputes after a switch.
 */
export function useT(): TFunction {
  return boundT[useLocaleStore((s) => s.locale)]
}

/** Hook: current locale ('fr' | 'en') — for components that only format values. */
export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale)
}

/** True when the key exists (dynamic keys built from data). */
export function hasTranslation(key: string): key is TranslationKey {
  return DICTIONARIES.en.has(key)
}
