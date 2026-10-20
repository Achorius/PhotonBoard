// ============================================================
// Screenshot gallery — every main screen, sub-screen, menu and dialog
// of the BUILT app (out/), on every form factor.
//
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/dev/gallery.mjs <outDir> [--only=desktop,pi,remote]
//
// Same isolation as scripts/dev/screenshot.mjs: throw-away HOME /
// XDG_CONFIG_HOME, the demo show auto-loads, random web/API ports.
//   desktop/  1600×1000 compact density — views + sub-screens + shell overlays + Stage window
//   pi/       1920×1080 touch density — every view, Stage window, a few dialogs
//   remote/   web remote in Playwright's Chromium — tablet 1024×768, phone 390×844
// Every step is wrapped: a failure logs a warning and the run continues.
// Does not build: run `npm run build` first if out/ is stale.
// ============================================================

import { _electron as electron, chromium, devices } from 'playwright'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const outDir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'gallery')
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null
const want = (part) => !only || only.has(part)

const SHOW = resolve('scripts/dev/demo-show.pbshow')
const SHOW_TITLE = 'Club Night Demo'
/** Extra copies so File → Open recent has a realistic list */
const EXTRA_SHOWS = ['Concert Salle Pleyel', 'Mariage Dupont', 'Theatre - Le Cid']
const WEB_PORT = process.env.PHOTONBOARD_WEB_PORT || String(20000 + Math.floor(Math.random() * 20000))
const API_PORT = process.env.PHOTONBOARD_API_PORT || String(Number(WEB_PORT) + 1)
const REMOTE_URL = `http://127.0.0.1:${WEB_PORT}`
const REMOTE_PIN = '2468'
const LIVE_SCENES = ['Warm Wash', 'Spot Beams', 'Bars Rainbow']

// ---- isolated environment ----
const home = mkdtempSync(join(tmpdir(), 'photonboard-gallery-'))
const showDir = join(home, 'Documents', 'PhotonBoard')
mkdirSync(showDir, { recursive: true })
for (const n of EXTRA_SHOWS) copyFileSync(SHOW, join(showDir, `${n}.pbshow`))
copyFileSync(SHOW, join(showDir, `${SHOW_TITLE}.pbshow`)) // newest = auto-loaded

const app = await electron.launch({
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1',
    PHOTONBOARD_WEB_PORT: WEB_PORT, PHOTONBOARD_API_PORT: API_PORT }
})

