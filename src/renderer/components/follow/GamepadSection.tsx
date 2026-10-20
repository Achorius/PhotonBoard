// Gamepad settings: status, activation (hold / toggle), trigger button
// learn, axis inversion, and a live view of the sticks and buttons.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LuGamepad2 } from 'react-icons/lu'
import { Button, Field, Section, SegmentedControl, StatusDot, Switch, cn } from '@renderer/components/ui'
import { useFollowStore } from '@renderer/stores/follow-store'
import { XBOX_AXES, XBOX_BUTTONS, gamepadManager } from '@renderer/lib/gamepad-manager'

const BUTTON_NAMES: Record<number, string> = {
  [XBOX_BUTTONS.A]: 'A', [XBOX_BUTTONS.B]: 'B', [XBOX_BUTTONS.X]: 'X', [XBOX_BUTTONS.Y]: 'Y',
  [XBOX_BUTTONS.LB]: 'LB', [XBOX_BUTTONS.RB]: 'RB', [XBOX_BUTTONS.LT]: 'LT', [XBOX_BUTTONS.RT]: 'RT',
  [XBOX_BUTTONS.BACK]: 'Back', [XBOX_BUTTONS.START]: 'Start', [XBOX_BUTTONS.L3]: 'L3', [XBOX_BUTTONS.R3]: 'R3',
  [XBOX_BUTTONS.DPAD_UP]: 'D-pad up', [XBOX_BUTTONS.DPAD_DOWN]: 'D-pad down', [XBOX_BUTTONS.DPAD_LEFT]: 'D-pad left', [XBOX_BUTTONS.DPAD_RIGHT]: 'D-pad right',
  [XBOX_BUTTONS.HOME]: 'Home'
}

export function buttonName(i: number): string {
  return BUTTON_NAMES[i] ?? `Button ${i + 1}`
}

export function GamepadSection() {
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
    <Section title="Gamepad">
      <div className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 ring-inset', g.connected ? 'bg-go/10 ring-go/30' : 'bg-surface-2 ring-line')}>
        <LuGamepad2 size={18} aria-hidden className={g.connected ? 'text-go-fg' : 'text-fg-tertiary'} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-sm text-fg-primary">
            <StatusDot tone={g.connected ? 'go' : 'neutral'} />
            {g.connected ? 'Connected' : 'No gamepad'}
          </span>
          <span className="truncate text-xs text-fg-tertiary">{g.connected ? g.name : 'Plug in a USB / Bluetooth controller and press a button'}</span>
        </div>
      </div>

      {g.connected && <GamepadLive trigger={g.activateButton} />}

      <Field label="Activation">
        <SegmentedControl<'hold' | 'toggle'>
          fullWidth
          aria-label="Activation mode"
          value={g.activateMode}
          onChange={(activateMode) => setConfig({ activateMode })}
          items={[{ value: 'hold', label: 'Hold' }, { value: 'toggle', label: 'Toggle' }]}
        />
      </Field>
      <Field label="Trigger" hint={learning ? 'Press the button to use on the gamepad' : undefined}>
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
          {learning ? 'Press a button…' : buttonName(g.activateButton)}
        </Button>
      </Field>
      <div className="flex flex-col gap-2 pt-1">
        <Switch checked={g.invertX} onChange={(invertX) => setConfig({ invertX })} label="Invert left / right" />
        <Switch checked={g.invertY} onChange={(invertY) => setConfig({ invertY })} label="Invert height" />
        <Switch checked={g.invertZ} onChange={(invertZ) => setConfig({ invertZ })} label="Invert depth" />
      </div>
    </Section>
  )
}

/** Sticks and pressed buttons, sampled at ~15 Hz */
function GamepadLive({ trigger }: { trigger: number }) {
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
      <Stick label="Left" x={ax(XBOX_AXES.LEFT_X)} y={ax(XBOX_AXES.LEFT_Y)} />
      <Stick label="Right" x={ax(XBOX_AXES.RIGHT_X)} y={ax(XBOX_AXES.RIGHT_Y)} />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {state.pressed.length === 0
          ? <span className="text-xs text-fg-tertiary">No button pressed</span>
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
