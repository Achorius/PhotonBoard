// ============================================================
// Top bar: brand, File menu, show title | programmer & MIDI state,
// Stage, output health | masters (GM, Strobe, Blinder, Blackout).
// Every subscription is field-level: nothing here re-renders at the
// mixer rate.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import {
  LuChevronDown, LuEraser, LuFilePlus, LuFolderOpen, LuHistory, LuLogOut, LuMonitorPlay, LuPiano, LuPlay,
  LuSave, LuSaveAll, LuSquare, LuUpload, LuFolderSearch, LuCrosshair
} from 'react-icons/lu'
import { Badge, Button, Divider, DropdownMenu, StatusDot, Tooltip, type MenuEntry } from '@renderer/components/ui'
import { useUiStore } from '@renderer/stores/ui-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useFollowStore } from '@renderer/stores/follow-store'
import { clearProgrammer, isProgrammerActive } from '@renderer/lib/dmx-mixer'
import { getTimelineState, onTimelinePlayStateChange, toggleTimeline } from '@renderer/lib/timeline-engine'
import { listShows } from '@renderer/lib/show-io'
import { getBridge, isElectronRuntime, isRemoteMode } from '@renderer/lib/runtime'
import { useRemoteConnection } from '@renderer/hooks/useRemoteConnection'
import { MasterControls, useMidiLearnTarget } from './MasterControls'
import { OutputHealthIndicator } from './OutputHealth'
import {
  requestNewShow, requestOpenShow, requestOpenShowByName, requestQuit, requestSave, requestSaveAs, requestUploadShow
} from './file-actions'

const IS_MAC_ELECTRON = isElectronRuntime() && /mac/i.test(navigator.platform)

export function Toolbar() {
  return (
    <header className="titlebar-drag flex h-topbar shrink-0 items-center gap-2 border-b border-line bg-surface-1 pl-2 pr-2">
      {/* macOS traffic lights (hidden-inset title bar) */}
      {IS_MAC_ELECTRON && <div className="w-[68px] shrink-0" />}
      <div className="titlebar-no-drag flex min-w-0 items-center gap-1">
        <BrandMark />
        <FileMenu />
        <ShowTitle />
      </div>
      <div className="min-w-4 flex-1 self-stretch" />
      <div className="titlebar-no-drag flex shrink-0 items-center gap-1.5">
        <FollowIndicator />
        <TimelineButton />
        <MidiLearnButton />
        <ClearButton />
        <Divider />
        <StageButton />
        {isRemoteMode() && <RemoteIndicator />}
        <OutputHealthIndicator />
        <Divider />
        <MasterControls />
      </div>
    </header>
  )
}

function BrandMark() {
  return (
    <div className="flex h-control w-control items-center justify-center" aria-label="PhotonBoard" role="img">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id="pb-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgb(var(--pb-accent))" stopOpacity="0.95" />
            <stop offset="1" stopColor="rgb(var(--pb-accent))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M9.5 7.5 L3 22 H21 L14.5 7.5 Z" fill="url(#pb-beam)" />
        <circle cx="12" cy="5.5" r="3.5" fill="rgb(var(--pb-accent))" />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------
// File menu
// ---------------------------------------------------------------

function FileMenu() {
  const fileInput = useRef<HTMLInputElement>(null)
  const remote = isRemoteMode()

  const items = (): MenuEntry[] => [
    ...(!remote ? [
      { label: 'New show', icon: LuFilePlus, shortcut: 'Mod+N', onSelect: () => { void requestNewShow() } },
      { label: 'Open…', icon: LuFolderOpen, shortcut: 'Mod+O', onSelect: () => { void requestOpenShow() } }
    ] : []),
    {
      label: remote ? 'Open show on console' : 'Open recent',
      icon: LuHistory,
      submenu: async () => {
        const names = await listShows()
        return names.map((name): MenuEntry => ({ label: name, onSelect: () => { void requestOpenShowByName(name) } }))
      }
    },
    { type: 'separator' },
    { label: 'Save', icon: LuSave, shortcut: 'Mod+S', onSelect: () => { void requestSave() } },
    { label: 'Save as…', icon: LuSaveAll, shortcut: 'Mod+Shift+S', onSelect: () => { void requestSaveAs() } },
    ...(remote ? [
      { type: 'separator' } as const,
      { label: 'Upload show file…', icon: LuUpload, description: 'Send a .pbshow from this device to the console', onSelect: () => fileInput.current?.click() }
    ] : [
      { type: 'separator' } as const,
      { label: 'Reveal show file', icon: LuFolderSearch, onSelect: () => { void getBridge()?.show.reveal() } },
      { type: 'separator' } as const,
      { label: 'Quit PhotonBoard', icon: LuLogOut, shortcut: IS_MAC_ELECTRON ? 'Mod+Q' : undefined, onSelect: () => { void requestQuit() } }
    ])
  ]

  return (
    <>
      <DropdownMenu
        items={items}
        trigger={({ active, ...props }) => (
          <Button {...props} variant="ghost" active={active} tone="neutral" iconRight={LuChevronDown} className="px-2.5">
            File
          </Button>
        )}
      />
      {remote && (
        <input
          ref={fileInput}
          type="file"
          accept=".pbshow,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // same file can be picked again
            if (file) void requestUploadShow(file)
          }}
        />
      )}
    </>
  )
}

