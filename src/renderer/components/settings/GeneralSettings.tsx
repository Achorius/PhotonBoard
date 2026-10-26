// ============================================================
// Settings → Display, Show and About pages.
// ============================================================

import { useEffect, useState } from 'react'
import {
  LuFile, LuFilePlus2, LuFolderOpen, LuFolderSearch, LuHand, LuKeyboard, LuLanguages, LuLayoutPanelLeft, LuMonitor, LuMousePointer2,
  LuPanelBottom, LuPiano, LuSave, LuSquareTerminal, LuSaveAll, LuSparkles, LuTimer, LuWandSparkles, LuFileInput, LuFileOutput, LuArrowLeftRight
} from 'react-icons/lu'
import { Badge, Button, Kbd, SegmentedControl, Switch, cn, type DensityPreference } from '@renderer/components/ui'
import { detectAutoDensity, useShowTitle, useUiStore, type LanguagePreference } from '@renderer/stores/ui-store'
import { LOCALE_NAMES, detectSystemLocale, t as translate, useT } from '@renderer/i18n'
import { getDeviceProfile } from '@renderer/lib/device-detect'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { isTimecodeChase, isTimecodeEnabled, getTimecodeFramerate } from '@renderer/lib/timecode-engine'
import { requestExport, requestImport, requestNewShow, requestOpenShow, requestSave, requestSaveAs } from '@renderer/components/layout/file-actions'
import { SupportedFormats } from '@renderer/components/interchange/ImportWizard'
import { InfoRow, SettingRow, SettingsCard, SettingsPage } from './settings-ui'
import { TouchscreensCard, touchDiagnosticsAvailable } from './TouchscreenSettings'

// ---------------------------------------------------------------
// Display
// ---------------------------------------------------------------

/** Language of this device's UI — names in their own language, no flags */
function LanguageCard() {
  const t = useT()
  const pref = useUiStore((s) => s.languagePreference)
  return (
    <SettingsCard icon={LuLanguages} title={t('settings.display.language.title')}>
      <SettingRow
        label={t('settings.display.language.label')}
        description={
          <>
            {pref === 'auto' && <>{t('settings.display.language.descriptionAuto', { language: LOCALE_NAMES[detectSystemLocale()] })} </>}
            {t('settings.display.language.description')}
          </>
        }
      >
        <SegmentedControl<LanguagePreference>
          aria-label={t('settings.display.language.aria')}
          size="md"
          value={pref}
          onChange={(v) => useUiStore.getState().setLanguagePreference(v)}
          items={[
            { value: 'auto', label: t('settings.display.language.auto'), icon: LuWandSparkles },
            { value: 'fr', label: LOCALE_NAMES.fr },
            { value: 'en', label: LOCALE_NAMES.en }
          ]}
        />
      </SettingRow>
    </SettingsCard>
  )
}

export function DisplaySettings() {
  const t = useT()
  const pref = useUiStore((s) => s.densityPreference)
  const density = useUiStore((s) => s.density)
  const executorBarOpen = useUiStore((s) => s.executorBarOpen)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const proMode = useUiStore((s) => s.proMode)
  const auto = detectAutoDensity()
  const profile = getDeviceProfile()

  return (
    <SettingsPage title={t('settings.display.title')} description={t('settings.display.description')}>
      <LanguageCard />

      <SettingsCard icon={LuMonitor} title={t('settings.display.controlSize')}>
        <SettingRow
          label={t('settings.display.density')}
          description={
            pref === 'auto'
              ? t('settings.display.densityAuto', { choice: auto === 'touch' ? t('settings.display.densityAutoTouch') : t('settings.display.densityAutoCompact') })
              : density === 'touch'
                ? t('settings.display.densityTouch')
                : t('settings.display.densityCompact')
          }
        >
          <SegmentedControl<DensityPreference>
            aria-label={t('settings.display.density')}
            size="md"
            value={pref}
            onChange={(v) => useUiStore.getState().setDensityPreference(v)}
            items={[
              { value: 'auto', label: t('settings.display.densityOptions.auto'), icon: LuWandSparkles },
              { value: 'compact', label: t('settings.display.densityOptions.compact'), icon: LuMousePointer2 },
              { value: 'touch', label: t('settings.display.densityOptions.touch'), icon: LuHand }
            ]}
          />
        </SettingRow>
        <DensityPreview density={density} />
      </SettingsCard>

      {touchDiagnosticsAvailable() && <TouchscreensCard />}

      <SettingsCard icon={LuLayoutPanelLeft} title={t('settings.display.layout')}>
        <SettingRow label={t('settings.display.executorBar')} description={t('settings.display.executorBarDescription')}>
          <Switch checked={executorBarOpen} onChange={(on) => useUiStore.getState().toggleExecutorBar(on)} aria-label={t('settings.display.executorBarAria')} />
        </SettingRow>
        <SettingRow label={t('settings.display.sidebar')} description={t('settings.display.sidebarDescription')}>
          <Switch checked={sidebarOpen} onChange={(on) => useUiStore.getState().toggleSidebar(on)} aria-label={t('settings.display.sidebarAria')} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard icon={LuSquareTerminal} title={t('settings.display.programming')} subtitle={t('settings.display.programmingSubtitle')}>
        <SettingRow label={t('pro.proMode')} description={t('pro.proModeHint')}>
          <Switch checked={proMode} onChange={(on) => useUiStore.getState().setProMode(on)} aria-label={t('settings.display.proModeAria')} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard icon={LuSparkles} title={t('settings.display.visualizer')} subtitle={t('settings.display.visualizerSubtitle')}>
        <InfoRow label={t('settings.display.deviceClass')}>
          {profile.isLowEnd ? t('settings.display.deviceLowEnd') : profile.isMidRange ? t('settings.display.deviceMidRange') : t('settings.display.deviceDesktop')}
        </InfoRow>
        <InfoRow label={t('settings.display.frameRate')}><span className="font-mono tabular">{t('units.fpsValue', { value: profile.visualizerFps })}</span></InfoRow>
        <InfoRow label={t('settings.display.pixelRatio')}>{t('settings.display.pixelRatioMax', { value: profile.maxPixelRatio })}</InfoRow>
      </SettingsCard>
    </SettingsPage>
  )
}

