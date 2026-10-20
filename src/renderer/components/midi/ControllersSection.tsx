// Recognised controllers (APC mini, Launchpad…): profile on/off, layout,
// fader pickup / jump, exact RGB colours, Test LEDs and the controller map.
// Machine settings (localStorage), never saved in the show.

import { memo, useState } from 'react'
import { LuLayoutGrid, LuLightbulb, LuTriangleAlert } from 'react-icons/lu'
import { Button, Field, Modal, SegmentedControl, Select, StatusDot, Switch, cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useControllerStore, type DetectedController } from '@renderer/stores/controller-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import type { ControllerLayoutId, ControllerSettings } from '@renderer/lib/midi/controller-types'
import { CONTROLLER_LAYOUTS } from '@renderer/lib/midi/layouts'
import { effectiveProfile, getProfile } from '@renderer/lib/midi/profiles'
import { testControllerLeds } from '@renderer/lib/midi/controller-runtime'
import { ControllerMap } from './ControllerMap'

export function ControllersSection({ label }: { label: React.ReactNode }) {
  const detected = useControllerStore((s) => s.detected)
  if (detected.length === 0) return null
  return (
    <div data-midi-controllers>
      {label}
      <div className="flex flex-col gap-2 px-2 pb-2">
        {detected.map((d) => <ControllerCard key={d.port} detected={d} />)}
      </div>
    </div>
  )
}

const ControllerCard = memo(function ControllerCard({ detected }: { detected: DetectedController }) {
  const t = useT()
  const settings = useControllerStore((s) => s.settings.find((x) => x.port === detected.port))
  const testing = useControllerStore((s) => s.testing === detected.port)
  const handMapped = useMidiStore((s) => s.mappings.some((m) => m.source.deviceName === detected.port))
  const [mapOpen, setMapOpen] = useState(false)
  const profile = getProfile(detected.profileId)
  if (!profile || !settings) return null
  const update = (patch: Partial<Omit<ControllerSettings, 'port'>>) => useControllerStore.getState().updateSettings(detected.port, patch)
  const live = detected.connected && settings.enabled

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-2.5">
      <div className="flex items-start gap-2">
        <StatusDot tone={live ? 'go' : 'neutral'} label={detected.connected ? undefined : t('pro.midi.controllers.disconnected')} className="mt-1.5" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-fg-primary" title={profile.name}>{t('pro.midi.controllers.recognised', { name: profile.name })}</span>
          <span className="truncate font-mono text-xs text-fg-tertiary" title={detected.port}>{detected.connected ? detected.port : t('pro.midi.controllers.disconnected')}</span>
        </div>
      </div>

      <Switch
        checked={settings.enabled}
        onChange={(enabled) => update({ enabled })}
        label={t('pro.midi.controllers.enable')}
        description={!settings.enabled && handMapped ? t('pro.midi.controllers.handMapped') : undefined}
      />

      {settings.enabled && (
        <>
          <Field layout="stacked" label={t('pro.midi.controllers.layout')} hint={t(`pro.midi.controllers.layoutHint.${settings.layout}`)}>
            {(fid) => (
              <Select<ControllerLayoutId>
                id={fid}
                value={settings.layout}
                onChange={(layout) => update({ layout })}
                options={CONTROLLER_LAYOUTS.filter((l) => profile.defaultLayouts.includes(l)).map((l) => ({ value: l, label: t(`pro.midi.controllers.layoutName.${l}`) }))}
              />
            )}
          </Field>
          {!profile.motorFaders && profile.controls.some((c) => c.kind === 'fader') && (
            <Field layout="stacked" label={t('pro.midi.controllers.faders')} hint={settings.takeover === 'pickup' ? t('pro.midi.controllers.pickupHint') : t('pro.midi.controllers.jumpHint')}>
              <SegmentedControl<'pickup' | 'jump'>
                fullWidth
                compact
                size="sm"
                aria-label={t('pro.midi.controllers.faders')}
                value={settings.takeover}
                onChange={(takeover) => update({ takeover })}
                items={[{ value: 'pickup', label: t('pro.midi.controllers.pickup') }, { value: 'jump', label: t('pro.midi.controllers.jump') }]}
              />
            </Field>
          )}
          {profile.rgbCapable && (
            <Switch checked={!!settings.rgbLeds} onChange={(rgbLeds) => update({ rgbLeds })} label={t('pro.midi.controllers.rgb')} description={t('pro.midi.controllers.rgbHint')} />
          )}
          {detected.connected && !detected.outputPort && (
            <p className="flex items-start gap-1.5 text-xs text-warning-fg"><LuTriangleAlert size={14} aria-hidden className="mt-px shrink-0" />{t('pro.midi.controllers.noOutput')}</p>
          )}
          {profile.id === 'korg-nanokontrol2' && <p className="text-xs text-fg-tertiary">{t('pro.midi.controllers.nanoLedMode')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={LuLightbulb}
              disabled={!live || !detected.outputPort}
              active={testing}
              className={cn(testing && 'animate-pulse')}
              onClick={() => testControllerLeds(detected.port)}
            >
              {testing ? t('pro.midi.controllers.testing') : t('pro.midi.controllers.testLeds')}
            </Button>
            <Button size="sm" variant="secondary" icon={LuLayoutGrid} onClick={() => setMapOpen(true)}>{t('pro.midi.controllers.map')}</Button>
          </div>
        </>
      )}

      {mapOpen && (
        <Modal open onClose={() => setMapOpen(false)} title={t('pro.midi.controllers.mapTitle', { name: profile.name })} description={t(`pro.midi.controllers.layoutHint.${settings.layout}`)} size="lg">
          <ControllerMap profile={effectiveProfile(profile, settings)} layout={settings.layout} port={detected.port} />
        </Modal>
      )}
    </div>
  )
})
