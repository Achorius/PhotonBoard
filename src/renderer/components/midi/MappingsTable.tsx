// Mapping table: search + category filter, readable source / target,
// behaviour badges, a live activity dot, delete with confirmation.

import { memo, useEffect, useMemo, useState } from 'react'
import { LuPiano, LuSearch, LuSearchX, LuTrash2, LuTriangleAlert } from 'react-icons/lu'
import {
  Badge, Button, EmptyState, IconButton, SegmentedControl, TBody, THead, Table, Td, Th, TextInput, Tr, cn
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useMidiStore } from '@renderer/stores/midi-store'
import { mappingMatches } from '@renderer/lib/midi-manager'
import type { MidiMapping } from '@shared/types'
import { behaviorLabel, categoryLabel, channelShort, describeTarget, formatSourceNumber, sourceLabel, useNameIndex, type Behavior, type NameIndex, type TargetCategory } from './midi-model'
import { LearnButton } from './LearnMenu'
import { deleteMapping } from './midi-actions'

type Filter = 'all' | TargetCategory

export function MappingsTable({ selectedId, onSelect, compact }: { selectedId: string | null; onSelect: (id: string | null) => void; compact?: boolean }) {
  const t = useT()
  const mappings = useMidiStore((s) => s.mappings)
  const index = useNameIndex()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  // t: target titles are translated (re-describe on a language change)
  const rows = useMemo(() => mappings.map((m) => ({ m, target: describeTarget(m, index) })), [mappings, index, t])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, masters: 0, playback: 0, fixtures: 0, timeline: 0 }
    for (const r of rows) c[r.target.meta.category]++
    return c
  }, [rows])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(({ m, target }) => {
      if (filter !== 'all' && target.meta.category !== filter) return false
      if (!q) return true
      const hay = `${m.name} ${target.title} ${target.detail ?? ''} ${formatSourceNumber(m.source.type, m.source.number)} ${channelShort(m.source.channel)} ${m.source.deviceName ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, filter, t])

  if (mappings.length === 0) {
    return (
      <EmptyState
        icon={LuPiano}
        title={t('midi.table.emptyTitle')}
        description={t('midi.table.emptyText')}
        action={<LearnButton label={t('midi.learn.learnControl')} />}
      />
    )
  }

  const filters: Filter[] = ['all', 'playback', 'masters', 'fixtures', 'timeline']
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-2">
        <TextInput
          size="sm"
          icon={LuSearch}
          placeholder={t('midi.table.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          aria-label={t('midi.table.searchLabel')}
          className="w-[260px] max-w-full"
        />
        <SegmentedControl<Filter>
          size="sm"
          aria-label={t('midi.table.filterLabel')}
          value={filter}
          onChange={setFilter}
          items={filters.map((f) => ({ value: f, label: `${f === 'all' ? t('common.all') : categoryLabel(f)} ${counts[f]}`, disabled: f !== 'all' && counts[f] === 0 }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <EmptyState size="sm" icon={LuSearchX} title={t('midi.table.noMatch')} action={<Button size="sm" variant="ghost" onClick={() => { setQuery(''); setFilter('all') }}>{t('midi.table.clearFilters')}</Button>} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th className="w-8 px-0" aria-label={t('midi.table.activity')} />
                <Th>{t('common.name')}</Th>
                <Th>{t('midi.table.source')}</Th>
                <Th>{t('midi.table.target')}</Th>
                <Th>{t('common.mode')}</Th>
                {!compact && <Th align="right">{t('midi.table.range')}</Th>}
                <Th className="w-12" aria-label={t('midi.table.actions')} />
              </Tr>
            </THead>
            <TBody>
              {shown.map(({ m }) => (
                <MappingRow key={m.id} mapping={m} index={index} selected={m.id === selectedId} onSelect={onSelect} compact={compact} />
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}

const MappingRow = memo(function MappingRow({ mapping: m, index, selected, onSelect, compact }: {
  compact?: boolean
  mapping: MidiMapping
  index: NameIndex
  selected: boolean
  onSelect: (id: string | null) => void
}) {
  const t = useT()
  const target = describeTarget(m, index)
  const Icon = target.meta.icon
  const behavior = (m.options.behavior || 'direct') as Behavior
  return (
    <Tr data-mapping-row={m.id} interactive selected={selected} onClick={() => onSelect(selected ? null : m.id)}>
      <Td className="w-8 px-0 text-center"><MappingActivity mapping={m} /></Td>
      <Td className="max-w-[200px]">
        <span className="block truncate font-medium text-fg-primary">{m.name}</span>
      </Td>
      <Td>
        <div className="flex flex-col">
          <span className="whitespace-nowrap font-mono text-xs tabular text-fg-primary">
            {formatSourceNumber(m.source.type, m.source.number)} <span className="text-fg-tertiary">· {channelShort(m.source.channel)}</span>
          </span>
          <span className="truncate text-2xs text-fg-tertiary">{m.source.deviceName || t('midi.table.anyDevice', { type: sourceLabel(m.source.type) })}</span>
        </div>
      </Td>
      <Td className="max-w-[240px]">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={14} aria-hidden className="shrink-0 text-fg-tertiary" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-fg-primary">{target.title}</span>
            {target.detail && (
              <span className={cn('flex items-center gap-1 truncate text-xs', target.missing ? 'text-warning-fg' : 'text-fg-secondary')}>
                {target.missing && <LuTriangleAlert size={12} aria-hidden />}
                {target.detail}
              </span>
            )}
          </div>
        </div>
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <Badge size="xs" tone={m.options.behavior === 'flash' ? 'warning' : m.options.behavior === 'trigger' ? 'info' : 'neutral'}>{behaviorLabel(behavior).toLocaleUpperCase()}</Badge>
          {m.source.type === 'cc' && <Badge size="xs" variant="outline" tone={m.options.encoding === 'relative' ? 'midi' : 'neutral'}>{m.options.encoding === 'relative' ? t('midi.table.relative') : t('midi.table.absolute')}</Badge>}
          {m.options.inverted && <Badge size="xs" variant="outline">{t('midi.table.inverted')}</Badge>}
        </div>
      </Td>
      {!compact && (
        <Td mono muted align="right" className="whitespace-nowrap">
          {target.meta.continuous ? `${m.options.min}–${m.options.max}` : '—'}
        </Td>
      )}
      <Td className="w-12 pr-1.5" onClick={(e) => e.stopPropagation()}>
        <IconButton icon={LuTrash2} label={t('midi.table.deleteMapping', { name: m.name })} size="sm" className="text-fg-tertiary hover:text-danger-fg"
          onClick={() => { void deleteMapping(m.id).then((ok) => { if (ok && selected) onSelect(null) }) }} />
      </Td>
    </Tr>
  )
})

/** Flashes when an incoming message drives this mapping */
function MappingActivity({ mapping }: { mapping: MidiMapping }) {
  const ts = useMidiStore((s) => {
    const msg = s.lastMessage
    if (!msg) return 0
    return mappingMatches(mapping, msg.type as MidiMapping['source']['type'], msg.channel, msg.number, msg.deviceName) ? msg.ts ?? 0 : 0
  })
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!ts) return
    setLit(true)
    const id = setTimeout(() => setLit(false), 160)
    return () => clearTimeout(id)
  }, [ts])
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2 w-2 rounded-full transition-colors duration-fast', lit ? 'bg-midi-fg shadow-[0_0_6px_rgb(var(--pb-midi-fg))]' : 'bg-surface-4')}
    />
  )
}
