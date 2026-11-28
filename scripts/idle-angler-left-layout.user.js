// ==UserScript==
// @name         Idle Angler Left-hand Layout
// @namespace    http://tampermonkey.net/
// @version      2026-11-28
// @description  The sidebar on the left, windows sliding out from there, no pages in Upgrades and Perks
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/left-layout.js and the runtime: edit those, not this file.
//
// =====================================================================================================
// Left-hand layout
//
// It changes the game's new sidebar layout:
//  - the sidebar (window buttons, Level and Ascension bars) sits down the left edge instead of the right
//  - a window slides out from the left edge of the screen, and the game moves over to make room for it
//    (nothing is covered), like Quicklinks does on the right. The scene slides over whole, at its full size,
//    so your angler stays in view, out past the window: its right edge goes off the screen while the window
//    is open (the catch feed and the right sail tab come back in, to stay on screen; Quicklinks keeps the
//    scene whole the same way). Out on the water the camera centres your angler on the part you see, and the big announcements
//    ("Legendary!") show there too. A narrower picture
//    would have the game lay its scene out again for the new width, which moves the whole view about on
//    every frame of the slide. One window shows at a time: opening
//    another swaps it in. Close it (✕, Esc or its button again) and the game slides back. Drag the window's
//    right edge to make it wider or narrower (every window then opens at that width; double-click the edge
//    for the usual 380px).
//    A window you undock floats over the game as before, and one you've pinned opens in its spot. The
//    Weather forecast mod's window slides out here too.
//  - Upgrades and Perks list every card on one page instead of five at a time
// Everything inside the windows is still the game's own: only where they sit changes.
// On a narrow screen (720px or less) the game's own phone layout is left alone.
// Stop it (and put the game's layout back) with:  stopLeftLayout(), or untick it in Settings > Mods
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

