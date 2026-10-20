// ============================================================
// Stage pages player — page tabs + grid, play only. Store-free:
// the Stage window (console surface data + commands) and the tablet
// remote (stores) both use it; the in-app view adds the designer.
// ============================================================

import { useMemo, useState } from 'react'
import { LuLayoutDashboard } from 'react-icons/lu'
import type { StagePage } from '@shared/types'
import { EmptyState, Tabs, cn } from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import type { SurfaceIndex } from './surface-data'
import type { SurfaceActions } from './surface-actions'
import type { WidgetContext } from './StageWidgets'
import { StagePageGrid } from './StagePageGrid'

export const STAGE_PAGE_PREF = 'photonboard.ui.stagePage'

function readPref(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

/** "Stage page 2" or the page's name */
export function stagePageName(page: StagePage, index: number): string {
  return page.name || t('pro.defaults.stagePage', { n: index + 1 })
}

/** Remembered page id (per surface, per device), falling back to the first page */
export function useCurrentStagePage(pages: readonly StagePage[], prefKey: string): [StagePage | undefined, (id: string) => void] {
  const [id, setId] = useState<string | null>(() => readPref(prefKey))
  const page = pages.find((p) => p.id === id) ?? pages[0]
  const choose = (next: string) => { setId(next); writePref(prefKey, next) }
  return [page, choose]
}

export function StagePagesPlayer({ pages, index, actions, size = 'md', prefKey = `${STAGE_PAGE_PREF}.player`, className }: {
  pages: readonly StagePage[]
  index: SurfaceIndex
  actions: SurfaceActions
  size?: 'md' | 'lg'
  prefKey?: string
  className?: string
}) {
  const tr = useT()
  const [page, choose] = useCurrentStagePage(pages, prefKey)
  const ctx = useMemo<WidgetContext>(() => ({ index, actions, size, interactive: true }), [index, actions, size])
  if (!page) {
    return (
      <div className={cn('flex min-h-0 flex-1 rounded-lg border border-dashed border-line', className)}>
        <EmptyState icon={LuLayoutDashboard} title={tr('pro.stage.designer.emptyTitle')} description={tr('pro.stage.designer.emptyPlayer')} />
      </div>
    )
  }
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2', className)}>
      {pages.length > 1 && (
        <div className="shrink-0 overflow-x-auto [scrollbar-width:none]">
          <Tabs
            variant="pill"
            size="md"
            aria-label={tr('pro.stage.designer.pagesAria')}
            items={pages.map((p, i) => ({ id: p.id, label: stagePageName(p, i) }))}
            value={page.id}
            onChange={choose}
          />
        </div>
      )}
      <StagePageGrid page={page} ctx={ctx} />
    </div>
  )
}
