// ============================================================
// MIDI view: devices (with activity), live monitor, mapping table
// with search / filter, mapping editor, and a learn mode that is
// impossible to miss.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { LuPiano, LuRefreshCw, LuTriangleAlert, LuX } from 'react-icons/lu'
import { Badge, Button, ResizeHandle, Spinner, StatusDot, toast, useResizable } from '@renderer/components/ui'
import { useMidiStore } from '@renderer/stores/midi-store'
import { DevicesPanel } from './DevicesPanel'
import { LearnButton } from './LearnMenu'
import { MappingEditor } from './MappingEditor'
import { MappingsTable } from './MappingsTable'
import { MidiMonitor } from './MidiMonitor'

export function MidiView() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const close = useCallback(() => setSelectedId(null), [])
  const left = useResizable({ initial: 300, min: 248, max: 440, storageKey: 'midi.left' })
  const editor = useResizable({ initial: 340, min: 288, max: 480, storageKey: 'midi.editor', direction: -1 })
  const count = useMidiStore((s) => s.mappings.length)
  useSelectLearnedMapping(setSelectedId)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-control-lg shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3 py-1.5">
        <LuPiano size={16} aria-hidden className="text-fg-tertiary" />
        <h1 className="text-sm font-semibold">MIDI</h1>
        <span className="text-xs tabular text-fg-tertiary">{count} mapping{count === 1 ? '' : 's'}</span>
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
        <section aria-label="Mappings" className="flex min-w-0 flex-1 flex-col">
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
      toast.success(`Mapped “${added.name}”`)
    }
  }), [select])
}

function ApiStatus() {
  const status = useMidiStore((s) => s.apiStatus)
  const inputs = useMidiStore((s) => s.devices.filter((d) => d.type === 'input' && d.connected).length)
  if (status === 'pending') return <Badge tone="neutral"><Spinner size={10} /> Connecting</Badge>
  if (status !== 'available') return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
      <StatusDot tone={inputs > 0 ? 'go' : 'neutral'} />
      {inputs > 0 ? `${inputs} input${inputs === 1 ? '' : 's'} connected` : 'No controller connected'}
    </span>
  )
}

function LearnBanner() {
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
        <span className="truncate text-sm font-semibold text-fg-primary">Learning “{label ?? '…'}”</span>
        <span className="truncate text-xs text-fg-secondary">Move a fader, turn a knob or press a pad on your controller.</span>
      </div>
      <Button variant="secondary" icon={LuX} onClick={() => useMidiStore.getState().cancelLearn()}>Cancel</Button>
    </div>
  )
}

function ApiBanner() {
  const status = useMidiStore((s) => s.apiStatus)
  const error = useMidiStore((s) => s.apiError)
  if (status !== 'unavailable' && status !== 'error') return null
  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-3 py-2">
      <LuTriangleAlert size={16} aria-hidden className="shrink-0 text-warning-fg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-fg-primary">MIDI is not available on this system</span>
        <span className="truncate text-xs text-fg-secondary">{error ?? 'Web MIDI is not supported here.'} Mappings are kept and work again when MIDI comes back.</span>
      </div>
      <Button size="sm" variant="secondary" icon={LuRefreshCw} onClick={() => { void useMidiStore.getState().initMidi() }}>Retry</Button>
    </div>
  )
}
