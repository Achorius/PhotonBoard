// ============================================================
// Top bar: brand, File & Edit menus, undo / redo, show title | programmer & MIDI state,
// Stage, output health | masters (GM, Strobe, Blinder, Blackout).
// Every subscription is field-level: nothing here re-renders at the
// mixer rate.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import {
  LuChevronDown, LuCopy, LuEraser, LuFilePlus, LuFolderOpen, LuHistory, LuLogOut, LuMonitorPlay, LuPencil, LuPiano, LuPlay,
  LuRedo2, LuSave, LuSaveAll, LuSquare, LuTrash2, LuUndo2, LuUpload, LuFolderSearch, LuCrosshair
} from 'react-icons/lu'
import { Badge, Button, Divider, DropdownMenu, IconButton, StatusDot, Tooltip, type MenuEntry } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { redo, undo, useHistoryStore } from '@renderer/lib/history'
import {
  canDeleteSelection, canDuplicateSelection, canRenameSelection, deleteSelection, duplicateSelection, getActiveSelection,
  renameSelection
} from '@renderer/lib/selection-actions'
import { useUiStore } from '@renderer/stores/ui-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useFollowStore } from '@renderer/stores/follow-store'
import { clearProgrammer, isProgrammerActive } from '@renderer/lib/dmx-mixer'
import { getTimelineState, onTimelinePlayStateChange } from '@renderer/lib/timeline-engine'
import { transportToggle } from '@renderer/lib/timeline-transport'
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
        <EditMenu />
        <UndoRedoButtons />
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
  const t = useT()
  const fileInput = useRef<HTMLInputElement>(null)
  const remote = isRemoteMode()

  const items = (): MenuEntry[] => [
    ...(!remote ? [
      { label: t('shell.fileMenu.newShow'), icon: LuFilePlus, shortcut: 'Mod+N', onSelect: () => { void requestNewShow() } },
      { label: t('shell.fileMenu.open'), icon: LuFolderOpen, shortcut: 'Mod+O', onSelect: () => { void requestOpenShow() } }
    ] : []),
    {
      label: remote ? t('shell.fileMenu.openOnConsole') : t('shell.fileMenu.openRecent'),
      icon: LuHistory,
      submenu: async () => {
        const names = await listShows()
        return names.map((name): MenuEntry => ({ label: name, onSelect: () => { void requestOpenShowByName(name) } }))
      }
    },
    { type: 'separator' },
    { label: t('shell.fileMenu.save'), icon: LuSave, shortcut: 'Mod+S', onSelect: () => { void requestSave() } },
    { label: t('shell.fileMenu.saveAs'), icon: LuSaveAll, shortcut: 'Mod+Shift+S', onSelect: () => { void requestSaveAs() } },
    ...(remote ? [
      { type: 'separator' } as const,
      { label: t('shell.fileMenu.upload'), icon: LuUpload, description: t('shell.fileMenu.uploadDescription'), onSelect: () => fileInput.current?.click() }
    ] : [
      { type: 'separator' } as const,
      { label: t('shell.fileMenu.reveal'), icon: LuFolderSearch, onSelect: () => { void getBridge()?.show.reveal() } },
      { type: 'separator' } as const,
      { label: t('shell.fileMenu.quit'), icon: LuLogOut, shortcut: IS_MAC_ELECTRON ? 'Mod+Q' : undefined, onSelect: () => { void requestQuit() } }
    ])
  ]

  return (
    <>
      <DropdownMenu
        items={items}
        trigger={({ active, ...props }) => (
          <Button {...props} variant="ghost" active={active} tone="neutral" iconRight={LuChevronDown} className="px-2.5">
            {t('shell.fileMenu.trigger')}
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

// ---------------------------------------------------------------
// Edit menu + undo / redo (touch-friendly buttons next to the menus)
// ---------------------------------------------------------------

const REDO_SHORTCUT = /mac|iphone|ipad/i.test(typeof navigator !== 'undefined' ? navigator.platform : '') ? 'Mod+Shift+Z' : 'Ctrl+Y'

function EditMenu() {
  const t = useT()
  // Built when the menu opens: the active view's selection at that moment
  const items = (): MenuEntry[] => {
    const h = useHistoryStore.getState()
    const sel = getActiveSelection()
    const label = sel ? safeLabel(sel.label) : null
    return [
      {
        label: h.undoLabel ? t('shell.editMenu.undoWhat', { what: h.undoLabel }) : t('shell.editMenu.undo'),
        icon: LuUndo2,
        shortcut: 'Mod+Z',
        disabled: !h.canUndo,
        description: isRemoteMode() ? t('shell.editMenu.remoteHint') : undefined,
        onSelect: () => { undo() }
      },
      {
        label: h.redoLabel ? t('shell.editMenu.redoWhat', { what: h.redoLabel }) : t('shell.editMenu.redo'),
        icon: LuRedo2,
        shortcut: REDO_SHORTCUT,
        disabled: !h.canRedo,
        onSelect: () => { redo() }
      },
      { type: 'separator' },
      {
        label: canDuplicateSelection() && label ? t('shell.editMenu.duplicateWhat', { what: label }) : t('shell.editMenu.duplicateSelection'),
        icon: LuCopy,
        shortcut: 'Mod+D',
        disabled: !canDuplicateSelection(),
        onSelect: () => { duplicateSelection() }
      },
      {
        label: t('shell.editMenu.renameSelection'),
        icon: LuPencil,
        shortcut: 'F2',
        disabled: !canRenameSelection(),
        onSelect: () => { renameSelection() }
      },
      {
        label: canDeleteSelection() && label ? t('shell.editMenu.deleteWhat', { what: label }) : t('shell.editMenu.deleteSelection'),
        icon: LuTrash2,
        shortcut: 'Backspace',
        danger: canDeleteSelection(),
        disabled: !canDeleteSelection(),
        description: sel ? undefined : t('shell.editMenu.noSelection'),
        onSelect: () => { void deleteSelection() }
      }
    ]
  }
  return (
    <DropdownMenu
      items={items}
      trigger={({ active, ...props }) => (
        <Button {...props} variant="ghost" active={active} tone="neutral" iconRight={LuChevronDown} className="px-2.5">
          {t('shell.editMenu.trigger')}
        </Button>
      )}
    />
  )
}

function safeLabel(label: () => string): string | null {
  try { return label() } catch { return null }
}

function UndoRedoButtons() {
  const t = useT()
  const canUndo = useHistoryStore((s) => s.canUndo)
  const canRedo = useHistoryStore((s) => s.canRedo)
  const undoLabel = useHistoryStore((s) => s.undoLabel)
  const redoLabel = useHistoryStore((s) => s.redoLabel)
  // ≥ 1536 px (Pi touchscreen, desktops): one-tap undo / redo. Narrower: in the Edit menu (and Mod+Z)
  return (
    <div className="hidden items-center 2xl:flex">
      <IconButton
        icon={LuUndo2}
        label={undoLabel ? t('shell.editMenu.undoWhat', { what: undoLabel }) : canUndo ? t('shell.editMenu.undo') : t('shell.editMenu.nothingToUndo')}
        shortcut="Mod+Z"
        disabled={!canUndo}
        onClick={() => { undo() }}
      />
      <IconButton
        icon={LuRedo2}
        label={redoLabel ? t('shell.editMenu.redoWhat', { what: redoLabel }) : canRedo ? t('shell.editMenu.redo') : t('shell.editMenu.nothingToRedo')}
        shortcut={REDO_SHORTCUT}
        disabled={!canRedo}
        onClick={() => { redo() }}
      />
    </div>
  )
}

function ShowTitle() {
  const t = useT()
  const showName = useUiStore((s) => s.showName)
  const isDirty = useUiStore((s) => s.isDirty)
  return (
    <div className="ml-1 flex min-w-0 items-center gap-2">
      <span className="truncate text-sm font-semibold text-fg-primary" title={showName}>{showName}</span>
      {isDirty && (
        <Tooltip content={t('shell.unsavedChanges')} shortcut={isRemoteMode() ? undefined : 'Mod+S'}>
          <span role="img" aria-label={t('shell.unsavedChanges')} className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        </Tooltip>
      )}
      {isRemoteMode() && <Badge tone="info" size="xs">{t('shell.remoteBadge')}</Badge>}
    </div>
  )
}

// ---------------------------------------------------------------
// State buttons
// ---------------------------------------------------------------

function FollowIndicator() {
  const t = useT()
  const active = useFollowStore((s) => s.active)
  if (!active) return null
  return (
    <Button size="sm" variant="ghost" icon={LuCrosshair} onClick={() => useUiStore.getState().setActiveTab('follow')} tooltip={t('shell.follow.tooltip')} className="text-go-fg">
      <span className="inline-flex items-center gap-1.5">{t('shell.follow.label')} <StatusDot tone="go" pulse /></span>
    </Button>
  )
}

function TimelineButton() {
  const t = useT()
  const [playing, setPlaying] = useState(() => getTimelineState().isPlaying)
  useEffect(() => onTimelinePlayStateChange(setPlaying), [])
  const midi = useMidiLearnTarget('timeline_play', t('shell.timelineButton.midiLabel'))
  return (
    <Button
      icon={playing ? LuSquare : LuPlay}
      tone="go"
      active={playing}
      onClick={transportToggle}
      onContextMenu={midi.onContextMenu}
      tooltip={playing ? t('shell.timelineButton.stop') : t('shell.timelineButton.play')}
      aria-label={playing ? t('shell.timelineButton.stopAria') : t('shell.timelineButton.playAria')}
      labelClassName="hidden xl:inline"
      className={midi.ring}
    >
      {t('shell.timelineButton.label')}
    </Button>
  )
}

function MidiLearnButton() {
  const t = useT()
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
        else midi.startLearn({ type: 'master', label: translate('common.grandMaster') })
      }}
      tooltip={isLearning ? t('shell.learn.tooltipLearning') : t('shell.learn.tooltipIdle')}
      aria-label={isLearning ? t('shell.learn.ariaLearning', { target: learnLabel ?? '' }) : t('shell.learn.ariaIdle')}
      labelClassName="hidden xl:inline max-w-[160px]"
    >
      {isLearning ? (learnLabel ? t('shell.learn.learning', { target: learnLabel }) : t('shell.learn.learningEllipsis')) : t('shell.learn.label')}
    </Button>
  )
}

