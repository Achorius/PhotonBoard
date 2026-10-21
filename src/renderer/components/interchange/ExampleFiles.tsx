// ============================================================
// Import wizard › "Try with an example file": the example files shipped
// with the app (resources/demos/formats, lib/demos), one per format
// PhotonBoard reads. Picking one runs the normal import preview —
// nothing changes until Import. Console only.
// ============================================================

import { useEffect, useState } from 'react'
import { LuArrowLeft, LuFileSearch, LuSparkles } from 'react-icons/lu'
import { demoText, type DemoFormatFile } from '@shared/demos'
import { Badge, Button, EmptyState, Spinner } from '@renderer/components/ui'
import { useLocale, useT } from '@renderer/i18n'
import { demosAvailable, loadDemos, useDemoStore } from '@renderer/lib/demos'
import { useInterchangeStore } from './interchange-store'
import { importExampleFile } from './interchange-actions'
import { formatName } from './format-names'

/** The link under "Choose a file…" (nothing when the app has no example files) */
export function ExampleFilesLink({ onOpen }: { onOpen: () => void }) {
  const t = useT()
  const [count, setCount] = useState<number | null>(() => useDemoStore.getState().list?.formats.length ?? null)
  useEffect(() => {
    if (!demosAvailable()) return
    let alive = true
    void loadDemos().then((l) => { if (alive) setCount(l.formats.length) })
    return () => { alive = false }
  }, [])
  if (!demosAvailable() || count === 0) return null
  return (
    <Button variant="ghost" size="sm" icon={LuSparkles} onClick={onOpen} data-import-examples>
      {t('file.demos.examples.link')}
    </Button>
  )
}

export function ExampleFiles({ onBack }: { onBack: () => void }) {
  const t = useT()
  const locale = useLocale()
  const list = useDemoStore((s) => s.list)
  const formats = useInterchangeStore((s) => s.formats)
  useEffect(() => { void loadDemos() }, [])

  const pick = (f: DemoFormatFile) => { void importExampleFile(f.path, f.fileName) }

  return (
    <div className="flex flex-col gap-3" data-import-example-list>
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="sm" icon={LuArrowLeft} onClick={onBack}>{t('file.demos.examples.back')}</Button>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-fg-primary">{t('file.demos.examples.title')}</span>
        <p className="text-sm text-fg-secondary">{t('file.demos.examples.description')}</p>
      </div>
      {!list ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : list.formats.length === 0 ? (
        <EmptyState size="sm" icon={LuFileSearch} title={t('file.demos.examples.none')} />
      ) : (
        <ul className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line bg-surface-1">
          {list.formats.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-import-example={f.id}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-xs text-fg-primary" title={f.fileName}>{f.fileName}</span>
                  <Badge size="xs" tone="info">{formatName(f.format, formats)}</Badge>
                </div>
                <span className="text-xs text-fg-secondary">{demoText(f.description, locale)}</span>
              </div>
              <Button size="sm" variant="secondary" icon={LuFileSearch} onClick={() => pick(f)}>{t('file.demos.examples.use')}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
