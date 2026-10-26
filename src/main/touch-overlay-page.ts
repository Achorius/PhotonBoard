// ============================================================
// PhotonBoard — touchscreen setup overlays (one page, three modes)
//
// Fullscreen windows main opens on the outputs during the touch wizards
// (touch-wizards.ts). The page is a dumb renderer: main sends it a "view"
// (texts already localised) through the touch-overlay preload, and it
// reports what the operator does:
//   { type: 'ready' }
//   { type: 'tap', x, y, region: 'content' | 'chrome', pointerType }   x, y in [0,1] of the window
//   { type: 'button', id }                                              skip / cancel / save / retry / done
// Modes:
//   identify   huge screen number, "Touch THIS screen" (or, dimmed, which
//              screen to touch now), Skip / Cancel bar at the SAME place
//              on every overlay (so it works whatever the current mapping)
//   calibrate  one crosshair target at a time, result card
//   test       a dot + ripple wherever a touch lands, the output's name
// Self-contained (data: URL, system fonts), design tokens of the console
// (dark surfaces, orange accent) like the splash screen.
// ============================================================

export interface OverlayButton {
  id: string
  label: string
  primary?: boolean
}

export interface IdentifyView {
  mode: 'identify'
  active: boolean
  big: string
  title: string
  subtitle: string
  hint: string
  progress: string
  status: 'ok' | 'none' | null
  statusText: string
  countdownMs: number
  countdownLabel: string
  bar: OverlayButton[]
}

export interface CalibrateView {
  mode: 'calibrate'
  /** Target position in [0,1] of the window, null = none */
  target: { x: number; y: number; check?: boolean } | null
  title: string
  subtitle: string
  progress: string
  /** Result / failure card */
  card: { tone: 'ok' | 'warn' | 'error'; title: string; text: string; buttons: OverlayButton[] } | null
  notice: string
  top: OverlayButton[]
  /** Passive overlay on the other screens (blocks the console during calibration) */
  passive?: boolean
}

export interface TestView {
  mode: 'test'
  big: string
  label: string
  hint: string
  countdownMs: number
  countdownLabel: string
  top: OverlayButton[]
}

export type OverlayView = IdentifyView | CalibrateView | TestView

