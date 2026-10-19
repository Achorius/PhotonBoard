// Colour: hue/saturation wheel + brightness, colour presets, colour
// wheel slots (swatches named by the fixture definition), and the
// emitter / CMY / CTO faders. One colour is translated per fixture to
// what it can do: RGB(W), CMY, or the nearest colour-wheel slot.

import { memo, useMemo, useRef } from 'react'
import { LuEraser } from 'react-icons/lu'
import { Button, Slider, cn } from '@renderer/components/ui'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { releaseAttrs, setAttrDmx, useAnyTouched } from './attr-actions'
import { ColourWheel } from './ColourWheel'
import { hsvToRgb, rgbToHsv, type Rgb } from './colour-math'
import { colourWrites, nearestSlot, rangeValue, summarize, type ProgrammerModel } from './programmer-model'
import { AttributeFaderBank } from './AttributeFader'
import { RangeCard } from './RangeCard'

interface Preset {
  name: string
  rgb: Rgb
  /** Emitters used instead when the fixture has them */
  extra?: Partial<Record<string, number>>
}

/** Colour presets (content colours sent to the fixtures) */
export const COLOUR_PRESETS: Preset[] = [
  { name: 'White', rgb: [255, 255, 255] },
  { name: 'Warm white', rgb: [255, 196, 130] },
  { name: 'Cool white', rgb: [200, 225, 255] },
  { name: 'Red', rgb: [255, 0, 0] },
  { name: 'Orange', rgb: [255, 100, 0] },
  { name: 'Amber', rgb: [255, 150, 0], extra: { amber: 255 } },
  { name: 'Yellow', rgb: [255, 230, 0] },
  { name: 'Lime', rgb: [160, 255, 0], extra: { lime: 255 } },
  { name: 'Green', rgb: [0, 255, 0] },
  { name: 'Cyan', rgb: [0, 255, 255] },
  { name: 'Light blue', rgb: [60, 160, 255] },
  { name: 'Blue', rgb: [0, 0, 255] },
  { name: 'Congo', rgb: [70, 0, 255] },
  { name: 'UV', rgb: [90, 0, 200], extra: { uv: 255 } },
  { name: 'Magenta', rgb: [255, 0, 255] },
  { name: 'Pink', rgb: [255, 80, 160] }
]

