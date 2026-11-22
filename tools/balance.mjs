// Pacing model for brief §8.2 and the balance run of §12.
// Deviation from §12, flagged in the plan: a scripted factory playing all 12 tiers would cost more
// than every other test combined, so each recipe's real throughput is measured in the sim instead,
// and those rates feed a pacing model. Running this file directly rewrites docs/balance.md.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECIPES, TIERS, RESEARCH, RINGS, BAL, TPS, DX, DY, BUILDINGS, ITEMS } from '../src/config.js';
import { place } from '../src/game/place.js';
import { recalcMods } from '../src/game/progress.js';
import { tick } from '../src/sim/tick.js';
// The test helpers give an ore-free map and the same feed/drain the sim tests trust.
import { testGame, setOre, feed, drain } from '../tests/helpers.js';

// Brief values, used verbatim. MODULES[t-1] is how many modules a typical player runs at tier t.
export const MODULES = [1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6];
export const BUILD_ALLOWANCE = [6, 7, 8, 9, 12, 12, 14, 14, 16, 16, 18, 18];
const HAUL_TIERS = new Set([5, 7, 9, 11]);
const HAUL_FREE_TILES = 10;

// What the player buys during each tier. Every tier needs a node left to buy (the 5-minute
// check-in), and tiers 5, 11 and 12 unlock none of their own, so one is saved for each: Long
// Tunnels for tier 5, and Big Boxes, the node a typical player skips longest, for 11 and 12.
const BOUGHT_IN = {
  1: ['miner1'], 2: ['belt1', 'smelt1'], 3: ['asm1'], 4: ['miner2', 'belt2'], 5: ['longTunnels'],
  6: ['smelt2', 'effGen'], 7: ['asm2'], 8: ['miner3', 'widePoles'], 9: ['belt3'], 10: ['deepDrills'],
  11: [], 12: ['bigBoxes'],
};
// Research owned at the start of tier t is ASSUMED_RESEARCH[t-1]: everything bought in earlier
// tiers. Upgrades bought mid-tier only count from the next tier, which keeps the estimate cautious.
export const ASSUMED_RESEARCH = TIERS.map((_, i) => Object.entries(BOUGHT_IN).filter(([t]) => +t <= i).flatMap(([, ids]) => ids));

const TICKS = 6000;
const WARM = 1200; // lines, buffers and the generator are full well before a minute is up
const MARGIN = 1.15; // feeders are sized 15% over the crafter's need so the crafter sets the pace
const AT = { x: 40, y: 40 }; // far from the Hub (78-81) and every map edge, with room for lines all round
const FIRST = 6; // the first feeder sits this far up its line, clear of the crafter and the generator
const STEP = 3; // a 2-wide feeder plus a one-tile gap: neighbours never touch, so no stray hand-offs

const modsFor = (ids) => { const g = { research: Object.fromEntries(ids.map((id) => [id, true])) }; recalcMods(g); return g.mods; };
const speedOf = (machine, mods) => machine === 'furnace' ? mods.furnaceMult : (machine === 'assembler' || machine === 'fabricator') ? mods.asmMult : 1;

// Ticks per craft exactly as stepCrafter counts them: prog adds the multiplier each tick and is
// zeroed on completion, so any overshoot is lost.
function ticksPerCraft(id, mods) {
  const f = speedOf(RECIPES[id].machine, mods), need = RECIPES[id].sec * TPS;
  let p = 0, n = 0;
  while (p < need) { p += f; n++; }
  return n;
}
const craftsPerSec = (id, mods) => TPS / ticksPerCraft(id, mods);
const minerPerSec = (mods) => mods.minerYield * TPS / Math.round(BAL.minerSecFull * TPS * 4 / 4 / mods.minerMult);

// How an ingredient reaches the crafter: ore from miners, furnace goods from a miner handing ore to
// a furnace, and anything else by belt from the lines the player built in earlier tiers.
const kindOf = (item) => !RECIPES[item] ? 'ore' : RECIPES[item].machine === 'furnace' ? 'smelt' : 'upstream';
const oreOf = (id) => Object.keys(RECIPES[id].in)[0];

