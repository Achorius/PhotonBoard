// ============================================================
// DMX address map — 512 slots of one universe on a 32 × 16 grid.
// Occupied ranges are coloured per fixture (or per group), the
// first slot carries the fixture number, overlaps are red.
// Tap a fixture to select it; tap a free slot to patch there.
// ============================================================

import { memo, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { LuHash, LuMousePointerClick, LuPlus, LuTriangleAlert } from 'react-icons/lu'
import { MAX_UNIVERSES, type FixtureDefinition, type Group } from '@shared/types'
import {
  Badge, Button, DropdownMenu, IconButton, SegmentedControl, SWATCH_COLORS, cn, fixtureCategoryIcon, formatAddress, formatAddressRange,
  palette, tint
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useGroupsByFixture, usePatchAnalysis, useRowSelection } from './patch-hooks'
import { occupancy, universeStats, UNIVERSE_SIZE, type Footprint } from './patch-utils'
import { AddressDialog } from './AddressDialog'

/** Per-fixture colours: the swatch palette minus orange (accent) and red (red means conflict here) */
const FIXTURE_COLORS = SWATCH_COLORS.slice(2)

const COLUMNS = 32
const ROWS = UNIVERSE_SIZE / COLUMNS

type ColorBy = 'fixture' | 'group'
type Focus = { kind: 'fixture'; id: string } | { kind: 'free'; address: number } | null

export function UniverseMap({ onAddAt }: { onAddAt: (universe: number, address: number) => void }) {
  const t = useT()
  const { patch, defs, items, byId, conflicts, numbers, universes } = usePatchAnalysis()
  const groupsByFixture = useGroupsByFixture()
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const [universe, setUniverse] = useState(() => universes[0] ?? 0)
  const [colorBy, setColorBy] = useState<ColorBy>('fixture')
  const [focus, setFocus] = useState<Focus>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [addressIds, setAddressIds] = useState<string[] | null>(null)

  // Follow the selection: show the universe of a fixture selected elsewhere
  useEffect(() => {
    if (selectedIds.length === 0) return
    const f = byId.get(selectedIds[selectedIds.length - 1])
    if (f && !selectedIds.some((id) => byId.get(id)?.universe === universe)) setUniverse(f.universe)
  }, [selectedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const inUniverse = useMemo(() => items.filter((f) => f.universe === universe), [items, universe])
  const slots = useMemo(() => occupancy(inUniverse, universe), [inUniverse, universe])
  const stats = useMemo(() => universeStats(inUniverse, universe), [inUniverse, universe])
  const universeConflicts = useMemo(() => inUniverse.filter((f) => conflicts.has(f.id)).length, [inUniverse, conflicts])
  const ordered = useMemo(() => [...inUniverse].sort((a, b) => a.address - b.address).map((f) => f.id), [inUniverse])
  const onSelect = useRowSelection(ordered)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const names = useMemo(() => new Map(patch.map((p) => [p.id, p.name])), [patch])

  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of inUniverse) {
      const n = numbers.get(f.id) ?? 1
      const byFixture: string = FIXTURE_COLORS[(n - 1) % FIXTURE_COLORS.length]
      const g = groupsByFixture.get(f.id)?.[0]
      map.set(f.id, colorBy === 'group' ? (g?.color.startsWith('#') ? g.color : palette.fgDisabled) : byFixture)
    }
    return map
  }, [inUniverse, numbers, groupsByFixture, colorBy])

  const shownUniverses = useMemo(() => [...new Set([...universes, universe])].sort((a, b) => a - b), [universes, universe])
  const unused = useMemo(() => Array.from({ length: MAX_UNIVERSES }, (_, u) => u).filter((u) => !shownUniverses.includes(u)), [shownUniverses])

  const onCellClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
    if (!cell) return
    const a = Number(cell.dataset.a)
    const ids = slots[a - 1]
    if (ids.length > 0) {
      const id = ids[ids.length - 1]
      setFocus({ kind: 'fixture', id })
      onSelect(id, e)
    } else {
      setFocus({ kind: 'free', address: a })
    }
  }

  const hoverIds = hover !== null ? slots[hover - 1] : []
  const highlightId = hoverIds.length > 0 ? hoverIds[hoverIds.length - 1] : focus?.kind === 'fixture' ? focus.id : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-control-lg shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-1.5">
        <SegmentedControl
          size="sm"
          aria-label={t('common.universe')}
          value={universe}
          onChange={(u) => { setUniverse(u); setFocus(null) }}
          items={shownUniverses.map((u) => ({ value: u, label: t('common.universeN', { n: u + 1 }) }))}
        />
        {unused.length > 0 && (
          <DropdownMenu
            items={() => unused.map((u) => ({ label: t('common.universeN', { n: u + 1 }), description: t('patch.map.empty'), onSelect: () => { setUniverse(u); setFocus(null) } }))}
            trigger={(p) => <IconButton {...p} size="sm" icon={LuPlus} label={t('patch.map.showAnother')} />}
          />
        )}
        <div className="flex-1" />
        <dl className="flex items-center gap-4 text-xs">
          <Stat label={t('patch.map.used')} value={`${stats.used} / ${UNIVERSE_SIZE}`} />
          <Stat label={t('common.fixtures')} value={String(stats.fixtures)} />
          <Stat label={t('patch.map.largestFree')} value={t('units.channelsShortValue', { count: stats.largestFree })} />
          {universeConflicts > 0 && <Badge tone="danger" icon={LuTriangleAlert}>{t('patch.map.inConflict', { count: universeConflicts })}</Badge>}
        </dl>
        <SegmentedControl
          size="sm"
          aria-label={t('patch.map.colourBy')}
          value={colorBy}
          onChange={setColorBy}
          items={[{ value: 'fixture' as const, label: t('patch.map.byFixture') }, { value: 'group' as const, label: t('patch.map.byGroup') }]}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-auto p-3">
        <div className="flex min-h-[420px] min-w-[640px] flex-1 gap-1.5 [[data-density=touch]_&]:min-h-[560px]">
          {/* Row start addresses */}
          <div className="grid w-9 shrink-0 gap-px" style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }} aria-hidden>
            {Array.from({ length: ROWS }, (_, r) => (
              <span key={r} className="flex items-center justify-end pr-1 font-mono text-2xs tabular text-fg-tertiary">{r * COLUMNS + 1}</span>
            ))}
          </div>
          <div
            role="grid"
            aria-label={t('patch.map.gridAria', { n: universe + 1 })}
            className="grid flex-1 gap-px overflow-hidden rounded bg-line-subtle ring-1 ring-line"
            style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
            onClick={onCellClick}
            onPointerMove={(e) => {
              if (e.pointerType !== 'mouse') return
              const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
              const a = cell ? Number(cell.dataset.a) : null
              if (a !== hover) setHover(a)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {slots.map((ids, i) => (
              <Cell
                key={i}
                address={i + 1}
                ids={ids}
                start={ids.length > 0 ? byId.get(ids[ids.length - 1])!.address === i + 1 : false}
                number={ids.length > 0 ? numbers.get(ids[ids.length - 1]) ?? 0 : 0}
                color={ids.length > 0 ? colorOf.get(ids[ids.length - 1]) ?? palette.fgDisabled : null}
                conflict={ids.length > 1}
                selected={ids.some((id) => selected.has(id))}
                highlighted={highlightId !== null && ids.includes(highlightId)}
                focusedFree={focus?.kind === 'free' && focus.address === i + 1}
              />
            ))}
          </div>
        </div>
      </div>

      <InfoBar
        universe={universe}
        focus={hover !== null ? (hoverIds.length > 0 ? { kind: 'fixture', id: hoverIds[hoverIds.length - 1] } : { kind: 'free', address: hover }) : focus}
        slots={slots}
        byId={byId}
        names={names}
        defs={defs}
        modeOf={(id) => patch.find((p) => p.id === id)?.modeName ?? ''}
        defIdOf={(id) => patch.find((p) => p.id === id)?.fixtureDefId ?? ''}
        numbers={numbers}
        groups={groupsByFixture}
        conflictWith={(id) => conflicts.get(id)?.with.map((x) => names.get(x) ?? '?') ?? []}
        onAddAt={onAddAt}
        onAddress={(id) => setAddressIds(selected.has(id) ? selectedIds : [id])}
      />
      {addressIds && <AddressDialog ids={addressIds} onClose={() => setAddressIds(null)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="font-mono tabular text-fg-primary">{value}</dd>
    </div>
  )
}

const Cell = memo(function Cell({ address, ids, start, number, color, conflict, selected, highlighted, focusedFree }: {
  address: number
  ids: string[]
  start: boolean
  number: number
  color: string | null
  conflict: boolean
  selected: boolean
  highlighted: boolean
  focusedFree: boolean
}) {
  const t = useT() // memo leaf: re-render on a language change
  const used = ids.length > 0
  const style: React.CSSProperties | undefined = used && !conflict && color
    ? { backgroundColor: tint(color, highlighted ? 0.6 : 0.36), boxShadow: start ? `inset 3px 0 0 ${color}` : undefined }
    : undefined
  return (
    <div
      data-a={address}
      role="gridcell"
      aria-label={used
        ? t(conflict ? 'patch.map.cellConflict' : 'patch.map.cellUsed', { address: String(address).padStart(3, '0'), number: String(number) })
        : t('patch.map.cellFree', { address: String(address) })}
      aria-selected={selected || undefined}
      className={cn(
        'relative flex min-h-0 min-w-0 cursor-pointer select-none items-center justify-center overflow-hidden font-mono text-2xs tabular leading-none',
        !used && (focusedFree ? 'bg-accent/25 text-fg-primary' : 'bg-surface-0 text-fg-disabled hover:bg-surface-2 hover:text-fg-secondary'),
        used && !conflict && 'text-fg-primary/70',
        conflict && 'bg-danger text-on-danger',
        selected && 'outline outline-2 -outline-offset-2 outline-info-fg'
      )}
      style={style}
    >
      {start ? <span className="font-semibold text-fg-primary">{number}</span> : address}
    </div>
  )
})

function InfoBar({ universe, focus, slots, byId, names, defs, modeOf, defIdOf, numbers, groups, conflictWith, onAddAt, onAddress }: {
  universe: number
  focus: Focus
  slots: string[][]
  byId: Map<string, Footprint>
  names: Map<string, string>
  defs: Map<string, FixtureDefinition>
  modeOf: (id: string) => string
  defIdOf: (id: string) => string
  numbers: Map<string, number>
  groups: Map<string, Group[]>
  conflictWith: (id: string) => string[]
  onAddAt: (universe: number, address: number) => void
  onAddress: (id: string) => void
}) {
  const t = useT()
  let content: React.ReactNode
  if (focus?.kind === 'fixture' && byId.has(focus.id)) {
    const f = byId.get(focus.id)!
    const def = defs.get(defIdOf(focus.id))
    const Icon = fixtureCategoryIcon(def?.categories)
    const others = conflictWith(focus.id)
    content = (
      <>
        <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <span className="font-mono text-xs tabular text-fg-tertiary">#{numbers.get(focus.id)}</span>
        <span className="truncate text-sm font-medium text-fg-primary">{names.get(focus.id)}</span>
        <span className="hidden truncate text-xs text-fg-tertiary lg:inline">{def ? `${def.manufacturer} ${def.name}` : t('patch.shared.missingType')} · {modeOf(focus.id)}</span>
        <span className="font-mono text-xs tabular text-accent-fg">{formatAddressRange(f.universe, f.address, f.count)}</span>
        <span className="text-xs tabular text-fg-tertiary">{t('units.channelsShortValue', { count: f.count })}</span>
        {(groups.get(focus.id) ?? []).slice(0, 2).map((g) => <Badge key={g.id} size="xs">{g.name}</Badge>)}
        {others.length > 0 && <Badge tone="danger" icon={LuTriangleAlert}>{t('patch.table.overlaps', { names: others.join(', ') })}</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="secondary" icon={LuHash} onClick={() => onAddress(focus.id)}>{t('patch.table.changeAddress')}</Button>
      </>
    )
  } else if (focus?.kind === 'free') {
    let run = 0
    for (let a = focus.address; a <= UNIVERSE_SIZE && slots[a - 1].length === 0; a++) run++
    content = (
      <>
        <span className="font-mono text-sm tabular text-fg-primary">{formatAddress(universe, focus.address)}</span>
        <span className="text-sm text-fg-secondary">{t('patch.map.isFree')}</span>
        <span className="truncate text-xs tabular text-fg-tertiary">
          {t('patch.map.freeFromHere', { count: run })}{run > 1 ? ` (${formatAddressRange(universe, focus.address, run)})` : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="primary" icon={LuPlus} onClick={() => onAddAt(universe, focus.address)}>{t('patch.map.addHere')}</Button>
      </>
    )
  } else {
    content = (
      <>
        <LuMousePointerClick size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <span className="truncate text-sm text-fg-tertiary">{t('patch.map.hint')}</span>
      </>
    )
  }
  return (
    <div className="flex h-control-lg shrink-0 items-center gap-2.5 overflow-hidden border-t border-line bg-surface-1 px-3" aria-live="polite">
      {content}
    </div>
  )
}
