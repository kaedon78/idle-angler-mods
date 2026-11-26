// ==UserScript==
// @name         Idle Angler Waves
// @namespace    http://tampermonkey.net/
// @version      2026-11-26.2
// @description  Rolling waves on the water: none inland, building from the Coast to the Open Ocean, calming to still water in the Cosmic Void; boats sit in the water
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/waves.js and the runtime: edit those, not this file.
//
// Idle Angler — Waves. Its script needs no other; with other Idle Angler mod scripts it shows in Settings > Mods
// with them, where its parts (boats in the water, hotspot buoys, lantern gauges) can be switched on their own.
//
// The water's surface rises and falls in rolling swells that come in from the right, the open sea, toward the
// shore on the left. How big they are depends on where you are along the world, not only which water:
//   Pond, River, Lake   still, as the game draws them (a first ripple shows near the Lake's far end)
//   Coast               small swells, growing the further out you sail
//   Coral Reef          bigger
//   Open Ocean          the biggest: tall swells, white caps and foam on the tallest crests
//   Abyssal Trench      easing off again
//   Cosmic Void         dying away to dead-still water a third of the way in
// The sea is many waves of different lengths added together (a real sea's spectrum), so no two crests match and
// waves come in sets; crests are sharp, troughs long and flat, and fronts (toward the shore) steeper than backs.
// A storm makes it bigger and rougher: shorter, steeper, more confused waves whose tallest crests break, with foam
// spilling down their fronts and trailing behind them, and spray; rain makes it a touch bigger, fog and snow a little
// smaller. Moving between waters (the
// zone map, or the boat sailing on) they grow or calm over a few seconds instead of jumping.
//
// How: the game draws its water (the surface strip, the deep water, the seabed, swimmers, spots and foam) in one
// layer, scene.waterLayer. Each frame the surface is worked out here for every art-pixel column on the screen and
// handed to the shaders as a one-row texture. A shader on that layer moves each column of it up or down with the
// wave there, in whole art pixels so the pixel art stays crisp, less and less with depth (the seabed barely
// moves). The game's reflection on the water (postfx.js) mirrors the picture about a straight waterline; here
// a copy of that shader mirrors it about the moving surface instead, so it follows the crests, and lets the top
// few art pixels of the surface (its dark edge and bright rows) show through, so the crests stand out against
// the mirrored sky. Its light and haze shader runs with its horizon on the moving surface too (read from the game's
// own file at start), so haze doesn't draw a straight line across the crests. Your boat, the
// angler, the line and bobber, the lantern and your name ride the swell, and so do other players' boats.
//
// Boats sit in the water, not on it: every hull, in every water (still ones too), sits 7 of its 18 art pixels
// lower, its crew with it, and the part under the surface sinks into the water's colour and fades with depth,
// with a pale line where the surface crosses it (along the swell, in waves). Moored at the Pond's pier, the hull
// sinks but the angler stays up on the walkway. Out on the waves a hull pitches with the swell under it (the angler
// stands upright in it), and where a crest is shorter than the boat the water rises to meet the hull's underside and
// drapes off its ends, instead of dropping away to show the sky.
//
// Behind the waves the sea goes on to the horizon in rows of smaller and smaller waves, each drawn like the game's
// own water surface, reflecting the land and sky above the horizon, fading into the sky's colour and sliding past
// slower the further off it is (parallax). The near water's reflection leaves the far rows out. The
// horizon (painted hills, islands, cloud banks) sits 14 art pixels higher than the game draws it, in every water
// (in still water the far sea is flat), and it never moves; a trough in the near waves shows the far rows.
// All of this only runs with the game's shaders on (Settings), the same as its ripples and reflections; with
// them off the boats and water are the game's own.
// Other players' boats carry a lantern on the stern as yours does (the game gives them none, so at night they sail
// dark): the game's own lantern, lit with yours at dusk and in gloom, lighting the night round it a little less.
// In Settings > Mods (under Waves) four parts can be switched off on their own, each then left as the game draws it:
// the boats sitting in the water, the hotspot buoys and their flags, the lantern gauges, and other players' lanterns.
// (The far sea is part of how the water, its reflection and its haze are drawn, so it stays.)
// Nothing changes in the game's state, and nothing goes to the server.
//
// In the console:  waves.intensity      how big the waves are now (0 still, 1 the Open Ocean)
//                  waves.force = 0.8    try a size anywhere, even in the Pond, up to 1.35 (the Open Ocean in a
//                                       storm); waves.force = null: back to normal
//                  waves.surface        the surface on screen now, column by column (art px)
//                  waves.panel = false  hide the test panel on a local test server (true: show it again)
// Stop it with:    stopWaves(), or untick it in Settings > Mods
//
// On a local test server (localhost), a test panel (the "Waves" tab on the left; click it to open) sets the time
// of day, the weather and the size of the sea, to try the waves in any conditions. Time and weather there change
// only how the scene is drawn (sky, light, clouds, rain, the sea), not the game's own conditions: the HUD, bite times
// and luck stay as they are. It isn't shown on the live game.

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
const waves = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  // The game's own modules (one instance per URL, so these are the ones the game runs)
  const { PostFx } = await mod('/src/postfx.js');
  const { PX, ZOOM } = await mod('/src/scene.js');
  const { SEA } = await mod('/src/data.js');
  const { SCENE } = await mod('/src/art.js');
  const { PHASES, WEATHERS, WEATHER_BY_ID } = await mod('/src/world.js');
  const { Filter, GlProgram, BufferImageSource, RenderTexture, Matrix, Graphics, Sprite, Texture, Container, BlurFilter } = await mod('/vendor/pixi.mjs'); // the page's import map: 'pixi.js'

  window.stopWaves?.(); // replace one already running

  // Its parts, each on its own (Settings > Mods, under Waves), read as it starts: off, a part is the game's own
  const part = (k) => { try { return localStorage.getItem(`waves.${k}`) !== 'off'; } catch { return true; } };
  const BOATS = part('boats'); // boats sit in the water (off: they ride the waves on top of it, as the game draws them)
  const BUOYS = part('buoys'); // a buoy with a flag at each spot, in place of its label
  const GAUGES = part('gauges'); // the bite and Frenzy as lanterns, in place of the game's bars
  const LANTERNS = part('lanterns'); // a lantern on other players' boats too, lit at night as yours is

  // ---------- Where the waves are ----------
  // Along the world: a water's index plus how far along it you are (0..1), so the Coast's far end is 3.99.
  // Between these points the size eases from one to the next.
  const PROFILE = [
    [2.75, 0], // the Lake: still until near its far end
    [3.0, 0.18], // the Coast begins
    [4.0, 0.42], // the Coral Reef
    [5.0, 0.76], // the Open Ocean
    [5.3, 1],
    [5.8, 1],
    [6.0, 0.9], // the Abyssal Trench
    [7.0, 0.3], // the Cosmic Void
    [7.35, 0],
  ];
  const ease = (x) => x * x * (3 - 2 * x);
  const profileAt = (u) => {
    if (u <= PROFILE[0][0]) return PROFILE[0][1];
    for (let i = 1; i < PROFILE.length; i++) {
      const [u1, v1] = PROFILE[i];
      if (u <= u1) {
        const [u0, v0] = PROFILE[i - 1];
        return v0 + (v1 - v0) * ease((u - u0) / (u1 - u0));
      }
    }
    return PROFILE[PROFILE.length - 1][1];
  };
  const WEATHER = { storm: 1.35, rain: 1.12, fog: 0.85, snow: 0.85 };
  const MAX_SIZE = 1.35; // the biggest the waves get: the Open Ocean in a storm

  // ---------- The waves themselves ----------
  // A real sea is many waves at once, of every length, each travelling at the speed its length gives it; their crests
  // and troughs add up and cancel out at random, so no two crests are alike and waves come in sets that build and
  // fade. This adds up 28 of them, sized from the Pierson-Moskowitz spectrum (how a wind sea's energy spreads over the
  // wave lengths), with fixed random phases: Tessendorf's method for film oceans, in one dimension. All of them travel
  // left, in from the open sea, the longer ones faster. A storm puts more of the energy into shorter waves (the
  // spectrum's peak moves from 560 to 340 world units) as well as making the sea bigger.
  // The sum is then shaped the way real waves are:
  //   choppy   each point of the surface moves sideways toward the nearest crest (Gerstner, Tessendorf), so crests
  //            are sharp and troughs long and flat
  //   skewed   crests rise higher than troughs sink (second-order Stokes waves)
  //   leaning  crests are pushed ahead of the wave in proportion to their height, so the front face (toward the
  //            shore) is steeper than the back, more so in a storm, until the tallest crests tip over and break
  //            (where they would overhang, the face stops at FACE art px a column, with foam spilling down it)
  // It is worked out once a frame, here, for each art-pixel column on the screen, and handed to the shaders as a
  // one-row texture (the surface texture, below), so the water, its reflection, the haze and the boats all use the
  // same numbers.
  const TAU = Math.PI * 2;
  const SPEED = (length) => 57 * Math.sqrt(length / 600); // world units a second: deep water's speed for a wave this long
  const SIGMA = 6; // the sea's rms height at full size (art px); its tallest crests reach about 5 times that
  const DEPTH = 45; // art px below the waterline where the water moves a third as much
  const DEEP = 19; // the deepest a trough can go (art px): the deepest troughs ease toward it, never past
  const PEAK = 44; // the highest a crest can go
  // Each of these goes from its clear-weather value to its storm value as a storm builds
  const CHOP = [0.5, 0.6]; // how far the surface bunches toward the crests (1: as far as it can without folding)
  const LEAN = [0.15, 0.33]; // how far a crest leans ahead (world units per world unit of height)
  const SKEW = [0.12, 0.16]; // how much higher the crests rise than the troughs sink
  const FACE = [2, 3]; // the steepest a wave's face can rise, in art px a column (no sheer walls)
  const ROUND = 0.8; // how far a crest's column can stand above the middle of its two neighbours (art px): round tops
  const PEAKED = [4, 1.5]; // how much of the sea is in waves near the main length (JONSWAP's gamma): a clear day's
  // sea is mostly a long, regular swell; a storm's is a confused mix of lengths
  const WAVES = (() => {
    let seed = 20261125;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const n = 28;
    const list = Array.from({ length: n }, (_, i) => {
      const length = 36 * Math.pow(1600 / 36, (i + 0.15 + 0.7 * rand()) / n); // 36 to 1600 world units, a few per octave
      const k = TAU / length;
      return { k, w: k * SPEED(length), p: rand() * TAU, dk: 0 };
    });
    // (the stretch of the spectrum each one stands for: half way to its neighbours, in wavenumber)
    list.forEach((c, i) => (c.dk = Math.abs((list[i + 1]?.k ?? c.k / 1.15) - (list[i - 1]?.k ?? c.k * 1.15)) / 2));
    return list;
  })();
  const mixed = (pair, storm) => pair[0] + (pair[1] - pair[0]) * storm;
  // Each wave's height (art px) for a sea of size s whose rms height is SIGMA * s: the JONSWAP spectrum (Pierson-
  // Moskowitz, with the waves near its peak length boosted)
  const waveAmps = (s, storm) => {
    const kp = TAU / (560 - 220 * storm);
    const gamma = mixed(PEAKED, storm);
    const e = WAVES.map((c) => {
      const off = Math.sqrt(c.k / kp) - 1; // (in frequency, which goes as the square root of the wavenumber)
      const boost = Math.pow(gamma, Math.exp(-(off * off) / (2 * (off < 0 ? 0.07 : 0.09) ** 2)));
      return Math.pow(c.k, -3) * Math.exp(-1.25 * (kp / c.k) ** 2) * boost * c.dk;
    });
    const sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => SIGMA * s * Math.sqrt((2 * v) / sum));
  };
  // This frame's surface, for the art columns col0 .. col0 + n - 1 of the scene (column c spans c*PX to (c+1)*PX):
  // each column's wave (raw: art px, up positive, not rounded), whether the wave tips over there (fold), and the
  // height drawn, in whole art px, with the boats' hulls in it (col)
  const TEX_W = 1024; // the most columns it covers (a screen 6000 px wide)
  const surf = { col0: 0, n: 0, raw: new Float64Array(TEX_W), fold: new Uint8Array(TEX_W), col: new Int16Array(TEX_W), sigma: 0 };
  const sampleX = new Float64Array(8192);
  const sampleY = new Float64Array(8192);
  const seaFrame = (t, s, storm, water, col0, n) => {
    surf.col0 = col0;
    surf.n = n;
    surf.sigma = SIGMA * s;
    const { raw, fold } = surf;
    fold.fill(0, 0, n);
    if (!s) {
      raw.fill(0, 0, n);
      return;
    }
    const amp = waveAmps(s, storm);
    const lean = mixed(LEAN, storm);
    const skew = mixed(SKEW, storm);
    const chop = mixed(CHOP, storm);
    const sg = SIGMA * s;
    // The surface at points 1 world unit apart (in the water's own x, which slides with it), each moved sideways by
    // the chop and the lean; enough either side of the screen for the points that move onto it
    const margin = 150;
    const x0 = col0 * PX + water - margin;
    const m = Math.min(sampleX.length, Math.ceil(n * PX + 2 * margin) + 1);
    // Each wave's phase steps the same amount from one point to the next: turn it by that, rather than work out
    // a sine and a cosine at every point
    const rot = WAVES.map((c) => {
      const th = c.k * x0 + c.w * t + c.p;
      return [Math.cos(th), Math.sin(th), Math.cos(c.k), Math.sin(c.k)];
    });
    for (let i = 0; i < m; i++) {
      let y = 0;
      let d = 0;
      for (let q = 0; q < rot.length; q++) {
        const r = rot[q];
        y += amp[q] * r[0];
        d += amp[q] * r[1];
        const c = r[0] * r[2] - r[1] * r[3];
        r[1] = r[1] * r[2] + r[0] * r[3];
        r[0] = c;
      }
      const z = Math.max(-0.5 / skew, Math.min(2.5, y / sg));
      let h = y + skew * sg * (z * z - 1);
      if (h < -0.6 * DEEP) h = -DEEP + 0.4 * DEEP * Math.exp((h + 0.6 * DEEP) / (0.4 * DEEP));
      h = Math.min(PEAK, h);
      sampleX[i] = x0 + i - chop * PX * d - lean * PX * Math.max(0, h);
      sampleY[i] = h;
    }
    // Onto the columns: each stretch between two points covers the columns whose middles it passes over (the
    // highest, where a leaning crest has folded over its own front)
    raw.fill(-Infinity, 0, n);
    const base = col0 * PX + water;
    for (let i = 0; i + 1 < m; i++) {
      const xa = sampleX[i];
      const xb = sampleX[i + 1];
      const lo = Math.min(xa, xb);
      const hi = Math.max(xa, xb);
      const j0 = Math.max(0, Math.ceil((lo - base) / PX - 0.5));
      const j1 = Math.min(n - 1, Math.floor((hi - base) / PX - 0.5));
      for (let j = j0; j <= j1; j++) {
        const f = hi > lo ? (base + (j + 0.5) * PX - xa) / (xb - xa) : 0;
        const y = sampleY[i] + (sampleY[i + 1] - sampleY[i]) * f;
        if (y > raw[j]) raw[j] = y;
        if (xb < xa) fold[j] = 1;
      }
    }
    for (let j = 0; j < n; j++) if (raw[j] === -Infinity) raw[j] = j ? raw[j - 1] : 0;
    // Round crests: no column stands more than ROUND above the middle of its neighbours, a few times over, so a crest
    // has a rounded top a few columns wide instead of a point (troughs are left as they are)
    for (let pass = 0; pass < 4; pass++) {
      for (let j = 1; j + 1 < n; j++) {
        const cap = (raw[j - 1] + raw[j + 1]) / 2 + ROUND;
        if (raw[j] > cap) raw[j] = cap;
      }
    }
    // No face steeper than FACE: where a crest leans out over its front (or the chop makes a sheer back), the water
    // in front of it is raised into a steep ramp instead, so the crest keeps its height but never stands as a wall
    const face = mixed(FACE, storm);
    for (let j = n - 1; j > 0; j--) if (raw[j - 1] < raw[j] - face) raw[j - 1] = raw[j] - face;
    for (let j = 0; j + 1 < n; j++) if (raw[j + 1] < raw[j] - face - 1) raw[j + 1] = raw[j] - face - 1;
  };
  const roundArt = (v) => Math.floor(v + 0.5);

  // The boats push the water up to their keels. A hull pitches only as far as the water's overall slope along it, so
  // on a crest shorter than the boat (steep storm seas) the surface would drop away under it and show the sky between
  // the keel and the water. Under the flat of the keel (where the underside is within FILL rows of its lowest) the
  // surface reaches at least up to the hull's lowest row; past that it falls away DRAPE art px a column, so the water
  // runs off steeply rather than standing in a step. The rounded bow and stern can still lift clear of the water, as
  // they do at sea. The underside is read from the boat's picture.
  const SINK = BOATS ? 7 : 0; // art px of the hull under the water: about half its sides (13 rows from keel to gunwale), as a laden fishing boat sits
  const FILL = 3; // rows up from the keel that the water is held to
  const DRAPE = 3; // art px the water falls a column, past them
  let hullUp = null; // per column of the boat's picture: how high the water must reach there (art px from the boat's waterline), or null
  try {
    const img = await createImageBitmap(await fetch(new URL(SCENE.boat, location.origin)).then((r) => r.blob()));
    const cx = new OffscreenCanvas(img.width, img.height).getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    hullUp = Array.from({ length: img.width }, (_, x) => {
      let y = img.height - 1;
      while (y >= 0 && d[(y * img.width + x) * 4 + 3] === 0) y--;
      return y >= img.height - FILL ? img.height - SINK - y : null; // just covers its lowest row
    });
    if (!hullUp.some((v) => v != null)) hullUp = null;
  } catch (e) {
    console.warn('[waves] Could not read the boat’s picture: gaps may show under it on steep waves', e);
  }
  const HULL_A = hullUp ? hullUp.findIndex((v) => v != null) : 0; // the first and last columns the water is held to
  const HULL_B = hullUp ? hullUp.length - 1 - [...hullUp].reverse().findIndex((v) => v != null) : 0;
  // This frame's hulls: { x0: the picture's left edge (world units), f: the boat's float (art px), rise: how much
  // higher its right end sits than its left as it pitches (art px), flip: mirrored }
  let hullsNow = [];
  const hullLift = (lx) => {
    let h = -Infinity;
    for (const b of hullsNow) {
      const n = hullUp.length;
      const col = Math.floor((lx - b.x0) / PX); // from the left, as drawn
      const c = b.flip ? n - 1 - col : col; // in the picture
      const tilt = b.rise * ((col + 0.5) / n - 0.5);
      const d = Math.max(HULL_A - c, c - HULL_B, 0);
      h = Math.max(h, roundArt(d > 0 ? b.f + tilt - DRAPE * d : b.f + tilt + (hullUp[c] ?? -SINK)));
    }
    return h;
  };
  // The surface where it is drawn, in the art column under x (world units in the scene): whole art px, up positive,
  // with the hulls in it
  const columnArt = (x) => surf.col[Math.max(0, Math.min(surf.n - 1, Math.floor(x / PX) - surf.col0))] ?? 0;
  // The wave itself at x, smooth (between the columns' middles), for the boats to float on
  const rawAt = (x) => {
    const u = Math.max(0, Math.min(surf.n - 1.001, x / PX - surf.col0 - 0.5));
    const j = Math.floor(u);
    return surf.raw[j] + (surf.raw[j + 1] - surf.raw[j]) * (u - j);
  };
  // A hull from x0 to x1 floats on the water under it: halfway between that water's average and its highest point, so
  // on a steep storm wave it rides up over the crest instead of sitting half inside it
  const hullArt = (x0, x1) => {
    let sum = 0;
    let top = -Infinity;
    for (let i = 0; i < 9; i++) {
      const h = rawAt(x0 + ((x1 - x0) * i) / 8);
      sum += h;
      top = Math.max(top, h);
    }
    return (sum / 9 + top) / 2;
  };
  // A boat has weight: it eases toward that height (a third of a second to close most of the way) and only steps to
  // the next art pixel once it is well past the halfway point, so it never flicks up a pixel and straight back.
  // `b` keeps one boat's state: { at, shown }.
  const FLOAT_S = 0.3;
  const floatArt = (b, target, dt, ease = FLOAT_S) => {
    b.at = b.at == null ? target : b.at + (target - b.at) * (1 - Math.exp(-dt / ease));
    if (b.shown == null || Math.abs(b.at - b.shown) > 0.7) b.shown = roundArt(b.at);
    return b.shown;
  };

  // A hull also pitches with the swell: it tilts to the slope of the water under it (a straight line fitted to the
  // water along it), so on a long swell its bow and stern follow the water, up to PITCH art px apart. It eases and
  // steps the same way as the float (a little quicker), in whole art px of rise from stern to bow, so the picture
  // only changes when the tilt has really changed. The hull and oar turn about the middle of the hull at its
  // waterline; the angler stands upright in it, as people do, so the rod and line stay where the game draws them.
  const PITCH = 8;
  const PITCH_S = 0.25;
  const pitchArt = (x0, x1) => {
    let suy = 0;
    for (let i = 0; i < 9; i++) {
      const u = i / 8 - 0.5;
      const h = rawAt(x0 + (x1 - x0) * (i / 8));
      suy += u * h;
    }
    const rise = suy / 0.9375; // the fitted line's rise over the hull's length (the u values are even about 0: sum u^2 = 0.9375)
    return Math.max(-PITCH, Math.min(PITCH, rise));
  };

  // Whitecaps and spray. Foam is made where a wave breaks (its crest tips over), on a steep front face, and on the
  // tallest crests; it stays where it was made on the water, fading over a second or so, so a breaking crest leaves
  // a trail of foam on its back as it passes. In the Open Ocean only (the caps fade in and out with it).
  const FOAM_S = 0.9; // seconds for foam to fade to a third
  const FOAM_RING = 8192; // the water's columns it remembers (round the ring)
  const foamAmt = new Float32Array(FOAM_RING);
  const foamAt = new Float32Array(FOAM_RING); // when each was last made
  const foamHash = (a, b) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  // The surface texture: one texel per art column on the screen. Red: the drawn height + 128 (art px); green: the
  // solid rows of foam under the surface; blue: how thick the speckled foam under that is (0..1); alpha: spray, a
  // pixel above the surface.
  const surfData = new Uint8Array(TEX_W * 4);
  const surfSource = new BufferImageSource({
    resource: surfData,
    width: TEX_W,
    height: 1,
    format: 'rgba8unorm',
    alphaMode: 'no-premultiply-alpha',
    scaleMode: 'nearest',
    autoGenerateMipmaps: false,
  });
  const surfResources = () => ({ uSurf: surfSource, uSurfSampler: surfSource.style });

  // The fog banks (atmosphere.js) lie in front of the water, but they're part of the scene's picture, and the near
  // water's reflection is laid over that, hiding them there: they'd stop at the waterline, over the far sea only. So
  // their shapes (the game's own: the same drawing, shared) are drawn small each frame, and the reflection lets the
  // picture under it (fog and all) show through as thick as the fog lies there.
  const FOG_K = 1 / 6; // the fog's picture, to the screen's (its blur hides the difference)
  const fogRT = RenderTexture.create({ width: 8, height: 8, resolution: 1 });
  const fogCopy = new Graphics();
  const fogResources = () => ({ uFog: fogRT.source, uFogSampler: fogRT.source.style });

  // The fishing spots (scene.js drawSpots: a ring on the surface and a pool of light in the spot's colour, and what
  // marks its kind: the fish under it, a whirlpool, rising bubbles, a wreck) are drawn on the water, under the near
  // water's reflection, which all but hides them. So the ring and the pool are left out, and the spot is lit instead
  // as if by a round spotlight shone down on the near water from above (REFLECT): as wide as the spot reaches, on
  // the moving surface, lighting whatever water is in it. What marks its kind is drawn small each frame (the game's
  // own drawing, shared), and the reflection thins over it, so it shows.
  const SPOT_K = 1 / 3; // the spots' picture, to the screen's (an art px a texel)
  const spotRT = RenderTexture.create({ width: 8, height: 8, resolution: 1 });
  const spotCopy = new Graphics();
  const spotResources = () => ({ uSpot: spotRT.source, uSpotSampler: spotRT.source.style });
  const SPOT_COLOR = Object.fromEntries((SEA.spots ?? []).map((d) => [d.id, d.color]));
  const MAX_SPOTS = 4; // spotlights at once (on screen)
  const SPOT_LIGHT = 0.55; // how much a spotlight brightens what's in it, by its colour (0.55: by up to 55%)
  // The faint haze of a spot's light over the water (in the scene's fxLayer, added on, as the game's glow is)
  const spotHaze = new Graphics();
  spotHaze.blendMode = 'add';
  // Draw the part of an oval (middle cx, cy; half sizes rx, ry) above the line at y = top
  const hazeCap = (cx, cy, rx, ry, top, color, alpha) => {
    const h = cy - top; // how far under the line its middle is
    if (ry <= h || alpha <= 0) return;
    const a0 = Math.asin(Math.max(-1, Math.min(1, h / ry)));
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = a0 + ((Math.PI - 2 * a0) * i) / 24;
      pts.push(cx + rx * Math.cos(a), cy - ry * Math.sin(a));
    }
    spotHaze.poly(pts).fill({ color, alpha });
  };
  // Mist: the water over a spot is warmer, so a low mist lies on it, as sea smoke does on water warmer than the air:
  // thickest at the surface and over the spot's middle, thinning as it rises, in soft columns that rise higher here
  // and lower there and lean with the drift, its body slowly churning upward; pale, lit a little in the spot's colour
  // by its light. A shader (MIST) on a strip over the water where the spots are, in the scene's fxLayer, so the water
  // mirrors it; by whole art px, as the art is.
  const MIST_HEIGHT = 28; // art px the mist rises over the middle of a spot, about (its columns, up to twice that)
  const MIST_BELOW = 4; // art px it lies down over the near water
  const MIST_ALPHA = 0.55; // how thick it is at its thickest
  const MIST = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uMist; // the waterline (screen px), the time (s), an art px (screen px), where the world's x = 0 is (screen px)
