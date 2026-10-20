// Gamepad settings: status, activation (hold / toggle), trigger button
// learn, axis inversion, and a live view of the sticks and buttons.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LuGamepad2 } from 'react-icons/lu'
import { Button, Field, Section, SegmentedControl, StatusDot, Switch, cn } from '@renderer/components/ui'
import { t as translate, useT, type TranslationKey } from '@renderer/i18n'
import { useFollowStore } from '@renderer/stores/follow-store'
import { XBOX_AXES, XBOX_BUTTONS, gamepadManager } from '@renderer/lib/gamepad-manager'

/** Labels printed on the controller (same in every language) */
const BUTTON_NAMES: Record<number, string> = {
  [XBOX_BUTTONS.A]: 'A', [XBOX_BUTTONS.B]: 'B', [XBOX_BUTTONS.X]: 'X', [XBOX_BUTTONS.Y]: 'Y',
  [XBOX_BUTTONS.LB]: 'LB', [XBOX_BUTTONS.RB]: 'RB', [XBOX_BUTTONS.LT]: 'LT', [XBOX_BUTTONS.RT]: 'RT',
  [XBOX_BUTTONS.BACK]: 'Back', [XBOX_BUTTONS.START]: 'Start', [XBOX_BUTTONS.L3]: 'L3', [XBOX_BUTTONS.R3]: 'R3',
  [XBOX_BUTTONS.HOME]: 'Home'
}

/** D-pad directions: translated (keys, evaluated when called) */
const DPAD_KEYS: Record<number, TranslationKey> = {
  [XBOX_BUTTONS.DPAD_UP]: 'follow.gamepad.dpadUp', [XBOX_BUTTONS.DPAD_DOWN]: 'follow.gamepad.dpadDown',
  [XBOX_BUTTONS.DPAD_LEFT]: 'follow.gamepad.dpadLeft', [XBOX_BUTTONS.DPAD_RIGHT]: 'follow.gamepad.dpadRight'
}

export function buttonName(i: number): string {
  const dpad = DPAD_KEYS[i]
  if (dpad) return translate(dpad)
  return BUTTON_NAMES[i] ?? translate('follow.gamepad.buttonN', { n: i + 1 })
}

