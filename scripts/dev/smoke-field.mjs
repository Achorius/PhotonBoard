// ============================================================
// End-to-end check of the 1.1.1 field fixes in the BUILT app (out/):
// fake Web MIDI (APC mini mk2 with its Linux/ALSA port names, plugged
// after start WITHOUT a statechange), fake gamepad, fake USB stick root
// (PHOTONBOARD_REMOVABLE_ROOTS). DMX read back from the main engine.
//
//   npm run build && xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/dev/smoke-field.mjs . <outDir>
// ============================================================
import { _electron as electron } from 'playwright'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(process.argv[2] || '.')
const outDir = resolve(process.argv[3] || 'smoke-field')
mkdirSync(outDir, { recursive: true })
const SHOW = join(ROOT, 'scripts/dev/demo-show.pbshow')
const home = mkdtempSync(join(tmpdir(), 'pb-e2e-'))
const showDir = join(home, 'Documents', 'PhotonBoard')
mkdirSync(showDir, { recursive: true })
copyFileSync(SHOW, join(showDir, 'Club Night Demo.pbshow'))
const media = join(home, 'media')
mkdirSync(media, { recursive: true })

const LINUX_MK2 = 'APC mini mk2 APC mini mk2 Contro'
const INIT = `(() => {
  let id = 1
  const port = (name, type) => ({ id: 'fake-' + id++, name, type, manufacturer: 'Akai', state: 'connected', connection: 'open',
    onmidimessage: null, sent: [], send(d) { this.sent.push(Array.from(d)) }, open: async () => {}, close: async () => {}, addEventListener() {}, removeEventListener() {} })
  const access = { inputs: new Map(), outputs: new Map(), onstatechange: null, sysexEnabled: false, addEventListener() {}, removeEventListener() {} }
  window.__fakeMidiAdd = (name) => { const i = port(name, 'input'), o = port(name, 'output'); access.inputs.set(i.id, i); access.outputs.set(o.id, o) } // NO statechange
  window.__fakeMidiEmit = (name, bytes) => { for (const i of access.inputs.values()) if (i.name === name) i.onmidimessage?.({ data: new Uint8Array(bytes) }) }
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async (o) => { access.sysexEnabled = !!(o && o.sysex); return access } })
  window.__fakePad = null
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__fakePad, null, null, null] })
})()`

