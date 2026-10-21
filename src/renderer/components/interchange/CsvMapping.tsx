// ============================================================
// CSV column mapping (import wizard): separator, header row, and the
// meaning of each column, with the first values as a reminder. The
// file is read again with these choices (ImportOptions.tabular).
// ============================================================

import { useState } from 'react'
import { LuTriangleAlert } from 'react-icons/lu'
import type { TabularField, TabularImportInfo } from '@shared/interchange'
import { Button, Checkbox, SegmentedControl, Select, type SelectOption } from '@renderer/components/ui'
import { useT, type TranslationKey } from '@renderer/i18n'
import { useInterchangeStore } from './interchange-store'
import { reimport } from './interchange-actions'

const FIELDS: TabularField[] = [
  'fid', 'name', 'fixtureType', 'manufacturer', 'model', 'mode', 'channels', 'universe', 'address',
  'x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'groups', 'position'
]

type Delim = TabularImportInfo['delimiter']

export function CsvMapping() {
  const t = useT()
  const tab = useInterchangeStore((s) => s.fragment?.tabular)
  const [delimiter, setDelimiter] = useState<Delim>(tab?.delimiter ?? ',')
  const [hasHeader, setHasHeader] = useState<boolean>(tab?.hasHeader ?? true)
  const [columns, setColumns] = useState<(TabularField | null)[]>(tab?.columns ?? [])
  if (!tab) return null

  const options: SelectOption<string>[] = [
    { value: '', label: t('interchange.mapping.ignore') },
    ...FIELDS.map((f) => ({ value: f, label: t(`interchange.mapping.fields.${f}` as TranslationKey) }))
  ]
  const setColumn = (i: number, f: TabularField | null) => {
    setColumns((cur) => {
      const next = Array.from({ length: Math.max(cur.length, tab.headers.length) }, (_, j) => cur[j] ?? null)
      // one column per meaning
      if (f) for (let j = 0; j < next.length; j++) if (next[j] === f) next[j] = null
      next[i] = f
      return next
    })
  }
  const structureChanged = delimiter !== tab.delimiter || hasHeader !== tab.hasHeader
  const apply = () => {
    void reimport({ tabular: structureChanged ? { delimiter, hasHeader } : { delimiter, hasHeader, columns } })
  }

  return (
    <div className="flex flex-col gap-3" data-csv-mapping>
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-fg-primary">{t('interchange.mapping.title')}</span>
        {!tab.confident && (
          <p className="flex items-center gap-1.5 text-sm text-warning-fg"><LuTriangleAlert size={14} aria-hidden />{t('interchange.mapping.unsure')}</p>
        )}
        <p className="text-sm text-fg-secondary">{t('interchange.mapping.description')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-secondary">{t('interchange.mapping.delimiter')}</span>
          <SegmentedControl<Delim>
            aria-label={t('interchange.mapping.delimiter')}
            items={[
              { value: ',', label: t('interchange.mapping.comma') },
              { value: ';', label: t('interchange.mapping.semicolon') },
              { value: '\t', label: t('interchange.mapping.tab') }
            ]}
            value={delimiter}
            onChange={setDelimiter}
          />
        </div>
        <Checkbox checked={hasHeader} onChange={setHasHeader} label={t('interchange.mapping.hasHeader')} />
        <span className="text-xs tabular text-fg-tertiary">{t('interchange.mapping.rows', { count: tab.rowCount })}</span>
      </div>
      {structureChanged ? (
        <Button variant="secondary" className="self-start" onClick={apply}>{t('interchange.mapping.apply')}</Button>
      ) : (
        <div className="max-h-[46vh] overflow-y-auto rounded-md border border-line-subtle">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-2xs uppercase tracking-[0.06em] text-fg-tertiary">
              <tr>
                <th className="px-2.5 py-1.5 font-semibold">{t('interchange.mapping.column')}</th>
                <th className="px-2.5 py-1.5 font-semibold">{t('interchange.mapping.sample')}</th>
                <th className="w-[46%] px-2.5 py-1.5 font-semibold">{t('interchange.mapping.meaning')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {tab.headers.map((h, i) => (
                <tr key={i} className="min-h-row">
                  <td className="max-w-[140px] truncate px-2.5 py-1 text-fg-primary" title={h}>{h || '—'}</td>
                  <td className="max-w-[180px] truncate px-2.5 py-1 font-mono text-xs text-fg-tertiary">
                    {tab.sample.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ')}
                  </td>
                  <td className="px-2.5 py-1">
                    <Select<string>
                      aria-label={h || t('interchange.mapping.column')}
                      size="sm"
                      value={columns[i] ?? ''}
                      onChange={(v) => setColumn(i, (v || null) as TabularField | null)}
                      options={options}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!structureChanged && (
        <Button variant="primary" className="self-end" onClick={apply} data-csv-apply>{t('interchange.mapping.apply')}</Button>
      )}
    </div>
  )
}
