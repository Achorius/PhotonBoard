// ============================================================
// FixtureSheet — spreadsheet of the patch (grandMA "fixture sheet"):
// one row per fixture, one column per attribute (grouped by feature),
// live values in % or DMX. Multi-cell fixtures show their cell range,
// 16-bit attributes their fine value. Programmer values are orange.
// Each cell subscribes to its own value only.
// ============================================================

import { memo, useMemo } from 'react'
import type React from 'react'
import { LuCable, LuTable } from 'react-icons/lu'
import type { FixtureDefinition, PatchEntry } from '@shared/types'
import { Button, EmptyState, cn, fixtureCategoryIcon, formatAddress, palette, tint, withAlpha } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useAttrSummary, useAttrTouched } from './attr-actions'
import { buildProgrammerModel, FEATURES, type Attribute } from './programmer-model'
import { formatRange, useProgrammerView } from './programmer-view-store'

export function FixtureSheet() {
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const rows = useMemo(() => [...patch].sort((a, b) => a.universe - b.universe || a.address - b.address), [patch])
  const numbers = useMemo(() => new Map(patch.map((p, i) => [p.id, i + 1])), [patch])
  const defs = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const model = useMemo(() => buildProgrammerModel(rows, fixtures), [rows, fixtures])
  const columns = model.attributes
  const groups = FEATURES.map((f) => ({ ...f, span: model.byFeature[f.id].length })).filter((g) => g.span > 0)

  if (patch.length === 0) {
    return (
      <EmptyState
        icon={LuCable}
        title="No fixtures patched"
        description="The sheet lists every patched fixture with its live values."
        action={<Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('patch')}>Add fixtures</Button>}
      />
    )
  }
  if (columns.length === 0) {
    return <EmptyState icon={LuTable} title="No channels" description="The patched fixture types have no known channels." />
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-20 bg-surface-1">
          <tr className="h-control-xs">
            <th colSpan={3} className="sticky left-0 z-10 bg-surface-1" />
            {groups.map((g) => (
              <th key={g.id} colSpan={g.span} scope="colgroup" className="border-l border-line px-2 text-left text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="h-control-sm">
            <Th sticky left={0} className="w-10 text-right">#</Th>
            <Th sticky left={40} className="w-[132px] min-w-[132px] max-w-[132px] text-left">Fixture</Th>
            <Th sticky left={172} className="w-[72px] text-left">Address</Th>
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                title={`${c.label}${c.fine ? ' (16-bit)' : ''}${c.cells ? ' — cells' : ''}`}
                className={cn(
                  'min-w-[52px] whitespace-nowrap border-b border-line px-1.5 text-center text-2xs font-semibold uppercase',
                  i === 0 || columns[i - 1].feature !== c.feature ? 'border-l border-l-line' : 'border-l border-l-line-subtle'
                )}
                style={{ color: c.color }}
              >
                {c.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <SheetRow
              key={entry.id}
              entry={entry}
              def={defs.get(entry.fixtureDefId)}
              number={numbers.get(entry.id) ?? 0}
              selected={selected.has(entry.id)}
              columns={columns}
              keys={model.fixtureKeys.get(entry.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ sticky, left, className, children }: { sticky?: boolean; left?: number; className?: string; children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap border-b border-line bg-surface-1 px-2 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary', sticky && 'sticky z-10', className)}
      style={sticky ? { left } : undefined}
    >
      {children}
    </th>
  )
}

const SELECTED_STICKY = tint(palette.info, 0.16, palette.surface0)

const SheetRow = memo(function SheetRow({ entry, def, number, selected, columns, keys }: {
  entry: PatchEntry
  def: FixtureDefinition | undefined
  number: number
  selected: boolean
  columns: Attribute[]
  keys: Set<string> | undefined
}) {
  const Icon = fixtureCategoryIcon(def?.categories)
  const onSelect = (e: React.MouseEvent) => {
    const touch = useUiStore.getState().density === 'touch'
    usePatchStore.getState().selectFixture(entry.id, touch || e.metaKey || e.ctrlKey || e.shiftKey)
  }
  // Sticky cells need an opaque background
  const stickyBg = selected ? undefined : 'bg-surface-0'
  const stickyStyle = selected ? { backgroundColor: SELECTED_STICKY } : undefined
  return (
    <tr aria-selected={selected} onClick={onSelect} className={cn('h-row cursor-pointer', selected ? 'bg-info/[0.16]' : 'hover:bg-surface-2')}>
      <td className={cn('sticky left-0 z-[1] w-10 border-b border-line-subtle px-2 text-right font-mono text-2xs tabular text-fg-tertiary', stickyBg, selected && 'shadow-[inset_2px_0_0_rgb(var(--pb-info-fg))]')} style={stickyStyle}>
        {number}
      </td>
      <td className={cn('sticky left-10 z-[1] w-[132px] min-w-[132px] max-w-[132px] border-b border-line-subtle px-2', stickyBg)} style={stickyStyle}>
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon size={13} aria-hidden className={selected ? 'shrink-0 text-info-fg' : 'shrink-0 text-fg-tertiary'} />
          <span className={cn('truncate text-sm', selected ? 'text-fg-primary' : 'text-fg-secondary')}>{entry.name}</span>
        </span>
      </td>
      <td className={cn('sticky left-[172px] z-[1] w-[72px] border-b border-r border-line-subtle border-r-line px-2 font-mono text-2xs tabular text-fg-tertiary', stickyBg)} style={stickyStyle}>
        {formatAddress(entry.universe, entry.address)}
      </td>
      {columns.map((c, i) => {
        const edge = i === 0 || columns[i - 1].feature !== c.feature ? 'border-l-line' : 'border-l-line-subtle'
        return keys?.has(c.key)
          ? <SheetCell key={c.key} attr={c} fixtureId={entry.id} edge={edge} />
          : <td key={c.key} className={cn('border-b border-l border-b-line-subtle bg-surface-0/60', edge)} />
      })}
    </tr>
  )
})

const SheetCell = memo(function SheetCell({ attr, fixtureId, edge }: { attr: Attribute; fixtureId: string; edge: string }) {
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr, fixtureId)
  const targets = useMemo(() => attr.targets.filter((t) => t.fixtureId === fixtureId), [attr, fixtureId])
  const touched = useAttrTouched(targets)
  const pct = (sum.max / attr.max) * 100
  return (
    <td className={cn('relative border-b border-l border-b-line-subtle px-1.5 text-center font-mono text-2xs tabular', edge, touched !== 'none' ? 'text-accent-fg' : sum.max > 0 ? 'text-fg-primary' : 'text-fg-disabled')}>
      {sum.max > 0 && (
        <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, backgroundColor: withAlphaSafe(attr.color, 0.16) }} />
      )}
      {touched !== 'none' && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
      <span className="relative">{formatRange(sum.min, sum.max, attr.max, unit)}</span>
    </td>
  )
})

function withAlphaSafe(color: string, a: number): string {
  return color.startsWith('#') ? withAlpha(color, a) : color
}
