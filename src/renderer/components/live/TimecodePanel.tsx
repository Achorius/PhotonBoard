// Timecode source / lock status chip for the transport bar, and the
// popover that configures timecode (MTC in, frame rate, chase, dropout, offset).

import { useEffect, useState } from 'react'
import { LuAudioWaveform } from 'react-icons/lu'
import {
  Button, Field, NumberField, Popover, SegmentedControl, Select, StatusDot, Switch, cn, usePopover
} from '@renderer/components/ui'
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

export function fpsLabel(fps: TimecodeFramerate): string {
  return fps === 29.97 ? '29.97 df' : `${fps} fps`
}

export function TimecodeButton() {
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
        tooltip="Timecode source & chase"
        className="gap-2 font-mono"
      >
        <StatusDot tone={tone} pulse={status.enabled && !status.receiving} />
        <span className="text-xs">
          {!status.enabled ? 'INT' : status.receiving ? 'MTC LOCK' : 'MTC'}
        </span>
        {status.enabled && <span className="text-2xs text-fg-tertiary">{status.fps === 29.97 ? '29.97' : status.fps}</span>}
        {status.enabled && status.chase && <span className="rounded-sm bg-info/20 px-1 text-[10px] font-semibold text-info-fg">CHASE</span>}
      </Button>
      <Popover {...pop.props} placement="bottom-start" aria-label="Timecode" className="w-[340px] [[data-density=touch]_&]:w-[400px]">
        <TimecodeSettings status={status} onChange={refresh} />
      </Popover>
    </>
  )
}

function TimecodeSettings({ status, onChange }: { status: TcStatus; onChange: () => void }) {
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
    ? 'Internal clock — the timeline runs on its own'
    : status.receiving ? `Locked to incoming MTC · ${fpsLabel(status.fps)}` : 'Waiting for MIDI timecode…'

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <LuAudioWaveform size={16} aria-hidden className="text-fg-tertiary" />
        <h2 className="flex-1 text-sm font-semibold">Timecode</h2>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <SegmentedControl
          fullWidth
          size="md"
          aria-label="Clock source"
          value={status.enabled ? 'mtc' : 'internal'}
          onChange={(v) => { enableTimecode(v === 'mtc'); onChange() }}
          items={[{ value: 'internal', label: 'Internal' }, { value: 'mtc', label: 'MIDI timecode' }]}
        />

        <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-inset',
          !status.enabled ? 'bg-surface-2 ring-line' : status.receiving ? 'bg-go/10 ring-go/40' : 'bg-warning/10 ring-warning/40')}>
          <StatusDot size="md" tone={!status.enabled ? 'neutral' : status.receiving ? 'go' : 'warning'} pulse={status.enabled && !status.receiving} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono text-xl tabular text-fg-primary">{status.enabled ? position : '--:--:--:--'}</span>
            <span className="text-xs text-fg-secondary">{statusText}</span>
          </div>
        </div>

        <Field label="Frame rate" hint={status.enabled ? 'Follows the incoming timecode once locked' : undefined}>
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
          label="Chase timecode"
          description="Start, follow and stop the timeline with the incoming timecode"
        />

        <Field label="Dropout" hint="Stop the chased timeline after this much silence">
          <NumberField
            aria-label="Dropout time"
            value={dropout}
            min={100}
            max={10000}
            step={50}
            unit="ms"
            disabled={!status.enabled}
            onChange={(v) => { setTimecodeDropoutMs(v); setDropout(getTimecodeDropoutMs()) }}
          />
        </Field>

        <Field label="Offset" hint="Added to incoming timecode (negative = earlier)">
          <NumberField
            aria-label="Timecode offset"
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
