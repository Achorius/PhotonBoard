// ============================================================
// Effects view — right column: parameters of the effect being edited.
// Every change goes through updateEffect (the engine keeps the phase
// of a running effect, so dragging never restarts it).
// ============================================================

import { memo, useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import {
  LuArrowLeft, LuArrowRight, LuBox, LuCopy, LuEllipsis, LuListOrdered, LuMousePointerClick, LuPlay, LuPlus, LuRepeat,
  LuRepeat1, LuRotateCcw, LuSlidersHorizontal, LuSquare, LuTarget, LuTrash2, LuX
} from 'react-icons/lu'
import type { Effect, EffectChannel, SpatialAxis, WaveformType } from '@shared/types'
import {
  Button, DropdownMenu, EmptyState, Encoder, IconButton, NumberField, SegmentedControl, Select, Slider, TextInput, cn,
  effectCategoryIcon, formatBpm, formatDegrees, formatHz, formatPercent, useDensity, withAlpha
} from '@renderer/components/ui'
import { formatNumber, t as translate, useT } from '@renderer/i18n'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { computeTapTempo } from '@renderer/lib/midi-manager'
import { clockNow } from '@renderer/lib/runtime'
import { CurveEditor } from './CurveEditor'
import {
  ATTRIBUTES, CATEGORY_COLOR, DEFAULT_KEYFRAMES, WAVEFORMS, attributeLabel, effectCategoryOf, effectChannels, sizeUpdates, waveformLabel
} from './effect-templates'
import { deleteWithUndo } from '@renderer/lib/selection-actions'
import { FanPreview, WaveGlyph, WaveformScope, attributeColor } from './effect-graphics'
import { fadeTimesOf, runEffect, setFadeTimes, useEffectsUiStore } from './effects-ui-store'
import { deleteEffect, duplicateEffect, useEffectSelectionActions, useTargetLabel } from './EffectList'

const MIN_HZ = 0.01
const MAX_HZ = 20
const LOG_RANGE = Math.log(MAX_HZ / MIN_HZ)
const hzToSlider = (hz: number) => Math.round((Math.log(Math.min(MAX_HZ, Math.max(MIN_HZ, hz)) / MIN_HZ) / LOG_RANGE) * 1000)
const sliderToHz = (v: number) => Number((MIN_HZ * Math.exp((v / 1000) * LOG_RANGE)).toPrecision(3))

export function EffectEditor() {
  const t = useT()
  const asideRef = useRef<HTMLElement>(null)
  const editingId = useEffectsUiStore((s) => s.editingId)
  const effect = useEffectsStore((s) => (editingId ? s.effects.find((e) => e.id === editingId) : undefined))
  useEffectSelectionActions(asideRef)

  return (
    <aside ref={asideRef} aria-label={t('effects.editor.region')} className="flex w-[368px] shrink-0 flex-col border-l border-line bg-surface-1 [[data-density=touch]_&]:w-[452px]">
      {effect ? (
        <EditorBody key={effect.id} effect={effect} />
      ) : (
        <EmptyState
          icon={LuSlidersHorizontal}
          title={t('effects.editor.emptyTitle')}
          description={t('effects.editor.emptyText')}
        />
      )}
    </aside>
  )
}

function EditorBody({ effect }: { effect: Effect }) {
  const t = useT()
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
            aria-label={t('effects.editor.name')}
            data-fx-name
            className="min-w-0 flex-1"
            inputClassName="font-semibold"
          />
          <IconButton
            icon={LuTrash2}
            label={t('effects.editor.deleteEffect')}
            data-fx-delete
            className="hover:text-danger-fg"
            onClick={() => { void deleteEffect(effect) }}
          />
          <DropdownMenu
            placement="bottom-end"
            items={() => [
              { label: t('effects.list.restartPhase'), icon: LuRotateCcw, disabled: !running, onSelect: () => useEffectsStore.getState().setEffectRunning(id, true) },
              { label: t('common.duplicate'), icon: LuCopy, onSelect: () => duplicateEffect(effect) },
              { type: 'separator' },
              { label: t('effects.editor.deleteEffectEllipsis'), icon: LuTrash2, danger: true, onSelect: () => { void deleteEffect(effect) } }
            ]}
            trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={t('effects.editor.actions')} />}
          />
          <IconButton icon={LuX} label={t('effects.editor.close')} onClick={() => useEffectsUiStore.getState().setEditing(null)} />
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
            {running ? t('effects.editor.stop') : t('effects.editor.start')}
          </Button>
          <IconButton variant="secondary" icon={LuRotateCcw} label={t('effects.editor.restart')} disabled={!running} onClick={() => useEffectsStore.getState().setEffectRunning(id, true)} />
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
  const t = useT()
  const label = useTargetLabel()(effect.fixtureIds)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const same = selectedIds.length === effect.fixtureIds.length && selectedIds.every((x) => effect.fixtureIds.includes(x))
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded bg-surface-0 py-1 pl-2.5 pr-1 ring-1 ring-inset ring-line">
      {/* Longer labels (French) push the buttons to a second line rather than truncating the targets */}
      <span className="flex min-w-[10rem] flex-1 items-center gap-2">
        <LuTarget size={14} aria-hidden className="shrink-0 text-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className={effect.fixtureIds.length === 0 ? 'text-warning-fg' : 'text-fg-primary'}>{label}</span>
          <span className="tabular text-fg-tertiary"> · {t('common.fixtureCount', { count: effect.fixtureIds.length })}</span>
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          icon={LuMousePointerClick}
          tooltip={t('effects.editor.selectFixturesHint')}
          disabled={effect.fixtureIds.length === 0}
          onClick={() => usePatchStore.getState().selectFixtures([...effect.fixtureIds])}
        >
          {t('effects.editor.selectFixtures')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          tooltip={t('effects.editor.useSelectionHint')}
          disabled={selectedIds.length === 0 || same}
          onClick={() => update({ fixtureIds: [...selectedIds] })}
        >
          {selectedIds.length > 0 && !same ? t('effects.editor.useSelectionCount', { count: selectedIds.length }) : t('effects.editor.useSelection')}
        </Button>
      </span>
    </div>
  )
}

