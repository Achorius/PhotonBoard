// Edit one mapping: name, source (device / type / channel / number, or
// re-learn from the device), target, behaviour, encoding and range.

import { useEffect, useMemo, useState } from 'react'
import { LuPiano, LuTrash2, LuX } from 'react-icons/lu'
import {
  Button, Field, IconButton, NumberField, Section, SegmentedControl, Select, Switch, TextInput, cn
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useMidiStore } from '@renderer/stores/midi-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import type { MidiMapping, MidiSourceType, MidiTargetType } from '@shared/types'
import {
  BEHAVIORS, TARGETS, behaviorDescription, behaviorLabel, categoryLabel, channelShort, describeTarget, formatSourceNumber, refItems,
  targetDescription, targetLabel, useNameIndex, type Behavior
} from './midi-model'
import { deleteMapping } from './midi-actions'
import { useControllerStore } from '@renderer/stores/controller-store'
import { mappingFeedbackMode } from '@renderer/lib/midi/mapping-feedback'
import { overriddenProfileName } from './controller-model'

type FeedbackChoice = 'off' | 'note' | 'cc'

export function MappingEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT()
  const mapping = useMidiStore((s) => s.mappings.find((m) => m.id === id))
  const devices = useMidiStore((s) => s.devices)
  const index = useNameIndex()
  const [relearn, setRelearn] = useState(false)
  // Re-render when controllers come and go (profile override hint)
  useControllerStore((s) => s.detected)

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
  const behavior = (mapping.options.behavior || 'direct') as Behavior
  const remove = () => { void deleteMapping(id).then((ok) => { if (ok) onClose() }) }
  const feedback: FeedbackChoice = mappingFeedbackMode(mapping) ?? 'off'
  const overridden = overriddenProfileName(mapping)

  return (
    <aside aria-label={t('midi.editor.region')} className="flex h-full min-h-0 flex-col bg-surface-1">
      <header className="flex min-h-control-lg shrink-0 items-center gap-2.5 border-b border-line-subtle py-1.5 pl-3 pr-1.5">
        <meta.icon size={16} aria-hidden className="shrink-0 text-midi-fg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{mapping.name}</h2>
          <p className="truncate font-mono text-xs text-fg-tertiary">{formatSourceNumber(mapping.source.type, mapping.source.number)} · {channelShort(mapping.source.channel)}</p>
        </div>
        <IconButton icon={LuTrash2} label={t('midi.editor.deleteMapping')} size="sm" className="text-fg-tertiary hover:text-danger-fg" onClick={remove} />
        <IconButton icon={LuX} label={t('common.close')} size="sm" onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t('midi.editor.mapping')}>
          <Field label={t('common.name')}><NameInput value={mapping.name} onCommit={(name) => update({ name })} /></Field>
        </Section>

        <Section
          title={t('midi.editor.source')}
          actions={
            <Button size="xs" variant="secondary" tone="midi" active={relearn} icon={LuPiano} onClick={() => setRelearn(!relearn)} className={cn(relearn && 'animate-pulse')}>
              {relearn ? t('midi.editor.moveControl') : t('midi.editor.relearn')}
            </Button>
          }
        >
          <Field label={t('midi.editor.device')}>
            {(fid) => (
              <Select
                id={fid}
                value={mapping.source.deviceName ?? ''}
                onChange={(v) => setSource({ deviceName: v || undefined })}
                options={[{ value: '', label: t('midi.editor.anyDevice') }, ...inputNames.map((n) => ({ value: n, label: n }))]}
              />
            )}
          </Field>
          <Field label={t('midi.editor.message')}>
            <SegmentedControl<MidiSourceType>
              fullWidth
              aria-label={t('midi.editor.messageType')}
              value={mapping.source.type}
              onChange={(type) => setSource({ type })}
              items={[{ value: 'cc', label: 'CC' }, { value: 'note', label: t('midi.source.note') }, { value: 'program', label: 'PC', title: t('midi.editor.programChange') }]}
            />
          </Field>
          <Field label={t('common.channel')}><NumberField aria-label={t('midi.editor.midiChannel')} value={mapping.source.channel} min={1} max={16} step={1} onChange={(channel) => setSource({ channel })} /></Field>
          <Field label={mapping.source.type === 'note' ? t('midi.editor.note') : mapping.source.type === 'program' ? t('midi.editor.program') : t('midi.editor.controller')}>
            <NumberField aria-label={t('midi.editor.number')} value={mapping.source.number} min={0} max={127} step={1} onChange={(number) => setSource({ number })} />
          </Field>
          {overridden && <p className="text-xs text-midi-fg">{t('pro.midi.feedback.overridesProfile', { name: overridden })}</p>}
        </Section>

        <Section title={t('midi.editor.target')}>
          <Field label={t('midi.editor.control')}>
            {(fid) => (
              <Select<MidiTargetType>
                id={fid}
                value={mapping.target.type}
                onChange={(type) => update({ target: { type, id: TARGETS[type].ref === TARGETS[mapping.target.type].ref ? mapping.target.id : undefined } })}
                options={(Object.keys(TARGETS) as MidiTargetType[]).map((type) => ({ value: type, label: `${categoryLabel(TARGETS[type].category)} · ${targetLabel(type)}` }))}
              />
            )}
          </Field>
          {ref && (
            <Field label={t(`midi.editor.ref.${ref}`)} error={target.missing ? t('midi.editor.pickTarget') : undefined}>
              {(fid) => (
                <Select
                  id={fid}
                  value={mapping.target.id ?? ''}
                  onChange={(v) => update({ target: { type: mapping.target.type, id: v || undefined } })}
                  options={[
                    { value: '', label: mapping.target.type === 'tap_tempo' ? t('midi.target.playingChases') : t('midi.editor.choose') },
                    ...(mapping.target.id && !index.byRef[ref].has(mapping.target.id) ? [{ value: mapping.target.id, label: t('midi.target.missing') }] : []),
                    ...refItems(index, ref).map((it) => ({ value: it.id, label: it.name }))
                  ]}
                />
              )}
            </Field>
          )}
          {mapping.target.type === 'channel' && mapping.target.id && (
            <ChannelField fixtureId={mapping.target.id} value={mapping.target.parameter ?? ''} onChange={(parameter) => update({ target: { ...mapping.target, parameter } })} />
          )}
          <p className="text-xs text-fg-tertiary">{targetDescription(mapping.target.type)}</p>
        </Section>

        <Section title={t('midi.editor.behaviour')}>
          <SegmentedControl<Behavior>
            fullWidth
            aria-label={t('midi.editor.behaviour')}
            value={behavior}
            onChange={(b) => setOptions({ behavior: b })}
            items={BEHAVIORS.map((b) => ({ value: b, label: behaviorLabel(b) }))}
          />
          <p className="text-xs text-fg-tertiary">{behaviorDescription(behavior)}</p>
          {mapping.source.type === 'cc' && (
            <Field label={t('midi.editor.encoding')} hint={mapping.options.encoding === 'relative' ? t('midi.editor.encodingRelative') : t('midi.editor.encodingAbsolute')}>
              <SegmentedControl<'absolute' | 'relative'>
                fullWidth
                aria-label={t('midi.editor.encoding')}
                value={mapping.options.encoding}
                onChange={(encoding) => setOptions({ encoding })}
                items={[{ value: 'absolute', label: t('midi.editor.absolute') }, { value: 'relative', label: t('midi.editor.relative') }]}
              />
            </Field>
          )}
          {meta.continuous && (
            <>
              <Field label={t('midi.editor.range')}>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField aria-label={t('midi.editor.minimum')} label={t('midi.editor.min')} value={mapping.options.min} min={0} max={255} step={1} onChange={(min) => setOptions({ min })} />
                  <NumberField aria-label={t('midi.editor.maximum')} label={t('midi.editor.max')} value={mapping.options.max} min={0} max={255} step={1} onChange={(max) => setOptions({ max })} />
                </div>
              </Field>
              <Switch checked={mapping.options.inverted} onChange={(inverted) => setOptions({ inverted })} label={t('midi.editor.inverted')} description={t('midi.editor.invertedHint')} />
            </>
          )}
          <Field label={t('pro.midi.feedback.label')} hint={t('pro.midi.feedback.hint')}>
            <SegmentedControl<FeedbackChoice>
              fullWidth
              aria-label={t('pro.midi.feedback.label')}
              value={feedback}
              onChange={(v) => setOptions({ feedback: v === 'off' ? undefined : v } as Partial<MidiMapping['options']>)}
              items={[{ value: 'off', label: t('pro.midi.feedback.off') }, { value: 'note', label: t('pro.midi.feedback.note') }, { value: 'cc', label: t('pro.midi.feedback.cc') }]}
            />
          </Field>
        </Section>

        <Section title={t('midi.editor.dangerZone')}>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} className="self-start" onClick={remove}>
            {t('midi.editor.deleteMapping')}
          </Button>
        </Section>
      </div>
    </aside>
  )
}

function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const t = useT()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <TextInput
      data-midi-mapping-name
      aria-label={t('midi.editor.nameLabel')}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = draft.trim(); if (v && v !== value) onCommit(v); else setDraft(value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() } }}
    />
  )
}

function ChannelField({ fixtureId, value, onChange }: { fixtureId: string; value: string; onChange: (v: string) => void }) {
  const t = useT()
  const entry = usePatchStore((s) => s.patch.find((p) => p.id === fixtureId))
  const fixtures = usePatchStore((s) => s.fixtures)
  const channels = useMemo(() => (entry ? usePatchStore.getState().getFixtureChannels(entry).map((c) => c.name) : []), [entry, fixtures])
  return (
    <Field label={t('common.channel')} error={value && !channels.includes(value) ? t('midi.editor.channelGone') : undefined}>
      {(fid) => (
        <Select
          id={fid}
          value={value}
          onChange={onChange}
          options={[{ value: '', label: t('midi.editor.choose') }, ...(value && !channels.includes(value) ? [{ value, label: value }] : []), ...channels.map((c) => ({ value: c, label: c }))]}
        />
      )}
    </Field>
  )
}