// =====================================================================================================
// Shared by Quicklinks and the Left-hand layout: a grip on a docked panel's inner edge that resizes it
//
// Each panel's width is a CSS variable on the page (Quicklinks --qs-w, the left slideout --ll-w) that the page,
// the scene and the camera's centre already follow, so the grip only sets that variable. The grip is its own
// element on the page, not part of the panel (the game redraws its windows' insides), held on the panel's edge
// by the same variable and shown only while the panel is out (`openClass` on the body).
// Drag it, or focus it and press ← / →. Let go and the width is remembered in this browser (`key`); a double
// click forgets it and goes back to the panel's usual width (`onReset`). While dragging, the page's slide
// transitions are off, so everything follows the pointer, and the game is told of the resize each frame (it
// measures its play area on resize). The width is capped to a share of the window (`max`) as the window shrinks
// too, and a drag stops KEEP px short of a panel out on the other side, so the scene is never squeezed away
// between them. Nothing goes to the server.
// =====================================================================================================
function edgeGrip({ id, edge, openClass, cssVar, key, min, max, label, onSize = () => {}, onReset = () => {} }) {
  document.getElementById(id)?.remove();
  document.getElementById(`${id}-style`)?.remove();
  const root = document.documentElement;
  const STEP = 16; // px a key press moves it
  const KEEP = 400; // px of the scene kept between this panel and one out on the other side
  // How wide it can go: up to the other side's grip (the other panel's edge), less KEEP, if that one is out
  const room = () => {
    const other = [...document.querySelectorAll('.ia-grip')].find((g) => g.dataset.edge !== edge && getComputedStyle(g).display !== 'none');
    if (!other) return Infinity;
    const r = other.getBoundingClientRect();
    const x = r.left + r.width / 2;
    return (edge === 'left' ? x : innerWidth - x) - KEEP;
  };
  const clamp = (w) => Math.round(Math.max(min, Math.min(innerWidth * max, room(), w)));
  const apply = (w) => {
    root.style.setProperty(cssVar, `min(${w}px, ${max * 100}vw)`);
    onSize(w);
  };
  let size = null; // the width set with the grip (px), or null: the panel's own
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved >= min) size = saved;
  } catch {
    // storage blocked: the usual width
  }
  if (size) apply(size);

  const style = document.createElement('style');
  style.id = `${id}-style`;
  // The grip straddles the panel's edge: 10px to catch, a 2px line in the middle while hovered or dragged
  const at = edge === 'left' ? `left:calc(var(${cssVar}) - 5px)` : `right:calc(var(${cssVar}) - 5px)`;
  style.textContent = `
#${id}{position:fixed;${at};top:44px;bottom:0;width:10px;z-index:900;display:none;cursor:ew-resize;touch-action:none;
  background:linear-gradient(90deg,transparent 4px,var(--ia-grip,transparent) 4px,var(--ia-grip,transparent) 6px,transparent 6px)}
body.${openClass} #${id}{display:block}
#${id}:hover,#${id}:focus-visible,body.ia-grip-drag #${id}{--ia-grip:rgba(253,230,138,.55);outline:none}
body.ia-grip-drag,body.ia-grip-drag *{transition:none !important;animation:none !important;cursor:ew-resize !important;user-select:none !important}`;
  document.head.append(style);

  const grip = document.createElement('div');
  grip.id = id;
  grip.className = 'ia-grip';
  grip.dataset.edge = edge;
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', `Width of ${label}`);
  grip.title = `Drag to change the width of ${label} (← / → too). Double-click for its usual width.`;
  document.body.append(grip);

  // The game measures its play area on resize: once a frame at most while the width changes
  let frame = 0;
  const tellGame = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      dispatchEvent(new Event('resize'));
    });
  };
  const save = () => {
    try {
      if (size) localStorage.setItem(key, String(size));
      else localStorage.removeItem(key);
    } catch {
      // storage blocked: the width lasts until the page reloads
    }
  };
  const set = (w) => {
    size = clamp(w);
    apply(size);
    tellGame();
  };
  const widthAt = (x) => (edge === 'left' ? x : innerWidth - x);

  let dragging = null; // the pointer's id
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = e.pointerId;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('ia-grip-drag');
  });
  grip.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragging) set(widthAt(e.clientX));
  });
  const end = (e) => {
    if (e.pointerId !== dragging) return;
    dragging = null;
    document.body.classList.remove('ia-grip-drag');
    save();
    dispatchEvent(new Event('resize'));
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => {
    size = null;
    save();
    root.style.removeProperty(cssVar);
    onReset();
    dispatchEvent(new Event('resize'));
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation(); // not the game's hotkeys
    const r = grip.getBoundingClientRect();
    const now = size ?? widthAt(r.left + r.width / 2); // (the grip's middle is the panel's edge)
    const wider = (e.key === 'ArrowRight') === (edge === 'left');
    set(now + (wider ? STEP : -STEP));
    save();
  });

  return {
    get size() { return size; }, // the width set with the grip (px), or null
    remove() {
      cancelAnimationFrame(frame);
      document.body.classList.remove('ia-grip-drag');
      grip.remove();
      style.remove();
    },
  };
}

