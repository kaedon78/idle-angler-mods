// ==UserScript==
// @name         Idle Angler Mods
// @namespace    http://tampermonkey.net/
// @version      2026-11-25.1
// @description  Idle Angler's UI mods in one script, each switched on or off in the game's Settings > Mods
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/: edit those files, not this one.
//
// Idle Angler — UI mods, all in one script. Each one also comes as a script of its own (scripts/), to load only
// the ones you want; with this one too, a mod runs once. It adds a Mods tab to the game's Settings window (Esc),
// where each mod is turned on or off; that takes effect at once and is remembered in this browser. The mods:
//  - Zone Map: Every place in the world in a strip under the top bar: click one to go there
//  - Income Pills: Measured gold, fish, chests and XP a minute
//  - Auto-click: Clicks the water for you, 1-15 times a second
//  - Build Switcher: Press 1-5 to put on a saved gear set
//  - Weather Forecast: The weather hour by hour, day by day and by month: click the time and weather in the top bar, or press W
//  - Gear Judge: ▲ / ▼ on gear judged over a whole day of weather, or the time and weather you pick
//  - Quicklinks: A sidebar on the right edge, with a panel of what most needs you right now
//  - Left-hand Layout: The sidebar on the left, windows sliding out from there, no pages in Upgrades and Perks
//  - Stacked Names: Names on the water that would overlap stack in a column by gold leaderboard rank, with rank badges
//  - Company Online: A green dot by each company member online now, in the Company window
//  - Smooth Resizing: No light-blue flashes while the game resizes
//  - Fog to the Edge: In fog the haze covers the whole screen
//  - Spots on Time: A new fishing spot fades in when it appears, even on a device whose clock is behind
// Load it with Tampermonkey, or paste it into the DevTools console on https://idle-angler.onrender.com/; it waits
// for the game to be up. Pasting it again replaces the mods running. Stop everything (and remove the Mods tab) with:
//   stopIdleAnglerMods()

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
// Shared by the Gear judge and Quicklinks: what a chest's value starts from
//
// A chest's coin and treasure start from your catch value, and the builds differ on how: the live game
// (v1.7.0) starts from your fish value (stats.fishValue, or else the water's base value), the balance test
// build (v1.7.1) multiplies the water's base value by it (loot.js rollChestContents). This reads which off
// the game's own chest roll once, with your stats: the random spread of its coin (0.7-1.3) held at its
// middle for that one call (Math.random put back after), in the water whose base value is highest, so the
// two ways can't agree. Nothing is opened or sent.
// =====================================================================================================
function chestBaseRule({ rollChestContents, RARITIES, CHEST_GOLD, ZONES, stats }) {
  const zone = ZONES.reduce((a, z) => (z.baseValue > a.baseValue ? z : a));
  const tier = RARITIES.length - 1; // the biggest coin, so its rounding doesn't matter
  const random = Math.random;
  let gold;
  Math.random = () => 0.5;
  try {
    gold = rollChestContents(zone, tier, stats).gold;
  } finally {
    Math.random = random;
  }
  const base = gold / (RARITIES[tier].valueMult * CHEST_GOLD * stats.valueMult * (stats.chestValueMult ?? 1));
  const multiplies = Math.abs(base - (stats.fishValue ?? 1) * zone.baseValue) < Math.abs(base - (stats.fishValue ?? zone.baseValue));
  return (s, z) => (multiplies ? (s.fishValue ?? 1) * z.baseValue : s.fishValue ?? z.baseValue);
}

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
// the part you see instead (the camera easing over as it always does). Where the game's camera doesn't
// follow the boat (moored at the Pond's pier, the cabin framed) it stays put. It only moves what you see:
// nothing goes to the server.
// One for the page (kept on window), so two scripts that carry this don't wrap the game's methods twice.
// =====================================================================================================
const viewCentre = window.idleAnglerViewCentre ??= (() => {
  const users = new Set();
  const AIMED = ['followBoat', 'announce']; // the game's methods that aim for the middle of the screen
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
  // Each of these aims at the middle of the screen as L.SW / 2, and reads L.SW for nothing else: for the one
  // call, the screen is made twice as wide as the middle of the part you see
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
// =====================================================================================================
// Zone map strip (was zone-map.js)
//
// It adds a 60px strip across the screen under the top bar, in its colours, laid out like the game's world, left to
// right: the Basement and the Cabin, then every water from the Pond to the Cosmic Void, each cell
// showing a small copy of that place's scenery. (The Town and the Farm are left out while the game
// has them shelved.)
//  - where you are is highlighted, with a marker for your boat's position in the water you're on
//  - each water shows your species mastery there (★ steps reached out of 3 per species: catching a
//    species 10, 100 and 1,000 times); the Basement shows your Emberscale Shards, or, while its door
//    is still shut, how many ascensions it needs
//  - a ✦ on a water when a fish that only bites in the current weather or time of day is biting
//    there right now and you haven't caught it yet
//  - what a locked water needs: the boat's price (gold when you can afford it), Power or ascensions
// Hover a cell for details: every species in a water with its Power stars and its species mastery
// level (Lv 1-99, as in the Collection).
// Click a cell to go there: a water sails there (the game's own travel action, as Boat & Map's "Sail
// here"); the Basement and the Cabin walk you in with the game's own fade, from wherever you are
// (sailing back to the Pond first if needed). A water whose boat you can afford buys the boat and sails
// there (the game's own unlockZone, as its line map does); any other locked water opens Boat & Map,
// which says what it needs. A shut Basement does nothing until you have the ascensions;
// then it walks you into the Cabin, which is what opens its door.
// Stop it (and remove the strip) with:  stopZoneMap(), or untick it in Settings > Mods
// =====================================================================================================
const zoneMap = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { act } = await mod('/src/actions.js');
  const { ZONES, BOATS, RARITIES, FISH, SEA, POWER } = await mod('/src/data.js');
  const { money, fmtDec, hex } = await mod('/src/format.js');
  const { worldAt, conditionName } = await mod('/src/world.js');
  const { FishingScene } = await mod('/src/scene.js');
  const { Homestead } = await mod('/src/homestead.js');
  const { openWindow, toast } = await mod('/src/ui.js');
  const { describeBounty, bountyProgress } = await mod('/src/bounties.js');
  // Species mastery levels (1-99). A newer module, so the strip still works without it (no "Lv" then)
  const { masteryLevel } = await mod('/src/mastery.js').catch(() => ({}));
  const { MASTERY, DRACONIC } = await mod('/src/data.js');
  const MAX_LV = MASTERY?.maxLevel ?? 99;

  window.stopZoneMap?.(); // replace a strip already running

  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  if (!app || !topbar) return console.warn('[zone map] The game page was not found (#app / #topbar)');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tierColor = (t) => hex(RARITIES[t].color);
  const fishByZone = {};
  for (const f of FISH) (fishByZone[f.zone] ??= []).push(f);

  // ---------- The scene and the homestead ----------
  // main.js keeps both in local variables. Their classes are exported, though, so: the scene's
  // update() runs every frame, and wrapping it once (then putting it straight back) hands us the live
  // scene. The scene's onWalkIn() is main.js's `() => home.enter('cabin')`, so calling it while
  // Homestead.prototype.enter is briefly a no-op that records `this` hands us the live homestead,
  // without walking anywhere. From then on it's the game's own enter / arrive / leave.
  let scene = null;
  let home = null;
  const sceneProto = FishingScene.prototype;
  const sceneUpdate = sceneProto.update;
  sceneProto.update = function (dt) {
    scene = this;
    sceneProto.update = sceneUpdate;
    return sceneUpdate.call(this, dt);
  };
  const getHome = () => {
    if (home || !scene) return home;
    const enter = Homestead.prototype.enter;
    Homestead.prototype.enter = function () { home = this; };
    try { scene.onWalkIn(); } finally { Homestead.prototype.enter = enter; }
    return home;
  };
  const placeNow = () => scene?.place ?? 'dock'; // 'dock', 'cabin' or 'basement' ('garden', 'village': shelved)

  // ---------- Tooltip ----------
  // A lookalike of the game's (which only renders its own data-tip keys): same frame and tip classes.
  const tip = document.createElement('div');
  tip.id = 'zonemap-tip';
  tip.hidden = true;
  tip.style.cssText =
    'position:fixed;z-index:1000;max-width:min(440px,calc(100vw - 16px));padding:8px 12px;pointer-events:none;' +
    'font-family:var(--font);font-size:14px;line-height:1.35;color:var(--text);border:9px solid;' +
    'border-image:var(--fr-tip);box-shadow:0 6px 18px rgba(0,0,0,.6)';
  document.body.append(tip);
  const tips = new Map();
  const placeTip = (e) => {
    const pad = 14;
    const { width, height } = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + width > innerWidth - 8) x = Math.max(8, e.clientX - width - pad);
    if (y + height > innerHeight - 8) y = Math.max(8, e.clientY - height - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  // ---------- Strip ----------
  const style = document.createElement('style');
  style.id = 'zonemap-style';
  style.textContent = `
#zonemap{position:absolute;z-index:6;left:0;right:0;box-sizing:border-box;padding:4px 6px;
  display:flex;gap:2px;height:var(--zm-h,60px);font-family:var(--font);font-size:16px;line-height:1;color:var(--text);
  background:linear-gradient(rgba(14,10,10,.9),rgba(14,10,10,.72)); /* the top bar's own (#topbar::before) */
  pointer-events:none;user-select:none}
#zonemap .zm{position:relative;flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;
  padding:0 6px;overflow:hidden;white-space:nowrap;pointer-events:auto;cursor:pointer;isolation:isolate;
  --bg:none;background:var(--bg) center 72%/cover no-repeat,linear-gradient(var(--sky),var(--water));
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.55);
  text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000}
#zonemap .zm.land{flex-grow:.8}
#zonemap .zm.shore{margin-right:6px}#zonemap .zm::before{content:'';position:absolute;inset:0;background:rgba(8,13,8,.3);z-index:-1}
#zonemap .zm:hover::before{background:rgba(8,13,8,.08)}
#zonemap .zm.here{box-shadow:inset 0 0 0 2px #fde68a}
#zonemap .zm.here::before{background:rgba(8,13,8,.08)}
#zonemap .zm.here .nm{color:#fde68a}
#zonemap .zm.locked{filter:grayscale(.7) brightness(.75)}
#zonemap .zm.hidden{filter:grayscale(1) brightness(.5);cursor:default}
#zonemap .zm .nm{font-weight:700;overflow:hidden;text-overflow:ellipsis}
#zonemap .zm .dot{flex:none;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 1px #000}
#zonemap .zm .pill{flex:none;padding:2px 5px;font-weight:700;background:rgba(0,0,0,.65);box-shadow:0 0 0 1px rgba(0,0,0,.4)}
#zonemap .zm .boat{position:absolute;bottom:1px;width:0;height:0;margin-left:-4px;border:4px solid transparent;
  border-bottom:5px solid #fde68a;border-top:0;transition:left 1s linear;filter:drop-shadow(0 0 1px #000)}
/* The game's own line of places (nav#metro) does the same job under the top bar, so it's hidden while the strip shows
   (it's absolutely placed: nothing moves). This style goes when the strip stops, and it comes back. */
#metro{display:none !important}
#scene-hud > .hud-where{margin-top:calc(var(--topbar-h) * var(--ui-scale) + var(--zm-h,60px) + 4px)}
#conn-status:not(.replaced, .kicked){top:calc(var(--topbar-h) * var(--ui-scale) + var(--zm-h,60px) + 14px)}
#zonemap-tip .zm-fish{display:grid;grid-template-columns:auto auto 1fr;column-gap:10px;align-items:baseline}
#zonemap-tip .zm-stars{color:#fde047;letter-spacing:1px}
@media (max-width:1000px){#zonemap .zm .sub{display:none}}
@media (max-width:640px){#zonemap .zm .nm{display:none}#zonemap .zm::after{content:attr(data-n);font-weight:700}}`;
  document.head.append(style);

  const strip = document.createElement('div');
  strip.id = 'zonemap';
  app.append(strip);
  // Right under the top bar, wherever the game's layout and UI scale put it, in the top bar's colours so
  // the two read as one band. HEIGHT goes in --zm-h on the page, which also pushes the game's place label
  // and connection notice down below the strip.
  const HEIGHT = 60;
  const root = document.documentElement;
  const place = () => {
    const a = app.getBoundingClientRect(), t = topbar.getBoundingClientRect();
    strip.style.top = `${t.bottom - a.top}px`;
    const h = `${HEIGHT}px`;
    if (root.style.getPropertyValue('--zm-h') !== h) root.style.setProperty('--zm-h', h);
  };

  // Land first, then the waters. The Basement is left of the Cabin, behind its left door, as in the game.
  // The Town and the Farm aren't listed: the game has shelved them (data.js SHELVED), so no door leads there.
  const LAND = [
    { place: 'basement', name: 'Basement', short: 'B', sky: '#3a1f2a', water: '#1a0f0c' },
    { place: 'cabin', name: 'Cabin', short: 'C', sky: '#b58654', water: '#5c3b20' },
  ];
  const DRACONIC_AT = DRACONIC?.requirement ?? 50; // ascensions that open the basement door
  const basementOpen = () => Boolean(S.state.draconic?.basement);
  const LAND_ORDER = LAND.map((l) => l.place);
  const makeCell = (n, sky, water, onClick) => {
    const el = document.createElement('div');
    el.className = 'zm';
    el.dataset.n = n;
    el.style.setProperty('--sky', sky);
    el.style.setProperty('--water', water);
    el.addEventListener('pointerenter', (e) => { tip.innerHTML = tips.get(el) ?? ''; tip.hidden = !tip.innerHTML; placeTip(e); });
    el.addEventListener('pointermove', placeTip);
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.addEventListener('click', onClick);
    strip.append(el);
    return el;
  };
  const landCells = LAND.map((l) => makeCell(l.short, l.sky, l.water, () => goLand(l.place)));
  for (const el of landCells) el.classList.add('land');
  landCells.at(-1).classList.add('shore');
  const cells = ZONES.map((zone) => makeCell(zone.index + 1, hex(zone.sky), hex(zone.water), () => goZone(zone)));

  // ---------- Pictures ----------
  // Each cell's background is a small copy of that place's scenery, painted from the game's own
  // pictures the way the scene lays them out (backdrops.js: the painted layers, their waterline rows,
  // tints and haze; seascape.js: the drawn scenery of the Abyss and the Void). It's painted once for
  // an imaginary 1920 x 900 window, keeping the band around the horizon: the sky in the zone's own
  // colours (not the time of day or the weather), the water below it.
  const { BACKDROPS } = await mod('/src/backdrops.js').catch(() => ({}));
  const { drawBackdrop } = await mod('/src/seascape.js').catch(() => ({}));
  const PX = 2; // one picture pixel is two screen pixels in the game
  const VW = 1920, VH = 900, WATER = 504; // the game puts the waterline 56% of the way down
  const TOP = 120, BOTTOM = 600, OUT = 0.25; // the band kept, and how far it's scaled down
  const rgb = (c, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
  const mix = (a, b, f) => [16, 8, 0].reduce((o, s) => o | (Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f) << s), 0);
  const images = new Map();
  const img = (src) => {
    if (!images.has(src)) {
      images.set(src, new Promise((ok) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => ok(null);
        i.src = src;
      }));
    }
    return images.get(src);
  };
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  // A picture recoloured: its shape in one colour (haze) or multiplied by a colour (tint)
  const recolor = (pic, color, mode) => {
    const c = canvas(pic.width, pic.height), g = c.getContext('2d');
    g.drawImage(pic, 0, 0);
    g.globalCompositeOperation = mode;
    g.fillStyle = rgb(color);
    g.fillRect(0, 0, c.width, c.height);
    if (mode === 'multiply') { g.globalCompositeOperation = 'destination-in'; g.drawImage(pic, 0, 0); }
    return c;
  };
  const crop = (pic, x, y, w, h) => { const c = canvas(w, h); c.getContext('2d').drawImage(pic, x, y, w, h, 0, 0, w, h); return c; };
  // A picture repeated across the window (as the game's TilingSprites), top edge at y, kept between top and bottom
  const band = (g, pic, y, { alpha = 1, top = -Infinity, bottom = Infinity, repeat = 'repeat-x', rows = pic.height } = {}) => {
    const y0 = Math.max(y, top, TOP), y1 = Math.min(y + rows * PX, bottom, BOTTOM);
    if (y1 <= y0) return;
    const p = g.createPattern(pic, repeat);
    p.setTransform(new DOMMatrix([PX, 0, 0, PX, 0, y]));
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = p;
    g.fillRect(0, y0, VW, y1 - y0);
    g.restore();
  };
  const skyFill = (g, color, to) => {
    const s = g.createLinearGradient(0, 0, 0, to);
    s.addColorStop(0, rgb(mix(0, color, 0.75)));
    s.addColorStop(1, rgb(color));
    g.fillStyle = s;
    g.fillRect(0, 0, VW, to + 1);
  };
  // Enough of Pixi's Graphics for seascape.js's drawBackdrop: a shape, then fill() or stroke()
  const pen = (g) => {
    let path = new Path2D();
    const shape = (f) => { path = new Path2D(); f(path); return o; };
    const style = (s) => (typeof s === 'object' ? s : { color: s });
    const o = {
      clear: () => o,
      rect: (x, y, w, h) => shape((p) => p.rect(x, y, w, h)),
      circle: (x, y, r) => shape((p) => p.arc(x, y, r, 0, Math.PI * 2)),
      ellipse: (x, y, rx, ry) => shape((p) => p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)),
      fill: (s) => { const { color = 0, alpha = 1 } = style(s); g.fillStyle = rgb(color, alpha); g.fill(path); return o; },
      stroke: (s) => { const { width = 1, color = 0, alpha = 1 } = style(s); g.lineWidth = width; g.strokeStyle = rgb(color, alpha); g.stroke(path); return o; },
    };
    return o;
  };
  const paintZone = async (g, zone) => {
    const cfg = BACKDROPS?.[zone.id] ?? {};
    skyFill(g, zone.sky, WATER);
    if (drawBackdrop && (!cfg.above?.length || cfg.drawn)) drawBackdrop(pen(g), zone.id, { W: VW, H: VH, VW, cut: 0, waterY: WATER });
    for (const layer of cfg.above ?? []) {
      const pic = await img(layer.src);
      if (!pic) continue;
      let y = layer.sky ? 0 : WATER - (layer.base + 1) * PX;
      if (layer.cover) y = Math.min(y, 0);
      band(g, pic, y, { alpha: layer.alpha ?? 1, bottom: WATER + PX });
      if (layer.haze) band(g, recolor(pic, zone.sky, 'source-in'), y, { alpha: layer.haze, bottom: WATER + PX });
    }
    const water = g.createLinearGradient(0, WATER, 0, BOTTOM);
    water.addColorStop(0, rgb(mix(zone.water, 0xffffff, 0.2)));
    water.addColorStop(1, rgb(mix(0, zone.water, 0.7)));
    g.fillStyle = water;
    g.fillRect(0, WATER, VW, VH - WATER);
    g.fillStyle = rgb(0xffffff, 0.3);
    g.fillRect(0, WATER, VW, 2 * PX); // the surface
    for (const layer of cfg.below ?? []) {
      let pic = await img(layer.src);
      if (!pic) continue;
      if (layer.tint != null) pic = recolor(pic, layer.tint, 'multiply');
      const y = VH - (layer.base + 1) * PX;
      band(g, pic, y, { alpha: layer.alpha ?? 1, top: WATER + 2 * PX });
      if (layer.poke) band(g, pic, y, { bottom: WATER }); // what breaks the surface, solid
    }
  };
  // The homestead: the Basement's cellar round the Altar's crystal (homestead.js drawBasement), the Cabin's
  // plank wall, beams and furniture (its "Quiet Cabin" sheets)
  const DAY_SKY = 0x8fc6ee;
  const GROUND = 540;
  const sprite = (g, pic, x, bottom, [sx, sy, sw, sh] = [0, 0, pic.width, pic.height]) =>
    g.drawImage(pic, sx, sy, sw, sh, x, bottom - sh * PX, sw * PX, sh * PX);
  const paintLand = {
    async basement(g) {
      const ceiling = GROUND - 150 * PX;
      const footing = GROUND - 22 * PX;
      // Overhead, the cabin's floorboards seen from below; damp planks, a fieldstone footing, a dirt floor
      for (let y = 0, i = 0; y < ceiling; y += 4 * PX, i++) { g.fillStyle = rgb(i % 2 ? 0x241510 : 0x2b1a12); g.fillRect(0, y, VW, 4 * PX); }
      const wall = await img('/assets/cabin/qc-wall.png');
      if (wall) band(g, recolor(crop(wall, 16, 16, 96, 96), 0x9a8078, 'multiply'), ceiling, { repeat: 'repeat', rows: (footing - ceiling) / PX });
      else { g.fillStyle = rgb(0x2a1c18); g.fillRect(0, ceiling, VW, footing - ceiling); }
      g.fillStyle = rgb(0x1c1916);
      g.fillRect(0, footing, VW, GROUND - footing);
      for (let row = 0; row < 3; row++) {
        for (let x = -row * 9 * PX, i = 0; x < VW; i++) {
          const w = (8 + ((row * 7 + i * 5) % 10)) * PX;
          g.fillStyle = rgb([0x4a443e, 0x554d45, 0x3e3934, 0x504840][(row + i) % 4]);
          g.fillRect(x + PX, footing + row * 7 * PX + PX, w - PX, 6 * PX);
          x += w;
        }
      }
      g.fillStyle = rgb(0x2a1f17);
      g.fillRect(0, GROUND, VW, VH - GROUND);
      // The Altar's crystal in the middle, the only light: everything else fades into the dark
      const cx = VW / 2, cy = GROUND - 30 * PX;
      const crystal = await img('/assets/cabin/crystal-dark.png');
      if (crystal) sprite(g, crystal, cx - 16 * PX, GROUND, [0, 0, 32, 32]); // the first frame of its glint
      // (Lighter than the game's darkness, so the room still reads at the strip's size)
      const dark = g.createRadialGradient(cx, cy, 60 * PX, cx, cy, 520 * PX);
      dark.addColorStop(0, 'rgba(8,4,10,0)');
      dark.addColorStop(1, 'rgba(8,4,10,.45)');
      g.fillStyle = dark;
      g.fillRect(0, 0, VW, VH);
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 120 * PX);
      glow.addColorStop(0, 'rgba(217,70,239,.55)');
      glow.addColorStop(1, 'rgba(124,58,237,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, VW, VH);
    },
    async cabin(g) {
      const ceiling = GROUND - 140 * PX;
      g.fillStyle = rgb(0x22130f);
      g.fillRect(0, 0, VW, ceiling); // the roof space, with its rafters
      g.fillStyle = rgb(0x3a2219);
      for (let x = 115; x < VW; x += 345) g.fillRect(x, 0, 8 * PX, ceiling);
      g.fillStyle = rgb(0x2e1a17);
      g.fillRect(0, ceiling, VW, GROUND - ceiling);
      for (let y = GROUND, i = 0; y < VH; y += 6 * PX, i++) { g.fillStyle = rgb(i % 2 ? 0x5a3328 : 0x63392d); g.fillRect(0, y, VW, 6 * PX); }
      const [wall, wood, objects] = await Promise.all(['wall', 'wood', 'objects'].map((n) => img(`/assets/cabin/qc-${n}.png`)));
      if (wall) band(g, crop(wall, 16, 16, 96, 96), ceiling, { repeat: 'repeat', rows: (GROUND - ceiling) / PX });
      if (wood) {
        const beam = crop(wood, 16, 80, 48, 16);
        band(g, beam, ceiling);
        band(g, beam, GROUND - 2 * PX);
      }
      if (objects) {
        g.fillStyle = rgb(DAY_SKY, 0.6);
        g.fillRect(860 + 3 * PX, 300 + 4 * PX, 58 * PX, 22 * PX); // the view through the window
        sprite(g, objects, 860, 300 + 28 * PX, [16, 66, 64, 28]);
        sprite(g, objects, 1240, GROUND + 2 * PX, [16, 129, 80, 31]); // the bed
        sprite(g, objects, 520, GROUND + 2 * PX, [81, 68, 30, 28]); // a dresser
      }
    },
  };
  let stopped = false;
  const urls = [];
  const paint = async (el, fn) => {
    try {
      const c = canvas(Math.round(VW * OUT), Math.round((BOTTOM - TOP) * OUT));
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.scale(OUT, OUT);
      g.translate(0, -TOP);
      await fn(g);
      const blob = await new Promise((ok) => c.toBlob(ok));
      if (!blob || stopped) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      el.style.setProperty('--bg', `url(${url})`);
    } catch (e) {
      console.warn("[zone map] Couldn't paint a picture:", e); // the cell keeps its plain colours
    }
  };
  LAND.forEach((l, i) => paint(landCells[i], paintLand[l.place]));
  ZONES.forEach((zone, i) => paint(cells[i], (g) => paintZone(g, zone)));

  // ---------- Mastery ----------
  // POWER.mastery: catching a species 10, 100 and 1,000 times each adds Power (data.js).
  const STEPS = POWER.mastery.map((m) => m.at);
  const masteryOf = (n) => STEPS.filter((at) => n >= at).length;
  const stars = (lvl) => `<span class="zm-stars">${'★'.repeat(lvl)}<span style="opacity:.35">${'★'.repeat(STEPS.length - lvl)}</span></span>`;

  // ---------- Rendering ----------
  const setHtml = (el, html) => {
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  };
  // The boat's place along the current water, kept 6px in from the cell's ends so it never gets clipped
  const boatLeft = () => {
    const f = Math.min(1, Math.max(0, S.boatX() / SEA.length));
    return `calc(6px + (100% - 12px) * ${f.toFixed(3)})`;
  };

  const renderLand = (where) => {
    const tipEnd = (l) => `<div class="tip-sep"></div><div class="muted">${where === l.place ? "You're here." : `Click to go to the ${l.name}.`}</div>`;
    LAND.forEach((l, i) => {
      const el = landCells[i];
      el.classList.toggle('here', where === l.place);
      let sub = '';
      let body = '';
      let end = tipEnd(l);
      if (l.place === 'cabin') {
        body = '<div>Your home by the Pond. Fishing carries on, idle, while you\'re here.</div>';
      } else {
        // The basement: shut until the door opens for good, the first time you walk into the cabin with
        // DRACONIC_AT ascensions (main.js basementRumble)
        const asc = S.state.ascension.count;
        const open = basementOpen();
        el.classList.toggle('locked', !open);
        const shards = S.state.draconic?.shards ?? 0;
        if (open) {
          if (shards) sub = `<span class="sub pill"><span style="color:#f0abfc">◆</span>${fmtDec(shards)}</span>`;
          body =
            "<div>The Draconic Altar <span class=\"muted\">· Draconic ascension and Emberscale Shard upgrades</span></div>" +
            `<div>${fmtDec(shards)} Emberscale Shard${shards === 1 ? '' : 's'} · ${fmtDec(S.state.draconic?.count ?? 0)} Draconic ascension${S.state.draconic?.count === 1 ? '' : 's'}</div>`;
        } else if (asc >= DRACONIC_AT) {
          sub = '<span class="pill" style="color:#fde047">Ready</span>';
          body = `<div>You have ${fmtDec(asc)} ascensions: the door under the cabin opens the next time you walk in.</div>`;
          end = '<div class="tip-sep"></div><div class="muted">Click to walk into the Cabin and open it.</div>';
        } else {
          sub = `<span class="pill"><span style="color:#fca5a5">Asc ${fmtDec(asc)}/${DRACONIC_AT}</span></span>`;
          body = `<div style="color:#fca5a5">Opens at ${DRACONIC_AT} ascensions <span class="muted">(you have ${fmtDec(asc)})</span></div>`;
          end = '';
        }
      }
      setHtml(el, `<span class="nm">${l.name}</span>${sub}`);
      tips.set(el, `<div class="tip-title">The ${l.name}</div>${body}${end}`);
    });
  };

  // Your bounties tied to one water (rarity, zone and species jobs carry a zone; the rest can be done anywhere)
  const bountiesByZone = () => {
    const out = {};
    for (const b of S.state.bounties?.slots ?? []) if (b?.zone) (out[b.zone] ??= []).push(b);
    return out;
  };

  const render = () => {
    place();
    const st = S.state;
    const w = worldAt();
    const power = S.power();
    const where = placeNow();
    const quests = bountiesByZone();
    renderLand(where);
    ZONES.forEach((zone, i) => {
      const el = cells[i];
      const status = S.zoneStatus(zone);
      const here = where === 'dock' && st.zone === zone.id;
      const hidden = status === 'hidden';
      el.classList.toggle('here', here);
      el.classList.toggle('hidden', hidden);
      el.classList.toggle('locked', !hidden && status !== 'unlocked');
      if (hidden) {
        setHtml(el, '<span class="nm">???</span>');
        tips.set(el, `<div class="tip-title">???</div><div class="muted">Buy the boat for the water before it first.</div>`);
        return;
      }

      const fish = fishByZone[zone.id] ?? [];
      const count = (f) => st.collection.fish[f.id] || 0;
      const levels = fish.reduce((a, f) => a + masteryOf(count(f)), 0);
      const maxLevels = fish.length * STEPS.length;
      const isNow = (f) => f.when === w.weather.id || f.when === w.phase.id;
      const newNow = fish.filter((f) => f.when && isNow(f) && !count(f));

      let need = '';
      if (status === 'buyable') need = `<span style="color:${st.gold >= zone.unlockCost ? '#fde047' : '#fca5a5'}">${esc(money(zone.unlockCost))}</span>`;
      else if (status === 'needsPower') need = `<span style="color:#fca5a5">Power ${fmtDec(zone.powerReq)}</span>`;
      else if (status === 'needsAscension') need = `<span style="color:#fca5a5">Asc ${zone.ascensionReq}</span>`;

      const star = newNow.length ? `<span style="color:${tierColor(Math.max(...newNow.map((f) => f.tier)))}">✦</span>` : '';
      const sub = need ? `<span class="pill">${need}</span>` : `<span class="sub pill"><span style="color:#fde047">★</span>${levels}/${maxLevels}</span>`;
      const zq = quests[zone.id] ?? []; // listed in the tooltip (no marker on the cell for now)
      // The dot is the rarest fish the water holds, in that rarity's colour. Rebuilt only when the text
      // changes, so the boat marker's transition isn't restarted every second.
      setHtml(el, `<span class="dot" style="background:${tierColor(zone.maxTier)}"></span><span class="nm">${esc(zone.name)}</span>${star}${sub}`);
      const b = el.querySelector('.boat');
      if (here && zone.index > 0) {
        if (b) b.style.left = boatLeft();
        else el.insertAdjacentHTML('beforeend', `<span class="boat" style="left:${boatLeft()}"></span>`);
      } else b?.remove();

      // Tooltip: every species with its mastery
      const vessel = BOATS[zone.index];
      const rows = [];
      rows.push(`<div>${vessel ? `<b>${esc(vessel.name)}</b> <span class="muted">· ${esc(vessel.desc)}</span>` : '<b>Cabin</b> <span class="muted">· your own walkway</span>'}</div>`);
      rows.push(`<div>Up to <b style="color:${tierColor(zone.maxTier)}">${RARITIES[zone.maxTier].name}</b> fish · mastery <b>${levels}</b> of ${maxLevels} ★</div>`);
      if (status === 'buyable') rows.push(`<div>Boat: <b>${esc(money(zone.unlockCost))}</b>${st.gold >= zone.unlockCost ? '' : ' <span class="muted">(not enough gold yet)</span>'}</div>`);
      if (status === 'needsPower') rows.push(`<div style="color:#fca5a5">Needs ${fmtDec(zone.powerReq)} Power <span class="muted">(you have ${fmtDec(power)})</span></div>`);
      if (status === 'needsAscension') rows.push(`<div style="color:#fca5a5">Needs ${zone.ascensionReq} ascension${zone.ascensionReq > 1 ? 's' : ''}</div>`);
      if (zq.length) {
        rows.push('<div class="tip-sep"></div><div class="tip-head">Bounties here</div>');
        for (const b of zq) {
          const have = bountyProgress(b, st.lifetimeGold);
          rows.push(
            `<div><span class="zm-stars">${'★'.repeat(b.stars ?? 0)}</span> ${esc(describeBounty(b, fmtDec))} · ` +
            (have >= b.need ? '<b style="color:#86efac">done, claim it</b>' : `<span class="muted">${fmtDec(have)} / ${fmtDec(b.need)}</span>`) +
            '</div>',
          );
        }
      }
      rows.push('<div class="tip-sep"></div><div class="zm-fish">');
      // Each species: its Power stars, then its species mastery level (1-99, the Collection's "Lv")
      for (const f of fish) {
        const n = count(f);
        const when = f.when ? ` <span class="muted">· ${esc(conditionName(f.when))}</span>${isNow(f) ? ' · <b>biting now</b>' : ''}` : '';
        const lv = masteryLevel?.(f, n) ?? 0;
        const level = !n ? '<b>not caught yet</b>' : lv ? `<span${lv >= MAX_LV ? ' style="color:#fde047"' : ''}>Lv ${lv}</span>` : '';
        rows.push(`<span style="color:${tierColor(f.tier)}">${esc(f.name)}${when}</span>${stars(masteryOf(n))}${level}`);
      }
      rows.push('</div>');
      const hint = here
        ? 'You are fishing here.'
        : status === 'unlocked'
          ? 'Click to sail here.'
          : status === 'buyable' && st.gold >= zone.unlockCost
            ? `Click to buy the boat for ${esc(money(zone.unlockCost))} and sail here.`
            : 'Click to open Boat &amp; Map.';
      rows.push(`<div class="tip-sep"></div><div class="muted">${hint}</div>`);
      tips.set(el, `<div class="tip-title" style="color:${tierColor(zone.maxTier)}">${zone.index + 1}. ${esc(zone.name)}</div>${rows.join('')}`);
    });
    for (const el of [...landCells, ...cells]) if (!tip.hidden && el.matches(':hover')) tip.innerHTML = tips.get(el);
  };

  // ---------- Going places ----------
  const travel = async (id) => {
    const ok = await act(S.game, 'travel', { id });
    if (!ok) console.warn(`[zone map] Couldn't sail to ${id}`);
    render();
    return ok;
  };

  const goZone = async (zone) => {
    const status = S.zoneStatus(zone);
    if (status === 'hidden') return;
    // A boat you can afford is bought on the click, as the game's own line map does (ui.js): unlockZone
    // takes the gold and sails you there. Anything else locked opens Boat & Map, which says what it needs.
    const buy = status === 'buyable' && S.state.gold >= zone.unlockCost;
    if (status !== 'unlocked' && !buy) return openWindow('zones');
    const go = async () => {
      if (buy) {
        if (await act(S.game, 'unlockZone', { id: zone.id })) toast(`Bought a ${BOATS[zone.index]?.name ?? 'boat'}! Sailing to ${zone.name}.`);
        else console.warn(`[zone map] Couldn't buy the boat for ${zone.id}`);
        render();
      } else if (S.state.zone !== zone.id) await travel(zone.id);
    };
    const h = placeNow() !== 'dock' ? getHome() : null;
    if (h?.place) {
      // Out of the homestead first (the game's fade), then buy or sail
      if (h.busy) return;
      h.fadeTo(() => {
        h.leave();
        go();
        render();
      });
      return;
    }
    await go();
  };

  const goLand = async (target) => {
    // A shut basement: the Cabin opens it once there are enough ascensions (the game's own walk-in)
    if (target === 'basement' && !basementOpen()) {
      if (S.state.ascension.count < DRACONIC_AT) return;
      target = 'cabin';
    }
    const h = getHome();
    if (!h) return console.warn("[zone map] The game's scene hasn't drawn a frame yet; try again in a moment");
    if (h.busy || h.place === target) return;
    if (h.place) {
      // Between two homestead places: fade straight there, coming in through the door on the side
      // you came from (the Basement is left of the Cabin: its stairs come up through the Cabin's left door)
      const from = LAND_ORDER.indexOf(target) < LAND_ORDER.indexOf(h.place) ? 1 : -1;
      h.fadeTo(() => { h.arrive(target, from); render(); });
      return;
    }
    // From the water: the homestead is reached from the Pond, so sail back there first
    if (S.state.zone !== 'pond' && !(await travel('pond'))) return;
    h.enter(target);
  };

  render();
  const timer = setInterval(render, 1000);
  // A resize can move a cell out from under the pointer without a pointerleave, so drop the tooltip
  const onResize = () => { tip.hidden = true; place(); };
  addEventListener('resize', onResize);

  window.stopZoneMap = () => {
    clearInterval(timer);
    stopped = true;
    for (const url of urls) URL.revokeObjectURL(url);
    if (sceneProto.update !== sceneUpdate) sceneProto.update = sceneUpdate; // no frame drawn yet
    removeEventListener('resize', onResize);
    strip.remove();
    tip.remove();
    style.remove();
    root.style.removeProperty('--zm-h');
    delete window.stopZoneMap;
  };
};