export function GamepadSection() {
  const t = useT()
  const g = useFollowStore(useShallow((s) => ({
    connected: s.gamepadConnected, name: s.gamepadName, activateButton: s.activateButton, activateMode: s.activateMode,
    invertX: s.invertX, invertY: s.invertY, invertZ: s.invertZ
  })))
  const setConfig = useFollowStore.getState().setConfig
  const [learning, setLearning] = useState(false)

  // Trigger learn: the next pressed button becomes the trigger
  useEffect(() => {
    if (!learning) return
    const pressedAtStart = new Set((gamepadManager.getRawGamepad()?.buttons ?? []).map((b, i) => (b.pressed ? i : -1)))
    const id = setInterval(() => {
      const gp = gamepadManager.getRawGamepad()
      if (!gp) return
      const i = gp.buttons.findIndex((b, idx) => b.pressed && !pressedAtStart.has(idx))
      if (i >= 0) { setConfig({ activateButton: i }); setLearning(false) }
    }, 50)
    return () => clearInterval(id)
  }, [learning, setConfig])

  return (
    <Section title={t('follow.gamepad.title')}>
      <div className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 ring-inset', g.connected ? 'bg-go/10 ring-go/30' : 'bg-surface-2 ring-line')}>
        <LuGamepad2 size={18} aria-hidden className={g.connected ? 'text-go-fg' : 'text-fg-tertiary'} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-sm text-fg-primary">
            <StatusDot tone={g.connected ? 'go' : 'neutral'} />
            {g.connected ? t('follow.gamepad.connected') : t('follow.gamepad.none')}
          </span>
          <span className="truncate text-xs text-fg-tertiary" title={g.connected ? g.name : t('follow.gamepad.plugIn')}>{g.connected ? g.name : t('follow.gamepad.plugIn')}</span>
        </div>
      </div>

      {g.connected && <GamepadLive trigger={g.activateButton} />}

      <Field label={t('follow.gamepad.activation')}>
        <SegmentedControl<'hold' | 'toggle'>
          fullWidth
          aria-label={t('follow.gamepad.activationAria')}
          value={g.activateMode}
          onChange={(activateMode) => setConfig({ activateMode })}
          items={[{ value: 'hold', label: t('follow.gamepad.hold') }, { value: 'toggle', label: t('follow.gamepad.toggle') }]}
        />
      </Field>
      <Field label={t('follow.gamepad.trigger')} hint={learning ? t('follow.gamepad.triggerHint') : undefined}>
        <Button
          size="sm"
          variant="secondary"
          tone="midi"
          active={learning}
          fullWidth
          onClick={() => setLearning(!learning)}
          className={cn('justify-between font-mono', learning && 'animate-pulse')}
          disabled={!g.connected && !learning}
        >
          {learning ? t('follow.gamepad.pressButton') : buttonName(g.activateButton)}
        </Button>
      </Field>
      <div className="flex flex-col gap-2 pt-1">
        <Switch checked={g.invertX} onChange={(invertX) => setConfig({ invertX })} label={t('follow.gamepad.invertX')} />
        <Switch checked={g.invertY} onChange={(invertY) => setConfig({ invertY })} label={t('follow.gamepad.invertY')} />
        <Switch checked={g.invertZ} onChange={(invertZ) => setConfig({ invertZ })} label={t('follow.gamepad.invertZ')} />
      </div>
    </Section>
  )
}

/** Sticks and pressed buttons, sampled at ~15 Hz */
function GamepadLive({ trigger }: { trigger: number }) {
  const t = useT()
  const [state, setState] = useState<{ axes: number[]; pressed: number[] }>({ axes: [], pressed: [] })
  useEffect(() => {
    const id = setInterval(() => {
      const s = gamepadManager.lastState
      if (!s?.connected) return
      const axes = s.axes.map((a) => Math.round(a * 20) / 20)
      const pressed = s.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0)
      setState((prev) => (prev.axes.join() === axes.join() && prev.pressed.join() === pressed.join() ? prev : { axes, pressed }))
    }, 66)
    return () => clearInterval(id)
  }, [])
  const ax = (i: number) => state.axes[i] ?? 0
  return (
    <div className="flex items-center gap-3">
      <Stick label={t('follow.gamepad.leftStick')} x={ax(XBOX_AXES.LEFT_X)} y={ax(XBOX_AXES.LEFT_Y)} />
      <Stick label={t('follow.gamepad.rightStick')} x={ax(XBOX_AXES.RIGHT_X)} y={ax(XBOX_AXES.RIGHT_Y)} />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {state.pressed.length === 0
          ? <span className="text-xs text-fg-tertiary">{t('follow.gamepad.noButton')}</span>
          : state.pressed.map((i) => (
            <span key={i} className={cn('rounded-sm px-1.5 py-0.5 font-mono text-2xs', i === trigger ? 'bg-go text-on-go' : 'bg-surface-4 text-fg-primary')}>{buttonName(i)}</span>
          ))}
      </div>
    </div>
  )
}

function Stick({ label, x, y }: { label: string; x: number; y: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-12 w-12 rounded-full bg-surface-0 ring-1 ring-inset ring-line">
        <span className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-line-subtle" />
        <span className="absolute left-1/2 top-1/2 h-full w-px -translate-y-1/2 bg-line-subtle" />
        <span
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-info-fg"
          style={{ left: `${50 + x * 40}%`, top: `${50 + y * 40}%` }}
        />
      </div>
      <span className="text-2xs text-fg-tertiary">{label}</span>
    </div>
  )
}
