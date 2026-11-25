// ==UserScript==
// @name         Idle Angler Stacked Names
// @namespace    http://tampermonkey.net/
// @version      2026-11-25
// @description  Names on the water that would overlap stack in a column by gold leaderboard rank, with rank badges
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/stacked-names.js and the runtime: edit those, not this file.
//
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
})();