uniform mat4 uSpotP; // the spots, a column each, as the reflection's: middle (screen px), reach (screen px), how bright (off: 0), a seed
uniform mat4 uSpotC; // and their colours
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float k = 0.5;
  for (int i = 0; i < 4; i++) {
    v += k * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    k *= 0.5;
  }
  return v / 0.9375;
}
void main(void) {
  vec2 g = vTextureCoord * uInputSize.xy + uOutputFrame.xy; // screen px in the scene's picture
  float art = uMist.z;
  float t = uMist.y;
  float wx = floor((g.x - uMist.w) / art) + 0.5; // the world's art column
  float xs = uMist.w + wx * art;
  float h = floor((uMist.x - g.y) / art) + 0.5; // art px over the waterline (under it: less than 0)
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    vec4 s = uSpotP[i];
    if (s.z <= 0.0) continue;
    float u = (xs - s.x) / s.y; // across the spot, -1..1
    float across = 1.0 - smoothstep(0.45, 1.15, abs(u));
    if (across <= 0.0) continue;
    // (its pattern by art px from the spot's middle, and the spot's own seed: it stays with the spot as you move)
    float fi = s.w;
    float rx = floor((xs - s.x) / art + 0.5);
    float lean = max(h, 0.0) * 0.3 * sin(t * 0.07 + fi); // (the columns lean with a slow drift)
    float cols = fbm(vec2((rx + lean) * 0.05 + fi, t * 0.05)); // where the mist rises higher now
    float top = ${MIST_HEIGHT.toFixed(1)} * (0.3 + 1.4 * cols * cols) * (0.5 + 0.5 * (1.0 - u * u));
    float lift = h >= 0.0 ? exp(-h / max(top, 1.0)) : smoothstep(${(-MIST_BELOW).toFixed(1)}, 0.0, h);
    float body = fbm(vec2((rx + lean) * 0.07 + t * 0.12 + fi, h * 0.14 - t * 0.4)); // churning upward
    float wisp = fbm(vec2((rx - lean) * 0.18 - t * 0.2, h * 0.3 - t * 0.9 + fi)); // finer wisps in it
    float d = lift * across * smoothstep(0.18, 0.7, 0.75 * body + 0.35 * wisp + 0.25 * lift - 0.1);
    float k = clamp(d * ${MIST_ALPHA.toFixed(2)} * min(1.0, 1.2 * s.z), 0.0, 1.0);
    vec3 lc = mix(vec3(1.0, 0.97, 0.93), uSpotC[i].rgb, 0.3); // pale, a little in the spot's colour
    col = col * (1.0 - k) + lc * k;
    a = a + k * (1.0 - a);
  }
  finalColor = vec4(col, a);
}
`;
  let mistFilter = null; // (made at its first use: VERTEX is below)
  let mistSprite = null;
  const mistUniforms = () => mistFilter.resources.waveMist.uniforms;
  const SPOT_DEPTH = 0.38; // how far a spotlight reaches down toward you, to how far it reaches across
  const SPOT_WAVER = 4.0; // screen px the reflection wavers by over a spot (more than elsewhere)
  // A buoy at the middle of each spot, as the game marks a zone's ends (scene.js drawSpots): red and white, on a
  // pole, bobbing, with a lamp on top that blinks, in the spot's colour. Found as the game draws its spots (just
  // after), fading with the spot; drawn whole in its own Graphics behind the boats (not in the water's layer, whose
  // filter would bend it column by column), raised or lowered to the water at its middle. It shows in the reflection.
  const WRECK_COLORS = new Set([0x5a3d22, 0x3f2a17, 0xdcd3c0]); // the game's wreck: mast and yard, hull, sail
  let spotsHooked = null; // the scene whose drawSpots finds the buoys too
  const buoys = []; // this frame's buoys: where (world units, on the still water), colour, how faded, the lamp's blink
  const buoyLamps = []; // this frame's lamps: where (world units, riding the water), colour, how lit
  const buoyBox = new Container(); // a Graphics per buoy (each tilts on its own)
  const buoyParts = [];
  const flagGlowBox = new Container(); // the flags again, over the night's darkness (in the scene's fxLayer)
  const flagGlowParts = [];
  const FLAG_GLOW = 0.85; // how strongly a flag glows at night (1: as bright as by day)
  // While you're on a spot (getting its buff: the game's sea.here), its flag is run up a taller pole, easing up and down
  const FLAG_RAISE = 20; // art px higher
  const flagUp = new Map(); // spot: 0 (down) .. 1 (up)
  let flagT = null;
  const drawSpotBuoys = (sc, t) => {
    buoys.length = 0;
    const dt = flagT == null ? 0 : Math.max(0, Math.min(0.25, t - flagT));
    flagT = t;
    const L = sc.L;
    if (!L || !sc.sea?.spots?.length || !sc.seaToWorld) return;
    const now = Date.now();
    const here = sc.sea.here;
    for (const spot of [...flagUp.keys()]) if (!sc.sea.spots.includes(spot)) flagUp.delete(spot);
    for (const spot of sc.sea.spots) {
      const color = SPOT_COLOR[spot.kind];
      if (color == null) continue;
      const wx = sc.seaToWorld(spot.x);
      if (wx < L.cut - 200 || wx > L.cut + L.VW + 200) continue; // off screen
      const a = Math.max(0, Math.min(1, (spot.until - now) / 8000, (now - (spot.at ?? 0)) / 3000)); // (as the spot fades)
      if (!(a > 0)) continue;
      const x = Math.round(wx / PX) * PX;
      // (floating a little higher than the game's: its red above the waterline, the white band at it, so the near
      // water's reflection, laid over the water from the waterline down, doesn't hide it)
      const y = L.waterY - 5 * PX + Math.round(Math.sin(t * 2 + spot.x) * PX);
      const on = Boolean(here) && (here === spot || (here.kind === spot.kind && here.x === spot.x));
      let up = flagUp.get(spot) ?? (on ? 1 : 0);
      up += ((on ? 1 : 0) - up) * Math.min(1, dt * 5);
      if (Math.abs((on ? 1 : 0) - up) < 0.01) up = on ? 1 : 0;
      flagUp.set(spot, up);
      buoys.push({ x, y, color, a, blink: 0.6 + 0.4 * Math.sin(t * 4 + spot.x), kind: spot.kind, t, seed: spot.x, up, spot });
    }
  };
  // A flag over each buoy's lamp in place of the game's long label ("On a School of fish: +1 fish every cast"): the
  // amount (from the start of the spot's description, so it follows the game's numbers) and an icon for what it
  // gives: a fish, a four-leaf clover (luck), a sparkle (mutation), a chest. Pixel art, dark on cloth in the
  // spot's colour, waving a pixel at a time.
  // (a 5 x 7 pixel font, and icons 7 to 9 px tall: about one and a half times the size of a 3 x 5 font, in whole art px)
  const FLAG_GLYPH = {
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
    '.': ['.', '.', '.', '.', '.', '.', '#'],
    0: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  };
  const FLAG_ICON = {
    school: ['..###....', '.#####..#', '##.####.#', '#########', '#######.#', '.#####..#', '..###....'], // a fish
    deep: ['.##...##.', '#.##.##.#', '####.####', '.###.###.', '....#....', '.###.###.', '####.####', '#.##.##.#', '.##...##.'], // a four-leaf clover: heart leaves round a middle
    glow: ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'], // a sparkle (mutation)
    wreck: ['.######.', '########', '###..###', '###..###', '########', '########', '########'], // a chest
  };
  const FLAG_INK = 0x14213d;
  const FLAG_SCALE = 1; // art px to each of the flag's pixels
  const FLAG_PAD = 2; // px of cloth round the text and icon
  const FLAG_POLE = 13; // art px of flagpole over the lamp (the cloth hangs from its top, clear of the lamp)
  const flagArt = {}; // kind: rows of '#' (ink) and '.' (cloth), with cloth all round
  const flagFor = (kind) => {
    if (kind in flagArt) return flagArt[kind];
    const def = (SEA.spots ?? []).find((d) => d.id === kind);
    const amount = (String(def?.desc ?? '').match(/^\s*([+×x])\s*([\d.]+)/) ?? []).slice(1).join('').replace('x', '×');
    const glyphs = [...amount].map((ch) => FLAG_GLYPH[ch]).filter(Boolean);
    const icon = FLAG_ICON[kind];
    if (!glyphs.length && !icon) return (flagArt[kind] = null);
    // Each flag 7 + 2 x FLAG_PAD px tall; a taller icon (up to 9) takes from the cloth over and under it. The text and
    // icon are centred top to bottom.
    const H = 7 + 2 * FLAG_PAD;
    const iconH = icon?.length ?? 0;
    const textW = glyphs.length ? glyphs.reduce((n, gl) => n + gl[0].length, glyphs.length - 1) : 0;
    const iconW = icon?.[0].length ?? 0;
    const blankText = '.'.repeat(textW);
    const blankIcon = '.'.repeat(iconW);
    const rows = [];
    for (let r = 0; r < H; r++) {
      const tr = r - FLAG_PAD; // (the text's row)
      const ir = r - Math.floor((H - iconH) / 2); // (the icon's row)
      const text = tr >= 0 && tr < 7 ? glyphs.map((gl) => gl[tr]).join('.') : blankText; // (a px between the characters)
      const pic = ir >= 0 && ir < iconH ? icon[ir] : blankIcon;
      const pad = '.'.repeat(FLAG_PAD);
      rows.push(pad + [textW ? text : '', iconW ? pic : ''].filter(Boolean).join('..') + pad); // (two before the icon)
    }
    return (flagArt[kind] = rows);
  };
  // The flagpole up from the lamp (tilting with the buoy); returns how tall (world units), 0 with no flag
  const drawFlagPole = (g, x, top, b) => {
    if (!flagFor(b.kind)) return 0;
    const pole = FLAG_POLE + Math.round((b.up ?? 0) * FLAG_RAISE); // (run up while you're on the spot)
    g.rect(x - PX, top - pole * PX, PX, pole * PX).fill({ color: 0x4a4a4a, alpha: b.a });
    return pole * PX;
  };
  // The cloth off the pole's top (x, y: its top left), drawn with the buoy so it leans as the buoy sways, and waving:
  // each column down a pixel now and then, more toward its free end (the text is big enough to read through it)
  const drawFlagCloth = (g, x, y, b) => {
    const art = flagFor(b.kind);
    if (!art) return;
    const w = art[0].length;
    const h = art.length;
    const P = FLAG_SCALE * PX; // (one of the flag's pixels)
    for (let c = 0; c < w; c++) {
      const wave = Math.round((0.5 + 0.5 * Math.sin(b.t * 3 - c * 0.35 + b.seed)) * Math.min(1, c / 8));
      const cx = x + c * P;
      const cy = y + wave * P;
      g.rect(cx, cy, P, h * P).fill({ color: b.color, alpha: b.a });
      for (let r = 0; r < h; r++) {
        if (art[r][c] !== '#') continue;
        let e = r;
        while (art[e + 1]?.[c] === '#') e++;
        g.rect(cx, cy + r * P, P, (e - r + 1) * P).fill({ color: FLAG_INK, alpha: b.a });
        r = e;
      }
    }
  };
  // The buoys, each raised by rise(x) (world units, up positive) at its middle. While its flag is up, a buoy sways:
  // it leans with the slope of the water under it (slope(x): art px up per art px across), a little late so it rocks
  // rather than snaps, and rocks gently on its own too (so it sways on a still sea). Tilted round its waterline.
  const SWAY_LEAN = 1.4; // how far it leans, to the water's own slope
  const SWAY_MAX = 0.1; // radians, at most (about 6 degrees: past that the flag's text breaks up on the pixels)
  const SWAY_IDLE = 0.07; // radians it rocks on its own
  const buoySway = new Map(); // spot: its lean now (radians)
  let swayT = null;
  const flagRects = []; // each flag's cloth this frame, in its buoy's Graphics (for the light shader: no rim light on it)
  const drawBuoys = (sc, rise, slope = () => 0) => {
    buoyLamps.length = 0;
    flagRects.length = 0;
    const layer = sc?.actorLayer;
    if (!layer) return;
    if (buoyBox.parent !== layer) layer.addChildAt(buoyBox, 0);
    while (buoyParts.length < buoys.length) buoyParts.push(buoyBox.addChild(new Graphics()));
    if (sc.fxLayer && flagGlowBox.parent !== sc.fxLayer) sc.fxLayer.addChild(flagGlowBox);
    while (flagGlowParts.length < buoys.length) flagGlowParts.push(flagGlowBox.addChild(new Graphics()));
    for (const parts of [buoyParts, flagGlowParts]) {
      parts.forEach((g, i) => {
        g.visible = i < buoys.length;
        if (!g.visible) g.clear();
      });
    }
    // (as the lamps are lit: by night, and in gloomy weather; fog veils it some)
    const glowA = FLAG_GLOW * (sc.atmo?.lit ?? 0) * (1 - 0.5 * (sc.atmo?.fogAmount ?? 0));
    for (const spot of [...buoySway.keys()]) if (!buoys.some((b) => b.spot === spot)) buoySway.delete(spot);
    const t = buoys[0]?.t ?? 0;
    const dt = swayT == null ? 0 : Math.max(0, Math.min(0.25, t - swayT));
    swayT = t;
    buoys.forEach(({ x, color, a, blink, ...b }, i) => {
      const y = b.y - rise(x);
      const base = y + 5 * PX; // (its waterline: what it tilts round)
      const lean = -Math.atan(slope(x)) * SWAY_LEAN + SWAY_IDLE * Math.sin(t * 1.7 + b.seed);
      const target = (b.up ?? 0) * Math.max(-SWAY_MAX, Math.min(SWAY_MAX, lean));
      let ang = buoySway.get(b.spot) ?? target;
      ang += (target - ang) * Math.min(1, dt * 4);
      buoySway.set(b.spot, ang);
      const g = buoyParts[i].clear();
      g.position.set(x, base);
      g.rotation = ang;
      // (drawn round its waterline: y is 5 art px above it)
      g.rect(-3 * PX, -5 * PX, 6 * PX, 4 * PX).fill({ color: 0xd8432e, alpha: a });
      g.rect(-3 * PX, -PX, 6 * PX, 2 * PX).fill({ color: 0xf2efe8, alpha: a });
      g.rect(-PX, -13 * PX, 2 * PX, 8 * PX).fill({ color: 0x4a4a4a, alpha: a });
      g.rect(-2 * PX, -15 * PX, 4 * PX, 3 * PX).fill({ color, alpha: blink * a });
      const pole = drawFlagPole(g, 0, -15 * PX, { color, a, ...b });
      if (pole) {
        drawFlagCloth(g, 0, -15 * PX - pole, { color, a, ...b });
        const art = flagFor(b.kind);
        const P = FLAG_SCALE * PX;
        // (a pixel lower for the cloth's wave)
        flagRects.push({ g, x0: 0, y0: -15 * PX - pole, x1: art[0].length * P, y1: -15 * PX - pole + (art.length + 1) * P, pad: P });
      }
      const h = 13.5 * PX; // (the lamp, tilted with it)
      buoyLamps.push({ x: x + h * Math.sin(ang), y: base - h * Math.cos(ang), color, a, blink });
      // At night the flag glows: drawn again over the darkness (just the cloth and what's on it, nothing round it),
      // fading in as the lamps are lit
      const gg = flagGlowParts[i].clear();
      gg.position.set(x, base);
      gg.rotation = ang;
      if (pole && glowA > 0.01) drawFlagCloth(gg, 0, -15 * PX - pole, { ...b, color, a: a * glowA });
    });
  };
  // At night (and in gloom) a buoy's lamp glows as the lantern does (atmosphere.js): its light in the light map, so it
  // lights a pool of the night round it, the buoy and the water; and its glow again over the darkness, blurred at three
  // widths and added, so it blooms. In the spot's colour, blinking with the lamp, riding the waves with the buoy.
  const lampBloom = []; // the haze, the wide glow, the tight core: Graphics, each in a blurred, added Container
  const lampLights = []; // per lamp: its pool and its core, in the light map
  const BUOY_LIGHT = 0.6; // how much a lamp lights the night round it, to the lantern's
  const drawLampGlow = (sc) => {
    const atmo = sc?.atmo;
    const fx = sc?.fxLayer;
    if (!atmo?.lights || !atmo.light || !fx) return;
    if (!lampBloom.length) {
      for (const strength of [14, 6, 2]) {
        const c = new Container();
        c.filters = [new BlurFilter({ strength, quality: 4 })];
        c.blendMode = 'add';
        lampBloom.push(c.addChild(new Graphics()));
      }
    }
    for (const g of lampBloom) if (g.parent.parent !== fx) fx.addChild(g.parent);
    while (lampLights.length < MAX_SPOTS) {
      lampLights.push([0, 1].map(() => {
        const s = new Sprite(atmo.light);
        s.anchor.set(0.5);
        s.blendMode = 'add';
        return s;
      }));
    }
    for (const pair of lampLights) for (const s of pair) {
      if (s.parent !== atmo.lights) atmo.lights.addChild(s);
      s.visible = false;
    }
    for (const g of lampBloom) g.parent.visible = true;
    const [haze, wide, tight] = lampBloom.map((g) => g.clear());
    const lit = atmo.lit ?? 0;
    if (lit < 0.02) return;
    const fog = 1 + (atmo.fogAmount ?? 0) * 0.8; // (fog scatters the glow wider)
    buoyLamps.slice(0, MAX_SPOTS).forEach((l, i) => {
      const y = l.y;
      const k = lit * l.a * (0.75 + 0.25 * l.blink);
      const core = [16, 8, 0].reduce((c, sh) => c | (Math.round(255 * 0.5 + ((l.color >> sh) & 255) * 0.5) << sh), 0);
      haze.circle(l.x, y, 30 * fog).fill({ color: l.color, alpha: 0.3 * k });
      wide.circle(l.x, y, 12 * fog).fill({ color: l.color, alpha: 0.7 * k });
      tight.circle(l.x, y, 5).fill({ color: core, alpha: k });
      const [pool, glow] = lampLights[i];
      const spread = 1 + (atmo.fogAmount ?? 0) * 0.5;
      pool.position.set(l.x, y + 12);
      pool.width = 220 * spread;
      pool.height = 190 * spread;
      pool.tint = l.color;
      pool.alpha = 0.9 * BUOY_LIGHT * k;
      glow.position.set(l.x, y);
      glow.width = glow.height = 60;
      glow.tint = core;
      glow.alpha = 0.8 * BUOY_LIGHT * k;
      pool.visible = glow.visible = true;
    });
    // Other players' lanterns, as the game lights yours (atmosphere.js update, drawBloom), MATE_LIGHT as much
    const f = (atmo.flicker ?? 1) * lit * MATE_LIGHT;
    const spread = 1 + (atmo.fogAmount ?? 0) * 0.5;
    mateLamps.slice(0, mateLights.length).forEach((l, i) => {
      haze.circle(l.x, l.y, 46 * fog).fill({ color: LANTERN_LIGHT, alpha: (0.3 + (atmo.fogAmount ?? 0) * 0.2) * f });
      wide.circle(l.x, l.y, 20 * fog).fill({ color: LANTERN_LIGHT, alpha: 0.75 * f });
      tight.circle(l.x, l.y, 8).fill({ color: LANTERN_CORE, alpha: MATE_CORE * f }); // (the core dimmer: the glass shows)
      const [pool, glow] = mateLights[i];
      pool.position.set(l.x, l.y + 20);
      pool.width = 360 * spread;
      pool.height = 330 * spread;
      pool.tint = LANTERN_LIGHT;
      pool.alpha = 0.9 * f;
      glow.position.set(l.x, l.y);
      glow.width = glow.height = 90;
      glow.tint = LANTERN_CORE;
      glow.alpha = 0.8 * f;
      pool.visible = glow.visible = true;
    });
  };
  const hideLampGlow = () => {
    for (const g of lampBloom) g.parent.visible = false;
    for (const pair of [...lampLights, ...mateLights]) for (const s of pair) s.visible = false;
  };

  // ---------- Other players' lanterns ----------
  // Your lantern stands on a post at your boat's stern (scene.js placeRowboat, atmosphere.js paintLantern); other
  // players' boats (scene.js makeMateRig) have none. Each gets the game's own, painted by the game's paintLantern into
  // the boat's rig, behind the oar, so it turns round, floats and pitches with the boat, and lit as the game lights
  // yours (drawLampGlow, above).
  const MATE_LIGHT = 0.6; // how much another boat's lantern lights the night, to yours
  const MATE_CORE = 0.4; // its bloom's bright core, to the game's (at full it washes the glass out to white)
  const MAX_MATE_LAMPS = 12; // scene.js MAX_MATES: other boats drawn at once
  const LANTERN_LIGHT = 0xffa04a; // atmosphere.js: the lantern's light and its core
  const LANTERN_CORE = 0xffd890;
  const STERN = { lanternX: 3, lanternSink: 3, gunwale: 5 }; // scene.js ROWBOAT: the post, from the stern (art px)
  const mateLanterns = new Map(); // a boat's rig (scene.mateRigs' r) -> its lantern (a Graphics in r.rig)
  const mateLamps = []; // this frame's glasses, in the scene
  const mateLights = []; // per lantern: its pool and its core, in the light map
  // Paints a boat's lantern where its hull is now (before it pitches) and returns it, with its glass in the rig
  const mateLantern = (sc, r) => {
    let g = mateLanterns.get(r);
    if (!g || g.destroyed || g.parent !== r.rig) {
      g = new Graphics();
      r.rig.addChildAt(g, r.rig.getChildIndex(r.boat) + 1);
      mateLanterns.set(r, g);
    }
    // (as placeRowboat: the glass 6 px right of the post and 15.5 px above its base, sunk into the hull)
    const at = { x: r.boat.x + (STERN.lanternX + 6) * PX, y: r.boat.y + (STERN.gunwale + STERN.lanternSink - 15.5) * PX };
    g.visible = true;
    sc.atmo.paintLantern(g.clear(), at, 'post', sc.atmo.lit ?? 0);
    return { g, at };
  };
  // The lanterns of boats gone from the scene, and the lights left over
  const tidyLanterns = (sc) => {
    for (const [r, g] of mateLanterns) {
      if (r.rig.destroyed || g.destroyed || ![...(sc?.mateRigs?.values() ?? [])].includes(r)) {
        if (!g.destroyed) g.destroy();
        mateLanterns.delete(r);
      }
    }
    const atmo = sc?.atmo;
    if (!atmo?.lights || !atmo.light) return;
    while (mateLights.length < MAX_MATE_LAMPS) {
      mateLights.push([0, 1].map(() => {
        const s = new Sprite(atmo.light);
        s.anchor.set(0.5);
        s.blendMode = 'add';
        return s;
      }));
    }
    for (const pair of mateLights) for (const s of pair) {
      if (s.parent !== atmo.lights) atmo.lights.addChild(s);
      s.visible = false;
    }
  };
  const hideLanterns = () => {
    for (const g of mateLanterns.values()) if (!g.destroyed) g.visible = false;
    for (const pair of mateLights) for (const s of pair) s.visible = false;
    mateLamps.length = 0;
  };
  const hookSpots = (sc) => {
    if (spotsHooked === sc || typeof sc?.drawSpots !== 'function') return;
    unhookSpots();
    const own = Object.prototype.hasOwnProperty.call(sc, 'drawSpots') ? sc.drawSpots : undefined;
    const draw = sc.drawSpots;
    sc.drawSpots = function (t, ...rest) {
      const out = draw.call(this, t, ...rest);
      try { drawSpotBuoys(this, t); } catch (e) { /* (the game's spots as they are) */ }
      return out;
    };
    spotsHooked = sc;
    spotsHooked.__wavesOwnDrawSpots = own;
  };
  const unhookSpots = () => {
    if (!spotsHooked) return;
    const own = spotsHooked.__wavesOwnDrawSpots;
    if (own) spotsHooked.drawSpots = own;
    else delete spotsHooked.drawSpots;
    delete spotsHooked.__wavesOwnDrawSpots;
    spotsHooked = null;
  };
  // The bite timer and the Frenzy bar as two lanterns on the stern post, one above the other, in place of the game's
  // round gauges over the water (and their words, hidden). The post is twice as tall; the bite lantern hangs at its
  // top, the Frenzy one where the game's lantern hangs (its light still comes from there at night). Each one's glass
  // fills from the bottom, an art px at a time, as the gauge's pie did (scene.js updateHud, updateFrenzy): the bite
  // with the wait for a bite (full when something bites, empty when not fishing), the Frenzy with its fill (empty
  // while sailing). In the gauges' colours (pie.js), on their dark green.
  // The boat's light (its pool in the night, its bloom, its reflection) comes from the bite lantern at the top: the
  // game places them all from atmo.lanternAt just after painting the lantern, so the hook moves that up once painted.
  // And the bloom's bright core over the glass (and its wide glow) much dimmer, so the fill shows through.
  const GAUGE_UP = 11; // art px the bite lantern hangs above the Frenzy one (its base a support bar's width, 1 art px, clear of the arm below)
  const GAUGE_BLOOM = { tight: 0.15, wide: 0.55 }; // the bloom's core and wide glow, to the game's
  const GAUGE_FILL = {
    bite: { light: 0xffe785, mid: 0xffbe45, dark: 0xdf9244 },
    frenzy: { light: 0xe890f0, mid: 0xa456e3, dark: 0x654ab0 },
  };
  const GAUGE_EMPTY = 0x1e2c21;
  // The game's gauges hidden (and the spot's long label: the buoy's flag says it)
  const HIDDEN = [GAUGES && '.hud-bar, .hud-phase, .hud-frenzy', BUOYS && '.hud-spot'].filter(Boolean);
  const GAUGE_CSS = HIDDEN.length ? `${HIDDEN.join(', ')} { display: none !important; }` : '';
  let gaugeStyle = null;
  let lanternHooked = null; // the atmosphere whose paintLantern draws the gauges
  const gaugeFills = (sc) => {
    const f = sc.fisher;
    const biting = f?.phase === 'waiting' || f?.phase === 'bite';
    const bite = biting ? (f.phase === 'bite' ? 1 : f.progress ?? 0) : 0;
    const frenzy = sc.sea?.moving ? 0 : sc.getFrenzy?.()?.fill ?? 0;
    return { bite: Math.max(0, Math.min(1, bite)), frenzy: Math.max(0, Math.min(1, frenzy)) };
  };
  const paintGauges = (g, at, mode, fills) => {
    // (as atmosphere.js paintLantern: art px round the post's base, 6 px left of and 15.5 px below the glass)
    const x0 = at.x - 6 * PX;
    const deck = at.y + 15.5 * PX;
    const r = (x, y, w, h, color) => g.rect(x0 + x * PX, deck + y * PX, w * PX, h * PX).fill(color);
    if (mode === 'post') {
      r(-1, -24 - GAUGE_UP, 2, 24 + GAUGE_UP, 0x3b2a1e); // post
      r(-1, -24 - GAUGE_UP, 2, 1, 0x5a4330);
    }
    for (const [dy, fill, c] of [[-GAUGE_UP, fills.bite, GAUGE_FILL.bite], [0, fills.frenzy, GAUGE_FILL.frenzy]]) {
      if (mode === 'post' || dy === 0) {
        r(1, -23 + dy, 5, 1, 0x26262b); // arm
        r(5, -22 + dy, 1, 2, 0x26262b); // hook
      } else {
        r(5, -24 + dy, 1, 4, 0x26262b); // (from a pole: hung on a chain from the one below's hook)
      }
      r(3, -20 + dy, 6, 1, 0x1c1c21); // cap
      r(4, -21 + dy, 4, 1, 0x26262b);
      r(3, -19 + dy, 1, 5, 0x1c1c21); // frame
      r(8, -19 + dy, 1, 5, 0x1c1c21);
      r(3, -14 + dy, 6, 1, 0x1c1c21); // base
      r(4, -19 + dy, 4, 5, GAUGE_EMPTY); // glass, 4 x 5
      // Filled from the bottom row up, each row left to right: 20 steps
      const n = Math.round(fill * 20);
      const rows = Math.floor(n / 4);
      const top = 5 - rows; // the first full row
      if (rows > 0) {
        r(4, -19 + dy + top, 4, rows, c.mid);
        r(4, -15 + dy, 4, 1, c.dark); // (the bottom row darker, as the gauges' fills are)
        if (rows > 1 && n % 4 === 0) r(4, -19 + dy + top, 4, 1, c.light); // (the surface lighter)
      }
      if (n % 4) r(4, -19 + dy + top - 1, n % 4, 1, c.light);
    }
  };
  const hookLantern = (sc) => {
    if (!gaugeStyle && GAUGE_CSS) {
      gaugeStyle = document.createElement('style');
      gaugeStyle.textContent = GAUGE_CSS;
      document.head.append(gaugeStyle);
    }
    if (!GAUGES) return;
    const atmo = sc?.atmo;
    if (lanternHooked === atmo || typeof atmo?.paintLantern !== 'function') return;
    unhookLantern();
    const own = Object.prototype.hasOwnProperty.call(atmo, 'paintLantern') ? atmo.paintLantern : undefined;
    const paint = atmo.paintLantern;
    atmo.paintLantern = function (g, at, mode, lit, ...rest) {
      if (g !== this.lantern && g !== this.dockLantern) return paint.call(this, g, at, mode, lit, ...rest);
      // (the Frenzy lantern's glass: where the game put it, unless this is the light already moved up)
      const glass = at?.__wavesGauge ? { x: at.x, y: at.y + GAUGE_UP * PX } : at;
      try {
        paintGauges(g, glass, mode, gaugeFills(sc));
      } catch (e) {
        return paint.call(this, g.clear(), at, mode, lit, ...rest);
      }
      if (g === this.lantern && !at?.__wavesGauge) this.lanternAt = { ...at, y: at.y - GAUGE_UP * PX, __wavesGauge: true };
    };
    lanternHooked = atmo;
    lanternHooked.__wavesOwnPaintLantern = own;
    lanternHooked.__wavesBloom = [atmo.bloomTight?.parent, atmo.bloomWide?.parent].map((c) => c?.alpha);
    if (atmo.bloomTight?.parent) atmo.bloomTight.parent.alpha = GAUGE_BLOOM.tight;
    if (atmo.bloomWide?.parent) atmo.bloomWide.parent.alpha = GAUGE_BLOOM.wide;
  };
  const unhookLantern = () => {
    if (!lanternHooked) return;
    const own = lanternHooked.__wavesOwnPaintLantern;
    if (own) lanternHooked.paintLantern = own;
    else delete lanternHooked.paintLantern;
    delete lanternHooked.__wavesOwnPaintLantern;
    const [tight, wide] = lanternHooked.__wavesBloom ?? [];
    if (lanternHooked.bloomTight?.parent && tight != null) lanternHooked.bloomTight.parent.alpha = tight;
    if (lanternHooked.bloomWide?.parent && wide != null) lanternHooked.bloomWide.parent.alpha = wide;
    delete lanternHooked.__wavesBloom;
    lanternHooked = null;
  };
  const SPOT_UNDER = 1; // art px under the surface where it starts: under the water's dark outline (scene.js: from waterY)

  // Glints: short flat dashes of sun (or moon) light flashing on the water in its path, as in footage of the sun's path
  // on the sea: a column under the light, thick and nearly solid toward the horizon and breaking up into scattered
  // dashes nearer, mostly dim with now and then a bright one, each gone in a tenth of a second or so; narrow and long
  // when the light is low, wider when it's high. On a rough sea they gather in bands on the swells' lit faces, which
  // roll in toward you, with dark troughs between.
  // The water's own columns (so they ride along with it) are cut into cells a few art px wide; each cell gets a chance
  // every 0.6 to 1.6 s, drawn afresh (whether it flashes, when, how long a dash and where in the cell, how bright), so
  // the glints land somewhere new each time instead of the same pixels lighting up over and over.
  // GLINT: the share of chances that flash, at the path's middle.
  const GLINT = 0.2;
  const GLINT_BRIGHT = 0.8; // how far a glint at its brightest goes toward the light's colour
  const NEAR_PATH = 0.3; // the soft shimmer of the sun's (or moon's) path on the near water, to the game's (not its glints)
  const GLINT_GLSL = `