function feederRate(item, mods) {
  if (kindOf(item) === 'ore') return minerPerSec(mods);
  const r = RECIPES[item];
  return Math.min(minerPerSec(mods) / r.in[oreOf(item)], craftsPerSec(item, mods)) * r.out;
}

function put(g, type, x, y, opts) {
  const e = place(g, type, x, y, opts);
  if (!e) throw new Error(`balance: cannot place ${type} at ${x},${y}`);
  return e;
}

// One line per ingredient, each ending in its own edge tile so a slow ingredient can never block a
// fast one (dead-end lines only overstock while starved, and only their own item).
// Order W, N, S, E; feeders sit on the left of travel, which keeps the four sides apart.
function lineEnds(w, h) {
  const { x, y } = AT;
  return [
    { x: x - 1, y: y + (h >> 1), dir: 1 },
    { x: x + (w >> 1), y: y - 1, dir: 2 },
    { x: x + (w >> 1), y: y + h, dir: 0 },
    { x: x + w, y, dir: 3 },
  ];
}

function buildLine(g, end, item, count) {
  const back = (p) => ({ x: end.x - DX[end.dir] * p, y: end.y - DY[end.dir] * p });
  const side = (end.dir + 3) % 4;
  const len = kindOf(item) === 'upstream' ? FIRST : FIRST + STEP * (count - 1) + 1;
  for (let p = 0; p < len; p++) { const t = back(p); put(g, 'belt', t.x, t.y, { dir: end.dir }); }
  if (kindOf(item) === 'upstream') { const t = back(len - 1); return { feed: { x: t.x, y: t.y, item }, miners: 0, furnaces: 0 }; }
  // Depth 1 off the line is the stub that side-loads onto it; 2x2 machines stack behind the stub.
  // Returns the top-left of the 2x2 at depths a..a+1 covering line positions p..p+1.
  const corner = (p, a) => {
    const xs = [], ys = [];
    for (const b of [0, 1]) for (const d of [a, a + 1]) { const t = back(p + b); xs.push(t.x + DX[side] * d); ys.push(t.y + DY[side] * d); }
    return { x: Math.min(...xs), y: Math.min(...ys) };
  };
  const ore = kindOf(item) === 'ore' ? item : oreOf(item);
  for (let i = 0; i < count; i++) {
    const p = FIRST + STEP * i, t = back(p);
    put(g, 'belt', t.x + DX[side], t.y + DY[side], { dir: (side + 2) % 4 });
    const minerAt = corner(p, kindOf(item) === 'ore' ? 2 : 4);
    if (kindOf(item) === 'smelt') { const f = corner(p, 2); put(g, 'furnace', f.x, f.y); }
    setOre(g, minerAt.x, minerAt.y, 2, 2, ore);
    put(g, 'miner', minerAt.x, minerAt.y);
  }
  return { feed: null, miners: count, furnaces: kindOf(item) === 'smelt' ? count : 0 };
}

// A minimal working module for one recipe: miners on ore, furnaces, then the crafter, with a coal
// generator when the crafter needs power, and its output drained so it never backs up.
export function buildModule(id, tier = RECIPES[id].tier) {
  const r = RECIPES[id];
  const g = testGame({ tier: Math.max(tier, r.tier) });
  g.research = Object.fromEntries(ASSUMED_RESEARCH[tier - 1].map((k) => [k, true]));
  recalcMods(g);
  const { w, h } = BUILDINGS[r.machine];
  const crafter = put(g, r.machine, AT.x, AT.y, r.machine === 'furnace' ? {} : { recipe: id });
  const ends = lineEnds(w, h), need = craftsPerSec(id, g.mods) * MARGIN;
  const feeds = [], counts = { miners: 0, furnaces: 0, generators: 0 };
  Object.keys(r.in).forEach((item, j) => {
    const n = kindOf(item) === 'upstream' ? 0 : Math.ceil(need * r.in[item] / feederRate(item, g.mods));
    const line = buildLine(g, ends[j], item, n);
    if (line.feed) feeds.push(line.feed);
    counts.miners += line.miners; counts.furnaces += line.furnaces;
  });
  if (BUILDINGS[r.machine].power > 0) {
    // One generator (20 power) covers either powered crafter; its own coal miner hands fuel in.
    const gx = AT.x + w + 1, gy = AT.y - 3;
    put(g, 'generator', gx, gy);
    setOre(g, gx + 2, gy, 2, 2, 'coal'); put(g, 'miner', gx + 2, gy);
    counts.generators++; counts.miners++;
  }
  const out = { x: AT.x + w, y: AT.y + h - 1 };
  put(g, 'belt', out.x, out.y, { dir: 1 });
  return { g, crafter, feeds, out, counts };
}

