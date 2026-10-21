// ============================================================
// Screenshot harness — launches the BUILT app with a demo show and
// captures every view on every form factor.
//
//   npm run screenshots                       (build + capture into ./screenshots)
//   npm run build && xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/dev/screenshot.mjs <outDir> [--only=desktop,pi,remote]
//
// What it does:
//   - runs Electron with an isolated HOME / XDG_CONFIG_HOME (your real
//     shows, outputs and settings are never touched) and copies
//     scripts/dev/demo-show.pbshow into $HOME/Documents/PhotonBoard so it
//     auto-loads as the last show (regenerate it: node scripts/dev/make-demo-show.mjs)
//   - starts a few scenes from the executor bar so the output is live
//   - desktop/  1600×1000, compact density: every view (via [data-tab]) + menus/dialogs + Stage window
//   - pi/       1920×1080, touch density (Pi 5 touchscreen kiosk)
//   - remote/   the web remote (random port, see WEB_PORT) in Playwright's Chromium:
//               PIN prompt, tablet 1024×768 (console + stage view), phone 390×844
// The Xvfb screen must be at least 1920×1080.
// ============================================================

import { _electron as electron, chromium, devices } from 'playwright'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const outDir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'screenshots')
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null
const want = (part) => !only || only.has(part)

const SHOW = resolve('scripts/dev/demo-show.pbshow')
/** The show takes its file name when loaded */
const SHOW_TITLE = 'Club Night Demo'
// Random ports so several harness runs can coexist (and never clash with a running console)
const WEB_PORT = process.env.PHOTONBOARD_WEB_PORT || String(20000 + Math.floor(Math.random() * 20000))
const API_PORT = process.env.PHOTONBOARD_API_PORT || String(Number(WEB_PORT) + 1)
const REMOTE_URL = `http://127.0.0.1:${WEB_PORT}`
const REMOTE_PIN = '2468'
/** Scenes started for the live screenshots (executor cell labels) */
const LIVE_SCENES = ['Warm Wash', 'Spot Beams', 'Bars Rainbow']

// ---- isolated environment ----
const home = mkdtempSync(join(tmpdir(), 'photonboard-shots-'))
mkdirSync(join(home, 'Documents', 'PhotonBoard'), { recursive: true })
copyFileSync(SHOW, join(home, 'Documents', 'PhotonBoard', `${SHOW_TITLE}.pbshow`))

const app = await electron.launch({
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1', PB_NO_SPLASH: '1',
    PHOTONBOARD_WEB_PORT: WEB_PORT, PHOTONBOARD_API_PORT: API_PORT }
})

