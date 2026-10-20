// ============================================================
// Raw DMX — all 512 channels of a universe as a compact grid (expert
// mode, and the only way to drive unpatched channels). Cells show the
// live mix value, the owning fixture channel (colour bar), programmer
// values (orange). Tap / click selects (Ctrl/Cmd adds, Shift extends;
// on touch a tap adds/removes); the bar below sets the selected channels.
// ============================================================

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuEraser, LuX } from 'react-icons/lu'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import { Button, IconButton, NumberField, Slider, cn, formatAddress, formatPercent, useDensity } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { getChannelShortLabel, getChannelTypeColor } from '@renderer/lib/fixture-library'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { programChannel, releaseChannels, useProgrammerStore } from '@renderer/lib/programmer-utils'
import { formatAttrValue, useProgrammerView } from './programmer-view-store'

interface ChannelOwner {
  fixtureName: string
  channelName: string
  color: string
  /** First channel of the fixture */
  start: boolean
}

export function DmxGrid({ universe }: { universe: number }) {
  const t = useT()
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const unit = useProgrammerView((s) => s.unit)
  const [selection, setSelection] = useState<number[]>([])
  const anchor = useRef<number | null>(null)

  const owners = useMemo(() => {
    const map = new Map<number, ChannelOwner>()
    for (const entry of patch) {
      if (entry.universe !== universe) continue
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      const mode = def?.modes.find((m) => m.name === entry.modeName)
      const names = mode?.channels ?? []
      const count = mode?.channelCount ?? names.length
      for (let i = 0; i < Math.max(count, names.length); i++) {
        const ch = entry.address - 1 + i
        if (ch < 0 || ch >= DMX_CHANNELS_PER_UNIVERSE) continue
        const name = names[i] ?? translate('fixtures.dmx.channelN', { n: i + 1 })
        map.set(ch, { fixtureName: entry.name, channelName: name, color: getChannelTypeColor(def?.channels[name]?.type ?? 'generic', name), start: i === 0 })
      }
    }
    return map
  }, [patch, fixtures, universe, t])

  const selected = useMemo(() => new Set(selection), [selection])

  // Whole rows of 32 / 25 / 20 / 16 / 10 / 8 channels (easy to read addresses), as wide as fits
  const touch = useDensity() === 'touch'
  const areaRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth - 24)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const minCell = touch ? 62 : 52
  const columns = [32, 25, 20, 16, 10, 8].find((n) => width / n >= minCell) ?? 8

  const onCell = useCallback((ch: number, e: React.MouseEvent) => {
    const touch = useUiStore.getState().density === 'touch'
    setSelection((cur) => {
      if (e.shiftKey && anchor.current !== null) {
        const a = Math.min(anchor.current, ch)
        const b = Math.max(anchor.current, ch)
        const range = Array.from({ length: b - a + 1 }, (_, i) => a + i)
        return e.metaKey || e.ctrlKey ? [...new Set([...cur, ...range])] : range
      }
      anchor.current = ch
      if (touch || e.metaKey || e.ctrlKey) return cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch]
      return cur.length === 1 && cur[0] === ch ? [] : [ch]
    })
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={areaRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        <div
          role="listbox"
          aria-label={t('fixtures.dmx.gridAria', { n: universe + 1 })}
          aria-multiselectable="true"
          className="grid gap-px overflow-hidden rounded-lg bg-line-subtle ring-1 ring-line"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: DMX_CHANNELS_PER_UNIVERSE }, (_, ch) => (
            <DmxCell key={ch} universe={universe} channel={ch} owner={owners.get(ch)} selected={selected.has(ch)} unit={unit} onSelect={onCell} />
          ))}
        </div>
      </div>
      <EditBar universe={universe} selection={selection} owners={owners} onClear={() => setSelection([])} />
    </div>
  )
}

