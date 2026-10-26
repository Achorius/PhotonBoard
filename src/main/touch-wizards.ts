// ============================================================
// PhotonBoard — touchscreen setup service (Linux X11 console)
//
// Owns everything Settings › Display › Touchscreens does:
//   list / save / reset      touch-setup.ts (scan, touch.json, apply)
//   identify                 assignment wizard: an overlay on EVERY output
//                            ("Touch THIS screen", one at a time); the
//                            touched panel is read from its event nodes
//                            (touch-events.ts), not from the mapping
//   calibrate                4 targets + centre check on the panel's output
//   test                     overlays draw where each touch lands (30 s)
//   auto-apply               at start (once X answers) and whenever input
//                            devices change (a replugged panel loses its
//                            matrix), debounced
// Overlays: frameless, always-on-top windows on each output's geometry
// (fullscreen when Electron sees a display there), inline page
// (touch-overlay-page.ts) + a tiny preload. One wizard at a time.
// Nothing here throws to the renderer.
// ============================================================

import { BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync, watch as fsWatch, type FSWatcher } from 'fs'
import type {
  TouchCalibrateResult,
  TouchIdentifyResult,
  TouchOutput,
  TouchPanel,
  TouchPanelSettings,
  TouchSetupInfo,
  TouchSetupResult,
  TouchTestResult
} from '../shared/photonboard-api'
import { IPC } from '../shared/types'
import {
  applyScan,
  applyTouchSetup,
  dropFromConfig,
  effectiveSettings,
  mergeConfig,
  panelOrientation,
  readTouchConfig,
  scanTouchSetup,
  touchConfigPath,
  unsupportedReason,
  writeTouchConfig,
  type SettingsOverride,
  type TouchSystemDeps
} from './touch-setup'
import { inputDevicesFingerprint, watchPanelTouches } from './touch-events'
import { CalibrationFlow, IdentifyFlow, type TapRegion } from './touch-wizard-flow'
import { touchOverlayHtml, type OverlayButton, type OverlayView } from './touch-overlay-page'

type Lang = 'fr' | 'en'

