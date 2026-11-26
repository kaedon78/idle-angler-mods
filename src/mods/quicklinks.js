// ==UserScript==
// @name         Idle Angler Quicklinks
// @version      2026-11-25.1
// @description  A sidebar on the right edge, with a panel of what most needs you right now
// @shared       view-centre
// @shared       chest-base
// @shared       edge-grip
// ==/UserScript==

// =====================================================================================================
// Quicklinks (was summary-panel.js, the Summary panel)
//
// It adds a second sidebar like the game's down the right edge, with a Quicklinks button. It slides out a panel, drawn as one of
// the game's windows, with what most needs you right now. While the panel is out, the game's bars move over
// to make room beside it (nothing is covered); the scene stays where it is at its full size, its right edge
// under the panel (the catch feed and the right sail tab come in), so the view doesn't move about as it
// slides; out on the water the camera eases your angler over to the middle of the part you see, and the
// big announcements ("Legendary!") show there too. The button again, or the panel's ✕, puts it away. Drag the
// panel's left edge to make it wider or narrower (double-click the edge to have it fit the bounty names again).
// The panel shows:
//  - At the top, the weather now (the forecast mod draws it; a click opens the forecast)
//  - Min-maxer: the income pills (that mod puts them here while both run), and under
//    them the 3 stats a +10% of is worth the most Gold/s (the Min-maxer's Gains tab); Open opens the Min-maxer
//  - Builds: the 6 pieces of gear you're wearing (click one to take it off, as on the paper doll), then
//    your saved gear sets; click one to put it on (its number key does too, with the build switcher on),
//    ⟳ saves what you're wearing over it, ✕ deletes it, and "+ Save what you're wearing" adds a new one
//  - Bounties: the three bounty rows, with their progress and Claim (or Reroll) buttons
//  - Ascend: how many times you've ascended, progress toward the next ascension (or the Oracle's target),
//    and the Oracle's "ascend for me" as buttons (Off, 1x-10x) beside the Ascend button
//  - Foreman: the upgrade it buys next (as the Upgrades window draws it, with its buy button), and what
//    it's buying (off, save up for the top of the list, or the next one you can afford)
//  - Chests: how many you have, what opening them all now pays on average, and Open all
//  - Bag: how full your bag is, then only the gear that's better for your build than what you're wearing
//    (by the Gear judge while it runs, with its time of day, weather and way of playing to pick above the list)
//  - Market: what's on sale now (as Market & Bounties > Market draws it; a click buys), when new stock
//    comes, and Restock
// Every button and dropdown here is the game's own: the panel sits inside the game's window layer, so
// a click runs exactly what the same button in the game's windows runs (the Ascend button asks first,
// Open all shows what came out, a click on gear opens the game's Put on / Sell / Lock menu,
// Ctrl-click sells and right-click locks, as in your bag). Each section's Open opens the game's
// window for it; a click on its title (or ▼) collapses it, which this browser remembers. The panel takes the Altar's black and crimson while you're in the basement.
// Stop it (and remove the panel) with:  stopSummaryPanel(), or untick it in Settings > Mods
// =====================================================================================================
const summaryPanel = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { RARITIES, STATS, ZONES, ZONE_BY_ID, BOUNTIES, SET_COLOR, AUTO_ASCEND_AT, AUTOMATION_BY_ID, GEAR_SETS, UPGRADE_BY_ID, SLOT_BY_ID, CHEST_GOLD, TREASURE_VALUE } = await mod('/src/data.js');
  const { fmt, fmtHtml, fmtDecHtml, fmtOdds, money, moneyHtml, hex } = await mod('/src/format.js');
  const { tierOdds, gearDropScale, rollChestContents } = await mod('/src/loot.js');
  const { GAIN_STATS, tenPercentPoints } = await mod('/src/minmax.js');
  const chestBase = chestBaseRule({ rollChestContents, RARITIES, CHEST_GOLD, ZONES, stats: S.getStats() }); // what a chest's value starts from, in this build
  const { describeBounty, bountyProgress, rewardTier } = await mod('/src/bounties.js');
  const { ICON_COLS, ICON_ROWS, ICON_INDEX } = await mod('/src/icon-index.js');

  window.stopSummaryPanel?.(); // replace one already running
  // Two starts at once (the Mods checkbox and a paste, say) both find none running while the game's files
  // load, so the newest one wins: each run has a token, and one that isn't the newest takes itself away
  // (its timer would otherwise keep putting its sidebar back). Anything an older copy left goes too.
  const run = {};
  window.summaryPanelRun = run;
  for (const id of ['qs-host', 'qs-hotbar', 'summary-style', 'qs-sidebar-style']) document.getElementById(id)?.remove();
  viewCentre.add('quicklinks'); // the camera centres on the part of the scene you see

  // The game's window layer: its click and change handlers (ui.js onAction / onChangeInput) run every
  // data-action button and data-change dropdown inside it, so the panel lives in there
  const layer = document.getElementById('windows');
  const app = document.getElementById('app');
  if (!layer || !app) return console.warn('[summary] The game page was not found (#windows, #app)');

  const STORE_KEY = 'idle-angler-summary-open';
  const FOLD_KEY = 'idle-angler-quicklinks-collapsed'; // section ids, as JSON
  const MAX_GEAR = 450;
  const SLIDE_MS = 180;
  // The panel's width: wide enough for each bounty's name on one line, between these (and never more
  // than half the window, or 85% of a narrow one). A name too long even then ends in "…" (hover for it).
  const MIN_W = 520;
  const MAX_W = 640;

  // ---------- The game's own helpers (copies from ui.js: it doesn't export them) ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tierColor = (tier) => hex(RARITIES[tier].color);
  const tierName = (tier) => RARITIES[tier].name;
  const itemColor = (item) => (item.set ? hex(SET_COLOR) : tierColor(item.tier));
  const disabled = (cond) => (cond ? 'disabled' : '');
  const pctText = (x) => `${x >= 0 ? '+' : ''}${Math.abs(x) >= 0.1 ? Math.round(x * 100) : (x * 100).toFixed(1)}%`;
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }
  function gameIcon(key, size = 32) {
    const i = ICON_INDEX[key];
    if (i === undefined) return '';
    return `<span class="gicon s${size}" style="background-image:url(/assets/icons/raven-${size}.png);background-size:${ICON_COLS * size}px ${ICON_ROWS * size}px;background-position:-${(i % ICON_COLS) * size}px -${Math.floor(i / ICON_COLS) * size}px" aria-hidden="true"></span>`;
  }
  const chestIcon = (tier) => `<span class="icon has-img" style="--c:${tierColor(tier)}">${gameIcon(`chest:${tier}`, 32)}</span>`;
  const SLOT_ICONS = { rod: 'fishing-pole', reel: 'spinning-wheel', line: 'rope-coil', hook: 'fishing-hook', bait: 'fishing-lure', charm: 'gem-pendant' };
  const itemArt = (item) =>
    gameIcon(`gear:${item.slot}:${Math.min(7, Math.max(0, item.level ?? 0))}`, 32) || `<span class="ui-icon" style="--icon:url(/assets/icons/ui/${SLOT_ICONS[item.slot]}.svg)"></span>`;
  // An automation not bought yet: the game's own note, a link to it in the Upgrades window
  const lockNote = (id) =>
    `<button class="muted small-text locked-note goto" data-action="goto" data-panel="automation">🔒 Unlock <b>${esc(AUTOMATION_BY_ID[id]?.name ?? id)}</b> in Upgrades (${moneyHtml(AUTOMATION_BY_ID[id]?.cost ?? 0)}, kept for good) <span class="goto-arrow">→</span></button>`;

  // ---------- Builds: the gear you're wearing and your gear sets (as Angler > Character draws them) ----------
  // The 6 gear squares (ui.js slotCell): click one to take it off, as on the paper doll
  const emptySlotArt = (slot) => gameIcon(`gear:${slot}:0`, 32) || `<span class="ui-icon" style="--icon:url(/assets/icons/ui/${SLOT_ICONS[slot]}.svg)"></span>`;
  function slotCell(slotId) {
    const item = S.itemByUid(S.state.equipped[slotId]);
    const slot = SLOT_BY_ID[slotId];
    if (!item) return `<div class="gear-slot empty" title="${esc(slot?.name ?? slotId)}: empty">${emptySlotArt(slotId)}<span class="slot-label">${esc(slot?.name ?? slotId)}</span></div>`;
    return `<button class="gear-slot q${item.ancient ?? 0} ${item.set ? 'set' : ''}" style="--c:${itemColor(item)}" data-action="unequip" data-slot="${slotId}" data-tip="item:${item.uid}" aria-label="${esc(S.itemName(item))}">
      ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span></button>`;
  }
  const priorityName = (key) => (key === 'gold' ? 'Income' : STATS[key]?.seekTier ? `${RARITIES[STATS[key].seekTier].name} odds` : STATS[key]?.name ?? key);
  function gearSetsHtml() {
    const st = S.state;
    const sets = st.gearSets ?? [];
    const keys = window.buildSwitcherKeys ?? 0; // the build switcher's 1-5, while it runs
    const cells = sets.map((set, i) => {
      const pieces = Object.entries(set.items ?? {});
      const have = pieces.filter(([, uid]) => S.itemByUid(uid)).length;
      const wearing = pieces.length > 0 && pieces.every(([slot, uid]) => st.equipped[slot] === uid);
      const key = i < keys ? `<kbd title="Press ${i + 1} to put this set on">${i + 1}</kbd>` : '';
      return `<div class="gearset">
        <button class="btn small ${wearing ? 'primary' : ''}" data-action="gearset-equip" data-index="${i}" title="Put this set on${set.priority ? ` (and its build: ${esc(set.priority.length ? set.priority.map(priorityName).join(', ') : 'Income')})` : ''}${key ? ` · or press ${i + 1}` : ''}">${key}${esc(set.name)} <span class="muted">${have}/${pieces.length}</span></button>
        <button class="btn small icon-btn" data-action="gearset-save" data-index="${i}" title="Save what you're wearing as ${esc(set.name)}">⟳</button>
        <button class="btn small icon-btn" data-action="gearset-delete" data-index="${i}" title="Delete ${esc(set.name)}">✕</button>
      </div>`;
    });
    if (sets.length < GEAR_SETS.max) cells.push(`<button class="btn small" data-action="gearset-save" data-index="${sets.length}">+ Save what you're wearing</button>`);
    return `<div class="gearsets">${cells.join('')}</div>`;
  }
  const buildsHtml = () => `<div class="qs-slots">${['rod', 'hook', 'reel', 'bait', 'line', 'charm'].map(slotCell).join('')}</div>${gearSetsHtml()}`;

  // ---------- Bounties (as the game's bounty board draws them) ----------
  const bountyBestZone = () => ZONES.filter((z) => S.state.zonesUnlocked.includes(z.id)).pop() ?? ZONES[0];
  function bountyRewardText(b) {
    const tier = Math.min(bountyBestZone().maxTier, rewardTier(bountyBestZone()) + (b.reward === 'gear' && b.stars === 3 ? 1 : 0));
    const rarity = `<span style="color:${tierColor(tier)}">${tierName(tier)}</span>`;
    if (b.reward === 'gold') return `<span class="gold-text">${BOUNTIES.goldMinutes[b.stars - 1]} minutes of income</span>`;
    if (b.reward === 'chests') return `${BOUNTIES.chestCount[b.stars - 1]} ${rarity}-or-better chests`;
    return `a piece of ${rarity}-or-better gear`;
  }
  const rewardIcon = (b) => {
    if (b.reward === 'chests') return chestIcon(Math.min(bountyBestZone().maxTier, rewardTier(bountyBestZone())));
    return `<span class="icon has-img">${gameIcon(b.reward === 'gold' ? 'cur:gold' : 'gear:charm:0', 32)}</span>`;
  };
  const finishedBounties = () => (S.state.bounties?.slots ?? []).filter((b) => b && bountyProgress(b, S.state.lifetimeGold) >= b.need).length;
  function bountiesHtml() {
    const st = S.state;
    const b = st.bounties;
    if (!b?.slots) return '<p class="muted small-text">No bounties yet.</p>';
    const now = Date.now();
    const free = now >= b.rerollAt;
    const rows = b.slots.map((bounty, i) => {
      if (!bounty) {
        return `<li class="row bounty-row empty">
          <div class="row-main muted">A new bounty comes in ${duration(b.nextAt[i] - now)}</div>
          ${free ? `<button class="btn small" data-action="bounty-reroll" data-index="${i}">Get one now</button>` : ''}
        </li>`;
      }
      const have = bountyProgress(bounty, st.lifetimeGold);
      const done = have >= bounty.need;
      return `<li class="row bounty-row ${done ? 'done' : ''}">
        ${rewardIcon(bounty)}
        <div class="row-main">
          <div class="name qs-line" title="${esc(describeBounty(bounty, fmt))}"><span class="qs-fit"><span class="stars" title="${bounty.stars} of 3 stars: bigger jobs pay more">${'★'.repeat(bounty.stars)}${'☆'.repeat(3 - bounty.stars)}</span> ${esc(describeBounty(bounty, fmt))}</span></div>
          <div class="xp-bar wide bounty-bar"><span style="width:${Math.min(100, (have / bounty.need) * 100).toFixed(1)}%"></span></div>
          <div class="sub">${bounty.kind === 'gold' ? `${moneyHtml(have)} / ${moneyHtml(bounty.need)}` : `${fmtHtml(have)} / ${fmtHtml(bounty.need)}`} · ${bountyRewardText(bounty)} and XP</div>
        </div>
        ${done ? `<button class="btn primary small" data-action="bounty-claim" data-index="${i}">Claim</button>` : `<button class="btn small" data-action="bounty-reroll" data-index="${i}" ${disabled(!free)} title="Swap this bounty for another">Reroll</button>`}
      </li>`;
    });
    return `<ul class="list bounties">${rows.join('')}</ul>
      <p class="muted small-text">${free ? 'You have a free reroll.' : `Next free reroll in ${duration(b.rerollAt - now)}.`}</p>`;
  }

  // ---------- Ascend and the Oracle (as the Ascension window draws them) ----------
  // The bar measures toward where the Oracle will ascend for you (its 1×-10×), or the requirement itself
  // while it's off or not bought. Its choice is a row of buttons, one per multiple the game offers: each
  // is the game's own auto-ascend control (data-change, the value the dropdown's option has), and a click
  // on the lit one sends 0, the dropdown's "off" (onOracle, below, hands it to the game's change handler).
  function ascendHtml() {
    const st = S.state;
    const req = S.ascensionRequirement();
    const oracle = S.hasAutomation('oracle');
    const at = oracle ? st.settings.autoAscendAt : 0;
    const target = req * (at || 1);
    const progress = Math.min(1, st.runGold / target);
    const can = S.canAscend();
    const goal = at ? `${moneyHtml(target)} <span class="muted">for the Oracle at ${at}×</span>` : `${moneyHtml(req)} needed`;
    // Off, then 1x-10x: the game's dropdown's options (AUTO_ASCEND_AT), the one set lit
    const choices = AUTO_ASCEND_AT.map((x) => {
      const on = (st.settings.autoAscendAt ?? 0) === x;
      const title = x ? `Ascend for me at ${x}× the requirement (${money(req * x)})` : "Don't ascend for me";
      return `<button type="button" class="btn small ${on ? 'primary' : ''}" data-change="auto-ascend" value="${x}" aria-pressed="${on}" title="${title}">${x ? `${x}x` : 'Off'}</button>`;
    }).join('');
    const ascendBtn = (wide) => `<button class="btn primary ${wide ? 'wide' : 'qs-ascend'}" data-action="ascend" ${disabled(!can)}>
        ${can ? `Ascend for +${fmtHtml(S.pendingEssence())} Essence` : `Ascend (${Math.min(100, (st.runGold / req) * 100).toFixed(1)}%)`}
      </button>`;
    return `<div class="qs-asc-count">Ascensions: <b>${fmtHtml(st.ascension.count)}</b></div>
      <div class="sub">Earned this run: <b>${moneyHtml(st.runGold)}</b> / ${goal}</div>
      <div class="progress"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>
      ${
        oracle
          ? `<div class="setting-select qs-oracle"><span>Oracle:</span><span class="qs-oracle-at">${choices}</span>${ascendBtn(false)}</div>`
          : `${ascendBtn(true)}${lockNote('oracle')}`
      }`;
  }

  // ---------- The Foreman (as the Upgrades window's Automation tab draws it) ----------
  // Its next upgrade: state.js nextAutoUpgrade, which isn't exported. The first on its list that isn't maxed,
  // or with "buy the next one I can afford", the first it can pay a level of now. When it can pay for none,
  // the one it buys first as gold comes in: the cheapest level (the earlier on the list on a tie).
  function foremanNext() {
    const set = S.state.settings;
    const discount = S.upgradeDiscount();
    let cheapest = null;
    for (const id of set.autoUpgradeOrder ?? []) {
      const up = UPGRADE_BY_ID[id];
      if (!up || S.upgradeLevel(id) >= up.maxLevel) continue;
      if (!set.autoUpgradeNextAfforded) return up;
      const cost = S.bulkCost(up, S.upgradeLevel(id), 1, discount);
      if (S.state.gold >= cost) return up;
      if (!cheapest || cost < cheapest.cost) cheapest = { up, cost };
    }
    return cheapest?.up ?? null;
  }
  // The upgrade's row as the Upgrades window draws it (ui.js renderUpgrades, effectText, milestoneText), without
  // its fold button. Its buy button buys what the window's x1 / x10 / Max would.
  function upgradeRowHtml(up) {
    const level = S.upgradeLevel(up.id);
    const plan = S.purchasePlan(up, level, S.state.gold, S.upgradeDiscount());
    const info = STATS[up.stat];
    const effect = !info
      ? ''
      : up.type === 'mult'
        ? `×${fmtDecHtml(up.perLevel)} ${info.name} per level · now ×${fmtDecHtml(S.leveledEffect(up, level))}`
        : `+${fmtDecHtml(up.perLevel)}${info.unit} ${info.name} per level · now +${fmtDecHtml(S.leveledEffect(up, level))}${info.unit}`;
    const next = S.nextMilestone(up, level);
    const milestone = next ? `<div class="milestone">★ Lv ${next}: +${Math.round((up.milestone - 1) * 100)}% of its effect again <span class="muted">(${next - level} to go)</span></div>` : '';
    const sign = up.type === 'mult' ? ['×', '#f472b6'] : ['+', '#38bdf8'];
    return `<ul class="list qs-next-up"><li class="row">
        <span class="icon" style="--c:${sign[1]}">${sign[0]}</span>
        <div class="row-main">
          <div class="name">${esc(up.name)} <span class="muted">Lv ${level}/${up.maxLevel}</span></div>
          <div class="sub">${effect}</div>
          ${milestone}
        </div>
        <button class="btn primary buy" data-action="buy-upgrade" data-id="${up.id}" ${disabled(!plan.affordable)}>
          ${plan.n > 1 ? `+${plan.n} · ` : ''}<span class="amt">${moneyHtml(plan.cost)}</span>
        </button>
      </li></ul>`;
  }
  function foremanHtml() {
    if (!S.hasAutomation('foreman')) return lockNote('foreman');
    const set = S.state.settings;
    const mode = !set.autoUpgrade ? 'off' : set.autoUpgradeNextAfforded ? 'next' : 'save';
    const listed = (set.autoUpgradeOrder ?? []).length;
    const up = foremanNext();
    const nextRow = up
      ? upgradeRowHtml(up)
      : listed
        ? '<p class="muted small-text">Everything on its list is maxed</p>'
        : '';
    return `${nextRow}<label class="setting-select">Buying <select data-change="autoup-mode" aria-label="How Foreman buys upgrades">${[
      ['off', 'Off'],
      ['save', 'Save up for the top of the list'],
      ['next', 'Buy the next one I can afford'],
    ]
      .map(([v, label]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`)
      .join('')}</select></label>
      <p class="muted small-text">${listed ? `${listed} upgrade${listed === 1 ? '' : 's'} on its list` : 'Its list is empty: nothing is bought'} · <button class="goto" data-action="goto" data-panel="automation">Change the list <span class="goto-arrow">→</span></button></p>`;
  }

  // ---------- The best +10% (the Min-maxer's Gains tab, minmax-ui.js renderGains) ----------
  // The same sum: each stat 10% higher than you have it, through the game's own goldPerSecond at your
  // clicks a second here, against what you make now. Worked out again every 5 s, or when the zone, clicking
  // or the main stats change (as the game does).
  const GAINS_SHOWN = 3;
  let gainsCache = { at: 0, key: '', rows: [] };
  function gainsHtml() {
    const stats = S.getStats();
    const zone = S.currentZone();
    const c = S.clickRate();
    const key = `${zone.id}|${c.toFixed(1)}|${stats.valueMult}|${stats.luckMult}|${stats.multiCatch}`;
    if (Date.now() - gainsCache.at > 5000 || gainsCache.key !== key) {
      const base = S.goldPerSecond(stats, zone, c);
      const rows = GAIN_STATS.map((stat) => {
        const points = tenPercentPoints(stats, stat);
        const with10 = S.goldPerSecond(S.statsWithBonus(stat, points), zone, c);
        return { stat, points, gain: base > 0 ? with10 / base - 1 : 0 };
      }).sort((a, b) => b.gain - a.gain);
      gainsCache = { at: Date.now(), key, rows };
    }
    const top = gainsCache.rows.filter((r) => r.gain >= 0.0005).slice(0, GAINS_SHOWN); // the Min-maxer's "no effect" line
    if (!top.length) return '<p class="muted small-text">No stat raises your Gold here.</p>';
    const best = top[0].gain;
    const rows = top
      .map(({ stat, points, gain }) => `<tr data-tip="stat:${stat}"><td>${esc(STATS[stat]?.name ?? stat)}</td><td class="muted">+${fmtDecHtml(points)} pts</td><td><b>+${(gain * 100).toFixed(2)}%</b></td><td><span class="mm-bar"><i style="width:${((gain / best) * 100).toFixed(1)}%"></i></span></td></tr>`)
      .join('');
    return `<table class="mm-table mm-gains"><tr><th>Best +10%</th><th>Bonus</th><th>Gold/min</th><th></th></tr>${rows}</table>`;
  }

  // ---------- Chests ----------
  // What opening them all now pays on average. A chest's contents are rolled when it's opened, with your
  // stats then (state.js rollChests, loot.js rollChestContents), so this is that roll's average with your
  // stats now: its coin, and each roll's treasure (a rarity from chest luck, no lower than 2 under the
  // chest's: loot.js tierOddsFrom) unless the roll is gear (CHEST_ITEM_CHANCE, not exported). Gear isn't
  // priced: it's counted. A Golden Fish's Gold Rush counts for less when opening (state.js
  // withGoldenForChests, not exported), so while one is on this reads high.
  const CHEST_ITEM_CHANCE = 0.35;
  function chestWorth(owned) {
    const s = S.getStats();
    const chestValue = s.chestValueMult ?? 1; // Plunderer, Magpie, Fortune's Embrace
    let coin = 0, treasure = 0, gear = 0;
    for (const { zone, tier, count } of owned) {
      const base = chestBase(s, zone);
      coin += count * base * RARITIES[tier].valueMult * CHEST_GOLD * s.valueMult * chestValue;
      const odds = tierOdds(s.chestLuckMult, Math.min(RARITIES.length - 1, zone.maxTier + 1));
      const floor = Math.max(0, tier - 2);
      const perTreasure = base * odds.reduce((t, q, i) => t + (q || 0) * RARITIES[Math.max(i, floor)].valueMult, 0) * TREASURE_VALUE * s.treasureMult * chestValue;
      const rolls = count * (1 + Math.floor(tier / 2));
      const gearShare = CHEST_ITEM_CHANCE * gearDropScale(s, zone);
      treasure += rolls * (1 - gearShare) * perTreasure;
      gear += rolls * gearShare;
    }
    return { coin, treasure, gear };
  }

  function chestsHtml() {
    const owned = Object.entries(S.state.chests ?? {})
      .map(([key, count]) => {
        const [zoneId, tier] = key.split(':');
        return { count, zone: ZONE_BY_ID[zoneId], tier: Number(tier) };
      })
      .filter((c) => c.zone && c.count > 0);
    const total = owned.reduce((n, c) => n + c.count, 0);
    const byTier = new Map();
    for (const c of owned) byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + c.count);
    const kinds = [...byTier]
      .sort((a, b) => b[0] - a[0])
      .map(([tier, n]) => `<span style="color:${tierColor(tier)}">${fmtHtml(n)} ${esc(tierName(tier))}</span>`)
      .join(' · ');
    const best = owned.length ? Math.max(...owned.map((c) => c.tier)) : 0;
    let worth = '';
    if (total) {
      const { coin, treasure, gear } = chestWorth(owned);
      const sold = S.state.settings?.autoSellTreasure && S.state.automations?.pawnbroker; // as applyChests sells it
      const title = `Opening them all now pays about ${money(coin + treasure)} on average: ${money(coin)} in coin and ${money(treasure)} in treasure`
        + (sold ? ', which the Pawnbroker sells at once.' : ', which goes to your bag to sell.')
        + ` About ${fmt(Math.round(gear))} pieces of gear come out too (not counted).`
        + ' Chests are priced when you open them, with your gear, weather and time of day then, so this moves with them.';
      worth = `<div class="sub" title="${esc(title)}">Worth about <b>${moneyHtml(coin + treasure)}</b>${sold ? '' : ' with treasure sold'}</div>`;
    }
    return `<div class="qs-chests">
        ${chestIcon(best)}
        <div class="row-main"><div class="name">${total ? `${fmtHtml(total)} chest${total === 1 ? '' : 's'}` : 'No chests'}</div>${kinds ? `<div class="sub">${kinds}</div>` : ''}${worth}</div>
        <button class="btn primary" data-action="open-every-chest" ${disabled(!total)}>Open all</button>
      </div>`;
  }

  // ---------- Upgrades in the bag ----------
  // The same test as the game's ▲ badge on Bags: loose gear you can wear that improves your build by
  // more than half a percent (S.upgradeValue). Worked out every 2 s, as the game does, or at once when
  // your gear, build or level changes.
  // With the Gear judge on, its measure instead (over a whole day of weather, or the time, weather and way of
  // playing picked above the list), and its answers as they come in. The Market section uses it too.
  const gear = { at: 0, sig: '', list: [] };
  const judge = () => window.gearJudge;
  const gearSig = () =>
    [S.state.player?.level, JSON.stringify(S.state.equipped), JSON.stringify(S.state.settings.buildPriority ?? []), S.looseGear().map((i) => i.uid + (i.locked ? 'L' : '')).join(','), judge() ? `j${judge().version}:${judgeSeen}` : ''].join('|');
  let judgeSeen = 0; // bumped as the judge's answers come in
  const upgradeOf = (item) => (judge() ? judge().change(item) : S.upgradeValueOf(item).change);
  function upgrades() {
    const now = performance.now();
    const sig = gearSig();
    if (sig === gear.sig && now - gear.at < 2000) return gear.list;
    gear.at = now;
    gear.sig = sig;
    // A piece for a slot you have nothing in is always an upgrade, whatever it adds: those come first
    gear.list = S.looseGear()
      .filter((i) => S.canWear(i))
      .map((item) => ({ item, up: judge() ? judge().change(item) : S.upgradeValue(item.uid).change, empty: !S.state.equipped[item.slot] }))
      .filter((x) => x.empty || x.up > 0.005)
      .sort((a, b) => b.empty - a.empty || (b.up ?? 0) - (a.up ?? 0) || (b.item.ilvl ?? 0) - (a.item.ilvl ?? 0));
    return gear.list;
  }
  // The Gear judge's time of day, weather and how you play, as three of the game's dropdowns
  function judgePicker() {
    const j = judge();
    if (!j) return '';
    const label = { time: 'Judge gear for this time of day', weather: 'Judge gear for this weather', activity: 'Judge gear for how you play: clicking as now, idle, or with the Auto-clicker; or for opening chests (the money and treasure in them)' };
    const select = (kind, list, now) =>
      `<select data-qs-judge="${kind}" aria-label="${label[kind]}" title="${label[kind]}">${list.map(([id, name]) => `<option value="${id}" ${id === now ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
    return `<div class="setting-select qs-judge"><span>Upgrades For:</span>${select('time', j.times, j.pick.time)}${select('weather', j.weathers, j.pick.weather)}${j.activities ? select('activity', j.activities, j.pick.activity) : ''}</div>`;
  }
  // Its ▲: the change for your build; for a slot you have nothing in, ▲ alone until it adds over ½%
  const emptyFor = (item) => S.canWear(item) && !S.state.equipped[item.slot];
  const upBadge = (item, up) =>
    up > 0.005
      ? `<span class="upg up">▲${pctText(up).replace('+', '')}</span>`
      : emptyFor(item)
        ? `<span class="upg up" title="Your ${esc(SLOT_BY_ID[item.slot]?.name ?? item.slot)} slot is empty: anything for it is an upgrade">▲</span>`
        : '';
  // A piece in your bag, as Bags > Gear draws it (ui.js renderBagGear), with the badge given
  function gearCell(item, badge) {
    const inSet = S.inGearSet(item.uid);
    const cls = [`q${item.ancient ?? 0}`, item.set ? 'set' : '', item.locked ? 'locked' : '', inSet ? 'in-set' : ''].join(' ');
    return `<button class="bag-cell ${cls}" style="--c:${itemColor(item)}" data-action="bag-item" data-uid="${item.uid}" data-tip="item:${item.uid}" aria-label="${esc(S.itemName(item))}">
      ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span>${badge}${item.locked ? '<span class="lock" title="Locked">🔒</span>' : ''}${inSet ? '<span class="set-mark" title="In a saved gear set">◆</span>' : ''}</button>`;
  }
  // The Gear judge's sets worth putting on together: the set, how many pieces with the ones you wear, the
  // change, and the pieces to put on (each the game's bag button: a click puts it on, as in Bags)
  const setGroups = () => judge()?.groups?.() ?? [];
  const setUpBadge = (g) => `<span class="upg up" style="color:${hex(SET_COLOR)}" title="${esc(judge().setNote(g))}">▲${pctText(g.change).replace('+', '')}</span>`;
  function setsHtml() {
    return setGroups()
      .map((g) => {
        const up = pctText(g.change).replace('+', '');
        const badge = setUpBadge(g);
        // A piece from the Market: its stall (a click buys it); one in your bag: its bag button (a click puts it on)
        const stock = S.state.shop?.stock ?? [];
        const cell = (it) => {
          const i = stock.findIndex((x) => x.type === 'item' && x.item === it);
          return i >= 0 ? stallCell(stock[i], i, badge) : gearCell(it, badge);
        };
        const what = g.shop ? `buy ${g.shop === g.items.length ? (g.shop === 2 ? 'both' : `all ${g.shop}`) : g.shop} from the Market${g.shop < g.items.length ? ', then put on these' : ' and put them on'}` : `put on these ${g.items.length}`;
        return `<div class="qs-set-group" title="${esc(judge().setNote(g))}"><div class="qs-set-name"><b style="color:${hex(SET_COLOR)}">${esc(g.name)}</b>
          <span class="muted small-text">${g.pieces} pieces${g.worn ? ` (${g.worn} on now)` : ''}: ${what}</span><b class="qs-set-up">▲${up}</b></div>
          <div class="bag-grid">${g.items.map(cell).join('')}</div></div>`;
      })
      .join('');
  }
  // How full your bag is, as Bags counts it (its "Bag 34/40" tab): loose gear against the room you have.
  // When it's full, gear you catch or are given is sold, and the Market sells you no more (state.js bagFull)
  function bagHtml() {
    const used = S.looseGear().length;
    const room = S.inventorySize?.() ?? 0;
    if (!room) return '';
    const free = Math.max(0, room - used);
    const full = free === 0;
    const tight = !full && free <= Math.max(2, Math.ceil(room * 0.1));
    const title = full
      ? 'Your bag is full: gear you catch, open or are given is sold, and the Market can’t sell you any. Sell or salvage some to make room.'
      : `${free} of ${room} spaces free in your bag`;
    return `<div class="qs-bag ${full ? 'full' : tight ? 'tight' : ''}" title="${esc(title)}"><span>Bag ${used}/${room}</span>
      <div class="progress"><div style="width:${Math.min(100, (used / room) * 100).toFixed(1)}%"></div></div><b>${full ? 'Full' : `${free} free`}</b></div>`;
  }
  function gearHtml() {
    const list = upgrades();
    const picker = bagHtml() + judgePicker();
    const groups = setsHtml();
    const waiting = judge()?.pending ? '<p class="muted small-text">Judging your gear…</p>' : '';
    if (!list.length && !groups) return `${picker}${waiting || `<p class="muted small-text">Nothing in your bag beats what you’re wearing for ${esc(judge()?.aim?.() ?? 'your build')}.</p>`}`;
    const cells = list.slice(0, MAX_GEAR).map(({ item, up }) => gearCell(item, upBadge(item, up)));
    const more = list.length > MAX_GEAR ? `<p class="muted small-text">…and ${list.length - MAX_GEAR} more in your bag</p>` : '';
    const grid = cells.length ? `${groups ? '<div class="qs-set-name"><b>One piece at a time</b></div>' : ''}<div class="bag-grid">${cells.join('')}</div>` : '';
    return `${picker}${groups}${grid}${more}<p class="muted small-text center">Click gear to put it on, sell or lock it · Ctrl-click sells · Right-click locks</p>`;
  }

  // ---------- The Market (as Market & Bounties > Market draws it, ui.js renderMarket) ----------
  // What's on sale now, sold ones too, with when new stock comes and the Restock button. A click buys,
  // as in the Market: the game's own buy (data-action="buy-shop", with the same index and want).
  const goldAmt = (n) => `<span class="amt">${moneyHtml(n)}</span>`;
  function marketHtml() {
    const shop = S.state.shop;
    if (!shop?.stock) return '<p class="muted small-text">The Market isn’t open here.</p>';
    const reroll = S.shopRerollCost();
    let html = `<div class="qs-market-head"><span class="muted small-text">New stock in ${duration(shop.refreshAt - Date.now())}</span>
      <button class="btn small" data-action="reroll-shop" ${disabled(S.state.gold < reroll)}>Restock · ${goldAmt(reroll)}</button></div><div class="stall">`;
    shop.stock.forEach((slot, i) => {
      if (slot.type === 'item') {
        const item = slot.item;
        const up = upgradeOf(item) ?? 0;
        const g = judge()?.groupOf?.(item.uid);
        const badge = g && g.change > up ? setUpBadge(g) : emptyFor(item) || up > 0.005 ? upBadge(item, up) : up < -0.005 ? '<span class="upg down">▼</span>' : '';
        html += stallCell(slot, i, badge);
      } else {
        html += stallCell(slot, i, '');
      }
    });
    return `${html}</div>`;
  }
  // One of the Market's stalls, as renderMarket draws it: a click buys (the game's buy-shop, its index and want)
  function stallCell(slot, i, badge) {
    const afford = S.state.gold >= slot.price;
    const want = esc(slot.type === 'item' ? `item:${slot.item.uid}` : `chest:${slot.zone}:${slot.tier}:${slot.price}`);
    const buy = slot.sold ? '' : `data-action="buy-shop" data-index="${i}" data-want="${want}"`;
    const price = slot.sold ? 'SOLD' : goldAmt(slot.price);
    if (slot.type === 'item') {
      const item = slot.item;
      return `<button class="bag-cell stall-cell q${item.ancient ?? 0} ${item.set ? 'set' : ''} ${slot.sold ? 'sold' : afford ? 'can' : ''}" style="--c:${itemColor(item)}" ${buy} data-tip="shop:${i}" aria-label="${esc(S.itemName(item))}, ${slot.sold ? 'sold' : 'for ' + slot.price}">
          ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span>${badge}<span class="t-cost">${price}</span></button>`;
    }
    return `<button class="bag-cell stall-cell chest ${slot.sold ? 'sold' : afford ? 'can' : ''}" style="--c:${tierColor(slot.tier)}" ${buy} title="${esc(`${tierName(slot.tier)} Chest · ${fmtOdds(RARITIES[slot.tier].oneIn)} · ${ZONE_BY_ID[slot.zone]?.name ?? ''} · ${1 + Math.floor(slot.tier / 2)} loot roll${slot.tier >= 2 ? 's' : ''}`)}" aria-label="${tierName(slot.tier)} Chest">
          ${chestIcon(slot.tier)}<span class="t-cost">${price}</span></button>`;
  }
  // The count by its title: how many are still for sale, and ▲ when one is an upgrade (the game's badge)
  const marketCount = () => {
    const left = (S.state.shop?.stock ?? []).filter((slot) => !slot.sold);
    const up = left.some((slot) => slot.type === 'item' && (emptyFor(slot.item) || (upgradeOf(slot.item) ?? 0) > 0.005 || judge()?.groupOf?.(slot.item.uid)));
    return left.length ? `${left.length} for sale${up ? ' · ▲' : ''}` : '';
  };

  // ---------- The sidebar's look: the game's own (#hotbar), copied ----------
  // The game styles its sidebar by id (#hotbar, #actionbar), in many layers. Every rule for them in its
  // stylesheet is copied here for the Quicklinks sidebar's ids, so it looks and opens exactly like the
  // game's, and keeps doing so when the game restyles it. Rules that reach outside the sidebar (the
  // windows' room beside it, the level and ascension bars, the collapse button) are left out.
  const splitSelectors = (text) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && !depth) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const sidebarRule = (sel) => /#(hotbar|actionbar)(?![\w-])/.test(sel) && !/#windows|#xp-row|#asc-row|#hotbar-pin|:has\(/.test(sel);
  const ourIds = (sel) => sel.replace(/#hotbar(?![\w-])/g, '#qs-hotbar').replace(/#actionbar(?![\w-])/g, '#qs-actionbar');
  function copyRules(rules) {
    let css = '';
    for (const r of rules) {
      if (r.selectorText !== undefined && r.style) {
        const parts = splitSelectors(r.selectorText).filter(sidebarRule).map(ourIds);
        if (parts.length) css += `${parts.join(',')}{${r.style.cssText}}\n`;
      } else if (r.cssRules && r.conditionText !== undefined) {
        const inner = copyRules(r.cssRules);
        const at = r instanceof CSSMediaRule ? 'media' : r instanceof CSSSupportsRule ? 'supports' : null;
        if (inner && at) css += `@${at} ${r.conditionText}{${inner}}\n`;
      }
    }
    return css;
  }
  const sidebarStyle = document.createElement('style');
  sidebarStyle.id = 'qs-sidebar-style';
  for (const sheet of document.styleSheets) {
    if (!sheet.href || new URL(sheet.href).origin !== location.origin) continue; // the game's own stylesheet
    try {
      sidebarStyle.textContent += copyRules(sheet.cssRules);
    } catch {
      // unreadable sheet: skipped
    }
  }
  document.head.append(sidebarStyle);

  // ---------- Styles ----------
  const RIBBON_RISE = 16; // the window's title ribbon rises 12px above its frame: the frame starts this far down
  const style = document.createElement('style');
  style.id = 'summary-style';
  style.textContent = `
:root{--qs-w:min(${MIN_W}px,85vw)}
body.qs-open #app{margin-right:var(--qs-w)}
body.qs-open{--qs-push:var(--qs-w)}
#app{transition:margin ${SLIDE_MS}ms ease-out}
/* The scene keeps its full size while the page makes room (a window on the left, Quicklinks on the right):
   it reaches past the page's right edge by however far the page is pushed, on the same timing, so the game
   never lays it out again (that moves the whole view about). The catch feed and the right sail tab come
   back in by as much, to stay on screen. The camera aims for the middle of the part you see (viewCentre).
   Left-hand layout and Quicklinks both have this rule */
#stage > #game{right:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)));transition:right ${SLIDE_MS}ms ease-out}
#scene-hud > .catch-feed{margin-right:calc(var(--ll-push, 0px) + var(--qs-push, 0px));transition:margin-right ${SLIDE_MS}ms ease-out}
#scene-hud > .sail-arrow.right{margin-left:calc(-1 * (var(--ll-push, 0px) + var(--qs-push, 0px)))}
body.qs-open .corner-btn,body.qs-open #bmc-wbtn{margin-right:var(--qs-w)}
/* The panel is one of the game's windows (frame, ribbon, corners, glass), held at the right edge, full height */
#windows #summary-panel.window{position:fixed;top:${RIBBON_RISE}px !important;right:0 !important;bottom:0 !important;left:auto !important;
  width:var(--qs-w) !important;height:auto !important;max-height:none !important;margin:0;display:flex;flex-direction:column;z-index:1;
  pointer-events:auto;transform:translateX(calc(100% + 16px));visibility:hidden;
  transition:transform ${SLIDE_MS}ms ease-out,visibility 0s linear ${SLIDE_MS}ms}
body.qs-open #windows #summary-panel.window{transform:none;visibility:visible;transition:transform ${SLIDE_MS}ms ease-out,visibility 0s}
/* The weather starts right under the header (the game leaves 30px above a window's contents when it has no tabs) */
#summary-panel > .win-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding-top:0}
#qs-weather{flex:none;margin:0 0 6px;cursor:pointer}
#qs-weather:empty{display:none}
#qs-weather .wf-now{margin:0}
#qs-weather:hover .wf-now{filter:brightness(1.12)}
#summary-panel .qs-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 2px 8px}
#summary-panel section{margin:0 0 10px}
/* Section titles as the game draws a foldable section's heading (Settings > General): 13px, regular, in
   the accent colour, with the same ▼ / ▶ marker */
#summary-panel h3{display:flex;align-items:baseline;gap:8px;margin:2px 0 4px;padding:3px 0;font-size:13px;font-weight:400;color:var(--accent)}
#summary-panel h3 .goto{margin-left:auto;font-size:.92em;font-weight:400}
#summary-panel .qs-fold{display:inline-flex;align-items:baseline;gap:0;padding:0;font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#summary-panel .qs-chev{display:list-item;list-style:disclosure-open inside;width:auto;font-size:inherit}
#summary-panel .qs-collapsed .qs-chev{list-style-type:disclosure-closed}
#summary-panel .qs-collapsed .qs-content{display:none}
#summary-panel section.qs-collapsed{margin-bottom:4px}
#summary-panel .qs-count{color:var(--muted);font-weight:400;font-size:.85em}
#summary-panel .bounties.list{margin:4px 0}
/* Bounty rows, tighter than the game's: less padding and a slimmer progress bar */
#summary-panel .bounty-row{padding-top:1px;padding-bottom:1px;min-height:0}
#summary-panel .bounty-row .name{font-size:.95em}
#summary-panel .bounty-row .bounty-bar{height:6px;margin:2px 0}
#summary-panel .qs-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#summary-panel .row-main{min-width:0}
#summary-panel .progress{margin:4px 0 6px}
#summary-panel .qs-asc-count{margin:2px 0 4px}
#summary-panel .qs-slots{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}
#summary-panel .qs-slots .gear-slot{flex:none}
#summary-panel .gearsets{justify-content:start;margin:4px 0}
#summary-panel .gearset .btn kbd{margin-right:6px}
#summary-panel .btn.wide{width:100%}
#summary-panel .setting-select{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:6px 0 0}
#summary-panel .setting-select select{flex:1 1 140px;min-width:0}
#summary-panel .qs-oracle .qs-oracle-at{display:flex;gap:4px}
/* One line: Oracle:, its multiples, then Ascend at the right end */
#summary-panel .setting-select.qs-oracle{flex-wrap:nowrap;gap:4px 6px}
#summary-panel .qs-oracle .qs-oracle-at .btn{min-width:32px;padding-left:6px;padding-right:6px}
#summary-panel .qs-oracle .qs-ascend{margin-left:auto;white-space:nowrap}
/* Market squares the size of the gear squares above (the game's stall stretches 6 across the width) */
#summary-panel [data-qs="market"] .stall{grid-template-columns:repeat(auto-fill,58px);gap:6px}
#summary-panel [data-qs="market"] .stall-cell.chest .icon{width:40px;height:40px}
#summary-panel .qs-set-group{margin:2px 0 8px}
#summary-panel .qs-set-name{display:flex;align-items:baseline;gap:6px;margin:4px 0 2px}
#summary-panel .qs-set-name .qs-set-up{margin-left:auto;color:${hex(SET_COLOR)}}
/* "Upgrades For:" on a line of its own, so the three dropdowns below it have the width to show their whole names */
#summary-panel .setting-select.qs-judge{flex-wrap:wrap;gap:2px 8px;margin:2px 0 6px}
#summary-panel .qs-judge > span{flex:1 0 100%}
/* Bag space: Bag 34/40, a slim bar, and what's free (amber when nearly full, red when full) */
#summary-panel .qs-bag{display:flex;align-items:center;gap:8px;margin:2px 0 6px;font-size:.9em}
#summary-panel .qs-bag > span{color:var(--muted);white-space:nowrap}
#summary-panel .qs-bag .progress{flex:1;height:6px;margin:0}
#summary-panel .qs-bag b{white-space:nowrap}
#summary-panel .qs-bag.tight .progress > div{background:#f59e0b}
#summary-panel .qs-bag.tight b{color:#f59e0b}
#summary-panel .qs-bag.full .progress > div{background:var(--danger,#ef4444)}
#summary-panel .qs-bag.full b{color:var(--danger,#ef4444)}
#summary-panel .qs-judge select{flex:1 1 0;min-width:0}
#summary-panel .qs-market-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0 6px}
#summary-panel .locked-note{display:block;width:100%;margin-top:6px;text-align:left}
#summary-panel p{margin:4px 0}
#summary-panel .qs-chests{display:flex;align-items:center;gap:8px}
#summary-panel .qs-chests .row-main{flex:1}
#summary-panel .bag-grid{justify-content:start;margin:6px 0}
#summary-panel .qs-next-up{margin:4px 0 0}
#qs-pills:has(#measured-rate-wrap) .qs-pills-off{display:none}
/* Top to bottom: the pills, then the best +10% (the pills mod appends its pills; this orders them) */
#qs-pills{display:flex;flex-direction:column}
#qs-pills #measured-rate-wrap{order:1}
#qs-pills .qs-gains{order:2;margin:2px 0}
#summary-panel .mm-gains td:nth-child(4){width:35%}
/* The Quicklinks sidebar: the game's sidebar (rules copied above), down the right edge. placeBar sets its top */
#qs-hotbar{left:auto !important;right:6px !important;bottom:auto !important}
/* Its icon: a lightning bolt drawn like the game's sidebar icons (a filled shape on a 512 square, shown
   through the same --icon mask, so it takes the buttons' colour and size) */
#qs-hotbar #qs-toggle .qs-icon{--icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cpath fill='%23fff' d='M313 18 88 290h139l-50 204 247-288H285l60-188z'/%3E%3C/svg%3E")}
/* Phones: the game hides its line map under an open window; the panel (always there, even put away) doesn't count */
@media (max-width:640px){body:not(:has(#windows .window:not(#summary-panel))) #metro{visibility:visible}}
@media (prefers-reduced-motion:reduce){#app,#stage > #game,#scene-hud > .catch-feed,#windows #summary-panel.window{transition:none}}`;
  document.head.append(style);

  // ---------- The panel ----------
  const SECTIONS = [
    // The income pills mod moves its pills into #qs-pills (it listens for idle-angler-quicklinks);
    // this section draws only the best +10% (.qs-gains), which CSS orders between them
    { id: 'stats', title: 'Min-maxer', panel: 'minmax', html: gainsHtml },
    { id: 'character', title: 'Builds', panel: 'character', html: buildsHtml, count: () => `${(S.state.gearSets ?? []).length}/${GEAR_SETS.max}` },
    { id: 'bounties', title: 'Bounties', panel: 'bounties', html: bountiesHtml, count: () => { const n = finishedBounties(); return n ? `${n} to claim` : ''; } },
    { id: 'ascend', title: 'Ascend', panel: 'ascend', html: ascendHtml },
    { id: 'foreman', title: 'Foreman', panel: 'automation', html: foremanHtml },
    { id: 'chests', title: 'Chests', panel: 'chests', html: chestsHtml },
    { id: 'gear', title: 'Bag', panel: 'bags', html: gearHtml, count: () => { const n = upgrades().length; const g = setGroups().length; return [n ? String(n) : '', g ? `${g} set${g === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '); } },
    { id: 'market', title: 'Market', panel: 'market', html: marketHtml, count: marketCount },
  ];
  // A window as the game builds one (windows.js), without its undock / pin buttons or resize grip. It sits
  // in a box of its own inside the window layer, so the game's buttons inside it work, while the layout
  // mods (which look for the layer's own windows) leave it alone.
  const host = document.createElement('div');
  host.id = 'qs-host';
  const panel = document.createElement('section');
  panel.id = 'summary-panel';
  panel.className = 'window';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Quicklinks');
  // The weather now, at the top above the sections: the forecast mod draws its now box into it (empty without it)
  panel.innerHTML = `<header class="win-head"><div class="win-title"><h2>Quicklinks</h2></div><div class="win-tools"><button class="win-close" type="button" aria-label="Hide Quicklinks" title="Hide Quicklinks">✕</button></div></header>
    <div class="win-body"><div id="qs-weather" title="Open the forecast (W)"></div><div class="qs-body">${SECTIONS.map(
      (s) => `<section data-qs="${s.id}"><h3><button type="button" class="qs-fold" aria-expanded="true" title="Collapse"><span class="qs-chev" aria-hidden="true"></span>${esc(s.title)}</button> <span class="qs-count"></span><button class="goto" data-action="goto" data-panel="${s.panel}" title="Open the game's window for this">Open <span class="goto-arrow">→</span></button></h3><div class="qs-content"></div></section>`,
    ).join('')}</div></div>
    <i class="win-corner tl"></i><i class="win-corner tr"></i><i class="win-corner bl"></i><i class="win-corner br"></i>`;
  const pillsHost = panel.querySelector('[data-qs="stats"] .qs-content');
  pillsHost.id = 'qs-pills';
  pillsHost.innerHTML = '<p class="muted small-text qs-pills-off">Turn on Income pills in Settings &gt; Mods (or install its script) to see them here.</p><div class="qs-gains"></div>';
  panel.querySelector('[data-qs="stats"] .goto').title = 'Open the Min-maxer';
  host.append(panel);
  layer.append(host);
  dispatchEvent(new Event('idle-angler-quicklinks'));
  const parts = SECTIONS.map((s) => {
    const el = panel.querySelector(`[data-qs="${s.id}"]`);
    return { ...s, el, content: el.querySelector('.qs-gains') ?? el.querySelector('.qs-content'), countEl: el.querySelector('.qs-count'), last: null, lastCount: null };
  });
  const onClose = () => setOpen(false);
  panel.querySelector('.win-close').addEventListener('click', onClose);

  // ---------- Collapsing a section ----------
  // A collapsed section keeps its title, count and Open; its contents aren't drawn until it's opened again
  let folded = new Set();
  try {
    folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]'));
  } catch {
    // storage blocked or unreadable: everything starts open
  }
  const showFold = (p) => {
    const shut = folded.has(p.id);
    p.el.classList.toggle('qs-collapsed', shut);
    const btn = p.el.querySelector('.qs-fold');
    btn.setAttribute('aria-expanded', String(!shut));
    btn.title = shut ? 'Expand' : 'Collapse';
  };
  for (const p of parts) showFold(p);
  const onFold = (e) => {
    const btn = e.target.closest('.qs-fold');
    if (!btn) return;
    const p = parts.find((x) => x.el.contains(btn));
    if (folded.has(p.id)) folded.delete(p.id);
    else folded.add(p.id);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]));
    } catch {
      // storage blocked: it's forgotten on reload
    }
    showFold(p);
    btn.blur();
    setTimeout(render, 0);
  };
  panel.addEventListener('click', onFold);
  // The Oracle's 1x-10x buttons: a click hands the button (its data-change and value, as the dropdown's
  // option would have them) to the game's own change handler on the window layer
  const onOracle = (e) => {
    const btn = e.target.closest('.qs-oracle [data-change="auto-ascend"]');
    if (btn) btn.dispatchEvent(new Event('change', { bubbles: true }));
  };
  panel.addEventListener('click', onOracle);
  // The Gear judge's time of day and weather (not the game's: no data-change, so its handler leaves them be)
  const onJudgePick = (e) => {
    const sel = e.target.closest('select[data-qs-judge]');
    if (!sel) return;
    sel.blur();
    window.gearJudge?.setPick({ [sel.dataset.qsJudge]: sel.value });
  };
  panel.addEventListener('change', onJudgePick);

  // ---------- The Quicklinks sidebar ----------
  // A second sidebar like the game's, down the right edge: the Quicklinks button (it slides the panel out
  // and back; its badge counts bounties to claim).
  const stage = document.getElementById('stage') ?? app;
  const bar = document.createElement('div');
  bar.id = 'qs-hotbar';
  bar.innerHTML = `<nav id="qs-actionbar" aria-label="Quicklinks"><div class="ab-group">
      <button type="button" class="action-btn" id="qs-toggle" aria-controls="summary-panel"><span class="ui-icon qs-icon"></span><span class="ab-label">Quicklinks</span><span class="badge"></span></button>
    </div></nav>`;
  stage.append(bar);
  const toggle = bar.querySelector('#qs-toggle');
  const dot = toggle.querySelector('.badge');
  toggle.addEventListener('click', () => setOpen(!isOpen));
  // The game's sidebar opens while the pointer is over it, or stays open (its Collapse / Expand): this one too
  const onEnter = () => bar.classList.add('hovering');
  const onLeave = () => bar.classList.remove('hovering');
  bar.addEventListener('pointerenter', onEnter);
  bar.addEventListener('pointerleave', onLeave);
  function syncBar() {
    const main = document.getElementById('hotbar');
    bar.classList.toggle('pinned', Boolean(main?.classList.contains('pinned')));
    placeBar();
  }
  // Where it sits: level with the game's sidebar when that's on the left (the Left-hand layout), else just
  // under it. Both bars move with the play area, which narrows while the panel is out.
  function placeBar() {
    const main = document.getElementById('hotbar');
    const nav = main?.querySelector('#actionbar');
    const s = stage.getBoundingClientRect();
    const r = (nav ?? main)?.getBoundingClientRect();
    let top = 58;
    if (r?.height) top = r.left > s.left + s.width / 2 ? main.getBoundingClientRect().bottom - s.top + 10 : r.top - s.top;
    const px = `${Math.round(top)}px`;
    if (bar.style.top !== px) bar.style.top = px;
  }
  const barObserver = new MutationObserver(syncBar);
  const watchBars = () => {
    barObserver.disconnect();
    const main = document.getElementById('hotbar');
    if (main) barObserver.observe(main, { attributes: true, attributeFilter: ['class', 'style'], subtree: true, childList: true, characterData: true });
  };
  watchBars();
  syncBar();
  addEventListener('resize', placeBar);

  // ---------- Keeping it current ----------
  // Redrawn when the game's state changes (at most every 300 ms) and once a second for the timers. A
  // part is only redrawn when it changed, never while a dropdown in it is open, and not between a press
  // and its release (a button swapped mid-click would lose the click: the game holds off the same way).
  let isOpen = false;
  let pressing = false;
  let pending = 0;
  function render() {
    pending = 0;
    if (window.summaryPanelRun !== run) return stop(); // a newer copy runs now
    const done = finishedBounties();
    if (dot.textContent !== (done ? String(done) : '')) dot.textContent = done ? String(done) : '';
    if (!bar.isConnected) stage.append(bar);
    syncBar();
    // In the basement, the Altar's black and crimson, as the game draws the Draconic Altar window
    const altar = document.body.dataset.place === 'basement';
    if (altar !== (panel.dataset.win === 'draconic')) {
      if (altar) panel.dataset.win = 'draconic';
      else delete panel.dataset.win;
    }
    if (!isOpen || pressing) return;
    const focused = document.activeElement;
    for (const p of parts) {
      const count = p.count?.() ?? '';
      if (count !== p.lastCount) {
        p.countEl.textContent = count;
        p.lastCount = count;
      }
      if (folded.has(p.id)) continue; // drawn when it's opened again
      if (p.content.contains(focused) && focused.matches('select')) continue;
      let html;
      try {
        html = p.html();
      } catch (err) {
        html = `<p class="muted small-text">Couldn’t show this: ${esc(err.message)}</p>`;
      }
      if (html !== p.last) {
        p.content.innerHTML = html;
        p.last = html;
      }
    }
    fitWidth();
  }

  // Widen (or narrow) the panel by what the longest bounty name lacks (or has to spare). Each name's text
  // is in an inline .qs-fit, so its own width is the width it needs on one line. Not while it has a width
  // set with the grip on its left edge (double-click the grip to go back to this)
  let width = MIN_W;
  const grip = edgeGrip({
    id: 'qs-grip', edge: 'right', openClass: 'qs-open', cssVar: '--qs-w', key: 'idle-angler-quicklinks-width',
    min: 340, max: 0.7, label: 'Quicklinks',
    onReset: () => {
      width = MIN_W;
      document.documentElement.style.setProperty('--qs-w', `min(${MIN_W}px, 85vw)`);
      fitWidth();
    },
  });
  function fitWidth() {
    if (grip.size) return;
    const lines = [...panel.querySelectorAll('.bounty-row .qs-line')].filter((l) => l.offsetParent);
    if (!lines.length) return;
    let spare = Infinity;
    for (const line of lines) spare = Math.min(spare, line.clientWidth - line.firstElementChild.getBoundingClientRect().width);
    const cap = Math.min(MAX_W, innerWidth * 0.5);
    const next = Math.round(Math.max(MIN_W, Math.min(cap, width - spare + 2)));
    if (Math.abs(next - width) < 3) return;
    width = next;
    document.documentElement.style.setProperty('--qs-w', `min(${width}px, 85vw)`);
    relayout();
  }
  const schedule = () => {
    if (!pending) pending = setTimeout(render, 300);
  };
  const unsubscribe = S.onChange(schedule);
  // The Gear judge's answers coming in (or it starting or stopping): the gear and the Market again
  const onJudge = () => {
    judgeSeen++;
    schedule();
  };
  addEventListener('idle-angler-gear-judge', onJudge);
  const timer = setInterval(render, 1000);
  const onPress = () => { pressing = true; };
  const onRelease = () => {
    if (!pressing) return;
    pressing = false;
    setTimeout(render, 0); // after the click has run
  };
  panel.addEventListener('pointerdown', onPress);
  addEventListener('pointerup', onRelease);
  addEventListener('pointercancel', onRelease);

  // ---------- Opening and closing ----------
  // The game measures its play area on window resize (Pixi's resizeTo, the windows' bounds, the action
  // bar), so a resize is sent on every frame while the page slides, and once more at the end.
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
  function setOpen(open, { remember = true } = {}) {
    isOpen = open;
    document.body.classList.toggle('qs-open', open);
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide Quicklinks' : 'Show Quicklinks');
    toggle.title = open ? 'Hide Quicklinks' : 'Show Quicklinks: income a second, the best +10%, builds, bounties, ascending, Foreman, chests and gear upgrades';
    panel.inert = !open;
    if (remember) {
      try {
        localStorage.setItem(STORE_KEY, open ? '1' : '0');
      } catch {
        // storage blocked: the panel just starts closed next time
      }
    }
    if (open) render();
    relayout();
  }

  let startOpen = false;
  try {
    startOpen = localStorage.getItem(STORE_KEY) === '1';
  } catch {
    // storage blocked
  }
  setOpen(startOpen, { remember: false });
  render();

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    clearInterval(timer);
    clearTimeout(pending);
    cancelAnimationFrame(slideFrame);
    removeEventListener('pointerup', onRelease);
    removeEventListener('pointercancel', onRelease);
    removeEventListener('resize', placeBar);
    removeEventListener('idle-angler-gear-judge', onJudge);
    barObserver.disconnect();
    grip.remove();
    host.remove();
    bar.remove();
    style.remove();
    sidebarStyle.remove();
    if (window.stopSummaryPanel === stop) delete window.stopSummaryPanel;
    if (window.summaryPanelRun !== run) return; // a newer copy has the page now: leave the rest to it
    delete window.summaryPanelRun;
    viewCentre.remove('quicklinks');
    document.body.classList.remove('qs-open');
    document.documentElement.style.removeProperty('--qs-w');
    dispatchEvent(new Event('idle-angler-quicklinks')); // the pills go back to the top bar
    dispatchEvent(new Event('resize'));
  }
  window.stopSummaryPanel = stop;
  console.log('[quicklinks] On: its sidebar is on the right edge. Turn it off with stopSummaryPanel()');
};

idleAnglerMods.define({
  id: 'summaryPanel',
  order: 60,
  name: "Quicklinks",
  desc: "A sidebar on the right edge, with a Quicklinks button that slides out your income a minute, the gear you're wearing and your builds, bounties, ascending, the Foreman and its next upgrade, chests, the upgrades in your bag and the Market",
  start: summaryPanel,
  stop: 'stopSummaryPanel',
});