idleAnglerMods.define({
  id: 'zoneMap',
  order: 10,
  name: "Zone map strip",
  desc: "A strip under the top bar with every place in the world: click one to go there. It shows your boat, your species mastery, ripe crops and missing fish that are biting now",
  start: zoneMap,
  stop: 'stopZoneMap',
});
}

{
// =====================================================================================================
// Income pills (was gold-income-logger.js; its auto-clicker is the Auto-click mod now)
//
// Every minute (or every 5, 15 or 30 s: "Measure over" in Settings > Mods) it measures, over that time,
// the gold you actually earned, the fish you caught, the chests you found and the XP you gained, each
// per minute (as the game's own Gold / min at the top left, which is its estimate for idle fishing). They
// show as pills at the top of the Quicklinks panel while it's on, or else in the top bar to the right of
// your Emberscales (styled like the game's own +X/min pill). Hover a pill for details; the fish pill breaks the catch down by rarity. A shaded bar
// in each pill shrinks as the time runs out, and changing your equipped gear starts it over.
// Stop it (and remove the pills) with:  stopGoldLogger(), or untick it in Settings > Mods
//
// How it works: it samples counters the game only ever adds to:
//  - state.lifetimeGold (bumped in earn()): spending, upgrades and ascending don't touch it, so
//    the delta is pure income. Money is stored in copper (100c = 1s, 100s = 1g).
//  - state.stats.fishCaught (bumped per fish in addCatches()): the "Fish caught" stat. A
//    multi-catch cast adds one per fish; chests and items caught don't count.
//    state.stats.casts is sampled too, for the fish-per-cast figure.
//  - state.collection.fish (times caught per species, kept forever): summed by each species'
//    rarity from the game's FISH table, for the per-rarity breakdown.
//  - state.stats.chestsFound (bumped when a catch is a chest): the "Chests found" stat. It counts
//    chests caught while fishing, not ones from bounty/company rewards or the shop, and opening
//    chests doesn't lower it.
//  - state.player.totalXp (bumped in gainXp()): kept forever, so levelling up and ascending
//    don't reset it.
// =====================================================================================================
const incomePills = async () => {
  // How long each reading measures over: the "Measure over" choice in Settings > Mods (this mod's option),
  // kept in this browser. A change comes in through window.setGoldLoggerPeriod (below), which starts the
  // measuring over without restarting the mod.
  let PERIOD_MS = (() => {
    try {
      const ms = Number(localStorage.getItem('idle-angler-income-period'));
      return [5_000, 15_000, 30_000, 60_000].includes(ms) ? ms : 60_000;
    } catch {
      return 60_000;
    }
  })();

  // window.game only exists for admins/localhost, so import the game's own modules instead.
  // ES modules are singletons per URL, so this returns the live instance the game is using.
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { money, moneyRateHtml, fmtDec, fmtDecHtml, hex } = await mod('/src/format.js');
  const { CHEST_ICON, FISH_SHEET, cellStyle } = await mod('/src/art.js');
  const { FISH, RARITIES } = await mod('/src/data.js');

  window.stopGoldLogger?.(); // replace any logger already running

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
  tip.id = 'measured-tip';
  tip.hidden = true;
  tip.style.cssText =
    'position:fixed;z-index:1000;max-width:min(500px,calc(100vw - 16px));padding:8px 12px;pointer-events:none;' +
    'font-family:var(--font);font-size:14px;line-height:1.35;color:var(--text);border:9px solid;' +
    'border-image:var(--fr-tip);box-shadow:0 6px 18px rgba(0,0,0,.6)';
  document.body.append(tip);
  const tips = new Map(); // pill -> html
  const placeTip = (e) => {
    const pad = 14;
    const { width, height } = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + width > innerWidth - 8) x = Math.max(8, e.clientX - width - pad);
    if (y + height > innerHeight - 8) y = Math.max(8, e.clientY - height - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const attachTip = (pill) => {
    pill.addEventListener('pointerenter', (e) => { tip.innerHTML = tips.get(pill); tip.hidden = false; placeTip(e); });
    pill.addEventListener('pointermove', placeTip);
    pill.addEventListener('pointerleave', () => { tip.hidden = true; });
  };
  const setTip = (pill, html) => {
    tips.set(pill, html);
    if (!tip.hidden && pill.matches(':hover')) tip.innerHTML = html; // refresh if it's open
  };

  // ---------- Pills ----------
  // A .currency wrapper (for the bar's spacing) holding span.rate pills, the same class the game
  // uses for its calculated +X/s, so they inherit that styling.
  // Countdown shading: a bar behind each pill's contents that shrinks from full width to nothing
  // over one measuring window, so the shaded part is the time left until the next reading. It is a
  // CSS transform animation (no per-frame JS); every reading rebuilds the pill, which drops in a
  // fresh bar and so restarts it. inset:1px keeps the pill's outline visible over the bar.
  const style = document.createElement('style');
  style.id = 'measured-style';
  style.textContent =
    '#measured-rate-wrap .rate{position:relative;overflow:hidden;isolation:isolate}' +
    '.measured-countdown{position:absolute;inset:1px;z-index:-1;border-radius:inherit;pointer-events:none;' +
    'transform-origin:left center;background:rgba(155,227,106,.4);animation:measured-countdown 60s linear forwards}' +
    '@keyframes measured-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
    // In the Quicklinks panel: the top bar's .currency and .rate rules (ui.css scopes them to #topbar)
    '#qs-pills #measured-rate-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0;' +
    'font:600 17px var(--num);font-variant-numeric:lining-nums tabular-nums;text-shadow:1px 1px 0 #000}' +
    '#qs-pills .rate{padding:1px 8px;font-size:15px;font-weight:500;color:#c6f29a;text-shadow:none;' +
    'background:rgba(10,18,8,.6);border-radius:999px;box-shadow:inset 0 0 0 1px rgba(155,227,106,.4)}' +
    '#qs-pills .rate .per{color:#8fbf6c}';
  document.head.append(style);
  // Each bar runs for the period in use when it's made (it can change: setGoldLoggerPeriod)
  const countdownBar = () => {
    const bar = Object.assign(document.createElement('span'), { className: 'measured-countdown' });
    bar.style.animationDuration = `${PERIOD_MS}ms`;
    return bar;
  };

  const ember = document.getElementById('emberscales')?.closest('.currency');
  const wrap = document.createElement('div');
  wrap.className = 'currency';
  wrap.id = 'measured-rate-wrap';
  const makePill = (id, withIcon) => {
    const pill = document.createElement('span');
    pill.className = 'rate';
    pill.id = id;
    pill.innerHTML = '<span class="per">measuring…</span>';
    pill.append(countdownBar());
    if (withIcon) pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px';
    tips.set(pill, `<div class="tip-title">Measuring…</div><div class="muted">First reading ${PERIOD_MS / 1000} s after starting, then every ${PERIOD_MS / 1000} s.</div>`);
    attachTip(pill);
    return pill;
  };
  const goldPill = makePill('measured-rate');
  const fishPill = makePill('measured-fish-rate', true);
  const chestPill = makePill('measured-chest-rate', true);
  const xpPill = makePill('measured-xp-rate');
  const pills = [goldPill, fishPill, chestPill, xpPill];
  wrap.append(...pills);
  // The pills: at the top of the Quicklinks panel while it's running (it sends idle-angler-quicklinks as it
  // starts and stops), else in the top bar right of the Emberscales. Moving a node restarts its CSS
  // animation, so the countdown bars are set back to the time already measured.
  const placePills = () => {
    const host = document.getElementById('qs-pills');
    if (host ? wrap.parentElement === host : !ember || (wrap.parentElement && wrap.previousElementSibling === ember)) return;
    if (host) host.append(wrap);
    else ember.after(wrap);
    const done = performance.now() - last.t;
    for (const bar of wrap.querySelectorAll('.measured-countdown')) bar.style.animationDelay = `-${Math.round(done)}ms`;
  };
  if (!ember) console.warn('[gold/s] Emberscales counter not found: the rate pills show only in Quicklinks');

  // Icons: the game's chest sprite, and a Carp (index 57) cut from the fish sprite sheet. Carp is
  // chunky and orange, so it stays readable at pill size where slimmer fish turn into a line.
  const chestImg = `<img src="${CHEST_ICON.url}" alt="chests" style="width:${CHEST_ICON.width}px;height:${CHEST_ICON.height}px;image-rendering:pixelated" />`;
  const fishImg = `<span aria-label="fish" style="display:inline-block;image-rendering:pixelated;${cellStyle(FISH_SHEET, 57, 22)}"></span>`;
  const iconRate = (icon, n) => `${icon}<span><span class="num">${fmtRate(n)}</span><span class="per">/min</span></span>`; // n: a minute

  // ---------- Sampling ----------
  const tierOf = new Map(FISH.map((f) => [f.id, f.tier]));
  const fishByTier = () => {
    const out = new Array(RARITIES.length).fill(0);
    for (const [id, n] of Object.entries(S.state.collection?.fish ?? {})) {
      const t = tierOf.get(id);
      if (t !== undefined && Number.isFinite(n)) out[t] += n;
    }
    return out;
  };
  const sample = () => ({
    copper: S.state.lifetimeGold,
    fish: S.state.stats.fishCaught ?? 0,
    casts: S.state.stats.casts ?? 0,
    tiers: fishByTier(),
    chests: S.state.stats.chestsFound ?? 0,
    xp: S.state.player.totalXp ?? 0,
    t: performance.now(),
  });
  let last = sample();
  let hiddenDuringWindow = document.visibilityState === 'hidden';
  const onVis = () => { if (document.visibilityState === 'hidden') hiddenDuringWindow = true; };
  document.addEventListener('visibilitychange', onVis);

  // ---------- Each reading ----------
  const tick = () => {
    const now = sample();
    const secs = (now.t - last.t) / 1000;
    const delta = (k) => Math.max(0, now[k] - last[k]);
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const footer =
      `<div class="tip-sep"></div><div class="muted">Measured over the last ${secs.toFixed(0)} s, up to ${at}</div>` +
      (hiddenDuringWindow ? '<div class="muted">⚠ The tab was hidden for part of it, so this reads low (fishing pauses while hidden).</div>' : '');

    const goldPerSec = delta('copper') / secs;
    goldPill.innerHTML = `+${moneyRateHtml(goldPerSec * 60)}<span class="per">/min</span>`; // as the game draws its Gold / min (ui.js renderGoldRate)
    setTip(goldPill,
      `<div class="tip-title">Measured income</div>` +
      `<div><b>${moneyRateHtml(goldPerSec * 60)}</b> a minute · <b>${moneyRateHtml(goldPerSec)}</b> a second</div>` +
      `<div class="muted">Everything you actually earned: fish, sales, chests, bounties, Golden Fish.</div>${footer}`);

    const fish = delta('fish');
    const casts = delta('casts');
    const fishPerSec = fish / secs;
    fishPill.innerHTML = iconRate(fishImg, fishPerSec * 60);
    const rows = RARITIES.map((r, t) => ({ r, n: Math.max(0, now.tiers[t] - last.tiers[t]) })).filter((x) => x.n > 0);
    const rowsTotal = rows.reduce((s, x) => s + x.n, 0);
    const cell = 'text-align:right;font-variant-numeric:tabular-nums';
    const table = rows.length
      ? `<div style="display:grid;grid-template-columns:auto repeat(4,auto);column-gap:14px;row-gap:1px;margin-top:4px">` +
        `<span class="tip-head">Rarity</span><span class="tip-head" style="${cell}">Caught</span><span class="tip-head" style="${cell}">/min</span><span class="tip-head" style="${cell}">Share</span><span class="tip-head" style="${cell}">One every</span>` +
        rows.map(({ r, n }) =>
          `<b style="color:${hex(r.color)}">${r.name}</b>` +
          `<span style="${cell}">${n.toLocaleString()}</span>` +
          `<span style="${cell}">${fmtRate((n / secs) * 60)}</span>` +
          `<span style="${cell}">${((n / rowsTotal) * 100).toFixed(n / rowsTotal < 0.1 ? 1 : 0)}%</span>` +
          `<span style="${cell}" class="muted">${fmtDuration(secs / n)}</span>`).join('') +
        `</div>`
      : '<div class="muted">No fish caught in this window.</div>';
    setTip(fishPill,
      `<div class="tip-title">Fish caught</div>` +
      `<div><b>${fish.toLocaleString()}</b> fish · <b>${fmtRate(fishPerSec * 60)}</b>/min · <b>${fmtRate(fishPerSec)}</b>/s</div>` +
      `<div class="muted">${casts.toLocaleString()} casts, ${casts ? fmtDec(fish / casts) : 0} fish per cast</div>` +
      `<div class="tip-sep"></div>${table}${footer}`);

    const chests = delta('chests');
    const chestsPerSec = chests / secs;
    chestPill.innerHTML = iconRate(chestImg, chestsPerSec * 60);
    setTip(chestPill,
      `<div class="tip-title">Chests found</div>` +
      `<div><b>${chests.toLocaleString()}</b> chests · <b>${fmtRate(chestsPerSec * 60)}</b>/min · <b>${fmtRate(chestsPerSec)}</b>/s</div>` +
      `<div class="muted">Caught while fishing; bounty, company and shop chests aren't counted.</div>${footer}`);

    const xp = delta('xp');
    const xpPerSec = xp / secs;
    const pl = S.state.player;
    const xpLeft = Math.max(0, S.xpToNext(pl.level) - pl.xp);
    xpPill.innerHTML = `+${fmtDecHtml(xpPerSec * 60)}<span class="per"> XP/min</span>`;
    setTip(xpPill,
      `<div class="tip-title">XP gained</div>` +
      `<div><b>${fmtDecHtml(xp)}</b> XP · <b>${fmtDecHtml(xpPerSec * 60)}</b>/min · <b>${fmtDecHtml(xpPerSec)}</b>/s</div>` +
      `<div>Next level (${pl.level + 1}) in about <b>${fmtDuration(xpPerSec > 0 ? xpLeft / xpPerSec : Infinity)}</b></div>${footer}`);

    for (const p of pills) {
      p.style.opacity = hiddenDuringWindow ? '0.55' : '';
      p.append(countdownBar()); // the pill's markup was just replaced, so this starts a new countdown
    }

    // Console logging, off for now that the pills show the same numbers. Uncomment to bring it back.
    // console.log(
    //   `%c[gold/s]%c ${money(goldPerSec)}/s  (${(goldPerSec / 10_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} g/s, ${money(goldPerSec * 60)}/min)` +
    //     `  ·  fish: ${fmtRate(fishPerSec)}/s (${fish} from ${casts} casts; ${rows.map(({ r, n }) => `${r.name} ${n}`).join(', ')})` +
    //     `  ·  chests: ${fmtRate(chestsPerSec)}/s (${chests} in ${secs.toFixed(1)}s, ${fmtRate(chestsPerSec * 60)}/min)` +
    //     `  ·  XP: ${fmtDec(xpPerSec)}/s (${fmtDec(xpPerSec * 60)}/min)` +
    //     (hiddenDuringWindow ? '  ⚠ tab was hidden — fishing pauses while hidden, so this is low' : ''),
    //   'color:#e8c34a;font-weight:bold', '',
    // );
    last = now;
    hiddenDuringWindow = document.visibilityState === 'hidden';
  };

  placePills();
  addEventListener('idle-angler-quicklinks', placePills);

  // ---------- Restart the window when equipped gear changes ----------
  // A reading that straddles a gear swap would mix two setups, so a swap starts a fresh window
  // (and countdown). The fingerprint is what's worn in each slot plus those items' rolls, so
  // reforging or upgrading a worn item counts too, while finding or selling other gear doesn't.
  // Checked once a second. The pills keep the previous reading until the new one lands, so you
  // can compare old gear against new; their tooltips say so.
  const gearKey = () => {
    const byUid = new Map((S.state.items ?? []).map((i) => [i.uid, i]));
    return JSON.stringify(
      Object.entries(S.state.equipped ?? {}).map(([slot, uid]) => {
        const i = byUid.get(uid);
        return [slot, uid, i && [i.tier, i.ilvl, i.ancient, i.power, i.set, i.stats, i.affixes]];
      }),
    );
  };
  const GEAR_MARK = '<!--gear-changed-->';
  let lastGear = gearKey();
  let id;
  const restartWindow = (why = 'Gear changed') => {
    clearInterval(id);
    last = sample();
    hiddenDuringWindow = document.visibilityState === 'hidden';
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const notice =
      `${GEAR_MARK}<div class="tip-sep"></div><div style="color:#fde68a">${why} at ${at}, so measuring restarted. ` +
      `These numbers are from before the change until the new reading lands.</div>`;
    for (const p of pills) {
      p.querySelector('.measured-countdown')?.remove();
      p.append(countdownBar());
      setTip(p, (tips.get(p) ?? '').split(GEAR_MARK)[0] + notice); // replaces any earlier notice
    }
    id = setInterval(tick, PERIOD_MS);
  };
  const gearTimer = setInterval(() => {
    const g = gearKey();
    if (g !== lastGear) {
      lastGear = g;
      restartWindow();
    }
  }, 1000);

  id = setInterval(tick, PERIOD_MS);
  window.setGoldLoggerPeriod = (ms) => {
    if (![5_000, 15_000, 30_000, 60_000].includes(ms) || ms === PERIOD_MS) return;
    PERIOD_MS = ms;
    restartWindow(`Measuring over ${ms < 60_000 ? `${ms / 1000} s` : '1 min'} from now`);
  };
  window.stopGoldLogger = () => {
    delete window.setGoldLoggerPeriod;
    clearInterval(id);
    clearInterval(gearTimer);
    document.removeEventListener('visibilitychange', onVis);
    removeEventListener('idle-angler-quicklinks', placePills);
    wrap.remove();
    tip.remove();
    style.remove();
    delete window.stopGoldLogger;
    // console.log('[gold/s] stopped');
  };
  // console.log(`[gold/s] started — first reading in ${PERIOD_MS / 1000}s (lifetime earned so far: ${money(last.copper)}, fish caught so far: ${last.fish}, chests found so far: ${last.chests}, total XP: ${fmtDec(last.xp)})`);
};

idleAnglerMods.define({
  id: 'incomePills',
  order: 20,
  name: "Income pills",
  desc: "Gold, fish, chests and XP a minute as you actually earn them, measured over the time below, at the top of Quicklinks (or in the top bar without it). Hover a pill for details",
  start: incomePills,
  stop: 'stopGoldLogger',
  // Shown under the mod's row; each is a localStorage key the mod reads as it starts
  options: [
    {
      key: 'idle-angler-income-period',
      label: 'Measure over',
      values: [['5000', '5 s'], ['15000', '15 s'], ['30000', '30 s'], ['60000', '1 min']],
      fallback: '60000',
      apply: (value) => window.setGoldLoggerPeriod?.(Number(value)), // live, without a restart
    },
  ],
});
}

{
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
}

{
// =====================================================================================================
// Build switcher (was build-switcher.js)
//
// Press 1-5 anywhere in the game (not while typing in chat or a box) to put on one of your saved
// builds (the game's gear sets, Angler > Character: up to 5, each with its stat priorities). A toast
// says which went on. Quicklinks shows the number key on each build's button.
// Putting a build on is the game's own "put this set on" (the same as clicking the set in Angler >
// Character): every piece you still have goes on, and its stat priorities come back with it.
// Stop it (and the keys) with:  stopBuildSwitcher(), or untick it in Settings > Mods
// =====================================================================================================
const buildSwitcher = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { act } = await mod('/src/actions.js');
  const { GEAR_SETS } = await mod('/src/data.js');
  const { toast } = await mod('/src/ui.js');
  const MAX = GEAR_SETS?.max ?? 5;

  window.stopBuildSwitcher?.(); // replace one already running

  // ---------- Putting a build on ----------
  let busy = false;
  const wear = async (i) => {
    const set = S.state.gearSets?.[i];
    if (!set) return toast(`No build ${i + 1} saved yet (save one in Angler > Character)`, true);
    if (busy) return;
    busy = true;
    try {
      const n = await act(S.game, 'equipGearSet', { index: i });
      if (!n) toast("None of that build's gear is in your bag any more (or you can't wear it yet)", true);
      else toast(`Build ${i + 1}: ${set.name}`);
    } finally {
      busy = false;
    }
  };

  // ---------- Hotkeys ----------
  // 1-5 put a build on. Not while typing, with a dialog up, or with Ctrl / Alt / Cmd held.
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.getElementById('modal-root')?.firstElementChild) return;
    const d = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    if (!d || Number(d) > MAX) return;
    e.preventDefault();
    if (e.repeat) return;
    wear(Number(d) - 1);
  };
  window.addEventListener('keydown', onKey, true);

  window.buildSwitcherKeys = MAX; // Quicklinks shows a key on each build while this runs
  window.stopBuildSwitcher = () => {
    window.removeEventListener('keydown', onKey, true);
    delete window.buildSwitcherKeys;
    delete window.stopBuildSwitcher;
  };
};