export function touchOverlayHtml(lang: 'fr' | 'en'): string {
  return `<!doctype html>
<html lang="${lang === 'fr' ? 'fr' : 'en'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>PhotonBoard</title>
<style>
  :root { --bg: #0a0a0f; --s1: #15171b; --s2: #1d2025; --s3: #262a30; --line: rgba(255,255,255,0.09); --fg: #eceef1; --fg2: #aab1ba; --fg3: #6f7680;
    --accent: #ff7a1a; --accent2: #ffb070; --ok: #35c47a; --warn: #f2b33d; --err: #ff5a5a; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--fg); cursor: default; user-select: none; -webkit-user-select: none; touch-action: none; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "DejaVu Sans", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  #root { position: absolute; inset: 0; }
  button { font: inherit; color: inherit; border: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .btn { min-height: 72px; padding: 0 32px; border-radius: 14px; background: var(--s3); color: var(--fg); font-size: 24px; font-weight: 600; box-shadow: inset 0 0 0 1px var(--line); }
  .btn:active { filter: brightness(1.25); }
  .btn.primary { background: var(--accent); color: #1a0d02; box-shadow: none; }

  /* identify */
  .id { position: absolute; inset: 0 0 16vh 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.6vh; text-align: center; padding: 0 6vw; }
  .id .big { font-size: 46vh; line-height: 0.9; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .id.active .big { color: var(--accent); text-shadow: 0 0 80px rgba(255,122,26,0.45); animation: beat 1.4s ease-in-out infinite; }
  .id.dim .big { font-size: 30vh; color: #2c3037; }
  .id .title { font-size: 6.4vh; font-weight: 700; }
  .id.dim .title { font-size: 4vh; font-weight: 600; color: var(--fg2); max-width: 70vw; }
  .id .subtitle { font-size: 3vh; color: var(--fg2); }
  .id .hint { font-size: 2.4vh; color: var(--fg3); max-width: 64vw; }
  .frame { position: absolute; inset: 0; pointer-events: none; }
  .active-frame { box-shadow: inset 0 0 0 10px var(--accent); animation: frame 1.4s ease-in-out infinite; }
  .glow { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(60% 55% at 50% 42%, rgba(255,122,26,0.14), rgba(255,122,26,0)); }
  .chip { position: absolute; top: 3vh; left: 3vw; padding: 10px 18px; border-radius: 999px; background: var(--s2); color: var(--fg2); font-size: 2.2vh; box-shadow: inset 0 0 0 1px var(--line); }
  .count { position: absolute; top: 3vh; right: 3vw; font-size: 2.2vh; color: var(--fg3); font-variant-numeric: tabular-nums; }
  .timebar { position: absolute; top: 0; left: 0; height: 6px; background: var(--accent); transform-origin: left; }
  .status { margin-top: 1vh; padding: 12px 22px; border-radius: 12px; font-size: 3vh; font-weight: 650; }
  .status.ok { background: rgba(53,196,122,0.14); color: var(--ok); box-shadow: inset 0 0 0 1px rgba(53,196,122,0.4); }
  .status.none { background: var(--s2); color: var(--fg2); box-shadow: inset 0 0 0 1px var(--line); }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 16vh; min-height: 96px; display: flex; gap: 2vw; padding: 2.4vh 3vw; background: var(--s1); box-shadow: 0 -1px 0 var(--line); }
  .bar .btn { flex: 1; height: 100%; font-size: 3vh; }

  /* calibrate */
  .target { position: absolute; width: 0; height: 0; }
  .target .ring { position: absolute; left: -56px; top: -56px; width: 112px; height: 112px; border-radius: 50%; border: 3px solid var(--accent); animation: pulse 1.3s ease-out infinite; }
  .target .disc { position: absolute; left: -38px; top: -38px; width: 76px; height: 76px; border-radius: 50%; background: rgba(255,122,26,0.16); border: 3px solid var(--accent); }
  .target .h, .target .v { position: absolute; background: var(--fg); }
  .target .h { left: -70px; top: -1.5px; width: 140px; height: 3px; }
  .target .v { left: -1.5px; top: -70px; width: 3px; height: 140px; }
  .target .dot { position: absolute; left: -5px; top: -5px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--bg); }
  .target.check .ring, .target.check .disc { border-color: var(--ok); }
  .target.check .disc { background: rgba(53,196,122,0.16); }
  .cal-text { position: absolute; left: 0; right: 0; top: 28vh; text-align: center; padding: 0 20vw; display: flex; flex-direction: column; gap: 1.2vh; pointer-events: none; }
  .cal-text .title { font-size: 4.6vh; font-weight: 700; }
  .cal-text .subtitle { font-size: 2.4vh; color: var(--fg2); }
  .cal-text .progress { font-size: 2.2vh; color: var(--accent2); font-weight: 600; letter-spacing: 0.04em; }
  .notice { position: absolute; left: 50%; bottom: 22vh; transform: translateX(-50%); max-width: 60vw; padding: 14px 22px; border-radius: 12px; background: rgba(242,179,61,0.12); color: var(--warn); box-shadow: inset 0 0 0 1px rgba(242,179,61,0.45); font-size: 2.4vh; text-align: center; pointer-events: none; }
  .top { position: absolute; top: 2.4vh; left: 50%; transform: translateX(-50%); display: flex; gap: 16px; }
  .card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(760px, 80vw); padding: 36px 40px; border-radius: 20px; background: linear-gradient(180deg, #202328 0%, #15171b 100%); box-shadow: 0 0 0 1px var(--line), 0 30px 80px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 14px; }
  .card h1 { font-size: 34px; font-weight: 700; }
  .card p { font-size: 22px; color: var(--fg2); line-height: 1.4; }
  .card.ok h1 { color: var(--ok); } .card.warn h1 { color: var(--warn); } .card.error h1 { color: var(--err); }
  .card .actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px; }
  .card .actions .btn { flex: 1; min-width: 180px; }
  .passive { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2vh; text-align: center; color: var(--fg2); }
  .passive .title { font-size: 4vh; font-weight: 600; }
  .passive .subtitle { font-size: 2.6vh; color: var(--fg3); }

  /* test */
  .test-big { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 60vh; font-weight: 800; color: #15181d; pointer-events: none; }
  .test-label { position: absolute; top: 3vh; left: 3vw; font-size: 4.2vh; font-weight: 700; pointer-events: none; }
  .test-hint { position: absolute; left: 0; right: 0; bottom: 4vh; text-align: center; font-size: 2.6vh; color: var(--fg2); padding: 0 14vw; pointer-events: none; }
  .test-count { position: absolute; top: 3.4vh; right: 3vw; font-size: 2.6vh; color: var(--fg3); font-variant-numeric: tabular-nums; pointer-events: none; }
  .touch-dot { position: absolute; width: 0; height: 0; pointer-events: none; }
  .touch-dot::before { content: ""; position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 22px rgba(255,122,26,0.8); }
  .touch-dot::after { content: ""; position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%; border: 3px solid var(--accent2); animation: ripple 900ms ease-out forwards; }
  .touch-dot.old::before { opacity: 0.35; box-shadow: none; transition: opacity 600ms; }
  .trail { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: rgba(255,122,26,0.5); pointer-events: none; }

  @keyframes beat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
  @keyframes frame { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  @keyframes pulse { from { transform: scale(0.7); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
  @keyframes ripple { from { transform: scale(1); opacity: 1; } to { transform: scale(5); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; } }
</style></head>
<body><div id="root"></div>
<script>
(function () {
  var root = document.getElementById('root');
  var view = null;
  var countdownEnd = 0;
  var tick = null;
  var api = window.pbTouch;
  function send(msg) { try { api && api.send(msg); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(b) {
    var e = el('button', 'btn' + (b.primary ? ' primary' : ''), b.label);
    e.setAttribute('data-button', b.id);
    e.addEventListener('click', function () { send({ type: 'button', id: b.id }); });
    return e;
  }
  function seconds() { return Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000)); }
  function startCountdown(ms, update) {
    if (tick) { clearInterval(tick); tick = null; }
    if (!ms) return;
    countdownEnd = Date.now() + ms;
    update();
    tick = setInterval(update, 250);
  }

  function renderIdentify(v) {
    var wrap = el('div', 'id ' + (v.active ? 'active' : 'dim'));
    wrap.appendChild(el('div', 'big', v.big));
    wrap.appendChild(el('div', 'title', v.title));
    if (v.subtitle) wrap.appendChild(el('div', 'subtitle', v.subtitle));
    if (v.hint) wrap.appendChild(el('div', 'hint', v.hint));
    if (v.status) wrap.appendChild(el('div', 'status ' + v.status, v.statusText));
    if (v.active) { root.appendChild(el('div', 'glow')); root.appendChild(el('div', 'frame active-frame')); }
    root.appendChild(wrap);
    root.appendChild(el('div', 'chip', v.progress));
    var count = el('div', 'count');
    root.appendChild(count);
    var bar = el('div', 'timebar');
    if (v.active) root.appendChild(bar);
    var chrome = el('div', 'bar');
    chrome.setAttribute('data-chrome', '');
    v.bar.forEach(function (b) { chrome.appendChild(btn(b)); });
    root.appendChild(chrome);
    var total = v.countdownMs;
    startCountdown(v.countdownMs, function () {
      var s = seconds();
      count.textContent = v.countdownLabel.replace('{s}', String(s));
      bar.style.transform = 'scaleX(' + Math.max(0, (countdownEnd - Date.now()) / total) + ')';
      bar.style.width = '100%';
    });
  }

  function renderCalibrate(v) {
    if (v.passive) {
      var p = el('div', 'passive');
      p.appendChild(el('div', 'title', v.title));
      if (v.subtitle) p.appendChild(el('div', 'subtitle', v.subtitle));
      root.appendChild(p);
      return;
    }
    if (v.target) {
      var t = el('div', 'target' + (v.target.check ? ' check' : ''));
      t.style.left = (v.target.x * 100) + 'vw';
      t.style.top = (v.target.y * 100) + 'vh';
      ['ring', 'disc', 'h', 'v', 'dot'].forEach(function (c) { t.appendChild(el('div', c)); });
      t.setAttribute('data-target', v.target.check ? 'check' : 'corner');
      root.appendChild(t);
    }
    if (!v.card) {
      var text = el('div', 'cal-text');
      if (v.progress) text.appendChild(el('div', 'progress', v.progress));
      text.appendChild(el('div', 'title', v.title));
      if (v.subtitle) text.appendChild(el('div', 'subtitle', v.subtitle));
      root.appendChild(text);
    } else {
      var card = el('div', 'card ' + v.card.tone);
      card.setAttribute('data-chrome', '');
      card.setAttribute('data-card', v.card.tone);
      card.appendChild(el('h1', null, v.card.title));
      card.appendChild(el('p', null, v.card.text));
      var actions = el('div', 'actions');
      v.card.buttons.forEach(function (b) { actions.appendChild(btn(b)); });
      card.appendChild(actions);
      root.appendChild(card);
    }
    if (v.notice) root.appendChild(el('div', 'notice', v.notice));
    if (v.top && v.top.length) {
      var top = el('div', 'top');
      top.setAttribute('data-chrome', '');
      v.top.forEach(function (b) { top.appendChild(btn(b)); });
      root.appendChild(top);
    }
  }

  function renderTest(v) {
    root.appendChild(el('div', 'test-big', v.big));
    root.appendChild(el('div', 'test-label', v.label));
    root.appendChild(el('div', 'test-hint', v.hint));
    var count = el('div', 'test-count');
    root.appendChild(count);
    var top = el('div', 'top');
    top.setAttribute('data-chrome', '');
    v.top.forEach(function (b) { top.appendChild(btn(b)); });
    root.appendChild(top);
    startCountdown(v.countdownMs, function () { count.textContent = v.countdownLabel.replace('{s}', String(seconds())); });
  }

  function render(v) {
    view = v;
    root.textContent = '';
    document.body.setAttribute('data-mode', v.mode);
    if (v.mode === 'identify') renderIdentify(v);
    else if (v.mode === 'calibrate') renderCalibrate(v);
    else if (v.mode === 'test') renderTest(v);
  }

  function inChrome(target) {
    for (var n = target; n && n !== document.body; n = n.parentNode) {
      if (n.nodeType === 1 && (n.hasAttribute('data-chrome') || n.hasAttribute('data-button'))) return true;
    }
    return false;
  }

  var dots = [];
  function drawDot(x, y) {
    var d = el('div', 'touch-dot');
    d.style.left = x + 'px'; d.style.top = y + 'px';
    root.appendChild(d);
    dots.push(d);
    if (dots.length > 1) dots[dots.length - 2].classList.add('old');
    while (dots.length > 30) { var old = dots.shift(); old.remove(); }
  }

  window.addEventListener('pointerdown', function (e) {
    if (!view) return;
    var chrome = inChrome(e.target);
    send({ type: 'tap', x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, region: chrome ? 'chrome' : 'content', pointerType: e.pointerType || '' });
    if (view.mode === 'test' && !chrome) drawDot(e.clientX, e.clientY);
  }, true);
  window.addEventListener('pointermove', function (e) {
    if (!view || view.mode !== 'test' || !e.buttons || inChrome(e.target)) return;
    var t = el('div', 'trail');
    t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, 700);
  }, true);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') send({ type: 'button', id: view && view.mode === 'test' ? 'done' : 'cancel' });
  });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  if (api) api.onState(render);
  send({ type: 'ready' });
})();
</script></body></html>`
}
