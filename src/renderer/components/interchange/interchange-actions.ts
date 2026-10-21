// ============================================================
// Import / export flows (File › Import… / Export…, drag and drop, USB
// stick, web remote):
//
//   file → main process importer (bridge.interchange) → fragment
//   → wizard preview / options (CSV: column mapping first when unsure)
//   → merge (lib/interchange-merge, pure) → fixture types installed
//     into the library → content applied:
//       merge mode: ONE undo step (lib/history historyStep) + "Undo" toast,
//       new show:   console = like File › New then the content (unsaved,
//                   Save asks for a name); remote = uploaded to the
//                   console, which adopts it (like a .pbshow upload).
//
// Web remote: the browser reads the file and sends its bytes (≤ 14 MB)
// to the console, which parses it; the merge runs on the remote's copy
// of the show and reaches the console as a normal remote edit.
// Exports come back as bytes the browser downloads.
// ============================================================

import { CONTENT_SECTIONS, type ContentSection } from '@shared/show-format'
import type { ImportOptions, ImportWarning, InterchangeContent, MergeOptions } from '@shared/interchange'
import type { InterchangeImportResult } from '@shared/photonboard-api'
import type { SectionChange } from '@shared/remote-commands'
import type { FixtureDefinition } from '@shared/types'
import { confirm } from '@renderer/components/ui'
import { formatList, hasTranslation, t, type TranslationKey } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { showToast } from '@renderer/stores/toast-store'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { historyStep, undoStep } from '@renderer/lib/history'
import { applySectionChanges, readAllSections } from '@renderer/lib/content-sync'
import { diffSection, type SectionData } from '@renderer/lib/content-merge'
import { applyShowData, collectShowData, uploadShowFile } from '@renderer/lib/show-io'
import {
  MERGE_CONTENT_KINDS, defaultMergeOptions, emptyMergeContent, mergeFragment, missingFixtureTypes, showFromContent, type MergeContent,
  type MergeReport
} from '@renderer/lib/interchange-merge'
import { resolveUnsaved } from '@renderer/components/layout/file-actions'
import { closeImportWizard, useInterchangeStore, type ImportSource, type WizardError, type WizardStep } from './interchange-store'
import { warningText } from './warning-text'

// ---------------------------------------------------------------
// Texts
// ---------------------------------------------------------------

export { warningText } from './warning-text'

export function errorText(e: WizardError | null): string {
  if (!e) return ''
  const key = `interchange.errors.${e.code}`
  if (e.code && hasTranslation(key)) {
    return t(key as TranslationKey, { format: e.format ?? '', error: e.message ?? '', app: e.format ?? '', ...e.params })
  }
  return e.message ? t('interchange.errors.generic', { error: e.message }) : t('interchange.errors.unknownFormat')
}

/** "12 fixtures, 3 groups and 5 sequences" */
export function describeCounts(counts: Partial<Record<InterchangeContent, number>>): string {
  const parts = MERGE_CONTENT_KINDS
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => t(`interchange.counts.${k}` as TranslationKey, { count: counts[k]! }))
  return formatList(parts)
}

// ---------------------------------------------------------------
// Formats
// ---------------------------------------------------------------

export async function loadFormats(): Promise<void> {
  if (useInterchangeStore.getState().formats) return
  try {
    const formats = await getBridge()?.interchange?.formats()
    if (formats) useInterchangeStore.setState({ formats })
  } catch (e) {
    console.warn('[Interchange] formats unavailable:', e)
  }
}

export function interchangeAvailable(): boolean {
  return !!getBridge()?.interchange
}

// ---------------------------------------------------------------
// Import: getting the file
// ---------------------------------------------------------------

function isShowEmpty(): boolean {
  const s = readAllSections()
  return s.patch.length === 0 && s.cuelists.length === 0 && s.presets.length === 0 && s.chases.length === 0
}

function adoptResult(res: InterchangeImportResult | null | undefined, source: ImportSource | null, back?: WizardStep): void {
  const store = useInterchangeStore
  if (!res || (!res.success && res.canceled)) {
    // Dialog closed: back where the wizard was (or closed when it was not shown yet)
    if (back && back !== 'loading' && back !== 'applying') store.setState({ step: back })
    else closeImportWizard()
    return
  }
  if (!res.success) {
    if (res.guidance) {
      store.setState({ step: 'guidance', guidance: { ...res.guidance, fileName: res.fileName ?? source?.fileName ?? '' }, error: null })
    } else {
      store.setState({ step: 'error', error: { code: res.errorCode, message: res.error, format: res.detectedFormat } })
    }
    return
  }
  const fragment = res.fragment
  const resolvedSource: ImportSource | null = source ?? (res.path ? { kind: 'path', path: res.path, fileName: res.fileName ?? res.path } : null)
  const previous = store.getState().options
  const options: MergeOptions = previous && store.getState().fragment?.format === fragment.format
    ? { ...defaultMergeOptions(fragment, previous.mode), addressConflicts: previous.addressConflicts, universeOffset: previous.universeOffset }
    : defaultMergeOptions(fragment, isShowEmpty() ? 'new' : 'merge')
  const unsure = !!fragment.tabular && !fragment.tabular.confident
  store.setState({ step: unsure ? 'mapping' : 'preview', fragment, options, source: resolvedSource, guidance: null, error: null })
}

