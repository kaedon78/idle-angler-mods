// ==UserScript==
// @name         Idle Angler Income Pills
// @version      2026-11-25
// @description  Measured gold, fish, chests and XP a minute
// ==/UserScript==

// =====================================================================================================
// Income pills (was gold-income-logger.js; its auto-clicker is the Auto-click mod now)
//
// Every minute (or every 5, 15 or 30 s: "Measure over" in Settings > Mods) it measures, over that time,
// the gold you actually earned, the fish you caught, the chests you found and the XP you gained, each
// per minute (as the game's own Gold / min at the top left, which is its estimate for idle fishing). They
// show as pills at the top of the Quicklinks panel while it's on, or else in the top bar to the right of
// your Emberscales (styled like the game's own +X/min pill). Hover a pill for details; the fish pill breaks the catch down by rarity. A shaded bar
// in each pill shrinks as the time runs out, and changing your equipped gear starts it over.
// Stop it (and remove the pills) with:  stopGoldLogger(), or untick it in Settings > Mods
//
// How it works: it samples counters the game only ever adds to:
//  - state.lifetimeGold (bumped in earn()): spending, upgrades and ascending don't touch it, so
//    the delta is pure income. Money is stored in copper (100c = 1s, 100s = 1g).
//  - state.stats.fishCaught (bumped per fish in addCatches()): the "Fish caught" stat. A
//    multi-catch cast adds one per fish; chests and items caught don't count.
//    state.stats.casts is sampled too, for the fish-per-cast figure.
//  - state.collection.fish (times caught per species, kept forever): summed by each species'
//    rarity from the game's FISH table, for the per-rarity breakdown.
//  - state.stats.chestsFound (bumped when a catch is a chest): the "Chests found" stat. It counts
//    chests caught while fishing, not ones from bounty/company rewards or the shop, and opening
//    chests doesn't lower it.
//  - state.player.totalXp (bumped in gainXp()): kept forever, so levelling up and ascending
//    don't reset it.
// =====================================================================================================
const incomePills = async () => {
  // How long each reading measures over: the "Measure over" choice in Settings > Mods (this mod's option),
  // kept in this browser. A change comes in through window.setGoldLoggerPeriod (below), which starts the
  // measuring over without restarting the mod.
  let PERIOD_MS = (() => {
    try {
      const ms = Number(localStorage.getItem('idle-angler-income-period'));
      return [5_000, 15_000, 30_000, 60_000].includes(ms) ? ms : 60_000;
    } catch {
      return 60_000;
    }
  })();

  // window.game only exists for admins/localhost, so import the game's own modules instead.
  // ES modules are singletons per URL, so this returns the live instance the game is using.
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { money, moneyRateHtml, fmtDec, fmtDecHtml, hex } = await mod('/src/format.js');
  const { CHEST_ICON, FISH_SHEET, cellStyle } = await mod('/src/art.js');
  const { FISH, RARITIES } = await mod('/src/data.js');

  window.stopGoldLogger?.(); // replace any logger already running

  // Rates are often well under 1/s, so keep two significant digits for small values.
  const fmtRate = (n) => (n > 0 && n < 0.1 ? String(+n.toPrecision(2)) : fmtDec(n));

  // "1h 23m" / "4m 05s" / "12s" / "0.4s".
  const fmtDuration = (s) => {
    if (!Number.isFinite(s)) return 'never at this rate';
    if (s < 10) return `${+s.toFixed(1)}s`;
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
  };

  // ---------- Tooltip ----------
  // The game's own #tooltip only renders its built-in data-tip keys (and hides itself over
  // anything else), so this is a lookalike: the same frame and the game's tip classes, following
  // the pointer the same way.
  const tip = document.createElement('div');
  tip.id = 'measured-tip';
  tip.hidden = true;
  tip.style.cssText =
    'position:fixed;z-index:1000;max-width:min(500px,calc(100vw - 16px));padding:8px 12px;pointer-events:none;' +
    'font-family:var(--font);font-size:14px;line-height:1.35;color:var(--text);border:9px solid;' +
    'border-image:var(--fr-tip);box-shadow:0 6px 18px rgba(0,0,0,.6)';
  document.body.append(tip);
  const tips = new Map(); // pill -> html
  const placeTip = (e) => {
    const pad = 14;
    const { width, height } = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + width > innerWidth - 8) x = Math.max(8, e.clientX - width - pad);
    if (y + height > innerHeight - 8) y = Math.max(8, e.clientY - height - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const attachTip = (pill) => {
    pill.addEventListener('pointerenter', (e) => { tip.innerHTML = tips.get(pill); tip.hidden = false; placeTip(e); });
    pill.addEventListener('pointermove', placeTip);
    pill.addEventListener('pointerleave', () => { tip.hidden = true; });
  };
  const setTip = (pill, html) => {
    tips.set(pill, html);
    if (!tip.hidden && pill.matches(':hover')) tip.innerHTML = html; // refresh if it's open
  };

  // ---------- Pills ----------
  // A .currency wrapper (for the bar's spacing) holding span.rate pills, the same class the game
  // uses for its calculated +X/s, so they inherit that styling.
  // Countdown shading: a bar behind each pill's contents that shrinks from full width to nothing
  // over one measuring window, so the shaded part is the time left until the next reading. It is a
  // CSS transform animation (no per-frame JS); every reading rebuilds the pill, which drops in a
  // fresh bar and so restarts it. inset:1px keeps the pill's outline visible over the bar.
  const style = document.createElement('style');
  style.id = 'measured-style';
  style.textContent =
    '#measured-rate-wrap .rate{position:relative;overflow:hidden;isolation:isolate}' +
    '.measured-countdown{position:absolute;inset:1px;z-index:-1;border-radius:inherit;pointer-events:none;' +
    'transform-origin:left center;background:rgba(155,227,106,.4);animation:measured-countdown 60s linear forwards}' +
    '@keyframes measured-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
    // In the Quicklinks panel: the top bar's .currency and .rate rules (ui.css scopes them to #topbar)
    '#qs-pills #measured-rate-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0;' +
    'font:600 17px var(--num);font-variant-numeric:lining-nums tabular-nums;text-shadow:1px 1px 0 #000}' +
    '#qs-pills .rate{padding:1px 8px;font-size:15px;font-weight:500;color:#c6f29a;text-shadow:none;' +
    'background:rgba(10,18,8,.6);border-radius:999px;box-shadow:inset 0 0 0 1px rgba(155,227,106,.4)}' +
    '#qs-pills .rate .per{color:#8fbf6c}';
  document.head.append(style);
  // Each bar runs for the period in use when it's made (it can change: setGoldLoggerPeriod)
  const countdownBar = () => {
    const bar = Object.assign(document.createElement('span'), { className: 'measured-countdown' });
    bar.style.animationDuration = `${PERIOD_MS}ms`;
    return bar;
  };

  const ember = document.getElementById('emberscales')?.closest('.currency');
  const wrap = document.createElement('div');
  wrap.className = 'currency';
  wrap.id = 'measured-rate-wrap';
  const makePill = (id, withIcon) => {
    const pill = document.createElement('span');
    pill.className = 'rate';
    pill.id = id;
    pill.innerHTML = '<span class="per">measuring…</span>';
    pill.append(countdownBar());
    if (withIcon) pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px';
    tips.set(pill, `<div class="tip-title">Measuring…</div><div class="muted">First reading ${PERIOD_MS / 1000} s after starting, then every ${PERIOD_MS / 1000} s.</div>`);
    attachTip(pill);
    return pill;
  };
  const goldPill = makePill('measured-rate');
  const fishPill = makePill('measured-fish-rate', true);
  const chestPill = makePill('measured-chest-rate', true);
  const xpPill = makePill('measured-xp-rate');
  const pills = [goldPill, fishPill, chestPill, xpPill];
  wrap.append(...pills);
  // The pills: at the top of the Quicklinks panel while it's running (it sends idle-angler-quicklinks as it
  // starts and stops), else in the top bar right of the Emberscales. Moving a node restarts its CSS
  // animation, so the countdown bars are set back to the time already measured.
  const placePills = () => {
    const host = document.getElementById('qs-pills');
    if (host ? wrap.parentElement === host : !ember || (wrap.parentElement && wrap.previousElementSibling === ember)) return;
    if (host) host.append(wrap);
    else ember.after(wrap);
    const done = performance.now() - last.t;
    for (const bar of wrap.querySelectorAll('.measured-countdown')) bar.style.animationDelay = `-${Math.round(done)}ms`;
  };
  if (!ember) console.warn('[gold/s] Emberscales counter not found: the rate pills show only in Quicklinks');

  // Icons: the game's chest sprite, and a Carp (index 57) cut from the fish sprite sheet. Carp is
  // chunky and orange, so it stays readable at pill size where slimmer fish turn into a line.
  const chestImg = `<img src="${CHEST_ICON.url}" alt="chests" style="width:${CHEST_ICON.width}px;height:${CHEST_ICON.height}px;image-rendering:pixelated" />`;
  const fishImg = `<span aria-label="fish" style="display:inline-block;image-rendering:pixelated;${cellStyle(FISH_SHEET, 57, 22)}"></span>`;
  const iconRate = (icon, n) => `${icon}<span><span class="num">${fmtRate(n)}</span><span class="per">/min</span></span>`; // n: a minute

  // ---------- Sampling ----------
  const tierOf = new Map(FISH.map((f) => [f.id, f.tier]));
  const fishByTier = () => {
    const out = new Array(RARITIES.length).fill(0);
    for (const [id, n] of Object.entries(S.state.collection?.fish ?? {})) {
      const t = tierOf.get(id);
      if (t !== undefined && Number.isFinite(n)) out[t] += n;
    }
    return out;
  };
  const sample = () => ({
    copper: S.state.lifetimeGold,
    fish: S.state.stats.fishCaught ?? 0,
    casts: S.state.stats.casts ?? 0,
    tiers: fishByTier(),
    chests: S.state.stats.chestsFound ?? 0,
    xp: S.state.player.totalXp ?? 0,
    t: performance.now(),
  });
  let last = sample();
  let hiddenDuringWindow = document.visibilityState === 'hidden';
  const onVis = () => { if (document.visibilityState === 'hidden') hiddenDuringWindow = true; };
  document.addEventListener('visibilitychange', onVis);

  // ---------- Each reading ----------
  const tick = () => {
    const now = sample();
    const secs = (now.t - last.t) / 1000;
    const delta = (k) => Math.max(0, now[k] - last[k]);
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const footer =
      `<div class="tip-sep"></div><div class="muted">Measured over the last ${secs.toFixed(0)} s, up to ${at}</div>` +
      (hiddenDuringWindow ? '<div class="muted">⚠ The tab was hidden for part of it, so this reads low (fishing pauses while hidden).</div>' : '');

    const goldPerSec = delta('copper') / secs;
    goldPill.innerHTML = `+${moneyRateHtml(goldPerSec * 60)}<span class="per">/min</span>`; // as the game draws its Gold / min (ui.js renderGoldRate)
    setTip(goldPill,
      `<div class="tip-title">Measured income</div>` +
      `<div><b>${moneyRateHtml(goldPerSec * 60)}</b> a minute · <b>${moneyRateHtml(goldPerSec)}</b> a second</div>` +
      `<div class="muted">Everything you actually earned: fish, sales, chests, bounties, Golden Fish.</div>${footer}`);

    const fish = delta('fish');
    const casts = delta('casts');
    const fishPerSec = fish / secs;
    fishPill.innerHTML = iconRate(fishImg, fishPerSec * 60);
    const rows = RARITIES.map((r, t) => ({ r, n: Math.max(0, now.tiers[t] - last.tiers[t]) })).filter((x) => x.n > 0);
    const rowsTotal = rows.reduce((s, x) => s + x.n, 0);
    const cell = 'text-align:right;font-variant-numeric:tabular-nums';
    const table = rows.length
      ? `<div style="display:grid;grid-template-columns:auto repeat(4,auto);column-gap:14px;row-gap:1px;margin-top:4px">` +
        `<span class="tip-head">Rarity</span><span class="tip-head" style="${cell}">Caught</span><span class="tip-head" style="${cell}">/min</span><span class="tip-head" style="${cell}">Share</span><span class="tip-head" style="${cell}">One every</span>` +
        rows.map(({ r, n }) =>
          `<b style="color:${hex(r.color)}">${r.name}</b>` +
          `<span style="${cell}">${n.toLocaleString()}</span>` +
          `<span style="${cell}">${fmtRate((n / secs) * 60)}</span>` +
          `<span style="${cell}">${((n / rowsTotal) * 100).toFixed(n / rowsTotal < 0.1 ? 1 : 0)}%</span>` +
          `<span style="${cell}" class="muted">${fmtDuration(secs / n)}</span>`).join('') +
        `</div>`
      : '<div class="muted">No fish caught in this window.</div>';
    setTip(fishPill,
      `<div class="tip-title">Fish caught</div>` +
      `<div><b>${fish.toLocaleString()}</b> fish · <b>${fmtRate(fishPerSec * 60)}</b>/min · <b>${fmtRate(fishPerSec)}</b>/s</div>` +
      `<div class="muted">${casts.toLocaleString()} casts, ${casts ? fmtDec(fish / casts) : 0} fish per cast</div>` +
      `<div class="tip-sep"></div>${table}${footer}`);

    const chests = delta('chests');
    const chestsPerSec = chests / secs;
    chestPill.innerHTML = iconRate(chestImg, chestsPerSec * 60);
    setTip(chestPill,
      `<div class="tip-title">Chests found</div>` +
      `<div><b>${chests.toLocaleString()}</b> chests · <b>${fmtRate(chestsPerSec * 60)}</b>/min · <b>${fmtRate(chestsPerSec)}</b>/s</div>` +
      `<div class="muted">Caught while fishing; bounty, company and shop chests aren't counted.</div>${footer}`);

    const xp = delta('xp');
    const xpPerSec = xp / secs;
    const pl = S.state.player;
    const xpLeft = Math.max(0, S.xpToNext(pl.level) - pl.xp);
    xpPill.innerHTML = `+${fmtDecHtml(xpPerSec * 60)}<span class="per"> XP/min</span>`;
    setTip(xpPill,
      `<div class="tip-title">XP gained</div>` +
      `<div><b>${fmtDecHtml(xp)}</b> XP · <b>${fmtDecHtml(xpPerSec * 60)}</b>/min · <b>${fmtDecHtml(xpPerSec)}</b>/s</div>` +
      `<div>Next level (${pl.level + 1}) in about <b>${fmtDuration(xpPerSec > 0 ? xpLeft / xpPerSec : Infinity)}</b></div>${footer}`);

    for (const p of pills) {
      p.style.opacity = hiddenDuringWindow ? '0.55' : '';
      p.append(countdownBar()); // the pill's markup was just replaced, so this starts a new countdown
    }

    // Console logging, off for now that the pills show the same numbers. Uncomment to bring it back.
    // console.log(
    //   `%c[gold/s]%c ${money(goldPerSec)}/s  (${(goldPerSec / 10_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} g/s, ${money(goldPerSec * 60)}/min)` +
    //     `  ·  fish: ${fmtRate(fishPerSec)}/s (${fish} from ${casts} casts; ${rows.map(({ r, n }) => `${r.name} ${n}`).join(', ')})` +
    //     `  ·  chests: ${fmtRate(chestsPerSec)}/s (${chests} in ${secs.toFixed(1)}s, ${fmtRate(chestsPerSec * 60)}/min)` +
    //     `  ·  XP: ${fmtDec(xpPerSec)}/s (${fmtDec(xpPerSec * 60)}/min)` +
    //     (hiddenDuringWindow ? '  ⚠ tab was hidden — fishing pauses while hidden, so this is low' : ''),
    //   'color:#e8c34a;font-weight:bold', '',
    // );
    last = now;
    hiddenDuringWindow = document.visibilityState === 'hidden';
  };

  placePills();
  addEventListener('idle-angler-quicklinks', placePills);

  // ---------- Restart the window when equipped gear changes ----------
  // A reading that straddles a gear swap would mix two setups, so a swap starts a fresh window
  // (and countdown). The fingerprint is what's worn in each slot plus those items' rolls, so
  // reforging or upgrading a worn item counts too, while finding or selling other gear doesn't.
  // Checked once a second. The pills keep the previous reading until the new one lands, so you
  // can compare old gear against new; their tooltips say so.
  const gearKey = () => {
    const byUid = new Map((S.state.items ?? []).map((i) => [i.uid, i]));
    return JSON.stringify(
      Object.entries(S.state.equipped ?? {}).map(([slot, uid]) => {
        const i = byUid.get(uid);
        return [slot, uid, i && [i.tier, i.ilvl, i.ancient, i.power, i.set, i.stats, i.affixes]];
      }),
    );
  };
  const GEAR_MARK = '<!--gear-changed-->';
  let lastGear = gearKey();
  let id;
  const restartWindow = (why = 'Gear changed') => {
    clearInterval(id);
    last = sample();
    hiddenDuringWindow = document.visibilityState === 'hidden';
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const notice =
      `${GEAR_MARK}<div class="tip-sep"></div><div style="color:#fde68a">${why} at ${at}, so measuring restarted. ` +
      `These numbers are from before the change until the new reading lands.</div>`;
    for (const p of pills) {
      p.querySelector('.measured-countdown')?.remove();
      p.append(countdownBar());
      setTip(p, (tips.get(p) ?? '').split(GEAR_MARK)[0] + notice); // replaces any earlier notice
    }
    id = setInterval(tick, PERIOD_MS);
  };
  const gearTimer = setInterval(() => {
    const g = gearKey();
    if (g !== lastGear) {
      lastGear = g;
      restartWindow();
    }
  }, 1000);

  id = setInterval(tick, PERIOD_MS);
  window.setGoldLoggerPeriod = (ms) => {
    if (![5_000, 15_000, 30_000, 60_000].includes(ms) || ms === PERIOD_MS) return;
    PERIOD_MS = ms;
    restartWindow(`Measuring over ${ms < 60_000 ? `${ms / 1000} s` : '1 min'} from now`);
  };
  window.stopGoldLogger = () => {
    delete window.setGoldLoggerPeriod;
    clearInterval(id);
    clearInterval(gearTimer);
    document.removeEventListener('visibilitychange', onVis);
    removeEventListener('idle-angler-quicklinks', placePills);
    wrap.remove();
    tip.remove();
    style.remove();
    delete window.stopGoldLogger;
    // console.log('[gold/s] stopped');
  };
  // console.log(`[gold/s] started — first reading in ${PERIOD_MS / 1000}s (lifetime earned so far: ${money(last.copper)}, fish caught so far: ${last.fish}, chests found so far: ${last.chests}, total XP: ${fmtDec(last.xp)})`);
};

idleAnglerMods.define({
  id: 'incomePills',
  order: 20,
  name: "Income pills",
  desc: "Gold, fish, chests and XP a minute as you actually earn them, measured over the time below, at the top of Quicklinks (or in the top bar without it). Hover a pill for details",
  start: incomePills,
  stop: 'stopGoldLogger',
  // Shown under the mod's row; each is a localStorage key the mod reads as it starts
  options: [
    {
      key: 'idle-angler-income-period',
      label: 'Measure over',
      values: [['5000', '5 s'], ['15000', '15 s'], ['30000', '30 s'], ['60000', '1 min']],
      fallback: '60000',
      apply: (value) => window.setGoldLoggerPeriod?.(Number(value)), // live, without a restart
    },
  ],
});
