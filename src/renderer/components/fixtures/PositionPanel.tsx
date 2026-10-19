// Position: pan / tilt XY pad (16-bit when the fixtures have fine
// channels), the other selected fixtures as markers, numeric entry,
// fine mode, centre (home), flip and release.

import { memo, useMemo } from 'react'
import { LuCrosshair, LuEraser, LuFlipHorizontal2, LuMove } from 'react-icons/lu'
import type { FixtureDefinition, PatchEntry } from '@shared/types'
import { Badge, Button, Encoder, NumberField, ToggleButton, cn } from '@renderer/components/ui'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { XYPad } from '../common/XYPad'
import { readAttrNow, releaseAttrs, setAttr, useAnyTouched, useAttrSummary, useAttrTouched } from './attr-actions'
import { summarize, type Attribute, type ProgrammerModel } from './programmer-model'
import { formatAttrValue, useProgrammerView, type ValueUnit } from './programmer-view-store'
import { AttributeFaderBank } from './AttributeFader'

export interface PositionPanelProps {
  model: ProgrammerModel
  defs: Map<string, FixtureDefinition>
  firstName: string
}

export const PositionPanel = memo(function PositionPanel({ model, defs, firstName }: PositionPanelProps) {
  const attrs = model.byFeature.position
  const pan = model.byKey.get('pan')
  const tilt = model.byKey.get('tilt')
  const others = attrs.filter((a) => a !== pan && a !== tilt)
  const anyTouched = useAnyTouched(attrs)
  const fine = useProgrammerView((s) => s.fineXY)
  const count = model.entries.length

  const centre = () => {
    if (pan) setAttr(pan, pan.fine ? 32768 : 128)
    if (tilt) setAttr(tilt, tilt.fine ? 32768 : 128)
  }
  const flip = () => flipPosition(model.entries, defs, pan, tilt)

  return (
    <div className="flex min-h-0 flex-1 gap-4 p-3">
      {pan || tilt ? (
        <PadArea pan={pan} tilt={tilt} entries={model.entries} fine={fine} />
      ) : null}
      <div className="flex w-[260px] shrink-0 flex-col gap-3 [[data-density=touch]_&]:w-[300px]">
        {pan && <AxisField attr={pan} label="Pan" />}
        {tilt && <AxisField attr={tilt} label="Tilt" />}
        <div className="grid grid-cols-2 gap-1.5">
          <ToggleButton
            pressed={fine}
            onPressedChange={(v) => useProgrammerView.getState().setFineXY(v)}
            icon={LuMove}
            tone="accent"
            size="sm"
            tooltip="Fine: the pad moves at a tenth of the speed (relative drag)"
          >
            Fine
          </ToggleButton>
          <Button size="sm" icon={LuCrosshair} onClick={centre} tooltip="Centre pan and tilt (home)">Centre</Button>
          <Button size="sm" icon={LuFlipHorizontal2} onClick={flip} disabled={!pan || !tilt} tooltip="Same beam position from the other side (pan ±180°, tilt mirrored)">
            Flip
          </Button>
          <Button size="sm" icon={LuEraser} onClick={() => releaseAttrs(attrs)} disabled={!anyTouched} tooltip="Release pan / tilt from the programmer">
            Release
          </Button>
        </div>
        {(pan || tilt) && (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-1 p-2.5 ring-1 ring-inset ring-line-subtle">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Fine adjust</span>
            <div className="flex items-start justify-around">
              {pan && <AxisEncoder attr={pan} label="Pan" />}
              {tilt && <AxisEncoder attr={tilt} label="Tilt" />}
            </div>
            {(pan?.fine || tilt?.fine) && <p className="text-2xs text-fg-tertiary">16-bit: coarse and fine channels move together.</p>}
          </div>
        )}
        {others.length > 0 && (
          <div className="flex min-h-[180px] flex-1 flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">More</span>
            <AttributeFaderBank attrs={others} selectionCount={count} firstName={firstName} className="flex-1" />
          </div>
        )}
      </div>
    </div>
  )
})