/** Colour a fixture is making, from its emitters / CMY / wheel slot (null if none) */
function fixtureRgb(values: number[][], model: ProgrammerModel, fixtureId: string): Rgb | null {
  const keys = model.fixtureKeys.get(fixtureId)
  if (!keys) return null
  const v = (k: string): number => {
    const a = model.byKey.get(k) ?? model.byKey.get(`${k} cells`)
    if (!a || !(keys.has(k) || keys.has(`${k} cells`))) return 0
    const s = summarize(values, a, fixtureId)
    return a.fine ? s.first / 257 : s.first
  }
  if (keys.has('red') || keys.has('red cells')) {
    const w = v('white')
    const a = v('amber')
    // Additive mix, scaled back into range (keeps the hue when emitters add up past full)
    const lime = v('lime')
    const uv = v('uv')
    const mix = [v('red') + w + a, v('green') + w + a * 0.75 + lime, v('blue') + w + uv * 0.6]
    const peak = Math.max(255, ...mix)
    return mix.map((c) => Math.round((c / peak) * 255)) as Rgb
  }
  if (keys.has('cyan') || keys.has('magenta') || keys.has('yellow')) return [255 - v('cyan'), 255 - v('magenta'), 255 - v('yellow')].map(Math.round) as Rgb
  const wheel = model.byKey.get('color wheel')
  if (wheel && keys.has('color wheel')) {
    const dmx = Math.round(v('color wheel'))
    const slot = wheel.ranges.find((r) => r.swatch && dmx >= r.from && dmx <= r.to)
    const m = slot?.swatch && /rgb\((\d+) (\d+) (\d+)\)/.exec(slot.swatch)
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  return null
}

/** Send one colour to every selected fixture, each in its own colour system */
function applyColour(model: ProgrammerModel, rgb: Rgb, extra?: Partial<Record<string, number>>): void {
  for (const entry of model.entries) {
    const keys = model.fixtureKeys.get(entry.id)
    if (!keys) continue
    const writes = colourWrites(keys, rgb, extra)
    for (const [key, value] of writes) {
      const attr = model.byKey.get(key)
      if (attr) setAttrDmx(attr, value, entry.id)
    }
    if (writes.size === 0 && keys.has('color wheel')) {
      const wheel = model.byKey.get('color wheel')
      const slot = wheel && nearestSlot(wheel.ranges, rgb)
      if (wheel && slot) setAttrDmx(wheel, rangeValue(slot), entry.id)
    }
  }
}

export interface ColourPanelProps {
  model: ProgrammerModel
  firstName: string
}

/** Live colour of the selection (first fixture with a colour = reference) */
function useSelectionColour(model: ProgrammerModel) {
  const ids = useMemo(() => model.entries.map((e) => e.id), [model])
  // "r,g,b;…" ("-" for a fixture without colour) — re-renders only when a colour changes
  const key = useDmxStore((s) => ids.map((id) => fixtureRgb(s.values, model, id)?.join(',') ?? '-').join(';'))
  return useMemo(() => {
    const colours = key.split(';').map((c) => (c === '-' ? null : (c.split(',').map(Number) as Rgb)))
    const refIndex = colours.findIndex((c) => c !== null)
    const ref = refIndex >= 0 ? colours[refIndex] : null
    const hsv = ref ? rgbToHsv(ref[0], ref[1], ref[2]) : { h: 0, s: 0, v: 1 }
    const others = colours.filter((c, i): c is Rgb => c !== null && i !== refIndex)
    const mixed = others.some((c) => c.join(',') !== ref?.join(','))
    return { ref, hsv, others, mixed }
  }, [key])
}

/** Wheel + brightness (re-renders with the colour only) */
function WheelArea({ model }: { model: ProgrammerModel }) {
  const { ref, hsv, others } = useSelectionColour(model)
  const lastHue = useRef(hsv.h)
  if (hsv.s > 0.02 && hsv.v > 0.02) lastHue.current = hsv.h
  const brightness = ref ? hsv.v : 1
  const markers = others.map((c) => rgbToHsv(c[0], c[1], c[2])).map((m) => ({ hue: m.h, sat: m.s }))
  return (
    <div className="flex min-h-0 w-[min(40%,420px)] min-w-[220px] shrink-0 flex-col gap-3">
      <ColourWheel
        fill
        hue={lastHue.current}
        sat={ref ? hsv.s : 0}
        value={Math.max(0.15, brightness)}
        markers={markers}
        onChange={(h, s) => applyColour(model, hsvToRgb(h, s, brightness > 0.02 ? brightness : 1))}
        className="min-h-[180px] flex-1"
        aria-label="Colour wheel"
      />
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Bright</span>
        <Slider
          value={Math.round(brightness * 255)}
          onChange={(v) => applyColour(model, hsvToRgb(lastHue.current, ref ? hsv.s : 0, v / 255))}
          defaultValue={255}
          showValue
          className="flex-1"
          aria-label="Colour brightness"
        />
      </div>
    </div>
  )
}

/** Swatch + name + RGB of the current colour */
function ColourReadout({ model }: { model: ProgrammerModel }) {
  const { ref, mixed } = useSelectionColour(model)
  return (
    <>
      <span
        aria-label={ref ? `Current colour rgb ${ref.join(' ')}` : 'No colour'}
        className="h-12 w-12 shrink-0 rounded-lg ring-1 ring-inset ring-line-strong"
        style={{ backgroundColor: ref ? `rgb(${ref[0]} ${ref[1]} ${ref[2]})` : undefined }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-fg-primary">{mixed ? 'Mixed colours' : ref ? describe(ref) : 'No colour mixing'}</span>
        <span className="font-mono text-2xs tabular text-fg-tertiary">{ref ? `R ${ref[0]} · G ${ref[1]} · B ${ref[2]}` : '—'}</span>
      </div>
    </>
  )
}

export const ColourPanel = memo(function ColourPanel({ model, firstName }: ColourPanelProps) {
  const attrs = model.byFeature.colour
  const anyTouched = useAnyTouched(attrs)
  const canMix = attrs.some((a) => /^(red|cyan|magenta|yellow)( cells)?$/.test(a.key))
  const wheel = model.byKey.get('color wheel')
  const swatchAttrs = attrs.filter((a) => a.ranges.length >= 2 && (a.key === 'color wheel' || a.key === 'color macro'))
  const faderAttrs = attrs.filter((a) => !swatchAttrs.includes(a))
  const canPreset = canMix || !!wheel

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-3">
      {canMix && <WheelArea model={model} />}

      <div className={cn('flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden', canMix ? 'w-[300px] [[data-density=touch]_&]:w-[340px]' : 'w-[min(100%,520px)]')}>
        <div className="flex items-center gap-3">
          <ColourReadout model={model} />
          <Button size="sm" variant="ghost" icon={LuEraser} disabled={!anyTouched} onClick={() => releaseAttrs(attrs)} tooltip="Release colour from the programmer">
            Release
          </Button>
        </div>

        {canPreset && (
          <section aria-label="Colour presets" className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Presets</span>
            <div className="grid grid-cols-8 gap-1">
              {COLOUR_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  onClick={() => applyColour(model, p.rgb, p.extra)}
                  className="aspect-square rounded ring-1 ring-inset ring-line-strong transition-[box-shadow,transform] duration-fast hover:ring-fg-secondary active:scale-95"
                  style={{ backgroundColor: `rgb(${p.rgb[0]} ${p.rgb[1]} ${p.rgb[2]})` }}
                />
              ))}
            </div>
          </section>
        )}

        {swatchAttrs.map((a) => (
          <RangeCard key={a.key} attr={a} selectionCount={model.entries.length} firstName={firstName} swatches />
        ))}
      </div>

      {faderAttrs.length > 0 && (
        <div className="flex min-h-0 min-w-[120px] flex-1 flex-col gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Channels</span>
          <AttributeFaderBank attrs={faderAttrs} selectionCount={model.entries.length} firstName={firstName} className="flex-1" />
        </div>
      )}
    </div>
  )
})

/** Short name of a colour for the readout */
function describe([r, g, b]: Rgb): string {
  const { h, s, v } = rgbToHsv(r, g, b)
  if (v < 0.04) return 'Black'
  if (s < 0.12) return v > 0.85 ? 'White' : 'Grey'
  if (s < 0.35) return h < 60 || h > 300 ? 'Warm white' : 'Cool white'
  const names: [number, string][] = [[15, 'Red'], [40, 'Orange'], [52, 'Amber'], [70, 'Yellow'], [100, 'Lime'], [150, 'Green'], [190, 'Cyan'], [215, 'Light blue'], [250, 'Blue'], [275, 'Congo'], [300, 'Violet'], [335, 'Magenta'], [350, 'Pink'], [361, 'Red']]
  return names.find(([max]) => h < max)?.[1] ?? 'Colour'
}

