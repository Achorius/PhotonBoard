// Edit one mapping: name, source (device / type / channel / number, or
// re-learn from the device), target, behaviour, encoding and range.

import { useEffect, useMemo, useState } from 'react'
import { LuPiano, LuTrash2, LuX } from 'react-icons/lu'
import {
  Button, Field, IconButton, NumberField, Section, SegmentedControl, Select, Switch, TextInput, cn
} from '@renderer/components/ui'
import { useMidiStore } from '@renderer/stores/midi-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import type { MidiMapping, MidiSourceType, MidiTargetType } from '@shared/types'
import { BEHAVIORS, CATEGORY_LABEL, TARGETS, describeTarget, formatSourceNumber, refItems, useNameIndex, type Behavior, type TargetCategory } from './midi-model'
import { deleteMapping } from './midi-actions'

export function MappingEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const mapping = useMidiStore((s) => s.mappings.find((m) => m.id === id))
  const devices = useMidiStore((s) => s.devices)
  const index = useNameIndex()
  const [relearn, setRelearn] = useState(false)

  // Re-learn the source from the next incoming message
  useEffect(() => {
    if (!relearn) return
    const start = useMidiStore.getState().lastMessage?.ts ?? 0
    const unsub = useMidiStore.subscribe((s) => {
      const msg = s.lastMessage
      if (!msg || (msg.ts ?? 0) <= start) return
      const type = msg.type as MidiSourceType
      if (type !== 'cc' && type !== 'note' && type !== 'program') return
      const cur = useMidiStore.getState().mappings.find((m) => m.id === id)
      if (cur) useMidiStore.getState().updateMapping(id, { source: { ...cur.source, type, channel: msg.channel, number: msg.number, deviceName: msg.deviceName } })
      setRelearn(false)
    })
    return unsub
  }, [relearn, id])

  useEffect(() => { if (!mapping) onClose() }, [mapping, onClose])
  if (!mapping) return null

  const update = (u: Partial<MidiMapping>) => useMidiStore.getState().updateMapping(id, u)
  const setSource = (u: Partial<MidiMapping['source']>) => update({ source: { ...mapping.source, ...u } })
  const setOptions = (u: Partial<MidiMapping['options']>) => update({ options: { ...mapping.options, ...u } })
  const target = describeTarget(mapping, index)
  const meta = target.meta
  const ref = meta.ref
  const inputNames = [...new Set(devices.filter((d) => d.type === 'input').map((d) => d.name))]
  if (mapping.source.deviceName && !inputNames.includes(mapping.source.deviceName)) inputNames.push(mapping.source.deviceName)

  return (
    <aside aria-label="Edit mapping" className="flex h-full min-h-0 flex-col bg-surface-1">
      <header className="flex min-h-control-lg shrink-0 items-center gap-2.5 border-b border-line-subtle py-1.5 pl-3 pr-1.5">
        <meta.icon size={16} aria-hidden className="shrink-0 text-midi-fg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{mapping.name}</h2>
          <p className="truncate font-mono text-xs text-fg-tertiary">{formatSourceNumber(mapping.source.type, mapping.source.number)} · ch {mapping.source.channel}</p>
        </div>
        <IconButton icon={LuX} label="Close" size="sm" onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Mapping">
          <Field label="Name"><NameInput value={mapping.name} onCommit={(name) => update({ name })} /></Field>
        </Section>

        <Section
          title="Source"
          actions={
            <Button size="xs" variant="secondary" tone="midi" active={relearn} icon={LuPiano} onClick={() => setRelearn(!relearn)} className={cn(relearn && 'animate-pulse')}>
              {relearn ? 'Move a control…' : 'Re-learn'}
            </Button>
          }
        >
          <Field label="Device">
            {(fid) => (
              <Select
                id={fid}
                value={mapping.source.deviceName ?? ''}
                onChange={(v) => setSource({ deviceName: v || undefined })}
                options={[{ value: '', label: 'Any device' }, ...inputNames.map((n) => ({ value: n, label: n }))]}
              />
            )}
          </Field>
          <Field label="Message">
            <SegmentedControl<MidiSourceType>
              fullWidth
              aria-label="Message type"
              value={mapping.source.type}
              onChange={(type) => setSource({ type })}
              items={[{ value: 'cc', label: 'CC' }, { value: 'note', label: 'Note' }, { value: 'program', label: 'PC', title: 'Program change' }]}
            />
          </Field>
          <Field label="Channel"><NumberField aria-label="MIDI channel" value={mapping.source.channel} min={1} max={16} step={1} onChange={(channel) => setSource({ channel })} /></Field>
          <Field label={mapping.source.type === 'note' ? 'Note' : mapping.source.type === 'program' ? 'Program' : 'Controller'}>
            <NumberField aria-label="Number" value={mapping.source.number} min={0} max={127} step={1} onChange={(number) => setSource({ number })} />
          </Field>
        </Section>

        <Section title="Target">
          <Field label="Control">
            {(fid) => (
              <Select<MidiTargetType>
                id={fid}
                value={mapping.target.type}
                onChange={(type) => update({ target: { type, id: TARGETS[type].ref === TARGETS[mapping.target.type].ref ? mapping.target.id : undefined } })}
                options={(Object.keys(TARGETS) as MidiTargetType[]).map((t) => ({ value: t, label: `${CATEGORY_LABEL[TARGETS[t].category as TargetCategory]} · ${TARGETS[t].label}` }))}
              />
            )}
          </Field>
          {ref && (
            <Field label={ref === 'cuelist' ? 'Scene' : ref === 'zone' ? 'Section' : ref[0].toUpperCase() + ref.slice(1)} error={target.missing ? 'Pick what this control drives' : undefined}>
              {(fid) => (
                <Select
                  id={fid}
                  value={mapping.target.id ?? ''}
                  onChange={(v) => update({ target: { type: mapping.target.type, id: v || undefined } })}
                  options={[
                    { value: '', label: mapping.target.type === 'tap_tempo' ? 'Playing chases' : 'Choose…' },
                    ...(mapping.target.id && !index.byRef[ref].has(mapping.target.id) ? [{ value: mapping.target.id, label: 'Missing' }] : []),
                    ...refItems(index, ref).map((it) => ({ value: it.id, label: it.name }))
                  ]}
                />
              )}
            </Field>
          )}
          {mapping.target.type === 'channel' && mapping.target.id && (
            <ChannelField fixtureId={mapping.target.id} value={mapping.target.parameter ?? ''} onChange={(parameter) => update({ target: { ...mapping.target, parameter } })} />
          )}
          <p className="text-xs text-fg-tertiary">{meta.description}</p>
        </Section>

        <Section title="Behaviour">
          <SegmentedControl<Behavior>
            fullWidth
            aria-label="Behaviour"
            value={(mapping.options.behavior || 'direct') as Behavior}
            onChange={(behavior) => setOptions({ behavior })}
            items={BEHAVIORS.map((b) => ({ value: b.value, label: b.label }))}
          />
          <p className="text-xs text-fg-tertiary">{BEHAVIORS.find((b) => b.value === (mapping.options.behavior || 'direct'))?.description}</p>
          {mapping.source.type === 'cc' && (
            <Field label="Encoding" hint={mapping.options.encoding === 'relative' ? 'Endless encoder: each step nudges the value' : 'Fader / knob: position = value'}>
              <SegmentedControl<'absolute' | 'relative'>
                fullWidth
                aria-label="Encoding"
                value={mapping.options.encoding}
                onChange={(encoding) => setOptions({ encoding })}
                items={[{ value: 'absolute', label: 'Absolute' }, { value: 'relative', label: 'Relative' }]}
              />
            </Field>
          )}
          {meta.continuous && (
            <>
              <Field label="Range">
                <div className="grid grid-cols-2 gap-2">
                  <NumberField aria-label="Minimum" label="Min" value={mapping.options.min} min={0} max={255} step={1} onChange={(min) => setOptions({ min })} />
                  <NumberField aria-label="Maximum" label="Max" value={mapping.options.max} min={0} max={255} step={1} onChange={(max) => setOptions({ max })} />
                </div>
              </Field>
              <Switch checked={mapping.options.inverted} onChange={(inverted) => setOptions({ inverted })} label="Inverted" description="Control up = value down" />
            </>
          )}
        </Section>

        <Section title="Danger zone">
          <Button size="sm" variant="danger-outline" icon={LuTrash2} className="self-start" onClick={() => { void deleteMapping(id).then((ok) => { if (ok) onClose() }) }}>
            Delete mapping
          </Button>
        </Section>
      </div>
    </aside>
  )
}

function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <TextInput
      aria-label="Mapping name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = draft.trim(); if (v && v !== value) onCommit(v); else setDraft(value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() } }}
    />
  )
}

function ChannelField({ fixtureId, value, onChange }: { fixtureId: string; value: string; onChange: (v: string) => void }) {
  const entry = usePatchStore((s) => s.patch.find((p) => p.id === fixtureId))
  const fixtures = usePatchStore((s) => s.fixtures)
  const channels = useMemo(() => (entry ? usePatchStore.getState().getFixtureChannels(entry).map((c) => c.name) : []), [entry, fixtures])
  return (
    <Field label="Channel" error={value && !channels.includes(value) ? 'This channel no longer exists' : undefined}>
      {(fid) => (
        <Select
          id={fid}
          value={value}
          onChange={onChange}
          options={[{ value: '', label: 'Choose…' }, ...(value && !channels.includes(value) ? [{ value, label: value }] : []), ...channels.map((c) => ({ value: c, label: c }))]}
        />
      )}
    </Field>
  )
}
