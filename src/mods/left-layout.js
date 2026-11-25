// ==UserScript==
// @name         Idle Angler Left-hand Layout
// @version      2026-11-25
// @description  The sidebar on the left, windows sliding out from there, no pages in Upgrades and Perks
// @shared       view-centre
// ==/UserScript==

// =====================================================================================================
// Left-hand layout
//
// It changes the game's new sidebar layout:
//  - the sidebar (window buttons, Level and Ascension bars) sits down the left edge instead of the right
//  - a window slides out from the left edge of the screen, and the game moves over to make room for it
//    (nothing is covered), like Quicklinks does on the right. The scene slides over whole, at its full size,
//    so your angler stays in view, out past the window: its right edge goes off the screen while the window
//    is open (the catch feed and the right sail tab come back in, to stay on screen; Quicklinks keeps the
//    scene whole the same way). Out on the water the camera centres your angler on the part you see, and the big announcements
//    ("Legendary!") show there too. A narrower picture
//    would have the game lay its scene out again for the new width, which moves the whole view about on
//    every frame of the slide. One window shows at a time: opening
//    another swaps it in. Close it (✕, Esc or its button again) and the game slides back.
//    A window you undock floats over the game as before, and one you've pinned opens in its spot. The
//    Weather forecast mod's window slides out here too.
//  - Upgrades and Perks list every card on one page instead of five at a time
// Everything inside the windows is still the game's own: only where they sit changes.
// On a narrow screen (720px or less) the game's own phone layout is left alone.
// Stop it (and put the game's layout back) with:  stopLeftLayout(), or untick it in Settings > Mods
// =====================================================================================================
const leftLayout = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { UPGRADES, PERKS, STATS } = await mod('/src/data.js');
  const { fmtHtml, fmtDecHtml, moneyHtml } = await mod('/src/format.js');
  const { ICON_COLS, ICON_ROWS, ICON_INDEX } = await mod('/src/icon-index.js');

  window.stopLeftLayout?.(); // replace one already running
  viewCentre.add('leftLayout'); // the camera centres on the part of the scene you see

  const layer = document.getElementById('windows');
  const hotbar = document.getElementById('hotbar');
  if (!layer || !hotbar) return console.warn('[left layout] The game page was not found (#windows, #hotbar)');

  const WIDTH = 380; // the slideout (px); a window's contents never grow past their normal size, so it shows more
  const SLIDE_MS = 180;
  const RIBBON_RISE = 16; // where the frame starts (px): a window's title ribbon rises 12px above it, so the ribbon's top is 4px down
  const WIDE = '(min-width: 721px)'; // the game's own break: below it, a window fills the phone's screen

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.id = 'left-layout-style';
  style.textContent = `
:root{--ll-w:${WIDTH}px}
#app{transition:margin ${SLIDE_MS}ms ease-out}
/* The scene keeps its full size while the page makes room (a window on the left, Quicklinks on the right):
   it reaches past the page's right edge by however far the page is pushed, on the same timing, so the game
   never lays it out again (that moves the whole view about). The catch feed and the right sail tab come
   back in by as much, to stay on screen. The camera aims for the middle of the part you see (viewCentre).
   Left-hand layout and Quicklinks both have this rule */
#stage > #game{right:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)));transition:right ${SLIDE_MS}ms ease-out}
#scene-hud > .catch-feed{margin-right:calc(var(--ll-push, 0px) + var(--qs-push, 0px));transition:margin-right ${SLIDE_MS}ms ease-out}
#scene-hud > .sail-arrow.right{margin-left:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)))}
@media ${WIDE}{
  body.ll-open #app{margin-left:var(--ll-w)}
  body.ll-open{--ll-push:var(--ll-w)}
  /* The sidebar: down the left edge, opening rightwards. Mirrored: the icons keep to the edge (the slim strip
     shows them), the names open to their right with the hotkey at the end, the active line is on the left,
     and Collapse points left */
  body #stage #hotbar{left:6px;right:auto}
  body #hotbar #actionbar .action-btn{justify-content:flex-start}
  body #hotbar #actionbar .action-btn :is(.gicon,.ui-icon){order:-3}
  body #hotbar #actionbar .action-btn .ab-label{text-align:left}
  body #hotbar:is(.hovering,.pinned,:focus-within) #actionbar .action-btn .ab-label{margin-right:0;margin-left:8px}
  body #hotbar #actionbar .action-btn kbd{order:1;margin-right:0;margin-left:8px}
  body #hotbar #actionbar .action-btn.active{box-shadow:inset 2px 0 0 var(--gold)}
  body #hotbar-pin{flex-direction:row-reverse}
  body #hotbar-pin svg{transform:scaleX(-1)}
  body #hotbar-pin[aria-pressed='true'] svg{transform:none}
  /* The zone arrows trade places with it: the left one clears the sidebar, the right one sits at the edge */
  body #scene-hud > .sail-arrow.left{transform:translate(52px,-50%)}
  body #scene-hud > .sail-arrow.right{transform:translate(calc(-100% - 6px),-50%)}
  /* A docked window: the slideout, against the left edge, down to the bottom of the page. Its frame starts
     just low enough for the title ribbon to rise over the top border as it always does, its top at the top
     of the page. The forecast mod's window (kept in the page, hidden, while it's closed) joins in when it shows */
  body #windows > .window:not(.floating):not([hidden]){position:fixed;left:0 !important;right:auto !important;top:${RIBBON_RISE}px !important;bottom:0 !important;
    width:var(--ll-w) !important;height:auto !important;max-height:none !important;transition:none;animation:ll-slide ${SLIDE_MS}ms ease-out}
  body #windows > .window:not(.floating) .win-resize{display:none}
}
@keyframes ll-slide{from{transform:translateX(-100%)}}
@media (prefers-reduced-motion:reduce){#app,#stage > #game,#scene-hud > .catch-feed{transition:none}body #windows > .window:not(.floating){animation:none}}`;
  document.head.append(style);

  const wide = matchMedia(WIDE);
  const docked = () => [...layer.querySelectorAll(':scope > .window:not(.floating):not([hidden])')];

  // ---------- The slideout ----------
  // The game measures its play area on window resize (Pixi, the window row, the sidebar), so a resize is
  // sent on every frame while the page slides, and once more at the end.
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

  // One docked window at a time: the newest stays, the others close through their own ✕ (the game's
  // close, so it forgets them the way it always does). The order they joined in is kept here.
  const joined = new Map(); // window element -> when it last became docked
  let tick = 0;
  let isOpen = false;
  function sync() {
    for (const el of [...joined.keys()]) if (!el.isConnected || el.classList.contains('floating') || el.hidden) joined.delete(el);
    for (const el of docked()) if (!joined.has(el)) joined.set(el, ++tick);
    if (wide.matches) {
      const list = [...joined].sort((a, b) => b[1] - a[1]).map(([el]) => el);
      for (const el of list.slice(1)) el.querySelector('.win-close')?.click();
    }
    const open = wide.matches && docked().length > 0;
    if (open !== isOpen) {
      isOpen = open;
      document.body.classList.toggle('ll-open', open);
      relayout();
    }
  }

  // ---------- Upgrades and Perks on one page ----------
  // The game draws five cards and a pager (ui.js renderUpgrades / renderPerks). Each time it draws one, the
  // five are swapped for every card, drawn the way the game draws them (copies of its helpers below), and
  // the pager goes. The cards are the game's own buttons (buy-upgrade, buy-perk).
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function gameIcon(key, size = 32) {
    const i = ICON_INDEX[key];
    if (i === undefined) return '';
    return `<span class="gicon s${size}" style="background-image:url(/assets/icons/raven-${size}.png);background-size:${ICON_COLS * size}px ${ICON_ROWS * size}px;background-position:-${(i % ICON_COLS) * size}px -${Math.floor(i / ICON_COLS) * size}px" aria-hidden="true"></span>`;
  }
  const rowIcon = (key, letter, color) => {
    const img = gameIcon(key);
    return img ? `<span class="icon has-img">${img}</span>` : `<span class="icon" style="--c:${color}">${esc(letter)}</span>`;
  };
  const goldAmt = (n) => `<span class="amt">${moneyHtml(n)}</span>`;
  const essenceAmt = (n) => `<span class="amt essence-text"><span class="essence-gem sm"></span><span>${fmtHtml(n)}</span></span>`;
  function effectText(def, level) {
    const info = STATS[def.stat];
    if (def.type === 'mult') return `×${fmtDecHtml(def.perLevel)} ${info.name} per level · now ×${fmtDecHtml(S.leveledEffect(def, level))}`;
    return `+${fmtDecHtml(def.perLevel)}${info.unit} ${info.name} per level · now +${fmtDecHtml(S.leveledEffect(def, level))}${info.unit}`;
  }
  function milestoneStar(def, level) {
    const next = S.nextMilestone(def, level);
    if (!next) return '';
    return `<span class="ms-star" title="Lv ${next}: +${Math.round((def.milestone - 1) * 100)}% of its effect again (${next - level} to go)">★ ${next}</span>`;
  }
  const ranksHtml = (def, level) =>
    def.maxLevel <= 10
      ? Array.from({ length: def.maxLevel }, (_, i) => `<i class="pip ${i < level ? 'on' : ''}"></i>`).join('')
      : `<span class="rank-bar"><span style="width:${Math.round((level / def.maxLevel) * 100)}%"></span></span>`;
  function upgradeCards() {
    const discount = S.upgradeDiscount();
    return UPGRADES.filter((u) => S.upgradeLevel(u.id) < u.maxLevel)
      .map((up) => {
        const level = S.upgradeLevel(up.id);
        const maxed = level >= up.maxLevel;
        const plan = S.purchasePlan(up, level, S.state.gold, discount);
        return `
      <button class="boon ${maxed ? 'max' : plan.affordable ? 'can' : ''}" data-action="buy-upgrade" data-id="${up.id}" data-tip="upg:${up.id}">
        ${rowIcon(`up:${up.id}`, up.type === 'mult' ? '×' : '+', up.type === 'mult' ? '#f472b6' : '#38bdf8')}
        <span class="boon-main">
          <span class="name">${esc(up.name)} <span class="muted">${level}/${up.maxLevel}</span> ${milestoneStar(up, level)}</span>
          <span class="sub">${effectText(up, level)}</span>
          <span class="ranks">${ranksHtml(up, level)}</span>
        </span>
        <span class="boon-cost">${maxed ? 'MAX' : `${plan.n > 1 ? `+${plan.n} · ` : ''}${goldAmt(plan.cost)}`}</span>
      </button>`;
      })
      .join('');
  }
  function perkCards() {
    const asc = S.state.ascension;
    return PERKS.filter((p) => S.perkLevel(p.id) < p.maxLevel)
      .map((perk) => {
        const level = S.perkLevel(perk.id);
        const maxed = level >= perk.maxLevel;
        const plan = S.purchasePlan(perk, level, asc.essence, 1, 1);
        const desc = perk.stat ? effectText(perk, level) : perk.desc;
        return `
      <button class="boon ${maxed ? 'max' : plan.affordable ? 'can' : ''}" data-action="buy-perk" data-id="${perk.id}" data-tip="perk:${perk.id}">
        ${rowIcon(`perk:${perk.id}`, '✦', '#a78bfa')}
        <span class="boon-main">
          <span class="name">${esc(perk.name)} <span class="muted">${level}/${perk.maxLevel}</span></span>
          <span class="sub">${desc}</span>
          <span class="ranks">${ranksHtml(perk, level)}</span>
        </span>
        <span class="boon-cost">${maxed ? 'MAX' : essenceAmt(plan.cost)}</span>
      </button>`;
      })
      .join('');
  }
  const PAGED = [
    { pager: 'upgrade-page', card: 'buy-upgrade', cards: upgradeCards },
    { pager: 'perk-page', card: 'buy-perk', cards: perkCards },
  ];
  // Where each window's list was scrolled to: the game's redraw puts five cards back first, which cuts the
  // scroll short before the full list returns
  const scrolled = new WeakMap();
  const onScroll = (e) => {
    if (e.target.classList?.contains('win-body')) scrolled.set(e.target, e.target.scrollTop);
  };
  layer.addEventListener('scroll', onScroll, true);
  function unpage() {
    for (const kind of PAGED) {
      for (const btn of layer.querySelectorAll(`.pager [data-action="${kind.pager}"]`)) {
        const pager = btn.closest('.pager');
        if (!pager?.isConnected) continue;
        const list = pager.parentElement;
        const body = pager.closest('.win-body');
        const old = [...list.querySelectorAll(`:scope > .boon[data-action="${kind.card}"]`)];
        let html;
        try {
          html = kind.cards();
        } catch (err) {
          console.warn('[left layout] Could not list every card; leaving the pages', err);
          continue;
        }
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        (old[0] ?? pager).before(tpl.content);
        for (const el of old) el.remove();
        pager.remove();
        if (body && scrolled.has(body)) body.scrollTop = scrolled.get(body);
      }
    }
  }

  // ---------- Watching the windows ----------
  const observer = new MutationObserver(() => {
    unpage();
    sync();
  });
  observer.observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  const onMedia = () => {
    sync();
    relayout();
  };
  wide.addEventListener('change', onMedia);
  unpage();
  sync();
  relayout();

  window.stopLeftLayout = () => {
    observer.disconnect();
    wide.removeEventListener('change', onMedia);
    layer.removeEventListener('scroll', onScroll, true);
    cancelAnimationFrame(slideFrame);
    document.body.classList.remove('ll-open');
    style.remove();
    viewCentre.remove('leftLayout');
    dispatchEvent(new Event('resize'));
    delete window.stopLeftLayout;
    console.log('[left layout] Off. Upgrades and Perks go back to pages the next time the game redraws them.');
  };
  console.log('[left layout] On: the sidebar is on the left and windows slide out from there. Turn it off with stopLeftLayout()');
};

idleAnglerMods.define({
  id: 'leftLayout',
  order: 70,
  name: "Left-hand layout",
  desc: "The sidebar down the left edge, and windows that slide out from the left one at a time, moving the game over instead of covering it (the scene slides over whole, so your angler stays in view). Upgrades and Perks list every card instead of five a page",
  start: leftLayout,
  stop: 'stopLeftLayout',
});
