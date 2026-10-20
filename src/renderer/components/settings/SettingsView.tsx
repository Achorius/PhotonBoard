// ============================================================
// Settings — machine & per-device configuration.
//   Outputs        DMX outputs (machine config, dmxOutputs API)
//   Remote access  web remote URL + QR, PIN, Companion API
//   Display        language, density, executor bar, sidebar, 3D quality
//   Show           current file, save / open, backups, MIDI & timecode links
//   About          version, platform, credits
// ============================================================

import { useState } from 'react'
import type { IconType } from 'react-icons'
import { LuCable, LuFileText, LuInfo, LuMonitor, LuSettings, LuSmartphone } from 'react-icons/lu'
import { StatusDot, cn, type Tone } from '@renderer/components/ui'
import { outputHealth, useOutputStatus, type OutputHealth } from '@renderer/hooks/useOutputStatus'
import { useT } from '@renderer/i18n'
import { OutputsSettings } from './OutputsSettings'
import { RemoteAccessSettings } from './RemoteAccessSettings'
import { AboutSettings, DisplaySettings, ShowSettings } from './GeneralSettings'
import { healthSummary } from '@renderer/components/layout/OutputHealth'

type SectionId = 'outputs' | 'remote' | 'display' | 'show' | 'about'

/** Labels: settings.sections.<id>.label / .hint */
const SECTIONS: { id: SectionId; icon: IconType }[] = [
  { id: 'outputs', icon: LuCable },
  { id: 'remote', icon: LuSmartphone },
  { id: 'display', icon: LuMonitor },
  { id: 'show', icon: LuFileText },
  { id: 'about', icon: LuInfo }
]

/** Section shown when the view mounts again (a language switch must not jump back to Outputs) */
let lastSection: SectionId | null = null

const HEALTH_TONE: Record<OutputHealth, Tone> = { ok: 'go', degraded: 'warning', error: 'danger', none: 'warning', unknown: 'neutral' }

export function SettingsView() {
  const t = useT()
  // Opens on Outputs (the output-health popover links here) unless reopened within the session
  const [section, setSectionState] = useState<SectionId>(() => lastSection ?? 'outputs')
  const setSection = (id: SectionId) => { lastSection = id; setSectionState(id) }

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3">
        <LuSettings size={16} aria-hidden className="text-fg-tertiary" />
        <h1 className="text-sm font-semibold text-fg-primary">{t('settings.title')}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('settings.sectionsAria')}
          className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface-1 p-2 [[data-density=touch]_&]:w-[272px]"
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
  const t = useT()
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
        <span className="truncate text-sm font-medium">{t(`settings.sections.${s.id}.label`)}</span>
        <span className="truncate text-2xs text-fg-tertiary">{t(`settings.sections.${s.id}.hint`)}</span>
      </span>
      {s.id === 'outputs' && <OutputsNavDot />}
    </button>
  )
}

/** Output health next to the Outputs entry (shared 1 Hz poll) */
function OutputsNavDot() {
  const status = useOutputStatus()
  const { health, active } = outputHealth(status)
  if (health === 'unknown') return null
  return <StatusDot tone={HEALTH_TONE[health]} pulse={health === 'error'} label={healthSummary(health, active.length)} />
}
