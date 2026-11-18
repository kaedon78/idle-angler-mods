// Idle Angler — zone map strip.
// Paste into the DevTools console on https://idle-angler.onrender.com/ once you're signed in and the
// game is running. It adds a thin strip across the screen under the top bar, laid out like the game's
// world, left to right: the Town, the Farm and the Cabin, then every water from the Pond to the Cosmic
// Void, each cell showing a small copy of that place's scenery.
//  - where you are is highlighted, with a marker for your boat's position in the water you're on
//  - each water shows your species mastery there (★ steps reached out of 3 per species: catching a
//    species 10, 100 and 1,000 times), the Farm shows crops ready to harvest
//  - a ✦ on a water when a fish that only bites in the current weather or time of day is biting
//    there right now and you haven't caught it yet
//  - what a locked water needs: the boat's price (gold when you can afford it), Power or ascensions
// Hover a cell for details: every species in a water with its Power stars and its species mastery
// level (Lv 1-99, as in the Collection).
// Click a cell to go there: a water sails there (the game's own travel action, as Boat & Map's "Sail
// here"); the Town, Farm and Cabin walk you in with the game's own fade, from wherever you are
// (sailing back to the Pond first if needed). A locked water opens Boat & Map instead, so buying a
// boat stays the game's own button.
// Stop it (and remove the strip) with:  stopZoneMap()