idleAnglerMods.define({
  id: 'buildSwitcher',
  order: 30,
  name: "Build switcher",
  desc: "Press 1-5 to put on one of your saved gear sets (Quicklinks shows each one's key)",
  start: buildSwitcher,
  stop: 'stopBuildSwitcher',
});
}

{
// =====================================================================================================
// Weather forecast (was weather-forecast.js)
//
// It adds a Forecast window, in the game's own window frame, that opens when you click the time and
// weather in the top bar or press W (not while typing in chat or a box). It has three views, all in
// game time:
//  - Hourly: the next 48 in-game hours (80 real minutes), hour by hour
//  - 10 Day: the next 10 in-game days (about 6½ real hours)
//  - Monthly: a calendar of in-game days (about 20 real hours a month); ‹ › change the month
// 10 Day and Monthly show only the rarest weather of each day.
// The game has no calendar, so the script makes one up: in-game day N (since the clock's start, each
// day running dawn to dawn, 05:00 to 05:00) gets the weekday and date of real day N. It's only there
// to give the days names.
// The weather is a fixed function of the shared server clock (world.js hashes each 12-minute slot), so
// the forecast is exact. The exception is weather someone sets for everyone: it shows while it lasts,
// but a change set later can't be known in advance.
// Stop it (and remove the window) with:  stopWeatherForecast(), or untick it in Settings > Mods
// =====================================================================================================
const weatherForecast = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const {
    worldAt, serverNow, getForcedWeather, formatHour, clock: worldClock,
    DAY_LENGTH_MS: DAY, WEATHER_SLOT_MS: SLOT, PHASES, WEATHERS, WEATHER_BY_ID,
  } = await mod('/src/world.js');

  window.stopWeatherForecast?.(); // replace one already running

  const root = document.getElementById('windows');
  if (!root) return console.warn('[forecast] The game page was not found (#windows)');

  const HOUR = DAY / 24; // an in-game hour (100 real seconds)
  const HOURLY_ROWS = 48;
  const DAILY_ROWS = 10;
  const STORE_KEY = 'idle-angler-forecast';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- The weather at any moment ----------
  // A copy of world.js's slot weather, so past days aren't coloured by weather someone set for
  // everyone (worldAt applies that to every time before it ends). Checked against worldAt below.
  function hash01(n) {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  const phaseAt = (t) => {
    const frac = (((t % DAY) + DAY) % DAY) / DAY;
    return PHASES.find((p) => frac >= p.start && frac < p.end) ?? PHASES[0];
  };
  const slotWeather = (slot) => {
    const phase = phaseAt((slot + 0.5) * SLOT).id;
    const options = WEATHERS.filter((w) => !w.phase || w.phase === phase);
    let roll = hash01(slot) * options.reduce((s, w) => s + w.weight, 0);
    for (const w of options) if ((roll -= w.weight) < 0) return w;
    return options[0];
  };
  const natural = (t) => {
    const w = slotWeather(Math.floor(t / SLOT));
    return w.phase && w.phase !== phaseAt(t).id ? WEATHER_BY_ID.clear : w;
  };
  const offset = () => serverNow() - worldClock.now(); // server time minus local time

  // If the copy ever disagrees with the game, use the game's worldAt for everything
  let exact = true;
  {
    const nowS = serverNow();
    const forcedUntil = getForcedWeather()?.until ?? 0;
    for (let i = 0; i < 400 && exact; i++) {
      const t = nowS + hash01(i + 77) * 30 * DAY;
      if (t < forcedUntil) continue;
      if (natural(t).id !== worldAt(t - offset(), {}).weather.id) exact = false;
    }
    if (!exact) console.warn('[forecast] The game’s weather rules changed; past days may show weather set for everyone');
  }

  /** The weather at server time t: { w, forced, by }. Weather set for everyone counts from now until it ends. */
  function weatherAt(t, forced, nowS) {
    if (forced && t >= nowS && t < forced.until) return { w: WEATHER_BY_ID[forced.weather] ?? natural(t), forced: true, by: forced.by };
    if (exact) return { w: natural(t), forced: false };
    const w = worldAt(t - offset(), {});
    return { w: w.weather, forced: w.forcedWeather, by: w.forcedBy };
  }

  /**
   * Runs of one weather in [a, b) (server time): { start, end, w, forced, by, phase (where it starts) }.
   * Walks the stretches in which neither the weather slot nor the time of day changes.
   */
  function segments(a, b, { naturalOnly = false } = {}) {
    const nowS = serverNow();
    const forced = naturalOnly ? null : getForcedWeather();
    const out = [];
    let t = a;
    while (t < b) {
      const dayStart = t - (((t % DAY) + DAY) % DAY);
      const cuts = [(Math.floor(t / SLOT) + 1) * SLOT, PHASES.map((p) => dayStart + p.end * DAY).find((x) => x > t), b];
      if (forced && forced.until > t) cuts.push(forced.until);
      if (forced && nowS > t) cuts.push(nowS);
      const e = Math.min(...cuts);
      const x = naturalOnly ? { w: natural((t + e) / 2), forced: false } : weatherAt((t + e) / 2, forced, nowS);
      const last = out[out.length - 1];
      if (last && last.w === x.w && last.forced === x.forced && last.end === t) last.end = e;
      else out.push({ start: t, end: e, w: x.w, forced: x.forced, by: x.by, phase: phaseAt(t) });
      t = e;
    }
    return out;
  }

  // ---------- Rarity ----------
  // How much of the time each weather is up, worked out over one full cycle of slots and days. The
  // rarest weather of a day is the one with the smallest share (ties: the earlier in the game's list).
  const share = Object.fromEntries(WEATHERS.map((w) => [w.id, 0]));
  {
    const gcd = (x, y) => (y ? gcd(y, x % y) : x);
    const cycle = (DAY / gcd(DAY, SLOT)) * SLOT;
    const step = SLOT / 120;
    for (let t = 0; t < cycle; t += step) {
      const slotPhase = phaseAt((Math.floor(t / SLOT) + 0.5) * SLOT).id;
      const phase = phaseAt(t + step / 2).id;
      const options = WEATHERS.filter((w) => !w.phase || w.phase === slotPhase);
      const total = options.reduce((s, w) => s + w.weight, 0);
      for (const w of options) share[!w.phase || w.phase === phase ? w.id : 'clear'] += w.weight / total;
    }
    const sum = Object.values(share).reduce((s, v) => s + v, 0);
    for (const id in share) share[id] /= sum;
  }
  const RARITY = [...WEATHERS].sort((x, y) => share[x.id] - share[y.id] || WEATHERS.indexOf(x) - WEATHERS.indexOf(y));
  const rank = Object.fromEntries(RARITY.map((w, i) => [w.id, i]));
  const rarestSeg = (segs) => segs.reduce((best, s) => (rank[s.w.id] < rank[best.w.id] ? s : best));
  // How often each weather is the rarest of its day (the Monthly view's key), over a long run of days
  const dayShare = Object.fromEntries(WEATHERS.map((w) => [w.id, 0]));
  {
    const n0 = Math.floor(serverNow() / DAY);
    const N = 3000;
    for (let n = n0; n < n0 + N; n++) dayShare[rarestSeg(segments(n * DAY, (n + 1) * DAY, { naturalOnly: true })).w.id] += 1 / N;
  }

  // ---------- Formatting ----------
  const COLOR = {
    clear: '#fde68a', cloudy: '#cbd5e1', rain: '#60a5fa', fog: '#e2e8f0', storm: '#facc15', cursed: '#a3e635',
    snow: '#bae6fd', acid: '#4ade80', blood: '#f87171', aurora: '#5eead4', meteor: '#c4b5fd',
  };
  const color = (w) => COLOR[w.id] ?? '#e5e7eb';
  // The game's top-bar icons; Clear has none, so it shows the sun (or the time of day's own icon)
  const iconSrc = (w, phaseId = 'day') => `/assets/icons/hud/${w.id === 'clear' ? phaseId : w.id}.svg`;
  const icon = (w, phaseId, cls = '') => `<img class="wf-ic ${cls}" src="${iconSrc(w, phaseId)}" alt="">`;
  const gameTime = (t) => formatHour((5 + ((((t % DAY) + DAY) % DAY) / DAY) * 24) % 24);
  const wall = (t) => new Date(t - offset()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const dur = (ms, seconds = false) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 10 && seconds) return `${m}m ${pad(s % 60)}s`;
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${pad(m % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  };
  const rel = (t, nowS) => {
    const d = t - nowS;
    if (d > 0) return d < 60_000 ? 'in <1m' : `in ${dur(d)}`;
    return -d < 60_000 ? 'now' : `${dur(-d)} ago`;
  };
  const oneIn = (p) => (p <= 0 ? 'never' : p >= 0.5 ? `${Math.round(p * 100)}% of days` : `1 day in ${Math.round(1 / p)}`);

  // The made-up calendar: in-game day n is named after real day n since 1 January 1970
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateOf = (n) => new Date(n * 86_400_000);
  const shortDate = (n) => `${WD[dateOf(n).getUTCDay()]} ${dateOf(n).getUTCDate()}`;
  const dayName = (n, n0) => (n === n0 ? 'Today' : n === n0 + 1 ? 'Tomorrow' : shortDate(n));

  // ---------- Saved window place and view ----------
  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
  };
  const saved = load();
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* storage blocked: not remembered */ }
  };
  let tab = ['hourly', 'daily', 'monthly'].includes(saved.tab) ? saved.tab : 'hourly';
  let monthShift = 0; // months from the current one, in the Monthly view

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.id = 'wf-style';
  style.textContent = `
#wf-win[hidden]{display:none}
#wf-win.wf-still{animation:none}
#wf-win .win-title .wf-ticon{width:1.15em;height:auto;image-rendering:pixelated}
/* The now box's rules also style its copy at the top of Quicklinks (#qs-weather) */
:is(#wf-win,#qs-weather) .wf-ic{display:block;width:22px;height:20px;image-rendering:pixelated;justify-self:center}
:is(#wf-win,#qs-weather) .wf-ic.big{width:44px;height:40px}
:is(#wf-win,#qs-weather) .wf-ic.mid{width:28px;height:26px}
:is(#wf-win,#qs-weather) .wf-ic.sm{width:14px;height:13px;display:inline-block;vertical-align:-2px}
:is(#wf-win,#qs-weather) .wf-muted{color:var(--muted)}
:is(#wf-win,#qs-weather) .wf-small{font-size:12px}
:is(#wf-win,#qs-weather) .wf-now{display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;align-items:center;padding:10px 12px;margin-bottom:10px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--wc) 16%,transparent),rgba(0,0,0,.22));box-shadow:inset 3px 0 0 var(--wc)}
:is(#wf-win,#qs-weather) .wf-now .wf-ic{grid-row:span 2}
:is(#wf-win,#qs-weather) .wf-now .wf-name{font:400 24px/1.1 var(--title);color:var(--wc)}
:is(#wf-win,#qs-weather) .wf-now .wf-clock{font:600 15px var(--num);text-shadow:1px 1px 0 #000}
:is(#wf-win,#qs-weather) .wf-now .wf-side{grid-row:span 2;display:grid;gap:3px;justify-items:end;text-align:right;font-size:12px}
:is(#wf-win,#qs-weather) .wf-now .wf-desc{grid-column:2;font-size:12px}
/* The tab row is the game's own (.win-tabs.panel-tabs, first in the body: the close button sits at its right end).
   Its sides are pulled out by the body's 6px padding, not the 8px of .panel-tabs' margin, which ran 2px past
   the body and gave it a sideways scrollbar */
#wf-win .wf-tabs{margin-left:-6px;margin-right:-6px}
#wf-win .win-body{overflow-x:hidden}
#wf-win .wf-nowbox,#wf-win .wf-view{max-width:100%;box-sizing:border-box}
#wf-win .wf-head{display:flex;align-items:baseline;gap:8px;padding:8px 6px 4px;font-weight:700;color:var(--accent);border-bottom:1px solid #3a4a30}
#wf-win .wf-head:first-child{padding-top:0}
#wf-win .wf-row{display:grid;grid-template-columns:62px 30px minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:5px 6px;
  border-bottom:1px solid rgba(58,74,48,.55);box-shadow:inset 3px 0 0 color-mix(in srgb,var(--wc) 70%,transparent)}
#wf-win .wf-row.daily{grid-template-columns:86px 34px minmax(0,1fr) auto;padding:7px 6px}
#wf-win .wf-row.now{background:rgba(253,230,138,.08)}
#wf-win .wf-row.past{opacity:.5}
#wf-win .wf-t{display:grid;line-height:1.15}
#wf-win .wf-t b{font:600 14px var(--num)}
#wf-win .wf-w{display:grid;min-width:0;line-height:1.2}
#wf-win .wf-w b{color:var(--wc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wf-win .wf-w span{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wf-win .wf-r{display:grid;justify-items:end;text-align:right;line-height:1.2;font-size:12px;white-space:nowrap}
#wf-win .wf-tag{padding:0 4px;font-size:11px;color:#1a1a1a;background:var(--wc)}
#wf-win .wf-month{display:flex;align-items:center;gap:8px;margin-bottom:8px}
#wf-win .wf-month h3{flex:1;margin:0;text-align:center;font:400 20px var(--title);color:var(--accent)}
#wf-win .wf-month button{min-width:30px}
#wf-win .wf-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
#wf-win .wf-cal .wd{padding:2px 0 4px;text-align:center;font-size:11px;font-weight:700;color:var(--muted)}
#wf-win .wf-day{position:relative;display:grid;justify-items:center;align-content:center;gap:2px;min-height:62px;padding:16px 2px 4px;
  background:linear-gradient(color-mix(in srgb,var(--wc) 14%,transparent),rgba(0,0,0,.25));box-shadow:inset 0 0 0 1px rgba(0,0,0,.45)}
#wf-win .wf-day .num{position:absolute;left:4px;top:2px;font:600 12px var(--num);text-shadow:1px 1px 0 #000}
#wf-win .wf-day .nm{max-width:100%;font-size:11px;line-height:1.1;color:var(--wc);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-win .wf-day.past{opacity:.45}
#wf-win .wf-day.today{box-shadow:inset 0 0 0 2px var(--accent)}
#wf-win .wf-day.blank{background:none;box-shadow:none}
#wf-win .wf-key{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:10px;font-size:12px}
#wf-win .wf-key span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
#wf-win .wf-key b{color:var(--wc);font-weight:600}
#wf-win .wf-note{margin:8px 2px 0;font-size:12px;color:var(--muted)}
#world.wf-link{cursor:pointer}
`;
  document.head.append(style);

  // ---------- The window (the game's own frame and parts) ----------
  const win = document.createElement('section');
  win.className = 'window';
  win.id = 'wf-win';
  win.dataset.win = 'forecast';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'Forecast');
  win.hidden = true;
  win.innerHTML = `
    <header class="win-head">
      <div class="win-title"><img class="wf-ticon" src="/assets/icons/hud/rain.svg" alt=""><h2>Forecast</h2></div>
      <button class="win-close" aria-label="Close Forecast">✕</button>
    </header>
    <div class="win-body">
      <div class="win-tabs panel-tabs wf-tabs"></div>
      <div class="wf-nowbox"></div>
      <div class="wf-view"></div>
    </div>
    <div class="win-resize" title="Drag to resize · double-click for the normal size"></div>`;
  // First in the container: when the game focuses one of its own windows it can tie with this one's
  // stacking order, and then the later one in the page (the game's) is the one on top.
  root.prepend(win);
  const head = win.querySelector('.win-head');
  const body = win.querySelector('.win-body');
  const nowBox = win.querySelector('.wf-nowbox');
  const tabsBox = win.querySelector('.wf-tabs');
  const view = win.querySelector('.wf-view');
  const grip = win.querySelector('.win-resize');

  const NARROW = 720;
  const MIN_W = 340;
  const MIN_H = 240;
  const TOP_GAP = 14;
  const narrow = () => root.clientWidth < NARROW;
  const others = () => [...root.querySelectorAll('.window')].filter((el) => el !== win);
  const zOf = (el) => Number(el.style.zIndex) || 0;

  function clamp(x, y) {
    const maxX = Math.max(0, root.clientWidth - 120);
    const maxY = Math.max(TOP_GAP, root.clientHeight - 48);
    const top = Math.round(Math.min(Math.max(TOP_GAP, y), maxY));
    win.style.left = `${Math.round(Math.min(Math.max(0, x), maxX))}px`;
    win.style.top = `${top}px`;
    win.style.maxHeight = `${Math.max(MIN_H, root.clientHeight - top - 4)}px`;
  }
  function place() {
    if (narrow()) {
      win.style.left = win.style.top = win.style.width = win.style.height = win.style.maxHeight = '';
      return;
    }
    const width = Math.min(saved.w ?? 600, root.clientWidth - 16);
    win.style.width = `${width}px`;
    win.style.height = saved.h ? `${Math.min(saved.h, root.clientHeight - TOP_GAP)}px` : '';
    clamp(saved.x ?? (root.clientWidth - width) / 2, saved.y ?? 40);
  }
  function focus() {
    win.style.zIndex = String(Math.max(10, ...others().map(zOf)) + 1);
    for (const el of others()) el.classList.remove('focused');
    win.classList.add('focused');
  }
  const isOpen = () => !win.hidden;
  const onTop = () => isOpen() && others().every((el) => zOf(el) < zOf(win));

  function open() {
    if (narrow()) for (const el of others()) el.querySelector('.win-close')?.click(); // one window at a time there
    win.hidden = false;
    win.classList.remove('wf-still');
    setTimeout(() => win.classList.add('wf-still'), 200); // the pop-in plays once
    place();
    focus();
    render(true);
  }
  function close() {
    win.hidden = true;
    win.classList.remove('focused');
  }
  const toggle = () => (isOpen() ? close() : open());

  win.addEventListener('pointerdown', focus);
  win.querySelector('.win-close').addEventListener('click', close);
  // The close button keeps clear of the scrollbar through --sbw, as the game's windows.js sets it on its own
  // windows (trackScrollbar): the scrollbar's width while the body scrolls, 0 while it doesn't
  let sbwQueued = false;
  const syncSbw = () => {
    sbwQueued = false;
    const zoom = body.offsetWidth ? body.getBoundingClientRect().width / body.offsetWidth : 1;
    win.style.setProperty('--sbw', `${Math.max(0, Math.round((body.offsetWidth - body.clientWidth) * zoom))}px`);
  };
  const queueSbw = () => {
    if (sbwQueued) return;
    sbwQueued = true;
    requestAnimationFrame(syncSbw);
  };
  const sbwResize = new ResizeObserver(queueSbw);
  sbwResize.observe(body);
  const sbwChange = new MutationObserver(queueSbw);
  sbwChange.observe(body, { childList: true, subtree: true });
  // Clicking any of the game's windows takes the focus glow away from this one
  const onRootDown = (e) => {
    if (!win.contains(e.target) && e.target.closest?.('.window')) win.classList.remove('focused');
  };
  root.addEventListener('pointerdown', onRootDown);
  // On narrow screens the game shows one window at a time: one of its windows opening closes this
  const observer = new MutationObserver((list) => {
    if (narrow() && isOpen() && list.some((m) => [...m.addedNodes].some((n) => n !== win && n.classList?.contains('window')))) close();
  });
  observer.observe(root, { childList: true });

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || narrow()) return;
    e.preventDefault();
    const sx = e.clientX - win.offsetLeft;
    const sy = e.clientY - win.offsetTop;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => clamp(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      Object.assign(saved, { x: win.offsetLeft, y: win.offsetTop });
      save();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || narrow()) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const sw = win.offsetWidth;
    const sh = win.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    win.classList.add('resizing');
    const move = (ev) => {
      win.style.width = `${Math.round(Math.min(Math.max(MIN_W, sw + ev.clientX - sx), root.clientWidth - win.offsetLeft))}px`;
      win.style.height = `${Math.round(Math.min(Math.max(MIN_H, sh + ev.clientY - sy), root.clientHeight - win.offsetTop))}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      win.classList.remove('resizing');
      Object.assign(saved, { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight });
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    delete saved.w;
    delete saved.h;
    save();
    place();
  });

  // ---------- Views ----------
  function nowHtml(nowS) {
    const segs = segments(nowS, nowS + 3 * DAY);
    const cur = segs[0];
    const next = segs[1];
    const phase = phaseAt(nowS);
    const dayStart = nowS - (nowS % DAY);
    const phaseEnd = dayStart + phase.end * DAY;
    const nextPhase = PHASES[(PHASES.indexOf(phase) + 1) % PHASES.length];
    return `<div class="wf-now" style="--wc:${color(cur.w)}">
      ${icon(cur.w, phase.id, 'big')}
      <div><span class="wf-name">${esc(cur.w.name)}</span></div>
      <div class="wf-side">
        ${next ? `<span>Then ${icon(next.w, next.phase.id, 'sm')} <b style="color:${color(next.w)}">${esc(next.w.name)}</b> at ${gameTime(next.start)}</span>
        <span class="wf-muted">in ${dur(next.start - nowS, true)} · ${wall(next.start)}</span>` : ''}
        <span>${icon(WEATHER_BY_ID.clear, nextPhase.id, 'sm')} ${esc(nextPhase.name)} at ${gameTime(phaseEnd)} <span class="wf-muted">in ${dur(phaseEnd - nowS, true)}</span></span>
      </div>
      <div class="wf-desc">
        <span class="wf-clock">${gameTime(nowS)}</span> · ${esc(phase.name)} <span class="wf-muted">(${esc(phase.desc)})</span><br>
        ${esc(cur.w.desc)}${cur.forced ? ` <span class="wf-muted">· set for everyone${cur.by ? ` by ${esc(cur.by)}` : ''}</span>` : ''}
      </div>
    </div>`;
  }

  const row = (cls, w, cells) => `<div class="wf-row ${cls}" style="--wc:${color(w)}">${cells}</div>`;

  function hourlyHtml(nowS) {
    const n0 = Math.floor(nowS / DAY);
    const first = Math.floor(nowS / HOUR) * HOUR;
    let html = '';
    let lastDay = null;
    for (let k = 0; k < HOURLY_ROWS; k++) {
      const a = first + k * HOUR;
      const from = Math.max(a, nowS);
      const n = Math.floor(a / DAY);
      if (n !== lastDay) {
        html += `<div class="wf-head">${dayName(n, n0)}${n - n0 < 2 ? ` <span class="wf-muted wf-small">${shortDate(n)}</span>` : ''}</div>`;
        lastDay = n;
      }
      const segs = segments(from, a + HOUR);
      const s = rarestSeg(segs);
      const later = s.start > from; // the rarest weather of the hour starts partway through it
      html += row(k === 0 ? 'now' : '', s.w, `
        <div class="wf-t"><b>${k === 0 ? 'Now' : gameTime(a)}</b><span class="wf-muted wf-small">${wall(from)}</span></div>
        ${icon(s.w, s.phase.id)}
        <div class="wf-w"><b>${esc(s.w.name)}${later ? ` <span class="wf-muted wf-small">from ${gameTime(s.start)}</span>` : ''}${s.forced ? ' <span class="wf-tag">set</span>' : ''}</b><span title="${esc(s.w.desc)}">${esc(s.w.desc)}</span></div>
        <div class="wf-r"><span>${icon(WEATHER_BY_ID.clear, s.phase.id, 'sm')} ${esc(s.phase.name)}</span><span class="wf-muted">${k === 0 ? 'now' : rel(later ? s.start : a, nowS)}</span></div>`);
    }
    return html + `<p class="wf-note">One in-game hour is 100 real seconds; weather can change every 12 real minutes. Each hour shows its rarest weather.</p>`;
  }

  /** A day's rarest weather, and the run of it to point at (the one still to come, else the last). */
  function dayInfo(n, nowS) {
    const segs = segments(n * DAY, (n + 1) * DAY);
    const best = rarestSeg(segs);
    const runs = segs.filter((s) => s.w === best.w && s.forced === best.forced);
    const run = runs.find((r) => r.end > nowS) ?? runs[runs.length - 1];
    return { w: best.w, forced: best.forced, runs, run, allDay: segs.length === 1 };
  }

  function dailyHtml(nowS) {
    const n0 = Math.floor(nowS / DAY);
    let html = '';
    for (let i = 0; i < DAILY_ROWS; i++) {
      const n = n0 + i;
      const d = dayInfo(n, nowS);
      const r = d.run;
      const live = r.start <= nowS && r.end > nowS;
      const more = d.runs.length > 1 ? ` <span class="wf-muted">+${d.runs.length - 1} more</span>` : '';
      const when = d.allDay ? 'All day' : `${gameTime(r.start)}–${gameTime(r.end)} · ${esc(r.phase.name)}`;
      const real = live ? `now, for ${dur(r.end - nowS)}` : r.end <= nowS ? `ended ${dur(nowS - r.end)} ago` : `${rel(r.start, nowS)} · ${wall(r.start)}`;
      html += row(i === 0 ? 'daily now' : 'daily', d.w, `
        <div class="wf-t"><b>${dayName(n, n0)}</b><span class="wf-muted wf-small">${i < 2 ? shortDate(n) : `${MONTHS[dateOf(n).getUTCMonth()].slice(0, 3)} ${dateOf(n).getUTCDate()}`}</span></div>
        ${icon(d.w, 'day', 'mid')}
        <div class="wf-w"><b>${esc(d.w.name)}${d.forced ? ' <span class="wf-tag">set</span>' : ''}</b><span title="${esc(d.w.desc)}">${esc(d.w.desc)}</span></div>
        <div class="wf-r"><span>${when}${more}</span><span class="wf-muted">${real}</span></div>`);
    }
    return html + `<p class="wf-note">Each day runs from dawn to dawn (05:00 to 05:00 in game, 40 real minutes) and shows only its rarest weather.</p>`;
  }

  function monthlyHtml(nowS) {
    const n0 = Math.floor(nowS / DAY);
    const today = dateOf(n0);
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthShift, 1));
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const nFirst = Math.round(first.getTime() / 86_400_000);
    const lead = first.getUTCDay();
    let cells = WD.map((d) => `<div class="wd">${d}</div>`).join('');
    cells += '<div class="wf-day blank"></div>'.repeat(lead);
    for (let i = 0; i < days; i++) {
      const n = nFirst + i;
      const d = dayInfo(n, nowS);
      const r = d.run;
      const tip = `${shortDate(n)}: ${d.w.name}${d.allDay ? ', all day' : `, ${gameTime(r.start)}–${gameTime(r.end)}`}${d.runs.length > 1 ? ` (+${d.runs.length - 1} more)` : ''}\n${d.w.desc}\n${r.end <= nowS ? `ended ${dur(nowS - r.end)} ago` : r.start <= nowS ? 'now' : `${rel(r.start, nowS)} (${new Date(r.start - offset()).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })})`}`;
      cells += `<div class="wf-day ${n < n0 ? 'past' : ''} ${n === n0 ? 'today' : ''}" style="--wc:${color(d.w)}" title="${esc(tip)}">
        <span class="num">${i + 1}</span>${icon(d.w, 'day')}<span class="nm">${esc(d.w.name)}</span></div>`;
    }
    const key = RARITY.filter((w) => dayShare[w.id] > 0)
      .map((w) => `<span style="--wc:${color(w)}">${icon(w, 'day', 'sm')}<b>${esc(w.name)}</b><span class="wf-muted">${oneIn(dayShare[w.id])}</span></span>`)
      .join('');
    const realStart = new Date(nFirst * DAY - offset());
    return `
      <div class="wf-month">
        <button class="btn" data-wf-month="-1" aria-label="Previous month">‹</button>
        <h3>${MONTHS[first.getUTCMonth()]}</h3>
        <button class="btn" data-wf-month="1" aria-label="Next month">›</button>
        ${monthShift ? '<button class="btn" data-wf-month="0">This month</button>' : ''}
      </div>
      <div class="wf-cal">${cells}</div>
      <div class="wf-key"><span class="wf-muted">Rarest weather of the day, rarest first:</span>${key}</div>
      <p class="wf-note">An in-game month is ${days} days, about ${Math.round((days * DAY) / 3_600_000)} real hours; this one ${realStart.getTime() > Date.now() ? 'starts' : 'started'} ${realStart.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Hover a day for its times.</p>`;
  }

  const TABS = [
    { id: 'hourly', name: 'Hourly', html: hourlyHtml },
    { id: 'daily', name: '10 Day', html: dailyHtml },
    { id: 'monthly', name: 'Monthly', html: monthlyHtml },
  ];

  let lastTabs = '';
  let lastView = '';
  function render(force = false) {
    if (!isOpen()) return;
    const nowS = serverNow();
    nowBox.innerHTML = nowHtml(nowS);
    // The hotkey on the first tab, as the game shows a window's key (ui.js tabBar)
    const tabs = TABS.map((t, i) => `<button class="win-tab ${t.id === tab ? 'active' : ''}" data-wf-tab="${t.id}">${t.name}${i === 0 ? ' <kbd>W</kbd>' : ''}</button>`).join('');
    if (force || tabs !== lastTabs) tabsBox.innerHTML = lastTabs = tabs;
    // The list only changes when its text does (minutes), so hovering and tooltips aren't disturbed every second
    const html = TABS.find((t) => t.id === tab).html(nowS);
    if (force || html !== lastView) view.innerHTML = lastView = html;
  }

  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-wf-tab]');
    if (t) {
      tab = saved.tab = t.dataset.wfTab;
      save();
      monthShift = 0;
      body.scrollTop = 0;
      return render(true);
    }
    const m = e.target.closest('[data-wf-month]');
    if (m) {
      const step = Number(m.dataset.wfMonth);
      monthShift = step === 0 ? 0 : Math.max(-6, Math.min(24, monthShift + step));
      render(true);
    }
  });

  // ---------- Opening it: the top bar's time and weather, or W ----------
  const chip = document.getElementById('world');
  const onChip = (e) => {
    if (e.button !== 0) return;
    toggle();
  };
  chip?.classList.add('wf-link');
  chip?.addEventListener('click', onChip);

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.getElementById('modal-root')?.firstElementChild) return;
    if (e.key === 'Escape' && onTop()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (!e.repeat) toggle();
    }
  };
  window.addEventListener('keydown', onKey, true);

  // The now box at the top of the Quicklinks panel too, when that mod is on (it makes the empty #qs-weather),
  // whether this window is open or not. A click on it opens the window.
  let qlHost = null;
  let qlLast = '';
  const renderQuicklinks = () => {
    const host = document.getElementById('qs-weather');
    if (!host) return;
    if (host !== qlHost) [qlHost, qlLast] = [host, ''];
    const html = nowHtml(serverNow());
    if (html !== qlLast) host.innerHTML = qlLast = html;
  };
  const onQuicklinks = (e) => {
    if (e.button !== 0 || !e.target.closest('#qs-weather')) return;
    if (!isOpen()) open();
  };
  document.addEventListener('click', onQuicklinks);
  renderQuicklinks();

  const timer = setInterval(() => {
    render();
    renderQuicklinks();
  }, 1000);
  const onResize = () => {
    if (!isOpen()) return;
    if (narrow()) place();
    else clamp(win.offsetLeft, win.offsetTop);
  };
  addEventListener('resize', onResize);

  window.stopWeatherForecast = () => {
    clearInterval(timer);
    observer.disconnect();
    sbwResize.disconnect();
    sbwChange.disconnect();
    window.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    root.removeEventListener('pointerdown', onRootDown);
    chip?.removeEventListener('click', onChip);
    chip?.classList.remove('wf-link');
    document.removeEventListener('click', onQuicklinks);
    const host = document.getElementById('qs-weather');
    if (host) host.innerHTML = '';
    win.remove();
    style.remove();
    delete window.stopWeatherForecast;
  };

  console.log(`[forecast] Ready: click the time and weather in the top bar, or press W.${exact ? '' : ' (using the game’s own weather lookup)'}`);
};

idleAnglerMods.define({
  id: 'weatherForecast',
  order: 40,
  name: "Weather forecast",
  desc: "Click the time and weather in the top bar, or press W, for the weather hour by hour, day by day and by month",
  start: weatherForecast,
  stop: 'stopWeatherForecast',
});
}

{
// =====================================================================================================
// Gear judge
//
// The game marks gear ▲ (better for your build) or ▼ by comparing your stats with and without it under the
// conditions of this very moment: this weather and time of day, any Twitch or event bonus running now, and
// whether you've clicked in the last 3 seconds (a pause to look at your bag counts as idle play, with its
// 2.5× faster bites). So a night-only power looks useless by day, luck gear looks worse in a Cursed Tide,
// and idle gear looks better while you read the bag. This judges gear over the time you'll fish in it:
//  - Weather and time of day: averaged over the whole cycle, each by the share of the time it lasts (a day
//    is 40 minutes, the weather can change every 12, night-only weather comes only at night). Or only the
//    ones you pick, in Settings > Mods or above the upgrades in Quicklinks' Bag: a time of day, a
//    weather, both, or "now" (for now only the most common: Day and Night; Clear, Overcast, Rain, Fog, Storm)
//  - Clicking: your click rate over the last few minutes (the game's own click habit) sets how much of the
//    time you fish idle (no click for 3 s) and how fast you click the rest of it; gold is worked out for
//    each, and added up by their shares. Or pick "Idle" (never a click: Patience, Still Waters and
//    Unyielding all the time) or "Auto-clicker" (never idle, at the Auto-click rate set under Income
//    pills in Settings > Mods: the Frenzy bar, click power and Stormrider all the time)
//  - Or "Opening chests": the game fills a chest when you open it, with the gear you're wearing then
//    (state.js rollChests). This judges gear by the money and treasure the chests you have would pay with it
//    on (loot.js rollChestContents: catch value, treasure, chest luck, and Plunderer, Magpie and Fortune's
//    Embrace), instead of your build. Wear the winners as a saved gear set just to open chests. The gear
//    found in chests isn't counted. Opened as you'd open them from a window, idle: not clicking the water
//  - Bonuses that end within the hour (Twitch, events, a Golden Fish) are left out
//  - Gear you can't wear yet isn't an upgrade
//  - Sets are judged as sets too: a set's bonuses come at 2, 4 and 6 pieces, so one piece of a set you don't
//    wear never looks good alone. The pieces in your bag and the Market are also tried together, every way that reaches a
//    bonus (with the ones you wear); a set that pays off that way has its pieces' ▲ in the set colour, with
//    the change for putting them all on, and Quicklinks lists it with its pieces (a Market one as its stall: buy it first)
// The rest is the game's own: its stats with and without the piece (the real getStats, every cap and set
// bonus), its gold a second and other build measures (priorityMetric), your build's priorities and their
// weights (Bags > Your build), and the same ½% line for a badge.
// It redraws the ▲ / ▼ badges in Bags > Gear and in the Market; Quicklinks uses it too. The game's own
// "Best upgrade" sort, its tooltips and the sidebar's ▲ still use the game's measure.
// Stop it with:  stopGearJudge(), or untick it in Settings > Mods
// =====================================================================================================
const gearJudge = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const W = await mod('/src/world.js');
  const { BASE, OVERFLOW, SET_BY_ID, SET_COLOR, SLOTS, RARITIES, ZONES, ZONE_BY_ID, CHEST_GOLD, TREASURE_VALUE } = await mod('/src/data.js');
  const { tierOdds, gearDropScale, rollChestContents } = await mod('/src/loot.js');
  const chestBase = chestBaseRule({ rollChestContents, RARITIES, CHEST_GOLD, ZONES, stats: S.getStats() }); // what a chest's value starts from, in this build
  const { hex } = await mod('/src/format.js');
  const { MAX_CPS } = await mod('/src/clicks.js');

  window.stopGearJudge?.(); // replace one already running

  const TIME_KEY = 'idle-angler-judge-time';
  const WEATHER_KEY = 'idle-angler-judge-weather';
  const ACTIVITY_KEY = 'idle-angler-judge-activity';
  const AUTO_KEY = 'measured-autoclick-cps'; // the Auto-click mod's rate, 14 until it's set
  const IDLE_S = 3; // state.js IDLE_SPEED_MS: no click for this long and play counts as idle
  const STILL_SPEED = 1.5; // state.js: Still Waters (4 pieces) bites ×1.5 while idle
  const AHEAD_MS = 60 * 60_000; // judged an hour from now: bonuses that end before then are left out
  const SLICE_MS = 10; // work a turn, so the game keeps running smoothly while it catches up

  // ---------- The conditions, and how long each lasts ----------
  // The day (40 min) and the weather slots (12 min) line up again every 3 days, 10 slots. Over that, each
  // slot's weather is drawn from those allowed at its middle's time of day (world.js weatherForSlot), and a
  // night-only weather is clear for the part of its slot that isn't night (naturalWeather).
  const SHARES = (() => {
    const day = W.DAY_LENGTH_MS;
    const slotMs = W.WEATHER_SLOT_MS;
    const period = 3 * day;
    const step = 15_000;
    const phaseAt = (t) => {
      const f = (t % day) / day;
      return W.PHASES.find((p) => f >= p.start && f < p.end) ?? W.PHASES[0];
    };
    const out = new Map();
    for (let t = 0; t < period; t += step) {
      const mid = phaseAt((Math.floor(t / slotMs) + 0.5) * slotMs);
      const phase = phaseAt(t);
      const options = W.WEATHERS.filter((w) => !w.phase || w.phase === mid.id);
      const total = options.reduce((n, w) => n + w.weight, 0);
      for (const w of options) {
        const weather = w.phase && w.phase !== phase.id ? 'clear' : w.id;
        const key = `${phase.id}|${weather}`;
        const c = out.get(key) ?? { phase: phase.id, weather, share: 0 };
        c.share += (w.weight / total) * (step / period);
        out.set(key, c);
      }
    }
    return [...out.values()];
  })();
  // The choices: any, now, and only the most common for now: the times of day that last a fifth of the day
  // or more (Day and Night), and the 5 weathers you see most (Clear, Overcast, Rain, Fog and Storm)
  const shareOf = (key, id) => SHARES.reduce((n, c) => n + (c[key] === id ? c.share : 0), 0);
  const COMMON_TIMES = W.PHASES.filter((p) => shareOf('phase', p.id) >= 0.2);
  const COMMON_WEATHERS = [...W.WEATHERS].sort((a, b) => shareOf('weather', b.id) - shareOf('weather', a.id)).slice(0, 5);
  const TIMES = [['any', 'Any time of day'], ['now', 'Time of day now'], ...COMMON_TIMES.map((p) => [p.id, p.name])];
  const WEATHER_PICKS = [['any', 'Any weather'], ['now', 'Weather now'], ...W.WEATHERS.filter((w) => COMMON_WEATHERS.includes(w)).map((w) => [w.id, w.name])];
  // How you play: as your clicks of the last few minutes say, idle (never a click), or with the
  // Auto-clicker on (never idle, at its rate)
  const autoRate = () => {
    try {
      return Math.min(MAX_CPS, Math.max(1, Math.round(+localStorage.getItem(AUTO_KEY)) || 14));
    } catch {
      return 14;
    }
  };
  const activities = () => [['now', 'As you click now'], ['idle', 'Idle'], ['auto', `Auto-clicker ${autoRate()}/s`], ['chests', 'Opening chests']];
  window.gearJudgeChoices = { time: TIMES, weather: WEATHER_PICKS, get activity() { return activities(); } }; // the Settings > Mods dropdowns

  const read = (key, list, fallback = 'any') => {
    try {
      const v = localStorage.getItem(key);
      return list.some(([id]) => id === v) ? v : fallback;
    } catch {
      return fallback;
    }
  };
  let pick = { time: read(TIME_KEY, TIMES), weather: read(WEATHER_KEY, WEATHER_PICKS), activity: read(ACTIVITY_KEY, activities(), 'now') };

  /** The conditions to judge in, with their shares of the time (adding up to 1). */
  function conditions() {
    const now = W.worldAt();
    const time = pick.time === 'now' ? now.phase.id : pick.time;
    const weather = pick.weather === 'now' ? now.weather.id : pick.weather;
    let list = SHARES.filter((c) => (time === 'any' || c.phase === time) && (weather === 'any' || c.weather === weather));
    // A pair that doesn't happen on its own (Aurora by day, or the owner's weather): just that pair
    if (!list.length) list = [{ phase: time === 'any' ? 'night' : time, weather: weather === 'any' ? 'clear' : weather, share: 1 }];
    const total = list.reduce((n, c) => n + c.share, 0);
    return list.map((c) => ({ ...c, share: c.share / total }));
  }

  /** Runs fn with the game's world set to these conditions, an hour ahead, then puts both back. */
  function under(cond, fn) {
    const saved = W.getOverride();
    const realNow = W.clock.now;
    const at = realNow() + AHEAD_MS;
    W.setOverride('phase', cond.phase);
    W.setOverride('weather', cond.weather);
    W.clock.now = () => at;
    try {
      return fn();
    } finally {
      W.clock.now = realNow;
      W.setOverride('phase', saved.phase);
      W.setOverride('weather', saved.weather);
    }
  }

  // Stats an hour ahead are idle play (no click for an hour): Patience's faster bites, and Still Waters'.
  // While clicking, those are taken back out, with what follows from the bite time (the animations, and
  // multi-catch from bites past the animation floor), as getStats works them out.
  const floor = 0.3 * BASE.fishTime;
  function clicking(s) {
    if (!s.idleBonus) return s;
    const k = ((BASE.idleSpeed ?? 1) > 1 ? BASE.idleSpeed : 1) * (s.flags?.stillSpeed ? STILL_SPEED : 1);
    const fishTime = s.fishTime * k;
    return {
      ...s,
      speedMult: s.speedMult / k,
      fishTime,
      animScale: Math.min(1, Math.max(0.3, fishTime / BASE.fishTime)),
      speedMultiCatch: fishTime < floor ? Math.log2(floor / fishTime) * OVERFLOW.speedMultiCatch : 0,
      idleBonus: false,
    };
  }

  // ---------- Judging ----------
  let ctx = null; // what this pass is judged with; a new one when any of it changes
  function context() {
    let idle = 1; // the share of the time with no click for 3 s
    let cps = 0; // clicks a second while clicking
    if (pick.activity === 'auto') {
      idle = 0;
      cps = autoRate();
    } else if (pick.activity !== 'idle') {
      const rate = S.clickRate();
      idle = Math.exp(-IDLE_S * rate);
      cps = Math.min(MAX_CPS, rate / Math.max(1e-6, 1 - idle));
    }
    const now = W.worldAt();
    const chests = pick.activity === 'chests';
    const sig = [
      chests ? Object.keys(S.state.chests ?? {}).filter((k) => S.state.chests[k] > 0).sort().join(',') : '', // the kinds of chest you have
      pick.time,
      pick.weather,
      pick.activity,
      pick.activity === 'auto' ? cps : '', // the Auto-click rate (yours: by the 5% step below)
      pick.time === 'now' ? now.phase.id : '',
      pick.weather === 'now' ? now.weather.id : '',
      S.state.player?.level,
      S.state.zone,
      JSON.stringify(S.state.equipped),
      JSON.stringify(S.buildPriority()),
      JSON.stringify(S.state.settings.statLimits ?? {}),
      Math.round(idle * 20), // a 5% step in idle play
      Math.floor(Date.now() / 60_000), // upgrades, perks and levels bought: once a minute
    ].join('|');
    if (ctx?.sig === sig) return ctx;
    const conds = conditions();
    return (ctx = { sig, conds, idle, cps, zone: S.currentZone(), keys: chests ? ['chests'] : S.buildPriority(), chests: chests ? chestKinds() : null, base: new Map(), version: (ctx?.version ?? 0) + 1 });
  }

  // ---------- Opening chests ----------
  // The chests you have, by kind ("zone:tier" and how many), each kind weighted by its count. With none, the
  // chests of the water you're in, by how often each rarity comes up for you now.
  function chestKinds() {
    const list = [];
    for (const [key, n] of Object.entries(S.state.chests ?? {})) {
      const [zoneId, tier] = key.split(':');
      if (n > 0 && ZONE_BY_ID[zoneId]) list.push({ zone: ZONE_BY_ID[zoneId], tier: Number(tier), n });
    }
    if (list.length) return list;
    const zone = S.currentZone();
    return tierOdds(S.getStats().chestLuckMult, zone.maxTier).map((n, tier) => ({ zone, tier, n })).filter((k) => k.n > 0);
  }
  const CHEST_ITEM_CHANCE = 0.35; // loot.js: each roll in a chest is gear this often, treasure otherwise
  /** Money and treasure from opening one chest of each kind with these stats, as loot.js rollChestContents pays on average. */
  function chestMoney(s, kinds) {
    const chestValue = s.chestValueMult ?? 1; // Plunderer, Magpie, Fortune's Embrace
    let sum = 0;
    for (const { zone, tier, n } of kinds) {
      const base = chestBase(s, zone);
      const gold = base * RARITIES[tier].valueMult * CHEST_GOLD * s.valueMult * chestValue;
      // Each roll's treasure: a rarity from chest luck, no lower than 2 under the chest's (loot.js tierOddsFrom)
      const odds = tierOdds(s.chestLuckMult, Math.min(RARITIES.length - 1, zone.maxTier + 1));
      const floor = Math.max(0, tier - 2);
      const treasureTier = odds.reduce((t, q, i) => t + (q || 0) * RARITIES[Math.max(i, floor)].valueMult, 0);
      const treasure = base * treasureTier * TREASURE_VALUE * s.treasureMult * chestValue;
      const rolls = 1 + Math.floor(tier / 2);
      sum += n * (gold + rolls * (1 - CHEST_ITEM_CHANCE * gearDropScale(s, zone)) * treasure);
    }
    return sum;
  }

  /** Each build measure, summed over the conditions by their shares (idle and clicking by theirs). */
  function measures(c, statsFor) {
    const sums = c.keys.map(() => 0);
    for (const cond of c.conds) {
      const s = under(cond, statsFor);
      const a = clicking(s);
      c.keys.forEach((key, i) => {
        if (key === 'chests') sums[i] += cond.share * chestMoney(s, c.chests); // opened idle (from a window)
        else sums[i] += cond.share * (c.idle * S.priorityMetric(key, s, c.zone, 0) + (1 - c.idle) * S.priorityMetric(key, a, c.zone, c.cps));
      });
    }
    return sums;
  }

  /** How much better the build gets with this piece on (0.12 = 12%), as the game's upgradeValue weighs it. */
  function judge(c, item) {
    if (S.isEquipped(item)) return 0;
    if (!S.canWear(item)) return null;
    const owned = S.state.items.includes(item);
    if (!owned) S.state.items.push(item); // the Market's: in the list only while it's worked out (as upgradeValueOf)
    try {
      return compare(c, measures(c, () => S.statsIfEquipped(item.uid)));
    } finally {
      if (!owned) S.state.items.splice(S.state.items.indexOf(item), 1);
    }
  }

  /** The same for several pieces put on at once (pieces of a set, each in its own slot). */
  function judgeGroup(c, items) {
    const map = Object.fromEntries(items.map((it) => [it.slot, it.uid]));
    const shop = items.filter((it) => !S.state.items.includes(it));
    S.state.items.push(...shop); // the Market's: in the list only while it's worked out (as in judge)
    try {
      return compare(c, measures(c, () => withEquipped(map, () => S.statsWithBonus('value', 0))));
    } finally {
      for (const it of shop) S.state.items.splice(S.state.items.indexOf(it), 1);
    }
  }
  // What's worn, changed for a moment (as the game's statsIfEquipped does for one slot), then put back
  function withEquipped(map, fn) {
    const eq = S.state.equipped;
    const saved = {};
    for (const [slot, uid] of Object.entries(map)) {
      saved[slot] = eq[slot];
      eq[slot] = uid;
    }
    try {
      return fn();
    } finally {
      for (const [slot, uid] of Object.entries(saved)) eq[slot] = uid;
    }
  }

  /** Build measures with some gear on, against now: the game's weighted change (upgradeValue). */
  function compare(c, worn) {
    if (!c.base.has('now')) c.base.set('now', measures(c, () => S.statsWithBonus('value', 0)));
    const base = c.base.get('now');
    let sum = 0;
    let weights = 0;
    c.keys.forEach((key, i) => {
      const w = S.PRIORITY_WEIGHTS[i];
      sum += w * Math.log(worn[i] / base[i] || 1);
      weights += w;
    });
    return Math.exp(sum / weights) - 1;
  }

  // Answers are kept until what they were judged with changes; until a new one is ready, the last one
  // stands. New work waits in a queue and is done a slice at a time.
  const answers = new Map(); // uid -> { version, change }
  const queue = new Map(); // key -> the work, given what to judge with
  let pump = 0;
  let spent = 0;
  let sliceStart = 0;
  const inSlice = () => {
    const t = performance.now();
    if (t - sliceStart > 50) {
      sliceStart = t;
      spent = 0;
    }
    return spent < SLICE_MS;
  };
  const enqueue = (key, fn) => {
    if (!queue.has(key)) queue.set(key, fn);
    if (!pump) pump = setTimeout(work, 30);
  };
  function work() {
    pump = 0;
    const t0 = performance.now();
    for (const [key, fn] of queue) {
      if (performance.now() - t0 > SLICE_MS) break;
      queue.delete(key);
      fn(context()); // work added meanwhile (a set's tries) comes after, in this loop or the next
    }
    if (queue.size) pump = setTimeout(work, 30);
    else dispatchEvent(new Event('idle-angler-gear-judge'));
  }
  const judgeNow = (c, item) => {
    const v = judge(c, item);
    answers.set(item.uid, { version: c.version, change: v });
    return v;
  };
  /** The change for this piece, or undefined while it waits to be judged. null: it can't be worn yet. */
  function change(item) {
    if (!item?.uid) return undefined;
    const c = context();
    const a = answers.get(item.uid);
    if (a?.version === c.version) return a.change;
    if (!queue.size && inSlice()) {
      const t0 = performance.now();
      const v = judgeNow(c, item);
      spent += performance.now() - t0;
      return v;
    }
    enqueue(item.uid, (cc) => judgeNow(cc, item));
    return a?.change;
  }

  // ---------- Sets, judged together ----------
  // A set's bonuses come at 2, 4 and 6 pieces worn, so one piece of a set you don't wear does nothing on its
  // own and never looks like an upgrade. Here the set pieces in your bag are also judged together: for each
  // set, the best piece of it for each slot (the one that does most on its own), and every way of putting
  // some of them on that reaches one of its bonuses, counting the pieces of it you already wear. The best
  // way for each set is kept when it beats putting on just its best piece by more than ½%.
  let sets = { sig: '', list: [], byUid: new Map() };
  let planned = '';
  let plans = 0;
  // The set pieces to try: the ones in your bag, and the ones for sale in the Market now
  const shopGear = () => (S.state.shop?.stock ?? []).filter((x) => x.type === 'item' && !x.sold && x.item?.slot).map((x) => x.item);
  const setPieces = () => [...S.looseGear(), ...shopGear()].filter((i) => i.set && S.canWear(i));
  const setSig = (c) => `${c.version}|${setPieces().map((i) => i.uid).join(',')}`;
  function planSets(c, sig) {
    const plan = ++plans;
    const next = new Map(); // set id -> its best way
    const bySet = new Map();
    for (const item of setPieces()) {
      if (!item.set || !SET_BY_ID[item.set] || !S.canWear(item)) continue;
      if (!bySet.has(item.set)) bySet.set(item.set, []);
      bySet.get(item.set).push(item);
    }
    for (const [id, pieces] of bySet) {
      const def = SET_BY_ID[id];
      const wornSlots = new Set(SLOTS.filter((sl) => S.itemByUid(S.state.equipped[sl.id])?.set === id).map((sl) => sl.id));
      const worn = wornSlots.size;
      const best = new Map(); // slot -> { item, alone }
      for (const p of pieces) {
        if (wornSlots.has(p.slot)) continue; // that slot already has a piece of it
        const a = answers.get(p.uid);
        const alone = (a?.version === c.version ? a.change : judgeNow(c, p)) ?? -Infinity;
        if (!best.has(p.slot) || alone > best.get(p.slot).alone) best.set(p.slot, { item: p, alone });
      }
      const slots = [...best.keys()];
      const bonusAt = new Set(def.bonuses.map((b) => b.pieces));
      for (let mask = 1; mask < 1 << slots.length; mask++) {
        const chosen = slots.filter((_, i) => mask & (1 << i)).map((sl) => best.get(sl));
        if (chosen.length < 2 || !bonusAt.has(worn + chosen.length)) continue;
        enqueue(`set:${plan}:${id}:${mask}`, (cc) => {
          if (cc.version !== c.version) return; // judged with something else now: a new plan comes
          const v = judgeGroup(cc, chosen.map((x) => x.item));
          const alone = Math.max(...chosen.map((x) => x.alone));
          if (v <= 0.005 || v <= alone + 0.005 || v <= (next.get(id)?.change ?? -Infinity)) return;
          const items = chosen.map((x) => x.item);
          const shop = items.filter((it) => !S.state.items.includes(it)).length; // to buy first
          next.set(id, { set: id, name: def.name, items, worn, shop, pieces: worn + chosen.length, change: v });
        });
      }
    }
    enqueue(`sets:${plan}`, (cc) => {
      if (cc.version !== c.version) return;
      const list = [...next.values()].sort((a, b) => b.change - a.change);
      const byUid = new Map();
      for (const g of list) for (const it of g.items) if (!byUid.has(it.uid)) byUid.set(it.uid, g);
      sets = { sig, list, byUid };
    });
  }
  /** The sets worth putting on together, best first (the last answer until a new one is ready). */
  function groups() {
    const c = context();
    const sig = setSig(c);
    if (sets.sig !== sig && planned !== sig) {
      planned = sig;
      enqueue(`plan:${sig}`, (cc) => {
        if (cc.version === c.version) planSets(cc, sig);
        else planned = '';
      });
    }
    return sets.list;
  }

  // ---------- The game's badges ----------
  const pctText = (x) => `${x >= 0 ? '+' : ''}${Math.abs(x) >= 0.1 ? Math.round(x * 100) : (x * 100).toFixed(1)}%`;
  const where = () => {
    const t = (id, list) => list.find(([x]) => x === id)?.[1] ?? id;
    const when = pick.time === 'any' && pick.weather === 'any' ? 'over a whole day of weather' : `in ${t(pick.time, TIMES).toLowerCase()}, ${t(pick.weather, WEATHER_PICKS).toLowerCase()}`;
    const how = pick.activity === 'idle' ? 'fishing idle' : pick.activity === 'auto' ? `with the Auto-clicker on (${autoRate()}/s)` : pick.activity === 'chests' ? 'opening them' : 'clicking as you do now';
    return `${when}, ${how}`;
  };
  /** What a change is for: your build, or the money and treasure your chests pay */
  const aim = () => {
    if (pick.activity !== 'chests') return 'your build';
    const n = Object.values(S.state.chests ?? {}).reduce((t, x) => t + (x > 0 ? x : 0), 0);
    return n ? `the money and treasure in your ${n} chest${n === 1 ? '' : 's'}` : 'the money and treasure in chests';
  };
  /** A cell's badge, as the game draws it (ui.js renderBagGear, renderMarket). */
  const badgeHtml = (up) =>
    up > 0.005
      ? `<span class="upg up" title="Gear judge: ${pctText(up)} for ${aim()}, ${where()}">▲${pctText(up).replace('+', '')}</span>`
      : up < -0.005
        ? `<span class="upg down" title="Gear judge: ${pctText(up)} for ${aim()}, ${where()}">▼</span>`
        : '';
  /** A piece of a set worth putting on with others of it: the ▲ in the set colour, with the set's change. */
  const setNote = (g) =>
    `${pctText(g.change)} for ${aim()} with ${g.items.length === 2 ? 'both these' : `these ${g.items.length}`} ${g.name} pieces on together (its ${g.pieces}-piece bonus${g.worn ? `, with the ${g.worn} you wear` : ''}), ${where()}${g.shop ? `. ${g.shop === g.items.length ? 'All of them are' : g.shop === 1 ? '1 of them is' : `${g.shop} of them are`} in the Market: buy ${g.shop === 1 ? 'it' : 'them'} first` : ''}`;
  const groupBadgeHtml = (g) => `<span class="upg up gj-set" style="color:${hex(SET_COLOR)}" title="Gear judge: ${setNote(g)}">▲${pctText(g.change).replace('+', '')}</span>`;
  // A piece for a slot you have nothing in: always an upgrade, at once (with its change once it's judged)
  const emptySlot = (item) => !S.state.equipped[item.slot] && S.canWear(item);
  const emptyBadgeHtml = (item, up) =>
    `<span class="upg up" title="Gear judge: your ${item.slot} slot is empty, so anything for it is an upgrade${up > 0.005 ? ` (${pctText(up)} for ${aim()}, ${where()})` : ''}">▲${up > 0.005 ? pctText(up).replace('+', '') : ''}</span>`;
  function setBadge(cell, up, group, empty) {
    if (up === undefined && !group && !empty) return; // not judged yet: the game's stays
    const html = group && group.change > (up ?? 0) ? groupBadgeHtml(group) : empty ? emptyBadgeHtml(empty, up) : badgeHtml(up ?? 0);
    const old = cell.querySelector(':scope > .upg');
    if ((old?.outerHTML ?? '') === html) return;
    if (old) old.remove();
    if (!html) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    (cell.querySelector(':scope > .ilvl') ?? cell.firstElementChild)?.after(tpl.content.firstChild);
  }
  const layer = document.getElementById('windows');
  function badges() {
    if (!layer) return;
    groups(); // a new plan, when the sets' pieces or what they're judged with changed
    for (const cell of layer.querySelectorAll('.bag-cell[data-uid]')) {
      if (cell.closest('#summary-panel')) continue; // Quicklinks draws its own
      const item = S.itemByUid(cell.dataset.uid);
      if (item?.slot) setBadge(cell, change(item), sets.byUid.get(item.uid), emptySlot(item) && item);
    }
    for (const cell of layer.querySelectorAll('.stall-cell[data-tip^="shop:"]')) {
      if (cell.closest('#summary-panel')) continue;
      const slot = S.state.shop?.stock?.[Number(cell.dataset.tip.slice(5))];
      if (slot?.type === 'item') setBadge(cell, change(slot.item), sets.byUid.get(slot.item.uid), emptySlot(slot.item) && slot.item);
    }
  }
  let frame = 0;
  const later = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      badges();
    });
  };
  const observer = new MutationObserver(later);
  if (layer) observer.observe(layer, { childList: true, subtree: true });
  addEventListener('idle-angler-gear-judge', later);

  // ---------- For Quicklinks and Settings > Mods ----------
  function setPick(next) {
    pick = { ...pick, ...next };
    try {
      localStorage.setItem(TIME_KEY, pick.time);
      localStorage.setItem(WEATHER_KEY, pick.weather);
      localStorage.setItem(ACTIVITY_KEY, pick.activity);
    } catch {
      // storage blocked: the choice lasts until the page reloads
    }
    context();
    queue.clear();
    planned = '';
    dispatchEvent(new Event('idle-angler-gear-judge'));
  }
  window.gearJudge = {
    change,
    groups,
    groupOf: (uid) => sets.byUid.get(uid), // the set worth putting on that this piece is in, if any
    setNote,
    // For the console: the change for putting these pieces on together, e.g. gearJudge.tryTogether([a, b])
    tryTogether: (items) => judgeGroup(context(), items),
    get pick() {
      return { ...pick };
    },
    setPick,
    times: TIMES,
    weathers: WEATHER_PICKS,
    get activities() {
      return activities();
    },
    where,
    aim,
    get pending() {
      return queue.size;
    },
    get version() {
      return context().version;
    },
  };
  window.setGearJudge = setPick;
  later();

  window.stopGearJudge = () => {
    clearTimeout(pump);
    cancelAnimationFrame(frame);
    observer.disconnect();
    removeEventListener('idle-angler-gear-judge', later);
    queue.clear();
    delete window.gearJudge;
    delete window.setGearJudge;
    delete window.gearJudgeChoices;
    delete window.stopGearJudge;
    dispatchEvent(new Event('idle-angler-gear-judge')); // Quicklinks goes back to the game's measure
  };
  console.log('[gear judge] On: gear is judged over a whole day of weather (Settings > Mods). Turn it off with stopGearJudge()');
};

idleAnglerMods.define({
  id: 'gearJudge',
  order: 50,
  name: "Gear judge",
  desc: "The ▲ / ▼ on gear (Bags, the Market, Quicklinks) judged over a whole day of weather instead of this moment's: night-only and weather powers count for the time they work, by how much you click, without bonuses that are about to end. Or judge it for one time of day or weather, and for idle play or the Auto-clicker; or for opening chests (the money and treasure your chests pay with it on)",
  start: gearJudge,
  stop: 'stopGearJudge',
  // The lists come from the game's world.js once the mod runs (these until then)
  options: [
    {
      key: 'idle-angler-judge-time',
      label: 'Time of day',
      get values() {
        return window.gearJudgeChoices?.time ?? [['any', 'Any time of day'], ['now', 'Time of day now']];
      },
      fallback: 'any',
      apply: (value) => window.setGearJudge?.({ time: value }), // live, without a restart
    },
    {
      key: 'idle-angler-judge-weather',
      label: 'Weather',
      get values() {
        return window.gearJudgeChoices?.weather ?? [['any', 'Any weather'], ['now', 'Weather now']];
      },
      fallback: 'any',
      apply: (value) => window.setGearJudge?.({ weather: value }),
    },
    {
      key: 'idle-angler-judge-activity',
      label: 'How you play',
      get values() {
        return window.gearJudgeChoices?.activity ?? [['now', 'As you click now'], ['idle', 'Idle'], ['auto', 'Auto-clicker']];
      },
      fallback: 'now',
      apply: (value) => window.setGearJudge?.({ activity: value }),
    },
  ],
});
}

{
// =====================================================================================================
// Quicklinks (was summary-panel.js, the Summary panel)
//
// It adds a second sidebar like the game's down the right edge, with a Quicklinks button. It slides out a panel, drawn as one of
// the game's windows, with what most needs you right now. While the panel is out, the game's bars move over
// to make room beside it (nothing is covered); the scene stays where it is at its full size, its right edge
// under the panel (the catch feed and the right sail tab come in), so the view doesn't move about as it
// slides; out on the water the camera eases your angler over to the middle of the part you see, and the
// big announcements ("Legendary!") show there too. The button again, or the panel's ✕, puts it away. Drag the
// panel's left edge to make it wider or narrower (double-click the edge to have it fit the bounty names again).
// The panel shows:
//  - At the top, the weather now (the forecast mod draws it; a click opens the forecast)
//  - Min-maxer: the income pills (that mod puts them here while both run), and under
//    them the 3 stats a +10% of is worth the most Gold/s (the Min-maxer's Gains tab); Open opens the Min-maxer
//  - Builds: the 6 pieces of gear you're wearing (click one to take it off, as on the paper doll), then
//    your saved gear sets; click one to put it on (its number key does too, with the build switcher on),
//    ⟳ saves what you're wearing over it, ✕ deletes it, and "+ Save what you're wearing" adds a new one
//  - Bounties: the three bounty rows, with their progress and Claim (or Reroll) buttons
//  - Ascend: how many times you've ascended, progress toward the next ascension (or the Oracle's target),
//    and the Oracle's "ascend for me" as buttons (Off, 1x-10x) beside the Ascend button
//  - Foreman: the upgrade it buys next (as the Upgrades window draws it, with its buy button), and what
//    it's buying (off, save up for the top of the list, or the next one you can afford)
//  - Chests: how many you have, what opening them all now pays on average, and Open all
//  - Bag: how full your bag is, then only the gear that's better for your build than what you're wearing
//    (by the Gear judge while it runs, with its time of day, weather and way of playing to pick above the list)
//  - Market: what's on sale now (as Market & Bounties > Market draws it; a click buys), when new stock
//    comes, and Restock
// Every button and dropdown here is the game's own: the panel sits inside the game's window layer, so
// a click runs exactly what the same button in the game's windows runs (the Ascend button asks first,
// Open all shows what came out, a click on gear opens the game's Put on / Sell / Lock menu,
// Ctrl-click sells and right-click locks, as in your bag). Each section's Open opens the game's
// window for it; a click on its title (or ▼) collapses it, which this browser remembers. The panel takes the Altar's black and crimson while you're in the basement.
// Stop it (and remove the panel) with:  stopSummaryPanel(), or untick it in Settings > Mods
// =====================================================================================================
const summaryPanel = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { RARITIES, STATS, ZONES, ZONE_BY_ID, BOUNTIES, SET_COLOR, AUTO_ASCEND_AT, AUTOMATION_BY_ID, GEAR_SETS, UPGRADE_BY_ID, SLOT_BY_ID, CHEST_GOLD, TREASURE_VALUE } = await mod('/src/data.js');
  const { fmt, fmtHtml, fmtDecHtml, fmtOdds, money, moneyHtml, hex } = await mod('/src/format.js');
  const { tierOdds, gearDropScale, rollChestContents } = await mod('/src/loot.js');
  const { GAIN_STATS, tenPercentPoints } = await mod('/src/minmax.js');
  const chestBase = chestBaseRule({ rollChestContents, RARITIES, CHEST_GOLD, ZONES, stats: S.getStats() }); // what a chest's value starts from, in this build
  const { describeBounty, bountyProgress, rewardTier } = await mod('/src/bounties.js');
  const { ICON_COLS, ICON_ROWS, ICON_INDEX } = await mod('/src/icon-index.js');

  window.stopSummaryPanel?.(); // replace one already running
  // Two starts at once (the Mods checkbox and a paste, say) both find none running while the game's files
  // load, so the newest one wins: each run has a token, and one that isn't the newest takes itself away
  // (its timer would otherwise keep putting its sidebar back). Anything an older copy left goes too.
  const run = {};
  window.summaryPanelRun = run;
  for (const id of ['qs-host', 'qs-hotbar', 'summary-style', 'qs-sidebar-style']) document.getElementById(id)?.remove();
  viewCentre.add('quicklinks'); // the camera centres on the part of the scene you see

  // The game's window layer: its click and change handlers (ui.js onAction / onChangeInput) run every
  // data-action button and data-change dropdown inside it, so the panel lives in there
  const layer = document.getElementById('windows');
  const app = document.getElementById('app');
  if (!layer || !app) return console.warn('[summary] The game page was not found (#windows, #app)');

  const STORE_KEY = 'idle-angler-summary-open';
  const FOLD_KEY = 'idle-angler-quicklinks-collapsed'; // section ids, as JSON
  const MAX_GEAR = 450;
  const SLIDE_MS = 180;
  // The panel's width: wide enough for each bounty's name on one line, between these (and never more
  // than half the window, or 85% of a narrow one). A name too long even then ends in "…" (hover for it).
  const MIN_W = 520;
  const MAX_W = 640;

  // ---------- The game's own helpers (copies from ui.js: it doesn't export them) ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tierColor = (tier) => hex(RARITIES[tier].color);
  const tierName = (tier) => RARITIES[tier].name;
  const itemColor = (item) => (item.set ? hex(SET_COLOR) : tierColor(item.tier));
  const disabled = (cond) => (cond ? 'disabled' : '');
  const pctText = (x) => `${x >= 0 ? '+' : ''}${Math.abs(x) >= 0.1 ? Math.round(x * 100) : (x * 100).toFixed(1)}%`;
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }
  function gameIcon(key, size = 32) {
    const i = ICON_INDEX[key];
    if (i === undefined) return '';
    return `<span class="gicon s${size}" style="background-image:url(/assets/icons/raven-${size}.png);background-size:${ICON_COLS * size}px ${ICON_ROWS * size}px;background-position:-${(i % ICON_COLS) * size}px -${Math.floor(i / ICON_COLS) * size}px" aria-hidden="true"></span>`;
  }
  const chestIcon = (tier) => `<span class="icon has-img" style="--c:${tierColor(tier)}">${gameIcon(`chest:${tier}`, 32)}</span>`;
  const SLOT_ICONS = { rod: 'fishing-pole', reel: 'spinning-wheel', line: 'rope-coil', hook: 'fishing-hook', bait: 'fishing-lure', charm: 'gem-pendant' };
  const itemArt = (item) =>
    gameIcon(`gear:${item.slot}:${Math.min(7, Math.max(0, item.level ?? 0))}`, 32) || `<span class="ui-icon" style="--icon:url(/assets/icons/ui/${SLOT_ICONS[item.slot]}.svg)"></span>`;
  // An automation not bought yet: the game's own note, a link to it in the Upgrades window
  const lockNote = (id) =>
    `<button class="muted small-text locked-note goto" data-action="goto" data-panel="automation">🔒 Unlock <b>${esc(AUTOMATION_BY_ID[id]?.name ?? id)}</b> in Upgrades (${moneyHtml(AUTOMATION_BY_ID[id]?.cost ?? 0)}, kept for good) <span class="goto-arrow">→</span></button>`;

  // ---------- Builds: the gear you're wearing and your gear sets (as Angler > Character draws them) ----------
  // The 6 gear squares (ui.js slotCell): click one to take it off, as on the paper doll
  const emptySlotArt = (slot) => gameIcon(`gear:${slot}:0`, 32) || `<span class="ui-icon" style="--icon:url(/assets/icons/ui/${SLOT_ICONS[slot]}.svg)"></span>`;
  function slotCell(slotId) {
    const item = S.itemByUid(S.state.equipped[slotId]);
    const slot = SLOT_BY_ID[slotId];
    if (!item) return `<div class="gear-slot empty" title="${esc(slot?.name ?? slotId)}: empty">${emptySlotArt(slotId)}<span class="slot-label">${esc(slot?.name ?? slotId)}</span></div>`;
    return `<button class="gear-slot q${item.ancient ?? 0} ${item.set ? 'set' : ''}" style="--c:${itemColor(item)}" data-action="unequip" data-slot="${slotId}" data-tip="item:${item.uid}" aria-label="${esc(S.itemName(item))}">
      ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span></button>`;
  }
  const priorityName = (key) => (key === 'gold' ? 'Income' : STATS[key]?.seekTier ? `${RARITIES[STATS[key].seekTier].name} odds` : STATS[key]?.name ?? key);
  function gearSetsHtml() {
    const st = S.state;
    const sets = st.gearSets ?? [];
    const keys = window.buildSwitcherKeys ?? 0; // the build switcher's 1-5, while it runs
    const cells = sets.map((set, i) => {
      const pieces = Object.entries(set.items ?? {});
      const have = pieces.filter(([, uid]) => S.itemByUid(uid)).length;
      const wearing = pieces.length > 0 && pieces.every(([slot, uid]) => st.equipped[slot] === uid);
      const key = i < keys ? `<kbd title="Press ${i + 1} to put this set on">${i + 1}</kbd>` : '';
      return `<div class="gearset">
        <button class="btn small ${wearing ? 'primary' : ''}" data-action="gearset-equip" data-index="${i}" title="Put this set on${set.priority ? ` (and its build: ${esc(set.priority.length ? set.priority.map(priorityName).join(', ') : 'Income')})` : ''}${key ? ` · or press ${i + 1}` : ''}">${key}${esc(set.name)} <span class="muted">${have}/${pieces.length}</span></button>
        <button class="btn small icon-btn" data-action="gearset-save" data-index="${i}" title="Save what you're wearing as ${esc(set.name)}">⟳</button>
        <button class="btn small icon-btn" data-action="gearset-delete" data-index="${i}" title="Delete ${esc(set.name)}">✕</button>
      </div>`;
    });
    if (sets.length < GEAR_SETS.max) cells.push(`<button class="btn small" data-action="gearset-save" data-index="${sets.length}">+ Save what you're wearing</button>`);
    return `<div class="gearsets">${cells.join('')}</div>`;
  }
  const buildsHtml = () => `<div class="qs-slots">${['rod', 'hook', 'reel', 'bait', 'line', 'charm'].map(slotCell).join('')}</div>${gearSetsHtml()}`;

  // ---------- Bounties (as the game's bounty board draws them) ----------
  const bountyBestZone = () => ZONES.filter((z) => S.state.zonesUnlocked.includes(z.id)).pop() ?? ZONES[0];
  function bountyRewardText(b) {
    const tier = Math.min(bountyBestZone().maxTier, rewardTier(bountyBestZone()) + (b.reward === 'gear' && b.stars === 3 ? 1 : 0));
    const rarity = `<span style="color:${tierColor(tier)}">${tierName(tier)}</span>`;
    if (b.reward === 'gold') return `<span class="gold-text">${BOUNTIES.goldMinutes[b.stars - 1]} minutes of income</span>`;
    if (b.reward === 'chests') return `${BOUNTIES.chestCount[b.stars - 1]} ${rarity}-or-better chests`;
    return `a piece of ${rarity}-or-better gear`;
  }
  const rewardIcon = (b) => {
    if (b.reward === 'chests') return chestIcon(Math.min(bountyBestZone().maxTier, rewardTier(bountyBestZone())));
    return `<span class="icon has-img">${gameIcon(b.reward === 'gold' ? 'cur:gold' : 'gear:charm:0', 32)}</span>`;
  };
  const finishedBounties = () => (S.state.bounties?.slots ?? []).filter((b) => b && bountyProgress(b, S.state.lifetimeGold) >= b.need).length;
  function bountiesHtml() {
    const st = S.state;
    const b = st.bounties;
    if (!b?.slots) return '<p class="muted small-text">No bounties yet.</p>';
    const now = Date.now();
    const free = now >= b.rerollAt;
    const rows = b.slots.map((bounty, i) => {
      if (!bounty) {
        return `<li class="row bounty-row empty">
          <div class="row-main muted">A new bounty comes in ${duration(b.nextAt[i] - now)}</div>
          ${free ? `<button class="btn small" data-action="bounty-reroll" data-index="${i}">Get one now</button>` : ''}
        </li>`;
      }
      const have = bountyProgress(bounty, st.lifetimeGold);
      const done = have >= bounty.need;
      return `<li class="row bounty-row ${done ? 'done' : ''}">
        ${rewardIcon(bounty)}
        <div class="row-main">
          <div class="name qs-line" title="${esc(describeBounty(bounty, fmt))}"><span class="qs-fit"><span class="stars" title="${bounty.stars} of 3 stars: bigger jobs pay more">${'★'.repeat(bounty.stars)}${'☆'.repeat(3 - bounty.stars)}</span> ${esc(describeBounty(bounty, fmt))}</span></div>
          <div class="xp-bar wide bounty-bar"><span style="width:${Math.min(100, (have / bounty.need) * 100).toFixed(1)}%"></span></div>
          <div class="sub">${bounty.kind === 'gold' ? `${moneyHtml(have)} / ${moneyHtml(bounty.need)}` : `${fmtHtml(have)} / ${fmtHtml(bounty.need)}`} · ${bountyRewardText(bounty)} and XP</div>
        </div>
        ${done ? `<button class="btn primary small" data-action="bounty-claim" data-index="${i}">Claim</button>` : `<button class="btn small" data-action="bounty-reroll" data-index="${i}" ${disabled(!free)} title="Swap this bounty for another">Reroll</button>`}
      </li>`;
    });
    return `<ul class="list bounties">${rows.join('')}</ul>
      <p class="muted small-text">${free ? 'You have a free reroll.' : `Next free reroll in ${duration(b.rerollAt - now)}.`}</p>`;
  }

  // ---------- Ascend and the Oracle (as the Ascension window draws them) ----------
  // The bar measures toward where the Oracle will ascend for you (its 1×-10×), or the requirement itself
  // while it's off or not bought. Its choice is a row of buttons, one per multiple the game offers: each
  // is the game's own auto-ascend control (data-change, the value the dropdown's option has), and a click
  // on the lit one sends 0, the dropdown's "off" (onOracle, below, hands it to the game's change handler).
  function ascendHtml() {
    const st = S.state;
    const req = S.ascensionRequirement();
    const oracle = S.hasAutomation('oracle');
    const at = oracle ? st.settings.autoAscendAt : 0;
    const target = req * (at || 1);
    const progress = Math.min(1, st.runGold / target);
    const can = S.canAscend();
    const goal = at ? `${moneyHtml(target)} <span class="muted">for the Oracle at ${at}×</span>` : `${moneyHtml(req)} needed`;
    // Off, then 1x-10x: the game's dropdown's options (AUTO_ASCEND_AT), the one set lit
    const choices = AUTO_ASCEND_AT.map((x) => {
      const on = (st.settings.autoAscendAt ?? 0) === x;
      const title = x ? `Ascend for me at ${x}× the requirement (${money(req * x)})` : "Don't ascend for me";
      return `<button type="button" class="btn small ${on ? 'primary' : ''}" data-change="auto-ascend" value="${x}" aria-pressed="${on}" title="${title}">${x ? `${x}x` : 'Off'}</button>`;
    }).join('');
    const ascendBtn = (wide) => `<button class="btn primary ${wide ? 'wide' : 'qs-ascend'}" data-action="ascend" ${disabled(!can)}>
        ${can ? `Ascend for +${fmtHtml(S.pendingEssence())} Essence` : `Ascend (${Math.min(100, (st.runGold / req) * 100).toFixed(1)}%)`}
      </button>`;
    return `<div class="qs-asc-count">Ascensions: <b>${fmtHtml(st.ascension.count)}</b></div>
      <div class="sub">Earned this run: <b>${moneyHtml(st.runGold)}</b> / ${goal}</div>
      <div class="progress"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>
      ${
        oracle
          ? `<div class="setting-select qs-oracle"><span>Oracle:</span><span class="qs-oracle-at">${choices}</span>${ascendBtn(false)}</div>`
          : `${ascendBtn(true)}${lockNote('oracle')}`
      }`;
  }

  // ---------- The Foreman (as the Upgrades window's Automation tab draws it) ----------
  // Its next upgrade: state.js nextAutoUpgrade, which isn't exported. The first on its list that isn't maxed,
  // or with "buy the next one I can afford", the first it can pay a level of now. When it can pay for none,
  // the one it buys first as gold comes in: the cheapest level (the earlier on the list on a tie).
  function foremanNext() {
    const set = S.state.settings;
    const discount = S.upgradeDiscount();
    let cheapest = null;
    for (const id of set.autoUpgradeOrder ?? []) {
      const up = UPGRADE_BY_ID[id];
      if (!up || S.upgradeLevel(id) >= up.maxLevel) continue;
      if (!set.autoUpgradeNextAfforded) return up;
      const cost = S.bulkCost(up, S.upgradeLevel(id), 1, discount);
      if (S.state.gold >= cost) return up;
      if (!cheapest || cost < cheapest.cost) cheapest = { up, cost };
    }
    return cheapest?.up ?? null;
  }
  // The upgrade's row as the Upgrades window draws it (ui.js renderUpgrades, effectText, milestoneText), without
  // its fold button. Its buy button buys what the window's x1 / x10 / Max would.
  function upgradeRowHtml(up) {
    const level = S.upgradeLevel(up.id);
    const plan = S.purchasePlan(up, level, S.state.gold, S.upgradeDiscount());
    const info = STATS[up.stat];
    const effect = !info
      ? ''
      : up.type === 'mult'
        ? `×${fmtDecHtml(up.perLevel)} ${info.name} per level · now ×${fmtDecHtml(S.leveledEffect(up, level))}`
        : `+${fmtDecHtml(up.perLevel)}${info.unit} ${info.name} per level · now +${fmtDecHtml(S.leveledEffect(up, level))}${info.unit}`;
    const next = S.nextMilestone(up, level);
    const milestone = next ? `<div class="milestone">★ Lv ${next}: +${Math.round((up.milestone - 1) * 100)}% of its effect again <span class="muted">(${next - level} to go)</span></div>` : '';
    const sign = up.type === 'mult' ? ['×', '#f472b6'] : ['+', '#38bdf8'];
    return `<ul class="list qs-next-up"><li class="row">
        <span class="icon" style="--c:${sign[1]}">${sign[0]}</span>
        <div class="row-main">
          <div class="name">${esc(up.name)} <span class="muted">Lv ${level}/${up.maxLevel}</span></div>
          <div class="sub">${effect}</div>
          ${milestone}
        </div>
        <button class="btn primary buy" data-action="buy-upgrade" data-id="${up.id}" ${disabled(!plan.affordable)}>
          ${plan.n > 1 ? `+${plan.n} · ` : ''}<span class="amt">${moneyHtml(plan.cost)}</span>
        </button>
      </li></ul>`;
  }
  function foremanHtml() {
    if (!S.hasAutomation('foreman')) return lockNote('foreman');
    const set = S.state.settings;
    const mode = !set.autoUpgrade ? 'off' : set.autoUpgradeNextAfforded ? 'next' : 'save';
    const listed = (set.autoUpgradeOrder ?? []).length;
    const up = foremanNext();
    const nextRow = up
      ? upgradeRowHtml(up)
      : listed
        ? '<p class="muted small-text">Everything on its list is maxed</p>'
        : '';
    return `${nextRow}<label class="setting-select">Buying <select data-change="autoup-mode" aria-label="How Foreman buys upgrades">${[
      ['off', 'Off'],
      ['save', 'Save up for the top of the list'],
      ['next', 'Buy the next one I can afford'],
    ]
      .map(([v, label]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`)
      .join('')}</select></label>
      <p class="muted small-text">${listed ? `${listed} upgrade${listed === 1 ? '' : 's'} on its list` : 'Its list is empty: nothing is bought'} · <button class="goto" data-action="goto" data-panel="automation">Change the list <span class="goto-arrow">→</span></button></p>`;
  }

  // ---------- The best +10% (the Min-maxer's Gains tab, minmax-ui.js renderGains) ----------
  // The same sum: each stat 10% higher than you have it, through the game's own goldPerSecond at your
  // clicks a second here, against what you make now. Worked out again every 5 s, or when the zone, clicking
  // or the main stats change (as the game does).
  const GAINS_SHOWN = 3;
  let gainsCache = { at: 0, key: '', rows: [] };
  function gainsHtml() {
    const stats = S.getStats();
    const zone = S.currentZone();
    const c = S.clickRate();
    const key = `${zone.id}|${c.toFixed(1)}|${stats.valueMult}|${stats.luckMult}|${stats.multiCatch}`;
    if (Date.now() - gainsCache.at > 5000 || gainsCache.key !== key) {
      const base = S.goldPerSecond(stats, zone, c);
      const rows = GAIN_STATS.map((stat) => {
        const points = tenPercentPoints(stats, stat);
        const with10 = S.goldPerSecond(S.statsWithBonus(stat, points), zone, c);
        return { stat, points, gain: base > 0 ? with10 / base - 1 : 0 };
      }).sort((a, b) => b.gain - a.gain);
      gainsCache = { at: Date.now(), key, rows };
    }
    const top = gainsCache.rows.filter((r) => r.gain >= 0.0005).slice(0, GAINS_SHOWN); // the Min-maxer's "no effect" line
    if (!top.length) return '<p class="muted small-text">No stat raises your Gold here.</p>';
    const best = top[0].gain;
    const rows = top
      .map(({ stat, points, gain }) => `<tr data-tip="stat:${stat}"><td>${esc(STATS[stat]?.name ?? stat)}</td><td class="muted">+${fmtDecHtml(points)} pts</td><td><b>+${(gain * 100).toFixed(2)}%</b></td><td><span class="mm-bar"><i style="width:${((gain / best) * 100).toFixed(1)}%"></i></span></td></tr>`)
      .join('');
    return `<table class="mm-table mm-gains"><tr><th>Best +10%</th><th>Bonus</th><th>Gold/min</th><th></th></tr>${rows}</table>`;
  }

  // ---------- Chests ----------
  // What opening them all now pays on average. A chest's contents are rolled when it's opened, with your
  // stats then (state.js rollChests, loot.js rollChestContents), so this is that roll's average with your
  // stats now: its coin, and each roll's treasure (a rarity from chest luck, no lower than 2 under the
  // chest's: loot.js tierOddsFrom) unless the roll is gear (CHEST_ITEM_CHANCE, not exported). Gear isn't
  // priced: it's counted. A Golden Fish's Gold Rush counts for less when opening (state.js
  // withGoldenForChests, not exported), so while one is on this reads high.
  const CHEST_ITEM_CHANCE = 0.35;
  function chestWorth(owned) {
    const s = S.getStats();
    const chestValue = s.chestValueMult ?? 1; // Plunderer, Magpie, Fortune's Embrace
    let coin = 0, treasure = 0, gear = 0;
    for (const { zone, tier, count } of owned) {
      const base = chestBase(s, zone);
      coin += count * base * RARITIES[tier].valueMult * CHEST_GOLD * s.valueMult * chestValue;
      const odds = tierOdds(s.chestLuckMult, Math.min(RARITIES.length - 1, zone.maxTier + 1));
      const floor = Math.max(0, tier - 2);
      const perTreasure = base * odds.reduce((t, q, i) => t + (q || 0) * RARITIES[Math.max(i, floor)].valueMult, 0) * TREASURE_VALUE * s.treasureMult * chestValue;
      const rolls = count * (1 + Math.floor(tier / 2));
      const gearShare = CHEST_ITEM_CHANCE * gearDropScale(s, zone);
      treasure += rolls * (1 - gearShare) * perTreasure;
      gear += rolls * gearShare;
    }
    return { coin, treasure, gear };
  }

  function chestsHtml() {
    const owned = Object.entries(S.state.chests ?? {})
      .map(([key, count]) => {
        const [zoneId, tier] = key.split(':');
        return { count, zone: ZONE_BY_ID[zoneId], tier: Number(tier) };
      })
      .filter((c) => c.zone && c.count > 0);
    const total = owned.reduce((n, c) => n + c.count, 0);
    const byTier = new Map();
    for (const c of owned) byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + c.count);
    const kinds = [...byTier]
      .sort((a, b) => b[0] - a[0])
      .map(([tier, n]) => `<span style="color:${tierColor(tier)}">${fmtHtml(n)} ${esc(tierName(tier))}</span>`)
      .join(' · ');
    const best = owned.length ? Math.max(...owned.map((c) => c.tier)) : 0;
    let worth = '';
    if (total) {
      const { coin, treasure, gear } = chestWorth(owned);
      const sold = S.state.settings?.autoSellTreasure && S.state.automations?.pawnbroker; // as applyChests sells it
      const title = `Opening them all now pays about ${money(coin + treasure)} on average: ${money(coin)} in coin and ${money(treasure)} in treasure`
        + (sold ? ', which the Pawnbroker sells at once.' : ', which goes to your bag to sell.')
        + ` About ${fmt(Math.round(gear))} pieces of gear come out too (not counted).`
        + ' Chests are priced when you open them, with your gear, weather and time of day then, so this moves with them.';
      worth = `<div class="sub" title="${esc(title)}">Worth about <b>${moneyHtml(coin + treasure)}</b>${sold ? '' : ' with treasure sold'}</div>`;
    }
    return `<div class="qs-chests">
        ${chestIcon(best)}
        <div class="row-main"><div class="name">${total ? `${fmtHtml(total)} chest${total === 1 ? '' : 's'}` : 'No chests'}</div>${kinds ? `<div class="sub">${kinds}</div>` : ''}${worth}</div>
        <button class="btn primary" data-action="open-every-chest" ${disabled(!total)}>Open all</button>
      </div>`;
  }

  // ---------- Upgrades in the bag ----------
  // The same test as the game's ▲ badge on Bags: loose gear you can wear that improves your build by
  // more than half a percent (S.upgradeValue). Worked out every 2 s, as the game does, or at once when
  // your gear, build or level changes.
  // With the Gear judge on, its measure instead (over a whole day of weather, or the time, weather and way of
  // playing picked above the list), and its answers as they come in. The Market section uses it too.
  const gear = { at: 0, sig: '', list: [] };
  const judge = () => window.gearJudge;
  const gearSig = () =>
    [S.state.player?.level, JSON.stringify(S.state.equipped), JSON.stringify(S.state.settings.buildPriority ?? []), S.looseGear().map((i) => i.uid + (i.locked ? 'L' : '')).join(','), judge() ? `j${judge().version}:${judgeSeen}` : ''].join('|');
  let judgeSeen = 0; // bumped as the judge's answers come in
  const upgradeOf = (item) => (judge() ? judge().change(item) : S.upgradeValueOf(item).change);
  function upgrades() {
    const now = performance.now();
    const sig = gearSig();
    if (sig === gear.sig && now - gear.at < 2000) return gear.list;
    gear.at = now;
    gear.sig = sig;
    // A piece for a slot you have nothing in is always an upgrade, whatever it adds: those come first
    gear.list = S.looseGear()
      .filter((i) => S.canWear(i))
      .map((item) => ({ item, up: judge() ? judge().change(item) : S.upgradeValue(item.uid).change, empty: !S.state.equipped[item.slot] }))
      .filter((x) => x.empty || x.up > 0.005)
      .sort((a, b) => b.empty - a.empty || (b.up ?? 0) - (a.up ?? 0) || (b.item.ilvl ?? 0) - (a.item.ilvl ?? 0));
    return gear.list;
  }
  // The Gear judge's time of day, weather and how you play, as three of the game's dropdowns
  function judgePicker() {
    const j = judge();
    if (!j) return '';
    const label = { time: 'Judge gear for this time of day', weather: 'Judge gear for this weather', activity: 'Judge gear for how you play: clicking as now, idle, or with the Auto-clicker; or for opening chests (the money and treasure in them)' };
    const select = (kind, list, now) =>
      `<select data-qs-judge="${kind}" aria-label="${label[kind]}" title="${label[kind]}">${list.map(([id, name]) => `<option value="${id}" ${id === now ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
    return `<div class="setting-select qs-judge"><span>Upgrades For:</span>${select('time', j.times, j.pick.time)}${select('weather', j.weathers, j.pick.weather)}${j.activities ? select('activity', j.activities, j.pick.activity) : ''}</div>`;
  }
  // Its ▲: the change for your build; for a slot you have nothing in, ▲ alone until it adds over ½%
  const emptyFor = (item) => S.canWear(item) && !S.state.equipped[item.slot];
  const upBadge = (item, up) =>
    up > 0.005
      ? `<span class="upg up">▲${pctText(up).replace('+', '')}</span>`
      : emptyFor(item)
        ? `<span class="upg up" title="Your ${esc(SLOT_BY_ID[item.slot]?.name ?? item.slot)} slot is empty: anything for it is an upgrade">▲</span>`
        : '';
  // A piece in your bag, as Bags > Gear draws it (ui.js renderBagGear), with the badge given
  function gearCell(item, badge) {
    const inSet = S.inGearSet(item.uid);
    const cls = [`q${item.ancient ?? 0}`, item.set ? 'set' : '', item.locked ? 'locked' : '', inSet ? 'in-set' : ''].join(' ');
    return `<button class="bag-cell ${cls}" style="--c:${itemColor(item)}" data-action="bag-item" data-uid="${item.uid}" data-tip="item:${item.uid}" aria-label="${esc(S.itemName(item))}">
      ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span>${badge}${item.locked ? '<span class="lock" title="Locked">🔒</span>' : ''}${inSet ? '<span class="set-mark" title="In a saved gear set">◆</span>' : ''}</button>`;
  }
  // The Gear judge's sets worth putting on together: the set, how many pieces with the ones you wear, the
  // change, and the pieces to put on (each the game's bag button: a click puts it on, as in Bags)
  const setGroups = () => judge()?.groups?.() ?? [];
  const setUpBadge = (g) => `<span class="upg up" style="color:${hex(SET_COLOR)}" title="${esc(judge().setNote(g))}">▲${pctText(g.change).replace('+', '')}</span>`;
  function setsHtml() {
    return setGroups()
      .map((g) => {
        const up = pctText(g.change).replace('+', '');
        const badge = setUpBadge(g);
        // A piece from the Market: its stall (a click buys it); one in your bag: its bag button (a click puts it on)
        const stock = S.state.shop?.stock ?? [];
        const cell = (it) => {
          const i = stock.findIndex((x) => x.type === 'item' && x.item === it);
          return i >= 0 ? stallCell(stock[i], i, badge) : gearCell(it, badge);
        };
        const what = g.shop ? `buy ${g.shop === g.items.length ? (g.shop === 2 ? 'both' : `all ${g.shop}`) : g.shop} from the Market${g.shop < g.items.length ? ', then put on these' : ' and put them on'}` : `put on these ${g.items.length}`;
        return `<div class="qs-set-group" title="${esc(judge().setNote(g))}"><div class="qs-set-name"><b style="color:${hex(SET_COLOR)}">${esc(g.name)}</b>
          <span class="muted small-text">${g.pieces} pieces${g.worn ? ` (${g.worn} on now)` : ''}: ${what}</span><b class="qs-set-up">▲${up}</b></div>
          <div class="bag-grid">${g.items.map(cell).join('')}</div></div>`;
      })
      .join('');
  }
  // How full your bag is, as Bags counts it (its "Bag 34/40" tab): loose gear against the room you have.
  // When it's full, gear you catch or are given is sold, and the Market sells you no more (state.js bagFull)
  function bagHtml() {
    const used = S.looseGear().length;
    const room = S.inventorySize?.() ?? 0;
    if (!room) return '';
    const free = Math.max(0, room - used);
    const full = free === 0;
    const tight = !full && free <= Math.max(2, Math.ceil(room * 0.1));
    const title = full
      ? 'Your bag is full: gear you catch, open or are given is sold, and the Market can’t sell you any. Sell or salvage some to make room.'
      : `${free} of ${room} spaces free in your bag`;
    return `<div class="qs-bag ${full ? 'full' : tight ? 'tight' : ''}" title="${esc(title)}"><span>Bag ${used}/${room}</span>
      <div class="progress"><div style="width:${Math.min(100, (used / room) * 100).toFixed(1)}%"></div></div><b>${full ? 'Full' : `${free} free`}</b></div>`;
  }
  function gearHtml() {
    const list = upgrades();
    const picker = bagHtml() + judgePicker();
    const groups = setsHtml();
    const waiting = judge()?.pending ? '<p class="muted small-text">Judging your gear…</p>' : '';
    if (!list.length && !groups) return `${picker}${waiting || `<p class="muted small-text">Nothing in your bag beats what you’re wearing for ${esc(judge()?.aim?.() ?? 'your build')}.</p>`}`;
    const cells = list.slice(0, MAX_GEAR).map(({ item, up }) => gearCell(item, upBadge(item, up)));
    const more = list.length > MAX_GEAR ? `<p class="muted small-text">…and ${list.length - MAX_GEAR} more in your bag</p>` : '';
    const grid = cells.length ? `${groups ? '<div class="qs-set-name"><b>One piece at a time</b></div>' : ''}<div class="bag-grid">${cells.join('')}</div>` : '';
    return `${picker}${groups}${grid}${more}<p class="muted small-text center">Click gear to put it on, sell or lock it · Ctrl-click sells · Right-click locks</p>`;
  }

  // ---------- The Market (as Market & Bounties > Market draws it, ui.js renderMarket) ----------
  // What's on sale now, sold ones too, with when new stock comes and the Restock button. A click buys,
  // as in the Market: the game's own buy (data-action="buy-shop", with the same index and want).
  const goldAmt = (n) => `<span class="amt">${moneyHtml(n)}</span>`;
  function marketHtml() {
    const shop = S.state.shop;
    if (!shop?.stock) return '<p class="muted small-text">The Market isn’t open here.</p>';
    const reroll = S.shopRerollCost();
    let html = `<div class="qs-market-head"><span class="muted small-text">New stock in ${duration(shop.refreshAt - Date.now())}</span>
      <button class="btn small" data-action="reroll-shop" ${disabled(S.state.gold < reroll)}>Restock · ${goldAmt(reroll)}</button></div><div class="stall">`;
    shop.stock.forEach((slot, i) => {
      if (slot.type === 'item') {
        const item = slot.item;
        const up = upgradeOf(item) ?? 0;
        const g = judge()?.groupOf?.(item.uid);
        const badge = g && g.change > up ? setUpBadge(g) : emptyFor(item) || up > 0.005 ? upBadge(item, up) : up < -0.005 ? '<span class="upg down">▼</span>' : '';
        html += stallCell(slot, i, badge);
      } else {
        html += stallCell(slot, i, '');
      }
    });
    return `${html}</div>`;
  }
  // One of the Market's stalls, as renderMarket draws it: a click buys (the game's buy-shop, its index and want)
  function stallCell(slot, i, badge) {
    const afford = S.state.gold >= slot.price;
    const want = esc(slot.type === 'item' ? `item:${slot.item.uid}` : `chest:${slot.zone}:${slot.tier}:${slot.price}`);
    const buy = slot.sold ? '' : `data-action="buy-shop" data-index="${i}" data-want="${want}"`;
    const price = slot.sold ? 'SOLD' : goldAmt(slot.price);
    if (slot.type === 'item') {
      const item = slot.item;
      return `<button class="bag-cell stall-cell q${item.ancient ?? 0} ${item.set ? 'set' : ''} ${slot.sold ? 'sold' : afford ? 'can' : ''}" style="--c:${itemColor(item)}" ${buy} data-tip="shop:${i}" aria-label="${esc(S.itemName(item))}, ${slot.sold ? 'sold' : 'for ' + slot.price}">
          ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span>${badge}<span class="t-cost">${price}</span></button>`;
    }
    return `<button class="bag-cell stall-cell chest ${slot.sold ? 'sold' : afford ? 'can' : ''}" style="--c:${tierColor(slot.tier)}" ${buy} title="${esc(`${tierName(slot.tier)} Chest · ${fmtOdds(RARITIES[slot.tier].oneIn)} · ${ZONE_BY_ID[slot.zone]?.name ?? ''} · ${1 + Math.floor(slot.tier / 2)} loot roll${slot.tier >= 2 ? 's' : ''}`)}" aria-label="${tierName(slot.tier)} Chest">
          ${chestIcon(slot.tier)}<span class="t-cost">${price}</span></button>`;
  }
  // The count by its title: how many are still for sale, and ▲ when one is an upgrade (the game's badge)
  const marketCount = () => {
    const left = (S.state.shop?.stock ?? []).filter((slot) => !slot.sold);
    const up = left.some((slot) => slot.type === 'item' && (emptyFor(slot.item) || (upgradeOf(slot.item) ?? 0) > 0.005 || judge()?.groupOf?.(slot.item.uid)));
    return left.length ? `${left.length} for sale${up ? ' · ▲' : ''}` : '';
  };

  // ---------- The sidebar's look: the game's own (#hotbar), copied ----------
  // The game styles its sidebar by id (#hotbar, #actionbar), in many layers. Every rule for them in its
  // stylesheet is copied here for the Quicklinks sidebar's ids, so it looks and opens exactly like the
  // game's, and keeps doing so when the game restyles it. Rules that reach outside the sidebar (the
  // windows' room beside it, the level and ascension bars, the collapse button) are left out.
  const splitSelectors = (text) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && !depth) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const sidebarRule = (sel) => /#(hotbar|actionbar)(?![\w-])/.test(sel) && !/#windows|#xp-row|#asc-row|#hotbar-pin|:has\(/.test(sel);
  const ourIds = (sel) => sel.replace(/#hotbar(?![\w-])/g, '#qs-hotbar').replace(/#actionbar(?![\w-])/g, '#qs-actionbar');
  function copyRules(rules) {
    let css = '';
    for (const r of rules) {
      if (r.selectorText !== undefined && r.style) {
        const parts = splitSelectors(r.selectorText).filter(sidebarRule).map(ourIds);
        if (parts.length) css += `${parts.join(',')}{${r.style.cssText}}\n`;
      } else if (r.cssRules && r.conditionText !== undefined) {
        const inner = copyRules(r.cssRules);
        const at = r instanceof CSSMediaRule ? 'media' : r instanceof CSSSupportsRule ? 'supports' : null;
        if (inner && at) css += `@${at} ${r.conditionText}{${inner}}\n`;
      }
    }
    return css;
  }
  const sidebarStyle = document.createElement('style');
  sidebarStyle.id = 'qs-sidebar-style';
  for (const sheet of document.styleSheets) {
    if (!sheet.href || new URL(sheet.href).origin !== location.origin) continue; // the game's own stylesheet
    try {
      sidebarStyle.textContent += copyRules(sheet.cssRules);
    } catch {
      // unreadable sheet: skipped
    }
  }
  document.head.append(sidebarStyle);

  // ---------- Styles ----------
  const RIBBON_RISE = 16; // the window's title ribbon rises 12px above its frame: the frame starts this far down
  const style = document.createElement('style');
  style.id = 'summary-style';
  style.textContent = `
:root{--qs-w:min(${MIN_W}px,85vw)}
body.qs-open #app{margin-right:var(--qs-w)}
body.qs-open{--qs-push:var(--qs-w)}
#app{transition:margin ${SLIDE_MS}ms ease-out}
/* The scene keeps its full size while the page makes room (a window on the left, Quicklinks on the right):
   it reaches past the page's right edge by however far the page is pushed, on the same timing, so the game
   never lays it out again (that moves the whole view about). The catch feed and the right sail tab come
   back in by as much, to stay on screen. The camera aims for the middle of the part you see (viewCentre).
   Left-hand layout and Quicklinks both have this rule */
#stage > #game{right:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)));transition:right ${SLIDE_MS}ms ease-out}
#scene-hud > .catch-feed{margin-right:calc(var(--ll-push, 0px) + var(--qs-push, 0px));transition:margin-right ${SLIDE_MS}ms ease-out}
#scene-hud > .sail-arrow.right{margin-left:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)))}
body.qs-open .corner-btn,body.qs-open #bmc-wbtn{margin-right:var(--qs-w)}
/* The panel is one of the game's windows (frame, ribbon, corners, glass), held at the right edge, full height */
#windows #summary-panel.window{position:fixed;top:${RIBBON_RISE}px !important;right:0 !important;bottom:0 !important;left:auto !important;
  width:var(--qs-w) !important;height:auto !important;max-height:none !important;margin:0;display:flex;flex-direction:column;z-index:1;
  pointer-events:auto;transform:translateX(calc(100% + 16px));visibility:hidden;
  transition:transform ${SLIDE_MS}ms ease-out,visibility 0s linear ${SLIDE_MS}ms}
body.qs-open #windows #summary-panel.window{transform:none;visibility:visible;transition:transform ${SLIDE_MS}ms ease-out,visibility 0s}
/* The weather starts right under the header (the game leaves 30px above a window's contents when it has no tabs) */
#summary-panel > .win-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding-top:0}
#qs-weather{flex:none;margin:0 0 6px;cursor:pointer}
#qs-weather:empty{display:none}
#qs-weather .wf-now{margin:0}
#qs-weather:hover .wf-now{filter:brightness(1.12)}
#summary-panel .qs-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 2px 8px}
#summary-panel section{margin:0 0 10px}
/* Section titles as the game draws a foldable section's heading (Settings > General): 13px, regular, in
   the accent colour, with the same ▼ / ▶ marker */
#summary-panel h3{display:flex;align-items:baseline;gap:8px;margin:2px 0 4px;padding:3px 0;font-size:13px;font-weight:400;color:var(--accent)}
#summary-panel h3 .goto{margin-left:auto;font-size:.92em;font-weight:400}
#summary-panel .qs-fold{display:inline-flex;align-items:baseline;gap:0;padding:0;font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#summary-panel .qs-chev{display:list-item;list-style:disclosure-open inside;width:auto;font-size:inherit}
#summary-panel .qs-collapsed .qs-chev{list-style-type:disclosure-closed}
#summary-panel .qs-collapsed .qs-content{display:none}
#summary-panel section.qs-collapsed{margin-bottom:4px}
#summary-panel .qs-count{color:var(--muted);font-weight:400;font-size:.85em}
#summary-panel .bounties.list{margin:4px 0}
/* Bounty rows, tighter than the game's: less padding and a slimmer progress bar */
#summary-panel .bounty-row{padding-top:1px;padding-bottom:1px;min-height:0}
#summary-panel .bounty-row .name{font-size:.95em}
#summary-panel .bounty-row .bounty-bar{height:6px;margin:2px 0}
#summary-panel .qs-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#summary-panel .row-main{min-width:0}
#summary-panel .progress{margin:4px 0 6px}
#summary-panel .qs-asc-count{margin:2px 0 4px}
#summary-panel .qs-slots{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}
#summary-panel .qs-slots .gear-slot{flex:none}
#summary-panel .gearsets{justify-content:start;margin:4px 0}
#summary-panel .gearset .btn kbd{margin-right:6px}
#summary-panel .btn.wide{width:100%}
#summary-panel .setting-select{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:6px 0 0}
#summary-panel .setting-select select{flex:1 1 140px;min-width:0}
#summary-panel .qs-oracle .qs-oracle-at{display:flex;gap:4px}
/* One line: Oracle:, its multiples, then Ascend at the right end */
#summary-panel .setting-select.qs-oracle{flex-wrap:nowrap;gap:4px 6px}
#summary-panel .qs-oracle .qs-oracle-at .btn{min-width:32px;padding-left:6px;padding-right:6px}
#summary-panel .qs-oracle .qs-ascend{margin-left:auto;white-space:nowrap}
/* Market squares the size of the gear squares above (the game's stall stretches 6 across the width) */
#summary-panel [data-qs="market"] .stall{grid-template-columns:repeat(auto-fill,58px);gap:6px}
#summary-panel [data-qs="market"] .stall-cell.chest .icon{width:40px;height:40px}
#summary-panel .qs-set-group{margin:2px 0 8px}
#summary-panel .qs-set-name{display:flex;align-items:baseline;gap:6px;margin:4px 0 2px}
#summary-panel .qs-set-name .qs-set-up{margin-left:auto;color:${hex(SET_COLOR)}}
/* "Upgrades For:" on a line of its own, so the three dropdowns below it have the width to show their whole names */
#summary-panel .setting-select.qs-judge{flex-wrap:wrap;gap:2px 8px;margin:2px 0 6px}
#summary-panel .qs-judge > span{flex:1 0 100%}
/* Bag space: Bag 34/40, a slim bar, and what's free (amber when nearly full, red when full) */
#summary-panel .qs-bag{display:flex;align-items:center;gap:8px;margin:2px 0 6px;font-size:.9em}
#summary-panel .qs-bag > span{color:var(--muted);white-space:nowrap}
#summary-panel .qs-bag .progress{flex:1;height:6px;margin:0}
#summary-panel .qs-bag b{white-space:nowrap}
#summary-panel .qs-bag.tight .progress > div{background:#f59e0b}
#summary-panel .qs-bag.tight b{color:#f59e0b}
#summary-panel .qs-bag.full .progress > div{background:var(--danger,#ef4444)}
#summary-panel .qs-bag.full b{color:var(--danger,#ef4444)}
#summary-panel .qs-judge select{flex:1 1 0;min-width:0}
#summary-panel .qs-market-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0 6px}
#summary-panel .locked-note{display:block;width:100%;margin-top:6px;text-align:left}
#summary-panel p{margin:4px 0}
#summary-panel .qs-chests{display:flex;align-items:center;gap:8px}
#summary-panel .qs-chests .row-main{flex:1}
#summary-panel .bag-grid{justify-content:start;margin:6px 0}
#summary-panel .qs-next-up{margin:4px 0 0}
#qs-pills:has(#measured-rate-wrap) .qs-pills-off{display:none}
/* Top to bottom: the pills, then the best +10% (the pills mod appends its pills; this orders them) */
#qs-pills{display:flex;flex-direction:column}
#qs-pills #measured-rate-wrap{order:1}
#qs-pills .qs-gains{order:2;margin:2px 0}
#summary-panel .mm-gains td:nth-child(4){width:35%}
/* The Quicklinks sidebar: the game's sidebar (rules copied above), down the right edge. placeBar sets its top */
#qs-hotbar{left:auto !important;right:6px !important;bottom:auto !important}
/* Its icon: a lightning bolt drawn like the game's sidebar icons (a filled shape on a 512 square, shown
   through the same --icon mask, so it takes the buttons' colour and size) */
#qs-hotbar #qs-toggle .qs-icon{--icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cpath fill='%23fff' d='M313 18 88 290h139l-50 204 247-288H285l60-188z'/%3E%3C/svg%3E")}
/* Phones: the game hides its line map under an open window; the panel (always there, even put away) doesn't count */
@media (max-width:640px){body:not(:has(#windows .window:not(#summary-panel))) #metro{visibility:visible}}
@media (prefers-reduced-motion:reduce){#app,#stage > #game,#scene-hud > .catch-feed,#windows #summary-panel.window{transition:none}}`;
  document.head.append(style);

  // ---------- The panel ----------
  const SECTIONS = [
    // The income pills mod moves its pills into #qs-pills (it listens for idle-angler-quicklinks);
    // this section draws only the best +10% (.qs-gains), which CSS orders between them
    { id: 'stats', title: 'Min-maxer', panel: 'minmax', html: gainsHtml },
    { id: 'character', title: 'Builds', panel: 'character', html: buildsHtml, count: () => `${(S.state.gearSets ?? []).length}/${GEAR_SETS.max}` },
    { id: 'bounties', title: 'Bounties', panel: 'bounties', html: bountiesHtml, count: () => { const n = finishedBounties(); return n ? `${n} to claim` : ''; } },
    { id: 'ascend', title: 'Ascend', panel: 'ascend', html: ascendHtml },
    { id: 'foreman', title: 'Foreman', panel: 'automation', html: foremanHtml },
    { id: 'chests', title: 'Chests', panel: 'chests', html: chestsHtml },
    { id: 'gear', title: 'Bag', panel: 'bags', html: gearHtml, count: () => { const n = upgrades().length; const g = setGroups().length; return [n ? String(n) : '', g ? `${g} set${g === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '); } },
    { id: 'market', title: 'Market', panel: 'market', html: marketHtml, count: marketCount },
  ];
  // A window as the game builds one (windows.js), without its undock / pin buttons or resize grip. It sits
  // in a box of its own inside the window layer, so the game's buttons inside it work, while the layout
  // mods (which look for the layer's own windows) leave it alone.
  const host = document.createElement('div');
  host.id = 'qs-host';
  const panel = document.createElement('section');
  panel.id = 'summary-panel';
  panel.className = 'window';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Quicklinks');
  // The weather now, at the top above the sections: the forecast mod draws its now box into it (empty without it)
  panel.innerHTML = `<header class="win-head"><div class="win-title"><h2>Quicklinks</h2></div><div class="win-tools"><button class="win-close" type="button" aria-label="Hide Quicklinks" title="Hide Quicklinks">✕</button></div></header>
    <div class="win-body"><div id="qs-weather" title="Open the forecast (W)"></div><div class="qs-body">${SECTIONS.map(
      (s) => `<section data-qs="${s.id}"><h3><button type="button" class="qs-fold" aria-expanded="true" title="Collapse"><span class="qs-chev" aria-hidden="true"></span>${esc(s.title)}</button> <span class="qs-count"></span><button class="goto" data-action="goto" data-panel="${s.panel}" title="Open the game's window for this">Open <span class="goto-arrow">→</span></button></h3><div class="qs-content"></div></section>`,
    ).join('')}</div></div>
    <i class="win-corner tl"></i><i class="win-corner tr"></i><i class="win-corner bl"></i><i class="win-corner br"></i>`;
  const pillsHost = panel.querySelector('[data-qs="stats"] .qs-content');
  pillsHost.id = 'qs-pills';
  pillsHost.innerHTML = '<p class="muted small-text qs-pills-off">Turn on Income pills in Settings &gt; Mods (or install its script) to see them here.</p><div class="qs-gains"></div>';
  panel.querySelector('[data-qs="stats"] .goto').title = 'Open the Min-maxer';
  host.append(panel);
  layer.append(host);
  dispatchEvent(new Event('idle-angler-quicklinks'));
  const parts = SECTIONS.map((s) => {
    const el = panel.querySelector(`[data-qs="${s.id}"]`);
    return { ...s, el, content: el.querySelector('.qs-gains') ?? el.querySelector('.qs-content'), countEl: el.querySelector('.qs-count'), last: null, lastCount: null };
  });
  const onClose = () => setOpen(false);
  panel.querySelector('.win-close').addEventListener('click', onClose);

  // ---------- Collapsing a section ----------
  // A collapsed section keeps its title, count and Open; its contents aren't drawn until it's opened again
  let folded = new Set();
  try {
    folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]'));
  } catch {
    // storage blocked or unreadable: everything starts open
  }
  const showFold = (p) => {
    const shut = folded.has(p.id);
    p.el.classList.toggle('qs-collapsed', shut);
    const btn = p.el.querySelector('.qs-fold');
    btn.setAttribute('aria-expanded', String(!shut));
    btn.title = shut ? 'Expand' : 'Collapse';
  };
  for (const p of parts) showFold(p);
  const onFold = (e) => {
    const btn = e.target.closest('.qs-fold');
    if (!btn) return;
    const p = parts.find((x) => x.el.contains(btn));
    if (folded.has(p.id)) folded.delete(p.id);
    else folded.add(p.id);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]));
    } catch {
      // storage blocked: it's forgotten on reload
    }
    showFold(p);
    btn.blur();
    setTimeout(render, 0);
  };
  panel.addEventListener('click', onFold);
  // The Oracle's 1x-10x buttons: a click hands the button (its data-change and value, as the dropdown's
  // option would have them) to the game's own change handler on the window layer
  const onOracle = (e) => {
    const btn = e.target.closest('.qs-oracle [data-change="auto-ascend"]');
    if (btn) btn.dispatchEvent(new Event('change', { bubbles: true }));
  };
  panel.addEventListener('click', onOracle);
  // The Gear judge's time of day and weather (not the game's: no data-change, so its handler leaves them be)
  const onJudgePick = (e) => {
    const sel = e.target.closest('select[data-qs-judge]');
    if (!sel) return;
    sel.blur();
    window.gearJudge?.setPick({ [sel.dataset.qsJudge]: sel.value });
  };
  panel.addEventListener('change', onJudgePick);

  // ---------- The Quicklinks sidebar ----------
  // A second sidebar like the game's, down the right edge: the Quicklinks button (it slides the panel out
  // and back; its badge counts bounties to claim).
  const stage = document.getElementById('stage') ?? app;
  const bar = document.createElement('div');
  bar.id = 'qs-hotbar';
  bar.innerHTML = `<nav id="qs-actionbar" aria-label="Quicklinks"><div class="ab-group">
      <button type="button" class="action-btn" id="qs-toggle" aria-controls="summary-panel"><span class="ui-icon qs-icon"></span><span class="ab-label">Quicklinks</span><span class="badge"></span></button>
    </div></nav>`;
  stage.append(bar);
  const toggle = bar.querySelector('#qs-toggle');
  const dot = toggle.querySelector('.badge');
  toggle.addEventListener('click', () => setOpen(!isOpen));
  // The game's sidebar opens while the pointer is over it, or stays open (its Collapse / Expand): this one too
  const onEnter = () => bar.classList.add('hovering');
  const onLeave = () => bar.classList.remove('hovering');
  bar.addEventListener('pointerenter', onEnter);
  bar.addEventListener('pointerleave', onLeave);
  function syncBar() {
    const main = document.getElementById('hotbar');
    bar.classList.toggle('pinned', Boolean(main?.classList.contains('pinned')));
    placeBar();
  }
  // Where it sits: level with the game's sidebar when that's on the left (the Left-hand layout), else just
  // under it. Both bars move with the play area, which narrows while the panel is out.
  function placeBar() {
    const main = document.getElementById('hotbar');
    const nav = main?.querySelector('#actionbar');
    const s = stage.getBoundingClientRect();
    const r = (nav ?? main)?.getBoundingClientRect();
    let top = 58;
    if (r?.height) top = r.left > s.left + s.width / 2 ? main.getBoundingClientRect().bottom - s.top + 10 : r.top - s.top;
    const px = `${Math.round(top)}px`;
    if (bar.style.top !== px) bar.style.top = px;
  }
  const barObserver = new MutationObserver(syncBar);
  const watchBars = () => {
    barObserver.disconnect();
    const main = document.getElementById('hotbar');
    if (main) barObserver.observe(main, { attributes: true, attributeFilter: ['class', 'style'], subtree: true, childList: true, characterData: true });
  };
  watchBars();
  syncBar();
  addEventListener('resize', placeBar);

  // ---------- Keeping it current ----------
  // Redrawn when the game's state changes (at most every 300 ms) and once a second for the timers. A
  // part is only redrawn when it changed, never while a dropdown in it is open, and not between a press
  // and its release (a button swapped mid-click would lose the click: the game holds off the same way).
  let isOpen = false;
  let pressing = false;
  let pending = 0;
  function render() {
    pending = 0;
    if (window.summaryPanelRun !== run) return stop(); // a newer copy runs now
    const done = finishedBounties();
    if (dot.textContent !== (done ? String(done) : '')) dot.textContent = done ? String(done) : '';
    if (!bar.isConnected) stage.append(bar);
    syncBar();
    // In the basement, the Altar's black and crimson, as the game draws the Draconic Altar window
    const altar = document.body.dataset.place === 'basement';
    if (altar !== (panel.dataset.win === 'draconic')) {
      if (altar) panel.dataset.win = 'draconic';
      else delete panel.dataset.win;
    }
    if (!isOpen || pressing) return;
    const focused = document.activeElement;
    for (const p of parts) {
      const count = p.count?.() ?? '';
      if (count !== p.lastCount) {
        p.countEl.textContent = count;
        p.lastCount = count;
      }
      if (folded.has(p.id)) continue; // drawn when it's opened again
      if (p.content.contains(focused) && focused.matches('select')) continue;
      let html;
      try {
        html = p.html();
      } catch (err) {
        html = `<p class="muted small-text">Couldn’t show this: ${esc(err.message)}</p>`;
      }
      if (html !== p.last) {
        p.content.innerHTML = html;
        p.last = html;
      }
    }
    fitWidth();
  }

  // Widen (or narrow) the panel by what the longest bounty name lacks (or has to spare). Each name's text
  // is in an inline .qs-fit, so its own width is the width it needs on one line. Not while it has a width
  // set with the grip on its left edge (double-click the grip to go back to this)
  let width = MIN_W;
  const grip = edgeGrip({
    id: 'qs-grip', edge: 'right', openClass: 'qs-open', cssVar: '--qs-w', key: 'idle-angler-quicklinks-width',
    min: 340, max: 0.7, label: 'Quicklinks',
    onReset: () => {
      width = MIN_W;
      document.documentElement.style.setProperty('--qs-w', `min(${MIN_W}px, 85vw)`);
      fitWidth();
    },
  });
  function fitWidth() {
    if (grip.size) return;
    const lines = [...panel.querySelectorAll('.bounty-row .qs-line')].filter((l) => l.offsetParent);
    if (!lines.length) return;
    let spare = Infinity;
    for (const line of lines) spare = Math.min(spare, line.clientWidth - line.firstElementChild.getBoundingClientRect().width);
    const cap = Math.min(MAX_W, innerWidth * 0.5);
    const next = Math.round(Math.max(MIN_W, Math.min(cap, width - spare + 2)));
    if (Math.abs(next - width) < 3) return;
    width = next;
    document.documentElement.style.setProperty('--qs-w', `min(${width}px, 85vw)`);
    relayout();
  }
  const schedule = () => {
    if (!pending) pending = setTimeout(render, 300);
  };
  const unsubscribe = S.onChange(schedule);
  // The Gear judge's answers coming in (or it starting or stopping): the gear and the Market again
  const onJudge = () => {
    judgeSeen++;
    schedule();
  };
  addEventListener('idle-angler-gear-judge', onJudge);
  const timer = setInterval(render, 1000);
  const onPress = () => { pressing = true; };
  const onRelease = () => {
    if (!pressing) return;
    pressing = false;
    setTimeout(render, 0); // after the click has run
  };
  panel.addEventListener('pointerdown', onPress);
  addEventListener('pointerup', onRelease);
  addEventListener('pointercancel', onRelease);

  // ---------- Opening and closing ----------
  // The game measures its play area on window resize (Pixi's resizeTo, the windows' bounds, the action
  // bar), so a resize is sent on every frame while the page slides, and once more at the end.
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
  function setOpen(open, { remember = true } = {}) {
    isOpen = open;
    document.body.classList.toggle('qs-open', open);
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide Quicklinks' : 'Show Quicklinks');
    toggle.title = open ? 'Hide Quicklinks' : 'Show Quicklinks: income a second, the best +10%, builds, bounties, ascending, Foreman, chests and gear upgrades';
    panel.inert = !open;
    if (remember) {
      try {
        localStorage.setItem(STORE_KEY, open ? '1' : '0');
      } catch {
        // storage blocked: the panel just starts closed next time
      }
    }
    if (open) render();
    relayout();
  }

  let startOpen = false;
  try {
    startOpen = localStorage.getItem(STORE_KEY) === '1';
  } catch {
    // storage blocked
  }
  setOpen(startOpen, { remember: false });
  render();

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    clearInterval(timer);
    clearTimeout(pending);
    cancelAnimationFrame(slideFrame);
    removeEventListener('pointerup', onRelease);
    removeEventListener('pointercancel', onRelease);
    removeEventListener('resize', placeBar);
    removeEventListener('idle-angler-gear-judge', onJudge);
    barObserver.disconnect();
    grip.remove();
    host.remove();
    bar.remove();
    style.remove();
    sidebarStyle.remove();
    if (window.stopSummaryPanel === stop) delete window.stopSummaryPanel;
    if (window.summaryPanelRun !== run) return; // a newer copy has the page now: leave the rest to it
    delete window.summaryPanelRun;
    viewCentre.remove('quicklinks');
    document.body.classList.remove('qs-open');
    document.documentElement.style.removeProperty('--qs-w');
    dispatchEvent(new Event('idle-angler-quicklinks')); // the pills go back to the top bar
    dispatchEvent(new Event('resize'));
  }
  window.stopSummaryPanel = stop;
  console.log('[quicklinks] On: its sidebar is on the right edge. Turn it off with stopSummaryPanel()');
};

idleAnglerMods.define({
  id: 'summaryPanel',
  order: 60,
  name: "Quicklinks",
  desc: "A sidebar on the right edge, with a Quicklinks button that slides out your income a minute, the gear you're wearing and your builds, bounties, ascending, the Foreman and its next upgrade, chests, the upgrades in your bag and the Market",
  start: summaryPanel,
  stop: 'stopSummaryPanel',
});
}

{
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

{
// =====================================================================================================
// Stacked names
//
// Every angler on the water has a name over their head, and with everyone fishing from the same spot
// they all land on top of each other. This stacks the names that would overlap into a column instead,
// the best on the gold leaderboard at the top and anyone not on it below, in name order. The game
// still places each name over its angler; only the column is added, as a shift up (a transform), so
// nothing the game draws changes.
//  - the ranks come from the leaderboards the game itself shows (GET /api/leaderboard, read every
//    minute); it never posts anything. Gold and ascensions each have a Twitch and an accounts board:
//    both are merged into one ranking, sorted the way the game sorts them
//  - right of a name, a badge for each ranking its player is in the top 5 of (gold, ascensions,
//    Emberscales), with their place in it (Settings > Mods can change how far down the badges go, or
//    turn them off). Each board sends its top 25, so a merged top 25 is complete
//  - your own name joins the column when it overlaps, and gets its badges too
// Stop it (and put the names back) with:  stopStackedNames(), or untick it in Settings > Mods
// =====================================================================================================
const stackedNames = async () => {
  window.stopStackedNames?.();
  const mod = (path) => import(new URL(path, location.origin).href);
  const [{ api }, { ICON_COLS, ICON_ROWS, ICON_INDEX }] = await Promise.all([mod('/src/api.js'), mod('/src/icon-index.js')]);

  const REFRESH_MS = 60000;
  const GAP = 1; // px between names in a column
  const MEASURE_MS = 2000; // how often a name's size is measured again (the UI scale can change)
  const BADGE = 18; // a badge's size (px)
  const BADGE_GAP = 7; // room for the rank tag, which pokes out at a badge's bottom right
  const BADGE_ROW = BADGE + 8; // a name with badges takes this much height in a column...
  const BADGE_LIFT = 4; // ...and sits this far up in it, so the badges and their rank tags clear the rows around it
  const BADGES_KEY = 'idle-angler-name-badges';
  const readTop = () => {
    try {
      return Number(localStorage.getItem(BADGES_KEY) ?? 5);
    } catch {
      return 5;
    }
  };
  let badgeTop = readTop(); // badges down to this rank; 0 = none
  const hud = document.getElementById('scene-hud');
  if (!hud) throw new Error('no #scene-hud: is the game running?');

  // The boards with a badge, in the order they're drawn, and the icon each row gets. The icons are
  // the Leaderboard window's own: gold's coin, Emberscales' scale, and for ascensions the draconic
  // icon if the player has draconic ascensions (that board ranks by those first), the ✦ if not
  // `order` sorts the merged boards as the game sorts each one: by gold, by draconic ascensions and
  // then ascensions, by Emberscales
  const BOARDS = [
    { type: 'gold', boards: ['twitch', 'accounts'], label: 'Gold', icon: () => 'gold', order: (a, b) => b.score - a.score },
    {
      type: 'ascensions',
      boards: ['twitch', 'accounts'],
      label: 'Ascensions',
      icon: (r) => (r.draconic > 0 ? 'draconic' : 'ascension'),
      order: (a, b) => (b.draconic ?? 0) - (a.draconic ?? 0) || (b.ascensions ?? 0) - (a.ascensions ?? 0),
    },
    { type: 'emberscales', boards: [undefined], label: 'Emberscales', icon: () => 'ember', order: (a, b) => b.score - a.score },
  ];
  const sprite = (key) => {
    const i = ICON_INDEX[key];
    const el = document.createElement('i');
    if (i !== undefined)
      el.style.cssText = `background-image:url(/assets/icons/raven-16.png);background-size:${ICON_COLS * 16}px ${ICON_ROWS * 16}px;background-position:-${(i % ICON_COLS) * 16}px -${Math.floor(i / ICON_COLS) * 16}px`;
    return el;
  };
  const iconEl = (kind) => {
    if (kind === 'gold') return sprite('cur:gold');
    if (kind === 'draconic') return sprite('ui:draconic');
    const el = document.createElement('span');
    if (kind === 'ember') el.className = 'ember-icon small'; // the game's own Emberscale
    else {
      el.className = 'sn-asc';
      el.textContent = '✦';
    }
    return el;
  };

  const style = document.createElement('style');
  style.textContent = `
    .sn-badges{position:absolute;left:0;top:0;display:flex;gap:${BADGE_GAP}px;pointer-events:none;white-space:nowrap}
    .sn-badges[hidden]{display:none}
    .sn-badge{position:relative;width:${BADGE}px;height:${BADGE}px;border-radius:50%;background:#14181c;
      box-shadow:0 0 0 1px #5d6670,0 1px 2px rgba(0,0,0,.6);display:grid;place-items:center}
    .sn-badge.r1{box-shadow:0 0 0 1px #f2c14e,0 0 5px rgba(242,193,78,.55)}
    .sn-badge.r2{box-shadow:0 0 0 1px #c9d1d9,0 1px 2px rgba(0,0,0,.6)}
    .sn-badge.r3{box-shadow:0 0 0 1px #c47a3a,0 1px 2px rgba(0,0,0,.6)}
    .sn-badge i{width:16px;height:16px;image-rendering:pixelated;transform:scale(.82)}
    .sn-badge .sn-asc{color:#c4b5fd;font:700 12px/1 system-ui,sans-serif}
    .sn-badge b{position:absolute;right:-5px;bottom:-5px;min-width:10px;padding:0 2px;border-radius:5px;
      background:#14181c;color:#f3f0e6;font:700 9px/11px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 1px #5d6670}
    .sn-badge.r1 b{color:#f2c14e;box-shadow:0 0 0 1px #f2c14e}
  `;
  document.head.append(style);

  // Leaderboards: the column's order (name, lower case -> place in the merged gold boards) and the
  // badges (name -> [{ board, rank, icon }], the place in each merged ranking; players who tie share one)
  let order = new Map();
  let ranked = new Map();
  const nameKey = (r) => String(r?.name ?? '').toLowerCase();
  const refresh = async () => {
    const results = await Promise.all(
      BOARDS.map(async (b) => {
        const got = await Promise.allSettled(b.boards.map((board) => api.leaderboard(b.type, board)));
        return got.flatMap((g) => (g.status === 'fulfilled' ? [...(g.value?.top ?? []), ...(g.value?.you ? [g.value.you] : [])] : []));
      }),
    );
    if (results.every((rows) => !rows.length)) return; // keep the last ranks if every request failed
    const best = new Map();
    for (const r of results[0]) {
      const key = nameKey(r);
      if (key && !(best.get(key) >= r.score)) best.set(key, r.score);
    }
    if (best.size) order = new Map([...best].sort((a, b) => b[1] - a[1]).map(([key], i) => [key, i + 1]));
    const next = new Map();
    BOARDS.forEach((b, i) => {
      const rows = new Map(); // one row a player (your own can come twice: in the top and as `you`)
      for (const r of results[i]) {
        const key = nameKey(r);
        if (key && !rows.has(key)) rows.set(key, r);
      }
      const sorted = [...rows].sort((x, y) => b.order(x[1], y[1]));
      sorted.forEach(([key, r], j) => {
        const rank = j > 0 && !b.order(sorted[j - 1][1], r) ? next.get(sorted[j - 1][0]).find((x) => x.board === b).rank : j + 1;
        const list = next.get(key) ?? [];
        list.push({ board: b, rank, icon: b.icon(r) });
        next.set(key, list);
      });
    });
    for (const list of next.values()) list.sort((x, y) => BOARDS.indexOf(x.board) - BOARDS.indexOf(y.board));
    ranked = next;
  };
  refresh().catch(() => {});
  const timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS);

  const sizes = new WeakMap(); // name element -> { text, w, h, at }
  const shifted = new Set(); // name elements we've moved
  const badgeEls = new Map(); // name element -> its badge row
  const size = (el, now) => {
    let s = sizes.get(el);
    if (!s || s.text !== el.textContent || now - s.at > MEASURE_MS) {
      s = { text: el.textContent, w: el.offsetWidth, h: el.offsetHeight, at: now };
      sizes.set(el, s);
    }
    return s;
  };
  const placeOf = (it) => order.get(it.text.toLowerCase()) ?? Infinity;
  const byPlace = (a, b) => placeOf(a) - placeOf(b) || a.text.localeCompare(b.text);
  const badgesOf = (text) => (badgeTop ? (ranked.get(text.toLowerCase()) ?? []).filter((x) => x.rank <= badgeTop) : []);
  const setShift = (el, dy) => {
    const t = dy ? `translate(-50%, calc(-100% - ${dy}px))` : '';
    if (el.style.transform !== t) el.style.transform = t;
    if (dy) shifted.add(el);
    else shifted.delete(el);
  };
  // The badge row right of a name: rebuilt only when its badges change, moved every frame
  const drawBadges = (it) => {
    let row = badgeEls.get(it.el);
    if (!it.badges.length) {
      if (row) row.hidden = true;
      return;
    }
    if (!row) {
      row = document.createElement('div');
      row.className = 'sn-badges';
      hud.append(row);
      badgeEls.set(it.el, row);
    }
    row.hidden = false;
    const key = it.badges.map((x) => `${x.icon}${x.rank}`).join('|');
    if (row.dataset.key !== key) {
      row.dataset.key = key;
      row.replaceChildren(
        ...it.badges.map((x) => {
          const b = document.createElement('span');
          b.className = `sn-badge r${x.rank}`;
          b.title = `#${x.rank} on the ${x.board.label} leaderboard`;
          const n = document.createElement('b');
          n.textContent = x.rank;
          b.append(iconEl(x.icon), n);
          return b;
        }),
      );
    }
    // Centred on the name, right of it
    const t = `translate(${Math.round(it.x + it.w / 2 + 5)}px, ${Math.round(it.y - it.dy - it.nh / 2 - BADGE / 2)}px)`;
    if (row.style.transform !== t) row.style.transform = t;
  };
  const dropBadges = (el) => {
    badgeEls.get(el)?.remove();
    badgeEls.delete(el);
  };

  // A column's box once stacked: rising from the lowest of its names, as wide as the names and badges
  const stack = (group) => {
    group.items.sort(byPlace);
    const bottom = Math.max(...group.items.map((it) => it.y));
    const n = group.items.length;
    // Every name in a column gets the same slot (as tall as its tallest row, so badges fit), filled
    // from the bottom up, with the name in the middle of it: the names are evenly spaced
    const slot = Math.max(...group.items.map((it) => it.h));
    // (A name on its own stays where the game put it; its slot is still counted round it, badges and all)
    const lift = n > 1 ? 0 : group.items[0].lift;
    group.items.forEach((it, i) => {
      const slotBottom = bottom - (n - 1 - i) * (slot + GAP);
      it.dy = n > 1 ? it.y - slotBottom + Math.round((slot - it.nh) / 2) : 0;
    });
    group.left = Math.min(...group.items.map((it) => it.x - it.w / 2));
    group.right = Math.max(...group.items.map((it) => it.x + it.w / 2 + it.bw));
    group.bottom = bottom + lift;
    group.top = group.bottom - n * (slot + GAP) + GAP;
  };
  // Columns that overlap, or touch top to bottom (so a name next to a column joins its even spacing)
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom + GAP && b.top < a.bottom + GAP;

  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const items = [];
    for (const el of hud.querySelectorAll(':scope > .hud-name')) {
      if (el.hidden) {
        if (shifted.has(el)) setShift(el, 0);
        continue;
      }
      const s = size(el, now);
      if (!s.w) continue; // not shown (Settings can hide your own name)
      const badges = badgesOf(s.text);
      const bw = badges.length ? 5 + badges.length * (BADGE + BADGE_GAP) : 0;
      const h = badges.length ? Math.max(s.h + 2 * BADGE_LIFT, BADGE_ROW) : s.h; // a row with badges needs room for them
      const lift = badges.length ? Math.round((h - s.h) / 2) : 0;
      items.push({ el, text: s.text, x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: s.w, nh: s.h, h, lift, bw, badges, dy: 0 });
    }
    // Each name starts alone; columns that overlap merge and stack again, until none do
    const groups = items.map((it) => ({ items: [it] }));
    groups.forEach(stack);
    for (let merged = true; merged; ) {
      merged = false;
      outer: for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++)
          if (overlap(groups[i], groups[j])) {
            groups[i].items.push(...groups[j].items);
            groups.splice(j, 1);
            stack(groups[i]);
            merged = true;
            break outer;
          }
    }
    const seen = new Set(items.map((it) => it.el));
    for (const it of items) {
      setShift(it.el, Math.round(it.dy));
      drawBadges(it);
    }
    for (const el of [...shifted]) if (!seen.has(el)) setShift(el, 0);
    for (const [el, row] of badgeEls) {
      if (!el.isConnected) dropBadges(el);
      else if (!seen.has(el)) row.hidden = true;
    }
  };
  tick();

  window.setStackedNamesBadges = (top) => (badgeTop = Number(top) || 0);
  window.stopStackedNames = () => {
    cancelAnimationFrame(frame);
    clearInterval(timer);
    for (const el of [...shifted]) setShift(el, 0);
    for (const el of [...badgeEls.keys()]) dropBadges(el);
    style.remove();
    delete window.stopStackedNames;
    delete window.setStackedNamesBadges;
    console.log('[stacked names] Off: names sit over their anglers again.');
  };
  console.log('[stacked names] On: overlapping names stack by gold leaderboard rank, with rank badges. Turn it off with stopStackedNames()');
};

idleAnglerMods.define({
  id: 'stackedNames',
  order: 80,
  name: "Stacked names",
  desc: "Names over the anglers on the water that would overlap stack in a column instead, the best on the gold leaderboard at the top. Right of a name, a badge for each leaderboard (gold, ascensions, Emberscales) its player is near the top of",
  start: stackedNames,
  stop: 'stopStackedNames',
  options: [
    {
      key: 'idle-angler-name-badges',
      label: 'Rank badges',
      values: [['3', 'Top 3'], ['5', 'Top 5'], ['10', 'Top 10'], ['0', 'Off']],
      fallback: '5',
      apply: (value) => window.setStackedNamesBadges?.(Number(value)), // live, without a restart
    },
  ],
});
}

{
// =====================================================================================================
// Company online
//
// In the Company window's "Top members", a green dot right of each member who's online now: the dot
// next to the chat button's "N online", the same green, size and glow. Hover it for the water they're
// fishing in. You always have one (you're playing).
// Who's online comes from the game's own list of the players on the water with you (the server's
// mates / mate / mateLeft messages; mates.js), which it keeps to draw their boats. Nothing more is asked
// of the server. The game keeps that list to itself: each frame its scene asks it for the boats in your
// water (Mates.inZone), so the first time it does, this keeps hold of the list.
// The server sends every online member of your company, whatever water they're fishing in (and the other
// players in your water, which this leaves out).
// Stop it with:  stopCompanyOnline(), or untick it in Settings > Mods
// =====================================================================================================
const companyOnline = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { Mates } = await mod('/src/mates.js');
  const { ZONE_BY_ID } = await mod('/src/data.js');

  window.stopCompanyOnline?.(); // replace one already running

  // ---------- The game's list of who's on the water ----------
  // Every method that reads or changes the list keeps hold of it (the scene calls inZone each frame) and,
  // when it changed, has the dots redrawn.
  let mates = null;
  const proto = Mates.prototype;
  const originals = {};
  for (const name of ['inZone', 'update', 'replace', 'remove', 'clear']) {
    const orig = proto[name];
    if (typeof orig !== 'function') continue;
    originals[name] = orig;
    proto[name] = function (...args) {
      if (mates !== this) {
        mates = this;
        later();
      }
      const out = orig.apply(this, args);
      if (name !== 'inZone') later();
      return out;
    };
  }

  // Names are matched without regard to capitals (a Twitch display name and its login differ only in those)
  const key = (name) => String(name ?? '').trim().toLowerCase();
  // Who's online: name -> the water they're in, for the members of your company the list has
  const online = () => {
    const out = new Map();
    for (const m of mates?.list?.values() ?? []) if (m.company !== false && m.name) out.set(key(m.name), m.zone);
    return out;
  };
  // You, by every name the game shows for you, whichever the company list uses: your account's (top bar),
  // your nickname (Character), and the one the company bounties mark as you
  const firstText = (el) => (el?.firstChild?.nodeType === Node.TEXT_NODE ? el.firstChild.textContent : el?.textContent);
  const myNames = () =>
    new Set(
      [
        document.getElementById('nickname')?.textContent,
        S.state.nickname,
        document.querySelector('.doll-name')?.textContent,
        ...[...document.querySelectorAll('.cb-top li.you')].map(firstText),
      ]
        .map(key)
        .filter(Boolean),
    );

  // ---------- The dots ----------
  const style = document.createElement('style');
  style.id = 'company-online-style';
  // The game's .online-dot (#4ade80, black edge), as the online count draws it: 8px, with its glow
  style.textContent = `.co-online.online-dot{width:8px;height:8px;margin:0 0 0 7px;vertical-align:middle;box-shadow:0 0 6px rgba(74,222,128,.8)}`;
  document.head.append(style);

  const layer = document.getElementById('windows');
  // The Company window's "Top members" table (ui.js renderCompany): rows of "#1 Name" and the score. The game
  // folds the window's sections into fold-out boxes (foldSections: <details><summary>Top members</summary>
  // <table>), so the table is the box's; as a plain <h3> heading, the one after it.
  const memberRows = () => {
    const out = [];
    for (const h of layer?.querySelectorAll('summary, h3') ?? []) {
      if (h.textContent.trim() !== 'Top members') continue;
      const table = h.matches('summary') ? h.parentElement?.querySelector(':scope > table.kv') : h.nextElementSibling;
      if (table?.matches('table.kv')) for (const td of table.querySelectorAll('tr > td:first-child')) out.push(td);
    }
    return out;
  };
  function draw() {
    const on = online();
    const me = myNames();
    for (const td of memberRows()) {
      const name = key(firstText(td).replace(/^\s*#\d+\s+/, ''));
      const zone = me.has(name) ? S.state.zone : on.get(name);
      const live = me.has(name) || on.has(name);
      const dot = td.querySelector(':scope > .co-online');
      const title = `Online now${ZONE_BY_ID[zone] ? `, fishing in the ${ZONE_BY_ID[zone].name}` : ''}${me.has(name) ? ' (you)' : ''}`;
      if (!live) {
        dot?.remove();
        continue;
      }
      if (dot) {
        if (dot.title !== title) dot.title = title;
        continue;
      }
      const span = document.createElement('span');
      span.className = 'online-dot co-online';
      span.title = title;
      td.append(span);
    }
  }
  let frame = 0;
  function later() {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }
  const observer = new MutationObserver(later);
  if (layer) observer.observe(layer, { childList: true, subtree: true });
  later();

  // For the console: companyOnline.check() says what it sees, when a dot is missing
  window.companyOnline = {
    get names() {
      return [...online().keys()];
    },
    check: () => ({
      foundTheList: Boolean(mates),
      onTheWater: [...(mates?.list?.values() ?? [])].map((m) => `${m.name} (${m.zone}${m.company === false ? ', not your company' : ', your company'})`),
      you: [...myNames()],
      memberRows: memberRows().map((td) => firstText(td).trim()),
    }),
  };
  window.stopCompanyOnline = () => {
    for (const [name, orig] of Object.entries(originals)) proto[name] = orig;
    observer.disconnect();
    cancelAnimationFrame(frame);
    style.remove();
    for (const dot of document.querySelectorAll('.co-online')) dot.remove();
    delete window.companyOnline;
    delete window.stopCompanyOnline;
  };
  console.log('[company online] On: a green dot by each company member online now (Company window). Turn it off with stopCompanyOnline()');
};

idleAnglerMods.define({
  id: 'companyOnline',
  order: 90,
  name: "Company online",
  desc: "A green dot by each member of your company who's online now, in the Company window's Top members (hover it for the water they're fishing in)",
  start: companyOnline,
  stop: 'stopCompanyOnline',
});
}

{
// =====================================================================================================
// Smooth resizing
//
// While the game's picture changes size (the browser window dragged, a phone turned, the Quicklinks panel
// sliding out), it flashes light blue. Why: the scene is drawn into a picture of the screen's size first
// (postfx.js PostFx, for its light shafts and reflections), and the screen shows that picture. A new size
// makes a new, empty one (PostFx.layout). Pixi then draws the screen at once, before the next frame has
// drawn the scene into it (pixi.js ResizePlugin: renderer.resize, then render), so the screen shows only its
// clear colour, the game's light blue (main.js: background 0x8fd3ff), until the next frame.
// This draws the scene into the new picture as soon as it's made, with what the last frame drew it with
// (the scene's lastPost), so the picture is never empty. Nothing else changes, and nothing goes to the server.
// Stop it with:  stopSmoothResize(), or untick it in Settings > Mods
// =====================================================================================================
const smoothResize = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { PostFx } = await mod('/src/postfx.js');

  window.stopSmoothResize?.(); // replace one already running

  const proto = PostFx.prototype;
  const original = proto.layout;
  let filled = 0;
  proto.layout = function (L) {
    const before = this.rt;
    const out = original.call(this, L);
    // A new picture (a new size): draw the scene into it now, as the next frame would
    if (this.rt !== before && this.scene?.lastPost) {
      this.render(this.scene.lastPost);
      filled++;
    }
    return out;
  };

  window.smoothResize = { get filled() { return filled; } }; // for the console: pictures drawn at once
  window.stopSmoothResize = () => {
    if (proto.layout !== original) proto.layout = original;
    delete window.smoothResize;
    delete window.stopSmoothResize;
  };
  console.log('[smooth resize] On: no light-blue frames while the game resizes. Turn it off with stopSmoothResize()');
};

idleAnglerMods.define({
  id: 'smoothResize',
  order: 100,
  name: "Smooth resizing",
  desc: "No light-blue flashes while the game resizes: dragging the window, turning a phone, or Quicklinks sliding out",
  start: smoothResize,
  stop: 'stopSmoothResize',
});
}

{
// =====================================================================================================
// Fog to the edge
//
// In fog (and the haze of rain, storms and the like) the haze stops a little behind your angler out on the
// water, and the left of the screen is clear. Why: the haze is drawn from the left edge of the screen as it
// is before the camera moves (atmosphere.js drawFog: from L.cut to the far edge of the world), but out on
// the water the camera pans right to bring your angler from a third of the way across to the middle
// (scene.js followBoat), and the world it brings in on the left, drawn for the camera to move into, has none.
// At 1920px wide in the Pond that's the left 665px, about 300px behind the angler.
// This adds the same haze over that strip (from the world's left end, x 0, to L.cut), after the game draws
// its own, so the haze covers all the world the camera can show. The drifting fog banks are left as they
// are. Nothing else changes, and nothing goes to the server.
// Stop it with:  stopFogToEdge(), or untick it in Settings > Mods
// =====================================================================================================
const fogToEdge = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { Atmosphere } = await mod('/src/atmosphere.js');

  window.stopFogToEdge?.(); // replace one already running

  const proto = Atmosphere.prototype;
  const original = proto.drawFog;
  proto.drawFog = function (...args) {
    const out = original.apply(this, args);
    const L = this.L;
    // The game's haze over the rest of the screen: its colour, at the alpha drawFog gives it (0.18), under
    // the same blur and fade (the fog layer's filters and alpha)
    if (this.fog?.visible && L?.cut > 0) this.fogShapes.rect(0, 0, L.cut, L.H).fill({ color: this.fogColor, alpha: 0.18 });
    return out;
  };

  window.stopFogToEdge = () => {
    if (proto.drawFog !== original) proto.drawFog = original;
    delete window.stopFogToEdge;
  };
  console.log('[fog to the edge] On: the haze covers the whole screen. Turn it off with stopFogToEdge()');
};

idleAnglerMods.define({
  id: 'fogToEdge',
  order: 110,
  name: "Fog to the edge",
  desc: "In fog the haze covers the whole screen, instead of stopping a little behind your angler out on the water",
  start: fogToEdge,
  stop: 'stopFogToEdge',
});
}

{
// =====================================================================================================
// Spots on time
//
// A new fishing spot can count ("On a School of fish" under the timers, and the bonus) seconds before its
// ring shows on the water. Why: the server stamps a spot with when it appeared and when it ends, by the
// server's clock, but the ring's fade (scene.js drawSpots: in over 3 s from `at`, out over the last 8 s
// before `until`) is worked out from this device's clock (Date.now). When that clock is behind the
// server's, the ring stays invisible until it catches up, and only then starts its 3 s fade; the game
// keeps the boat on the server's clock for this reason (state.js seaNow), but not the spots.
// This draws the spots by the server's clock (world.js serverNow, which the game sets from the server's
// time when it connects), so a new spot starts fading in as soon as it arrives. The fade itself is the
// game's own. Nothing else changes, and nothing goes to the server.
// Stop it with:  stopSpotsOnTime(), or untick it in Settings > Mods
// =====================================================================================================
const spotsOnTime = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { FishingScene } = await mod('/src/scene.js');
  const { serverNow } = await mod('/src/world.js');

  window.stopSpotsOnTime?.(); // replace one already running

  const proto = FishingScene.prototype;
  const original = proto.drawSpots;
  const realNow = Date.now;
  proto.drawSpots = function (...args) {
    const ahead = serverNow() - realNow.call(Date); // how far the server's clock is ahead of this device's
    if (!ahead) return original.apply(this, args);
    // drawSpots reads the time once, from Date.now: for this call only, that's the server's time
    Date.now = () => realNow.call(Date) + ahead;
    try { return original.apply(this, args); } finally { Date.now = realNow; }
  };

  window.stopSpotsOnTime = () => {
    if (proto.drawSpots !== original) proto.drawSpots = original;
    delete window.stopSpotsOnTime;
  };
  console.log('[spots on time] On: fishing spots fade in by the server’s clock. Turn it off with stopSpotsOnTime()');
};

idleAnglerMods.define({
  id: 'spotsOnTime',
  order: 120,
  name: "Spots on time",
  desc: "A new fishing spot fades in as soon as it appears, instead of seconds after the game already counts it when this device's clock is behind the server's",
  start: spotsOnTime,
  stop: 'stopSpotsOnTime',
});
}

})();
