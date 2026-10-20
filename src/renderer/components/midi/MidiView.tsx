// ============================================================
// MIDI view: devices (with activity), live monitor, mapping table
// with search / filter, mapping editor, and a learn mode that is
// impossible to miss.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { LuPiano, LuRefreshCw, LuTriangleAlert, LuX } from 'react-icons/lu'
import { Badge, Button, ResizeHandle, Spinner, StatusDot, toast, useResizable } from '@renderer/components/ui'
import { t as tGlobal, useT } from '@renderer/i18n'
import { useSelectionActions } from '@renderer/lib/selection-actions'
import { useMidiStore } from '@renderer/stores/midi-store'
import { DevicesPanel } from './DevicesPanel'
import { LearnButton } from './LearnMenu'
import { MappingEditor } from './MappingEditor'
import { MappingsTable } from './MappingsTable'
import { MidiMonitor } from './MidiMonitor'
import { deleteConfirmOptions, duplicateMapping, mappingLabel } from './midi-actions'

/** Focus the name field of the open mapping editor (F2 / Enter) */
function focusMappingName(): void {
  const input = document.querySelector<HTMLInputElement>('[data-midi-mapping-name]')
  input?.focus()
  input?.select()
}

export function MidiView() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const close = useCallback(() => setSelectedId(null), [])
  const left = useResizable({ initial: 300, min: 248, max: 440, storageKey: 'midi.left' })
  const editor = useResizable({ initial: 340, min: 288, max: 480, storageKey: 'midi.editor', direction: -1 })
  const count = useMidiStore((s) => s.mappings.length)
  useSelectLearnedMapping(setSelectedId)

  // Delete / Mod+D / F2 on the selected mapping (the editor shows it, with its own delete button)
  const selected = useMidiStore((s) => (selectedId ? s.mappings.find((m) => m.id === selectedId) : undefined))
  useSelectionActions(selected ? {
    label: () => mappingLabel(selected),
    delete: () => useMidiStore.getState().removeMapping(selected.id),
    confirmDelete: deleteConfirmOptions(),
    duplicate: () => { const id = duplicateMapping(selected.id); if (id) setSelectedId(id) },
    rename: () => { requestAnimationFrame(focusMappingName) }
  } : null, { scope: rootRef })

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-control-lg shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3 py-1.5">
        <LuPiano size={16} aria-hidden className="text-fg-tertiary" />
        <h1 className="text-sm font-semibold">MIDI</h1>
        <span className="text-xs tabular text-fg-tertiary">{t('midi.view.mappingCount', { count })}</span>
        <ApiStatus />
        <div className="flex-1" />
        <LearnButton />
      </header>
      <LearnBanner />
      <ApiBanner />
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full shrink-0 flex-col border-r border-line bg-surface-1" style={{ width: left.size }}>
          <DevicesPanel />
          <MidiMonitor onSelectMapping={setSelectedId} />
        </div>
        <ResizeHandle {...left.handleProps} />
        <section aria-label={t('midi.view.mappings')} className="flex min-w-0 flex-1 flex-col">
          <MappingsTable selectedId={selectedId} onSelect={setSelectedId} compact={!!selectedId} />
        </section>
        {selectedId && (
          <>
            <ResizeHandle {...editor.handleProps} />
            <div className="h-full shrink-0 border-l border-line" style={{ width: editor.size }}>
              <MappingEditor key={selectedId} id={selectedId} onClose={close} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** After a learn completes, select the new mapping and confirm it */
function useSelectLearnedMapping(select: (id: string) => void) {
  useEffect(() => useMidiStore.subscribe((s, p) => {
    if (!(p.isLearning && !s.isLearning)) return
    const before = new Set(p.mappings.map((m) => m.id))
    const added = s.mappings.find((m) => !before.has(m.id))
    if (added) {
      select(added.id)
      toast.success(tGlobal('midi.learn.mapped', { name: added.name }))
    }
  }), [select])
}

function ApiStatus() {
  const t = useT()
  const status = useMidiStore((s) => s.apiStatus)
  const inputs = useMidiStore((s) => s.devices.filter((d) => d.type === 'input' && d.connected).length)
  if (status === 'pending') return <Badge tone="neutral"><Spinner size={10} /> {t('midi.view.connecting')}</Badge>
  if (status !== 'available') return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
      <StatusDot tone={inputs > 0 ? 'go' : 'neutral'} />
      {inputs > 0 ? t('midi.view.inputsConnected', { count: inputs }) : t('midi.view.noController')}
    </span>
  )
}

function LearnBanner() {
  const t = useT()
  const isLearning = useMidiStore((s) => s.isLearning)
  const label = useMidiStore((s) => s.learnTarget?.label)
  if (!isLearning) return null
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b border-midi/60 bg-midi/20 px-3 py-2">
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-midi text-on-midi">
        <span className="absolute inset-0 animate-ping rounded-full bg-midi opacity-40" />
        <LuPiano size={16} aria-hidden className="relative" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-fg-primary">{t('midi.learn.learning', { label: label ?? '…' })}</span>
        <span className="truncate text-xs text-fg-secondary">{t('midi.learn.hint')}</span>
      </div>
      <Button variant="secondary" icon={LuX} onClick={() => useMidiStore.getState().cancelLearn()}>{t('common.cancel')}</Button>
    </div>
  )
}

function ApiBanner() {
  const t = useT()
  const status = useMidiStore((s) => s.apiStatus)
  const error = useMidiStore((s) => s.apiError)
  if (status !== 'unavailable' && status !== 'error') return null
  const text = `${status === 'error' ? t('midi.api.failed') : t('midi.api.unsupported')} ${t('midi.api.kept')}`
  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-3 py-2">
      <LuTriangleAlert size={16} aria-hidden className="shrink-0 text-warning-fg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-fg-primary">{t('midi.api.title')}</span>
        {/* 'unavailable' = no Web MIDI at all; 'error' = the ports failed to open (the system's own, English, message in the tooltip) */}
        <span className="truncate text-xs text-fg-secondary" title={[text, status === 'error' ? error : null].filter(Boolean).join('\n')}>{text}</span>
      </div>
      <Button size="sm" variant="secondary" icon={LuRefreshCw} onClick={() => { void useMidiStore.getState().initMidi() }}>{t('common.retry')}</Button>
    </div>
  )
}