async function runSource(source: ImportSource, options?: ImportOptions): Promise<void> {
  const api = getBridge()?.interchange
  if (!api) {
    useInterchangeStore.setState({ importOpen: true, step: 'error', error: { code: 'unavailable' } })
    return
  }
  useInterchangeStore.setState({ importOpen: true, step: 'loading', source })
  try {
    const res = source.kind === 'path'
      ? await api.importFile({ path: source.path, options })
      : await api.importData(source.fileName, source.data, { options })
    adoptResult(res, source)
  } catch (e) {
    useInterchangeStore.setState({ step: 'error', error: { message: (e as Error).message } })
  }
}

/** File › Import…: the OS dialog (console) or the wizard's file picker (remote) */
export async function requestImport(opts: { startDir?: string } = {}): Promise<void> {
  void loadFormats()
  const api = getBridge()?.interchange
  if (!api || isRemoteMode()) {
    useInterchangeStore.setState({ importOpen: true, step: api ? 'pick' : 'error', error: api ? null : { code: 'unavailable' }, fragment: null, guidance: null })
    return
  }
  useInterchangeStore.setState({ importOpen: true, step: 'loading', source: null, fragment: null, guidance: null, error: null })
  try {
    adoptResult(await api.importFile({ startDir: opts.startDir }), null)
  } catch (e) {
    useInterchangeStore.setState({ step: 'error', error: { message: (e as Error).message } })
  }
}

/** The OS dialog again from the wizard (console) */
export async function pickAnotherFile(): Promise<void> {
  const api = getBridge()?.interchange
  if (!api) return
  const back = useInterchangeStore.getState().step
  useInterchangeStore.setState({ step: 'loading' })
  try {
    adoptResult(await api.importFile({}), null, back)
  } catch (e) {
    useInterchangeStore.setState({ step: 'error', error: { message: (e as Error).message } })
  }
}

/** A file picked in the browser or dropped on the window */
export async function importFile(file: File): Promise<void> {
  void loadFormats()
  const api = getBridge()?.interchange
  if (!api) {
    useInterchangeStore.setState({ importOpen: true, step: 'error', error: { code: 'unavailable' } })
    return
  }
  const path = !isRemoteMode() ? api.pathForFile?.(file) : null
  if (path) return runSource({ kind: 'path', path, fileName: file.name })
  if (file.size > api.maxDataSize) {
    const mb = (n: number) => Math.round(n / 1024 / 1024 * 10) / 10
    useInterchangeStore.setState({
      importOpen: true, step: 'error',
      error: { code: isRemoteMode() ? 'tooLargeRemote' : 'tooLarge', params: { size: mb(file.size), max: mb(api.maxDataSize) } }
    })
    return
  }
  useInterchangeStore.setState({ importOpen: true, step: 'loading', source: { kind: 'data', data: new Uint8Array(), fileName: file.name } })
  let data: Uint8Array
  try {
    data = new Uint8Array(await file.arrayBuffer())
  } catch (e) {
    useInterchangeStore.setState({ step: 'error', error: { code: 'unreadable', message: (e as Error).message } })
    return
  }
  return runSource({ kind: 'data', data, fileName: file.name })
}

/** Same file again with operator choices (CSV column mapping) */
export async function reimport(options: ImportOptions): Promise<void> {
  const source = useInterchangeStore.getState().source
  if (source) await runSource(source, options)
}

// ---------------------------------------------------------------
// Import: applying the fragment
// ---------------------------------------------------------------

/** The current show content as the merge sees it */
function currentContent(): MergeContent {
  const s = readAllSections()
  return {
    patch: s.patch, groups: s.groups, presets: s.presets, cuelists: s.cuelists, chases: s.chases, effects: s.effects,
    midiMappings: s.midiMappings, macros: s.macros, speedMasters: s.speedMasters, stagePages: s.stagePages,
    executor: s.executor, timeline: s.timeline, roomConfig: s.roomConfig
  }
}

