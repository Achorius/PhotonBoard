// ============================================================
// Inspector panels for the room (nothing selected) and a truss bar.
// ============================================================

import { useMemo } from 'react'
import { LuAlignHorizontalSpaceAround, LuCopy, LuListChecks, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import type { TrussBar } from '@shared/types'
import {
  Button, ColorSwatch, Field, IconButton, ListItem, NumberField, SWATCH_COLORS, Section, TextInput, palette
} from '@renderer/components/ui'
import { formatDecimal, useT } from '@renderer/i18n'
import { historyStep } from '@renderer/lib/history'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { cm } from '../scene/layout-math'
import { barLabel, deleteBar, duplicateBar, fixturesOnBar, formatMetres, hangOnBar } from './rig-actions'

/** Room dimensions + stage edge (compact block, also used in the 3D room popover) */
export function RoomFields() {
  const room = useVisualizerStore((s) => s.roomConfig)
  const set = useVisualizerStore.getState().setRoomConfig
  const t = useT()
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <NumberField label={t('layout.room.widthShort')} aria-label={t('layout.room.widthAria')} value={room.width} onChange={(v) => set({ width: v })} min={2} max={100} step={0.5} precision={1} size="sm" />
        <NumberField label={t('layout.room.depthShort')} aria-label={t('layout.room.depthAria')} value={room.depth} onChange={(v) => set({ depth: v })} min={2} max={100} step={0.5} precision={1} size="sm" />
        <NumberField label={t('layout.room.heightShort')} aria-label={t('layout.room.heightAria')} value={room.height} onChange={(v) => set({ height: v })} min={2} max={40} step={0.5} precision={1} size="sm" />
      </div>
      <Field label={t('layout.room.stageEdge')} hint={t('layout.room.stageEdgeHint')}>
        <NumberField
          aria-label={t('layout.room.stageEdgeAria')}
          value={room.stageEdgeZ ?? 0}
          onChange={(v) => set({ stageEdgeZ: v })}
          min={-room.depth / 2}
          max={room.depth / 2}
          step={0.25}
          precision={2}
          unit="m"
          size="sm"
        />
      </Field>
    </>
  )
}

export function RoomPropertiesPanel() {
  const bars = useVisualizerStore((s) => s.roomConfig.trussBars)
  const patch = usePatchStore((s) => s.patch)
  const sorted = useMemo(() => [...bars].sort((a, b) => a.z - b.z), [bars])
  const t = useT()
  return (
    <div className="flex min-h-0 flex-col">
      <Section title={t('layout.room.title')}>
        <RoomFields />
      </Section>
      <Section
        title={t('layout.room.bars', { count: bars.length })}
        actions={<Button size="xs" variant="ghost" icon={LuPlus} onClick={() => useVisualizerStore.getState().addTrussBar()}>{t('common.add')}</Button>}
      >
        {sorted.length === 0 ? (
          <p className="text-xs text-fg-tertiary">{t('layout.room.noBars')}</p>
        ) : (
          <div role="listbox" aria-label={t('layout.room.barsList')} className="-mx-1.5 flex flex-col">
            {sorted.map((bar) => (
              <ListItem
                key={bar.id}
                title={bar.name}
                subtitle={t('layout.room.barSubtitle', { count: fixturesOnBar(bar, patch).length, length: formatMetres(bar.width, 1, t) })}
                leading={<span aria-hidden className="h-3 w-3 rounded-sm" style={{ backgroundColor: bar.color ?? palette.fgDisabled }} />}
                trailing={<span className="font-mono text-2xs tabular text-fg-tertiary">{t('layout.room.barDepth', { value: formatDecimal(bar.z, 2, t.locale) })}</span>}
                onSelect={() => useVisualizerStore.getState().selectTruss(bar.id)}
              />
            ))}
          </div>
        )}
      </Section>
      <p className="px-3 py-3 text-xs text-fg-tertiary">
        {t('layout.room.help')}
      </p>
    </div>
  )
}

