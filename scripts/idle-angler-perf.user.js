// ==UserScript==
// @name         Idle Angler Performance
// @namespace    http://tampermonkey.net/
// @version      2026-11-25
// @description  Lower CPU use for computers without graphics acceleration, keeping the look
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/perf.js and the runtime: edit those, not this file.
//
// Idle Angler — performance mod for slow computers (no GPU, or the GPU switched off in the browser).
// Its script needs no other; with other Idle Angler mod scripts it shows in Settings > Mods with them.
//
// What it changes, each of which can be switched off on its own:
//  - Frame cap. The game draws a new frame every time the screen refreshes (60 a second, 144 on a fast
//    monitor), and each frame rebuilds ~20 shapes on the CPU (sky, rain, water, spots, the line) and runs
//    every blur and shader pass. Capping it at 30 halves that or better. The game's own clock runs on
//    elapsed time, not frames, so fishing, sailing and timers go at the same speed.
//    The 30 setting aims at 31: the game switches its light shafts off for a moment to test them when it
//    measures under 30 a second for 15 s, and an exact 30 measures as 29.9 now and then. Below 30 (24, 20)
//    that test runs once per visit: the shafts blink off for 5 s, then come back. They are never turned off
//    for good by it, because a capped game doesn't speed up without them.
//    Pixi's own ticker.maxFPS isn't used: it rounds the time down to whole milliseconds, so a 30 cap
//    on a 60 Hz screen skips the 33.3 ms frame and runs at 20.
//  - Lighter blurs. The fog and the lantern's three bloom layers are Pixi blur filters at quality 3 and 4:
//    each quality step is one more pass across the screen in each direction, 30 passes a frame at
//    night. Lighter blurs cap them at 2 passes: the same spread, slightly less smooth at the edges.
//  - Meter: a small chip right of the game's "online" player count with the frames a second and the cap
//    (in the window's bottom left corner until the game shows that count). Click it for the settings
//    and which renderer the game ended up on: "Microsoft Basic Render Driver" (Windows), "SwiftShader" or
//    "llvmpipe" in its name means the graphics are drawn by the CPU; "canvas" means the browser had no WebGL
//    at all, and Pixi drew with plain canvas. When the CPU draws, nearly all the cost is in the browser's
//    GPU process, not the page, so it's Chrome's Task Manager (Shift+Esc) that shows what these save.
//    Measured on a stand-in for the scene (the game's Pixi, filters and per-frame drawing) in Chrome with
//    the GPU off: 409% of a core uncapped at 60 fps; 311% with lighter blurs; 201% capped at 30;
//    185% with both; 120% at 24 with both.
// Settings are remembered in this browser (localStorage 'idle-angler-perf').
// Pasting it again replaces the one running. Stop it and put everything back with:
//   stopIdleAnglerPerf()

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
const perf = async () => {
  window.stopIdleAnglerPerf?.();

  const KEY = 'idle-angler-perf';
  const CAPS = [0, 60, 45, 30, 24, 20]; // 0: no cap
  const BLUR_PASSES = 2;
  const DEFAULTS = { cap: 30, blur: true, meter: true };
  const opts = (() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  })();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(opts));
    } catch {
      // private window or blocked storage: the settings just aren't remembered
    }
  };

  // The game imports 'pixi.js' through its import map, which points at /vendor/pixi.mjs: importing that
  // URL gives the same module, so patching its classes patches the game's.
  const PIXI = await import(new URL('/vendor/pixi.mjs', location.origin).href);
  const { Ticker, BlurFilter } = PIXI;

  // ---------- Frame cap ----------
  // Ticker.prototype.update is what each animation frame calls (ticker._tick looks it up on the instance,
  // so a patched prototype reaches the ticker the game already has). A skipped update leaves lastTime
  // alone, so the next frame's deltaMS covers the skipped time and the game's clock stays right.
  const baseUpdate = Ticker.prototype.update;
  let app = null; // the game's Application: the context of its ticker's render listener
  let gameTicker = null;
  const findApp = (ticker) => {
    for (let l = ticker._head?.next; l; l = l.next) if (l._context?.stage && l._context?.renderer) return l._context;
    return null;
  };
  const SLACK_MS = 2; // a frame up to this early still counts (vsync timing jitters by a millisecond or so)
  let due = 0; // when the next frame is due; steps by the interval so the average rate is the cap
  const stats = { frames: 0, since: performance.now(), fps: 0 };

  Ticker.prototype.update = function (now = performance.now()) {
    if (this !== gameTicker) {
      const found = !gameTicker && findApp(this);
      if (!found) return baseUpdate.call(this, now);
      app = found;
      gameTicker = this;
      onApp();
    }
    if (opts.cap) {
      const interval = 1000 / (opts.cap >= 30 ? opts.cap + 1 : opts.cap);
      if (now < due - SLACK_MS) return;
      due = now - due > interval ? now + interval : due + interval; // fell behind (a slow frame, a hidden tab): start again from now
    }
    baseUpdate.call(this, now);
    stats.frames++;
  };

  // ---------- Lighter blurs ----------
  // Hooked where each blur runs, not found by walking the stage: the game draws its world into a texture
  // from a root of its own (postfx.js moves the camera off app.stage), so the fog and bloom aren't on it.
  const blurQuality = new Map(); // each blur filter the game made -> its own quality
  const baseBlurApply = BlurFilter.prototype.apply;
  BlurFilter.prototype.apply = function (...args) {
    if (!blurQuality.has(this)) blurQuality.set(this, this.quality);
    const own = blurQuality.get(this);
    const want = opts.blur ? Math.min(own, BLUR_PASSES) : own;
    if (this.quality !== want) this.quality = want;
    return baseBlurApply.apply(this, args);
  };
  const restoreBlur = () => {
    for (const [f, q] of blurQuality) if (!f.destroyed) f.quality = q;
    blurQuality.clear();
  };

  // ---------- Renderer ----------
  const rendererName = () => {
    const r = app?.renderer;
    if (!r) return 'not started yet';
    let name = r.name ?? String(r.type);
    const gl = r.gl;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const what = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      name += ` (${what})`;
    }
    return name;
  };
  const softwareGl = () => /swiftshader|llvmpipe|software|basic render|microsoft basic|warp/i.test(rendererName());

  // ---------- Meter and settings ----------
  const css = document.createElement('style');
  css.textContent = `
    #iap-perf { position: fixed; left: 8px; bottom: 8px; z-index: 2147483000; color: #e9dcbc; user-select: none; }
    #iap-perf.docked { position: absolute; }
    /* the chip copies the game's "online" chip (.online-count) it sits beside */
    #iap-perf .chip { display: inline-block; padding: 3px 8px; font-size: 13px; white-space: nowrap; cursor: pointer;
      background: rgba(10, 14, 8, 0.72); border: 2px solid rgba(207, 224, 168, 0.35);
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45); font-variant-numeric: tabular-nums; }
    #iap-perf .panel { display: none; margin-bottom: 6px; padding: 8px 10px; width: 250px; font: 12px/1.35 system-ui, sans-serif;
      color: #e8eedd; background: rgba(10, 14, 8, 0.92); border: 2px solid rgba(207, 224, 168, 0.35); }
    @media (max-width: 640px) { #iap-perf .chip { padding: 2px 6px; font-size: 11px; } }
    #iap-perf.open .panel { display: block; }
    #iap-perf .panel h4 { margin: 0 0 6px; font-size: 12px; }
    #iap-perf label { display: flex; align-items: center; gap: 6px; margin: 4px 0; cursor: pointer; }
    #iap-perf select { font: inherit; }
    #iap-perf .note { margin-top: 6px; opacity: 0.75; word-break: break-word; }
    #iap-perf.hidden .chip { opacity: 0.35; }`;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'iap-perf';
  box.innerHTML = `
    <div class="panel">
      <h4>Performance</h4>
      <label>Frame cap <select data-k="cap">${CAPS.map((c) => `<option value="${c}">${c ? `${c} a second` : 'Off'}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-k="blur"> Lighter blurs (fog and lantern glow)</label>
      <label><input type="checkbox" data-k="meter"> Show the meter</label>
      <div class="note" data-renderer></div>
      <div class="note">To see the CPU it saves: Chrome's Task Manager (Shift+Esc), the GPU Process and this tab.</div>
    </div>
    <span class="chip" title="Idle Angler performance: click for settings"></span>`;
  document.body.appendChild(box);
  const chip = box.querySelector('.chip');
  const capSel = box.querySelector('[data-k="cap"]');
  capSel.value = String(CAPS.includes(opts.cap) ? opts.cap : 30);
  box.querySelector('[data-k="blur"]').checked = opts.blur;
  box.querySelector('[data-k="meter"]').checked = opts.meter;
  box.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    opts[k] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
    save();
    if (k === 'cap') due = 0;
    render();
  });
  chip.addEventListener('click', () => {
    box.classList.toggle('open');
    render();
  });
  // keep keys typed in the panel away from the game's shortcuts
  box.addEventListener('keydown', (e) => e.stopPropagation());

  // Docked just right of the game's "online" chip (#online-count, absolute at the stage's bottom left, beside
  // the chat button; on phones it moves up onto the chat button, and this follows). The game hides that chip
  // until it's connected: the bottom left corner of the window until then.
  const GAP = 6;
  const place = () => {
    const online = document.getElementById('online-count');
    if (!online || online.hidden || !online.offsetParent) {
      box.classList.remove('docked');
      box.style.left = box.style.bottom = '';
      if (box.parentElement !== document.body) document.body.appendChild(box);
      return;
    }
    if (box.previousElementSibling !== online) online.after(box);
    box.classList.add('docked');
    const bottom = parseFloat(getComputedStyle(online).bottom) || 0;
    box.style.left = `${online.offsetLeft + online.offsetWidth + GAP}px`;
    box.style.bottom = `${bottom + (online.offsetHeight - chip.offsetHeight) / 2}px`;
  };
  const placeObserver = new ResizeObserver(place); // the count's width changes as players come and go
  const watchOnline = () => {
    const online = document.getElementById('online-count');
    if (online && !online.dataset.iapWatched) {
      online.dataset.iapWatched = '1';
      placeObserver.observe(online);
    }
  };
  addEventListener('resize', place);

  const render = () => {
    const now = performance.now();
    const span = now - stats.since;
    if (span >= 900) {
      stats.fps = (stats.frames * 1000) / span;
      stats.frames = 0;
      stats.since = now;
    }
    const cap = opts.cap ? `cap ${opts.cap}` : 'no cap';
    chip.textContent = !app
      ? '⚡ waiting for the game'
      : opts.meter || box.classList.contains('open')
        ? `⚡ ${stats.fps.toFixed(0)} fps · ${cap}`
        : '⚡';
    box.classList.toggle('hidden', !opts.meter && !box.classList.contains('open'));
    if (box.classList.contains('open')) {
      box.querySelector('[data-renderer]').textContent =
        `Renderer: ${rendererName()}${app && softwareGl() ? ' — drawn by the CPU' : ''}.`;
    }
    watchOnline();
    place();
  };
  const meterTimer = setInterval(render, 1000);
  render();

  function onApp() {
    due = 0;
    render();
  }

  // for checking from the console
  window.idleAnglerPerf = { opts, stats, blurs: blurQuality, get app() { return app; } };

  window.stopIdleAnglerPerf = () => {
    Ticker.prototype.update = baseUpdate;
    BlurFilter.prototype.apply = baseBlurApply;
    clearInterval(meterTimer);
    placeObserver.disconnect();
    removeEventListener('resize', place);
    delete document.getElementById('online-count')?.dataset.iapWatched;
    restoreBlur();
    box.remove();
    css.remove();
    delete window.idleAnglerPerf;
    delete window.stopIdleAnglerPerf;
  };
};

idleAnglerMods.define({
  id: 'perf',
  order: 220,
  name: 'Performance',
  desc: 'Less CPU for computers without graphics acceleration: a frame cap (30 a second unless you pick another), lighter blurs, and a frames-a-second meter by the online count. Click the meter for its settings',
  start: perf,
  stop: 'stopIdleAnglerPerf',
});
}
})();
