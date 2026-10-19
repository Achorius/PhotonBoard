// ============================================================
// Effects view — right column: parameters of the effect being edited.
// Every change goes through updateEffect (the engine keeps the phase
// of a running effect, so dragging never restarts it).
// ============================================================

import { memo, useCallback, useRef } from 'react'
import type React from 'react'
import {
  LuArrowLeft, LuArrowRight, LuBox, LuCopy, LuEllipsis, LuListOrdered, LuMousePointerClick, LuPlay, LuPlus, LuRepeat,
  LuRepeat1, LuRotateCcw, LuSlidersHorizontal, LuSquare, LuTarget, LuTrash2, LuX
} from 'react-icons/lu'
import type { Effect, EffectChannel, SpatialAxis, WaveformType } from '@shared/types'
import {
  Button, DropdownMenu, EmptyState, Encoder, IconButton, NumberField, SegmentedControl, Select, Slider, TextInput, cn,
  effectCategoryIcon, formatDegrees, percentOf, useDensity, withAlpha
} from '@renderer/components/ui'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { computeTapTempo } from '@renderer/lib/midi-manager'
import { clockNow } from '@renderer/lib/runtime'
import { CurveEditor } from './CurveEditor'
import {
  ATTRIBUTES, CATEGORY_COLOR, DEFAULT_KEYFRAMES, WAVEFORMS, attributeLabel, effectCategoryOf, effectChannels, sizeUpdates
} from './effect-templates'
import { FanPreview, WaveGlyph, WaveformScope, attributeColor } from './effect-graphics'
import { fadeTimesOf, runEffect, useEffectsUiStore } from './effects-ui-store'
import { deleteEffect, duplicateEffect, useTargetLabel } from './EffectList'

const MIN_HZ = 0.01
const MAX_HZ = 20
const LOG_RANGE = Math.log(MAX_HZ / MIN_HZ)
const hzToSlider = (hz: number) => Math.round((Math.log(Math.min(MAX_HZ, Math.max(MIN_HZ, hz)) / MIN_HZ) / LOG_RANGE) * 1000)
const sliderToHz = (v: number) => Number((MIN_HZ * Math.exp((v / 1000) * LOG_RANGE)).toPrecision(3))

export function EffectEditor() {
  const editingId = useEffectsUiStore((s) => s.editingId)
  const effect = useEffectsStore((s) => (editingId ? s.effects.find((e) => e.id === editingId) : undefined))

  return (
    <aside aria-label="Effect parameters" className="flex w-[368px] shrink-0 flex-col border-l border-line bg-surface-1 [[data-density=touch]_&]:w-[452px]">
      {effect ? (
        <EditorBody key={effect.id} effect={effect} />
      ) : (
        <EmptyState
          icon={LuSlidersHorizontal}
          title="No effect selected"
          description="Tap an effect in the list to edit its waveform, speed, size and spread — or start a new one from the library."
        />
      )}
    </aside>
  )
}

function EditorBody({ effect }: { effect: Effect }) {
  const id = effect.id
  const update = useCallback((u: Partial<Effect>) => useEffectsStore.getState().updateEffect(id, u), [id])
  const category = effectCategoryOf(effect)
  const color = CATEGORY_COLOR[category]
  const Icon = effectCategoryIcon(category)
  const running = effect.isRunning

  return (
    <>
      <header className="flex shrink-0 flex-col gap-2 border-b border-line-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-control w-control shrink-0 items-center justify-center rounded" style={{ color, backgroundColor: withAlpha(color, 0.16) }}>
            <Icon size={16} aria-hidden />
          </span>
          <TextInput
            value={effect.name}
            onChange={(e) => update({ name: e.target.value })}
            aria-label="Effect name"
            className="min-w-0 flex-1"
            inputClassName="font-semibold"
          />
          <DropdownMenu
            placement="bottom-end"
            items={() => [
              { label: 'Restart phase', icon: LuRotateCcw, disabled: !running, onSelect: () => useEffectsStore.getState().setEffectRunning(id, true) },
              { label: 'Duplicate', icon: LuCopy, onSelect: () => duplicateEffect(effect) },
              { type: 'separator' },
              { label: 'Delete effect…', icon: LuTrash2, danger: true, onSelect: () => { void deleteEffect(effect) } }
            ]}
            trigger={(p) => <IconButton {...p} icon={LuEllipsis} label="Effect actions" />}
          />
          <IconButton icon={LuX} label="Close editor" onClick={() => useEffectsUiStore.getState().setEditing(null)} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            tone="go"
            active={running}
            icon={running ? LuSquare : LuPlay}
            className="flex-1"
            onClick={() => runEffect(id, !running)}
          >
            {running ? 'Stop' : 'Start'}
          </Button>
          <IconButton variant="secondary" icon={LuRotateCcw} label="Restart phase (re-trigger)" disabled={!running} onClick={() => useEffectsStore.getState().setEffectRunning(id, true)} />
        </div>
        <TargetsLine effect={effect} update={update} />
      </header>

      <div data-fx-editor-body className="min-h-0 flex-1 overflow-y-auto">
        <WaveformSection effect={effect} update={update} color={color} />
        <SpeedSection effect={effect} update={update} />
        <SizeSection effect={effect} update={update} color={color} />
        <SpreadSection effect={effect} update={update} />
        <PlaybackSection effect={effect} update={update} />
        <AttributesSection effect={effect} update={update} />
      </div>
    </>
  )
}

