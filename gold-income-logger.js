// Idle Angler — measured gold income, fish, chest and XP rates.
// Paste into the DevTools console on https://idle-angler.onrender.com/ once you're signed in
// and the game is running. Every 60 s it measures, over that minute, the gold you actually earned,
// the fish you caught, the chests you found and the XP you gained, each per second. They show as
// pills in the top bar to the right of your Emberscales (styled like the game's own +X/s pill).
// Hover a pill for details; the fish pill breaks the catch down by rarity. A shaded bar in each
// pill shrinks as the minute runs out, and changing your equipped gear restarts the minute.
// An "Auto-click" toggle in the top bar clicks the water for you, 1-15 times a second (− / +); it starts on.
// Stop it (and remove the pills) with:  stopGoldLogger()
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

(async () => {
  const PERIOD_MS = 60_000;

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
    `transform-origin:left center;background:rgba(155,227,106,.4);animation:measured-countdown ${PERIOD_MS}ms linear forwards}` +
    '@keyframes measured-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}';
  document.head.append(style);
  const countdownBar = () => Object.assign(document.createElement('span'), { className: 'measured-countdown' });

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
  if (ember) ember.after(wrap);
  else console.warn("[gold/s] Emberscales counter not found, so the rate pills can't be shown");

  // Icons: the game's chest sprite, and a Carp (index 57) cut from the fish sprite sheet. Carp is
  // chunky and orange, so it stays readable at pill size where slimmer fish turn into a line.
  const chestImg = `<img src="${CHEST_ICON.url}" alt="chests" style="width:${CHEST_ICON.width}px;height:${CHEST_ICON.height}px;image-rendering:pixelated" />`;
  const fishImg = `<span aria-label="fish" style="display:inline-block;image-rendering:pixelated;${cellStyle(FISH_SHEET, 57, 22)}"></span>`;
  const iconRate = (icon, n) => `${icon}<span><span class="num">${fmtRate(n)}</span><span class="per">/s</span></span>`;

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
    goldPill.innerHTML = `+${moneyRateHtml(goldPerSec)}<span class="per">/s</span>`;
    setTip(goldPill,
      `<div class="tip-title">Measured income</div>` +
      `<div><b>${moneyRateHtml(goldPerSec)}</b> a second · <b>${moneyRateHtml(goldPerSec * 60)}</b> a minute</div>` +
      `<div class="muted">Everything you actually earned: fish, sales, chests, bounties, Golden Fish.</div>${footer}`);

    const fish = delta('fish');
    const casts = delta('casts');
    const fishPerSec = fish / secs;
    fishPill.innerHTML = iconRate(fishImg, fishPerSec);
    const rows = RARITIES.map((r, t) => ({ r, n: Math.max(0, now.tiers[t] - last.tiers[t]) })).filter((x) => x.n > 0);
    const rowsTotal = rows.reduce((s, x) => s + x.n, 0);
    const cell = 'text-align:right;font-variant-numeric:tabular-nums';
    const table = rows.length
      ? `<div style="display:grid;grid-template-columns:auto repeat(4,auto);column-gap:14px;row-gap:1px;margin-top:4px">` +
        `<span class="tip-head">Rarity</span><span class="tip-head" style="${cell}">Caught</span><span class="tip-head" style="${cell}">/s</span><span class="tip-head" style="${cell}">Share</span><span class="tip-head" style="${cell}">One every</span>` +
        rows.map(({ r, n }) =>
          `<b style="color:${hex(r.color)}">${r.name}</b>` +
          `<span style="${cell}">${n.toLocaleString()}</span>` +
          `<span style="${cell}">${fmtRate(n / secs)}</span>` +
          `<span style="${cell}">${((n / rowsTotal) * 100).toFixed(n / rowsTotal < 0.1 ? 1 : 0)}%</span>` +
          `<span style="${cell}" class="muted">${fmtDuration(secs / n)}</span>`).join('') +
        `</div>`
      : '<div class="muted">No fish caught in this window.</div>';
    setTip(fishPill,
      `<div class="tip-title">Fish caught</div>` +
      `<div><b>${fish.toLocaleString()}</b> fish · <b>${fmtRate(fishPerSec)}</b>/s · <b>${fmtRate(fishPerSec * 60)}</b>/min</div>` +
      `<div class="muted">${casts.toLocaleString()} casts, ${casts ? fmtDec(fish / casts) : 0} fish per cast</div>` +
      `<div class="tip-sep"></div>${table}${footer}`);

    const chests = delta('chests');
    const chestsPerSec = chests / secs;
    chestPill.innerHTML = iconRate(chestImg, chestsPerSec);
    setTip(chestPill,
      `<div class="tip-title">Chests found</div>` +
      `<div><b>${chests.toLocaleString()}</b> chests · <b>${fmtRate(chestsPerSec)}</b>/s · <b>${fmtRate(chestsPerSec * 60)}</b>/min</div>` +
      `<div class="muted">Caught while fishing; bounty, company and shop chests aren't counted.</div>${footer}`);

    const xp = delta('xp');
    const xpPerSec = xp / secs;
    const pl = S.state.player;
    const xpLeft = Math.max(0, S.xpToNext(pl.level) - pl.xp);
    xpPill.innerHTML = `+${fmtDecHtml(xpPerSec)}<span class="per"> XP/s</span>`;
    setTip(xpPill,
      `<div class="tip-title">XP gained</div>` +
      `<div><b>${fmtDecHtml(xp)}</b> XP · <b>${fmtDecHtml(xpPerSec)}</b>/s · <b>${fmtDecHtml(xpPerSec * 60)}</b>/min</div>` +
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

  // ---------- Auto-clicker ----------
  // The game allows auto-clicking: clicks over 15 a second simply don't count, on this side and on
  // the server, and nobody is flagged (clicks.js; changelog "No more auto-clicker detection").
  // A click is a pointerdown + pointerup sent straight to the game's canvas, which is where Pixi
  // listens, so it takes the same path as your own clicks (Golden Fish check, the 15/s limiter,
  // Frenzy). The events don't bubble, so the page's own menu and tooltip handlers never see them.
  // Your own clicks share the same 15/s budget while it runs.
  // The beat comes from a tiny Web Worker, because Chrome slows timers in background tabs to once a
  // second (and later once a minute) but not a worker's messages, so it keeps clicking when the tab
  // isn't in front. It starts on when you paste the script (click the pill to stop it); the − / +
  // buttons set the rate, which this browser remembers.
  const AUTO_MIN = 1, AUTO_MAX = 15; // 15 is the game's cap: at it, timer jitter loses the odd click
  const AUTO_KEY = 'measured-autoclick-cps';
  let autoCps = 14;
  try { autoCps = Math.min(AUTO_MAX, Math.max(AUTO_MIN, Math.round(+localStorage.getItem(AUTO_KEY)) || 14)); } catch {}
  const autoWrap = document.createElement('div');
  autoWrap.className = 'currency';
  autoWrap.id = 'measured-autoclick-wrap';
  autoWrap.style.cssText = 'display:flex;align-items:center;gap:3px';
  const autoBtn = document.createElement('span');
  autoBtn.className = 'rate';
  autoBtn.setAttribute('role', 'button');
  autoBtn.style.cssText = 'cursor:pointer;user-select:none';
  const stepBtn = (label, delta) => {
    const b = document.createElement('span');
    b.className = 'rate';
    b.setAttribute('role', 'button');
    b.textContent = label;
    b.style.cssText = 'cursor:pointer;user-select:none;min-width:1.4em;text-align:center;padding-left:0;padding-right:0';
    b.addEventListener('click', () => setRate(autoCps + delta));
    attachTip(b);
    return b;
  };
  const minusBtn = stepBtn('−', -1);
  const plusBtn = stepBtn('+', 1);
  autoWrap.append(autoBtn, minusBtn, plusBtn);
  wrap.after(autoWrap);
  attachTip(autoBtn);

  const clickCanvas = () => {
    const c = document.querySelector('#game > canvas');
    const r = c?.getBoundingClientRect();
    if (!r?.width) return false;
    const init = {
      clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.45,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: false, cancelable: true,
    };
    c.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
    c.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    return true;
  };

  // The game's connection banner (#conn-status, main.js) is up while its server stream is down:
  // reconnecting, restarting for an update, or replaced by another tab. Clicks sent then are refused
  // (HTTP 409, "not connected yet") and dropped, so the auto-clicker holds off until the banner goes.
  // "A new version is out" (class update) keeps the connection, so clicking carries on through it.
  // The banner shows after 3 s down, so the first few seconds of a drop still get the odd 409.
  const offline = () => {
    const el = document.getElementById('conn-status');
    return !!el && !el.classList.contains('update');
  };

  let beat = null; // { worker, stop() }
  const startBeat = (fn, ms) => {
    try {
      const src = 'let t;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = fn;
      w.postMessage(ms);
      return { worker: true, stop: () => w.terminate() };
    } catch {
      const t = setInterval(fn, ms); // the page blocks workers: foreground-only timing
      return { worker: false, stop: () => clearInterval(t) };
    }
  };

  // While on: { since, clicks0, sent, low, held, paused } where low is the lowest Frenzy fill seen just
  // before a click since the last tooltip refresh (the bottom of the bar's sawtooth), i.e. how full it
  // stays; held counts the beats skipped while the game was offline, paused says it is right now.
  let auto = null;
  const pct = (x) => `${Math.floor(x * 100)}%`;
  const renderAuto = () => {
    autoBtn.innerHTML = !auto
      ? `<span class="muted">Auto-click off</span> <span class="per muted">${autoCps}/s</span>`
      : auto.paused
        ? `<span>Auto-click paused</span> <span class="per">${autoCps}/s</span>`
        : `<span>Auto-click</span> <span class="per">${autoCps}/s</span>`;
    autoBtn.style.background = !auto ? '' : auto.paused ? 'rgba(253,230,138,.35)' : 'rgba(155,227,106,.4)';
    minusBtn.style.opacity = autoCps <= AUTO_MIN ? '.4' : '';
    plusBtn.style.opacity = autoCps >= AUTO_MAX ? '.4' : '';
    setTip(minusBtn, autoCps <= AUTO_MIN ? `<div class="muted">Already at ${AUTO_MIN} a second.</div>` : `<div>Slower: ${autoCps - 1} clicks a second</div>`);
    setTip(plusBtn, autoCps >= AUTO_MAX ? `<div class="muted">${AUTO_MAX} a second is the most the game counts.</div>` : `<div>Faster: ${autoCps + 1} clicks a second</div>`);
    let body;
    if (auto) {
      const secs = (performance.now() - auto.since) / 1000;
      const counted = (S.state.stats?.clicks ?? 0) - auto.clicks0;
      const frenzy = auto.low === Infinity ? '' :
        `<div>Frenzy bar: stays at <b>${pct(auto.low)}</b> or more <span class="muted">(×${fmtDec(S.frenzyMult())} luck now)</span></div>`;
      auto.low = Infinity;
      body =
        `<div>Clicking the water ${autoCps} times a second. Click to stop.</div>` +
        (auto.paused ? `<div style="color:#fde68a">Paused while the game reconnects to the server; it carries on by itself once it's back.</div>` : '') +
        '<div class="tip-sep"></div>' +
        frenzy +
        `<div>Sent: <b>${auto.sent}</b> in ${fmtDuration(secs)}</div>` +
        (auto.held ? `<div class="muted">Held back while reconnecting: ${auto.held}</div>` : '') +
        `<div>Counted by the game: <b>${counted}</b>${secs >= 5 ? ` <span class="muted">(${fmtRate(counted / secs)}/s)</span>` : ''}</div>` +
        `<div class="muted">The count comes from the server, so it trails a little.</div>` +
        (beat?.worker ? '' : `<div style="color:#fde68a">This page blocks the background timer, so it only clicks while the tab is in front.</div>`);
    } else {
      body =
        `<div>Click to start clicking the water ${autoCps} times a second (− / + to change).</div>` +
        `<div class="muted">The game counts up to 15 clicks a second and ignores the rest; it doesn't flag auto-clicking. ` +
        `It keeps going in a background tab.</div>`;
    }
    setTip(autoBtn, `<div class="tip-title">Auto-clicker</div>${body}`);
  };
  const setAuto = (on) => {
    beat?.stop();
    beat = null;
    auto = null;
    if (on) {
      auto = { since: performance.now(), clicks0: S.state.stats?.clicks ?? 0, sent: 0, low: Infinity, held: 0, paused: false };
      beat = startBeat(() => {
        const down = offline();
        if (down !== auto.paused) { auto.paused = down; renderAuto(); }
        if (down) { auto.held++; return; }
        const f = S.frenzyFill?.();
        if (f != null && f < auto.low) auto.low = f;
        if (clickCanvas()) auto.sent++;
      }, 1000 / autoCps);
    }
    renderAuto();
  };
  // A new rate restarts the beat (and the sent/counted tally, so its rate reads true).
  const setRate = (n) => {
    n = Math.min(AUTO_MAX, Math.max(AUTO_MIN, n));
    if (n === autoCps) return;
    autoCps = n;
    try { localStorage.setItem(AUTO_KEY, String(n)); } catch {}
    if (auto) setAuto(true);
    else renderAuto();
  };
  autoBtn.addEventListener('click', () => setAuto(!auto));
  setAuto(true); // on from the start; click the pill to stop it
  const autoTipTimer = setInterval(() => { if (auto) renderAuto(); }, 1000);

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
  const restartWindow = () => {
    clearInterval(id);
    last = sample();
    hiddenDuringWindow = document.visibilityState === 'hidden';
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const notice =
      `${GEAR_MARK}<div class="tip-sep"></div><div style="color:#fde68a">Gear changed at ${at}, so measuring restarted. ` +
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
  window.stopGoldLogger = () => {
    clearInterval(id);
    clearInterval(gearTimer);
    clearInterval(autoTipTimer);
    beat?.stop();
    autoWrap.remove();
    document.removeEventListener('visibilitychange', onVis);
    wrap.remove();
    tip.remove();
    style.remove();
    delete window.stopGoldLogger;
    // console.log('[gold/s] stopped');
  };
  // console.log(`[gold/s] started — first reading in ${PERIOD_MS / 1000}s (lifetime earned so far: ${money(last.copper)}, fish caught so far: ${last.fish}, chests found so far: ${last.chests}, total XP: ${fmtDec(last.xp)})`);
})();
