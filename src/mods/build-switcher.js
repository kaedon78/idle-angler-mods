// ==UserScript==
// @name         Idle Angler Build Switcher
// @version      2026-11-25
// @description  Press 1-5 to put on a saved gear set
// ==/UserScript==

// =====================================================================================================
// Build switcher (was build-switcher.js)
//
// Press 1-5 anywhere in the game (not while typing in chat or a box) to put on one of your saved
// builds (the game's gear sets, Angler > Character: up to 5, each with its stat priorities). A toast
// says which went on. Quicklinks shows the number key on each build's button.
// Putting a build on is the game's own "put this set on" (the same as clicking the set in Angler >
// Character): every piece you still have goes on, and its stat priorities come back with it.
// Stop it (and the keys) with:  stopBuildSwitcher(), or untick it in Settings > Mods
// =====================================================================================================
const buildSwitcher = async () => {
  const mod = (path) => import(new URL(path, location.origin).href);
  const S = await mod('/src/state.js');
  const { act } = await mod('/src/actions.js');
  const { GEAR_SETS } = await mod('/src/data.js');
  const { toast } = await mod('/src/ui.js');
  const MAX = GEAR_SETS?.max ?? 5;

  window.stopBuildSwitcher?.(); // replace one already running

  // ---------- Putting a build on ----------
  let busy = false;
  const wear = async (i) => {
    const set = S.state.gearSets?.[i];
    if (!set) return toast(`No build ${i + 1} saved yet (save one in Angler > Character)`, true);
    if (busy) return;
    busy = true;
    try {
      const n = await act(S.game, 'equipGearSet', { index: i });
      if (!n) toast("None of that build's gear is in your bag any more (or you can't wear it yet)", true);
      else toast(`Build ${i + 1}: ${set.name}`);
    } finally {
      busy = false;
    }
  };

  // ---------- Hotkeys ----------
  // 1-5 put a build on. Not while typing, with a dialog up, or with Ctrl / Alt / Cmd held.
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.getElementById('modal-root')?.firstElementChild) return;
    const d = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    if (!d || Number(d) > MAX) return;
    e.preventDefault();
    if (e.repeat) return;
    wear(Number(d) - 1);
  };
  window.addEventListener('keydown', onKey, true);

  window.buildSwitcherKeys = MAX; // Quicklinks shows a key on each build while this runs
  window.stopBuildSwitcher = () => {
    window.removeEventListener('keydown', onKey, true);
    delete window.buildSwitcherKeys;
    delete window.stopBuildSwitcher;
  };
};

idleAnglerMods.define({
  id: 'buildSwitcher',
  order: 30,
  name: "Build switcher",
  desc: "Press 1-5 to put on one of your saved gear sets (Quicklinks shows each one's key)",
  start: buildSwitcher,
  stop: 'stopBuildSwitcher',
});