const app = await electron.launch({
  args: ['--no-sandbox', join(ROOT, 'out/main/index.js')],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1', PB_NO_SPLASH: '1',
    PHOTONBOARD_WEB_PORT: String(30000 + Math.floor(Math.random() * 20000)), PHOTONBOARD_API_PORT: '0', PHOTONBOARD_REMOVABLE_ROOTS: media }
})
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`) }
try {
  await app.context().addInitScript(INIT)
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.error('[renderer error]', e.message))
  const wait = (ms) => win.waitForTimeout(ms)
  const ready = async () => {
    await win.waitForSelector('[data-tab]', { timeout: 30000 })
    await win.getByText('Club Night Demo').first().waitFor({ timeout: 30000 })
    await wait(800)
  }
  await ready()
  await win.evaluate(() => { localStorage.setItem('photonboard.ui.language', 'en') })
  await win.reload()
  await ready()
  await app.evaluate(({ BrowserWindow }) => { const bw = BrowserWindow.getAllWindows()[0]; bw.setFullScreen(false); bw.setContentSize(1600, 1000) })
  await wait(500)
  const out = () => win.evaluate(async () => Array.from(await window.photonboard.dmx.getValues(0)))
  const gm = async () => Number(await win.locator('[role="slider"][aria-label="Grand Master"]').first().getAttribute('aria-valuenow'))
  const tab = (id) => win.locator(`[data-tab="${id}"]`).first().click()

  // ---- MIDI hotplug (no statechange) ----
  await tab('midi')
  await wait(500)
  await win.evaluate((n) => { window.__fakeMidiAdd(n); window.__fakeMidiAdd('APC mini mk2 APC mini mk2 Notes') }, LINUX_MK2)
  await wait(3500)
  const ctl = await win.locator('[data-midi-controllers]').textContent().catch(() => '')
  check('hotplugged APC mini mk2 appears without Rescan (no statechange)', /APC mini mk2/.test(ctl ?? ''), (ctl ?? '').slice(0, 80))
  const summary = await win.locator('[data-controller-summary]').first().textContent().catch(() => '')
  check('MIDI view explains what the profile drives', /Grand Master/.test(summary ?? '') && /Faders 1–8/.test(summary ?? ''), (summary ?? '').slice(0, 160))
  await win.screenshot({ path: join(outDir, 'midi-controller.png') })

  // ---- Profile fader 9 → GM ----
  const emit = (bytes) => win.evaluate(([n, b]) => window.__fakeMidiEmit(n, b), [LINUX_MK2, bytes])
  await emit([0xb0, 56, 127]); await emit([0xb0, 56, 64]); await wait(200)
  check('profile fader 9 drives the Grand Master', (await gm()) === 129, `GM=${await gm()}`)
  await emit([0xb0, 56, 127]); await wait(200)
  check('profile fader 9 back to full', (await gm()) === 255, `GM=${await gm()}`)
  // GM moved on screen (double-tap = back to full) while the fader is down: the fader must pick up
  await emit([0xb0, 56, 10]); await wait(200)
  await win.locator('[role="slider"][aria-label="Grand Master"]').first().dblclick(); await wait(300)
  check('GM back to full on screen', (await gm()) === 255, `GM=${await gm()}`)
  await emit([0xb0, 56, 15]); await wait(300)
  const toast = await win.getByText(/waits for pickup/).first().textContent().catch(() => '')
  check('a far GM fader says it waits for pickup (toast)', /Grand Master/.test(toast ?? ''), (toast ?? '').slice(0, 100))
  check('…and the GM did not jump', (await gm()) === 255, `GM=${await gm()}`)
  await win.screenshot({ path: join(outDir, 'pickup-toast.png') })

  // ---- MIDI learn of the GM on CC 56 (profile on) ----
  await win.locator('[role="slider"][aria-label="Grand Master"]').first().click({ button: 'right' })
  await wait(200)
  for (const v of [120, 124, 127, 127]) await emit([0xb0, 56, v])
  await wait(700)
  await emit([0xb0, 56, 0]); await wait(200)
  const g0 = await gm()
  await emit([0xb0, 56, 64]); await wait(200)
  const g64 = await gm()
  check('learned GM on CC56 (absolute): fader 0 → GM 0, 64 → GM 129, no pickup', g0 === 0 && g64 === 129, `GM ${g0} / ${g64}`)
  const table = await win.locator('text=Absolute').count()
  check('learned mapping is shown as absolute', table > 0)
  await emit([0xb0, 56, 127]); await wait(200)

  // ---- Blinder: Par 1 (dimmer + RGB at 0 in the look) → dimmer 255 + RGB 255 ----
  const PAR = 120 // Par 1 at 1.121: R G B A Dimmer Strobe
  const before = (await out()).slice(PAR, PAR + 6)
  const blinder = win.getByRole('button', { name: await win.evaluate(() => window.__pbI18n.t('shell.masters.blinderAria')), exact: true }).first()
  const box = await blinder.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down(); await wait(300)
  const during = (await out()).slice(PAR, PAR + 6)
  await win.mouse.up(); await wait(300)
  check('Blinder: a par dark in the look → dimmer 255 + RGB(A) 255, strobe channel open', during[4] === 255 && during[0] === 255 && during[1] === 255 && during[2] === 255 && during[5] < 10,
    `before ${before} during ${during}`)
  const after = (await out()).slice(PAR, PAR + 6)
  check('Blinder released: back to the look', after.join() === before.join(), `after ${after}`)

  // ---- Strobe (default full white): hardware strobe channel in its strobe range ----
  const strobe = win.getByRole('button', { name: await win.evaluate(() => window.__pbI18n.t('shell.masters.strobeAria')), exact: true }).first()
  const sb = await strobe.boundingBox()
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await win.mouse.down(); await wait(250)
  const samples = []
  for (let i = 0; i < 5; i++) { samples.push((await out()).slice(PAR, PAR + 6)); await wait(37) }
  const front = (await out())[180]
  await win.mouse.up(); await wait(300)
  check('Strobe: hardware-strobe par → strobe channel in 10-255 at 10 Hz, dimmer kept full (not chopped), RGB full white',
    samples.every((s) => s[5] >= 10 && s[4] === 255 && s[0] === 255), samples.map((s) => s.join('/')).join('  '))
  check('Strobe: a dimmer-only fixture (Front 1) goes full (white mode; the engine chops it)', front === 255, `Front 1 = ${front}`)
  const afterStrobe = (await out()).slice(PAR, PAR + 6)
  check('Strobe released: back to the look', afterStrobe.join() === before.join(), `after ${afterStrobe}`)

  // ---- Strobe settings UI ----
  await tab('settings'); await wait(400)
  const strobeCard = await win.locator('[data-strobe-rate]').count()
  check('Settings › Outputs shows the strobe rate / mode card', strobeCard > 0)
  await win.screenshot({ path: join(outDir, 'strobe-settings.png'), fullPage: true })

  // ---- Gamepad ----
  await tab('follow'); await wait(500)
  const help = await win.locator('[data-gamepad-help]').textContent().catch(() => '')
  check('Follow: no gamepad visible → says to press a button / what the OS sees', /press|game controller/i.test(help ?? ''), (help ?? '').slice(0, 120))
  await win.evaluate(() => {
    window.__fakePad = { id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', index: 0, connected: true, mapping: 'standard', timestamp: 1,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) }
  })
  await wait(600)
  const status = await win.getByText(/Xbox 360 Controller/).first().textContent().catch(() => '')
  check('Follow sees the injected gamepad', /Xbox 360/.test(status ?? ''), (status ?? '').slice(0, 60))
  await win.screenshot({ path: join(outDir, 'follow-gamepad.png') })

  // ---- USB stick ----
  const stick = join(media, 'CLE_SHOWS')
  mkdirSync(join(stick, 'Shows'), { recursive: true })
  copyFileSync(SHOW, join(stick, 'Shows', 'Concert Stick.pbshow'))
  writeFileSync(join(stick, 'notes.txt'), 'x')
  await wait(3000)
  const usbToast = await win.getByText(/USB stick detected/).first().textContent().catch(() => '')
  check('USB stick inserted → toast with its shows', /CLE_SHOWS/.test(usbToast ?? ''), usbToast ?? '')
  await win.screenshot({ path: join(outDir, 'usb-toast.png') })
  await win.getByRole('button', { name: /^File/ }).first().click(); await wait(300)
  await win.getByText('Open from a USB stick…').first().click(); await wait(800)
  await win.screenshot({ path: join(outDir, 'usb-modal.png') })
  await win.locator('[data-usb-open="Concert Stick"]').first().click(); await wait(600)
  // the learned MIDI mapping made the show dirty: "Don't save"
  const dontSave = win.getByRole('button', { name: await win.evaluate(() => window.__pbI18n.t('file.unsaved.dontSave')) })
  if (await dontSave.count()) { await win.screenshot({ path: join(outDir, 'usb-unsaved.png') }); await dontSave.first().click() }
  await wait(2500)
  const title = await win.getByText('Concert Stick').count()
  const copied = await win.evaluate(async () => (await window.photonboard.show.list()).includes('Concert Stick'))
  check('Open from the stick: show copied into the shows folder and opened', title > 0 && copied, `title=${title} inShows=${copied}`)
  await win.getByRole('button', { name: /^File/ }).first().click(); await wait(300)
  await win.getByText('Save a copy on the USB stick').first().click(); await wait(1500)
  const { existsSync } = await import('fs')
  check('Save a copy on the USB stick writes <show>.pbshow at its root', existsSync(join(stick, 'Concert Stick.pbshow')))
} catch (e) {
  failed++
  console.error('E2E error:', e)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
