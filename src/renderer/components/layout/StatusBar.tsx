// ============================================================
// Status bar: outputs · patch · MIDI · timecode | command line |
// show file · executor bar toggle. Each live readout is its own
// small component with a narrow subscription.
// ============================================================

import { useEffect, useState } from 'react'
import { LuFileText, LuPanelBottomClose, LuPanelBottomOpen, LuPiano, LuTimer } from 'react-icons/lu'
import { IconButton, StatusDot, Tooltip, cn } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { formatTimecode, getTimecodePosition, isTimecodeEnabled, isTimecodeReceiving } from '@renderer/lib/timecode-engine'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { useT } from '@renderer/i18n'
import { CommandLine } from './CommandLine'
import { OutputHealthIndicator } from './OutputHealth'

export function StatusBar() {
  const t = useT()
  const executorBarOpen = useUiStore((s) => s.executorBarOpen)
  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-1 border-t border-line bg-surface-1 px-1.5 text-xs text-fg-tertiary">
      <OutputHealthIndicator variant="statusbar" />
      <Sep />
      <PatchSummary />
      <Sep />
      <MidiStatus />
      <TimecodeStatus />
      <Sep />
      <CommandLine />
      <ShowFile />
      <IconButton
        icon={executorBarOpen ? LuPanelBottomClose : LuPanelBottomOpen}
        label={executorBarOpen ? t('shell.status.hideExecutors') : t('shell.status.showExecutors')}
        size="xs"
        onClick={() => useUiStore.getState().toggleExecutorBar()}
      />
    </footer>
  )
}

function Sep() {
  return <span aria-hidden className="mx-1 h-3 w-px shrink-0 bg-line" />
}

function PatchSummary() {
  const t = useT()
  const count = usePatchStore((s) => s.patch.length)
  const universes = usePatchStore((s) => new Set(s.patch.map((p) => p.universe)).size)
  const num = (n: number) => <span className="tabular text-fg-secondary">{n}</span>
  return (
    <span className="shrink-0 whitespace-nowrap px-1.5">
      {t.rich('common.fixtureCount', { count: num(count) }, count)}
      {universes > 1 && <> · {t.rich('common.universeCount', { count: num(universes) }, universes)}</>}
    </span>
  )
}

function MidiStatus() {
  const t = useT()
  const inputs = useMidiStore((s) => s.devices.filter((d) => d.type === 'input' && d.connected).map((d) => d.name).join(', '))
  return (
    <Tooltip content={inputs ? t('shell.status.midiInputs', { names: inputs }) : t('shell.status.noMidiInput')}>
      <button
        type="button"
        onClick={() => useUiStore.getState().setActiveTab('midi')}
        className="flex h-full min-w-0 max-w-[220px] shrink items-center gap-1.5 rounded-sm px-1.5 hover:bg-surface-3 hover:text-fg-primary"
      >
        <LuPiano size={13} aria-hidden className="shrink-0" />
        <span className="truncate">{inputs || t('shell.status.noMidi')}</span>
        {inputs && <MidiActivity />}
      </button>
    </Tooltip>
  )
}

/** Blinks on every incoming MIDI message (only this dot re-renders) */
function MidiActivity() {
  const last = useMidiStore((s) => s.lastMessage)
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!last) return
    setLit(true)
    const t = setTimeout(() => setLit(false), 120)
    return () => clearTimeout(t)
  }, [last])
  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-fast', lit ? 'bg-midi-fg' : 'bg-surface-5')} />
}

/** Incoming MIDI timecode (shown only when timecode sync is enabled) */
function TimecodeStatus() {
  const t = useT()
  const [tc, setTc] = useState<{ text: string; receiving: boolean } | null>(null)
  useEffect(() => {
    const read = () => {
      if (!isTimecodeEnabled()) { setTc((p) => (p ? null : p)); return }
      const receiving = isTimecodeReceiving()
      const text = formatTimecode(getTimecodePosition())
      setTc((p) => (p && p.text === text && p.receiving === receiving ? p : { text, receiving }))
    }
    read()
    const id = setInterval(read, 100)
    return () => clearInterval(id)
  }, [])
  if (!tc) return null
  return (
    <>
      <Sep />
      <span className="flex shrink-0 items-center gap-1.5 px-1.5" title={tc.receiving ? t('shell.status.timecodeReceiving') : t('shell.status.timecodeNoSignal')}>
        <LuTimer size={13} aria-hidden />
        <StatusDot tone={tc.receiving ? 'go' : 'warning'} />
        <span className={cn('font-mono tabular', tc.receiving ? 'text-fg-primary' : 'text-fg-tertiary')}>{tc.text}</span>
      </span>
    </>
  )
}

/** Current show file (Electron: click to reveal in the file manager) */
function ShowFile() {
  const t = useT()
  const showName = useUiStore((s) => s.showName)
  const isDirty = useUiStore((s) => s.isDirty)
  const [path, setPath] = useState<string | null>(null)

  // The path only changes on save / open / new — all of which change the name or the dirty flag
  useEffect(() => {
    if (isRemoteMode()) return
    let cancelled = false
    getBridge()?.show.getPath().then((p) => { if (!cancelled) setPath(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [showName, isDirty])

  if (isRemoteMode()) return null
  if (!path) {
    return <span className="shrink-0 whitespace-nowrap px-1.5 text-fg-disabled">{t('shell.status.notSavedYet')}</span>
  }
  return (
    <Tooltip content={t('shell.status.revealPath', { path })}>
      <button
        type="button"
        onClick={() => { void getBridge()?.show.reveal() }}
        className="flex h-full min-w-0 max-w-[220px] shrink items-center gap-1.5 rounded-sm px-1.5 hover:bg-surface-3 hover:text-fg-primary"
      >
        <LuFileText size={13} aria-hidden className="shrink-0" />
        <span className="truncate">{path.split(/[\\/]/).pop()}</span>
      </button>
    </Tooltip>
  )
}
