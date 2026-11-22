# Steelreach — Design Brief v1

*Working name. Jacob can rename it.*

A phone-first factory-automation game in the spirit of Builderment. It replaces **Ironline**, the game built in the "Builderment mobile app" chat. It is a brand-new game with a fresh save, not a patch to Ironline.

---

## 1. Why this exists

Jacob played Ironline and enjoyed the idea, but it broke down in ways that made it unpleasant:

1. **Machines jammed.** Every machine was 1 tile, so it had 4 sides. One side was the output, which left only 3 input belts. Beacon Cores needed 4 ingredients, so one belt had to carry mixed items. An assembler stopped accepting an item once it held 2 batches of it. When that item reached the front of the belt, everything behind it waited forever. The only fix was to delete the assembler and place it again, which emptied its buffer.
2. **Belts couldn't cross.** There were no tunnels or bridges, and the only splitter was the "Router." The Router sprayed items to every neighbor, so it gave no control.
3. **Tiles were too small to tap** accurately on a phone.
4. **He ran out of room** on the 48×48 map.

He wants a game that is "far better." In his own picks, that means it should be:

- satisfying to **watch run**
- a real **layout puzzle**
- full of **steady unlocks**
- **polished**, with sound, animation, and smooth controls

### What success looks like
- He plays it over a few days, in a mix of quick check-ins and ~30-minute sessions, and reaches the last tier.
- No machine ever needs to be deleted and replaced to get it working again.
- Big factories still run smoothly on his phone.

### Goals
- Multi-tile machines with enough sides for 4-ingredient recipes.
- Belts that cross each other: tunnels and bridges.
- Directional splitters and mergers, plus storage boxes.
- A big map, about 160×160 (see §4.1).
- 12 tiers in about 5–8 hours of total play.
- An endgame built around reaching far regions of the map. Their ore is visible from the start and unlocks by tier.
- Power that arrives mid-game, around tier 5.
- A research tree, sound effects, and dark mode.
- Saves to his Claude account, with Continue / New game on open.
- True full screen on his iPhone through a Home Screen version (§3).

### Non-goals (explicitly not wanted)
- Music. Ironline's soundtrack is **not** carried over.
- Filter splitters. He didn't pick them.
- Offline or idle progress. The game **pauses when closed**.
- Enemies or pollution.
- Liquids or pipes. Oil is handled as an item (see §5).
- An app-store app. (A Home Screen web app *is* wanted; see §3.)
- Multiplayer.

### Anti-goals (it fails if any of these happen, even if it "works")
- Any situation where the fix for a stuck machine is to delete and replace it.
- Needing pixel-precise taps to place or fix things.
- The map feeling cramped by mid-game.
- Stuttering or lag on a phone once the factory is big.
- Losing progress.

---

## 2. Approaches considered

| # | Approach | Trade-off | Decision |
|---|---|---|---|
| 1 | **One self-contained web page drawn on a 2D canvas** (like Ironline). Written as separate source modules, tested headless in Node, then bundled into one HTML file and published as an artifact. | Proven to work on his phone. Uses the same account-save path as Ironline. Easy to test the factory logic in isolation. Needs care to stay fast with thousands of moving items. | **Chosen by Jacob.** |
| 2 | Same page, but drawn with a game graphics engine (WebGL, e.g. PixiJS bundled inline). | Smoother with very large item counts. Heavier file, more phone-browser risk. | Fallback only, if #1 can't hit the performance target (§10). |
| 3 | An installable app. | Much more setup, no real gain for him. | Rejected. |

---

## 3. Platform and constraints

