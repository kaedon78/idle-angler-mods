// ==UserScript==
// @name         Idle Angler Stacked Names
// @version      2026-11-25
// @description  Names on the water that would overlap stack in a column by gold leaderboard rank, with rank badges
// ==/UserScript==

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