/** Lights up while the programmer holds manual values */
function ClearButton() {
  const t = useT()
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
      tooltip={active ? t('shell.clear.tooltipActive') : t('shell.clear.tooltipEmpty')}
      shortcut="Mod+Backspace"
      aria-label={t('shell.clear.aria')}
      labelClassName="hidden xl:inline"
    >
      {t('shell.clear.label')}
    </Button>
  )
}

function StageButton() {
  const t = useT()
  const remote = isRemoteMode()
  return (
    <Button
      icon={LuMonitorPlay}
      variant="ghost"
      onClick={() => {
        if (remote) useUiStore.getState().setStageMode(true)
        else getBridge()?.stage.open()
      }}
      tooltip={remote ? t('shell.stage.tooltipRemote') : t('shell.stage.tooltipConsole')}
      shortcut={remote ? undefined : 'Mod+Shift+W'}
      aria-label={t('shell.stage.label')}
      labelClassName="hidden xl:inline"
    >
      {t('shell.stage.label')}
    </Button>
  )
}

function RemoteIndicator() {
  const t = useT()
  const state = useRemoteConnection()
  const label = state === 'open' ? t('shell.connection.connected') : state === 'auth-required' ? t('shell.connection.pinRequired') : t('shell.connection.reconnecting')
  return (
    <Tooltip content={label}>
      <span role="status" aria-label={label} className="flex h-control items-center gap-1.5 px-1.5 text-xs text-fg-secondary">
        <StatusDot tone={state === 'open' ? 'go' : state === 'auth-required' ? 'danger' : 'warning'} pulse={state !== 'open'} />
        <span className="hidden xl:inline">{state === 'open' ? t('shell.connection.online') : t('shell.connection.offline')}</span>
      </span>
    </Tooltip>
  )
}
