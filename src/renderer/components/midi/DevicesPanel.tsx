// MIDI ports with connection state and an activity LED per input.

import { memo, useEffect, useState } from 'react'
import { LuArrowDownToLine, LuArrowUpFromLine, LuPiano, LuRefreshCw } from 'react-icons/lu'
import { EmptyState, IconButton, PanelHeader, StatusDot, cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useMidiStore } from '@renderer/stores/midi-store'
import type { MidiDevice } from '@shared/types'

export function DevicesPanel() {
  const t = useT()
  const devices = useMidiStore((s) => s.devices)
  const apiStatus = useMidiStore((s) => s.apiStatus)
  const inputs = devices.filter((d) => d.type === 'input')
  const outputs = devices.filter((d) => d.type === 'output')
  const connected = inputs.filter((d) => d.connected).length

  return (
    <section aria-label={t('midi.devices.region')} className="flex min-h-0 shrink-0 flex-col border-b border-line">
      <PanelHeader
        icon={LuPiano}
        title={t('midi.devices.title')}
        count={devices.length > 0 ? t('midi.devices.count', { inputs: connected, outputs: outputs.filter((d) => d.connected).length }) : undefined}
        actions={<IconButton icon={LuRefreshCw} label={t('midi.devices.rescan')} size="sm" onClick={() => { void useMidiStore.getState().initMidi() }} />}
      />
      <div className="max-h-[280px] overflow-y-auto py-1 [[data-density=touch]_&]:max-h-[340px]">
        {devices.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuPiano}
            title={apiStatus === 'available' ? t('midi.devices.emptyTitle') : t('midi.devices.unavailableTitle')}
            description={apiStatus === 'available' ? t('midi.devices.emptyText') : t('midi.devices.unavailableText')}
          />
        ) : (
          <>
            <GroupLabel icon={LuArrowDownToLine} label={t('midi.devices.inputs')} />
            {inputs.length === 0 ? <p className="px-3 pb-2 text-xs text-fg-tertiary">{t('midi.devices.noInputs')}</p> : inputs.map((d) => <DeviceRow key={d.id} device={d} />)}
            <GroupLabel icon={LuArrowUpFromLine} label={t('midi.devices.outputs')} />
            {outputs.length === 0 ? <p className="px-3 pb-2 text-xs text-fg-tertiary">{t('midi.devices.noOutputs')}</p> : outputs.map((d) => <DeviceRow key={d.id} device={d} />)}
          </>
        )}
      </div>
    </section>
  )
}

function GroupLabel({ icon: Icon, label }: { icon: typeof LuPiano; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
      <Icon size={12} aria-hidden />
      {label}
    </div>
  )
}

const DeviceRow = memo(function DeviceRow({ device }: { device: MidiDevice }) {
  const t = useT()
  const state = device.connected ? t('midi.devices.connected') : t('midi.devices.disconnected')
  return (
    <div className="flex min-h-row items-center gap-2.5 px-3 py-1">
      <StatusDot tone={device.connected ? 'go' : 'neutral'} label={state} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-sm', device.connected ? 'text-fg-primary' : 'text-fg-tertiary')}>{device.name}</span>
        <span className="truncate text-xs text-fg-tertiary">
          {device.connected && device.manufacturer ? device.manufacturer : state}
        </span>
      </div>
      {device.type === 'input' && <ActivityLed name={device.name} />}
    </div>
  )
})

/** Lights for a moment on every message from this input */
function ActivityLed({ name }: { name: string }) {
  const t = useT()
  const ts = useMidiStore((s) => (s.lastMessage?.deviceName === name ? s.lastMessage.ts ?? 0 : 0))
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!ts) return
    setLit(true)
    const id = setTimeout(() => setLit(false), 140)
    return () => clearTimeout(id)
  }, [ts])
  return (
    <span
      role="img"
      aria-label={lit ? t('midi.devices.receiving') : t('midi.devices.idle')}
      title={t('midi.devices.activity')}
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset transition-colors duration-fast', lit ? 'bg-midi-fg ring-midi-fg shadow-[0_0_8px_rgb(var(--pb-midi-fg))]' : 'bg-surface-3 ring-line-strong')}
    />
  )
}
