// Idle Angler — weather forecast.
// Paste into the DevTools console on https://idle-angler.onrender.com/ once the game is running. It adds
// a Forecast window, in the game's own window frame, that opens when you click the time and weather in
// the top bar or press W (not while typing in chat or a box). It has three views, all in game time:
//  - Hourly: the next 48 in-game hours (80 real minutes), hour by hour
//  - 10 Day: the next 10 in-game days (about 6½ real hours)
//  - Monthly: a calendar of in-game days (about 20 real hours a month); ‹ › change the month
// 10 Day and Monthly show only the rarest weather of each day.
// The game has no calendar, so the script makes one up: in-game day N (since the clock's start, each
// day running dawn to dawn, 05:00 to 05:00) gets the weekday and date of real day N. It's only there
// to give the days names.
// The weather is a fixed function of the shared server clock (world.js hashes each 12-minute slot), so
// the forecast is exact. The exception is weather someone sets for everyone: it shows while it lasts,
// but a change set later can't be known in advance.
// Stop it (and remove the window) with:  stopWeatherForecast()

(async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const {
    worldAt, serverNow, getForcedWeather, formatHour, clock: worldClock,
    DAY_LENGTH_MS: DAY, WEATHER_SLOT_MS: SLOT, PHASES, WEATHERS, WEATHER_BY_ID,
  } = await mod('/src/world.js');

  window.stopWeatherForecast?.(); // replace one already running

  const root = document.getElementById('windows');
  if (!root) return console.warn('[forecast] The game page was not found (#windows)');

  const HOUR = DAY / 24; // an in-game hour (100 real seconds)
  const HOURLY_ROWS = 48;
  const DAILY_ROWS = 10;
  const STORE_KEY = 'idle-angler-forecast';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- The weather at any moment ----------
  // A copy of world.js's slot weather, so past days aren't coloured by weather someone set for
  // everyone (worldAt applies that to every time before it ends). Checked against worldAt below.
  function hash01(n) {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  const phaseAt = (t) => {
    const frac = (((t % DAY) + DAY) % DAY) / DAY;
    return PHASES.find((p) => frac >= p.start && frac < p.end) ?? PHASES[0];
  };
  const slotWeather = (slot) => {
    const phase = phaseAt((slot + 0.5) * SLOT).id;
    const options = WEATHERS.filter((w) => !w.phase || w.phase === phase);
    let roll = hash01(slot) * options.reduce((s, w) => s + w.weight, 0);
    for (const w of options) if ((roll -= w.weight) < 0) return w;
    return options[0];
  };
  const natural = (t) => {
    const w = slotWeather(Math.floor(t / SLOT));
    return w.phase && w.phase !== phaseAt(t).id ? WEATHER_BY_ID.clear : w;
  };
  const offset = () => serverNow() - worldClock.now(); // server time minus local time

  // If the copy ever disagrees with the game, use the game's worldAt for everything
  let exact = true;
  {
    const nowS = serverNow();
    const forcedUntil = getForcedWeather()?.until ?? 0;
    for (let i = 0; i < 400 && exact; i++) {
      const t = nowS + hash01(i + 77) * 30 * DAY;
      if (t < forcedUntil) continue;
      if (natural(t).id !== worldAt(t - offset(), {}).weather.id) exact = false;
    }
    if (!exact) console.warn('[forecast] The game’s weather rules changed; past days may show weather set for everyone');
  }

  /** The weather at server time t: { w, forced, by }. Weather set for everyone counts from now until it ends. */
  function weatherAt(t, forced, nowS) {
    if (forced && t >= nowS && t < forced.until) return { w: WEATHER_BY_ID[forced.weather] ?? natural(t), forced: true, by: forced.by };
    if (exact) return { w: natural(t), forced: false };
    const w = worldAt(t - offset(), {});
    return { w: w.weather, forced: w.forcedWeather, by: w.forcedBy };
  }

  /**
   * Runs of one weather in [a, b) (server time): { start, end, w, forced, by, phase (where it starts) }.
   * Walks the stretches in which neither the weather slot nor the time of day changes.
   */
  function segments(a, b, { naturalOnly = false } = {}) {
    const nowS = serverNow();
    const forced = naturalOnly ? null : getForcedWeather();
    const out = [];
    let t = a;
    while (t < b) {
      const dayStart = t - (((t % DAY) + DAY) % DAY);
      const cuts = [(Math.floor(t / SLOT) + 1) * SLOT, PHASES.map((p) => dayStart + p.end * DAY).find((x) => x > t), b];
      if (forced && forced.until > t) cuts.push(forced.until);
      if (forced && nowS > t) cuts.push(nowS);
      const e = Math.min(...cuts);
      const x = naturalOnly ? { w: natural((t + e) / 2), forced: false } : weatherAt((t + e) / 2, forced, nowS);
      const last = out[out.length - 1];
      if (last && last.w === x.w && last.forced === x.forced && last.end === t) last.end = e;
      else out.push({ start: t, end: e, w: x.w, forced: x.forced, by: x.by, phase: phaseAt(t) });
      t = e;
    }
    return out;
  }

  // ---------- Rarity ----------
  // How much of the time each weather is up, worked out over one full cycle of slots and days. The
  // rarest weather of a day is the one with the smallest share (ties: the earlier in the game's list).
  const share = Object.fromEntries(WEATHERS.map((w) => [w.id, 0]));
  {
    const gcd = (x, y) => (y ? gcd(y, x % y) : x);
    const cycle = (DAY / gcd(DAY, SLOT)) * SLOT;
    const step = SLOT / 120;
    for (let t = 0; t < cycle; t += step) {
      const slotPhase = phaseAt((Math.floor(t / SLOT) + 0.5) * SLOT).id;
      const phase = phaseAt(t + step / 2).id;
      const options = WEATHERS.filter((w) => !w.phase || w.phase === slotPhase);
      const total = options.reduce((s, w) => s + w.weight, 0);
      for (const w of options) share[!w.phase || w.phase === phase ? w.id : 'clear'] += w.weight / total;
    }
    const sum = Object.values(share).reduce((s, v) => s + v, 0);
    for (const id in share) share[id] /= sum;
  }
  const RARITY = [...WEATHERS].sort((x, y) => share[x.id] - share[y.id] || WEATHERS.indexOf(x) - WEATHERS.indexOf(y));
  const rank = Object.fromEntries(RARITY.map((w, i) => [w.id, i]));
  const rarestSeg = (segs) => segs.reduce((best, s) => (rank[s.w.id] < rank[best.w.id] ? s : best));
  // How often each weather is the rarest of its day (the Monthly view's key), over a long run of days
  const dayShare = Object.fromEntries(WEATHERS.map((w) => [w.id, 0]));
  {
    const n0 = Math.floor(serverNow() / DAY);
    const N = 3000;
    for (let n = n0; n < n0 + N; n++) dayShare[rarestSeg(segments(n * DAY, (n + 1) * DAY, { naturalOnly: true })).w.id] += 1 / N;
  }

  // ---------- Formatting ----------
  const COLOR = {
    clear: '#fde68a', cloudy: '#cbd5e1', rain: '#60a5fa', fog: '#e2e8f0', storm: '#facc15', cursed: '#a3e635',
    snow: '#bae6fd', acid: '#4ade80', blood: '#f87171', aurora: '#5eead4', meteor: '#c4b5fd',
  };
  const color = (w) => COLOR[w.id] ?? '#e5e7eb';
  // The game's top-bar icons; Clear has none, so it shows the sun (or the time of day's own icon)
  const iconSrc = (w, phaseId = 'day') => `/assets/icons/hud/${w.id === 'clear' ? phaseId : w.id}.svg`;
  const icon = (w, phaseId, cls = '') => `<img class="wf-ic ${cls}" src="${iconSrc(w, phaseId)}" alt="">`;
  const gameTime = (t) => formatHour((5 + ((((t % DAY) + DAY) % DAY) / DAY) * 24) % 24);
  const wall = (t) => new Date(t - offset()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const dur = (ms, seconds = false) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 10 && seconds) return `${m}m ${pad(s % 60)}s`;
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${pad(m % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  };
  const rel = (t, nowS) => {
    const d = t - nowS;
    if (d > 0) return d < 60_000 ? 'in <1m' : `in ${dur(d)}`;
    return -d < 60_000 ? 'now' : `${dur(-d)} ago`;
  };
  const oneIn = (p) => (p <= 0 ? 'never' : p >= 0.5 ? `${Math.round(p * 100)}% of days` : `1 day in ${Math.round(1 / p)}`);

  // The made-up calendar: in-game day n is named after real day n since 1 January 1970
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateOf = (n) => new Date(n * 86_400_000);
  const shortDate = (n) => `${WD[dateOf(n).getUTCDay()]} ${dateOf(n).getUTCDate()}`;
  const dayName = (n, n0) => (n === n0 ? 'Today' : n === n0 + 1 ? 'Tomorrow' : shortDate(n));

  // ---------- Saved window place and view ----------
  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
  };
  const saved = load();
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* storage blocked: not remembered */ }
  };
  let tab = ['hourly', 'daily', 'monthly'].includes(saved.tab) ? saved.tab : 'hourly';
  let monthShift = 0; // months from the current one, in the Monthly view

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.id = 'wf-style';
  style.textContent = `
#wf-win[hidden]{display:none}
#wf-win.wf-still{animation:none}
#wf-win .win-title .wf-ticon{width:1.15em;height:auto;image-rendering:pixelated}
#wf-win .wf-ic{display:block;width:22px;height:20px;image-rendering:pixelated;justify-self:center}
#wf-win .wf-ic.big{width:44px;height:40px}
#wf-win .wf-ic.mid{width:28px;height:26px}
#wf-win .wf-ic.sm{width:14px;height:13px;display:inline-block;vertical-align:-2px}
#wf-win .wf-muted{color:var(--muted)}
#wf-win .wf-small{font-size:12px}
#wf-win .wf-now{display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;align-items:center;padding:10px 12px;margin-bottom:10px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--wc) 16%,transparent),rgba(0,0,0,.22));box-shadow:inset 3px 0 0 var(--wc)}
#wf-win .wf-now .wf-ic{grid-row:span 2}
#wf-win .wf-now .wf-name{font:400 24px/1.1 var(--title);color:var(--wc)}
#wf-win .wf-now .wf-clock{font:600 15px var(--num);text-shadow:1px 1px 0 #000}
#wf-win .wf-now .wf-side{grid-row:span 2;display:grid;gap:3px;justify-items:end;text-align:right;font-size:12px}
#wf-win .wf-now .wf-desc{grid-column:2;font-size:12px}
#wf-win .wf-tabs{position:sticky;top:-10px;z-index:3;margin:0 -8px 8px;padding:0 8px;background:#223020}
#wf-win .wf-tabs .win-tab kbd{display:none}
#wf-win .wf-head{display:flex;align-items:baseline;gap:8px;padding:8px 6px 4px;font-weight:700;color:var(--accent);border-bottom:1px solid #3a4a30}
#wf-win .wf-head:first-child{padding-top:0}
#wf-win .wf-row{display:grid;grid-template-columns:62px 30px minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:5px 6px;
  border-bottom:1px solid rgba(58,74,48,.55);box-shadow:inset 3px 0 0 color-mix(in srgb,var(--wc) 70%,transparent)}
#wf-win .wf-row.daily{grid-template-columns:86px 34px minmax(0,1fr) auto;padding:7px 6px}
#wf-win .wf-row.now{background:rgba(253,230,138,.08)}
#wf-win .wf-row.past{opacity:.5}
#wf-win .wf-t{display:grid;line-height:1.15}
#wf-win .wf-t b{font:600 14px var(--num)}
#wf-win .wf-w{display:grid;min-width:0;line-height:1.2}
#wf-win .wf-w b{color:var(--wc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wf-win .wf-w span{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wf-win .wf-r{display:grid;justify-items:end;text-align:right;line-height:1.2;font-size:12px;white-space:nowrap}
#wf-win .wf-tag{padding:0 4px;font-size:11px;color:#1a1a1a;background:var(--wc)}
#wf-win .wf-month{display:flex;align-items:center;gap:8px;margin-bottom:8px}
#wf-win .wf-month h3{flex:1;margin:0;text-align:center;font:400 20px var(--title);color:var(--accent)}
#wf-win .wf-month button{min-width:30px}
#wf-win .wf-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
#wf-win .wf-cal .wd{padding:2px 0 4px;text-align:center;font-size:11px;font-weight:700;color:var(--muted)}
#wf-win .wf-day{position:relative;display:grid;justify-items:center;align-content:center;gap:2px;min-height:62px;padding:16px 2px 4px;
  background:linear-gradient(color-mix(in srgb,var(--wc) 14%,transparent),rgba(0,0,0,.25));box-shadow:inset 0 0 0 1px rgba(0,0,0,.45)}
#wf-win .wf-day .num{position:absolute;left:4px;top:2px;font:600 12px var(--num);text-shadow:1px 1px 0 #000}
#wf-win .wf-day .nm{max-width:100%;font-size:11px;line-height:1.1;color:var(--wc);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-win .wf-day.past{opacity:.45}
#wf-win .wf-day.today{box-shadow:inset 0 0 0 2px var(--accent)}
#wf-win .wf-day.blank{background:none;box-shadow:none}
#wf-win .wf-key{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:10px;font-size:12px}
#wf-win .wf-key span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
#wf-win .wf-key b{color:var(--wc);font-weight:600}
#wf-win .wf-note{margin:8px 2px 0;font-size:12px;color:var(--muted)}
#world.wf-link{cursor:pointer}
`;
  document.head.append(style);

  // ---------- The window (the game's own frame and parts) ----------
  const win = document.createElement('section');
  win.className = 'window';
  win.id = 'wf-win';
  win.dataset.win = 'forecast';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'Forecast');
  win.hidden = true;
  win.innerHTML = `
    <header class="win-head">
      <div class="win-title"><img class="wf-ticon" src="/assets/icons/hud/rain.svg" alt=""><h2>Forecast</h2></div>
      <kbd>W</kbd>
      <button class="win-close" aria-label="Close Forecast">✕</button>
    </header>
    <div class="win-body">
      <div class="wf-nowbox"></div>
      <div class="win-tabs wf-tabs"></div>
      <div class="wf-view"></div>
    </div>
    <div class="win-resize" title="Drag to resize · double-click for the normal size"></div>`;
  // First in the container: when the game focuses one of its own windows it can tie with this one's
  // stacking order, and then the later one in the page (the game's) is the one on top.
  root.prepend(win);
  const head = win.querySelector('.win-head');
  const body = win.querySelector('.win-body');
  const nowBox = win.querySelector('.wf-nowbox');
  const tabsBox = win.querySelector('.wf-tabs');
  const view = win.querySelector('.wf-view');
  const grip = win.querySelector('.win-resize');

  const NARROW = 720;
  const MIN_W = 340;
  const MIN_H = 240;
  const TOP_GAP = 14;
  const narrow = () => root.clientWidth < NARROW;
  const others = () => [...root.querySelectorAll('.window')].filter((el) => el !== win);
  const zOf = (el) => Number(el.style.zIndex) || 0;

  function clamp(x, y) {
    const maxX = Math.max(0, root.clientWidth - 120);
    const maxY = Math.max(TOP_GAP, root.clientHeight - 48);
    const top = Math.round(Math.min(Math.max(TOP_GAP, y), maxY));
    win.style.left = `${Math.round(Math.min(Math.max(0, x), maxX))}px`;
    win.style.top = `${top}px`;
    win.style.maxHeight = `${Math.max(MIN_H, root.clientHeight - top - 4)}px`;
  }
  function place() {
    if (narrow()) {
      win.style.left = win.style.top = win.style.width = win.style.height = win.style.maxHeight = '';
      return;
    }
    const width = Math.min(saved.w ?? 600, root.clientWidth - 16);
    win.style.width = `${width}px`;
    win.style.height = saved.h ? `${Math.min(saved.h, root.clientHeight - TOP_GAP)}px` : '';
    clamp(saved.x ?? (root.clientWidth - width) / 2, saved.y ?? 40);
  }
  function focus() {
    win.style.zIndex = String(Math.max(10, ...others().map(zOf)) + 1);
    for (const el of others()) el.classList.remove('focused');
    win.classList.add('focused');
  }
  const isOpen = () => !win.hidden;
  const onTop = () => isOpen() && others().every((el) => zOf(el) < zOf(win));

  function open() {
    if (narrow()) for (const el of others()) el.querySelector('.win-close')?.click(); // one window at a time there
    win.hidden = false;
    win.classList.remove('wf-still');
    setTimeout(() => win.classList.add('wf-still'), 200); // the pop-in plays once
    place();
    focus();
    render(true);
  }
  function close() {
    win.hidden = true;
    win.classList.remove('focused');
  }
  const toggle = () => (isOpen() ? close() : open());

  win.addEventListener('pointerdown', focus);
  win.querySelector('.win-close').addEventListener('click', close);
  // Clicking any of the game's windows takes the focus glow away from this one
  const onRootDown = (e) => {
    if (!win.contains(e.target) && e.target.closest?.('.window')) win.classList.remove('focused');
  };
  root.addEventListener('pointerdown', onRootDown);
  // On narrow screens the game shows one window at a time: one of its windows opening closes this
  const observer = new MutationObserver((list) => {
    if (narrow() && isOpen() && list.some((m) => [...m.addedNodes].some((n) => n !== win && n.classList?.contains('window')))) close();
  });
  observer.observe(root, { childList: true });

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || narrow()) return;
    e.preventDefault();
    const sx = e.clientX - win.offsetLeft;
    const sy = e.clientY - win.offsetTop;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => clamp(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      Object.assign(saved, { x: win.offsetLeft, y: win.offsetTop });
      save();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || narrow()) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const sw = win.offsetWidth;
    const sh = win.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    win.classList.add('resizing');
    const move = (ev) => {
      win.style.width = `${Math.round(Math.min(Math.max(MIN_W, sw + ev.clientX - sx), root.clientWidth - win.offsetLeft))}px`;
      win.style.height = `${Math.round(Math.min(Math.max(MIN_H, sh + ev.clientY - sy), root.clientHeight - win.offsetTop))}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      win.classList.remove('resizing');
      Object.assign(saved, { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight });
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    delete saved.w;
    delete saved.h;
    save();
    place();
  });

  // ---------- Views ----------
  function nowHtml(nowS) {
    const segs = segments(nowS, nowS + 3 * DAY);
    const cur = segs[0];
    const next = segs[1];
    const phase = phaseAt(nowS);
    const dayStart = nowS - (nowS % DAY);
    const phaseEnd = dayStart + phase.end * DAY;
    const nextPhase = PHASES[(PHASES.indexOf(phase) + 1) % PHASES.length];
    return `<div class="wf-now" style="--wc:${color(cur.w)}">
      ${icon(cur.w, phase.id, 'big')}
      <div><span class="wf-name">${esc(cur.w.name)}</span></div>
      <div class="wf-side">
        ${next ? `<span>Then ${icon(next.w, next.phase.id, 'sm')} <b style="color:${color(next.w)}">${esc(next.w.name)}</b> at ${gameTime(next.start)}</span>
        <span class="wf-muted">in ${dur(next.start - nowS, true)} · ${wall(next.start)}</span>` : ''}
        <span>${icon(WEATHER_BY_ID.clear, nextPhase.id, 'sm')} ${esc(nextPhase.name)} at ${gameTime(phaseEnd)} <span class="wf-muted">in ${dur(phaseEnd - nowS, true)}</span></span>
      </div>
      <div class="wf-desc">
        <span class="wf-clock">${gameTime(nowS)}</span> · ${esc(phase.name)} <span class="wf-muted">(${esc(phase.desc)})</span><br>
        ${esc(cur.w.desc)}${cur.forced ? ` <span class="wf-muted">· set for everyone${cur.by ? ` by ${esc(cur.by)}` : ''}</span>` : ''}
      </div>
    </div>`;
  }

  const row = (cls, w, cells) => `<div class="wf-row ${cls}" style="--wc:${color(w)}">${cells}</div>`;

  function hourlyHtml(nowS) {
    const n0 = Math.floor(nowS / DAY);
    const first = Math.floor(nowS / HOUR) * HOUR;
    let html = '';
    let lastDay = null;
    for (let k = 0; k < HOURLY_ROWS; k++) {
      const a = first + k * HOUR;
      const from = Math.max(a, nowS);
      const n = Math.floor(a / DAY);
      if (n !== lastDay) {
        html += `<div class="wf-head">${dayName(n, n0)}${n - n0 < 2 ? ` <span class="wf-muted wf-small">${shortDate(n)}</span>` : ''}</div>`;
        lastDay = n;
      }
      const segs = segments(from, a + HOUR);
      const s = rarestSeg(segs);
      const later = s.start > from; // the rarest weather of the hour starts partway through it
      html += row(k === 0 ? 'now' : '', s.w, `
        <div class="wf-t"><b>${k === 0 ? 'Now' : gameTime(a)}</b><span class="wf-muted wf-small">${wall(from)}</span></div>
        ${icon(s.w, s.phase.id)}
        <div class="wf-w"><b>${esc(s.w.name)}${later ? ` <span class="wf-muted wf-small">from ${gameTime(s.start)}</span>` : ''}${s.forced ? ' <span class="wf-tag">set</span>' : ''}</b><span title="${esc(s.w.desc)}">${esc(s.w.desc)}</span></div>
        <div class="wf-r"><span>${icon(WEATHER_BY_ID.clear, s.phase.id, 'sm')} ${esc(s.phase.name)}</span><span class="wf-muted">${k === 0 ? 'now' : rel(later ? s.start : a, nowS)}</span></div>`);
    }
    return html + `<p class="wf-note">One in-game hour is 100 real seconds; weather can change every 12 real minutes. Each hour shows its rarest weather.</p>`;
  }

  /** A day's rarest weather, and the run of it to point at (the one still to come, else the last). */
  function dayInfo(n, nowS) {
    const segs = segments(n * DAY, (n + 1) * DAY);
    const best = rarestSeg(segs);
    const runs = segs.filter((s) => s.w === best.w && s.forced === best.forced);
    const run = runs.find((r) => r.end > nowS) ?? runs[runs.length - 1];
    return { w: best.w, forced: best.forced, runs, run, allDay: segs.length === 1 };
  }

  function dailyHtml(nowS) {
    const n0 = Math.floor(nowS / DAY);
    let html = '';
    for (let i = 0; i < DAILY_ROWS; i++) {
      const n = n0 + i;
      const d = dayInfo(n, nowS);
      const r = d.run;
      const live = r.start <= nowS && r.end > nowS;
      const more = d.runs.length > 1 ? ` <span class="wf-muted">+${d.runs.length - 1} more</span>` : '';
      const when = d.allDay ? 'All day' : `${gameTime(r.start)}–${gameTime(r.end)} · ${esc(r.phase.name)}`;
      const real = live ? `now, for ${dur(r.end - nowS)}` : r.end <= nowS ? `ended ${dur(nowS - r.end)} ago` : `${rel(r.start, nowS)} · ${wall(r.start)}`;
      html += row(i === 0 ? 'daily now' : 'daily', d.w, `
        <div class="wf-t"><b>${dayName(n, n0)}</b><span class="wf-muted wf-small">${i < 2 ? shortDate(n) : `${MONTHS[dateOf(n).getUTCMonth()].slice(0, 3)} ${dateOf(n).getUTCDate()}`}</span></div>
        ${icon(d.w, 'day', 'mid')}
        <div class="wf-w"><b>${esc(d.w.name)}${d.forced ? ' <span class="wf-tag">set</span>' : ''}</b><span title="${esc(d.w.desc)}">${esc(d.w.desc)}</span></div>
        <div class="wf-r"><span>${when}${more}</span><span class="wf-muted">${real}</span></div>`);
    }
    return html + `<p class="wf-note">Each day runs from dawn to dawn (05:00 to 05:00 in game, 40 real minutes) and shows only its rarest weather.</p>`;
  }

  function monthlyHtml(nowS) {
    const n0 = Math.floor(nowS / DAY);
    const today = dateOf(n0);
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthShift, 1));
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const nFirst = Math.round(first.getTime() / 86_400_000);
    const lead = first.getUTCDay();
    let cells = WD.map((d) => `<div class="wd">${d}</div>`).join('');
    cells += '<div class="wf-day blank"></div>'.repeat(lead);
    for (let i = 0; i < days; i++) {
      const n = nFirst + i;
      const d = dayInfo(n, nowS);
      const r = d.run;
      const tip = `${shortDate(n)}: ${d.w.name}${d.allDay ? ', all day' : `, ${gameTime(r.start)}–${gameTime(r.end)}`}${d.runs.length > 1 ? ` (+${d.runs.length - 1} more)` : ''}\n${d.w.desc}\n${r.end <= nowS ? `ended ${dur(nowS - r.end)} ago` : r.start <= nowS ? 'now' : `${rel(r.start, nowS)} (${new Date(r.start - offset()).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })})`}`;
      cells += `<div class="wf-day ${n < n0 ? 'past' : ''} ${n === n0 ? 'today' : ''}" style="--wc:${color(d.w)}" title="${esc(tip)}">
        <span class="num">${i + 1}</span>${icon(d.w, 'day')}<span class="nm">${esc(d.w.name)}</span></div>`;
    }
    const key = RARITY.filter((w) => dayShare[w.id] > 0)
      .map((w) => `<span style="--wc:${color(w)}">${icon(w, 'day', 'sm')}<b>${esc(w.name)}</b><span class="wf-muted">${oneIn(dayShare[w.id])}</span></span>`)
      .join('');
    const realStart = new Date(nFirst * DAY - offset());
    return `
      <div class="wf-month">
        <button class="btn" data-wf-month="-1" aria-label="Previous month">‹</button>
        <h3>${MONTHS[first.getUTCMonth()]}</h3>
        <button class="btn" data-wf-month="1" aria-label="Next month">›</button>
        ${monthShift ? '<button class="btn" data-wf-month="0">This month</button>' : ''}
      </div>
      <div class="wf-cal">${cells}</div>
      <div class="wf-key"><span class="wf-muted">Rarest weather of the day, rarest first:</span>${key}</div>
      <p class="wf-note">An in-game month is ${days} days, about ${Math.round((days * DAY) / 3_600_000)} real hours; this one ${realStart.getTime() > Date.now() ? 'starts' : 'started'} ${realStart.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Hover a day for its times.</p>`;
  }

  const TABS = [
    { id: 'hourly', name: 'Hourly', html: hourlyHtml },
    { id: 'daily', name: '10 Day', html: dailyHtml },
    { id: 'monthly', name: 'Monthly', html: monthlyHtml },
  ];

  let lastTabs = '';
  let lastView = '';
  function render(force = false) {
    if (!isOpen()) return;
    const nowS = serverNow();
    nowBox.innerHTML = nowHtml(nowS);
    const tabs = TABS.map((t) => `<button class="win-tab ${t.id === tab ? 'active' : ''}" data-wf-tab="${t.id}">${t.name}</button>`).join('');
    if (force || tabs !== lastTabs) tabsBox.innerHTML = lastTabs = tabs;
    // The list only changes when its text does (minutes), so hovering and tooltips aren't disturbed every second
    const html = TABS.find((t) => t.id === tab).html(nowS);
    if (force || html !== lastView) view.innerHTML = lastView = html;
  }

  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-wf-tab]');
    if (t) {
      tab = saved.tab = t.dataset.wfTab;
      save();
      monthShift = 0;
      body.scrollTop = 0;
      return render(true);
    }
    const m = e.target.closest('[data-wf-month]');
    if (m) {
      const step = Number(m.dataset.wfMonth);
      monthShift = step === 0 ? 0 : Math.max(-6, Math.min(24, monthShift + step));
      render(true);
    }
  });

  // ---------- Opening it: the top bar's time and weather, or W ----------
  const chip = document.getElementById('world');
  const onChip = (e) => {
    if (e.button !== 0) return;
    toggle();
  };
  chip?.classList.add('wf-link');
  chip?.addEventListener('click', onChip);

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.getElementById('modal-root')?.firstElementChild) return;
    if (e.key === 'Escape' && onTop()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (!e.repeat) toggle();
    }
  };
  window.addEventListener('keydown', onKey, true);

  const timer = setInterval(() => render(), 1000);
  const onResize = () => {
    if (!isOpen()) return;
    if (narrow()) place();
    else clamp(win.offsetLeft, win.offsetTop);
  };
  addEventListener('resize', onResize);

  window.stopWeatherForecast = () => {
    clearInterval(timer);
    observer.disconnect();
    window.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    root.removeEventListener('pointerdown', onRootDown);
    chip?.removeEventListener('click', onChip);
    chip?.classList.remove('wf-link');
    win.remove();
    style.remove();
    delete window.stopWeatherForecast;
  };

  console.log(`[forecast] Ready: click the time and weather in the top bar, or press W.${exact ? '' : ' (using the game’s own weather lookup)'}`);
})();