/** Section diffs from the current stores to the merged content */
function changesTo(content: MergeContent): Partial<Record<ContentSection, SectionChange>> {
  const cur = readAllSections()
  const next: Partial<SectionData> = {
    patch: content.patch, groups: content.groups, presets: content.presets, cuelists: content.cuelists, chases: content.chases,
    effects: content.effects, midiMappings: content.midiMappings, macros: content.macros, speedMasters: content.speedMasters,
    stagePages: content.stagePages, executor: content.executor, roomConfig: content.roomConfig,
    timeline: { ...content.timeline, length: content.timeline.length ?? cur.timeline.length, loop: content.timeline.loop ?? cur.timeline.loop }
  }
  const changes: Partial<Record<ContentSection, SectionChange>> = {}
  for (const s of CONTENT_SECTIONS) {
    if (!(s in next)) continue
    const change = diffSection(s, cur[s] as never, next[s as keyof SectionData] as never)
    if (change) changes[s] = change
  }
  return changes
}

/** Fixture types the patch uses that only the offline catalog has (a .pbshow from another machine) */
async function fetchCatalogTypes(ids: string[]): Promise<FixtureDefinition[]> {
  const bridge = getBridge()
  if (!bridge) return []
  const out: FixtureDefinition[] = []
  for (const id of ids.slice(0, 300)) {
    for (const candidate of /^(ofl|qlc)\//.test(id) ? [id] : [`ofl/${id}`]) {
      try {
        const def = await bridge.fixtures.catalogGet(candidate)
        if (def) { out.push({ ...def, id }); break }
      } catch { /* not a catalog id */ }
    }
  }
  return out
}

/** Remarks of the merge itself (the reader's were shown in the preview): logged, summed up in the toast */
function mergeRemarks(name: string, report: MergeReport, extra: ImportWarning[]): string | undefined {
  const all = [...extra, ...report.warnings]
  if (all.length > 0) console.info(`[Interchange] "${name}":\n${all.map((w) => `  [${w.level}] ${warningText(w)}`).join('\n')}`)
  const serious = all.filter((w) => w.level !== 'info')
  return serious.length > 0 ? t('interchange.done.withRemarks', { count: serious.length, first: warningText(serious[0]) }) : undefined
}

/** Import the wizard's fragment with its options. Resolves true when something was applied. */
export async function applyImport(): Promise<boolean> {
  const store = useInterchangeStore
  const { fragment, options } = store.getState()
  const bridge = getBridge()
  if (!fragment || !options || !bridge) return false
  if (options.mode === 'new' && !(await resolveUnsaved(t('interchange.wizard.unsavedNew')))) return false

  store.setState({ step: 'applying' })
  try {
    let library = usePatchStore.getState().fixtures
    const missing = missingFixtureTypes(fragment, library)
    const fromCatalog = missing.length > 0 ? await fetchCatalogTypes(missing) : []
    const frag = fromCatalog.length > 0 ? { ...fragment, fixtures: [...fragment.fixtures, ...fromCatalog] } : fragment
    const base = options.mode === 'new' ? emptyMergeContent(fragment.name) : currentContent()
    const result = mergeFragment(frag, base, library, options)

    // Fixture types first: the mixer resolves patched fixtures through the library
    const installWarnings: ImportWarning[] = []
    for (const def of result.install) {
      try {
        const saved = await bridge.fixtures.save(def)
        if (!saved?.success) installWarnings.push({ level: 'warning', code: 'installFailed', message: t('interchange.wizard.installFailed', { name: def.name, error: saved?.error ?? '' }) })
      } catch (e) {
        installWarnings.push({ level: 'warning', code: 'installFailed', message: t('interchange.wizard.installFailed', { name: def.name, error: (e as Error).message }) })
      }
    }
    if (result.install.length > 0) {
      await usePatchStore.getState().loadFixtures().catch(() => {})
      library = usePatchStore.getState().fixtures
    }

    const remarkText = mergeRemarks(fragment.name, result.report, installWarnings)
    const what = describeCounts(result.report.added)

    if (options.mode === 'new') {
      const show = showFromContent(result.content, fragment.name)
      if (isRemoteMode()) {
        const file = new File([JSON.stringify(show)], `${fragment.name}.pbshow`, { type: 'application/json' })
        let res = await uploadShowFile(file)
        if (res.status === 'error' && res.exists) {
          const ok = await confirm({
            title: t('file.replace.consoleTitle'), message: t('file.replace.message'), confirmLabel: t('file.replace.action'), tone: 'danger'
          })
          if (!ok) { store.setState({ step: 'preview' }); return false }
          res = await uploadShowFile(file, { overwrite: true })
        }
        if (res.status !== 'ok') { store.setState({ step: 'preview' }); return false }
      } else {
        // Like File › New (the console forgets its current file: Save asks for a name), then the content
        try { await bridge.show.new() } catch { /* template only */ }
        applyShowData(show, { name: show.name })
        useUiStore.getState().setDirty(true)
      }
      showToast('success', t('interchange.done.newShow', { name: show.name }), { id: 'interchange', description: [what, remarkText].filter(Boolean).join(' · ') || undefined, duration: 6000 })
      closeImportWizard()
      return true
    }

    const changes = changesTo(result.content)
    if (Object.keys(changes).length === 0) {
      showToast('info', t('interchange.done.nothing', { name: fragment.name }), { id: 'interchange', description: remarkText })
      closeImportWizard()
      return false
    }
    const step = historyStep(t('interchange.wizard.stepLabel', { name: fragment.name }), () => applySectionChanges(changes))
    showToast('success', t('interchange.done.merged', { name: fragment.name, what: what || '—' }), {
      id: 'interchange',
      description: remarkText,
      duration: 8000,
      action: step ? { label: t('common.undo'), onClick: () => { undoStep(step.id) } } : undefined
    })
    closeImportWizard()
    return true
  } catch (e) {
    console.error('[Interchange] import failed:', e)
    store.setState({ step: 'error', error: { message: (e as Error).message } })
    return false
  }
}

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

