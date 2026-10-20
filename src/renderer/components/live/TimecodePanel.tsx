// Timecode source / lock status chip for the transport bar, and the
// popover that configures timecode (MTC in, frame rate, chase, dropout, offset).

import { useEffect, useState } from 'react'
import { LuAudioWaveform } from 'react-icons/lu'
import {
  Button, Field, NumberField, Popover, SegmentedControl, Select, StatusDot, Switch, cn, usePopover
} from '@renderer/components/ui'
import { formatDecimal, t as translate, useT } from '@renderer/i18n'
import {
  FRAMERATES, enableTimecode, formatTimecode, getTimecodeDropoutMs, getTimecodeFramerate, getTimecodeOffset,
  getTimecodePosition, isTimecodeChase, isTimecodeEnabled, isTimecodeReceiving, setTimecodeChase,
  setTimecodeDropoutMs, setTimecodeFramerate, setTimecodeOffset, type TimecodeFramerate
} from '@renderer/lib/timecode-engine'

interface TcStatus {
  enabled: boolean
  receiving: boolean
  chase: boolean
  fps: TimecodeFramerate
}

function readStatus(): TcStatus {
  return { enabled: isTimecodeEnabled(), receiving: isTimecodeReceiving(), chase: isTimecodeChase(), fps: getTimecodeFramerate() }
}

/** Engine status, polled at 4 Hz (state changes only) */
function useTcStatus(): [TcStatus, () => void] {
  const [status, setStatus] = useState(readStatus)
  const refresh = () => setStatus((prev) => {
    const next = readStatus()
    return prev.enabled === next.enabled && prev.receiving === next.receiving && prev.chase === next.chase && prev.fps === next.fps ? prev : next
  })
  useEffect(() => {
    const id = setInterval(refresh, 250)
    return () => clearInterval(id)
  }, [])
  return [status, refresh]
}

/** "25 fps", "29.97 df" (fr "29,97 df") */
export function fpsLabel(fps: TimecodeFramerate): string {
  return fps === 29.97 ? translate('timeline.timecode.dropFrame', { fps: formatDecimal(29.97, 2) }) : translate('units.fpsValue', { value: fps })
}

export function TimecodeButton() {
  const t = useT()
  const pop = usePopover()
  const [status, refresh] = useTcStatus()
  const tone = !status.enabled ? 'neutral' : status.receiving ? 'go' : 'warning'
  return (
    <>
      <Button
        ref={pop.anchorRef}
        {...pop.triggerProps}
        data-tc-toggle
        size="sm"
        variant="outline"
        active={pop.open}
        tone="neutral"
        onClick={pop.toggle}
        tooltip={t('timeline.timecode.buttonTooltip')}
        className="gap-2 font-mono"
      >
        <StatusDot tone={tone} pulse={status.enabled && !status.receiving} />
        <span className="text-xs">
          {!status.enabled ? t('timeline.timecode.badgeInternal') : status.receiving ? t('timeline.timecode.badgeLocked') : 'MTC'}
        </span>
        {status.enabled && <span className="text-2xs text-fg-tertiary">{status.fps === 29.97 ? formatDecimal(29.97, 2) : status.fps}</span>}
        {status.enabled && status.chase && <span className="rounded-sm bg-info/20 px-1 text-[10px] font-semibold text-info-fg">{t('timeline.timecode.badgeChase')}</span>}
      </Button>
      <Popover {...pop.props} placement="bottom-start" aria-label={t('timeline.timecode.title')} className="w-[340px] [[data-density=touch]_&]:w-[400px]">
        <TimecodeSettings status={status} onChange={refresh} />
      </Popover>
    </>
  )
}

function TimecodeSettings({ status, onChange }: { status: TcStatus; onChange: () => void }) {
  const t = useT()
  const [dropout, setDropout] = useState(getTimecodeDropoutMs)
  const [offset, setOffset] = useState(getTimecodeOffset)
  const [position, setPosition] = useState(() => formatTimecode(getTimecodePosition()))

  useEffect(() => {
    if (!status.enabled) return
    const id = setInterval(() => setPosition((p) => {
      const next = formatTimecode(getTimecodePosition())
      return p === next ? p : next
    }), 100)
    return () => clearInterval(id)
  }, [status.enabled])

  const statusText = !status.enabled
    ? t('timeline.timecode.statusInternal')
    : status.receiving ? t('timeline.timecode.statusLocked', { fps: fpsLabel(status.fps) }) : t('timeline.timecode.statusWaiting')

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <LuAudioWaveform size={16} aria-hidden className="text-fg-tertiary" />
        <h2 className="flex-1 text-sm font-semibold">{t('timeline.timecode.title')}</h2>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <SegmentedControl
          fullWidth
          size="md"
          aria-label={t('timeline.timecode.clockSource')}
          value={status.enabled ? 'mtc' : 'internal'}
          onChange={(v) => { enableTimecode(v === 'mtc'); onChange() }}
          items={[{ value: 'internal', label: t('timeline.timecode.internal') }, { value: 'mtc', label: t('timeline.timecode.mtc') }]}
        />

        <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-inset',
          !status.enabled ? 'bg-surface-2 ring-line' : status.receiving ? 'bg-go/10 ring-go/40' : 'bg-warning/10 ring-warning/40')}>
          <StatusDot size="md" tone={!status.enabled ? 'neutral' : status.receiving ? 'go' : 'warning'} pulse={status.enabled && !status.receiving} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono text-xl tabular text-fg-primary">{status.enabled ? position : '--:--:--:--'}</span>
            <span className="text-xs text-fg-secondary">{statusText}</span>
          </div>
        </div>

        <Field label={t('timeline.timecode.frameRate')} hint={status.enabled ? t('timeline.timecode.frameRateHint') : undefined}>
          {(id) => (
            <Select
              id={id}
              value={String(status.fps)}
              onChange={(v) => { setTimecodeFramerate(Number(v) as TimecodeFramerate); onChange() }}
              options={FRAMERATES.map((f) => ({ value: String(f), label: fpsLabel(f) }))}
            />
          )}
        </Field>

        <Switch
          checked={status.chase}
          disabled={!status.enabled}
          onChange={(on) => { setTimecodeChase(on); onChange() }}
          label={t('timeline.timecode.chase')}
          description={t('timeline.timecode.chaseDescription')}
        />

        <Field label={t('timeline.timecode.dropout')} hint={t('timeline.timecode.dropoutHint')}>
          <NumberField
            aria-label={t('timeline.timecode.dropoutAria')}
            value={dropout}
            min={100}
            max={10000}
            step={50}
            unit="ms"
            disabled={!status.enabled}
            onChange={(v) => { setTimecodeDropoutMs(v); setDropout(getTimecodeDropoutMs()) }}
          />
        </Field>

        <Field label={t('timeline.timecode.offset')} hint={t('timeline.timecode.offsetHint')}>
          <NumberField
            aria-label={t('timeline.timecode.offsetAria')}
            value={offset}
            min={-36000}
            max={36000}
            step={0.1}
            unit="s"
            disabled={!status.enabled}
            onChange={(v) => { setTimecodeOffset(v); setOffset(getTimecodeOffset()) }}
          />
        </Field>
      </div>
    </div>
  )
}
