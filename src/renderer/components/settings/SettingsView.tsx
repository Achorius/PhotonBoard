// ============================================================
// Settings — machine & per-device configuration.
//   Outputs        DMX outputs (machine config, dmxOutputs API)
//   Remote access  web remote URL + QR, PIN, Companion API
//   Display        density, executor bar, sidebar, 3D quality
//   Show           current file, save / open, backups, MIDI & timecode links
//   About          version, platform, credits
// ============================================================

import { useState } from 'react'
import type { IconType } from 'react-icons'
import { LuCable, LuFileText, LuInfo, LuMonitor, LuSettings, LuSmartphone } from 'react-icons/lu'
import { StatusDot, cn, type Tone } from '@renderer/components/ui'
import { outputHealth, useOutputStatus, type OutputHealth } from '@renderer/hooks/useOutputStatus'
import { useUiStore } from '@renderer/stores/ui-store'
import { OutputsSettings } from './OutputsSettings'
import { RemoteAccessSettings } from './RemoteAccessSettings'
import { AboutSettings, DisplaySettings, ShowSettings } from './GeneralSettings'

type SectionId = 'outputs' | 'remote' | 'display' | 'show' | 'about'

const SECTIONS: { id: SectionId; label: string; hint: string; icon: IconType }[] = [
  { id: 'outputs', label: 'Outputs', hint: 'Art-Net · USB DMX', icon: LuCable },
  { id: 'remote', label: 'Remote access', hint: 'Phone · tablet · Companion', icon: LuSmartphone },
  { id: 'display', label: 'Display', hint: 'Density · layout', icon: LuMonitor },
  { id: 'show', label: 'Show', hint: 'File · backups · inputs', icon: LuFileText },
  { id: 'about', label: 'About', hint: 'Version · credits', icon: LuInfo }
]

const HEALTH_TONE: Record<OutputHealth, Tone> = { ok: 'go', degraded: 'warning', error: 'danger', none: 'warning', unknown: 'neutral' }

export function SettingsView() {
  // Always opens on Outputs (the output-health popover links here)
  const [section, setSection] = useState<SectionId>('outputs')

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3">
        <LuSettings size={16} aria-hidden className="text-fg-tertiary" />
        <h1 className="text-sm font-semibold text-fg-primary">Settings</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface-1 p-2 [[data-density=touch]_&]:w-64"
        >
          {SECTIONS.map((s) => (
            <NavItem key={s.id} section={s} active={section === s.id} onSelect={() => setSection(s.id)} />
          ))}
        </nav>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto" key={section}>
          {section === 'outputs' && <OutputsSettings />}
          {section === 'remote' && <RemoteAccessSettings />}
          {section === 'display' && <DisplaySettings />}
          {section === 'show' && <ShowSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function NavItem({ section: s, active, onSelect }: { section: (typeof SECTIONS)[number]; active: boolean; onSelect: () => void }) {
  const Icon = s.icon
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={cn(
        'relative flex min-h-control-lg items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors duration-fast',
        active ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary'
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" />}
      <Icon size={18} aria-hidden className={cn('shrink-0', active ? 'text-accent-fg' : 'text-fg-tertiary')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{s.label}</span>
        <span className="truncate text-2xs text-fg-tertiary">{s.hint}</span>
      </span>
      {s.id === 'outputs' && <OutputsNavDot />}
    </button>
  )
}

/** Output health next to the Outputs entry (shared 1 Hz poll) */
function OutputsNavDot() {
  const { health } = outputHealth(useOutputStatus())
  if (health === 'unknown') return null
  return <StatusDot tone={HEALTH_TONE[health]} pulse={health === 'error'} label={`Outputs: ${health}`} />
}
