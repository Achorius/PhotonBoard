// ============================================================
// Scene settings › Advanced (Pro view): tracking, move in black,
// rate, priority mode, speed master. Collapsible; opens by itself
// when the scene uses one of them. Plain cuelist updates (automatic
// undo); the engines read these fields at GO time.
// ============================================================

import { LuRotateCcw } from 'react-icons/lu'
import type { Cuelist } from '@shared/types'
import { Field, IconButton, NumberField, Section, SegmentedControl, Select, Switch } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { DEFAULT_MIB, MAX_TIME, RATE_MAX, RATE_MIN, cleanRate, hasAdvancedSettings, nextMib } from './pro-cue'

type PriorityMode = NonNullable<Cuelist['priorityMode']>

export function SceneAdvanced({ cuelist: cl }: { cuelist: Cuelist }) {
  const t = useT()
  const speedMasters = usePoolStore((s) => s.speedMasters)
  const update = (u: Parameters<ReturnType<typeof usePlaybackStore.getState>['updateCuelist']>[1]) => usePlaybackStore.getState().updateCuelist(cl.id, u)
  const mib = cl.mib ?? DEFAULT_MIB
  const rate = cl.rate ?? 1
  const masterMissing = !!cl.speedMasterId && !speedMasters.some((m) => m.id === cl.speedMasterId)

  return (
    <Section title={t('pro.scenes.advanced.title')} collapsible defaultOpen={hasAdvancedSettings(cl)}>
      <div data-scene-advanced="" className="flex flex-col gap-3">
        <Switch
          checked={cl.tracking !== false}
          onChange={(v) => update({ tracking: v ? undefined : false })}
          label={t('pro.scenes.advanced.tracking')}
          description={t('pro.scenes.advanced.trackingHint')}
        />
        <div className="flex flex-col gap-2">
          <Switch
            checked={mib.enabled}
            onChange={(v) => update({ mib: nextMib(cl, { enabled: v }) })}
            label={t('pro.scenes.advanced.mib')}
            description={t('pro.scenes.advanced.mibHint')}
          />
          <div className="grid grid-cols-2 gap-2 pl-11">
            <NumberField
              size="sm"
              label={t('pro.scenes.advanced.mibDelay')}
              disabled={!mib.enabled}
              value={mib.delay}
              onChange={(v) => update({ mib: nextMib(cl, { delay: v }) })}
              min={0}
              max={MAX_TIME}
              step={0.1}
              unit={t('units.seconds')}
              aria-label={t('pro.scenes.advanced.mibDelay')}
            />
            <NumberField
              size="sm"
              label={t('pro.scenes.advanced.mibFade')}
              disabled={!mib.enabled}
              value={mib.fade}
              onChange={(v) => update({ mib: nextMib(cl, { fade: v }) })}
              min={0}
              max={MAX_TIME}
              step={0.1}
              unit={t('units.seconds')}
              aria-label={t('pro.scenes.advanced.mibFade')}
            />
          </div>
        </div>
        <Field layout="stacked" label={t('pro.scenes.advanced.rate')} hint={t('pro.scenes.advanced.rateHint')}>
          {(id) => (
            <div className="flex items-center gap-1">
              <div className="w-[120px]">
                <NumberField
                  id={id}
                  size="sm"
                  value={rate}
                  onChange={(v) => update({ rate: cleanRate(v) })}
                  min={RATE_MIN}
                  max={RATE_MAX}
                  step={0.05}
                  unit="×"
                  aria-label={t('pro.scenes.advanced.rate')}
                />
              </div>
              {rate !== 1 && <IconButton icon={LuRotateCcw} size="xs" label={t('pro.scenes.advanced.rateReset')} onClick={() => update({ rate: undefined })} />}
            </div>
          )}
        </Field>
        <Field layout="stacked" label={t('pro.scenes.advanced.priorityMode')} hint={t('pro.scenes.advanced.priorityHint')}>
          <SegmentedControl<PriorityMode>
            size="sm"
            aria-label={t('pro.scenes.advanced.priorityMode')}
            value={cl.priorityMode ?? 'normal'}
            onChange={(m) => update({ priorityMode: m === 'normal' ? undefined : m })}
            items={[
              { value: 'normal', label: t('pro.scenes.advanced.normal') },
              { value: 'swap', label: t('pro.scenes.advanced.swap') },
              { value: 'super', label: t('pro.scenes.advanced.super') }
            ]}
          />
        </Field>
        <Field layout="stacked" label={t('pro.scenes.advanced.speedMaster')} hint={t('pro.scenes.advanced.speedMasterHint')}>
          {(id) => (
            <Select
              id={id}
              size="sm"
              className="max-w-[240px]"
              value={masterMissing ? '' : cl.speedMasterId ?? ''}
              onChange={(v) => update({ speedMasterId: v || undefined })}
              options={[
                { value: '', label: t('pro.scenes.advanced.noSpeedMaster') },
                ...speedMasters.map((m) => ({ value: m.id, label: t('pro.scenes.advanced.speedMasterOption', { number: m.number, name: m.name || t('pro.defaults.speedMaster', { n: m.number }) }) }))
              ]}
            />
          )}
        </Field>
      </div>
    </Section>
  )
}