let failures = 0
let count = 0
try {
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.error('[renderer error]', e.message))
  const mainId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)

  // ---- helpers ----
  const wait = (ms, page = win) => page.waitForTimeout(ms)
  const shot = async (page, dir, name, settle = 600) => {
    mkdirSync(join(outDir, dir), { recursive: true })
    await page.waitForTimeout(settle)
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
    await page.screenshot({ path: join(outDir, dir, `${name}.png`) })
    count++
    console.log('  ✓', `${dir}/${name}.png`)
  }
  const escAll = async (page = win) => {
    for (let i = 0; i < 3; i++) {
      const open = await page.locator('[role="dialog"], [role="menu"]').count().catch(() => 0)
      if (!open) break
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(200)
    }
  }
  const step = async (name, fn, page = win) => {
    try { await fn() } catch (e) {
      failures++
      console.warn(`  ! step "${name}" failed:`, String(e.message).split("\n").slice(0, process.env.GALLERY_DEBUG ? 12 : 2).join(" | "))
      await escAll(page)
    }
  }
  const dismissToasts = async (page = win) => {
    for (const b of await page.locator('button[aria-label="Dismiss"]').all()) await b.click({ timeout: 1000 }).catch(() => {})
    await page.waitForTimeout(250)
  }
  const tab = async (id, settle = 700) => {
    await dismissToasts()
    await win.click(`[data-tab="${id}"]`)
    await wait(settle)
  }
  const sizeWindow = async (w, h) => {
    await app.evaluate(({ BrowserWindow }, [id, w, h]) => {
      const bw = BrowserWindow.fromId(id)
      bw.setFullScreen(false)
      bw.setContentSize(w, h)
    }, [mainId, w, h])
    await wait(600)
  }
  const ready = async () => {
    await win.waitForSelector('[data-tab]', { timeout: 20000 })
    await win.getByText(SHOW_TITLE).first().waitFor({ timeout: 20000 })
    await wait(800)
  }
  const setDensity = async (d) => {
    await win.evaluate((d) => { try { localStorage.setItem('photonboard.ui.density', d) } catch { /* ignore */ } }, d)
    await win.reload()
    await ready()
  }
  const startScenes = async (names = LIVE_SCENES) => {
    for (const name of names) {
      const cell = win.locator(`[data-exec-cell][aria-label^="${name},"]`).first()
      if (!(await cell.count())) continue
      const label = await cell.getAttribute('aria-label')
      if (label && /stopped$/.test(label)) await cell.click()
    }
    await wait(1200)
  }
  const selectGroup = async (name) => {
    await win.locator('button[aria-label="Select a group"]').first().click({ timeout: 3000 })
    await wait(250)
    await win.getByRole('menuitem', { name: new RegExp('^' + name) }).first().click({ timeout: 3000 })
    await wait(400)
  }
  // Programmer view mode. The header re-flows when the universe picker appears, so park the
  // pointer afterwards (otherwise another segment shows a hover highlight).
  const fxMode = async (m) => {
    await win.locator(`button:has([data-mode="${m}"])`).first().click({ timeout: 3000 })
    await win.mouse.move(900, 500)
    await wait(500)
  }
  const sidebarRow = (name) => win.locator('[role="listbox"][aria-label="Patched fixtures"] [role="option"]')
    .filter({ has: win.locator('span.truncate', { hasText: new RegExp(`^${name}$`) }) }).first()
  /** Effects target group: clicking an exactly-selected group clears it, so only click when not selected */
  const fxTargetGroup = async (name) => {
    const row = win.locator(`[data-fx-target-group="${name}"]`)
    if ((await row.getAttribute('aria-selected', { timeout: 3000 })) !== 'true') await row.click({ timeout: 3000 })
    await wait(300)
  }
  const subtab = async (name) => { await win.getByRole('tab', { name, exact: true }).first().click({ timeout: 3000 }); await wait(400) }
  const clearProgrammer = async () => { await win.locator('button[aria-label="Clear programmer"]').first().click({ timeout: 2000 }).catch(() => {}); await wait(300) }
  const openStage = async (dir, name, w, h) => {
    const p = app.waitForEvent('window')
    await win.evaluate(() => window.photonboard.stage.open())
    const stage = await p
    await app.evaluate(({ BrowserWindow }, [id, w, h]) => {
      for (const bw of BrowserWindow.getAllWindows()) if (bw.id !== id) { bw.setFullScreen(false); bw.setContentSize(w, h) }
    }, [mainId, w, h])
    await stage.waitForTimeout(1800)
    await shot(stage, dir, name)
    await stage.close()
  }

  await ready()

  // ========================================================== desktop
  if (want('desktop')) {
    const D = 'desktop'
    const s = (name, settle) => shot(win, D, name, settle)
    console.log('desktop 1600×1000 compact')
    await sizeWindow(1600, 1000)
    await setDensity('compact')
    await startScenes()
    await step('start', async () => { await tab('playback'); await s('00-demarrage-scenes') })

    // ---- Patch ----
    await step('patch table', async () => {
      await tab('patch'); await subtab('Fixtures')
      const rows = win.locator('tr[data-row]')
      await rows.nth(0).click(); await rows.nth(3).click({ modifiers: ['Shift'] })
      await s('01-patch-fixtures')
    })
    await step('patch row menu', async () => {
      await win.locator('tr[data-row]').nth(2).locator('button[aria-label^="Actions for"]').click({ timeout: 3000 })
      await s('02-patch-menu-ligne', 400); await escAll()
    })
    await step('patch address', async () => {
      await win.getByRole('toolbar', { name: 'Selected fixtures' }).getByRole('button', { name: 'Address' }).click({ timeout: 3000 })
      await s('03-patch-dialogue-adresse', 400)
      await win.getByRole('button', { name: 'Cancel' }).click()
    })
    await step('patch map', async () => { await subtab('DMX map'); await s('04-patch-carte-dmx') })
    await step('patch library', async () => {
      await subtab('Library')
      await win.locator('[data-source-tab="library"]').first().click({ timeout: 3000 }) // Library tab: catalog / library / online
      await win.getByRole('option').filter({ hasText: 'Moving Head Spot' }).first().click({ timeout: 3000 })
      await s('05-patch-bibliotheque')
    })
    await step('patch add dialog', async () => {
      await win.getByRole('button', { name: 'Patch…' }).first().click({ timeout: 3000 })
      await wait(400)
      const q = win.locator('input[aria-label="Quantity"]').first()
      await q.focus(); await q.fill('4'); await q.press('Enter')
      await s('06-patch-dialogue-ajout')
      await win.getByRole('button', { name: 'Cancel' }).click()
    })
    await step('patch editor', async () => {
      await win.getByRole('button', { name: 'Edit a copy' }).first().click({ timeout: 3000 })
      await s('07-patch-editeur-fixture')
      await win.getByRole('button', { name: 'Cancel' }).click()
      await wait(300)
      await win.getByRole('button', { name: 'Discard changes' }).click({ timeout: 1000 }).catch(() => {})
    })
    await step('patch back', async () => { await subtab('Fixtures') })

    // ---- Fixtures / programmer ----
    await step('fixtures no selection', async () => {
      await tab('fixtures')
      await win.evaluate(() => {}).catch(() => {})
      await selectGroup('Clear selection')
      await fxMode('attributes')
      await s('10-fixtures-sans-selection')
    })
    await step('fixtures spots position', async () => {
      await selectGroup('Spots')
      await win.click('#tab-position'); await s('11-fixtures-spots-intensite-position')
    })
    await step('fixtures spots colour', async () => { await win.click('#tab-colour'); await s('12-fixtures-spots-couleur') })
    await step('fixtures spots beam', async () => { await win.click('#tab-beam'); await s('13-fixtures-spots-faisceau') })
    await step('fixtures washes colour', async () => {
      await selectGroup('Washes')
      await win.click('#tab-colour')
      await win.getByRole('button', { name: 'Magenta', exact: true }).first().click({ timeout: 3000 })
      await win.getByRole('button', { name: 'Full', exact: true }).first().click({ timeout: 3000 }).catch(() => {})
      await win.mouse.move(900, 500)
      await s('14-fixtures-washes-couleur')
    })
    await step('fixtures faders', async () => { await fxMode('faders'); await s('15-fixtures-faders') })
    await step('fixtures sheet', async () => { await fxMode('sheet'); await s('16-fixtures-tableur') })
    await step('fixtures dmx', async () => { await fxMode('dmx'); await s('17-fixtures-dmx-brut') })
    await step('toast', async () => {
      await fxMode('attributes')
      await selectGroup('Spots')
      await win.click('[data-action="locate"]')
      await s('18-fixtures-locate-toast', 500)
      await dismissToasts()
      await clearProgrammer()
    })

    // ---- Effects ----
    await step('effects library', async () => {
      await tab('effects')
      await fxTargetGroup('Spots')
      await s('20-effets-bibliotheque')
    })
    await step('effects editor', async () => {
      await win.locator('[data-fx-row="Spot Circle"] [data-fx-play]').click({ timeout: 3000 })
      await win.locator('[data-fx-row="Spot Circle"] [data-fx-edit]').click({ timeout: 3000 })
      await s('21-effets-editeur-en-cours', 1200)
    })
    await step('effects movement', async () => {
      await win.getByRole('tab', { name: /Movement/ }).first().click({ timeout: 3000 })
      await s('22-effets-categorie-mouvement')
    })

    // ---- Scenes ----
    await step('scenes', async () => { await tab('playback'); await s('30-scenes-liste') })
    await step('scene detail', async () => {
      await win.locator('[data-scene-row]', { hasText: 'Intro' }).first().click({ timeout: 3000 })
      await wait(200)
      await win.getByRole('button', { name: 'GO', exact: true }).click()
      await wait(300)
      await win.getByRole('button', { name: 'GO', exact: true }).click()
      await s('31-scene-detail-cues', 1500)
    })
    await step('record popover', async () => {
      await win.locator('tr[data-reorder-index="1"] td').nth(1).click({ timeout: 3000 })
      await win.getByRole('button', { name: /Record…/ }).first().click({ timeout: 3000 })
      await s('32-scene-popover-enregistrer', 400)
      await win.keyboard.press('Escape')
    })
    await step('cue menu', async () => {
      await win.getByRole('button', { name: /Cue 2 actions/ }).click({ timeout: 3000 })
      await s('33-scene-menu-cue', 300)
      await win.keyboard.press('Escape')
    })
    await step('scene effects', async () => {
      await win.locator('[data-scene-row]', { hasText: 'Spot Beams' }).first().click({ timeout: 3000 })
      await win.getByRole('tab', { name: /Effects/ }).click({ timeout: 3000 })
      await s('34-scene-onglet-effets')
      await win.getByRole('tab', { name: /Cues/ }).click()
    })
    await step('chases', async () => {
      await win.getByRole('radio', { name: /Chases/ }).click({ timeout: 3000 })
      await wait(300)
      await win.getByRole('button', { name: 'Play', exact: true }).first().click({ timeout: 3000 })
      await s('35-chases-editeur', 1200)
      await win.getByRole('button', { name: 'Stop', exact: true }).first().click({ timeout: 3000 })
      await win.getByRole('radio', { name: /Scenes/ }).click()
    })

    // ---- Timeline ----
    await step('timeline', async () => { await tab('live'); await s('40-timeline') })
    await step('timeline clip', async () => {
      await win.locator('[data-clip]').nth(2).click({ timeout: 3000 })
      await s('41-timeline-clip-selectionne', 400)
    })
    await step('timeline tc', async () => {
      await win.locator('[data-tc-toggle]').click({ timeout: 3000 })
      await s('42-timeline-popover-timecode', 400)
      await win.keyboard.press('Escape')
    })
    await step('timeline play', async () => {
      await win.locator('[data-transport="play"]').click({ timeout: 3000 })
      await s('43-timeline-lecture', 2500)
      await win.locator('[data-transport="stop"]').click({ timeout: 3000 })
    })

    // ---- 3D ----
    await step('3d', async () => {
      await startScenes(['Warm Wash', 'Spot Beams', 'Bars Rainbow'])
      await tab('visualizer', 3500)
      await s('50-3d-faisceaux')
    })
    await step('3d selected', async () => { await sidebarRow('Spot 2').click({ timeout: 3000 }); await s('51-3d-fixture-selectionnee', 1200) })
    await step('3d top', async () => {
      await win.getByRole('button', { name: 'Plan view from above' }).click({ timeout: 3000 })
      await s('52-3d-vue-dessus', 1500)
      await win.getByRole('button', { name: 'Perspective view' }).click()
    })
    await step('3d room', async () => {
      await win.getByRole('button', { name: /^Room/ }).first().click({ timeout: 3000 })
      await s('53-3d-popover-salle', 800)
      await win.keyboard.press('Escape')
    })

    // ---- Layout ----
    await step('layout', async () => {
      await tab('stage-layout', 1200)
      await sidebarRow('Wash 2').click({ timeout: 3000 })
      await s('55-plan-fixture-selectionnee', 800)
    })
    await step('layout menu', async () => {
      const box = await win.locator('canvas[role="application"]').boundingBox()
      await win.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.12, { button: 'right' })
      await s('56-plan-menu-contextuel', 400)
      await win.keyboard.press('Escape')
    })

    // ---- MIDI ----
    await step('midi', async () => { await tab('midi'); await s('60-midi-mappings') })
    await step('midi edit', async () => { await win.locator('[data-mapping-row]').nth(1).click({ timeout: 3000 }); await s('61-midi-edition-mapping', 400) })
    await step('midi learn', async () => {
      await win.locator('[data-midi-learn]').first().click({ timeout: 3000 })
      await s('62-midi-menu-learn', 400)
      await win.keyboard.press('Escape')
    })

    // ---- Follow ----
    await step('follow', async () => { await tab('follow'); await s('65-follow') })
    await step('follow active', async () => {
      const rows = win.locator('[data-follow-fixture]')
      for (let i = 0; i < 4; i++) await rows.nth(i).click({ timeout: 3000 })
      await win.locator('[data-follow-activate]').click({ timeout: 3000 })
      await wait(400)
      const b = await win.locator('[data-follow-pad]').boundingBox()
      await win.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.4); await win.mouse.down()
      await win.mouse.move(b.x + b.width * 0.38, b.y + b.height * 0.48, { steps: 4 }); await win.mouse.up()
      await s('66-follow-actif')
      await win.locator('[data-follow-activate]').click({ timeout: 3000 })
    })

    // ---- Settings ----
    const sections = [['Outputs', '70-reglages-sorties'], ['Remote access', '71-reglages-acces-distant-qr'], ['Display', '72-reglages-affichage'], ['Show', '73-reglages-show'], ['About', '74-reglages-a-propos']]
    await step('settings', async () => { await tab('settings') })
    for (const [label, name] of sections) {
      await step(`settings ${label}`, async () => {
        await win.locator('nav[aria-label="Settings sections"] button', { hasText: label }).first().click({ timeout: 3000 })
        await s(name, label === 'Remote access' ? 1200 : 600)
      })
    }

    // ---- Shell ----
    await step('file menu', async () => {
      await tab('playback')
      await win.getByRole('button', { name: 'File' }).click({ timeout: 3000 })
      await s('80-menu-fichier', 300)
    })
    await step('open recent', async () => {
      await win.getByRole('menuitem', { name: /Open recent/ }).click({ timeout: 3000 })
      await s('81-menu-ouvrir-recent', 600)
      await escAll()
    })
    await step('output health', async () => {
      await win.locator('footer button', { hasText: /output|No DMX/i }).first().click({ timeout: 3000 })
      await s('82-popover-sorties-dmx', 400)
      await win.keyboard.press('Escape')
    })
    await step('executor menu', async () => {
      await win.locator('[data-exec-cell][aria-label^="Verse,"]').first().click({ button: 'right', timeout: 3000 })
      await s('83-menu-executeur', 300)
      await win.keyboard.press('Escape')
    })
    await step('column popover', async () => {
      await win.locator('button[title="Column title & colour"]').first().click({ timeout: 3000 })
      await win.getByLabel('Column title').fill('Wash looks')
      await s('84-popover-colonne', 300)
      await win.keyboard.press('Escape')
    })
    await step('shortcuts', async () => {
      await win.locator('main').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
      await win.keyboard.press('Shift+?')
      await s('85-raccourcis-clavier', 400)
      await win.keyboard.press('Escape')
    })
    await step('unsaved dialog', async () => {
      await win.getByRole('button', { name: 'File' }).click({ timeout: 3000 })
      await win.getByRole('menuitem', { name: /New show/ }).click({ timeout: 3000 })
      await s('86-dialogue-modifications-non-enregistrees', 400)
      await win.getByRole('button', { name: 'Cancel' }).click()
    })
    await step('blackout', async () => {
      await win.locator('main').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
      await win.keyboard.press('Escape')
      await s('87-blackout-actif', 500)
      await win.keyboard.press('Escape')
    })
    await step('stage window', async () => { await openStage(D, '88-fenetre-stage', 1600, 1000) })
  }

  // ========================================================== pi
  if (want('pi')) {
    const P = 'pi'
    const s = (name, settle) => shot(win, P, name, settle)
    console.log('pi 1920×1080 touch')
    await sizeWindow(1920, 1080)
    await setDensity('touch')
    await startScenes()
    await step('pi start', async () => { await tab('playback'); await s('00-demarrage-scenes') })
    await step('pi patch', async () => { await tab('patch'); await subtab('Fixtures'); await s('01-patch') })
    await step('pi fixtures', async () => {
      await tab('fixtures'); await fxMode('attributes'); await selectGroup('Spots')
      await win.click('#tab-position'); await s('02-fixtures-spots')
    })
    await step('pi fixtures colour', async () => {
      await selectGroup('Washes'); await win.click('#tab-colour')
      await win.getByRole('button', { name: 'Magenta', exact: true }).first().click({ timeout: 3000 })
      await s('03-fixtures-washes-couleur')
      await clearProgrammer()
    })
    await step('pi effects', async () => {
      await tab('effects')
      await fxTargetGroup('Spots')
      await win.locator('[data-fx-row="Spot Circle"] [data-fx-play]').click({ timeout: 3000 })
      await win.locator('[data-fx-row="Spot Circle"] [data-fx-edit]').click({ timeout: 3000 })
      await s('04-effets', 1000)
    })
    await step('pi scenes', async () => {
      await tab('playback')
      await win.locator('[data-scene-row]', { hasText: 'Intro' }).first().click({ timeout: 3000 })
      await s('05-scenes')
    })
    await step('pi timeline', async () => { await tab('live'); await win.locator('[data-clip]').nth(2).click({ timeout: 3000 }); await s('06-timeline') })
    await step('pi 3d', async () => { await tab('visualizer', 3500); await s('07-3d') })
    await step('pi layout', async () => { await tab('stage-layout', 1200); await s('08-plan') })
    await step('pi midi', async () => { await tab('midi'); await s('09-midi') })
    await step('pi follow', async () => { await tab('follow'); await s('10-follow') })
    await step('pi settings', async () => {
      await tab('settings')
      await win.locator('nav[aria-label="Settings sections"] button', { hasText: 'Remote access' }).first().click({ timeout: 3000 })
      await s('11-reglages-acces-distant', 1200)
    })
    await step('pi add dialog', async () => {
      await tab('patch'); await subtab('Library')
      await win.locator('[data-source-tab="library"]').first().click({ timeout: 3000 }) // Library tab: catalog / library / online
      await win.getByRole('option').filter({ hasText: 'Moving Head Spot' }).first().click({ timeout: 3000 })
      await win.getByRole('button', { name: 'Patch…' }).first().click({ timeout: 3000 })
      await s('12-dialogue-ajout-fixtures', 500)
      await win.getByRole('button', { name: 'Cancel' }).click()
      await subtab('Fixtures')
    })
    await step('pi file menu', async () => {
      await tab('playback')
      await win.getByRole('button', { name: 'File' }).click({ timeout: 3000 })
      await s('13-menu-fichier', 300)
      await escAll()
    })
    await step('pi exec menu', async () => {
      await win.locator('[data-exec-cell][aria-label^="Verse,"]').first().click({ button: 'right', timeout: 3000 })
      await s('14-menu-executeur', 300)
      await win.keyboard.press('Escape')
    })
    await step('pi stage window', async () => { await openStage(P, '15-fenetre-stage', 1920, 1080) })
    await step('pi density reset', async () => { await setDensity('auto'); await startScenes() })
  }

  // ========================================================== remote
  if (want('remote')) {
    const R = 'remote'
    console.log('remote')
    await win.evaluate((pin) => window.photonboard.remote.setSettings({ pinEnabled: true, pin }), REMOTE_PIN)
    const browser = await chromium.launch()
    try {
      const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, deviceScaleFactor: 1 })
      const tp = await tablet.newPage()
      tp.on('pageerror', (e) => console.error('[remote error]', e.message))
      await step('tablet pin', async () => {
        await tp.goto(REMOTE_URL)
        const pinInput = tp.getByRole('textbox', { name: 'PIN' })
        await pinInput.waitFor({ timeout: 15000 })
        await shot(tp, R, 'tablette-0-code-pin', 400)
        await pinInput.fill(REMOTE_PIN)
        await tp.getByRole('button', { name: 'Connect' }).click()
        await pinInput.waitFor({ state: 'detached', timeout: 15000 })
        await tp.waitForTimeout(2000)
      }, tp)
      await step('tablet stage', async () => {
        const full = tp.getByRole('button', { name: 'Full console' }).first()
        if (!(await full.count())) { await tp.getByRole('button', { name: 'Stage' }).click({ timeout: 3000 }) }
        await tp.waitForTimeout(800)
        await dismissToasts(tp)
        await shot(tp, R, 'tablette-1-vue-scene', 1200)
      }, tp)
      await step('tablet console scenes', async () => {
        // Two identical buttons overlap here (App.tsx fixed one + RemoteStageView header); either switches
        await tp.getByRole('button', { name: 'Full console' }).last().click({ timeout: 3000 })
        await tp.waitForTimeout(800)
        await tp.click('[data-tab="playback"]')
        await tp.locator('[data-scene-row]', { hasText: 'Spot Beams' }).first().click({ timeout: 3000 }).catch(() => {})
        await dismissToasts(tp)
        await shot(tp, R, 'tablette-2-console-scenes', 1000)
      }, tp)
      await step('tablet console fixtures', async () => {
        await tp.click('[data-tab="fixtures"]')
        await tp.waitForTimeout(500)
        await tp.locator('button[aria-label="Select a group"]').first().click({ timeout: 3000 })
        await tp.getByRole('menuitem', { name: /^Spots/ }).first().click({ timeout: 3000 })
        await tp.click('#tab-colour').catch(() => {})
        await dismissToasts(tp)
        await shot(tp, R, 'tablette-3-console-fixtures', 1000)
      }, tp)

      const phone = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
      const pp = await phone.newPage()
      pp.on('pageerror', (e) => console.error('[remote error]', e.message))
      await step('phone play', async () => {
        await pp.goto(`${REMOTE_URL}/?pin=${REMOTE_PIN}`)
        await pp.locator('[data-stage-cell][role="button"]').first().waitFor({ timeout: 15000 })
        await pp.waitForTimeout(1000)
        await dismissToasts(pp)
        await shot(pp, R, 'telephone-1-scene-jouer', 800)
      }, pp)
      await step('phone active', async () => {
        // Columns 3-4 (Movers / Song), start Ballad and Verse from the phone
        await pp.getByRole('tab', { name: 'Columns 3 and 4' }).click({ timeout: 3000 })
        await pp.waitForTimeout(400)
        for (const n of ['Ballad', 'Verse']) {
          const cell = pp.locator(`[data-stage-cell][aria-label^="${n},"]`).first()
          if (/stopped$/.test((await cell.getAttribute('aria-label', { timeout: 3000 })) ?? '')) await cell.click({ timeout: 3000 })
        }
        await dismissToasts(pp)
        await shot(pp, R, 'telephone-2-scenes-actives', 1500)
      }, pp)
      await step('phone levels', async () => {
        await pp.getByRole('tab', { name: 'Columns 1 and 2' }).click({ timeout: 3000 }).catch(() => {})
        await pp.getByRole('radio', { name: 'Levels' }).click({ timeout: 3000 })
        await dismissToasts(pp)
        await shot(pp, R, 'telephone-3-niveaux', 1000)
        await pp.getByRole('radio', { name: 'Play' }).click({ timeout: 3000 })
      }, pp)
    } finally {
      await browser.close()
      await win.evaluate(() => window.photonboard.remote.setSettings({ pinEnabled: false, pin: '' })).catch(() => {})
    }
  }
} finally {
  await app.close()
  rmSync(home, { recursive: true, force: true })
}
console.log(`${count} screenshots in ${outDir}${failures ? ` — ${failures} step(s) failed` : ''}`)