export function TrussPropertiesPanel({ bar }: { bar: TrussBar }) {
  const patch = usePatchStore((s) => s.patch)
  const room = useVisualizerStore((s) => s.roomConfig)
  const onBar = useMemo(() => fixturesOnBar(bar, patch), [bar, patch])
  const update = (u: Partial<TrussBar>) => useVisualizerStore.getState().updateTrussBar(bar.id, u)
  const t = useT()

  // Moving a bar takes the fixtures hung on it along
  const moveBar = (u: Partial<Pick<TrussBar, 'z' | 'y'>>) => {
    const dz = u.z !== undefined ? u.z - bar.z : 0
    const dy = u.y !== undefined ? u.y - bar.y : 0
    update(u)
    const store = usePatchStore.getState()
    for (const e of onBar) {
      if (!e.position3D) continue
      store.updateFixture(e.id, { position3D: { x: e.position3D.x, y: cm(e.position3D.y + dy), z: cm(e.position3D.z + dz) } })
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: bar.color ?? palette.fgDisabled }} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-primary">{bar.name}</h3>
        <IconButton icon={LuCopy} label={t('layout.bar.duplicate')} shortcut="Mod+D" size="sm" onClick={() => { historyStep(t('shell.editMenu.duplicateWhat', { what: barLabel(bar) }), () => duplicateBar(bar)) }} />
        <IconButton icon={LuTrash2} label={t('layout.bar.delete')} shortcut="Delete" size="sm" className="hover:text-danger-fg" onClick={() => void deleteBar(bar)} />
        <IconButton icon={LuX} label={t('layout.bar.deselect')} size="sm" onClick={() => useVisualizerStore.getState().selectTruss(null)} />
      </header>
      <Section title={t('layout.bar.section')}>
        <Field label={t('layout.bar.name')}>
          {(id) => <TextInput id={id} size="sm" value={bar.name} onChange={(e) => update({ name: e.target.value })} />}
        </Field>
        <Field label={t('layout.bar.depth')}>
          <NumberField aria-label={t('layout.bar.depthAria')} value={bar.z} onChange={(z) => moveBar({ z })} min={-room.depth / 2} max={room.depth / 2} step={0.05} precision={2} unit="m" size="sm" />
        </Field>
        <Field label={t('layout.bar.height')}>
          <NumberField aria-label={t('layout.bar.heightAria')} value={bar.y} onChange={(y) => moveBar({ y })} min={0.5} max={room.height} step={0.05} precision={2} unit="m" size="sm" />
        </Field>
        <Field label={t('layout.bar.length')}>
          <NumberField aria-label={t('layout.bar.lengthAria')} value={bar.width} onChange={(width) => update({ width })} min={0.5} max={room.width * 2} step={0.5} precision={1} unit="m" size="sm" />
        </Field>
        <Field label={t('layout.bar.colour')}>
          <div className="flex flex-wrap gap-1">
            {SWATCH_COLORS.slice(0, 8).map((c) => (
              <ColorSwatch key={c} color={c} size="sm" label={c} selected={bar.color?.toLowerCase() === c.toLowerCase()} onClick={() => update({ color: bar.color === c ? undefined : c })} />
            ))}
          </div>
        </Field>
      </Section>
      <Section title={t('layout.bar.fixturesOnBar', { count: onBar.length })}>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon={LuListChecks} disabled={onBar.length === 0} onClick={() => usePatchStore.getState().selectFixtures(onBar.map((e) => e.id))}>
            {t('layout.bar.select')}
          </Button>
          <Button size="sm" icon={LuAlignHorizontalSpaceAround} disabled={onBar.length < 2} onClick={() => hangOnBar(onBar.map((e) => e.id), bar)}>
            {t('layout.bar.spread')}
          </Button>
        </div>
        <p className="text-2xs text-fg-tertiary">{t('layout.bar.longPressHint')}</p>
      </Section>
      <div className="px-3 py-3">
        <Button size="sm" variant="danger-outline" icon={LuTrash2} fullWidth onClick={() => void deleteBar(bar)}>
          {t('layout.bar.delete')}
        </Button>
      </div>
    </div>
  )
}
