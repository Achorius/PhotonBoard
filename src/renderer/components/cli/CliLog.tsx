// ============================================================
// Command-line log (pro-store.cliLog, last 50 lines): time, origin
// (console / macro / remote), the line as typed and its coloured
// result. Tapping a line puts it back on the command line.
// ============================================================

import { memo, useEffect, useRef } from 'react'
import { LuTerminal } from 'react-icons/lu'
import { Badge, EmptyState, cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useProStore, type CliLogEntry } from '@renderer/stores/pro-store'

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 21:04:09 (a readout, like timecode: same in every language) */
export function formatLogTime(time: number): string {
  const d = new Date(time)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function CliLog({ onRecall, className }: { onRecall: (text: string) => void; className?: string }) {
  const t = useT()
  const log = useProStore((s) => s.cliLog)
  const scroller = useRef<HTMLDivElement>(null)
  const last = log[log.length - 1]?.id

  // Follow the newest line
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])

  return (
    <div ref={scroller} role="log" aria-label={t('pro.cliUi.logAria')} className={cn('min-h-0 overflow-y-auto rounded bg-surface-0 ring-1 ring-inset ring-line-subtle', className)}>
      {log.length === 0 ? (
        <EmptyState size="sm" icon={LuTerminal} title={t('pro.cliUi.logEmptyTitle')} description={t('pro.cliUi.logEmptyText')} />
      ) : (
        <ol className="flex flex-col py-1">
          {log.map((entry) => <LogRow key={entry.id} entry={entry} onRecall={onRecall} />)}
        </ol>
      )}
    </div>
  )
}

const LogRow = memo(function LogRow({ entry, onRecall }: { entry: CliLogEntry; onRecall: (text: string) => void }) {
  const t = useT()
  const tone = entry.level === 'error' || (!entry.ok && entry.level !== 'warning') ? 'error' : entry.level === 'warning' ? 'warning' : 'ok'
  const origin = entry.origin === undefined
    ? null
    : entry.origin === 'macro' ? t('pro.cliUi.origin.macro') : t('pro.cliUi.origin.remote')
  return (
    <li>
      <button
        type="button"
        tabIndex={-1}
        title={t('pro.cliUi.recallTitle')}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => onRecall(entry.text)}
        data-cli-log-entry={tone}
        className="flex w-full min-w-0 items-baseline gap-2 px-2 py-0.5 text-left hover:bg-surface-2 [[data-density=touch]_&]:py-1.5"
      >
        <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{formatLogTime(entry.time)}</span>
        {origin && <Badge size="xs" tone={entry.origin === 'macro' ? 'neutral' : 'info'} title={entry.origin}>{origin}</Badge>}
        <span className="min-w-0 shrink truncate font-mono text-xs text-fg-primary">{entry.text}</span>
        {entry.message && (
          <span
            className={cn(
              'ml-auto min-w-0 shrink-[2] truncate text-xs',
              tone === 'error' ? 'text-danger-fg' : tone === 'warning' ? 'text-warning-fg' : 'text-go-fg'
            )}
            title={entry.message}
          >
            {entry.message}
          </span>
        )}
      </button>
    </li>
  )
})
