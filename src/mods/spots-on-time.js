// ==UserScript==
// @name         Idle Angler Spots on Time
// @version      2026-11-25
// @description  A new fishing spot fades in when it appears, even on a device whose clock is behind
// ==/UserScript==

// =====================================================================================================
// Spots on time
//
// A new fishing spot can count ("On a School of fish" under the timers, and the bonus) seconds before its
// ring shows on the water. Why: the server stamps a spot with when it appeared and when it ends, by the
// server's clock, but the ring's fade (scene.js drawSpots: in over 3 s from `at`, out over the last 8 s
// before `until`) is worked out from this device's clock (Date.now). When that clock is behind the
// server's, the ring stays invisible until it catches up, and only then starts its 3 s fade; the game
// keeps the boat on the server's clock for this reason (state.js seaNow), but not the spots.
// This draws the spots by the server's clock (world.js serverNow, which the game sets from the server's
// time when it connects), so a new spot starts fading in as soon as it arrives. The fade itself is the
// game's own. Nothing else changes, and nothing goes to the server.
// Stop it with:  stopSpotsOnTime(), or untick it in Settings > Mods
// =====================================================================================================
const spotsOnTime = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const { FishingScene } = await mod('/src/scene.js');
  const { serverNow } = await mod('/src/world.js');

  window.stopSpotsOnTime?.(); // replace one already running

  const proto = FishingScene.prototype;
  const original = proto.drawSpots;
  const realNow = Date.now;
  proto.drawSpots = function (...args) {
    const ahead = serverNow() - realNow.call(Date); // how far the server's clock is ahead of this device's
    if (!ahead) return original.apply(this, args);
    // drawSpots reads the time once, from Date.now: for this call only, that's the server's time
    Date.now = () => realNow.call(Date) + ahead;
    try { return original.apply(this, args); } finally { Date.now = realNow; }
  };

  window.stopSpotsOnTime = () => {
    if (proto.drawSpots !== original) proto.drawSpots = original;
    delete window.stopSpotsOnTime;
  };
  console.log('[spots on time] On: fishing spots fade in by the server’s clock. Turn it off with stopSpotsOnTime()');
};

idleAnglerMods.define({
  id: 'spotsOnTime',
  order: 120,
  name: "Spots on time",
  desc: "A new fishing spot fades in as soon as it appears, instead of seconds after the game already counts it when this device's clock is behind the server's",
  start: spotsOnTime,
  stop: 'stopSpotsOnTime',
});
