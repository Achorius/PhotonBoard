// ============================================================
// Fixture type editor — create a custom fixture definition, edit
// a user/imported one, or edit a copy of a built-in type.
//  - identity (maker, name, categories)
//  - channels: name, type, default, HTP/LTP, order (quick presets)
//  - modes: ordered channel lists
//  - physical: pan/tilt range, beam angle, dimensions, weight, power
// Validates before saving; closing with changes asks first.
// Existing channel data (capabilities, fine aliases, wheels, pixel
// layouts) is preserved when editing an imported fixture.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import {
  LuArrowDown, LuArrowUp, LuCirclePlus, LuListPlus, LuPlus, LuTrash2
} from 'react-icons/lu'
import type { FixtureChannel, FixtureDefinition, FixtureMode, FixturePhysical } from '@shared/types'
import {
  Badge, Button, EmptyState, Field, IconButton, Modal, NumberField, Section, SegmentedControl, Select, TextInput, Tag, ask, channelTypeIcon, cn, toast
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { getChannelTypeColor } from '@renderer/lib/fixture-library'

type ChannelType = FixtureChannel['type']

const CHANNEL_TYPES: { value: ChannelType; label: string }[] = [
  { value: 'intensity', label: 'Intensity' },
  { value: 'color', label: 'Colour' },
  { value: 'pan', label: 'Pan' },
  { value: 'tilt', label: 'Tilt' },
  { value: 'gobo', label: 'Gobo' },
  { value: 'prism', label: 'Prism' },
  { value: 'shutter', label: 'Shutter' },
  { value: 'strobe', label: 'Strobe' },
  { value: 'speed', label: 'Speed' },
  { value: 'effect', label: 'Effect' },
  { value: 'fog', label: 'Fog' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'generic', label: 'Generic' }
]

const COMMON_CATEGORIES = [
  'Moving Head', 'Scanner', 'PAR', 'Color Changer', 'Wash', 'Profile', 'Fresnel', 'Dimmer', 'Batten', 'Pixel Bar', 'Strip',
  'Matrix', 'Strobe', 'Blinder', 'Fog', 'Hazer', 'Laser', 'Effect'
]

const PRESETS: { id: string; label: string; channels: [string, ChannelType, number?][] }[] = [
  { id: 'dimmer', label: 'Dimmer', channels: [['Dimmer', 'intensity']] },
  { id: 'rgb', label: 'RGB', channels: [['Red', 'color'], ['Green', 'color'], ['Blue', 'color']] },
  { id: 'rgbw', label: 'RGBW', channels: [['Red', 'color'], ['Green', 'color'], ['Blue', 'color'], ['White', 'color']] },
  { id: 'pantilt', label: 'Pan / Tilt 16-bit', channels: [['Pan', 'pan', 128], ['Pan Fine', 'pan', 0], ['Tilt', 'tilt', 128], ['Tilt Fine', 'tilt', 0]] },
  { id: 'gobo', label: 'Gobo', channels: [['Gobo', 'gobo'], ['Gobo Rotation', 'gobo']] },
  { id: 'shutter', label: 'Shutter', channels: [['Shutter', 'shutter']] },
  { id: 'strobe', label: 'Strobe', channels: [['Strobe', 'strobe']] },
  { id: 'colorwheel', label: 'Colour wheel', channels: [['Color Wheel', 'color']] }
]

const autoPrecedence = (type: ChannelType): 'HTP' | 'LTP' => (type === 'intensity' ? 'HTP' : 'LTP')
const autoDefault = (type: ChannelType): number => (type === 'pan' || type === 'tilt' ? 128 : 0)

interface ChannelRow {
  key: string
  name: string
  type: ChannelType
  defaultValue: number
  precedence: 'HTP' | 'LTP'
  /** Original definition (capabilities, aliases… are kept on save) */
  orig?: FixtureChannel
  /** Name in the original definition (renames) */
  origName?: string
  /** Fine channel referenced by a mode but declared as an alias of another channel */
  alias?: boolean
}

interface ModeRow {
  key: string
  name: string
  channelKeys: string[]
  orig?: FixtureMode
  origName?: string
}

interface FormState {
  manufacturer: string
  name: string
  categories: string[]
  channels: ChannelRow[]
  modes: ModeRow[]
  panRange: number
  tiltRange: number
  beamMin: number
  beamMax: number
  width: number
  height: number
  depth: number
  weight: number
  power: number
}

let keySeq = 0
const newKey = (p: string) => `${p}-${++keySeq}`

function initialState(fixture: FixtureDefinition | undefined, asCopy: boolean): FormState {
  const channels: ChannelRow[] = []
  const byName = new Map<string, ChannelRow>()
  if (fixture) {
    for (const [name, ch] of Object.entries(fixture.channels)) {
      const row: ChannelRow = {
        key: newKey('ch'), name, type: ch.type ?? 'generic', defaultValue: ch.defaultValue ?? 0,
        precedence: ch.precedence ?? autoPrecedence(ch.type ?? 'generic'), orig: ch, origName: name
      }
      channels.push(row)
      byName.set(name, row)
    }
    // Channel names used by modes but only declared as fine aliases
    for (const m of fixture.modes) {
      for (const name of m.channels) {
        if (byName.has(name)) continue
        const parent = Object.values(fixture.channels).find((c) => c.fineChannelAliases?.includes(name))
        const row: ChannelRow = {
          key: newKey('ch'), name, type: parent?.type ?? 'generic', defaultValue: 0, precedence: 'LTP', origName: name, alias: true
        }
        channels.push(row)
        byName.set(name, row)
      }
    }
  }
  const modes: ModeRow[] = fixture
    ? fixture.modes.map((m) => ({
        key: newKey('mode'), name: m.name, orig: m, origName: m.name,
        channelKeys: m.channels.map((n) => byName.get(n)?.key).filter((k): k is string => !!k)
      }))
    : [{ key: newKey('mode'), name: 'Standard', channelKeys: [] }]
  const p = fixture?.physical
  return {
    manufacturer: fixture?.manufacturer ?? '',
    name: fixture ? (asCopy ? `${fixture.name} (custom)` : fixture.name) : '',
    categories: fixture?.categories ? [...fixture.categories] : [],
    channels,
    modes,
    panRange: p?.panRange ?? 0,
    tiltRange: p?.tiltRange ?? 0,
    beamMin: p?.lens?.degreesMinMax?.[0] ?? 0,
    beamMax: p?.lens?.degreesMinMax?.[1] ?? 0,
    width: p?.dimensions?.[0] ?? 0,
    height: p?.dimensions?.[1] ?? 0,
    depth: p?.dimensions?.[2] ?? 0,
    weight: p?.weight ?? 0,
    power: p?.power ?? 0
  }
}

/** Comparable snapshot (ignores generated keys) for the unsaved-changes guard */
function snapshot(s: FormState): string {
  const index = new Map(s.channels.map((c, i) => [c.key, i]))
  return JSON.stringify({
    ...s,
    channels: s.channels.map(({ name, type, defaultValue, precedence }) => [name, type, defaultValue, precedence]),
    modes: s.modes.map((m) => [m.name, m.channelKeys.map((k) => index.get(k))])
  })
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fixture'
}

interface Issues {
  list: string[]
  manufacturer?: string
  name?: string
  channelNames: Set<string>
  modeNames: Set<string>
  emptyModes: Set<string>
  beam?: string
}

export interface FixtureEditorProps {
  /** Definition to edit; omitted = new fixture type */
  fixture?: FixtureDefinition
  /** Edit a copy (new id) — used for built-in types */
  asCopy?: boolean
  onClose: () => void
  onSaved?: (def: FixtureDefinition) => void
}

export function FixtureEditor({ fixture, asCopy = false, onClose, onSaved }: FixtureEditorProps) {
  const isEdit = !!fixture && !asCopy
  const [initial] = useState(() => initialState(fixture, asCopy))
  const [form, setForm] = useState<FormState>(initial)
  const initialSnap = useRef(snapshot(initial))
  const [showIssues, setShowIssues] = useState(false)
  const [saving, setSaving] = useState(false)
  const fixtures = usePatchStore((s) => s.fixtures)
  const patch = usePatchStore((s) => s.patch)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const dirty = snapshot(form) !== initialSnap.current
  const channelByKey = useMemo(() => new Map(form.channels.map((c) => [c.key, c])), [form.channels])

  // Modes used by patched fixtures (cannot be deleted)
  const modeUsage = useMemo(() => {
    const map = new Map<string, number>()
    if (!isEdit || !fixture) return map
    for (const p of patch) if (p.fixtureDefId === fixture.id) map.set(p.modeName, (map.get(p.modeName) ?? 0) + 1)
    return map
  }, [isEdit, fixture, patch])

  const newId = isEdit ? fixture!.id : `${slug(form.manufacturer || 'user')}/${slug(form.name)}`

  const issues = useMemo<Issues>(() => {
    const out: Issues = { list: [], channelNames: new Set(), modeNames: new Set(), emptyModes: new Set() }
    if (!form.manufacturer.trim()) { out.manufacturer = 'Required'; out.list.push('Manufacturer is required') }
    if (!form.name.trim()) { out.name = 'Required'; out.list.push('Name is required') }
    if (!isEdit && form.name.trim() && fixtures.some((f) => f.id === newId)) {
      out.name = 'A fixture type with this maker and name already exists'
      out.list.push(out.name)
    }
    if (form.channels.length === 0) out.list.push('Add at least one channel')
    const seen = new Map<string, number>()
    for (const c of form.channels) seen.set(c.name.trim().toLowerCase(), (seen.get(c.name.trim().toLowerCase()) ?? 0) + 1)
    for (const c of form.channels) {
      if (!c.name.trim() || (seen.get(c.name.trim().toLowerCase()) ?? 0) > 1) out.channelNames.add(c.key)
    }
    if (out.channelNames.size > 0) out.list.push('Channel names must be filled in and unique')
    if (form.modes.length === 0) out.list.push('Add at least one mode')
    const modeSeen = new Map<string, number>()
    for (const m of form.modes) modeSeen.set(m.name.trim().toLowerCase(), (modeSeen.get(m.name.trim().toLowerCase()) ?? 0) + 1)
    for (const m of form.modes) {
      if (!m.name.trim() || (modeSeen.get(m.name.trim().toLowerCase()) ?? 0) > 1) out.modeNames.add(m.key)
      if (m.channelKeys.length === 0) out.emptyModes.add(m.key)
    }
    if (out.modeNames.size > 0) out.list.push('Mode names must be filled in and unique')
    if (out.emptyModes.size > 0) out.list.push('Every mode needs at least one channel')
    for (const [modeName, n] of modeUsage) {
      if (!form.modes.some((m) => m.origName === modeName)) out.list.push(`Mode “${modeName}” is used by ${n} patched fixture${n === 1 ? '' : 's'} and cannot be removed`)
    }
    if (form.beamMin > 0 && form.beamMax > 0 && form.beamMin > form.beamMax) { out.beam = 'Min is larger than max'; out.list.push('Beam angle: min is larger than max') }
    return out
  }, [form, isEdit, fixtures, newId, modeUsage])

  // ---- channels ----
  const addChannels = (list: [string, ChannelType, number?][]) => {
    const taken = new Set(form.channels.map((c) => c.name.toLowerCase()))
    const rows: ChannelRow[] = list.map(([name, type, def]) => {
      let n = name
      let i = 2
      while (taken.has(n.toLowerCase())) n = `${name} ${i++}`
      taken.add(n.toLowerCase())
      return { key: newKey('ch'), name: n, type, defaultValue: def ?? autoDefault(type), precedence: autoPrecedence(type) }
    })
    setForm((f) => ({
      ...f,
      channels: [...f.channels, ...rows],
      // A single mode follows the channel list automatically
      modes: f.modes.length === 1 ? [{ ...f.modes[0], channelKeys: [...f.modes[0].channelKeys, ...rows.map((r) => r.key)] }] : f.modes
    }))
  }
  const updateChannel = (key: string, patchRow: Partial<ChannelRow>) =>
    setForm((f) => ({ ...f, channels: f.channels.map((c) => (c.key === key ? { ...c, ...patchRow } : c)) }))
  const removeChannel = (key: string) =>
    setForm((f) => ({ ...f, channels: f.channels.filter((c) => c.key !== key), modes: f.modes.map((m) => ({ ...m, channelKeys: m.channelKeys.filter((k) => k !== key) })) }))
  const moveChannel = (key: string, dir: -1 | 1) => setForm((f) => {
    const i = f.channels.findIndex((c) => c.key === key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= f.channels.length) return f
    const channels = [...f.channels]
    ;[channels[i], channels[j]] = [channels[j], channels[i]]
    // Modes that contain both keep the list order
    const order = new Map(channels.map((c, idx) => [c.key, idx]))
    const modes = f.modes.map((m) => {
      if (!m.channelKeys.includes(channels[i].key) || !m.channelKeys.includes(channels[j].key)) return m
      return { ...m, channelKeys: [...m.channelKeys].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) }
    })
    return { ...f, channels, modes }
  })

  // ---- modes ----
  const addMode = () => setForm((f) => {
    const taken = new Set(f.modes.map((m) => m.name.toLowerCase()))
    let name = `${f.channels.length}ch`
    let i = 2
    while (taken.has(name.toLowerCase())) name = `${f.channels.length}ch ${i++}`
    return { ...f, modes: [...f.modes, { key: newKey('mode'), name, channelKeys: f.channels.map((c) => c.key) }] }
  })
  const updateMode = (key: string, patchRow: Partial<ModeRow>) =>
    setForm((f) => ({ ...f, modes: f.modes.map((m) => (m.key === key ? { ...m, ...patchRow } : m)) }))
  const toggleInMode = (modeKey: string, chKey: string) => setForm((f) => ({
    ...f,
    modes: f.modes.map((m) => {
      if (m.key !== modeKey) return m
      if (m.channelKeys.includes(chKey)) return { ...m, channelKeys: m.channelKeys.filter((k) => k !== chKey) }
      // Insert following the channel list order
      const order = new Map(f.channels.map((c, idx) => [c.key, idx]))
      const pos = order.get(chKey) ?? 0
      const keys = [...m.channelKeys]
      const at = keys.findIndex((k) => (order.get(k) ?? 0) > pos)
      keys.splice(at < 0 ? keys.length : at, 0, chKey)
      return { ...m, channelKeys: keys }
    })
  }))

  // ---- save ----
  const build = (): FixtureDefinition => {
    const renamed = new Map<string, string>()
    for (const c of form.channels) if (c.origName && c.origName !== c.name.trim()) renamed.set(c.origName, c.name.trim())
    const kept = new Set(form.channels.map((c) => c.origName).filter(Boolean))
    const channels: Record<string, FixtureChannel> = {}
    for (const c of form.channels) {
      if (c.alias) continue
      const name = c.name.trim()
      const base: FixtureChannel = c.orig
        ? { ...c.orig }
        : {
            name,
            type: c.type,
            capabilities: [{ dmxRange: [0, 255], type: c.type === 'intensity' ? 'Intensity' : 'Generic', label: `${name} 0-100%` }]
          }
      channels[name] = {
        ...base,
        name,
        type: c.type,
        defaultValue: c.defaultValue,
        precedence: c.precedence,
        highlightValue: base.highlightValue ?? (c.type === 'intensity' ? 255 : undefined),
        fineChannelAliases: base.fineChannelAliases
          ?.filter((a) => kept.has(a))
          .map((a) => renamed.get(a) ?? a)
      }
      if (!channels[name].fineChannelAliases?.length) delete channels[name].fineChannelAliases
    }
    const modes: FixtureMode[] = form.modes.map((m) => {
      const names = m.channelKeys.map((k) => channelByKey.get(k)?.name.trim()).filter((n): n is string => !!n)
      const sameChannels = !!m.orig && m.orig.channels.length === names.length && m.orig.channels.every((n, i) => (renamed.get(n) ?? n) === names[i])
      return {
        ...(m.orig && sameChannels ? m.orig : {}),
        name: m.name.trim(),
        channels: names,
        channelCount: names.length
      }
    })
    const physical: FixturePhysical = { ...(isEdit || asCopy ? fixture?.physical : undefined) }
    const opt = (v: number) => (v > 0 ? v : undefined)
    physical.panRange = opt(form.panRange)
    physical.tiltRange = opt(form.tiltRange)
    physical.weight = opt(form.weight)
    physical.power = opt(form.power)
    physical.lens = form.beamMin > 0 || form.beamMax > 0
      ? { degreesMinMax: [form.beamMin || form.beamMax, form.beamMax || form.beamMin] }
      : undefined
    physical.dimensions = form.width > 0 || form.height > 0 || form.depth > 0 ? [form.width, form.height, form.depth] : undefined
    for (const k of Object.keys(physical) as (keyof FixturePhysical)[]) if (physical[k] === undefined) delete physical[k]

    return {
      ...(fixture && !asCopy ? fixture : { wheels: fixture?.wheels }),
      id: newId,
      name: form.name.trim(),
      manufacturer: form.manufacturer.trim(),
      categories: form.categories,
      channels,
      modes,
      physical: Object.keys(physical).length > 0 ? physical : undefined,
      source: isEdit && fixture?.source && fixture.source !== 'builtin' ? fixture.source : 'user',
      lastModified: new Date().toISOString()
    }
  }

  const save = async () => {
    setShowIssues(true)
    if (issues.list.length > 0) return
    setSaving(true)
    try {
      const def = build()
      const result = await window.photonboard.fixtures.save(def)
      if (result && result.success === false) {
        toast.error('Fixture type not saved', { description: result.error ?? 'Unknown error' })
        return
      }
      await usePatchStore.getState().loadFixtures()
      // Patched fixtures follow renamed modes
      if (isEdit) {
        const updates: Record<string, { modeName: string }> = {}
        for (const m of form.modes) {
          if (!m.origName || m.origName === m.name.trim()) continue
          for (const p of usePatchStore.getState().patch) {
            if (p.fixtureDefId === def.id && p.modeName === m.origName) updates[p.id] = { modeName: m.name.trim() }
          }
        }
        usePatchStore.getState().updateFixtures(updates)
      }
      toast.success(isEdit ? `${def.name} updated` : `${def.name} added to the library`)
      initialSnap.current = snapshot(form)
      onSaved?.(def)
      onClose()
    } catch (e) {
      toast.error('Fixture type not saved', { description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const requestClose = async () => {
    if (!dirty) { onClose(); return }
    const choice = await ask({
      title: 'Discard changes?',
      message: 'Your changes to this fixture type have not been saved.',
      actions: [
        // Last = default (Enter): the safe choice
        { id: 'discard', label: 'Discard changes', variant: 'danger-outline' },
        { id: 'keep', label: 'Keep editing', variant: 'primary' }
      ]
    })
    if (choice === 'discard') onClose()
  }

  const title = isEdit ? `Edit ${fixture!.name}` : asCopy ? `Custom copy of ${fixture!.name}` : 'New fixture type'
  const issueShown = showIssues && issues.list.length > 0

  return (
    <Modal
      open
      onClose={() => { void requestClose() }}
      size="xl"
      title={title}
      description={asCopy ? 'Built-in types cannot be changed; this creates your own editable version.' : isEdit && fixture?.source !== 'user' ? 'Saved to your user library; capabilities and wheels from the original file are kept.' : undefined}
      flush
      footer={(
        <>
          <div className="mr-auto min-w-0 flex-1">
            {issueShown ? (
              <p role="alert" className="truncate text-xs text-danger-fg" title={issues.list.join('\n')}>
                {issues.list[0]}{issues.list.length > 1 ? ` (+${issues.list.length - 1} more)` : ''}
              </p>
            ) : (
              <p className="truncate text-xs tabular text-fg-tertiary">
                {form.channels.length} channel{form.channels.length === 1 ? '' : 's'} · {form.modes.length} mode{form.modes.length === 1 ? '' : 's'}
                {dirty && <span className="text-warning-fg"> · unsaved changes</span>}
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={() => { void requestClose() }}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => { void save() }}>{isEdit ? 'Save changes' : 'Create fixture type'}</Button>
        </>
      )}
    >
      <div className="flex flex-col border-t border-line-subtle px-2">
        <Section title="Identity">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field layout="stacked" label="Manufacturer" error={showIssues ? issues.manufacturer : undefined}>
              {(id) => <TextInput id={id} data-autofocus="" value={form.manufacturer} placeholder="e.g. Generic" invalid={showIssues && !!issues.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />}
            </Field>
            <Field layout="stacked" label="Name" error={showIssues ? issues.name : undefined} hint={!isEdit && form.name ? <span className="font-mono">{newId}</span> : undefined}>
              {(id) => <TextInput id={id} value={form.name} placeholder="e.g. LED PAR 18x10W" invalid={showIssues && !!issues.name} onChange={(e) => set('name', e.target.value)} />}
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Categories</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories">
              {[...new Set([...COMMON_CATEGORIES, ...form.categories])].map((c) => {
                const on = form.categories.includes(c)
                return (
                  <Tag key={c} selected={on} onClick={() => set('categories', on ? form.categories.filter((x) => x !== c) : [...form.categories, c])}>{c}</Tag>
                )
              })}
            </div>
          </div>
        </Section>

        <Section
          title={`Channels (${form.channels.length})`}
          actions={<Button size="sm" variant="ghost" icon={LuPlus} onClick={() => addChannels([['Channel', 'generic']])}>Channel</Button>}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-fg-tertiary">Quick add</span>
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant="outline" icon={LuCirclePlus} onClick={() => addChannels(p.channels)}>{p.label}</Button>
            ))}
          </div>
          {form.channels.length === 0 ? (
            <div className="rounded-lg bg-surface-0 ring-1 ring-inset ring-line">
              <EmptyState size="sm" icon={LuListPlus} title="No channels yet" description="Use a quick-add preset or add channels one by one, in DMX order." />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg bg-surface-0 ring-1 ring-inset ring-line">
              <table className="w-full min-w-[680px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
                    <th className="h-control-sm w-10 border-b border-line px-2 text-right">#</th>
                    <th className="border-b border-line px-2">Name</th>
                    <th className="w-44 border-b border-line px-2">Type</th>
                    <th className="w-28 border-b border-line px-2">Default</th>
                    <th className="w-32 border-b border-line px-2">Merge</th>
                    <th className="w-[108px] border-b border-line px-2 [[data-density=touch]_&]:w-[148px]"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {form.channels.map((c, i) => {
                    const Icon = channelTypeIcon(c.type)
                    return (
                      <tr key={c.key} className="h-row">
                        <td className="border-b border-line-subtle px-2 text-right font-mono text-xs tabular text-fg-tertiary">{i + 1}</td>
                        <td className="border-b border-line-subtle px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <TextInput
                              size="sm"
                              aria-label={`Channel ${i + 1} name`}
                              value={c.name}
                              invalid={showIssues && issues.channelNames.has(c.key)}
                              onChange={(e) => updateChannel(c.key, { name: e.target.value })}
                            />
                            {c.alias && <Badge size="xs" title="Fine channel declared as an alias of another channel">fine</Badge>}
                          </div>
                        </td>
                        <td className="border-b border-line-subtle px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <Icon size={14} aria-hidden className="shrink-0" style={{ color: getChannelTypeColor(c.type, c.name) }} />
                            <Select
                              size="sm"
                              aria-label={`Channel ${i + 1} type`}
                              value={c.type}
                              disabled={c.alias}
                              className="flex-1"
                              onChange={(type) => updateChannel(c.key, { type, precedence: autoPrecedence(type), defaultValue: autoDefault(type) })}
                              options={CHANNEL_TYPES}
                            />
                          </div>
                        </td>
                        <td className="border-b border-line-subtle px-2 py-1">
                          <NumberField size="sm" aria-label={`Channel ${i + 1} default`} value={c.defaultValue} min={0} max={255} step={1} disabled={c.alias} onChange={(v) => updateChannel(c.key, { defaultValue: v })} />
                        </td>
                        <td className="border-b border-line-subtle px-2 py-1">
                          <SegmentedControl
                            size="sm"
                            fullWidth
                            aria-label={`Channel ${i + 1} merge`}
                            value={c.precedence}
                            onChange={(precedence) => { if (!c.alias) updateChannel(c.key, { precedence }) }}
                            items={[{ value: 'HTP', label: 'HTP', disabled: c.alias }, { value: 'LTP', label: 'LTP', disabled: c.alias }]}
                          />
                        </td>
                        <td className="border-b border-line-subtle px-1 py-1">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton size="sm" icon={LuArrowUp} label="Move up" disabled={i === 0} onClick={() => moveChannel(c.key, -1)} />
                            <IconButton size="sm" icon={LuArrowDown} label="Move down" disabled={i === form.channels.length - 1} onClick={() => moveChannel(c.key, 1)} />
                            <IconButton size="sm" icon={LuTrash2} label={`Remove ${c.name || 'channel'}`} onClick={() => removeChannel(c.key)} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title={`Modes (${form.modes.length})`}
          actions={<Button size="sm" variant="ghost" icon={LuPlus} onClick={addMode}>Mode</Button>}
        >
          {form.modes.length === 0 ? (
            <div className="rounded-lg bg-surface-0 ring-1 ring-inset ring-line">
              <EmptyState size="sm" icon={LuListPlus} title="No modes" description="A mode is the list of channels the fixture uses, in DMX order." action={<Button size="sm" variant="primary" icon={LuPlus} onClick={addMode}>Add mode</Button>} />
            </div>
          ) : form.modes.map((m) => (
            <ModeCard
              key={m.key}
              mode={m}
              channels={form.channels}
              channelByKey={channelByKey}
              nameInvalid={showIssues && issues.modeNames.has(m.key)}
              empty={showIssues && issues.emptyModes.has(m.key)}
              usedBy={m.origName ? modeUsage.get(m.origName) ?? 0 : 0}
              onRename={(name) => updateMode(m.key, { name })}
              onToggle={(chKey) => toggleInMode(m.key, chKey)}
              onAll={() => updateMode(m.key, { channelKeys: form.channels.map((c) => c.key) })}
              onNone={() => updateMode(m.key, { channelKeys: [] })}
              onRemove={() => setForm((f) => ({ ...f, modes: f.modes.filter((x) => x.key !== m.key) }))}
            />
          ))}
        </Section>

        <Section title="Physical" collapsible defaultOpen={!!fixture?.physical}>
          <p className="text-xs text-fg-tertiary">Used by the 3D visualizer and position effects. Leave 0 when unknown.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field layout="stacked" label="Pan range"><NumberField aria-label="Pan range" value={form.panRange} onChange={(v) => set('panRange', v)} min={0} max={720} step={1} unit="°" /></Field>
            <Field layout="stacked" label="Tilt range"><NumberField aria-label="Tilt range" value={form.tiltRange} onChange={(v) => set('tiltRange', v)} min={0} max={360} step={1} unit="°" /></Field>
            <Field layout="stacked" label="Beam min" error={showIssues ? issues.beam : undefined}><NumberField aria-label="Beam angle min" value={form.beamMin} onChange={(v) => set('beamMin', v)} min={0} max={180} step={0.5} unit="°" /></Field>
            <Field layout="stacked" label="Beam max"><NumberField aria-label="Beam angle max" value={form.beamMax} onChange={(v) => set('beamMax', v)} min={0} max={180} step={0.5} unit="°" /></Field>
            <Field layout="stacked" label="Width"><NumberField aria-label="Width" value={form.width} onChange={(v) => set('width', v)} min={0} max={5000} step={1} unit="mm" /></Field>
            <Field layout="stacked" label="Height"><NumberField aria-label="Height" value={form.height} onChange={(v) => set('height', v)} min={0} max={5000} step={1} unit="mm" /></Field>
            <Field layout="stacked" label="Depth"><NumberField aria-label="Depth" value={form.depth} onChange={(v) => set('depth', v)} min={0} max={5000} step={1} unit="mm" /></Field>
            <Field layout="stacked" label="Weight"><NumberField aria-label="Weight" value={form.weight} onChange={(v) => set('weight', v)} min={0} max={500} step={0.1} unit="kg" /></Field>
            <Field layout="stacked" label="Power"><NumberField aria-label="Power" value={form.power} onChange={(v) => set('power', v)} min={0} max={10000} step={1} unit="W" /></Field>
          </div>
        </Section>
      </div>
    </Modal>
  )
}

function ModeCard({ mode, channels, channelByKey, nameInvalid, empty, usedBy, onRename, onToggle, onAll, onNone, onRemove }: {
  mode: ModeRow
  channels: ChannelRow[]
  channelByKey: Map<string, ChannelRow>
  nameInvalid: boolean
  empty: boolean
  usedBy: number
  onRename: (name: string) => void
  onToggle: (chKey: string) => void
  onAll: () => void
  onNone: () => void
  onRemove: () => void
}) {
  const included = new Set(mode.channelKeys)
  const excluded = channels.filter((c) => !included.has(c.key))
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg bg-surface-0 p-2.5 ring-1 ring-inset', empty ? 'ring-danger/60' : 'ring-line')}>
      <div className="flex items-center gap-2">
        <div className="w-48 [[data-density=touch]_&]:w-60">
          <TextInput size="sm" aria-label="Mode name" value={mode.name} invalid={nameInvalid} onChange={(e) => onRename(e.target.value)} />
        </div>
        <Badge mono>{mode.channelKeys.length} ch</Badge>
        {usedBy > 0 && <Badge tone="info">{usedBy} patched</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onAll}>All</Button>
        <Button size="sm" variant="ghost" onClick={onNone}>None</Button>
        <IconButton
          size="sm"
          icon={LuTrash2}
          label={usedBy > 0 ? 'Used by patched fixtures' : `Remove mode ${mode.name}`}
          disabled={usedBy > 0}
          onClick={onRemove}
        />
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Channels in this mode (tap to remove)">
        {mode.channelKeys.length === 0 && <span className="text-xs text-danger-fg">No channels — tap channels below to add them.</span>}
        {mode.channelKeys.map((k, i) => {
          const c = channelByKey.get(k)
          if (!c) return null
          return (
            <ChannelChip key={k} index={i + 1} row={c} included onClick={() => onToggle(k)} />
          )
        })}
      </div>
      {excluded.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-line-subtle pt-2">
          <span className="mr-1 text-2xs text-fg-tertiary">Not in mode</span>
          {excluded.map((c) => <ChannelChip key={c.key} row={c} onClick={() => onToggle(c.key)} />)}
        </div>
      )}
    </div>
  )
}

function ChannelChip({ row, index, included, onClick }: { row: ChannelRow; index?: number; included?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!included}
      title={included ? 'Remove from this mode' : 'Add to this mode'}
      className={cn(
        'inline-flex h-control-xs items-center gap-1.5 rounded-sm px-2 text-xs transition-colors duration-fast',
        included ? 'bg-surface-3 text-fg-primary hover:bg-surface-4' : 'border border-dashed border-line-strong text-fg-tertiary hover:text-fg-primary'
      )}
    >
      {index !== undefined && <span className="font-mono text-2xs tabular text-fg-tertiary">{index}</span>}
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getChannelTypeColor(row.type, row.name) }} />
      {row.name || 'Unnamed'}
      {!included && <LuPlus size={10} aria-hidden />}
    </button>
  )
}

/** Exported for the library view: opens the editor for a definition (copy for built-ins) */
export function editorModeFor(def: FixtureDefinition): { fixture: FixtureDefinition; asCopy: boolean } {
  return { fixture: def, asCopy: !def.source || def.source === 'builtin' }
}

