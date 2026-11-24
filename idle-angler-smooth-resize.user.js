// ==UserScript==
// @name         Idle Angler Smooth Resizing
// @namespace    http://tampermonkey.net/
// @version      2026-11-24
// @description  No light-blue flashes while the game resizes
// @author       You
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==

// Idle Angler — Smooth resizing, on its own. The same fix is a mod in the Idle Angler Mods script
// (idle-angler-mods.js, "Smooth resizing" in Settings > Mods); this needs nothing else. Load it with
// Tampermonkey, or paste it into the DevTools console on https://idle-angler.onrender.com/.
//
// While the game's picture changes size (the browser window dragged, a phone turned, a side panel sliding
// out), it flashes light blue. Why: the scene is drawn into a picture of the screen's size first
// (postfx.js PostFx, for its light shafts and reflections), and the screen shows that picture. A new size
// makes a new, empty one (PostFx.layout). Pixi then draws the screen at once, before the next frame has
// drawn the scene into it (pixi.js ResizePlugin: renderer.resize, then render), so the screen shows only its
// clear colour, the game's light blue (main.js: background 0x8fd3ff), until the next frame.
// This draws the scene into the new picture as soon as it's made, with what the last frame drew it with
// (the scene's lastPost), so the picture is never empty. Nothing else changes, and nothing goes to the server.
//
// With the Mods script loaded too, whichever starts last replaces the other (they share stopSmoothResize),
// so the fix runs once; unticking "Smooth resizing" in Settings > Mods turns this one off as well.
// Stop it with:  stopSmoothResize()

(async () => {
  // The game's own module (ES modules are one instance per URL, so this is the one the game runs)
  const { PostFx } = await import(new URL('/src/postfx.js', location.origin).href);

  window.stopSmoothResize?.(); // replace one already running (this script again, or the Mods script's)

  const proto = PostFx.prototype;
  const original = proto.layout;
  let filled = 0;
  proto.layout = function (L) {
    const before = this.rt;
    const out = original.call(this, L);
    // A new picture (a new size): draw the scene into it now, as the next frame would
    if (this.rt !== before && this.scene?.lastPost) {
      this.render(this.scene.lastPost);
      filled++;
    }
    return out;
  };

  window.smoothResize = { get filled() { return filled; } }; // for the console: pictures drawn at once
  window.stopSmoothResize = () => {
    if (proto.layout !== original) proto.layout = original;
    delete window.smoothResize;
    delete window.stopSmoothResize;
  };
  console.log('[smooth resize] On: no light-blue frames while the game resizes. Turn it off with stopSmoothResize()');
})();
