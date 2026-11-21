# Steelreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Steelreach, a phone-first factory game, as one source tree that ships two builds: a Claude artifact that saves to the player's account, and a full-screen Home Screen web app on GitHub Pages.

**Architecture:** The game is plain ES modules. The pure simulation lives in `src/game` and `src/sim`, with no DOM, and is tested in Node with `node:test`. A canvas renderer, a touch input layer, and a DOM UI sit on top. esbuild bundles `src/main.js` and inlines it with the CSS into one HTML file per target (`__TARGET__` = `"artifact"` or `"home"`). The simulation runs at a fixed 20 ticks per second and pauses while the page is hidden.

**Tech Stack:** Node 22 and `node:test` (no test framework), esbuild (dev only), playwright-core driving `/usr/bin/google-chrome` for the browser check (dev only). The shipped game has zero runtime dependencies.

**Spec:** `docs/Steelreach_Brief_v1.md`. Read it before starting. Section numbers below (§) refer to it.

## Global Constraints

- The map is 160×160 tiles. The Hub is a 4×4 block at tiles x 78–81, y 78–81, and ring distance is measured from point (80, 80).
- The simulation runs at a fixed **20 ticks/second**. When `document.hidden` is true, no ticks run and there's no catch-up.
- Directions are `0=N, 1=E, 2=S, 3=W`, with `DX=[0,1,0,-1]` and `DY=[-1,0,1,0]`. An entity's `x, y` is its top-left tile.
- Belts are single-lane: up to **4 items per tile**, spacing `0.25`, and a waiting front item sits at pos `0.875`. Base speed is **2 tiles/s**, rising to 3, 4, and 5 with research.
- Buffers: each ingredient holds 2 batches, output holds 4, overstock caps at **99**. A storage box holds 200 (500 with research). A tunnel gap is up to 4 tiles between (8 with research).
- Power: a generator holds up to 10 fuel. 1 coal lasts 4 s and gives 20 power. 1 fuel cell lasts 60 s and gives 200 power (tier 11+). A pole reaches 8 tiles (12 with research) and covers a 7×7 area (11×11 with research). An unpowered machine runs at **25%**. Speed = `0.25 + 0.75 × satisfaction`. Only Foundry (draw 4) and Refinery (draw 8) need power.
- Only tier-5+ machines need power. Miners, furnaces, assemblers, and fabricators never do.
- Belts only: nothing teleports items to the Hub. The Hub accepts only from belts pointing into it or from machines touching it, never pass-by.
- Default zoom is a **44 px** tile, and pinch zoom ranges from **16 to 72 px** per tile. Undo keeps the last **20** actions. Autosave runs every **10 s** and when the page is hidden.
- The shipped HTML makes **no external requests**: CSS, JS, icons, and sound are all inline or generated. There is **no music** and **no filter splitter**.
- The viewport meta includes `viewport-fit=cover`, and the page uses `env(safe-area-inset-*)` padding (the Claude iOS app draws under its top bar). Light and dark themes follow `prefers-color-scheme`.
- Performance target: **60 fps on a phone with 3,000 buildings and 10,000 belt items**.
- User-facing copy the spec fixes:
  - "Bridge placed"
  - "Waiting for <Item>"
  - "Output full"
  - "Low power: <N>% speed"
  - "<Machine> can't use <Item>"
  - "<N> <Item>, waiting for <Item>"
  - Continue / New game, with "Tap again to start over"
