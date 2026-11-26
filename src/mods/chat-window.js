// ==UserScript==
// @name         Idle Angler Chat Window
// @version      2026-11-26.4
// @description  Chat window: drag its top-right corner to resize it, a gear for the mod settings; each message's time and no company names if you like
// ==/UserScript==

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
