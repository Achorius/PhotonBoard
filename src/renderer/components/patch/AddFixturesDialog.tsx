// ============================================================
// Add fixtures — choose a type (local library or Open Fixture
// Library), a mode, how many, a name pattern and where: the
// addresses are planned automatically (next free address, gap,
// universe overflow) and checked against the patch before
// anything is created. Overlaps are refused, with an offer to
// shift to free addresses.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { LuArrowRight, LuFileUp, LuLibrary, LuPencilRuler, LuWandSparkles } from 'react-icons/lu'
import type { FixtureDefinition } from '@shared/types'
import {
  Badge, Button, EmptyState, Field, Modal, NumberField, Select, Switch, Tabs, TextInput, cn, fixtureCategoryIcon, formatAddressRange, toast
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { canImportFiles, importFixtureFiles, nextGroupColor, usePatchAnalysis } from './patch-hooks'
import { expandNamePattern, findFreeAddress, planFixtures, UNIVERSE_SIZE } from './patch-utils'
import { Notice, UniverseStrip, type StripSegment } from './patch-parts'
import { LibraryBrowser, sourceLabel } from './LibraryBrowser'
import { OFLSearchPanel } from './OFLSearchPanel'
import { ModeChannelList } from './FixtureDetails'
import { FixtureEditor } from './FixtureEditor'
import { UNIVERSE_OPTIONS } from './AddressDialog'

export interface AddFixturesRequest {
  defId?: string
  universe?: number
  address?: number
}

const MAX_COUNT = 256
const NEW_GROUP = '__new'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function AddFixturesDialog({ request, onClose }: { request: AddFixturesRequest; onClose: () => void }) {
  const fixtures = usePatchStore((s) => s.fixtures)
  const groups = usePatchStore((s) => s.groups)
  const { patch, items } = usePatchAnalysis()
  const [tab, setTab] = useState<'library' | 'online'>('library')
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

  const def = useMemo(() => fixtures.find((f) => f.id === defId) ?? null, [fixtures, defId])
  const mode = def?.modes.find((m) => m.name === modeName) ?? def?.modes[0]
  const channels = Math.max(1, mode?.channelCount ?? 1)

  const chooseDef = useCallback((d: FixtureDefinition) => {
    setDefId(d.id)
    setModeName((cur) => (d.modes.some((m) => m.name === cur) ? cur : d.modes[0]?.name ?? ''))
    setPattern(`${d.name} {n}`)
    setNumberManual(false)
  }, [])

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
    if (ids.length === 0) { toast.error('Nothing was patched'); return }
    store.selectFixtures(ids)
    const first = plan[0]
    const last = plan[plan.length - 1]
    toast.success(ids.length === 1 ? `Patched ${first.name}` : `Patched ${ids.length} fixtures: ${def.name}`, {
      description: ids.length === 1
        ? formatAddressRange(first.universe, first.address, channels)
        : `${formatAddressRange(first.universe, first.address, channels).split('–')[0]} → ${formatAddressRange(last.universe, last.address, channels)}`
    })
    onClose()
  }

  const groupOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: '', label: 'No group' }]
    const ids = new Set(groups.map((g) => g.id))
    const walk = (parent: string | undefined, depth: number) => {
      for (const g of groups.filter((x) => (x.parentGroupId && ids.has(x.parentGroupId) ? x.parentGroupId : undefined) === parent)) {
        out.push({ value: g.id, label: `${'   '.repeat(depth)}${g.name}` })
        walk(g.id, depth + 1)
      }
    }
    walk(undefined, 0)
    out.push({ value: NEW_GROUP, label: 'New group…' })
    return out
  }, [groups])

  const Icon = fixtureCategoryIcon(def?.categories)
  const preview = plan.slice(0, 64)

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        flush
        title="Add fixtures"
        footer={(
          <>
            <p className={cn('mr-auto text-xs tabular', def && (conflicts.length > 0 || overflow.length > 0) ? 'text-danger-fg' : 'text-fg-tertiary')}>
              {!def
                ? 'Select a fixture type, then set quantity and address.'
                : conflicts.length > 0 || overflow.length > 0
                  ? 'Resolve the address problems above to patch.'
                  : `${plan.length} fixture${plan.length === 1 ? '' : 's'} · ${channels} ch each · ${plan.length * channels} channels`}
            </p>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid} onClick={add}>
              {count > 1 ? `Patch ${count} fixtures` : 'Patch fixture'}
            </Button>
          </>
        )}
      >
        <div className="flex h-[min(720px,calc(100vh-200px))] min-h-[360px] border-t border-line-subtle">
          {/* Type */}
          <div className="flex w-[340px] shrink-0 flex-col border-r border-line-subtle [[data-density=touch]_&]:w-[380px]">
            <div className="flex shrink-0 items-end gap-1 px-2.5 pt-1">
              <Tabs
                size="sm"
                aria-label="Fixture source"
                value={tab}
                onChange={setTab}
                items={[{ id: 'library', label: 'Library', icon: LuLibrary }, { id: 'online', label: 'Online (OFL)' }]}
                className="flex-1"
              />
            </div>
            {tab === 'library' ? (
              <LibraryBrowser
                className="flex-1"
                selectedId={defId}
                onSelect={chooseDef}
                onActivate={(d) => { chooseDef(d) }}
                emptyAction={<Button size="sm" variant="primary" onClick={() => setTab('online')}>Search online</Button>}
              />
            ) : (
              <OFLSearchPanel
                className="flex-1"
                onFixtureDownloaded={(d) => { chooseDef(d); setTab('library') }}
              />
            )}
            <div className="flex shrink-0 items-center gap-1 border-t border-line-subtle p-1.5">
              <Button size="sm" variant="ghost" icon={LuPencilRuler} onClick={() => setEditor(true)}>New type</Button>
              {canImportFiles() && (
                <Button size="sm" variant="ghost" icon={LuFileUp} onClick={async () => {
                  const ids = await importFixtureFiles()
                  const d = ids.length > 0 ? usePatchStore.getState().fixtures.find((f) => f.id === ids[0]) : undefined
                  if (d) { chooseDef(d); setTab('library') }
                }}>Import file</Button>
              )}
            </div>
          </div>

          {/* Configuration */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {!def || !mode ? (
              <EmptyState
                icon={LuLibrary}
                title="Choose a fixture type"
                description="Pick a type from your library, or search the Open Fixture Library online. Then choose how many fixtures to patch and where."
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
                  <Field layout="stacked" label="Mode" className="col-span-2">
                    {(id) => (
                      <Select
                        id={id}
                        value={mode.name}
                        onChange={setModeName}
                        options={def.modes.map((m) => ({ value: m.name, label: `${m.name} — ${m.channelCount} ch` }))}
                      />
                    )}
                  </Field>
                  <Field layout="stacked" label="Quantity">
                    <NumberField aria-label="Quantity" value={count} onChange={setCount} min={1} max={MAX_COUNT} step={1} />
                  </Field>
                  <Field layout="stacked" label="Group">
                    {(id) => <Select id={id} value={groupId} onChange={setGroupId} options={groupOptions} />}
                  </Field>
                  {groupId === NEW_GROUP && (
                    <Field layout="stacked" label="New group name" className="col-span-2 lg:col-span-4">
                      {(id) => <TextInput id={id} value={newGroupName} placeholder="e.g. Back truss spots" onChange={(e) => setNewGroupName(e.target.value)} invalid={!newGroupName.trim()} />}
                    </Field>
                  )}
                  <Field
                    layout="stacked"
                    label="Name"
                    className="col-span-2 lg:col-span-3"
                    hint={<><code className="font-mono text-fg-secondary">{'{n}'}</code> = number, <code className="font-mono text-fg-secondary">{'{nn}'}</code> = 01, 02… — first: <span className="text-fg-secondary">{expandNamePattern(pattern, startNumber, count)}</span></>}
                  >
                    {(id) => <TextInput id={id} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Spot {n}" />}
                  </Field>
                  <Field layout="stacked" label="First number">
                    <NumberField aria-label="First number" value={startNumber} onChange={(v) => { setNumberManual(true); setStartNumber(v) }} min={0} max={9999} step={1} />
                  </Field>
                  <Field layout="stacked" label="Universe">
                    {(id) => <Select id={id} value={String(universe)} onChange={(v) => setUniverse(Number(v))} options={UNIVERSE_OPTIONS} />}
                  </Field>
                  <Field layout="stacked" label="Start address" className="col-span-1 lg:col-span-2">
                    <div className="flex gap-2">
                      <NumberField aria-label="Start address" value={address} onChange={(v) => { setAddressManual(true); setAddress(v) }} min={1} max={UNIVERSE_SIZE} step={1} className="flex-1" />
                      <Button
                        variant="secondary"
                        icon={LuWandSparkles}
                        tooltip="First free block in this universe"
                        onClick={() => { setAddressManual(false); setAddress(findFreeAddress(items, universe, channels) ?? 1) }}
                      >
                        Next free
                      </Button>
                    </div>
                  </Field>
                  <Field layout="stacked" label="Gap">
                    <NumberField aria-label="Gap between fixtures" value={gap} onChange={setGap} min={0} max={64} step={1} unit="ch" />
                  </Field>
                </div>

                <Switch
                  checked={avoid}
                  onChange={setAvoid}
                  label="Skip used addresses"
                  description="Place each fixture in the next free block (continuing on the next universe when full) instead of overlapping existing fixtures."
                />

                <div className="flex flex-col gap-2">
                  {strips.map((s) => <UniverseStrip key={s.universe} label={`Universe ${s.universe + 1}`} segments={s.segs} />)}
                  <div className="flex items-center gap-3 text-2xs text-fg-tertiary">
                    <Legend className="bg-surface-5">Patched</Legend>
                    <Legend className="bg-accent">New</Legend>
                    <Legend className="bg-danger">Overlap</Legend>
                  </div>
                </div>

                {conflicts.length > 0 && (
                  <Notice
                    tone="danger"
                    title={`${conflicts.length === plan.length && plan.length > 1 ? 'All' : conflicts.length} new fixture${conflicts.length === 1 ? '' : 's'} would overlap patched fixtures`}
                    action={<Button size="sm" variant="secondary" onClick={() => setAvoid(true)}>Shift to free addresses</Button>}
                  >
                    {[...new Set(conflicts.flatMap((c) => c.conflictWith))].slice(0, 5).map((id) => names.get(id)).join(', ')} already use{conflicts.length === 1 ? 's' : ''} these channels.
                  </Notice>
                )}
                {overflow.length > 0 && (
                  <Notice
                    tone="danger"
                    title={`${overflow.length} fixture${overflow.length === 1 ? ' does' : 's do'} not fit before channel ${UNIVERSE_SIZE}`}
                    action={!avoid ? <Button size="sm" variant="secondary" onClick={() => setAvoid(true)}>Continue on next universe</Button> : undefined}
                  >
                    {avoid ? 'There is no free room left in the following universes.' : 'Lower the start address or quantity, or let them continue on the next universe.'}
                  </Notice>
                )}
                {spills && conflicts.length === 0 && overflow.length === 0 && (
                  <Notice tone="info" title={`Continues on universe ${usedUniverses.filter((u) => u !== universe).map((u) => u + 1).join(', ')}`}>
                    Universe {universe + 1} has no room for all of them from the start address.
                  </Notice>
                )}

                <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-line">
                  <div className="flex h-control-sm items-center justify-between bg-surface-2 px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
                    <span>Preview</span>
                    <span className="tabular">{plan.length} fixture{plan.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto bg-surface-0">
                    {preview.map((p) => (
                      <div key={p.index} className="flex h-row items-center gap-2 border-t border-line-subtle px-3 text-sm first:border-t-0">
                        <span className="w-8 shrink-0 text-right font-mono text-2xs tabular text-fg-tertiary">{p.index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-fg-primary">{p.name}</span>
                        <LuArrowRight size={12} aria-hidden className="shrink-0 text-fg-tertiary" />
                        <span className={cn('font-mono text-xs tabular', p.overflow || p.conflictWith.length > 0 ? 'text-danger-fg' : 'text-accent-fg')}>
                          {p.overflow ? 'no room' : formatAddressRange(p.universe, p.address, channels)}
                        </span>
                        {p.conflictWith.length > 0 && <Badge size="xs" tone="danger">overlap</Badge>}
                      </div>
                    ))}
                    {plan.length > preview.length && <p className="border-t border-line-subtle px-3 py-1.5 text-xs text-fg-tertiary">…and {plan.length - preview.length} more</p>}
                  </div>
                </div>

                <details className="group rounded-lg ring-1 ring-inset ring-line">
                  <summary className="flex h-control-sm cursor-pointer list-none items-center gap-2 px-3 text-xs text-fg-secondary hover:text-fg-primary">
                    <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Channels</span>
                    <span className="tabular text-fg-tertiary">{mode.channelCount} in {mode.name}</span>
                  </summary>
                  <div className="max-h-[240px] overflow-y-auto border-t border-line-subtle"><ModeChannelList def={def} modeName={mode.name} dense /></div>
                </details>
              </div>
            )}
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
