// ==UserScript==
// @name         Idle Angler Company Online
// @version      2026-11-25
// @description  A green dot by each company member online now, in the Company window
// ==/UserScript==

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
