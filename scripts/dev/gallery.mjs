// ============================================================
// Screenshot gallery — every main screen, sub-screen, menu and dialog
// of the BUILT app (out/), on every form factor, in French or English,
// simple or Pro view.
//
//   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/dev/gallery.mjs <outDir> [--only=desktop,pi,remote] [--lang=fr|en] [--pro]
//
//   --lang=fr|en  UI language (localStorage 'photonboard.ui.language'; default en)
//   --pro         Pro programming view on (localStorage 'photonboard.ui.pro'),
//                 plus the Pro screens: command line panel + keypad, pools,
//                 programmer tools + MAtricks, cue table pro columns + timing
//                 editor, scene advanced settings, record popover store modes,
//                 executor pages + pro cell menu + column faders, stage pages
//                 + designer, MIDI controller (fake APC mini mk2) + map.
//
// Controls are found by data-* attributes, roles and their TRANSLATED
// names (the app exposes its translator as window.__pbI18n), so one
// script runs in both languages.
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
const argValue = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const onlyArg = argValue('only')
const only = onlyArg ? new Set(onlyArg.split(',')) : null
const want = (part) => !only || only.has(part)
const LANG = argValue('lang') === 'fr' ? 'fr' : 'en'
const PRO = process.argv.includes('--pro')
const APP_ROOT = resolve(argValue('app') || '.')

const SHOW = resolve('scripts/dev/demo-show.pbshow')
const SHOW_TITLE = 'Club Night Demo'
/** Extra copies so File → Open recent has a realistic list */
const EXTRA_SHOWS = ['Concert Salle Pleyel', 'Mariage Dupont', 'Theatre - Le Cid']
const WEB_PORT = process.env.PHOTONBOARD_WEB_PORT || String(20000 + Math.floor(Math.random() * 20000))
const API_PORT = process.env.PHOTONBOARD_API_PORT || String(Number(WEB_PORT) + 1)
const REMOTE_URL = `http://127.0.0.1:${WEB_PORT}`
const REMOTE_PIN = '2468'
const LIVE_SCENES = ['Warm Wash', 'Spot Beams', 'Bars Rainbow']
/** Machine preferences every page starts with */
const PREFS = { 'photonboard.ui.language': LANG, 'photonboard.ui.pro': PRO ? 'true' : 'false' }

/** A fake Web MIDI with an Akai APC mini mk2 plugged in (Pro MIDI screens) */
const FAKE_MIDI = `(() => {
  let id = 1
  const port = (name, type) => ({ id: 'fake-' + id++, name, type, manufacturer: 'Akai Professional', state: 'connected', connection: 'open',
    onmidimessage: null, send() {}, open: async () => {}, close: async () => {}, addEventListener() {}, removeEventListener() {} })
  const access = { inputs: new Map(), outputs: new Map(), onstatechange: null, sysexEnabled: false, addEventListener() {}, removeEventListener() {} }
  for (const n of ['APC mini mk2 Control', 'APC mini mk2 Notes']) {
    const i = port(n, 'input'); const o = port(n, 'output')
    access.inputs.set(i.id, i); access.outputs.set(o.id, o)
  }
  window.__fakeMidi = access
  window.__fakeMidiEmit = (bytes) => { for (const i of access.inputs.values()) if (i.name === 'APC mini mk2 Control') i.onmidimessage?.({ data: new Uint8Array(bytes) }) }
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async (o) => { access.sysexEnabled = !!(o && o.sysex); return access } })
})()`

// ---- isolated environment ----
const home = mkdtempSync(join(tmpdir(), 'photonboard-gallery-'))
const showDir = join(home, 'Documents', 'PhotonBoard')
mkdirSync(showDir, { recursive: true })
for (const n of EXTRA_SHOWS) copyFileSync(SHOW, join(showDir, `${n}.pbshow`))
copyFileSync(SHOW, join(showDir, `${SHOW_TITLE}.pbshow`)) // newest = auto-loaded

