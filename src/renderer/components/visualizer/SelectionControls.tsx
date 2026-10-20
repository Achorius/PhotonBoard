// ============================================================
// Quick programmer strip under the 3D / layout views: colour presets and
// Dim / Pan / Tilt / Zoom for the selected fixtures, group quick-select.
// Live values re-render only the small slider leaves (~25 Hz).
// ============================================================

import { memo, useMemo, useState } from 'react'
import { LuChevronDown, LuChevronUp, LuX } from 'react-icons/lu'
import type { FixtureChannel, PatchEntry } from '@shared/types'
import { Button, ColorSwatch, IconButton, Slider, Tag } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore, useDmxUniverse } from '@renderer/stores/dmx-store'
import { getChannelTypeColor } from '@renderer/lib/fixture-library'
import { rgbToColorWheelDmx } from '@renderer/lib/dmx-channel-resolver'
import { setProgrammerChannel } from '@renderer/lib/dmx-mixer'
import { useT, type TranslationKey } from '@renderer/i18n'

type Ch = { name: string; absoluteChannel: number; type: string }

const PRESETS: Array<{ label: TranslationKey; r: number; g: number; b: number }> = [
  { label: 'visualizer.quick.colours.red', r: 255, g: 0, b: 0 },
  { label: 'visualizer.quick.colours.amber', r: 255, g: 150, b: 0 },
  { label: 'visualizer.quick.colours.yellow', r: 255, g: 230, b: 0 },
  { label: 'visualizer.quick.colours.green', r: 0, g: 255, b: 0 },
  { label: 'visualizer.quick.colours.cyan', r: 0, g: 255, b: 255 },
  { label: 'visualizer.quick.colours.blue', r: 0, g: 0, b: 255 },
  { label: 'visualizer.quick.colours.magenta', r: 255, g: 0, b: 255 },
  { label: 'visualizer.quick.colours.warmWhite', r: 255, g: 200, b: 120 },
  { label: 'visualizer.quick.colours.white', r: 255, g: 255, b: 255 }
]

const SLIDERS: Array<{ label: TranslationKey; names: string[] }> = [
  { label: 'visualizer.quick.sliders.dim', names: ['dimmer', 'intensity'] },
  { label: 'visualizer.quick.sliders.pan', names: ['pan'] },
  { label: 'visualizer.quick.sliders.tilt', names: ['tilt'] },
  { label: 'visualizer.quick.sliders.zoom', names: ['zoom'] }
]

function findCh(channels: Ch[], names: string[]): Ch | undefined {
  return channels.find((c) => names.includes(c.name.toLowerCase()))
}

function applyColor(entries: PatchEntry[], r: number, g: number, b: number): void {
  const store = usePatchStore.getState()
  const values = useDmxStore.getState().values
  for (const entry of entries) {
    const channels = store.getFixtureChannels(entry)
    const rCh = findCh(channels, ['red', 'r'])
    const gCh = findCh(channels, ['green', 'g'])
    const bCh = findCh(channels, ['blue', 'b'])
    if (rCh && gCh && bCh) {
      setProgrammerChannel(entry.universe, rCh.absoluteChannel, r)
      setProgrammerChannel(entry.universe, gCh.absoluteChannel, g)
      setProgrammerChannel(entry.universe, bCh.absoluteChannel, b)
    } else {
      const cw = findCh(channels, ['color wheel', 'color', 'colour wheel', 'color wheel effect'])
      if (cw) setProgrammerChannel(entry.universe, cw.absoluteChannel, rgbToColorWheelDmx(r, g, b))
    }
    // Bring up a dark fixture so the colour is visible
    const dim = findCh(channels, ['dimmer', 'intensity'])
    if (dim && (values[entry.universe]?.[dim.absoluteChannel] ?? 0) === 0) setProgrammerChannel(entry.universe, dim.absoluteChannel, 255)
  }
}