try {
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.error('[renderer error]', e.message))

  const shot = async (page, dir, name) => {
    mkdirSync(join(outDir, dir), { recursive: true })
    await page.screenshot({ path: join(outDir, dir, `${name}.png`) })
  }

  const sizeWindow = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      const bw = BrowserWindow.getAllWindows()[0]
      bw.setFullScreen(false)
      bw.setContentSize(w, h)
    }, [width, height])
    await win.waitForTimeout(600)
  }

  const ready = async () => {
    await win.waitForSelector('[data-tab]', { timeout: 20000 })
    await win.getByText(SHOW_TITLE).first().waitFor({ timeout: 20000 })
    await win.waitForTimeout(800)
  }

  const startScenes = async () => {
    for (const name of LIVE_SCENES) {
      const cell = win.locator(`[data-exec-cell][aria-label^="${name},"]`).first()
      if (await cell.count()) await cell.click()
    }
    await win.waitForTimeout(1200)
  }

  const captureViews = async (dir) => {
    const tabs = await win.$$eval('[data-tab]', (els) => els.map((e) => e.getAttribute('data-tab')))
    for (const [i, tab] of tabs.entries()) {
      await win.click(`[data-tab="${tab}"]`)
      await win.waitForTimeout(tab === 'visualizer' ? 2000 : 700)
      await shot(win, dir, `${String(i + 1).padStart(2, '0')}-${tab}`)
    }
  }

  const setDensity = async (density) => {
    await win.evaluate((d) => { try { localStorage.setItem('photonboard.ui.density', d) } catch { /* ignore */ } }, density)
    await win.reload()
    await ready()
  }

  await ready()

  if (want('desktop')) {
    await sizeWindow(1600, 1000)
    await setDensity('compact')
    await startScenes()
    await win.click('[data-tab="playback"]')
    await win.waitForTimeout(500)
    await shot(win, 'desktop', '00-start')
    await captureViews('desktop')

    // Shell overlays
    await win.click('[data-tab="playback"]')
    await win.getByRole('button', { name: 'File' }).click()
    await win.waitForTimeout(300)
    await shot(win, 'desktop', 'x1-file-menu')
    await win.keyboard.press('Escape')
    await win.locator('footer button', { hasText: /output|No DMX/i }).first().click()
    await win.waitForTimeout(300)
    await shot(win, 'desktop', 'x2-outputs-popover')
    await win.keyboard.press('Escape')
    await win.locator('[data-exec-cell][aria-label^="Verse,"]').first().click({ button: 'right' })
    await win.waitForTimeout(300)
    await shot(win, 'desktop', 'x3-executor-menu')
    await win.keyboard.press('Escape')
    await win.keyboard.press('Shift+?')
    await win.waitForTimeout(300)
    await shot(win, 'desktop', 'x4-shortcuts')
    await win.keyboard.press('Escape')
    // Rename a column (also makes the show dirty for the unsaved-changes dialog)
    await win.locator('button[title="Column title & colour"]').first().click()
    await win.getByLabel('Column title').fill('Wash looks')
    await win.waitForTimeout(300)
    await shot(win, 'desktop', 'x5-column-popover')
    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: 'File' }).click()
    await win.getByRole('menuitem', { name: /New show/ }).click()
    await win.waitForTimeout(400)
    await shot(win, 'desktop', 'x6-unsaved-dialog')
    await win.getByRole('button', { name: 'Cancel' }).click()
    await win.locator('main').click({ position: { x: 5, y: 5 } })
    await win.keyboard.press('Escape') // blackout on
    await win.waitForTimeout(400)
    await shot(win, 'desktop', 'x7-blackout')
    await win.keyboard.press('Escape') // blackout off

    // Stage window (second screen)
    const stagePromise = app.waitForEvent('window')
    await win.evaluate(() => window.photonboard.stage.open())
    const stage = await stagePromise
    await stage.waitForTimeout(1500)
    await shot(stage, 'desktop', 'x8-stage-window')
    await stage.close()
  }

  if (want('pi')) {
    await sizeWindow(1920, 1080)
    await setDensity('touch')
    await startScenes()
    await win.click('[data-tab="playback"]')
    await shot(win, 'pi', '00-start')
    await captureViews('pi')
    await setDensity('auto')
  }

  if (want('remote')) {
    await win.evaluate((pin) => window.photonboard.remote.setSettings({ pinEnabled: true, pin }), REMOTE_PIN)
    const browser = await chromium.launch()
    try {
      // Tablet (1024 wide = full console in the browser): PIN prompt, console, stage view
      const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, deviceScaleFactor: 1 })
      const tp = await tablet.newPage()
      tp.on('pageerror', (e) => console.error('[remote error]', e.message))
      await tp.goto(REMOTE_URL)
      const pinInput = tp.getByRole('textbox', { name: 'PIN' })
      await pinInput.waitFor({ timeout: 15000 })
      await tp.waitForTimeout(400)
      await shot(tp, 'remote', 'tablet-0-pin')
      await pinInput.fill(REMOTE_PIN)
      await tp.getByRole('button', { name: 'Connect' }).click()
      await pinInput.waitFor({ state: 'detached', timeout: 15000 })
      await tp.waitForTimeout(2500)
      await shot(tp, 'remote', 'tablet-1-console')
      await tp.click('[data-tab="fixtures"]')
      await tp.waitForTimeout(800)
      await shot(tp, 'remote', 'tablet-2-fixtures')
      await tp.getByRole('button', { name: 'Stage' }).click()
      await tp.waitForTimeout(1200)
      await shot(tp, 'remote', 'tablet-3-stage')

      // Phone (stage only); the PIN is remembered per browser profile, use ?pin=
      const phone = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
      const pp = await phone.newPage()
      await pp.goto(`${REMOTE_URL}/?pin=${REMOTE_PIN}`)
      await pp.waitForTimeout(3000)
      await shot(pp, 'remote', 'phone-1-stage')
    } finally {
      await browser.close()
      await win.evaluate(() => window.photonboard.remote.setSettings({ pinEnabled: false, pin: '' })).catch(() => {})
    }
  }
} finally {
  await app.close()
  rmSync(home, { recursive: true, force: true })
}
console.log('screenshots in', outDir)
