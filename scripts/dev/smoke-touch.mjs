// ============================================================
// Touch check of the BUILT app (out/): drives the console with real
// Chromium touch events (CDP Input.dispatchTouchEvent, the same path as a
// touchscreen) — taps on tabs, buttons, menus, executor pads, and a finger
// drag on the Grand Master fader. Fullscreen 1920×1080 like the Pi kiosk.
//
//   npm run build && xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/dev/smoke-touch.mjs . <outDir>
// ============================================================
import { _electron as electron } from 'playwright'
import { copyFileSync, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(process.argv[2] || '.')
const outDir = resolve(process.argv[3] || 'smoke-touch')
mkdirSync(outDir, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'pb-touch-'))
const showDir = join(home, 'Documents', 'PhotonBoard')
mkdirSync(showDir, { recursive: true })
copyFileSync(join(ROOT, 'scripts/dev/demo-show.pbshow'), join(showDir, 'Club Night Demo.pbshow'))

const app = await electron.launch({
  args: ['--no-sandbox', join(ROOT, 'out/main/index.js')],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1', PB_NO_SPLASH: process.env.PB_NO_SPLASH ?? '1',
    PHOTONBOARD_WEB_PORT: String(30000 + Math.floor(Math.random() * 20000)), PHOTONBOARD_API_PORT: '0' }
})
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`) }
try {
  // The splash (data: URL) may come first: take the console window
  let win = await app.firstWindow()
  while (win.url().startsWith('data:')) win = await app.waitForEvent('window')
  win.on('pageerror', (e) => console.error('[renderer error]', e.message))
  const wait = (ms) => win.waitForTimeout(ms)
  await win.waitForSelector('[data-tab]', { timeout: 30000 })
  await win.evaluate(() => { localStorage.setItem('photonboard.ui.language', 'en') })
  await win.reload()
  await win.waitForSelector('[data-tab]', { timeout: 30000 })
  await win.getByText('Club Night Demo').first().waitFor({ timeout: 30000 })
  await wait(800)
  console.log('windows:', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => `${w.getTitle()} visible=${w.isVisible()} ${JSON.stringify(w.getBounds())} ignoreMouse=${false}`))).join(' | '))

  const cdp = await win.context().newCDPSession(win)
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 6, radiusY: 6, force: 1 })) })
  const center = async (loc) => { const b = await loc.boundingBox(); if (!b) throw new Error('not visible'); return [b.x + b.width / 2, b.y + b.height / 2] }
  const tap = async (loc) => { const p = await center(loc); await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(350) }
  const drag = async (from, to, steps = 12) => {
    await touch('touchStart', [from]); await wait(40)
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await wait(16) }
    await touch('touchEnd', []); await wait(300)
  }
  // Log what the page actually receives
  await win.evaluate(() => {
    window.__ev = { pointerdown: 0, click: 0, touchstart: 0, types: new Set() }
    for (const t of ['pointerdown', 'click', 'touchstart']) addEventListener(t, (e) => { window.__ev[t]++; if (e.pointerType) window.__ev.types.add(e.pointerType) }, true)
  })

  for (const id of ['patch', 'playback', 'fixtures', 'settings']) {
    const loc = win.locator(`[data-tab="${id}"]`).first()
    if (!(await loc.count())) continue
    await tap(loc)
    const current = await loc.getAttribute('aria-current')
    check(`tap tab "${id}" selects it`, current === 'page', `aria-current=${current}`)
  }
  await win.screenshot({ path: join(outDir, 'after-tabs.png') })
  const ev = await win.evaluate(() => ({ ...window.__ev, types: [...window.__ev.types] }))
  check('page receives touch pointer events and clicks', ev.pointerdown > 0 && ev.click > 0 && ev.types.includes('touch'), JSON.stringify(ev))

  // Blackout toggle
  const bo = win.getByRole('button', { name: /blackout/i }).first()
  const before = await bo.getAttribute('aria-pressed')
  await tap(bo)
  const after = await bo.getAttribute('aria-pressed')
  check('tap BLACKOUT toggles it', before !== after, `${before} → ${after}`)
  if (after !== before) await tap(bo)

  // GM fader drag
  const gmLoc = win.locator('[role="slider"][aria-label="Grand Master"]').first()
  const gm0 = Number(await gmLoc.getAttribute('aria-valuenow'))
  const b = await gmLoc.boundingBox()
  const horiz = b.width > b.height
  const from = [b.x + b.width / 2, b.y + b.height / 2]
  const to = horiz ? [b.x + b.width * 0.15, from[1]] : [from[0], b.y + b.height * 0.85]
  await drag(from, to)
  const gm1 = Number(await gmLoc.getAttribute('aria-valuenow'))
  check('finger drag moves the Grand Master', gm1 !== gm0, `${gm0} → ${gm1}`)
  await drag(to, horiz ? [b.x + b.width + 40, from[1]] : [from[0], b.y - 40])

  // File menu via tap
  const file = win.getByRole('button', { name: /^file/i }).first()
  if (await file.count()) {
    await tap(file)
    const menu = await win.locator('[role="menu"]').count()
    check('tap File opens its menu', menu > 0)
    await win.screenshot({ path: join(outDir, 'file-menu.png') })
    await win.keyboard.press('Escape'); await wait(200)
  }

  // Executor pad tap (playback tab, first filled pad)
  await tap(win.locator('[data-tab="playback"]').first())
  const pad = win.locator('[data-exec-cell][aria-pressed="false"]:not([data-hold])').first()
  if (await pad.count()) {
    const before = await pad.getAttribute('aria-pressed')
    const key = await pad.getAttribute('data-exec-cell')
    await tap(pad)
    const after = await win.locator(`[data-exec-cell="${key}"]`).first().getAttribute('aria-pressed')
    check('tap an executor pad changes it', before !== after, `${before} → ${after}`)
  } else console.log('  (no executor pad selector found)')
  await win.screenshot({ path: join(outDir, 'after-pad.png') })
} catch (e) {
  failed++
  console.error(e)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} touch check(s) FAILED` : '\nAll touch checks passed')
process.exit(failed ? 1 : 0)