/** The pad; re-renders with the positions of the selected fixtures only */
function PadArea({ pan, tilt, entries, fine }: { pan?: Attribute; tilt?: Attribute; entries: PatchEntry[]; fine: boolean }) {
  const max = pan?.fine || tilt?.fine ? 65535 : 255
  const ids = useMemo(() => entries.map((e) => e.id), [entries])
  // "x,y;x,y;…" for every selected fixture (first = reference)
  const key = useDmxStore((s) => ids.map((id) => {
    const x = pan ? scale(summarize(s.values, pan, id).first, pan.max, max) : max / 2
    const y = tilt ? scale(summarize(s.values, tilt, id).first, tilt.max, max) : max / 2
    return `${x},${y}`
  }).join(';'))
  const points = key.split(';').map((p) => p.split(',').map(Number) as [number, number])
  const [first = [max / 2, max / 2], ...rest] = points
  const panTouched = useAttrTouched(pan?.targets ?? [])
  const tiltTouched = useAttrTouched(tilt?.targets ?? [])
  const touched = panTouched !== 'none' || tiltTouched !== 'none'

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col items-center gap-2 rounded-lg p-2 ring-1 ring-inset', touched ? 'ring-accent/40' : 'ring-transparent')}>
      <XYPad
        fill
        x={first[0]}
        y={first[1]}
        max={max}
        fine={fine}
        markers={rest.map(([x, y]) => ({ x, y }))}
        readout={false}
        label={entries.length > 1 ? `Pan / Tilt · ${entries.length} fixtures` : 'Pan / Tilt'}
        onChange={(x, y) => {
          if (pan) setAttr(pan, scale(x, max, pan.max))
          if (tilt) setAttr(tilt, scale(y, max, tilt.max))
        }}
      />
    </div>
  )
}

function scale(v: number, from: number, to: number): number {
  return from === to ? v : Math.round((v / from) * to)
}

/** Knob for slow, precise moves (a full turn ≈ a quarter of the range) */
function AxisEncoder({ attr, label }: { attr: Attribute; label: string }) {
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr)
  return (
    <Encoder
      value={sum.first}
      onChange={(v) => setAttr(attr, v)}
      max={attr.max}
      defaultValue={attr.fine ? 32768 : 128}
      sensitivity={attr.fine ? 2400 : 1200}
      size={56}
      color={attr.color}
      label={label}
      format={(v) => formatAttrValue(v, attr.max, unit, true)}
      aria-label={`${label} fine adjust`}
    />
  )
}

/** Numeric pan / tilt entry in % or DMX (coarse.fraction for 16-bit) */
function AxisField({ attr, label }: { attr: Attribute; label: string }) {
  const unit = useProgrammerView((s) => s.unit)
  const sum = useAttrSummary(attr)
  const touched = useAttrTouched(attr.targets)
  const { value, max, step } = toField(sum.first, attr, unit)
  return (
    <div className="flex items-center gap-2">
      <NumberField
        label={label}
        value={value}
        min={0}
        max={max}
        step={step}
        unit={unit === 'percent' ? '%' : undefined}
        onChange={(v) => setAttr(attr, fromField(v, attr, unit))}
        className={cn('flex-1', touched !== 'none' && '[&_input]:text-accent-fg')}
        aria-label={`${label} value`}
      />
      {sum.min !== sum.max && <Badge size="xs" tone="warning" title="The selected fixtures have different values">Mixed</Badge>}
    </div>
  )
}

function toField(v: number, attr: Attribute, unit: ValueUnit): { value: number; max: number; step: number } {
  if (unit === 'percent') {
    return { value: Math.round((v / attr.max) * (attr.fine ? 1000 : 100)) / (attr.fine ? 10 : 1), max: 100, step: attr.fine ? 0.1 : 1 }
  }
  return attr.fine ? { value: Math.floor((v / 256) * 100) / 100, max: 255.99, step: 0.01 } : { value: v, max: 255, step: 1 }
}

function fromField(v: number, attr: Attribute, unit: ValueUnit): number {
  if (unit === 'percent') return Math.round((v / 100) * attr.max)
  return attr.fine ? Math.round(v * 256) : Math.round(v)
}

/**
 * Flip: reach the same beam position from the other side — pan moves by
 * 180° (of the fixture's pan range, 540° by default), tilt mirrors around
 * its centre. Per fixture.
 */
function flipPosition(entries: PatchEntry[], defs: Map<string, FixtureDefinition>, pan?: Attribute, tilt?: Attribute): void {
  if (!pan || !tilt) return
  for (const e of entries) {
    const range = defs.get(e.fixtureDefId)?.physical?.panRange || 540
    const p = readAttrNow(pan, e.id).first / pan.max
    const t = readAttrNow(tilt, e.id).first / tilt.max
    const half = 180 / range
    const np = p + half <= 1 ? p + half : p - half >= 0 ? p - half : p
    setAttr(pan, Math.round(np * pan.max), e.id)
    setAttr(tilt, Math.round((1 - t) * tilt.max), e.id)
  }
}
