// ============================================================
// Follow spot: several moving heads converge on one target that the
// operator drives with the stage pad (finger / mouse) or a gamepad.
//   left   fixtures in the follow group (pan/tilt ranges, positions)
//   centre stage pad (top view) + height fader
//   right  output, movement and gamepad settings
// ============================================================

import { memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  LuCrosshair, LuGamepad2, LuHouse, LuMapPin, LuTriangleAlert, LuCable
} from 'react-icons/lu'
import {
  Badge, Button, Checkbox, EmptyState, Fader, Field, NumberField, PanelHeader, Section, Slider,
  StatusDot, cn, fixtureCategoryIcon, formatAddress, formatDegrees, formatPercent
} from '@renderer/components/ui'
import { useFollowStore } from '@renderer/stores/follow-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { FollowPad, type PadFixture } from './FollowPad'
import { GamepadSection } from './GamepadSection'

const DEFAULT_PAN = 540
const DEFAULT_TILT = 270

interface FollowFixture {
  id: string
  name: string
  address: string
  pan: number
  tilt: number
  rangesFromDef: boolean
  position: { x: number; z: number } | null
  categories: string[]
}

function useMovingHeads(): FollowFixture[] {
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  return useMemo(() => {
    const defs = new Map(fixtures.map((f) => [f.id, f]))
    return patch.flatMap((p) => {
      const def = defs.get(p.fixtureDefId)
      if (!def?.categories.includes('Moving Head')) return []
      const pan = Number(def.physical?.panRange)
      const tilt = Number(def.physical?.tiltRange)
      const fromDef = Number.isFinite(pan) && pan > 0 && Number.isFinite(tilt) && tilt > 0
      return [{
        id: p.id,
        name: p.name,
        address: formatAddress(p.universe, p.address),
        pan: Number.isFinite(pan) && pan > 0 ? pan : DEFAULT_PAN,
        tilt: Number.isFinite(tilt) && tilt > 0 ? tilt : DEFAULT_TILT,
        rangesFromDef: fromDef,
        position: p.position3D ? { x: p.position3D.x, z: p.position3D.z } : null,
        categories: def.categories
      }]
    })
  }, [patch, fixtures])
}

export function FollowPanel() {
  const heads = useMovingHeads()
  const { fixtureIds, active, gamepadConnected } = useFollowStore(useShallow((s) => ({ fixtureIds: s.fixtureIds, active: s.active, gamepadConnected: s.gamepadConnected })))
  const assigned = useMemo(() => new Set(fixtureIds), [fixtureIds])
  const usable = heads.filter((h) => assigned.has(h.id) && h.position).length

  const padFixtures: PadFixture[] = useMemo(
    () => heads.filter((h) => h.position).map((h) => ({ id: h.id, name: h.name, x: h.position!.x, z: h.position!.z, assigned: assigned.has(h.id) })),
    [heads, assigned]
  )

  // Leaving the view never leaves a follow running unnoticed: the top bar shows it (FollowIndicator)
  const toggle = () => {
    const st = useFollowStore.getState()
    if (st.active) st.deactivate()
    else st.activate({ keepTarget: true })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-control-lg shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface-1 px-3 py-1.5">
        <LuCrosshair size={16} aria-hidden className="text-fg-tertiary" />
        <h1 className="text-sm font-semibold">Follow spot</h1>
        <Badge tone={active ? 'go' : 'neutral'} variant={active ? 'solid' : 'subtle'}>{active ? 'TRACKING' : 'STANDBY'}</Badge>
        <span className="text-xs text-fg-tertiary">{fixtureIds.length} fixture{fixtureIds.length === 1 ? '' : 's'} in the group</span>
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
          <LuGamepad2 size={14} aria-hidden className="text-fg-tertiary" />
          <StatusDot tone={gamepadConnected ? 'go' : 'neutral'} />
          {gamepadConnected ? 'Gamepad ready' : 'No gamepad'}
        </span>
        <Button
          data-follow-activate
          size="lg"
          tone="go"
          variant={active ? 'secondary' : 'success'}
          active={active}
          icon={LuCrosshair}
          disabled={!active && usable === 0}
          tooltip={usable === 0 ? 'Add fixtures that have a stage position' : active ? 'Release the fixtures' : 'Aim the group at the target'}
          onClick={toggle}
          className="min-w-[156px]"
        >
          {active ? 'Stop follow' : 'Start follow'}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <FixturesColumn heads={heads} assigned={assigned} />
        <PadColumn fixtures={padFixtures} hasFixtures={heads.length > 0} />
        <SettingsColumn />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Fixtures

function FixturesColumn({ heads, assigned }: { heads: FollowFixture[]; assigned: Set<string> }) {
  const st = useFollowStore.getState
  return (
    <aside aria-label="Follow fixtures" className="flex w-[256px] shrink-0 flex-col border-r border-line bg-surface-1 xl:w-[300px] xl:[[data-density=touch]_&]:w-[340px]">
      <PanelHeader
        title="Fixtures"
        count={heads.length > 0 ? `${heads.filter((h) => assigned.has(h.id)).length} of ${heads.length}` : undefined}
        actions={heads.length > 0 && (
          <>
            <Button size="xs" variant="ghost" onClick={() => heads.forEach((h) => st().addFixture(h.id))}>All</Button>
            <Button size="xs" variant="ghost" onClick={() => heads.forEach((h) => st().removeFixture(h.id))}>None</Button>
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {heads.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuCable}
            title="No moving heads patched"
            description="Follow aims moving heads at a target. Patch some first."
            action={<Button size="sm" variant="primary" onClick={() => useUiStore.getState().setActiveTab('patch')}>Open Patch</Button>}
          />
        ) : heads.map((h) => <FixtureRow key={h.id} fixture={h} checked={assigned.has(h.id)} />)}
      </div>
      <p className="shrink-0 border-t border-line-subtle px-3 py-2 text-xs text-fg-tertiary">
        Aiming uses each fixture&apos;s stage position and its pan / tilt range.
      </p>
    </aside>
  )
}

const FixtureRow = memo(function FixtureRow({ fixture: f, checked }: { fixture: FollowFixture; checked: boolean }) {
  const Icon = fixtureCategoryIcon(f.categories)
  const toggle = () => {
    const st = useFollowStore.getState()
    if (checked) st.removeFixture(f.id)
    else st.addFixture(f.id)
  }
  return (
    <div
      data-follow-fixture={f.id}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() } }}
      className={cn('relative flex min-h-row cursor-pointer items-center gap-2.5 px-3 py-1.5', checked ? 'bg-info/10 hover:bg-info/15' : 'hover:bg-surface-2')}
    >
      <span onClick={(e) => e.stopPropagation()} className="flex">
        <Checkbox checked={checked} onChange={toggle} aria-label={`Follow with ${f.name}`} />
      </span>
      <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-fg-primary">{f.name}</span>
          <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{f.address}</span>
        </span>
        <span className="truncate text-xs text-fg-tertiary" title={f.rangesFromDef ? 'From the fixture profile' : 'Profile has no range: default used'}>
          Pan {formatDegrees(f.pan)} · Tilt {formatDegrees(f.tilt)}{f.rangesFromDef ? '' : ' (default)'}
        </span>
      </div>
      {!f.position && (
        <Badge size="xs" tone="warning" icon={LuTriangleAlert} title="Place it in Stage layout so follow can aim it">NO POSITION</Badge>
      )}
    </div>
  )
})

