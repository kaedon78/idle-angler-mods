# idle-angler-mods

UI mods for [Idle Angler](https://idle-angler.onrender.com/). Each script runs in your own browser on the
game's page. They only change how the game looks and what it shows you, and none of them changes the
game's state. Company Talk is the one that sends anything to the server, and only a company chat line
when you press an emote.

Every mod comes as a script of its own, so you can install just the ones you want. Each one works by itself,
and any mix of them shares one **Mods** tab in the game's Settings window (Esc). There, each mod can be
turned on or off and its options set. A change takes effect at once and is remembered in this browser.

The scripts are in [`scripts/`](scripts):

| Script | What it does |
| --- | --- |
| [`idle-angler-mods.user.js`](scripts/idle-angler-mods.user.js) | **All the UI mods below in one script** (every one from Zone map to Spots on time) |
| [`idle-angler-zone-map.user.js`](scripts/idle-angler-zone-map.user.js) | Zone map strip: every place in the world under the top bar; click one to go there |
| [`idle-angler-income-pills.user.js`](scripts/idle-angler-income-pills.user.js) | Income pills: measured gold, fish, chests and XP a minute |
| [`idle-angler-auto-click.user.js`](scripts/idle-angler-auto-click.user.js) | Auto-click: clicks the water for you, 1-15 times a second |
| [`idle-angler-build-switcher.user.js`](scripts/idle-angler-build-switcher.user.js) | Build switcher: press 1-5 to put on a saved gear set |
| [`idle-angler-weather-forecast.user.js`](scripts/idle-angler-weather-forecast.user.js) | Weather forecast: click the time and weather in the top bar, or press W |
| [`idle-angler-gear-judge.user.js`](scripts/idle-angler-gear-judge.user.js) | Gear judge: ▲ / ▼ on gear judged over a whole day of weather |
| [`idle-angler-quicklinks.user.js`](scripts/idle-angler-quicklinks.user.js) | Quicklinks: a sidebar on the right edge with what most needs you right now |
| [`idle-angler-left-layout.user.js`](scripts/idle-angler-left-layout.user.js) | Left-hand layout: the sidebar and windows on the left |
| [`idle-angler-stacked-names.user.js`](scripts/idle-angler-stacked-names.user.js) | Stacked names: overlapping names on the water stack in a column, with rank badges |
| [`idle-angler-company-online.user.js`](scripts/idle-angler-company-online.user.js) | Company online: a green dot by each company member online now |
| [`idle-angler-smooth-resize.user.js`](scripts/idle-angler-smooth-resize.user.js) | Smooth resizing: no light-blue flashes while the game resizes |
| [`idle-angler-fog-to-edge.user.js`](scripts/idle-angler-fog-to-edge.user.js) | Fog to the edge: in fog the haze covers the whole screen |
| [`idle-angler-spots-on-time.user.js`](scripts/idle-angler-spots-on-time.user.js) | Spots on time: a new fishing spot fades in when it appears |
| [`idle-angler-waves.user.js`](scripts/idle-angler-waves.user.js) | Waves: rolling waves, a far sea, boats in the water, hotspot buoys, lantern gauges |
| [`idle-angler-company-talk.user.js`](scripts/idle-angler-company-talk.user.js) | Company Talk: speech bubbles and emotes over your company's anglers |
| [`idle-angler-perf.user.js`](scripts/idle-angler-perf.user.js) | Performance: lower CPU use for computers without graphics acceleration |

Waves, Company Talk and Performance aren't in the all-in-one script; add them on their own. Load any mix: a
mod in two of your scripts (say, the all-in-one and Zone map on its own) still runs once.

## Running the scripts

You need a desktop browser (Chrome, Edge or Firefox) and an Idle Angler account. There are two ways to
load a script.

### With Tampermonkey (loads every time you open the game)

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension. In Chrome and Edge, also allow it
   to run scripts: turn on **Developer mode** on the extensions page (`chrome://extensions`), or
   **Allow User Scripts** in Tampermonkey's extension details, whichever your browser version asks for.
2. Add a script: open it on GitHub, click **Raw**, and Tampermonkey offers to install it. Click **Install**.
   Repeat for each script you want.
3. Open <https://idle-angler.onrender.com/> and sign in. Each script carries
   `@match https://idle-angler.onrender.com/`, so it runs only on the game's page. The mods wait for the
   game to finish loading, then start.

To update a script, reinstall it from **Raw**. If you used the old `idle-angler-mods.js` (pasted into a new
Tampermonkey script), delete that one and install `idle-angler-mods.user.js` instead. Your choices in the Mods
tab carry over.

### From the DevTools console (this visit only)

1. Open the game and sign in, and wait until it's running.
2. Open DevTools (F12) and go to the **Console** tab. Chrome asks you to type `allow pasting` the first
   time.
3. Paste the whole script and press Enter.

Pasting a script again replaces the mods it carries. A reload removes every pasted script.

### Turning mods off

Untick a mod in **Settings > Mods**, and it stays off next time too. To remove a mod for good, disable or
delete its script in Tampermonkey. In the console, `stopIdleAnglerMods()` stops every mod and removes the Mods
tab until the page is reloaded.

## The mods

### The UI mods (`idle-angler-mods.user.js`, or each on its own)

- **Zone map strip:** every place in the world in a strip under the top bar, with your species mastery,
  weather-only fish biting now and what a locked water needs. Click a place to go there.
- **Income pills:** measured gold, fish, chests and XP a minute, at the top of Quicklinks (or in the top bar
  without it). How long they measure over is set in Settings > Mods.
- **Auto-click:** clicks the water 1-15 times a second. Its toggle and − / + are under it in Settings > Mods.
- **Build switcher:** press 1-5 to put on a saved gear set.
- **Weather forecast:** click the time and weather in the top bar, or press W.
- **Gear judge:** ▲ / ▼ on gear, judged over a whole day of weather or the time and weather you pick.
- **Quicklinks:** a sidebar on the right edge, with a panel of what most needs you right now. It shows the
  Income pills, the forecast, the Gear judge's picks and the build keys when those mods are on too.
- **Left-hand layout:** the sidebar on the left, windows sliding out from there, no pages in Upgrades and
  Perks.
- **Stacked names:** names on the water that would overlap stack in a column by gold leaderboard rank,
  with rank badges.
- **Company online:** a green dot by each company member online now, in the Company window.
- **Smooth resizing:** no light-blue frames while the game resizes.
- **Fog to the edge:** in fog the haze covers the whole screen.
- **Spots on time:** a new fishing spot fades in when it appears, even on a device whose clock is behind.

### Waves (`idle-angler-waves.user.js`)

- **Waves:** rolling swells that come in from the open sea. None inland (Pond, River, Lake), building
  from the Coast to the biggest in the Open Ocean, then calming to still water in the Cosmic Void. Storms,
  rain, fog and snow change their size and roughness, and the biggest crests break into foam and spray.
- **Far sea:** rows of smaller waves out to the horizon, with parallax.
- **Reflections** follow the moving surface.
- **Boats sit in the water:** every boat, yours and other players', sits partly under the surface and
  pitches with the swell.
- **Hotspot buoys:** each spot's buoy rides the waves and flies a flag with its bonus and an icon for its
  type, in place of the long label. The flag is raised while you're fishing that spot. At night the buoy's
  lamp glows and the flag stays readable.
- **Lantern gauges:** a second lantern on the stern. The two lanterns fill with the bite wait and the
  Frenzy, in place of the game's bars.

Boats in the water, hotspot buoys and lantern gauges can each be switched off under Waves in Settings > Mods.

It needs the game's **shaders** on (Settings), the same as the game's own ripples and reflections; with
them off the water and boats are the game's own. A **Waves** tab on the left opens a test panel to try
different sea sizes (time of day and weather controls appear there only on a local test copy of the
game). In the console, `waves.panel = false` hides it, and `waves.force = 0.8` tries a wave size anywhere
(`waves.force = null` goes back to normal).

### Company Talk (`idle-angler-company-talk.user.js`)

A prototype of anglers talking on the water. Every company chat line, from anyone in your company with
the script or without it, pops up as a speech bubble over that angler, if they're on the water in your
zone. An emote bar above the chat button sends emotes as short chat lines such as `*waves*`: players
without the script read them as ordinary chat, and players with it see a bubble with the emote's icon.
Emotes have a 4-second cooldown, and the game's chat rate limit applies.

### Performance (`idle-angler-perf.user.js`)

For computers with no graphics acceleration, where the browser draws the game on the CPU.

- **Frame cap** (30 by default): the game's clock runs on elapsed time, so fishing, sailing and timers
  keep their speed.
- **Lighter blurs** for the fog and the lantern bloom: the same spread in fewer passes.
- **Meter:** a chip by the online player count shows frames a second; click it for the settings and the
  renderer the game ended up on.

Each part can be switched off on its own, and the settings are remembered in this browser.

## Changing the mods

The scripts in `scripts/` are built: don't edit them. Each mod's source is in [`src/mods/`](src/mods), the
shared runtime (the Mods tab, and starting the mods once the game is up) in [`src/runtime.js`](src/runtime.js),
and parts that more than one mod uses in [`src/shared/`](src/shared). After a change, bump the source's
`@version` and run (Node 18 or newer):

```
node build.mjs
```

`node build.mjs --check` only checks that `scripts/` matches `src/`. A new mod is a file in `src/mods/` that
ends with `idleAnglerMods.define({ ... })` (see the top of `src/runtime.js` for what that takes), listed in
`build.mjs`.