// (a hash that stays random for big inputs: Dave Hoskins' hash12)
float glintHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// How bright the glint at art pixel (col, row) is now (0..1), at t seconds, if a share (dense) of its cell's chances
// flash; cells are cw art px wide, and a flash lights a dash 1 to cw px long somewhere in its cell
float glintAt(float col, float row, float t, float dense, float cw) {
  vec2 cell = vec2(floor(col / cw), row);
  float h0 = glintHash(cell);
  float pace = t / (0.6 + 1.0 * h0) + h0 * 17.0; // this cell's chances: 0.6 to 1.6 s apart, out of step with its neighbours'
  float n = floor(pace);
  vec2 cn = cell + vec2(n * 7.31, n * 3.17);
  if (glintHash(cn) > dense) return 0.0; // this chance passes it by
  float len = 1.0 + floor(glintHash(cn + vec2(5.2, 1.7)) * cw * 0.999);
  float off = floor(glintHash(cn + vec2(2.9, 8.3)) * (cw - len + 0.999));
  float x = col - cell.x * cw;
  if (x < off || x >= off + len) return 0.0;
  float at = 0.15 + 0.7 * glintHash(cell.yx + vec2(n * 1.93, 41.0)); // when in this chance it flashes
  float k = clamp(1.0 - abs(fract(pace) - at) / 0.07, 0.0, 1.0);
  float hb = glintHash(cn + vec2(13.1, 3.3));
  return k * k * (0.3 + 0.7 * hb * hb * hb); // mostly dim, now and then bright
}
`;

  // ---------- The sea behind ----------
  // Behind the waves you sail on, the sea goes on to the horizon in rows of smaller and smaller waves. The horizon
  // (where the painted land and the sky meet the sea) sits HORIZON art px above the waterline. Each row of the far
  // sea is drawn as the game draws its own water's surface (its strip: the dark edge, the bright rows under it), with
  // its own waves; the further a row, the closer it sits to the horizon and the smaller its waves (r: its size, as a
  // share of the near sea's), the more it fades into the sky's colour, and the slower it slides past as the boat
  // sails or the camera pans (p: 1 would move with the water, the painted land behind moves at under half), and the
  // fainter the dark edge along its top (edge: how much of it shows), so the far rows don't stack up in stripes. Nearer
  // rows hide the ones behind; a trough in the near waves shows them, and no longer the land.
  const HORIZON = 14;
  const FAR = [
    { r: 0.6, p: 0.86, haze: 0.12, edge: 0.7 },
    { r: 0.4, p: 0.76, haze: 0.22, edge: 0.45 },
    { r: 0.26, p: 0.67, haze: 0.32, edge: 0.3 },
    { r: 0.16, p: 0.59, haze: 0.42, edge: 0.18 },
    { r: 0.09, p: 0.52, haze: 0.52, edge: 0.1 },
  ];
  // The far sea's waves: four lengths (world units, shorter in a storm), each row with its own phases. Their heights
  // add up to the near sea's rms height (SIGMA * size), times each row's r.
  const FAR_LENGTHS = [520, 330, 210, 135];
  const FAR_REFLECT = 0.55; // how strongly a far row reflects the land and sky, just under its surface
  const FAR_STILL_REFLECT = 0.9; // and still water, all the way down
  const FAR_MARK = 254 / 255; // the far sea's alpha (see farFilter)
  const FAR_WEIGHTS = (() => {
    const w = [1, 0.8, 0.55, 0.4];
    const rms = Math.sqrt(w.reduce((a, v) => a + v * v, 0) / 2);
    return w.map((v) => v / rms);
  })();
  const FAR_PHASES = (() => {
    let seed = 7741;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    return FAR.map(() => [0, 1, 2, 3].map(() => (rand() * TAU).toFixed(3)));
  })();
  // The top rows of the game's water picture (the strip it tiles along the surface), read once: the far rows wear it
  const STRIP_H = 23;
  let strip = null; // { w, data }
  try {
    const img = await createImageBitmap(await fetch(new URL(SCENE.water, location.origin)).then((r) => r.blob()));
    const cx = new OffscreenCanvas(img.width, STRIP_H).getContext('2d');
    cx.drawImage(img, 0, 0);
    strip = { w: img.width, data: new Uint8Array(cx.getImageData(0, 0, img.width, STRIP_H).data.buffer) };
  } catch (e) {
    console.warn('[waves] Could not read the water’s picture: the far sea is drawn plainer', e);
  }
  if (!strip) {
    // Near enough the game's: clear, its dark edge, bright rows, then the water
    const rows = [[0, 0, 0, 0], [0, 0, 0, 0], [43, 31, 38, 255], ...Array(4).fill([150, 233, 250, 255]), ...Array(5).fill([104, 178, 216, 255]), ...Array(11).fill([92, 145, 207, 255])];
    strip = { w: 1, data: new Uint8Array(rows.flat()) };
  }
  const stripSource = new BufferImageSource({
    resource: strip.data,
    width: strip.w,
    height: STRIP_H,
    format: 'rgba8unorm',
    alphaMode: 'no-premultiply-alpha',
    scaleMode: 'nearest',
    autoGenerateMipmaps: false,
  });
  // The far waves, and where the far sea's top is in a column (both need uView and PX declared first)
  const FAR_TOP_GLSL = `
