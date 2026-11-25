// ==UserScript==
// @name         Idle Angler Smooth Resizing
// @version      2026-11-25
// @description  No light-blue flashes while the game resizes
// ==/UserScript==

// =====================================================================================================
// Smooth resizing
//
// While the game's picture changes size (the browser window dragged, a phone turned, the Quicklinks panel
// sliding out), it flashes light blue. Why: the scene is drawn into a picture of the screen's size first
// (postfx.js PostFx, for its light shafts and reflections), and the screen shows that picture. A new size
// makes a new, empty one (PostFx.layout). Pixi then draws the screen at once, before the next frame has
// drawn the scene into it (pixi.js ResizePlugin: renderer.resize, then render), so the screen shows only its
// clear colour, the game's light blue (main.js: background 0x8fd3ff), until the next frame.
// This draws the scene into the new picture as soon as it's made, with what the last frame drew it with
// (the scene's lastPost), so the picture is never empty. Nothing else changes, and nothing goes to the server.
// Stop it with:  stopSmoothResize(), or untick it in Settings > Mods
// =====================================================================================================
const smoothResize = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { PostFx } = await mod('/src/postfx.js');

  window.stopSmoothResize?.(); // replace one already running

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
};

idleAnglerMods.define({
  id: 'smoothResize',
  order: 100,
  name: "Smooth resizing",
  desc: "No light-blue flashes while the game resizes: dragging the window, turning a phone, or Quicklinks sliding out",
  start: smoothResize,
  stop: 'stopSmoothResize',
});
