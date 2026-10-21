// ============================================================
// Import wizard: file → detected format → what the file holds →
// options (current show / new show, what to import, address
// conflicts, universe offset) → Import. Closed console formats show
// an export guide; unsure CSV columns go through a mapping step.
// Flows: ./interchange-actions.ts
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { LuCircleAlert, LuFileInput, LuFileQuestion, LuFiles, LuInfo, LuTable, LuTriangleAlert } from 'react-icons/lu'
import type { ImportWarning, ImportedShowFragment, InterchangeContent, MergeOptions } from '@shared/interchange'
import { MAX_UNIVERSES } from '@shared/types'
import { Badge, Button, Checkbox, EmptyState, Modal, NumberField, SegmentedControl, Spinner, cn } from '@renderer/components/ui'
import { useT, type TranslationKey } from '@renderer/i18n'
import { isRemoteMode } from '@renderer/lib/runtime'
import { usePatchStore } from '@renderer/stores/patch-store'
import {
  MERGE_CONTENT_KINDS, fragmentContents, summarizeFixtureTypes, type FixtureTypeOrigin
} from '@renderer/lib/interchange-merge'
import { closeImportWizard, setMergeOptions, useInterchangeStore } from './interchange-store'
import { applyImport, errorText, importFile, loadFormats, pickAnotherFile, warningText } from './interchange-actions'
import { formatName } from './format-names'
import { CsvMapping } from './CsvMapping'
import { ExampleFiles, ExampleFilesLink } from './ExampleFiles'

const ORIGIN_TONE: Record<FixtureTypeOrigin, 'go' | 'info' | 'accent' | 'warning' | 'danger'> = {
  library: 'go', catalog: 'info', file: 'accent', generic: 'warning', missing: 'danger'
}

export function ImportWizard() {
  const t = useT()
  const open = useInterchangeStore((s) => s.importOpen)
  const step = useInterchangeStore((s) => s.step)
  const fragment = useInterchangeStore((s) => s.fragment)
  const fileInput = useRef<HTMLInputElement>(null)
  if (!open) return null

  const remote = isRemoteMode()
  const chooseFile = () => {
    if (remote) fileInput.current?.click()
    else void pickAnotherFile()
  }
  const busy = step === 'applying'

  let body: React.ReactNode
  let footer: React.ReactNode
  const otherFile = <Button variant="ghost" icon={LuFiles} onClick={chooseFile} disabled={busy}>{t('interchange.wizard.otherFile')}</Button>
  switch (step) {
    case 'pick':
      body = <PickStep onChoose={chooseFile} />
      footer = <Button variant="secondary" onClick={closeImportWizard}>{t('common.cancel')}</Button>
      break
    case 'loading':
      body = <LoadingStep />
      footer = <Button variant="secondary" onClick={closeImportWizard}>{t('common.cancel')}</Button>
      break
    case 'guidance':
      body = <GuidanceStep />
      footer = <>{otherFile}<Button variant="primary" onClick={closeImportWizard}>{t('common.close')}</Button></>
      break
    case 'error':
      body = <ErrorStep />
      footer = <>{otherFile}<Button variant="primary" onClick={closeImportWizard}>{t('common.close')}</Button></>
      break
    case 'mapping':
      body = <CsvMapping />
      footer = <>{otherFile}<Button variant="secondary" onClick={closeImportWizard}>{t('common.cancel')}</Button></>
      break
    default:
      body = fragment ? <PreviewStep fragment={fragment} /> : null
      footer = (
        <>
          {otherFile}
          <Button variant="secondary" onClick={closeImportWizard} disabled={busy}>{t('common.cancel')}</Button>
          <ImportButton busy={busy} />
        </>
      )
  }

  return (
    <Modal
      open
      onClose={() => { if (!busy) closeImportWizard() }}
      dismissible={!busy}
      title={t('interchange.wizard.title')}
      size="lg"
      footer={<div className="flex w-full flex-wrap items-center justify-end gap-2">{footer}</div>}
    >
      <div data-import-wizard={step} className="flex min-h-[200px] flex-col gap-4">
        {body}
      </div>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importFile(file)
        }}
      />
    </Modal>
  )
}