uniform vec4 uFar;   // the horizon (screen px), the near sea's rms height (art px), the time (s), how much higher crests rise than troughs sink
uniform vec4 uFarK;  // the far waves' wavenumbers (per world unit)
uniform vec4 uFarW;  // and how fast they turn (radians a second)
uniform vec4 uFarA;  // and their heights (art px, as the near sea's)
float farWave(float u, vec4 ph, float r) {
  float h = dot(uFarA, cos(uFarK * u + uFarW * uFar.z + ph)) * r;
  float sg = max(uFar.y * r, 0.001);
  float z = clamp(h / sg, -0.5 / max(uFar.w, 0.01), 2.5);
  return h + uFar.w * sg * (z * z - 1.0); // crests up, troughs flatter, like the near sea
}
// The top of the far sea at screen x (screen px): the highest of its rows' tops there
float farTop(float gx) {
  float art = PX * uView.y;
  float mid = (floor((gx - uView.x) / art) + 0.5) * art;
  float top = uFar.x;
${FAR.map((f, i) => `  top = min(top, uFar.x + floor(${(HORIZON * f.r).toFixed(3)} - farWave((mid + ${(1 - f.p).toFixed(3)} * uView.x) / (uView.y * ${f.p.toFixed(3)}) + uView.z, vec4(${FAR_PHASES[i].join(', ')}), ${f.r.toFixed(3)}) + 0.5) * art);`).join('\n')}
  return top;
}
`;
  const FAR_GLSL = `${FAR_TOP_GLSL}
uniform vec3 uTint;  // the water's tint (the game draws its strip with it)
uniform vec3 uSky;   // the sky's colour low down, which the far rows fade into
uniform float uFarEdge; // how much of the rows' dark edges shows (none on still water: it would rule it in lines)
uniform sampler2D uStrip;
uniform vec4 uLightAt; // the light's x on screen (px), how strong its path is, its colour's (r, g)
uniform float uLightB;  // and blue
uniform vec2 uGlint;    // how rough the sea is 0..1, how wide the light's path is (1 with the light well up, less low)
uniform sampler2D uTexture; // the background (sky, painted land): the far rows reflect it
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
// Art row d of a far row's water (0: its surface), at u along it
vec4 stripAt(float col, float row) { return texture(uStrip, vec2((col + 0.5) / ${strip.w}.0, (row + 0.5) / ${STRIP_H}.0)); }
// Under its dark edge a row reflects what stands above the horizon (land, sky): art row d below its surface shows
// the background d art px above the horizon, strongest at the top and fading with depth, wavering a pixel sideways
${GLINT_GLSL}
vec4 farRow(float d, float u, float haze, float edge, vec2 g, float r) {
  float row = min(2.0 + d, ${STRIP_H - 1}.0); // (the strip's first two rows are above the water)
  float col = mod(floor((u + 6.0 * uFar.z) / PX), ${strip.w}.0); // (the game slides its strip 6 world units a second)
  vec4 s = stripAt(col, row);
  if (d < 0.5) s = mix(stripAt(col, 3.0), s, edge * uFarEdge); // its dark edge, fainter the further off
  vec3 c = s.rgb * uTint;
  // Calm water (as the rows' edges fade out) is a mirror: the far sea as a whole shows what stands above the horizon,
  // as far above it as the pixel is below, much as the near water does, and hazes less (the land it mirrors is
  // already as hazy as it's painted)
  float calm = 1.0 - uFarEdge;
  if (d > 0.5 || calm > 0.0) {
    float art = PX * uView.y;
    float wob = floor(sin(d * 1.9 + uFar.z * 1.7 + u * 0.013) * mix(1.4, 0.6, calm) + 0.5) * art;
    float up = mix(d - 0.5, floor((g.y - uFar.x) / art) + 0.5, calm); // how far above the horizon (art px)
    vec2 at = (vec2(g.x + wob, uFar.x - max(up, 0.5) * art) - uOutputFrame.xy) * uInputSize.zw;
    vec4 b = texture(uTexture, clamp(at, uInputClamp.xy, uInputClamp.zw));
    float k = mix(d > 0.5 ? ${FAR_REFLECT.toFixed(2)} * exp(-(d - 1.0) / 5.0) : 0.0, ${FAR_STILL_REFLECT.toFixed(2)}, calm);
    c = mix(c, b.rgb, k * b.a);
  }
  c = mix(c, uSky, haze * (1.0 - 0.75 * calm));
  // The light's path: toward the horizon so thick with glints it's nearly a solid column, here a soft glow under the
  // light in a lane narrower the further off the row is (narrower than the near water's), with 1 art px glints
  // flashing in it; on a rough sea, on the row's lit crest more than down its back
  if (uLightAt.y > 0.0 && d > 0.5) {
    float lane = exp(-abs(g.x - uLightAt.x) / ((10.0 + 25.0 * r) * uGlint.y));
    float swell = mix(1.0, 1.8 * exp(-(d - 1.0) / 1.5), uGlint.x);
    c += vec3(uLightAt.zw, uLightB) * uLightAt.y * lane * min(1.0, swell) * 0.16;
    float gl = uLightAt.y * glintAt(floor((g.x - uView.x) / (PX * uView.y)) + floor(uView.z / PX), d * 7.0 + r * 113.0, uFar.z, ${GLINT} * 2.5 * lane * swell, 1.0);
    c = mix(c, vec3(uLightAt.zw, uLightB) * 1.05, clamp(gl * ${GLINT_BRIGHT}, 0.0, 1.0));
  }
  return vec4(c * s.a, s.a);
}
// The far sea at screen pixel g: the nearest row whose water it is in, or clear above them all. The furthest row
// reaches up to the horizon at least, so nothing behind it (the painted scene's own water line, say) shows below the
// horizon, where the near water would mirror it as a line across the water
vec4 farSea(vec2 g) {
  float art = PX * uView.y;
  float mid = (floor((g.x - uView.x) / art) + 0.5) * art; // the middle of this art column, from the scene's left edge
${FAR.map((f, i) => `  {
    float u = (mid + ${(1 - f.p).toFixed(3)} * uView.x) / (uView.y * ${f.p.toFixed(3)}) + uView.z; // along this row (it slides ${f.p} as fast)
    float top = uFar.x + floor(${(HORIZON * f.r).toFixed(3)} - farWave(u, vec4(${FAR_PHASES[i].join(', ')}), ${f.r.toFixed(3)}) + 0.5) * art;${i === FAR.length - 1 ? '\n    top = min(top, uFar.x);' : ''}
    if (g.y >= top) return farRow(floor((g.y - top) / art), u, ${f.haze.toFixed(3)}, ${f.edge.toFixed(3)}, g, ${f.r.toFixed(3)});
  }`).join('\n')}
  return vec4(0.0);
}
`;

  const WAVE_GLSL = `
