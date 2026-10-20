// Channel faders: one strip per fixture, one fader per DMX channel
// (labels and fills in the channel-type colour). The strip bank scrolls
// sideways — by trackpad / wheel, by dragging the strip headers with a
// finger, or from the navigator at the bottom. Each fader subscribes to
// its own channel only.

import { memo, useEffect, useMemo, useRef } from 'react'
import type React from 'react'
import { LuSlidersVertical } from 'react-icons/lu'
import type { FixtureDefinition, PatchEntry } from '@shared/types'
import { EmptyState, Fader, cn, fixtureCategoryIcon, formatAddress } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { getChannelShortLabel, getChannelTypeColor } from '@renderer/lib/fixture-library'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { programChannel, releaseChannels, useProgrammerStore } from '@renderer/lib/programmer-utils'
import { formatAttrValue, useProgrammerView } from './programmer-view-store'
import { useChannelMenu } from './channel-menu'

export interface FixtureStripsProps {
  entries: PatchEntry[]
  defs: Map<string, FixtureDefinition>
  /** Fixture numbers (1-based patch order) */
  numbers: Map<string, number>
  selectedIds: string[]
  emptyTitle?: string
  emptyDescription?: string
}

export function FixtureStrips({ entries, defs, numbers, selectedIds, emptyTitle, emptyDescription }: FixtureStripsProps) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const first = selectedIds[0]

  // Bring the (first) selected fixture into view
  useEffect(() => {
    if (!first) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-strip="${CSS.escape(first)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [first])

  if (entries.length === 0) {
    return <EmptyState icon={LuSlidersVertical} title={emptyTitle ?? t('fixtures.empty.noFixturesHere')} description={emptyDescription} />
  }

  const jump = (id: string) => {
    scroller.current?.querySelector<HTMLElement>(`[data-strip="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden p-3">
        {entries.map((e) => (
          <Strip key={e.id} entry={e} def={defs.get(e.fixtureDefId)} number={numbers.get(e.id) ?? 0} selected={selected.has(e.id)} />
        ))}
      </div>
      {entries.length > 1 && (
        <nav aria-label={t('fixtures.strips.jumpAria')} className="flex h-control-lg shrink-0 items-center gap-1 overflow-x-auto border-t border-line-subtle px-3">
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => jump(e.id)}
              className={cn(
                'h-control-xs shrink-0 rounded-sm px-2 text-2xs transition-colors duration-fast',
                selected.has(e.id) ? 'bg-info/20 text-info-fg' : 'text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary'
              )}
            >
              {e.name}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

const Strip = memo(function Strip({ entry, def, number, selected }: {
  entry: PatchEntry
  def: FixtureDefinition | undefined
  number: number
  selected: boolean
}) {
  const t = useT()
  const channels = useMemo(() => {
    const mode = def?.modes.find((m) => m.name === entry.modeName)
    return (mode?.channels ?? []).map((name, i) => ({ name, channel: entry.address - 1 + i, chDef: def?.channels[name] }))
      .filter((c) => c.channel >= 0 && c.channel < 512)
  }, [entry, def])
  const Icon = fixtureCategoryIcon(def?.categories)

  const onSelect = (e: React.MouseEvent) => {
    const touch = useUiStore.getState().density === 'touch'
    usePatchStore.getState().selectFixture(entry.id, touch || e.metaKey || e.ctrlKey || e.shiftKey)
  }

  return (
    <section
      data-strip={entry.id}
      aria-label={entry.name}
      className={cn(
        'flex h-full shrink-0 flex-col rounded-lg ring-1 ring-inset transition-colors duration-fast',
        selected ? 'bg-info/[0.08] ring-info/70' : 'bg-surface-1 ring-line'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title={def ? `${def.manufacturer} ${def.name} · ${entry.modeName}` : t('fixtures.strips.unknownType')}
        className="flex min-h-control-sm min-w-0 items-center gap-1.5 rounded-t-lg border-b border-line-subtle px-2 text-left hover:bg-surface-2"
      >
        <span className="font-mono text-2xs tabular text-fg-tertiary">{number}</span>
        <Icon size={13} aria-hidden className={selected ? 'text-info-fg' : 'text-fg-tertiary'} />
        <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', selected ? 'text-fg-primary' : 'text-fg-secondary')}>{entry.name}</span>
        <span className="font-mono text-2xs tabular text-fg-tertiary">{formatAddress(entry.universe, entry.address)}</span>
      </button>
      {channels.length === 0 ? (
        <p className="p-3 text-xs text-warning-fg">{t('fixtures.strips.unknownType')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-1 px-1.5 pb-1.5 pt-1">
          {channels.map((c) => (
            <ChannelFader
              key={c.channel}
              universe={entry.universe}
              channel={c.channel}
              fixtureId={entry.id}
              fixtureName={entry.name}
              name={c.name}
              color={getChannelTypeColor(c.chDef?.type ?? 'generic', c.name)}
              defaultValue={c.chDef?.defaultValue ?? 0}
            />
          ))}
        </div>
      )}
    </section>
  )
})

const ChannelFader = memo(function ChannelFader({ universe, channel, fixtureId, fixtureName, name, color, defaultValue }: {
  universe: number
  channel: number
  fixtureId: string
  fixtureName: string
  name: string
  color: string
  defaultValue: number
}) {
  const value = useDmxStore((s) => s.values[universe]?.[channel] ?? 0)
  const touched = useProgrammerStore((s) => s.version >= 0 && getProgrammerValue(universe, channel) !== undefined)
  const unit = useProgrammerView((s) => s.unit)
  const openMenu = useChannelMenu()
  const release = () => releaseChannels({ [universe]: [channel] })
  return (
    <div
      className="flex h-full w-[34px] shrink-0 flex-col items-center [[data-density=touch]_&]:w-[46px]"
      title={`${name} · ${formatAddress(universe, channel + 1)}`}
      onContextMenu={(e) => openMenu(e, { fixtureId, fixtureName, channelName: name, onRelease: touched ? release : undefined })}
    >
      <span className={cn('h-4 font-mono text-2xs leading-4 tabular', touched ? 'text-accent-fg' : value > 0 ? 'text-fg-secondary' : 'text-fg-tertiary')}>
        {formatAttrValue(value, 255, unit)}
      </span>
      <div className="flex min-h-0 w-full flex-1 justify-center">
        <Fader
          value={value}
          onChange={(v) => programChannel(universe, channel, v)}
          defaultValue={defaultValue}
          color={color}
          readout={false}
          ticks={false}
          aria-label={`${fixtureName} ${name}`}
        />
      </div>
      <span
        className={cn('mt-0.5 w-full truncate rounded-sm text-center text-2xs font-semibold leading-4', touched ? 'bg-accent/20 text-accent-fg' : 'text-fg-tertiary')}
        style={touched ? undefined : { color }}
      >
        {getChannelShortLabel(name)}
      </span>
    </div>
  )
})