function ShowTitle() {
  const showName = useUiStore((s) => s.showName)
  const isDirty = useUiStore((s) => s.isDirty)
  return (
    <div className="ml-1 flex min-w-0 items-center gap-2">
      <span className="truncate text-sm font-semibold text-fg-primary" title={showName}>{showName}</span>
      {isDirty && (
        <Tooltip content="Unsaved changes" shortcut={isRemoteMode() ? undefined : 'Mod+S'}>
          <span role="img" aria-label="Unsaved changes" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        </Tooltip>
      )}
      {isRemoteMode() && <Badge tone="info" size="xs">REMOTE</Badge>}
    </div>
  )
}

// ---------------------------------------------------------------
// State buttons
// ---------------------------------------------------------------

function FollowIndicator() {
  const active = useFollowStore((s) => s.active)
  if (!active) return null
  return (
    <Button size="sm" variant="ghost" icon={LuCrosshair} onClick={() => useUiStore.getState().setActiveTab('follow')} tooltip="Follow spot is tracking — open Follow" className="text-go-fg">
      <span className="inline-flex items-center gap-1.5">Follow <StatusDot tone="go" pulse /></span>
    </Button>
  )
}

function TimelineButton() {
  const [playing, setPlaying] = useState(() => getTimelineState().isPlaying)
  useEffect(() => onTimelinePlayStateChange(setPlaying), [])
  const midi = useMidiLearnTarget('timeline_play', 'Live / Timeline')
  return (
    <Button
      icon={playing ? LuSquare : LuPlay}
      tone="go"
      active={playing}
      onClick={toggleTimeline}
      onContextMenu={midi.onContextMenu}
      tooltip={`${playing ? 'Stop' : 'Play'} the timeline · right-click: MIDI learn`}
      aria-label={playing ? 'Stop timeline' : 'Play timeline'}
      labelClassName="hidden xl:inline"
      className={midi.ring}
    >
      Live
    </Button>
  )
}

function MidiLearnButton() {
  const isLearning = useMidiStore((s) => s.isLearning)
  const learnLabel = useMidiStore((s) => s.learnTarget?.label)
  return (
    <Button
      icon={LuPiano}
      tone="midi"
      active={isLearning}
      onClick={() => {
        const midi = useMidiStore.getState()
        if (midi.isLearning) midi.cancelLearn()
        else midi.startLearn({ type: 'master', label: 'Grand Master' })
      }}
      tooltip={isLearning
        ? 'Move a MIDI control to map it — click to cancel'
        : 'MIDI learn: right-click (or long-press) any control, then move a MIDI fader or key. Click here to learn the Grand Master.'}
      aria-label={isLearning ? `MIDI learning ${learnLabel ?? ''} — cancel` : 'MIDI learn'}
      labelClassName="hidden xl:inline max-w-[160px]"
    >
      {isLearning ? `Learning ${learnLabel ?? '…'}` : 'Learn'}
    </Button>
  )
}

/** Lights up while the programmer holds manual values */
function ClearButton() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setActive(isProgrammerActive()), 250)
    return () => clearInterval(id)
  }, [])
  return (
    <Button
      icon={LuEraser}
      tone="accent"
      active={active}
      onClick={() => { clearProgrammer(); setActive(false) }}
      tooltip={active ? 'Clear the programmer (release manual values)' : 'Programmer is empty'}
      shortcut="Backspace"
      aria-label="Clear programmer"
      labelClassName="hidden xl:inline"
    >
      Clear
    </Button>
  )
}

function StageButton() {
  const remote = isRemoteMode()
  return (
    <Button
      icon={LuMonitorPlay}
      variant="ghost"
      onClick={() => {
        if (remote) useUiStore.getState().setStageMode(true)
        else getBridge()?.stage.open()
      }}
      tooltip={remote ? 'Switch to the Stage view' : 'Open the Stage window (second screen)'}
      shortcut={remote ? undefined : 'Mod+Shift+W'}
      aria-label="Stage"
      labelClassName="hidden xl:inline"
    >
      Stage
    </Button>
  )
}

function RemoteIndicator() {
  const state = useRemoteConnection()
  const label = state === 'open' ? 'Connected to the console' : state === 'auth-required' ? 'PIN required' : 'Reconnecting to the console…'
  return (
    <Tooltip content={label}>
      <span role="status" aria-label={label} className="flex h-control items-center gap-1.5 px-1.5 text-xs text-fg-secondary">
        <StatusDot tone={state === 'open' ? 'go' : state === 'auth-required' ? 'danger' : 'warning'} pulse={state !== 'open'} />
        <span className="hidden xl:inline">{state === 'open' ? 'Online' : 'Offline'}</span>
      </span>
    </Tooltip>
  )
}