uniform vec4 uView;   // the camera's x (screen px), zoom, how far the water has slid (world units), the waterline (screen px)
uniform vec4 uSurfAt; // the first art column in uSurf, its width, the wave caps 0..1, how stormy 0..1
uniform float uTick;  // changes twice a second (the foam's speckle)
uniform sampler2D uSurf;
const float PX = ${PX.toFixed(1)};
float colOf(float sx) { return floor((sx - uView.x) / uView.y / PX); } // the art column under screen x
vec4 surfAt(float sx) {
  float i = clamp(colOf(sx) - uSurfAt.x, 0.0, uSurfAt.y - 1.0);
  return texture(uSurf, vec2((i + 0.5) / ${TEX_W}.0, 0.5));
}
float columnArt(float sx) { return floor(surfAt(sx).r * 255.0 + 0.5) - 128.0; } // the surface there (art px, up positive)
`;

  // Wave caps and foam (from the surface texture): 1 where screen pixel g is foam, else 0 (whatever the caps' fade)
  const CAPS_GLSL = `
float capHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float capAt(vec2 g) {
  if (uSurfAt.z <= 0.0) return 0.0;
  vec4 s = surfAt(g.x);
  float art = PX * uView.y;
  float h = floor(s.r * 255.0 + 0.5) - 128.0;
  float row = floor((g.y - (uView.w - h * art)) / art); // 0: the surface's top row
  if (row < -1.0) return 0.0;
  if (row < 0.0) return s.a > 0.5 ? 1.0 : 0.0;
  float solid = floor(s.g * 255.0 + 0.5);
  if (row < solid) return 1.0;
  if (row < solid + 2.0 && s.b > 0.0) {
    float n = capHash(vec2(floor(colOf(g.x) + uView.z / PX), row * 13.0 + uTick));
    return n < s.b * (row < solid + 1.0 ? 0.75 : 0.3) ? 1.0 : 0.0;
  }
  return 0.0;
}
`;

  // Pixi's standard filter vertex shader (as postfx.js has it)
  const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;

  // The water layer: each art-pixel column moves up or down with its wave, less with depth, and in the Open Ocean the
  // tall crests wear small white caps
  const WATER = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uDepth; // screen px
${WAVE_GLSL}
${CAPS_GLSL}
void main(void) {
  vec2 g = vTextureCoord * uInputSize.xy + uOutputFrame.xy; // screen px in the scene's picture
  float art = PX * uView.y; // screen px per art pixel
  float h = columnArt(g.x);
  float below = g.y - uView.w;
  float f = below <= 0.0 ? 1.0 : exp(-below / uDepth);
  float shift = floor(h * f + 0.5) * art; // whole art pixels, so nothing blurs
  vec2 src = vTextureCoord + vec2(0.0, shift) * uInputSize.zw;
  vec4 c = src.y < 0.0 ? vec4(0.0) : texture(uTexture, vec2(src.x, min(src.y, uInputClamp.w)));
  // Wave caps and foam (CAPS_GLSL), fading in and out with uSurfAt.z
  if (uSurfAt.z > 0.0 && capAt(g) > 0.0) {
    bool spray = g.y < uView.w - h * art;
    c = spray ? vec4(vec3(0.9 * uSurfAt.z), 0.9 * uSurfAt.z) : vec4(mix(c.rgb, vec3(c.a), uSurfAt.z), c.a);
  }
  finalColor = c;
}
`;

  // The game's reflection (postfx.js REFLECT), mirrored about the moving surface instead of the straight waterline.
  // Everything else is as the game has it.
  const REFLECT = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec2 uDimensions;