// =====================================================================================================
// Shared by Quicklinks and the Left-hand layout: the camera and the big announcements centre on the part of
// the scene you can see
//
// Out on the water the game's camera keeps your angler in the middle of the scene (scene.js followBoat), and
// the big announcement for a rare catch ("Legendary!", scene.js announce) shows there too. With a side panel
// out, these two keep the scene at its full size (so the game never lays it out again), and part of it is
// under the panel or past the edge of the screen: the middle of the scene isn't the middle of what you see,
// and the bigger the screen, the further off it is. While either of them is on, both aim for the middle of
// the part you see instead (the camera easing over as it always does). The arrows at the screen's edges that
// point to fishing spots and the Golden Fish off screen (scene.js drawEdgeMarks) go by the part you see too,
// so a spot under the panel gets an arrow beside the panel. Where the game's camera doesn't
// follow the boat (moored at the Pond's pier, the cabin framed) it stays put. It only moves what you see:
// nothing goes to the server.
// One for the page (kept on window), so two scripts that carry this don't wrap the game's methods twice.
// =====================================================================================================
const viewCentre = window.idleAnglerViewCentre ??= (() => {
  const users = new Set();
  const AIMED = ['followBoat', 'announce', 'drawEdgeMarks']; // the game's methods that go by the screen's width
  let proto = null, originals = null, probe = null, observer = null;
  let share = 0.5; // where the middle of what you see is, as a share of the scene's width (the game's: half)
  let stale = true;
  const mark = () => { stale = true; };
  // The part you see once the panels have finished sliding runs from the left panel's edge (--ll-push) to
  // the right one's (--qs-push): the probe sits there, with no transition. The scene's left edge is always
  // at the left end of it (the page moves over by as much), so the middle is half its width in
  const measure = () => {
    stale = false;
    const seen = probe.getBoundingClientRect().width;
    const whole = document.getElementById('game')?.clientWidth || innerWidth;
    share = seen > 0 && whole > 0 ? Math.min(0.5, seen / 2 / whole) : 0.5;
  };
  // The first two aim at the middle of the screen as L.SW / 2, and the arrows take L.SW as the screen's right
  // edge; none reads L.SW for anything else. For the one call, the screen is made as wide as the part you see
  // (twice its middle), whose left end is the scene's left edge
  const aimed = (original) => function (...args) {
    if (stale) measure();
    const L = this.L;
    if (!L || share >= 0.5) return original.apply(this, args);
    const sw = L.SW;
    L.SW = sw * share * 2;
    try { return original.apply(this, args); } finally { L.SW = sw; }
  };
  const install = async () => {
    const { FishingScene } = await import(new URL('/src/scene.js', location.origin).href);
    if (!users.size || proto) return; // turned off while the game's file loaded, or already on
    proto = FishingScene.prototype;
    originals = {};
    for (const name of AIMED) {
      originals[name] = proto[name];
      proto[name] = aimed(originals[name]);
    }
    probe = document.createElement('div');
    probe.id = 'ia-view-probe';
    probe.style.cssText = 'position:fixed;top:0;height:0;left:var(--ll-push,0px);right:var(--qs-push,0px);visibility:hidden;pointer-events:none';
    document.body.append(probe);
    // The panels open and close with the page's classes (ll-open, qs-open), and the screen can change size
    observer = new MutationObserver(mark);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', mark);
    stale = true;
  };
  return {
    add(id) {
      users.add(id);
      stale = true;
      if (!proto) install().catch((e) => console.warn('[view centre] The view stays as the game has it:', e));
    },
    remove(id) {
      users.delete(id);
      stale = true;
      if (users.size || !proto) return;
      for (const name of AIMED) proto[name] = originals[name];
      observer.disconnect();
      removeEventListener('resize', mark);
      probe.remove();
      proto = originals = probe = observer = null;
      share = 0.5;
    },
    get share() { return share; }, // for the console: where the middle of what you see is (0.5 = the game's)
  };
})();

