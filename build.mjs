// Builds the scripts players install (scripts/*.user.js) from src/:
//  - one script per mod: the mod with the runtime (src/runtime.js) and any shared parts it needs, so each one
//    works alone, and any mix of them shares one Mods tab in Settings
//  - idle-angler-mods.user.js: every mod marked `bundle` below in one script (the UI mods, as it always was)
//
//   node build.mjs           write scripts/
//   node build.mjs --check   only check that scripts/ matches src/ (exit code 1 if not)
//
// Edit src/, never scripts/. A source starts with a ==UserScript== block giving its @name, @version and
// @description (and @shared: the files of src/shared it needs); this adds the rest of the header. Bump a
// source's @version when it changes (a script's version is the newest of its parts'), so Tampermonkey sees the update.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'scripts');

// Every mod in src/mods, in the order the Mods tab lists them (each one's `order` decides when it starts)
const MODS = [
  { file: 'zone-map', bundle: true },
  { file: 'income-pills', bundle: true },
  { file: 'auto-click', bundle: true },
  { file: 'build-switcher', bundle: true },
  { file: 'weather-forecast', bundle: true },
  { file: 'gear-judge', bundle: true },
  { file: 'quicklinks', bundle: true },
  { file: 'left-layout', bundle: true },
  { file: 'stacked-names', bundle: true },
  { file: 'company-online', bundle: true },
  { file: 'smooth-resize', bundle: true },
  { file: 'fog-to-edge', bundle: true },
  { file: 'spots-on-time', bundle: true },
  { file: 'waves', bundle: false },
  { file: 'company-talk', bundle: false },
  { file: 'perf', bundle: false },
];
const BUNDLE = {
  name: 'Idle Angler Mods',
  out: 'idle-angler-mods.user.js',
  description: "Idle Angler's UI mods in one script, each switched on or off in the game's Settings > Mods",
};

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const trimLines = (s) => s.replace(/^\n+/, '').replace(/\s+$/, '');

// A source: its ==UserScript== block (if any), a `// @version` line (the runtime and shared parts), its leading
// comment and its code
function parse(text, where) {
  const meta = { shared: [] };
  const head = text.match(/^\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==\n/);
  if (head) {
    for (const line of head[1].split('\n')) {
      const m = line.match(/^\/\/ @(\w+)\s+(.*)$/);
      if (!m) continue;
      if (m[1] === 'shared') meta.shared.push(...m[2].trim().split(/\s+/));
      else meta[m[1]] = m[2].trim();
    }
    text = text.slice(head[0].length);
  }
  const version = text.match(/^\/\/ @version\s+(\S+)\n/);
  if (version) {
    meta.version = version[1];
    text = text.slice(version[0].length);
  }
  if (!meta.version) throw new Error(`${where}: no @version`);
  const lines = trimLines(text).split('\n');
  let n = 0;
  while (n < lines.length && (lines[n].startsWith('//') || lines[n].trim() === '')) n++;
  return { meta, lead: trimLines(lines.slice(0, n).join('\n')), code: trimLines(lines.slice(n).join('\n')) };
}

const header = ({ name, version, description }) => `// ==UserScript==
// @name         ${name}
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  ${description}
// @match        https://idle-angler.onrender.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=onrender.com
// @grant        none
// ==/UserScript==`;
const newest = (...versions) => versions.sort().at(-1);
const block = (...parts) => parts.filter((p) => p != null).join('\n'); // ('' is a blank line; null, nothing)

