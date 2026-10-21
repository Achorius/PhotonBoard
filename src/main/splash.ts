// ============================================================
// PhotonBoard — start-up splash screen
//
// A small frameless window shown the moment the app is ready, while the
// console window loads hidden (show: false). When the console is ready
// to show — never before SPLASH_MIN_MS, never after SPLASH_MAX_MS — the
// console appears and the splash fades out.
//   macOS / Windows: a transparent window holding a rounded card; the
//     console is shown first and the card fades out over it.
//   Linux (Pi kiosk, the console is fullscreen): an opaque window that
//     covers the display in the console's background colour (no
//     compositor: no transparency); the card fades out, then the
//     console replaces it.
// Self-contained page (data: URL, inline SVG, system fonts): no file to
// package, no network. PB_NO_SPLASH=1 turns it off (test harnesses).
// ============================================================

import { BrowserWindow } from 'electron'

export const SPLASH_MIN_MS = 1200
export const SPLASH_MAX_MS = 4000
const FADE_MS = 320

/** Same colour as the console window background (src/main/index.ts createWindow) */
export const CONSOLE_BACKGROUND = '#0a0a0f'

const TAGLINES = {
  en: 'DMX lighting console',
  fr: 'Console d’éclairage DMX'
} as const

export type SplashLanguage = keyof typeof TAGLINES

export function splashDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PB_NO_SPLASH === '1' || env.PB_NO_SPLASH === 'true'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** The brand mark of build/icon.svg (beam + lamp), without its tile */
const LOGO_SVG = `<svg class="logo" viewBox="0 0 24 24" width="76" height="76" aria-hidden="true">
  <defs>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff7a1a" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb070" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path class="beam" d="M9.5 7.5 L3 22 H21 L14.5 7.5 Z" fill="url(#beam)"/>
  <circle class="halo" cx="12" cy="5.5" r="6" fill="url(#glow)"/>
  <circle cx="12" cy="5.5" r="3.5" fill="#ff7a1a"/>
</svg>`

export interface SplashPageOptions {
  version: string
  language: SplashLanguage
  /** Opaque full-display page (Linux) instead of a floating card */
  cover: boolean
}

/** The splash page (exported for tests) */
export function splashHtml(o: SplashPageOptions): string {
  const tagline = TAGLINES[o.language] ?? TAGLINES.en
  return `<!doctype html>
<html lang="${o.language}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>PhotonBoard</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; overflow: hidden; background: ${o.cover ? CONSOLE_BACKGROUND : 'transparent'}; cursor: default; user-select: none; -webkit-user-select: none; }
  body { display: flex; align-items: center; justify-content: center; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "DejaVu Sans", Arial, sans-serif; color: #eceef1; -webkit-font-smoothing: antialiased; }
  .card { position: relative; width: 420px; height: 268px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    border-radius: ${o.cover ? 18 : 16}px; background: linear-gradient(180deg, #202328 0%, #121417 100%);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.07)${o.cover ? '' : ', 0 24px 64px rgba(0,0,0,0.55)'};
    overflow: hidden; opacity: 0; transform: scale(0.985); animation: in 380ms cubic-bezier(.2,.7,.2,1) 40ms forwards; }
  .card::before { content: ""; position: absolute; inset: -40% -20% auto; height: 70%; background: radial-gradient(closest-side, rgba(255,122,26,0.16), rgba(255,122,26,0)); pointer-events: none; }
  .logo { margin-bottom: 6px; filter: drop-shadow(0 6px 18px rgba(255,122,26,0.25)); }
  .halo { animation: halo 1.8s ease-in-out infinite; transform-origin: 12px 5.5px; }
  .name { font-size: 26px; font-weight: 650; letter-spacing: 0.01em; }
  .tagline { font-size: 13px; color: #aab1ba; letter-spacing: 0.02em; }
  .version { position: absolute; right: 14px; bottom: 12px; font: 500 11px ui-monospace, "SF Mono", "JetBrains Mono", "DejaVu Sans Mono", monospace; color: #858c96; }
  .bar { position: relative; width: 148px; height: 2px; margin-top: 18px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
  .bar::after { content: ""; position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 2px; background: linear-gradient(90deg, rgba(255,122,26,0), #ff7a1a, rgba(255,122,26,0)); animation: run 1.1s ease-in-out infinite; }
  body.out .card { animation: out ${FADE_MS}ms ease-in forwards; }
  @keyframes in { to { opacity: 1; transform: none; } }
  @keyframes out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(1.01); } }
  @keyframes run { from { left: -40%; } to { left: 100%; } }
  @keyframes halo { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .card, body.out .card { animation-duration: 1ms; } .halo, .bar::after { animation: none; } }
</style></head>
<body><div class="card" role="status" aria-label="PhotonBoard">
  ${LOGO_SVG}
  <div class="name">PhotonBoard</div>
  <div class="tagline">${escapeHtml(tagline)}</div>
  <div class="bar"></div>
  <div class="version">v${escapeHtml(o.version)}</div>
</div></body></html>`
}

export interface Splash {
  /**
   * The console is ready: wait for the minimum display time, call `show`
   * (shows the console window), fade out and close. Runs once.
   */
  finish(show: () => void): void
  /** Close at once (quit, errors) */
  destroy(): void
}

export interface SplashOptions extends Omit<SplashPageOptions, 'cover'> {
  /** Bounds of the display the console opens on */
  display: Electron.Rectangle
  /** Linux: opaque window covering the display (kiosk) */
  cover: boolean
}

export function openSplash(o: SplashOptions): Splash {
  const started = Date.now()
  const width = 460
  const height = 308
  const bounds = o.cover
    ? o.display
    : { x: Math.round(o.display.x + (o.display.width - width) / 2), y: Math.round(o.display.y + (o.display.height - height) / 2), width, height }
  let win: BrowserWindow | null = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: !o.cover,
    backgroundColor: o.cover ? CONSOLE_BACKGROUND : '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    title: 'PhotonBoard',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false }
  })
  win.setMenu(null)
  win.once('ready-to-show', () => { win?.showInactive() })
  win.on('closed', () => { win = null })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(o))}`).catch(() => { /* closed before it loaded */ })

  let finishing = false
  const destroy = () => {
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  }

  return {
    finish(show) {
      if (finishing) return
      finishing = true
      const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - started))
      setTimeout(() => {
        const fade = (): Promise<void> => {
          if (!win || win.isDestroyed() || !win.isVisible()) return Promise.resolve()
          return win.webContents.executeJavaScript('document.body.classList.add("out")', true)
            .then(() => new Promise<void>((r) => setTimeout(r, FADE_MS)), () => undefined)
        }
        if (o.cover) {
          // No transparency: the card fades into the console's background, then the console takes its place
          void fade().then(() => {
            try { show() } finally { setTimeout(destroy, 60) }
          })
        } else {
          try { show() } finally { void fade().then(destroy) }
        }
      }, wait)
    },
    destroy
  }
}
