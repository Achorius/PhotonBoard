// Dev helper: smoke-test a packaged Linux build (dist/linux-unpacked) under Xvfb.
// Checks the app boots, the window renders, the web remote is served from
// app.asar, and the serial port native module loads.
//   xvfb-run -a node scripts/dev/smoke-packaged.mjs [dist/linux-unpacked/photonboard]
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const exe = resolve(process.argv[2] || 'dist/linux-unpacked/photonboard')
const home = mkdtempSync(join(tmpdir(), 'photonboard-smoke-'))
const port = String(20000 + Math.floor(Math.random() * 20000))
const app = await electron.launch({
  executablePath: exe,
  args: ['--no-sandbox'],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1',
    PHOTONBOARD_WEB_PORT: port, PHOTONBOARD_API_PORT: String(Number(port) + 1) }
})
const errors = []
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(e.message))
await win.waitForTimeout(4000)
const title = await win.title()
const navCount = await win.$$eval('[data-tab]', (els) => els.length)
const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.status + ' ' + r.headers.get('content-type')).catch((e) => 'ERR ' + e.message)
const ports = await win.evaluate(async () => {
  try { const r = await window.photonboard.dmxOutputs.scanUsb(); return Array.isArray(r) ? 'ok (' + r.length + ' ports)' : JSON.stringify(r) } catch (e) { return 'ERR ' + e.message }
})
const version = await app.evaluate(({ app }) => app.getVersion())
console.log(JSON.stringify({ version, title, navCount, webRemote: html, serialPorts: ports, pageErrors: errors }, null, 2))
await win.screenshot({ path: join(home, 'packaged.png') })
console.log('screenshot', join(home, 'packaged.png'))
await app.close()