(async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { act } = await mod('/src/actions.js');
  const { ZONES, BOATS, RARITIES, FISH, SEA, POWER } = await mod('/src/data.js');
  const { money, fmtDec, hex } = await mod('/src/format.js');
  const { worldAt, conditionName, serverNow } = await mod('/src/world.js');
  const { FishingScene } = await mod('/src/scene.js');
  const { Homestead } = await mod('/src/homestead.js');
  const { openWindow } = await mod('/src/ui.js');
  const { describeBounty, bountyProgress } = await mod('/src/bounties.js');
  // Species mastery levels (1-99). A newer module, so the strip still works without it (no "Lv" then)
  const { masteryLevel } = await mod('/src/mastery.js').catch(() => ({}));
  const { MASTERY } = await mod('/src/data.js');
  const MAX_LV = MASTERY?.maxLevel ?? 99;

  window.stopZoneMap?.(); // replace a strip already running

  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  if (!app || !topbar) return console.warn('[zone map] The game page was not found (#app / #topbar)');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tierColor = (t) => hex(RARITIES[t].color);
  const fishByZone = {};
  for (const f of FISH) (fishByZone[f.zone] ??= []).push(f);

  // ---------- The scene and the homestead ----------
  // main.js keeps both in local variables. Their classes are exported, though, so: the scene's
  // update() runs every frame, and wrapping it once (then putting it straight back) hands us the live
  // scene. The scene's onWalkIn() is main.js's `() => home.enter('cabin')`, so calling it while
  // Homestead.prototype.enter is briefly a no-op that records `this` hands us the live homestead,
  // without walking anywhere. From then on it's the game's own enter / arrive / leave.
  let scene = null;
  let home = null;
  const sceneProto = FishingScene.prototype;
  const sceneUpdate = sceneProto.update;
  sceneProto.update = function (dt) {
    scene = this;
    sceneProto.update = sceneUpdate;
    return sceneUpdate.call(this, dt);
  };
  const getHome = () => {
    if (home || !scene) return home;
    const enter = Homestead.prototype.enter;
    Homestead.prototype.enter = function () { home = this; };
    try { scene.onWalkIn(); } finally { Homestead.prototype.enter = enter; }
    return home;
  };
  const placeNow = () => scene?.place ?? 'dock'; // 'dock', 'cabin', 'garden' or 'village'

  // ---------- Tooltip ----------
  // A lookalike of the game's (which only renders its own data-tip keys): same frame and tip classes.
  const tip = document.createElement('div');
  tip.id = 'zonemap-tip';
  tip.hidden = true;
  tip.style.cssText =
    'position:fixed;z-index:1000;max-width:min(440px,calc(100vw - 16px));padding:8px 12px;pointer-events:none;' +
    'font-family:var(--font);font-size:14px;line-height:1.35;color:var(--text);border:9px solid;' +
    'border-image:var(--fr-tip);box-shadow:0 6px 18px rgba(0,0,0,.6)';
  document.body.append(tip);
  const tips = new Map();
  const placeTip = (e) => {
    const pad = 14;
    const { width, height } = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + width > innerWidth - 8) x = Math.max(8, e.clientX - width - pad);
    if (y + height > innerHeight - 8) y = Math.max(8, e.clientY - height - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  // ---------- Strip ----------
  const style = document.createElement('style');
  style.id = 'zonemap-style';
  style.textContent = `
#zonemap{position:absolute;z-index:6;left:6px;right:6px;
  display:flex;gap:2px;height:var(--zm-h,30px);font-family:var(--font);font-size:clamp(12px,calc(var(--zm-h,30px) * .34),16px);line-height:1;color:var(--text);
  pointer-events:none;user-select:none}
#zonemap .zm{position:relative;flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;
  padding:0 6px;overflow:hidden;white-space:nowrap;pointer-events:auto;cursor:pointer;isolation:isolate;
  --bg:none;background:var(--bg) center 72%/cover no-repeat,linear-gradient(var(--sky),var(--water));
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.55);
  text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000}
#zonemap .zm.land{flex-grow:.8}
#zonemap .zm.shore{margin-right:6px}#zonemap .zm::before{content:'';position:absolute;inset:0;background:rgba(8,13,8,.3);z-index:-1}
#zonemap .zm:hover::before{background:rgba(8,13,8,.08)}
#zonemap .zm.here{box-shadow:inset 0 0 0 2px #fde68a}
#zonemap .zm.here::before{background:rgba(8,13,8,.08)}
#zonemap .zm.here .nm{color:#fde68a}
#zonemap .zm.locked{filter:grayscale(.7) brightness(.75)}
#zonemap .zm.hidden{filter:grayscale(1) brightness(.5);cursor:default}
#zonemap .zm .nm{font-weight:700;overflow:hidden;text-overflow:ellipsis}
#zonemap .zm .dot{flex:none;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 1px #000}
#zonemap .zm .pill{flex:none;padding:2px 5px;font-weight:700;background:rgba(0,0,0,.65);box-shadow:0 0 0 1px rgba(0,0,0,.4)}
#zonemap .zm .boat{position:absolute;bottom:1px;width:0;height:0;margin-left:-4px;border:4px solid transparent;
  border-bottom:5px solid #fde68a;border-top:0;transition:left 1s linear;filter:drop-shadow(0 0 1px #000)}
#scene-hud > .hud-where{margin-top:calc(var(--topbar-h) * var(--ui-scale) + var(--zm-h,30px) + 4px)}
#conn-status:not(.replaced, .kicked){top:calc(var(--topbar-h) * var(--ui-scale) + var(--zm-h,30px) + 14px)}
#zonemap-tip .zm-fish{display:grid;grid-template-columns:auto auto 1fr;column-gap:10px;align-items:baseline}
#zonemap-tip .zm-stars{color:#fde047;letter-spacing:1px}
@media (max-width:1000px){#zonemap .zm .sub{display:none}}
@media (max-width:640px){#zonemap .zm .nm{display:none}#zonemap .zm::after{content:attr(data-n);font-weight:700}}`;
  document.head.append(style);

  const strip = document.createElement('div');
  strip.id = 'zonemap';
  app.append(strip);
  // Just under the top bar and as tall as it, wherever the game's layout and UI scale put it. The
  // height goes in --zm-h on the page, which also pushes the game's place label and connection notice
  // down below the strip.
  const root = document.documentElement;
  const place = () => {
    const a = app.getBoundingClientRect(), t = topbar.getBoundingClientRect();
    strip.style.top = `${t.bottom - a.top + 2}px`;
    const h = `${Math.round(t.height) || 30}px`;
    if (root.style.getPropertyValue('--zm-h') !== h) root.style.setProperty('--zm-h', h);
  };

  // Land first (the Town is furthest left, as in the game), then the waters
  const LAND = [
    { place: 'village', name: 'Town', short: 'T', sky: '#9a7b55', water: '#4f3b26' },
    { place: 'garden', name: 'Farm', short: 'F', sky: '#7fb35a', water: '#3e5a26' },
    { place: 'cabin', name: 'Cabin', short: 'C', sky: '#b58654', water: '#5c3b20' },
  ];
  const LAND_ORDER = LAND.map((l) => l.place);
  const makeCell = (n, sky, water, onClick) => {
    const el = document.createElement('div');
    el.className = 'zm';
    el.dataset.n = n;
    el.style.setProperty('--sky', sky);
    el.style.setProperty('--water', water);
    el.addEventListener('pointerenter', (e) => { tip.innerHTML = tips.get(el) ?? ''; tip.hidden = !tip.innerHTML; placeTip(e); });
    el.addEventListener('pointermove', placeTip);
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.addEventListener('click', onClick);
    strip.append(el);
    return el;
  };
  const landCells = LAND.map((l) => makeCell(l.short, l.sky, l.water, () => goLand(l.place)));
  for (const el of landCells) el.classList.add('land');
  landCells.at(-1).classList.add('shore');
  const cells = ZONES.map((zone) => makeCell(zone.index + 1, hex(zone.sky), hex(zone.water), () => goZone(zone)));

  // ---------- Pictures ----------
  // Each cell's background is a small copy of that place's scenery, painted from the game's own
  // pictures the way the scene lays them out (backdrops.js: the painted layers, their waterline rows,
  // tints and haze; seascape.js: the drawn scenery of the Abyss and the Void). It's painted once for
  // an imaginary 1920 x 900 window, keeping the band around the horizon: the sky in the zone's own
  // colours (not the time of day or the weather), the water below it.
  const { BACKDROPS } = await mod('/src/backdrops.js').catch(() => ({}));
  const { drawBackdrop } = await mod('/src/seascape.js').catch(() => ({}));
  const PX = 2; // one picture pixel is two screen pixels in the game
  const VW = 1920, VH = 900, WATER = 504; // the game puts the waterline 56% of the way down
  const TOP = 120, BOTTOM = 600, OUT = 0.25; // the band kept, and how far it's scaled down
  const rgb = (c, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
  const mix = (a, b, f) => [16, 8, 0].reduce((o, s) => o | (Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f) << s), 0);
  const images = new Map();
  const img = (src) => {
    if (!images.has(src)) {
      images.set(src, new Promise((ok) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => ok(null);
        i.src = src;
      }));
    }
    return images.get(src);
  };
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  // A picture recoloured: its shape in one colour (haze) or multiplied by a colour (tint)
  const recolor = (pic, color, mode) => {
    const c = canvas(pic.width, pic.height), g = c.getContext('2d');
    g.drawImage(pic, 0, 0);
    g.globalCompositeOperation = mode;
    g.fillStyle = rgb(color);
    g.fillRect(0, 0, c.width, c.height);
    if (mode === 'multiply') { g.globalCompositeOperation = 'destination-in'; g.drawImage(pic, 0, 0); }
    return c;
  };
  const crop = (pic, x, y, w, h) => { const c = canvas(w, h); c.getContext('2d').drawImage(pic, x, y, w, h, 0, 0, w, h); return c; };
  // A picture repeated across the window (as the game's TilingSprites), top edge at y, kept between top and bottom
  const band = (g, pic, y, { alpha = 1, top = -Infinity, bottom = Infinity, repeat = 'repeat-x', rows = pic.height } = {}) => {
    const y0 = Math.max(y, top, TOP), y1 = Math.min(y + rows * PX, bottom, BOTTOM);
    if (y1 <= y0) return;
    const p = g.createPattern(pic, repeat);
    p.setTransform(new DOMMatrix([PX, 0, 0, PX, 0, y]));
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = p;
    g.fillRect(0, y0, VW, y1 - y0);
    g.restore();
  };
  const skyFill = (g, color, to) => {
    const s = g.createLinearGradient(0, 0, 0, to);
    s.addColorStop(0, rgb(mix(0, color, 0.75)));
    s.addColorStop(1, rgb(color));
    g.fillStyle = s;
    g.fillRect(0, 0, VW, to + 1);
  };
  // Enough of Pixi's Graphics for seascape.js's drawBackdrop: a shape, then fill() or stroke()
  const pen = (g) => {
    let path = new Path2D();
    const shape = (f) => { path = new Path2D(); f(path); return o; };
    const style = (s) => (typeof s === 'object' ? s : { color: s });
    const o = {
      clear: () => o,
      rect: (x, y, w, h) => shape((p) => p.rect(x, y, w, h)),
      circle: (x, y, r) => shape((p) => p.arc(x, y, r, 0, Math.PI * 2)),
      ellipse: (x, y, rx, ry) => shape((p) => p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)),
      fill: (s) => { const { color = 0, alpha = 1 } = style(s); g.fillStyle = rgb(color, alpha); g.fill(path); return o; },
      stroke: (s) => { const { width = 1, color = 0, alpha = 1 } = style(s); g.lineWidth = width; g.strokeStyle = rgb(color, alpha); g.stroke(path); return o; },
    };
    return o;
  };
  const paintZone = async (g, zone) => {
    const cfg = BACKDROPS?.[zone.id] ?? {};
    skyFill(g, zone.sky, WATER);
    if (drawBackdrop && (!cfg.above?.length || cfg.drawn)) drawBackdrop(pen(g), zone.id, { W: VW, H: VH, VW, cut: 0, waterY: WATER });
    for (const layer of cfg.above ?? []) {
      const pic = await img(layer.src);
      if (!pic) continue;
      let y = layer.sky ? 0 : WATER - (layer.base + 1) * PX;
      if (layer.cover) y = Math.min(y, 0);
      band(g, pic, y, { alpha: layer.alpha ?? 1, bottom: WATER + PX });
      if (layer.haze) band(g, recolor(pic, zone.sky, 'source-in'), y, { alpha: layer.haze, bottom: WATER + PX });
    }
    const water = g.createLinearGradient(0, WATER, 0, BOTTOM);
    water.addColorStop(0, rgb(mix(zone.water, 0xffffff, 0.2)));
    water.addColorStop(1, rgb(mix(0, zone.water, 0.7)));
    g.fillStyle = water;
    g.fillRect(0, WATER, VW, VH - WATER);
    g.fillStyle = rgb(0xffffff, 0.3);
    g.fillRect(0, WATER, VW, 2 * PX); // the surface
    for (const layer of cfg.below ?? []) {
      let pic = await img(layer.src);
      if (!pic) continue;
      if (layer.tint != null) pic = recolor(pic, layer.tint, 'multiply');
      const y = VH - (layer.base + 1) * PX;
      band(g, pic, y, { alpha: layer.alpha ?? 1, top: WATER + 2 * PX });
      if (layer.poke) band(g, pic, y, { bottom: WATER }); // what breaks the surface, solid
    }
  };
  // The homestead: the Town's forest and buildings (village.js), the Farm's view of the Pond's hills
  // (homestead.js), the Cabin's plank wall, beams and furniture (its "Quiet Cabin" sheets)
  const DAY_SKY = 0x8fc6ee;
  const GROUND = 540;
  const sprite = (g, pic, x, bottom, [sx, sy, sw, sh] = [0, 0, pic.width, pic.height]) =>
    g.drawImage(pic, sx, sy, sw, sh, x, bottom - sh * PX, sw * PX, sh * PX);
  const paintLand = {
    async village(g) {
      skyFill(g, DAY_SKY, GROUND);
      for (const n of [4, 3, 2, 1]) {
        const pic = await img(`/assets/village/forest-${n}.png`);
        if (pic) band(g, pic, GROUND - 240 * PX, { bottom: GROUND });
      }
      g.fillStyle = rgb(0x2f3a24);
      g.fillRect(0, GROUND - 2 * PX, VW, 2 * PX); // the forest floor's edge
      g.fillStyle = rgb(0x6f675d);
      g.fillRect(0, GROUND, VW, VH - GROUND); // the street
      g.fillStyle = rgb(0x5a534b);
      for (let x = 0; x < VW; x += 12 * PX) g.fillRect(x, GROUND + 6 * PX, PX, 4 * PX);
      for (const [name, x] of [['smithy', 240], ['harbour', 760], ['shack', 1320]]) {
        const pic = await img(`/assets/village/${name}.png`);
        if (pic) sprite(g, pic, x, GROUND + 4 * PX);
      }
    },
    async garden(g) {
      skyFill(g, DAY_SKY, GROUND);
      for (const layer of BACKDROPS?.pond?.above ?? []) {
        const pic = await img(layer.src);
        if (pic) band(g, pic, GROUND - (layer.base + 1) * PX, { bottom: GROUND });
      }
      g.fillStyle = rgb(0x5f9a4a);
      g.fillRect(0, GROUND, VW, VH - GROUND);
      for (let x = 300; x < VW - 200; x += 180) { // the plots
        g.fillStyle = rgb(0x5a3a22);
        g.fillRect(x, GROUND + 10 * PX, 140, 14 * PX);
        g.fillStyle = rgb(0x86c35a);
        for (let i = 0; i < 4; i++) g.fillRect(x + 14 + i * 32, GROUND + 6 * PX, 4 * PX, 6 * PX);
      }
    },
    async cabin(g) {
      const ceiling = GROUND - 140 * PX;
      g.fillStyle = rgb(0x22130f);
      g.fillRect(0, 0, VW, ceiling); // the roof space, with its rafters
      g.fillStyle = rgb(0x3a2219);
      for (let x = 115; x < VW; x += 345) g.fillRect(x, 0, 8 * PX, ceiling);
      g.fillStyle = rgb(0x2e1a17);
      g.fillRect(0, ceiling, VW, GROUND - ceiling);
      for (let y = GROUND, i = 0; y < VH; y += 6 * PX, i++) { g.fillStyle = rgb(i % 2 ? 0x5a3328 : 0x63392d); g.fillRect(0, y, VW, 6 * PX); }
      const [wall, wood, objects] = await Promise.all(['wall', 'wood', 'objects'].map((n) => img(`/assets/cabin/qc-${n}.png`)));
      if (wall) band(g, crop(wall, 16, 16, 96, 96), ceiling, { repeat: 'repeat', rows: (GROUND - ceiling) / PX });
      if (wood) {
        const beam = crop(wood, 16, 80, 48, 16);
        band(g, beam, ceiling);
        band(g, beam, GROUND - 2 * PX);
      }
      if (objects) {
        g.fillStyle = rgb(DAY_SKY, 0.6);
        g.fillRect(860 + 3 * PX, 300 + 4 * PX, 58 * PX, 22 * PX); // the view through the window
        sprite(g, objects, 860, 300 + 28 * PX, [16, 66, 64, 28]);
        sprite(g, objects, 1240, GROUND + 2 * PX, [16, 129, 80, 31]); // the bed
        sprite(g, objects, 520, GROUND + 2 * PX, [81, 68, 30, 28]); // a dresser
      }
    },
  };
  let stopped = false;
  const urls = [];
  const paint = async (el, fn) => {
    try {
      const c = canvas(Math.round(VW * OUT), Math.round((BOTTOM - TOP) * OUT));
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.scale(OUT, OUT);
      g.translate(0, -TOP);
      await fn(g);
      const blob = await new Promise((ok) => c.toBlob(ok));
      if (!blob || stopped) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      el.style.setProperty('--bg', `url(${url})`);
    } catch (e) {
      console.warn("[zone map] Couldn't paint a picture:", e); // the cell keeps its plain colours
    }
  };
  LAND.forEach((l, i) => paint(landCells[i], paintLand[l.place]));
  ZONES.forEach((zone, i) => paint(cells[i], (g) => paintZone(g, zone)));

  // ---------- Mastery ----------
  // POWER.mastery: catching a species 10, 100 and 1,000 times each adds Power (data.js).
  const STEPS = POWER.mastery.map((m) => m.at);
  const masteryOf = (n) => STEPS.filter((at) => n >= at).length;
  const stars = (lvl) => `<span class="zm-stars">${'★'.repeat(lvl)}<span style="opacity:.35">${'★'.repeat(STEPS.length - lvl)}</span></span>`;

  // ---------- Rendering ----------
  const setHtml = (el, html) => {
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  };
  // The boat's place along the current water, kept 6px in from the cell's ends so it never gets clipped
  const boatLeft = () => {
    const f = Math.min(1, Math.max(0, S.boatX() / SEA.length));
    return `calc(6px + (100% - 12px) * ${f.toFixed(3)})`;
  };
  const clock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
  };

  const renderLand = (where) => {
    const tipEnd = (l) => `<div class="tip-sep"></div><div class="muted">${where === l.place ? "You're here." : `Click to go to the ${l.name}.`}</div>`;
    LAND.forEach((l, i) => {
      const el = landCells[i];
      el.classList.toggle('here', where === l.place);
      let sub = '';
      let body = '';
      if (l.place === 'cabin') {
        body = '<div>Your home by the Pond. Fishing carries on, idle, while you\'re here.</div>';
      } else if (l.place === 'garden') {
        const plots = S.state.farm?.plots ?? [];
        const now = serverNow();
        const growing = plots.filter((p) => p.crop && p.readyAt > now);
        const ready = plots.filter((p) => p.crop && p.readyAt <= now).length;
        const empty = plots.length - growing.length - ready;
        if (ready) sub = `<span class="sub pill" style="color:#86efac">${ready} ready</span>`;
        const next = growing.length ? Math.min(...growing.map((p) => p.readyAt)) - now : null;
        body =
          `<div>${plots.length} plots: <b style="color:#86efac">${ready} ready</b> · ${growing.length} growing · ${empty} empty</div>` +
          (next !== null ? `<div class="muted">Next crop ready in ${clock(next)}</div>` : '');
      } else {
        body =
          '<div>Harbourmaster <span class="muted">· Boat &amp; Map</span></div><div>Blacksmith <span class="muted">· reforging</span></div>' +
          '<div>Fishmonger <span class="muted">· Market</span></div><div>Notice board <span class="muted">· Bounties</span></div>';
      }
      setHtml(el, `<span class="nm">${l.name}</span>${sub}`);
      tips.set(el, `<div class="tip-title">${l.name === 'Town' ? 'The Village' : l.name === 'Farm' ? 'The Garden' : 'The Cabin'}</div>${body}${tipEnd(l)}`);
    });
  };

  // Your bounties tied to one water (rarity, zone and species jobs carry a zone; the rest can be done anywhere)
  const bountiesByZone = () => {
    const out = {};
    for (const b of S.state.bounties?.slots ?? []) if (b?.zone) (out[b.zone] ??= []).push(b);
    return out;
  };

  const render = () => {
    place();
    const st = S.state;
    const w = worldAt();
    const power = S.power();
    const where = placeNow();
    const quests = bountiesByZone();
    renderLand(where);
    ZONES.forEach((zone, i) => {
      const el = cells[i];
      const status = S.zoneStatus(zone);
      const here = where === 'dock' && st.zone === zone.id;
      const hidden = status === 'hidden';
      el.classList.toggle('here', here);
      el.classList.toggle('hidden', hidden);
      el.classList.toggle('locked', !hidden && status !== 'unlocked');
      if (hidden) {
        setHtml(el, '<span class="nm">???</span>');
        tips.set(el, `<div class="tip-title">???</div><div class="muted">Buy the boat for the water before it first.</div>`);
        return;
      }

      const fish = fishByZone[zone.id] ?? [];
      const count = (f) => st.collection.fish[f.id] || 0;
      const levels = fish.reduce((a, f) => a + masteryOf(count(f)), 0);
      const maxLevels = fish.length * STEPS.length;
      const isNow = (f) => f.when === w.weather.id || f.when === w.phase.id;
      const newNow = fish.filter((f) => f.when && isNow(f) && !count(f));

      let need = '';
      if (status === 'buyable') need = `<span style="color:${st.gold >= zone.unlockCost ? '#fde047' : '#fca5a5'}">${esc(money(zone.unlockCost))}</span>`;
      else if (status === 'needsPower') need = `<span style="color:#fca5a5">Power ${fmtDec(zone.powerReq)}</span>`;
      else if (status === 'needsAscension') need = `<span style="color:#fca5a5">Asc ${zone.ascensionReq}</span>`;

      const star = newNow.length ? `<span style="color:${tierColor(Math.max(...newNow.map((f) => f.tier)))}">✦</span>` : '';
      const sub = need ? `<span class="pill">${need}</span>` : `<span class="sub pill"><span style="color:#fde047">★</span>${levels}/${maxLevels}</span>`;
      const zq = quests[zone.id] ?? []; // listed in the tooltip (no marker on the cell for now)
      // The dot is the rarest fish the water holds, in that rarity's colour. Rebuilt only when the text
      // changes, so the boat marker's transition isn't restarted every second.
      setHtml(el, `<span class="dot" style="background:${tierColor(zone.maxTier)}"></span><span class="nm">${esc(zone.name)}</span>${star}${sub}`);
      const b = el.querySelector('.boat');
      if (here && zone.index > 0) {
        if (b) b.style.left = boatLeft();
        else el.insertAdjacentHTML('beforeend', `<span class="boat" style="left:${boatLeft()}"></span>`);
      } else b?.remove();

      // Tooltip: every species with its mastery
      const vessel = BOATS[zone.index];
      const rows = [];
      rows.push(`<div>${vessel ? `<b>${esc(vessel.name)}</b> <span class="muted">· ${esc(vessel.desc)}</span>` : '<b>Cabin</b> <span class="muted">· your own walkway</span>'}</div>`);
      rows.push(`<div>Up to <b style="color:${tierColor(zone.maxTier)}">${RARITIES[zone.maxTier].name}</b> fish · mastery <b>${levels}</b> of ${maxLevels} ★</div>`);
      if (status === 'buyable') rows.push(`<div>Boat: <b>${esc(money(zone.unlockCost))}</b>${st.gold >= zone.unlockCost ? '' : ' <span class="muted">(not enough gold yet)</span>'}</div>`);
      if (status === 'needsPower') rows.push(`<div style="color:#fca5a5">Needs ${fmtDec(zone.powerReq)} Power <span class="muted">(you have ${fmtDec(power)})</span></div>`);
      if (status === 'needsAscension') rows.push(`<div style="color:#fca5a5">Needs ${zone.ascensionReq} ascension${zone.ascensionReq > 1 ? 's' : ''}</div>`);
      if (zq.length) {
        rows.push('<div class="tip-sep"></div><div class="tip-head">Bounties here</div>');
        for (const b of zq) {
          const have = bountyProgress(b, st.lifetimeGold);
          rows.push(
            `<div><span class="zm-stars">${'★'.repeat(b.stars ?? 0)}</span> ${esc(describeBounty(b, fmtDec))} · ` +
            (have >= b.need ? '<b style="color:#86efac">done, claim it</b>' : `<span class="muted">${fmtDec(have)} / ${fmtDec(b.need)}</span>`) +
            '</div>',
          );
        }
      }
      rows.push('<div class="tip-sep"></div><div class="zm-fish">');
      // Each species: its Power stars, then its species mastery level (1-99, the Collection's "Lv")
      for (const f of fish) {
        const n = count(f);
        const when = f.when ? ` <span class="muted">· ${esc(conditionName(f.when))}</span>${isNow(f) ? ' · <b>biting now</b>' : ''}` : '';
        const lv = masteryLevel?.(f, n) ?? 0;
        const level = !n ? '<b>not caught yet</b>' : lv ? `<span${lv >= MAX_LV ? ' style="color:#fde047"' : ''}>Lv ${lv}</span>` : '';
        rows.push(`<span style="color:${tierColor(f.tier)}">${esc(f.name)}${when}</span>${stars(masteryOf(n))}${level}`);
      }
      rows.push('</div>');
      const hint = here ? 'You are fishing here.' : status === 'unlocked' ? 'Click to sail here.' : 'Click to open Boat & Map.';
      rows.push(`<div class="tip-sep"></div><div class="muted">${hint}</div>`);
      tips.set(el, `<div class="tip-title" style="color:${tierColor(zone.maxTier)}">${zone.index + 1}. ${esc(zone.name)}</div>${rows.join('')}`);
    });
    for (const el of [...landCells, ...cells]) if (!tip.hidden && el.matches(':hover')) tip.innerHTML = tips.get(el);
  };

  // ---------- Going places ----------
  const travel = async (id) => {
    const ok = await act(S.game, 'travel', { id });
    if (!ok) console.warn(`[zone map] Couldn't sail to ${id}`);
    render();
    return ok;
  };

  const goZone = async (zone) => {
    const status = S.zoneStatus(zone);
    if (status === 'hidden') return;
    if (status !== 'unlocked') return openWindow('zones'); // Boat & Map: buying stays the game's button
    const h = placeNow() !== 'dock' ? getHome() : null;
    if (h?.place) {
      // Out of the homestead first (the game's fade), then sail on if it's not the Pond
      if (h.busy) return;
      h.fadeTo(() => {
        h.leave();
        if (S.state.zone !== zone.id) travel(zone.id);
        render();
      });
      return;
    }
    if (S.state.zone !== zone.id) await travel(zone.id);
  };

  const goLand = async (target) => {
    const h = getHome();
    if (!h) return console.warn("[zone map] The game's scene hasn't drawn a frame yet; try again in a moment");
    if (h.busy || h.place === target) return;
    if (h.place) {
      // Between two homestead places: fade straight there, coming in through the door on the side
      // you came from (the Town is left of the Farm, which is left of the Cabin)
      const from = LAND_ORDER.indexOf(target) < LAND_ORDER.indexOf(h.place) ? 1 : -1;
      h.fadeTo(() => { h.arrive(target, from); render(); });
      return;
    }
    // From the water: the homestead is reached from the Pond, so sail back there first
    if (S.state.zone !== 'pond' && !(await travel('pond'))) return;
    h.enter(target);
  };

  render();
  const timer = setInterval(render, 1000);
  // A resize can move a cell out from under the pointer without a pointerleave, so drop the tooltip
  const onResize = () => { tip.hidden = true; place(); };
  addEventListener('resize', onResize);

  window.stopZoneMap = () => {
    clearInterval(timer);
    stopped = true;
    for (const url of urls) URL.revokeObjectURL(url);
    if (sceneProto.update !== sceneUpdate) sceneProto.update = sceneUpdate; // no frame drawn yet
    removeEventListener('resize', onResize);
    strip.remove();
    tip.remove();
    style.remove();
    root.style.removeProperty('--zm-h');
    delete window.stopZoneMap;
  };
})();