const runtime = parse(read('src', 'runtime.js'), 'src/runtime.js');
const shared = new Map(readdirSync(join(ROOT, 'src', 'shared')).filter((f) => f.endsWith('.js')).map((f) => [f.slice(0, -3), parse(read('src', 'shared', f), `src/shared/${f}`)]));
const mods = MODS.map((m) => ({ ...m, ...parse(read('src', 'mods', `${m.file}.js`), `src/mods/${m.file}.js`) }));
const unlisted = readdirSync(join(ROOT, 'src', 'mods')).filter((f) => f.endsWith('.js') && !MODS.some((m) => `${m.file}.js` === f));
if (unlisted.length) throw new Error(`Not in build.mjs MODS: ${unlisted.join(', ')}`);
for (const m of mods) {
  for (const s of m.meta.shared) if (!shared.has(s)) throw new Error(`src/mods/${m.file}.js: no src/shared/${s}.js`);
  for (const k of ['name', 'description']) if (!m.meta[k]) throw new Error(`src/mods/${m.file}.js: no @${k}`);
}
const sharedFor = (list) => [...shared.keys()].filter((k) => list.some((m) => m.meta.shared.includes(k)));
const partsCode = (names) => names.map((k) => block(shared.get(k).lead || null, shared.get(k).code));
const runtimeCode = block(runtime.lead || null, runtime.code);

const outputs = new Map(); // file name -> text
for (const m of mods) {
  const needs = sharedFor([m]);
  const version = newest(m.meta.version, runtime.meta.version, ...needs.map((k) => shared.get(k).meta.version));
  outputs.set(`idle-angler-${m.file}.user.js`, block(
    header({ ...m.meta, version }),
    '',
    `// Built by build.mjs from src/mods/${m.file}.js and the runtime: edit those, not this file.`,
    '//',
    m.lead || null,
    '',
    '(() => {',
    runtimeCode,
    '',
    ...partsCode(needs).flatMap((c) => [c, '']),
    '{',
    m.code,
    '}',
    '})();',
    '',
  ));
}
{
  const list = mods.filter((m) => m.bundle);
  const needs = sharedFor(list);
  const version = newest(runtime.meta.version, ...list.map((m) => m.meta.version), ...needs.map((k) => shared.get(k).meta.version));
  const intro = [
    "// Idle Angler — UI mods, all in one script. Each one also comes as a script of its own (scripts/), to load only",
    "// the ones you want; with this one too, a mod runs once. It adds a Mods tab to the game's Settings window (Esc),",
    "// where each mod is turned on or off; that takes effect at once and is remembered in this browser. The mods:",
    ...list.map((m) => `//  - ${m.meta.name.replace(/^Idle Angler /, '')}: ${m.meta.description}`),
    "// Load it with Tampermonkey, or paste it into the DevTools console on https://idle-angler.onrender.com/; it waits",
    "// for the game to be up. Pasting it again replaces the mods running. Stop everything (and remove the Mods tab) with:",
    '//   stopIdleAnglerMods()',
  ].join('\n');
  outputs.set(BUNDLE.out, block(
    header({ name: BUNDLE.name, version, description: BUNDLE.description }),
    '',
    '// Built by build.mjs from src/: edit those files, not this one.',
    '//',
    intro,
    '',
    '(() => {',
    runtimeCode,
    '',
    ...partsCode(needs).flatMap((c) => [c, '']),
    ...list.flatMap((m) => ['{', m.lead || null, m.code, '}', '']),
    '})();',
    '',
  ));
}

const check = process.argv.includes('--check');
const stale = [];
if (!check) mkdirSync(OUT, { recursive: true });
for (const [name, text] of outputs) {
  const path = join(OUT, name);
  const now = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
  if (now === text) continue;
  stale.push(name);
  if (!check) writeFileSync(path, text);
}
const extra = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.user.js') && !outputs.has(f)) : [];
if (check) {
  if (stale.length || extra.length) {
    console.error(`scripts/ is out of date: ${[...stale, ...extra.map((f) => `${f} (no source)`)].join(', ')}. Run node build.mjs`);
    process.exit(1);
  }
  console.log(`scripts/ is up to date (${outputs.size} scripts)`);
} else {
  console.log(`Wrote ${stale.length} of ${outputs.size} scripts to scripts/${stale.length ? `: ${stale.join(', ')}` : ''}`);
  if (extra.length) console.warn(`Not made from any source (delete them?): ${extra.join(', ')}`);
}
