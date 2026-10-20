// ============================================================
// Cue timing editor (Pro view, beside / below the cue table):
// per-feature fade & delay, cue parts (name, in / out / delay,
// which channels), follow trigger and block cue.
// An empty time inherits the cue's (shown greyed; tap to set it).
// Every edit is a normal cue update (automatic undo).
// ============================================================

import { useMemo } from 'react'
import { LuLayers, LuListTree, LuPlus, LuRotateCcw, LuTimer, LuTrash2, LuX } from 'react-icons/lu'
import type { Cue, CueFeature, Cuelist } from '@shared/types'
import {
  Badge, Button, DropdownMenu, EmptyState, IconButton, NumberField, Section, SegmentedControl, Switch, TextInput, cn, formatSeconds,
  type MenuEntry
} from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { formatCueNumber } from './actions'
import { featureLabel } from './feature-label'
import { makeFeatureOf } from './store-modes'
import {
  CUE_FEATURES, MAX_TIME, addPart, assignToPart, clearFeatureTiming, countByFeature, countByPart, removePart, setFeatureTime, updatePart
} from './pro-cue'

export function CueTimingEditor({ cuelist: cl, cue, layout, onClose }: {
  cuelist: Cuelist
  cue: Cue | undefined
  layout: 'side' | 'bottom'
  onClose: () => void
}) {
  const t = useT()
  return (
    <aside
      aria-label={t('pro.scenes.timing.aria')}
      data-cue-timing-editor=""
      className={cn(
        'flex min-h-0 shrink-0 flex-col bg-surface-1',
        layout === 'side' ? 'w-[340px] border-l border-line [[data-density=touch]_&]:w-[400px]' : 'max-h-[50%] w-full border-t border-line'
      )}
    >
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <LuTimer size={14} aria-hidden className="shrink-0 text-accent-fg" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-primary">
          {cue ? t('pro.scenes.timing.title', { number: formatCueNumber(cue.number) }) : t('pro.scenes.timing.button')}
        </h3>
        <IconButton icon={LuX} size="sm" label={t('pro.scenes.timing.hide')} onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cue ? <CueTiming cuelistId={cl.id} cue={cue} columns={layout === 'bottom'} /> : (
          <EmptyState size="sm" icon={LuTimer} title={t('pro.scenes.timing.noCueTitle')} description={t('pro.scenes.timing.noCueText')} />
        )}
      </div>
    </aside>
  )
}

