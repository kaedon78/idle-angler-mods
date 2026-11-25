// ==UserScript==
// @name         Idle Angler Auto-click
// @version      2026-11-25
// @description  Clicks the water for you, 1-15 times a second
// ==/UserScript==

// =====================================================================================================
// Auto-click (was part of the Income pills)
//
// An "Auto-click" toggle in Settings > Mods (under this mod's row) clicks the water for you, 1-15 times a
// second (− / +, remembered in this browser); it starts clicking as soon as the mod is on. Hover it for how
// many clicks went out, how many the game counted, and how full the Frenzy bar stays.
// The game allows auto-clicking: clicks over 15 a second simply don't count, on this side and on
// the server, and nobody is flagged (clicks.js; changelog "No more auto-clicker detection").
// A click is a pointerdown + pointerup sent straight to the game's canvas, which is where Pixi
// listens, so it takes the same path as your own clicks (Golden Fish check, the 15/s limiter,
// Frenzy). The events don't bubble, so the page's own menu and tooltip handlers never see them.
// Your own clicks share the same 15/s budget while it runs.
// The beat comes from a tiny Web Worker, because Chrome slows timers in background tabs to once a
// second (and later once a minute) but not a worker's messages, so it keeps clicking when the tab
// isn't in front.
// The Gear judge reads the rate set here (localStorage 'measured-autoclick-cps') for "How you play: Auto-clicker".
// Stop it with:  stopAutoClick(), or untick it in Settings > Mods
// =====================================================================================================
const autoClick = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { fmtDec } = await mod('/src/format.js');

  window.stopAutoClick?.(); // replace one already running

  // Rates are often well under 1/s, so keep two significant digits for small values.
  const fmtRate = (n) => (n > 0 && n < 0.1 ? String(+n.toPrecision(2)) : fmtDec(n));
  // "1h 23m" / "4m 05s" / "12s" / "0.4s".
  const fmtDuration = (s) => {
    if (!Number.isFinite(s)) return 'never at this rate';
    if (s < 10) return `${+s.toFixed(1)}s`;
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
  };

  // ---------- Tooltip ----------
  // The game's own #tooltip only renders its built-in data-tip keys (and hides itself over
  // anything else), so this is a lookalike: the same frame and the game's tip classes, following
  // the pointer the same way.
  const tip = document.createElement('div');
  tip.id = 'autoclick-tip';
  tip.hidden = true;
  tip.style.cssText =
    'position:fixed;z-index:1000;max-width:min(500px,calc(100vw - 16px));padding:8px 12px;pointer-events:none;' +
    'font-family:var(--font);font-size:14px;line-height:1.35;color:var(--text);border:9px solid;' +
    'border-image:var(--fr-tip);box-shadow:0 6px 18px rgba(0,0,0,.6)';
  document.body.append(tip);
  const tips = new Map(); // button -> html
  const placeTip = (e) => {
    const pad = 14;
    const { width, height } = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + width > innerWidth - 8) x = Math.max(8, e.clientX - width - pad);
    if (y + height > innerHeight - 8) y = Math.max(8, e.clientY - height - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const attachTip = (el) => {
    el.addEventListener('pointerenter', (e) => { tip.innerHTML = tips.get(el) ?? ''; tip.hidden = false; placeTip(e); });
    el.addEventListener('pointermove', placeTip);
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
  };
  const setTip = (el, html) => {
    tips.set(el, html);
    if (!tip.hidden && el.matches(':hover')) tip.innerHTML = html; // refresh if it's open
  };

  // ---------- The toggle and − / + ----------
  // span.rate pills, as the game draws its +X/min in the top bar (ui.css scopes those rules to #topbar, so
  // they're given here)
  const style = document.createElement('style');
  style.id = 'autoclick-style';
  style.textContent =
    '#measured-autoclick-wrap{font:600 17px var(--num);text-shadow:1px 1px 0 #000}' +
    '#measured-autoclick-wrap .rate{padding:1px 8px;font-size:15px;font-weight:500;color:#c6f29a;text-shadow:none;' +
    'background:rgba(10,18,8,.6);border-radius:999px;box-shadow:inset 0 0 0 1px rgba(155,227,106,.4)}' +
    '#measured-autoclick-wrap .rate .per{color:#8fbf6c}';
  document.head.append(style);

  const AUTO_MIN = 1, AUTO_MAX = 15; // 15 is the game's cap: at it, timer jitter loses the odd click
  const AUTO_KEY = 'measured-autoclick-cps';
  let autoCps = 14;
  try { autoCps = Math.min(AUTO_MAX, Math.max(AUTO_MIN, Math.round(+localStorage.getItem(AUTO_KEY)) || 14)); } catch {}
  // Shown in Settings > Mods, under this mod's row (the runtime asks for them through window.autoClickControls
  // each time it draws the Mods tab)
  const autoWrap = document.createElement('div');
  autoWrap.id = 'measured-autoclick-wrap';
  autoWrap.style.cssText = 'display:flex;align-items:center;gap:3px';
  window.autoClickControls = () => autoWrap;
  const autoBtn = document.createElement('span');
  autoBtn.className = 'rate';
  autoBtn.setAttribute('role', 'button');
  autoBtn.style.cssText = 'cursor:pointer;user-select:none';
  const stepBtn = (label, delta) => {
    const b = document.createElement('span');
    b.className = 'rate';
    b.setAttribute('role', 'button');
    b.textContent = label;
    b.style.cssText = 'cursor:pointer;user-select:none;min-width:1.4em;text-align:center;padding-left:0;padding-right:0';
    b.addEventListener('click', () => setRate(autoCps + delta));
    attachTip(b);
    return b;
  };
  const minusBtn = stepBtn('−', -1);
  const plusBtn = stepBtn('+', 1);
  autoWrap.append(autoBtn, minusBtn, plusBtn);
  attachTip(autoBtn);

  // Where a click lands is where the game shows its "-0.25s": the middle of the part of the scene you see,
  // where the rare catch announcements show (with Quicklinks or the Left-hand layout panel out, part of
  // the scene is under it: see viewCentre; its share is a half while neither is out, or without them)
  const clickCanvas = () => {
    const c = document.querySelector('#game > canvas');
    const r = c?.getBoundingClientRect();
    if (!r?.width) return false;
    const share = window.idleAnglerViewCentre?.share ?? 0.5;
    const init = {
      clientX: r.left + r.width * share, clientY: r.top + r.height * 0.45,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: false, cancelable: true,
    };
    c.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
    c.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    return true;
  };

  // The game's connection banner (#conn-status, main.js) is up while its server stream is down:
  // reconnecting, restarting for an update, or replaced by another tab. Clicks sent then are refused
  // (HTTP 409, "not connected yet") and dropped, so the auto-clicker holds off until the banner goes.
  // "A new version is out" (class update) keeps the connection, so clicking carries on through it.
  // The banner shows after 3 s down, so the first few seconds of a drop still get the odd 409.
  const offline = () => {
    const el = document.getElementById('conn-status');
    return !!el && !el.classList.contains('update');
  };

  let beat = null; // { worker, stop() }
  const startBeat = (fn, ms) => {
    try {
      const src = 'let t;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = fn;
      w.postMessage(ms);
      return { worker: true, stop: () => w.terminate() };
    } catch {
      const t = setInterval(fn, ms); // the page blocks workers: foreground-only timing
      return { worker: false, stop: () => clearInterval(t) };
    }
  };

  // While on: { since, clicks0, sent, low, held, paused } where low is the lowest Frenzy fill seen just
  // before a click since the last tooltip refresh (the bottom of the bar's sawtooth), i.e. how full it
  // stays; held counts the beats skipped while the game was offline, paused says it is right now.
  let auto = null;
  const pct = (x) => `${Math.floor(x * 100)}%`;
  const renderAuto = () => {
    autoBtn.innerHTML = !auto
      ? `<span class="muted">Auto-click off</span> <span class="per muted">${autoCps}/s</span>`
      : auto.paused
        ? `<span>Auto-click paused</span> <span class="per">${autoCps}/s</span>`
        : `<span>Auto-click</span> <span class="per">${autoCps}/s</span>`;
    autoBtn.style.background = !auto ? '' : auto.paused ? 'rgba(253,230,138,.35)' : 'rgba(155,227,106,.4)';
    minusBtn.style.opacity = autoCps <= AUTO_MIN ? '.4' : '';
    plusBtn.style.opacity = autoCps >= AUTO_MAX ? '.4' : '';
    setTip(minusBtn, autoCps <= AUTO_MIN ? `<div class="muted">Already at ${AUTO_MIN} a second.</div>` : `<div>Slower: ${autoCps - 1} clicks a second</div>`);
    setTip(plusBtn, autoCps >= AUTO_MAX ? `<div class="muted">${AUTO_MAX} a second is the most the game counts.</div>` : `<div>Faster: ${autoCps + 1} clicks a second</div>`);
    let body;
    if (auto) {
      const secs = (performance.now() - auto.since) / 1000;
      const counted = (S.state.stats?.clicks ?? 0) - auto.clicks0;
      const frenzy = auto.low === Infinity ? '' :
        `<div>Frenzy bar: stays at <b>${pct(auto.low)}</b> or more <span class="muted">(×${fmtDec(S.frenzyMult())} luck now)</span></div>`;
      auto.low = Infinity;
      body =
        `<div>Clicking the water ${autoCps} times a second. Click to stop.</div>` +
        (auto.paused ? `<div style="color:#fde68a">Paused while the game reconnects to the server; it carries on by itself once it's back.</div>` : '') +
        '<div class="tip-sep"></div>' +
        frenzy +
        `<div>Sent: <b>${auto.sent}</b> in ${fmtDuration(secs)}</div>` +
        (auto.held ? `<div class="muted">Held back while reconnecting: ${auto.held}</div>` : '') +
        `<div>Counted by the game: <b>${counted}</b>${secs >= 5 ? ` <span class="muted">(${fmtRate(counted / secs)}/s)</span>` : ''}</div>` +
        `<div class="muted">The count comes from the server, so it trails a little.</div>` +
        (beat?.worker ? '' : `<div style="color:#fde68a">This page blocks the background timer, so it only clicks while the tab is in front.</div>`);
    } else {
      body =
        `<div>Click to start clicking the water ${autoCps} times a second (− / + to change).</div>` +
        `<div class="muted">The game counts up to 15 clicks a second and ignores the rest; it doesn't flag auto-clicking. ` +
        `It keeps going in a background tab.</div>`;
    }
    setTip(autoBtn, `<div class="tip-title">Auto-clicker</div>${body}`);
  };
  const setAuto = (on) => {
    beat?.stop();
    beat = null;
    auto = null;
    if (on) {
      auto = { since: performance.now(), clicks0: S.state.stats?.clicks ?? 0, sent: 0, low: Infinity, held: 0, paused: false };
      beat = startBeat(() => {
        const down = offline();
        if (down !== auto.paused) { auto.paused = down; renderAuto(); }
        if (down) { auto.held++; return; }
        const f = S.frenzyFill?.();
        if (f != null && f < auto.low) auto.low = f;
        if (clickCanvas()) auto.sent++;
      }, 1000 / autoCps);
    }
    renderAuto();
  };
  // A new rate restarts the beat (and the sent/counted tally, so its rate reads true).
  const setRate = (n) => {
    n = Math.min(AUTO_MAX, Math.max(AUTO_MIN, n));
    if (n === autoCps) return;
    autoCps = n;
    try { localStorage.setItem(AUTO_KEY, String(n)); } catch {}
    if (auto) setAuto(true);
    else renderAuto();
  };
  autoBtn.addEventListener('click', () => setAuto(!auto));
  setAuto(true); // on from the start; click the toggle to stop it
  const autoTipTimer = setInterval(() => { if (auto) renderAuto(); }, 1000);

  window.stopAutoClick = () => {
    delete window.autoClickControls;
    clearInterval(autoTipTimer);
    beat?.stop();
    autoWrap.remove();
    tip.remove();
    style.remove();
    delete window.stopAutoClick;
  };
};

idleAnglerMods.define({
  id: 'autoClick',
  order: 25,
  name: "Auto-click",
  desc: "Clicks the water for you, 1-15 times a second (− / +), from the toggle here. It starts clicking as soon as it's on, and keeps going in a background tab",
  start: autoClick,
  stop: 'stopAutoClick',
  // Live controls shown under the mod's row while it runs (an element the mod keeps up to date)
  controls: () => window.autoClickControls?.(),
});