const memo = new Map();

// Steady-state output of one module, timed between the first and last craft after warm-up so a
// slow recipe isn't rounded to whole crafts. Research is what ASSUMED_RESEARCH says is owned.
export function measureModule(id, tier = RECIPES[id].tier) {
  const key = `${id}@${tier}:${RECIPES[id].sec}:${ASSUMED_RESEARCH[tier - 1].join()}`;
  if (memo.has(key)) return memo.get(key);
  const { g, feeds, out, counts } = buildModule(id, tier);
  const r = RECIPES[id];
  let drained = 0, last = 0, first = null, end = null;
  for (let t = 0; t < TICKS; t++) {
    for (const f of feeds) feed(g, f.x, f.y, [f.item]);
    tick(g);
    drained += drain(g, out.x, out.y).length;
    const made = g.stats.made[id] ?? 0;
    if (made !== last) { last = made; if (t >= WARM) { first ??= { t, made }; end = { t, made }; } }
  }
  if (!first || end.t === first.t) throw new Error(`balance: ${id} module made too little to measure`);
  const perMin = (end.made - first.made) / ((end.t - first.t) / TPS) * 60;
  const ideal = r.out * craftsPerSec(id, g.mods) * 60;
  // Anything short of the crafter's own pace means the layout, not the recipe, is being measured.
  if (perMin < ideal * 0.97) throw new Error(`balance: ${id} module starved: ${perMin.toFixed(1)}/min of ${ideal.toFixed(1)}`);
  if (drained < last - BAL.outMax * 2) throw new Error(`balance: ${id} output backed up`);
  const res = { id, tier, perMin, ideal, counts, machine: r.machine };
  memo.set(key, res);
  return res;
}

// Items per minute from one module of each recipe, measured at the recipe's own unlock tier
// unless a tier is given.
export function measureModules({ tier } = {}) {
  const out = {};
  for (const id in RECIPES) out[id] = measureModule(id, Math.max(tier ?? 0, RECIPES[id].tier)).perMin;
  return out;
}