type SectionProps = { effect: Effect; update: (u: Partial<Effect>) => void }

function Group({ title, actions, children, className }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5 border-b border-line-subtle px-3 py-3 last:border-b-0', className)}>
      <div className="flex min-h-control-xs items-center gap-2">
        <span className="flex-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{title}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}

function Row({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 [[data-density=touch]_&]:grid-cols-[88px_minmax(0,1fr)]">
      <span className="truncate text-xs text-fg-secondary">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {hint && <p className="col-start-2 text-xs text-fg-tertiary">{hint}</p>}
    </div>
  )
}

// ------------------------------------------------------------
// Targets
// ------------------------------------------------------------

function TargetsLine({ effect, update }: SectionProps) {
  const label = useTargetLabel()(effect.fixtureIds)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const same = selectedIds.length === effect.fixtureIds.length && selectedIds.every((x) => effect.fixtureIds.includes(x))
  return (
    <div className="flex min-w-0 items-center gap-2 rounded bg-surface-0 py-1 pl-2.5 pr-1 ring-1 ring-inset ring-line">
      <LuTarget size={14} aria-hidden className="shrink-0 text-fg-tertiary" />
      <span className="min-w-0 flex-1 truncate text-xs">
        <span className={effect.fixtureIds.length === 0 ? 'text-warning-fg' : 'text-fg-primary'}>{label}</span>
        <span className="tabular text-fg-tertiary"> · {effect.fixtureIds.length} fixture{effect.fixtureIds.length === 1 ? '' : 's'}</span>
      </span>
      <Button
        size="xs"
        variant="ghost"
        icon={LuMousePointerClick}
        tooltip="Select this effect's fixtures"
        disabled={effect.fixtureIds.length === 0}
        onClick={() => usePatchStore.getState().selectFixtures([...effect.fixtureIds])}
      >
        Select
      </Button>
      <Button
        size="xs"
        variant="ghost"
        tooltip="Run this effect on the current selection instead"
        disabled={selectedIds.length === 0 || same}
        onClick={() => update({ fixtureIds: [...selectedIds] })}
      >
        Use selection{selectedIds.length > 0 && !same ? ` (${selectedIds.length})` : ''}
      </Button>
    </div>
  )
}

// ------------------------------------------------------------
// Waveform
// ------------------------------------------------------------

const WaveformSection = memo(function WaveformSection({ effect, update, color }: SectionProps & { color: string }) {
  const setWaveform = (w: WaveformType) => {
    const u: Partial<Effect> = { waveform: w }
    if (w === 'custom' && !effect.keyframes?.length) u.keyframes = DEFAULT_KEYFRAMES
    update(u)
  }
  return (
    <Group title="Waveform">
      <div role="radiogroup" aria-label="Waveform" className="grid grid-cols-5 gap-1 [[data-density=touch]_&]:grid-cols-3 [[data-density=touch]_&]:gap-1.5">
        {WAVEFORMS.map((w) => {
          const on = effect.waveform === w.id
          return (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-fx-waveform={w.id}
              onClick={() => setWaveform(w.id)}
              className={cn(
                'flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded border text-2xs font-medium transition-colors duration-fast',
                '[[data-density=touch]_&]:h-14 [[data-density=touch]_&]:text-xs',
                on ? 'border-accent/70 bg-accent/15 text-fg-primary' : 'border-line bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
              )}
            >
              <WaveGlyph waveform={w.id} keyframes={w.id === 'custom' ? effect.keyframes : undefined} width={32} height={14} className={on ? 'text-accent-fg' : undefined} />
              <span className="truncate">{w.label}</span>
            </button>
          )
        })}
      </div>
      <WaveformScope effect={effect} className="h-24 w-full rounded bg-surface-0 ring-1 ring-inset ring-line [[data-density=touch]_&]:h-32" />
      <div className="-mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {effectChannels(effect).map((ch, i) => (
          <span key={i} className="flex items-center gap-1.5 text-2xs text-fg-tertiary">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: attributeColor(ch.channelType) }} />
            {attributeLabel(ch.channelType)}
          </span>
        ))}
        <span className="ml-auto text-2xs text-fg-tertiary">Output of the first fixture, one cycle</span>
      </div>
      {effect.waveform === 'custom' && (
        <CurveEditor keyframes={effect.keyframes} onChange={(keyframes) => update({ keyframes })} color={color} />
      )}
    </Group>
  )
})

