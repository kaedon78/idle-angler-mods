// ==UserScript==
// @name         Idle Angler Gear Judge
// @version      2026-11-26
// @description  ▲ / ▼ on gear judged over a whole day of weather, or the time and weather you pick
// @shared       chest-base
// ==/UserScript==

// =====================================================================================================
// Gear judge
//
// The game marks gear ▲ (better for your build) or ▼ by comparing your stats with and without it under the
// conditions of this very moment: this weather and time of day, any Twitch or event bonus running now, and
// whether you've clicked in the last 3 seconds (a pause to look at your bag counts as idle play, with its
// 2.5× faster bites). So a night-only power looks useless by day, luck gear looks worse in a Cursed Tide,
// and idle gear looks better while you read the bag. This judges gear over the time you'll fish in it:
//  - Weather and time of day: averaged over the whole cycle, each by the share of the time it lasts (a day
//    is 40 minutes, the weather can change every 12, night-only weather comes only at night). Or only the
//    ones you pick, in Settings > Mods or above the upgrades in Quicklinks' Bag: a time of day, a
//    weather, both, or "now" (for now only the most common: Day and Night; Clear, Overcast, Rain, Fog, Storm)
//  - Clicking: your click rate over the last few minutes (the game's own click habit) sets how much of the
//    time you fish idle (no click for 3 s) and how fast you click the rest of it; gold is worked out for
//    each, and added up by their shares. Or pick "Idle" (never a click: Patience, Still Waters and
//    Unyielding all the time) or "Auto-clicker" (never idle, at the Auto-click rate set under Income
//    pills in Settings > Mods: the Frenzy bar, click power and Stormrider all the time)
//  - Or "Opening chests": the game fills a chest when you open it, with the gear you're wearing then
//    (state.js rollChests). This judges gear by the money and treasure the chests you have would pay with it
//    on (loot.js rollChestContents: catch value, treasure, chest luck, and Plunderer, Magpie and Fortune's
//    Embrace), instead of your build. Wear the winners as a saved gear set just to open chests. The gear
//    found in chests isn't counted. Opened as you'd open them from a window, idle: not clicking the water
//  - Bonuses that end within the hour (Twitch, events, a Golden Fish) are left out
//  - Gear you can't wear yet isn't an upgrade
//  - Sets are judged as sets too: a set's bonuses come at 2, 4 and 6 pieces, so one piece of a set you don't
//    wear never looks good alone. The pieces in your bag and the Market are also tried together, every way that reaches a
//    bonus (with the ones you wear); a set that pays off that way has its pieces' ▲ in the set colour, with
//    the change for putting them all on, and Quicklinks lists it with its pieces (a Market one as its stall: buy it first)
// The rest is the game's own: its stats with and without the piece (the real getStats, every cap and set
// bonus), its gold a second and other build measures (priorityMetric), your build's priorities and their
// weights (Bags > Your build), and the same ½% line for a badge.
// It redraws the ▲ / ▼ badges in Bags > Gear and in the Market; Quicklinks uses it too. The game's own
// "Best upgrade" sort, its tooltips and the sidebar's ▲ still use the game's measure.
// Stop it with:  stopGearJudge(), or untick it in Settings > Mods
// =====================================================================================================
const gearJudge = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const W = await mod('/src/world.js');
  const { BASE, OVERFLOW, SET_BY_ID, SET_COLOR, SLOTS, RARITIES, ZONES, ZONE_BY_ID, CHEST_GOLD, TREASURE_VALUE } = await mod('/src/data.js');
  const { tierOdds, gearDropScale, rollChestContents } = await mod('/src/loot.js');
  const chestBase = chestBaseRule({ rollChestContents, RARITIES, CHEST_GOLD, ZONES, stats: S.getStats() }); // what a chest's value starts from, in this build
  const { hex } = await mod('/src/format.js');
  const { MAX_CPS } = await mod('/src/clicks.js');

  window.stopGearJudge?.(); // replace one already running

  const TIME_KEY = 'idle-angler-judge-time';
  const WEATHER_KEY = 'idle-angler-judge-weather';
  const ACTIVITY_KEY = 'idle-angler-judge-activity';
  const AUTO_KEY = 'measured-autoclick-cps'; // the Auto-click mod's rate, 14 until it's set
  const IDLE_S = 3; // state.js IDLE_SPEED_MS: no click for this long and play counts as idle
  const STILL_SPEED = 1.5; // state.js: Still Waters (4 pieces) bites ×1.5 while idle
  const AHEAD_MS = 60 * 60_000; // judged an hour from now: bonuses that end before then are left out
  const SLICE_MS = 10; // work a turn, so the game keeps running smoothly while it catches up

  // ---------- The conditions, and how long each lasts ----------
  // The day (40 min) and the weather slots (12 min) line up again every 3 days, 10 slots. Over that, each
  // slot's weather is drawn from those allowed at its middle's time of day (world.js weatherForSlot), and a
  // night-only weather is clear for the part of its slot that isn't night (naturalWeather).
  const SHARES = (() => {
    const day = W.DAY_LENGTH_MS;
    const slotMs = W.WEATHER_SLOT_MS;
    const period = 3 * day;
    const step = 15_000;
    const phaseAt = (t) => {
      const f = (t % day) / day;
      return W.PHASES.find((p) => f >= p.start && f < p.end) ?? W.PHASES[0];
    };
    const out = new Map();
    for (let t = 0; t < period; t += step) {
      const mid = phaseAt((Math.floor(t / slotMs) + 0.5) * slotMs);
      const phase = phaseAt(t);
      const options = W.WEATHERS.filter((w) => !w.phase || w.phase === mid.id);
      const total = options.reduce((n, w) => n + w.weight, 0);
      for (const w of options) {
        const weather = w.phase && w.phase !== phase.id ? 'clear' : w.id;
        const key = `${phase.id}|${weather}`;
        const c = out.get(key) ?? { phase: phase.id, weather, share: 0 };
        c.share += (w.weight / total) * (step / period);
        out.set(key, c);
      }
    }
    return [...out.values()];
  })();
  // The choices: any, now, and only the most common for now: the times of day that last a fifth of the day
  // or more (Day and Night), and the 5 weathers you see most (Clear, Overcast, Rain, Fog and Storm)
  const shareOf = (key, id) => SHARES.reduce((n, c) => n + (c[key] === id ? c.share : 0), 0);
  const COMMON_TIMES = W.PHASES.filter((p) => shareOf('phase', p.id) >= 0.2);
  const COMMON_WEATHERS = [...W.WEATHERS].sort((a, b) => shareOf('weather', b.id) - shareOf('weather', a.id)).slice(0, 5);
  const TIMES = [['any', 'Any time of day'], ['now', 'Time of day now'], ...COMMON_TIMES.map((p) => [p.id, p.name])];
  const WEATHER_PICKS = [['any', 'Any weather'], ['now', 'Weather now'], ...W.WEATHERS.filter((w) => COMMON_WEATHERS.includes(w)).map((w) => [w.id, w.name])];
  // How you play: as your clicks of the last few minutes say, idle (never a click), or with the
  // Auto-clicker on (never idle, at its rate)
  const autoRate = () => {
    try {
      return Math.min(MAX_CPS, Math.max(1, Math.round(+localStorage.getItem(AUTO_KEY)) || 14));
    } catch {
      return 14;
    }
  };
  const activities = () => [['now', 'As you click now'], ['idle', 'Idle'], ['auto', `Auto-clicker ${autoRate()}/s`], ['chests', 'Opening chests']];
  window.gearJudgeChoices = { time: TIMES, weather: WEATHER_PICKS, get activity() { return activities(); } }; // the Settings > Mods dropdowns

  const read = (key, list, fallback = 'any') => {
    try {
      const v = localStorage.getItem(key);
      return list.some(([id]) => id === v) ? v : fallback;
    } catch {
      return fallback;
    }
  };
  let pick = { time: read(TIME_KEY, TIMES), weather: read(WEATHER_KEY, WEATHER_PICKS), activity: read(ACTIVITY_KEY, activities(), 'now') };

  /** The conditions to judge in, with their shares of the time (adding up to 1). */
  function conditions() {
    const now = W.worldAt();
    const time = pick.time === 'now' ? now.phase.id : pick.time;
    const weather = pick.weather === 'now' ? now.weather.id : pick.weather;
    let list = SHARES.filter((c) => (time === 'any' || c.phase === time) && (weather === 'any' || c.weather === weather));
    // A pair that doesn't happen on its own (Aurora by day, or the owner's weather): just that pair
    if (!list.length) list = [{ phase: time === 'any' ? 'night' : time, weather: weather === 'any' ? 'clear' : weather, share: 1 }];
    const total = list.reduce((n, c) => n + c.share, 0);
    return list.map((c) => ({ ...c, share: c.share / total }));
  }

  /** Runs fn with the game's world set to these conditions, an hour ahead, then puts both back. */
  function under(cond, fn) {
    const saved = W.getOverride();
    const realNow = W.clock.now;
    const at = realNow() + AHEAD_MS;
    W.setOverride('phase', cond.phase);
    W.setOverride('weather', cond.weather);
    W.clock.now = () => at;
    try {
      return fn();
    } finally {
      W.clock.now = realNow;
      W.setOverride('phase', saved.phase);
      W.setOverride('weather', saved.weather);
    }
  }

  // Stats an hour ahead are idle play (no click for an hour): Patience's faster bites, and Still Waters'.
  // While clicking, those are taken back out, with what follows from the bite time (the animations, and
  // multi-catch from bites past the animation floor), as getStats works them out.
  const floor = 0.3 * BASE.fishTime;
  function clicking(s) {
    if (!s.idleBonus) return s;
    const k = ((BASE.idleSpeed ?? 1) > 1 ? BASE.idleSpeed : 1) * (s.flags?.stillSpeed ? STILL_SPEED : 1);
    const fishTime = s.fishTime * k;
    return {
      ...s,
      speedMult: s.speedMult / k,
      fishTime,
      animScale: Math.min(1, Math.max(0.3, fishTime / BASE.fishTime)),
      speedMultiCatch: fishTime < floor ? Math.log2(floor / fishTime) * OVERFLOW.speedMultiCatch : 0,
      idleBonus: false,
    };
  }

  // ---------- Judging ----------
  // Your stats as they stand, with what you wear, apart from gear: upgrades, perks, levels, ascensions, mastery and the
  // rest all show in them. Worked out as the judging does (an hour ahead, so bonuses ending sooner are left out), in
  // one fixed time and weather, each stat to about 0.2% (badges go by ½%). At most every STATS_MS. Counters that move
  // with every catch and that no gear changes are left out (gearDry: catches since gear last dropped).
  const STATS_MS = 2000;
  const NOT_STATS = new Set(['gearDry']);
  let statsSeen = { at: -Infinity, sig: '' };
  function statsSig() {
    const t = performance.now();
    if (t - statsSeen.at < STATS_MS) return statsSeen.sig;
    const s = under(SHARES[0], () => S.statsWithBonus('value', 0));
    const nums = Object.entries(s)
      .filter(([k, v]) => typeof v === 'number' && !NOT_STATS.has(k))
      .map(([k, v]) => `${k}:${v > 0 ? Math.round(Math.log(v) * 500) : v}`);
    statsSeen = { at: t, sig: `${nums.join(',')}|${JSON.stringify(s.flags ?? {})}` };
    return statsSeen.sig;
  }
  // How you click (as you click now): the idle share it's judged with stays until your play moves IDLE_STEP from it,
  // so a click rate easing off as you stop clicking doesn't judge everything again at every step on the way
  const IDLE_STEP = 0.1;
  let held = null; // { idle, cps }
  let ctx = null; // what this pass is judged with; a new one when any of it changes
  function context() {
    let idle = 1; // the share of the time with no click for 3 s
    let cps = 0; // clicks a second while clicking
    if (pick.activity === 'auto') {
      idle = 0;
      cps = autoRate();
    } else if (pick.activity !== 'idle') {
      const rate = S.clickRate();
      idle = Math.exp(-IDLE_S * rate);
      cps = Math.min(MAX_CPS, rate / Math.max(1e-6, 1 - idle));
      if (!held || Math.abs(idle - held.idle) >= IDLE_STEP || (idle === 1) !== (held.idle === 1)) held = { idle, cps };
      ({ idle, cps } = held);
    }
    const now = W.worldAt();
    const chests = pick.activity === 'chests';
    const sig = [
      chests ? Object.keys(S.state.chests ?? {}).filter((k) => S.state.chests[k] > 0).sort().join(',') : '', // the kinds of chest you have
      pick.time,
      pick.weather,
      pick.activity,
      pick.activity === 'auto' ? cps : '', // the Auto-click rate (yours: by the 5% step below)
      pick.time === 'now' ? now.phase.id : '',
      pick.weather === 'now' ? now.weather.id : '',
      S.state.player?.level,
      S.state.zone,
      JSON.stringify(S.state.equipped),
      JSON.stringify(S.buildPriority()),
      JSON.stringify(S.state.settings.statLimits ?? {}),
      idle, // (held, above)
      statsSig(), // upgrades, perks, levels and the rest
    ].join('|');
    if (ctx?.sig === sig) return ctx;
    const conds = conditions();
    return (ctx = { sig, conds, idle, cps, zone: S.currentZone(), keys: chests ? ['chests'] : S.buildPriority(), chests: chests ? chestKinds() : null, base: new Map(), version: (ctx?.version ?? 0) + 1 });
  }

  // ---------- Opening chests ----------
  // The chests you have, by kind ("zone:tier" and how many), each kind weighted by its count. With none, the
  // chests of the water you're in, by how often each rarity comes up for you now.
  function chestKinds() {
    const list = [];
    for (const [key, n] of Object.entries(S.state.chests ?? {})) {
      const [zoneId, tier] = key.split(':');
      if (n > 0 && ZONE_BY_ID[zoneId]) list.push({ zone: ZONE_BY_ID[zoneId], tier: Number(tier), n });
    }
    if (list.length) return list;
    const zone = S.currentZone();
    return tierOdds(S.getStats().chestLuckMult, zone.maxTier).map((n, tier) => ({ zone, tier, n })).filter((k) => k.n > 0);
  }
  const CHEST_ITEM_CHANCE = 0.35; // loot.js: each roll in a chest is gear this often, treasure otherwise
  /** Money and treasure from opening one chest of each kind with these stats, as loot.js rollChestContents pays on average. */
  function chestMoney(s, kinds) {
    const chestValue = s.chestValueMult ?? 1; // Plunderer, Magpie, Fortune's Embrace
    let sum = 0;
    for (const { zone, tier, n } of kinds) {
      const base = chestBase(s, zone);
      const gold = base * RARITIES[tier].valueMult * CHEST_GOLD * s.valueMult * chestValue;
      // Each roll's treasure: a rarity from chest luck, no lower than 2 under the chest's (loot.js tierOddsFrom)
      const odds = tierOdds(s.chestLuckMult, Math.min(RARITIES.length - 1, zone.maxTier + 1));
      const floor = Math.max(0, tier - 2);
      const treasureTier = odds.reduce((t, q, i) => t + (q || 0) * RARITIES[Math.max(i, floor)].valueMult, 0);
      const treasure = base * treasureTier * TREASURE_VALUE * s.treasureMult * chestValue;
      const rolls = 1 + Math.floor(tier / 2);
      sum += n * (gold + rolls * (1 - CHEST_ITEM_CHANCE * gearDropScale(s, zone)) * treasure);
    }
    return sum;
  }

  /** Each build measure, summed over the conditions by their shares (idle and clicking by theirs). */
  function measures(c, statsFor) {
    const sums = c.keys.map(() => 0);
    for (const cond of c.conds) {
      const s = under(cond, statsFor);
      const a = clicking(s);
      c.keys.forEach((key, i) => {
        if (key === 'chests') sums[i] += cond.share * chestMoney(s, c.chests); // opened idle (from a window)
        else sums[i] += cond.share * (c.idle * S.priorityMetric(key, s, c.zone, 0) + (1 - c.idle) * S.priorityMetric(key, a, c.zone, c.cps));
      });
    }
    return sums;
  }

  /** How much better the build gets with this piece on (0.12 = 12%), as the game's upgradeValue weighs it. */
  function judge(c, item) {
    if (S.isEquipped(item)) return 0;
    if (!S.canWear(item)) return null;
    const owned = S.state.items.includes(item);
    if (!owned) S.state.items.push(item); // the Market's: in the list only while it's worked out (as upgradeValueOf)
    try {
      return compare(c, measures(c, () => S.statsIfEquipped(item.uid)));
    } finally {
      if (!owned) S.state.items.splice(S.state.items.indexOf(item), 1);
    }
  }

  /** The same for several pieces put on at once (pieces of a set, each in its own slot). */
  function judgeGroup(c, items) {
    const map = Object.fromEntries(items.map((it) => [it.slot, it.uid]));
    const shop = items.filter((it) => !S.state.items.includes(it));
    S.state.items.push(...shop); // the Market's: in the list only while it's worked out (as in judge)
    try {
      return compare(c, measures(c, () => withEquipped(map, () => S.statsWithBonus('value', 0))));
    } finally {
      for (const it of shop) S.state.items.splice(S.state.items.indexOf(it), 1);
    }
  }
  // What's worn, changed for a moment (as the game's statsIfEquipped does for one slot), then put back
  function withEquipped(map, fn) {
    const eq = S.state.equipped;
    const saved = {};
    for (const [slot, uid] of Object.entries(map)) {
      saved[slot] = eq[slot];
      eq[slot] = uid;
    }
    try {
      return fn();
    } finally {
      for (const [slot, uid] of Object.entries(saved)) eq[slot] = uid;
    }
  }

  /** Build measures with some gear on, against now: the game's weighted change (upgradeValue). */
  function compare(c, worn) {
    if (!c.base.has('now')) c.base.set('now', measures(c, () => S.statsWithBonus('value', 0)));
    const base = c.base.get('now');
    let sum = 0;
    let weights = 0;
    c.keys.forEach((key, i) => {
      const w = S.PRIORITY_WEIGHTS[i];
      sum += w * Math.log(worn[i] / base[i] || 1);
      weights += w;
    });
    return Math.exp(sum / weights) - 1;
  }

  // Answers are kept until what they were judged with changes; until a new one is ready, the last one
  // stands. New work waits in a queue and is done a slice at a time.
  const answers = new Map(); // uid -> { version, change }
  const queue = new Map(); // key -> the work, given what to judge with
  let pump = 0;
  let spent = 0;
  let sliceStart = 0;
  const inSlice = () => {
    const t = performance.now();
    if (t - sliceStart > 50) {
      sliceStart = t;
      spent = 0;
    }
    return spent < SLICE_MS;
  };
  const enqueue = (key, fn) => {
    if (!queue.has(key)) queue.set(key, fn);
    if (!pump) pump = setTimeout(work, 30);
  };
  function work() {
    pump = 0;
    const t0 = performance.now();
    for (const [key, fn] of queue) {
      if (performance.now() - t0 > SLICE_MS) break;
      queue.delete(key);
      fn(context()); // work added meanwhile (a set's tries) comes after, in this loop or the next
    }
    if (queue.size) pump = setTimeout(work, 30);
    else dispatchEvent(new Event('idle-angler-gear-judge'));
  }
  const judgeNow = (c, item) => {
    const v = judge(c, item);
    answers.set(item.uid, { version: c.version, change: v });
    return v;
  };
  /** The change for this piece, or undefined while it waits to be judged. null: it can't be worn yet. */
  function change(item) {
    if (!item?.uid) return undefined;
    const c = context();
    const a = answers.get(item.uid);
    if (a?.version === c.version) return a.change;
    if (!queue.size && inSlice()) {
      const t0 = performance.now();
      const v = judgeNow(c, item);
      spent += performance.now() - t0;
      return v;
    }
    enqueue(item.uid, (cc) => judgeNow(cc, item));
    return a?.change;
  }

  // ---------- Sets, judged together ----------
  // A set's bonuses come at 2, 4 and 6 pieces worn, so one piece of a set you don't wear does nothing on its
  // own and never looks like an upgrade. Here the set pieces in your bag are also judged together: for each
  // set, the best piece of it for each slot (the one that does most on its own), and every way of putting
  // some of them on that reaches one of its bonuses, counting the pieces of it you already wear. The best
  // way for each set is kept when it beats putting on just its best piece by more than ½%.
  let sets = { sig: '', list: [], byUid: new Map() };
  let planned = '';
  let plans = 0;
  // The set pieces to try: the ones in your bag, and the ones for sale in the Market now
  const shopGear = () => (S.state.shop?.stock ?? []).filter((x) => x.type === 'item' && !x.sold && x.item?.slot).map((x) => x.item);
  const setPieces = () => [...S.looseGear(), ...shopGear()].filter((i) => i.set && S.canWear(i));
  const setSig = (c) => `${c.version}|${setPieces().map((i) => i.uid).join(',')}`;
  function planSets(c, sig) {
    const plan = ++plans;
    const next = new Map(); // set id -> its best way
    const bySet = new Map();
    for (const item of setPieces()) {
      if (!item.set || !SET_BY_ID[item.set] || !S.canWear(item)) continue;
      if (!bySet.has(item.set)) bySet.set(item.set, []);
      bySet.get(item.set).push(item);
    }
    for (const [id, pieces] of bySet) {
      const def = SET_BY_ID[id];
      const wornSlots = new Set(SLOTS.filter((sl) => S.itemByUid(S.state.equipped[sl.id])?.set === id).map((sl) => sl.id));
      const worn = wornSlots.size;
      const best = new Map(); // slot -> { item, alone }
      for (const p of pieces) {
        if (wornSlots.has(p.slot)) continue; // that slot already has a piece of it
        const a = answers.get(p.uid);
        const alone = (a?.version === c.version ? a.change : judgeNow(c, p)) ?? -Infinity;
        if (!best.has(p.slot) || alone > best.get(p.slot).alone) best.set(p.slot, { item: p, alone });
      }
      const slots = [...best.keys()];
      const bonusAt = new Set(def.bonuses.map((b) => b.pieces));
      for (let mask = 1; mask < 1 << slots.length; mask++) {
        const chosen = slots.filter((_, i) => mask & (1 << i)).map((sl) => best.get(sl));
        if (chosen.length < 2 || !bonusAt.has(worn + chosen.length)) continue;
        enqueue(`set:${plan}:${id}:${mask}`, (cc) => {
          if (cc.version !== c.version) return; // judged with something else now: a new plan comes
          const v = judgeGroup(cc, chosen.map((x) => x.item));
          const alone = Math.max(...chosen.map((x) => x.alone));
          if (v <= 0.005 || v <= alone + 0.005 || v <= (next.get(id)?.change ?? -Infinity)) return;
          const items = chosen.map((x) => x.item);
          const shop = items.filter((it) => !S.state.items.includes(it)).length; // to buy first
          next.set(id, { set: id, name: def.name, items, worn, shop, pieces: worn + chosen.length, change: v });
        });
      }
    }
    enqueue(`sets:${plan}`, (cc) => {
      if (cc.version !== c.version) return;
      const list = [...next.values()].sort((a, b) => b.change - a.change);
      const byUid = new Map();
      for (const g of list) for (const it of g.items) if (!byUid.has(it.uid)) byUid.set(it.uid, g);
      sets = { sig, list, byUid };
    });
  }
  /** The sets worth putting on together, best first (the last answer until a new one is ready). */
  function groups() {
    const c = context();
    const sig = setSig(c);
    if (sets.sig !== sig && planned !== sig) {
      planned = sig;
      enqueue(`plan:${sig}`, (cc) => {
        if (cc.version === c.version) planSets(cc, sig);
        else planned = '';
      });
    }
    return sets.list;
  }

  // ---------- The game's badges ----------
  const pctText = (x) => `${x >= 0 ? '+' : ''}${Math.abs(x) >= 0.1 ? Math.round(x * 100) : (x * 100).toFixed(1)}%`;
  const where = () => {
    const t = (id, list) => list.find(([x]) => x === id)?.[1] ?? id;
    const when = pick.time === 'any' && pick.weather === 'any' ? 'over a whole day of weather' : `in ${t(pick.time, TIMES).toLowerCase()}, ${t(pick.weather, WEATHER_PICKS).toLowerCase()}`;
    const how = pick.activity === 'idle' ? 'fishing idle' : pick.activity === 'auto' ? `with the Auto-clicker on (${autoRate()}/s)` : pick.activity === 'chests' ? 'opening them' : 'clicking as you do now';
    return `${when}, ${how}`;
  };
  /** What a change is for: your build, or the money and treasure your chests pay */
  const aim = () => {
    if (pick.activity !== 'chests') return 'your build';
    const n = Object.values(S.state.chests ?? {}).reduce((t, x) => t + (x > 0 ? x : 0), 0);
    return n ? `the money and treasure in your ${n} chest${n === 1 ? '' : 's'}` : 'the money and treasure in chests';
  };
  /** A cell's badge, as the game draws it (ui.js renderBagGear, renderMarket). */
  const badgeHtml = (up) =>
    up > 0.005
      ? `<span class="upg up" title="Gear judge: ${pctText(up)} for ${aim()}, ${where()}">▲${pctText(up).replace('+', '')}</span>`
      : up < -0.005
        ? `<span class="upg down" title="Gear judge: ${pctText(up)} for ${aim()}, ${where()}">▼</span>`
        : '';
  /** A piece of a set worth putting on with others of it: the ▲ in the set colour, with the set's change. */
  const setNote = (g) =>
    `${pctText(g.change)} for ${aim()} with ${g.items.length === 2 ? 'both these' : `these ${g.items.length}`} ${g.name} pieces on together (its ${g.pieces}-piece bonus${g.worn ? `, with the ${g.worn} you wear` : ''}), ${where()}${g.shop ? `. ${g.shop === g.items.length ? 'All of them are' : g.shop === 1 ? '1 of them is' : `${g.shop} of them are`} in the Market: buy ${g.shop === 1 ? 'it' : 'them'} first` : ''}`;
  const groupBadgeHtml = (g) => `<span class="upg up gj-set" style="color:${hex(SET_COLOR)}" title="Gear judge: ${setNote(g)}">▲${pctText(g.change).replace('+', '')}</span>`;
  // A piece for a slot you have nothing in: always an upgrade, at once (with its change once it's judged)
  const emptySlot = (item) => !S.state.equipped[item.slot] && S.canWear(item);
  const emptyBadgeHtml = (item, up) =>
    `<span class="upg up" title="Gear judge: your ${item.slot} slot is empty, so anything for it is an upgrade${up > 0.005 ? ` (${pctText(up)} for ${aim()}, ${where()})` : ''}">▲${up > 0.005 ? pctText(up).replace('+', '') : ''}</span>`;
  function setBadge(cell, up, group, empty) {
    if (up === undefined && !group && !empty) return; // not judged yet: the game's stays
    const html = group && group.change > (up ?? 0) ? groupBadgeHtml(group) : empty ? emptyBadgeHtml(empty, up) : badgeHtml(up ?? 0);
    const old = cell.querySelector(':scope > .upg');
    if ((old?.outerHTML ?? '') === html) return;
    if (old) old.remove();
    if (!html) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    (cell.querySelector(':scope > .ilvl') ?? cell.firstElementChild)?.after(tpl.content.firstChild);
  }
  const layer = document.getElementById('windows');
  function badges() {
    if (!layer) return;
    groups(); // a new plan, when the sets' pieces or what they're judged with changed
    for (const cell of layer.querySelectorAll('.bag-cell[data-uid]')) {
      if (cell.closest('#summary-panel')) continue; // Quicklinks draws its own
      const item = S.itemByUid(cell.dataset.uid);
      if (item?.slot) setBadge(cell, change(item), sets.byUid.get(item.uid), emptySlot(item) && item);
    }
    for (const cell of layer.querySelectorAll('.stall-cell[data-tip^="shop:"]')) {
      if (cell.closest('#summary-panel')) continue;
      const slot = S.state.shop?.stock?.[Number(cell.dataset.tip.slice(5))];
      if (slot?.type === 'item') setBadge(cell, change(slot.item), sets.byUid.get(slot.item.uid), emptySlot(slot.item) && slot.item);
    }
  }
  let frame = 0;
  const later = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      badges();
    });
  };
  const observer = new MutationObserver(later);
  if (layer) observer.observe(layer, { childList: true, subtree: true });
  addEventListener('idle-angler-gear-judge', later);

  // ---------- For Quicklinks and Settings > Mods ----------
  function setPick(next) {
    pick = { ...pick, ...next };
    try {
      localStorage.setItem(TIME_KEY, pick.time);
      localStorage.setItem(WEATHER_KEY, pick.weather);
      localStorage.setItem(ACTIVITY_KEY, pick.activity);
    } catch {
      // storage blocked: the choice lasts until the page reloads
    }
    context();
    queue.clear();
    planned = '';
    dispatchEvent(new Event('idle-angler-gear-judge'));
  }
  window.gearJudge = {
    change,
    groups,
    groupOf: (uid) => sets.byUid.get(uid), // the set worth putting on that this piece is in, if any
    setNote,
    // For the console: the change for putting these pieces on together, e.g. gearJudge.tryTogether([a, b])
    tryTogether: (items) => judgeGroup(context(), items),
    get pick() {
      return { ...pick };
    },
    setPick,
    times: TIMES,
    weathers: WEATHER_PICKS,
    get activities() {
      return activities();
    },
    where,
    aim,
    get pending() {
      return queue.size;
    },
    get version() {
      return context().version;
    },
  };
  window.setGearJudge = setPick;
  later();

  window.stopGearJudge = () => {
    clearTimeout(pump);
    cancelAnimationFrame(frame);
    observer.disconnect();
    removeEventListener('idle-angler-gear-judge', later);
    queue.clear();
    delete window.gearJudge;
    delete window.setGearJudge;
    delete window.gearJudgeChoices;
    delete window.stopGearJudge;
    dispatchEvent(new Event('idle-angler-gear-judge')); // Quicklinks goes back to the game's measure
  };
  console.log('[gear judge] On: gear is judged over a whole day of weather (Settings > Mods). Turn it off with stopGearJudge()');
};