// Minutes per tier: build allowance + haul + the tier's goals shared across its modules.
// config may be the config module itself or a what-if ({ tiers, research, modules, ... }); rates
// always come from the live sim, so recipe times are changed in config.js, not here.
export function estimate(config = {}) {
  const tiers = config.tiers ?? config.TIERS ?? TIERS, research = config.research ?? config.RESEARCH ?? RESEARCH;
  const modules = config.modules ?? MODULES, build = config.buildAllowance ?? BUILD_ALLOWANCE;
  const rate = config.rate ?? ((item, t) => measureModule(item, t).perMin);
  const rows = tiers.map((def, i) => {
    const t = i + 1, M = modules[i], owned = new Set(ASSUMED_RESEARCH[i]);
    // Work, not wall-clock per item: M modules share the tier's goals, so the minutes add up.
    const workOf = (bag) => Object.entries(bag).reduce((s, [k, n]) => s + n / (M * rate(k, t)), 0);
    const items = Object.entries(def.goals).map(([k, n]) => ({ item: k, goal: n, perMin: rate(k, t), minutes: n / (M * rate(k, t)) }));
    const production = workOf(def.goals);
    const ore = def.unlocks.ores[0];
    const beltLevel = modsFor([...owned]).beltLevel;
    const haul = HAUL_TIERS.has(t) ? (RINGS.find((r) => r.ore === ore).r0 - HAUL_FREE_TILES) / BAL.beltTilesPerSec[beltLevel] / 60 : 0;
    const avail = research.filter((r) => r.tier <= t && !owned.has(r.id) && (!r.req || owned.has(r.req)))
      .map((r) => ({ id: r.id, name: r.name, cost: r.cost, minutes: workOf(r.cost) }))
      .sort((a, b) => a.minutes - b.minutes);
    const bought = (BOUGHT_IN[t] ?? []).map((id) => { const r = research.find((x) => x.id === id); return { id, name: r.name, minutes: workOf(r.cost) }; });
    return {
      tier: t, name: def.name, modules: M, build: build[i], haul, production, items,
      minutes: build[i] + haul + production,
      research: avail[0] ?? null, researchMinutes: avail[0]?.minutes ?? Infinity, bought,
    };
  });
  return { tiers: rows, totalMinutes: rows.reduce((s, r) => s + r.minutes, 0) };
}