function DensityPreview({ density }: { density: 'compact' | 'touch' }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle bg-surface-0/40 px-4 py-3">
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('settings.display.preview')}</span>
      <Button size="sm" icon={LuSave}>{t('settings.display.previewButton')}</Button>
      <Button size="sm" variant="primary">{t('settings.display.previewPrimary')}</Button>
      <Badge>{density === 'touch' ? t('settings.display.previewTouch') : t('settings.display.previewCompact')}</Badge>
    </div>
  )
}

// ---------------------------------------------------------------
// Show
// ---------------------------------------------------------------

export function ShowSettings() {
  const t = useT()
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
    if (!ok) useUiStore.getState().showStatus(translate('settings.show.revealFailed'), 'error')
  }

  const go = (tab: 'midi' | 'live') => useUiStore.getState().setActiveTab(tab)

  return (
    <SettingsPage title={t('settings.show.title')} description={t('settings.show.description')}>
      <SettingsCard
        icon={LuFile}
        title={showName}
        status={isDirty ? <Badge size="xs" tone="warning">{t('settings.show.unsaved')}</Badge> : <Badge size="xs" tone="go">{t('settings.show.saved')}</Badge>}
        actions={
          <>
            <Button size="sm" variant={isDirty ? 'primary' : 'secondary'} icon={LuSave} onClick={() => { void requestSave() }}>{t('common.save')}</Button>
            <Button size="sm" variant="ghost" icon={LuSaveAll} onClick={() => { void requestSaveAs() }}>{t('common.saveAs')}</Button>
          </>
        }
      >
        <InfoRow label={t('settings.show.file')} mono>
          {path === undefined ? '…' : path ?? <span className="font-sans text-sm text-fg-tertiary">{t('settings.show.notSavedYet')}</span>}
        </InfoRow>
        <InfoRow label={t('settings.show.backups')}>
          {t.rich('settings.show.backupsText', { file: <span className="font-mono text-xs">.pbshow.bak</span> })}
        </InfoRow>
        <InfoRow label={t('settings.show.autosave')}>
          {t.rich('settings.show.autosaveText', { keys: <Kbd keys="Mod+S" className="align-middle" /> })}
        </InfoRow>
        {!remote && (
          <div className="flex flex-wrap gap-2 border-t border-line-subtle px-4 py-3">
            <Button size="sm" icon={LuFolderOpen} onClick={() => { void requestOpenShow() }}>{t('settings.show.openShow')}</Button>
            <Button size="sm" icon={LuFilePlus2} onClick={() => { void requestNewShow() }}>{t('settings.show.newShow')}</Button>
            <Button size="sm" variant="ghost" icon={LuFolderSearch} onClick={() => { void reveal() }}>{t('settings.show.showInFolder')}</Button>
          </div>
        )}
      </SettingsCard>

      <FormatsCard />

      <SettingsCard icon={LuTimer} title={t('settings.show.inputs')} subtitle={t('settings.show.inputsSubtitle')}>
        <SettingRow label={t('settings.show.midi')} description={t('settings.show.midiDescription')}>
          <Button size="sm" variant="secondary" icon={LuPiano} onClick={() => go('midi')}>{t('settings.show.openMidi')}</Button>
        </SettingRow>
        <SettingRow
          label={t('settings.show.mtc')}
          description={
            isTimecodeEnabled()
              ? `${t('settings.show.mtcEnabled', { fps: getTimecodeFramerate() })}${isTimecodeChase() ? t('settings.show.mtcChase') : ''}`
              : t('settings.show.mtcDisabled')
          }
        >
          <Button size="sm" variant="secondary" icon={LuTimer} onClick={() => go('live')}>{t('settings.show.openTimeline')}</Button>
        </SettingRow>
      </SettingsCard>
    </SettingsPage>
  )
}