const STRINGS = {
  en: {
    screen: 'Screen {n}',
    screenName: 'Screen {n} · {name}',
    touchThis: 'Touch THIS screen',
    touchThisHint: 'Put a finger anywhere on this screen. A screen without a touch panel: Skip.',
    touchOther: 'Touch screen {n} — the one showing a big {n}',
    thisScreen: 'This screen: {screen}',
    step: 'Step {i} / {total}',
    autoSkip: 'Skipped automatically in {s} s',
    skipThis: 'Skip this screen',
    skipN: 'Skip screen {n}',
    cancel: 'Cancel',
    assigned: '✓ Touch panel assigned to this screen',
    skipped: 'No touch panel',
    calTitle: 'Touch the centre of the target',
    calCheck: 'Touch the centre to check',
    calSubtitle: 'Calibration · {screen} · {panel}',
    calProgress: 'Point {i} / {total}',
    calCheckProgress: 'Check',
    calWait: 'One moment…',
    calFailedTitle: 'The touches do not line up',
    calInconsistent: 'One touch was {pct} % of the screen away from where the others put it. Touch each target precisely with one finger, then try again.',
    calDegenerate: 'The touches were too close to each other to measure anything. Touch each target where it is shown, then try again.',
    calImplausible: 'These touches would need a mirrored or very distorted correction: check the panel\'s screen and orientation first, then try again.',
    calOkTitle: 'Calibration done',
    calWarnTitle: 'Calibration done — still a bit off',
    calResult: 'The centre touch landed {px} px from the centre ({pct} % of the screen). Save it, or try again.',
    save: 'Save',
    retry: 'Retry',
    calPassive: 'Calibration in progress — {screen}',
    calPassiveSub: 'Touch the targets on that screen.',
    calElsewhere: 'That touch landed on another screen ({screen}): assign the touch panels to their screens first (assistant), then calibrate.',
    testHint: 'Touch the screens: a dot appears where each touch lands. It must appear under your finger, on THIS screen.',
    testCount: '{s} s',
    done: 'Done'
  },
  fr: {
    screen: 'Écran {n}',
    screenName: 'Écran {n} · {name}',
    touchThis: 'Touchez CET écran',
    touchThisHint: 'Posez un doigt n’importe où sur cet écran. Un écran sans dalle tactile : Passer.',
    touchOther: 'Touchez l’écran {n} — celui qui affiche le {n} en grand',
    thisScreen: 'Cet écran : {screen}',
    step: 'Étape {i} / {total}',
    autoSkip: 'Passage automatique dans {s} s',
    skipThis: 'Passer cet écran',
    skipN: 'Passer l’écran {n}',
    cancel: 'Annuler',
    assigned: '✓ Dalle tactile associée à cet écran',
    skipped: 'Sans dalle tactile',
    calTitle: 'Touchez le centre de la cible',
    calCheck: 'Touchez le centre pour vérifier',
    calSubtitle: 'Calibration · {screen} · {panel}',
    calProgress: 'Point {i} / {total}',
    calCheckProgress: 'Vérification',
    calWait: 'Un instant…',
    calFailedTitle: 'Les touchers ne concordent pas',
    calInconsistent: 'Un toucher était à {pct} % de l’écran de l’endroit attendu d’après les autres. Touchez chaque cible bien au centre avec un seul doigt, puis recommencez.',
    calDegenerate: 'Les touchers étaient trop proches les uns des autres pour mesurer quoi que ce soit. Touchez chaque cible là où elle s’affiche, puis recommencez.',
    calImplausible: 'Ces touchers demanderaient une correction inversée ou très déformée : vérifiez d’abord l’écran et l’orientation de la dalle, puis recommencez.',
    calOkTitle: 'Calibration terminée',
    calWarnTitle: 'Calibration terminée — encore un peu décalée',
    calResult: 'Le toucher du centre est arrivé à {px} px du centre ({pct} % de l’écran). Enregistrez, ou recommencez.',
    save: 'Enregistrer',
    retry: 'Recommencer',
    calPassive: 'Calibration en cours — {screen}',
    calPassiveSub: 'Touchez les cibles sur cet écran-là.',
    calElsewhere: 'Ce toucher est arrivé sur un autre écran ({screen})\u00a0: associez d’abord les dalles tactiles à leurs écrans (assistant), puis calibrez.',
    testHint: 'Touchez les écrans : un point apparaît là où chaque toucher arrive. Il doit apparaître sous votre doigt, sur CET écran.',
    testCount: '{s} s',
    done: 'Terminé'
  }
} as const

type Key = keyof typeof STRINGS.en

function fmt(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  const s: string = STRINGS[lang][key] ?? STRINGS.en[key]
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}

function decimal(lang: Lang, v: number, digits = 1): string {
  const s = v.toFixed(digits)
  return lang === 'fr' ? s.replace('.', ',') : s
}

const IDENTIFY_STEP_MS = 20_000
const TEST_MS = 30_000
const AUTO_DEBOUNCE_MS = 1500

export interface TouchServiceOptions {
  deps: () => TouchSystemDeps
  language: () => Lang
  /** out/preload/touch-overlay.mjs */
  preloadPath: string
  /** Re-apply at start / on device changes (touch.json exists, or the Pi kiosk) */
  autoApply: () => boolean
  /** Give the console its focus back when a wizard closes its overlays */
  focusConsole?: () => void
  log?: (...args: unknown[]) => void
}

interface OverlayMessage {
  type?: unknown
  id?: unknown
  x?: unknown
  y?: unknown
  region?: unknown
  pointerType?: unknown
}

/** One overlay window on one output */
class Overlay {
  readonly win: BrowserWindow
  private view: OverlayView | null = null
  private ready = false
  private closing = false

