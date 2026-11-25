// ==UserScript==
// @name         Idle Angler Company Talk
// @version      2026-11-25
// @description  Company Talk: speech bubbles and emotes over your company's anglers, carried by company chat
// ==/UserScript==

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
//    company members); a bubble follows that element every frame, so it rides along when the boat
//    sails, and with the Stacked names mod too
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
  }

  // Every frame: follow each bubble's name, hide it while the name is off screen, drop it when it's done
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
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
    placeBar();
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

  function placeBar() {
    const t = document.getElementById('chat-toggle');
    const chat = document.getElementById('chat');
    const r = t?.getBoundingClientRect();
    if (!r?.width) return;
    // Right of the chat button, or above the open chat window
    const c = chat && !chat.hidden ? chat.getBoundingClientRect() : null;
    if (c?.width) {
      bar.style.left = `${Math.round(c.left)}px`;
      bar.style.top = `${Math.round(c.top - bar.offsetHeight - 6)}px`;
    } else {
      bar.style.left = `${Math.round(r.right + 8)}px`;
      bar.style.top = `${Math.round(r.top + (r.height - bar.offsetHeight) / 2)}px`;
    }
  }

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

  raf = requestAnimationFrame(frame);

  // For trying it out without sending anything: show a line as if it came in over company chat
  // (e.g. companyTalkPreview('*waves*'), or companyTalkPreview('hi', 'SomeMate') for a member on screen)
  window.companyTalkPreview = (text, name = null) =>
    showBubble(name ? { userId: `preview:${name}`, name, text } : { userId: myId, name: me.user.displayName, text });

  window.stopCompanyTalk = () => {
    cancelAnimationFrame(raf);
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
