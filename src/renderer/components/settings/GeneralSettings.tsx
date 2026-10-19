// ============================================================
// Settings → Display, Show and About pages.
// ============================================================

import { useEffect, useState } from 'react'
import {
  LuFile, LuFilePlus2, LuFolderOpen, LuFolderSearch, LuHand, LuKeyboard, LuLayoutPanelLeft, LuMonitor, LuMousePointer2,
  LuPanelBottom, LuPiano, LuSave, LuSaveAll, LuSparkles, LuTimer, LuWandSparkles
} from 'react-icons/lu'
import { Badge, Button, SegmentedControl, Switch, cn, type DensityPreference } from '@renderer/components/ui'
import { detectAutoDensity, useShowTitle, useUiStore } from '@renderer/stores/ui-store'
import { getDeviceProfile } from '@renderer/lib/device-detect'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { isTimecodeChase, isTimecodeEnabled, getTimecodeFramerate } from '@renderer/lib/timecode-engine'
import { requestNewShow, requestOpenShow, requestSave, requestSaveAs } from '@renderer/components/layout/file-actions'
import { InfoRow, SettingRow, SettingsCard, SettingsPage } from './settings-ui'

// ---------------------------------------------------------------
// Display
// ---------------------------------------------------------------

export function DisplaySettings() {
  const pref = useUiStore((s) => s.densityPreference)
  const density = useUiStore((s) => s.density)
  const executorBarOpen = useUiStore((s) => s.executorBarOpen)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const auto = detectAutoDensity()
  const profile = getDeviceProfile()

  return (
    <SettingsPage title="Display" description="How the console looks on this screen. Saved per device: the Pi, a laptop and each tablet keep their own choice.">
      <SettingsCard icon={LuMonitor} title="Control size">
        <SettingRow
          label="Density"
          description={
            pref === 'auto'
              ? `Auto picks ${auto === 'touch' ? 'Touch on this touchscreen' : 'Compact for mouse and trackpad'}.`
              : density === 'touch'
                ? 'Touch: large targets (44 px) for fingers — Pi touchscreen, tablets.'
                : 'Compact: dense layout for mouse and trackpad.'
          }
        >
          <SegmentedControl<DensityPreference>
            aria-label="Density"
            size="md"
            value={pref}
            onChange={(v) => useUiStore.getState().setDensityPreference(v)}
            items={[
              { value: 'auto', label: 'Auto', icon: LuWandSparkles },
              { value: 'compact', label: 'Compact', icon: LuMousePointer2 },
              { value: 'touch', label: 'Touch', icon: LuHand }
            ]}
          />
        </SettingRow>
        <DensityPreview density={density} />
      </SettingsCard>

      <SettingsCard icon={LuLayoutPanelLeft} title="Layout">
        <SettingRow label="Executor bar" description="The 8 × 4 scene buttons at the bottom of every view.">
          <Switch checked={executorBarOpen} onChange={(on) => useUiStore.getState().toggleExecutorBar(on)} aria-label="Show the executor bar" />
        </SettingRow>
        <SettingRow label="Fixture sidebar" description="Patched fixtures and groups on the left, for quick selection.">
          <Switch checked={sidebarOpen} onChange={(on) => useUiStore.getState().toggleSidebar(on)} aria-label="Show the fixture sidebar" />
        </SettingRow>
      </SettingsCard>

      <SettingsCard icon={LuSparkles} title="3D visualiser" subtitle="Quality adapts automatically to this device's graphics.">
        <InfoRow label="Device class">
          {profile.isLowEnd ? 'Low-end graphics — 2D stage layout' : profile.isMidRange ? 'ARM graphics (Raspberry Pi) — 2D stage layout by default' : 'Desktop graphics — full 3D'}
        </InfoRow>
        <InfoRow label="Frame rate"><span className="font-mono tabular">{profile.visualizerFps} fps</span></InfoRow>
        <InfoRow label="Pixel ratio"><span className="font-mono tabular">{profile.maxPixelRatio}×</span> maximum</InfoRow>
      </SettingsCard>
    </SettingsPage>
  )
}

function DensityPreview({ density }: { density: 'compact' | 'touch' }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle bg-surface-0/40 px-4 py-3">
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Preview</span>
      <Button size="sm" icon={LuSave}>Button</Button>
      <Button size="sm" variant="primary">Primary</Button>
      <Badge>{density === 'touch' ? 'Touch · 44 px targets' : 'Compact · 30 px controls'}</Badge>
    </div>
  )
}

// ---------------------------------------------------------------
// Show
// ---------------------------------------------------------------

