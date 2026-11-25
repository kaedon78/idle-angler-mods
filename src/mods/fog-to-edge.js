// ==UserScript==
// @name         Idle Angler Fog to the Edge
// @version      2026-11-25
// @description  In fog the haze covers the whole screen
// ==/UserScript==

// =====================================================================================================
// Fog to the edge
//
// In fog (and the haze of rain, storms and the like) the haze stops a little behind your angler out on the
// water, and the left of the screen is clear. Why: the haze is drawn from the left edge of the screen as it
// is before the camera moves (atmosphere.js drawFog: from L.cut to the far edge of the world), but out on
// the water the camera pans right to bring your angler from a third of the way across to the middle
// (scene.js followBoat), and the world it brings in on the left, drawn for the camera to move into, has none.
// At 1920px wide in the Pond that's the left 665px, about 300px behind the angler.
// This adds the same haze over that strip (from the world's left end, x 0, to L.cut), after the game draws
// its own, so the haze covers all the world the camera can show. The drifting fog banks are left as they
// are. Nothing else changes, and nothing goes to the server.
// Stop it with:  stopFogToEdge(), or untick it in Settings > Mods
// =====================================================================================================
const fogToEdge = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { Atmosphere } = await mod('/src/atmosphere.js');

  window.stopFogToEdge?.(); // replace one already running

  const proto = Atmosphere.prototype;
  const original = proto.drawFog;
  proto.drawFog = function (...args) {
    const out = original.apply(this, args);
    const L = this.L;
    // The game's haze over the rest of the screen: its colour, at the alpha drawFog gives it (0.18), under
    // the same blur and fade (the fog layer's filters and alpha)
    if (this.fog?.visible && L?.cut > 0) this.fogShapes.rect(0, 0, L.cut, L.H).fill({ color: this.fogColor, alpha: 0.18 });
    return out;
  };

  window.stopFogToEdge = () => {
    if (proto.drawFog !== original) proto.drawFog = original;
    delete window.stopFogToEdge;
  };
  console.log('[fog to the edge] On: the haze covers the whole screen. Turn it off with stopFogToEdge()');
};

idleAnglerMods.define({
  id: 'fogToEdge',
  order: 110,
  name: "Fog to the edge",
  desc: "In fog the haze covers the whole screen, instead of stopping a little behind your angler out on the water",
  start: fogToEdge,
  stop: 'stopFogToEdge',
});