- **Delivery:** a single HTML file (inline JS and CSS, no external requests) published as a Claude artifact. He opens it from a link on his phone.
- **Source layout:** plain ES modules in `src/` (sim, world, render, input, ui, save, audio). A small build script inlines them into `dist/index.html`. No framework.
- **Two builds from one source (Jacob's call):**
  1. **Claude link:** the artifact. It saves to his Claude account, opens in the Claude app or Safari, and the app's or browser's bars stay visible.
  2. **Home Screen version:** the same game hosted at its own address, set up as a web app (manifest, `apple-mobile-web-app-capable`, `display: standalone`, Home Screen icon, safe-area padding). Added to the iPhone Home Screen, it opens in **true full screen** with no browser bars. It saves **on the phone only**, since the Claude account save isn't available outside Claude. iPhones don't allow a full-screen API for web pages (only for video), so this is the only route to full screen.
  - **Hosting:** GitHub Pages from Jacob's repo **`Jacobt001/Steel_reach`**. Jacob is making it public, since free Pages needs a public repo and the game holds no private data. The source lives on `main` and the built site on the `gh-pages` branch.
  - **Save code:** both builds have **Copy save code / Load save code** in the Menu, so he can move progress between them. The code is a compact text string. Copy uses the clipboard from a button tap; Load uses a paste box.
  - **Focus mode (my call):** both builds have a button that hides the game's own top and bottom bars, leaving just the map and a small floating button to bring them back. This gives the most screen possible inside the Claude link too.
- **Primary device:** an **iPhone**, in portrait, with touch. Jacob uses both the Claude app and Safari. It must also work with a mouse on desktop, but touch comes first.
- **Look:** clean, flat, and minimal, in Builderment style like Ironline. Light and dark themes follow the phone's setting.
- **Pausing:** the simulation runs only while the page is visible. When it's hidden, nothing advances and there's no catch-up.
- **Saving (Claude link):** the account save uses the artifact runtime's data capability, the same pattern Ironline used (`window.claude.use('db')` and `use('user')`, with a per-user doc). **The builder must call `describe_capabilities` before writing the save code** to confirm the current API. Saves also mirror to `localStorage` as a fallback.

---

## 4. World

### 4.1 Map
- Fixed size of **160×160 tiles**, about 11× Ironline's area. Jacob confirmed this after hearing that ~4× would feel cramped with 2×2 and 3×3 machines.
- The **Hub** is a 4×4 block in the exact center (see §6.6).
- The whole map is buildable from the start. Belts and machines can go anywhere. Only certain **ores** are locked.
- **Belts only (Jacob's call):** every item reaches the Hub by belt. Nothing teleports. Hauling from far regions with long trunk lines, tunnels, and bridges *is* the late-game challenge, so belt tools (§9) and belt-speed research (§8.3) must make long hauls pleasant on a phone.
- Terrain is plain ground. There are no obstacles beyond ore patches and map edges. (Builder's call: a light decorative texture is fine.)

### 4.2 Rings and resources
The distance from the Hub defines rings. Every ring is fully visible from the start, and locked ores show a lock badge and the tier that unlocks them.

| Ring | Distance from center | New resource | Mineable from |
|---|---|---|---|
| 0 | 0–28 | Iron ore, copper ore, stone, coal | Tier 1 |
| 1 | 28–48 | Quartz, plus larger iron/copper/coal fields | Tier 5 (quartz) |
| 2 | 48–66 | Oil seeps | Tier 7 |
| 3 | 66–84 | Titanium ore | Tier 9 |
| 4 | 84+ (corners) | Uranium ore | Tier 11 |

- Basic ores (iron, copper, stone, coal) appear in every ring. Outer patches are **bigger and richer**, which rewards expanding outward.
- Ore is infinite. There is no depletion.
- World generation is seeded and deterministic, so the same seed always gives the same map. A new game picks a new seed.
- Ring 0 must have at least two patches of each basic ore within about 15 tiles of the Hub.

---

## 5. Items and recipes

This is a starting balance, and the builder will tune it (§8.2, §12). Times are in seconds at base speed.

**Raw:** iron ore, copper ore, stone, coal, quartz, crude oil, titanium ore, uranium ore.

| Item | Machine | Inputs → output | Time | Tier |
|---|---|---|---|---|
| Iron plate | Furnace | 1 iron ore → 1 | 1.6 | 1 |
| Copper plate | Furnace | 1 copper ore → 1 | 1.6 | 1 |
| Gear | Assembler | 2 iron plate → 1 | 1.0 | 2 |
| Wire | Assembler | 1 copper plate → 2 | 0.8 | 2 |
| Brick | Furnace | 2 stone → 1 | 2.0 | 3 |
| Circuit | Assembler | 1 iron plate + 3 wire → 1 | 2.0 | 3 |
| Steel | Assembler | 2 iron plate + 1 coal → 1 | 2.5 | 4 |
| Motor | Fabricator | 1 steel + 2 gear + 2 wire → 1 | 3.5 | 4 |
| Glass | Furnace | 2 quartz → 1 | 2.0 | 5 |
| Silicon | Foundry | 2 quartz + 1 coal → 1 | 3.0 | 5 |
| Frame | Assembler | 2 steel + 3 brick → 1 | 3.0 | 6 |
| Processor | Fabricator | 2 circuit + 1 silicon + 4 wire → 1 | 4.0 | 6 |
| Plastic | Refinery | 3 crude oil → 2 | 3.0 | 7 |
| Cable | Assembler | 2 wire + 1 plastic → 1 | 1.5 | 7 |
| Robot arm | Fabricator | 1 motor + 1 processor + 2 plastic + 1 steel → 1 | 6.0 | 8 |
| Titanium plate | Foundry | 2 titanium ore + 1 coal → 1 | 3.0 | 9 |
| Turbine | Fabricator | 3 titanium plate + 2 motor + 2 cable + 1 frame → 1 | 8.0 | 10 |
| Fuel cell | Fabricator | 4 uranium ore + 1 titanium plate + 1 glass + 1 processor → 1 | 8.0 | 11 |
| Fusion core | Fabricator | 2 fuel cell + 1 turbine + 1 robot arm + 2 processor → 1 | 15.0 | 12 |

Every item has a **distinct shape and color**, readable at small sizes and in both themes, as Ironline did.

---

## 6. Buildings

### 6.1 General rules for machines
- **Footprint:** a multi-tile footprint (sizes are in the table below). Machines are placed by tapping or dragging a ghost, and they don't rotate.
- **Inputs:** a machine takes items from:
  - any belt that **points into** one of its edge tiles, and
  - any belt that **runs past** an edge tile, parallel to the edge. This is **pass-by intake**: the machine grabs items it needs, and everything else keeps moving.
- **Never jams on mixed belts:** a machine accepts only the items its recipe uses. On a pass-by belt, unneeded items and items it's full of simply roll past. This is the fix for Ironline's core flaw.
- **Dead-end belts:** if a belt ends into a machine and its front item can't be used, that belt is **blocked**. It's shown with a red marker, and tapping it says why (e.g. "Furnace can't use Coal"). The cause is always visible, and the fix is to re-route the belt, never to delete the machine.
- **Buffers:** each ingredient normally buffers up to 2 batches, and output buffers up to 4 items.
- **No Ironline-style stall (my call):** a dead-end belt can have a usable item in front whose buffer is full while the machine waits on a different ingredient behind it. In that case the machine is **starved**, and a starved machine keeps accepting any ingredient it uses from a dead-end belt, beyond the normal cap, up to **99 per ingredient**. The extra stock is shown as "overstocked" and gets used up once the missing ingredient arrives. A true stall therefore needs 99 surplus items. Even then, the inspector names it ("40 Steel, waiting for Gear") and has a **Clear** button that throws away the machine's buffered items. Deleting a machine is never the fix.
- **Outputs:** a machine pushes output onto any belt that **starts at one of its edge tiles and points away from it**. With several output belts, it alternates between them.
- **Direct hand-off:** a machine also hands output directly to an **adjacent machine** whose recipe uses that item (e.g. Miner → Furnace touching). This keeps Ironline's handy miner-next-to-furnace setup.
- **Recipe choice:** the Assembler, Fabricator, and Foundry get their recipe from the build menu before placing, and it can be changed by tapping the machine. The Furnace has no recipe picker. It auto-detects its recipe from its first input, like Ironline. The Refinery has only one recipe.
- **Inspector:** tapping any machine shows its recipe, the buffer of each ingredient, its progress, its power state, and a plain status line ("Waiting for Wire", "Output full", "Low power: 60% speed").
- **Status icons:** these appear on the map, small and only when something is wrong: missing input, output full, no power.

| Building | Size | Unlocks | Power? | Notes |
|---|---|---|---|---|
| Miner | 2×2 | T1 | No | Must cover ≥1 ore tile of one type. Speed scales with ore tiles covered (1–4). Also extracts oil from seeps. |
| Furnace | 2×2 | T1 | No | 1-ingredient smelting recipes. |
| Assembler | 2×2 | T2 | No | Recipes with 1–2 ingredients. |
| Fabricator | 3×3 | T4 | No | Recipes with 3–4 ingredients. Has 12 edge tiles, so 4 inputs plus outputs fit easily. |
| Foundry | 2×2 | T5 | **Yes** | Alloys: silicon, titanium plate. |
| Refinery | 3×3 | T7 | **Yes** | Crude oil → plastic. |
| Generator | 2×2 | T5 | — | Burns coal (later fuel cells too; see §7). |
| Power pole | 1×1 | T5 | — | Extends the power network. |

**Power rule (my call):** only machines unlocked at **tier 5 or later** need power. Miners, furnaces, assemblers, and fabricators never do. This way his whole factory doesn't suddenly slow down the moment power unlocks.

### 6.2 Belts
- Belts are **single-lane** and carry **up to 4 items per tile**. Items move **smoothly and continuously**, not hopping tile to tile.
- Base speed is about **2 tiles per second**. Research raises it (§8).
- Items stay evenly spaced and queue up when blocked. A blocked belt backs up visibly, so you can see where things are stuck.
- Corners draw as curves.
- The simulation processes belts **downstream first**, with no recursion, so belt lines of 1,000+ tiles can't overflow the stack.

### 6.3 Tunnels
- A tunnel is an **entrance and exit pair** in a straight line, with a gap of **up to 4 tiles** (research raises it to 8).
- Anything can sit on the tiles between, including belts, machines, and other tunnels.
- Placing one: pick Tunnel, tap the entrance spot, then tap the exit spot. The valid exit tiles are highlighted.

### 6.4 Bridges
- A bridge is a **1×1 crossing piece**. Two belts pass through it at right angles without mixing.
- **Auto-bridge (my call):** while drawing a belt, crossing an existing perpendicular belt drops a bridge there automatically, and a short toast says "Bridge placed." It can also be placed manually from the menu.

### 6.5 Splitter, Merger, Storage box
- **Splitter** (1×1, directional, T2): one input from the back, up to 3 outputs (left, front, right). Items alternate between outputs that have room.
- **Merger** (1×1, directional, T2): up to 3 inputs (left, back, right), one output to the front. It takes from inputs in turn so no input is starved.
- **Storage box** (2×2, T4): accepts items from any belt pointing in. Holds **200 items** of mixed types, first in first out. Outputs to belts pointing away. Tapping it shows the contents, with an Empty button that throws them away.
- Ironline's omni-directional **Router is removed**.

### 6.6 Hub
- The Hub is 4×4 in the center. It accepts **any item from any side**, so it never blocks.
- Delivered items count toward the tier goal and are stored for research.
- It visibly pulses when items arrive.

---

## 7. Power (tier 5+)

- **Generator** (2×2): burns 1 coal every 4 s and supplies **20 power** while fueled. It holds up to 10 coal. From tier 11 it also accepts **fuel cells**, where 1 cell gives 200 power for 60 s (builder tunes this).
- **Power pole** (1×1): connects to other poles and generators within **8 tiles**.
- **Coverage:** every generator and pole powers machines with any tile inside its **7×7 square**.
- **Networks:** all connected generators and poles form one network. Each powered machine draws a set amount: Foundry 4, Refinery 8.
- **Satisfaction** is supply ÷ demand, capped at 1. A machine's speed is **25% + 75% × satisfaction**. A machine with no network runs at 25%, so it never fully stops.
- An optional power overlay (toggle) shows coverage squares and network links.

---

## 8. Progression

### 8.1 Tiers

Each tier has goals: deliver N of each listed item to the Hub. Reaching a tier unlocks what's listed.

| Tier | Name | Unlocks on reaching it | Goals (starting numbers) |
|---|---|---|---|
| 1 | Ignition | Belt, Miner, Furnace | 40 iron plate, 30 copper plate |
| 2 | Parts | Assembler, Splitter, Merger; gear, wire | 50 gear, 80 wire |
| 3 | Circuits | Tunnel, Bridge; brick, circuit | 60 circuit, 40 brick |
| 4 | Steel | Fabricator, Storage box; steel, motor | 60 steel, 30 motor |
| 5 | Power | Generator, Power pole, Foundry; **quartz (ring 1)**; glass, silicon | 60 silicon, 60 glass |
| 6 | Electronics | frame, processor | 50 processor, 40 frame |
| 7 | Oil | Refinery; **oil (ring 2)**; plastic, cable | 120 plastic, 100 cable |
| 8 | Automation | robot arm | 40 robot arm, 100 processor |
| 9 | Titanium | **titanium (ring 3)**; titanium plate | 150 titanium plate, 60 robot arm |
| 10 | Aerospace | turbine | 40 turbine, 200 titanium plate |
| 11 | Nuclear | **uranium (ring 4)**; fuel cell; generators accept fuel cells | 40 fuel cell, 40 turbine |
| 12 | Fusion | fusion core | 20 fusion core |

After tier 12, a **"Factory complete" screen** shows play time, items made, and the biggest production line, followed by **sandbox mode**.

Each tier-up gets a short sheet listing what unlocked, a chime, and a "new" badge on unlocked tools, as in Ironline.

### 8.2 Pacing
- The total target is **5–8 hours** of play to finish tier 12. Early tiers take about 10–15 minutes, and late tiers about 40–50 minutes.
- **Quick check-ins must pay off.** In a 5-minute session, the player should be able to finish at least one research node or see a goal move meaningfully. The goal bar should always show progress and items per minute.

### 8.3 Research
Research is paid instantly with items stored in the Hub, like Ironline. A badge appears when something is affordable.

| Research | Effect | Unlock tier | Cost (starting) |
|---|---|---|---|
| Faster Miners I / II / III | +40% each | 1 / 4 / 8 | iron plate → steel → robot arm |
| Faster Belts I / II / III | 2 → 3 → 4 → 5 tiles/s | 1 / 4 / 9 | copper plate/gear → steel → titanium |
| Hot Furnaces I / II | +40% each | 2 / 6 | gear → frame |
| Quick Assembly I / II | Assembler and Fabricator +35% each | 3 / 7 | circuit → processor |
| Long Tunnels | tunnel gap 4 → 8 | 4 | steel, circuit |
| Big Boxes | storage 200 → 500 | 6 | frame |
| Efficient Generators | +50% power per coal | 6 | processor, silicon |
| Wide Poles | pole reach 8 → 12, coverage 7×7 → 11×11 | 7 | cable |
| Deep Drills | miners yield 2 per cycle | 10 | turbine |

---

## 9. Controls (phone first)

Tiny tiles were the main complaint about belts, so tap targets are the priority here.

- **Default zoom:** a tile is about **44 px** (CSS) on a phone. Pinch zoom ranges from about 16 px (overview) to 72 px.
- **Pan and zoom:** one finger pans in Pan mode, and two fingers pan and pinch in any mode. This is kept from Ironline.
- **Placing a machine:** tap to drop a **ghost**, then drag the ghost to adjust it, then tap ✓ to place. The ghost turns red where it can't fit and says why.
- **Drawing belts:** drag a path. The tile under your finger is shown in a **magnifier bubble above the finger**, so your finger never hides it. Direction follows the drag, and corners are automatic.
- **Edge auto-pan:** dragging near the screen edge auto-pans the map, so long belts don't need lifting and re-dragging.
- **Two-tap belt (my call):** in Belt mode, a double-tap marks a start point; tapping an end point previews an L-shaped belt between them (straight runs, one corner, with a button to flip which way the corner goes). It auto-bridges across perpendicular belts and shows red where a machine is in the way. ✓ places it. This is the main tool for the long hauls back from far regions.
- **Rotation:** directional pieces (splitter, merger, tunnel) have a rotate button in the build bar.
- **Erase:** tap or drag over things to remove them. Removing refunds nothing and costs nothing, since buildings are free, like Ironline.
- **Undo:** an undo button covers the last 20 build or erase actions. This is a cheap safety net for mis-taps.
- **Tap to inspect:** in Pan mode, tap a machine to inspect it or a belt to see what's on it.
- **Overview:** at the farthest zoom, the map switches to a simple view, with buildings as colored blocks and belts as lines. This makes the whole factory readable at a glance.

---

## 10. Polish

- **Sound effects:** these are generated live with Web Audio, with no files. Sounds cover placing, erasing, undo, belt drawing (a soft tick per tile), tier-up (a chime), research bought, and blocked/warning. There is a mute toggle in the Menu, and the setting is remembered. Sound starts on the first tap, per phone autoplay rules.
- **Animation:** items glide on belts, and machines show a small working animation (a spin or a glow) only while crafting. The Hub pulses on delivery.
- **Performance target:** **60 fps on a mid-range phone with 3,000 buildings and 10,000 items on belts.**
  - The simulation runs at a fixed 20 ticks per second, and rendering interpolates between ticks.
  - Terrain and ore are pre-rendered into cached chunk images. Only visible chunks and objects are drawn.
  - If 2D canvas can't hit the target after optimization, fall back to Approach 2 (WebGL).

---

## 11. Save

- **Autosave** runs every 10 s, plus when the page is hidden. Saves go to his Claude account (with a `localStorage` mirror).
- **On open:** if there's a save, show **Continue / New game**. New game asks for a second tap to confirm, as in Ironline.
- **What's saved:** the seed, tier, goal progress, Hub stock, research, every building (type, position, direction, recipe), **items on belts, and machine buffers**, so the factory is exactly as he left it. The save uses a compact encoding.
- **Home Screen version:** saves to `localStorage` (or IndexedDB) on the phone, with the same autosave timing and the same Continue / New game screen.
- **Save code:** Copy save code / Load save code in the Menu of both builds (§3). Loading asks for confirmation before replacing the current game.
- **Versioning:** saves carry a version number. The loader must ignore or upgrade old versions without crashing.

---

## 12. Testing the builder must do

- **Headless simulation tests (Node):**
  - belts move multiple items per tile with correct spacing
  - long belts work
  - tunnels and bridges pass items correctly and don't mix them
  - splitters alternate and mergers take fairly
  - pass-by intake: a mixed belt feeding a 4-ingredient Fabricator runs for 10,000 ticks without stalling
  - a dead-end belt with a wrong item is reported as blocked
  - power satisfaction math works
  - save → load round-trips identically
- **A balance run:** a scripted reference factory plays tiers 1–12 headless, to estimate time per tier against the 5–8 hour target.
- **A real-browser check:** Jacob plays on an **iPhone**, in the Claude app and in Safari, so the main check uses **WebKit** (Playwright WebKit) at an iPhone viewport (390×844), with Chromium as a secondary check. It takes screenshots of the main screens in light and dark, touch-event checks for placing and belt drawing, and an fps reading with a large generated factory.

---

## 13. Left to the builder

These are things a sensible builder can decide without changing what Jacob gets:

- the exact item shapes, colors, and building art (staying flat and clean)
- exact UI layout of the build bar and sheets, keeping Ironline's general feel: a top bar with the tier pill, Research and Menu, and a bottom build bar
- tuning all numbers in §5, §7, and §8 to hit the pacing target
- world-generation details within the ring rules
- the internal data structures

---

## 14. Calls I made (for Jacob to check)

1. **160×160 map**, confirmed by Jacob.
2. **Pass-by intake** is the way mixed belts avoid jams. Dead-end belts with a wrong item show as blocked, with the reason. Starved machines overstock (up to 99) so a merged belt into a Fabricator can't stall, and the inspector has a Clear button.
3. **Only tier-5+ machines need power**, so the existing factory never slows down when power arrives.
4. **The whole map is buildable from the start.** Only the special ores are locked.
5. **Auto-bridge** when a belt is drawn across another.
6. **Two-tap belt tool** for long hauls.
7. **Undo** (last 20 actions) and a **magnifier bubble** for drawing belts.
8. **Items on belts and in machines are saved.**
9. **Working name "Steelreach."**
10. **Home Screen version hosted on GitHub Pages** from your `Steel_reach` repo, plus a **focus mode** in both builds.
