// ============================================================
// Fixture type details: identity, physical data, modes and the
// DMX channel list of each mode (offset, name, type, default).
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { FixtureChannel, FixtureDefinition } from '@shared/types'
import { Badge, SegmentedControl, Select, Table, TBody, Td, Th, THead, Tr, channelTypeIcon, fixtureCategoryIcon, formatDegrees } from '@renderer/components/ui'
import { formatNumber, hasTranslation, t as tr, useT } from '@renderer/i18n'
import { getChannelTypeColor } from '@renderer/lib/fixture-library'
import { sourceLabel } from './LibraryBrowser'

/** Translated name of a channel type ("Intensity" / "Intensité"); unknown types are shown as is */
export function channelTypeLabel(type: FixtureChannel['type'] | string): string {
  const key = `patch.channelTypes.${type}`
  return hasTranslation(key) ? tr(key) : type
}

/** Channel list of one mode (DMX order) */
export function ModeChannelList({ def, modeName, dense }: { def: FixtureDefinition; modeName: string; dense?: boolean }) {
  const t = useT()
  const mode = def.modes.find((m) => m.name === modeName) ?? def.modes[0]
  if (!mode) return <p className="p-3 text-sm text-fg-tertiary">{t('patch.details.noModes')}</p>
  return (
    <Table aria-label={t('patch.details.channelsOf', { mode: mode.name })} className={dense ? 'text-xs' : undefined}>
      <THead>
        <Tr>
          <Th align="right" className="w-12">{t('patch.details.columns.channel')}</Th>
          <Th>{t('patch.details.columns.name')}</Th>
          <Th>{t('patch.details.columns.type')}</Th>
          {!dense && <Th align="right">{t('patch.details.columns.default')}</Th>}
          {!dense && <Th align="center">{t('patch.details.columns.merge')}</Th>}
        </Tr>
      </THead>
      <TBody>
        {mode.channels.map((name, i) => {
          const ch = def.channels[name]
          const type = ch?.type ?? 'generic'
          const Icon = channelTypeIcon(type)
          const precedence = ch?.precedence ?? (type === 'intensity' ? 'HTP' : 'LTP')
          return (
            <Tr key={`${i}-${name}`}>
              <Td align="right" mono muted>{i + 1}</Td>
              <Td className="max-w-0 truncate text-fg-primary">{name}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                  <Icon size={14} aria-hidden style={{ color: getChannelTypeColor(type, name) }} />
                  {ch ? channelTypeLabel(type) : t('patch.details.fineAlias')}
                </span>
              </Td>
              {!dense && <Td align="right" mono muted>{ch?.defaultValue ?? 0}</Td>}
              {!dense && <Td align="center"><Badge size="xs" mono variant={precedence === 'HTP' ? 'outline' : 'subtle'}>{precedence}</Badge></Td>}
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}

/** Mode picker: segmented when few short names, native select otherwise */
export function ModePicker({ def, value, onChange }: { def: FixtureDefinition; value: string; onChange: (mode: string) => void }) {
  const t = useT()
  const short = def.modes.length <= 4 && def.modes.every((m) => m.name.length <= 14)
  if (def.modes.length <= 1) return null
  return short ? (
    <SegmentedControl size="sm" aria-label={t('common.mode')} value={value} onChange={onChange} items={def.modes.map((m) => ({ value: m.name, label: m.name }))} />
  ) : (
    <Select size="sm" aria-label={t('common.mode')} value={value} onChange={onChange} className="w-64" options={def.modes.map((m) => ({ value: m.name, label: t('patch.details.modePickerOption', { name: m.name, count: m.channelCount }) }))} />
  )
}

export function FixtureDetails({ def, actions, patchedCount, banner }: {
  def: FixtureDefinition
  actions?: React.ReactNode
  patchedCount: number
  /** Optional line under the header (catalog preview: provenance) */
  banner?: React.ReactNode
}) {
  const t = useT()
  const [mode, setMode] = useState(def.modes[0]?.name ?? '')
  useEffect(() => { setMode(def.modes[0]?.name ?? '') }, [def.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const Icon = fixtureCategoryIcon(def.categories)
  const src = sourceLabel(def)
  const current = def.modes.find((m) => m.name === mode) ?? def.modes[0]

  const physical = useMemo(() => {
    const p = def.physical
    const rows: [string, string][] = []
    if (!p) return rows
    if (p.dimensions) rows.push([t('patch.details.physical.dimensions'), t('patch.details.valueMm', { value: p.dimensions.map((d) => formatNumber(d, { max: 1 })).join(' × ') })])
    if (p.weight) rows.push([t('patch.details.physical.weight'), t('patch.details.valueKg', { value: p.weight })])
    if (p.power) rows.push([t('patch.details.physical.power'), t('patch.details.valueW', { value: p.power })])
    if (p.lens?.degreesMinMax) {
      const [a, b] = p.lens.degreesMinMax
      rows.push([t('patch.details.physical.beam'), a === b ? formatDegrees(a) : `${formatDegrees(a)} – ${formatDegrees(b)}`])
    }
    if (p.panRange) rows.push([t('patch.details.physical.panRange'), formatDegrees(p.panRange)])
    if (p.tiltRange) rows.push([t('patch.details.physical.tiltRange'), formatDegrees(p.tiltRange)])
    if (p.bulb?.type) rows.push([t('patch.details.physical.lightSource'), p.bulb.type])
    if (p.DMXconnector) rows.push([t('patch.details.physical.dmx'), p.DMXconnector])
    return rows
  }, [def, t])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-line-subtle px-4 py-3">
        <div className="flex min-w-[200px] flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-inset ring-line">
            <Icon size={20} aria-hidden className="text-fg-secondary" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-semibold text-fg-primary">{def.name}</h2>
              <Badge size="xs" tone={src.tone}>{src.label}</Badge>
              {patchedCount > 0 && <Badge size="xs" tone="info">{t('patch.shared.patchedCount', { count: patchedCount })}</Badge>}
            </div>
            <p className="truncate text-sm text-fg-secondary">
              {def.manufacturer}
              {def.categories.length > 0 && <span className="text-fg-tertiary"> · {def.categories.join(', ')}</span>}
            </p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
      </header>
      {banner}

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
            {t('patch.details.modesHeading', { count: def.modes.length })}
          </h3>
          <ModePicker def={def} value={current?.name ?? ''} onChange={setMode} />
          {current && (
            <span className="text-xs text-fg-tertiary">
              {def.modes.length <= 1 && <span className="text-fg-secondary">{current.name} · </span>}
              <span className="tabular">{t('common.channelCount', { count: current.channelCount })}</span>
              {current.pixelLayout && <span> · {t('patch.details.cells', { count: current.pixelLayout.cellCount })}</span>}
            </span>
          )}
        </div>
        {current && <div className="px-1 pb-3"><ModeChannelList def={def} modeName={current.name} /></div>}
      </div>
    </div>
  )
}
