// ============================================================
// PhotonBoard i18n — types derived from the English dictionary.
//
//   Translation     the deep shape of `en` with string leaves: `fr`
//                   (and every fr/<area>.ts) is typed with it, so a
//                   missing or extra key is a TypeScript error.
//   TranslationKey  every dotted key, e.g. 'common.save' — the
//                   argument of t(). A typo is a TypeScript error.
//
// Plurals: an object with an `other` key is a plural entry
//   { one: '{count} fixture', other: '{count} fixtures' }
// (`zero`, `one`, `two`, `few`, `many`, `other` — CLDR categories,
// plus `zero` used for count === 0 in any language). `other` is
// reserved: never use it as a plain key.
// ============================================================

import type { en } from './en'

export type Locale = 'fr' | 'en'

/** Plural forms of one message. `other` is required; `zero` (when present) wins for 0. */
export interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

/** Strings widened to `string`, plural objects to PluralForms, groups recursively. */
type Widen<T> = T extends string
  ? string
  : T extends { other: string }
    ? PluralForms
    : { [K in keyof T]: Widen<T[K]> }

/** Shape every locale must have (derived from en). */
export type Translation = Widen<typeof en>

type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? Join<P, K> : Paths<T[K], Join<P, K>>
}[keyof T & string]

/** Every translatable key ('common.save', 'shell.tabs.patch', …). */
export type TranslationKey = Paths<typeof en>

/** Interpolation values: `{name}` in a message. Numbers are formatted for the locale. */
export type TParams = Record<string, string | number | null | undefined>
