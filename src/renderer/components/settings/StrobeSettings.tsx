// Settings → Outputs: what the Strobe and Blinder keys do, and the strobe
// rate (top bar, Stage window, remotes, MIDI controllers all use these).

import { LuZap } from 'react-icons/lu'
import { SegmentedControl, Slider } from '@renderer/components/ui'
import { useDmxStore, STROBE_RATE_MAX, STROBE_RATE_MIN, type StrobeMode } from '@renderer/stores/dmx-store'
import { useT } from '@renderer/i18n'
import { SettingRow, SettingsCard } from './settings-ui'

export function StrobeSettingsCard() {
  const t = useT()
  const rate = useDmxStore((s) => s.strobeRate)
  const mode = useDmxStore((s) => s.strobeMode)
  return (
    <SettingsCard icon={LuZap} title={t('settings.strobe.title')} subtitle={t('settings.strobe.subtitle')}>
      <SettingRow label={t('settings.strobe.mode')} description={mode === 'look' ? t('settings.strobe.modeLookHint') : t('settings.strobe.modeWhiteHint')}>
        <SegmentedControl<StrobeMode>
          aria-label={t('settings.strobe.mode')}
          size="md"
          value={mode}
          onChange={(m) => useDmxStore.getState().setStrobeMode(m)}
          items={[{ value: 'white', label: t('settings.strobe.modeWhite') }, { value: 'look', label: t('settings.strobe.modeLook') }]}
        />
      </SettingRow>
      <SettingRow label={t('settings.strobe.rate')} description={t('settings.strobe.rateHint')}>
        <div data-strobe-rate className="flex w-56 items-center gap-2">
          <Slider
            aria-label={t('settings.strobe.rate')}
            value={rate}
            min={STROBE_RATE_MIN}
            max={STROBE_RATE_MAX}
            step={1}
            defaultValue={10}
            onChange={(v) => useDmxStore.getState().setStrobeRate(v)}
            showValue={(v) => t('settings.strobe.rateValue', { value: Math.round(v) })}
            className="flex-1"
          />
        </div>
      </SettingRow>
      <p className="border-t border-line-subtle px-4 py-3 text-xs text-fg-tertiary">{t('settings.strobe.blinderHint')}</p>
    </SettingsCard>
  )
}
