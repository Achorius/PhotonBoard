// ============================================================
// End-to-end check of Settings › Display › Touchscreens on the BUILT app
// (out/), with fake xinput / xrandr / udevadm (test-fixtures/touch/bin)
// reproducing the field data of a Pi 5: HDMI-1 + HDMI-2 (3840×1080
// desktop), ONE "wch.cn TouchScreen" on USB port 1-1.4.4 with two X
// pointer devices (ids 8 and 9). The fake xinput records every set-prop.
// Real Chromium touch events (CDP Input.dispatchTouchEvent) drive the
// console AND the wizard overlays. "Panel touched" for the assignment
// wizard comes from the test hook PB_TOUCH_FAKE_EVENTS.
//
//   npm run build && xvfb-run -a -s "-screen 0 3840x1080x24" node scripts/dev/smoke-touch-setup.mjs . <screenshotDir>
// ============================================================
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(process.argv[2] || '.')
const outDir = resolve(process.argv[3] || 'smoke-touch-setup')
mkdirSync(outDir, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'pb-touchsetup-'))
const state = join(home, 'fake-x')
const fakeEvents = join(home, 'fake-events')
const inputDir = join(home, 'dev-input')
for (const d of [state, fakeEvents, inputDir, join(home, 'Documents', 'PhotonBoard')]) mkdirSync(d, { recursive: true })
const touchJson = join(home, '.config', 'photonboard', 'touch.json')

const app = await electron.launch({
  args: ['--no-sandbox', join(ROOT, 'out/main/index.js')],
  env: {
    ...process.env,
    PATH: `${join(ROOT, 'test-fixtures/touch/bin')}:${process.env.PATH}`,
    PB_FAKE_TOUCH_DIR: join(ROOT, 'test-fixtures/touch/pi5-field'),
    PB_FAKE_TOUCH_STATE: state,
    PB_TOUCH_FAKE_EVENTS: fakeEvents,
    PB_INPUT_DIR: inputDir,
    PB_TOUCH_CONF: join(home, 'no-touch-map.conf'),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_SESSION_TYPE: 'x11',
    PHOTONBOARD_HEADLESS_TEST: '1',
    PB_NO_SPLASH: '1',
    PHOTONBOARD_WEB_PORT: String(30000 + Math.floor(Math.random() * 20000)),
    PHOTONBOARD_API_PORT: '0'
  }
})

let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, eps = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps)

/** Last Coordinate Transformation Matrix set on an xinput id (fake xinput's log) */
function lastMatrix(id) {
  const log = existsSync(join(state, 'calls.log')) ? readFileSync(join(state, 'calls.log'), 'utf8').trim().split('\n') : []
  const line = log.filter((l) => l.startsWith(`set-prop ${id} Coordinate Transformation Matrix `)).pop()
  return line ? line.split(' ').slice(5).map(Number) : null
}
const setPropCount = () => (existsSync(join(state, 'calls.log')) ? readFileSync(join(state, 'calls.log'), 'utf8').split('\n').filter((l) => l.startsWith('set-prop')).length : 0)
const savedConfig = () => (existsSync(touchJson) ? JSON.parse(readFileSync(touchJson, 'utf8')) : null)
const PANEL = '1-1.4.4|wch.cn TouchScreen'

async function until(fn, timeout = 8000, step = 100) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) return v
    await sleep(step)
  }
}

/** Touch helpers bound to one page (console or overlay) */
async function toucher(page) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 6, radiusY: 6, force: 1 })) })
  const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []); await sleep(120) }
  const tap = async (loc) => {
    await loc.scrollIntoViewIfNeeded()
    const b = await loc.boundingBox()
    if (!b) throw new Error('not visible')
    await tapAt(b.x + b.width / 2, b.y + b.height / 2)
    await sleep(250)
  }
  return { tap, tapAt }
}