idleAnglerMods.define({
  id: 'gearJudge',
  order: 50,
  name: "Gear judge",
  desc: "The ▲ / ▼ on gear (Bags, the Market, Quicklinks) judged over a whole day of weather instead of this moment's: night-only and weather powers count for the time they work, by how much you click, without bonuses that are about to end. Or judge it for one time of day or weather, and for idle play or the Auto-clicker; or for opening chests (the money and treasure your chests pay with it on)",
  start: gearJudge,
  stop: 'stopGearJudge',
  // The lists come from the game's world.js once the mod runs (these until then)
  options: [
    {
      key: 'idle-angler-judge-time',
      label: 'Time of day',
      get values() {
        return window.gearJudgeChoices?.time ?? [['any', 'Any time of day'], ['now', 'Time of day now']];
      },
      fallback: 'any',
      apply: (value) => window.setGearJudge?.({ time: value }), // live, without a restart
    },
    {
      key: 'idle-angler-judge-weather',
      label: 'Weather',
      get values() {
        return window.gearJudgeChoices?.weather ?? [['any', 'Any weather'], ['now', 'Weather now']];
      },
      fallback: 'any',
      apply: (value) => window.setGearJudge?.({ weather: value }),
    },
    {
      key: 'idle-angler-judge-activity',
      label: 'How you play',
      get values() {
        return window.gearJudgeChoices?.activity ?? [['now', 'As you click now'], ['idle', 'Idle'], ['auto', 'Auto-clicker']];
      },
      fallback: 'now',
      apply: (value) => window.setGearJudge?.({ activity: value }),
    },
  ],
});
