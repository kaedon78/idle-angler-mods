// Idle Angler — build switcher.
// Paste into the DevTools console on https://idle-angler.onrender.com/ once you're signed in and the
// game is running. It adds a key to the bottom bar, left of the Angler button, showing which of your
// saved builds (the game's gear sets, Angler > Gear: up to 5, each with its stat priorities) you're
// wearing: 1-5, or – when it's none of them.
//  - a line above the Ascension bar names the build you're wearing, with its stat priorities
//  - click either for a menu of every saved build; pick one to put it on
//  - or press 1-5 anywhere in the game (not while typing in chat or a box)
// Putting a build on is the game's own "put this set on" (the same as clicking the set in Angler >
// Gear): every piece you still have goes on, and its stat priorities come back with it.
// Stop it (and remove the key) with:  stopBuildSwitcher()

(async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { act } = await mod('/src/actions.js');
  const { GEAR_SETS, STATS, RARITIES } = await mod('/src/data.js');
  const { toast, openWindow } = await mod('/src/ui.js');
  const MAX = GEAR_SETS?.max ?? 5;

  window.stopBuildSwitcher?.(); // replace one already running

  const bar = document.getElementById('actionbar');
  const angler = bar?.querySelector('[data-win="angler"]');
  if (!bar) return console.warn('[build switcher] The game page was not found (#actionbar)');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // As the game names priorities (ui.js priorityName)
  const priorityName = (key) => (key === 'gold' ? 'Income' : STATS[key]?.seekTier ? `${RARITIES[STATS[key].seekTier].name} odds` : STATS[key]?.name ?? key);
  const priorities = (list) => (list?.length ? list.map((k, i) => `${i + 1}. ${priorityName(k)}`).join(' · ') : 'Income');

  // ---------- Which build you're wearing ----------
  // A build is worn when every piece of it you still own is on (pieces you've sold don't count
  // against it). Several can match at once (one set inside another): then the one you last picked
  // here, else the one whose priorities are the ones in use, else the one with the most pieces.
  let last = -1;
  const owned = (set) => Object.entries(set.items ?? {}).filter(([, uid]) => S.itemByUid(uid));
  const current = () => {
    const st = S.state;
    const now = JSON.stringify(st.settings?.buildPriority ?? []);
    const worn = (st.gearSets ?? [])
      .map((set, i) => ({ i, set, pieces: owned(set) }))
      .filter(({ pieces }) => pieces.length && pieces.every(([slot, uid]) => st.equipped[slot] === uid));
    if (!worn.length) return -1;
    if (worn.some((w) => w.i === last)) return last;
    const score = (w) => (JSON.stringify(w.set.priority ?? []) === now ? 1000 : 0) + w.pieces.length;
    return worn.sort((a, b) => score(b) - score(a))[0].i;
  };

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.id = 'buildswitch-style';
  style.textContent = `
#buildswitch-btn .bs-num{font:700 20px/1 var(--font);text-shadow:1px 1px 0 #000}
#buildswitch-btn.none .bs-num{opacity:.5}
#buildswitch-menu{position:fixed;z-index:1000;display:grid;min-width:260px;max-width:min(420px,calc(100vw - 16px));padding:4px;
  border:9px solid;border-image:var(--fr-tip);box-shadow:0 10px 24px rgba(0,0,0,.5)}
#buildswitch-menu[hidden]{display:none}
#buildswitch-menu .bs-head{padding:4px 8px 8px;margin-bottom:4px;font-weight:700;border-bottom:1px solid #3a4a30}
#buildswitch-menu .pm-item{display:grid;grid-template-columns:auto 1fr;column-gap:10px;align-items:baseline;cursor:pointer}
#buildswitch-menu .pm-item kbd{grid-row:span 2;align-self:center;min-width:18px;text-align:center}
#buildswitch-menu .pm-item .bs-pri{grid-column:2;font-size:12px}
#buildswitch-menu .pm-item.on{background:rgba(253,230,138,.14)}
#buildswitch-menu .pm-item.on .bs-name{color:#fde68a}
#buildswitch-menu .pm-item:disabled{cursor:default;opacity:.55}
#buildswitch-menu .pm-item:disabled:hover{background:none}
#buildswitch-menu .bs-foot{margin-top:4px;border-top:1px solid #3a4a30}
#buildswitch-row{display:flex;align-items:baseline;gap:8px;padding:0 4px;font:inherit;font-size:13px;color:inherit;
  text-shadow:1px 1px 0 #000;background:none;border:0;cursor:pointer;text-align:left;white-space:nowrap;
  contain:inline-size;overflow:hidden}
#buildswitch-row .lvl{min-width:50px;color:#fde68a}
#buildswitch-row .bs-pri{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:11px}
#buildswitch-row:hover .bs-name{color:#f4f0b0}
#buildswitch-tip{position:fixed;z-index:1000;max-width:min(380px,calc(100vw - 16px));padding:8px 12px;pointer-events:none;
  font-family:var(--font);font-size:14px;line-height:1.35;color:var(--text);border:9px solid;border-image:var(--fr-tip);
  box-shadow:0 6px 18px rgba(0,0,0,.6)}`;
  document.head.append(style);

  // ---------- The key ----------
  // The game's own key look (.action-btn: frame, size, corner key label). It has no data-win, so the
  // bar's click handler leaves it alone.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'buildswitch-btn';
  btn.className = 'action-btn';
  btn.setAttribute('aria-label', 'Builds');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.innerHTML = '<span class="bs-num"></span><kbd>1-5</kbd>';
  bar.insertBefore(btn, angler ?? bar.firstChild);
  const num = btn.querySelector('.bs-num');

  // ---------- The status line ----------
  // Above the Ascension bar, in the same style as it and the XP bar: the build you're wearing, its
  // stat priorities, and how many of its pieces you're missing. Click it for the menu too. It never
  // widens the bar (contain: inline-size): a long line is cut off with "…".
  const row = document.createElement('button');
  row.type = 'button';
  row.id = 'buildswitch-row';
  row.setAttribute('aria-label', 'Current build (opens the builds menu)');
  const ascRow = document.getElementById('asc-row');
  if (ascRow) ascRow.before(row);
  else document.getElementById('hotbar')?.prepend(row);
  const rowHtml = () => {
    const sets = S.state.gearSets ?? [];
    const i = current();
    if (i < 0) {
      return `<span class="lvl">Build –</span><span class="muted">${sets.length ? 'Not wearing a saved build' : 'No builds saved yet (Angler &gt; Gear)'}</span>`;
    }
    const set = sets[i];
    const pieces = Object.keys(set.items ?? {}).length;
    const have = owned(set).length;
    const missing = have < pieces ? ` <span style="color:#fca5a5">${have}/${pieces} pieces</span>` : '';
    return `<span class="lvl">Build ${i + 1}</span><b class="bs-name">${esc(set.name)}</b>${missing}<span class="bs-pri muted">${esc(priorities(set.priority))}</span>`;
  };

  // Tooltip: a lookalike of the game's (which only shows its own data-tip keys)
  const tip = document.createElement('div');
  tip.id = 'buildswitch-tip';
  tip.hidden = true;
  document.body.append(tip);
  const tipHtml = () => {
    const sets = S.state.gearSets ?? [];
    const i = current();
    const head = i >= 0
      ? `<div class="tip-title">Build ${i + 1}: ${esc(sets[i].name)}</div><div class="muted">${esc(priorities(sets[i].priority))}</div>`
      : `<div class="tip-title">Builds</div><div class="muted">${sets.length ? "You're not wearing any of your saved builds." : 'No builds saved yet: save one in Angler > Gear.'}</div>`;
    return `${head}<div class="tip-sep"></div><div class="muted">Click to pick a build, or press 1-${MAX}.</div>`;
  };
  const placeTip = () => {
    const r = btn.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - width / 2), innerWidth - width - 8)}px`;
    tip.style.top = `${Math.max(8, r.top - height - 8)}px`;
  };
  btn.addEventListener('pointerenter', () => {
    if (!menu.hidden) return;
    tip.innerHTML = tipHtml();
    tip.hidden = false;
    placeTip();
  });
  btn.addEventListener('pointerleave', () => { tip.hidden = true; });

  // ---------- The menu ----------
  const menu = document.createElement('div');
  menu.id = 'buildswitch-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  const renderMenu = () => {
    const sets = S.state.gearSets ?? [];
    const on = current();
    const rows = [];
    for (let i = 0; i < MAX; i++) {
      const set = sets[i];
      if (!set) {
        rows.push(`<button class="pm-item" role="menuitem" disabled><kbd>${i + 1}</kbd><span class="muted">Empty</span></button>`);
        continue;
      }
      const pieces = Object.keys(set.items ?? {}).length;
      const have = owned(set).length;
      rows.push(
        `<button class="pm-item${i === on ? ' on' : ''}" role="menuitem" data-build="${i}"><kbd>${i + 1}</kbd>` +
          `<span><b class="bs-name">${esc(set.name)}</b> <span class="muted">${have}/${pieces} pieces${i === on ? ' · wearing' : ''}</span></span>` +
          `<span class="bs-pri muted">${esc(priorities(set.priority))}</span></button>`,
      );
    }
    menu.innerHTML =
      `<div class="bs-head">Builds</div>${rows.join('')}` +
      `<button class="pm-item bs-foot" role="menuitem" data-manage><span></span><span class="muted">Save or change builds (Angler &gt; Gear)</span></button>`;
  };
  const placeMenu = () => {
    const r = btn.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(Math.max(8, r.left), innerWidth - width - 8)}px`;
    menu.style.top = `${Math.max(8, r.top - height - 10)}px`;
  };
  const setMenu = (open) => {
    menu.hidden = !open;
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      tip.hidden = true;
      renderMenu();
      placeMenu();
    }
  };
  btn.addEventListener('click', () => setMenu(menu.hidden));
  row.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-build], [data-manage]');
    if (!item || item.disabled) return;
    setMenu(false);
    if (item.hasAttribute('data-manage')) return openWindow('character');
    wear(Number(item.dataset.build));
  });
  const onPointerDown = (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target) && !row.contains(e.target)) setMenu(false);
  };
  document.addEventListener('pointerdown', onPointerDown);

  // ---------- Putting a build on ----------
  let busy = false;
  const wear = async (i) => {
    const set = S.state.gearSets?.[i];
    if (!set) return toast(`No build ${i + 1} saved yet (save one in Angler > Gear)`, true);
    if (busy) return;
    busy = true;
    last = i;
    try {
      const n = await act(S.game, 'equipGearSet', { index: i });
      if (!n) toast("None of that build's gear is in your bag any more (or you can't wear it yet)", true);
      else toast(`Build ${i + 1}: ${set.name}`);
    } finally {
      busy = false;
      render();
    }
  };

  // ---------- Hotkeys ----------
  // 1-5 put a build on. Not while typing, with a dialog up, or with Ctrl / Alt / Cmd held. Runs before
  // the game's own keys (capture), so Esc closes this menu instead of opening Settings.
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.getElementById('modal-root')?.firstElementChild) return;
    if (e.key === 'Escape' && !menu.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setMenu(false);
      return;
    }
    const d = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    if (!d || Number(d) > MAX) return;
    e.preventDefault();
    if (e.repeat) return;
    setMenu(false);
    wear(Number(d) - 1);
  };
  window.addEventListener('keydown', onKey, true);

  // ---------- Keeping it current ----------
  // Gear changes anywhere (the Gear window, a set button, a new drop) show up within half a second
  const render = () => {
    const i = current();
    const text = i >= 0 ? String(i + 1) : '–';
    if (num.textContent !== text) num.textContent = text;
    btn.classList.toggle('none', i < 0);
    const line = rowHtml();
    if (row.dataset.html !== line) { row.dataset.html = line; row.innerHTML = line; }
    if (!menu.hidden) renderMenu();
    if (!tip.hidden) tip.innerHTML = tipHtml();
  };
  render();
  const timer = setInterval(render, 500);
  const onResize = () => { tip.hidden = true; setMenu(false); };
  addEventListener('resize', onResize);

  window.stopBuildSwitcher = () => {
    clearInterval(timer);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointerDown);
    removeEventListener('resize', onResize);
    btn.remove();
    row.remove();
    menu.remove();
    tip.remove();
    style.remove();
    delete window.stopBuildSwitcher;
  };
})();