export function ShowSettings() {
  const { showName, isDirty } = useShowTitle()
  const remote = isRemoteMode()
  const [path, setPath] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    getBridge()?.show.getPath().then((p) => { if (alive) setPath(p) }).catch(() => { if (alive) setPath(null) })
    return () => { alive = false }
  }, [showName, isDirty])

  const reveal = async () => {
    const ok = await getBridge()?.show.reveal().catch(() => false)
    if (!ok) useUiStore.getState().showStatus('Could not open the shows folder', 'error')
  }

  const go = (tab: 'midi' | 'live') => useUiStore.getState().setActiveTab(tab)

  return (
    <SettingsPage title="Show" description="The show file holds the patch, groups, scenes, chases, effects, timeline and MIDI mappings.">
      <SettingsCard
        icon={LuFile}
        title={showName}
        status={isDirty ? <Badge size="xs" tone="warning">Unsaved changes</Badge> : <Badge size="xs" tone="go">Saved</Badge>}
        actions={
          <>
            <Button size="sm" variant={isDirty ? 'primary' : 'secondary'} icon={LuSave} onClick={() => { void requestSave() }}>Save</Button>
            <Button size="sm" variant="ghost" icon={LuSaveAll} onClick={() => { void requestSaveAs() }}>Save as…</Button>
          </>
        }
      >
        <InfoRow label="File" mono>
          {path === undefined ? '…' : path ?? <span className="font-sans text-sm text-fg-tertiary">Not saved yet — Save picks a location</span>}
        </InfoRow>
        <InfoRow label="Backups">
          Every save is atomic and keeps the previous version as <span className="font-mono text-xs">.pbshow.bak</span>; a damaged file is restored from it automatically.
        </InfoRow>
        <InfoRow label="Autosave">
          Off — save with <span className="font-mono text-xs">Ctrl/Cmd + S</span>. The last show reopens automatically at start-up.
        </InfoRow>
        {!remote && (
          <div className="flex flex-wrap gap-2 border-t border-line-subtle px-4 py-3">
            <Button size="sm" icon={LuFolderOpen} onClick={() => { void requestOpenShow() }}>Open show…</Button>
            <Button size="sm" icon={LuFilePlus2} onClick={() => { void requestNewShow() }}>New show</Button>
            <Button size="sm" variant="ghost" icon={LuFolderSearch} onClick={() => { void reveal() }}>Show in folder</Button>
          </div>
        )}
      </SettingsCard>

      <SettingsCard icon={LuTimer} title="Control inputs" subtitle="Configured in their own views.">
        <SettingRow label="MIDI devices & mappings" description="Controllers, learn mode, scene and fader mappings (saved with the show).">
          <Button size="sm" variant="secondary" icon={LuPiano} onClick={() => go('midi')}>Open MIDI</Button>
        </SettingRow>
        <SettingRow
          label="MIDI timecode (MTC)"
          description={
            isTimecodeEnabled()
              ? `Enabled · ${getTimecodeFramerate()} fps${isTimecodeChase() ? ' · timeline chases timecode' : ''}`
              : 'Chase an external MTC source with the timeline.'
          }
        >
          <Button size="sm" variant="secondary" icon={LuTimer} onClick={() => go('live')}>Open Timeline</Button>
        </SettingRow>
      </SettingsCard>
    </SettingsPage>
  )
}

// ---------------------------------------------------------------
// About
// ---------------------------------------------------------------

function platformInfo() {
  const ua = navigator.userAgent
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1]
  const chrome = /Chrom(?:e|ium)\/([\d.]+)/.exec(ua)?.[1]
  const os = /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS / iPadOS'
          : /Linux/.test(ua) ? 'Linux' : 'Unknown OS'
  const arch = /aarch64|arm64/i.test(ua) || /arm/i.test(navigator.platform) ? 'ARM 64-bit' : /x86_64|Win64|x64|Intel/i.test(ua) ? 'x86-64' : ''
  return { electron, chrome, os, arch }
}

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null)
  const remote = isRemoteMode()
  const info = platformInfo()
  // Unpackaged runs (electron out/main) report Electron's own version
  const devBuild = !!version && version === info.electron

  useEffect(() => {
    getBridge()?.app.getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  return (
    <SettingsPage title="About PhotonBoard" description="DMX lighting console for laptops, the Raspberry Pi touchscreen and browsers.">
      <SettingsCard icon={LuSparkles} title="PhotonBoard" status={version && !devBuild && <Badge size="xs" mono>v{version}</Badge>}>
        <InfoRow label="Version">{devBuild ? 'Development build' : <span className="font-mono tabular">{version ?? '…'}</span>}</InfoRow>
        <InfoRow label="Running as">{remote ? 'Web remote (browser) — connected to a console' : 'Console (desktop app)'}</InfoRow>
        <InfoRow label="Platform">{[info.os, info.arch].filter(Boolean).join(' · ')}</InfoRow>
        {info.electron && <InfoRow label="Electron"><span className="font-mono tabular">{info.electron}</span></InfoRow>}
        {info.chrome && <InfoRow label="Chromium"><span className="font-mono tabular">{info.chrome}</span></InfoRow>}
        <InfoRow label="Screen"><span className="font-mono tabular">{window.screen.width} × {window.screen.height}</span> · {window.devicePixelRatio}× pixel ratio</InfoRow>
      </SettingsCard>

      <SettingsCard icon={LuKeyboard} title="Help">
        <SettingRow label="Keyboard shortcuts" description="Every shortcut, grouped by area.">
          <Button size="sm" icon={LuKeyboard} onClick={() => useUiStore.getState().setShortcutsOpen(true)}>Show shortcuts</Button>
        </SettingRow>
      </SettingsCard>

      <SettingsCard icon={LuPanelBottom} title="Credits">
        <ul className={cn('flex flex-col gap-1.5 px-4 py-3 text-sm text-fg-secondary')}>
          <li>Fixture definitions from the <span className="text-fg-primary">Open Fixture Library</span> (open-fixture-library.org) and QLC+ / GDTF imports.</li>
          <li>Built with Electron, React, Zustand, Three.js and Tailwind CSS.</li>
          <li>Inter and JetBrains Mono typefaces (SIL Open Font License) · Lucide icons (ISC).</li>
          <li>Art-Net™ designed by and copyright Artistic Licence Holdings Ltd.</li>
        </ul>
      </SettingsCard>
    </SettingsPage>
  )
}