const app = await electron.launch({
  args: ['--no-sandbox', join(APP_ROOT, 'out/main/index.js')],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PHOTONBOARD_HEADLESS_TEST: '1', PB_NO_SPLASH: '1',
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
  /** Translated UI text (the app's own dictionary, current language) */
  const T = (key, params, page = win) => page.evaluate(([k, p]) => window.__pbI18n.t(k, p), [key, params ?? {}])
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  /** Regex matching a translated text at the start of an accessible name ("Effects 3" tab badges…) */
  const startsWith = async (key, params, page = win) => new RegExp('^' + esc(await T(key, params, page)))
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
      console.warn(`  ! step "${name}" failed:`, String(e.message).split('\n').slice(0, process.env.GALLERY_DEBUG ? 12 : 2).join(' | '))
      await escAll(page)
    }
  }
  const dismissToasts = async (page = win) => {
    const label = await T('ui.dismiss', {}, page).catch(() => 'Dismiss')
    for (const b of await page.locator(`button[aria-label="${label}"]`).all()) await b.click({ timeout: 1000 }).catch(() => {})
    await page.waitForTimeout(250)
  }
  const tab = async (id, settle = 700) => {
    await dismissToasts()
    await win.locator(`[data-tab="${id}"]`).first().click()
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
    await win.waitForFunction(() => !!window.__pbI18n, null, { timeout: 10000 })
    await wait(800)
  }
  /** Machine preferences (language, Pro, density…) then reload */
  const setPrefs = async (prefs) => {
    await win.evaluate((p) => { try { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v) } catch { /* ignore */ } }, prefs)
    await win.reload()
    await ready()
  }
  const setDensity = (d) => setPrefs({ 'photonboard.ui.density': d })
  /** ", stopped" (or ", arrêtée"…) at the end of an executor cell's accessible name */
  const stoppedSuffix = async (key, page = win) => {
    const full = await T(key, { name: '\u0001', mode: '\u0002' }, page)
    return full.slice(full.indexOf('\u0002') + 1)
  }
  const startScenes = async (names = LIVE_SCENES) => {
    const suffix = await stoppedSuffix('shell.executors.cellStopped')
    for (const name of names) {
      const cell = win.locator(`[data-exec-cell][aria-label^="${name},"]`).first()
      if (!(await cell.count())) continue
      const label = await cell.getAttribute('aria-label')
      if (label && label.endsWith(suffix)) await cell.click()
    }
    await wait(1200)
  }
  const groupMenu = async () => {
    await win.locator(`button[aria-label="${await T('fixtures.groupMenu.aria')}"]`).first().click({ timeout: 3000 })
    await wait(250)
  }
  const selectGroup = async (name) => {
    await groupMenu()
    await win.getByRole('menuitem', { name: new RegExp('^' + esc(name)) }).first().click({ timeout: 3000 })
    await wait(400)
  }
  const clearSelection = async () => {
    await groupMenu()
    await win.getByRole('menuitem', { name: await startsWith('fixtures.groupMenu.clearSelection') }).first().click({ timeout: 3000 })
    await wait(400)
  }
  // Programmer view mode. The header re-flows when the universe picker appears, so park the
  // pointer afterwards (otherwise another segment shows a hover highlight).
  const fxMode = async (m) => {
    await win.locator(`button:has([data-mode="${m}"])`).first().click({ timeout: 3000 })
    await win.mouse.move(900, 500)
    await wait(500)
  }
  const sidebarRow = async (name) => win.locator(`[role="listbox"][aria-label="${await T('shell.sidebar.listAria')}"] [role="option"]`)
    .filter({ has: win.locator('span.truncate', { hasText: new RegExp(`^${esc(name)}$`) }) }).first()
  /** Effects target group: clicking an exactly-selected group clears it, so only click when not selected */
  const fxTargetGroup = async (name) => {
    const row = win.locator(`[data-fx-target-group="${name}"]`)
    if ((await row.getAttribute('aria-selected', { timeout: 3000 })) !== 'true') await row.click({ timeout: 3000 })
    await wait(300)
  }
  const patchTab = async (key) => {
    await win.getByRole('tab', { name: await T(`patch.view.tabs.${key}`), exact: true }).first().click({ timeout: 3000 })
    await wait(400)
  }
  const button = async (key, params, opts = {}) => win.getByRole('button', { name: await T(key, params), exact: true, ...opts })
  const cancel = async () => { await (await button('ui.cancel')).last().click({ timeout: 3000 }) }
  const clearProgrammer = async () => {
    await win.locator(`button[aria-label="${await T('shell.clear.aria')}"]`).first().click({ timeout: 2000 }).catch(() => {})
    await wait(300)
  }
  const settingsSection = async (id) => {
    await win.locator(`nav[aria-label="${await T('settings.sectionsAria')}"] button`, { hasText: await T(`settings.sections.${id}.label`) }).first().click({ timeout: 3000 })
  }
  const fileMenu = async () => { await (await button('shell.fileMenu.trigger')).click({ timeout: 3000 }) }
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
  /** Type a command line in the status-bar input and run it */
  const cli = async (line, settle = 250) => {
    const input = win.locator('#pb-command-line')
    await input.click({ timeout: 3000 })
    await input.fill(line)
    await input.press('Enter')
    await wait(settle)
    // Store on an existing cue asks: answer Merge
    const merge = win.locator('[data-ask-choice="merge"]')
    if (await merge.count()) { await merge.first().click(); await wait(200) }
  }
  const sceneRow = (name) => win.locator('[data-scene-row]', { hasText: name }).first()

  await ready()
  console.log(`language ${LANG}${PRO ? ', Pro view' : ''}`)
  await setPrefs(PREFS)

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
      await tab('patch'); await patchTab('fixtures')
      const rows = win.locator('tr[data-row]')
      await rows.nth(0).click(); await rows.nth(3).click({ modifiers: ['Shift'] })
      await s('01-patch-fixtures')
    })
    await step('patch row menu', async () => {
      await win.locator('tr[data-row]').nth(2).locator(`button[aria-label^="${(await T('patch.shared.actionsFor', { name: '\u0001' })).split('\u0001')[0]}"]`).click({ timeout: 3000 })
      await s('02-patch-menu-ligne', 400); await escAll()
    })
    await step('patch address', async () => {
      await win.getByRole('toolbar', { name: await T('patch.table.selectionAria') }).getByRole('button', { name: await T('patch.table.address') }).click({ timeout: 3000 })
      await s('03-patch-dialogue-adresse', 400)
      await cancel()
    })
    await step('patch map', async () => { await patchTab('map'); await s('04-patch-carte-dmx') })
    await step('patch library', async () => {
      await patchTab('library')
      await win.locator('[data-source-tab="library"]').first().click({ timeout: 3000 }) // Library tab: catalog / library / online
      await win.getByRole('option').filter({ hasText: 'Moving Head Spot' }).first().click({ timeout: 3000 })
      await s('05-patch-bibliotheque')
    })
    await step('patch add dialog', async () => {
      await (await button('patch.shared.patchEllipsis')).first().click({ timeout: 3000 })
      await wait(400)
      const q = win.locator(`input[aria-label="${await T('patch.add.quantity')}"]`).first()
      await q.focus(); await q.fill('4'); await q.press('Enter')
      await s('06-patch-dialogue-ajout')
      await cancel()
    })
    await step('patch editor', async () => {
      await (await button('patch.library.editCopy')).first().click({ timeout: 3000 })
      await s('07-patch-editeur-fixture')
      await cancel()
      await wait(300)
      await (await button('patch.editor.discardAction')).click({ timeout: 1000 }).catch(() => {})
    })
    await step('patch back', async () => { await patchTab('fixtures') })

    // ---- Fixtures / programmer ----
    await step('fixtures no selection', async () => {
      await tab('fixtures')
      await clearSelection()
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
      await (await button('fixtures.colour.names.magenta')).first().click({ timeout: 3000 })
      await (await button('fixtures.intensity.full')).first().click({ timeout: 3000 }).catch(() => {})
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
      await win.getByRole('tab', { name: await startsWith('effects.categories.movement') }).first().click({ timeout: 3000 })
      await s('22-effets-categorie-mouvement')
    })

    // ---- Scenes ----
    await step('scenes', async () => { await tab('playback'); await s('30-scenes-liste') })
    await step('scene detail', async () => {
      await sceneRow('Intro').click({ timeout: 3000 })
      await wait(200)
      await win.getByRole('button', { name: 'GO', exact: true }).click()
      await wait(300)
      await win.getByRole('button', { name: 'GO', exact: true }).click()
      await s('31-scene-detail-cues', 1500)
    })
    await step('record popover', async () => {
      await win.locator('tr[data-reorder-index="1"] td').nth(1).click({ timeout: 3000 })
      await win.getByRole('button', { name: await startsWith('scenes.view.record') }).first().click({ timeout: 3000 })
      await s('32-scene-popover-enregistrer', 400)
      await win.keyboard.press('Escape')
    })
    await step('cue menu', async () => {
      await win.getByRole('button', { name: await T('scenes.cues.actionsAria', { number: '2' }) }).click({ timeout: 3000 })
      await s('33-scene-menu-cue', 300)
      await win.keyboard.press('Escape')
    })
    await step('scene effects', async () => {
      await sceneRow('Spot Beams').click({ timeout: 3000 })
      await win.locator('[role="tab"][data-scene-tab="effects"], [role="tab"]:has-text("' + (await T('common.effects')) + '")').first().click({ timeout: 3000 })
      await s('34-scene-onglet-effets')
      await win.locator('[role="tab"][data-scene-tab="cues"], [role="tab"]:has-text("' + (await T('common.cues')) + '")').first().click()
    })
    await step('chases', async () => {
      await win.getByRole('radio', { name: new RegExp(esc(await T('common.chases')), 'i') }).click({ timeout: 3000 })
      await wait(300)
      await win.getByRole('button', { name: await T('scenes.chase.play'), exact: true }).first().click({ timeout: 3000 })
      await s('35-chases-editeur', 1200)
      await win.getByRole('button', { name: await T('common.stop'), exact: true }).first().click({ timeout: 3000 })
      await win.getByRole('radio', { name: new RegExp(esc(await T('common.scenes')), 'i') }).click()
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
    await step('3d selected', async () => { await (await sidebarRow('Spot 2')).click({ timeout: 3000 }); await s('51-3d-fixture-selectionnee', 1200) })
    await step('3d top', async () => {
      await (await button('visualizer.camera.topHint')).click({ timeout: 3000 })
      await s('52-3d-vue-dessus', 1500)
      await (await button('visualizer.camera.perspectiveHint')).click()
    })
    await step('3d room', async () => {
      await win.getByRole('button', { name: await startsWith('visualizer.toolbar.room') }).first().click({ timeout: 3000 })
      await s('53-3d-popover-salle', 800)
      await win.keyboard.press('Escape')
    })

    // ---- Layout ----
    await step('layout', async () => {
      await tab('stage-layout', 1200)
      await (await sidebarRow('Wash 2')).click({ timeout: 3000 })
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
    const sections = [['outputs', '70-reglages-sorties'], ['remote', '71-reglages-acces-distant-qr'], ['display', '72-reglages-affichage'], ['show', '73-reglages-show'], ['about', '74-reglages-a-propos']]
    await step('settings', async () => { await tab('settings') })
    for (const [id, name] of sections) {
      await step(`settings ${id}`, async () => {
        await settingsSection(id)
        await s(name, id === 'remote' ? 1200 : 600)
      })
    }

    // ---- Shell ----
    await step('file menu', async () => {
      await tab('playback')
      await fileMenu()
      await s('80-menu-fichier', 300)
    })
    await step('open recent', async () => {
      await win.getByRole('menuitem', { name: await startsWith('shell.fileMenu.openRecent') }).click({ timeout: 3000 })
      await s('81-menu-ouvrir-recent', 600)
      await escAll()
    })
    await step('output health', async () => {
      await win.locator('footer button[aria-haspopup="dialog"]').first().click({ timeout: 3000 })
      await s('82-popover-sorties-dmx', 400)
      await win.keyboard.press('Escape')
    })
    await step('executor menu', async () => {
      await win.locator('[data-exec-cell][aria-label^="Verse,"]').first().click({ button: 'right', timeout: 3000 })
      await s('83-menu-executeur', 300)
      await win.keyboard.press('Escape')
    })
    await step('column popover', async () => {
      await win.locator(`button[title="${await T('shell.executors.columnHeaderTooltip')}"]`).first().click({ timeout: 3000 })
      await win.getByLabel(await T('shell.executors.columnTitle')).fill('Wash looks')
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
      await fileMenu()
      await win.getByRole('menuitem', { name: await startsWith('shell.fileMenu.newShow') }).click({ timeout: 3000 })
      await s('86-dialogue-modifications-non-enregistrees', 400)
      await cancel()
    })
    await step('blackout', async () => {
      await win.locator('main').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
      await win.keyboard.press('Escape')
      await s('87-blackout-actif', 500)
      await win.keyboard.press('Escape')
    })
    await step('stage window', async () => { await openStage(D, '88-fenetre-stage', 1600, 1000) })

    // ---------------------------------------------------- Pro screens
    if (PRO) {
      console.log('desktop — Pro screens')
      await step('pro switch', async () => {
        await tab('settings'); await settingsSection('display')
        await s('90-pro-reglage-programmation-pro')
      })
      await step('pro cli panel', async () => {
        await tab('playback')
        await win.locator('[data-cli-expand]').click({ timeout: 3000 })
        await wait(300)
        if (!(await win.locator('[data-cli-keypad]').count())) await win.locator('[data-cli-keypad-toggle]').click({ timeout: 3000 })
        await win.locator('#pb-command-line').fill('Fixture 1 Thru 4 At')
        await s('91-pro-cli-panneau-clavier', 500)
      })
      await step('pro cli content', async () => {
        // Show content for the next screens, built with the command line
        await win.locator('#pb-command-line').fill('')
        for (const line of [
          'Group 2 At 80', 'Store Preset 1.1 "Wash 80"', 'Clear', 'Clear',
          'Group 2 At 40', 'Store Preset 1.2 "Wash 40"', 'Clear', 'Clear',
          'Fixture 1 Thru 4 At 100', 'Store Group 9 "Front 4"', 'Clear', 'Clear',
          'Assign Sequence 2 At Executor 2.1', 'Assign Sequence 3 At Executor 2.5 /button=flash',
          'Group 2 At Preset 1.1 Fade 2', 'Store Cue 1 Sequence 99', 'Clear', 'Clear',
          'Fixture 1 Thru 4 At 0 Thru 100'
        ]) await cli(line)
        await s('92-pro-cli-journal', 500)
      })
      await step('pro cli cheatsheet', async () => {
        await win.locator('[data-cli-syntax-toggle]').click({ timeout: 3000 })
        await s('93-pro-cli-aide-memoire', 400)
        await win.locator('[data-cli-syntax-toggle]').click({ timeout: 3000 })
        await win.locator('[data-cli-expand]').click({ timeout: 3000 })
        await cli('Clear'); await cli('Clear')
      })

      // Pools
      await step('pro pools presets', async () => { await tab('pools'); await s('94-pro-pools-presets') })
      await step('pro pools groups', async () => {
        await win.locator('[data-pools-tab] [data-tab="groups"]').first().click({ timeout: 3000 })
        await win.locator('[data-pools-tab="groups"] [data-slot="2"]').first().click({ timeout: 3000 })
        await s('95-pro-pools-groupes-master')
      })
      await step('pro pools macros', async () => {
        await win.locator('[data-pools-tab] [data-tab="macros"]').first().click({ timeout: 3000 })
        await win.locator('[data-pools-tab="macros"] [data-slot="1"]').first().click({ timeout: 3000 })
        await wait(400)
        await (await button('pro.pools.macroEditor.addLine')).click({ timeout: 3000 })
        await (await button('pro.pools.macroEditor.addLine')).click({ timeout: 3000 })
        await win.getByRole('textbox', { name: await T('pro.pools.macroEditor.command', { n: 1 }) }).fill('Group 2 At Preset 1.1 Fade 1')
        await win.getByRole('textbox', { name: await T('pro.pools.macroEditor.command', { n: 2 }) }).fill('Go Executor 2.1')
        await s('96-pro-pools-editeur-macro', 400)
        await (await button('common.save')).click({ timeout: 3000 })
        await s('97-pro-pools-macros', 400)
      })
      await step('pro pools speed', async () => {
        await win.locator('[data-pools-tab] [data-tab="speed"]').first().click({ timeout: 3000 })
        await win.locator('[data-pools-tab="speed"] [data-slot="1"]').first().click({ timeout: 3000 })
        await s('98-pro-pools-speed-masters')
      })

      // Programmer tools
      await step('pro programmer tools', async () => {
        await tab('fixtures'); await fxMode('attributes'); await selectGroup('Spots')
        await win.click('#tab-colour').catch(() => {})
        await s('100-pro-programmer-outils-presets')
      })
      await step('pro matricks', async () => {
        await win.locator('[data-tool="matricks"]').click({ timeout: 3000 })
        await s('101-pro-matricks', 400)
        await win.keyboard.press('Escape')
        await clearProgrammer()
      })

      // Scenes
      await step('pro cue columns', async () => {
        await tab('playback')
        await sceneRow('Intro').click({ timeout: 3000 })
        await win.locator('[data-cue-columns-menu]').click({ timeout: 3000 })
        await s('102-pro-colonnes-cues-menu', 300)
        for (const key of ['featureTiming', 'parts', 'trigger', 'presets']) {
          const item = win.getByRole('menuitemcheckbox', { name: await startsWith(`pro.scenes.columns.${key}`) }).first()
          if (await item.count()) {
            if ((await item.getAttribute('aria-checked')) !== 'true') await item.click({ timeout: 2000 })
            if (!(await win.locator('[role="menu"]').count())) await win.locator('[data-cue-columns-menu]').click({ timeout: 3000 })
          }
        }
        await escAll()
        await win.locator('[data-cue-timing-toggle]').click({ timeout: 3000 })
        await win.locator('tr[data-reorder-index="1"] td').nth(1).click({ timeout: 3000 })
        await s('103-pro-cues-colonnes-temps', 500)
      })
      await step('pro scene advanced', async () => {
        await win.locator('[data-scene-tab="settings"]').first().click({ timeout: 3000 })
        await wait(300)
        const adv = win.getByRole('button', { name: await startsWith('pro.scenes.advanced.title') }).first()
        if (!(await win.locator('[data-scene-advanced]').count())) await adv.click({ timeout: 3000 })
        await win.locator('[data-scene-advanced]').scrollIntoViewIfNeeded().catch(() => {})
        await s('104-pro-scene-avance', 400)
        await win.locator('[data-scene-tab="cues"]').first().click({ timeout: 3000 })
      })
      await step('pro record popover', async () => {
        await win.locator('tr[data-reorder-index="1"] td').nth(1).click({ timeout: 3000 })
        await selectGroupFromBar('Spots').catch(() => {})
        await win.getByRole('button', { name: await startsWith('scenes.view.record') }).first().click({ timeout: 3000 })
        await wait(300)
        const update = win.locator('[role="dialog"] [role="radio"]').nth(2)
        await update.click({ timeout: 2000 }).catch(() => {})
        await s('105-pro-popover-memoriser-modes', 400)
        await win.keyboard.press('Escape')
      })

      // Executor pages
      await step('pro executor faders', async () => {
        await win.getByRole('button', { name: await T('pro.stage.faders.show') }).first().click({ timeout: 3000 }).catch(() => {})
        await s('106-pro-executeurs-pages-faders', 500)
      })
      await step('pro executor page 2', async () => {
        await win.locator(`[aria-label="${await T('pro.stage.pages.aria')}"] button`).last().click({ timeout: 3000 })
        await s('107-pro-executeurs-page-2', 500)
      })
      await step('pro cell menu', async () => {
        await win.locator('[data-exec-cell]').filter({ has: win.locator('*') }).nth(4).click({ button: 'right', timeout: 3000 })
        await s('108-pro-menu-cellule', 400)
        await escAll()
        await win.locator(`[aria-label="${await T('pro.stage.pages.aria')}"] button`).first().click({ timeout: 3000 }).catch(() => {})
      })

      // Stage pages
      await step('pro stage pages', async () => {
        await tab('stage', 1000)
        await s('109-pro-pages-stage-vide', 400)
        const add = win.getByRole('button', { name: await T('pro.stage.designer.newPage') }).first()
        await add.click({ timeout: 3000 })
        await wait(300)
        const firstItem = win.locator('[role="menu"] [role="menuitem"]').first()
        if (await firstItem.count()) await firstItem.click({ timeout: 2000 })
        await s('110-pro-pages-stage-designer', 800)
      })

      // MIDI controller (fake APC mini mk2)
      await step('pro midi controller', async () => {
        await app.context().addInitScript(FAKE_MIDI)
        await win.reload(); await ready()
        await tab('midi', 1200)
        await s('111-pro-midi-controleur', 600)
        await win.evaluate(() => window.__fakeMidiEmit?.([0xb0, 48, 10]))
      })
      await step('pro midi map', async () => {
        await win.getByRole('button', { name: await T('pro.midi.controllers.map'), exact: true }).first().click({ timeout: 3000 })
        await s('112-pro-midi-carte-controleur', 600)
        await escAll()
      })
      await step('pro midi ghost', async () => {
        await tab('playback')
        await win.evaluate(() => window.__fakeMidiEmit?.([0xb0, 48, 12]))
        await s('113-pro-executeurs-fantome-midi', 600)
      })
    }

    async function selectGroupFromBar(name) {
      await selectGroup(name)
    }
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
    await step('pi patch', async () => { await tab('patch'); await patchTab('fixtures'); await s('01-patch') })
    await step('pi fixtures', async () => {
      await tab('fixtures'); await fxMode('attributes'); await selectGroup('Spots')
      await win.click('#tab-position'); await s('02-fixtures-spots')
    })
    await step('pi fixtures colour', async () => {
      await selectGroup('Washes'); await win.click('#tab-colour')
      await (await button('fixtures.colour.names.magenta')).first().click({ timeout: 3000 })
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
      await sceneRow('Intro').click({ timeout: 3000 })
      await s('05-scenes')
    })
    await step('pi timeline', async () => { await tab('live'); await win.locator('[data-clip]').nth(2).click({ timeout: 3000 }); await s('06-timeline') })
    await step('pi 3d', async () => { await tab('visualizer', 3500); await s('07-3d') })
    await step('pi layout', async () => { await tab('stage-layout', 1200); await s('08-plan') })
    await step('pi midi', async () => { await tab('midi'); await s('09-midi') })
    await step('pi follow', async () => { await tab('follow'); await s('10-follow') })
    await step('pi settings', async () => {
      await tab('settings')
      await settingsSection('remote')
      await s('11-reglages-acces-distant', 1200)
    })
    await step('pi add dialog', async () => {
      await tab('patch'); await patchTab('library')
      await win.locator('[data-source-tab="library"]').first().click({ timeout: 3000 }) // Library tab: catalog / library / online
      await win.getByRole('option').filter({ hasText: 'Moving Head Spot' }).first().click({ timeout: 3000 })
      await (await button('patch.shared.patchEllipsis')).first().click({ timeout: 3000 })
      await s('12-dialogue-ajout-fixtures', 500)
      await cancel()
      await patchTab('fixtures')
    })
    await step('pi file menu', async () => {
      await tab('playback')
      await fileMenu()
      await s('13-menu-fichier', 300)
      await escAll()
    })
    await step('pi exec menu', async () => {
      await win.locator('[data-exec-cell][aria-label^="Verse,"]').first().click({ button: 'right', timeout: 3000 })
      await s('14-menu-executeur', 300)
      await win.keyboard.press('Escape')
    })
    await step('pi stage window', async () => { await openStage(P, '15-fenetre-stage', 1920, 1080) })
    if (PRO) {
      await step('pi pro cli keypad', async () => {
        await win.locator('[data-cli-expand]').click({ timeout: 3000 })
        await win.locator('#pb-command-line').fill('Group 2 At')
        await s('20-pro-cli-clavier-tactile', 500)
        await win.locator('#pb-command-line').fill('')
        await win.locator('[data-cli-expand]').click({ timeout: 3000 })
      })
      await step('pi pro pools', async () => { await tab('pools'); await s('21-pro-pools') })
      await step('pi pro programmer', async () => {
        await tab('fixtures'); await fxMode('attributes'); await selectGroup('Spots')
        await s('22-pro-programmer-outils')
        await clearProgrammer()
      })
      await step('pi pro stage pages', async () => { await tab('stage', 1000); await s('23-pro-pages-stage') })
    }
    await step('pi density reset', async () => { await setDensity('auto'); await startScenes() })
  }

  // ========================================================== remote
  if (want('remote')) {
    const R = 'remote'
    console.log('remote')
    await win.evaluate((pin) => window.photonboard.remote.setSettings({ pinEnabled: true, pin }), REMOTE_PIN)
    const browser = await chromium.launch()
    const withPrefs = async (ctx) => {
      await ctx.addInitScript((p) => { try { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v) } catch { /* ignore */ } }, PREFS)
      return ctx
    }
    try {
      const tablet = await withPrefs(await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, deviceScaleFactor: 1 }))
      const tp = await tablet.newPage()
      tp.on('pageerror', (e) => console.error('[remote error]', e.message))
      await step('tablet pin', async () => {
        await tp.goto(REMOTE_URL)
        await tp.waitForFunction(() => !!window.__pbI18n, null, { timeout: 15000 })
        const pinInput = tp.getByRole('textbox', { name: await T('remote.pin', {}, tp) })
        await pinInput.waitFor({ timeout: 15000 })
        await shot(tp, R, 'tablette-0-code-pin', 400)
        await pinInput.fill(REMOTE_PIN)
        await tp.getByRole('button', { name: await T('remote.connect', {}, tp) }).click()
        await pinInput.waitFor({ state: 'detached', timeout: 15000 })
        await tp.waitForTimeout(2000)
      }, tp)
      await step('tablet stage', async () => {
        const full = tp.getByRole('button', { name: await T('stage.fullConsole', {}, tp) }).first()
        // The top bar's Stage button (Pro: the nav rail has a "Stage" pages tab too)
        if (!(await full.count())) { await tp.locator('header').getByRole('button', { name: await T('shell.stage.label', {}, tp), exact: true }).first().click({ timeout: 3000 }) }
        await tp.waitForTimeout(800)
        await dismissToasts(tp)
        await shot(tp, R, 'tablette-1-vue-scene', 1200)
      }, tp)
      await step('tablet console scenes', async () => {
        // Two identical buttons overlap here (App.tsx fixed one + RemoteStageView header); either switches
        await tp.getByRole('button', { name: await T('stage.fullConsole', {}, tp) }).last().click({ timeout: 3000 })
        await tp.waitForTimeout(800)
        await tp.locator('[data-tab="playback"]').first().click()
        await tp.locator('[data-scene-row]', { hasText: 'Spot Beams' }).first().click({ timeout: 3000 }).catch(() => {})
        await dismissToasts(tp)
        await shot(tp, R, 'tablette-2-console-scenes', 1000)
      }, tp)
      await step('tablet console fixtures', async () => {
        await tp.locator('[data-tab="fixtures"]').first().click()
        await tp.waitForTimeout(500)
        await tp.locator(`button[aria-label="${await T('fixtures.groupMenu.aria', {}, tp)}"]`).first().click({ timeout: 3000 })
        await tp.getByRole('menuitem', { name: /^Spots/ }).first().click({ timeout: 3000 })
        await tp.click('#tab-colour').catch(() => {})
        await dismissToasts(tp)
        await shot(tp, R, 'tablette-3-console-fixtures', 1000)
      }, tp)
      if (PRO) {
        await step('tablet pro cli', async () => {
          await tp.locator('[data-cli-expand]').click({ timeout: 3000 })
          await tp.locator('#pb-command-line').fill('Group 2 At 50')
          await tp.locator('#pb-command-line').press('Enter')
          await dismissToasts(tp)
          await shot(tp, R, 'tablette-4-pro-cli', 1200)
          await tp.locator('[data-cli-expand]').click({ timeout: 3000 }).catch(() => {})
          await tp.locator('#pb-command-line').fill('Clear')
          await tp.locator('#pb-command-line').press('Enter')
          await tp.locator('#pb-command-line').fill('Clear')
          await tp.locator('#pb-command-line').press('Enter')
        }, tp)
        await step('tablet pro pools', async () => {
          await tp.locator('[data-tab="pools"]').first().click()
          await dismissToasts(tp)
          await shot(tp, R, 'tablette-5-pro-pools', 1000)
        }, tp)
      }

      const phone = await withPrefs(await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }))
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
        // Column pair 3–4 (Movers / Song), start Ballad and Verse from the phone
        await pp.getByRole('tab', { name: await T('stage.columnPairAria', { a: 3, b: 4 }, pp) }).click({ timeout: 3000 })
        await pp.waitForTimeout(400)
        const suffix = await stoppedSuffix('stage.cellStopped', pp)
        for (const n of ['Ballad', 'Verse']) {
          const cell = pp.locator(`[data-stage-cell][aria-label^="${n},"]`).first()
          if (((await cell.getAttribute('aria-label', { timeout: 3000 })) ?? '').endsWith(suffix)) await cell.click({ timeout: 3000 })
        }
        await dismissToasts(pp)
        await shot(pp, R, 'telephone-2-scenes-actives', 1500)
      }, pp)
      await step('phone levels', async () => {
        await pp.getByRole('tab', { name: await T('stage.columnPairAria', { a: 1, b: 2 }, pp) }).click({ timeout: 3000 }).catch(() => {})
        await pp.getByRole('radio', { name: await T('stage.gridModes.levels', {}, pp) }).click({ timeout: 3000 })
        await dismissToasts(pp)
        await shot(pp, R, 'telephone-3-niveaux', 1000)
        await pp.getByRole('radio', { name: await T('stage.gridModes.play', {}, pp) }).click({ timeout: 3000 })
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
