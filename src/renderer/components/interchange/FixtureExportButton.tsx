// ============================================================
// "Export as GDTF" for one fixture type (fixture library details,
// offline catalog preview): every exporter that implements
// writeFixture. One format = one button, several = a menu.
// Console: save dialog named after the exporter's file name
// ("Manufacturer@Model@Revision.gdtf"); remote: browser download.
// ============================================================

import { useEffect, useState } from 'react'
import { LuFileOutput } from 'react-icons/lu'
import type { FixtureDefinition } from '@shared/types'
import { Button, DropdownMenu } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { getBridge } from '@renderer/lib/runtime'
import { useInterchangeStore } from './interchange-store'
import { exportFixtureAs, loadFormats } from './interchange-actions'
import { shortFormatName } from './format-names'

export function FixtureExportButton({ def }: { def: FixtureDefinition }) {
  const t = useT()
  const formats = useInterchangeStore((s) => s.formats)
  const [busy, setBusy] = useState(false)
  const available = !!getBridge()?.interchange?.exportFixture
  useEffect(() => { if (available && !formats) void loadFormats() }, [available, formats])
  const list = available ? formats?.fixtureExporters ?? [] : []
  if (list.length === 0) return null

  const run = async (format: string) => {
    setBusy(true)
    try { await exportFixtureAs(format, def) } finally { setBusy(false) }
  }

  if (list.length === 1) {
    const f = list[0]
    return (
      <Button
        size="sm"
        variant="ghost"
        icon={LuFileOutput}
        loading={busy}
        tooltip={t('interchange.fixtureExport.tooltip', { format: shortFormatName(f.id, f.name) })}
        onClick={() => { void run(f.id) }}
        data-fixture-export={f.id}
      >
        {t('interchange.fixtureExport.as', { format: shortFormatName(f.id, f.name) })}
      </Button>
    )
  }
  return (
    <DropdownMenu
      placement="bottom-end"
      items={() => list.map((f) => ({
        label: t('interchange.fixtureExport.as', { format: shortFormatName(f.id, f.name) }),
        description: f.extensions.map((e) => `.${e}`).join(' '),
        icon: LuFileOutput,
        onSelect: () => { void run(f.id) }
      }))}
      trigger={(p) => (
        <Button {...p} size="sm" variant="ghost" icon={LuFileOutput} loading={busy} data-fixture-export="menu">
          {t('interchange.fixtureExport.menu')}
        </Button>
      )}
    />
  )
}
