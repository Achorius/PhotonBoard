// ============================================================
// Fixture type details: identity, physical data, modes and the
// DMX channel list of each mode (offset, name, type, default).
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { FixtureDefinition } from '@shared/types'
import { Badge, SegmentedControl, Select, Table, TBody, Td, Th, THead, Tr, channelTypeIcon, fixtureCategoryIcon, formatDegrees } from '@renderer/components/ui'
import { getChannelTypeColor } from '@renderer/lib/fixture-library'
import { sourceLabel } from './LibraryBrowser'

/** Channel list of one mode (DMX order) */
export function ModeChannelList({ def, modeName, dense }: { def: FixtureDefinition; modeName: string; dense?: boolean }) {
  const mode = def.modes.find((m) => m.name === modeName) ?? def.modes[0]
  if (!mode) return <p className="p-3 text-sm text-fg-tertiary">This fixture type has no modes.</p>
  return (
    <Table aria-label={`Channels of ${mode.name}`} className={dense ? 'text-xs' : undefined}>
      <THead>
        <Tr>
          <Th align="right" className="w-12">Ch</Th>
          <Th>Channel</Th>
          <Th>Type</Th>
          {!dense && <Th align="right">Default</Th>}
          {!dense && <Th align="center">Merge</Th>}
        </Tr>
      </THead>
      <TBody>
        {mode.channels.map((name, i) => {
          const ch = def.channels[name]
          const type = ch?.type ?? 'generic'
          const Icon = channelTypeIcon(type)
          return (
            <Tr key={`${i}-${name}`}>
              <Td align="right" mono muted>{i + 1}</Td>
              <Td className="max-w-0 truncate text-fg-primary">{name}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                  <Icon size={14} aria-hidden style={{ color: getChannelTypeColor(type, name) }} />
                  {ch ? type : 'fine / alias'}
                </span>
              </Td>
              {!dense && <Td align="right" mono muted>{ch?.defaultValue ?? 0}</Td>}
              {!dense && <Td align="center"><Badge size="xs" mono variant={(ch?.precedence ?? (type === 'intensity' ? 'HTP' : 'LTP')) === 'HTP' ? 'outline' : 'subtle'}>{ch?.precedence ?? (type === 'intensity' ? 'HTP' : 'LTP')}</Badge></Td>}
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}

/** Mode picker: segmented when few short names, native select otherwise */
export function ModePicker({ def, value, onChange }: { def: FixtureDefinition; value: string; onChange: (mode: string) => void }) {
  const short = def.modes.length <= 4 && def.modes.every((m) => m.name.length <= 14)
  if (def.modes.length <= 1) return null
  return short ? (
    <SegmentedControl size="sm" aria-label="Mode" value={value} onChange={onChange} items={def.modes.map((m) => ({ value: m.name, label: m.name }))} />
  ) : (
    <Select size="sm" aria-label="Mode" value={value} onChange={onChange} className="w-64" options={def.modes.map((m) => ({ value: m.name, label: `${m.name} (${m.channelCount} ch)` }))} />
  )
}

export function FixtureDetails({ def, actions, patchedCount }: { def: FixtureDefinition; actions?: React.ReactNode; patchedCount: number }) {
  const [mode, setMode] = useState(def.modes[0]?.name ?? '')
  useEffect(() => { setMode(def.modes[0]?.name ?? '') }, [def.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const Icon = fixtureCategoryIcon(def.categories)
  const src = sourceLabel(def)
  const current = def.modes.find((m) => m.name === mode) ?? def.modes[0]

  const physical = useMemo(() => {
    const p = def.physical
    const rows: [string, string][] = []
    if (!p) return rows
    if (p.dimensions) rows.push(['Dimensions', `${p.dimensions.join(' x ')} mm`])
    if (p.weight) rows.push(['Weight', `${p.weight} kg`])
    if (p.power) rows.push(['Power', `${p.power} W`])
    if (p.lens?.degreesMinMax) {
      const [a, b] = p.lens.degreesMinMax
      rows.push(['Beam', a === b ? formatDegrees(a) : `${formatDegrees(a)} – ${formatDegrees(b)}`])
    }
    if (p.panRange) rows.push(['Pan range', formatDegrees(p.panRange)])
    if (p.tiltRange) rows.push(['Tilt range', formatDegrees(p.tiltRange)])
    if (p.bulb?.type) rows.push(['Source', p.bulb.type])
    if (p.DMXconnector) rows.push(['DMX', p.DMXconnector])
    return rows
  }, [def])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-line-subtle px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-inset ring-line">
          <Icon size={20} aria-hidden className="text-fg-secondary" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold text-fg-primary">{def.name}</h2>
            <Badge size="xs" tone={src.tone}>{src.label}</Badge>
            {patchedCount > 0 && <Badge size="xs" tone="info">{patchedCount} patched</Badge>}
          </div>
          <p className="truncate text-sm text-fg-secondary">
            {def.manufacturer}
            {def.categories.length > 0 && <span className="text-fg-tertiary"> · {def.categories.join(', ')}</span>}
          </p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {physical.length > 0 && (
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-3">
            {physical.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{k}</dt>
                <dd className="font-mono text-xs tabular text-fg-primary">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
          <h3 className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
            {def.modes.length === 1 ? 'Mode' : `${def.modes.length} modes`}
          </h3>
          <ModePicker def={def} value={current?.name ?? ''} onChange={setMode} />
          {current && (
            <span className="text-xs text-fg-tertiary">
              {def.modes.length <= 1 && <span className="text-fg-secondary">{current.name} · </span>}
              <span className="tabular">{current.channelCount} channels</span>
              {current.pixelLayout && <span> · {current.pixelLayout.cellCount} cells</span>}
            </span>
          )}
        </div>
        {current && <div className="px-1 pb-3"><ModeChannelList def={def} modeName={current.name} /></div>}
      </div>
    </div>
  )
}
