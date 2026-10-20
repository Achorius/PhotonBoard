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
import { useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { barForFixture, describeFixture, fixturePosition } from '../scene/layout-math'
import { flipFixtures, formatMetres, hangOnBar, mountOptions, resetPlacement, setMount, setPosition } from './rig-actions'

export function FixturePropertiesPanel({ onClose }: { onClose?: () => void }) {
  const selectedId = useVisualizerStore((s) => s.selectedFixtureId)
  const room = useVisualizerStore((s) => s.roomConfig)
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const t = useT()

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
  const tiltHint = t(wall ? 'layout.fixture.tiltHintWall' : mount === 'floor' ? 'layout.fixture.tiltHintFloor' : 'layout.fixture.tiltHintCeiling')
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
            {def ? def.name : t('layout.fixture.unknownType')} · <span className="font-mono tabular">{formatAddress(entry.universe, entry.address)}</span>
          </p>
        </div>
        {onClose && <IconButton icon={LuX} label={t('layout.fixture.closeInspector')} size="sm" onClick={onClose} />}
      </header>

      <Section title={t('layout.fixture.position')}>
        <div className="grid grid-cols-3 gap-1.5">
          <NumberField label="X" aria-label={t('layout.fixture.xAria')} value={pos.x} onChange={(x) => setPosition(entry, { x })} min={-half.w - 2} max={half.w + 2} step={0.05} precision={2} size="sm" />
          <NumberField label="Y" aria-label={t('layout.fixture.yAria')} value={pos.y} onChange={(y) => setPosition(entry, { y })} min={0} max={room.height + 2} step={0.05} precision={2} size="sm" />
          <NumberField label="Z" aria-label={t('layout.fixture.zAria')} value={pos.z} onChange={(z) => setPosition(entry, { z })} min={-half.d - 2} max={half.d + 2} step={0.05} precision={2} size="sm" />
        </div>
        <p className="text-2xs text-fg-tertiary">{t('layout.fixture.positionHint')}</p>
      </Section>

      <Section title={t('layout.fixture.rigging')}>
        <Field label={t('layout.fixture.mount')}>
          {(id) => (
            <Select id={id} size="sm" value={mount} options={mountOptions(t)} onChange={(m) => setMount([entry.id], m)} />
          )}
        </Field>
        <Field label={t('layout.fixture.trussBar')} hint={room.trussBars.length === 0 ? t('layout.fixture.addBarHint') : undefined}>
          {(id) => (
            <Select
              id={id}
              size="sm"
              value={bar?.id ?? ''}
              disabled={room.trussBars.length === 0}
              options={[{ value: '', label: t('layout.fixture.notOnBar'), disabled: !!bar }, ...room.trussBars.map((b) => ({ value: b.id, label: t('layout.fixture.barOption', { name: b.name, height: formatMetres(b.y, 2, t) }) }))]}
              onChange={(v) => {
                const target = room.trussBars.find((b) => b.id === v)
                if (target) hangOnBar([entry.id], target)
              }}
            />
          )}
        </Field>
      </Section>

      <Section title={t(spec.kind === 'moving-head' ? 'layout.fixture.mountingRotation' : 'layout.fixture.aim')}>
        <Field label={t('layout.fixture.tilt')} hint={tiltHint}>
          <NumberField aria-label={t('layout.fixture.tiltAria')} value={entry.mountingAngle ?? 0} onChange={(v) => update({ mountingAngle: v, rotation3D: undefined })} min={-90} max={90} step={1} unit="°" size="sm" />
        </Field>
        <Field label={t('layout.fixture.direction')} hint={t('layout.fixture.directionHint')}>
          <div className="flex items-center gap-1.5">
            <NumberField aria-label={t('layout.fixture.directionAria')} value={entry.mountingPan ?? 0} onChange={(v) => update({ mountingPan: v, rotation3D: undefined })} min={-180} max={180} step={1} unit="°" size="sm" className="min-w-0 flex-1" />
            <IconButton icon={LuFlipHorizontal2} label={t('layout.actions.flip')} size="sm" variant="secondary" onClick={() => flipFixtures([entry.id])} />
          </div>
        </Field>
        {spec.kind === 'moving-head' && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
            <Checkbox checked={entry.panInvert ?? false} onChange={(v) => update({ panInvert: v })} label={t('layout.fixture.invertPan')} />
            <Checkbox checked={entry.tiltInvert ?? false} onChange={(v) => update({ tiltInvert: v })} label={t('layout.fixture.invertTilt')} />
          </div>
        )}
      </Section>

      {spec.emits && (
        <Section title={t('layout.fixture.optics')}>
          <Field label={t('layout.fixture.beamAngle')} hint={entry.beamAngle === undefined ? t('layout.fixture.beamAngleHint') : undefined}>
            <div className="flex items-center gap-1.5">
              <NumberField aria-label={t('layout.fixture.beamAngleAria')} value={spec.beamAngle} onChange={(v) => update({ beamAngle: v })} min={1} max={120} step={1} unit="°" size="sm" className="min-w-0 flex-1" />
              {entry.beamAngle !== undefined && (
                <IconButton icon={LuRotateCcw} label={t('layout.fixture.useDefinitionBeam')} size="sm" onClick={() => update({ beamAngle: undefined })} />
              )}
            </div>
          </Field>
          {hasPixels && (
            <Checkbox checked={entry.pixelInvert ?? false} onChange={(v) => update({ pixelInvert: v })} label={t('layout.fixture.reversePixels')} />
          )}
        </Section>
      )}

      <div className="px-3 py-3">
        <Button
          size="sm"
          variant="danger-outline"
          icon={LuRotateCcw}
          fullWidth
          tooltip={t('layout.actions.resetHint')}
          shortcut="Delete"
          onClick={() => void resetPlacement([entry.id])}
        >
          {t('layout.actions.resetPlacement')}
        </Button>
      </div>
    </div>
  )
}