/** The overlay windows currently open, with their mode */
async function overlays(count, mode) {
  return until(async () => {
    const pages = app.windows().filter((p) => p.url().startsWith('data:text/html'))
    const found = []
    for (const p of pages) {
      try {
        const m = await p.evaluate(() => document.body.getAttribute('data-mode'))
        if (m === mode) found.push(p)
      } catch { /* closing */ }
    }
    return found.length >= count ? found : null
  }, 10000)
}
async function overlaysClosed() {
  return until(async () => app.windows().filter((p) => p.url().startsWith('data:text/html') && !p.isClosed()).length === 0, 8000)
}
/** Overlay pages sorted by their window's x (HDMI-1 first) */
async function byScreen(pages) {
  const withX = await Promise.all(pages.map(async (p) => ({ p, x: await p.evaluate(() => window.screenX) })))
  return withX.sort((a, b) => a.x - b.x).map((e) => e.p)
}

try {
  let win = await app.firstWindow()
  while (win.url().startsWith('data:')) win = await app.waitForEvent('window')
  win.on('pageerror', (e) => console.error('[renderer error]', e.message))
  await win.waitForSelector('[data-tab]', { timeout: 30000 })
  await win.evaluate(() => { localStorage.setItem('photonboard.ui.language', 'en'); localStorage.setItem('photonboard.ui.density', 'touch') })
  await win.reload()
  await win.waitForSelector('[data-tab]', { timeout: 30000 })
  const console_ = await toucher(win)

  const openDisplaySettings = async (label) => {
    await console_.tap(win.locator('[data-tab="settings"]').first())
    await console_.tap(win.getByRole('button', { name: label }).first())
    await win.waitForSelector('[data-touch-status]', { timeout: 15000 })
  }
  const section = () => win.locator('section:has([data-touch-setup])').first()
  /** The whole section (taller than the 1080 px window): screenshot in a tall viewport */
  const metrics = await win.context().newCDPSession(win)
  const shootSection = async (file) => {
    await metrics.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 2600, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    await section().screenshot({ path: join(outDir, file) })
    await metrics.send('Emulation.clearDeviceMetricsOverride')
    await sleep(300)
  }

  // --- 1. What is detected ---------------------------------------------------
  await openDisplaySettings(/^Display/)
  const status = (await win.locator('[data-touch-status]').innerText()).trim()
  check('status: 1 touch panel for 2 screens', status === '1 touch panel detected for 2 screens', status)
  check('warning: fewer panels than screens (USB data cable)', /USB data cable/.test(await win.locator('[data-touch-warning]').innerText()))
  const panelsOn = async (name) => Number(await win.locator(`[data-touch-screen="${name}"]`).getAttribute('data-touch-panels'))
  check('diagram: automatic order puts the panel on HDMI-1, HDMI-2 has none', (await panelsOn('HDMI-1')) === 1 && (await panelsOn('HDMI-2')) === 0)
  check('panel row lists xinput ids 8 and 9', /xinput 8, 9/.test(await win.locator('[data-touch-panel="1-1.4.4"]').innerText()))
  await shootSection('section-en.png')

  // --- 2. Panel → Screen 2 by touch: ids 8 AND 9 get [0.5 0 0.5; 0 1 0; 0 0 1] ---
  await console_.tap(win.locator('[data-touch-panel="1-1.4.4"] [data-touch-output="HDMI-2"]'))
  await until(() => near(lastMatrix(8) ?? [], [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]) && near(lastMatrix(9) ?? [], [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]))
  check('Screen 2: set-prop id 8 = [0.5,0,0.5,0,1,0,0,0,1]', near(lastMatrix(8) ?? [], [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]), JSON.stringify(lastMatrix(8)))
  check('Screen 2: set-prop id 9 = [0.5,0,0.5,0,1,0,0,0,1]', near(lastMatrix(9) ?? [], [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]), JSON.stringify(lastMatrix(9)))
  check('touch.json: panel on HDMI-2', savedConfig()?.panels?.[PANEL]?.output === 'HDMI-2')
  await until(async () => (await panelsOn('HDMI-2')) === 1)
  check('diagram follows (panel on HDMI-2)', (await panelsOn('HDMI-2')) === 1 && (await panelsOn('HDMI-1')) === 0)

  // --- 3. Calibration with a deliberate offset (+30 px, -20 px) ---------------
  const before = setPropCount()
  await console_.tap(win.locator('[data-touch-calibrate="1-1.4.4"]'))
  const calPages = await overlays(2, 'calibrate')
  check('calibration: an overlay on each screen', !!calPages && calPages.length === 2)
  const [calScreen1, calScreen2] = await byScreen(calPages)
  await calScreen2.waitForSelector('[data-target="corner"]', { state: 'attached' })
  check('calibration: matrix applied WITHOUT calibration first', setPropCount() > before && near(lastMatrix(8), [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]))
  check('calibration: the other screen is a passive blocker', (await calScreen1.locator('.passive').count()) === 1)
  await calScreen2.screenshot({ path: join(outDir, 'calibration-overlay-en.png') })
  const cal = await toucher(calScreen2)
  const DX = 30, DY = -20
  for (let i = 0; i < 4; i++) {
    const dot = await calScreen2.locator('[data-target="corner"] .dot').boundingBox()
    await cal.tapAt(dot.x + dot.width / 2 + DX, dot.y + dot.height / 2 + DY)
    await sleep(450)
  }
  await calScreen2.waitForSelector('[data-target="check"]', { state: 'attached', timeout: 5000 })
  const candidate = lastMatrix(8)
  check('calibration: candidate applied for the centre check', near(candidate, [0.5, 0, 0.5 - 0.5 * DX / 1920, 0, 1, -DY / 1080, 0, 0, 1], 1e-3), JSON.stringify(candidate))
  await cal.tapAt(960 + 2, 540)
  await calScreen2.waitForSelector('[data-card]', { timeout: 5000 })
  check('calibration: result card shows the centre error', /2 px/.test(await calScreen2.locator('[data-card]').innerText()))
  await calScreen2.screenshot({ path: join(outDir, 'calibration-result-en.png') })
  await cal.tap(calScreen2.locator('[data-button="save"]'))
  await overlaysClosed()
  const calib = await until(() => savedConfig()?.panels?.[PANEL]?.calibration)
  check('calibration saved ≈ [1,0,-30/1920, 0,1,20/1080]', !!calib && near(calib, [1, 0, -DX / 1920, 0, 1, -DY / 1080], 1e-3), JSON.stringify(calib))
  check('calibration: ids 8 and 9 keep the calibrated matrix', near(lastMatrix(8), candidate, 1e-4) && near(lastMatrix(9), candidate, 1e-4))
  await win.getByText(/Calibration saved/).first().waitFor({ timeout: 5000 })

  // --- 4. Touch test overlay --------------------------------------------------
  await console_.tap(win.locator('[data-touch-test]'))
  const testPages = await byScreen(await overlays(2, 'test'))
  const t2 = await toucher(testPages[1])
  await t2.tapAt(700, 420)
  await t2.tapAt(1300, 700)
  await sleep(300)
  check('test overlay: a dot where each touch lands', (await testPages[1].locator('.touch-dot').count()) === 2)
  await testPages[1].screenshot({ path: join(outDir, 'test-overlay-en.png') })
  await t2.tap(testPages[1].locator('[data-button="done"]'))
  await overlaysClosed()
  const testToast = await win.getByText(/touches seen/).first().innerText().catch(() => '')
  check('test result: 2 touches on screen 2, none on screen 1', /HDMI-1\): 0/.test(testToast) && /HDMI-2\): 2/.test(testToast), testToast)

  // --- 5. Back to automatic, then the assignment wizard (owner's case) -------
  await console_.tap(win.locator('[data-touch-reset-all]'))
  await console_.tap(win.getByRole('dialog').getByRole('button', { name: /Back to automatic setup/ }))
  await until(() => !existsSync(touchJson))
  check('reset: touch.json removed, automatic order (HDMI-1) applied', !existsSync(touchJson) && near(lastMatrix(8), [0.5, 0, 0, 0, 1, 0, 0, 0, 1]))
  await console_.tap(win.locator('[data-touch-identify]'))
  const idPages = await byScreen(await overlays(2, 'identify'))
  await idPages[0].waitForSelector('.id.active')
  check('identify: step 1 active on screen 1, screen 2 dimmed', (await idPages[0].locator('.id.active').count()) === 1 && (await idPages[1].locator('.id.dim').count()) === 1)
  await idPages[0].screenshot({ path: join(outDir, 'identify-step1-screen1-en.png') })
  await idPages[1].screenshot({ path: join(outDir, 'identify-step1-screen2-en.png') })
  // Screen 1 has no panel: Skip (tapped on the overlay)
  await (await toucher(idPages[0])).tap(idPages[0].locator('[data-button="skip"]'))
  await idPages[1].waitForSelector('.id.active', { timeout: 5000 })
  await idPages[1].screenshot({ path: join(outDir, 'identify-step2-screen2-en.png') })
  // The panel is touched on step 2 (test hook: as if read from /dev/input/event3)
  writeFileSync(join(fakeEvents, 'touch-1'), '1-1.4.4\n')
  await overlaysClosed()
  await win.waitForSelector('[data-touch-summary]', { timeout: 8000 })
  check('identify: panel assigned to HDMI-2, saved', savedConfig()?.panels?.[PANEL]?.output === 'HDMI-2')
  check('identify: ids 8 AND 9 mapped to HDMI-2', near(lastMatrix(8), [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]) && near(lastMatrix(9), [0.5, 0, 0.5, 0, 1, 0, 0, 0, 1]))
  const summary = await win.locator('[data-touch-summary]').innerText()
  check('identify: summary lists screen 1 without panel, screen 2 with it', /HDMI-1 → no touch panel/.test(summary) && /HDMI-2 → wch.cn TouchScreen/.test(summary), summary.replace(/\n/g, ' | '))
  await shootSection('section-after-assistant-en.png')

  // --- 6. French -------------------------------------------------------------
  await win.evaluate(() => { localStorage.setItem('photonboard.ui.language', 'fr') })
  await win.reload()
  await win.waitForSelector('[data-tab]', { timeout: 30000 })
  await openDisplaySettings(/^Affichage/)
  const statusFr = (await win.locator('[data-touch-status]').innerText()).trim()
  check('FR status: 1 dalle tactile détectée pour 2 écrans', statusFr === '1 dalle tactile détectée pour 2 écrans', statusFr)
  await shootSection('section-fr.png')
  await console_.tap(win.locator('[data-touch-identify]'))
  const idFr = await byScreen(await overlays(2, 'identify'))
  await idFr[0].waitForSelector('.id.active')
  check('FR identify overlay: "Touchez CET écran" / "Touchez l’écran 1 — celui qui affiche le 1 en grand"',
    /Touchez CET écran/.test(await idFr[0].innerText('body')) && /Touchez l’écran 1 — celui qui affiche le 1 en grand/.test(await idFr[1].innerText('body')))
  await idFr[0].screenshot({ path: join(outDir, 'identify-step1-screen1-fr.png') })
  await idFr[1].screenshot({ path: join(outDir, 'identify-step1-screen2-fr.png') })
  await (await toucher(idFr[1])).tap(idFr[1].locator('[data-button="cancel"]'))
  await overlaysClosed()
  check('FR identify: Annuler closes, nothing changed', savedConfig()?.panels?.[PANEL]?.output === 'HDMI-2')
  await win.getByText(/Assistant annulé/).first().waitFor({ timeout: 5000 }).then(() => check('FR toast: assistant annulé', true), () => check('FR toast: assistant annulé', false))
  // FR calibration + test overlays
  await console_.tap(win.locator('[data-touch-calibrate="1-1.4.4"]'))
  const calFr = await byScreen(await overlays(2, 'calibrate'))
  await calFr[1].waitForSelector('[data-target="corner"]', { state: 'attached' })
  await calFr[1].screenshot({ path: join(outDir, 'calibration-overlay-fr.png') })
  await calFr[1].keyboard.press('Escape').catch(() => { /* the overlay closes on keydown */ })
  await overlaysClosed()
  check('FR calibration: Escape cancels, calibration from reset stays none', savedConfig()?.panels?.[PANEL]?.calibration === null)
  await console_.tap(win.locator('[data-touch-test]'))
  const testFr = await byScreen(await overlays(2, 'test'))
  const tf = await toucher(testFr[0])
  await tf.tapAt(800, 500)
  await testFr[0].screenshot({ path: join(outDir, 'test-overlay-fr.png') })
  await tf.tap(testFr[0].locator('[data-button="done"]'))
  await overlaysClosed()
} catch (e) {
  failed++
  console.error(e)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} touch setup check(s) FAILED` : '\nAll touch setup checks passed')
process.exit(failed ? 1 : 0)
