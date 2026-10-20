// ============================================================
// Offline fixture catalog (Open Fixture Library + QLC+, shipped
// with the app): info cache, install into the library, credits.
// The catalog itself lives in the main process
// (window.photonboard.fixtures.catalog*).
// ============================================================

import { useEffect, useState } from 'react'
import type { FixtureCatalogEntry, FixtureCatalogInfo, FixtureCatalogSourceInfo, FixtureDefinition } from '@shared/types'
import { toast } from '@renderer/components/ui'
import { getLocale, t } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'

let infoPromise: Promise<FixtureCatalogInfo> | null = null

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  // Electron prefixes IPC errors: "Error invoking remote method 'x': Error: …"
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim() || t('patch.shared.unknownError')
}

/** Catalog info, fetched once per session (a failed request is retried next time) */
export function loadCatalogInfo(): Promise<FixtureCatalogInfo> {
  if (!infoPromise) {
    const api = typeof window !== 'undefined' ? window.photonboard?.fixtures : undefined
    if (!api?.catalogInfo) {
      return Promise.resolve({ available: false, error: 'not supported', fixtureCount: 0, sources: [], manufacturers: [], categories: [] })
    }
    infoPromise = api.catalogInfo().catch((e: unknown) => {
      infoPromise = null
      return { available: false, error: errorText(e), fixtureCount: 0, sources: [], manufacturers: [], categories: [] }
    })
  }
  return infoPromise
}

/** Catalog info for a component: null while loading */
export function useCatalogInfo(): FixtureCatalogInfo | null {
  const [info, setInfo] = useState<FixtureCatalogInfo | null>(null)
  useEffect(() => {
    let alive = true
    void loadCatalogInfo().then((i) => { if (alive) setInfo(i) })
    return () => { alive = false }
  }, [])
  return info
}

/**
 * Copy a catalog fixture into the user library, reload the library and
 * confirm with a toast. Returns the definition, or null on failure (toast shown).
 */
export async function installFromCatalog(entry: Pick<FixtureCatalogEntry, 'id' | 'name' | 'manufacturer'>): Promise<FixtureDefinition | null> {
  try {
    const def = await window.photonboard.fixtures.catalogInstall(entry.id)
    await usePatchStore.getState().loadFixtures()
    toast.success(t('patch.catalog.added', { name: def.name }), {
      description: t('patch.catalog.addedDescription', { modes: t('patch.shared.modeCount', { count: def.modes.length }), maker: def.manufacturer || entry.manufacturer })
    })
    return def
  } catch (e) {
    toast.error(t('patch.catalog.addFailed', { name: entry.name }), { description: errorText(e) })
    return null
  }
}

/** Short product name of a data source for the credits line */
function sourceName(s: FixtureCatalogSourceInfo): string {
  if (s.id === 'ofl') return 'Open Fixture Library'
  if (s.id === 'qlcplus') return 'QLC+'
  return s.name
}

function formatSourceDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(getLocale() === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  } catch {
    return iso.slice(0, 10)
  }
}

/** "Fixture data: Open Fixture Library (MIT, 20 Oct 2026) · QLC+ (Apache-2.0, 19 Oct 2026)" */
export function catalogCredits(info: FixtureCatalogInfo): string {
  const sources = info.sources.map((s) => t('patch.catalog.sourceCredit', { name: sourceName(s), license: s.license, date: formatSourceDate(s.date) }))
  return t('patch.catalog.attribution', { sources: sources.join(' · ') })
}

export { errorText as catalogErrorText }
