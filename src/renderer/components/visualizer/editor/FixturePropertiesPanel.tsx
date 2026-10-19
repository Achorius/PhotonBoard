// ============================================================
// Fixture inspector (layout + 3D): position in metres, rigging (mount,
// truss bar), aim, optics. Every field is a NumberField: type, scrub
// with a finger, or step with the arrow keys.
// ============================================================

import { useMemo } from 'react'
import { LuFlipHorizontal2, LuRotateCcw, LuX } from 'react-icons/lu'
import type { MountingLocation, PatchEntry } from '@shared/types'
import {
  Badge, Button, Checkbox, Field, IconButton, NumberField, Section, Select, fixtureCategoryIcon, formatAddress
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { barForFixture, describeFixture, fixturePosition } from '../scene/layout-math'
import { MOUNT_OPTIONS, flipFixtures, hangOnBar, resetPlacement, setMount, setPosition } from './rig-actions'

export function FixturePropertiesPanel({ onClose }: { onClose?: () => void }) {
  const selectedId = useVisualizerStore((s) => s.selectedFixtureId)
  const room = useVisualizerStore((s) => s.roomConfig)
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)

  const index = useMemo(() => patch.findIndex((p) => p.id === selectedId), [patch, selectedId])
  const entry: PatchEntry | undefined = patch[index]
  const def = useMemo(() => (entry ? fixtures.find((f) => f.id === entry.fixtureDefId) : undefined), [entry, fixtures])
  if (!entry) return null

  const spec = describeFixture(entry, def)
  const pos = fixturePosition(entry, index, patch.length, room)
  const mount: MountingLocation = entry.mountingLocation ?? 'ceiling'
  const bar = barForFixture(pos, entry.mountingLocation, room.trussBars)
  const Icon = fixtureCategoryIcon(def?.categories)
  const update = (u: Partial<PatchEntry>) => usePatchStore.getState().updateFixture(entry.id, u)
  const hasPixels = !!def?.modes.find((m) => m.name === entry.modeName)?.pixelLayout
  const wall = mount.startsWith('wall')
  const tiltHint = wall ? '0° horizontal, + aims down' : mount === 'floor' ? '0° straight up, + leans upstage' : '0° straight down, + leans upstage'
  const half = { w: room.width / 2, d: room.depth / 2 }

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-start gap-2.5 border-b border-line-subtle px-3 py-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary">
          <Icon size={16} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Badge size="xs" mono>{index + 1}</Badge>
            <h3 className="truncate text-sm font-semibold text-fg-primary">{entry.name}</h3>
          </div>
          <p className="truncate text-xs text-fg-tertiary">
            {def ? def.name : 'Unknown type'} · <span className="font-mono tabular">{formatAddress(entry.universe, entry.address)}</span>
          </p>
        </div>
        {onClose && <IconButton icon={LuX} label="Close inspector" size="sm" onClick={onClose} />}
      </header>

      <Section title="Position">
        <div className="grid grid-cols-3 gap-1.5">
          <NumberField label="X" aria-label="X position (metres)" value={pos.x} onChange={(x) => setPosition(entry, { x })} min={-half.w - 2} max={half.w + 2} step={0.05} precision={2} size="sm" />
          <NumberField label="Y" aria-label="Height (metres)" value={pos.y} onChange={(y) => setPosition(entry, { y })} min={0} max={room.height + 2} step={0.05} precision={2} size="sm" />
          <NumberField label="Z" aria-label="Depth (metres)" value={pos.z} onChange={(z) => setPosition(entry, { z })} min={-half.d - 2} max={half.d + 2} step={0.05} precision={2} size="sm" />
        </div>
        <p className="text-2xs text-fg-tertiary">Metres from centre stage · X stage right + · Y height · Z upstage +</p>
      </Section>

      <Section title="Rigging">
        <Field label="Mount">
          {(id) => (
            <Select id={id} size="sm" value={mount} options={MOUNT_OPTIONS} onChange={(m) => setMount([entry.id], m)} />
          )}
        </Field>
        <Field label="Truss bar" hint={room.trussBars.length === 0 ? 'Add a bar in the stage layout.' : undefined}>
          {(id) => (
            <Select
              id={id}
              size="sm"
              value={bar?.id ?? ''}
              disabled={room.trussBars.length === 0}
              options={[{ value: '', label: 'Not on a bar', disabled: !!bar }, ...room.trussBars.map((b) => ({ value: b.id, label: `${b.name} · ${b.y.toFixed(2)} m` }))]}
              onChange={(v) => {
                const target = room.trussBars.find((b) => b.id === v)
                if (target) hangOnBar([entry.id], target)
              }}
            />
          )}
        </Field>
      </Section>

      <Section title={spec.kind === 'moving-head' ? 'Mounting rotation' : 'Aim'}>
        <Field label="Tilt" hint={tiltHint}>
          <NumberField aria-label="Tilt (degrees)" value={entry.mountingAngle ?? 0} onChange={(v) => update({ mountingAngle: v, rotation3D: undefined })} min={-90} max={90} step={1} unit="°" size="sm" />
        </Field>
        <Field label="Direction" hint="Rotation around the vertical axis">
          <div className="flex items-center gap-1.5">
            <NumberField aria-label="Direction (degrees)" value={entry.mountingPan ?? 0} onChange={(v) => update({ mountingPan: v, rotation3D: undefined })} min={-180} max={180} step={1} unit="°" size="sm" className="min-w-0 flex-1" />
            <IconButton icon={LuFlipHorizontal2} label="Flip 180°" size="sm" variant="secondary" onClick={() => flipFixtures([entry.id])} />
          </div>
        </Field>
        {spec.kind === 'moving-head' && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
            <Checkbox checked={entry.panInvert ?? false} onChange={(v) => update({ panInvert: v })} label="Invert pan" />
            <Checkbox checked={entry.tiltInvert ?? false} onChange={(v) => update({ tiltInvert: v })} label="Invert tilt" />
          </div>
        )}
      </Section>

      {spec.emits && (
        <Section title="Optics">
          <Field label="Beam angle" hint={entry.beamAngle === undefined ? 'From the fixture definition' : undefined}>
            <div className="flex items-center gap-1.5">
              <NumberField aria-label="Beam angle (degrees)" value={spec.beamAngle} onChange={(v) => update({ beamAngle: v })} min={1} max={120} step={1} unit="°" size="sm" className="min-w-0 flex-1" />
              {entry.beamAngle !== undefined && (
                <IconButton icon={LuRotateCcw} label="Use the definition's beam angle" size="sm" onClick={() => update({ beamAngle: undefined })} />
              )}
            </div>
          </Field>
          {hasPixels && (
            <Checkbox checked={entry.pixelInvert ?? false} onChange={(v) => update({ pixelInvert: v })} label="Reverse pixel order" />
          )}
        </Section>
      )}

      <div className="px-3 py-3">
        <Button size="sm" variant="danger-outline" icon={LuRotateCcw} fullWidth onClick={() => void resetPlacement([entry.id])}>
          Reset placement
        </Button>
      </div>
    </div>
  )
}