const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const names = (bag) => Object.entries(bag).map(([k, n]) => `${n.toLocaleString('en-US')} ${ITEMS[k].name.toLowerCase()}`).join(' + ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function report(e = estimate()) {
  const total = Math.round(e.totalMinutes), h = Math.floor(total / 60), m = total % 60;
  const L = [];
  L.push('# Steelreach balance report', '');
  L.push('Generated by `node tools/balance.mjs`. Do not edit by hand: change `src/config.js` and re-run.', '');
  L.push(`**Estimated time to finish tier 12: ${total} minutes (about ${h} h ${m} min).** The target is 5–8 hours.`, '');
  L.push('Each tier\'s time is: time to build, plus time for the first item to travel in from a new ring, plus time for the tier\'s modules to make the goals.', '');
  L.push('## Minutes per tier', '');
  L.push('| Tier | Name | Build | Haul | Making goals | **Total** | Goals |', '|---|---|---|---|---|---|---|');
  for (const t of e.tiers) L.push(`| ${t.tier} | ${t.name} | ${t.build} | ${t.haul ? n1(t.haul) : '–'} | ${n1(t.production)} | **${n1(t.minutes)}** | ${names(Object.fromEntries(t.items.map((i) => [i.item, i.goal])))} |`);
  L.push(`| | **Total** | | | | **${n1(e.totalMinutes)}** | |`, '');
  L.push('## Research: can a 5-minute check-in buy something?', '');
  L.push('"Minutes" is how long that tier\'s modules take to make the cost. The test requires the cheapest one to be 5 minutes or less at every tier.', '');
  L.push('Tiers 5, 11 and 12 unlock no research of their own, so the estimate assumes one node is saved for each: Long Tunnels for tier 5, Big Boxes for tiers 11 and 12.', '');
  L.push('| Tier | Cheapest research you can buy | Cost | Minutes | Assumed bought during this tier (minutes) |', '|---|---|---|---|---|');
  for (const t of e.tiers) {
    const r = t.research;
    const b = t.bought.map((x) => `${x.name} (${n1(x.minutes)})`).join(', ') || 'nothing';
    L.push(`| ${t.tier} | ${r ? r.name : 'none left'} | ${r ? names(r.cost) : ''} | ${r ? n1(r.minutes) : ''} | ${b} |`);
  }
  L.push('');
  L.push('## Measured modules', '');
  L.push('Items per minute from **one** module, measured in the real sim (6,000 ticks) with the research the player is assumed to own at that tier.', '');
  L.push('| Item | Tier used | Machine | Items/min per module | Feeders in the module |', '|---|---|---|---|---|');
  const seen = new Set();
  for (const t of e.tiers) for (const it of t.items) {
    const k = `${it.item}@${t.tier}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const mm = measureModule(it.item, t.tier);
    const parts = [mm.counts.miners && plural(mm.counts.miners, 'miner'), mm.counts.furnaces && plural(mm.counts.furnaces, 'furnace'), mm.counts.generators && plural(mm.counts.generators, 'generator')].filter(Boolean);
    const belt = Object.keys(RECIPES[it.item].in).filter((x) => kindOf(x) === 'upstream').map((x) => ITEMS[x].name.toLowerCase());
    if (belt.length) parts.push(`${belt.join(', ')} by belt`);
    L.push(`| ${ITEMS[it.item].name} | ${t.tier} | ${BUILDINGS[mm.machine].name} | ${n1(mm.perMin)} | ${parts.join(', ')} |`);
  }
  L.push('');
  L.push('## What the estimate assumes', '');
  L.push('- **A module** is one crafter kept busy: miners on ore, furnaces when it needs plates, brick or glass, and the crafter, joined by belts and hand-offs, with the output carried away. Powered crafters (Foundry, Refinery) get one coal generator with its own coal miner. Feeders are sized 15% over what the crafter uses, so the crafter sets the pace.');
  L.push('- **Crafted ingredients** (gear, wire, steel, processor and so on) arrive by belt from the lines built in earlier tiers. The build allowance is the time to extend those lines.');
  L.push(`- **Modules per tier:** ${MODULES.join(', ')} (tiers 1–12). A tier's modules share its goals, so the minutes for each goal item add up.`);
  L.push(`- **Build allowance:** ${BUILD_ALLOWANCE.join(', ')} minutes (tiers 1–12).`);
  L.push(`- **Haul:** on tiers 5, 7, 9 and 11, the new ore's ring starts ${RINGS.slice(1).map((r) => r.r0).join(' / ')} tiles out; the first ${HAUL_FREE_TILES} tiles are free and the rest is travel time at that tier's belt speed. It is under a minute, because belts are fast; building the long line is part of the build allowance.`);
  L.push('- **Research:** each tier uses only the upgrades bought in earlier tiers (the right-hand column above). Hot Furnaces and Quick Assembly speed up crafters, so they shorten "Making goals". Faster Miners and Deep Drills cut how many miners a module needs, and Faster Belts shortens the haul; none of them speeds up a crafter, so they mostly show up as less building, which the fixed build allowance does not count.');
  L.push('- **Crafter timing** is the sim\'s own: progress is zeroed when a craft finishes, so with speed upgrades a crafter runs slightly slower than its recipe time suggests. The measurement includes this.');
  L.push('- Not modelled: learning the controls, mistakes, rebuilding, idle time away from the game.', '');
  L.push('## If real play feels off', '');
  L.push('- **A tier drags or flies by:** change that tier\'s goals in `TIERS` in `src/config.js`. Making goals scales directly with them: double the goals, double the "Making goals" minutes.');
  L.push('- **Research feels slow or trivial:** change its `cost` in `RESEARCH`. Keep the cheapest node at each tier under 5 minutes of that tier\'s production.');
  L.push('- **One item is the bottleneck everywhere:** change its recipe `sec` in `RECIPES`. This moves every tier that uses it, so re-run this report.');
  L.push('- **Everything is uniformly too long or short:** players building more modules than assumed finish faster. Scale all goals together rather than touching recipe times.');
  L.push('- Re-run with `node tools/balance.mjs`; `npm test` fails if the estimate leaves 5–8 hours, tiers 1–3 leave 10–15 minutes, tiers 9–12 leave 40–50 minutes, or any tier\'s cheapest research passes 5 minutes.');
  L.push('');
  return L.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const e = estimate();
  const path = fileURLToPath(new URL('../docs/balance.md', import.meta.url));
  writeFileSync(path, report(e));
  for (const t of e.tiers) console.log(`T${t.tier} ${t.name.padEnd(12)} ${n1(t.minutes).padStart(5)} min  research ${t.research ? `${t.research.name} ${n1(t.researchMinutes)}` : 'none'}`);
  console.log(`Total ${n1(e.totalMinutes)} min -> ${path}`);
}