uniform float uBoundary;
uniform float uTime;
uniform vec3 uWater;
uniform vec2 uLight;
uniform float uPath;
uniform float uScroll;
uniform vec3 uPathColor;
uniform float uBand; // screen px under the surface where the reflection fades in, so the crests' own water shows
uniform vec2 uGlint; // how rough the sea is 0..1, how wide the light's path is (1 with the light well up, less low)
uniform vec4 uFogAt; // screen px to the fog's picture (x, y), how thick the fog is 0..1 (none: 0)
uniform sampler2D uFog; // the fog banks' cover (alpha)
uniform vec4 uSpotAt; // screen px to the fishing spots' picture (x, y), any drawn: 1 (none: 0), any spotlights: 1 (none: 0)
uniform sampler2D uSpot; // the fishing spots' cover (alpha)
uniform mat4 uSpotP; // the spotlights, a column each: middle (screen px), reach (screen px), how bright 0..1 (off: 0)
uniform mat4 uSpotC; // and their colours
${WAVE_GLSL}
${FAR_TOP_GLSL}
${GLINT_GLSL}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 picA(vec2 c) { return texture(uTexture, clamp(c, vec2(0.0), vec2(1.0)) * uDimensions / uInputSize.xy); }
vec3 pic(vec2 c) { return picA(c).rgb; }
void main(void) {
  vec2 coord = vTextureCoord * uInputSize.xy / uDimensions;
  vec2 px = coord * uDimensions;
  float boundary = uBoundary - columnArt(px.x) * PX * uView.y / uDimensions.y; // the surface in this column
  if (coord.y < boundary) {
    finalColor = vec4(0.0);
    return;
  }
  float d = clamp((coord.y - boundary) / max(0.0001, 1.0 - boundary), 0.0, 1.0);
  float amp = 0.6 + 7.0 * d;
  float dx = (sin(px.y * 0.11 + uTime * 1.6) + 0.5 * sin(px.y * 0.27 - uTime * 2.3)) * amp * 0.45;
  dx += (noise(vec2((px.x + uScroll) * 0.03, px.y * 0.09 + uTime * 0.5)) - 0.5) * amp * 1.2;
  // Over a spot the water is warmer, and stirs: the reflection wavers more there, quick and fine
  if (uSpotAt.w > 0.0) {
    float dn = (coord.y - boundary) * uDimensions.y;
    float warm = 0.0;
    for (int i = 0; i < ${MAX_SPOTS}; i++) {
      vec4 s = uSpotP[i];
      if (s.z <= 0.0) continue;
      float ry = min(${SPOT_DEPTH.toFixed(2)} * s.y, 0.8 * (1.0 - boundary) * uDimensions.y);
      warm = max(warm, (1.0 - smoothstep(0.6, 1.0, length(vec2((px.x - s.x) / s.y, dn / ry)))) * min(1.0, 1.3 * s.z));
    }
    dx += warm * ${SPOT_WAVER.toFixed(1)} * (0.6 * sin(px.y * 0.45 - uTime * 3.3 + 0.8 * sin(px.x * 0.03 + uTime)) + noise(vec2((px.x + uScroll) * 0.05, px.y * 0.2 - uTime * 2.2)) - 0.5);
  }
  vec2 src = vec2(coord.x + dx / uDimensions.x, 2.0 * boundary - coord.y);
  // Things near (boats, the shore, the fisher) are mirrored about the surface, as above. The background (marked by
  // its alpha: sky, the land behind, the far sea) is far off, so it's mirrored about the horizon instead, as the far
  // rows mirror it: the far sea and this water show it as one reflection, with no seam where they meet. Where
  // something near stands over the background there, the background as mirrored about the surface stays.
  // The far sea itself isn't reflected: the reflection (and its blur) stays above the far sea's top, its crests too.
  // (a pixel half background, half something near, as the picture is sampled between them, counts as background)
  float art = ${PX.toFixed(1)} * uView.y / uDimensions.y; // an art px, as a share of the height
  float hz = uBoundary - ${HORIZON}.0 * art; // the horizon
  float lim = 2.0;
  if (picA(src).a < ${(1 - 0.03 / 255).toFixed(6)}) {
    vec2 far = vec2(src.x, 2.0 * hz - coord.y);
    // Something small and near standing high over the horizon there (a buoy's flag on its pole): the sky just beside
    // it or over it instead, as it would be without it. (Else the row at the horizon showed through in its shape, a
    // ghost of it in the water, bright at night where a lamp lights that row.) Something as tall as a boat stays.
    if (picA(far).a >= ${(1 - 0.03 / 255).toFixed(6)}) {
      vec2 across = vec2(art * uDimensions.y / uDimensions.x, 0.0); // an art px across
      vec2 sky = vec2(-1.0);
      for (int k = 1; k <= 2; k++) {
        if (sky.x < 0.0 && picA(far - float(k) * across).a < ${(1 - 0.03 / 255).toFixed(6)}) sky = far - float(k) * across;
        if (sky.x < 0.0 && picA(far + float(k) * across).a < ${(1 - 0.03 / 255).toFixed(6)}) sky = far + float(k) * across;
      }
      for (int k = 1; k <= 14; k++) {
        if (sky.x < 0.0 && picA(far - vec2(0.0, float(k) * art)).a < ${(1 - 0.03 / 255).toFixed(6)}) sky = far - vec2(0.0, float(k) * art);
      }
      if (sky.x >= 0.0) far = sky;
    }
    if (picA(far).a < ${(1 - 0.03 / 255).toFixed(6)}) src = far;
    lim = min(farTop(src.x * uDimensions.x) / uDimensions.y, hz) - 0.5 * art;
    src.y = min(src.y, lim);
  }
  float r = (0.4 + 4.5 * d) / uDimensions.y;
  vec3 col = pic(vec2(src.x, min(src.y, lim))) * 2.0;
  col += pic(vec2(src.x, min(src.y + r, lim))) + pic(vec2(src.x, min(src.y - r, lim)));
  col += pic(vec2(src.x, min(src.y + 2.0 * r, lim))) * 0.7 + pic(vec2(src.x, min(src.y - 2.0 * r, lim))) * 0.7;
  col += (pic(vec2(src.x + r * 1.6 * uDimensions.y / uDimensions.x, min(src.y, lim))) + pic(vec2(src.x - r * 1.6 * uDimensions.y / uDimensions.x, min(src.y, lim)))) * 0.8;
  col /= 7.6;
  col = mix(col, uWater * 0.55, 0.18 + 0.4 * d);
  col *= 0.95 - 0.25 * d;
  float a = mix(0.88, 0.14, smoothstep(0.0, 0.9, d));
  float width = (26.0 + 240.0 * d) * uGlint.y;
  float core = exp(-abs(px.x - uLight.x) / width);
  float sparkle = smoothstep(0.5, 0.92, noise(vec2((px.x + uScroll) * 0.09, px.y * 0.16 - uTime * 1.7)) * 0.7 + 0.3 * noise(vec2((px.x + uScroll) * 0.2 + uTime * 0.7, px.y * 0.35))); // (it shimmers about twice as fast as the game's)
  // On a rough sea the light lies in bands on the swells' faces, rolling in toward you (down the screen), closer
  // together toward the horizon, with dark troughs between
  float artPx = ${PX.toFixed(1)} * uView.y;
  float under = (coord.y - boundary) * uDimensions.y / artPx; // art px under the surface here
  float wx = (px.x - uView.x) / artPx + uView.z / ${PX.toFixed(1)}; // the water's own column
  float ph = 2.4 * sqrt(under + 0.5) - uTime * 1.1 + 0.7 * sin(wx * 0.045 + under * 0.05) + 0.5 * sin(wx * 0.11 - uTime * 0.4);
  float lit = smoothstep(-0.3, 0.7, sin(ph));
  float path = ${NEAR_PATH.toFixed(2)} * uPath * core * (0.12 + 0.88 * sparkle) * mix(1.0, 0.3 + 1.0 * lit, uGlint.x) * (1.0 - 0.35 * d);
  col += uPathColor * path;
  a = clamp(max(a, path), 0.0, 1.0);
  if (uBand > 0.0) a *= smoothstep(0.0, uBand, (coord.y - boundary) * uDimensions.y);
  // Glints in the light's path (GLINT_GLSL): thickest and brightest just under the surface (toward the horizon),
  // where its lane is narrow and the dashes short, thinning out, spreading wider and the dashes longer nearer you;
  // they ride up and down with the surface, and on a rough sea gather on the swells' lit faces
  if (uPath > 0.0) {
    float row = floor(under); // art rows under the surface here
    float wcol = floor(wx + 0.5);
    float lane = exp(-abs(px.x - uLight.x) / ((30.0 + 200.0 * d) * uGlint.y));
    float cw = 2.0 + floor(2.99 * d); // cells (the longest dash): 2 art px just under the surface, 4 nearest you
    float swell = mix(1.0, 1.8 * lit, uGlint.x);
    float gl = uPath * glintAt(wcol, row, uTime, ${GLINT} * (1.2 - 0.7 * d) * lane * swell, cw) * (1.0 - 0.6 * d);
    col = mix(col, uPathColor * 1.1, clamp(gl * ${GLINT_BRIGHT}, 0.0, 1.0));
    a = max(a, gl * ${GLINT_BRIGHT});
  }
  // Fog in front of the water: the picture under the reflection (the fog over the water) shows through it
  if (uFogAt.z > 0.0) {
    vec2 fp = px * uFogAt.xy;
    vec2 fs = 12.0 * uFogAt.xy;
    float fog = texture(uFog, fp).a * 2.0 + texture(uFog, fp + vec2(fs.x, 0.0)).a + texture(uFog, fp - vec2(fs.x, 0.0)).a
      + texture(uFog, fp + vec2(0.0, fs.y)).a + texture(uFog, fp - vec2(0.0, fs.y)).a;
    a *= 1.0 - clamp(uFogAt.z * fog / 6.0, 0.0, 1.0);
  }
  // Fishing spots: the reflection thins over what marks a spot's kind (the fish, the whirlpool...), so it shows
  if (uSpotAt.z > 0.0) {
    vec2 sp = px * uSpotAt.xy;
    vec2 ss = ${PX.toFixed(1)} * uView.y * uSpotAt.xy; // an art px
    float spot = texture(uSpot, sp).a * 2.0 + texture(uSpot, sp + vec2(ss.x, 0.0)).a + texture(uSpot, sp - vec2(ss.x, 0.0)).a
      + texture(uSpot, sp + vec2(0.0, ss.y)).a + texture(uSpot, sp - vec2(0.0, ss.y)).a;
    a *= 1.0 - clamp(2.5 * spot / 6.0, 0.0, 0.9);
  }
  vec4 outc = vec4(col * a, a);
  // And each spot is lit as if by a round spotlight shone down from above: on the near water it lies as an oval
  // whose widest (as wide as the spot reaches) is at the surface line, its near half curving down toward you (the
  // far half would be beyond the waterline, so isn't seen). Just under the surface it rides the crests with it.
  // Everything in it is lit (the water, its reflection, the fish), with a brighter rim, a faint ripple of light
  // across it and glints, and its colour added so it shows at night as well.
  // (below the water's dark outline row at the surface: the spotlight starts under it, leaving it black)
  if (uSpotAt.w > 0.0 && under >= ${SPOT_UNDER.toFixed(1)}) {
    // Screen px under the surface here (by whole art px, as the art is): just under it, under the moving surface, so
    // the light rides up the crests with it; deeper, under the still waterline, as the deep water keeps still
    float still = (coord.y - uBoundary) * uDimensions.y / artPx;
    float down = (floor(mix(under, still, smoothstep(0.0, 10.0, under))) + 0.5) * artPx;
    float qx = uView.x + (floor((px.x - uView.x) / artPx) + 0.5) * artPx;
    float band = (1.0 - boundary) * uDimensions.y; // the near water's depth on screen
    vec3 mul = vec3(0.0);
    vec3 add = vec3(0.0);
    float shone = 0.0;
    for (int i = 0; i < ${MAX_SPOTS}; i++) {
      vec4 s = uSpotP[i];
      if (s.z <= 0.0) continue;
      float ry = min(${SPOT_DEPTH.toFixed(2)} * s.y, 0.8 * band); // how far it reaches down toward you, on screen
      float v = down / ry; // 0 at the surface (its middle: its widest), 1 at its near edge
      if (v > 1.25) continue;
      float e = length(vec2((qx - s.x) / s.y, v));
      // Its edge under the water ripples: pushed in and out by the ripples drifting across it, and broken up there
      // into short streaks of light along the water, as light on rippling water is, instead of a sharp outline
      // (at the surface line, its widest, it just ends)
      float wq = qx + uScroll; // (the ripples ride with the water)
      float rn = 0.65 * noise(vec2(wq * 0.02, down * 0.05 - uTime * 0.8)) + 0.35 * noise(vec2(wq * 0.06 + uTime * 0.4, down * 0.14));
      float edge = smoothstep(0.78, 1.06, e + (rn - 0.5) * 0.2); // 0 inside, 1 outside
      float streak = noise(vec2(wq * 0.05 - uTime * 0.3, floor(down / artPx) * 0.9 + uTime * 1.3));
      float m = 1.0 - clamp(edge + (streak - 0.5) * 1.6 * edge * (1.0 - edge), 0.0, 1.0);
      if (m <= 0.0) continue;
      float rim = 4.0 * edge * (1.0 - edge) * m; // (a little brighter where it breaks up)
      float rip = noise(vec2(wq * 0.04, down * 0.1 - uTime * 0.6));
      float gl = glintAt(floor(wx + 0.5), floor(under) + 57.0, uTime, 0.1 * m, 2.0);
      vec3 c = uSpotC[i].rgb;
      mul += c * ${SPOT_LIGHT.toFixed(2)} * m * s.z;
      add += c * (m * (0.045 + 0.05 * rip) + 0.08 * rim + 0.35 * gl) * s.z;
      shone = max(shone, m * s.z);
    }
    if (shone > 0.0) outc = vec4((outc.rgb + pic(coord) * (1.0 - outc.a)) * (1.0 + mul) + add, 1.0);
  }
  finalColor = outc;
}
`;

  // A hull (and an oar) in the water: below the surface in its column it sinks into the water's colour and
  // fades, more the deeper it goes, with a pale line where the surface crosses it
  const HULL = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec3 uWater;
${WAVE_GLSL}
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 g = vTextureCoord * uInputSize.xy + uOutputFrame.xy; // screen px in the scene's picture
  float art = PX * uView.y;
  float under = g.y - (uView.w - columnArt(g.x) * art); // screen px below the surface in this column
  if (under >= 0.0 && c.a > 0.0) {
    float k = clamp(under / (6.0 * art), 0.0, 1.0);
    c.rgb = mix(c.rgb, uWater * c.a, 0.45 + 0.35 * k);
    if (under < art) c.rgb = mix(c.rgb, vec3(0.85, 0.93, 1.0) * c.a, 0.35);
    c *= mix(0.8, 0.3, k);
  }
  finalColor = c;
}
`;

  const waveUniforms = () => ({
    uView: { value: new Float32Array([0, ZOOM, 0, 0]), type: 'vec4<f32>' },
    uSurfAt: { value: new Float32Array([0, TEX_W, 0, 0]), type: 'vec4<f32>' },
    uTick: { value: 0, type: 'f32' },
  });
  const waterFilter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: WATER, name: 'waves-water' }),
    resources: {
      waveWater: { ...waveUniforms(), uDepth: { value: DEPTH * PX * ZOOM, type: 'f32' } },
      ...surfResources(),
    },
    padding: Math.ceil((PEAK + 2) * PX * ZOOM), // room above the layer for the crests
  });
  const reflectFilter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: REFLECT, name: 'waves-reflect' }),
    resources: {
      waveReflect: {
        ...waveUniforms(),
        uDimensions: { value: new Float32Array(2), type: 'vec2<f32>' },
        uBoundary: { value: 0.7, type: 'f32' },
        uTime: { value: 0, type: 'f32' },
        uWater: { value: new Float32Array([0.12, 0.4, 0.5]), type: 'vec3<f32>' },
        uLight: { value: new Float32Array(2), type: 'vec2<f32>' },
        uPath: { value: 0, type: 'f32' },
        uScroll: { value: 0, type: 'f32' },
        uPathColor: { value: new Float32Array([1, 0.92, 0.75]), type: 'vec3<f32>' },
        uBand: { value: 0, type: 'f32' },
        uGlint: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
        uFar: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFarK: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFarW: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFarA: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFogAt: { value: new Float32Array(4), type: 'vec4<f32>' },
        uSpotAt: { value: new Float32Array(4), type: 'vec4<f32>' },
        uSpotP: { value: new Float32Array(16), type: 'mat4x4<f32>' },
        uSpotC: { value: new Float32Array(16), type: 'mat4x4<f32>' },
      },
      ...surfResources(),
      ...fogResources(),
      ...spotResources(),
    },
  });
  // The game's light and haze shader (postfx.js SHAFTS), knowing where the moving surface is. It hazes the picture
  // differently above and below the waterline, so with a straight horizon a crest rising above it gets the sky's
  // haze, which shows as a straight line across the waves (most in a storm, which is the haziest). Its source is
  // read from the game's own file, so it stays the game's; if the game changes it so that this no longer fits, its own
  // runs instead. (Its filter is made on the first frame, to share the game's uniforms.)
  // It also lifts the wave caps back toward white after its haze and mist (in a storm the haze, the storm's fog and
  // its darkness all dim them to the grey of the sky): toward the haze's own brightness, so at night they stay dim.
  // Boats sit in front of the water, so their boxes (uOccA/B, up to 8: yours first) are left alone.
  const OCC_GLSL = `
uniform mat4 uOccA; // boats in front of the water, each column (x0, y0, x1, y1) in screen px
uniform mat4 uOccB;
bool inBox(vec4 b, vec2 p) { return p.x >= b.x && p.x < b.z && p.y >= b.y && p.y < b.w; }
bool occluded(vec2 p) {
  for (int i = 0; i < 4; i++) if (inBox(uOccA[i], p) || inBox(uOccB[i], p)) return true;
  return false;
}
uniform mat4 uFlags; // the buoys' flags, each column (x0, y0, x1, y1) in screen px (none: all 0)
bool onFlag(vec2 p) {
  for (int i = 0; i < 4; i++) if (inBox(uFlags[i], p)) return true;
  return false;
}
`;
  // The game's rim light (warm light on the tops of ridges and trees, strongest with the sun low) lights a dark pixel
  // above the horizon with a bright one just over it: on a flag, its dark text and icon under the bright cloth, and
  // the row under the cloth, which washed them out in the sun's rose or orange. Not on the flags (FLAG_INK stays dark).
  const NO_RIM = `
  if (onFlag(p) || onFlag(p - vec2(0.0, 3.0 * uInputSize.w * uInputSize.y))) rim = 0.0;`;
  const LIFT = `
  if (uSurfAt.z > 0.0 && capAt(p) > 0.0 && !occluded(p)) {
    vec3 foamLit = vec3(0.96) * clamp(max(uHazeColor.r, max(uHazeColor.g, uHazeColor.b)) / 0.8, 0.35, 1.0);
    c = mix(c, foamLit, uSurfAt.z * clamp(hz + 0.55 * uSurfAt.w, 0.0, 0.85));
  }`;
  let shaftSource = null;
  try {
    const file = await fetch(new URL('/src/postfx.js', location.origin)).then((r) => r.text());
    const body = file.match(/const SHAFTS = `([\s\S]*?)`;/)?.[1] ?? '';
    const at = body.indexOf('void main(void) {');
    const P = 'vec2 p = coord * uDimensions;';
    if (at > 0 && !body.includes('${') && body.slice(0, at).includes('float hash(vec2 p)') && body.slice(at).includes(P) && body.slice(at).includes('uHorizon')) {
      const head = body.slice(0, at).replace('float hash(vec2 p)', `${WAVE_GLSL}${FAR_TOP_GLSL}${CAPS_GLSL}${OCC_GLSL}\nfloat hash(vec2 p)`);
      // Above the water or in it: by the top of the water in this column (wtop: the near surface, or the far sea's
      // above it), so the far sea is hazed as water, as the near water is, not as land (else the haze steps where
      // they meet, and the far sea's reflection doesn't run on into the near water's). The light's path on the water
      // keeps to the near water (hzn). How far from the horizon (which the haze and mist fade with): from the straight
      // horizon still, as the game has it, so a tall crest doesn't lift the haze in its column all the way up the sky,
      // which shows as a pale stripe over it.
      // Only the background is hazed as water down from the far sea's top: what stands in front of it (boats, anglers,
      // the Pond's shore) is hazed as the game hazes it, as above the water down to the near surface. Else the far sea's
      // top cuts across each angler, hazed less below it than above, as if they were see-through. The background's
      // pixels are the ones marked by their alpha (FAR_MARK, kept this far: the ripple leaves the picture above the
      // water as it is, and the reflection draws nothing there).
      let main = body.slice(at);
      const SIDE = '(dy < 0.0 ? 1.0 : 0.55)';
      const PIC = 'vec4 color = texture(uTexture, vTextureCoord);';
      main = main.includes(SIDE)
        ? main.replace(SIDE, '(coord.y < wtop ? 1.0 : 0.55)').replace(/coord\.y < uHorizon/g, 'coord.y < wtop').replace(/coord\.y > uHorizon/g, 'coord.y > hzn')
        : main.replace(/uHorizon/g, 'hzn');
      const top = main.indexOf(PIC) >= 0 && main.indexOf(PIC) < main.indexOf(P)
        ? `color.a < ${(1 - 0.03 / 255).toFixed(6)} ? min(hzn, farTop(p.x) / uDimensions.y) : hzn`
        : 'min(hzn, farTop(p.x) / uDimensions.y)';
      if (!top.startsWith('color')) console.warn('[waves] The game’s light shader has changed: the far sea’s top may show across the anglers in haze');
      main = main.replace(P, `${P}\n  float hzn = uHorizon - columnArt(p.x) * PX * uView.y / uDimensions.y; // the surface in this column\n  float wtop = ${top}; // the top of the water here: the far sea's, behind what stands in front`);
      // After the mist (or else the haze), where `hz` is the haze's strength here
      const after = [/\n  c = mix\(c, mistColor,[^\n]*\n/, /\n  c = mix\(c, uHazeColor,[^\n]*\n/].find((re) => re.test(main));
      const RIM = /\n  float rim = [^\n]*\n/;
      if (RIM.test(main)) main = main.replace(RIM, (m) => `${m.slice(0, -1)}${NO_RIM}\n`);
      else console.warn('[waves] The game’s light shader has changed: the rim light may wash out the buoys’ flags');
      if (after && /float hz = /.test(main)) main = main.replace(after, (m) => `${m.slice(0, -1)}${LIFT}\n`);
      else console.warn('[waves] The game’s light shader has changed: the wave caps may look dim in haze');
      shaftSource = head + main;
    } else console.warn('[waves] The game’s light shader has changed: a straight line may show across the crests in haze');
  } catch (e) {
    console.warn('[waves] Could not read the game’s light shader:', e);
  }
  let shaftFilter = null;
  let su = null; // its wave uniforms
  const makeShafts = (post) => {
    const shared = post.shafts?.resources?.shaftUniforms;
    if (!shaftSource || !shared) return null;
    const f = new Filter({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: shaftSource, name: 'waves-shafts' }),
      resources: {
        shaftUniforms: shared,
        waveShafts: {
          ...waveUniforms(),
          uOccA: { value: new Float32Array(16), type: 'mat4x4<f32>' },
          uOccB: { value: new Float32Array(16), type: 'mat4x4<f32>' },
          uFlags: { value: new Float32Array(16), type: 'mat4x4<f32>' },
          uFar: { value: new Float32Array(4), type: 'vec4<f32>' },
          uFarK: { value: new Float32Array(4), type: 'vec4<f32>' },
          uFarW: { value: new Float32Array(4), type: 'vec4<f32>' },
          uFarA: { value: new Float32Array(4), type: 'vec4<f32>' },
        },
        ...surfResources(),
      },
    });
    f.apply = function (filterManager, input, output, clearMode) {
      shared.uniforms.uDimensions[0] = input.frame.width;
      shared.uniforms.uDimensions[1] = input.frame.height;
      filterManager.applyFilter(this, input, output, clearMode);
    };
    f.resolution = 'inherit';
    su = f.resources.waveShafts.uniforms;
    return f;
  };

  const hullFilter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: HULL, name: 'waves-hull' }),
    resources: { waveHull: { ...waveUniforms(), uWater: { value: new Float32Array([0.12, 0.4, 0.5]), type: 'vec3<f32>' } }, ...surfResources() },
  });
  // The far sea, drawn over the background (sky, painted land) and under everything in front of it: the near water,
  // the Pond's shore, boats. The background's pixels, far sea and all, are left the least bit transparent (alpha
  // 254/255, too little to see: nothing is drawn under the scene), which marks them, so the near water's reflection
  // can tell them from what is in front.
  const FAR_SEA = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform vec4 uView; // as the water's
