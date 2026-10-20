// ============================================================
// End-to-end smoke of the Pro programming layer in the BUILT app
// (out/): command line → programmer → presets → cues → executors →
// DMX output read back from the main-process engine.
//
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/dev/smoke-pro.mjs <outDir> [--lang=fr|en]
//
// Throw-away HOME, the demo show auto-loads (fixtures 1-4 = Spot 1-4,
// group 1 = Spots, groups 2 = Washes), Pro view on. Every check is
// logged ✓ / ✗ and written to <outDir>/smoke.json; screenshots of key
// states go to <outDir>/. Exit code 1 when a check fails.
// Does not build: run `npm run build` first if out/ is stale.
// ============================================================

import { _electron as electron } from 'playwright'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const outDir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'smoke-pro')
const LANG = process.argv.includes('--lang=fr') ? 'fr' : 'en'
mkdirSync(outDir, { recursive: true })

const SHOW = resolve('scripts/dev/demo-show.pbshow')
const SHOW_TITLE = 'Club Night Demo'
const home = mkdtempSync(join(tmpdir(), 'photonboard-smoke-'))
const showDir = join(home, 'Documents', 'PhotonBoard')
mkdirSync(showDir, { recursive: true })
copyFileSync(SHOW, join(showDir, `${SHOW_TITLE}.pbshow`))

const app = await electron.launch({
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1',
    PHOTONBOARD_WEB_PORT: String(30000 + Math.floor(Math.random() * 20000)), PHOTONBOARD_API_PORT: '0' }
})