- The game is named **Steelreach**. The artifact's account save is the doc `data/users/<id>/steelreach`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014zEKgR3y6chAihLf41CtQb
  ```

## Review Focus

These are the inputs most likely to bite a player that no spec test covers. Each one has a pinned test in its owning task.

1. **A garbled or foreign save code pasted into Load, or a corrupt or newer-version save on open.** The game must keep or start a game and show a message, never crash. (Task 11)
2. **A second finger landing mid belt-drag** (starting a pinch). The drag must cancel without placing stray belts. (Task 13)
3. **Erasing one end of a tunnel while items are underground, or erasing a machine a belt is blocked on.** No dangling references, no crash, and items underground are dropped. (Task 5, Task 8)
4. **A belt loop with no exit.** Items circulate, the count is conserved, and the ordering pass doesn't hang. (Task 4)
5. **The account save is unavailable or slow** (`claude.use` resolves `null`, `db.get` rejects or never answers). The game must start from the local save at once. (Task 11)

---

## File Structure

```
package.json            scripts: test, build, check
build.mjs               esbuild bundle + inline → dist/artifact/index.html, dist/home/{index.html,manifest.webmanifest,icon-180.png,icon-512.png}
tools/make-icons.mjs    writes PNG icons with node:zlib (no deps)
tools/balance.mjs       measures module throughput in-sim, writes docs/balance.md
tools/browser-check.mjs playwright-core + google-chrome, iPhone viewport, screenshots, fps
src/index.html          page template with <!--CSS--> and <!--JS--> and <!--HEAD--> markers
src/styles.css
src/config.js           all constants, items, recipes, buildings, rings, tiers, research, balance
src/world.js            seeded RNG, ring math, ore generation
src/game/state.js       createGame, grid, entities, add/remove, lookups, edge helpers
src/game/place.js       canPlace, place, placeTunnel, validTunnelExits, placeBeltPath, erase
src/game/undo.js        doAction, undo
src/game/progress.js    unlocks, tier check, research, mods, stats
src/sim/offer.js        offer() dispatcher + result codes
src/sim/order.js        downstream-first conveyor order
src/sim/belts.js        belt tile accept/step, pass-by pulls
src/sim/pieces.js       bridge, tunnel, splitter, merger accept/step
src/sim/machines.js     miner, crafters, generator intake, storage, outputs, hand-off, status
src/sim/hub.js          Hub accept
src/sim/power.js        networks, coverage, satisfaction
src/sim/tick.js         tick(game)
src/save/serialize.js   serialize / deserialize / tryLoad
src/save/code.js        encodeSaveCode / decodeSaveCode
src/save/stores.js      createLocalStore, createClaudeStore, loadBest, createSaver
src/render/camera.js    camera math
src/render/terrain.js   cached terrain chunks
src/render/shapes.js    item and building drawing primitives
src/render/draw.js      drawFrame
src/input/gestures.js   pointer → tap/doubleTap/drag/pinch events
src/input/paths.js      dragPath, lPath, pathDirs
src/input/tools.js      tool state machine wiring gestures to game ops
src/ui/format.js        pure text formatting
src/ui/ui.js            DOM: top bar, build bar, sheets, toasts, focus mode
src/audio.js            generated sound effects
src/loop.js             fixed-timestep loop
src/main.js             boot, stores, wiring, debug hook
tests/helpers.js        test helpers
tests/*.test.js
```

---

### Task 1: Scaffold, config data, and the two-target build

**Files:**
- Create: `package.json`, `build.mjs`, `tools/make-icons.mjs`, `src/index.html`, `src/styles.css`, `src/config.js`, `src/main.js` (placeholder that draws "Steelreach" on a canvas), `.gitignore` (`node_modules`, `dist`)
- Test: `tests/config.test.js`, `tests/build.test.js`

**Interfaces:**
- Produces (from `src/config.js`, all named exports):
  - `MAP=160`, `TPS=20`, `HUB={x:78,y:78,w:4,h:4}`, `CENTER={x:80,y:80}`, `DX`, `DY`, `TILE=44`, `ZOOM_MIN_PX=16`, `ZOOM_MAX_PX=72`
  - `ITEMS`: `{ [id]: {name, color, shape} }` for the 27 ids in §5. The ids are `iron_ore copper_ore stone coal quartz crude_oil titanium_ore uranium_ore iron_plate copper_plate gear wire brick circuit steel motor glass silicon frame processor plastic cable robot_arm titanium_plate turbine fuel_cell fusion_core`. Names come from §5 ("Crude oil", "Robot arm", …).
  - `RECIPES`: `{ [outputId]: {machine, in:{id:n}, out:n, sec, tier} }`, exactly §5's table. `machine` ∈ `furnace|assembler|fabricator|foundry|refinery`.
  - `BUILDINGS`: `{ [type]: {name, w, h, tier, power, dir} }` for `belt bridge tunnel splitter merger storage miner furnace assembler fabricator foundry refinery generator pole hub`. Sizes and tiers come from §6. `power` is 4 for foundry, 8 for refinery, 0 otherwise. `dir` is true for belt, bridge, tunnel, splitter, merger. The hub has `tier: 0` and is not placeable.
  - `ORE_TIER = {iron_ore:1, copper_ore:1, stone:1, coal:1, quartz:5, crude_oil:7, titanium_ore:9, uranium_ore:11}`
  - `RINGS = [{r0:0,r1:28,ore:null},{r0:28,r1:48,ore:'quartz'},{r0:48,r1:66,ore:'crude_oil'},{r0:66,r1:84,ore:'titanium_ore'},{r0:84,r1:Infinity,ore:'uranium_ore'}]`
  - `TIERS`: an array of 12 entries, `{name, unlocks:{buildings:[], recipes:[], ores:[]}, goals:{}}`, using the names, unlocks, and goals from §8.1. Tier 1 unlocks `belt, miner, furnace`, recipes `iron_plate, copper_plate`, and ores `iron_ore, copper_ore, stone, coal`. Placing a tunnel uses building id `tunnel`.
  - `RESEARCH`: an array of `{id, name, desc, tier, req?, cost, effect}`. The ids and starting costs are:
    - `miner1` T1 `{iron_plate:30}`, `miner2` T4 `{steel:40,gear:40}` req miner1, `miner3` T8 `{robot_arm:15,steel:80}` req miner2. Each has effect `{minerMult:+0.4}`.
    - `belt1` T1 `{copper_plate:30,iron_plate:20}`, `belt2` T4 `{steel:40,gear:30}` req belt1, `belt3` T9 `{titanium_plate:60,motor:20}` req belt2. Each has effect `{beltLevel:+1}`.
    - `smelt1` T2 `{gear:40}`, `smelt2` T6 `{frame:20}` req smelt1. Each has effect `{furnaceMult:+0.4}`.
    - `asm1` T3 `{circuit:30}`, `asm2` T7 `{processor:30}` req asm1. Each has effect `{asmMult:+0.35}`.
    - `longTunnels` T4 `{steel:30,circuit:30}` with effect `{tunnelGap:8}`.
    - `bigBoxes` T6 `{frame:20}` with effect `{storageCap:500}`.
    - `effGen` T6 `{processor:20,silicon:40}` with effect `{genMult:1.5}`.
    - `widePoles` T7 `{cable:60}` with effect `{poleReach:12,coverHalf:5}`.
    - `deepDrills` T10 `{turbine:10}` with effect `{minerYield:2}`.
  - `BAL`:
    ```
    {beltTilesPerSec:[2,3,4,5], spacing:0.25, waitPos:0.875, ingBatches:2, outMax:4, overstock:99,
     storageCap:200, tunnelGap:4, minerSecFull:1.0, genFuelMax:10, coalSec:4, coalPower:20,
     cellSec:60, cellPower:200, poleReach:8, coverHalf:3, unpowered:0.25, undoMax:20, autosaveMs:10000}
    ```
- Produces (`build.mjs`): `npm run build` writes `dist/artifact/index.html` and `dist/home/index.html` + `manifest.webmanifest` + `icon-180.png` + `icon-512.png`.

- [ ] **Step 1: Write the failing config test** (`tests/config.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { ITEMS, RECIPES, BUILDINGS, TIERS, RESEARCH, ORE_TIER } from '../src/config.js';
const SIZE = {furnace:[1,1], assembler:[1,2], fabricator:[3,4], foundry:[2,2], refinery:[1,1]};
const tierOf = (kind, id) => TIERS.findIndex(t => t.unlocks[kind].includes(id)) + 1; // 0 = never
test('27 items, every recipe input/output is a known item', () => {
  assert.equal(Object.keys(ITEMS).length, 27);
  for (const [out, r] of Object.entries(RECIPES)) { assert.ok(ITEMS[out], out); for (const k in r.in) assert.ok(ITEMS[k], k); }
});
test('ingredient counts fit the machine', () => {
  for (const [out, r] of Object.entries(RECIPES)) { const n = Object.keys(r.in).length, [lo, hi] = SIZE[r.machine]; assert.ok(n >= lo && n <= hi, out); }
});
test('12 tiers; each recipe unlocks at its stated tier; goals use unlocked items', () => {
  assert.equal(TIERS.length, 12);
  for (const [out, r] of Object.entries(RECIPES)) assert.equal(tierOf('recipes', out), r.tier, out);
  TIERS.forEach((t, i) => { for (const g in t.goals) { const tt = RECIPES[g].tier; assert.ok(tt <= i + 1, `${g} in tier ${i+1}`); } });
});
test('every ore and placeable building unlocks somewhere', () => {
  for (const o in ORE_TIER) assert.equal(tierOf('ores', o), ORE_TIER[o], o);
  for (const b in BUILDINGS) if (b !== 'hub') assert.equal(tierOf('buildings', b), BUILDINGS[b].tier, b);
});
test('research costs only use items unlocked by the research tier', () => {
  for (const r of RESEARCH) for (const k in r.cost) assert.ok(RECIPES[k].tier <= r.tier, `${r.id}:${k}`);
  for (const r of RESEARCH) if (r.req) assert.ok(RESEARCH.find(x => x.id === r.req));
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL, with "Cannot find module '../src/config.js'"

- [ ] **Step 3: Write `src/config.js`** with the exports above. Colors and shapes are the builder's choice: distinct, and readable on light `#eef2ea` and dark `#121815` backgrounds. Shapes come from `circle square rect gear diamond chip hex star triangle ring cross bolt`.

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing build test** (`tests/build.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execSync } from 'node:child_process'; import { readFileSync, existsSync } from 'node:fs';
test('build emits both targets with no external requests', () => {
  execSync('node build.mjs', { stdio: 'pipe' });
  const a = readFileSync('dist/artifact/index.html', 'utf8'), h = readFileSync('dist/home/index.html', 'utf8');
  for (const s of [a, h]) {
    assert.match(s, /^<!DOCTYPE html>/); assert.match(s, /<title>Steelreach<\/title>/);
    assert.match(s, /viewport-fit=cover/); assert.doesNotMatch(s, /(src|href)=["']https?:/);
  }
  assert.doesNotMatch(a, /manifest\.webmanifest/);
  assert.match(h, /rel="manifest" href="manifest\.webmanifest"/); assert.match(h, /apple-mobile-web-app-capable/);
  for (const f of ['manifest.webmanifest', 'icon-180.png', 'icon-512.png']) assert.ok(existsSync('dist/home/' + f), f);
  const m = JSON.parse(readFileSync('dist/home/manifest.webmanifest', 'utf8'));
  assert.equal(m.display, 'standalone'); assert.equal(m.name, 'Steelreach');
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npm i -D esbuild@0.28 && node --test tests/build.test.js`
Expected: FAIL, because `build.mjs` is missing.

- [ ] **Step 7: Write `build.mjs`, `tools/make-icons.mjs`, `src/index.html`, `src/styles.css`, and the placeholder `src/main.js`.**
  - `build.mjs` calls `esbuild.build({entryPoints:['src/main.js'], bundle:true, format:'iife', minify:true, write:false, define:{__TARGET__: JSON.stringify(target)}})` for each target. It replaces `<!--CSS-->`, `<!--JS-->`, and `<!--HEAD-->` in the template. In the JS, every `</script` must be escaped as `<\/script`.
  - `<!--HEAD-->` is empty for the artifact. For home it holds the manifest link, `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=Steelreach`, and `<link rel="apple-touch-icon" href="icon-180.png">`.
  - The manifest is `{name, short_name:'Steelreach', display:'standalone', orientation:'portrait', start_url:'./', background_color, theme_color, icons:[180,512]}`.
  - `make-icons.mjs` writes solid-background PNGs with a simple gear-like mark computed per pixel, encoded with `zlib.deflateSync` and handwritten PNG chunks (CRC32 included).
  - `package.json` scripts: `"test": "node --test tests/"`, `"build": "node build.mjs"`, `"check": "node tools/browser-check.mjs"`. Set `"type": "module"`.

- [ ] **Step 8: Run all tests and verify they pass**

Run: `npm test`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: scaffold, game data, two-target build"
```

---

### Task 2: World generation

**Files:**
- Create: `src/world.js`
- Test: `tests/world.test.js`

**Interfaces:**
- Consumes: `MAP, CENTER, HUB, RINGS` from config.
- Produces:
  - `mulberry32(seed:number) -> () => number`, which returns a float in [0, 1)
  - `ringOf(x:number, y:number) -> 0|1|2|3|4`, measuring distance from the tile center `(x+.5, y+.5)` to CENTER
  - `generateWorld(seed:number) -> {seed:number, ore:(string|null)[]}`, where `ore` has length MAP*MAP and is indexed `y*MAP+x`
  - `idx(x,y) -> number` and `inMap(x,y) -> boolean`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { generateWorld, ringOf, idx } from '../src/world.js'; import { MAP, RINGS } from '../src/config.js';
const BASIC = ['iron_ore','copper_ore','stone','coal'];
function patches(w, type, maxDist) { // count 4-connected patches with any tile within maxDist of center
  const seen = new Set(); let n = 0;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = idx(x,y); if (w.ore[i] !== type || seen.has(i)) continue;
    let near = false; const st = [[x,y]]; seen.add(i);
    while (st.length) { const [a,b] = st.pop(); if (Math.hypot(a+.5-80, b+.5-80) <= maxDist) near = true;
      for (const [c,d] of [[a+1,b],[a-1,b],[a,b+1],[a,b-1]]) { const j = idx(c,d);
        if (c>=0&&d>=0&&c<MAP&&d<MAP&&!seen.has(j)&&w.ore[j]===type) { seen.add(j); st.push([c,d]); } } }
    if (near) n++;
  }
  return n;
}
test('deterministic per seed, different across seeds', () => {
  assert.deepEqual(generateWorld(7).ore, generateWorld(7).ore);
  assert.notDeepEqual(generateWorld(7).ore, generateWorld(8).ore);
});
test('hub tiles have no ore', () => { const w = generateWorld(3);
  for (let y = 78; y < 82; y++) for (let x = 78; x < 82; x++) assert.equal(w.ore[idx(x,y)], null); });
test('ring 0 has >=2 patches of each basic ore within 15 tiles, for 20 seeds', () => {
  for (let s = 1; s <= 20; s++) { const w = generateWorld(s); for (const t of BASIC) assert.ok(patches(w, t, 15) >= 2, `seed ${s} ${t}`); }
});
test('special ores appear only in their ring, and every special ore exists', () => {
  const w = generateWorld(5); const found = {};
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) { const o = w.ore[idx(x,y)]; if (!o || BASIC.includes(o)) continue;
    found[o] = true; assert.equal(RINGS[ringOf(x,y)].ore, o, `${o} at ${x},${y}`); }
  for (const r of RINGS.slice(1)) assert.ok(found[r.ore], r.ore);
});
test('outer basic patches are bigger on average than ring 0 patches', () => {
  const w = generateWorld(9); let inner = 0, outer = 0, ni = 0, no = 0;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) { const o = w.ore[idx(x,y)]; if (!BASIC.includes(o)) continue;
    if (ringOf(x,y) === 0) inner++; else outer++; }
  assert.ok(outer / inner > 2);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/world.test.js`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `src/world.js`.**
  - Place ring 0 patches first: 2–3 per basic ore at angles spaced around the Hub, with centers 8–14 tiles away and radius 2.5–3.5.
  - Then scatter patches into rings 1–4. Each outer ring gets basic-ore patches of radius 4–7 and 6–10 patches of the ring's special ore, with patch centers kept inside the ring band and tiles clipped to the band.
  - Patch edges are noisy (radius + rng jitter per tile, as in Ironline's `genOre`). No ore goes in the Hub footprint plus a 1-tile margin.

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test tests/world.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: seeded ring world generation"
```

---

### Task 3: Game state, placement rules, and undo

**Files:**
- Create: `src/game/state.js`, `src/game/place.js`, `src/game/undo.js`, `src/game/progress.js` (only `isUnlocked` and `defaultMods` in this task)
- Create: `tests/helpers.js`
- Test: `tests/place.test.js`

**Interfaces:**
- Consumes: config, `generateWorld`, `idx`, `inMap`.
- Produces (`state.js`):
  - `createGame(seed:number) -> Game` places the hub as entity id 1. The Game shape is:
    ```
    {seed, world, tier:1, prog:{}, stock:{}, research:{}, mods, tick:0, grid:Int32Array(MAP*MAP), ents:Map<id,Ent>,
     nextId:2, machines:Ent[], conveyors:Ent[], order:Ent[], topoDirty:true, powerDirty:true, nets:[],
     undo:[], cur:null, events:[], stats:{playTicks:0, made:{}}, settings:{sfx:true, lastRecipe:{}}, completedAt:null}
    ```
  - `Ent` always has `{id, type, x, y, w, h, dir}` plus per-type state:
    - `belt`: `{items:[{item,pos}] (front first), blocked:null|string, side:0}`
    - `bridge`: `{dirH:1|3, dirV:0|2, h:[{item,pos}], v:[{item,pos}]}`
    - `tunnel_in`: `{pair:id, under:[{item,left}]}`
    - `tunnel_out`: `{pair:id, items:[]}`
    - `splitter`: `{hold:null|{item,pos}, rr:0}`
    - `merger`: `{hold:null|{item,pos}, turn:0}`
    - `storage`: `{queue:[], rr:0}`
    - `miner`: `{ore, tiles, timer:0, out:[], rr:0}`
    - crafters: `{recipe:string|null, buf:{}, prog:0, out:[], rr:0, net:-1, pmult:1}` (the furnace starts with `recipe:null`)
    - `generator`: `{fuel:{coal:0,fuel_cell:0}, burn:0, burnPower:0, net:-1}`
    - `pole`: `{net:-1}`
    - `hub`: `{}`
  - `addEnt(game, type, x, y, props) -> Ent` and `removeEnt(game, ent)`. Both set `topoDirty` and `powerDirty`, and keep `machines` (miner, crafters, generator, storage) and `conveyors` (belt, bridge, tunnel_in, tunnel_out, splitter, merger) in sync.
  - `entAt(game, x, y) -> Ent|null`
  - `edgeNeighbors(ent) -> {x,y,dir}[]` returns the tiles just outside each edge tile, where `dir` points outward.
  - `CRAFTERS = ['furnace','assembler','fabricator','foundry','refinery']`
- Produces (`place.js`):
  - `canPlace(game, type, x, y, opts={}) -> {ok:true}|{ok:false, reason}`. The exact reasons are `'Off the map'`, `'Tile is occupied'`, `'Miners need an ore tile'`, `'Miner covers two ore types'`, `` `Unlocks at Tier ${n}` `` (locked building), `` `${OreName} unlocks at Tier ${n}` `` (locked ore under a miner), and `'Recipe not unlocked'`.
  - `place(game, type, x, y, opts={dir, recipe, dirH, dirV}) -> Ent|null`. A miner stores `ore` and `tiles` (the count of covered ore tiles). An assembler, fabricator, or foundry takes `opts.recipe ?? game.settings.lastRecipe[type] ?? first unlocked recipe for that machine`. The refinery always gets `plastic`.
  - `erase(game, x, y) -> boolean` refuses the hub.
- Produces (`undo.js`): `doAction(game, fn:() => any) -> any` records every add and remove made inside `fn` as one action. `undo(game) -> boolean` reverts the last action, restoring removed buildings without their contents. The stack is capped at `BAL.undoMax`.
- Produces (`progress.js`): `isUnlocked(game, kind:'buildings'|'recipes'|'ores', id) -> boolean` and `defaultMods() -> {beltLevel:0, minerMult:1, furnaceMult:1, asmMult:1, tunnelGap:4, storageCap:200, genMult:1, poleReach:8, coverHalf:3, minerYield:1}`.
- Produces (`tests/helpers.js`):
  - `testGame({tier=12}={}) -> Game` builds a game with seed 1, ore cleared everywhere, and the given tier.
  - `setOre(game, x, y, w, h, type)`
  - `run(game, n)` calls `tick` n times. Import it lazily, since tick arrives in Task 4.

- [ ] **Step 1: Write the failing test** (`tests/place.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, setOre } from './helpers.js'; import { canPlace, place, erase } from '../src/game/place.js';
import { entAt } from '../src/game/state.js'; import { doAction, undo } from '../src/game/undo.js';
test('multi-tile footprint occupies every tile and blocks overlap', () => {
  const g = testGame(); const f = place(g, 'fabricator', 40, 40, {recipe:'motor'});
  assert.equal(entAt(g, 42, 42), f); assert.equal(entAt(g, 43, 42), null);
  assert.deepEqual(canPlace(g, 'assembler', 41, 39), {ok:false, reason:'Tile is occupied'});
  assert.deepEqual(canPlace(g, 'assembler', 159, 10), {ok:false, reason:'Off the map'});
});
test('miner rules: needs ore, one type, locked ores refused, tiles counted', () => {
  const g = testGame({tier:4});
  assert.equal(canPlace(g, 'miner', 10, 10).reason, 'Miners need an ore tile');
  setOre(g, 10, 10, 1, 1, 'iron_ore'); setOre(g, 11, 10, 1, 1, 'coal');
  assert.equal(canPlace(g, 'miner', 10, 10).reason, 'Miner covers two ore types');
  setOre(g, 20, 20, 2, 1, 'quartz'); assert.equal(canPlace(g, 'miner', 20, 20).reason, 'Quartz unlocks at Tier 5');
  setOre(g, 30, 30, 2, 2, 'iron_ore'); setOre(g, 30, 31, 1, 1, null); assert.equal(place(g, 'miner', 30, 30).tiles, 3);
});
test('locked buildings refused with tier', () => {
  const g = testGame({tier:1}); assert.equal(canPlace(g, 'assembler', 5, 5).reason, 'Unlocks at Tier 2');
});
test('hub cannot be erased; erase removes', () => {
  const g = testGame(); assert.equal(erase(g, 79, 79), false);
  place(g, 'belt', 5, 5, {dir:1}); assert.equal(erase(g, 5, 5), true); assert.equal(entAt(g, 5, 5), null);
});
test('undo reverts a whole action and is capped at 20', () => {
  const g = testGame();
  doAction(g, () => { for (let x = 0; x < 5; x++) place(g, 'belt', x, 0, {dir:1}); });
  assert.ok(undo(g)); for (let x = 0; x < 5; x++) assert.equal(entAt(g, x, 0), null);
  place(g, 'assembler', 50, 50, {recipe:'gear'}); doAction(g, () => erase(g, 50, 50));
  assert.ok(undo(g)); assert.equal(entAt(g, 50, 50).recipe, 'gear');
  for (let i = 0; i < 25; i++) doAction(g, () => place(g, 'belt', i, 5, {dir:1}));
  let n = 0; while (undo(g)) n++; assert.equal(n, 20);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/place.test.js`
Expected: FAIL, because modules are missing.

- [ ] **Step 3: Implement `state.js`, `place.js`, `undo.js`, `progress.js` (`isUnlocked`, `defaultMods`), and `tests/helpers.js`** to the interfaces above. `canPlace` checks the reasons in this order: off map, occupied, building locked, miner ore rules, recipe locked.

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test tests/place.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: game state, placement rules, undo"
```

---

### Task 4: Belts, offer dispatch, conveyor order, Hub intake, tick

**Files:**
- Create: `src/sim/offer.js`, `src/sim/order.js`, `src/sim/belts.js`, `src/sim/hub.js`, `src/sim/tick.js`
- Modify: `tests/helpers.js` (add `feed`, `drain`, `snake`)
- Test: `tests/belts.test.js`

**Interfaces:**
- Consumes: Game/Ent shapes and `entAt` from Task 3.
- Produces:
  - `offer(game, ent, item, moveDir, pos=0, mode='deadEnd') -> 0|1|2|3`, with result codes exported as `OK=0, BUSY=1, NEVER=2, STALL=3`. `moveDir` is the direction the item travels as it enters `ent`, and `mode` ∈ `'deadEnd'|'handoff'|'passBy'`. In this task it dispatches `belt → acceptBelt` and `hub → acceptHub`, and returns `NEVER` for anything else. Later tasks add cases.
  - `acceptBelt(game, b, item, moveDir, pos) -> 0|1|2`: returns `NEVER` if `moveDir === (b.dir+2)%4`. It accepts if the tile is empty, or if the last item's `pos >= spacing`. The new item's pos is `min(pos, last.pos - spacing)` (or `min(pos, waitPos)` if the tile is empty).
  - `stepBelt(game, b, v)`: the algorithm below.
  - `beltSpeed(game) -> tiles/tick`, which is `BAL.beltTilesPerSec[game.mods.beltLevel] / TPS`.
  - `acceptHub(game, item) -> 0`: `stock[item]++`, and `prog[item]++` if it's a goal of the current tier. It sets `game.hubPulse = game.tick` (the renderer pulses the Hub for 10 ticks after) and always returns OK.
  - `rebuildOrder(game)` sets `game.order`.
  - `nextOf(game, node) -> Ent[]` returns a conveyor's downstream entities.
  - `tick(game)` runs: `if topoDirty rebuildOrder` → (Task 9 adds power) → (Task 7 adds machines) → step each `order` node → `tick++`, `stats.playTicks++`.
  - Test helpers:
    - `feed(game, x, y, items:string[], dir)` offers the next item in the cycle at pos 0 on the tile at x,y each call. Call it before each tick.
    - `drain(game, x, y) -> string[]` removes and returns every item on that belt tile with `pos >= 0.875`.
    - `snake(game, n) -> {start:[x,y], end:[x,y]}` lays n belts in a serpentine.

`stepBelt` algorithm (front item is index 0):
```
for i, it in items:
  limit = i == 0 ? Infinity : items[i-1].pos - spacing        // items[i-1] already moved this tick
  np = min(it.pos + v, limit)
  if i == 0 and np >= 1:
     t = entAt(ahead tile)
     r = t ? offer(game, t, it.item, b.dir, np - 1, 'deadEnd') : BUSY
     if r == OK: remove it; b.blocked = null; restart loop at the new front with limit = Infinity; continue
     np = waitPos
     b.blocked = r == NEVER ? `${name(t)} can't use ${itemName}` : r == STALL ? `${name(t)} is full of ${itemName}` : null
  it.pos = np
(Task 8 adds: side pulls after movement.)
```
Order: Kahn's algorithm on reversed edges. Nodes with no conveyor successors go first, then nodes whose successors are all placed. Any nodes left (cycles) are appended in id order. The pass is iterative, with no recursion.

- [ ] **Step 1: Write the failing test** (`tests/belts.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, drain, snake } from './helpers.js'; import { place } from '../src/game/place.js';
import { tick } from '../src/sim/tick.js'; import { offer, OK, NEVER } from '../src/sim/offer.js';
const line = (g, x, y, n, dir=1) => { for (let i = 0; i < n; i++) place(g, 'belt', x + i, y, {dir}); };
test('an item crosses 10 tiles in ~100 ticks at 2 tiles/s', () => {
  const g = testGame(); line(g, 10, 10, 10); offer(g, g.ents.get(g.grid[10*160+10]), 'gear', 1, 0);
  let t = 0, got = []; while (!got.length && t < 200) { tick(g); t++; got = drain(g, 19, 10); }
  assert.ok(t >= 85 && t <= 100, `t=${t}`);
});
test('throughput is 8 items/s and spacing holds', () => {
  const g = testGame(); line(g, 10, 10, 20); let n = 0;
  for (let t = 0; t < 1200; t++) { feed(g, 10, 10, ['gear']); tick(g); const d = drain(g, 29, 10); if (t >= 200) n += d.length; }
  assert.ok(Math.abs(n - 400) <= 8, `n=${n}`);
});
test('a stopped belt holds exactly 4 per tile', () => {
  const g = testGame(); line(g, 10, 10, 5);
  for (let t = 0; t < 600; t++) { feed(g, 10, 10, ['wire']); tick(g); }
  for (let x = 10; x < 15; x++) assert.equal(g.ents.get(g.grid[10*160+x]).items.length, 4);
});
test('no entry from the front; side entry works', () => {
  const g = testGame(); line(g, 10, 10, 3);
  const b = g.ents.get(g.grid[10*160+11]); assert.equal(offer(g, b, 'gear', 3, 0), NEVER); assert.equal(offer(g, b, 'gear', 2, 0), OK);
});
test('2000-tile belt: no stack overflow, item arrives', () => {
  const g = testGame(); const { start, end } = snake(g, 2000);
  offer(g, g.ents.get(g.grid[start[1]*160+start[0]]), 'gear', g.ents.get(g.grid[start[1]*160+start[0]]).dir, 0);
  let got = []; for (let t = 0; t < 21000 && !got.length; t++) { tick(g); got = drain(g, end[0], end[1]); }
  assert.deepEqual(got, ['gear']);
});
test('Review Focus 4: closed loop conserves items and terminates', () => {
  const g = testGame(); place(g,'belt',10,10,{dir:1}); place(g,'belt',11,10,{dir:2}); place(g,'belt',11,11,{dir:3}); place(g,'belt',10,11,{dir:0});
  for (let i = 0; i < 6; i++) { feed(g, 10, 10, ['gear']); tick(g); }
  for (let t = 0; t < 1000; t++) tick(g);
  const n = [...g.ents.values()].filter(e => e.type === 'belt').reduce((s, e) => s + e.items.length, 0); assert.equal(n, 6);
});
test('belt into the Hub counts toward goals', () => {
  const g = testGame({tier:1}); line(g, 70, 79, 8); // last tile (77,79) points E into hub tile (78,79)
  for (let t = 0; t < 400; t++) { feed(g, 70, 79, ['iron_plate']); tick(g); }
  assert.ok(g.stock.iron_plate > 0); assert.equal(g.prog.iron_plate, g.stock.iron_plate);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/belts.test.js`
Expected: FAIL, because modules are missing.

- [ ] **Step 3: Implement `offer.js`, `order.js`, `belts.js`, `hub.js`, `tick.js`, and the helpers** to the interfaces and algorithm above.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: multi-item belts, offer dispatch, downstream order, hub intake"
```

---

### Task 5: Bridges, tunnels, and belt-path placement with auto-bridge

**Files:**
- Create: `src/sim/pieces.js` (bridge + tunnel parts in this task)
- Modify: `src/sim/offer.js` (dispatch `bridge`, `tunnel_in`, `tunnel_out`), `src/sim/order.js` (their successors), `src/game/place.js` (add `placeTunnel`, `validTunnelExits`, `placeBeltPath`; erasing either tunnel end removes both)
- Test: `tests/pieces-cross.test.js`

**Interfaces:**
- Consumes: `offer`, `acceptBelt` semantics, `rebuildOrder`, `place`.
- Produces:
  - Bridge: `acceptBridge(game, e, item, moveDir, pos)` routes to lane `h` if `moveDir === e.dirH`, lane `v` if `moveDir === e.dirV`, and otherwise returns `NEVER`. Each lane behaves like a belt tile moving in its lane direction. `stepBridge(game, e, v)`.
  - Tunnel: `acceptTunnelIn(game, e, item, moveDir)` accepts only `moveDir === e.dir`, while `under.length < 4*(gap+1)`. Items travel `ceil((gap+1)/v)` ticks underground, then enter `pair` (the `tunnel_out`) when it has room. `tunnel_out` behaves like a belt tile that only accepts from its paired entrance. `stepTunnelIn` and `stepTunnelOut`.
  - `placeTunnel(game, x, y, dir, ex, ey) -> {ok, reason}`: the exit must be straight ahead along `dir`, with tiles between ≥ 1 and ≤ `game.mods.tunnelGap`. Both tiles must be empty, and the building must be unlocked. Reasons: `'Exit must be straight ahead'`, `'Too far for a tunnel'`, `'Tile is occupied'`, `'Unlocks at Tier 3'`.
  - `validTunnelExits(game, x, y, dir) -> [x,y][]`
  - `placeBeltPath(game, path:[x,y][], dirs:number[]) -> {placed, bridges, skipped:[x,y][]}`, applied tile by tile:
    - An empty tile gets a belt with `dirs[i]`.
    - An existing belt has its dir set.
    - An existing belt perpendicular to the path, with the path going straight through (`dirs[i-1] === dirs[i]`, both perpendicular to the belt), is replaced by a bridge whose lanes are the old belt's dir and `dirs[i]`. This carries over the old belt's items into the matching lane, and pushes a `{type:'toast', text:'Bridge placed'}` event once per call. This only happens when bridge is unlocked; otherwise the belt is just re-pointed.
    - An existing bridge gets its matching lane dir set.
    - Anything else is skipped.

- [ ] **Step 1: Write the failing test** (`tests/pieces-cross.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, drain } from './helpers.js'; import { place, placeTunnel, validTunnelExits, placeBeltPath, erase } from '../src/game/place.js';
import { tick } from '../src/sim/tick.js'; import { entAt } from '../src/game/state.js';
const row = (y, x0, x1, dir) => { const p = [], d = []; for (let x = x0; x <= x1; x++) { p.push([x, y]); d.push(dir); } return [p, d]; };
const col = (x, y0, y1, dir) => { const p = [], d = []; for (let y = y0; y <= y1; y++) { p.push([x, y]); d.push(dir); } return [p, d]; };
test('drawing across a belt auto-bridges; both flows cross without mixing', () => {
  const g = testGame(); placeBeltPath(g, ...col(15, 5, 15, 2));
  const r = placeBeltPath(g, ...row(10, 10, 20, 1)); assert.equal(r.bridges, 1); assert.equal(entAt(g, 15, 10).type, 'bridge');
  assert.ok(g.events.some(e => e.text === 'Bridge placed'));
  let H = [], V = [];
  for (let t = 0; t < 1500; t++) { feed(g, 10, 10, ['iron_plate']); feed(g, 15, 5, ['copper_plate']); tick(g); H.push(...drain(g, 20, 10)); V.push(...drain(g, 15, 15)); }
  assert.ok(H.length > 400 && V.length > 400); assert.ok(H.every(i => i === 'iron_plate')); assert.ok(V.every(i => i === 'copper_plate'));
});
test('tunnel passes items under a machine; range limits and exits', () => {
  const g = testGame(); place(g, 'assembler', 62, 59, {recipe:'gear'});
  assert.equal(placeTunnel(g, 60, 60, 1, 66, 60).reason, 'Too far for a tunnel');
  assert.equal(placeTunnel(g, 60, 60, 1, 64, 61).reason, 'Exit must be straight ahead');
  assert.deepEqual(validTunnelExits(g, 60, 60, 1), [[62,60],[63,60],[64,60],[65,60]].filter(([x,y]) => !entAt(g, x, y)));
  assert.equal(placeTunnel(g, 60, 60, 1, 65, 60).ok, true);
  placeBeltPath(g, ...row(60, 57, 59, 1)); placeBeltPath(g, ...row(60, 66, 70, 1));
  let out = []; for (let t = 0; t < 1000; t++) { feed(g, 57, 60, ['gear']); tick(g); out.push(...drain(g, 70, 60)); }
  assert.ok(out.length > 250);
});
test('Review Focus 3: erasing a tunnel end with items underground removes both ends, no crash', () => {
  const g = testGame(); placeTunnel(g, 60, 60, 1, 64, 60); placeBeltPath(g, ...row(60, 57, 59, 1));
  for (let t = 0; t < 60; t++) { feed(g, 57, 60, ['gear']); tick(g); }
  assert.ok(entAt(g, 60, 60).under.length > 0);
  erase(g, 64, 60); assert.equal(entAt(g, 60, 60), null); assert.equal(entAt(g, 64, 60), null);
  for (let t = 0; t < 100; t++) tick(g);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/pieces-cross.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the bridge, tunnel, `placeTunnel`, `validTunnelExits`, and `placeBeltPath`** to the interfaces above. A `place(g,'tunnel',…)` call with `opts.exit:[ex,ey]` delegates to `placeTunnel`, so undo records both ends.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bridges, tunnels, belt paths with auto-bridge"
```

---

### Task 6: Splitter, merger, storage box

**Files:**
- Modify: `src/sim/pieces.js` (splitter, merger), `src/sim/machines.js` (create it; storage intake and output only), `src/sim/offer.js`, `src/sim/order.js`, `src/sim/tick.js` (step `game.machines` before conveyors)
- Test: `tests/pieces-split.test.js`

**Interfaces:**
- Produces:
  - `acceptSplitter(game, e, item, moveDir)`: only from the back (`moveDir === e.dir`), and only when `hold` is null. `stepSplitter` moves `hold` across the tile, then offers it to the left, front, and right outputs in round-robin order starting at `rr`, skipping outputs that refuse. An "output" is the neighbor tile in that direction.
  - `acceptMerger(game, e, item, moveDir)`: only from the left, back, or right (`moveDir !== (e.dir+2)%4`), and only when `hold` is null. Fairness: accept from input side `s` only if `s === e.turn`, or if the belt on side `e.turn` has no item at `pos >= waitPos - v`. After accepting, set `turn` to the next side in left → back → right order. `stepMerger` outputs to the front.
  - `acceptStorage(game, e, item, moveDir, mode)` accepts any item from `'deadEnd'` while `queue.length < game.mods.storageCap`. It returns `BUSY` when full and `NEVER` for `'handoff'` or `'passBy'`. `stepStorage` offers `queue[0]` round-robin to output ports.
  - `outputPorts(game, ent) -> {node, dir}[]` (in `machines.js`) returns the conveyor nodes adjacent to `ent`'s edges whose entry direction equals the outward `dir`: a belt or `tunnel_in` with `node.dir === dir`, a splitter or merger accepting from that side, or a bridge with `dirH === dir` or `dirV === dir`. These are cached per entity and recomputed when `topoDirty`.

- [ ] **Step 1: Write the failing test** (`tests/pieces-split.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, drain } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
test('splitter divides evenly across 3 outputs, and all to the open ones', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'splitter',10,10,{dir:1});
  place(g,'belt',10,9,{dir:0}); place(g,'belt',11,10,{dir:1}); place(g,'belt',10,11,{dir:2});
  const c = {u:0,f:0,d:0};
  for (let t = 0; t < 2000; t++) { feed(g,9,10,['gear']); tick(g); c.u += drain(g,10,9).length; c.f += drain(g,11,10).length; c.d += drain(g,10,11).length; }
  const tot = c.u + c.f + c.d; for (const k in c) assert.ok(Math.abs(c[k] - tot/3) <= 2, JSON.stringify(c));
});
test('merger alternates two full inputs', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'belt',10,9,{dir:2}); place(g,'merger',10,10,{dir:1}); place(g,'belt',11,10,{dir:1});
  const out = []; for (let t = 0; t < 800; t++) { feed(g,9,10,['iron_plate']); feed(g,10,9,['copper_plate']); tick(g); out.push(...drain(g,11,10)); }
  const a = out.filter(i => i === 'iron_plate').length, b = out.length - a; assert.ok(out.length > 100 && Math.abs(a - b) <= 2, `${a}/${b}`);
});
test('storage buffers mixed items FIFO up to cap, then outputs', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); const s = place(g,'storage',10,10);
  for (let t = 0; t < 3000; t++) { feed(g,9,10,['gear','wire']); tick(g); }
  assert.equal(s.queue.length, 200); assert.deepEqual(s.queue.slice(0,2), ['gear','wire']);
  place(g,'belt',12,10,{dir:1}); const out = []; for (let t = 0; t < 40; t++) { tick(g); out.push(...drain(g,12,10)); }
  assert.deepEqual(out.slice(0,2), ['gear','wire']);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/pieces-split.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the splitter, merger, storage, and `outputPorts`**, and add the machines step to `tick`.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: splitter, merger, storage box"
```

---

### Task 7: Miners, crafters, outputs, hand-off

**Files:**
- Modify: `src/sim/machines.js`, `src/sim/offer.js` (dispatch crafters and generator to `acceptMachine`)
- Test: `tests/machines.test.js`

**Interfaces:**
- Consumes: `outputPorts`, `offer`, `game.mods`, `RECIPES`.
- Produces:
  - `acceptMachine(game, m, item, moveDir, pos, mode) -> 0|1|2|3`. In this task it uses the normal cap only (Task 8 adds overstock and pass-by):
    - A crafter returns `NEVER` if its recipe doesn't use the item. It returns `BUSY` if `buf[item] >= ingBatches*need`, and otherwise `OK`.
    - A furnace with `recipe === null` takes the furnace recipe whose input is `item`, if that recipe is unlocked. It resets to `null` when its buffer, progress, and output are empty. While it's set, another smeltable unlocked ore returns `BUSY`, not `NEVER`, so no false red marker appears. Non-smeltable or locked items return `NEVER`.
    - A generator accepts `coal`, and `fuel_cell` when `tier >= 11`, while total fuel < `genFuelMax`.
  - `stepMachine(game, m)`:
    - A miner produces `minerYield` ore every `round(minerSecFull*TPS*4/tiles/minerMult)` ticks while `out.length < outMax`.
    - A crafter progresses by `speed = (furnace ? furnaceMult : machine in [assembler,fabricator] ? asmMult : 1) * m.pmult` per tick when every ingredient has `buf >= need` and `out.length + r.out <= outMax`. At `prog >= r.sec*TPS` it consumes the ingredients, pushes `r.out` items, and adds them to `stats.made`.
    - Then it pushes `out[0]` once per tick to the first target that accepts, scanning round-robin from `rr` over: `outputPorts` (mode `'deadEnd'`), then adjacent crafters, generators, and the hub via `edgeNeighbors` (mode `'handoff'`).
  - `m.pmult` defaults to 1 (Task 9 sets it).

- [ ] **Step 1: Write the failing test** (`tests/machines.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, setOre, feed, drain, run } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
test('full-coverage miner makes 1 ore/s; 2 tiles makes half', () => {
  const g = testGame(); setOre(g,10,10,2,2,'iron_ore'); setOre(g,20,10,2,1,'iron_ore');
  place(g,'miner',10,10); place(g,'belt',12,10,{dir:1}); place(g,'miner',20,10); place(g,'belt',22,10,{dir:1});
  let a = 0, b = 0; for (let t = 0; t < 1200; t++) { tick(g); a += drain(g,12,10).length; b += drain(g,22,10).length; }
  assert.ok(Math.abs(a - 60) <= 2 && Math.abs(b - 30) <= 2, `${a} ${b}`);
});
test('miner touching furnace hands off; furnace output reaches a belt', () => {
  const g = testGame(); setOre(g,10,10,2,2,'copper_ore'); place(g,'miner',10,10); place(g,'furnace',12,10); place(g,'belt',14,10,{dir:1});
  const out = []; for (let t = 0; t < 1200; t++) { tick(g); out.push(...drain(g,14,10)); }
  assert.ok(out.length >= 30 && out.every(i => i === 'copper_plate'));
});
test('furnace auto-detects, switches ore types, refuses non-smeltables', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); const f = place(g,'furnace',10,10); place(g,'belt',12,10,{dir:1});
  const out = []; for (let t = 0; t < 2000; t++) { feed(g,9,10,['iron_ore','copper_ore']); tick(g); out.push(...drain(g,12,10)); }
  assert.ok(out.includes('iron_plate') && out.includes('copper_plate'));
});
test('assembler crafts gears from a dead-end belt; stats.made counts', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'assembler',10,10,{recipe:'gear'}); place(g,'belt',12,10,{dir:1});
  const out = []; for (let t = 0; t < 400; t++) { feed(g,9,10,['iron_plate']); tick(g); out.push(...drain(g,12,10)); }
  assert.ok(out.length >= 15 && out.every(i => i === 'gear')); assert.ok(g.stats.made.gear >= out.length);
});
test('machine touching the hub delivers straight in', () => {
  const g = testGame(); place(g,'belt',75,79,{dir:1}); place(g,'assembler',76,78,{recipe:'gear'}); // tiles 76-77, touches hub at x=78
  for (let t = 0; t < 600; t++) { feed(g,75,79,['iron_plate']); tick(g); }
  assert.ok(g.stock.gear > 10);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/machines.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the miner, crafters, generator intake, outputs, and hand-off** in `machines.js`.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: miners, crafters, outputs and hand-off"
```

---

### Task 8: No-jam intake: pass-by, overstock, blocked reasons, status

This task is the game's core promise (§1 flaw 1, §6.1). Review it hardest.

**Files:**
- Modify: `src/sim/machines.js` (overstock, `pullPassBy`, `machineStatus`, `clearMachine`), `src/sim/belts.js` (side pulls in `stepBelt`)
- Test: `tests/nojam.test.js`

**Interfaces:**
- Produces:
  - Overstock in `acceptMachine`: when `mode === 'deadEnd'` and the machine is starved (some ingredient has `buf < need`), accept a used item up to `buf[item] < BAL.overstock`. When `buf[item] >= overstock`, return `STALL`.
  - `pullPassBy(game, m, item) -> boolean` uses the normal cap only, for crafters and generators.
  - In `stepBelt`, after movement, check the side neighbors `(b.dir+3)%4` and `(b.dir+1)%4`, starting with `b.side` and alternating. For the first item on the tile that a side machine's `pullPassBy` accepts, remove it. At most one pull per side per tick. The Hub and storage never pull.
  - `machineStatus(game, m) -> string`, checked in this priority order:
    1. `'Output full'`
    2. `` `${buf[k]} ${Name(k)}, waiting for ${Name(missing)}` `` when some ingredient is above its normal cap while another is missing (k is the most-overstocked item)
    3. `` `Waiting for ${Name(missing)}` `` (the first missing ingredient, in recipe order)
    4. `` `No power: 25% speed` `` (powered type with no network)
    5. `` `Low power: ${Math.round(pmult*100)}% speed` `` (pmult < 1)
    6. `'Working'`

    A miner with full output returns `'Output full'`, and otherwise `'Working'`.
  - `clearMachine(game, m)` empties `buf`, `out`, and `prog`.

- [ ] **Step 1: Write the failing test** (`tests/nojam.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed } from './helpers.js'; import { place, erase } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
import { machineStatus, clearMachine } from '../src/sim/machines.js'; import { entAt } from '../src/game/state.js';
test('mixed pass-by belt feeds a 4-ingredient Fabricator for 10,000 ticks, junk passes to the Hub', () => {
  const g = testGame(); const f = place(g,'fabricator',75,78,{recipe:'robot_arm'}); // touches hub at x=78
  for (let x = 70; x <= 77; x++) place(g,'belt',x,77,{dir:1}); place(g,'belt',78,77,{dir:2}); // along top edge, then into hub
  for (let t = 0; t < 10000; t++) { feed(g,70,77,['motor','processor','plastic','plastic','steel','coal']); tick(g); }
  assert.ok(g.stock.robot_arm >= 70, `made ${g.stock.robot_arm}`); assert.ok(g.stock.coal > 100);
  assert.ok(!machineStatus(g, f).includes('waiting for'));
});
test('dead-end merged belt into a Fabricator overstocks instead of stalling (Ironline bug)', () => {
  const g = testGame(); place(g,'belt',39,41,{dir:1}); const f = place(g,'fabricator',40,40,{recipe:'motor'}); place(g,'belt',43,41,{dir:1});
  const seq = [...Array(10).fill('steel'), ...Array(40).fill(0).map((_, i) => i % 2 ? 'gear' : 'wire')];
  for (let t = 0; t < 3000; t++) { feed(g,39,41,seq); tick(g); }
  assert.ok(g.stats.made.motor >= 3); assert.equal(entAt(g,39,41).blocked, null);
});
test('true stall at 99 is named on the belt and in the status; Clear frees it', () => {
  const g = testGame(); place(g,'belt',39,41,{dir:1}); const f = place(g,'fabricator',40,40,{recipe:'motor'});
  for (let t = 0; t < 2000; t++) { feed(g,39,41,['steel']); tick(g); }
  assert.equal(f.buf.steel, 99); assert.equal(entAt(g,39,41).blocked, 'Fabricator is full of Steel');
  assert.equal(machineStatus(g, f), '99 Steel, waiting for Gear');
  clearMachine(g, f); tick(g); tick(g); assert.ok(f.buf.steel >= 1 && f.buf.steel < 99);
});
test('wrong item on a dead-end belt is blocked with a reason', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'furnace',10,10);
  for (let t = 0; t < 100; t++) { feed(g,9,10,['coal']); tick(g); }
  assert.equal(entAt(g,9,10).blocked, "Furnace can't use Coal");
});
test('Review Focus 3: erasing the machine a belt is blocked on clears the block, no crash', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'furnace',10,10);
  for (let t = 0; t < 100; t++) { feed(g,9,10,['coal']); tick(g); }
  erase(g,10,10); for (let t = 0; t < 10; t++) tick(g); assert.equal(entAt(g,9,10).blocked, null);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/nojam.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the overstock, pass-by pulls, `machineStatus`, and `clearMachine`.** `blocked` resets to null whenever the front item isn't waiting on a refusing target, including when the target is gone.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: no-jam intake (pass-by, overstock, blocked reasons, status)"
```

---

### Task 9: Power

**Files:**
- Create: `src/sim/power.js`
- Modify: `src/sim/tick.js` (`if powerDirty rebuildPower`, then `stepPower` before machines)
- Test: `tests/power.test.js`

**Interfaces:**
- Produces:
  - `rebuildPower(game)`: networks are found with union-find over generators and poles. Two nodes join if the Chebyshev distance between their footprint centers is ≤ `mods.poleReach`. A node's coverage is its footprint grown by `mods.coverHalf` on every side.
    - Each consumer (any entity with `BUILDINGS[type].power > 0`) gets `net` = the lowest id of a network whose coverage intersects its footprint, or `-1` if none.
    - The function sets `game.nets = [{id, gens:[], consumers:[], demand}]` and clears `powerDirty`.
  - `stepPower(game)`, for each network:
    - When demand > 0, each generator with `burn === 0` burns a fuel cell if it has one, and otherwise a coal. A fuel cell sets `burn = cellSec*TPS` and `burnPower = cellPower`. A coal sets `burn = coalSec*TPS` and `burnPower = coalPower*mods.genMult`.
    - Supply is the sum of `burnPower` over burning generators, and `sat = min(1, supply/demand)`.
    - Consumers get `pmult = unpowered + (1-unpowered)*sat`. Consumers with `net === -1` get `pmult = unpowered`, and burning generators decrement `burn`.

- [ ] **Step 1: Write the failing test** (`tests/power.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
test('one generator fully powers a foundry through a pole; six are 87.5%', () => {
  const g = testGame(); const gen = place(g,'generator',10,10); gen.fuel.coal = 10; place(g,'pole',18,10);
  const f = place(g,'foundry',20,12,{recipe:'silicon'}); tick(g); tick(g); assert.equal(f.pmult, 1);
  const more = [[20,8],[16,12],[18,12],[16,8],[14,10]].map(([x,y]) => place(g,'foundry',x,y,{recipe:'silicon'}));
  tick(g); tick(g); assert.ok(Math.abs(f.pmult - (0.25 + 0.75*20/24)) < 1e-9);
});
test('uncovered foundry runs at 25%; fuel runs out → 25%', () => {
  const g = testGame(); const lone = place(g,'foundry',100,100,{recipe:'silicon'}); tick(g); assert.equal(lone.pmult, 0.25);
  const gen = place(g,'generator',10,10); gen.fuel.coal = 2; const f = place(g,'foundry',12,10,{recipe:'silicon'});
  for (let t = 0; t < 170; t++) tick(g); assert.equal(gen.fuel.coal, 0); assert.equal(f.pmult, 0.25);
});
test('generators do not burn with no demand', () => {
  const g = testGame(); const gen = place(g,'generator',10,10); gen.fuel.coal = 5; for (let t = 0; t < 400; t++) tick(g); assert.equal(gen.fuel.coal, 5);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/power.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `power.js`** and wire it into `tick`.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: power networks, coverage, satisfaction"
```

---

### Task 10: Tiers, research, mods

**Files:**
- Modify: `src/game/progress.js`, `src/sim/hub.js` (call `checkTier` after a goal delivery)
- Test: `tests/progress.test.js`

**Interfaces:**
- Produces:
  - `checkTier(game)`: when every current goal is met, it does `tier++`, `prog = {}`, and pushes `{type:'tierUp', tier:newTier}`. When tier 12 completes, it sets `tier = 13`, `completedAt = stats.playTicks`, and pushes `{type:'complete'}` instead. `tier === 13` is sandbox mode, and `isUnlocked` treats it as everything unlocked.
  - `researchState(game, id) -> {can:boolean, reason:string|null}`. The reasons are `'Already researched'`, `` `Unlocks at Tier ${n}` ``, `` `Needs ${reqName}` ``, and `'Not enough items'`.
  - `buyResearch(game, id) -> {ok, reason}` deducts the cost from `stock`, sets `research[id] = true`, calls `recalcMods`, and pushes `{type:'research', id}`.
  - `recalcMods(game)` builds mods from `defaultMods()`. Numeric `+x` effects add. Absolute values (`tunnelGap`, `storageCap`, `genMult`, `poleReach`, `coverHalf`, `minerYield`) replace. It sets `powerDirty` and `topoDirty`.
  - `anyResearchAffordable(game) -> boolean`

- [ ] **Step 1: Write the failing test** (`tests/progress.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame } from './helpers.js'; import { acceptHub } from '../src/sim/hub.js';
import { buyResearch, researchState, isUnlocked } from '../src/game/progress.js'; import { TIERS, RESEARCH } from '../src/config.js';
test('delivering all goals advances the tier and resets progress', () => {
  const g = testGame({tier:1});
  for (const [k, n] of Object.entries(TIERS[0].goals)) for (let i = 0; i < n; i++) acceptHub(g, k);
  assert.equal(g.tier, 2); assert.deepEqual(g.prog, {}); assert.ok(g.events.some(e => e.type === 'tierUp' && e.tier === 2));
  assert.ok(isUnlocked(g, 'buildings', 'assembler'));
});
test('finishing tier 12 enters sandbox and reports completion', () => {
  const g = testGame({tier:12}); for (let i = 0; i < TIERS[11].goals.fusion_core; i++) acceptHub(g, 'fusion_core');
  assert.equal(g.tier, 13); assert.ok(g.events.some(e => e.type === 'complete')); assert.ok(isUnlocked(g, 'recipes', 'fusion_core'));
});
test('research gates, costs, and effects', () => {
  const g = testGame({tier:3});
  assert.equal(researchState(g, 'miner2').reason, 'Unlocks at Tier 4');
  assert.equal(researchState(g, 'miner1').reason, 'Not enough items');
  const c = RESEARCH.find(r => r.id === 'miner1').cost.iron_plate;
  g.stock.iron_plate = c + 1; assert.equal(buyResearch(g, 'miner1').ok, true); assert.equal(g.stock.iron_plate, 1);
  assert.ok(Math.abs(g.mods.minerMult - 1.4) < 1e-9); assert.equal(researchState(g, 'miner1').reason, 'Already researched');
  g.tier = 4; g.research = {}; g.stock = {steel:99, gear:99}; assert.equal(researchState(g, 'miner2').reason, 'Needs Faster Miners I');
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/progress.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the progression functions** above.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tiers, sandbox, research and mods"
```

---

### Task 11: Save, save codes, stores

**Files:**
- Create: `src/save/serialize.js`, `src/save/code.js`, `src/save/stores.js`
- Test: `tests/save.test.js`

**Interfaces:**
- Produces:
  - `serialize(game) -> object`, with shape `{v:1, savedAt:number, seed, tier, prog, stock, research, tick, stats, settings, completedAt, ents:[...]}`. Each entity is an array starting `[type, x, y, dir]`, followed by its per-type state.
    - Belt item `pos` values are rounded to 3 decimals, and the hub is omitted.
    - Undo, events, and caches are not saved.
  - `deserialize(obj) -> Game` regenerates the world from the seed and rebuilds the entities.
    - It throws `Error('Save is from a newer version')` if `v > 1`, and `Error('Save is damaged')` on a malformed shape.
    - Unknown entity types are skipped.
  - `tryLoad(obj) -> {ok:true, game}|{ok:false, reason}` never throws.
  - `encodeSaveCode(obj) -> Promise<string>` produces `'SR1.' + base64url(deflate-raw(JSON))`, using `CompressionStream` (present in Node 22 and iOS 16.4+).
  - `decodeSaveCode(str) -> Promise<object>` rejects with `Error('Not a Steelreach save code')` on anything invalid. It trims whitespace first.
  - `createLocalStore(key='steelreach') -> {name:'local', load():Promise<obj|null>, save(obj):Promise<void>}` stores the save code string. Any storage exception results in `null` or a no-op.
  - `createClaudeStore(claude=window.claude, docName='steelreach', timeoutMs=10000) -> Promise<store|null>`:
    - It does `await claude.use('db')` and `await claude.use('user')`. If either is null, it resolves null.
    - The doc is `db.collection('data/users/'+await user.id()).doc(docName)`.
    - `load` reads the `{code, savedAt}` fields and races `get()` against the timeout, resolving `null` on timeout or error.
    - `save` does `set({code, savedAt})`, allowing one write at a time and queueing only the latest.
  - `loadBest(stores, timeoutMs=10000) -> Promise<obj|null>` returns the decoded save with the newest `savedAt`. A store that errors or times out is ignored.
  - `createSaver({stores, snapshot:() => obj, intervalMs=BAL.autosaveMs, now=Date.now}) -> {maybeSave():Promise<void>, flush():Promise<void>}`. `maybeSave` saves when `intervalMs` have elapsed since the last save, and `flush` saves immediately.

- [ ] **Step 1: Write the failing test** (`tests/save.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, setOre } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
import { serialize, deserialize, tryLoad } from '../src/save/serialize.js'; import { encodeSaveCode, decodeSaveCode } from '../src/save/code.js';
import { createClaudeStore, loadBest } from '../src/save/stores.js';
const strip = s => { const o = structuredClone(s); delete o.savedAt; return o; };
function busyGame() { const g = testGame(); setOre(g,10,10,2,2,'iron_ore'); place(g,'miner',10,10); place(g,'furnace',12,10);
  for (let x = 14; x < 30; x++) place(g,'belt',x,10,{dir:1}); place(g,'tunnel',30,10,{dir:1, exit:[33,10]});
  for (let t = 0; t < 500; t++) tick(g); return g; }
test('round trip is exact, and simulation continues identically', () => {
  const g = busyGame(); const s = serialize(g), h = deserialize(s);
  assert.deepEqual(strip(serialize(h)), strip(s));
  for (let t = 0; t < 300; t++) { tick(g); tick(h); } assert.deepEqual(strip(serialize(h)), strip(serialize(g)));
});
test('save codes round trip', async () => { const s = serialize(busyGame()); assert.deepEqual(await decodeSaveCode(' ' + await encodeSaveCode(s) + '\n'), s); });
test('Review Focus 1: garbage, foreign, damaged and newer saves never throw from tryLoad', async () => {
  for (const bad of ['hello', 'SR1.!!!', 'SR1.' + Buffer.from('{}').toString('base64url'), '']) await assert.rejects(decodeSaveCode(bad), /Not a Steelreach save code/);
  assert.deepEqual(tryLoad({v:99}), {ok:false, reason:'Save is from a newer version'});
  assert.deepEqual(tryLoad({v:1, seed:'x', ents:'nope'}), {ok:false, reason:'Save is damaged'});
  assert.equal(tryLoad(null).ok, false);
});
test('Review Focus 5: claude unavailable or slow never blocks loading', async () => {
  assert.equal(await createClaudeStore({ use: async () => null }), null);
  const never = { name:'claude', load: () => new Promise(() => {}) }, broken = { name:'x', load: async () => { throw new Error('offline'); } };
  const local = { name:'local', load: async () => ({ v:1, savedAt: 5 }) };
  const t0 = Date.now(); assert.equal((await loadBest([never, broken, local], 50)).savedAt, 5); assert.ok(Date.now() - t0 < 1000);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/save.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `serialize.js`, `code.js`, and `stores.js`.** Use `JSON.stringify` key order as written, so the deep-equal comparisons stay stable.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: save/load, save codes, local and account stores"
```

---

### Task 12: Rendering

**Files:**
- Create: `src/render/camera.js`, `src/render/terrain.js`, `src/render/shapes.js`, `src/render/draw.js`
- Test: `tests/render.test.js`

**Interfaces:**
- Produces:
  - `createCamera(viewW, viewH) -> cam`, with shape `{x, y, z, vw, vh}`. `x, y` is the world point (in tiles) at the screen center, and `z` is pixels per tile. It starts at `z = TILE`, centered on (80, 80).
  - `worldToScreen(cam, wx, wy) -> [sx, sy]`, where world units are tiles
  - `screenToWorld(cam, sx, sy) -> [wx, wy]`
  - `screenToTile(cam, sx, sy) -> [tx, ty]` (integers)
  - `zoomAt(cam, factor, sx, sy)` keeps the world point under `(sx, sy)` fixed and clamps `z` to `[ZOOM_MIN_PX, ZOOM_MAX_PX]`.
  - `panBy(cam, dx, dy)` and `clampCam(cam)` keep the map in view, allowing up to 3 tiles past the edge.
  - `visibleTiles(cam) -> {x0, y0, x1, y1}`
  - `createTerrain(world) -> {draw(ctx, cam, theme)}` caches 32×32-tile chunks at two resolutions: 16 px per tile when `z < 28`, otherwise 48 px. Lock badges are not cached.
  - `drawFrame(ctx, game, cam, alpha, view, theme)`. `view` is `{ghost, beltPreview, tunnelExits, powerOverlay, selected, magnifier}`, and `alpha` ∈ [0, 1) is the fraction toward the next tick. The draw order is:
    1. terrain
    2. lock badges on locked-ore patches (padlock + `T${n}`)
    3. belts and pieces, with curved corners
    4. items
    5. machines, with a working animation only while `prog` advanced this tick, plus the Hub pulse while `game.tick - game.hubPulse < 10`
    6. status icons (missing input, output full, no power)
    7. red blocked markers
    8. power overlay
    9. ghost and previews
  - Overview mode applies when `z < 20`: buildings become colored blocks and belts become 2 px lines, with no items drawn.
  - Items are interpolated: render `pos + min(v*alpha, room ahead)`.
  - `readTheme() -> theme` reads CSS custom properties (`--bg`, `--ground`, `--belt`, `--text`, `--warn`, `--bad`, `--accent`, …) and is re-read on `prefers-color-scheme` change.

- [ ] **Step 1: Write the failing test** (`tests/render.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createCamera, worldToScreen, screenToWorld, screenToTile, zoomAt, visibleTiles } from '../src/render/camera.js';
import { drawFrame } from '../src/render/draw.js'; import { testGame } from './helpers.js'; import { place } from '../src/game/place.js';
const mockCtx = () => { const calls = { n: 0 }; return [new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'measureText' ? () => ({width:10}) : () => { calls.n++; }), set: (t, k, v) => (t[k] = v, true) }), calls]; };
test('camera round-trips and zooms around the finger', () => {
  const c = createCamera(390, 700); const [sx, sy] = worldToScreen(c, 80, 80); const [wx, wy] = screenToWorld(c, sx, sy);
  assert.ok(Math.abs(wx - 80) < 1e-9 && Math.abs(wy - 80) < 1e-9); assert.equal(c.z, 44);
  const before = screenToWorld(c, 100, 200); zoomAt(c, 1.5, 100, 200); const after = screenToWorld(c, 100, 200);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  zoomAt(c, 100, 0, 0); assert.equal(c.z, 72); zoomAt(c, 0.001, 0, 0); assert.equal(c.z, 16);
  assert.deepEqual(screenToTile(c, ...worldToScreen(c, 10.5, 20.5)), [10, 20]);
});
test('drawFrame culls off-screen work', () => {
  const g = testGame(); for (let x = 0; x < 40; x++) place(g, 'belt', x, 5, {dir:1});
  const c = createCamera(390, 700); const theme = new Proxy({}, { get: () => '#888' });
  const [ctx1, near] = mockCtx(); c.x = 20; c.y = 5; drawFrame(ctx1, g, c, 0, {}, theme);
  const [ctx2, far] = mockCtx(); c.x = 140; c.y = 140; drawFrame(ctx2, g, c, 0, {}, theme);
  assert.ok(near.n > far.n + 20);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/render.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the camera, terrain chunk cache, shapes, and `drawFrame`.** Terrain chunk canvases use `OffscreenCanvas` when present, and otherwise `document.createElement('canvas')`. In Node (no canvas), `createTerrain` returns a no-op drawer. Keep the look flat and clean, in the style of Ironline (§3).

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: renderer with chunk cache, overview, interpolation"
```

---

### Task 13: Gestures, paths, and tools

**Files:**
- Create: `src/input/gestures.js`, `src/input/paths.js`, `src/input/tools.js`
- Test: `tests/input.test.js`

**Interfaces:**
- Produces:
  - `createGestures(h) -> {down(p), move(p), up(p), cancel(p)}`, where `p = {id, x, y, t}`. It calls `h.tap(x,y)`, `h.doubleTap(x,y)` (second tap within 300 ms and 24 px), `h.dragStart/dragMove/dragEnd(x,y)` (after 8 px of movement), `h.dragCancel()`, and `h.pinch({cx, cy, scale, dx, dy})`.
    - `tap` fires on every lift that wasn't a drag. A second tap within the window fires `doubleTap` instead of `tap`. The move that crosses 8 px fires `dragStart` and then `dragMove`.
    - A second pointer during a drag calls `dragCancel` and then pinch events.
    - Pinch ends when fewer than 2 pointers remain. A lone remaining finger does not start a new drag until it lifts.
  - `dragPath(cells:[x,y][]) -> [x,y][]` removes consecutive duplicates and fills diagonal steps by inserting the horizontal step first.
  - `lPath(a:[x,y], b:[x,y], flip=false) -> [x,y][]` goes horizontal then vertical, or vertical then horizontal when flipped. Both ends are included.
  - `pathDirs(path, singleDir=1) -> dir[]` gives each tile the direction toward the next tile. The last tile repeats the previous direction, and a single tile gets `singleDir`. Tools pass the last rotation the player chose.
  - `createTools({game, cam, ui, sfx}) -> {setTool(id), tool, gestures, rotate(), confirm(), cancel(), flip(), view}`. The tool ids match `BUILDINGS` keys plus `'pan'` and `'erase'`. Behavior per tool:
    - **pan:** drag pans, tap inspects via `ui.inspect(ent)`, and pinch zooms.
    - **belt:** drag shows a live preview, and `dragEnd` calls `doAction(() => placeBeltPath(…))`. A double-tap sets the two-tap start; the next tap previews `lPath`, and `confirm()` places it. Edge auto-pan applies when the finger is within 32 px of a screen edge during a drag. `view.magnifier = {x, y, tile}` while dragging.
    - **machines:** a tap sets `view.ghost = {type, x, y, ok, reason}`, a drag moves it, and `confirm()` places it with `doAction`.
    - **tunnel:** the first tap sets the entrance and `view.tunnelExits`. Tapping a highlighted exit places it.
    - **erase:** tap or drag erases, as one action per gesture.
    - **bridge:** `rotate()` cycles the four `(dirH, dirV)` combinations. Splitters and mergers rotate through the four directions.
    - `view.powerOverlay` is true while the Pole or Generator tool is active, or when the Menu toggle is on.

- [ ] **Step 1: Write the failing test** (`tests/input.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createGestures } from '../src/input/gestures.js'; import { dragPath, lPath, pathDirs } from '../src/input/paths.js';
import { createTools } from '../src/input/tools.js'; import { createCamera, worldToScreen } from '../src/render/camera.js';
import { testGame } from './helpers.js';
const rec = () => { const log = []; return [log, new Proxy({}, { get: (_, k) => (...a) => log.push(k) })]; };
test('tap, double tap, drag', () => {
  const [log, h] = rec(); const g = createGestures(h);
  g.down({id:1,x:10,y:10,t:0}); g.up({id:1,x:10,y:10,t:50}); g.down({id:1,x:12,y:11,t:200}); g.up({id:1,x:12,y:11,t:250});
  g.down({id:1,x:0,y:0,t:1000}); g.move({id:1,x:30,y:0,t:1050}); g.up({id:1,x:30,y:0,t:1100});
  assert.deepEqual(log, ['tap', 'doubleTap', 'dragStart', 'dragMove', 'dragEnd']);
});
test('paths', () => {
  assert.deepEqual(dragPath([[0,0],[0,0],[1,1]]), [[0,0],[1,0],[1,1]]);
  assert.deepEqual(lPath([0,0],[2,1]), [[0,0],[1,0],[2,0],[2,1]]); assert.deepEqual(lPath([0,0],[2,1],true), [[0,0],[0,1],[1,1],[2,1]]);
  assert.deepEqual(pathDirs([[0,0],[1,0],[1,1]]), [1,2,2]);
});
test('Review Focus 2: second finger mid belt-drag cancels without placing belts', () => {
  const game = testGame(); const cam = createCamera(390, 700); const t = createTools({ game, cam, ui: { inspect(){}, toast(){} }, sfx: { play(){} } });
  t.setTool('belt'); const [ax, ay] = worldToScreen(cam, 79.5, 76.5), [bx] = worldToScreen(cam, 84.5, 76.5);
  t.gestures.down({id:1,x:ax,y:ay,t:0}); t.gestures.move({id:1,x:bx,y:ay,t:100});
  t.gestures.down({id:2,x:ax,y:ay+80,t:150}); t.gestures.move({id:2,x:ax,y:ay+140,t:200});
  t.gestures.up({id:2,x:ax,y:ay+140,t:250}); t.gestures.up({id:1,x:bx,y:ay,t:300});
  assert.equal([...game.ents.values()].filter(e => e.type === 'belt').length, 0);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/input.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the gestures, paths, and tools** to the interfaces above.

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: gestures, belt paths, two-tap belt, tools"
```

---

### Task 14: UI shell, sheets, and focus mode

**Files:**
- Create: `src/ui/format.js`, `src/ui/ui.js`
- Modify: `src/index.html` (DOM skeleton), `src/styles.css`
- Test: `tests/format.test.js`

**Interfaces:**
- Produces (`format.js`, pure):
  - `goalLines(game) -> [{item, name, have, need}]`
  - `tierLabel(game) -> 'Tier 3 · Circuits' | 'Sandbox mode'`
  - `formatDuration(ticks) -> '5h 12m'`
  - `topMade(stats) -> {item, name, count}|null`
- Produces (`ui.js`): `createUI({root, game, tools, sfx, actions}) -> {render(), inspect(ent), toast(text), showWelcome(onContinue, onNew), showTierUp(tier), showComplete(), sync()}`. `actions` = `{newGame(), copySaveCode(), loadSaveCode(text), setSfx(on), perf()}`. The UI pieces are:
  - **Top bar:** the tier pill (opens Goals), a goal progress strip with items/min, Research (badge when `anyResearchAffordable`), Menu.
  - **Bottom build bar:** a horizontally scrolling tool list in the order Pan, Belt, Bridge, Tunnel, Splitter, Merger, Storage, Miner, Furnace, Assembler, Fabricator, Foundry, Refinery, Generator, Pole, Erase. Locked tools show a padlock and toast `Unlocks at Tier N`, and newly unlocked tools show a "new" dot. Beside the list sit Rotate (for directional pieces), Undo, a recipe chip for assembler, fabricator, and foundry, and ✓/✕ when there's a pending ghost or two-tap preview.
  - **Sheets** (bottom sheets, one at a time):
    - Goals & Hub storage.
    - Research list, with buy buttons and `researchState` reasons.
    - Inspector:
      - for a machine: recipe picker, ingredient buffers with overstock highlighted, progress, `machineStatus`, and a Clear button
      - for a belt: items and the blocked reason
      - for storage: contents and an Empty button
      - for a generator: fuel and network supply/demand
    - Menu: Sound on/off, Focus mode, Copy save code, Load save code (textarea + Load, with confirm "Tap again to replace your game"), Performance (fps, tick ms, buildings, items), New game (two-tap confirm "Tap again to start over").
    - Welcome: Continue / New game.
    - First-run hint card (new game only, dismissible): "Put a Miner on ore, a Furnace touching it, then draw a Belt from the Furnace into the Hub." 
    - Tier-up: what unlocked, plus Continue.
    - Factory complete: play time, items made, top item, plus Keep building.
  - **Focus mode** toggles `body.focus`, which hides `#top` and `#bar` and shows a floating restore button.
  - **Toasts** last 1.8 s.

- [ ] **Step 1: Write the failing test** (`tests/format.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { goalLines, tierLabel, formatDuration, topMade } from '../src/ui/format.js'; import { testGame } from './helpers.js'; import { TIERS } from '../src/config.js';
test('format helpers', () => {
  const g = testGame({tier:3}); g.prog.circuit = 12;
  assert.deepEqual(goalLines(g).find(l => l.item === 'circuit'), {item:'circuit', name:'Circuit', have:12, need:TIERS[2].goals.circuit});
  assert.equal(tierLabel(g), 'Tier 3 · Circuits'); g.tier = 13; assert.equal(tierLabel(g), 'Sandbox mode');
  assert.equal(formatDuration(20 * 60 * 312), '5h 12m'); assert.equal(formatDuration(20 * 59), '0m');
  assert.deepEqual(topMade({made:{gear:5, wire:9}}), {item:'wire', name:'Wire', count:9}); assert.equal(topMade({made:{}}), null);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/format.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `format.js`, then `ui.js`, the DOM skeleton, and the styles.** Every tap target is at least 44×44 CSS px. Keep Ironline's general feel (§13).

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: UI shell, sheets, focus mode"
```

---

### Task 15: Sound effects

**Files:**
- Create: `src/audio.js`
- Test: `tests/audio.test.js`

**Interfaces:**
- Produces: `createSfx({enabled=true}={}) -> {play(name), setEnabled(bool), enabled, unlock()}`.
  - `name` ∈ `place erase undo tick tierUp research warn tap`.
  - Sounds are synthesized with Web Audio oscillators and envelopes. The AudioContext is created lazily in `unlock()`, which must be called from a user gesture, and is resumed if suspended.
  - With no `AudioContext` available, everything is a silent no-op.
  - `tick` is rate-limited to 1 per 40 ms.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createSfx } from '../src/audio.js';
test('silent no-op without Web Audio', () => { const s = createSfx(); s.unlock(); for (const n of ['place','erase','undo','tick','tierUp','research','warn','tap']) s.play(n);
  s.setEnabled(false); assert.equal(s.enabled, false); });
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/audio.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `audio.js`.**

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: generated sound effects"
```

---

### Task 16: Loop, boot, and both targets wired

**Files:**
- Create: `src/loop.js`
- Modify: `src/main.js` (replace the placeholder)
- Test: `tests/loop.test.js`

**Interfaces:**
- Produces:
  - `createLoop({step, render, tps=TPS, raf=requestAnimationFrame, now=performance.now, isHidden=() => document.hidden}) -> {start(), stop()}`. Each frame it runs `floor(acc*tps)` steps (at most 5 per frame, discarding the excess), then `render(alpha)`. While hidden it runs no steps and resets the accumulator.
  - The boot sequence in `main.js`:
    1. Build the UI, camera, tools, and sfx.
    2. `local = createLocalStore()`, then `loadBest([local], 0)`.
    3. If that returns a save with progress (tier > 1 or any entities), call `tryLoad` and show Welcome (Continue / New game). Otherwise start `createGame(randomSeed)` and show the first-run hint.
    4. If `__TARGET__ === 'artifact'`, call `createClaudeStore()` in the background. When it resolves, load the account save. If that save is newer, and the player has placed nothing since opening, load it and toast "Progress restored from your account".
    5. Create a saver over `[local, claudeStore?]`. Call `maybeSave()` every frame, and `flush()` on `visibilitychange` (hidden) and `pagehide`.
  - Event draining each frame: `game.events` routes to sfx and UI. `tierUp` → `showTierUp` + `tierUp` sound. `research` → `research` sound. `complete` → `showComplete`. `toast` → `toast`.
  - `pointerdown` calls `sfx.unlock()`, and touch-action is `none` on the canvas.
  - Debug hook: when `location.hash === '#debug'`, set `window.__steelreach = {game, cam, tools, stress(nBuildings, nItems), fps():number, tickMs():number}`. `stress` fills a far-ring area with belt loops and machines up to the counts.

- [ ] **Step 1: Write the failing test** (`tests/loop.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createLoop } from '../src/loop.js';
test('fixed 20 tps, max 5 steps per frame, nothing while hidden', () => {
  let now = 0, cb, hidden = false, steps = 0, frames = 0;
  const l = createLoop({ step: () => steps++, render: () => frames++, raf: f => (cb = f), now: () => now, isHidden: () => hidden });
  l.start(); for (let i = 0; i < 60; i++) { now += 1000 / 60; cb(now); }
  assert.ok(Math.abs(steps - 20) <= 1, `steps=${steps}`);
  now += 5000; cb(now); assert.ok(steps <= 26);
  hidden = true; const s0 = steps; for (let i = 0; i < 60; i++) { now += 1000 / 60; cb(now); } assert.equal(steps, s0);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/loop.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `loop.js` and the full `main.js`.**

- [ ] **Step 4: Run the tests and build**

Run: `npm test && npm run build`
Expected: PASS, with both `dist/` targets written.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: game loop, boot, saves wired for artifact and home targets"
```

---

### Task 17: Balance pass

Deviation from §12, flagged: §12 asks for a scripted factory that plays all 12 tiers. Laying out 12 tiers of factory by script would cost more than all the other tests combined. Instead, this task measures each recipe's real throughput in the simulation and feeds those rates into a pacing model. It answers the same question, time per tier, from real sim numbers.

**Files:**
- Create: `tools/balance.mjs`, `docs/balance.md` (generated)
- Modify: `src/config.js` (tuned numbers only)
- Test: `tests/balance.test.js`

**Interfaces:**
- Produces: `measureModules() -> {[recipe]: itemsPerMin}` and `estimate(config) -> {tiers:[{tier, minutes}], totalMinutes}`, both exported from `tools/balance.mjs`. Running the script directly writes `docs/balance.md`.
  - **Measuring:** for each recipe, `measureModules` builds a minimal working module in an empty `testGame` and runs the real sim for 6,000 ticks. A module is miners on ore, then furnaces, then the crafter, with belts and hand-offs as needed, and items drained at the end. It reports steady-state output per minute, with research applied as owned at that tier per `ASSUMED_RESEARCH`.
  - **Estimating:** per tier, `minutes = buildAllowance[t] + haul[t] + goals / (modules[t] × rate)`, where:
    - `modules = [1,1,2,2,2,3,3,4,4,5,5,6]` is the number of parallel modules a typical player runs at each tier
    - `buildAllowance = [6,7,8,9,12,12,14,14,16,16,18,18]` minutes
    - `haul[t]` = (ring distance of the tier's newest ore − 10 tiles) / belt speed, converted to minutes, for tiers 5, 7, 9, and 11, otherwise 0
  - **Research:** it also reports, per tier, the minutes of that tier's production needed to afford its cheapest available research.

- [ ] **Step 1: Write the failing test** (`tests/balance.test.js`)

```js
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { estimate } from '../tools/balance.mjs';
test('pacing hits the spec: 5–8 h total, early tiers 10–15 min, late 40–50, research within 5 min', () => {
  const e = estimate(); assert.ok(e.totalMinutes >= 300 && e.totalMinutes <= 480, `total ${e.totalMinutes}`);
  for (const t of e.tiers.slice(0, 3)) assert.ok(t.minutes >= 10 && t.minutes <= 15, `T${t.tier} ${t.minutes}`);
  for (const t of e.tiers.slice(8)) assert.ok(t.minutes >= 40 && t.minutes <= 50, `T${t.tier} ${t.minutes}`);
  for (const t of e.tiers) assert.ok(t.researchMinutes <= 5, `T${t.tier} research ${t.researchMinutes}`);
});
```

- [ ] **Step 2: Run it and see where it stands**

Run: `node --test tests/balance.test.js`
Expected: FAIL (module missing), then FAIL with specific tiers out of range once the tool exists.

- [ ] **Step 3: Implement `tools/balance.mjs`, then tune `TIERS[].goals`, `RESEARCH[].cost`, and recipe `sec` in `config.js`** until the test passes. Change no rule from the Global Constraints. Re-run `npm test` after each change, since other tests rely on some of these values.

- [ ] **Step 4: Run it and verify it passes, then write the report**

Run: `npm test && node tools/balance.mjs`
Expected: PASS, and `docs/balance.md` lists minutes per tier and the total.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: balance tooling and tuned pacing"
```

---

### Task 18: Browser check and performance

WebKit can't be downloaded in this workspace (the Playwright browser hosts are blocked), so this check runs on Google Chrome with iPhone emulation. The real WebKit check is Jacob's own phone. Say so in the hand-off.

**Files:**
- Create: `tools/browser-check.mjs`, `docs/screens/*.png` (output)
- Modify: whatever the check finds broken.

**Interfaces:**
- Consumes: the `dist/` builds and the `#debug` hook from Task 16.
- Produces: `npm run check` exits 0 and prints a JSON summary of the form `{fpsIdle, fpsStress, tickMsStress, saveCodeKB}`.

- [ ] **Step 1: Write `tools/browser-check.mjs`.**
  - Install with `npm i -D playwright-core@1.65`, and launch `chromium.launch({executablePath:'/usr/bin/google-chrome', args:['--no-sandbox']})`.
  - Use the context `devices['iPhone 13']` (390×844, dpr 3, `hasTouch`, `isMobile`), first with `colorScheme:'light'` and then `'dark'`.
  - Serve `dist/artifact` and `dist/home` from a `node:http` static server on localhost, and open `index.html#debug`.
  - Checks, each failing the script with a message:
    1. There are no console errors on load.
    2. Screenshots are taken of the first run, the build bar scrolled, the research sheet, the menu, focus mode, and the overview zoom, in light and dark, saved to `docs/screens/`.
    3. Tap Belt, then a touch-drag across 5 tiles, leaves 5 belts in `__steelreach.game`.
    4. A two-finger pinch (CDP `Input.dispatchTouchEvent`) changes `cam.z`.
    5. Placing an assembler shows a ghost, and ✓ places it.
    6. Fps measured over 5 s at idle should be ≥ 55.
    7. After `stress(3000, 10000)`, fps over 5 s should be ≥ 55 and average tick ms ≤ 8.
    8. The save code for the stress factory should be < 300 KB.
    9. Reloading restores the factory: the entity count is equal.
    10. In the home build, `manifest.webmanifest` loads and the page has no external requests (watch `page.on('request')`).

- [ ] **Step 2: Run it**

Run: `npm run build && npm run check`
Expected: exit 0 with the summary. If fps fails, profile `drawFrame` and `tick` first: chunk cache hits, item batching by color, and allocation in hot loops. Switch to WebGL (spec Approach 2) only if 2D still misses after that, and stop to report that before switching.

- [ ] **Step 3: Look at every screenshot** with the Read tool, and fix anything that's misaligned, clipped by safe areas, unreadable in dark mode, or smaller than a 44 px tap target. Then re-run Step 2.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: iPhone-emulated browser check, perf, screenshots"
```

---

### Task 19: Publish the artifact and deploy the Home Screen version

**Files:**
- Modify: none in code. This task records the URLs in `docs/DEPLOY.md`.

- [ ] **Step 1: Publish the artifact.** Call `mcp__claude-artifacts__guide` with topic `pages` if it hasn't been read this session. Then `publish_files` with `files:[{as:'index.html', path:'/home/claude/steelreach/dist/artifact/index.html'}]`, `title:'Steelreach'`, `icon:'factory'`. Record the slug and URL.

- [ ] **Step 2: Declare the save capability.** `declare_capabilities` on that slug with `{db:{}, user:{}}`. This is a new page, so publish first, then declare. Confirm with `read_declaration`.

- [ ] **Step 3: Create the GitHub repo.** Jacob authorized this. Run `gh repo create Jacobt001/steelreach --public --description "Steelreach factory game"`. If `gh` has no valid token (it didn't when this plan was written), ask Jacob to create an empty public repo named `steelreach` on GitHub and wait. Then call `mcp__claude-code-remote__add_repo` with `owner:'Jacobt001', repo:'steelreach', access:'push'` and follow its clone instructions.

- [ ] **Step 4: Push the source and the site.** Push the source to `main`. Push the contents of `dist/home` to a `gh-pages` branch (an orphan branch whose root is `index.html`, `manifest.webmanifest`, the icons, and `.nojekyll`).

- [ ] **Step 5: Verify the site is live.** WebFetch `https://jacobt001.github.io/steelreach/` and `…/manifest.webmanifest`, allowing up to a few minutes for the first deploy. If Pages didn't auto-enable, run `gh api -X POST repos/Jacobt001/steelreach/pages -f "source[branch]=gh-pages" -f "source[path]=/"`. If that isn't permitted, ask Jacob to set Settings → Pages → Branch: `gh-pages`.

- [ ] **Step 6: Write `docs/DEPLOY.md` and commit.** It records the artifact URL, the Pages URL, how to republish (`npm run build`, then `publish_files` with slug and base_version, and push `dist/home` to `gh-pages`), and the iPhone steps: open the Pages link in Safari → Share → Add to Home Screen.

```bash
git add -A && git commit -m "docs: deployment record" && git push origin main
```
