// ============================================================
// File › Export…: every registered exporter, with what it carries
// and the software that reads it. Console: save dialog; remote: the
// browser downloads the file.
// ============================================================

import { useEffect, useState } from 'react'
import { LuFileOutput } from 'react-icons/lu'
import { Badge, Button, EmptyState, Modal, Spinner } from '@renderer/components/ui'
import { formatList, useT, type TranslationKey } from '@renderer/i18n'
import { useInterchangeStore } from './interchange-store'
import { exportShowAs, loadFormats } from './interchange-actions'

export function ExportDialog() {
  const t = useT()
  const open = useInterchangeStore((s) => s.exportOpen)
  const formats = useInterchangeStore((s) => s.formats)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (open && !formats) void loadFormats() }, [open, formats])
  if (!open) return null
  const close = () => { if (!busy) useInterchangeStore.setState({ exportOpen: false }) }
  const run = async (id: string) => {
    setBusy(id)
    try {
      if (await exportShowAs(id)) useInterchangeStore.setState({ exportOpen: false })
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal open onClose={close} dismissible={!busy} title={t('interchange.export.title')} description={t('interchange.export.description')} size="lg"
      footer={<Button variant="secondary" onClick={close} disabled={!!busy}>{t('common.close')}</Button>}>
      {!formats ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : formats.exporters.length === 0 ? (
        <EmptyState size="sm" icon={LuFileOutput} title={t('interchange.export.none')} />
      ) : (
        <ul className="flex flex-col gap-2" data-export-formats>
          {formats.exporters.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3" data-export-format={f.id}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg-primary">{f.name}</span>
                  {f.extensions.map((e) => <Badge key={e} size="xs" mono>.{e}</Badge>)}
                </div>
                {f.exports.length > 0 && (
                  <span className="text-xs text-fg-secondary">
                    {t('interchange.export.carries', { list: formatList(f.exports.map((c) => t(`interchange.content.${c}` as TranslationKey))) })}
                  </span>
                )}
                {f.apps.length > 0 && <span className="text-xs text-fg-tertiary">{t('interchange.export.apps', { list: f.apps.join(', ') })}</span>}
              </div>
              <Button variant="primary" icon={LuFileOutput} loading={busy === f.id} disabled={!!busy} onClick={() => { void run(f.id) }}>
                {busy === f.id ? t('interchange.export.exporting') : t('interchange.export.export')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