const results = []
const errors = []
let failed = 0
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  const win = await app.firstWindow()
  win.on('pageerror', (e) => { errors.push(e.message); console.error('[renderer error]', e.message) })
  // (no MIDI subsystem in containers / CI: Web MIDI access failing there is expected)
  win.on('console', (m) => { if (m.type() === 'error' && !/Web MIDI API/.test(m.text())) errors.push(m.text()) })
  const wait = (ms) => win.waitForTimeout(ms)
  const shot = (name) => win.screenshot({ path: join(outDir, `${name}.png`) })
  const T = (key, params) => win.evaluate(([k, p]) => window.__pbI18n.t(k, p), [key, params ?? {}])
  const ready = async () => {
    await win.waitForSelector('[data-tab]', { timeout: 20000 })
    await win.getByText(SHOW_TITLE).first().waitFor({ timeout: 20000 })
    await win.waitForFunction(() => !!window.__pbI18n, null, { timeout: 10000 })
    await wait(800)
  }
  await ready()
  await win.evaluate((lang) => {
    localStorage.setItem('photonboard.ui.language', lang)
    localStorage.setItem('photonboard.ui.pro', 'true')
    localStorage.setItem('photonboard.ui.density', 'compact')
  }, LANG)
  await win.reload()
  await ready()
  await app.evaluate(({ BrowserWindow }) => { const bw = BrowserWindow.getAllWindows()[0]; bw.setFullScreen(false); bw.setContentSize(1600, 1000) })
  await wait(600)

  /** Main-process engine output of universe 1 (post masters) */
  const out = () => win.evaluate(async () => Array.from(await window.photonboard.dmx.getValues(0)))
  /** Last command-line log entry (text + message) */
  const lastLog = () => win.evaluate(() => {
    const rows = document.querySelectorAll('[data-cli-log-entry]')
    return rows.length ? rows[rows.length - 1].textContent ?? '' : ''
  })
  const cli = async (line, settle = 300) => {
    const input = win.locator('#pb-command-line')
    await input.click()
    await input.fill(line)
    await input.press('Enter')
    await wait(settle)
    const text = await lastLog()
    console.log(`    > ${line}   ${text.replace(/\s+/g, ' ').slice(0, 140)}`)
    return text
  }
  const cellLabel = (col, row) => win.locator(`[data-exec-cell="${col}:${row}"]`).first().getAttribute('aria-label').catch(() => null)

  // Expanded command line (log visible)
  await win.locator('[data-cli-expand]').click()
  await wait(300)

  // ---- clean state
  await cli('Release'); await cli('Clear'); await cli('Clear'); await cli('Clear')
  await wait(2500)
  const base = await out()

  // ---- Fixture 1 Thru 4 / At 50
  await cli('Fixture 1 Thru 4')
  await cli('At 50', 600)
  const at50 = await out()
  // Dimmer channels of Spot 1-4 (13-channel fixtures at 1.001 / 1.014 / 1.027 / 1.040): the ones that moved to 50 %
  const changed = at50.map((v, i) => (v !== base[i] ? i : -1)).filter((i) => i >= 0 && i < 52)
  const dimmers = [0, 13, 26, 39].map((start) => changed.find((i) => i >= start && i < start + 13) ?? -1)
  check('At 50 sets the 4 spot dimmers to 50 % on the DMX output', dimmers.every((i) => i >= 0 && Math.abs(at50[i] - 128) <= 1),
    `channels ${dimmers.map((i) => i + 1).join(',')} = ${dimmers.map((i) => at50[i]).join(',')}`)
  const dim = async () => { const o = await out(); return dimmers.map((i) => o[i]) }

  // ---- Store Preset 1.1
  const stored = await cli('Store Preset 1.1')
  check('Store Preset 1.1', /1\.1/.test(stored), stored.trim().slice(0, 80))
  await cli('Clear'); await cli('Clear', 600)
  check('Clear twice releases the values', (await dim()).every((v) => v === 0), String(await dim()))

  // ---- Group 1 At Preset 1.1 Fade 2 (timed)
  await cli('Group 1 At Preset 1.1 Fade 2', 100)
  await wait(700)
  const mid = await dim()
  await wait(2200)
  const end = await dim()
  check('Group 1 At Preset 1.1 Fade 2 fades in (mid-fade between 0 and 50 %)', mid.every((v) => v > 0 && v < 127), String(mid))
  check('… and reaches the preset after the fade', end.every((v) => Math.abs(v - 128) <= 1), String(end))
  await shot('01-preset-fade')

  // ---- Store Cue 1 Sequence 99
  const cueMsg = await cli('Store Cue 1 Sequence 99', 500)
  check('Store Cue 1 Sequence 99', /99/.test(cueMsg), cueMsg.trim().slice(0, 100))
  await cli('Clear'); await cli('Clear', 600)
  check('programmer cleared after storing', (await dim()).every((v) => v === 0), String(await dim()))

  // ---- Assign Sequence 99 At Executor 1.5 (col 2, row 1)
  const before15 = await cellLabel(1, 0)
  const assignMsg = await cli('Assign Sequence 99 At Executor 1.5', 500)
  const after15 = await cellLabel(1, 0)
  check('Assign Sequence 99 At Executor 1.5 puts it in column 2, row 1', !!after15 && after15 !== before15, `${before15} → ${after15} (${assignMsg.trim().slice(0, 60)})`)

  // ---- Go / Off Executor 1.5
  await cli('Go Executor 1.5', 100)
  await wait(3200)
  const goVals = await dim()
  check('Go Executor 1.5 plays the cue (spots at 50 %)', goVals.every((v) => Math.abs(v - 128) <= 1), String(goVals))
  await shot('02-executor-go')
  await cli('Off Executor 1.5', 100)
  await wait(3200)
  check('Off Executor 1.5 fades it out', (await dim()).every((v) => v === 0), String(await dim()))

  // ---- Oops: undo the assignment
  await cli('Oops', 500)
  const oops15 = await cellLabel(1, 0)
  check('Oops undoes the last change (executor 1.5 back to its scene)', oops15 === before15, `${oops15}`)

  // ---- Executor cell with button function 'flash' (pointer down / up)
  await cli('Assign Executor 1.1 /button=flash', 400)
  const sum = (a) => a.reduce((x, y) => x + y, 0)
  const before = sum(await out())
  const cell = win.locator('[data-exec-cell="0:0"]').first()
  const box = await cell.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await wait(600)
  const during = sum(await out())
  await shot('03-flash-held')
  await win.mouse.up()
  await wait(2800)
  const after = sum(await out())
  check('Flash executor: output up while held, back on release', during > before && Math.abs(after - before) <= 4, `sum ${before} → ${during} → ${after}`)
  await cli('Assign Executor 1.1 /button=toggle', 300)

  // ---- Executor pages
  await cli('Assign Sequence 2 At Executor 2.1', 400)
  await cli('Page 2', 500)
  const pageLabel = await win.locator(`[aria-label="${await T('pro.stage.pages.aria')}"]`).first().textContent().catch(() => '')
  const p2cell = await cellLabel(0, 0)
  check('Page 2 (created by Assign) shows its executors', /2/.test(pageLabel ?? '') && !!p2cell, `selector "${(pageLabel ?? '').trim()}", 2.1 = ${p2cell}`)
  await shot('04-page-2')
  await win.locator(`[aria-label="${await T('pro.stage.pages.aria')}"] button`).first().click().catch(() => {})
  await wait(400)
  check('page selector back to page 1', (await cellLabel(1, 0)) === before15, `${await cellLabel(1, 0)}`)

  // ---- Macro (pools: create, then run from the command line)
  await win.locator('[data-tab="pools"]').first().click()
  await wait(500)
  await win.locator('[data-pools-tab] [data-tab="macros"]').first().click()
  await win.locator('[data-pools-tab="macros"] [data-slot="1"]').first().click()
  await wait(400)
  await win.getByRole('button', { name: await T('pro.pools.macroEditor.addLine') }).click()
  await win.getByRole('textbox', { name: await T('pro.pools.macroEditor.command', { n: 1 }) }).fill('Fixture 1 Thru 4 At 30')
  await win.getByRole('button', { name: await T('common.save'), exact: true }).click()
  await wait(300)
  await cli('Macro 1', 800)
  const macroVals = await dim()
  check('Macro 1 runs its line (spots at 30 %)', macroVals.every((v) => Math.abs(v - 77) <= 1), String(macroVals))
  await cli('Clear'); await cli('Clear', 600)

  // ---- Blind
  await cli('Blind On', 300)
  await cli('Fixture 1 Thru 4 At 100', 600)
  const blindVals = await dim()
  const blindPressed = await win.locator('[data-tool="blind"]').first().getAttribute('aria-pressed').catch(() => null)
  check('Blind: programmer values stay off the output', blindVals.every((v) => v === 0), `${blindVals} (Blind button pressed: ${blindPressed})`)
  await win.locator('[data-tab="visualizer"]').first().click()
  await wait(2500)
  await shot('05-blind-3d-preview')
  await cli('Blind Off', 600)
  check('Blind Off: the values reach the output', (await dim()).every((v) => v === 255), String(await dim()))
  await win.locator('[data-tab="playback"]').first().click()

  // ---- Park / Unpark
  await cli('At 60', 500)
  await cli('Park', 400)
  await cli('Clear'); await cli('Clear', 600)
  const parked = await dim()
  check('Park holds the output after Clear', parked.every((v) => Math.abs(v - 153) <= 1), String(parked))
  await cli('Unpark', 600)
  check('Unpark releases it', (await dim()).every((v) => v === 0), String(await dim()))
  await shot('06-end')

  const logEntries = await win.locator('[data-cli-log-entry]').count()
  check('command line log filled', logEntries > 10, `${logEntries} entries`)
} catch (e) {
  check('smoke run', false, String(e?.message ?? e).split('\n')[0])
} finally {
  await app.close().catch(() => {})
  rmSync(home, { recursive: true, force: true })
}
check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))
writeFileSync(join(outDir, 'smoke.json'), JSON.stringify({ lang: LANG, failed, results, errors }, null, 2))
console.log(`${results.length - failed}/${results.length} checks passed → ${outDir}`)
process.exit(failed ? 1 : 0)