function ImportButton({ busy }: { busy: boolean }) {
  const t = useT()
  const options = useInterchangeStore((s) => s.options)
  const fragment = useInterchangeStore((s) => s.fragment)
  const nothing = !options || !fragment || !Object.values(options.include).some(Boolean)
  return (
    <Button variant="primary" icon={LuFileInput} loading={busy} disabled={nothing || busy} onClick={() => { void applyImport() }} data-import-apply>
      {busy ? t('interchange.wizard.importing') : t('interchange.wizard.import')}
    </Button>
  )
}

// ---------------------------------------------------------------
// Steps
// ---------------------------------------------------------------

function PickStep({ onChoose }: { onChoose: () => void }) {
  const t = useT()
  // Example files shipped with the app (console): picked in place
  const [examples, setExamples] = useState(false)
  if (examples) return <ExampleFiles onBack={() => setExamples(false)} />
  return (
    <>
      <EmptyState
        icon={LuFileInput}
        title={t('interchange.wizard.pickTitle')}
        description={<>{t('interchange.wizard.pickDescription')} {t('interchange.wizard.dropHint')}</>}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button variant="primary" size="lg" icon={LuFiles} onClick={onChoose}>{t('interchange.wizard.chooseFile')}</Button>
            <ExampleFilesLink onOpen={() => setExamples(true)} />
          </div>
        }
      />
      <SupportedFormats />
    </>
  )
}

