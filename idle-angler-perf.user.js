// ==UserScript==
// @name         Idle Angler Performance
// @namespace    http://tampermonkey.net/
// @version      2026-11-19
// @description  Lower CPU use for computers without graphics acceleration, keeping the look
// @author       You
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Idle Angler — performance mod for slow computers (no GPU, or the GPU switched off in the browser).
// It stands alone: it doesn't need the Idle Angler Mods script and doesn't change it. Load it with
// Tampermonkey, or paste it into the DevTools console on https://idle-angler.onrender.com/ at any time.
//
// What it changes, each of which can be switched off on its own:
//  - Frame cap. The game draws a new frame every time the screen refreshes (60 a second, 144 on a fast
//    monitor), and each frame rebuilds ~20 shapes on the CPU (sky, rain, water, spots, the line) and runs
//    every blur and shader pass. Capping it at 30 halves that or better. The game's own clock runs on
//    elapsed time, not frames, so fishing, sailing and timers go at the same speed.
//    The 30 setting aims at 31: the game switches its light shafts off for a moment to test them when it
//    measures under 30 a second for 15 s, and an exact 30 measures as 29.9 now and then. Below 30 (24, 20)
//    that test runs once per visit: the shafts blink off for 5 s, then come back. They are never turned off
//    for good by it, because a capped game doesn't speed up without them.
//    Pixi's own ticker.maxFPS isn't used: it rounds the time down to whole milliseconds, so a 30 cap
//    on a 60 Hz screen skips the 33.3 ms frame and runs at 20.
//  - Lighter blurs. The fog and the lantern's three bloom layers are Pixi blur filters at quality 3 and 4:
//    each quality step is one more pass across the screen in each direction, 30 passes a frame at
//    night. Lighter blurs cap them at 2 passes: the same spread, slightly less smooth at the edges.
//  - Meter: a small chip right of the game's "online" player count with the frames a second and the cap
//    (in the window's bottom left corner until the game shows that count). Click it for the settings
//    and which renderer the game ended up on: "Microsoft Basic Render Driver" (Windows), "SwiftShader" or
//    "llvmpipe" in its name means the graphics are drawn by the CPU; "canvas" means the browser had no WebGL
//    at all, and Pixi drew with plain canvas. When the CPU draws, nearly all the cost is in the browser's
//    GPU process, not the page, so it's Chrome's Task Manager (Shift+Esc) that shows what these save.
//    Measured on a stand-in for the scene (the game's Pixi, filters and per-frame drawing) in Chrome with
//    the GPU off: 409% of a core uncapped at 60 fps; 311% with lighter blurs; 201% capped at 30;
//    185% with both; 120% at 24 with both.
// Settings are remembered in this browser (localStorage 'idle-angler-perf').
// Pasting it again replaces the one running. Stop it and put everything back with:
//   stopIdleAnglerPerf()

