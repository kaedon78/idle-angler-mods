# idle-angler-mods

UI mods for [Idle Angler](https://idle-angler.onrender.com/). Each script runs in your own browser on the
game's page. They only change how the game looks and what it shows you, and none of them changes the
game's state. Company Talk is the one that sends anything to the server, and only a company chat line
when you press an emote.

| Script | What it does | Stands alone |
| --- | --- | --- |
| [`idle-angler-mods.js`](idle-angler-mods.js) | The main bundle: twelve UI mods, each switched on or off in the game's Settings | yes |
| [`idle-angler-waves.user.js`](idle-angler-waves.user.js) | Rolling waves, a far sea to the horizon, boats sitting in the water, hotspot buoys with flags, lantern gauges | yes |
| [`idle-angler-company-talk.user.js`](idle-angler-company-talk.user.js) | Speech bubbles and emotes over your company's anglers, carried by company chat | yes |
| [`idle-angler-perf.user.js`](idle-angler-perf.user.js) | Lower CPU use for computers without graphics acceleration | yes |
| [`idle-angler-smooth-resize.user.js`](idle-angler-smooth-resize.user.js) | No light-blue flashes while the game resizes (also part of the main bundle) | yes |

Every script works on its own; load any mix of them.

## Running the scripts

You need a desktop browser (Chrome, Edge or Firefox) and an Idle Angler account. There are two ways to
load a script.

### With Tampermonkey (loads every time you open the game)

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension. In Chrome and Edge, also allow it
   to run scripts: turn on **Developer mode** on the extensions page (`chrome://extensions`), or
   **Allow User Scripts** in Tampermonkey's extension details, whichever your browser version asks for.
2. Add a script:
   - **The `.user.js` scripts:** open the file on GitHub, click **Raw**, and Tampermonkey offers to install
     it. Click **Install**.
   - **`idle-angler-mods.js`:** Tampermonkey doesn't offer to install a file not named `.user.js`, so open
     the Tampermonkey dashboard, click **+** (create a new script), replace the template with the whole
     file, and save (Ctrl+S).
3. Open <https://idle-angler.onrender.com/> and sign in. Each script carries
   `@match https://idle-angler.onrender.com/`, so it runs only on the game's page.

**Sign in first.** Company Talk checks who you are once, when it starts; if it starts on the sign-in
screen it logs `[company talk] Not signed in` and stops. Reload the page once you're signed in. The main
bundle waits for the game to finish loading by itself.

To update a script, reinstall it from **Raw** (or paste the new file over the old one in the dashboard).

### From the DevTools console (this visit only)

1. Open the game and sign in, and wait until it's running.
2. Open DevTools (F12) and go to the **Console** tab. Chrome asks you to type `allow pasting` the first
   time.
3. Paste the whole script and press Enter.

Pasting a script again replaces the copy that's running. A reload removes every pasted script.

### Turning a script off

Disable it in Tampermonkey and reload, or stop it in the console without reloading:

| Script | Console command |
| --- | --- |
| Mods | `stopIdleAnglerMods()` |
| Waves | `stopWaves()` |
| Company Talk | `stopCompanyTalk()` |
| Performance | `stopIdleAnglerPerf()` |
| Smooth Resizing | `stopSmoothResize()` |

## The mods

### Idle Angler Mods (`idle-angler-mods.js`)

Adds a **Mods** tab to the game's Settings window (Esc), where each mod can be turned on or off. A change
takes effect at once and is remembered in this browser.

- **Zone map strip:** every place in the world in a strip under the top bar, with your species mastery,
  weather-only fish biting now and what a locked water needs. Click a place to go there.
- **Income pills and auto-click:** measured gold, fish, chests and XP a minute; Auto-click at 1-15 clicks
  a second (set in Settings > Mods).
- **Build switcher:** press 1-5 to put on a saved gear set.
- **Weather forecast:** click the time and weather in the top bar, or press W.
- **Gear judge:** ▲ / ▼ on gear, judged over a whole day of weather or the time and weather you pick.
- **Quicklinks:** a sidebar on the right edge, with a panel of what most needs you right now.
- **Left-hand layout:** the sidebar on the left, windows sliding out from there, no pages in Upgrades and
  Perks.
- **Stacked names:** names on the water that would overlap stack in a column by gold leaderboard rank,
  with rank badges.
- **Company online:** a green dot by each company member online now, in the Company window.
- **Smooth resizing:** no light-blue frames while the game resizes.
- **Fog to the edge:** in fog the haze covers the whole screen.
- **Spots on time:** a new fishing spot fades in when it appears, even on a device whose clock is behind.

### Idle Angler Waves (`idle-angler-waves.user.js`)

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

It needs the game's **shaders** on (Settings), the same as the game's own ripples and reflections; with
them off the water and boats are the game's own. A **Waves** tab on the left opens a test panel to try
different sea sizes (time of day and weather controls appear there only on a local test copy of the
game). In the console, `waves.panel = false` hides it, and `waves.force = 0.8` tries a wave size anywhere
(`waves.force = null` goes back to normal).

### Idle Angler Company Talk (`idle-angler-company-talk.user.js`)

A prototype of anglers talking on the water. Every company chat line, from anyone in your company with
the script or without it, pops up as a speech bubble over that angler, if they're on the water in your
zone. An emote bar above the chat button sends emotes as short chat lines such as `*waves*`: players
without the script read them as ordinary chat, and players with it see a bubble with the emote's icon.
Emotes have a 4-second cooldown, and the game's chat rate limit applies.

### Idle Angler Performance (`idle-angler-perf.user.js`)

For computers with no graphics acceleration, where the browser draws the game on the CPU.

- **Frame cap** (30 by default): the game's clock runs on elapsed time, so fishing, sailing and timers
  keep their speed.
- **Lighter blurs** for the fog and the lantern bloom: the same spread in fewer passes.
- **Meter:** a chip by the online player count shows frames a second; click it for the settings and the
  renderer the game ended up on.

Each part can be switched off on its own, and the settings are remembered in this browser.

### Idle Angler Smooth Resizing (`idle-angler-smooth-resize.user.js`)

Stops the light-blue flash while the game's picture changes size (a window dragged, a phone turned, a
side panel sliding out). This is the same fix as the main bundle's Smooth resizing mod, for anyone who
wants only this one. With both loaded, the fix runs once.
