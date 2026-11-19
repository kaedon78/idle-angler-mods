// ==UserScript==
// @name         Idle Angler Mods
// @namespace    http://tampermonkey.net/
// @version      2026-11-19
// @description  try to take over the world!
// @author       You
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Idle Angler — UI mods, all in one script.
// Paste into the DevTools console on https://idle-angler.onrender.com/ once you're signed in and the game
// is running. It starts every mod you've left on, and adds a Mods tab to the game's Settings window
// (Esc) where each one can be turned on or off. That takes effect at once and is remembered in this
// browser for the next time the script runs. The mods:
//  - Top bar layout fixes (always on): the game's own top bar stays put (test report #28 and #29)
//  - Zone map strip: every place in the world under the top bar; click one to go there
//  - Income pills and auto-click: measured gold, fish, chests and XP a second; Auto-click 1-15/s
//  - Build switcher: put on a saved gear set from the bottom bar, or press 1-5
//  - Weather forecast: click the time and weather in the top bar, or press W
//  - Quicklinks: a tab on the right edge with what most needs you right now
// Pasting it again replaces the one running. Stop everything (and remove the Mods tab) with:
//   stopIdleAnglerMods()
// Each mod below is the script it used to be, unchanged; the manager at the bottom runs them.

(async () => {
window.stopIdleAnglerMods?.(); // replace the mods already running

// =====================================================================================================
// Top bar layout fixes
//
// Two bugs in the game's own stylesheet, patched until the game fixes them (test report #28, #29):
//  - #topbar .store-btn has margin-left: auto, which pushes the Supporter store button and the avatar
//    to the far right of the bar: it's set back to 0
//  - the currency buttons are as wide as their text, so whenever the gold or its rate changes length
//    ("9g 87s" to "10g", "9,999g 99s" to "10.00Kg") the rest of the bar shifts. Each one keeps the
//    widest it has been as its min-width, so it can grow but never shrinks back and moves nothing. A new
//    text size starts them over.
// Always on (not listed in Settings > Mods). Stop it from the console with:  stopTopbarFixes()
// =====================================================================================================
const topbarFixes = async () => {
  window.stopTopbarFixes?.(); // replace one already running

  const topbar = document.getElementById('topbar');
  const currencies = topbar?.querySelector('.currencies');
  if (!currencies) return console.warn('[top bar fixes] The game page was not found (#topbar .currencies)');

  const style = document.createElement('style');
  style.id = 'tbf-style';
  style.textContent = `
#topbar .store-btn{margin-left:0}
#topbar .currency{box-sizing:border-box;justify-content:flex-start}`;
  document.head.append(style);

  // The top bar has zoom: var(--ui-scale) (the text size setting). getBoundingClientRect is in screen
  // pixels after that zoom and min-width in CSS pixels before it, so the width is divided by the zoom.
  let zoomWas = null;
  const widest = new Map(); // currency button -> its widest width so far (CSS px)
  const hold = () => {
    const zoom = currencies.currentCSSZoom ?? 1;
    if (zoom !== zoomWas) {
      zoomWas = zoom;
      widest.clear();
      for (const el of currencies.querySelectorAll('.currency')) el.style.minWidth = '';
    }
    for (const el of currencies.querySelectorAll('.currency')) {
      if (el.hidden) continue;
      const w = Math.ceil(el.getBoundingClientRect().width / zoom);
      if (w > (widest.get(el) ?? 0)) {
        widest.set(el, w);
        el.style.minWidth = `${w}px`;
      }
    }
  };
  // A mutation callback runs after the game changes the text and before the frame is drawn, so a button
  // that grew is held at its new width before anything on its right can be seen moving back
  const observer = new MutationObserver(hold);
  observer.observe(currencies, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  const onResize = () => { zoomWas = null; hold(); };
  addEventListener('resize', onResize);
  hold();

  window.stopTopbarFixes = () => {
    observer.disconnect();
    removeEventListener('resize', onResize);
    for (const el of currencies.querySelectorAll('.currency')) el.style.minWidth = '';
    style.remove();
    delete window.stopTopbarFixes;
  };
};

// =====================================================================================================
// Zone map strip (was zone-map.js)
//
// It adds a 60px strip across the screen under the top bar, in its colours, laid out like the game's world, left to
// right: the Basement and the Cabin, then every water from the Pond to the Cosmic Void, each cell
// showing a small copy of that place's scenery. (The Town and the Farm are left out while the game
// has them shelved.)
//  - where you are is highlighted, with a marker for your boat's position in the water you're on
//  - each water shows your species mastery there (★ steps reached out of 3 per species: catching a
//    species 10, 100 and 1,000 times); the Basement shows your Emberscale Shards, or, while its door
//    is still shut, how many ascensions it needs
//  - a ✦ on a water when a fish that only bites in the current weather or time of day is biting
//    there right now and you haven't caught it yet
//  - what a locked water needs: the boat's price (gold when you can afford it), Power or ascensions
// Hover a cell for details: every species in a water with its Power stars and its species mastery
// level (Lv 1-99, as in the Collection).
// Click a cell to go there: a water sails there (the game's own travel action, as Boat & Map's "Sail
// here"); the Basement and the Cabin walk you in with the game's own fade, from wherever you are
// (sailing back to the Pond first if needed). A water whose boat you can afford buys the boat and sails
// there (the game's own unlockZone, as its line map does); any other locked water opens Boat & Map,
// which says what it needs. A shut Basement does nothing until you have the ascensions;
// then it walks you into the Cabin, which is what opens its door.
// Stop it (and remove the strip) with:  stopZoneMap(), or untick it in Settings > Mods
// =====================================================================================================
const zoneMap = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { act } = await mod('/src/actions.js');
  const { ZONES, BOATS, RARITIES, FISH, SEA, POWER } = await mod('/src/data.js');
  const { money, fmtDec, hex } = await mod('/src/format.js');
  const { worldAt, conditionName } = await mod('/src/world.js');
  const { FishingScene } = await mod('/src/scene.js');
  const { Homestead } = await mod('/src/homestead.js');
  const { openWindow, toast } = await mod('/src/ui.js');
  const { describeBounty, bountyProgress } = await mod('/src/bounties.js');
  // Species mastery levels (1-99). A newer module, so the strip still works without it (no "Lv" then)
  const { masteryLevel } = await mod('/src/mastery.js').catch(() => ({}));
  const { MASTERY, DRACONIC } = await mod('/src/data.js');
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
  const placeNow = () => scene?.place ?? 'dock'; // 'dock', 'cabin' or 'basement' ('garden', 'village': shelved)

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
#zonemap{position:absolute;z-index:6;left:0;right:0;box-sizing:border-box;padding:4px 6px;
  display:flex;gap:2px;height:var(--zm-h,60px);font-family:var(--font);font-size:16px;line-height:1;color:var(--text);
  background:linear-gradient(rgba(14,10,10,.9),rgba(14,10,10,.72)); /* the top bar's own (#topbar::before) */
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
#scene-hud > .hud-where{margin-top:calc(var(--topbar-h) * var(--ui-scale) + var(--zm-h,60px) + 4px)}
#conn-status:not(.replaced, .kicked){top:calc(var(--topbar-h) * var(--ui-scale) + var(--zm-h,60px) + 14px)}
#zonemap-tip .zm-fish{display:grid;grid-template-columns:auto auto 1fr;column-gap:10px;align-items:baseline}
#zonemap-tip .zm-stars{color:#fde047;letter-spacing:1px}
@media (max-width:1000px){#zonemap .zm .sub{display:none}}
@media (max-width:640px){#zonemap .zm .nm{display:none}#zonemap .zm::after{content:attr(data-n);font-weight:700}}`;
  document.head.append(style);

  const strip = document.createElement('div');
  strip.id = 'zonemap';
  app.append(strip);
  // Right under the top bar, wherever the game's layout and UI scale put it, in the top bar's colours so
  // the two read as one band. HEIGHT goes in --zm-h on the page, which also pushes the game's place label
  // and connection notice down below the strip.
  const HEIGHT = 60;
  const root = document.documentElement;
  const place = () => {
    const a = app.getBoundingClientRect(), t = topbar.getBoundingClientRect();
    strip.style.top = `${t.bottom - a.top}px`;
    const h = `${HEIGHT}px`;
    if (root.style.getPropertyValue('--zm-h') !== h) root.style.setProperty('--zm-h', h);
  };

  // Land first, then the waters. The Basement is left of the Cabin, behind its left door, as in the game.
  // The Town and the Farm aren't listed: the game has shelved them (data.js SHELVED), so no door leads there.
  const LAND = [
    { place: 'basement', name: 'Basement', short: 'B', sky: '#3a1f2a', water: '#1a0f0c' },
    { place: 'cabin', name: 'Cabin', short: 'C', sky: '#b58654', water: '#5c3b20' },
  ];
  const DRACONIC_AT = DRACONIC?.requirement ?? 50; // ascensions that open the basement door
  const basementOpen = () => Boolean(S.state.draconic?.basement);
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
  // The homestead: the Basement's cellar round the Altar's crystal (homestead.js drawBasement), the Cabin's
  // plank wall, beams and furniture (its "Quiet Cabin" sheets)
  const DAY_SKY = 0x8fc6ee;
  const GROUND = 540;
  const sprite = (g, pic, x, bottom, [sx, sy, sw, sh] = [0, 0, pic.width, pic.height]) =>
    g.drawImage(pic, sx, sy, sw, sh, x, bottom - sh * PX, sw * PX, sh * PX);
  const paintLand = {
    async basement(g) {
      const ceiling = GROUND - 150 * PX;
      const footing = GROUND - 22 * PX;
      // Overhead, the cabin's floorboards seen from below; damp planks, a fieldstone footing, a dirt floor
      for (let y = 0, i = 0; y < ceiling; y += 4 * PX, i++) { g.fillStyle = rgb(i % 2 ? 0x241510 : 0x2b1a12); g.fillRect(0, y, VW, 4 * PX); }
      const wall = await img('/assets/cabin/qc-wall.png');
      if (wall) band(g, recolor(crop(wall, 16, 16, 96, 96), 0x9a8078, 'multiply'), ceiling, { repeat: 'repeat', rows: (footing - ceiling) / PX });
      else { g.fillStyle = rgb(0x2a1c18); g.fillRect(0, ceiling, VW, footing - ceiling); }
      g.fillStyle = rgb(0x1c1916);
      g.fillRect(0, footing, VW, GROUND - footing);
      for (let row = 0; row < 3; row++) {
        for (let x = -row * 9 * PX, i = 0; x < VW; i++) {
          const w = (8 + ((row * 7 + i * 5) % 10)) * PX;
          g.fillStyle = rgb([0x4a443e, 0x554d45, 0x3e3934, 0x504840][(row + i) % 4]);
          g.fillRect(x + PX, footing + row * 7 * PX + PX, w - PX, 6 * PX);
          x += w;
        }
      }
      g.fillStyle = rgb(0x2a1f17);
      g.fillRect(0, GROUND, VW, VH - GROUND);
      // The Altar's crystal in the middle, the only light: everything else fades into the dark
      const cx = VW / 2, cy = GROUND - 30 * PX;
      const crystal = await img('/assets/cabin/crystal-dark.png');
      if (crystal) sprite(g, crystal, cx - 16 * PX, GROUND, [0, 0, 32, 32]); // the first frame of its glint
      // (Lighter than the game's darkness, so the room still reads at the strip's size)
      const dark = g.createRadialGradient(cx, cy, 60 * PX, cx, cy, 520 * PX);
      dark.addColorStop(0, 'rgba(8,4,10,0)');
      dark.addColorStop(1, 'rgba(8,4,10,.45)');
      g.fillStyle = dark;
      g.fillRect(0, 0, VW, VH);
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 120 * PX);
      glow.addColorStop(0, 'rgba(217,70,239,.55)');
      glow.addColorStop(1, 'rgba(124,58,237,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, VW, VH);
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

  const renderLand = (where) => {
    const tipEnd = (l) => `<div class="tip-sep"></div><div class="muted">${where === l.place ? "You're here." : `Click to go to the ${l.name}.`}</div>`;
    LAND.forEach((l, i) => {
      const el = landCells[i];
      el.classList.toggle('here', where === l.place);
      let sub = '';
      let body = '';
      let end = tipEnd(l);
      if (l.place === 'cabin') {
        body = '<div>Your home by the Pond. Fishing carries on, idle, while you\'re here.</div>';
      } else {
        // The basement: shut until the door opens for good, the first time you walk into the cabin with
        // DRACONIC_AT ascensions (main.js basementRumble)
        const asc = S.state.ascension.count;
        const open = basementOpen();
        el.classList.toggle('locked', !open);
        const shards = S.state.draconic?.shards ?? 0;
        if (open) {
          if (shards) sub = `<span class="sub pill"><span style="color:#f0abfc">◆</span>${fmtDec(shards)}</span>`;
          body =
            "<div>The Draconic Altar <span class=\"muted\">· Draconic ascension and Emberscale Shard upgrades</span></div>" +
            `<div>${fmtDec(shards)} Emberscale Shard${shards === 1 ? '' : 's'} · ${fmtDec(S.state.draconic?.count ?? 0)} Draconic ascension${S.state.draconic?.count === 1 ? '' : 's'}</div>`;
        } else if (asc >= DRACONIC_AT) {
          sub = '<span class="pill" style="color:#fde047">Ready</span>';
          body = `<div>You have ${fmtDec(asc)} ascensions: the door under the cabin opens the next time you walk in.</div>`;
          end = '<div class="tip-sep"></div><div class="muted">Click to walk into the Cabin and open it.</div>';
        } else {
          sub = `<span class="pill"><span style="color:#fca5a5">Asc ${fmtDec(asc)}/${DRACONIC_AT}</span></span>`;
          body = `<div style="color:#fca5a5">Opens at ${DRACONIC_AT} ascensions <span class="muted">(you have ${fmtDec(asc)})</span></div>`;
          end = '';
        }
      }
      setHtml(el, `<span class="nm">${l.name}</span>${sub}`);
      tips.set(el, `<div class="tip-title">The ${l.name}</div>${body}${end}`);
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
      const hint = here
        ? 'You are fishing here.'
        : status === 'unlocked'
          ? 'Click to sail here.'
          : status === 'buyable' && st.gold >= zone.unlockCost
            ? `Click to buy the boat for ${esc(money(zone.unlockCost))} and sail here.`
            : 'Click to open Boat &amp; Map.';
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
    // A boat you can afford is bought on the click, as the game's own line map does (ui.js): unlockZone
    // takes the gold and sails you there. Anything else locked opens Boat & Map, which says what it needs.
    const buy = status === 'buyable' && S.state.gold >= zone.unlockCost;
    if (status !== 'unlocked' && !buy) return openWindow('zones');
    const go = async () => {
      if (buy) {
        if (await act(S.game, 'unlockZone', { id: zone.id })) toast(`Bought a ${BOATS[zone.index]?.name ?? 'boat'}! Sailing to ${zone.name}.`);
        else console.warn(`[zone map] Couldn't buy the boat for ${zone.id}`);
        render();
      } else if (S.state.zone !== zone.id) await travel(zone.id);
    };
    const h = placeNow() !== 'dock' ? getHome() : null;
    if (h?.place) {
      // Out of the homestead first (the game's fade), then buy or sail
      if (h.busy) return;
      h.fadeTo(() => {
        h.leave();
        go();
        render();
      });
      return;
    }
    await go();
  };

  const goLand = async (target) => {
    // A shut basement: the Cabin opens it once there are enough ascensions (the game's own walk-in)
    if (target === 'basement' && !basementOpen()) {
      if (S.state.ascension.count < DRACONIC_AT) return;
      target = 'cabin';
    }
    const h = getHome();
    if (!h) return console.warn("[zone map] The game's scene hasn't drawn a frame yet; try again in a moment");
    if (h.busy || h.place === target) return;
    if (h.place) {
      // Between two homestead places: fade straight there, coming in through the door on the side
      // you came from (the Basement is left of the Cabin: its stairs come up through the Cabin's left door)
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
};

// =====================================================================================================
// Income pills and auto-click (was gold-income-logger.js)
//
// Every minute (or every 5, 15 or 30 s: "Measure over" in Settings > Mods) it measures, over that time,
// the gold you actually earned, the fish you caught, the chests you found and the XP you gained, each
// per second. They show as pills in the top bar to the right of your Emberscales (styled like the game's
// own +X/s pill). Hover a pill for details; the fish pill breaks the catch down by rarity. A shaded bar
// in each pill shrinks as the time runs out, and changing your equipped gear starts it over. An "Auto-click" toggle in the top bar clicks the
// water for you, 1-15 times a second (− / +); it starts on. Stop it (and remove the pills) with:
// stopGoldLogger()
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
  // How long each reading measures over: the "Measure over" choice in Settings > Mods (the manager's
  // MODS options), kept in this browser. A change comes in through window.setGoldLoggerPeriod (below),
  // which starts the measuring over without restarting the mod (that would turn auto-click back on).
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
    '@keyframes measured-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}';
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
};

// =====================================================================================================
// Build switcher (was build-switcher.js)
//
// It adds a key to the bottom bar, left of the Angler button, showing which of your saved builds (the
// game's gear sets, Angler > Gear: up to 5, each with its stat priorities) you're wearing: 1-5, or –
// when it's none of them.
//  - a line above the Ascension bar names the build you're wearing, with its stat priorities
//  - click either for a menu of every saved build; pick one to put it on
//  - or press 1-5 anywhere in the game (not while typing in chat or a box)
// Putting a build on is the game's own "put this set on" (the same as clicking the set in Angler >
// Gear): every piece you still have goes on, and its stat priorities come back with it.
// Stop it (and remove the key) with:  stopBuildSwitcher(), or untick it in Settings > Mods
// =====================================================================================================
const buildSwitcher = async () => {
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
  // The bar's buttons sit in groups (.ab-group), so the Angler button isn't a child of the bar itself:
  // insertBefore on the bar threw, and the key never appeared. The game also fills the bar in once
  // you're signed in (ui.js initUI sets its innerHTML), which drops a key put in before that: render()
  // puts it back.
  const placeKey = () => {
    const a = bar.querySelector('[data-win="angler"]');
    if (a) a.before(btn);
    else bar.prepend(btn);
  };
  placeKey();
  const num = btn.querySelector('.bs-num');

  // ---------- The status line ----------
  // Above the Ascension bar, in the same style as it and the XP bar: the build you're wearing, its
  // stat priorities, and how many of its pieces you're missing. Click it for the menu too. It never
  // widens the bar (contain: inline-size): a long line is cut off with "…".
  const row = document.createElement('button');
  row.type = 'button';
  row.id = 'buildswitch-row';
  row.setAttribute('aria-label', 'Current build (opens the builds menu)');
  const placeRow = () => {
    const ascRow = document.getElementById('asc-row');
    if (ascRow) ascRow.before(row);
    else document.getElementById('hotbar')?.prepend(row);
  };
  placeRow();
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
    if (!btn.isConnected || (bar.querySelector('[data-win="angler"]') && btn.nextElementSibling?.dataset.win !== 'angler')) placeKey();
    if (!row.isConnected) placeRow();
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
};

// =====================================================================================================
// Weather forecast (was weather-forecast.js)
//
// It adds a Forecast window, in the game's own window frame, that opens when you click the time and
// weather in the top bar or press W (not while typing in chat or a box). It has three views, all in
// game time:
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
// Stop it (and remove the window) with:  stopWeatherForecast(), or untick it in Settings > Mods
// =====================================================================================================
const weatherForecast = async () => {
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
/* The tab row is the game's own (.win-tabs.panel-tabs, first in the body: the close button sits at its right end).
   Its sides are pulled out by the body's 6px padding, not the 8px of .panel-tabs' margin, which ran 2px past
   the body and gave it a sideways scrollbar */
#wf-win .wf-tabs{margin-left:-6px;margin-right:-6px}
#wf-win .win-body{overflow-x:hidden}
#wf-win .wf-nowbox,#wf-win .wf-view{max-width:100%;box-sizing:border-box}
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
      <button class="win-close" aria-label="Close Forecast">✕</button>
    </header>
    <div class="win-body">
      <div class="win-tabs panel-tabs wf-tabs"></div>
      <div class="wf-nowbox"></div>
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
  // The close button keeps clear of the scrollbar through --sbw, as the game's windows.js sets it on its own
  // windows (trackScrollbar): the scrollbar's width while the body scrolls, 0 while it doesn't
  let sbwQueued = false;
  const syncSbw = () => {
    sbwQueued = false;
    const zoom = body.offsetWidth ? body.getBoundingClientRect().width / body.offsetWidth : 1;
    win.style.setProperty('--sbw', `${Math.max(0, Math.round((body.offsetWidth - body.clientWidth) * zoom))}px`);
  };
  const queueSbw = () => {
    if (sbwQueued) return;
    sbwQueued = true;
    requestAnimationFrame(syncSbw);
  };
  const sbwResize = new ResizeObserver(queueSbw);
  sbwResize.observe(body);
  const sbwChange = new MutationObserver(queueSbw);
  sbwChange.observe(body, { childList: true, subtree: true });
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
    // The hotkey on the first tab, as the game shows a window's key (ui.js tabBar)
    const tabs = TABS.map((t, i) => `<button class="win-tab ${t.id === tab ? 'active' : ''}" data-wf-tab="${t.id}">${t.name}${i === 0 ? ' <kbd>W</kbd>' : ''}</button>`).join('');
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
    sbwResize.disconnect();
    sbwChange.disconnect();
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
};

// =====================================================================================================
// Quicklinks (was summary-panel.js, the Summary panel)
//
// It adds a tab on the right edge of the page; click it to slide out a panel with what most needs you
// right now. While the panel is out, the game shrinks to make room beside it (nothing is covered);
// click the tab again to put it away. The panel shows:
//  - Character: your saved gear sets; click one to put it on, ⟳ saves what you're wearing over it,
//    ✕ deletes it, and "+ Save what you're wearing" adds a new one (as in Angler > Character)
//  - Bounties: the three bounty rows, with their progress and Claim (or Reroll) buttons
//  - Ascend: how many times you've ascended, progress toward the next ascension, the Ascend button,
//    and the Oracle's "ascend for me"
//  - Foreman: what it's buying (off, save up for the top of the list, or the next one you can afford)
//  - Chests: how many you have, and Open all
//  - Upgrades in your bag: only the gear that's better for your build than what you're wearing
// Every button and dropdown here is the game's own: the panel sits inside the game's window layer, so
// a click runs exactly what the same button in the game's windows runs (the Ascend button asks first,
// Open all shows what came out, a click on gear opens the game's Put on / Sell / Lock menu,
// Ctrl-click sells and right-click locks, as in your bag). Each section's title opens the game's
// window for it. The panel takes the Altar's dark red look while you're in the basement.
// Stop it (and remove the panel) with:  stopSummaryPanel(), or untick it in Settings > Mods
// =====================================================================================================
const summaryPanel = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { RARITIES, STATS, ZONES, ZONE_BY_ID, BOUNTIES, SET_COLOR, AUTO_ASCEND_AT, AUTOMATION_BY_ID, GEAR_SETS } = await mod('/src/data.js');
  const { fmt, fmtHtml, moneyHtml, hex } = await mod('/src/format.js');
  const { describeBounty, bountyProgress, rewardTier } = await mod('/src/bounties.js');
  const { ICON_COLS, ICON_ROWS, ICON_INDEX } = await mod('/src/icon-index.js');

  window.stopSummaryPanel?.(); // replace one already running

  // The game's window layer: its click and change handlers (ui.js onAction / onChangeInput) run every
  // data-action button and data-change dropdown inside it, so the panel lives in there
  const layer = document.getElementById('windows');
  const app = document.getElementById('app');
  if (!layer || !app) return console.warn('[summary] The game page was not found (#windows, #app)');

  const STORE_KEY = 'idle-angler-summary-open';
  const MAX_GEAR = 450;
  const SLIDE_MS = 180;
  // The panel's width: wide enough for each bounty's name on one line, between these (and never more
  // than half the window, or 85% of a narrow one). A name too long even then ends in "…" (hover for it).
  const MIN_W = 480;
  const MAX_W = 600;

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

  // ---------- Gear sets (as Angler > Character draws them) ----------
  const priorityName = (key) => (key === 'gold' ? 'Income' : STATS[key]?.seekTier ? `${RARITIES[STATS[key].seekTier].name} odds` : STATS[key]?.name ?? key);
  function gearSetsHtml() {
    const st = S.state;
    const sets = st.gearSets ?? [];
    const cells = sets.map((set, i) => {
      const pieces = Object.entries(set.items ?? {});
      const have = pieces.filter(([, uid]) => S.itemByUid(uid)).length;
      const wearing = pieces.length > 0 && pieces.every(([slot, uid]) => st.equipped[slot] === uid);
      return `<div class="gearset">
        <button class="btn small ${wearing ? 'primary' : ''}" data-action="gearset-equip" data-index="${i}" title="Put this set on${set.priority ? ` (and its build: ${esc(set.priority.length ? set.priority.map(priorityName).join(', ') : 'Income')})` : ''}">${esc(set.name)} <span class="muted">${have}/${pieces.length}</span></button>
        <button class="btn small icon-btn" data-action="gearset-save" data-index="${i}" title="Save what you're wearing as ${esc(set.name)}">⟳</button>
        <button class="btn small icon-btn" data-action="gearset-delete" data-index="${i}" title="Delete ${esc(set.name)}">✕</button>
      </div>`;
    });
    if (sets.length < GEAR_SETS.max) cells.push(`<button class="btn small" data-action="gearset-save" data-index="${sets.length}">+ Save what you're wearing</button>`);
    return `<div class="gearsets">${cells.join('')}</div>`;
  }

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
  function ascendHtml() {
    const st = S.state;
    const req = S.ascensionRequirement();
    const progress = Math.min(1, st.runGold / req);
    const can = S.canAscend();
    return `<div class="qs-asc-count">Ascensions: <b>${fmtHtml(st.ascension.count)}</b></div>
      <div class="sub">Earned this run: <b>${moneyHtml(st.runGold)}</b> / ${moneyHtml(req)} needed</div>
      <div class="progress"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>
      <button class="btn primary wide" data-action="ascend" ${disabled(!can)}>
        ${can ? `Ascend for +${fmtHtml(S.pendingEssence())} Essence` : `Ascend (${(progress * 100).toFixed(1)}%)`}
      </button>
      ${
        S.hasAutomation('oracle')
          ? `<label class="setting-select">Oracle: ascend for me <select data-change="auto-ascend">${AUTO_ASCEND_AT.map((x) => `<option value="${x}" ${st.settings.autoAscendAt === x ? 'selected' : ''}>${x ? `at ${x}× the requirement` : 'off'}</option>`).join('')}</select></label>`
          : lockNote('oracle')
      }`;
  }

  // ---------- The Foreman (as the Upgrades window's Automation tab draws it) ----------
  function foremanHtml() {
    if (!S.hasAutomation('foreman')) return lockNote('foreman');
    const set = S.state.settings;
    const mode = !set.autoUpgrade ? 'off' : set.autoUpgradeNextAfforded ? 'next' : 'save';
    const listed = (set.autoUpgradeOrder ?? []).length;
    return `<label class="setting-select">Buying <select data-change="autoup-mode" aria-label="How Foreman buys upgrades">${[
      ['off', 'Off'],
      ['save', 'Save up for the top of the list'],
      ['next', 'Buy the next one I can afford'],
    ]
      .map(([v, label]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`)
      .join('')}</select></label>
      <p class="muted small-text">${listed ? `${listed} upgrade${listed === 1 ? '' : 's'} on its list` : 'Its list is empty: nothing is bought'} · <button class="goto" data-action="goto" data-panel="automation">Change the list <span class="goto-arrow">→</span></button></p>`;
  }

  // ---------- Chests ----------
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
    return `<div class="qs-chests">
        ${chestIcon(best)}
        <div class="row-main"><div class="name">${total ? `${fmtHtml(total)} chest${total === 1 ? '' : 's'}` : 'No chests'}</div>${kinds ? `<div class="sub">${kinds}</div>` : ''}</div>
        <button class="btn primary" data-action="open-every-chest" ${disabled(!total)}>Open all</button>
      </div>`;
  }

  // ---------- Upgrades in the bag ----------
  // The same test as the game's ▲ badge on Bags: loose gear you can wear that improves your build by
  // more than half a percent (S.upgradeValue). Worked out every 2 s, as the game does, or at once when
  // your gear, build or level changes.
  const gear = { at: 0, sig: '', list: [] };
  const gearSig = () =>
    [S.state.player?.level, JSON.stringify(S.state.equipped), JSON.stringify(S.state.settings.buildPriority ?? []), S.looseGear().map((i) => i.uid + (i.locked ? 'L' : '')).join(',')].join('|');
  function upgrades() {
    const now = performance.now();
    const sig = gearSig();
    if (sig === gear.sig && now - gear.at < 2000) return gear.list;
    gear.at = now;
    gear.sig = sig;
    gear.list = S.looseGear()
      .filter((i) => S.canWear(i))
      .map((item) => ({ item, up: S.upgradeValue(item.uid).change }))
      .filter((x) => x.up > 0.005)
      .sort((a, b) => b.up - a.up || (b.item.ilvl ?? 0) - (a.item.ilvl ?? 0));
    return gear.list;
  }
  function gearHtml() {
    const list = upgrades();
    if (!list.length) return '<p class="muted small-text">Nothing in your bag beats what you’re wearing for your build.</p>';
    const cells = list.slice(0, MAX_GEAR).map(({ item, up }) => {
      const inSet = S.inGearSet(item.uid);
      const cls = [`q${item.ancient ?? 0}`, item.set ? 'set' : '', item.locked ? 'locked' : '', inSet ? 'in-set' : ''].join(' ');
      return `<button class="bag-cell ${cls}" style="--c:${itemColor(item)}" data-action="bag-item" data-uid="${item.uid}" data-tip="item:${item.uid}" aria-label="${esc(S.itemName(item))}">
        ${itemArt(item)}<span class="ilvl">${item.ilvl ?? 1}</span><span class="upg up">▲${pctText(up).replace('+', '')}</span>${item.locked ? '<span class="lock" title="Locked">🔒</span>' : ''}${inSet ? '<span class="set-mark" title="In a saved gear set">◆</span>' : ''}</button>`;
    });
    const more = list.length > MAX_GEAR ? `<p class="muted small-text">…and ${list.length - MAX_GEAR} more in your bag</p>` : '';
    return `<div class="bag-grid">${cells.join('')}</div>${more}<p class="muted small-text center">Click gear to put it on, sell or lock it · Ctrl-click sells · Right-click locks</p>`;
  }

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.id = 'summary-style';
  style.textContent = `
:root{--qs-w:min(${MIN_W}px,85vw)}
body.qs-open #app{margin-right:var(--qs-w)}
#app{transition:margin-right ${SLIDE_MS}ms ease-out}
body.qs-open .corner-btn,body.qs-open #bmc-wbtn{margin-right:var(--qs-w)}
#summary-panel{position:fixed;top:0;right:0;bottom:0;width:var(--qs-w);box-sizing:border-box;z-index:1;display:flex;flex-direction:column;
  pointer-events:auto;font-family:var(--font);font-size:calc(14px * var(--ui-scale,1));color:var(--text);
  border:12px solid;border-image:url('/assets/ui/ornate/forest/panel_main_normal.png') 32 fill / 16px / 0 stretch;background:#1e2c21;background-clip:padding-box;
  transform:translateX(100%);visibility:hidden;transition:transform ${SLIDE_MS}ms ease-out,visibility 0s linear ${SLIDE_MS}ms}
body.qs-open #summary-panel{transform:none;visibility:visible;transition:transform ${SLIDE_MS}ms ease-out,visibility 0s}
#summary-panel .qs-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px 4px 8px}
#summary-panel section{margin:0 0 10px}
#summary-panel h3{display:flex;align-items:baseline;gap:8px;margin:6px 0 4px;padding:4px 8px;font-size:1em;color:var(--accent);
  background:#17221a;box-shadow:inset 0 0 0 1px rgba(201,207,210,.14)}
#summary-panel h3 .goto{margin-left:auto;font-size:.85em;font-weight:400}
#summary-panel .qs-count{color:var(--muted);font-weight:400}
#summary-panel .bounties.list{margin:4px 0}
#summary-panel .bounty-row .name{font-size:.95em}
#summary-panel .qs-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#summary-panel .row-main{min-width:0}
#summary-panel .progress{margin:4px 0 6px}
#summary-panel .qs-asc-count{margin:2px 0 4px}
#summary-panel .gearsets{justify-content:start;margin:4px 0}
#summary-panel .btn.wide{width:100%}
#summary-panel .setting-select{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:6px 0 0;padding:6px 8px;background:#17221a;box-shadow:inset 0 0 0 1px rgba(201,207,210,.14)}
#summary-panel .setting-select select{flex:1 1 140px;min-width:0}
#summary-panel .locked-note{display:block;width:100%;margin-top:6px;text-align:left}
#summary-panel p{margin:4px 0}
#summary-panel .qs-chests{display:flex;align-items:center;gap:8px}
#summary-panel .qs-chests .row-main{flex:1}
#summary-panel .bag-grid{justify-content:start;margin:6px 0}
#summary-tab{position:fixed;top:calc(50% - 70px);right:0;z-index:5;transform:translateY(-100%);display:flex;flex-direction:column;align-items:center;gap:6px;
  min-width:0;padding:10px 0;writing-mode:vertical-rl;letter-spacing:1px;transition:right ${SLIDE_MS}ms ease-out;
  /* As wide as the game's side tabs to the next water (.sail-tab: 44px, zoomed by the text size) */
  width:calc(44px * var(--ui-scale, 1));justify-content:center}
body.qs-open #summary-tab{right:var(--qs-w)}
/* The side tabs' chevron (.sail-chev): it points right as drawn, so it's flipped to point left while the panel is away */
#summary-tab .qs-arrow{flex:none;width:10px;height:18px;background:var(--accent);-webkit-mask:url('/assets/icons/hud/chevron.svg') center / contain no-repeat;mask:url('/assets/icons/hud/chevron.svg') center / contain no-repeat;transform:scaleX(-1)}
body.qs-open #summary-tab .qs-arrow{transform:none}
#summary-tab .qs-dot{writing-mode:horizontal-tb;min-width:16px;padding:0 3px;font:700 11px/16px var(--font);text-align:center;color:#1b2a17;background:var(--accent);border-radius:8px}
#summary-tab .qs-dot:empty{display:none}
/* The basement: the Altar's black and crimson, as the game draws the Draconic Altar window */
body[data-place='basement'] #summary-panel{border-image-source:url('/assets/ui/ornate/blood/panel_main_normal.png');background-color:#0a090a}
body[data-place='basement'] #summary-panel :is(h3,.setting-select){background-color:#141012}
body[data-place='basement'] #summary-panel .row{border-image-source:url('/assets/ui/ornate/blood/panel_slotdark_normal.png')}
body[data-place='basement'] :is(#summary-panel,#summary-tab) .btn,body[data-place='basement'] #summary-tab{border-image-source:url('/assets/ui/ornate/blood/button_dark_normal.png')}
body[data-place='basement'] :is(#summary-panel,#summary-tab) .btn:hover:not(:disabled),body[data-place='basement'] #summary-tab:hover{border-image-source:url('/assets/ui/ornate/blood/button_dark_hovered.png')}
body[data-place='basement'] #summary-panel .btn.primary{border-image-source:url('/assets/ui/ornate/blood/button_light_normal.png');color:#3a0d10}
@media (prefers-reduced-motion:reduce){#app,#summary-panel,#summary-tab{transition:none}}`;
  document.head.append(style);

  // ---------- The panel and its tab ----------
  const SECTIONS = [
    { id: 'character', title: 'Character', panel: 'character', html: gearSetsHtml, count: () => `${(S.state.gearSets ?? []).length}/${GEAR_SETS.max} gear sets` },
    { id: 'bounties', title: 'Bounties', panel: 'bounties', html: bountiesHtml, count: () => { const n = finishedBounties(); return n ? `${n} to claim` : ''; } },
    { id: 'ascend', title: 'Ascend', panel: 'ascend', html: ascendHtml },
    { id: 'foreman', title: 'Foreman', panel: 'automation', html: foremanHtml },
    { id: 'chests', title: 'Chests', panel: 'chests', html: chestsHtml },
    { id: 'gear', title: 'Upgrades in your bag', panel: 'bags', html: gearHtml, count: () => { const n = upgrades().length; return n ? String(n) : ''; } },
  ];
  const panel = document.createElement('aside');
  panel.id = 'summary-panel';
  panel.setAttribute('aria-label', 'Quicklinks');
  panel.innerHTML = `<div class="qs-body">${SECTIONS.map(
    (s) => `<section data-qs="${s.id}"><h3>${esc(s.title)} <span class="qs-count"></span><button class="goto" data-action="goto" data-panel="${s.panel}" title="Open the game's window for this">Open <span class="goto-arrow">→</span></button></h3><div class="qs-content"></div></section>`,
  ).join('')}</div>`;
  layer.append(panel);
  const parts = SECTIONS.map((s) => {
    const el = panel.querySelector(`[data-qs="${s.id}"]`);
    return { ...s, content: el.querySelector('.qs-content'), countEl: el.querySelector('.qs-count'), last: null, lastCount: null };
  });

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.id = 'summary-tab';
  tab.className = 'btn';
  tab.setAttribute('aria-controls', 'summary-panel');
  tab.innerHTML = '<span class="qs-arrow" aria-hidden="true"></span><span>Quicklinks</span><span class="qs-dot" title="Bounties to claim"></span>';
  document.body.append(tab);
  const dot = tab.querySelector('.qs-dot');

  // ---------- Keeping it current ----------
  // Redrawn when the game's state changes (at most every 300 ms) and once a second for the timers. A
  // part is only redrawn when it changed, never while a dropdown in it is open, and not between a press
  // and its release (a button swapped mid-click would lose the click: the game holds off the same way).
  let isOpen = false;
  let pressing = false;
  let pending = 0;
  function render() {
    pending = 0;
    const done = finishedBounties();
    if (dot.textContent !== (done ? String(done) : '')) dot.textContent = done ? String(done) : '';
    if (!isOpen || pressing) return;
    const focused = document.activeElement;
    for (const p of parts) {
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
      const count = p.count?.() ?? '';
      if (count !== p.lastCount) {
        p.countEl.textContent = count;
        p.lastCount = count;
      }
    }
    fitWidth();
  }

  // Widen (or narrow) the panel by what the longest bounty name lacks (or has to spare). Each name's text
  // is in an inline .qs-fit, so its own width is the width it needs on one line.
  let width = MIN_W;
  function fitWidth() {
    const lines = [...panel.querySelectorAll('.bounty-row .qs-line')];
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
    tab.setAttribute('aria-expanded', String(open));
    tab.setAttribute('aria-label', open ? 'Hide Quicklinks' : 'Show Quicklinks');
    tab.title = open ? 'Hide Quicklinks' : 'Show Quicklinks: gear sets, bounties, ascending, Foreman, chests and gear upgrades';
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
  tab.addEventListener('click', () => setOpen(!isOpen));
  let startOpen = false;
  try {
    startOpen = localStorage.getItem(STORE_KEY) === '1';
  } catch {
    // storage blocked
  }
  setOpen(startOpen, { remember: false });
  render();

  window.stopSummaryPanel = () => {
    unsubscribe?.();
    clearInterval(timer);
    clearTimeout(pending);
    cancelAnimationFrame(slideFrame);
    removeEventListener('pointerup', onRelease);
    removeEventListener('pointercancel', onRelease);
    document.body.classList.remove('qs-open');
    document.documentElement.style.removeProperty('--qs-w');
    panel.remove();
    tab.remove();
    style.remove();
    dispatchEvent(new Event('resize'));
    delete window.stopSummaryPanel;
  };
  console.log('[quicklinks] On: the Quicklinks tab is on the right edge. Turn it off with stopSummaryPanel()');
};

// =====================================================================================================
// The manager: which mods run, and the Mods tab in the Settings window
// =====================================================================================================
// The game draws a window's tabs and contents itself (ui.js renderWindow) and replaces them whenever
// what it would draw changes, so the Mods tab can't be one of its tabs. Instead it's added to the
// Settings window on screen, and added back each time the game redraws it. While it's showing, the
// game's own contents are hidden, not removed: a click on one of the game's tabs brings them back.
const MODS = [
  {
    id: 'topbarFixes',
    name: "Top bar layout fixes",
    desc: "Until the game fixes test report #28 and #29: the Supporter store button stays beside the rest of the top bar, and the currencies keep their widest width so the bar doesn't shift as your gold changes",
    start: topbarFixes,
    stop: 'stopTopbarFixes',
    always: true, // a fix, not a feature: always on, and not listed in the Mods tab
  },
  {
    id: 'zoneMap',
    name: "Zone map strip",
    desc: "A strip under the top bar with every place in the world: click one to go there. It shows your boat, your species mastery, ripe crops and missing fish that are biting now",
    start: zoneMap,
    stop: 'stopZoneMap',
  },
  {
    id: 'incomePills',
    name: "Income pills and auto-click",
    desc: "Gold, fish, chests and XP a second, measured each minute, in the top bar, and an Auto-click toggle (1-15 clicks a second) that starts on",
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
  },
  {
    id: 'buildSwitcher',
    name: "Build switcher",
    desc: "A key left of the Angler button that puts on one of your saved gear sets; or press 1-5",
    start: buildSwitcher,
    stop: 'stopBuildSwitcher',
  },
  {
    id: 'weatherForecast',
    name: "Weather forecast",
    desc: "Click the time and weather in the top bar, or press W, for the weather hour by hour, day by day and by month",
    start: weatherForecast,
    stop: 'stopWeatherForecast',
  },
  {
    id: 'summaryPanel',
    name: "Quicklinks",
    desc: "A tab on the right edge that slides out your gear sets, bounties, ascending, the Foreman, chests and the upgrades in your bag",
    start: summaryPanel,
    stop: 'stopSummaryPanel',
  },
];
const STORE_KEY = 'idle-angler-mods';
const loadChoices = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
  } catch {
    return {};
  }
};
const choices = loadChoices(); // mod id -> false once turned off (every mod is on until then)
const saveChoices = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(choices));
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
};
const wanted = (m) => m.always || choices[m.id] !== false;
const starting = new Set();
const failed = {}; // mod id -> why it didn't start
// A mod is running while its stop function exists (also true of one stopped from the console)
const running = (m) => typeof window[m.stop] === 'function';

async function turnOn(m) {
  if (starting.has(m.id)) return;
  starting.add(m.id);
  delete failed[m.id];
  refreshPane();
  try {
    await m.start();
    // A mod that can't find its part of the page warns in the console and returns without starting
    if (!running(m)) failed[m.id] = "It couldn't find its part of the game page (the console says which).";
  } catch (e) {
    failed[m.id] = String(e?.message ?? e);
    console.error(`[mods] ${m.name} failed to start`, e);
  }
  starting.delete(m.id);
  refreshPane();
}

function turnOff(m) {
  try {
    window[m.stop]?.();
  } catch (e) {
    console.error(`[mods] ${m.name} failed to stop`, e);
  }
  delete failed[m.id];
  refreshPane();
}

// ---------- The Mods tab ----------
const layer = document.getElementById('windows');
if (!layer) return console.warn('[mods] The game page was not found (#windows)');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let showing = false; // the Mods tab is the one on screen

const style = document.createElement('style');
style.id = 'im-style';
style.textContent = `
.window.im-showing > .win-body > :not(.win-tabs):not(.im-pane){display:none !important}
.window:not(.im-showing) .im-pane{display:none}
.im-pane .im-state{display:block;margin-top:2px;font-size:.85em}
.im-pane .im-state.on{color:#86efac}
.im-pane .im-state.off{opacity:.65}
.im-pane .im-state.failed{color:#fca5a5}
.im-pane .im-option{margin:-2px 0 8px 30px}
`;
document.head.append(style);

const readOption = (o) => {
  try {
    const v = localStorage.getItem(o.key);
    return o.values.some(([value]) => value === v) ? v : o.fallback;
  } catch {
    return o.fallback;
  }
};
// A mod's option: a dropdown in the game's own setting-select style, outside the row's label so a click
// on it doesn't tick the box
const optionHtml = (m, o) => {
  const now = readOption(o);
  const opts = o.values.map(([value, text]) => `<option value="${value}" ${value === now ? 'selected' : ''}>${esc(text)}</option>`).join('');
  return `
    <label class="setting-select im-option">${esc(o.label)} <select data-im-opt="${m.id}" data-key="${o.key}">${opts}</select></label>`;
};

function paneHtml() {
  const row = (m) => {
    const on = running(m);
    const state = starting.has(m.id) ? ['', 'Starting…'] : failed[m.id] ? ['failed', `Didn't start: ${failed[m.id]}`] : on ? ['on', 'On'] : ['off', 'Off'];
    return `
    <label class="setting">
      <input type="checkbox" data-im="${m.id}" ${wanted(m) ? 'checked' : ''} ${starting.has(m.id) ? 'disabled' : ''}/>
      <span><b>${esc(m.name)}</b><span class="sub">${esc(m.desc)}</span><span class="im-state ${state[0]}">${esc(state[1])}</span></span>
    </label>${(m.options ?? []).map((o) => optionHtml(m, o)).join('')}`;
  };
  return `
    <h2>UI mods</h2>
    <p class="muted small-text">These come from the idle-angler-mods.js script, not the game. A change takes effect at once, and this browser remembers it the next time the script runs.</p>
    <div class="btn-row">
      <button class="btn small" data-im-all="on">All on</button>
      <button class="btn small" data-im-all="off">All off</button>
    </div>
    ${MODS.filter((m) => !m.always).map(row).join('')}`;
}

const settingsWindow = () => layer.querySelector('section.window[data-win="settings"]');

function refreshPane() {
  const pane = settingsWindow()?.querySelector('.im-pane');
  if (!pane) return;
  const scroll = pane.parentElement.scrollTop;
  pane.innerHTML = paneHtml();
  pane.parentElement.scrollTop = scroll;
}

/** Put the Mods tab and its pane into the Settings window (again, after the game redraws it). */
function decorate() {
  const win = settingsWindow();
  const body = win?.querySelector('.win-body');
  const tabs = body?.querySelector(':scope > .win-tabs');
  if (!tabs) return;
  let tab = tabs.querySelector('.im-tab');
  if (!tab) {
    tab = document.createElement('button');
    tab.className = 'win-tab im-tab';
    tab.type = 'button';
    tab.textContent = 'Mods';
    const credits = tabs.querySelector('[data-tab="credits"]');
    tabs.insertBefore(tab, credits);
  }
  if (!body.querySelector(':scope > .im-pane')) {
    const pane = document.createElement('div');
    pane.className = 'im-pane';
    pane.innerHTML = paneHtml();
    body.append(pane);
  }
  win.classList.toggle('im-showing', showing);
  tab.classList.toggle('active', showing);
  // The game's own active tab looks inactive while Mods shows (marked, so it can be given back)
  for (const t of tabs.querySelectorAll('.win-tab:not(.im-tab)')) {
    if (showing && t.classList.contains('active')) {
      t.classList.remove('active');
      t.dataset.imActive = '1';
    } else if (!showing && t.dataset.imActive) {
      t.classList.add('active');
      delete t.dataset.imActive;
    }
  }
}

// The game adds the Settings window when it opens and rewrites its body when it redraws
let bodyObserver = null;
let watched = null;
function watch() {
  const body = settingsWindow()?.querySelector('.win-body') ?? null;
  if (body !== watched) {
    bodyObserver?.disconnect();
    watched = body;
    if (!body) showing = false; // closed: it opens on the game's own tab next time
    else {
      bodyObserver = new MutationObserver(() => {
        if (!body.querySelector(':scope > .im-pane') || !body.querySelector(':scope > .win-tabs .im-tab')) decorate();
      });
      bodyObserver.observe(body, { childList: true });
    }
  }
  decorate();
}
const layerObserver = new MutationObserver(watch);
layerObserver.observe(layer, { childList: true });

// Clicks: the Mods tab, the game's tabs (back to the game's contents), All on / All off
function onClick(e) {
  const win = e.target.closest('section.window[data-win="settings"]');
  if (!win) return;
  const tab = e.target.closest('.win-tab');
  if (tab?.classList.contains('im-tab')) {
    showing = true;
    decorate();
    win.querySelector('.win-body').scrollTop = 0;
    return;
  }
  if (tab && showing) {
    showing = false;
    decorate();
    return;
  }
  const all = e.target.closest('[data-im-all]');
  if (all) {
    const on = all.dataset.imAll === 'on';
    for (const m of MODS.filter((x) => !x.always)) {
      choices[m.id] = on;
      if (on && !running(m)) turnOn(m);
      else if (!on && running(m)) turnOff(m);
    }
    saveChoices();
    refreshPane();
  }
}
// Capture, so the game's tab is given back its active look before the game's own click handler runs
layer.addEventListener('click', onClick, true);

function onChange(e) {
  const pick = e.target.closest('select[data-im-opt]');
  if (pick) {
    pick.blur();
    try {
      localStorage.setItem(pick.dataset.key, pick.value);
    } catch {
      // storage blocked: the mod can't read it back, so it keeps its default
    }
    // The mod reads its options as it starts. A running one takes the change live if its option says how,
    // and is restarted otherwise
    const m = MODS.find((x) => x.id === pick.dataset.imOpt);
    const o = m?.options?.find((x) => x.key === pick.dataset.key);
    if (m && running(m)) {
      if (o?.apply) o.apply(pick.value);
      else {
        turnOff(m);
        turnOn(m);
      }
    }
    return;
  }
  const box = e.target.closest('input[data-im]');
  if (!box) return;
  box.blur(); // the game doesn't redraw a window while one of its boxes has focus
  const m = MODS.find((x) => x.id === box.dataset.im);
  if (!m) return;
  choices[m.id] = box.checked;
  saveChoices();
  if (box.checked && !running(m)) turnOn(m);
  else if (!box.checked && running(m)) turnOff(m);
  else refreshPane();
}
layer.addEventListener('change', onChange);

window.stopIdleAnglerMods = () => {
  for (const m of MODS) if (running(m)) turnOff(m);
  layerObserver.disconnect();
  bodyObserver?.disconnect();
  layer.removeEventListener('click', onClick, true);
  layer.removeEventListener('change', onChange);
  const win = settingsWindow();
  showing = false;
  if (win) {
    decorate();
    win.classList.remove('im-showing');
    win.querySelector('.im-tab')?.remove();
    win.querySelector('.im-pane')?.remove();
  }
  style.remove();
  delete window.stopIdleAnglerMods;
};

watch();
// Wait for the game to be up: signed in, with its action bar filled in (ui.js initUI). Pasted or loaded
// before that (straight after a reload), the mods found the game's page still half built: the build
// switcher's key went into the empty bar and was wiped when the game filled it in.
const ready = () => Boolean(document.querySelector('#actionbar [data-win="angler"]'));
if (!ready()) {
  console.log('[mods] Waiting for the game to finish loading…');
  await new Promise((done) => {
    const check = setInterval(() => {
      if (!ready() && window.stopIdleAnglerMods) return;
      clearInterval(check);
      done();
    }, 250);
  });
  if (!window.stopIdleAnglerMods) return; // stopped (or replaced) while waiting
}
// One at a time, in the order above: several of them move the game's layout, and each measures it as it starts
for (const m of MODS) if (wanted(m)) await turnOn(m);
console.log(`[mods] On: ${MODS.filter(running).map((m) => m.name).join(', ') || 'none'}. Turn mods on or off in Settings > Mods; stop all with stopIdleAnglerMods()`);
})();