// ------------------------------------------------------------
// Speed
// ------------------------------------------------------------

const SpeedSection = memo(function SpeedSection({ effect, update }: SectionProps) {
  const unit = useEffectsUiStore((s) => s.speedUnit)
  const taps = useRef<number[]>([])
  const hz = Number(effect.speed) || 0
  const setHz = (v: number) => update({ speed: Math.min(100, Math.max(MIN_HZ, v)) })

  const tap = () => {
    const now = clockNow()
    const last = taps.current[taps.current.length - 1]
    if (last !== undefined && now - last > 3000) taps.current = []
    taps.current.push(now)
    if (taps.current.length > 8) taps.current.shift()
    const bpm = computeTapTempo(taps.current)
    if (bpm !== null) setHz(bpm / 60)
  }

  return (
    <Group
      title="Speed"
      actions={
        <SegmentedControl
          size="xs"
          aria-label="Speed unit"
          value={unit}
          onChange={(u) => useEffectsUiStore.getState().setSpeedUnit(u)}
          items={[{ value: 'bpm', label: 'BPM' }, { value: 'hz', label: 'Hz' }]}
        />
      }
    >
      <div className="flex items-center gap-2">
        {unit === 'bpm' ? (
          <NumberField value={Math.round(hz * 600) / 10} onChange={(v) => setHz(v / 60)} min={0.6} max={1200} step={0.1} precision={1} unit="BPM" aria-label="Speed in BPM" className="w-[132px]" />
        ) : (
          <NumberField value={Math.round(hz * 100) / 100} onChange={setHz} min={MIN_HZ} max={MAX_HZ} step={0.01} unit="Hz" aria-label="Speed in Hz" className="w-[132px]" />
        )}
        <Button variant="secondary" size="md" onClick={() => setHz(hz / 2)} tooltip="Half speed" aria-label="Half speed">Half</Button>
        <Button variant="secondary" size="md" onClick={() => setHz(hz * 2)} tooltip="Double speed" aria-label="Double speed">Double</Button>
        <Button variant="secondary" tone="accent" className="flex-1" onPress={tap} onRelease={() => {}} tooltip="Tap the beat (2+ taps)">
          Tap
        </Button>
      </div>
      <Slider value={hzToSlider(hz)} min={0} max={1000} onChange={(v) => setHz(sliderToHz(v))} defaultValue={hzToSlider(1)} aria-label="Speed" />
      <div className="-mt-1.5 flex justify-between font-mono text-2xs tabular text-fg-tertiary">
        <span>{unit === 'bpm' ? '0.6' : '0.01 Hz'}</span>
        <span>{unit === 'bpm' ? '60' : '1 Hz'}</span>
        <span>{unit === 'bpm' ? '1200 BPM' : '20 Hz'}</span>
      </div>
    </Group>
  )
})

// ------------------------------------------------------------
// Size & offset
// ------------------------------------------------------------

const SizeSection = memo(function SizeSection({ effect, update, color }: SectionProps & { color: string }) {
  const centered = effectChannels(effect).some((c) => c.channelType === 'Pan' || c.channelType === 'Tilt')
  return (
    <Group title="Size & offset">
      <Row label="Size" hint={centered ? 'Pan / tilt swing around their centre (50%).' : undefined}>
        <Slider
          value={effect.depth}
          onChange={(v) => update(sizeUpdates(effect, v))}
          min={0}
          max={255}
          defaultValue={255}
          color={color}
          showValue={(v) => `${percentOf(v)}%`}
          aria-label="Size"
          className="flex-1"
        />
      </Row>
      <Row label="Phase offset">
        <Slider
          value={((Number(effect.offset) || 0) % 360 + 360) % 360}
          onChange={(v) => update({ offset: v })}
          min={0}
          max={359}
          defaultValue={0}
          showValue={formatDegrees}
          aria-label="Phase offset"
          className="flex-1"
        />
      </Row>
    </Group>
  )
})

