// Idle Angler — compact catch text.
// Paste into the DevTools console on https://idle-angler.onrender.com/ once the game is running. The
// text that rises from the bobber after each cast becomes one line per catch instead of three or four:
//    [mutations] Name  price  New!
//  - the name keeps its rarity colour (the rarity's name and the weight are dropped)
//  - mutations go in front of the name, still shimmering in their colour
//  - the price follows: "+1.2k" when it was sold right away, "1.2k" when it went into your bag;
//    gear that went into your bags and chests show no price
//  - "New!" marks a species you hadn't caught before
//  - the XP line is dropped (the XP bar still shows it); "+N more" stays
// Legendary-or-better finds keep their big title lettering, the beam and the announcement.
// Turn it off with:  stopCompactCatch()

(() => {
  window.stopCompactCatch?.(); // replace one already running

  const hud = document.getElementById('scene-hud') ?? document.querySelector('.hud-where')?.parentElement;
  if (!hud) return console.warn('[compact catch] The game scene was not found (#scene-hud)');

  const style = document.createElement('style');
  style.id = 'cc-style';
  style.textContent = `
.catch-float.cc{gap:2px}
.catch-float.cc .cc-line{display:flex;align-items:baseline;justify-content:center;gap:.4em;text-shadow:1px 1px 0 #000,0 0 3px rgba(0,0,0,.8)}
.catch-float.cc .cc-line > *{display:inline-block}
.catch-float.cc .cf-mut{font-size:calc(13px * var(--ui-scale))}
.catch-float.cc .cf-gold{font-size:calc(14px * var(--ui-scale))}
.catch-float.cc .cc-new{padding:0 4px;font-weight:700;font-size:calc(11px * var(--ui-scale));color:#10200a;background:#86efac;text-shadow:none}
.catch-float.cc .cc-more{font-size:calc(12px * var(--ui-scale));color:#d5dcc4}
`;
  document.head.append(style);

  // The game's catch text is name, [mutations], sub line, [price] for each catch (up to 3), then
  // optional "+N more" and "+XP" lines. Rebuild it as one line per catch.
  function compact(node) {
    if (node.classList.contains('cc')) return;
    const entries = [];
    let more = null;
    let cur = null;
    for (const child of [...node.children]) {
      const c = child.classList;
      if (c.contains('cf-name')) entries.push((cur = { name: child }));
      else if (c.contains('cf-mut') && cur) cur.mut = child;
      else if (c.contains('cf-gold') && cur) cur.gold = child;
      else if (c.contains('cf-sub')) {
        if (c.contains('xp-text')) continue;
        if (cur && !cur.sub) cur.sub = child;
        else if (/^\+\d+ more$/.test(child.textContent.trim())) more = child;
      }
    }
    if (!entries.length) return; // not the layout this expects: leave it alone
    const lines = entries.map((e) => {
      const line = document.createElement('div');
      line.className = 'cc-line';
      if (e.mut) line.append(e.mut);
      line.append(e.name);
      if (e.gold) {
        // "Sold +1.2k" / "Auto-sold +1.2k" become "+1.2k"; "Into your bags" goes
        const text = e.gold.textContent.trim();
        if (/^Into your bags/i.test(text)) e.gold = null;
        else {
          for (const n of [...e.gold.childNodes]) {
            if (n.nodeType === Node.TEXT_NODE) n.textContent = n.textContent.replace(/^\s*(Auto-)?sold\s*/i, '');
          }
          line.append(e.gold);
        }
      }
      if (/New species!/.test(e.sub?.textContent ?? '')) {
        const tag = document.createElement('span');
        tag.className = 'cc-new';
        tag.textContent = 'New!';
        tag.title = e.sub.textContent.split('·').pop().trim(); // "New species! +N Power"
        line.append(tag);
      }
      return line;
    });
    if (more) {
      more.className = 'cc-more';
      lines.push(more);
    }
    node.replaceChildren(...lines);
    node.classList.add('cc');
  }

  // The game adds the text and fills it in the same moment; this runs right after, before it's drawn
  const observer = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('catch-float')) compact(n);
  });
  observer.observe(hud, { childList: true });
  hud.querySelectorAll('.catch-float').forEach(compact);

  window.stopCompactCatch = () => {
    observer.disconnect();
    style.remove();
    delete window.stopCompactCatch;
  };
  console.log('[compact catch] On: one line per catch. Turn it off with stopCompactCatch()');
})();
