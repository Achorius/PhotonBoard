// DMX output health: indicator button (top bar / status bar) + popover
// listing every output with its state, rate and last error.

import { LuCable, LuSettings2, LuUsb, LuNetwork } from 'react-icons/lu'
import type { DmxOutputStatus } from '@shared/types'
import { Badge, Button, Popover, StatusDot, usePopover, cn, type Tone } from '@renderer/components/ui'
import { outputHealth, useOutputStatus, type OutputHealth } from '@renderer/hooks/useOutputStatus'
import { useUiStore } from '@renderer/stores/ui-store'

const HEALTH_TONE: Record<OutputHealth, Tone> = { ok: 'go', degraded: 'warning', error: 'danger', none: 'neutral', unknown: 'neutral' }

const STATE_TONE: Record<DmxOutputStatus['state'], Tone> = { ok: 'go', connecting: 'warning', error: 'danger', invalid: 'danger', disabled: 'neutral' }
const STATE_LABEL: Record<DmxOutputStatus['state'], string> = { ok: 'Sending', connecting: 'Connecting', error: 'Error', invalid: 'Invalid config', disabled: 'Disabled' }

export function healthSummary(health: OutputHealth, count: number): string {
  switch (health) {
    case 'ok': return count === 1 ? '1 output OK' : `${count} outputs OK`
    case 'degraded': return 'Output connecting'
    case 'error': return 'Output error'
    case 'none': return 'No DMX output'
    default: return 'Output status…'
  }
}

/**
 * Output health indicator. `variant="statusbar"` renders the compact text form.
 */
export function OutputHealthIndicator({ variant = 'toolbar' }: { variant?: 'toolbar' | 'statusbar' }) {
  const status = useOutputStatus()
  const { health, active } = outputHealth(status)
  const pop = usePopover()
  const summary = healthSummary(health, active.length)
  const tone = HEALTH_TONE[health]

  return (
    <>
      {variant === 'toolbar' ? (
        <Button
          ref={pop.anchorRef}
          variant="ghost"
          icon={LuCable}
          onClick={pop.toggle}
          {...pop.triggerProps}
          tooltip={summary}
          aria-label={summary}
          className={cn('gap-1.5 px-2', health === 'error' && 'text-danger-fg')}
        >
          <StatusDot tone={tone} pulse={health === 'error'} />
        </Button>
      ) : (
        <button
          ref={pop.anchorRef}
          type="button"
          onClick={pop.toggle}
          {...pop.triggerProps}
          className={cn('flex h-full items-center gap-1.5 rounded-sm px-1.5 hover:bg-surface-3 hover:text-fg-primary', health === 'error' && 'text-danger-fg')}
        >
          <StatusDot tone={tone} />
          {summary}
        </button>
      )}
      <Popover {...pop.props} placement={variant === 'toolbar' ? 'bottom-end' : 'top-start'} className="w-[380px]" aria-label="DMX outputs">
        <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
          <StatusDot tone={tone} size="md" />
          <span className="flex-1 text-sm font-semibold text-fg-primary">{summary}</span>
          {status && <span className="text-xs text-fg-tertiary">{status.universeCount} universes</span>}
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {!status || status.outputs.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-fg-tertiary">No Art-Net or USB DMX output is configured. The show runs, but nothing reaches the fixtures.</p>
          ) : status.outputs.map((o) => <OutputRow key={o.id} output={o} />)}
        </div>
        <div className="flex justify-end border-t border-line-subtle px-2 py-2">
          <Button
            size="sm"
            variant="ghost"
            icon={LuSettings2}
            onClick={() => { pop.close(); useUiStore.getState().setActiveTab('settings') }}
          >
            Configure outputs
          </Button>
        </div>
      </Popover>
    </>
  )
}

function OutputRow({ output: o }: { output: DmxOutputStatus }) {
  const Icon = o.type === 'artnet' ? LuNetwork : LuUsb
  return (
    <div className={cn('flex gap-2.5 px-3 py-2', !o.enabled && 'opacity-60')}>
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-fg-tertiary" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-fg-primary">{o.label || (o.type === 'artnet' ? 'Art-Net' : 'USB DMX')}</span>
          <Badge size="xs" mono>U{o.sourceUniverse + 1}</Badge>
        </div>
        <span className="truncate font-mono text-2xs text-fg-tertiary">{o.target}</span>
        {o.lastError && o.state !== 'ok' && <span className="text-xs text-danger-fg">{o.lastError}</span>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <StatusDot tone={STATE_TONE[o.state]} />
          {STATE_LABEL[o.state]}
        </span>
        {o.state === 'ok' && <span className="font-mono text-2xs tabular text-fg-tertiary">{Math.round(o.fps)} fps</span>}
      </div>
    </div>
  )
}
