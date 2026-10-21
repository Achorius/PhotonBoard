// Every warning code an importer / exporter / the merge can emit has an
// English and a French text (interchange.warnings.<code>), and the params
// the emitters send fill every placeholder of both texts.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { ImportWarning } from '@shared/interchange'
import type { FixtureDefinition, ShowFile } from '@shared/types'
import { normalizeShow } from '@shared/show-format'
import { en } from '@renderer/i18n/en'
import { fr } from '@renderer/i18n/fr'
import { getT, setLocale, type TranslationKey } from '@renderer/i18n'
import { contentOfShow, defaultMergeOptions, mergeFragment } from '@renderer/lib/interchange-merge'
import { createInterchangeHost } from '../../../main/interchange'
import { FixtureCatalog } from '../../../main/fixture-catalog'
import { BUILTIN_FIXTURES } from '../../../main/fixture-library'
import { warningText } from './warning-text'

const ROOT = resolve(__dirname, '../../../..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p)
  }
  return out
}

/** Warning codes written in the sources (helper calls, `code:` fields, namespaced literals) */
function emittedCodes(): Map<string, string> {
  const files = [...sources(join(ROOT, 'src/main/interchange')), join(ROOT, 'src/renderer/lib/interchange-merge.ts')]
  const codes = new Map<string, string>()
  const patterns = [
    /\(\s*'(?:info|warning|error)'\s*,\s*(?:[^,'()]*\?\s*'[\w.]+'\s*:\s*)?'([\w.]+)'/g, // warn('info', 'code', …), item(…, cond ? 'a' : 'b', …)
    /\?\s*'([\w.]+)'\s*:\s*'(?:[\w.]+)'\s*,\s*\n?\s*(?:found|`|')/g,
    /\bcode:\s*'([\w.]+)'/g,
    /\bnote\(\s*'([\w.]+)'/g,
    /'((?:mvr|gdtf|ma|ma2|ma3|qlcplus|usitt)\.[A-Za-z][\w.]*)'/g
  ]
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const re of patterns) for (const m of text.matchAll(re)) if (!codes.has(m[1])) codes.set(m[1], f.slice(ROOT.length + 1))
  }
  // Not warnings: the wizard's own codes (already translated messages)
  codes.delete('installFailed')
  return codes
}

function leaf(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict)
}

const isMessage = (v: unknown) => typeof v === 'string' || (!!v && typeof v === 'object' && typeof (v as { other?: unknown }).other === 'string')

describe('interchange warning texts', () => {
  const codes = emittedCodes()

  it('finds the codes of every format', () => {
    for (const prefix of ['mvr.', 'gdtf.', 'ma.', 'ma3.', 'qlcplus.', 'usitt.']) {
      expect([...codes.keys()].some((c) => c.startsWith(prefix)), prefix).toBe(true)
    }
    expect(codes.has('valuesDropped')).toBe(true)
    expect(codes.has('qlcplus.fixtureModeNotFound')).toBe(true)
    expect(codes.has('gdtf.virtualChannels')).toBe(true)
    expect(codes.size).toBeGreaterThan(200)
  })

  it('every emitted code has an English and a French text', () => {
    const missing: string[] = []
    for (const [code, file] of codes) {
      for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
        if (!isMessage(leaf(dict, `interchange.warnings.${code}`))) missing.push(`${lang}: ${code} (${file})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the importers’ params fill every placeholder, in both languages', async () => {
    const catalog = new FixtureCatalog([join(ROOT, 'resources/fixture-library')])
    const host = createInterchangeHost({ getLibrary: () => BUILTIN_FIXTURES, catalog })
    const samples: string[] = []
    const dir = join(ROOT, 'test-fixtures/interchange')
    for (const sub of readdirSync(dir)) {
      const p = join(dir, sub)
      if (statSync(p).isDirectory()) for (const f of readdirSync(p)) if (!/\.(md|xsd)$/.test(f)) samples.push(join(p, f))
    }
    const warnings: ImportWarning[] = []
    const demo: ShowFile = normalizeShow(readFileSync(join(ROOT, 'scripts/dev/demo-show.pbshow'), 'utf8')).show
    const base = contentOfShow(demo)
    const library: FixtureDefinition[] = [...BUILTIN_FIXTURES]
    for (const file of samples) {
      const res = await host.importPath(file)
      if (!res.success) continue
      warnings.push(...res.fragment.warnings)
      const merged = mergeFragment(res.fragment, base, library, defaultMergeOptions(res.fragment, 'merge'))
      warnings.push(...merged.report.warnings)
    }
    for (const format of host.listFormats().exporters.map((f) => f.id)) {
      const out = await host.exportShow(format, demo, library)
      if (out.success) warnings.push(...out.warnings)
    }
    expect(warnings.length).toBeGreaterThan(30)
    const leftovers: string[] = []
    for (const lang of ['en', 'fr'] as const) {
      const tr = getT(lang)
      for (const w of warnings) {
        const key = `interchange.warnings.${w.code}`
        if (!isMessage(leaf(lang === 'en' ? en : fr, key))) { leftovers.push(`${lang}: no text for ${w.code}`); continue }
        const text = tr(key as TranslationKey, w.params)
        if (/\{\w+\}/.test(text)) leftovers.push(`${lang}: ${w.code} → ${text}`)
      }
    }
    expect([...new Set(leftovers)]).toEqual([])
  }, 120_000)

  it('the wizard shows the translated text, else the message, else the code', () => {
    setLocale('fr')
    try {
      expect(warningText({ level: 'warning', code: 'mvr.gdtfMissing', params: { file: 'Robe@Spot.gdtf' }, message: 'GDTF missing' }))
        .toBe('Le GDTF « Robe@Spot.gdtf » n’est pas inclus dans le MVR : le type de projecteur a été cherché dans la bibliothèque')
      // params missing (an older importer): its own text rather than a half-filled one
      expect(warningText({ level: 'warning', code: 'mvr.gdtfMissing', message: 'GDTF missing' })).toBe('GDTF missing')
      expect(warningText({ level: 'info', code: 'some.unknown', message: 'Plain English' })).toBe('Plain English')
      expect(warningText({ level: 'info', code: 'some.unknown' })).toBe('some.unknown')
    } finally {
      setLocale('en')
    }
  })
})