export function requestExport(): void {
  void loadFormats()
  useInterchangeStore.setState({ exportOpen: true })
}

function downloadBase64(fileName: string, base64: string): void {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes]))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Formats that write one fixture type (GDTF…): "Export fixture as …" in the fixture library */
export function fixtureExportFormats(): { id: string; name: string; extensions: string[] }[] {
  if (!getBridge()?.interchange?.exportFixture) return []
  return useInterchangeStore.getState().formats?.fixtureExporters ?? []
}

/** Export one fixture type. Console: save dialog (exporter's file name); remote: download. */
export async function exportFixtureAs(format: string, fixture: FixtureDefinition): Promise<boolean> {
  const api = getBridge()?.interchange
  if (!api?.exportFixture) {
    showToast('error', t('interchange.errors.unavailable'))
    return false
  }
  try {
    const res = await api.exportFixture({ format, fixture })
    if (!res || res.canceled) return false
    if (!res.success) {
      const err = res.errorCode && hasTranslation(`interchange.errors.${res.errorCode}`)
        ? t(`interchange.errors.${res.errorCode}` as TranslationKey, { error: res.error ?? '' })
        : res.error ?? ''
      showToast('error', t('interchange.fixtureExport.failed', { name: fixture.name, error: err }))
      return false
    }
    if (res.data && res.fileName) downloadBase64(res.fileName, res.data)
    const warnings = (res.warnings ?? []).filter((w) => w.level !== 'info')
    const done = res.path ? t('interchange.export.saved', { path: res.path }) : t('interchange.export.downloaded', { file: res.fileName ?? '' })
    showToast(warnings.length ? 'warning' : 'success', done, {
      id: 'interchange-export-fixture',
      description: warnings.length ? t('interchange.export.remarks', { count: warnings.length, first: warningText(warnings[0]) }) : undefined,
      duration: warnings.length ? 8000 : 4000
    })
    return true
  } catch (e) {
    showToast('error', t('interchange.fixtureExport.failed', { name: fixture.name, error: (e as Error).message }))
    return false
  }
}

/** Export the current show to `format`. Resolves true when written / downloaded. */
export async function exportShowAs(format: string): Promise<boolean> {
  const api = getBridge()?.interchange
  if (!api) {
    showToast('error', t('interchange.errors.unavailable'))
    return false
  }
  const show = collectShowData()
  const used = new Set(show.patch.map((p) => p.fixtureDefId))
  const fixtures = usePatchStore.getState().fixtures.filter((f) => used.has(f.id))
  try {
    const res = await api.exportShow({ format, show, fixtures })
    if (!res || res.canceled) return false
    if (!res.success) {
      const err = res.errorCode && hasTranslation(`interchange.errors.${res.errorCode}`)
        ? t(`interchange.errors.${res.errorCode}` as TranslationKey, { error: res.error ?? '' })
        : res.error ?? ''
      showToast('error', t('interchange.export.failed', { error: err }))
      return false
    }
    if (res.data && res.fileName) downloadBase64(res.fileName, res.data)
    const warnings = (res.warnings ?? []).filter((w) => w.level !== 'info')
    const done = res.path ? t('interchange.export.saved', { path: res.path }) : t('interchange.export.downloaded', { file: res.fileName ?? '' })
    showToast(warnings.length ? 'warning' : 'success', done, {
      id: 'interchange-export',
      description: warnings.length ? t('interchange.export.remarks', { count: warnings.length, first: warningText(warnings[0]) }) : undefined,
      duration: warnings.length ? 8000 : 4000
    })
    return true
  } catch (e) {
    showToast('error', t('interchange.export.failed', { error: (e as Error).message }))
    return false
  }
}
