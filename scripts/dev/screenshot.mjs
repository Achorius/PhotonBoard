// Dev helper: launch the built app under Xvfb and screenshot each main tab.
// Usage: npm run build && xvfb-run -a node scripts/dev/screenshot.mjs [outDir]
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const outDir = resolve(process.argv[2] || 'screenshots')
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, PHOTONBOARD_HEADLESS_TEST: '1' }
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
await win.waitForTimeout(2500)
await win.screenshot({ path: `${outDir}/00-start.png` })
const tabs = await win.$$eval('[data-tab]', (els) => els.map((e) => e.getAttribute('data-tab')))
for (const [i, t] of tabs.entries()) {
  await win.click(`[data-tab="${t}"]`)
  await win.waitForTimeout(800)
  await win.screenshot({ path: `${outDir}/${String(i + 1).padStart(2, '0')}-${t}.png` })
}
if (!tabs.length) {
  for (let k = 1; k <= 9; k++) {
    await win.keyboard.press(String(k))
    await win.waitForTimeout(800)
    await win.screenshot({ path: `${outDir}/key-${k}.png` })
  }
}
await app.close()
console.log('screenshots in', outDir)
