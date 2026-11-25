// ==UserScript==
// @name         Idle Angler Auto-click
// @namespace    http://tampermonkey.net/
// @version      2026-11-25
// @description  Clicks the water for you, 1-15 times a second
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/auto-click.js and the runtime: edit those, not this file.
//
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

(() => {
// =====================================================================================================
// The runtime: which mods run, and the Mods tab in the game's Settings window
//
// Every Idle Angler mod script carries this same runtime. The first script to run puts it on the page
// (window.idleAnglerMods) and the others hand their mods to it, so whichever scripts you've installed,
// one Mods tab lists them all, and each one can be turned on or off there. A script whose runtime is newer
// (REV) takes over from an older one, keeping what's running.
// The mods wait for the game to be up (signed in, its action bar filled in), then start one at a time in
// their `order`, whatever order the scripts ran in: several of them move the game's layout, and each
// measures it as it starts. A mod defined again (its script pasted again) replaces the one running.
// Stop every mod (and remove the Mods tab) with:  stopIdleAnglerMods()
// =====================================================================================================
// The game draws a window's tabs and contents itself (ui.js renderWindow) and replaces them whenever
// what it would draw changes, so the Mods tab can't be one of its tabs. Instead it's added to the
// Settings window on screen, and added back each time the game redraws it. While it's showing, the
// game's own contents are hidden, not removed: a click on one of the game's tabs brings them back.
//
// A mod is an object handed to idleAnglerMods.define():
//   id       its key in the remembered choices (localStorage 'idle-angler-mods')
//   order    where it starts among the others (the old one-script order: 10, 20, ...)
//   name     its name in the Mods tab; desc: the line under it
//   start    an async function that starts it; it defines window[stop] once it's running
//   stop     the name of the window function that stops it (a mod is running while that exists)
//   options  settings shown under its row, each a localStorage key the mod reads as it starts:
//            { key, label, values: [[value, text], ...], fallback, apply? } a dropdown, or
//            { key, label, toggle: true, fallback: 'on' | 'off', apply? } a checkbox ('on' / 'off').
//            apply(value) takes a change live; without it the mod is restarted
//   controls a function giving an element to show under its row while it runs (the mod keeps it up to date)
const idleAnglerMods = (() => {
  const REV = 1;
  const older = window.idleAnglerMods;
  if (older?.rev >= REV) return older;
  const handed = older?.retire?.() ?? { mods: [], seen: new Set() }; // an older runtime's mods

  const STORE_KEY = 'idle-angler-mods';
  const loadChoices = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
    } catch {
      return {};
    }
  };
  const choices = loadChoices(); // mod id -> false once turned off (every mod is on until then)
  const saveChoices = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(choices));
    } catch {
      // storage blocked: the choice lasts until the page reloads
    }
  };
  // Auto-click was part of the Income pills until 2026-11-25: turned off with them, it stays off
  if (choices.incomePills === false && !('autoClick' in choices)) {
    choices.autoClick = false;
    saveChoices();
  }

  const mods = new Map(); // id -> mod
  const inOrder = () => [...mods.values()].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  const wanted = (m) => choices[m.id] !== false;
  const starting = new Set();
  const failed = {}; // mod id -> why it didn't start
  // A mod is running while its stop function exists (also true of one started or stopped from the console)
  const running = (m) => typeof window[m.stop] === 'function';
  let retired = false;

  async function turnOn(m) {
    if (starting.has(m.id) || retired || mods.get(m.id) !== m) return;
    starting.add(m.id);
    delete failed[m.id];
    refreshPane();
    try {
      await m.start();
      // A mod that can't find its part of the page warns in the console and returns without starting
      if (!running(m)) failed[m.id] = "It couldn't find its part of the game page (the console says which).";
    } catch (e) {
      failed[m.id] = String(e?.message ?? e);
      console.error(`[mods] ${m.name} failed to start`, e);
    }
    starting.delete(m.id);
    refreshPane();
  }

  function turnOff(m) {
    try {
      window[m.stop]?.();
    } catch (e) {
      console.error(`[mods] ${m.name} failed to stop`, e);
    }
    delete failed[m.id];
    refreshPane();
  }

  // Starting is one at a time: each start waits for the one before it
  let chain = Promise.resolve();
  const startInTurn = (m) => {
    chain = chain.then(() => (wanted(m) && !running(m) ? turnOn(m) : null));
    return chain;
  };
  // Mods defined since the last batch; started together, in their order, once the game is up
  const pending = new Set();
  const seen = new Set(handed.seen); // ids that have been through a batch (an older runtime's too)
  let ready = false;
  let batchQueued = false;
  const batch = () => {
    batchQueued = false;
    if (!ready || retired) return;
    const list = [...pending].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
    pending.clear();
    for (const m of list) {
      seen.add(m.id);
      if (mods.get(m.id) === m) startInTurn(m);
    }
    if (list.length) {
      chain.then(() => {
        if (retired) return;
        const on = inOrder().filter(running).map((m) => m.name);
        console.log(`[mods] On: ${on.join(', ') || 'none'}. Turn mods on or off in Settings > Mods; stop all with stopIdleAnglerMods()`);
      });
    }
  };
  const queue = (m) => {
    pending.add(m);
    if (!batchQueued) {
      batchQueued = true;
      setTimeout(batch, 0); // after the rest of this script (and any others running now) has defined its mods
    }
  };

  function define(m) {
    if (retired) return window.idleAnglerMods?.define(m); // (a newer runtime took over)
    const before = mods.get(m.id);
    if (before && running(before)) turnOff(before); // pasted again: the new copy replaces it
    mods.set(m.id, m);
    delete failed[m.id];
    queue(m);
    refreshPane();
  }

  // ---------- The Mods tab ----------
  let layer = null; // the game's window layer (#windows), once the game is up
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let showing = false; // the Mods tab is the one on screen

  const style = document.createElement('style');
  style.id = 'im-style';
  style.textContent = `
.window.im-showing > .win-body > :not(.win-tabs):not(.im-pane){display:none !important}
.window:not(.im-showing) .im-pane{display:none}
.im-pane .im-state{display:block;margin-top:2px;font-size:.85em}
.im-pane .im-state.on{color:#86efac}
.im-pane .im-state.off{opacity:.65}
.im-pane .im-state.failed{color:#fca5a5}
.im-pane .im-option{margin:-2px 0 8px 30px}
.im-pane .im-option.setting{margin-top:-4px;margin-bottom:6px}
.im-pane .im-controls{display:flex}
`;

  const optionValues = (o) => (o.toggle ? [['on', 'On'], ['off', 'Off']] : o.values);
  const readOption = (o) => {
    try {
      const v = localStorage.getItem(o.key);
      return optionValues(o).some(([value]) => value === v) ? v : o.fallback;
    } catch {
      return o.fallback;
    }
  };
  // A mod's option: a dropdown in the game's own setting-select style, or a checkbox like the mods' own, outside
  // the row's label so a click on it doesn't tick the mod's box
  const optionHtml = (m, o) => {
    const now = readOption(o);
    if (o.toggle) {
      return `
    <label class="setting im-option"><input type="checkbox" data-im-opt="${m.id}" data-key="${o.key}" ${now === 'on' ? 'checked' : ''}/><span>${esc(o.label)}</span></label>`;
    }
    const opts = o.values.map(([value, text]) => `<option value="${value}" ${value === now ? 'selected' : ''}>${esc(text)}</option>`).join('');
    return `
    <label class="setting-select im-option">${esc(o.label)} <select data-im-opt="${m.id}" data-key="${o.key}">${opts}</select></label>`;
  };

  function paneHtml() {
    const row = (m) => {
      const on = running(m);
      const state = starting.has(m.id) ? ['', 'Starting…'] : failed[m.id] ? ['failed', `Didn't start: ${failed[m.id]}`] : on ? ['on', 'On'] : ['off', 'Off'];
      return `
    <label class="setting">
      <input type="checkbox" data-im="${m.id}" ${wanted(m) ? 'checked' : ''} ${starting.has(m.id) ? 'disabled' : ''}/>
      <span><b>${esc(m.name)}</b><span class="sub">${esc(m.desc)}</span><span class="im-state ${state[0]}">${esc(state[1])}</span></span>
    </label>${m.controls && on ? `<div class="im-option im-controls" data-im-controls="${m.id}"></div>` : ''}${(m.options ?? []).map((o) => optionHtml(m, o)).join('')}`;
    };
    return `
    <h2>UI mods</h2>
    <p class="muted small-text">These come from the Idle Angler mod scripts in this browser, not the game: ${mods.size === 1 ? 'one mod' : `${mods.size} mods`}. A change takes effect at once, and this browser remembers it the next time the scripts run.</p>
    <div class="btn-row">
      <button class="btn small" data-im-all="on">All on</button>
      <button class="btn small" data-im-all="off">All off</button>
    </div>
    ${inOrder().map(row).join('')}`;
  }

  const settingsWindow = () => layer?.querySelector('section.window[data-win="settings"]');

  // A mod's live controls (its own element, with its own handlers) go into their spot under its row
  function mountControls(pane) {
    for (const spot of pane.querySelectorAll('[data-im-controls]')) {
      const el = mods.get(spot.dataset.imControls)?.controls?.();
      if (el) spot.append(el);
    }
  }

  function refreshPane() {
    const pane = settingsWindow()?.querySelector('.im-pane');
    if (!pane) return;
    const scroll = pane.parentElement.scrollTop;
    pane.innerHTML = paneHtml();
    mountControls(pane);
    pane.parentElement.scrollTop = scroll;
  }

  /** Put the Mods tab and its pane into the Settings window (again, after the game redraws it). */
  function decorate() {
    const win = settingsWindow();
    const body = win?.querySelector('.win-body');
    const tabs = body?.querySelector(':scope > .win-tabs');
    if (!tabs) return;
    let tab = tabs.querySelector('.im-tab');
    if (!tab) {
      tab = document.createElement('button');
      tab.className = 'win-tab im-tab';
      tab.type = 'button';
      tab.textContent = 'Mods';
      const credits = tabs.querySelector('[data-tab="credits"]');
      tabs.insertBefore(tab, credits);
    }
    if (!body.querySelector(':scope > .im-pane')) {
      const pane = document.createElement('div');
      pane.className = 'im-pane';
      pane.innerHTML = paneHtml();
      mountControls(pane);
      body.append(pane);
    }
    win.classList.toggle('im-showing', showing);
    tab.classList.toggle('active', showing);
    // The game's own active tab looks inactive while Mods shows (marked, so it can be given back)
    for (const t of tabs.querySelectorAll('.win-tab:not(.im-tab)')) {
      if (showing && t.classList.contains('active')) {
        t.classList.remove('active');
        t.dataset.imActive = '1';
      } else if (!showing && t.dataset.imActive) {
        t.classList.add('active');
        delete t.dataset.imActive;
      }
    }
  }

  // The game adds the Settings window when it opens and rewrites its body when it redraws
  let bodyObserver = null;
  let watched = null;
  function watch() {
    const body = settingsWindow()?.querySelector('.win-body') ?? null;
    if (body !== watched) {
      bodyObserver?.disconnect();
      watched = body;
      if (!body) showing = false; // closed: it opens on the game's own tab next time
      else {
        bodyObserver = new MutationObserver(() => {
          if (!body.querySelector(':scope > .im-pane') || !body.querySelector(':scope > .win-tabs .im-tab')) decorate();
        });
        bodyObserver.observe(body, { childList: true });
      }
    }
    decorate();
  }
  const layerObserver = new MutationObserver(watch);

  // Clicks: the Mods tab, the game's tabs (back to the game's contents), All on / All off
  function onClick(e) {
    const win = e.target.closest('section.window[data-win="settings"]');
    if (!win) return;
    const tab = e.target.closest('.win-tab');
    if (tab?.classList.contains('im-tab')) {
      showing = true;
      decorate();
      win.querySelector('.win-body').scrollTop = 0;
      return;
    }
    if (tab && showing) {
      showing = false;
      decorate();
      return;
    }
    const all = e.target.closest('[data-im-all]');
    if (all) {
      const on = all.dataset.imAll === 'on';
      for (const m of inOrder()) {
        choices[m.id] = on;
        if (on && !running(m)) startInTurn(m);
        else if (!on && running(m)) turnOff(m);
      }
      saveChoices();
      refreshPane();
    }
  }

  function onChange(e) {
    const pick = e.target.closest('[data-im-opt]');
    if (pick) {
      pick.blur(); // the game doesn't redraw a window while one of its fields has focus
      const value = pick.type === 'checkbox' ? (pick.checked ? 'on' : 'off') : pick.value;
      try {
        localStorage.setItem(pick.dataset.key, value);
      } catch {
        // storage blocked: the mod can't read it back, so it keeps its default
      }
      // The mod reads its options as it starts. A running one takes the change live if its option says how,
      // and is restarted otherwise
      const m = mods.get(pick.dataset.imOpt);
      const o = m?.options?.find((x) => x.key === pick.dataset.key);
      if (m && running(m)) {
        if (o?.apply) o.apply(value);
        else {
          turnOff(m);
          startInTurn(m);
        }
      }
      return;
    }
    const box = e.target.closest('input[data-im]');
    if (!box) return;
    box.blur();
    const m = mods.get(box.dataset.im);
    if (!m) return;
    choices[m.id] = box.checked;
    saveChoices();
    if (box.checked && !running(m)) startInTurn(m);
    else if (!box.checked && running(m)) turnOff(m);
    else refreshPane();
  }

  const addTab = () => {
    layer = document.getElementById('windows');
    if (!layer) return console.warn('[mods] The game page was not found (#windows): no Mods tab in Settings');
    document.head.append(style);
    layerObserver.observe(layer, { childList: true });
    // Capture, so the game's tab is given back its active look before the game's own click handler runs
    layer.addEventListener('click', onClick, true);
    layer.addEventListener('change', onChange);
    watch();
  };
  const removeTab = () => {
    layerObserver.disconnect();
    bodyObserver?.disconnect();
    bodyObserver = watched = null;
    layer?.removeEventListener('click', onClick, true);
    layer?.removeEventListener('change', onChange);
    const win = settingsWindow();
    showing = false;
    if (win) {
      decorate();
      win.classList.remove('im-showing');
      win.querySelector('.im-tab')?.remove();
      win.querySelector('.im-pane')?.remove();
    }
    style.remove();
    layer = null;
  };

  // An older runtime's mods: the ones it had started stay as they are, the rest start with the next batch
  for (const m of handed.mods) {
    mods.set(m.id, m);
    if (!seen.has(m.id)) queue(m);
  }

  // ---------- Waiting for the game ----------
  // Up means signed in, with its action bar filled in (ui.js initUI). Started before that (straight after a
  // reload), the mods found the game's page still half built: the build switcher's key went into the empty
  // bar and was wiped when the game filled it in.
  const gameUp = () => Boolean(document.querySelector('#actionbar [data-win="angler"]'));
  let waiting = null;
  const whenUp = () => {
    ready = true;
    addTab();
    batch();
  };
  if (gameUp()) whenUp();
  else {
    console.log('[mods] Waiting for the game to finish loading…');
    waiting = setInterval(() => {
      if (!gameUp()) return;
      clearInterval(waiting);
      waiting = null;
      whenUp();
    }, 250);
  }

  // Hand over to a newer runtime: the Mods tab goes, the mods keep running
  const retire = () => {
    retired = true;
    clearInterval(waiting);
    removeTab();
    return { mods: [...mods.values()], seen: new Set(seen) };
  };

  const api = {
    rev: REV,
    define,
    retire,
    get mods() { return inOrder().map((m) => ({ id: m.id, name: m.name, on: running(m), wanted: wanted(m), failed: failed[m.id] })); }, // for the console
  };
  window.idleAnglerMods = api;
  window.stopIdleAnglerMods = () => {
    for (const m of inOrder()) if (running(m)) turnOff(m);
    retire();
    if (window.idleAnglerMods === api) delete window.idleAnglerMods;
    delete window.stopIdleAnglerMods;
  };
  return api;
})();

{
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
}
})();