// ------------------------------------------------------------
// Spread (fan)
// ------------------------------------------------------------

const AXES: { value: SpatialAxis; label: string }[] = [
  { value: 'x', label: 'X L–R' },
  { value: 'z', label: 'Z F–B' },
  { value: 'y', label: 'Y Height' },
  { value: 'radial', label: 'Radial' }
]

const SpreadSection = memo(function SpreadSection({ effect, update }: SectionProps) {
  const touch = useDensity() === 'touch'
  const fan = Number(effect.fan) || 0
  const magnitude = Math.min(360, Math.abs(fan))
  const reverse = fan < 0
  const spatial = effect.spatialMode === 'spatial'
  const n = effect.fixtureIds.length
  const step = !spatial && n > 1 ? magnitude / n : null

  return (
    <Group title="Spread">
      <div className="flex items-start gap-3">
        <Encoder
          value={magnitude}
          onChange={(v) => update({ fan: reverse ? -v : v })}
          min={0}
          max={360}
          step={1}
          defaultValue={0}
          label="Spread"
          format={formatDegrees}
          size={touch ? 60 : 48}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SegmentedControl
            size="sm"
            fullWidth
            aria-label="Direction"
            value={reverse ? 'rev' : 'fwd'}
            onChange={(d) => update({ fan: d === 'rev' ? -magnitude : magnitude })}
            items={[
              { value: 'fwd', label: 'Forward', icon: LuArrowRight, disabled: magnitude === 0 },
              { value: 'rev', label: 'Reverse', icon: LuArrowLeft, disabled: magnitude === 0 }
            ]}
          />
          <SegmentedControl
            size="sm"
            fullWidth
            aria-label="Distribution"
            value={spatial ? 'spatial' : 'index'}
            onChange={(m) => update({ spatialMode: m })}
            items={[
              { value: 'index', label: 'Fixture order', icon: LuListOrdered },
              { value: 'spatial', label: '3D position', icon: LuBox }
            ]}
          />
        </div>
      </div>
      {spatial && (
        <SegmentedControl
          size="sm"
          fullWidth
          aria-label="Spatial axis"
          value={effect.spatialAxis ?? 'x'}
          onChange={(a) => update({ spatialAxis: a })}
          items={AXES}
        />
      )}
      <FanPreview effect={effect} className="h-16 w-full [[data-density=touch]_&]:h-20" />
      <p className="-mt-1 text-xs text-fg-tertiary">
        {n <= 1
          ? 'Spread needs two or more fixtures.'
          : magnitude === 0
            ? `All ${n} fixtures move in sync.`
            : spatial
              ? `Phase follows each fixture's 3D position along ${AXES.find((a) => a.value === (effect.spatialAxis ?? 'x'))?.label ?? 'X'}.`
              : `${formatDegrees(step ?? 0)} between neighbouring fixtures${reverse ? ', last fixture leads' : ''}.`}
      </p>
    </Group>
  )
})

// ------------------------------------------------------------
// Playback: loop / one-shot, fades
// ------------------------------------------------------------

