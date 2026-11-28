// ==UserScript==
// @name         Idle Angler Quicklinks
// @namespace    http://tampermonkey.net/
// @version      2026-11-28.4
// @description  A sidebar on the right edge, with a panel of what most needs you right now
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/quicklinks.js and the runtime: edit those, not this file.
//
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
//  - Gear: the 6 pieces of gear you're wearing (click one to take it off, as on the paper doll), then
//    your saved gear sets in one row: pick one in the dropdown to put it on (its number key does too, with
//    the build switcher on); Save saves what you're wearing over the set it shows, or as a new one ("New
//    set…"), and Delete deletes it
//  - Bounties: the three bounty rows, with their progress and Claim (or Reroll) buttons
//  - Ascend: how many times you've ascended, progress toward the next ascension (or the Oracle's target),
//    and the Oracle's "ascend for me" as buttons (Off, 1x-3x) beside the Ascend button
//  - Upgrades: the upgrade the Foreman buys next (as the Upgrades window draws it, with its buy button), and what
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
  // One row: a dropdown of your sets (picking one puts it on), then Save and Delete for the set it shows. Its last
  // choice, while there's room for another set, is a new one: Save then asks its name (the game's own prompt).
  // The dropdown shows the set you picked, else the one you're wearing, else a new one. A set it shows stays
  // shown when you change a piece of it, until another set is put on (here, by the build switcher's keys or in
  // Angler > Character)
  let setPick = null; // the set index the dropdown shows, 'new', or null: go by what you're wearing
  let lastWorn = -1; // the set you were wearing when it was last drawn
  function gearSetsHtml() {
    const st = S.state;
    const sets = st.gearSets ?? [];
    const keys = window.buildSwitcherKeys ?? 0; // the build switcher's 1-5, while it runs
    const room = sets.length < GEAR_SETS.max;
    const info = sets.map((set) => {
      const pieces = Object.entries(set.items ?? {});
      return {
        set,
        have: pieces.filter(([, uid]) => S.itemByUid(uid)).length,
        total: pieces.length,
        wearing: pieces.length > 0 && pieces.every(([slot, uid]) => st.equipped[slot] === uid),
      };
    });
    // The set shown, if you're wearing it (one set's gear can be all of another's too), else the first you are
    const worn = Number.isInteger(setPick) && info[setPick]?.wearing ? setPick : info.findIndex((s) => s.wearing);
    if (worn >= 0 && worn !== lastWorn) setPick = worn;
    lastWorn = worn;
    let pick = setPick === 'new' && room ? 'new' : Number.isInteger(setPick) && setPick < sets.length ? setPick : null;
    pick ??= worn >= 0 ? worn : room ? 'new' : 0;
    const options = info.map(({ set, have, total, wearing }, i) =>
      `<option value="${i}" ${pick === i ? 'selected' : ''}>${i < keys ? `${i + 1}. ` : ''}${esc(set.name)} (${have}/${total})${wearing ? ' · on' : ''}</option>`);
    if (room) options.push(`<option value="new" ${pick === 'new' ? 'selected' : ''}>New set…</option>`);
    const cur = pick === 'new' ? null : info[pick];
    const build = cur?.set.priority ? ` Its build: ${cur.set.priority.length ? cur.set.priority.map(priorityName).join(', ') : 'Income'}.` : '';
    const pickTitle = `Pick a gear set to put it on.${build}${keys ? ` Or press 1-${Math.min(keys, sets.length) || 1}.` : ''}`;
    const index = cur ? pick : sets.length;
    return `<div class="qs-setrow">
      <select data-qs-set aria-label="Gear set" title="${esc(pickTitle)}">${options.join('')}</select>
      <button class="btn small" data-action="gearset-save" data-index="${index}" title="${cur ? `Save what you're wearing as ${esc(cur.set.name)}` : "Save what you're wearing as a new gear set"}">Save</button>
      <button class="btn small" data-action="gearset-delete" data-index="${index}" ${disabled(!cur)} title="${cur ? `Delete ${esc(cur.set.name)} (its gear stays in your bag)` : 'Pick a set to delete it'}">Delete</button>
    </div>`;
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
  // while it's off or not bought. Its choice is a row of buttons, Off and the multiples: each is the game's
  // own auto-ascend control (data-change, the value the dropdown's option has; Off's is 0), which onOracle,
  // below, hands to the game's change handler.
  function ascendHtml() {
    const st = S.state;
    const req = S.ascensionRequirement();
    const oracle = S.hasAutomation('oracle');
    const at = oracle ? st.settings.autoAscendAt : 0;
    const target = req * (at || 1);
    const progress = Math.min(1, st.runGold / target);
    const can = S.canAscend();
    const goal = at ? `${moneyHtml(target)} <span class="muted">for the Oracle at ${at}×</span>` : `${moneyHtml(req)} needed`;
    // Off, then the game's dropdown's multiples (AUTO_ASCEND_AT) up to 3x, the one set lit. 5x and 10x are left
    // out, unless one is set (in the Ascension window), so what the Oracle does is still shown (lit) here
    const choices = AUTO_ASCEND_AT.filter((x) => x <= 3 || x === st.settings.autoAscendAt).map((x) => {
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
        ? `<p class="muted small-text">Everything on the foreman's list is maxed</p>`
        : '';
    return `${nextRow}<label class="setting-select">Buying <select data-change="autoup-mode" aria-label="How the foreman buys upgrades">${[
      ['off', 'Off'],
      ['save', 'Save up for the top of the list'],
      ['next', 'Buy the next one I can afford'],
    ]
      .map(([v, label]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`)
      .join('')}</select></label>
      <p class="muted small-text">${listed ? `${listed} upgrade${listed === 1 ? '' : 's'} on the foreman's list` : "The foreman's list is empty: nothing is bought"} · <button class="goto" data-action="goto" data-panel="automation">Change the list <span class="goto-arrow">→</span></button></p>`;
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
    // The 5 best rarities you have, best first, then how many chests the rest come to
    const tiers = [...byTier].sort((a, b) => b[0] - a[0]);
    const rest = tiers.slice(5).reduce((n, [, count]) => n + count, 0);
    const kinds = tiers
      .slice(0, 5)
      .map(([tier, n]) => `<span style="color:${tierColor(tier)}">${fmtHtml(n)}&nbsp;${esc(tierName(tier))}</span>`)
      .join(' · ') + (rest ? ` <span class="muted">and&nbsp;${fmtHtml(rest)}&nbsp;more</span>` : '');
    const best = owned.length ? Math.max(...owned.map((c) => c.tier)) : 0;
    let worth = '';
    if (total) {
      const { coin, treasure, gear } = chestWorth(owned);
      const sold = S.state.settings?.autoSellTreasure && S.state.automations?.pawnbroker; // as applyChests sells it
      const title = `Opening them all now pays about ${money(coin + treasure)} on average: ${money(coin)} in coin and ${money(treasure)} in treasure`
        + (sold ? ', which the Pawnbroker sells at once.' : ', which goes to your bag to sell.')
        + ` About ${fmt(Math.round(gear))} pieces of gear come out too (not counted).`
        + ' Chests are priced when you open them, with your gear, weather and time of day then, so this moves with them.';
      worth = `<span class="sub qs-worth" title="${esc(title)}">Worth about <b>${moneyHtml(coin + treasure)}</b></span>`;
    }
    return `<div class="qs-chests">
        ${chestIcon(best)}
        <div class="row-main"><div class="name">${total ? `${fmtHtml(total)} chest${total === 1 ? '' : 's'}` : 'No chests'}${worth}</div>${kinds ? `<div class="sub">${kinds}</div>` : ''}</div>
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
#summary-panel .qs-setrow{display:flex;align-items:center;gap:6px;margin:4px 0}
#summary-panel .qs-setrow select{flex:1 1 auto;min-width:0}
#summary-panel .qs-setrow .btn{flex:none}
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
#summary-panel .qs-chests .qs-worth{margin-left:10px;font-weight:400}
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
    { id: 'character', title: 'Gear', panel: 'character', html: buildsHtml, count: () => `${(S.state.gearSets ?? []).length}/${GEAR_SETS.max}` },
    { id: 'bounties', title: 'Bounties', panel: 'bounties', html: bountiesHtml, count: () => { const n = finishedBounties(); return n ? `${n} to claim` : ''; } },
    { id: 'ascend', title: 'Ascend', panel: 'ascend', html: ascendHtml },
    { id: 'foreman', title: 'Upgrades', panel: 'automation', html: foremanHtml },
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
    if (p.id === 'bounties') fitDue = true;
    btn.blur();
    setTimeout(render, 0);
  };
  panel.addEventListener('click', onFold);
  // The Oracle's 1x-3x buttons: a click hands the button (its data-change and value, as the dropdown's
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
  // The gear set dropdown (no data-change either): a set picked is put on, by the game's own gearset-equip
  // (a click on a button carrying it, as the set's button in Angler > Character would be)
  const onSetPick = (e) => {
    const sel = e.target.closest('select[data-qs-set]');
    if (!sel) return;
    sel.blur();
    setPick = sel.value === 'new' ? 'new' : Number(sel.value);
    if (setPick !== 'new') {
      const btn = document.createElement('button');
      btn.hidden = true;
      btn.dataset.action = 'gearset-equip';
      btn.dataset.index = String(setPick);
      sel.after(btn);
      btn.click();
      btn.remove();
    }
    setTimeout(render, 0);
  };
  panel.addEventListener('change', onSetPick);
  // Save on a new set shows that set once it's saved (if the name is given up, there's none, and the dropdown goes
  // back to what you're wearing); Delete goes back to what you're wearing, whether or not it's confirmed
  const onSetButton = (e) => {
    const btn = e.target.closest('.qs-setrow [data-action="gearset-save"], .qs-setrow [data-action="gearset-delete"]');
    if (!btn) return; // not the dropdown's own gearset-equip, which keeps the set it put on
    setPick = btn.dataset.action === 'gearset-save' ? Number(btn.dataset.index) : null;
  };
  panel.addEventListener('click', onSetButton, true);

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
  // Watched for its pinned class and its size (not everything inside it: its level and XP text change all
  // the time, and each placeBar measures the page). A move nothing here sees is caught by the next render
  const barObserver = new MutationObserver(syncBar);
  const barSizes = new ResizeObserver(syncBar);
  const watchBars = () => {
    barObserver.disconnect();
    barSizes.disconnect();
    const main = document.getElementById('hotbar');
    if (!main) return;
    barObserver.observe(main, { attributes: true, attributeFilter: ['class', 'style'] });
    barSizes.observe(main);
    const nav = main.querySelector('#actionbar');
    if (nav) barSizes.observe(nav);
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
  // fitWidth measures the bounty names, which makes the browser lay out the page first (and the Market's
  // countdown has just changed it), so it runs only when they may have changed: new bounty rows, the
  // section unfolded, the panel opened or the window resized
  let fitDue = true;
  const onResizeFit = () => {
    fitDue = true;
  };
  addEventListener('resize', onResizeFit);
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
        if (p.id === 'bounties') fitDue = true;
      }
    }
    if (fitDue) {
      fitDue = false;
      fitWidth();
    }
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
    toggle.title = open ? 'Hide Quicklinks' : 'Show Quicklinks: income a second, the best +10%, gear, bounties, ascending, upgrades, chests and gear upgrades';
    panel.inert = !open;
    if (remember) {
      try {
        localStorage.setItem(STORE_KEY, open ? '1' : '0');
      } catch {
        // storage blocked: the panel just starts closed next time
      }
    }
    if (open) {
      fitDue = true;
      render();
    }
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
    removeEventListener('resize', onResizeFit);
    removeEventListener('idle-angler-gear-judge', onJudge);
    barObserver.disconnect();
    barSizes.disconnect();
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
})();
