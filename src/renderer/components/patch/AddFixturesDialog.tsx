// ============================================================
// Add fixtures — choose a type (offline catalog, local library
// or Open Fixture Library online), a mode, how many, a name
// pattern and where: the addresses are planned automatically
// (next free address, gap, universe overflow) and checked against
// the patch before anything is created. Overlaps are refused,
// with an offer to shift to free addresses.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { LuArrowRight, LuCheck, LuFileUp, LuGlobe, LuLibrary, LuPackageSearch, LuPencilRuler, LuTriangleAlert, LuWandSparkles } from 'react-icons/lu'
import type { FixtureDefinition } from '@shared/types'
import {
  Badge, Button, EmptyState, Field, Modal, NumberField, Select, Switch, Tabs, TextInput, cn, fixtureCategoryIcon, formatAddressRange, toast
} from '@renderer/components/ui'
import { formatList, t as tr, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { canImportFiles, importFixtureFiles, nextGroupColor, usePatchAnalysis } from './patch-hooks'
import { expandNamePattern, findFreeAddress, planFixtures, UNIVERSE_SIZE } from './patch-utils'
import { Notice, UniverseStrip, type StripSegment } from './patch-parts'
import { LibraryBrowser, sourceLabel } from './LibraryBrowser'
import { OFLSearchPanel } from './OFLSearchPanel'
import { CatalogPanel, CatalogPreview } from './CatalogPanel'
import { installFromCatalog, useCatalogInfo } from './catalog'
import { ModeChannelList } from './FixtureDetails'
import { FixtureEditor } from './FixtureEditor'
import { useUniverseOptions } from './AddressDialog'

export interface AddFixturesRequest {
  defId?: string
  universe?: number
  address?: number
}

type SourceTab = 'catalog' | 'library' | 'online'

const MAX_COUNT = 256
const NEW_GROUP = '__new'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function AddFixturesDialog({ request, onClose }: { request: AddFixturesRequest; onClose: () => void }) {
  const t = useT()
  const universeOpts = useUniverseOptions()
  const fixtures = usePatchStore((s) => s.fixtures)
  const groups = usePatchStore((s) => s.groups)
  const { patch, items } = usePatchAnalysis()
  const catalog = useCatalogInfo()
  const catalogOff = catalog?.available === false
  // The offline catalog is the primary source; a type preselected from the Library opens the library
  const [tab, setTab] = useState<SourceTab>(request.defId ? 'library' : 'catalog')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [catalogSeed, setCatalogSeed] = useState({ text: '', n: 0 })
  const [defId, setDefId] = useState<string | null>(request.defId ?? null)
  const [modeName, setModeName] = useState('')
  const [count, setCount] = useState(1)
  const [pattern, setPattern] = useState('')
  const [startNumber, setStartNumber] = useState(1)
  const [numberManual, setNumberManual] = useState(false)
  const [universe, setUniverse] = useState(request.universe ?? 0)
  const [address, setAddress] = useState(request.address ?? 1)
  const [addressManual, setAddressManual] = useState(request.address !== undefined)
  const [gap, setGap] = useState(0)
  const [avoid, setAvoid] = useState(true)
  const [groupId, setGroupId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [editor, setEditor] = useState(false)

  const shownTab: SourceTab = tab === 'catalog' && catalogOff ? 'library' : tab
  const def = useMemo(() => fixtures.find((f) => f.id === defId) ?? null, [fixtures, defId])
  const mode = def?.modes.find((m) => m.name === modeName) ?? def?.modes[0]
  const channels = Math.max(1, mode?.channelCount ?? 1)

  const chooseDef = useCallback((d: FixtureDefinition) => {
    setDefId(d.id)
    setPreviewId(null)
    setModeName((cur) => (d.modes.some((m) => m.name === cur) ? cur : d.modes[0]?.name ?? ''))
    setPattern(`${d.name} {n}`)
    setNumberManual(false)
  }, [])

  const openCatalog = (text = '') => {
    setCatalogSeed((s) => ({ text, n: s.n + 1 }))
    setTab('catalog')
  }

  // Preselected type (Library → "Patch…")
  useEffect(() => {
    if (request.defId) {
      const d = usePatchStore.getState().fixtures.find((f) => f.id === request.defId)
      if (d) chooseDef(d)
    }
  }, [request.defId, chooseDef])

  // Next number after existing fixtures named like the pattern ("Spot 4" exists → start at 5)
  useEffect(() => {
    if (numberManual) return
    const m = /^(.*?)\{n+\}(.*)$/.exec(pattern.trim())
    const stem = m ? m[1] : `${pattern.trim()} `
    const tail = m ? m[2] : ''
    const re = new RegExp(`^${escapeRegExp(stem)}(\\d+)${escapeRegExp(tail)}$`)
    let max = 0
    for (const p of patch) {
      const hit = re.exec(p.name)
      if (hit) max = Math.max(max, Number(hit[1]))
    }
    setStartNumber(max + 1)
  }, [pattern, patch, numberManual])

  // Default address: first free block for this mode
  useEffect(() => {
    if (addressManual) return
    setAddress(findFreeAddress(items, universe, channels) ?? 1)
  }, [items, universe, channels, addressManual])

  const plan = useMemo(
    () => (def ? planFixtures(items, { count, channels, universe, address, gap, avoidConflicts: avoid, namePattern: pattern, startNumber }) : []),
    [def, items, count, channels, universe, address, gap, avoid, pattern, startNumber]
  )
  const conflicts = plan.filter((p) => p.conflictWith.length > 0)
  const overflow = plan.filter((p) => p.overflow)
  const names = useMemo(() => new Map(patch.map((p) => [p.id, p.name])), [patch])
  const usedUniverses = useMemo(() => [...new Set(plan.filter((p) => !p.overflow).map((p) => p.universe))].sort((a, b) => a - b), [plan])
  const spills = usedUniverses.some((u) => u !== universe)

  const strips = useMemo(() => (usedUniverses.length > 0 ? usedUniverses : [universe]).slice(0, 3).map((u) => {
    const segs: StripSegment[] = items.filter((f) => f.universe === u).map((f) => ({ key: f.id, address: f.address, count: f.count, kind: 'existing', label: names.get(f.id) }))
    for (const p of plan) {
      if (p.universe !== u || p.overflow) continue
      segs.push({ key: `n${p.index}`, address: p.address, count: channels, kind: p.conflictWith.length > 0 ? 'conflict' : 'new', label: p.name })
    }
    return { universe: u, segs }
  }), [usedUniverses, universe, items, plan, channels, names])

  const valid = !!def && !!mode && plan.length > 0 && conflicts.length === 0 && overflow.length === 0 && (groupId !== NEW_GROUP || !!newGroupName.trim())

  const add = () => {
    if (!def || !mode || !valid) return
    const store = usePatchStore.getState()
    let gid = groupId || undefined
    if (groupId === NEW_GROUP) {
      store.addGroup(newGroupName.trim(), nextGroupColor(store.groups))
      gid = usePatchStore.getState().groups.at(-1)?.id
    }
    const ids = store.addFixtures(
      plan.map((p) => ({ fixtureDefId: def.id, modeName: mode.name, universe: p.universe, address: p.address, name: p.name })),
      gid
    )
    if (ids.length === 0) { toast.error(tr('patch.add.nothingPatched')); return }
    store.selectFixtures(ids)
    const first = plan[0]
    const last = plan[plan.length - 1]
    toast.success(ids.length === 1 ? tr('patch.add.patchedOne', { name: first.name }) : tr('patch.add.patchedMany', { count: ids.length, type: def.name }), {
      description: ids.length === 1
        ? formatAddressRange(first.universe, first.address, channels)
        : `${formatAddressRange(first.universe, first.address, channels).split('–')[0]} → ${formatAddressRange(last.universe, last.address, channels)}`
    })
    onClose()
  }

  const groupOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: '', label: t('patch.parts.noGroup') }]
    const ids = new Set(groups.map((g) => g.id))
    const walk = (parent: string | undefined, depth: number) => {
      for (const g of groups.filter((x) => (x.parentGroupId && ids.has(x.parentGroupId) ? x.parentGroupId : undefined) === parent)) {
        out.push({ value: g.id, label: `${'   '.repeat(depth)}${g.name}` })
        walk(g.id, depth + 1)
      }
    }
    walk(undefined, 0)
    out.push({ value: NEW_GROUP, label: t('patch.add.newGroupOption') })
    return out
  }, [groups, t])

  const Icon = fixtureCategoryIcon(def?.categories)
  const preview = plan.slice(0, 64)
  const conflictNames = [...new Set(conflicts.flatMap((c) => c.conflictWith))].slice(0, 5).map((id) => names.get(id) ?? '?')
  const nextUniverses = usedUniverses.filter((u) => u !== universe).map((u) => String(u + 1))

  // Right pane while browsing the catalog: preview of the tapped fixture
  const catalogPreview = shownTab === 'catalog' && previewId ? (
    <CatalogPreview
      id={previewId}
      renderActions={(d) => {
        const local = fixtures.find((f) => f.id === d.id)
        return (
          <>
            {local && <Badge tone="go" icon={LuCheck}>{t('patch.shared.inLibrary')}</Badge>}
            <Button
              size="sm"
              variant="primary"
              icon={LuArrowRight}
              onClick={() => {
                if (local) chooseDef(local)
                else void installFromCatalog(d).then((x) => { if (x) chooseDef(x) })
              }}
            >
              {t('patch.shared.use')}
            </Button>
          </>
        )
      }}
    />
  ) : null

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        flush
        title={t('patch.add.title')}
        footer={(
          <>
            <p className={cn('mr-auto min-w-0 truncate text-xs tabular', def && (conflicts.length > 0 || overflow.length > 0) ? 'text-danger-fg' : 'text-fg-tertiary')}>
              {!def
                ? t('patch.add.footerSelect')
                : conflicts.length > 0 || overflow.length > 0
                  ? t('patch.add.footerResolve')
                  : t('patch.add.footerSummary', {
                      fixtures: t('common.fixtureCount', { count: plan.length }),
                      per: channels,
                      channels: t('common.channelCount', { count: plan.length * channels })
                    })}
            </p>
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!valid} onClick={add} data-action="patch">
              {count > 1 ? t('patch.add.patchMany', { count }) : t('patch.add.patchOne')}
            </Button>
          </>
        )}
      >
        <div className="flex h-[min(720px,calc(100vh-200px))] min-h-[360px] border-t border-line-subtle">
          {/* Type */}
          <div className="flex w-[340px] shrink-0 flex-col border-r border-line-subtle [[data-density=touch]_&]:w-[400px]">
            <div className="flex shrink-0 items-end gap-1 px-2.5 pt-1">
              <Tabs
                size="sm"
                fit
                aria-label={t('patch.add.sourceAria')}
                value={shownTab}
                onChange={setTab}
                items={[
                  ...(catalogOff ? [] : [{ id: 'catalog' as const, label: t('patch.add.tabs.catalog'), icon: LuPackageSearch, 'data-source-tab': 'catalog' }]),
                  { id: 'library' as const, label: t('patch.add.tabs.library'), icon: LuLibrary, 'data-source-tab': 'library' },
                  { id: 'online' as const, label: t('patch.add.tabs.online'), icon: LuGlobe, 'data-source-tab': 'online' }
                ]}
                className="flex-1"
              />
            </div>
            {catalogOff && (
              <p className="flex shrink-0 items-center gap-1.5 px-3 pt-1.5 text-2xs text-warning-fg" title={catalog?.error}>
                <LuTriangleAlert size={12} aria-hidden className="shrink-0" />
                <span className="truncate">{t('patch.add.catalogUnavailable')}{catalog?.error ? ` — ${catalog.error}` : ''}</span>
              </p>
            )}
            {shownTab === 'catalog' ? (
              <CatalogPanel
                key={catalogSeed.n}
                className="flex-1"
                info={catalog}
                initialText={catalogSeed.text}
                previewId={previewId ?? (def?.id ?? null)}
                onPreview={(e) => setPreviewId(e.id)}
                onFixtureDownloaded={chooseDef}
              />
            ) : shownTab === 'library' ? (
              <LibraryBrowser
                className="flex-1"
                selectedId={defId}
                onSelect={chooseDef}
                onActivate={(d) => { chooseDef(d) }}
                onSearchCatalog={catalogOff ? undefined : (q) => openCatalog(q)}
                emptyAction={!catalogOff ? <Button size="sm" variant="primary" icon={LuPackageSearch} onClick={() => openCatalog()}>{t('patch.library.browseCatalog')}</Button> : undefined}
              />
            ) : (
              <OFLSearchPanel
                className="flex-1"
                onOpenCatalog={catalogOff ? undefined : () => openCatalog()}
                onFixtureDownloaded={(d) => { chooseDef(d); setTab('library') }}
              />
            )}
            <div className="flex shrink-0 items-center gap-1 border-t border-line-subtle p-1.5">
              <Button size="sm" variant="ghost" icon={LuPencilRuler} onClick={() => setEditor(true)}>{t('patch.shared.newType')}</Button>
              {canImportFiles() && (
                <Button size="sm" variant="ghost" icon={LuFileUp} onClick={async () => {
                  const ids = await importFixtureFiles()
                  const d = ids.length > 0 ? usePatchStore.getState().fixtures.find((f) => f.id === ids[0]) : undefined
                  if (d) { chooseDef(d); setTab('library') }
                }}>{t('patch.add.importFile')}</Button>
              )}
            </div>
          </div>

          {/* Configuration */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {catalogPreview ?? (!def || !mode ? (
              <EmptyState
                icon={shownTab === 'catalog' ? LuPackageSearch : LuLibrary}
                title={t('patch.add.emptyTitle')}
                description={t('patch.add.emptyDescription')}
              />
            ) : (
              <div className="flex flex-col gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-inset ring-line">
                    <Icon size={20} aria-hidden className="text-fg-secondary" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base font-semibold text-fg-primary">{def.name}</span>
                    <span className="truncate text-xs text-fg-tertiary">{def.manufacturer} · {sourceLabel(def).label}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4">
                  <Field layout="stacked" label={t('common.mode')} className="col-span-2">
                    {(id) => (
                      <Select
                        id={id}
                        value={mode.name}
                        onChange={setModeName}
                        options={def.modes.map((m) => ({ value: m.name, label: t('patch.shared.modeOption', { name: m.name, count: m.channelCount }) }))}
                      />
                    )}
                  </Field>
                  <Field layout="stacked" label={t('patch.add.quantity')}>
                    <NumberField aria-label={t('patch.add.quantity')} value={count} onChange={setCount} min={1} max={MAX_COUNT} step={1} />
                  </Field>
                  <Field layout="stacked" label={t('common.group')}>
                    {(id) => <Select id={id} value={groupId} onChange={setGroupId} options={groupOptions} />}
                  </Field>
                  {groupId === NEW_GROUP && (
                    <Field layout="stacked" label={t('patch.add.newGroupName')} className="col-span-2 lg:col-span-4">
                      {(id) => <TextInput id={id} value={newGroupName} placeholder={t('patch.add.newGroupPlaceholder')} onChange={(e) => setNewGroupName(e.target.value)} invalid={!newGroupName.trim()} />}
                    </Field>
                  )}
                  <Field
                    layout="stacked"
                    label={t('common.name')}
                    className="col-span-2 lg:col-span-3"
                    hint={t.rich('patch.add.nameHint', {
                      n: <code className="font-mono text-fg-secondary">{'{n}'}</code>,
                      nn: <code className="font-mono text-fg-secondary">{'{nn}'}</code>,
                      first: <span className="text-fg-secondary">{expandNamePattern(pattern, startNumber, count)}</span>
                    })}
                  >
                    {(id) => <TextInput id={id} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('patch.add.namePlaceholder')} />}
                  </Field>
                  <Field layout="stacked" label={t('patch.add.firstNumber')}>
                    <NumberField aria-label={t('patch.add.firstNumber')} value={startNumber} onChange={(v) => { setNumberManual(true); setStartNumber(v) }} min={0} max={9999} step={1} />
                  </Field>
                  <Field layout="stacked" label={t('common.universe')}>
                    {(id) => <Select id={id} value={String(universe)} onChange={(v) => setUniverse(Number(v))} options={universeOpts} />}
                  </Field>
                  <Field layout="stacked" label={t('patch.shared.startAddress')} className="col-span-1 lg:col-span-2">
                    <div className="flex gap-2">
                      <NumberField aria-label={t('patch.shared.startAddress')} value={address} onChange={(v) => { setAddressManual(true); setAddress(v) }} min={1} max={UNIVERSE_SIZE} step={1} className="min-w-[72px] flex-1" />
                      <Button
                        variant="secondary"
                        icon={LuWandSparkles}
                        tooltip={t('patch.shared.nextFreeTooltip')}
                        onClick={() => { setAddressManual(false); setAddress(findFreeAddress(items, universe, channels) ?? 1) }}
                      >
                        {t('patch.shared.nextFree')}
                      </Button>
                    </div>
                  </Field>
                  <Field layout="stacked" label={t('patch.shared.gap')}>
                    <NumberField aria-label={t('patch.shared.gapBetween')} value={gap} onChange={setGap} min={0} max={64} step={1} unit={t('units.channelsShort')} />
                  </Field>
                </div>

                <Switch
                  checked={avoid}
                  onChange={setAvoid}
                  label={t('patch.shared.skipUsed')}
                  description={t('patch.add.skipUsedDescription')}
                />

                <div className="flex flex-col gap-2">
                  {strips.map((s) => <UniverseStrip key={s.universe} label={t('common.universeN', { n: s.universe + 1 })} segments={s.segs} />)}
                  <div className="flex items-center gap-3 text-2xs text-fg-tertiary">
                    <Legend className="bg-surface-5">{t('patch.add.legend.patched')}</Legend>
                    <Legend className="bg-accent">{t('patch.add.legend.new')}</Legend>
                    <Legend className="bg-danger">{t('patch.add.legend.overlap')}</Legend>
                  </div>
                </div>

                {conflicts.length > 0 && (
                  <Notice
                    tone="danger"
                    title={conflicts.length === plan.length && plan.length > 1 ? t('patch.add.conflictsAll') : t('patch.add.conflictsSome', { count: conflicts.length })}
                    action={<Button size="sm" variant="secondary" onClick={() => setAvoid(true)}>{t('patch.shared.shiftToFree')}</Button>}
                  >
                    {t('patch.shared.alreadyUse', { names: conflictNames.join(', '), count: conflictNames.length })}
                  </Notice>
                )}
                {overflow.length > 0 && (
                  <Notice
                    tone="danger"
                    title={t('patch.shared.overflowTitle', { count: overflow.length, max: UNIVERSE_SIZE })}
                    action={!avoid ? <Button size="sm" variant="secondary" onClick={() => setAvoid(true)}>{t('patch.add.continueNext')}</Button> : undefined}
                  >
                    {avoid ? t('patch.add.noRoomLeft') : t('patch.add.lowerOrContinue')}
                  </Notice>
                )}
                {spills && conflicts.length === 0 && overflow.length === 0 && (
                  <Notice tone="info" title={t('patch.add.continuesOn', { list: formatList(nextUniverses), count: nextUniverses.length })}>
                    {t('patch.add.noRoomFromStart', { n: universe + 1 })}
                  </Notice>
                )}

                <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-line">
                  <div className="flex h-control-sm items-center justify-between bg-surface-2 px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
                    <span>{t('patch.add.preview')}</span>
                    <span className="tabular">{t('common.fixtureCount', { count: plan.length })}</span>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto bg-surface-0">
                    {preview.map((p) => (
                      <div key={p.index} className="flex h-row items-center gap-2 border-t border-line-subtle px-3 text-sm first:border-t-0">
                        <span className="w-8 shrink-0 text-right font-mono text-2xs tabular text-fg-tertiary">{p.index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-fg-primary">{p.name}</span>
                        <LuArrowRight size={12} aria-hidden className="shrink-0 text-fg-tertiary" />
                        <span className={cn('font-mono text-xs tabular', p.overflow || p.conflictWith.length > 0 ? 'text-danger-fg' : 'text-accent-fg')}>
                          {p.overflow ? t('patch.add.noRoom') : formatAddressRange(p.universe, p.address, channels)}
                        </span>
                        {p.conflictWith.length > 0 && <Badge size="xs" tone="danger">{t('patch.add.overlapBadge')}</Badge>}
                      </div>
                    ))}
                    {plan.length > preview.length && <p className="border-t border-line-subtle px-3 py-1.5 text-xs text-fg-tertiary">{t('patch.add.andMore', { count: plan.length - preview.length })}</p>}
                  </div>
                </div>

                <details className="group rounded-lg ring-1 ring-inset ring-line">
                  <summary className="flex h-control-sm cursor-pointer list-none items-center gap-2 px-3 text-xs text-fg-secondary hover:text-fg-primary">
                    <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('common.channels')}</span>
                    <span className="tabular text-fg-tertiary">{t('patch.add.channelsIn', { count: mode.channelCount, mode: mode.name })}</span>
                  </summary>
                  <div className="max-h-[240px] overflow-y-auto border-t border-line-subtle"><ModeChannelList def={def} modeName={mode.name} dense /></div>
                </details>
              </div>
            ))}
          </div>
        </div>
      </Modal>
      {editor && (
        <FixtureEditor
          onClose={() => setEditor(false)}
          onSaved={(d) => { chooseDef(d); setTab('library') }}
        />
      )}
    </>
  )
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('h-2 w-3 rounded-sm', className)} />
      {children}
    </span>
  )
}
