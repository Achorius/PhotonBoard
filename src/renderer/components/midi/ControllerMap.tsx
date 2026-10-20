// Visual map of a controller: what every pad, button and fader does in
// the chosen layout, with the LEDs as the device shows them (4 Hz).
// Tap a control to read its function (and its Shift function).

import { useEffect, useMemo, useState } from 'react'
import { cn, prefersDarkText, withAlpha } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import type { ControlDef, ControlId, ControllerBinding, ControllerLayoutId, ControllerProfile, LedState } from '@renderer/lib/midi/controller-types'
import { buildBindings } from '@renderer/lib/midi/layouts'
import { getController } from '@renderer/lib/midi/controller-runtime'
import { faderLogicalLevel } from '@renderer/lib/midi/controller-actions'
import { useControllerStore, ghostKey, GM_GHOST_KEY } from '@renderer/stores/controller-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { mappingMatches } from '@renderer/lib/midi-manager'
import type { MidiMapping } from '@shared/types'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { actionLabel, actionShort, controlLabel } from './controller-model'

/** Re-render at 4 Hz while mounted (LEDs and names follow the show) */
function useTick(ms = 250): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return n
}

function ledStyle(state: LedState | undefined): { style?: React.CSSProperties; dark: boolean; blink: boolean } {
  if (!state || state.mode === 'off') return { dark: false, blink: false }
  if (state.mode === 'dim') return { style: { backgroundColor: withAlpha(state.color, 0.35), boxShadow: `inset 0 0 0 1px ${withAlpha(state.color, 0.6)}` }, dark: false, blink: false }
  return {
    style: { backgroundColor: state.color, boxShadow: `0 0 10px ${withAlpha(state.color, 0.55)}` },
    dark: prefersDarkText(state.color),
    blink: state.mode === 'blink' || state.mode === 'pulse'
  }
}