/** Formats the console imports / exports (also in About) */
function FormatsCard() {
  const t = useT()
  return (
    <SettingsCard
      icon={LuArrowLeftRight}
      title={t('interchange.formatsPage.title')}
      subtitle={t('interchange.formatsPage.description')}
      actions={
        <>
          <Button size="sm" icon={LuFileInput} onClick={() => { void requestImport() }}>{t('interchange.menu.import')}</Button>
          <Button size="sm" variant="ghost" icon={LuFileOutput} onClick={() => { requestExport() }}>{t('interchange.menu.export')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-3" data-supported-formats>
        <SupportedFormats showExports />
        <p className="text-xs text-fg-tertiary">{t('interchange.formatsPage.openFormat')}</p>
      </div>
    </SettingsCard>
  )
}

// ---------------------------------------------------------------
// About
// ---------------------------------------------------------------

function platformInfo() {
  const t = translate
  const ua = navigator.userAgent
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1]
  const chrome = /Chrom(?:e|ium)\/([\d.]+)/.exec(ua)?.[1]
  const os = /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS / iPadOS'
          : /Linux/.test(ua) ? 'Linux' : t('settings.about.unknownOs')
  const arch = /aarch64|arm64/i.test(ua) || /arm/i.test(navigator.platform) ? t('settings.about.arm64') : /x86_64|Win64|x64|Intel/i.test(ua) ? 'x86-64' : ''
  return { electron, chrome, os, arch }
}

export function AboutSettings() {
  const t = useT()
  const [version, setVersion] = useState<string | null>(null)
  const remote = isRemoteMode()
  const info = platformInfo()
  // Unpackaged runs (electron out/main) report Electron's own version
  const devBuild = !!version && version === info.electron

  useEffect(() => {
    getBridge()?.app.getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  return (
    <SettingsPage title={t('settings.about.title')} description={t('settings.about.description')}>
      <SettingsCard icon={LuSparkles} title="PhotonBoard" status={version && !devBuild && <Badge size="xs" mono>v{version}</Badge>}>
        <InfoRow label={t('settings.about.version')}>{devBuild ? t('settings.about.devBuild') : <span className="font-mono tabular">{version ?? '…'}</span>}</InfoRow>
        <InfoRow label={t('settings.about.runningAs')}>{remote ? t('settings.about.runningRemote') : t('settings.about.runningConsole')}</InfoRow>
        <InfoRow label={t('settings.about.platform')}>{[info.os, info.arch].filter(Boolean).join(' · ')}</InfoRow>
        {info.electron && <InfoRow label="Electron"><span className="font-mono tabular">{info.electron}</span></InfoRow>}
        {info.chrome && <InfoRow label="Chromium"><span className="font-mono tabular">{info.chrome}</span></InfoRow>}
        <InfoRow label={t('settings.about.screen')}><span className="font-mono tabular">{window.screen.width} × {window.screen.height}</span> · {t('settings.about.pixelRatio', { value: window.devicePixelRatio })}</InfoRow>
      </SettingsCard>

      <SettingsCard icon={LuKeyboard} title={t('settings.about.help')}>
        <SettingRow label={t('settings.about.shortcuts')} description={t('settings.about.shortcutsDescription')}>
          <Button size="sm" icon={LuKeyboard} onClick={() => useUiStore.getState().setShortcutsOpen(true)}>{t('settings.about.showShortcuts')}</Button>
        </SettingRow>
      </SettingsCard>

      <FormatsCard />

      <SettingsCard icon={LuPanelBottom} title={t('settings.about.credits')}>
        <ul className={cn('flex flex-col gap-1.5 px-4 py-3 text-sm text-fg-secondary')}>
          <li>{t.rich('settings.about.creditOfl', { ofl: <span className="text-fg-primary">{t('settings.about.creditOflName')}</span> })}</li>
          <li>{t('settings.about.creditBuilt')}</li>
          <li>{t('settings.about.creditFonts')}</li>
          <li>{t('settings.about.creditArtnet')}</li>
        </ul>
      </SettingsCard>
    </SettingsPage>
  )
}