const float PX = ${PX.toFixed(1)};
${FAR_GLSL}
void main(void) {
  vec2 g = vTextureCoord * uInputSize.xy + uOutputFrame.xy; // screen px in the scene's picture
  vec4 f = farSea(g);
  finalColor = (f.a > 0.0 ? f : texture(uTexture, vTextureCoord)) * ${FAR_MARK.toFixed(6)};
}
`;
  const farFilter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: FAR_SEA, name: 'waves-far' }),
    resources: {
      waveFar: {
        uView: { value: new Float32Array([0, ZOOM, 0, 0]), type: 'vec4<f32>' },
        uFar: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFarK: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFarW: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFarA: { value: new Float32Array(4), type: 'vec4<f32>' },
        uTint: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uSky: { value: new Float32Array([0.6, 0.8, 0.95]), type: 'vec3<f32>' },
        uFarEdge: { value: 0, type: 'f32' },
        uLightAt: { value: new Float32Array(4), type: 'vec4<f32>' },
        uLightB: { value: 0, type: 'f32' },
        uGlint: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
      },
      uStrip: stripSource,
      uStripSampler: stripSource.style,
    },
    padding: Math.ceil((DEEP + 4) * PX * ZOOM), // the background stops at the waterline: room below it for the troughs
  });
  farFilter.resolution = 'inherit';
  const fu = farFilter.resources.waveFar.uniforms;
  const hu = hullFilter.resources.waveHull.uniforms;
  const wu = waterFilter.resources.waveWater.uniforms;
  const ru = reflectFilter.resources.waveReflect.uniforms;
  reflectFilter.apply = function (filterManager, input, output, clearMode) {
    ru.uDimensions[0] = input.frame.width;
    ru.uDimensions[1] = input.frame.height;
    filterManager.applyFilter(this, input, output, clearMode);
  };
  for (const f of [waterFilter, reflectFilter, hullFilter]) f.resolution = 'inherit'; // the game's chunky render resolution

  // ---------- Each frame ----------
  let intensity = 0; // eased toward where you are
  let caps = 0; // the Open Ocean's wave caps, eased the same way
  let storm = 0; // how stormy the sea is, eased more slowly as a storm comes and goes
  let lastT = null;
  let water = 0; // how far the water has slid (world units), carried over the game's jumps at a border or a resize
  let lastScroll = null;
  let force = null;
  let frames = 0;
  const myBoat = {}; // your boat's float (floatArt)
  const myPitch = {}; // and its pitch (pitchArt, eased the same way)
  const mateBoats = new WeakMap(); // other players' boats' (their rig objects -> state)

  const proto = PostFx.prototype;
  const original = proto.render;

  // Take the waves off: the game's own layer and reflection, as it has them
  const calm = (post) => {
    const scene = post.scene;
    if (scene?.waterLayer?.filters?.includes(waterFilter)) scene.waterLayer.filters = null;
    if (scene?.bgLayer?.filters?.includes(farFilter)) scene.bgLayer.filters = null;
    if (post.mirror?.filters?.[0] === reflectFilter) post.mirror.filters = [post.reflect];
    if (shaftFilter && post.group?.filters?.[0] === shaftFilter) post.group.filters = [post.shafts];
    if (scene) for (const hull of hulls(scene)) if (hull.filters?.includes(hullFilter)) hull.filters = null;
    if (scene?.spotGlow) scene.spotGlow.renderable = true; // (and the spots' rings: the game draws them afresh each frame)
    spotHaze.visible = false;
    if (scene) drawBuoys(scene, () => 0); // (on the game's flat water)
    hideLampGlow();
    hideLanterns(); // (other boats as the game has them)
    if (mistSprite) mistSprite.visible = false;
  };
  // Your hull and oar, and other players'
  const hulls = (scene) => [scene.rowboat, scene.oar, ...[...(scene.mateRigs?.values() ?? [])].flatMap((r) => [r.boat, r.oar])].filter(Boolean);

  // A boat's hull for hullLift: its picture's left edge in the scene, whether it is mirrored (the rig turned round)
  const hullOf = (rig, hull, f, rise) => {
    const sx = rig.scale.x;
    const a = rig.x + sx * hull.x;
    const b = rig.x + sx * (hull.x + hull.width);
    return { x0: Math.min(a, b), f, rise, flip: sx < 0 };
  };
  // Pitch a hull and its oar (`parts`, in `rig`) so its right end, as seen, sits `rise` art px higher than its left:
  // about the middle of the hull at its waterline. Put back after the frame (`turned`). Returns a function that turns a
  // point in the scene the same way (for the lantern on its post).
  let turned = [];
  const pitch = (rig, hull, parts, rise) => {
    if (!rise || !hull) return (pt) => pt;
    const sx = Math.sign(rig.scale.x) || 1;
    const seen = -Math.atan2(rise * PX, hull.width); // as seen: up on the right is anticlockwise (y points down)
    const turn = seen * sx; // in the rig, which is mirrored when it faces left
    const px = hull.x + hull.width / 2;
    const py = hull.y + hull.height - SINK * PX;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    for (const o of parts) {
      if (!o) continue;
      turned.push([o, o.x, o.y, o.rotation]);
      const [dx, dy] = [o.x - px, o.y - py];
      o.position.set(px + dx * cos - dy * sin, py + dx * sin + dy * cos);
      o.rotation += turn;
    }
    const [wx, wy] = [rig.x + rig.scale.x * px, rig.y + py];
    const [c, sn] = [Math.cos(seen), Math.sin(seen)];
    return (pt) => ({ ...pt, x: wx + (pt.x - wx) * c - (pt.y - wy) * sn, y: wy + (pt.x - wx) * sn + (pt.y - wy) * c });
  };

  let lastPost = null; // the game's PostFx, so stopWaves can put its water back at once
  const render = function (p) {
    lastPost = this;
    const scene = this.scene;
    const L = scene?.L;
    if (scene && scene !== lookScene) seeAs(scene);
    if (scene && BUOYS) hookSpots(scene); // (a buoy at each spot)
    if (scene) hookLantern(scene); // (the bite and Frenzy gauges as lanterns)
    if (!L || !scene.zone) return original.call(this, p);
    const t = p.t ?? 0;
    const dt = lastT == null ? 0 : Math.min(0.25, Math.max(0, t - lastT));
    lastT = t;
    const scroll = scene.scrollPx ?? 0;
    if (lastScroll != null && Math.abs(scroll - lastScroll) < 200) water += scroll - lastScroll;
    lastScroll = scroll;

    const along = scene.zone.index + Math.min(1, Math.max(0, (scene.sea?.x ?? 0) / SEA.length));
    const target = force ?? profileAt(along) * (WEATHER[p.grade?.weather] ?? 1);
    intensity += (target - intensity) * Math.min(1, dt * 0.6); // a few seconds to grow or calm
    if (Math.abs(target - intensity) < 0.001) intensity = target;

    shadersOn = Boolean(p.on); // (the glitter: next frame)
    if (!p.on) {
      calm(this); // the game's shaders are off (Settings): its own flat water and boat
      return original.call(this, p);
    }

    // This frame's waves (none: the boats still sit in the water)
    const s = intensity >= 0.01 ? intensity : 0;
    // Wave caps: the Open Ocean's, fading in and out over a few seconds as you arrive or leave
    caps += ((scene.zone.id === 'ocean' && s ? 1 : 0) - caps) * Math.min(1, dt * 0.6);
    if (caps < 0.01) caps = 0;
    storm += ((p.grade?.weather === 'storm' ? 1 : 0) - storm) * Math.min(1, dt * 0.3);
    if (storm < 0.005) storm = 0;
    // The surface across the screen (and a few columns either side)
    const viewX = scene.view.position.x;
    const screenW = this.rt?.width || innerWidth;
    const col0 = Math.floor(-viewX / ZOOM / PX) - 4;
    seaFrame(t, s, storm, water, col0, Math.min(TEX_W, Math.ceil(screenW / ZOOM / PX) + 8));
    if (!shaftFilter && shaftSource) shaftFilter = makeShafts(this);
    fu.uView.set([viewX, ZOOM, water, L.waterYS]);
    for (const u of [wu, ru, hu, su].filter(Boolean)) {
      u.uView.set([viewX, ZOOM, water, L.waterYS]);
      u.uSurfAt.set([surf.col0, TEX_W, caps, storm]);
      u.uTick = Math.floor(t * 2) % 64;
    }
    ru.uBand = Math.min(1, s * 1.5) * 3 * PX * ZOOM; // up to 3 art px of the surface itself on the crests
    // The sea behind (in still water too: flat, out to the horizon)
    {
      const k = FAR_LENGTHS.map((len) => TAU / (len * (1 - 0.3 * storm)));
      fu.uFarK.set(k);
      fu.uFarW.set(k.map((kk) => kk * SPEED(TAU / kk)));
      fu.uFarA.set(FAR_WEIGHTS.map((v) => v * SIGMA * s));
      fu.uFar.set([L.waterYS - HORIZON * PX * ZOOM, SIGMA * s, t % 86400, mixed(SKEW, storm)]);
      for (const k of ['uFar', 'uFarK', 'uFarW', 'uFarA']) for (const u of [ru, su].filter(Boolean)) u[k].set(fu[k]); // (the reflection keeps off the far sea; the haze takes it as water)
      fu.uFarEdge = Math.min(1, s / 0.25);
      const rgb = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
      fu.uTint.set(rgb(scene.waterSurface?.tint ?? 0xffffff));
      fu.uSky.set(rgb(scene.zone.sky ?? 0x8fd3ff));
    }
    if (scene.bgLayer && !scene.bgLayer.filters?.includes(farFilter)) scene.bgLayer.filters = [farFilter];
    if (!s) {
      if (scene.waterLayer.filters?.includes(waterFilter)) scene.waterLayer.filters = null;
      if (shaftFilter && this.group?.filters?.[0] === shaftFilter) this.group.filters = [this.shafts];
    } else if (!scene.waterLayer.filters?.includes(waterFilter)) scene.waterLayer.filters = [waterFilter];
    const tint = scene.zone.water ?? 0x1f78b4;
    hu.uWater.set([((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255]);
    if (BOATS) for (const hull of hulls(scene)) if (!hull.filters?.includes(hullFilter)) hull.filters = [hullFilter];

    // Your boat (hull, angler, oar) sits SINK art px deep in the water under its hull; the bobber on the water under it
    const moved = [];
    const lift = (obj, dy) => {
      if (!dy || !obj) return;
      moved.push([obj, obj.y]);
      obj.y -= dy;
    };
    const bowX = scene.boatBowX ?? L.bowX;
    const boatLen = scene.rowboat?.width ?? 148;
    const docked = scene.docked?.();
    const myFloat = floatArt(myBoat, docked || !s ? 0 : hullArt(bowX - boatLen, bowX), dt);
    const myRise = floatArt(myPitch, docked || !s ? 0 : pitchArt(bowX - boatLen, bowX), dt, PITCH_S);
    const boat = (myFloat - SINK) * PX;
    hullsNow = scene.rowboat ? [hullOf(scene.rig, scene.rowboat, myFloat, myRise)] : [];
    lift(scene.rowboat, boat);
    if (!docked) lift(scene.angler, boat); // (moored, the angler is up on the walkway)
    lift(scene.oar, boat);
    const myTurn = pitch(scene.rig, scene.rowboat, [scene.rowboat, scene.oar], myRise);
    if (!docked) scene.placeName();
    // The lantern on its post at the stern (drawn next frame from where this says it is)
    const at = scene.atmo?.lanternAt;
    if (at && scene.atmo.lanternMode === 'post') scene.atmo.lanternAt = myTurn({ x: at.x, y: at.y - boat });
    // The horizon behind the water: the painted scenery (hills, islands, cloud banks) and the drawn backdrops stand
    // on the horizon, HORIZON art px above the waterline, with the far sea in front of them. Always, so it never
    // moves as the waves grow or calm. Sky paintings that start at the top of the screen stay put.
    for (const look of [scene, scene.ghost]) {
      for (const layer of look?.paintedSky?.children ?? []) if (layer.y > 0) lift(layer, HORIZON * PX);
      lift(look?.backdrop, HORIZON * PX);
    }
    // What pokes up out of the near water (a wreck's masts) is in the background layer: in front of the far sea for
    // this frame (the front of the layer behind the water, which is drawn the same way)
    const poked = [];
    for (const o of [scene.paintedPoke, scene.pokeMask]) {
      if (o?.parent !== scene.bgLayer || !scene.worldLayer) continue;
      poked.push([o, scene.bgLayer.getChildIndex(o)]);
      scene.worldLayer.addChildAt(o, poked.length - 1);
    }
    // Other players' boats, and their lanterns
    tidyLanterns(scene);
    mateLamps.length = 0;
    for (const r of scene.mateRigs?.values() ?? []) {
      if (!r.rig.visible || !r.boat) continue;
      const mid = r.rig.x + r.rig.scale.x * (r.boat.x + r.boat.width / 2);
      if (!mateBoats.has(r)) mateBoats.set(r, { float: {}, pitch: {} });
      const m = mateBoats.get(r);
      const [x0, x1] = [mid - r.boat.width / 2, mid + r.boat.width / 2];
      const f = floatArt(m.float, s ? hullArt(x0, x1) : 0, dt);
      const rise = floatArt(m.pitch, s ? pitchArt(x0, x1) : 0, dt, PITCH_S);
      const lantern = LANTERNS && scene.atmo ? mateLantern(scene, r) : null; // (where the hull is, before it pitches)
      lift(r.rig, (f - SINK) * PX);
      const turn = pitch(r.rig, r.boat, [r.boat, r.oar, lantern?.g], rise);
      if (lantern) mateLamps.push(turn({ x: r.rig.x + r.rig.scale.x * lantern.at.x, y: r.rig.y + lantern.at.y }));
      if (hullsNow.length < 4) hullsNow.push(hullOf(r.rig, r.boat, f, rise));
    }
    if (!hullUp) hullsNow = [];

    // The surface as drawn: each column's wave in whole art px, raised to any hull over it; and the foam
    {
      const { col0: c0, n, raw, fold, col, sigma } = surf;
      const tick = Math.floor(t * 2);
      const shift = Math.floor(water / PX + 0.5); // the water's own column = the scene's column + this
      // The tallest crests (the highest for 4 columns either side) wear a cap 5 columns wide
      if (caps > 0 && sigma > 0) {
        for (let j = 0; j < n; j++) {
          if (raw[j] <= 2.2 * sigma) continue;
          let top = true;
          for (let k = 1; k <= 4 && top; k++) top = raw[j] >= (raw[j - k] ?? -Infinity) && raw[j] >= (raw[j + k] ?? -Infinity);
          if (top) for (let k = Math.max(0, j - 2); k <= Math.min(n - 1, j + 2); k++) if (!fold[k]) fold[k] = 2;
        }
      }
      for (let j = 0; j < n; j++) {
        const cx = (c0 + j + 0.5) * PX;
        col[j] = Math.max(-128, Math.min(127, Math.max(roundArt(raw[j]), hullsNow.length ? hullLift(cx) : -Infinity)));
        let solid = 0;
        let speck = 0;
        let spray = 0;
        if (caps > 0 && sigma > 0) {
          // Foam made now: where the crest tips over, up a steep front face, and on the tallest crests
          let made = fold[j] ? 1 : 0;
          const rise = j + 1 < n ? raw[j + 1] - raw[j] : 0; // the front face rises to the right, toward the crest
          if (rise > 2 && raw[j] > 0.8 * sigma) made = Math.max(made, Math.min(1, (rise - 2) / 2));
          if (fold[j] === 2) made = Math.max(made, 0.6);
          const wcol = (((c0 + j + shift) % FOAM_RING) + FOAM_RING) % FOAM_RING;
          const was = foamAmt[wcol] * Math.exp(-Math.max(0, t - foamAt[wcol]) / FOAM_S);
          const f = made > was ? made : was;
          foamAmt[wcol] = f;
          foamAt[wcol] = t;
          solid = f > 0.75 ? 3 : f > 0.45 ? 2 : f > 0.2 ? 1 : 0;
          speck = Math.min(1, f * 1.4);
          spray = fold[j] === 1 && storm > 0.3 && foamHash(c0 + j + shift, tick) < 0.45 ? 255 : 0;
        }
        const o = j * 4;
        surfData[o] = col[j] + 128;
        surfData[o + 1] = solid;
        surfData[o + 2] = Math.round(speck * 255);
        surfData[o + 3] = spray;
      }
      surfSource.update();
    }

    const bobber = s ? columnArt(scene.bobberX?.() ?? L.bobberX) * PX : 0;
    // The line and bobber again, from the rod where it is now to the water where it is now
    const bobberY = L.bobberY;
    L.bobberY = bobberY - bobber;
    try {
      scene.drawLines(t, scene.getFx?.().castAnimation !== false, scene.bobber.visible);
    } finally {
      L.bobberY = bobberY;
    }

    // The boats' boxes for the haze shader's cap lift (yours first, then the nearest others)
    if (su) {
      const boxes = [scene.rig, ...[...(scene.mateRigs?.values() ?? [])].filter((r) => r.rig.visible).map((r) => r.rig)].slice(0, 8);
      const occ = new Float32Array(32);
      boxes.forEach((rig, i) => {
        const b = rig.getBounds();
        occ.set([b.minX, b.minY, b.maxX, b.maxY], i * 4);
      });
      su.uOccA.set(occ.subarray(0, 16));
      su.uOccB.set(occ.subarray(16));
      // And the flags' (their cloth as drawn this frame, turned with the buoy, and a flag pixel round it)
      const fl = new Float32Array(16);
      flagRects.slice(0, 4).forEach(({ g, x0, y0, x1, y1, pad }, i) => {
        if (!g.visible || !g.parent) return;
        const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => g.toGlobal({ x, y }));
        const xs = pts.map((q) => q.x);
        const ys = pts.map((q) => q.y);
        fl.set([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad], i * 4);
      });
      su.uFlags.set(fl);
    }

    // The background's mark (its alpha) has to last into the scene's picture: it is cleared to clear, not to the sky's
    // colour (the sky covers it all anyway), and the game's light (a multiplied sprite over the whole scene), its
    // added glows and its fog banks (blurred, then laid over the scene) leave the alpha under them as it was, for this
    // picture only. (Thick fog would otherwise round the mark away, and the water would mirror it in patches.)
    const bg = this.renderer?.background;
    const bgAlpha = bg?.alpha;
    const st = this.renderer?.state;
    const gl = this.renderer?.gl;
    const blends = st?.blendModesMap && gl ? ['multiply', 'add'].filter((m) => st.blendModesMap[m]?.length === 2 || st.blendModesMap[m]?.length === 4).map((m) => [m, st.blendModesMap[m]]) : [];
    // The fog banks' cover, for the reflection (none: no fog)
    {
      const atmo = scene?.atmo;
      const shapes = atmo?.fogShapes;
      const amount = atmo?.fog?.visible ? (atmo.fog.alpha ?? 0) : 0;
      ru.uFogAt[2] = 0;
      if (shapes?.context && amount > 0.01 && this.renderer) {
        const w = Math.max(8, Math.ceil((this.rt?.width || innerWidth) * FOG_K));
        const h = Math.max(8, Math.ceil((this.rt?.height || innerHeight) * FOG_K));
        if (fogRT.width !== w || fogRT.height !== h) fogRT.resize(w, h);
        if (fogCopy.context !== shapes.context) fogCopy.context = shapes.context;
        fogCopy.setFromMatrix(new Matrix().scale(FOG_K, FOG_K).append(shapes.worldTransform));
        this.renderer.render({ container: fogCopy, target: fogRT, clear: true, clearColor: [0, 0, 0, 0] });
        ru.uFogAt.set([FOG_K / w, FOG_K / h, amount, 0]);
      }
    }
    // The fishing spots: the game's ring and pool of light left out (the spotlight stands for them), the spotlights,
    // and the cover of what's left, for the reflection (none: no spots)
    {
      const g = scene?.spotGfx;
      const ctx = g?.context;
      // Its glow is left out too: under the waterline the spotlight stands for it. Over the water, the glow's faint
      // haze is drawn again (spotHaze, below)
      if (scene?.spotGlow) scene.spotGlow.renderable = false;
      const fx = scene?.fxLayer;
      if (fx && spotHaze.parent !== fx) fx.addChildAt(spotHaze, Math.max(0, fx.children.indexOf(scene.spotGlow) + 1));
      spotHaze.visible = true;
      spotHaze.clear();
      // The mist's strip: over the water, across where the spots are (none: hidden)
      if (!mistFilter) {
        mistFilter = new Filter({
          glProgram: GlProgram.from({ vertex: VERTEX, fragment: MIST, name: 'waves-mist' }),
          resources: {
            waveMist: {
              uMist: { value: new Float32Array(4), type: 'vec4<f32>' },
              uSpotP: { value: new Float32Array(16), type: 'mat4x4<f32>' },
              uSpotC: { value: new Float32Array(16), type: 'mat4x4<f32>' },
            },
          },
        });
        mistSprite = new Sprite(Texture.WHITE);
        mistSprite.filters = [mistFilter];
      }
      if (fx && mistSprite.parent !== fx) fx.addChildAt(mistSprite, fx.children.indexOf(spotHaze) + 1);
      mistSprite.visible = false;
      let mist0 = Infinity;
      let mist1 = -Infinity;
      if (Array.isArray(ctx?.instructions)) {
        // The rings (the only strokes there), and the ovals some kinds fill under the surface (the Deep hole's dark
        // ones, the Glowing water's pool): the spotlight stands for them. And the wreck's mast, sail and hull, which
        // stood up behind our buoy like a second one (by their colours, scene.js drawSpots). What's left is drawn in
        // pixels: the fish, the whirlpool, the bubbles, the buoys at the zone's ends
        const n = ctx.instructions.length;
        const oval = (ins) => ins?.data?.path?.instructions?.some?.((s) => s?.action === 'ellipse');
        const wreck = (ins) => ins?.action === 'fill' && WRECK_COLORS.has(ins.data?.style?.color);
        for (let i = n - 1; i >= 0; i--) {
          const ins = ctx.instructions[i];
          if (ins?.action === 'stroke' || oval(ins) || (BUOYS && wreck(ins))) ctx.instructions.splice(i, 1);
        }
        if (ctx.instructions.length !== n) ctx.onUpdate?.();
      }
      ru.uSpotAt[2] = 0;
      ru.uSpotAt[3] = 0;
      ru.uSpotP.fill(0);
      const spots = scene?.sea?.spots ?? [];
      if (g && spots.length && scene.seaToWorld) {
        const now = Date.now();
        let n = 0;
        for (const spot of spots) {
          if (n >= MAX_SPOTS) break;
          const color = SPOT_COLOR[spot.kind];
          if (color == null) continue;
          // As the game fades and pulses its spot: in over 3 s, out over the last 8
          const fade = Math.min(1, (spot.until - now) / 8000, (now - (spot.at ?? 0)) / 3000);
          if (!(fade > 0)) continue;
          const pulse = 0.85 + 0.15 * Math.sin(t * 2 + spot.x);
          const x = scene.seaToWorld(spot.x);
          const r = SEA.spotRadius * scene.ppu;
          const a = g.toGlobal({ x, y: 0 });
          const b = g.toGlobal({ x: x + r, y: 0 });
          ru.uSpotP.set([a.x, Math.abs(b.x - a.x), fade * pulse, ((spot.x * 0.618) % 97) + 3], n * 4); // (w: its own seed, for the mist)
          ru.uSpotC.set([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, 0], n * 4);
          n++;
          // The haze over it: the game's glow (scene.js drawSpots: a pool of light, four ovals deep under the
          // surface, and a flat one over it), as much of it as stands above the waterline
          const surface = L.waterY + 2 * PX;
          for (let k = 4; k >= 1; k--) hazeCap(x, surface + 4 * PX, r * (0.45 + k * 0.17), (3 + k * 2.5) * PX, L.waterY, color, 0.08 * pulse * fade);
          hazeCap(x, surface - PX, r * 0.9, 2 * PX, L.waterY, color, 0.14 * pulse * fade);
          mist0 = Math.min(mist0, x - 1.2 * r);
          mist1 = Math.max(mist1, x + 1.2 * r);
        }
        ru.uSpotAt[3] = n ? 1 : 0;
        if (n && mistSprite && mist1 > mist0) {
          const top = L.waterY - MIST_HEIGHT * 2.2 * PX;
          mistSprite.position.set(mist0, top);
          mistSprite.width = mist1 - mist0;
          mistSprite.height = L.waterY + (MIST_BELOW + 1) * PX - top;
          mistSprite.visible = true;
          const mu = mistUniforms();
          const o = g.toGlobal({ x: 0, y: L.waterY });
          const one = g.toGlobal({ x: PX, y: L.waterY });
          mu.uMist.set([o.y, t % 3600, Math.abs(one.x - o.x), o.x]);
          mu.uSpotP.set(ru.uSpotP);
          mu.uSpotC.set(ru.uSpotC);
        }
      }
      if (ctx && spots.length && this.renderer) {
        const w = Math.max(8, Math.ceil((this.rt?.width || innerWidth) * SPOT_K));
        const h = Math.max(8, Math.ceil((this.rt?.height || innerHeight) * SPOT_K));
        if (spotRT.width !== w || spotRT.height !== h) spotRT.resize(w, h);
        if (spotCopy.context !== ctx) spotCopy.context = ctx;
        spotCopy.setFromMatrix(new Matrix().scale(SPOT_K, SPOT_K).append(g.worldTransform));
        this.renderer.render({ container: spotCopy, target: spotRT, clear: true, clearColor: [0, 0, 0, 0] });
        ru.uSpotAt[0] = SPOT_K / w;
        ru.uSpotAt[1] = SPOT_K / h;
        ru.uSpotAt[2] = 1;
      }
    }
    drawBuoys(scene, (x) => columnArt(x) * PX, (x) => { // (riding the waves, whole; leaning with them)
      const s = (rawAt(x + 4 * PX) - rawAt(x - 4 * PX)) / 8;
      return Number.isFinite(s) ? s : 0;
    });
    drawLampGlow(scene); // (the buoys' lamps at night)
    const KEEP = 'waves-keep-alpha'; // (normal, keeping the alpha; unknown to the game, which reads it as normal)
    const normal = st?.blendModesMap?.normal;
    const laid = [];
    if (normal && gl) {
      st.blendModesMap[KEEP] = [normal[0], normal[1], gl.ZERO, gl.ONE];
      for (const c of scene?.weatherLayer?.children ?? []) for (const f of c.filters ?? []) if (f.blendMode === 'normal') laid.push(f);
      for (const f of laid) f.blendMode = KEEP;
    }
    if (bg) bg.alpha = 0;
    for (const [m, f] of blends) st.blendModesMap[m] = [f[0], f[1], gl.ZERO, gl.ONE];
    if (blends.length || laid.length) st.blendMode = null; // (the state caches the last one set)
    try {
      original.call(this, p);
    } finally {
      if (bg) bg.alpha = bgAlpha;
      for (const [m, f] of blends) st.blendModesMap[m] = f;
      for (const f of laid) f.blendMode = 'normal';
      if (st?.blendModesMap) delete st.blendModesMap[KEEP];
      if (blends.length || laid.length) st.blendMode = null;
      // The game's own positions again, for its next frame (the pitch first: it turned the lifted hulls)
      for (const [obj, x, y, r] of turned.reverse()) {
        obj.position.set(x, y);
        obj.rotation = r;
      }
      turned = [];
      for (const [obj, y] of moved) obj.y = y;
      for (const [o, i] of poked) scene.bgLayer.addChildAt(o, Math.min(i, scene.bgLayer.children.length));
    }

    // The reflection about the moving surface (render() has just set the game's own for this frame: copy it over)
    // (in still water too, so the far sea isn't mirrored in it)
    const gu = this.reflect?.u;
    if (gu && this.mirror?.filters) {
      ru.uBoundary = gu.uBoundary;
      ru.uTime = gu.uTime;
      ru.uWater.set(gu.uWater);
      ru.uLight.set(gu.uLight);
      ru.uPath = gu.uPath;
      ru.uScroll = gu.uScroll;
      ru.uPathColor.set(gu.uPathColor);
      // (and the far rows' glints, from next frame)
      fu.uLightAt.set([gu.uLight[0], gu.uPath, gu.uPathColor[0], gu.uPathColor[1]]);
      fu.uLightB = gu.uPathColor[2];
      // How rough the sea is, and how wide the path: narrow and long with the light low, wider with it well up
      const up = Math.max(0, Math.min(1, (L.waterYS - gu.uLight[1]) / (0.5 * (this.rt?.height || innerHeight))));
      ru.uGlint.set([Math.min(1, s), 0.6 + 0.6 * up]);
      fu.uGlint.set(ru.uGlint);
      if (this.mirror.filters[0] !== reflectFilter) this.mirror.filters = [reflectFilter];
      if (shaftFilter && this.group?.filters?.[0] === this.shafts) this.group.filters = [shaftFilter]; // (in still water too: the far sea is water)
    }
    frames++;
  };

  // ---------- The test panel ----------
  // How the scene is drawn: the time of day (a share of the day: 0 is dawn) and the weather, or null for the real ones.
  // Only what the scene draws is changed (its drawWorld and drawClouds get these), not the game's own conditions.
  const look = { time: null, weather: null };
  const TIMES = [['Real', null], ['Dawn', 0.05], ['Morning', 0.2], ['Noon', 0.3], ['Afternoon', 0.44], ['Dusk', 0.55], ['Night', 0.8]];
  const SEAS = [['Real', null], ['Still', 0], ['Coast', 0.3], ['Reef', 0.6], ['Ocean', 1], ['Ocean storm', MAX_SIZE]];
  const lookWorld = (world) => {
    if (!world || (look.time == null && !look.weather)) return world;
    const w = { ...world };
    if (look.time != null) {
      w.dayFrac = look.time;
      w.hour = (5 + look.time * 24) % 24;
      w.phase = PHASES.find((ph) => look.time >= ph.start && look.time < ph.end) ?? w.phase;
    }
    if (look.weather && WEATHER_BY_ID[look.weather]) w.weather = WEATHER_BY_ID[look.weather];
    return w;
  };
  let lookScene = null;
  const lookOwn = {}; // the scene's own drawWorld / drawClouds / drawWaterFx, if it had them as its own (not its class's)
  // The game's glitter under the sun (drawWaterFx: a stack of short bars, always in much the same place) is left out
  // while the shaders are on: the glints (GLINT_GLSL) take its place. Its foam at the boat stays.
  let shadersOn = false;
  const wrapped = {
    drawWorld: (fn) => function (world, ...rest) { return fn.call(this, lookWorld(world), ...rest); },
    drawClouds: (fn) => function (dt, world, ...rest) { return fn.call(this, dt, lookWorld(world), ...rest); },
    drawWaterFx: (fn) => function (...args) {
      if (!shadersOn) return fn.apply(this, args);
      const light = this.lightWorld;
      this.lightWorld = null;
      try {
        return fn.apply(this, args);
      } finally {
        this.lightWorld = light;
      }
    },
  };
  const seeAs = (scene) => {
    unsee();
    lookScene = scene;
    for (const name of Object.keys(wrapped)) {
      const fn = scene[name];
      if (typeof fn !== 'function') continue;
      lookOwn[name] = Object.prototype.hasOwnProperty.call(scene, name) ? fn : undefined;
      scene[name] = wrapped[name](fn);
    }
  };
  const unsee = () => {
    if (!lookScene) return;
    for (const name of Object.keys(lookOwn)) {
      if (lookOwn[name]) lookScene[name] = lookOwn[name];
      else delete lookScene[name];
      delete lookOwn[name];
    }
    lookScene = null;
  };

  const PANEL_ID = 'waves-test-panel';
  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(`${PANEL_ID}-style`)?.remove();
  // The panel only on a local test server, not on the live game (there, waves.force in the console tries a sea)
  const host = location.hostname;
  const LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) || host.endsWith('.localhost');
  const store = {
    get(k) { try { return localStorage.getItem(`waves.${k}`); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(`waves.${k}`, v); } catch {} },
  };
  const style = document.createElement('style');
  style.id = `${PANEL_ID}-style`;
  style.textContent = `