export function SelectionControls() {
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const patch = usePatchStore((s) => s.patch)
  const groups = usePatchStore((s) => s.groups)
  const [open, setOpen] = useState(true)
  const t = useT()

  const entries = useMemo(() => {
    const ids = new Set(selectedIds)
    return patch.filter((p) => ids.has(p.id))
  }, [patch, selectedIds])
  const topGroups = useMemo(() => groups.filter((g) => !g.parentGroupId && g.fixtureIds.length > 0), [groups])

  if (entries.length === 0) return null

  const isGroupSelected = (ids: string[]) => ids.length === selectedIds.length && ids.every((id) => selectedIds.includes(id))

  return (
    <section aria-label={t('visualizer.quick.region')} className="shrink-0 border-t border-line bg-surface-1">
      <div className="flex min-h-control-lg items-center gap-2 px-3 py-1.5">
        <span className="shrink-0 text-xs font-semibold text-info-fg tabular">
          {entries.length === 1 ? entries[0].name : t('common.fixtureCount', { count: entries.length })}
        </span>
        {topGroups.length > 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {topGroups.map((g) => (
              <Tag
                key={g.id}
                color={g.color}
                selected={isGroupSelected(g.fixtureIds)}
                onClick={() => usePatchStore.getState().selectGroup(g.id)}
                title={t('visualizer.quick.selectGroup', { name: g.name, count: g.fixtureIds.length })}
              >
                {g.name}
              </Tag>
            ))}
          </div>
        )}
        {topGroups.length === 0 && <div className="flex-1" />}
        <div role="group" aria-label={t('visualizer.quick.colourPresets')} className="flex shrink-0 items-center gap-1">
          {PRESETS.map((p) => (
            <ColorSwatch
              key={p.label}
              size="md"
              label={t(p.label)}
              color={`rgb(${p.r} ${p.g} ${p.b})`}
              onClick={() => applyColor(entries, p.r, p.g, p.b)}
              className="[[data-density=touch]_&]:h-control-sm [[data-density=touch]_&]:w-control-sm"
            />
          ))}
        </div>
        <Button size="xs" variant="ghost" icon={LuX} tooltip={t('visualizer.quick.clearSelection')} onClick={() => usePatchStore.getState().clearSelection()}>{t('common.clear')}</Button>
        <IconButton
          size="sm"
          icon={open ? LuChevronDown : LuChevronUp}
          label={t(open ? 'visualizer.quick.hide' : 'visualizer.quick.show')}
          onClick={() => setOpen(!open)}
        />
      </div>
      {open && <QuickSliders entries={entries} />}
    </section>
  )
}

function QuickSliders({ entries }: { entries: PatchEntry[] }) {
  const first = entries[0]
  const channels = useMemo(() => usePatchStore.getState().getFixtureChannels(first) as Ch[], [first])
  const t = useT()
  const rows = SLIDERS.map((s) => ({ ...s, ch: findCh(channels, s.names) })).filter((s) => s.ch)
  if (rows.length === 0) {
    return <p className="px-3 pb-2 text-xs text-fg-tertiary">{t('visualizer.quick.noChannels', { name: first.name })}</p>
  }
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-3 pb-2.5 xl:grid-cols-4">
      {rows.map((r) => (
        <ChannelSlider key={r.label} label={t(r.label)} names={r.names} channel={r.ch!} first={first} entries={entries} />
      ))}
    </div>
  )
}

const ChannelSlider = memo(function ChannelSlider({ label, names, channel, first, entries }: {
  label: string
  names: string[]
  channel: Ch
  first: PatchEntry
  entries: PatchEntry[]
}) {
  const values = useDmxUniverse(first.universe)
  const t = useT()
  const value = values[channel.absoluteChannel] ?? 0
  const onChange = (v: number) => {
    const store = usePatchStore.getState()
    for (const entry of entries) {
      const c = findCh(store.getFixtureChannels(entry) as Ch[], names)
      if (c) setProgrammerChannel(entry.universe, c.absoluteChannel, v)
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-9 shrink-0 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{label}</span>
      <Slider
        value={value}
        onChange={onChange}
        min={0}
        max={255}
        color={getChannelTypeColor(channel.type as FixtureChannel['type'], channel.name)}
        showValue
        className="min-w-0 flex-1"
        aria-label={t('visualizer.quick.sliderAria', { label })}
      />
    </div>
  )
})
