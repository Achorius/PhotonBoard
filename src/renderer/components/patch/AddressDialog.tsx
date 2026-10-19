// ============================================================
// Re-address one or several fixtures: universe + start address,
// optional gap, "skip used addresses". Shows the result before
// applying and refuses overlaps (offering to shift instead).
// ============================================================

import { useMemo, useState } from 'react'
import { LuArrowRight, LuWandSparkles } from 'react-icons/lu'
import { MAX_UNIVERSES } from '@shared/types'
import { Button, Field, Modal, NumberField, Select, Switch, formatAddressRange, toast } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePatchAnalysis } from './patch-hooks'
import { findFreeAddress, overlaps, planReaddress, UNIVERSE_SIZE } from './patch-utils'
import { Notice, UniverseStrip, type StripSegment } from './patch-parts'

export const UNIVERSE_OPTIONS = Array.from({ length: MAX_UNIVERSES }, (_, u) => ({ value: String(u), label: `Universe ${u + 1}` }))

export function AddressDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { patch, items, byId } = usePatchAnalysis()
  // Keep the order of the patch addresses (lowest first) — predictable packing
  const moving = useMemo(
    () => ids.map((id) => byId.get(id)).filter((f) => !!f).sort((a, b) => a.universe - b.universe || a.address - b.address),
    [ids, byId]
  )
  const first = moving[0]
  const [universe, setUniverse] = useState(first?.universe ?? 0)
  const [address, setAddress] = useState(first?.address ?? 1)
  const [gap, setGap] = useState(0)
  const [avoid, setAvoid] = useState(moving.length > 1)

  const plan = useMemo(() => planReaddress(items, moving, universe, address, gap, avoid), [items, moving, universe, address, gap, avoid])
  const names = useMemo(() => new Map(patch.map((p) => [p.id, p.name])), [patch])
  const conflicts = plan.filter((p) => p.conflict)
  const overflow = plan.filter((p) => p.overflow)
  const conflictNames = useMemo(() => {
    const movingIds = new Set(moving.map((m) => m.id))
    const hit = new Set<string>()
    for (const p of plan) {
      if (!p.conflict) continue
      const fp = { universe: p.universe, address: p.address, count: byId.get(p.id)?.count ?? 1 }
      for (const f of items) if (!movingIds.has(f.id) && overlaps(f, fp)) hit.add(names.get(f.id) ?? '?')
    }
    return [...hit]
  }, [plan, items, moving, byId, names])
  const unchanged = plan.every((p) => byId.get(p.id)?.universe === p.universe && byId.get(p.id)?.address === p.address)

  const segments = useMemo<StripSegment[]>(() => {
    const movingIds = new Set(moving.map((m) => m.id))
    const segs: StripSegment[] = items
      .filter((f) => f.universe === universe && !movingIds.has(f.id))
      .map((f) => ({ key: f.id, address: f.address, count: f.count, kind: 'existing', label: names.get(f.id) }))
    for (const p of plan) {
      if (p.overflow) continue
      segs.push({ key: `new-${p.id}`, address: p.address, count: byId.get(p.id)?.count ?? 1, kind: p.conflict ? 'conflict' : 'new', label: names.get(p.id) })
    }
    return segs
  }, [items, moving, plan, universe, names, byId])

  if (!first) return null

  const nextFree = () => {
    const exclude = new Set(moving.map((m) => m.id))
    const found = findFreeAddress(items, universe, first.count, 1, exclude)
    if (found === null) toast.warning(`Universe ${universe + 1} is full`, { description: `No block of ${first.count} free channels.` })
    else setAddress(found)
  }

  const apply = () => {
    const updates: Record<string, { universe: number; address: number }> = {}
    for (const p of plan) updates[p.id] = { universe: p.universe, address: p.address }
    usePatchStore.getState().updateFixtures(updates)
    toast.success(moving.length === 1 ? `${names.get(first.id)} → ${formatAddressRange(plan[0].universe, plan[0].address, first.count)}` : `Re-addressed ${moving.length} fixtures`)
    onClose()
  }

  const blocked = conflicts.length > 0 || overflow.length > 0
  const title = moving.length === 1 ? `Address of ${names.get(first.id)}` : `Address ${moving.length} fixtures`

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={title}
      description={moving.length > 1 ? 'Fixtures are placed one after another from the start address, in their current order.' : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={blocked || unchanged} onClick={apply}>Apply</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field layout="stacked" label="Universe">
            {(id) => <Select id={id} value={String(universe)} onChange={(v) => setUniverse(Number(v))} options={UNIVERSE_OPTIONS} />}
          </Field>
          <Field layout="stacked" label={moving.length > 1 ? 'Start address' : 'Address'}>
            <div className="flex gap-2">
              <NumberField aria-label="Start address" value={address} onChange={setAddress} min={1} max={UNIVERSE_SIZE} step={1} className="flex-1" />
              <Button variant="secondary" icon={LuWandSparkles} onClick={nextFree} tooltip="First free block in this universe">Next free</Button>
            </div>
          </Field>
          {moving.length > 1 && (
            <Field layout="stacked" label="Gap between fixtures" hint="Empty channels left after each fixture">
              <NumberField aria-label="Gap" value={gap} onChange={setGap} min={0} max={64} step={1} unit="ch" />
            </Field>
          )}
        </div>
        <Switch
          checked={avoid}
          onChange={setAvoid}
          label="Skip used addresses"
          description="Jump over channels used by other fixtures instead of overlapping them."
        />

        <UniverseStrip label={`Universe ${universe + 1}`} segments={segments} />

        <div className="max-h-[200px] overflow-y-auto rounded-lg bg-surface-0 ring-1 ring-inset ring-line">
          {plan.map((p) => {
            const from = byId.get(p.id)!
            return (
              <div key={p.id} className="flex h-row items-center gap-2 border-b border-line-subtle px-3 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-fg-primary">{names.get(p.id)}</span>
                <span className="font-mono text-xs tabular text-fg-tertiary">{formatAddressRange(from.universe, from.address, from.count)}</span>
                <LuArrowRight size={12} aria-hidden className="shrink-0 text-fg-tertiary" />
                <span className={p.overflow || p.conflict ? 'font-mono text-xs tabular text-danger-fg' : 'font-mono text-xs tabular text-fg-primary'}>
                  {p.overflow ? 'does not fit' : formatAddressRange(p.universe, p.address, from.count)}
                </span>
              </div>
            )
          })}
        </div>

        {conflicts.length > 0 && (
          <Notice
            tone="danger"
            title={conflicts.length === 1 ? 'This address overlaps another fixture' : `${conflicts.length} fixtures would overlap other fixtures`}
            action={!avoid ? <Button size="sm" variant="secondary" onClick={() => setAvoid(true)}>Shift to free addresses</Button> : undefined}
          >
            {conflictNames.length > 0 && <>{conflictNames.slice(0, 5).join(', ')}{conflictNames.length > 5 ? '…' : ''} already use{conflictNames.length === 1 ? 's' : ''} these channels. </>}
            Two fixtures on the same channels receive the same DMX values.
          </Notice>
        )}
        {overflow.length > 0 && (
          <Notice tone="danger" title={`${overflow.length === 1 ? 'A fixture does' : `${overflow.length} fixtures do`} not fit before channel ${UNIVERSE_SIZE}`}>
            Choose a lower start address or another universe.
          </Notice>
        )}
      </div>
    </Modal>
  )
}