/** Formats read / recognised (wizard picker, Settings › About) */
export function SupportedFormats({ showExports = false }: { showExports?: boolean }) {
  const t = useT()
  const formats = useInterchangeStore((s) => s.formats)
  useEffect(() => { if (!formats) void loadFormats() }, [formats])
  if (!formats) {
    return <p className="text-xs text-fg-tertiary">{t('interchange.wizard.loadingFormats')}</p>
  }
  const row = (title: string, items: { key: string; name: string; ext: string[] }[]) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{title}</span>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((f) => (
          <li key={f.key} className="flex items-center gap-1 rounded-md border border-line-subtle bg-surface-2 px-2 py-1 text-xs text-fg-secondary">
            <span className="text-fg-primary">{f.name}</span>
            <span className="font-mono text-2xs text-fg-tertiary">{f.ext.map((e) => `.${e}`).join(' ')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="flex flex-col gap-3">
      {row(showExports ? t('interchange.formatsPage.imports') : t('interchange.wizard.readsTitle'),
        formats.importers.map((f) => ({ key: f.id, name: f.name, ext: f.extensions })))}
      {showExports && row(t('interchange.formatsPage.exports'), formats.exporters.map((f) => ({ key: f.id, name: f.name, ext: f.extensions })))}
      {row(t('interchange.wizard.recognisedTitle'), formats.recognised.map((f) => ({ key: f.key, name: f.app, ext: f.extensions })))}
    </div>
  )
}

function LoadingStep() {
  const t = useT()
  const source = useInterchangeStore((s) => s.source)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-sm text-fg-secondary" role="status">
      <Spinner />
      {source ? t('interchange.wizard.loading', { file: source.fileName }) : null}
    </div>
  )
}

function GuidanceStep() {
  const t = useT()
  const guidance = useInterchangeStore((s) => s.guidance)
  const formats = useInterchangeStore((s) => s.formats)
  if (!guidance) return null
  const key = `interchange.guidance.${guidance.key}` as TranslationKey
  const steps = t(key).split('\n').map((s) => s.replace(/^\d+\.\s*/, ''))
  return (
    <div className="flex flex-col gap-4" data-guidance={guidance.key}>
      <div className="flex items-start gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
        <LuInfo size={20} aria-hidden className="mt-0.5 shrink-0 text-info-fg" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold text-fg-primary">{t('interchange.guidance.title', { app: guidance.app })}</span>
          <span className="truncate font-mono text-xs text-fg-tertiary">{guidance.fileName}</span>
          <p className="text-sm text-fg-secondary">{t('interchange.guidance.intro', { app: guidance.app })}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.guidance.readsTitle')}</span>
        <div className="flex flex-wrap gap-1.5">
          {guidance.suggestedFormats.map((f, i) => <Badge key={f} tone={i === 0 ? 'accent' : 'neutral'}>{formatName(f, formats)}</Badge>)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.guidance.stepsTitle')}</span>
        <ol className="flex flex-col gap-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-fg-secondary">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-xs text-fg-primary">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ErrorStep() {
  const t = useT()
  const error = useInterchangeStore((s) => s.error)
  const source = useInterchangeStore((s) => s.source)
  return (
    <div className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3" role="alert">
      <LuCircleAlert size={20} aria-hidden className="mt-0.5 shrink-0 text-danger-fg" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-base font-semibold text-fg-primary">{t('interchange.errors.title')}</span>
        {source?.fileName && <span className="truncate font-mono text-xs text-fg-tertiary">{source.fileName}</span>}
        <p className="text-sm text-fg-secondary">{errorText(error)}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Preview + options
// ---------------------------------------------------------------

function PreviewStep({ fragment }: { fragment: ImportedShowFragment }) {
  const t = useT()
  const formats = useInterchangeStore((s) => s.formats)
  const source = useInterchangeStore((s) => s.source)
  const options = useInterchangeStore((s) => s.options)
  const library = usePatchStore((s) => s.fixtures)
  const contents = useMemo(() => fragmentContents(fragment), [fragment])
  const types = useMemo(() => summarizeFixtureTypes(fragment, library), [fragment, library])
  const universes = useMemo(() => new Set(fragment.patch.map((p) => p.universe)).size, [fragment])
  const cueCount = useMemo(() => fragment.cuelists.reduce((n, c) => n + (Array.isArray(c.cues) ? c.cues.length : 0), 0), [fragment])
  const kinds = MERGE_CONTENT_KINDS.filter((k) => (contents[k] ?? 0) > 0)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-import-preview>
        <span className="min-w-0 truncate text-sm font-semibold text-fg-primary" title={source?.fileName}>{source?.fileName ?? fragment.name}</span>
        <Badge tone="info">{formatName(fragment.format, formats)}</Badge>
        {fragment.sourceApp && <Badge>{t('interchange.wizard.sourceApp', { app: fragment.sourceApp })}</Badge>}
        {fragment.tabular && (
          <Button size="sm" variant="ghost" icon={LuTable} onClick={() => useInterchangeStore.setState({ step: 'mapping' })}>
            {t('interchange.mapping.edit')}
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.wizard.found')}</span>
        {kinds.length === 0
          ? <EmptyState size="sm" icon={LuFileQuestion} title={t('interchange.wizard.nothingFound')} />
          : (
            <ul className="flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <li key={k} className="rounded-md bg-surface-2 px-2.5 py-1 text-sm tabular text-fg-primary" data-found={k}>
                  {t(`interchange.counts.${k}` as TranslationKey, { count: contents[k]! })}
                </li>
              ))}
              {universes > 0 && <li className="rounded-md bg-surface-2 px-2.5 py-1 text-sm tabular text-fg-secondary">{t('interchange.counts.universes', { count: universes })}</li>}
              {cueCount > 0 && <li className="rounded-md bg-surface-2 px-2.5 py-1 text-sm tabular text-fg-secondary">{t('interchange.counts.cueTotal', { count: cueCount })}</li>}
            </ul>
          )}
      </section>

      {types.length > 0 && <FixtureTypes types={types} />}
      {options && kinds.length > 0 && <Options options={options} kinds={kinds} />}
      <Warnings warnings={fragment.warnings} />
    </>
  )
}

function FixtureTypes({ types }: { types: ReturnType<typeof summarizeFixtureTypes> }) {
  const t = useT()
  const [all, setAll] = useState(false)
  const shown = all ? types : types.slice(0, 6)
  return (
    <section className="flex flex-col gap-1.5">
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.wizard.fixtureTypes')}</span>
      <ul className="flex flex-col divide-y divide-line-subtle rounded-md bg-surface-1">
        {shown.map((ty) => (
          <li key={ty.id} className="flex min-h-row items-center gap-2 px-2.5 py-1">
            <span className="min-w-0 flex-1 truncate text-sm text-fg-primary" title={ty.id}>
              {ty.manufacturer && <span className="text-fg-tertiary">{ty.manufacturer} </span>}{ty.name}
            </span>
            {ty.count > 0 && <span className="font-mono text-xs tabular text-fg-tertiary">×{ty.count}</span>}
            <Badge size="xs" tone={ORIGIN_TONE[ty.origin]}>{t(`interchange.origins.${ty.origin}` as TranslationKey)}</Badge>
          </li>
        ))}
      </ul>
      {!all && types.length > 6 && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(true)}>
          {t('interchange.wizard.showAllTypes', { count: types.length - 6 })}
        </Button>
      )}
    </section>
  )
}

function Options({ options, kinds }: { options: MergeOptions; kinds: InterchangeContent[] }) {
  const t = useT()
  const toggle = (k: InterchangeContent, on: boolean) => setMergeOptions({ include: { ...options.include, [k]: on } })
  const patching = !!options.include.patch
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line-subtle p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.wizard.whereTitle')}</span>
        <SegmentedControl<MergeOptions['mode']>
          size="md"
          aria-label={t('interchange.wizard.whereTitle')}
          items={[{ value: 'merge', label: t('interchange.wizard.modeMerge') }, { value: 'new', label: t('interchange.wizard.modeNew') }]}
          value={options.mode}
          onChange={(mode) => setMergeOptions({ mode })}
        />
        <p className="text-xs text-fg-tertiary">{options.mode === 'merge' ? t('interchange.wizard.modeMergeHint') : t('interchange.wizard.modeNewHint')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.wizard.includeTitle')}</span>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {kinds.map((k) => (
            <Checkbox key={k} checked={!!options.include[k]} onChange={(on) => toggle(k, on)} label={t(`interchange.content.${k}` as TranslationKey)} />
          ))}
        </div>
      </div>

      {options.mode === 'merge' && patching && (
        <div className="flex flex-col gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.wizard.conflictsTitle')}</span>
          <SegmentedControl<MergeOptions['addressConflicts']>
            size="md"
            aria-label={t('interchange.wizard.conflictsTitle')}
            items={[
              { value: 'shift', label: t('interchange.wizard.conflictShift') },
              { value: 'keep', label: t('interchange.wizard.conflictKeep') },
              { value: 'skip', label: t('interchange.wizard.conflictSkip') }
            ]}
            value={options.addressConflicts}
            onChange={(addressConflicts) => setMergeOptions({ addressConflicts })}
          />
          <p className="text-xs text-fg-tertiary">
            {options.addressConflicts === 'shift' ? t('interchange.wizard.conflictShiftHint')
              : options.addressConflicts === 'keep' ? t('interchange.wizard.conflictKeepHint') : t('interchange.wizard.conflictSkipHint')}
          </p>
        </div>
      )}

      {(patching || options.mode === 'merge') && (
        <div className="flex flex-wrap items-center gap-3">
          <NumberField
            label={t('interchange.wizard.universeOffset')}
            aria-label={t('interchange.wizard.universeOffset')}
            value={options.universeOffset}
            min={0}
            max={MAX_UNIVERSES - 1}
            step={1}
            onChange={(v) => setMergeOptions({ universeOffset: Math.max(0, Math.min(MAX_UNIVERSES - 1, Math.round(v))) })}
            className="w-44"
          />
          <span className="text-xs text-fg-tertiary">{t('interchange.wizard.universeOffsetHint', { universe: options.universeOffset + 1 })}</span>
        </div>
      )}
    </section>
  )
}

