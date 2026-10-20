// ============================================================
// Re-address one or several fixtures: universe + start address,
// optional gap, "skip used addresses". Shows the result before
// applying and refuses overlaps (offering to shift instead).
// ============================================================

import { useMemo, useState } from 'react'
import { LuArrowRight, LuWandSparkles } from 'react-icons/lu'
import { MAX_UNIVERSES } from '@shared/types'
import { Button, Field, Modal, NumberField, Select, Switch, formatAddressRange, toast } from '@renderer/components/ui'
import { t as tr, useT, type TFunction } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePatchAnalysis } from './patch-hooks'
import { findFreeAddress, overlaps, planReaddress, UNIVERSE_SIZE } from './patch-utils'
import { Notice, UniverseStrip, type StripSegment } from './patch-parts'

/** "Universe 1" … options for a universe picker (in the given language) */
export function universeOptions(t: TFunction): { value: string; label: string }[] {
  return Array.from({ length: MAX_UNIVERSES }, (_, u) => ({ value: String(u), label: t('common.universeN', { n: u + 1 }) }))
}

/** Universe picker options, rebuilt on a language change */
export function useUniverseOptions(): { value: string; label: string }[] {
  const t = useT()
  return useMemo(() => universeOptions(t), [t])
}

export function AddressDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const t = useT()
  const universeOpts = useUniverseOptions()
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
    if (found === null) toast.warning(tr('patch.address.universeFull', { n: universe + 1 }), { description: tr('patch.address.noBlock', { count: first.count }) })
    else setAddress(found)
  }

  const apply = () => {
    const updates: Record<string, { universe: number; address: number }> = {}
    for (const p of plan) updates[p.id] = { universe: p.universe, address: p.address }
    usePatchStore.getState().updateFixtures(updates)
    toast.success(moving.length === 1
      ? `${names.get(first.id)} → ${formatAddressRange(plan[0].universe, plan[0].address, first.count)}`
      : tr('patch.address.readdressed', { count: moving.length }))
    onClose()
  }

  const blocked = conflicts.length > 0 || overflow.length > 0
  const title = moving.length === 1 ? t('patch.address.titleOne', { name: names.get(first.id) ?? '' }) : t('patch.address.titleMany', { count: moving.length })
  const shownNames = `${conflictNames.slice(0, 5).join(', ')}${conflictNames.length > 5 ? '…' : ''}`

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={title}
      description={moving.length > 1 ? t('patch.address.description') : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={blocked || unchanged} onClick={apply}>{t('common.apply')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field layout="stacked" label={t('common.universe')}>
            {(id) => <Select id={id} value={String(universe)} onChange={(v) => setUniverse(Number(v))} options={universeOpts} />}
          </Field>
          <Field layout="stacked" label={moving.length > 1 ? t('patch.shared.startAddress') : t('common.address')}>
            <div className="flex gap-2">
              <NumberField aria-label={t('patch.shared.startAddress')} value={address} onChange={setAddress} min={1} max={UNIVERSE_SIZE} step={1} className="min-w-[72px] flex-1" />
              <Button variant="secondary" icon={LuWandSparkles} onClick={nextFree} tooltip={t('patch.shared.nextFreeTooltip')}>{t('patch.shared.nextFree')}</Button>
            </div>
          </Field>
          {moving.length > 1 && (
            <Field layout="stacked" label={t('patch.shared.gapBetween')} hint={t('patch.address.gapHint')}>
              <NumberField aria-label={t('patch.shared.gap')} value={gap} onChange={setGap} min={0} max={64} step={1} unit={t('units.channelsShort')} />
            </Field>
          )}
        </div>
        <Switch
          checked={avoid}
          onChange={setAvoid}
          label={t('patch.shared.skipUsed')}
          description={t('patch.address.skipUsedDescription')}
        />

        <UniverseStrip label={t('common.universeN', { n: universe + 1 })} segments={segments} />

        <div className="max-h-[200px] overflow-y-auto rounded-lg bg-surface-0 ring-1 ring-inset ring-line">
          {plan.map((p) => {
            const from = byId.get(p.id)!
            return (
              <div key={p.id} className="flex h-row items-center gap-2 border-b border-line-subtle px-3 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-fg-primary">{names.get(p.id)}</span>
                <span className="font-mono text-xs tabular text-fg-tertiary">{formatAddressRange(from.universe, from.address, from.count)}</span>
                <LuArrowRight size={12} aria-hidden className="shrink-0 text-fg-tertiary" />
                <span className={p.overflow || p.conflict ? 'font-mono text-xs tabular text-danger-fg' : 'font-mono text-xs tabular text-fg-primary'}>
                  {p.overflow ? t('patch.address.doesNotFit') : formatAddressRange(p.universe, p.address, from.count)}
                </span>
              </div>
            )
          })}
        </div>

        {conflicts.length > 0 && (
          <Notice
            tone="danger"
            title={conflicts.length === 1 ? t('patch.address.overlapOne') : t('patch.address.overlapMany', { count: conflicts.length })}
            action={!avoid ? <Button size="sm" variant="secondary" onClick={() => setAvoid(true)}>{t('patch.shared.shiftToFree')}</Button> : undefined}
          >
            {conflictNames.length > 0 && <>{t('patch.shared.alreadyUse', { names: shownNames, count: conflictNames.length })} </>}
            {t('patch.address.sameValues')}
          </Notice>
        )}
        {overflow.length > 0 && (
          <Notice tone="danger" title={t('patch.shared.overflowTitle', { count: overflow.length, max: UNIVERSE_SIZE })}>
            {t('patch.address.lowerStart')}
          </Notice>
        )}
      </div>
    </Modal>
  )
}