export function ControllerMap({ profile, layout, port }: { profile: ControllerProfile; layout: ControllerLayoutId; port: string }) {
  const t = useT()
  useTick()
  const [selected, setSelected] = useState<ControlId | null>(null)
  const bindings = useMemo(() => new Map<ControlId, ControllerBinding>(buildBindings(profile, layout).map((b) => [b.control, b])), [profile, layout])
  const leds = getController(port)?.leds
  const byId = useMemo(() => new Map(profile.controls.map((c) => [c.id, c])), [profile])
  const grid = profile.grid
  const scenes = profile.controls.filter((c) => c.id.startsWith('scene:'))
  const tracks = profile.controls.filter((c) => c.id.startsWith('track:') || c.id === 'page:-' || c.id === 'page:+' || c.id === 'shift')
  const faders = profile.controls.filter((c) => /^(fader|encoder):\d+$/.test(c.id) && bindings.has(c.id))

  const mappings = useMidiStore((s) => s.mappings)
  /** A user mapping on the same message wins over the profile */
  const userMapping = (c: ControlDef): MidiMapping | undefined => mappings.find((m) => mappingMatches(m, c.type, c.channel, c.number, port))

  const sel = selected ? byId.get(selected) : undefined
  const selBinding = selected ? bindings.get(selected) : undefined
  const selMapping = sel ? userMapping(sel) : undefined

  const button = (c: ControlDef, shape: 'pad' | 'round' | 'wide') => {
    const um = userMapping(c)
    const b = um ? undefined : bindings.get(c.id)
    const look = ledStyle(leds?.get(c.id))
    const label = um ? um.name : b ? actionShort(b.action, t) : c.id === 'shift' ? 'Shift' : ''
    return (
      <button
        key={c.id}
        type="button"
        aria-pressed={selected === c.id}
        aria-label={controlLabel(c, t)}
        title={um ? t('pro.midi.map.userMapping', { name: um.name }) : b ? actionLabel(b.action, t) : t('pro.midi.map.notUsed')}
        onClick={() => setSelected(selected === c.id ? null : c.id)}
        style={look.style}
        className={cn(
          'relative flex min-w-0 items-center justify-center overflow-hidden border border-line bg-surface-2 px-0.5 text-center text-2xs font-medium leading-tight transition-colors duration-fast',
          shape === 'pad' && 'aspect-square rounded-sm',
          shape === 'round' && 'h-7 w-11 rounded-full [[data-density=touch]_&]:h-9 [[data-density=touch]_&]:w-14',
          shape === 'wide' && 'h-7 rounded-sm [[data-density=touch]_&]:h-9',
          look.dark ? 'text-black/80' : 'text-fg-primary',
          look.blink && 'animate-pulse',
          !b && !um && c.id !== 'shift' && 'opacity-50',
          um && 'border-dashed border-midi-fg/70 text-midi-fg',
          selected === c.id && 'outline outline-2 outline-offset-1 outline-info-fg'
        )}
      >
        <span className="line-clamp-2 break-words">{label}</span>
        {um && <span aria-hidden className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-midi-fg" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        {grid && (
          <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, maxWidth: grid.cols * 56 }}>
            {Array.from({ length: grid.rows }, (_, row) => Array.from({ length: grid.cols }, (_, col) => {
              const c = byId.get(grid.pad(col, row))
              return c ? button(c, 'pad') : <span key={`${col}:${row}`} />
            }))}
          </div>
        )}
        {scenes.length > 0 && <div className="flex flex-col gap-1 pt-0.5">{scenes.map((c) => button(c, 'round'))}</div>}
      </div>
      {tracks.length > 0 && (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(8, tracks.length)}, minmax(0, 1fr))`, maxWidth: Math.max(8, tracks.length) * 56 }}>
          {tracks.map((c) => button(c, 'wide'))}
        </div>
      )}
      {faders.length > 0 && (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(9, faders.length)}, minmax(0, 1fr))`, maxWidth: Math.max(9, faders.length) * 56 }}>
          {faders.map((c) => <FaderView key={c.id} control={c} binding={bindings.get(c.id)!} selected={selected === c.id} onSelect={() => setSelected(selected === c.id ? null : c.id)} />)}
        </div>
      )}
      <div className="min-h-[44px] rounded-lg border border-line-subtle bg-surface-1 px-3 py-2" aria-live="polite">
        {sel ? (
          <>
            <div className="text-sm font-medium text-fg-primary">{controlLabel(sel, t)}</div>
 <div className="text-xs text-fg-secondary">
              {selMapping ? t('pro.midi.map.userMapping', { name: selMapping.name }) : selBinding ? actionLabel(selBinding.action, t) : sel.id === 'shift' ? 'Shift' : t('pro.midi.map.notUsed')}
            </div>
            {!selMapping && selBinding?.shiftAction && <div className="text-xs text-fg-tertiary">{t('pro.midi.map.shiftThen', { action: actionLabel(selBinding.shiftAction, t) })}</div>}
          </>
        ) : (
          <div className="text-xs text-fg-tertiary">{t('pro.midi.map.hint')}</div>
        )}
      </div>
    </div>
  )
}

function FaderView({ control, binding, selected, onSelect }: { control: ControlDef; binding: ControllerBinding; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const page = useExecutorStore((s) => s.currentPage)
  const key = binding.action.type === 'grand-master' ? GM_GHOST_KEY : binding.action.type === 'column-fader' ? ghostKey(page, binding.action.col) : ''
  const ghost = useControllerStore((s) => (key ? s.ghosts[key] : undefined))
  const level = faderLogicalLevel(binding.action) ?? 0
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={controlLabel(control, t)}
      title={actionLabel(binding.action, t)}
      onClick={onSelect}
      className={cn('flex min-w-0 flex-col items-center gap-1 rounded-sm px-0.5 py-1', selected && 'outline outline-2 outline-offset-1 outline-info-fg')}
    >
      <span className="relative h-20 w-3 overflow-hidden rounded-full bg-surface-0 ring-1 ring-inset ring-line-strong [[data-density=touch]_&]:h-24">
        <span className="absolute inset-x-0 bottom-0 bg-accent/80" style={{ height: `${(level / 255) * 100}%` }} />
        {ghost !== undefined && <span className="absolute inset-x-[-2px] h-0.5 bg-warning" style={{ bottom: `calc(${(ghost / 255) * 100}% - 1px)` }} />}
      </span>
      <span className="w-full truncate text-center text-2xs text-fg-secondary">{actionShort(binding.action, t)}</span>
    </button>
  )
}
