// Small dialogs of the pools (and the programmer preset rows):
// label / renumber prompts, a colour picker and an executor picker.
// Promise based like ui/dialogs; <PoolDialogHost/> renders them.

import { useState } from 'react'
import { create } from 'zustand'
import { Button, Modal, SegmentedControl, Select, SwatchPicker, SWATCH_COLORS, cn, prompt } from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import { MAX_OBJECT_NUMBER } from '@shared/show-format'
import type { ExecutorCell } from '@shared/types'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePoolStore } from '@renderer/stores/pool-store'

export interface ExecutorPick {
  page: number
  col: number
  row: number
}

type Pending =
  | { kind: 'colour'; title: string; value: string | undefined; resolve: (v: string | null | undefined) => void }
  | { kind: 'executor'; title: string; resolve: (v: ExecutorPick | null) => void }

const useDialogs = create<{ pending: Pending | null }>(() => ({ pending: null }))

function settle() {
  useDialogs.setState({ pending: null })
}

/** Colour of a pool object: a colour, null = no colour, undefined = cancelled */
export function pickColour(title: string, value: string | undefined): Promise<string | null | undefined> {
  return new Promise((resolve) => useDialogs.setState({ pending: { kind: 'colour', title, value, resolve } }))
}

/** An executor cell (page 0-based), or null when cancelled */
export function pickExecutor(title: string): Promise<ExecutorPick | null> {
  return new Promise((resolve) => useDialogs.setState({ pending: { kind: 'executor', title, resolve } }))
}

/** Rename prompt: the new name, or null when cancelled / unchanged */
export async function askLabel(what: string, current: string): Promise<string | null> {
  const name = await prompt({ title: t('pro.pools.dialog.labelTitle', { what }), label: t('pro.pools.dialog.labelField'), defaultValue: current })
  if (name === null) return null
  const trimmed = name.trim()
  return trimmed === current ? null : trimmed
}

/** Renumber prompt: a valid number, or null */
export async function askNumber(what: string, current: number | undefined): Promise<number | null> {
  const text = await prompt({
    title: t('pro.pools.dialog.renumberTitle', { what }),
    message: t('pro.pools.dialog.renumberMessage'),
    label: t('pro.pools.dialog.renumberField'),
    defaultValue: current !== undefined ? String(current) : '',
    validate: (v) => {
      const n = Number(v.trim())
      return Number.isInteger(n) && n >= 1 && n <= MAX_OBJECT_NUMBER ? null : t('pro.pools.dialog.renumberInvalid', { max: MAX_OBJECT_NUMBER })
    }
  })
  if (text === null) return null
  const n = Number(text.trim())
  return n === current ? null : n
}

export function PoolDialogHost() {
  const pending = useDialogs((s) => s.pending)
  if (!pending) return null
  if (pending.kind === 'colour') return <ColourDialog key="colour" pending={pending} />
  return <ExecutorDialog key="executor" pending={pending} />
}

function ColourDialog({ pending }: { pending: Extract<Pending, { kind: 'colour' }> }) {
  const t = useT()
  const close = (v: string | null | undefined) => { settle(); pending.resolve(v) }
  return (
    <Modal open onClose={() => close(undefined)} title={pending.title} size="sm"
      footer={<Button variant="ghost" onClick={() => close(null)}>{t('pro.pools.dialog.noColour')}</Button>}
    >
      <SwatchPicker colors={SWATCH_COLORS} value={pending.value ?? ''} onChange={(c) => close(c)} columns={6} size="lg" />
    </Modal>
  )
}

/** Name of what an executor cell holds */
function cellName(cell: ExecutorCell | null): string | null {
  if (!cell) return null
  switch (cell.kind) {
    case 'cuelist': return usePlaybackStore.getState().cuelists.find((c) => c.id === cell.id)?.name ?? null
    case 'chase': return usePlaybackStore.getState().chases.find((c) => c.id === cell.id)?.name ?? null
    case 'effect': return useEffectsStore.getState().effects.find((e) => e.id === cell.id)?.name ?? null
    case 'group': return usePatchStore.getState().groups.find((g) => g.id === cell.id)?.name ?? null
    case 'macro': {
      const m = usePoolStore.getState().macros.find((x) => x.id === cell.id)
      return m ? m.name || t('pro.pools.defaults.macro', { n: m.number }) : null
    }
    case 'speed': {
      const m = usePoolStore.getState().speedMasters.find((x) => x.id === cell.id)
      return m ? m.name || t('pro.pools.defaults.speed', { n: m.number }) : null
    }
    default: return null
  }
}

function ExecutorDialog({ pending }: { pending: Extract<Pending, { kind: 'executor' }> }) {
  const t = useT()
  const pages = useExecutorStore((s) => s.pages)
  const [page, setPage] = useState(() => Math.min(useExecutorStore.getState().currentPage, pages.length - 1))
  const close = (v: ExecutorPick | null) => { settle(); pending.resolve(v) }
  const current = pages[page] ?? pages[0]
  const pageItems = pages.map((p, i) => ({ value: i, label: String(i + 1), title: p.name }))
  return (
    <Modal open onClose={() => close(null)} title={pending.title} size="lg">
      <div className="flex flex-col gap-3">
        {pages.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.pools.assign.page')}</span>
            {pages.length <= 8 ? (
              <SegmentedControl size="sm" aria-label={t('pro.pools.assign.page')} value={page} onChange={setPage} items={pageItems} />
            ) : (
              <Select value={String(page)} onChange={(v) => setPage(Number(v))} options={pages.map((p, i) => ({ value: String(i), label: `${i + 1} · ${p.name}` }))} />
            )}
          </div>
        )}
        <div className="grid grid-flow-col grid-cols-8 grid-rows-4 gap-1.5">
          {current.cells.map((column, col) => column.map((cell, row) => {
            const name = cellName(cell)
            const slot = col * 4 + row + 1
            return (
              <button
                key={`${col}-${row}`}
                type="button"
                onClick={() => close({ page, col, row })}
                aria-label={t('pro.pools.assign.slot', { page: page + 1, slot })}
                className={cn(
                  'flex min-h-control-lg min-w-0 flex-col items-start justify-between rounded-md px-1.5 py-1 text-left ring-1 ring-inset transition-colors duration-fast',
                  name ? 'bg-surface-2 ring-line-subtle hover:bg-surface-3' : 'ring-line hover:bg-surface-2'
                )}
              >
                <span className="font-mono text-2xs tabular text-fg-tertiary">{page + 1}.{slot}</span>
                <span className={cn('w-full truncate text-xs', name ? 'text-fg-primary' : 'text-fg-tertiary')}>{name ?? t('pro.pools.assign.free')}</span>
              </button>
            )
          }))}
        </div>
      </div>
    </Modal>
  )
}
