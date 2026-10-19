// Master section of the top bar: Grand Master, Strobe / Blinder (hold),
// Blackout (latching). Field-level subscriptions only.

import { useCallback } from 'react'
import type React from 'react'
import { LuPower, LuSun, LuZap } from 'react-icons/lu'
import type { MidiTargetType } from '@shared/types'
import { Button, Slider, Tooltip, cn } from '@renderer/components/ui'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useMidiStore } from '@renderer/stores/midi-store'

/** Right-click / long-press a control to MIDI-learn it; violet outline = mapped, pulsing = learning */
export function useMidiLearnTarget(type: MidiTargetType, label: string) {
  const mapped = useMidiStore((s) => s.mappings.some((m) => m.target.type === type))
  const learning = useMidiStore((s) => s.isLearning && s.learnTarget?.type === type)
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const midi = useMidiStore.getState()
    if (midi.isLearning && midi.learnTarget?.type === type) midi.cancelLearn()
    else midi.startLearn({ type, label })
  }, [type, label])
  // outline (not ring): buttons already use ring for their own borders
  const ring = learning
    ? 'outline outline-2 -outline-offset-2 outline-midi-fg animate-pulse'
    : mapped ? 'outline outline-1 -outline-offset-1 outline-midi-fg/70' : undefined
  return { onContextMenu, ring, learning }
}

function GrandMaster() {
  const grandMaster = useDmxStore((s) => s.grandMaster)
  const setGrandMaster = useDmxStore((s) => s.setGrandMaster)
  const midi = useMidiLearnTarget('master', 'Grand Master')
  const pct = Math.round((grandMaster / 255) * 100)
  return (
    <Tooltip content="Grand Master — double-click: full · right-click: MIDI learn">
      <div
        onContextMenu={midi.onContextMenu}
        className={cn('flex h-control items-center gap-2 rounded bg-surface-0 pl-2.5 pr-2 ring-1 ring-inset ring-line', midi.ring)}
      >
        <span className="text-2xs font-bold tracking-[0.08em] text-fg-tertiary">GM</span>
        <Slider
          aria-label="Grand Master"
          value={grandMaster}
          onChange={setGrandMaster}
          defaultValue={255}
          color={pct < 100 ? 'rgb(var(--pb-warning))' : 'rgb(var(--pb-fg-secondary))'}
          className="w-20 xl:w-28 xl:[[data-density=touch]_&]:w-36"
        />
        <span className={cn('w-9 text-right font-mono text-xs tabular', pct < 100 ? 'text-warning-fg' : 'text-fg-secondary')}>{pct}%</span>
      </div>
    </Tooltip>
  )
}

export function MasterControls() {
  const blackout = useDmxStore((s) => s.blackout)
  const strobe = useDmxStore((s) => s.strobe)
  const blinder = useDmxStore((s) => s.blinder)
  const strobeMidi = useMidiLearnTarget('strobe', 'Strobe')
  const blinderMidi = useMidiLearnTarget('blinder', 'Blinder')
  const blackoutMidi = useMidiLearnTarget('blackout', 'Blackout')
  const dmx = useDmxStore.getState

  return (
    <div className="flex items-center gap-1.5">
      <GrandMaster />
      <Button
        icon={LuZap}
        tone="info"
        active={strobe}
        onPress={() => dmx().toggleStrobe(true)}
        onRelease={() => dmx().toggleStrobe(false)}
        onContextMenu={strobeMidi.onContextMenu}
        tooltip="Strobe — hold · right-click: MIDI learn"
        aria-label="Strobe (hold)"
        labelClassName="hidden xl:inline"
        className={strobeMidi.ring}
      >
        Strobe
      </Button>
      <Button
        icon={LuSun}
        tone="warning"
        active={blinder}
        onPress={() => dmx().toggleBlinder(true)}
        onRelease={() => dmx().toggleBlinder(false)}
        onContextMenu={blinderMidi.onContextMenu}
        tooltip="Blinder — hold for full white · right-click: MIDI learn"
        aria-label="Blinder (hold)"
        labelClassName="hidden xl:inline"
        className={blinderMidi.ring}
      >
        Blinder
      </Button>
      <Button
        icon={LuPower}
        variant="danger-outline"
        tone="danger"
        active={blackout}
        onClick={() => dmx().toggleBlackout()}
        onContextMenu={blackoutMidi.onContextMenu}
        tooltip="Blackout · right-click: MIDI learn"
        shortcut="Esc"
        className={cn(
          'w-[128px] font-bold uppercase tracking-[0.06em]',
          blackoutMidi.ring
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          Blackout
          {blackout && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white animate-blink" />}
        </span>
      </Button>
    </div>
  )
}

/** Full-width strip while Blackout is on: the stage is dark, make it impossible to miss */
export function BlackoutBanner() {
  const blackout = useDmxStore((s) => s.blackout)
  if (!blackout) return null
  return (
    <div role="alert" className="flex h-6 shrink-0 items-center justify-center gap-2 bg-danger text-2xs font-bold uppercase tracking-[0.1em] text-on-danger">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white animate-blink" />
      Blackout — all intensity output is at zero
      <button type="button" onClick={() => useDmxStore.getState().setBlackout(false)} className="ml-2 rounded-sm px-1.5 underline-offset-2 hover:underline">
        Release (Esc)
      </button>
    </div>
  )
}
