// ============================================================
// Inspector panels for the room (nothing selected) and a truss bar.
// ============================================================

import { useMemo } from 'react'
import { LuAlignHorizontalSpaceAround, LuListChecks, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import type { TrussBar } from '@shared/types'
import {
  Button, ColorSwatch, Field, IconButton, ListItem, NumberField, SWATCH_COLORS, Section, TextInput, palette
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { cm } from '../scene/layout-math'
import { deleteBar, fixturesOnBar, hangOnBar } from './rig-actions'

/** Room dimensions + stage edge (compact block, also used in the 3D room popover) */
export function RoomFields() {
  const room = useVisualizerStore((s) => s.roomConfig)
  const set = useVisualizerStore.getState().setRoomConfig
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <NumberField label="W" aria-label="Room width (metres)" value={room.width} onChange={(v) => set({ width: v })} min={2} max={100} step={0.5} precision={1} size="sm" />
        <NumberField label="D" aria-label="Room depth (metres)" value={room.depth} onChange={(v) => set({ depth: v })} min={2} max={100} step={0.5} precision={1} size="sm" />
        <NumberField label="H" aria-label="Room height (metres)" value={room.height} onChange={(v) => set({ height: v })} min={2} max={40} step={0.5} precision={1} size="sm" />
      </div>
      <Field label="Stage edge" hint="Depth of the downstage edge (0 = centre)">
        <NumberField
          aria-label="Stage edge depth (metres)"
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
  return (
    <div className="flex min-h-0 flex-col">
      <Section title="Room (metres)">
        <RoomFields />
      </Section>
      <Section
        title={`Truss bars · ${bars.length}`}
        actions={<Button size="xs" variant="ghost" icon={LuPlus} onClick={() => useVisualizerStore.getState().addTrussBar()}>Add</Button>}
      >
        {sorted.length === 0 ? (
          <p className="text-xs text-fg-tertiary">No bars yet. Add one, then hang fixtures on it from their inspector or by long-pressing them.</p>
        ) : (
          <div role="listbox" aria-label="Truss bars" className="-mx-1.5 flex flex-col">
            {sorted.map((bar) => (
              <ListItem
                key={bar.id}
                title={bar.name}
                subtitle={`${fixturesOnBar(bar, patch).length} fixtures · ${bar.width.toFixed(1)} m`}
                leading={<span aria-hidden className="h-3 w-3 rounded-sm" style={{ backgroundColor: bar.color ?? palette.fgDisabled }} />}
                trailing={<span className="font-mono text-2xs tabular text-fg-tertiary">Z {bar.z.toFixed(2)}</span>}
                onSelect={() => useVisualizerStore.getState().selectTruss(bar.id)}
              />
            ))}
          </div>
        )}
      </Section>
      <p className="px-3 py-3 text-xs text-fg-tertiary">
        Select a fixture or a bar on the plan to edit it. Drag empty space to pan, pinch or scroll to zoom.
      </p>
    </div>
  )
}

export function TrussPropertiesPanel({ bar }: { bar: TrussBar }) {
  const patch = usePatchStore((s) => s.patch)
  const room = useVisualizerStore((s) => s.roomConfig)
  const onBar = useMemo(() => fixturesOnBar(bar, patch), [bar, patch])
  const update = (u: Partial<TrussBar>) => useVisualizerStore.getState().updateTrussBar(bar.id, u)

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
        <IconButton icon={LuX} label="Deselect bar" size="sm" onClick={() => useVisualizerStore.getState().selectTruss(null)} />
      </header>
      <Section title="Bar">
        <Field label="Name">
          {(id) => <TextInput id={id} size="sm" value={bar.name} onChange={(e) => update({ name: e.target.value })} />}
        </Field>
        <Field label="Depth (Z)">
          <NumberField aria-label="Bar depth (metres)" value={bar.z} onChange={(z) => moveBar({ z })} min={-room.depth / 2} max={room.depth / 2} step={0.05} precision={2} unit="m" size="sm" />
        </Field>
        <Field label="Height">
          <NumberField aria-label="Bar height (metres)" value={bar.y} onChange={(y) => moveBar({ y })} min={0.5} max={room.height} step={0.05} precision={2} unit="m" size="sm" />
        </Field>
        <Field label="Length">
          <NumberField aria-label="Bar length (metres)" value={bar.width} onChange={(width) => update({ width })} min={0.5} max={room.width * 2} step={0.5} precision={1} unit="m" size="sm" />
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-1">
            {SWATCH_COLORS.slice(0, 8).map((c) => (
              <ColorSwatch key={c} color={c} size="sm" label={c} selected={bar.color?.toLowerCase() === c.toLowerCase()} onClick={() => update({ color: bar.color === c ? undefined : c })} />
            ))}
          </div>
        </Field>
      </Section>
      <Section title={`Fixtures on this bar · ${onBar.length}`}>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon={LuListChecks} disabled={onBar.length === 0} onClick={() => usePatchStore.getState().selectFixtures(onBar.map((e) => e.id))}>
            Select
          </Button>
          <Button size="sm" icon={LuAlignHorizontalSpaceAround} disabled={onBar.length < 2} onClick={() => hangOnBar(onBar.map((e) => e.id), bar)}>
            Spread
          </Button>
        </div>
        <p className="text-2xs text-fg-tertiary">Long-press a fixture on the plan to hang it here.</p>
      </Section>
      <div className="px-3 py-3">
        <Button size="sm" variant="danger-outline" icon={LuTrash2} fullWidth onClick={() => void deleteBar(bar)}>
          Delete bar
        </Button>
      </div>
    </div>
  )
}
