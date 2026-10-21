// ============================================================
// File › Open a demo…: the demo shows shipped with the app, one line
// of description each. Opening one replaces the current show (with the
// usual unsaved-changes question); it opens as a new, unsaved show.
// ============================================================

import { useState } from 'react'
import { LuFolderOpen, LuSparkles } from 'react-icons/lu'
import { demoText } from '@shared/demos'
import { Badge, Button, EmptyState, Modal, Spinner } from '@renderer/components/ui'
import { useLocale, useT } from '@renderer/i18n'
import { closeDemoDialog, useDemoStore } from '@renderer/lib/demos'
import { requestOpenDemo } from '@renderer/components/layout/file-actions'

export function DemoDialog() {
  const t = useT()
  const locale = useLocale()
  const open = useDemoStore((s) => s.dialogOpen)
  const list = useDemoStore((s) => s.list)
  const error = useDemoStore((s) => s.error)
  const [busy, setBusy] = useState<string | null>(null)
  if (!open) return null

  const run = async (id: string, name: string) => {
    setBusy(id)
    try {
      if (await requestOpenDemo(id, name)) closeDemoDialog()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!busy) closeDemoDialog() }}
      dismissible={!busy}
      title={t('file.demos.title')}
      description={t('file.demos.description')}
      size="lg"
      footer={<Button variant="secondary" onClick={closeDemoDialog} disabled={!!busy}>{t('common.close')}</Button>}
    >
      {!list ? (
        error
          ? <EmptyState size="sm" icon={LuSparkles} title={t('file.demos.failed', { error })} />
          : <div className="flex items-center justify-center gap-3 py-8 text-sm text-fg-secondary" role="status"><Spinner />{t('file.demos.loading')}</div>
      ) : list.shows.length === 0 ? (
        <EmptyState size="sm" icon={LuSparkles} title={t('file.demos.none')} description={t('file.demos.noneHint')} />
      ) : (
        <ul className="flex flex-col gap-2" data-demo-list>
          {list.shows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3" data-demo={d.id}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg-primary">{d.name}</span>
                  <Badge size="xs">{t('common.fixtureCount', { count: d.fixtures })}</Badge>
                  <Badge size="xs">{t('common.universeCount', { count: d.universes })}</Badge>
                </div>
                <span className="text-xs text-fg-secondary">{demoText(d.description, locale)}</span>
              </div>
              <Button
                variant="primary"
                icon={LuFolderOpen}
                loading={busy === d.id}
                disabled={!!busy}
                onClick={() => { void run(d.id, d.name) }}
                data-demo-open={d.id}
              >
                {t('file.demos.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