(async () => {
  window.stopIdleAnglerPerf?.();

  const KEY = 'idle-angler-perf';
  const CAPS = [0, 60, 45, 30, 24, 20]; // 0: no cap
  const BLUR_PASSES = 2;
  const DEFAULTS = { cap: 30, blur: true, meter: true };
  const opts = (() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  })();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(opts));
    } catch {
      // private window or blocked storage: the settings just aren't remembered
    }
  };

  // The game imports 'pixi.js' through its import map, which points at /vendor/pixi.mjs: importing that
  // URL gives the same module, so patching its classes patches the game's.
  const PIXI = await import(new URL('/vendor/pixi.mjs', location.origin).href);
  const { Ticker, BlurFilter } = PIXI;

  // ---------- Frame cap ----------
  // Ticker.prototype.update is what each animation frame calls (ticker._tick looks it up on the instance,
  // so a patched prototype reaches the ticker the game already has). A skipped update leaves lastTime
  // alone, so the next frame's deltaMS covers the skipped time and the game's clock stays right.
  const baseUpdate = Ticker.prototype.update;
  let app = null; // the game's Application: the context of its ticker's render listener
  let gameTicker = null;
  const findApp = (ticker) => {
    for (let l = ticker._head?.next; l; l = l.next) if (l._context?.stage && l._context?.renderer) return l._context;
    return null;
  };
  const SLACK_MS = 2; // a frame up to this early still counts (vsync timing jitters by a millisecond or so)
  let due = 0; // when the next frame is due; steps by the interval so the average rate is the cap
  const stats = { frames: 0, since: performance.now(), fps: 0 };

  Ticker.prototype.update = function (now = performance.now()) {
    if (this !== gameTicker) {
      const found = !gameTicker && findApp(this);
      if (!found) return baseUpdate.call(this, now);
      app = found;
      gameTicker = this;
      onApp();
    }
    if (opts.cap) {
      const interval = 1000 / (opts.cap >= 30 ? opts.cap + 1 : opts.cap);
      if (now < due - SLACK_MS) return;
      due = now - due > interval ? now + interval : due + interval; // fell behind (a slow frame, a hidden tab): start again from now
    }
    baseUpdate.call(this, now);
    stats.frames++;
  };

  // ---------- Lighter blurs ----------
  // Hooked where each blur runs, not found by walking the stage: the game draws its world into a texture
  // from a root of its own (postfx.js moves the camera off app.stage), so the fog and bloom aren't on it.
  const blurQuality = new Map(); // each blur filter the game made -> its own quality
  const baseBlurApply = BlurFilter.prototype.apply;
  BlurFilter.prototype.apply = function (...args) {
    if (!blurQuality.has(this)) blurQuality.set(this, this.quality);
    const own = blurQuality.get(this);
    const want = opts.blur ? Math.min(own, BLUR_PASSES) : own;
    if (this.quality !== want) this.quality = want;
    return baseBlurApply.apply(this, args);
  };
  const restoreBlur = () => {
    for (const [f, q] of blurQuality) if (!f.destroyed) f.quality = q;
    blurQuality.clear();
  };

  // ---------- Renderer ----------
  const rendererName = () => {
    const r = app?.renderer;
    if (!r) return 'not started yet';
    let name = r.name ?? String(r.type);
    const gl = r.gl;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const what = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      name += ` (${what})`;
    }
    return name;
  };
  const softwareGl = () => /swiftshader|llvmpipe|software|basic render|microsoft basic|warp/i.test(rendererName());

  // ---------- Meter and settings ----------
  const css = document.createElement('style');
  css.textContent = `
    #iap-perf { position: fixed; left: 8px; bottom: 8px; z-index: 2147483000; color: #e9dcbc; user-select: none; }
    #iap-perf.docked { position: absolute; }
    /* the chip copies the game's "online" chip (.online-count) it sits beside */
    #iap-perf .chip { display: inline-block; padding: 3px 8px; font-size: 13px; white-space: nowrap; cursor: pointer;
      background: rgba(10, 14, 8, 0.72); border: 2px solid rgba(207, 224, 168, 0.35);
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45); font-variant-numeric: tabular-nums; }
    #iap-perf .panel { display: none; margin-bottom: 6px; padding: 8px 10px; width: 250px; font: 12px/1.35 system-ui, sans-serif;
      color: #e8eedd; background: rgba(10, 14, 8, 0.92); border: 2px solid rgba(207, 224, 168, 0.35); }
    @media (max-width: 640px) { #iap-perf .chip { padding: 2px 6px; font-size: 11px; } }
    #iap-perf.open .panel { display: block; }
    #iap-perf .panel h4 { margin: 0 0 6px; font-size: 12px; }
    #iap-perf label { display: flex; align-items: center; gap: 6px; margin: 4px 0; cursor: pointer; }
    #iap-perf select { font: inherit; }
    #iap-perf .note { margin-top: 6px; opacity: 0.75; word-break: break-word; }
    #iap-perf.hidden .chip { opacity: 0.35; }`;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'iap-perf';
  box.innerHTML = `
    <div class="panel">
      <h4>Performance</h4>
      <label>Frame cap <select data-k="cap">${CAPS.map((c) => `<option value="${c}">${c ? `${c} a second` : 'Off'}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-k="blur"> Lighter blurs (fog and lantern glow)</label>
      <label><input type="checkbox" data-k="meter"> Show the meter</label>
      <div class="note" data-renderer></div>
      <div class="note">To see the CPU it saves: Chrome's Task Manager (Shift+Esc), the GPU Process and this tab.</div>
    </div>
    <span class="chip" title="Idle Angler performance: click for settings"></span>`;
  document.body.appendChild(box);
  const chip = box.querySelector('.chip');
  const capSel = box.querySelector('[data-k="cap"]');
  capSel.value = String(CAPS.includes(opts.cap) ? opts.cap : 30);
  box.querySelector('[data-k="blur"]').checked = opts.blur;
  box.querySelector('[data-k="meter"]').checked = opts.meter;
  box.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    opts[k] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
    save();
    if (k === 'cap') due = 0;
    render();
  });
  chip.addEventListener('click', () => {
    box.classList.toggle('open');
    render();
  });
  // keep keys typed in the panel away from the game's shortcuts
  box.addEventListener('keydown', (e) => e.stopPropagation());

  // Docked just right of the game's "online" chip (#online-count, absolute at the stage's bottom left, beside
  // the chat button; on phones it moves up onto the chat button, and this follows). The game hides that chip
  // until it's connected: the bottom left corner of the window until then.
  const GAP = 6;
  const place = () => {
    const online = document.getElementById('online-count');
    if (!online || online.hidden || !online.offsetParent) {
      box.classList.remove('docked');
      box.style.left = box.style.bottom = '';
      if (box.parentElement !== document.body) document.body.appendChild(box);
      return;
    }
    if (box.previousElementSibling !== online) online.after(box);
    box.classList.add('docked');
    const bottom = parseFloat(getComputedStyle(online).bottom) || 0;
    box.style.left = `${online.offsetLeft + online.offsetWidth + GAP}px`;
    box.style.bottom = `${bottom + (online.offsetHeight - chip.offsetHeight) / 2}px`;
  };
  const placeObserver = new ResizeObserver(place); // the count's width changes as players come and go
  const watchOnline = () => {
    const online = document.getElementById('online-count');
    if (online && !online.dataset.iapWatched) {
      online.dataset.iapWatched = '1';
      placeObserver.observe(online);
    }
  };
  addEventListener('resize', place);

  const render = () => {
    const now = performance.now();
    const span = now - stats.since;
    if (span >= 900) {
      stats.fps = (stats.frames * 1000) / span;
      stats.frames = 0;
      stats.since = now;
    }
    const cap = opts.cap ? `cap ${opts.cap}` : 'no cap';
    chip.textContent = !app
      ? '⚡ waiting for the game'
      : opts.meter || box.classList.contains('open')
        ? `⚡ ${stats.fps.toFixed(0)} fps · ${cap}`
        : '⚡';
    box.classList.toggle('hidden', !opts.meter && !box.classList.contains('open'));
    if (box.classList.contains('open')) {
      box.querySelector('[data-renderer]').textContent =
        `Renderer: ${rendererName()}${app && softwareGl() ? ' — drawn by the CPU' : ''}.`;
    }
    watchOnline();
    place();
  };
  const meterTimer = setInterval(render, 1000);
  render();

  function onApp() {
    due = 0;
    render();
  }

  // for checking from the console
  window.idleAnglerPerf = { opts, stats, blurs: blurQuality, get app() { return app; } };

  window.stopIdleAnglerPerf = () => {
    Ticker.prototype.update = baseUpdate;
    BlurFilter.prototype.apply = baseBlurApply;
    clearInterval(meterTimer);
    placeObserver.disconnect();
    removeEventListener('resize', place);
    delete document.getElementById('online-count')?.dataset.iapWatched;
    restoreBlur();
    box.remove();
    css.remove();
    delete window.idleAnglerPerf;
    delete window.stopIdleAnglerPerf;
  };
})();