// ------------------------------------------------------------
// Waveform
// ------------------------------------------------------------

const WaveformSection = memo(function WaveformSection({ effect, update, color }: SectionProps & { color: string }) {
  const t = useT()
  const setWaveform = (w: WaveformType) => {
    const u: Partial<Effect> = { waveform: w }
    if (w === 'custom' && !effect.keyframes?.length) u.keyframes = DEFAULT_KEYFRAMES
    update(u)
  }
  return (
    <Group title={t('effects.editor.waveform')}>
      <div role="radiogroup" aria-label={t('effects.editor.waveform')} className="grid grid-cols-5 gap-1 [[data-density=touch]_&]:grid-cols-3 [[data-density=touch]_&]:gap-1.5">
        {WAVEFORMS.map((w) => {
          const on = effect.waveform === w
          return (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={on}
              data-fx-waveform={w}
              onClick={() => setWaveform(w)}
              className={cn(
                'flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded border text-2xs font-medium transition-colors duration-fast',
                '[[data-density=touch]_&]:h-14 [[data-density=touch]_&]:text-xs',
                on ? 'border-accent/70 bg-accent/15 text-fg-primary' : 'border-line bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
              )}
            >
              <WaveGlyph waveform={w} keyframes={w === 'custom' ? effect.keyframes : undefined} width={32} height={14} className={on ? 'text-accent-fg' : undefined} />
              <span className="max-w-full truncate px-0.5">{waveformLabel(w)}</span>
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
        <span className="ml-auto text-2xs text-fg-tertiary">{t('effects.editor.scopeHint')}</span>
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
  const t = useT()
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
      title={t('effects.editor.speed')}
      actions={
        <SegmentedControl
          size="xs"
          aria-label={t('effects.editor.speedUnit')}
          value={unit}
          onChange={(u) => useEffectsUiStore.getState().setSpeedUnit(u)}
          items={[{ value: 'bpm', label: t('units.bpm') }, { value: 'hz', label: t('units.hertz') }]}
        />
      }
    >
      <div className="flex items-center gap-2">
        {unit === 'bpm' ? (
          <NumberField value={Math.round(hz * 600) / 10} onChange={(v) => setHz(v / 60)} min={0.6} max={1200} step={0.1} precision={1} unit={t('units.bpm')} aria-label={t('effects.editor.speedBpm')} className="w-[132px]" />
        ) : (
          <NumberField value={Math.round(hz * 100) / 100} onChange={setHz} min={MIN_HZ} max={MAX_HZ} step={0.01} unit={t('units.hertz')} aria-label={t('effects.editor.speedHz')} className="w-[132px]" />
        )}
        <Button variant="secondary" size="md" onClick={() => setHz(hz / 2)} tooltip={t('effects.editor.halfHint')} aria-label={t('effects.editor.halfHint')}>{t('effects.editor.half')}</Button>
        <Button variant="secondary" size="md" onClick={() => setHz(hz * 2)} tooltip={t('effects.editor.doubleHint')} aria-label={t('effects.editor.doubleHint')}>{t('effects.editor.double')}</Button>
        <Button variant="secondary" tone="accent" className="flex-1" onPress={tap} onRelease={() => {}} tooltip={t('effects.editor.tapHint')}>
          {t('effects.editor.tap')}
        </Button>
      </div>
      <Slider value={hzToSlider(hz)} min={0} max={1000} onChange={(v) => setHz(sliderToHz(v))} defaultValue={hzToSlider(1)} aria-label={t('effects.editor.speed')} />
      <div className="-mt-1.5 flex justify-between font-mono text-2xs tabular text-fg-tertiary">
        <span>{unit === 'bpm' ? formatNumber(0.6) : formatHz(0.01)}</span>
        <span>{unit === 'bpm' ? formatNumber(60) : formatHz(1)}</span>
        <span>{unit === 'bpm' ? formatBpm(1200) : formatHz(20)}</span>
      </div>
    </Group>
  )
})

// ------------------------------------------------------------
// Size & offset
// ------------------------------------------------------------

const SizeSection = memo(function SizeSection({ effect, update, color }: SectionProps & { color: string }) {
  const t = useT()
  const centered = effectChannels(effect).some((c) => c.channelType === 'Pan' || c.channelType === 'Tilt')
  return (
    <Group title={t('effects.editor.sizeOffset')}>
      <Row label={t('effects.editor.size')} hint={centered ? t('effects.editor.sizeCentered') : undefined}>
        <Slider
          value={effect.depth}
          onChange={(v) => update(sizeUpdates(effect, v))}
          min={0}
          max={255}
          defaultValue={255}
          color={color}
          showValue={(v) => formatPercent(v)}
          aria-label={t('effects.editor.size')}
          className="flex-1"
        />
      </Row>
      <Row label={t('effects.editor.phaseOffset')}>
        <Slider
          value={((Number(effect.offset) || 0) % 360 + 360) % 360}
          onChange={(v) => update({ offset: v })}
          min={0}
          max={359}
          defaultValue={0}
          showValue={formatDegrees}
          aria-label={t('effects.editor.phaseOffset')}
          className="flex-1"
        />
      </Row>
    </Group>
  )
})

// ------------------------------------------------------------
// Spread (fan)
// ------------------------------------------------------------

const AXES: SpatialAxis[] = ['x', 'z', 'y', 'radial']

const SpreadSection = memo(function SpreadSection({ effect, update }: SectionProps) {
  const t = useT()
  const axisItems = useMemo(() => AXES.map((a) => ({ value: a, label: t(`effects.editor.axes.${a}`) })), [t])
  const touch = useDensity() === 'touch'
  const fan = Number(effect.fan) || 0
  const magnitude = Math.min(360, Math.abs(fan))
  const reverse = fan < 0
  const spatial = effect.spatialMode === 'spatial'
  const n = effect.fixtureIds.length
  const step = !spatial && n > 1 ? magnitude / n : null

  return (
    <Group title={t('effects.editor.spread')}>
      <div className="flex items-start gap-3">
        <Encoder
          value={magnitude}
          onChange={(v) => update({ fan: reverse ? -v : v })}
          min={0}
          max={360}
          step={1}
          defaultValue={0}
          label={t('effects.editor.spread')}
          format={formatDegrees}
          size={touch ? 60 : 48}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SegmentedControl
            size="sm"
            fullWidth
            aria-label={t('effects.editor.direction')}
            value={reverse ? 'rev' : 'fwd'}
            onChange={(d) => update({ fan: d === 'rev' ? -magnitude : magnitude })}
            items={[
              { value: 'fwd', label: t('effects.editor.forward'), icon: LuArrowRight, disabled: magnitude === 0 },
              { value: 'rev', label: t('effects.editor.reverse'), icon: LuArrowLeft, disabled: magnitude === 0 }
            ]}
          />
          <SegmentedControl
            size="sm"
            fullWidth
            aria-label={t('effects.editor.distribution')}
            value={spatial ? 'spatial' : 'index'}
            onChange={(m) => update({ spatialMode: m })}
            items={[
              { value: 'index', label: t('effects.editor.fixtureOrder'), icon: LuListOrdered },
              { value: 'spatial', label: t('effects.editor.position3d'), icon: LuBox }
            ]}
          />
        </div>
      </div>
      {spatial && (
        <SegmentedControl
          size="sm"
          fullWidth
          aria-label={t('effects.editor.spatialAxis')}
          value={effect.spatialAxis ?? 'x'}
          onChange={(a) => update({ spatialAxis: a })}
          items={axisItems}
        />
      )}
      <FanPreview effect={effect} className="h-16 w-full [[data-density=touch]_&]:h-20" />
      <p className="-mt-1 text-xs text-fg-tertiary">
        {n <= 1
          ? t('effects.editor.spreadNeedsTwo')
          : magnitude === 0
            ? t('effects.editor.spreadSync', { count: n })
            : spatial
              ? t('effects.editor.spreadSpatial', { axis: t(`effects.editor.axesLong.${effect.spatialAxis ?? 'x'}`) })
              : t(reverse ? 'effects.editor.spreadStepReverse' : 'effects.editor.spreadStep', { deg: formatDegrees(step ?? 0) })}
      </p>
    </Group>
  )
})

// ------------------------------------------------------------
// Playback: loop / one-shot, fades
// ------------------------------------------------------------

const PlaybackSection = memo(function PlaybackSection({ effect, update }: SectionProps) {
  const t = useT()
  const fade = fadeTimesOf(effect)
  const setFade = (f: Partial<{ fadeIn: number; fadeOut: number }>) => setFadeTimes(effect, f)
  return (
    <Group title={t('effects.editor.playback')}>
      <SegmentedControl
        size="sm"
        fullWidth
        aria-label={t('effects.editor.playbackMode')}
        value={effect.oneShot ? 'once' : 'loop'}
        onChange={(m) => update({ oneShot: m === 'once' })}
        items={[
          { value: 'loop', label: t('effects.editor.loop'), icon: LuRepeat },
          { value: 'once', label: t('effects.editor.oneShot'), icon: LuRepeat1 }
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label={t('effects.editor.fadeIn')} value={fade.fadeIn} onChange={(v) => setFade({ fadeIn: v })} min={0} max={60} step={0.1} unit={t('units.seconds')} />
        <NumberField label={t('effects.editor.fadeOut')} value={fade.fadeOut} onChange={(v) => setFade({ fadeOut: v })} min={0} max={60} step={0.1} unit={t('units.seconds')} />
      </div>
      <p className="-mt-1 text-xs text-fg-tertiary">{t('effects.editor.fadesHint')}</p>
    </Group>
  )
})

// ------------------------------------------------------------
// Attributes (channels the effect drives)
// ------------------------------------------------------------

const AttributesSection = memo(function AttributesSection({ effect, update }: SectionProps) {
  const t = useT()
  const attributeOptions = useMemo(() => ATTRIBUTES.map((a) => ({ value: a as string, label: attributeLabel(a) })), [t])
  const waveOverrideOptions = useMemo(() => [
    { value: '', label: t('effects.editor.mainWaveform') },
    ...WAVEFORMS.filter((w) => w !== 'custom').map((w) => ({ value: w as string, label: waveformLabel(w) })),
    { value: 'constant', label: t('effects.editor.holdConstant') }
  ], [t])
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
    void deleteWithUndo({
      label: translate('effects.selection.attribute', { name: attributeLabel(channels[i].channelType), effect: effect.name }),
      confirm: false,
      run: () => {
        if (next.length === 1) {
          // Back to a simple single-attribute effect
          update({ channels: undefined, channelType: next[0].channelType, depth: next[0].depth })
        } else setChannels(next)
      }
    })
  }

  return (
    <Group
      title={t('effects.editor.attributes')}
      actions={<Button size="xs" variant="ghost" icon={LuPlus} onClick={add}>{t('effects.editor.addAttribute')}</Button>}
    >
      {channels.map((ch, i) => (
        <div key={i} className="flex flex-col gap-2 rounded border border-line bg-surface-2 p-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: attributeColor(ch.channelType) }} />
            <Select
              size="sm"
              value={ch.channelType}
              onChange={(v) => patchChannel(i, { channelType: v })}
              options={attributeOptions.some((o) => o.value === ch.channelType) ? attributeOptions : [{ value: ch.channelType, label: ch.channelType }, ...attributeOptions]}
              aria-label={t('effects.editor.attribute')}
              className="min-w-0 flex-1"
            />
            {compound && <IconButton size="sm" icon={LuTrash2} label={t('effects.editor.removeAttribute', { name: attributeLabel(ch.channelType) })} onClick={() => remove(i)} />}
          </div>
          {compound && (
            <>
              <Slider
                value={ch.depth}
                onChange={(v) => patchChannel(i, { depth: v })}
                min={0}
                max={255}
                color={attributeColor(ch.channelType)}
                showValue={(v) => formatPercent(v)}
                aria-label={t('effects.editor.attributeSize', { name: attributeLabel(ch.channelType) })}
              />
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <NumberField size="sm" label={t('effects.editor.phase')} value={Number(ch.phaseOffset) || 0} onChange={(v) => patchChannel(i, { phaseOffset: v })} min={-360} max={360} step={1} unit="°" />
                <NumberField size="sm" label={t('effects.editor.rate')} value={ch.frequencyMultiplier ?? 1} onChange={(v) => patchChannel(i, { frequencyMultiplier: v })} min={0.25} max={8} step={0.25} unit="x" />
              </div>
              <Select
                size="sm"
                value={ch.waveform ?? ''}
                onChange={(v) => patchChannel(i, { waveform: v === '' ? undefined : (v as WaveformType) })}
                options={waveOverrideOptions}
                aria-label={t('effects.editor.attributeWaveform', { name: attributeLabel(ch.channelType) })}
              />
            </>
          )}
        </div>
      ))}
      <p className="text-xs text-fg-tertiary">
        {compound ? t('effects.editor.compoundHint') : t('effects.editor.simpleHint')}
      </p>
    </Group>
  )
})