function Warnings({ warnings }: { warnings: ImportWarning[] }) {
  const t = useT()
  const groups = useMemo(() => {
    const byCode = new Map<string, { first: ImportWarning; count: number }>()
    for (const w of warnings) {
      const g = byCode.get(w.code)
      if (g) g.count++
      else byCode.set(w.code, { first: w, count: 1 })
    }
    const order = { error: 0, warning: 1, info: 2 }
    return [...byCode.values()].sort((a, b) => order[a.first.level] - order[b.first.level])
  }, [warnings])
  if (groups.length === 0) return null
  return (
    <section className="flex flex-col gap-1.5" data-import-warnings>
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('interchange.wizard.warningsTitle', { count: warnings.length })}</span>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {groups.map(({ first, count }) => {
          const Icon = first.level === 'info' ? LuInfo : first.level === 'warning' ? LuTriangleAlert : LuCircleAlert
          return (
            <li key={first.code} className="flex items-start gap-2 text-sm text-fg-secondary">
              <Icon size={14} aria-hidden className={cn('mt-0.5 shrink-0', first.level === 'info' ? 'text-info-fg' : first.level === 'warning' ? 'text-warning-fg' : 'text-danger-fg')} />
              <span>
                {warningText(first)}
                {count > 1 && <span className="text-fg-tertiary"> · {t('interchange.wizard.warningsMore', { count: count - 1 })}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