function CueTiming({ cuelistId, cue, columns }: { cuelistId: string; cue: Cue; columns: boolean }) {
  const t = useT()
  const update = (u: Partial<Cue>) => usePlaybackStore.getState().updateCue(cuelistId, cue.id, u)
  // Recomputed when the cue's values change (classification is cached per channel)
  const featureOf = useMemo(() => makeFeatureOf(), [cue.values]) // eslint-disable-line react-hooks/exhaustive-deps
  const byFeature = useMemo(() => countByFeature(cue, featureOf), [cue, featureOf])
  const byPart = useMemo(() => countByPart(cue), [cue])
  const number = formatCueNumber(cue.number)
  const sectionClass = columns ? 'border-b-0' : undefined

  return (
    <div className={cn(columns ? 'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)] divide-x divide-line-subtle' : 'flex flex-col')}>
      <Section title={t('pro.scenes.timing.perFeature')} className={sectionClass}>
        <p className="-mt-1 text-xs text-fg-tertiary">{t('pro.scenes.timing.perFeatureHint')}</p>
        <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_28px] items-center gap-x-1.5 gap-y-1 [[data-density=touch]_&]:grid-cols-[minmax(0,1fr)_104px_104px_40px]">
          <span />
          <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.scenes.timing.fade')}</span>
          <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.scenes.timing.delay')}</span>
          <span />
          {CUE_FEATURES.map((f) => {
            const ft = cue.featureTiming?.[f]
            const label = featureLabel(f)
            return (
              <FeatureRow
                key={f}
                feature={f}
                label={label}
                count={byFeature[f]}
                fade={ft?.fade}
                delay={ft?.delay}
                cueFade={cue.fadeIn}
                cueDelay={cue.delay}
                onFade={(v) => update({ featureTiming: setFeatureTime(cue, f, 'fade', v) })}
                onDelay={(v) => update({ featureTiming: setFeatureTime(cue, f, 'delay', v) })}
                onReset={() => update({ featureTiming: clearFeatureTiming(cue, f) })}
              />
            )
          })}
        </div>
      </Section>

      <Section
        title={t('pro.scenes.timing.parts')}
        className={sectionClass}
        actions={(cue.parts?.length ?? 0) > 0 ? (
          <Button size="xs" variant="ghost" icon={LuPlus} data-cue-add-part="" onClick={() => update({ parts: addPart(cue) })}>{t('pro.scenes.timing.addPart')}</Button>
        ) : undefined}
      >
        {(cue.parts?.length ?? 0) === 0 ? (
          <EmptyState
            size="sm"
            icon={LuLayers}
            title={t('pro.scenes.timing.noPartsTitle')}
            description={t('pro.scenes.timing.noPartsText')}
            action={<Button size="sm" icon={LuPlus} data-cue-add-part="" onClick={() => update({ parts: addPart(cue) })}>{t('pro.scenes.timing.addPart')}</Button>}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-fg-tertiary">{t('pro.scenes.timing.partsHint')}</p>
            <div className="flex items-center gap-2 px-1 text-xs text-fg-secondary">
              <span className="min-w-0 flex-1 truncate">{t('pro.scenes.timing.mainPart')}</span>
              <span className="shrink-0 font-mono tabular text-fg-tertiary">{t('pro.scenes.timing.valuesCount', { count: byPart.get(0) ?? 0 })}</span>
            </div>
            {cue.parts!.map((part) => (
              <div key={part.index} data-cue-part={part.index} className="flex flex-col gap-1.5 rounded-lg bg-surface-2 p-2 ring-1 ring-inset ring-line-subtle">
                <div className="flex items-center gap-1.5">
                  <Badge mono size="xs" tone="info">{part.index}</Badge>
                  <TextInput
                    size="sm"
                    className="min-w-0 flex-1"
                    value={part.name ?? ''}
                    placeholder={t('pro.scenes.timing.partN', { n: part.index })}
                    aria-label={t('pro.scenes.timing.partNameAria', { n: part.index })}
                    onChange={(e) => update({ parts: updatePart(cue, part.index, { name: e.target.value }) })}
                  />
                  <IconButton
                    icon={LuTrash2}
                    size="sm"
                    label={t('pro.scenes.timing.removePart', { n: part.index })}
                    className="hover:bg-danger/15 hover:text-danger-fg"
                    onClick={() => update(removePart(cue, part.index))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <LabeledTime label={t('pro.scenes.timing.fadeIn')} value={part.fade} inherited={cue.fadeIn} aria={`${t('pro.scenes.timing.partN', { n: part.index })} — ${t('pro.scenes.timing.fadeIn')}`} onChange={(v) => update({ parts: updatePart(cue, part.index, { fade: v }) })} />
                  <LabeledTime label={t('pro.scenes.timing.fadeOut')} value={part.fadeOut} inherited={cue.fadeOut} aria={`${t('pro.scenes.timing.partN', { n: part.index })} — ${t('pro.scenes.timing.fadeOut')}`} onChange={(v) => update({ parts: updatePart(cue, part.index, { fadeOut: v }) })} />
                  <LabeledTime label={t('pro.scenes.timing.delay')} value={part.delay} inherited={cue.delay} aria={`${t('pro.scenes.timing.partN', { n: part.index })} — ${t('pro.scenes.timing.delay')}`} onChange={(v) => update({ parts: updatePart(cue, part.index, { delay: v }) })} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs tabular text-fg-tertiary">{t('pro.scenes.timing.valuesCount', { count: byPart.get(part.index) ?? 0 })}</span>
                  <DropdownMenu
                    placement="bottom-end"
                    items={() => partMenu(cuelistId, cue.id, part.index, byFeature, featureOf)}
                    trigger={(p) => <Button {...p} size="xs" variant="ghost" icon={LuListTree} tooltip={t('pro.scenes.timing.assignTitle', { n: part.index })}>{t('pro.scenes.timing.assign')}</Button>}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('pro.scenes.timing.trigger')} className={sectionClass}>
        <SegmentedControl<'after-fade' | 'after-go'>
          size="sm"
          fullWidth
          aria-label={t('pro.scenes.trigger.aria', { number })}
          value={cue.followMode === 'after-go' ? 'after-go' : 'after-fade'}
          onChange={(m) => update({ followMode: m === 'after-go' ? 'after-go' : undefined })}
          items={[
            { value: 'after-fade', label: t('pro.scenes.trigger.afterFade') },
            { value: 'after-go', label: t('pro.scenes.trigger.afterGo') }
          ]}
        />
        <p className="text-xs text-fg-tertiary">{cue.followTime === null ? t('pro.scenes.trigger.manual') : t('pro.scenes.trigger.hint')}</p>
        <Switch
          checked={cue.block === true}
          onChange={(v) => update({ block: v ? true : undefined })}
          label={t('pro.scenes.timing.block')}
          description={t('pro.scenes.timing.blockHint')}
        />
      </Section>
    </div>
  )
}

function FeatureRow({ feature, label, count, fade, delay, cueFade, cueDelay, onFade, onDelay, onReset }: {
  feature: CueFeature
  label: string
  count: number
  fade: number | undefined
  delay: number | undefined
  cueFade: number
  cueDelay: number
  onFade: (v: number | undefined) => void
  onDelay: (v: number | undefined) => void
  onReset: () => void
}) {
  const t = useT()
  const set = fade !== undefined || delay !== undefined
  return (
    <>
      <span data-feature-row={feature} className={cn('flex min-w-0 flex-col', count === 0 && !set && 'opacity-60')}>
        <span className="truncate text-sm text-fg-primary">{label}</span>
        <span className="truncate font-mono text-2xs tabular text-fg-tertiary">{t('pro.scenes.timing.valuesCount', { count })}</span>
      </span>
      <TimeSlot value={fade} inherited={cueFade} aria={t('pro.scenes.timing.fadeAria', { feature: label })} onChange={onFade} />
      <TimeSlot value={delay} inherited={cueDelay} aria={t('pro.scenes.timing.delayAria', { feature: label })} onChange={onDelay} />
      {set ? <IconButton icon={LuRotateCcw} size="xs" label={t('pro.scenes.timing.reset')} onClick={onReset} /> : <span />}
    </>
  )
}

function LabeledTime({ label, value, inherited, aria, onChange }: {
  label: string
  value: number | undefined
  inherited: number
  aria: string
  onChange: (v: number | undefined) => void
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{label}</span>
      <TimeSlot value={value} inherited={inherited} aria={aria} onChange={onChange} clearable />
    </span>
  )
}

/** A time that may inherit: greyed inherited value (tap = set it), else a number field */
function TimeSlot({ value, inherited, aria, onChange, clearable }: {
  value: number | undefined
  inherited: number
  aria: string
  onChange: (v: number | undefined) => void
  clearable?: boolean
}) {
  const t = useT()
  if (value === undefined) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start border border-dashed border-line px-1.5 font-mono text-fg-tertiary"
        aria-label={aria}
        tooltip={t('pro.scenes.featureTimingNone')}
        onClick={() => onChange(inherited)}
      >
        <span className="truncate">{formatSeconds(inherited)}</span>
      </Button>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <NumberField size="sm" className="min-w-0 flex-1" value={value} onChange={onChange} min={0} max={MAX_TIME} step={0.1} unit={t('units.seconds')} aria-label={aria} />
      {clearable && <IconButton icon={LuX} size="xs" label={t('pro.scenes.timing.reset')} onClick={() => onChange(undefined)} />}
    </span>
  )
}

/** "Channels…" menu of a part — built when it opens (current language, current values) */
function partMenu(
  cuelistId: string,
  cueId: string,
  partIndex: number,
  byFeature: Record<CueFeature, number>,
  featureOf: (fixtureId: string, channelName: string) => CueFeature
): MenuEntry[] {
  const current = () => usePlaybackStore.getState().cuelists.find((c) => c.id === cuelistId)?.cues.find((q) => q.id === cueId)
  const apply = (feature: CueFeature | null) => {
    const cue = current()
    if (!cue) return
    const values = assignToPart(cue, partIndex, feature, featureOf)
    if (values !== cue.values) usePlaybackStore.getState().updateCue(cuelistId, cueId, { values })
  }
  const backToCue = () => {
    const cue = current()
    if (!cue || !cue.values.some((v) => v.part === partIndex)) return
    // Same as removing the part, keeping the part itself
    usePlaybackStore.getState().updateCue(cuelistId, cueId, { values: removePart(cue, partIndex).values })
  }
  return [
    { type: 'label', label: translate('pro.scenes.timing.assignTitle', { n: partIndex }) },
    ...CUE_FEATURES.filter((f) => byFeature[f] > 0).map((f): MenuEntry => ({
      label: translate('pro.scenes.timing.assignFeature', { feature: featureLabel(f) }),
      description: translate('pro.scenes.timing.valuesCount', { count: byFeature[f] }),
      onSelect: () => apply(f)
    })),
    { type: 'separator' },
    { label: translate('pro.scenes.timing.assignAll'), onSelect: () => apply(null) },
    { label: translate('pro.scenes.timing.backToMain'), onSelect: backToCue }
  ]
}
