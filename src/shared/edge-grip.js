// @version      2026-11-25.1
// =====================================================================================================
// Shared by Quicklinks and the Left-hand layout: a grip on a docked panel's inner edge that resizes it
//
// Each panel's width is a CSS variable on the page (Quicklinks --qs-w, the left slideout --ll-w) that the page,
// the scene and the camera's centre already follow, so the grip only sets that variable. The grip is its own
// element on the page, not part of the panel (the game redraws its windows' insides), held on the panel's edge
// by the same variable and shown only while the panel is out (`openClass` on the body).
// Drag it, or focus it and press ← / →. Let go and the width is remembered in this browser (`key`); a double
// click forgets it and goes back to the panel's usual width (`onReset`). While dragging, the page's slide
// transitions are off, so everything follows the pointer, and the game is told of the resize each frame (it
// measures its play area on resize). The width is capped to a share of the window (`max`) as the window shrinks
// too, and a drag stops KEEP px short of a panel out on the other side, so the scene is never squeezed away
// between them. Nothing goes to the server.
// =====================================================================================================
function edgeGrip({ id, edge, openClass, cssVar, key, min, max, label, onSize = () => {}, onReset = () => {} }) {
  document.getElementById(id)?.remove();
  document.getElementById(`${id}-style`)?.remove();
  const root = document.documentElement;
  const STEP = 16; // px a key press moves it
  const KEEP = 400; // px of the scene kept between this panel and one out on the other side
  // How wide it can go: up to the other side's grip (the other panel's edge), less KEEP, if that one is out
  const room = () => {
    const other = [...document.querySelectorAll('.ia-grip')].find((g) => g.dataset.edge !== edge && getComputedStyle(g).display !== 'none');
    if (!other) return Infinity;
    const r = other.getBoundingClientRect();
    const x = r.left + r.width / 2;
    return (edge === 'left' ? x : innerWidth - x) - KEEP;
  };
  const clamp = (w) => Math.round(Math.max(min, Math.min(innerWidth * max, room(), w)));
  const apply = (w) => {
    root.style.setProperty(cssVar, `min(${w}px, ${max * 100}vw)`);
    onSize(w);
  };
  let size = null; // the width set with the grip (px), or null: the panel's own
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved >= min) size = saved;
  } catch {
    // storage blocked: the usual width
  }
  if (size) apply(size);

  const style = document.createElement('style');
  style.id = `${id}-style`;
  // The grip straddles the panel's edge: 10px to catch, a 2px line in the middle while hovered or dragged
  const at = edge === 'left' ? `left:calc(var(${cssVar}) - 5px)` : `right:calc(var(${cssVar}) - 5px)`;
  style.textContent = `
#${id}{position:fixed;${at};top:44px;bottom:0;width:10px;z-index:900;display:none;cursor:ew-resize;touch-action:none;
  background:linear-gradient(90deg,transparent 4px,var(--ia-grip,transparent) 4px,var(--ia-grip,transparent) 6px,transparent 6px)}
body.${openClass} #${id}{display:block}
#${id}:hover,#${id}:focus-visible,body.ia-grip-drag #${id}{--ia-grip:rgba(253,230,138,.55);outline:none}
body.ia-grip-drag,body.ia-grip-drag *{transition:none !important;animation:none !important;cursor:ew-resize !important;user-select:none !important}`;
  document.head.append(style);

  const grip = document.createElement('div');
  grip.id = id;
  grip.className = 'ia-grip';
  grip.dataset.edge = edge;
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', `Width of ${label}`);
  grip.title = `Drag to change the width of ${label} (← / → too). Double-click for its usual width.`;
  document.body.append(grip);

  // The game measures its play area on resize: once a frame at most while the width changes
  let frame = 0;
  const tellGame = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      dispatchEvent(new Event('resize'));
    });
  };
  const save = () => {
    try {
      if (size) localStorage.setItem(key, String(size));
      else localStorage.removeItem(key);
    } catch {
      // storage blocked: the width lasts until the page reloads
    }
  };
  const set = (w) => {
    size = clamp(w);
    apply(size);
    tellGame();
  };
  const widthAt = (x) => (edge === 'left' ? x : innerWidth - x);

  let dragging = null; // the pointer's id
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = e.pointerId;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('ia-grip-drag');
  });
  grip.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragging) set(widthAt(e.clientX));
  });
  const end = (e) => {
    if (e.pointerId !== dragging) return;
    dragging = null;
    document.body.classList.remove('ia-grip-drag');
    save();
    dispatchEvent(new Event('resize'));
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => {
    size = null;
    save();
    root.style.removeProperty(cssVar);
    onReset();
    dispatchEvent(new Event('resize'));
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation(); // not the game's hotkeys
    const r = grip.getBoundingClientRect();
    const now = size ?? widthAt(r.left + r.width / 2); // (the grip's middle is the panel's edge)
    const wider = (e.key === 'ArrowRight') === (edge === 'left');
    set(now + (wider ? STEP : -STEP));
    save();
  });

  return {
    get size() { return size; }, // the width set with the grip (px), or null
    remove() {
      cancelAnimationFrame(frame);
      document.body.classList.remove('ia-grip-drag');
      grip.remove();
      style.remove();
    },
  };
}