#${PANEL_ID} { position: fixed; left: 8px; top: 96px; z-index: 2147483000; font: 12px/1.25 system-ui, sans-serif; color: #e8eef5; user-select: none; }
#${PANEL_ID} .wv-tab { display: inline-block; background: rgba(12, 20, 32, 0.85); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 4px 9px; cursor: pointer; }
#${PANEL_ID} .wv-tab:hover { background: rgba(30, 48, 72, 0.92); }
#${PANEL_ID} .wv-body { margin-top: 4px; width: 236px; background: rgba(12, 20, 32, 0.9); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 8px 8px 2px; }
#${PANEL_ID} .wv-head { margin: 0 0 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.65; }
#${PANEL_ID} .wv-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
#${PANEL_ID} button { font: inherit; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 4px; padding: 3px 6px; cursor: pointer; }
#${PANEL_ID} button:hover { background: rgba(255, 255, 255, 0.16); }
#${PANEL_ID} button.on { background: #2f6fcf; border-color: #79a8f2; }
#${PANEL_ID} .wv-note { font-size: 10px; opacity: 0.55; margin: -2px 0 8px; }
`;
  if (LOCAL) document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'keydown']) panel.addEventListener(type, (e) => e.stopPropagation());
  const tab = panel.appendChild(document.createElement('div'));
  tab.className = 'wv-tab';
  tab.textContent = 'Waves ▸';
  const body = panel.appendChild(document.createElement('div'));
  body.className = 'wv-body';
  const rows = [];
  const group = (title, items, current, choose, note) => {
    const head = body.appendChild(document.createElement('div'));
    head.className = 'wv-head';
    head.textContent = title;
    const row = body.appendChild(document.createElement('div'));
    row.className = 'wv-row';
    const buttons = items.map(([label, value]) => {
      const b = row.appendChild(document.createElement('button'));
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        choose(value);
        refresh();
      });
      return [b, value];
    });
    rows.push(() => buttons.forEach(([b, value]) => b.classList.toggle('on', current() === value)));
    if (note) {
      const n = body.appendChild(document.createElement('div'));
      n.className = 'wv-note';
      n.textContent = note;
    }
  };
  const refresh = () => rows.forEach((fn) => fn());
  group('Time of day', TIMES, () => look.time, (v) => (look.time = v));
  group('Weather', [['Real', null], ...WEATHERS.map((w) => [w.name, w.id])], () => look.weather, (v) => (look.weather = v), 'Only how it looks: the game’s own time and weather (bites, luck) stay as they are');
  group('Sea', SEAS, () => force, (v) => (window.waves.force = v));
  const open = (on) => {
    body.style.display = on ? '' : 'none';
    tab.textContent = on ? 'Waves ▾' : 'Waves ▸';
    store.set('panelOpen', on ? '1' : '0');
  };
  tab.addEventListener('click', () => open(body.style.display === 'none'));
  open(store.get('panelOpen') === '1');
  panel.style.display = store.get('panelHidden') === '1' ? 'none' : '';
  if (LOCAL) document.body.appendChild(panel);
  refresh();

  proto.render = render;
  window.waves = {
    get intensity() { return Math.round(intensity * 1000) / 1000; },
    get force() { return force; },
    set force(v) { force = v == null ? null : Math.max(0, Math.min(MAX_SIZE, Number(v) || 0)); },
    get frames() { return frames; }, // frames drawn with waves (for checking it runs)
    get boat() { return myBoat.shown ?? 0; }, // your boat's height on the water now (art px, up positive)
    get surface() { return { col0: surf.col0, heights: Array.from(surf.col.subarray(0, surf.n)) }; }, // the drawn surface, column by column
    get panel() { return LOCAL && panel.style.display !== 'none'; }, // (local test servers only)
    set panel(v) {
      panel.style.display = v ? '' : 'none';
      store.set('panelHidden', v ? '0' : '1');
    },
  };
  window.stopWaves = () => {
    if (proto.render === render) proto.render = original;
    if (lastPost) calm(lastPost); // the game's own water and reflection again
    unsee();
    panel.remove();
    style.remove();
    fogCopy.destroy({ context: false }); // (the context is the game's)
    fogRT.destroy(true);
    spotCopy.destroy({ context: false });
    spotRT.destroy(true);
    spotHaze.destroy(); // (and out of the scene)
    buoyBox.destroy({ children: true });
    flagGlowBox.destroy({ children: true });
    unhookSpots();
    unhookLantern();
    gaugeStyle?.remove();
    gaugeStyle = null;
    for (const g of lampBloom) g.parent.destroy({ children: true });
    for (const pair of [...lampLights, ...mateLights]) for (const s of pair) s.destroy();
    for (const g of mateLanterns.values()) if (!g.destroyed) g.destroy();
    mateLanterns.clear();
    mistSprite?.destroy(); // (and out of the scene)
    mistFilter?.destroy();
    delete window.waves;
    delete window.stopWaves;
  };
  console.log('[waves] On: swells build from the Coast to the Open Ocean and calm to still water in the Cosmic Void. Turn it off with stopWaves()');
};

idleAnglerMods.define({
  id: 'waves',
  order: 200,
  name: 'Waves',
  desc: "Rolling waves that build from the Coast to the Open Ocean and calm to still water in the Cosmic Void, bigger in storms, with a far sea out to the horizon. It needs the game's shaders on (Settings)",
  start: waves,
  stop: 'stopWaves',
  // Each part on its own (the waves are what they ride on); a change restarts the waves
  options: [
    { key: 'waves.boats', label: 'Boats sit in the water, partly under the surface (off: on top of it, as the game has them)', toggle: true, fallback: 'on' },
    { key: 'waves.buoys', label: "Hotspot buoys, flying a flag with the spot's bonus in place of its label", toggle: true, fallback: 'on' },
    { key: 'waves.gauges', label: "Lantern gauges: the bite wait and the Frenzy fill two lanterns on the stern, in place of the game's bars", toggle: true, fallback: 'on' },
    { key: 'waves.lanterns', label: "Lanterns on other players' boats, lit at night as yours is", toggle: true, fallback: 'on' },
  ],
});
}
})();