const PlaybackSection = memo(function PlaybackSection({ effect, update }: SectionProps) {
  const fade = useEffectsUiStore((s) => fadeTimesOf(s.fades, effect.id))
  const setFade = (f: Partial<{ fadeIn: number; fadeOut: number }>) => useEffectsUiStore.getState().setFade(effect.id, f)
  return (
    <Group title="Playback">
      <SegmentedControl
        size="sm"
        fullWidth
        aria-label="Playback mode"
        value={effect.oneShot ? 'once' : 'loop'}
        onChange={(m) => update({ oneShot: m === 'once' })}
        items={[
          { value: 'loop', label: 'Loop', icon: LuRepeat },
          { value: 'once', label: 'One-shot', icon: LuRepeat1 }
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Fade in" value={fade.fadeIn} onChange={(v) => setFade({ fadeIn: v })} min={0} max={60} step={0.1} unit="s" />
        <NumberField label="Fade out" value={fade.fadeOut} onChange={(v) => setFade({ fadeOut: v })} min={0} max={60} step={0.1} unit="s" />
      </div>
      <p className="-mt-1 text-xs text-fg-tertiary">Fades ramp the size when starting / stopping from this view. Saved on this console only.</p>
    </Group>
  )
})

// ------------------------------------------------------------
// Attributes (channels the effect drives)
// ------------------------------------------------------------

const ATTRIBUTE_OPTIONS = ATTRIBUTES.map((a) => ({ value: a as string, label: attributeLabel(a) }))
const WAVE_OVERRIDE_OPTIONS = [{ value: '', label: 'Main waveform' }, ...WAVEFORMS.filter((w) => w.id !== 'custom').map((w) => ({ value: w.id as string, label: w.label }))]

const AttributesSection = memo(function AttributesSection({ effect, update }: SectionProps) {
  const compound = !!effect.channels && effect.channels.length > 0
  const channels = effectChannels(effect)

  const setChannels = (next: EffectChannel[]) => {
    if (next.length === 0) return
    update({ channels: next, channelType: next[0].channelType })
  }
  const patchChannel = (i: number, u: Partial<EffectChannel>) => {
    if (!compound) {
      if (u.channelType) update({ channelType: u.channelType })
      return
    }
    setChannels(channels.map((c, j) => (j === i ? { ...c, ...u } : c)))
  }
  const add = () => {
    const used = new Set(channels.map((c) => c.channelType))
    const type = ATTRIBUTES.find((a) => !used.has(a)) ?? 'Dimmer'
    setChannels([...channels.map((c) => ({ ...c })), { channelType: type, phaseOffset: 0, depth: effect.depth, frequencyMultiplier: 1 }])
  }
  const remove = (i: number) => {
    const next = channels.filter((_, j) => j !== i)
    if (next.length === 1) {
      // Back to a simple single-attribute effect
      update({ channels: undefined, channelType: next[0].channelType, depth: next[0].depth })
    } else setChannels(next)
  }

  return (
    <Group
      title="Attributes"
      actions={<Button size="xs" variant="ghost" icon={LuPlus} onClick={add}>Add</Button>}
    >
      {channels.map((ch, i) => (
        <div key={i} className="flex flex-col gap-2 rounded border border-line bg-surface-2 p-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: attributeColor(ch.channelType) }} />
            <Select
              size="sm"
              value={ch.channelType}
              onChange={(v) => patchChannel(i, { channelType: v })}
              options={ATTRIBUTE_OPTIONS.some((o) => o.value === ch.channelType) ? ATTRIBUTE_OPTIONS : [{ value: ch.channelType, label: ch.channelType }, ...ATTRIBUTE_OPTIONS]}
              aria-label="Attribute"
              className="min-w-0 flex-1"
            />
            {compound && <IconButton size="sm" icon={LuTrash2} label={`Remove ${attributeLabel(ch.channelType)}`} onClick={() => remove(i)} />}
          </div>
          {compound && (
            <>
              <Slider
                value={ch.depth}
                onChange={(v) => patchChannel(i, { depth: v })}
                min={0}
                max={255}
                color={attributeColor(ch.channelType)}
                showValue={(v) => `${percentOf(v)}%`}
                aria-label={`${attributeLabel(ch.channelType)} size`}
              />
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <NumberField size="sm" label="Phase" value={Number(ch.phaseOffset) || 0} onChange={(v) => patchChannel(i, { phaseOffset: v })} min={-360} max={360} step={1} unit="°" />
                <NumberField size="sm" label="Rate" value={ch.frequencyMultiplier ?? 1} onChange={(v) => patchChannel(i, { frequencyMultiplier: v })} min={0.25} max={8} step={0.25} unit="x" />
              </div>
              <Select
                size="sm"
                value={ch.waveform ?? ''}
                onChange={(v) => patchChannel(i, { waveform: v === '' ? undefined : (v as WaveformType) })}
                options={WAVE_OVERRIDE_OPTIONS}
                aria-label={`${attributeLabel(ch.channelType)} waveform`}
              />
            </>
          )}
        </div>
      ))}
      <p className="text-xs text-fg-tertiary">
        {compound ? 'Each attribute has its own size, phase and rate (e.g. tilt at 2× for a figure 8).' : 'Add a second attribute to build a compound effect (circle = pan + tilt at 90°).'}
      </p>
    </Group>
  )
})
