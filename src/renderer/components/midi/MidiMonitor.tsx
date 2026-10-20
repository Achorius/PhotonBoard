// Incoming MIDI messages (newest first) with the mapping each one drives.
// Re-renders at most 10×/s whatever the message rate; can be paused.

import { memo, useEffect, useMemo, useState } from 'react'
import { LuActivity, LuArrowRight, LuEraser, LuPause, LuPlay } from 'react-icons/lu'
import { Badge, EmptyState, IconButton, PanelHeader, cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useMidiStore, type MidiMessageInfo } from '@renderer/stores/midi-store'
import { mappingMatches } from '@renderer/lib/midi-manager'
import type { MidiMapping, MidiSourceType } from '@shared/types'
import { channelShort, formatSourceNumber } from './midi-model'

function useThrottledLog(paused: boolean): MidiMessageInfo[] {
  const [log, setLog] = useState(() => useMidiStore.getState().messageLog)
  useEffect(() => {
    if (paused) return
    setLog(useMidiStore.getState().messageLog)
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useMidiStore.subscribe((s, prev) => {
      if (s.messageLog === prev.messageLog || timer) return
      timer = setTimeout(() => { timer = null; setLog(useMidiStore.getState().messageLog) }, 100)
    })
    return () => { unsub(); if (timer) clearTimeout(timer) }
  }, [paused])
  return log
}

export function MidiMonitor({ onSelectMapping }: { onSelectMapping: (id: string) => void }) {
  const t = useT()
  const [paused, setPaused] = useState(false)
  const log = useThrottledLog(paused)
  const mappings = useMidiStore((s) => s.mappings)

  return (
    <section aria-label={t('midi.monitor.region')} className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={LuActivity}
        title={t('midi.monitor.title')}
        count={paused ? t('midi.monitor.paused') : log.length > 0 ? t('midi.monitor.last', { count: log.length }) : undefined}
        actions={
          <>
            <IconButton icon={paused ? LuPlay : LuPause} label={paused ? t('midi.monitor.resume') : t('midi.monitor.pause')} size="sm" active={paused} tone="warning" onClick={() => setPaused(!paused)} />
            <IconButton icon={LuEraser} label={t('midi.monitor.clear')} size="sm" disabled={log.length === 0} onClick={() => useMidiStore.getState().clearMessageLog()} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {log.length === 0 ? (
          <EmptyState size="sm" icon={LuActivity} title={t('midi.monitor.emptyTitle')} description={t('midi.monitor.emptyText')} />
        ) : (
          <ul className="py-1">
            {log.map((m, i) => <MonitorRow key={`${m.ts}-${i}`} msg={m} mappings={mappings} newest={i === 0} onSelectMapping={onSelectMapping} />)}
          </ul>
        )}
      </div>
    </section>
  )
}

const MonitorRow = memo(function MonitorRow({ msg, mappings, newest, onSelectMapping }: {
  msg: MidiMessageInfo
  mappings: MidiMapping[]
  newest: boolean
  onSelectMapping: (id: string) => void
}) {
  const type = (msg.type === 'noteoff' ? 'note' : msg.type) as MidiSourceType
  const matched = useMemo(() => mappings.filter((m) => mappingMatches(m, type, msg.channel, msg.number, msg.deviceName)), [mappings, type, msg])
  useT() // re-render on a language change (channelShort)
  const typeTone = msg.type === 'cc' ? 'info' : msg.type === 'program' ? 'warning' : 'midi'
  return (
    <li className={cn('flex min-h-row items-center gap-2 px-3 py-0.5 text-xs', newest && 'bg-midi/10')}>
      <Badge size="xs" mono tone={typeTone} variant={msg.type === 'noteoff' ? 'outline' : 'subtle'} className="w-11 justify-center">
        {msg.type === 'noteoff' ? 'OFF' : msg.type === 'program' ? 'PC' : msg.type === 'note' ? 'NOTE' : 'CC'}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono tabular text-fg-primary">
          {formatSourceNumber(msg.type, msg.number)} <span className="text-fg-tertiary">· {channelShort(msg.channel)}</span>
        </span>
        {matched.length > 0 ? (
          <button type="button" onClick={() => onSelectMapping(matched[0].id)} className="flex min-w-0 items-center gap-1 text-left text-midi-fg hover:underline">
            <LuArrowRight size={12} aria-hidden className="shrink-0" />
            <span className="truncate">{matched.map((m) => m.name).join(', ')}</span>
          </button>
        ) : msg.deviceName ? (
          <span className="truncate text-fg-tertiary">{msg.deviceName}</span>
        ) : null}
      </div>
      <span className="flex w-14 shrink-0 items-center gap-1.5">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full bg-midi-fg" style={{ width: `${(msg.value / 127) * 100}%` }} />
        </span>
        <span className="w-6 text-right font-mono tabular text-fg-secondary">{msg.value}</span>
      </span>
    </li>
  )
})
