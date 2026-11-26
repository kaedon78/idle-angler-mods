// ==UserScript==
// @name         Idle Angler Chat Window
// @namespace    http://tampermonkey.net/
// @version      2026-11-26.4
// @description  Chat window: drag its top-right corner to resize it, a gear for the mod settings; each message's time and no company names if you like
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/chat-window.js and the runtime: edit those, not this file.
//
// =====================================================================================================
// Chat window
//
// The chat window in the bottom-left corner (chat.js) is a fixed 340 x 300. This adds a grip in its top-right
// corner, the corner away from where it sits: drag it to make the window wider or taller (it stays put in its
// corner), or focus it and press the arrow keys. Let go and the size is remembered in this browser; a double
// click on the grip goes back to the game's own size. The size is a CSS variable the window's width and height
// follow, still capped to the screen as the game caps it, so the grip never touches the game's drawing of
// the chat. The chat's text stays scrolled to the newest line if it was there.
// Timestamps (an option, off unless you turn it on): each message's time before it, the time the game already
// gives it as its tooltip (the hour and minute on this device's clock), with the date too for a message from
// before today (the chat keeps the last 100 lines, often from days before). The date is added as the game
// draws each message (chat.js Chat.html).
// No company names (an option, off unless you turn it on): the <Company> after each name is left out of the
// chat's lines, in both tabs, as the game draws them. A change to either option, or this starting or stopping,
// has the open chat drawn again (as a click on its tab does), so it shows at once.
// A gear by the chat's ✕ opens the game's Settings window on the Mods tab, at this mod's options (the game's own
// openWindow, then a click on the Mods tab the runtime adds); with the Mods tab already showing, it closes Settings.
// Nothing goes to the server.
// Stop it with:  stopChatWindow(), or untick it in Settings > Mods
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
const chatWindow = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { Chat } = await mod('/src/chat.js');
  const { openWindow } = await mod('/src/ui.js');

  window.stopChatWindow?.(); // replace one already running

  const chat = document.getElementById('chat');
  const log = chat?.querySelector('.chat-log');
  if (!chat || !log) {
    console.warn("[chat window] The game's chat window isn't where it was (#chat .chat-log): not starting");
    return;
  }

  const SIZE_KEY = 'idle-angler-chat-size';
  const TIMES_KEY = 'idle-angler-chat-times';
  const NO_CO_KEY = 'idle-angler-chat-no-company';
  const MIN_W = 240;
  const MIN_H = 150;
  const TOP = 54; // px kept clear above it for the top bar
  const STEP = 16; // px an arrow key moves it
  const root = document.documentElement;

  const style = document.createElement('style');
  style.id = 'cw-style';
  // body #chat outranks the game's .chat and body .chat; the caps are the game's own (100% - 20px wide), and
  // its height cap is let out so a tall window can reach up to the top bar
  style.textContent = `
body.cw-sized #chat{width:min(var(--cw-w), calc(100% - 20px));height:min(var(--cw-h), calc(100% - 120px))}
#chat .chat-tabs{padding-right:22px}
#cw-grip{position:absolute;top:0;right:0;width:16px;height:16px;z-index:2;cursor:nesw-resize;touch-action:none;
  opacity:.55;background:
    linear-gradient(225deg,transparent 3px,currentColor 3px,currentColor 4.5px,transparent 4.5px,
      transparent 7px,currentColor 7px,currentColor 8.5px,transparent 8.5px,
      transparent 11px,currentColor 11px,currentColor 12.5px,transparent 12.5px)}
#cw-grip:hover,#cw-grip:focus-visible,body.cw-drag #cw-grip{opacity:1;color:#fde68a;outline:none}
body.cw-drag,body.cw-drag *{cursor:nesw-resize !important;user-select:none !important}
body.cw-times #chat .chat-msg[title]::before{content:attr(title);white-space:nowrap;margin-right:5px;color:var(--muted,#9aa39a);
  font-size:11px;font-style:normal;font-variant-numeric:tabular-nums}
body.cw-times #chat .chat-msg[data-cw-day][title]::before{content:attr(data-cw-day) " " attr(title)}
#cw-gear{align-self:center;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:0 2px 0 0;
  padding:0;border:0;background:none;color:var(--muted,#9aa39a);cursor:pointer}
#cw-gear .ui-icon{width:18px;height:18px}
#cw-gear:hover,#cw-gear:focus-visible{color:#fde68a;outline:none}`;
  document.head.append(style);

  const stored = (key) => {
    try {
      return localStorage.getItem(key) ?? 'off';
    } catch {
      return 'off';
    }
  };
  // The open chat drawn again, as a click on its tab does (the game's render)
  const redraw = () => {
    if (!chat.hidden) chat.querySelector('.chat-tabs .win-tab.active')?.click();
  };

  // ---------- Timestamps ----------
  const setTimes = (value) => document.body.classList.toggle('cw-times', value === 'on');
  setTimes(stored(TIMES_KEY));
  window.setChatTimes = setTimes;

  // ---------- No company names ----------
  let noCompany = stored(NO_CO_KEY) === 'on';
  window.setChatNoCompany = (value) => {
    noCompany = value === 'on';
    redraw();
  };

  // As the game draws each line: a message from before today carries its date (`data-cw-day`), shown before its
  // time, and its company can be left out (the game writes it as ' <span class="co">&lt;Name&gt;</span>',
  // the name escaped, so the first </span> ends it)
  const proto = Chat.prototype;
  const html = proto.html;
  proto.html = function (m) {
    let out = html.call(this, m);
    if (noCompany) out = out.replace(/ <span class="co">[\s\S]*?<\/span>/, '');
    const at = new Date(m?.at);
    if (!(at < new Date().setHours(0, 0, 0, 0))) return out;
    const day = at.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return out.replace('<div class="chat-msg', `<div data-cw-day="${day.replace(/[&<>"]/g, '')}" class="chat-msg`);
  };
  redraw();

  // ---------- The gear: Settings > Mods ----------
  const settingsWindow = () => document.querySelector('section.window[data-win="settings"]');
  const gear = document.createElement('button');
  gear.id = 'cw-gear';
  gear.type = 'button';
  gear.title = 'Mod settings';
  gear.setAttribute('aria-label', 'Mod settings');
  gear.innerHTML = '<span class="ui-icon" style="--icon:url(/assets/icons/ui/cog.svg)"></span>';
  const close = chat.querySelector('[data-chat-close]');
  close?.parentElement.insertBefore(gear, close);
  let opening = 0;
  gear.addEventListener('click', () => {
    gear.blur(); // Esc goes on closing windows, not to the button
    const open = settingsWindow();
    if (open?.classList.contains('im-showing')) {
      open.querySelector('.win-close')?.click();
      return;
    }
    openWindow('settings');
    // The runtime adds its Mods tab once the window is on the page: show it, at this mod's row
    const until = performance.now() + 1500;
    cancelAnimationFrame(opening);
    const showMods = () => {
      const tab = settingsWindow()?.querySelector('.win-tabs .im-tab');
      if (!tab) {
        if (performance.now() < until) opening = requestAnimationFrame(showMods);
        return;
      }
      tab.click();
      settingsWindow()?.querySelector('input[data-im="chatWindow"]')?.closest('label')?.scrollIntoView({ block: 'start' });
    };
    showMods();
  });

  // ---------- The size ----------
  let size = null; // { w, h } set with the grip, or null: the game's own
  const apply = () => {
    document.body.classList.toggle('cw-sized', !!size);
    if (size) {
      root.style.setProperty('--cw-w', `${size.w}px`);
      root.style.setProperty('--cw-h', `${size.h}px`);
    } else {
      root.style.removeProperty('--cw-w');
      root.style.removeProperty('--cw-h');
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY));
    if (saved?.w >= MIN_W && saved?.h >= MIN_H) size = { w: Math.round(saved.w), h: Math.round(saved.h) };
  } catch {
    // nothing saved, or storage blocked: the game's size
  }
  apply();
  const save = () => {
    try {
      if (size) localStorage.setItem(SIZE_KEY, JSON.stringify(size));
      else localStorage.removeItem(SIZE_KEY);
    } catch {
      // storage blocked: the size lasts until the page reloads
    }
  };

  // The window keeps its bottom-left corner, so the size is how far the grip is from there
  const set = (w, h) => {
    const r = chat.getBoundingClientRect();
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    size = {
      w: Math.round(Math.max(MIN_W, Math.min(innerWidth - r.left - 10, w))),
      h: Math.round(Math.max(MIN_H, Math.min(r.bottom - TOP, h))),
    };
    apply();
    if (atBottom) log.scrollTop = log.scrollHeight;
  };

  const grip = document.createElement('div');
  grip.id = 'cw-grip';
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-label', 'Size of the chat window');
  grip.title = 'Drag to resize the chat (arrow keys too). Double-click for its usual size.';
  chat.append(grip);

  let drag = null; // { id, dx, dy }: the pointer, and how far it is from the window's top-right corner
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = chat.getBoundingClientRect();
    drag = { id: e.pointerId, dx: r.right - e.clientX, dy: e.clientY - r.top };
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('cw-drag');
  });
  grip.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag?.id) return;
    const r = chat.getBoundingClientRect();
    set(e.clientX + drag.dx - r.left, r.bottom - (e.clientY - drag.dy));
  });
  const end = (e) => {
    if (e.pointerId !== drag?.id) return;
    drag = null;
    document.body.classList.remove('cw-drag');
    save();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => {
    size = null;
    apply();
    save();
    log.scrollTop = log.scrollHeight;
  });
  grip.addEventListener('keydown', (e) => {
    const k = { ArrowRight: [STEP, 0], ArrowLeft: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] }[e.key];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation(); // not the game's hotkeys
    const r = chat.getBoundingClientRect();
    set(r.width + k[0], r.height + k[1]);
    save();
  });

  window.stopChatWindow = () => {
    if (proto.html !== html) proto.html = html;
    redraw();
    cancelAnimationFrame(opening);
    gear.remove();
    grip.remove();
    style.remove();
    document.body.classList.remove('cw-sized', 'cw-times', 'cw-drag');
    root.style.removeProperty('--cw-w');
    root.style.removeProperty('--cw-h');
    delete window.setChatTimes;
    delete window.setChatNoCompany;
    delete window.stopChatWindow;
  };
};

idleAnglerMods.define({
  id: 'chatWindow',
  order: 130,
  name: 'Chat window',
  desc: "Drag the chat window's top-right corner to resize it (double-click there for its usual size). Below: timestamps, and no company names",
  start: chatWindow,
  stop: 'stopChatWindow',
  options: [
    {
      key: 'idle-angler-chat-times',
      label: "Show each message's time",
      toggle: true,
      fallback: 'off',
      apply: (value) => window.setChatTimes?.(value), // live, without a restart
    },
    {
      key: 'idle-angler-chat-no-company',
      label: 'Hide company names in chat',
      toggle: true,
      fallback: 'off',
      apply: (value) => window.setChatNoCompany?.(value),
    },
  ],
});
}
})();