// ---------------------------------------------------------------- Pad

function PadColumn({ fixtures, hasFixtures }: { fixtures: PadFixture[]; hasFixtures: boolean }) {
  const roomHeight = useVisualizerStore((s) => s.roomConfig.height)
  const targetY = useFollowStore((s) => s.targetY)
  const home = useFollowStore((s) => s.targetHeight)
  const missingPositions = hasFixtures && fixtures.length === 0
  return (
    <section aria-label="Stage pad" className="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        icon={LuMapPin}
        title="Target"
        subtitle="Stage seen from above — drag to aim · Shift / second finger = fine"
        actions={
          <Button size="sm" variant="secondary" icon={LuHouse} tooltip={`Centre stage at ${home.toFixed(1)} m`}
            onClick={() => useFollowStore.getState().setTarget(0, home, 0)}>Centre</Button>
        }
      />
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {missingPositions ? (
          <EmptyState
            icon={LuMapPin}
            title="Moving heads have no stage position"
            description="Place them in Stage layout: follow needs to know where each one hangs."
            action={<Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('stage-layout')}>Open Stage layout</Button>}
          />
        ) : (
          <>
            <FollowPad fixtures={fixtures} />
            <div className="flex shrink-0 flex-col items-center gap-2 pb-6 pt-5">
              <Fader
                aria-label="Target height"
                value={targetY}
                min={0}
                max={Math.max(1, roomHeight)}
                step={0.05}
                defaultValue={home}
                readout={(v) => v.toFixed(2)}
                onChange={(v) => { const st = useFollowStore.getState(); st.setTarget(st.targetX, v, st.targetZ) }}
                className="min-h-0 flex-1"
              />
              <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Height m</span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Settings

function SettingsColumn() {
  const cfg = useFollowStore(useShallow((s) => ({
    followDimmer: s.followDimmer, sensitivity: s.sensitivity, targetHeight: s.targetHeight
  })))
  const setConfig = useFollowStore.getState().setConfig
  /** Re-apply the output when follow is running (dimmer changes) */
  const reapply = () => {
    const st = useFollowStore.getState()
    if (st.active) st.setTarget(st.targetX, st.targetY, st.targetZ)
  }
  return (
    <aside aria-label="Follow settings" className="flex w-[272px] shrink-0 flex-col border-l border-line bg-surface-1 xl:w-[320px] xl:[[data-density=touch]_&]:w-[360px]">
      <PanelHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Output">
          <Field label="Dimmer">
            <Slider aria-label="Follow dimmer" value={cfg.followDimmer} min={0} max={255} defaultValue={255}
              showValue={(v) => formatPercent(v)} onChange={(v) => { setConfig({ followDimmer: Math.round(v) }); reapply() }} />
          </Field>
        </Section>
        <Section title="Movement">
          <Field label="Speed" hint="Gamepad: metres per second at full stick">
            <Slider aria-label="Gamepad speed" value={cfg.sensitivity} min={0.5} max={12} step={0.5} defaultValue={8}
              showValue={(v) => v.toFixed(1)} onChange={(v) => setConfig({ sensitivity: v })} />
          </Field>
          <Field label="Home height" hint="Height used by Centre (1.5 m ≈ chest)">
            <NumberField aria-label="Home height" value={cfg.targetHeight} min={0} max={10} step={0.1} unit="m" onChange={(v) => setConfig({ targetHeight: v })} />
          </Field>
        </Section>
        <GamepadSection />
        <Section title="How it works" collapsible defaultOpen={false}>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-fg-secondary">
            <li>Tick the moving heads that should follow, and place them in Stage layout.</li>
            <li>Start follow (or hold the gamepad trigger), then drag on the pad.</li>
            <li>Left stick: left / right and height. Right stick: depth.</li>
            <li>Stopping gives the fixtures back to what they were doing.</li>
          </ul>
        </Section>
      </div>
    </aside>
  )
}