{
const leftLayout = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { UPGRADES, PERKS, STATS } = await mod('/src/data.js');
  const { fmtHtml, fmtDecHtml, moneyHtml } = await mod('/src/format.js');
  const { ICON_COLS, ICON_ROWS, ICON_INDEX } = await mod('/src/icon-index.js');

  window.stopLeftLayout?.(); // replace one already running
  viewCentre.add('leftLayout'); // the camera centres on the part of the scene you see

  const layer = document.getElementById('windows');
  const hotbar = document.getElementById('hotbar');
  if (!layer || !hotbar) return console.warn('[left layout] The game page was not found (#windows, #hotbar)');

  const WIDTH = 380; // the slideout (px); a window's contents never grow past their normal size, so it shows more
  const SLIDE_MS = 180;
  const RIBBON_RISE = 16; // where the frame starts (px): a window's title ribbon rises 12px above it, so the ribbon's top is 4px down
  const WIDE = '(min-width: 721px)'; // the game's own break: below it, a window fills the phone's screen

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.id = 'left-layout-style';
  style.textContent = `
:root{--ll-w:${WIDTH}px}
#app{transition:margin ${SLIDE_MS}ms ease-out}
/* The scene keeps its full size while the page makes room (a window on the left, Quicklinks on the right):
   it reaches past the page's right edge by however far the page is pushed, on the same timing, so the game
   never lays it out again (that moves the whole view about). The catch feed and the right sail tab come
   back in by as much, to stay on screen. The camera aims for the middle of the part you see (viewCentre).
   Left-hand layout and Quicklinks both have this rule */
#stage > #game{right:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)));transition:right ${SLIDE_MS}ms ease-out}
#scene-hud > .catch-feed{margin-right:calc(var(--ll-push, 0px) + var(--qs-push, 0px));transition:margin-right ${SLIDE_MS}ms ease-out}
#scene-hud > .sail-arrow.right{margin-left:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)))}
@media ${WIDE}{
  body.ll-open #app{margin-left:var(--ll-w)}
  body.ll-open{--ll-push:var(--ll-w)}
  /* The sidebar: down the left edge, opening rightwards. Mirrored: the icons keep to the edge (the slim strip
     shows them), the names open to their right with the hotkey at the end, the active line is on the left,
     and Collapse points left */
  body #stage #hotbar{left:6px;right:auto}
  body #hotbar #actionbar .action-btn{justify-content:flex-start}
  body #hotbar #actionbar .action-btn :is(.gicon,.ui-icon){order:-3}
  body #hotbar #actionbar .action-btn .ab-label{text-align:left}
  body #hotbar:is(.hovering,.pinned,:focus-within) #actionbar .action-btn .ab-label{margin-right:0;margin-left:8px}
  body #hotbar #actionbar .action-btn kbd{order:1;margin-right:0;margin-left:8px}
  body #hotbar #actionbar .action-btn.active{box-shadow:inset 2px 0 0 var(--gold)}
  body #hotbar-pin{flex-direction:row-reverse}
  body #hotbar-pin svg{transform:scaleX(-1)}
  body #hotbar-pin[aria-pressed='true'] svg{transform:none}
  /* The zone arrows trade places with it: the left one clears the sidebar, the right one sits at the edge */
  body #scene-hud > .sail-arrow.left{transform:translate(52px,-50%)}
  body #scene-hud > .sail-arrow.right{transform:translate(calc(-100% - 6px),-50%)}
  /* A docked window: the slideout, against the left edge, down to the bottom of the page. Its frame starts
     just low enough for the title ribbon to rise over the top border as it always does, its top at the top
     of the page. The forecast mod's window (kept in the page, hidden, while it's closed) joins in when it shows */
  body #windows > .window:not(.floating):not([hidden]){position:fixed;left:0 !important;right:auto !important;top:${RIBBON_RISE}px !important;bottom:0 !important;
    width:var(--ll-w) !important;height:auto !important;max-height:none !important;transition:none;animation:ll-slide ${SLIDE_MS}ms ease-out}
  body #windows > .window:not(.floating) .win-resize{display:none}
}
@keyframes ll-slide{from{transform:translateX(-100%)}}
@media (prefers-reduced-motion:reduce){#app,#stage > #game,#scene-hud > .catch-feed{transition:none}body #windows > .window:not(.floating){animation:none}}`;
  document.head.append(style);
  // A grip on the docked window's right edge sets its width for every window (double-click it for WIDTH again)
  const grip = edgeGrip({
    id: 'll-grip', edge: 'left', openClass: 'll-open', cssVar: '--ll-w', key: 'idle-angler-left-width',
    min: 300, max: 0.6, label: 'the window',
  });

  const wide = matchMedia(WIDE);
  const docked = () => [...layer.querySelectorAll(':scope > .window:not(.floating):not([hidden])')];

  // ---------- The slideout ----------
  // The game measures its play area on window resize (Pixi, the window row, the sidebar), so a resize is
  // sent on every frame while the page slides, and once more at the end.
  let slideFrame = 0;
  function relayout() {
    cancelAnimationFrame(slideFrame);
    const t0 = performance.now();
    const step = () => {
      dispatchEvent(new Event('resize'));
      if (performance.now() - t0 < SLIDE_MS + 40) slideFrame = requestAnimationFrame(step);
    };
    slideFrame = requestAnimationFrame(step);
  }

  // One docked window at a time: the newest stays, the others close through their own ✕ (the game's
  // close, so it forgets them the way it always does). The order they joined in is kept here.
  const joined = new Map(); // window element -> when it last became docked
  let tick = 0;
  let isOpen = false;
  function sync() {
    for (const el of [...joined.keys()]) if (!el.isConnected || el.classList.contains('floating') || el.hidden) joined.delete(el);
    for (const el of docked()) if (!joined.has(el)) joined.set(el, ++tick);
    if (wide.matches) {
      const list = [...joined].sort((a, b) => b[1] - a[1]).map(([el]) => el);
      for (const el of list.slice(1)) el.querySelector('.win-close')?.click();
    }
    const open = wide.matches && docked().length > 0;
    if (open !== isOpen) {
      isOpen = open;
      document.body.classList.toggle('ll-open', open);
      relayout();
    }
  }

  // ---------- Upgrades and Perks on one page ----------
  // The game draws five cards and a pager (ui.js renderUpgrades / renderPerks). Each time it draws one, the
  // five are swapped for every card, drawn the way the game draws them (copies of its helpers below), and
  // the pager goes. The cards are the game's own buttons (buy-upgrade, buy-perk).
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function gameIcon(key, size = 32) {
    const i = ICON_INDEX[key];
    if (i === undefined) return '';
    return `<span class="gicon s${size}" style="background-image:url(/assets/icons/raven-${size}.png);background-size:${ICON_COLS * size}px ${ICON_ROWS * size}px;background-position:-${(i % ICON_COLS) * size}px -${Math.floor(i / ICON_COLS) * size}px" aria-hidden="true"></span>`;
  }
  const rowIcon = (key, letter, color) => {
    const img = gameIcon(key);
    return img ? `<span class="icon has-img">${img}</span>` : `<span class="icon" style="--c:${color}">${esc(letter)}</span>`;
  };
  const goldAmt = (n) => `<span class="amt">${moneyHtml(n)}</span>`;
  const essenceAmt = (n) => `<span class="amt essence-text"><span class="essence-gem sm"></span><span>${fmtHtml(n)}</span></span>`;
  function effectText(def, level) {
    const info = STATS[def.stat];
    if (def.type === 'mult') return `×${fmtDecHtml(def.perLevel)} ${info.name} per level · now ×${fmtDecHtml(S.leveledEffect(def, level))}`;
    return `+${fmtDecHtml(def.perLevel)}${info.unit} ${info.name} per level · now +${fmtDecHtml(S.leveledEffect(def, level))}${info.unit}`;
  }
  function milestoneStar(def, level) {
    const next = S.nextMilestone(def, level);
    if (!next) return '';
    return `<span class="ms-star" title="Lv ${next}: +${Math.round((def.milestone - 1) * 100)}% of its effect again (${next - level} to go)">★ ${next}</span>`;
  }
  const ranksHtml = (def, level) =>
    def.maxLevel <= 10
      ? Array.from({ length: def.maxLevel }, (_, i) => `<i class="pip ${i < level ? 'on' : ''}"></i>`).join('')
      : `<span class="rank-bar"><span style="width:${Math.round((level / def.maxLevel) * 100)}%"></span></span>`;
  function upgradeCards() {
    const discount = S.upgradeDiscount();
    return UPGRADES.filter((u) => S.upgradeLevel(u.id) < u.maxLevel)
      .map((up) => {
        const level = S.upgradeLevel(up.id);
        const maxed = level >= up.maxLevel;
        const plan = S.purchasePlan(up, level, S.state.gold, discount);
        return `
      <button class="boon ${maxed ? 'max' : plan.affordable ? 'can' : ''}" data-action="buy-upgrade" data-id="${up.id}" data-tip="upg:${up.id}">
        ${rowIcon(`up:${up.id}`, up.type === 'mult' ? '×' : '+', up.type === 'mult' ? '#f472b6' : '#38bdf8')}
        <span class="boon-main">
          <span class="name">${esc(up.name)} <span class="muted">${level}/${up.maxLevel}</span> ${milestoneStar(up, level)}</span>
          <span class="sub">${effectText(up, level)}</span>
          <span class="ranks">${ranksHtml(up, level)}</span>
        </span>
        <span class="boon-cost">${maxed ? 'MAX' : `${plan.n > 1 ? `+${plan.n} · ` : ''}${goldAmt(plan.cost)}`}</span>
      </button>`;
      })
      .join('');
  }
  function perkCards() {
    const asc = S.state.ascension;
    return PERKS.filter((p) => S.perkLevel(p.id) < p.maxLevel)
      .map((perk) => {
        const level = S.perkLevel(perk.id);
        const maxed = level >= perk.maxLevel;
        const plan = S.purchasePlan(perk, level, asc.essence, 1, 1);
        const desc = perk.stat ? effectText(perk, level) : perk.desc;
        return `
      <button class="boon ${maxed ? 'max' : plan.affordable ? 'can' : ''}" data-action="buy-perk" data-id="${perk.id}" data-tip="perk:${perk.id}">
        ${rowIcon(`perk:${perk.id}`, '✦', '#a78bfa')}
        <span class="boon-main">
          <span class="name">${esc(perk.name)} <span class="muted">${level}/${perk.maxLevel}</span></span>
          <span class="sub">${desc}</span>
          <span class="ranks">${ranksHtml(perk, level)}</span>
        </span>
        <span class="boon-cost">${maxed ? 'MAX' : essenceAmt(plan.cost)}</span>
      </button>`;
      })
      .join('');
  }
  const PAGED = [
    { pager: 'upgrade-page', card: 'buy-upgrade', cards: upgradeCards },
    { pager: 'perk-page', card: 'buy-perk', cards: perkCards },
  ];
  // Where each window's list was scrolled to: the game's redraw puts five cards back first, which cuts the
  // scroll short before the full list returns
  const scrolled = new WeakMap();
  const onScroll = (e) => {
    if (e.target.classList?.contains('win-body')) scrolled.set(e.target, e.target.scrollTop);
  };
  layer.addEventListener('scroll', onScroll, true);
  function unpage() {
    for (const kind of PAGED) {
      for (const btn of layer.querySelectorAll(`.pager [data-action="${kind.pager}"]`)) {
        const pager = btn.closest('.pager');
        if (!pager?.isConnected) continue;
        const list = pager.parentElement;
        const body = pager.closest('.win-body');
        const old = [...list.querySelectorAll(`:scope > .boon[data-action="${kind.card}"]`)];
        let html;
        try {
          html = kind.cards();
        } catch (err) {
          console.warn('[left layout] Could not list every card; leaving the pages', err);
          continue;
        }
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        (old[0] ?? pager).before(tpl.content);
        for (const el of old) el.remove();
        pager.remove();
        if (body && scrolled.has(body)) body.scrollTop = scrolled.get(body);
      }
    }
  }

  // ---------- Watching the windows ----------
  const observer = new MutationObserver(() => {
    unpage();
    sync();
  });
  observer.observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  const onMedia = () => {
    sync();
    relayout();
  };
  wide.addEventListener('change', onMedia);
  unpage();
  sync();
  relayout();

  window.stopLeftLayout = () => {
    observer.disconnect();
    wide.removeEventListener('change', onMedia);
    layer.removeEventListener('scroll', onScroll, true);
    cancelAnimationFrame(slideFrame);
    document.body.classList.remove('ll-open');
    grip.remove();
    document.documentElement.style.removeProperty('--ll-w');
    style.remove();
    viewCentre.remove('leftLayout');
    dispatchEvent(new Event('resize'));
    delete window.stopLeftLayout;
    console.log('[left layout] Off. Upgrades and Perks go back to pages the next time the game redraws them.');
  };
  console.log('[left layout] On: the sidebar is on the left and windows slide out from there. Turn it off with stopLeftLayout()');
};

idleAnglerMods.define({
  id: 'leftLayout',
  order: 70,
  name: "Left-hand layout",
  desc: "The sidebar down the left edge, and windows that slide out from the left one at a time, moving the game over instead of covering it (the scene slides over whole, so your angler stays in view). Upgrades and Perks list every card instead of five a page",
  start: leftLayout,
  stop: 'stopLeftLayout',
});
}
})();
