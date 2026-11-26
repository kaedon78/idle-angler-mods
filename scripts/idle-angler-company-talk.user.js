// ==UserScript==
// @name         Idle Angler Company Talk
// @namespace    http://tampermonkey.net/
// @version      2026-11-26
// @description  Company Talk: speech bubbles and emotes over your company's anglers, carried by company chat
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Built by build.mjs from src/mods/company-talk.js and the runtime: edit those, not this file.
//
// Idle Angler — Company Talk, a prototype of anglers talking to each other on the water, with no change
// to the game's server. Its script needs no other; with other Idle
// Angler mod scripts it shows in Settings > Mods with them.
//
// The channel is the game's own company chat. Every company message (from anyone in your company, mod
// or not) pops up as a speech bubble over that angler's head, if they're on the water in your zone (the
// game draws your company's boats there). An emote bar above the chat button sends emotes: short lines
// like "*waves*" that read naturally to players without the script, while players with it see the emote
// pop up as a bubble with its icon. So the "protocol" degrades to ordinary chat for everyone else.
//
// How it works, all from the page:
//  - receiving: its own EventSource on /api/chat/stream (the same stream the chat window opens; the server
//    sends the history first, which is skipped, then one `message` event a line)
//  - sending: POST /api/chat { channel: 'company', text }, what the chat window's Send does. Nothing is
//    sent unless you press an emote (or type in the chat yourself); there's a 4 s cooldown between emotes
//  - placing: the game puts each name over its angler as an HTML element (.hud-name, and .mate-name for
//    company members); a bubble follows that element every frame while it shows, so it rides along when
//    the boat sails, and with the Stacked names mod too
//  - who's who: your own lines go over your own name (matched by user id from /api/me); a member's go
//    over the .mate-name with their name. Someone not on the water in your zone gets no bubble (their
//    line is still in the chat window)
//
// Limits of doing it without the server: anyone could type "*waves*" by hand and get the emote (that's
// fine for emotes; it would not be for anything that has to be trusted), every line is in the company's
// chat history for all members, and the game's chat rate limit applies.
//
// Pasting it again replaces the one running. Stop it with:
//   stopCompanyTalk()

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
const companyTalk = async () => {
  window.stopCompanyTalk?.();

  // The emotes: the line that goes into chat, and the icon modded players see in the bubble
  const EMOTES = [
    { id: 'wave', icon: '👋', text: '*waves*', label: 'Wave' },
    { id: 'cheer', icon: '🎉', text: '*cheers*', label: 'Cheer' },
    { id: 'fish', icon: '🐟', text: '*holds up a fish*', label: 'Show a fish' },
    { id: 'laugh', icon: '😂', text: '*laughs*', label: 'Laugh' },
    { id: 'gg', icon: '👍', text: '*gives a thumbs up*', label: 'Thumbs up' },
    { id: 'sleep', icon: '💤', text: '*dozes off*', label: 'Doze off' },
  ];
  const BY_TEXT = new Map(EMOTES.map((e) => [e.text.toLowerCase(), e]));
  const COOLDOWN_MS = 4000;
  const BUBBLE_MS = (text) => Math.min(9000, 3500 + text.length * 60);

  const me = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
  if (!me?.user) return console.warn('[company talk] Not signed in');
  const myId = String(me.user.id);

  // ---- Styles -------------------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .ct-bubble { position: fixed; z-index: 40; pointer-events: none; transform: translate(-50%, -100%);
      max-width: 240px; padding: 5px 9px; border-radius: 8px; background: #f7f1df; color: #2a2116;
      border: 2px solid #2a2116; font: 13px/1.3 system-ui, sans-serif; text-align: center;
      box-shadow: 0 2px 0 rgba(0,0,0,.35); opacity: 0; transition: opacity .18s; word-wrap: break-word; }
    .ct-bubble.on { opacity: 1; }
    .ct-bubble::after { content: ''; position: absolute; left: 50%; bottom: -8px; margin-left: -6px;
      border: 6px solid transparent; border-top-color: #2a2116; border-bottom: 0; }
    .ct-bubble.emote { font-size: 22px; padding: 3px 8px; }
    .ct-bubble.emote small { display: block; font-size: 11px; font-style: italic; opacity: .75; }
    .ct-bubble.pop { animation: ct-pop .35s ease-out; }
    @keyframes ct-pop { 0% { transform: translate(-50%, -80%) scale(.6); } 70% { transform: translate(-50%, -104%) scale(1.08); } 100% { transform: translate(-50%, -100%) scale(1); } }
    #ct-bar { position: fixed; z-index: 41; display: flex; gap: 4px; padding: 4px; border-radius: 8px;
      background: rgba(20, 24, 32, .82); border: 1px solid rgba(255,255,255,.15); }
    #ct-bar button { width: 34px; height: 34px; border: 0; border-radius: 6px; background: rgba(255,255,255,.08);
      font-size: 19px; cursor: pointer; }
    #ct-bar button:hover { background: rgba(255,255,255,.2); }
    #ct-bar.cool button { opacity: .4; cursor: default; }
    #ct-bar .ct-tag { align-self: center; padding: 0 4px; color: #cfd6e4; font: 11px system-ui, sans-serif; }
    #ct-toast { position: fixed; z-index: 42; padding: 4px 8px; border-radius: 6px; background: #5a1e1e;
      color: #fff; font: 12px system-ui, sans-serif; }
  `;
  document.head.append(style);

  // ---- Bubbles ------------------------------------------------------------------------------------
  const bubbles = new Map(); // anchor key -> { el, until }

  /** The name element over this sender's angler, or null when they aren't on screen. */
  function anchorFor(msg) {
    const hud = [...document.querySelectorAll('.hud-name')];
    if (String(msg.userId) === myId) return hud.find((n) => !n.classList.contains('mate-name')) ?? null;
    const name = String(msg.name ?? '').toLowerCase();
    return hud.find((n) => n.classList.contains('mate-name') && n.textContent.trim().toLowerCase() === name) ?? null;
  }

  function showBubble(msg) {
    const key = String(msg.userId ?? msg.name);
    const text = String(msg.text ?? '').trim();
    if (!text) return;
    const emote = BY_TEXT.get(text.toLowerCase());
    let b = bubbles.get(key);
    if (!b) {
      b = { el: document.createElement('div'), key, msg };
      b.el.className = 'ct-bubble';
      document.body.append(b.el);
      bubbles.set(key, b);
    }
    b.msg = msg;
    b.el.classList.toggle('emote', !!emote);
    b.el.replaceChildren();
    if (emote) {
      b.el.append(emote.icon);
      const s = document.createElement('small');
      s.textContent = emote.label.toLowerCase();
      b.el.append(s);
    } else {
      b.el.textContent = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    }
    b.until = performance.now() + BUBBLE_MS(text);
    b.el.classList.remove('pop');
    void b.el.offsetWidth; // restart the pop
    b.el.classList.add('pop');
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // Every frame while there are bubbles: follow each bubble's name, hide it while the name is off screen,
  // drop it when it's done. With no bubbles the loop stops (showBubble starts it again), since reading
  // where a name is makes the browser lay out the page first
  let raf = 0;
  function frame() {
    raf = bubbles.size ? requestAnimationFrame(frame) : 0;
    const now = performance.now();
    for (const [key, b] of bubbles) {
      if (now > b.until) {
        b.el.classList.remove('on');
        if (now > b.until + 300) {
          b.el.remove();
          bubbles.delete(key);
        }
        continue;
      }
      const a = anchorFor(b.msg);
      const r = a && !a.hidden ? a.getBoundingClientRect() : null;
      const visible = r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      b.el.classList.toggle('on', !!visible);
      if (visible) {
        b.el.style.left = `${Math.round(r.left + r.width / 2)}px`;
        b.el.style.top = `${Math.round(r.top - 6)}px`;
      }
    }
  }

  // ---- Receiving: the chat stream ------------------------------------------------------------------
  let es = null;
  let retry = 0;
  function connect() {
    es?.close();
    es = new EventSource('/api/chat/stream');
    es.addEventListener('message', (e) => {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data?.channel === 'company' && data.msg) showBubble(data.msg);
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) retry = setTimeout(connect, 10_000);
    };
  }
  connect();

  // ---- Sending: the emote bar ----------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.id = 'ct-bar';
  const tag = document.createElement('span');
  tag.className = 'ct-tag';
  tag.textContent = 'Company';
  bar.append(tag);
  let coolUntil = 0;
  for (const e of EMOTES) {
    const btn = document.createElement('button');
    btn.textContent = e.icon;
    btn.title = `${e.label}: sends "${e.text}" to company chat`;
    btn.addEventListener('click', () => sendEmote(e));
    bar.append(btn);
  }
  document.body.append(bar);
  bar.hidden = !me.company;

  // Placing the bar measures the page, which makes the browser lay it out first, so it's done only when
  // something it sits by changes (the chat button, the chat window opening, closing or being resized, the
  // game's area, the window), at most once a frame, and every 2 s in case something moved them unseen
  let placeRaf = 0;
  let placed = '';
  function placeBar() {
    placeRaf = 0;
    if (bar.hidden) return;
    const t = document.getElementById('chat-toggle');
    const chat = document.getElementById('chat');
    const r = t?.getBoundingClientRect();
    if (!r?.width) return;
    // Right of the chat button, or above the open chat window
    const c = chat && !chat.hidden ? chat.getBoundingClientRect() : null;
    const [left, top] = c?.width
      ? [c.left, c.top - bar.offsetHeight - 6]
      : [r.right + 8, r.top + (r.height - bar.offsetHeight) / 2];
    const at = `${Math.round(left)}px ${Math.round(top)}px`;
    if (at === placed) return;
    placed = at;
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
  }
  const schedulePlace = () => {
    if (!placeRaf && !bar.hidden) placeRaf = requestAnimationFrame(placeBar);
  };
  const sizes = new ResizeObserver(schedulePlace);
  const attrs = new MutationObserver(schedulePlace);
  for (const el of [bar, document.getElementById('chat-toggle'), document.getElementById('chat')]) {
    if (!el) continue;
    sizes.observe(el);
    if (el !== bar) attrs.observe(el, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  }
  const area = document.getElementById('chat-toggle')?.parentElement;
  if (area) sizes.observe(area);
  addEventListener('resize', schedulePlace);
  const placeTimer = setInterval(schedulePlace, 2000);
  schedulePlace();

  function toast(text) {
    const t = document.createElement('div');
    t.id = 'ct-toast';
    t.textContent = text;
    const r = bar.getBoundingClientRect();
    t.style.left = `${r.left}px`;
    t.style.top = `${r.top - 28}px`;
    document.body.append(t);
    setTimeout(() => t.remove(), 3000);
  }

  async function sendEmote(e) {
    const now = Date.now();
    if (now < coolUntil) return;
    coolUntil = now + COOLDOWN_MS;
    bar.classList.add('cool');
    setTimeout(() => bar.classList.remove('cool'), COOLDOWN_MS);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'company', text: e.text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || `Not sent (${res.status})`);
      }
    } catch (err) {
      toast(`Not sent: ${err.message}`);
    }
  }

  // For trying it out without sending anything: show a line as if it came in over company chat
  // (e.g. companyTalkPreview('*waves*'), or companyTalkPreview('hi', 'SomeMate') for a member on screen)
  window.companyTalkPreview = (text, name = null) =>
    showBubble(name ? { userId: `preview:${name}`, name, text } : { userId: myId, name: me.user.displayName, text });

  window.stopCompanyTalk = () => {
    cancelAnimationFrame(raf);
    cancelAnimationFrame(placeRaf);
    clearInterval(placeTimer);
    sizes.disconnect();
    attrs.disconnect();
    removeEventListener('resize', schedulePlace);
    clearTimeout(retry);
    es?.close();
    for (const b of bubbles.values()) b.el.remove();
    bubbles.clear();
    bar.remove();
    style.remove();
    delete window.companyTalkPreview;
    delete window.stopCompanyTalk;
    console.log('[company talk] Off');
  };

  console.log(`[company talk] On${me.company ? ` for ${me.company.name}` : ' (not in a company: nothing to send or show)'}. Stop it with stopCompanyTalk()`);
};

idleAnglerMods.define({
  id: 'companyTalk',
  order: 210,
  name: 'Company Talk',
  desc: "Every company chat line pops up as a speech bubble over that angler on the water, and an emote bar above the chat button sends emotes as short chat lines (players without the mod read them as chat)",
  start: companyTalk,
  stop: 'stopCompanyTalk',
});
}
})();