  constructor(
    private readonly registry: Map<number, Overlay>,
    readonly output: TouchOutput,
    readonly index: number,
    lang: Lang,
    preload: string,
    private readonly handler: (overlay: Overlay, msg: OverlayMessage) => void
  ) {
    const scale = screen.getPrimaryDisplay()?.scaleFactor || 1
    const bounds = {
      x: Math.round(output.x / scale),
      y: Math.round(output.y / scale),
      width: Math.round(output.width / scale),
      height: Math.round(output.height / scale)
    }
    // Fullscreen (above a fullscreen console / Stage window) when Electron sees a display there
    const display = screen.getAllDisplays().some((d) => d.bounds.x === bounds.x && d.bounds.y === bounds.y && d.bounds.width === bounds.width && d.bounds.height === bounds.height)
    this.win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      backgroundColor: '#0a0a0f',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: display,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'PhotonBoard — touch',
      webPreferences: { preload, sandbox: false, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false }
    })
    const win = this.win
    win.setMenu(null)
    registry.set(win.webContents.id, this)
    const id = win.webContents.id
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      win.show()
      if (display) win.setFullScreen(true)
      win.setBounds(display ? win.getBounds() : bounds)
    })
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.handler(this, { type: 'button', id: this.view?.mode === 'test' ? 'done' : 'cancel' })
      }
    })
    win.on('closed', () => {
      registry.delete(id)
      if (!this.closing) this.handler(this, { type: 'button', id: this.view?.mode === 'test' ? 'done' : 'cancel' })
    })
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(touchOverlayHtml(lang))}`).catch(() => { /* closed before it loaded */ })
  }

  setView(view: OverlayView): void {
    this.view = view
    this.push()
  }

  onMessage(msg: OverlayMessage): void {
    if (msg?.type === 'ready') {
      this.ready = true
      this.push()
      return
    }
    this.handler(this, msg)
  }

  focus(): void {
    if (!this.win.isDestroyed()) this.win.focus()
  }

  close(): void {
    this.closing = true
    if (!this.win.isDestroyed()) this.win.destroy()
  }

  private push(): void {
    if (this.ready && this.view && !this.win.isDestroyed()) this.win.webContents.send(IPC.TOUCH_OVERLAY_STATE, this.view)
  }
}

function tapOf(msg: OverlayMessage): { x: number; y: number; region: TapRegion; pointerType: string } | null {
  if (msg.type !== 'tap' || typeof msg.x !== 'number' || typeof msg.y !== 'number') return null
  return { x: msg.x, y: msg.y, region: msg.region === 'chrome' ? 'chrome' : 'content', pointerType: typeof msg.pointerType === 'string' ? msg.pointerType : '' }
}

export class TouchSetupService {
  private busy: string | null = null
  private readonly overlays = new Map<number, Overlay>()
  private autoTimer: ReturnType<typeof setTimeout> | null = null
  private autoStop: (() => void) | null = null

  constructor(private readonly o: TouchServiceOptions) {
    ipcMain.on(IPC.TOUCH_OVERLAY_MESSAGE, (event, msg: unknown) => {
      this.overlays.get(event.sender.id)?.onMessage((msg ?? {}) as OverlayMessage)
    })
  }

  private get deps(): TouchSystemDeps { return this.o.deps() }
  private log(...args: unknown[]): void { try { this.o.log?.(...args) } catch { /* closed stdout */ } }
  private configPath(): string { return this.deps.configPath ?? touchConfigPath(this.deps.env ?? process.env) }

  // --- list / save / reset -------------------------------------------------

  async list(): Promise<TouchSetupInfo> {
    return (await scanTouchSetup(this.deps)).info
  }

  async save(request: unknown): Promise<TouchSetupResult> {
    const panels = (request as { panels?: unknown } | null)?.panels
    if (!panels || typeof panels !== 'object') return { ok: false, error: 'invalid request', info: await this.list() }
    return this.update((saved) => mergeConfig(saved, panels as Record<string, unknown>))
  }

  async reset(which?: unknown): Promise<TouchSetupResult> {
    return this.update((saved) => dropFromConfig(saved, typeof which === 'string' && which ? which : undefined))
  }

  private async update(change: (saved: ReturnType<typeof readTouchConfig>) => ReturnType<typeof mergeConfig>): Promise<TouchSetupResult> {
    try {
      const path = this.configPath()
      await writeTouchConfig(path, change(readTouchConfig(path)))
      const { info, applied } = await applyTouchSetup(this.deps)
      const failed = applied.filter((a) => !a.ok)
      return { ok: info.supported && failed.length === 0, error: failed.map((f) => f.error).join('; ') || info.error, info }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), info: await this.list() }
    }
  }

  // --- overlays --------------------------------------------------------------

  private openOverlays(outputs: TouchOutput[], handler: (overlay: Overlay, msg: OverlayMessage) => void): Overlay[] {
    const lang = this.o.language()
    return outputs.map((o, i) => new Overlay(this.overlays, o, i, lang, this.o.preloadPath, handler))
  }

  private closeOverlays(list: Overlay[]): void {
    for (const ov of list) ov.close()
    try { this.o.focusConsole?.() } catch { /* console closed */ }
  }

  private screenLabel(lang: Lang, outputs: TouchOutput[], name: string): string {
    const i = outputs.findIndex((o) => o.name === name)
    return fmt(lang, 'screenName', { n: i + 1, name })
  }

  // --- identify ---------------------------------------------------------------

  async identify(): Promise<TouchIdentifyResult> {
    if (this.busy) return { ok: false, reason: 'busy', assignments: [] }
    this.busy = 'identify'
    try {
      const { info } = await scanTouchSetup(this.deps)
      if (!info.supported) return { ok: false, reason: 'unsupported', error: info.error, assignments: [], info }
      if (!info.outputs.length) return { ok: false, reason: 'no-outputs', assignments: [], info }
      if (!info.panels.length) return { ok: false, reason: 'no-panels', assignments: info.outputs.map((o) => ({ output: o.name, panel: null })), info }
      return await this.runIdentify(info)
    } catch (e) {
      return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e), assignments: [] }
    } finally {
      this.busy = null
    }
  }

  private runIdentify(info: TouchSetupInfo): Promise<TouchIdentifyResult> {
    const lang = this.o.language()
    const outputs = info.outputs
    let flow: IdentifyFlow | null = null
    const watcher = watchPanelTouches(info.panels.map((p) => ({ key: p.key, port: p.port, nodes: p.nodes })), (key) => flow?.rawTouch(key), { env: this.deps.env })
    if (watcher.failures.length) this.log('[Touch] Event nodes not readable:', watcher.failures.join(', '))
    if (!watcher.opened && info.panels.length > 1) {
      watcher.stop()
      return Promise.resolve({ ok: false, reason: 'no-access', error: watcher.failures.join(', '), assignments: [], info })
    }
    const fallbackPanel = watcher.opened ? null : info.panels[0].key
    let overlays: Overlay[] = []

    return new Promise<TouchIdentifyResult>((resolve) => {
      const render = () => {
        if (!flow) return
        for (const ov of overlays) ov.setView(this.identifyView(lang, flow, outputs, ov.index))
        overlays[flow.step]?.focus()
      }
      const f = new IdentifyFlow({
        outputs: outputs.map((o) => o.name),
        panels: info.panels.map((p) => p.key),
        stepMs: IDENTIFY_STEP_MS,
        fallbackPanel,
        onChange: render,
        onFinish: ({ canceled, results }) => {
          watcher.stop()
          this.closeOverlays(overlays)
          const assignments = outputs.map((o, i) => ({ output: o.name, panel: results[i] ?? null }))
          if (canceled) { resolve({ ok: false, canceled: true, assignments, info }); return }
          void this.saveAssignments(info, assignments).then((r) => resolve({ ok: r.ok, error: r.error, assignments, info: r.info }))
        }
      })
      flow = f
      overlays = this.openOverlays(outputs, (_ov, msg) => {
        const tap = tapOf(msg)
        if (tap) f.tap(tap.region, tap.pointerType)
        else if (msg.type === 'button' && typeof msg.id === 'string') f.button(msg.id)
      })
      f.start()
    })
  }

  private identifyView(lang: Lang, flow: IdentifyFlow, outputs: TouchOutput[], index: number): OverlayView {
    const current = flow.step
    const n = current + 1
    const active = index === current && flow.phase !== 'done'
    const result = flow.results[index]
    const status: 'ok' | 'none' | null = index < current || (index === current && flow.phase !== 'touch')
      ? (result ? 'ok' : result === null ? 'none' : null)
      : null
    const mine = this.screenLabel(lang, outputs, outputs[index].name)
    const bar: OverlayButton[] = [
      { id: 'skip', label: active ? fmt(lang, 'skipThis') : fmt(lang, 'skipN', { n }) },
      { id: 'cancel', label: fmt(lang, 'cancel') }
    ]
    return {
      mode: 'identify',
      active: active && flow.phase === 'touch',
      big: String(index + 1),
      title: active ? fmt(lang, 'touchThis') : fmt(lang, 'touchOther', { n }),
      subtitle: active ? mine : fmt(lang, 'thisScreen', { screen: mine }),
      hint: active && flow.phase === 'touch' ? fmt(lang, 'touchThisHint') : '',
      progress: fmt(lang, 'step', { i: n, total: outputs.length }),
      status,
      statusText: status === 'ok' ? fmt(lang, 'assigned') : status === 'none' ? fmt(lang, 'skipped') : '',
      countdownMs: flow.phase === 'touch' ? flow.remainingMs() : 0,
      countdownLabel: fmt(lang, 'autoSkip'),
      bar
    }
  }

  /** Wizard result → touch.json: assigned panels get their screen; a panel whose screen was given to another goes back to automatic */
  private async saveAssignments(info: TouchSetupInfo, assignments: { output: string; panel: string | null }[]): Promise<TouchSetupResult> {
    const assigned = assignments.filter((a) => a.panel)
    if (!assigned.length) return { ok: true, info: await this.list() }
    const updates: Record<string, TouchPanelSettings> = {}
    for (const p of info.panels) {
      const a = assigned.find((x) => x.panel === p.key)
      const base = effectiveSettings(p)
      if (a) updates[p.key] = { ...base, output: a.output }
      else if (base.output && assigned.some((x) => x.output === base.output)) updates[p.key] = { ...base, output: null }
    }
    return this.update((saved) => mergeConfig(saved, updates))
  }

  // --- calibrate -------------------------------------------------------------

  async calibrate(which: unknown): Promise<TouchCalibrateResult> {
    if (this.busy) return { ok: false, reason: 'busy' }
    this.busy = 'calibrate'
    try {
      const { info } = await scanTouchSetup(this.deps)
      if (!info.supported) return { ok: false, reason: 'unsupported', error: info.error, info }
      const panel = info.panels.find((p) => p.key === which || p.port === which)
      if (!panel) return { ok: false, reason: 'no-panel', info }
      const output = info.outputs.find((o) => o.name === panel.output)
      if (!output) return { ok: false, reason: 'no-output', info }
      return await this.runCalibration(info, panel, output)
    } catch (e) {
      return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
    } finally {
      this.busy = null
    }
  }

  private runCalibration(info: TouchSetupInfo, panel: TouchPanel, output: TouchOutput): Promise<TouchCalibrateResult> {
    const lang = this.o.language()
    const settings = effectiveSettings(panel)
    const apply = async (calibration: number[] | null) => {
      const override: SettingsOverride = new Map([[panel.key, { calibration }]])
      const applied = await applyScan(info, this.deps, override)
      const mine = applied.find((a) => a.key === panel.key)
      if (mine && !mine.ok) this.log('[Touch] Calibration: applying the matrix failed:', mine.error)
    }
    let overlays: Overlay[] = []
    let main: Overlay | null = null
    let notice = ''
    let noticeTimer: ReturnType<typeof setTimeout> | null = null

    return new Promise<TouchCalibrateResult>((resolve) => {
      const render = () => {
        for (const ov of overlays) ov.setView(ov === main ? this.calibrateView(lang, flow, info, panel, output, notice) : {
          mode: 'calibrate',
          passive: true,
          target: null,
          title: fmt(lang, 'calPassive', { screen: this.screenLabel(lang, info.outputs, output.name) }),
          subtitle: fmt(lang, 'calPassiveSub'),
          progress: '',
          card: null,
          notice: '',
          top: []
        })
      }
      const flow: CalibrationFlow = new CalibrationFlow({
        width: output.width,
        height: output.height,
        orientation: panelOrientation(settings, output),
        apply,
        onChange: render,
        onFinish: (r) => {
          if (noticeTimer) clearTimeout(noticeTimer)
          this.closeOverlays(overlays)
          if (r.action === 'cancel') {
            void applyTouchSetup(this.deps).then(({ info: fresh }) => resolve({ ok: false, canceled: true, info: fresh }))
            return
          }
          const updated: TouchPanelSettings = { ...settings, calibration: r.calibration }
          void this.update((saved) => mergeConfig(saved, { [panel.key]: updated }))
            .then((u) => resolve({ ok: u.ok, error: u.error, calibration: r.calibration, errorPx: Math.round(r.errorPx), info: u.info }))
        }
      })
      // Overlays on every output: a stray touch cannot reach the console, and it tells where it landed
      overlays = this.openOverlays(info.outputs, (ov, msg) => {
        const tap = tapOf(msg)
        if (tap) {
          if (ov === main) flow.tap(tap.x, tap.y, tap.region)
          else if (tap.region === 'content' && (flow.phase === 'targets' || flow.phase === 'check')) {
            notice = fmt(lang, 'calElsewhere', { screen: this.screenLabel(lang, info.outputs, ov.output.name) })
            if (noticeTimer) clearTimeout(noticeTimer)
            noticeTimer = setTimeout(() => { notice = ''; render() }, 6000)
            render()
          }
        } else if (msg.type === 'button' && typeof msg.id === 'string') {
          flow.button(msg.id)
        }
      })
      main = overlays.find((ov) => ov.output.name === output.name) ?? null
      main?.focus()
      void flow.start()
    })
  }

  private calibrateView(lang: Lang, flow: CalibrationFlow, info: TouchSetupInfo, panel: TouchPanel, output: TouchOutput, notice: string): OverlayView {
    const screenName = this.screenLabel(lang, info.outputs, output.name)
    const subtitle = fmt(lang, 'calSubtitle', { screen: screenName, panel: panel.name })
    const cancel: OverlayButton = { id: 'cancel', label: fmt(lang, 'cancel') }
    const base = { mode: 'calibrate' as const, target: flow.target, subtitle, notice, top: [cancel], card: null, progress: '', title: '' }
    switch (flow.phase) {
      case 'targets':
        return { ...base, title: fmt(lang, 'calTitle'), progress: fmt(lang, 'calProgress', { i: flow.index + 1, total: 4 }) }
      case 'check':
        return { ...base, title: fmt(lang, 'calCheck'), progress: fmt(lang, 'calCheckProgress') }
      case 'failed': {
        const text = flow.failure === 'inconsistent'
          ? fmt(lang, 'calInconsistent', { pct: decimal(lang, (flow.fitError ?? 0) * 100) })
          : flow.failure === 'implausible' ? fmt(lang, 'calImplausible') : fmt(lang, 'calDegenerate')
        return { ...base, top: [], card: { tone: 'error', title: fmt(lang, 'calFailedTitle'), text, buttons: [{ id: 'retry', label: fmt(lang, 'retry'), primary: true }, cancel] } }
      }
      case 'result': {
        const pct = flow.errorPercent ?? 0
        return {
          ...base,
          top: [],
          card: {
            tone: pct <= 2.5 ? 'ok' : 'warn',
            title: fmt(lang, pct <= 2.5 ? 'calOkTitle' : 'calWarnTitle'),
            text: fmt(lang, 'calResult', { px: Math.round(flow.errorPx ?? 0), pct: decimal(lang, pct) }),
            buttons: [{ id: 'save', label: fmt(lang, 'save'), primary: true }, { id: 'retry', label: fmt(lang, 'retry') }, cancel]
          }
        }
      }
      default:
        return { ...base, title: fmt(lang, 'calWait') }
    }
  }

  // --- test -------------------------------------------------------------------

  async test(): Promise<TouchTestResult> {
    if (this.busy) return { ok: false, reason: 'busy', touches: {} }
    this.busy = 'test'
    try {
      const { info } = await scanTouchSetup(this.deps)
      if (!info.supported) return { ok: false, reason: 'unsupported', error: info.error, touches: {} }
      if (!info.outputs.length) return { ok: false, reason: 'no-outputs', touches: {} }
      const lang = this.o.language()
      const touches: Record<string, number> = Object.fromEntries(info.outputs.map((o) => [o.name, 0]))
      return await new Promise<TouchTestResult>((resolve) => {
        let finished = false
        let overlays: Overlay[] = []
        const finish = () => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          this.closeOverlays(overlays)
          resolve({ ok: true, touches })
        }
        const timer = setTimeout(finish, TEST_MS)
        overlays = this.openOverlays(info.outputs, (ov, msg) => {
          const tap = tapOf(msg)
          if (tap?.region === 'content') touches[ov.output.name] = (touches[ov.output.name] ?? 0) + 1
          else if (msg.type === 'button' && (msg.id === 'done' || msg.id === 'cancel')) finish()
        })
        for (const ov of overlays) {
          ov.setView({
            mode: 'test',
            big: String(ov.index + 1),
            label: this.screenLabel(lang, info.outputs, ov.output.name),
            hint: fmt(lang, 'testHint'),
            countdownMs: TEST_MS,
            countdownLabel: fmt(lang, 'testCount'),
            top: [{ id: 'done', label: fmt(lang, 'done'), primary: true }]
          })
        }
        overlays[0]?.focus()
      })
    } catch (e) {
      return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e), touches: {} }
    } finally {
      this.busy = null
    }
  }

  // --- automatic apply ------------------------------------------------------

  /**
   * Apply at start (once X answers, up to ~30 s) and again whenever the
   * input devices change (debounced; once more a few seconds later, the X
   * server adds devices after udev). Never while a wizard runs.
   */
  startAutoApply(): void {
    if (unsupportedReason(this.deps) || this.autoStop) return
    let stopped = false
    let attempts = 0
    const firstApply = async () => {
      if (stopped) return
      if (!this.o.autoApply()) return
      const { info, applied } = await applyTouchSetup(this.deps)
      if (!info.supported && info.reason === 'no-x' && ++attempts < 15) {
        this.autoTimer = setTimeout(() => { void firstApply() }, 2000)
        return
      }
      if (applied.length) this.log(`[Touch] Applied: ${applied.map((a) => `${a.key} → ${a.output ?? 'none'}${a.ok ? '' : ` (${a.error})`}`).join(', ')}`)
    }
    void firstApply()

    const schedule = () => {
      if (stopped) return
      if (this.autoTimer) clearTimeout(this.autoTimer)
      this.autoTimer = setTimeout(() => { void reapply(true) }, AUTO_DEBOUNCE_MS)
    }
    const reapply = async (again: boolean) => {
      if (stopped || !this.o.autoApply()) return
      if (this.busy) { schedule(); return }
      const { applied } = await applyTouchSetup(this.deps)
      if (applied.length) this.log(`[Touch] Input devices changed — re-applied (${applied.length} panel${applied.length > 1 ? 's' : ''})`)
      if (again) this.autoTimer = setTimeout(() => { void reapply(false) }, 3000)
    }

    let watcher: FSWatcher | null = null
    const inputDir = (this.deps.env ?? process.env).PB_INPUT_DIR || '/dev/input'
    try {
      if (existsSync(inputDir)) {
        watcher = fsWatch(inputDir, { persistent: false }, (_event, name) => { if (!name || /^event\d+$/.test(String(name))) schedule() })
        watcher.on('error', () => { watcher?.close(); watcher = null })
      }
    } catch { watcher = null }
    // Fallback (no inotify on /dev/input): poll the kernel's device list
    let last: string | null = null
    const poll = setInterval(() => {
      void inputDevicesFingerprint().then((fp) => {
        if (last !== null && fp !== last) schedule()
        last = fp
      })
    }, 3000)
    poll.unref?.()

    this.autoStop = () => {
      stopped = true
      if (this.autoTimer) clearTimeout(this.autoTimer)
      clearInterval(poll)
      watcher?.close()
    }
  }

  dispose(): void {
    this.autoStop?.()
    this.autoStop = null
    for (const ov of [...this.overlays.values()]) ov.close()
  }
}