const DmxCell = memo(function DmxCell({ universe, channel, owner, selected, unit, onSelect }: {
  universe: number
  channel: number
  owner: ChannelOwner | undefined
  selected: boolean
  unit: 'percent' | 'dmx'
  onSelect: (ch: number, e: React.MouseEvent) => void
}) {
  const t = useT()
  const value = useDmxStore((s) => s.values[universe]?.[channel] ?? 0)
  const touched = useProgrammerStore((s) => s.version >= 0 && getProgrammerValue(universe, channel) !== undefined)
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      title={`${formatAddress(universe, channel + 1)} · ${owner ? `${owner.fixtureName} · ${owner.channelName}` : t('fixtures.dmx.unpatched')} · ${value}`}
      onClick={(e) => onSelect(channel, e)}
      className={cn(
        'relative flex h-[34px] flex-col items-start justify-between overflow-hidden px-1 py-0.5 text-left [[data-density=touch]_&]:h-[44px]',
        selected ? 'bg-info/25' : owner ? 'bg-surface-2 hover:bg-surface-3' : 'bg-surface-1 hover:bg-surface-2',
        selected && 'z-[1] outline outline-2 -outline-offset-2 outline-info-fg'
      )}
    >
      {owner && <span aria-hidden className={cn('absolute inset-y-0 left-0', owner.start ? 'w-[3px]' : 'w-px')} style={{ backgroundColor: owner.color }} />}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-0">
        <span className="block h-full" style={{ width: `${(value / 255) * 100}%`, backgroundColor: touched ? 'rgb(var(--pb-accent))' : owner?.color ?? 'rgb(var(--pb-fg-tertiary))' }} />
      </span>
      <span className="flex w-full items-baseline justify-between gap-0.5 pl-0.5">
        <span className="font-mono text-[10px] leading-3 tabular text-fg-tertiary">{channel + 1}</span>
        {owner && <span className="truncate font-mono text-[10px] leading-3" style={{ color: owner.color }}>{getChannelShortLabel(owner.channelName)}</span>}
      </span>
      <span className={cn('pl-0.5 font-mono text-xs leading-4 tabular', touched ? 'text-accent-fg' : value > 0 ? 'text-fg-primary' : 'text-fg-disabled')}>
        {formatAttrValue(value, 255, unit)}
      </span>
    </button>
  )
})

function EditBar({ universe, selection, owners, onClear }: {
  universe: number
  selection: number[]
  owners: Map<number, ChannelOwner>
  onClear: () => void
}) {
  const t = useT()
  const first = selection[0]
  const value = useDmxStore((s) => (first === undefined ? 0 : s.values[universe]?.[first] ?? 0))
  const set = (v: number) => { for (const ch of selection) programChannel(universe, ch, v) }
  const sorted = [...selection].sort((a, b) => a - b)
  const label = sorted.length === 0
    ? t('fixtures.dmx.selectHint')
    : sorted.length === 1
      ? `${formatAddress(universe, sorted[0] + 1)}${owners.get(sorted[0]) ? ` · ${owners.get(sorted[0])!.fixtureName} ${owners.get(sorted[0])!.channelName}` : ''}`
      : t('fixtures.dmx.selectionRange', { count: sorted.length, from: String(sorted[0] + 1), to: String(sorted[sorted.length - 1] + 1) })
  const disabled = selection.length === 0
  return (
    <div className="flex min-h-control-lg shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface-1 px-3 py-1.5">
      <span className={cn('min-w-[160px] truncate text-xs', disabled ? 'text-fg-tertiary' : 'text-fg-primary')}>{label}</span>
      {!disabled && <IconButton icon={LuX} label={t('fixtures.dmx.deselect')} size="xs" onClick={onClear} />}
      <Slider value={value} onChange={set} disabled={disabled} showValue className="min-w-[160px] flex-1" aria-label={t('fixtures.dmx.levelAria')} />
      <NumberField value={value} onChange={set} min={0} max={255} disabled={disabled} label="DMX" className="w-[110px]" />
      <Button size="sm" disabled={disabled} onClick={() => set(0)}>{t('fixtures.intensity.out')}</Button>
      <Button size="sm" disabled={disabled} onClick={() => set(128)}>{formatPercent(50, 100)}</Button>
      <Button size="sm" disabled={disabled} onClick={() => set(255)}>{t('fixtures.intensity.full')}</Button>
      <Button size="sm" variant="ghost" icon={LuEraser} disabled={disabled} onClick={() => releaseChannels({ [universe]: selection })}>{t('fixtures.release.label')}</Button>
    </div>
  )
}
