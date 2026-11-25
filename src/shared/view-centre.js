// @version      2026-11-25
// =====================================================================================================
// Shared by Quicklinks and the Left-hand layout: the camera and the big announcements centre on the part of
// the scene you can see
//
// Out on the water the game's camera keeps your angler in the middle of the scene (scene.js followBoat), and
// the big announcement for a rare catch ("Legendary!", scene.js announce) shows there too. With a side panel
// out, these two keep the scene at its full size (so the game never lays it out again), and part of it is
// under the panel or past the edge of the screen: the middle of the scene isn't the middle of what you see,
// and the bigger the screen, the further off it is. While either of them is on, both aim for the middle of
// the part you see instead (the camera easing over as it always does). Where the game's camera doesn't
// follow the boat (moored at the Pond's pier, the cabin framed) it stays put. It only moves what you see:
// nothing goes to the server.
// One for the page (kept on window), so two scripts that carry this don't wrap the game's methods twice.
// =====================================================================================================
const viewCentre = window.idleAnglerViewCentre ??= (() => {
  const users = new Set();
  const AIMED = ['followBoat', 'announce']; // the game's methods that aim for the middle of the screen
  let proto = null, originals = null, probe = null, observer = null;
  let share = 0.5; // where the middle of what you see is, as a share of the scene's width (the game's: half)
  let stale = true;
  const mark = () => { stale = true; };
  // The part you see once the panels have finished sliding runs from the left panel's edge (--ll-push) to
  // the right one's (--qs-push): the probe sits there, with no transition. The scene's left edge is always
  // at the left end of it (the page moves over by as much), so the middle is half its width in
  const measure = () => {
    stale = false;
    const seen = probe.getBoundingClientRect().width;
    const whole = document.getElementById('game')?.clientWidth || innerWidth;
    share = seen > 0 && whole > 0 ? Math.min(0.5, seen / 2 / whole) : 0.5;
  };
  // Each of these aims at the middle of the screen as L.SW / 2, and reads L.SW for nothing else: for the one
  // call, the screen is made twice as wide as the middle of the part you see
  const aimed = (original) => function (...args) {
    if (stale) measure();
    const L = this.L;
    if (!L || share >= 0.5) return original.apply(this, args);
    const sw = L.SW;
    L.SW = sw * share * 2;
    try { return original.apply(this, args); } finally { L.SW = sw; }
  };
  const install = async () => {
    const { FishingScene } = await import(new URL('/src/scene.js', location.origin).href);
    if (!users.size || proto) return; // turned off while the game's file loaded, or already on
    proto = FishingScene.prototype;
    originals = {};
    for (const name of AIMED) {
      originals[name] = proto[name];
      proto[name] = aimed(originals[name]);
    }
    probe = document.createElement('div');
    probe.id = 'ia-view-probe';
    probe.style.cssText = 'position:fixed;top:0;height:0;left:var(--ll-push,0px);right:var(--qs-push,0px);visibility:hidden;pointer-events:none';
    document.body.append(probe);
    // The panels open and close with the page's classes (ll-open, qs-open), and the screen can change size
    observer = new MutationObserver(mark);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', mark);
    stale = true;
  };
  return {
    add(id) {
      users.add(id);
      stale = true;
      if (!proto) install().catch((e) => console.warn('[view centre] The view stays as the game has it:', e));
    },
    remove(id) {
      users.delete(id);
      stale = true;
      if (users.size || !proto) return;
      for (const name of AIMED) proto[name] = originals[name];
      observer.disconnect();
      removeEventListener('resize', mark);
      probe.remove();
      proto = originals = probe = observer = null;
      share = 0.5;
    },
    get share() { return share; }, // for the console: where the middle of what you see is (0.5 = the game's)
  };
})();
