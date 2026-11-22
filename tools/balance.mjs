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

// What the player buys during each tier. Tier 5 unlocks no research, so Long Tunnels waits for it.
// Tiers 11 and 12 unlock none either and every node is owned by then, so those two tiers pass
// the 5-minute check on the goal-bar path (a 5-minute session moves the bar 15%+), not on research.
const BOUGHT_IN = {
  1: ['miner1'], 2: ['belt1', 'smelt1'], 3: ['asm1'], 4: ['miner2', 'belt2'], 5: ['longTunnels'],
  6: ['smelt2', 'effGen', 'bigBoxes'], 7: ['asm2'], 8: ['miner3', 'widePoles'], 9: ['belt3'], 10: ['deepDrills'],
  11: [], 12: [],
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

// Buildings (belts excluded) a typical phone player places per module at tier t. A module is the
// item's whole chain from ore, so this is the cap on how much of a chain they actually build:
// a chain bigger than the budget runs at budget / chainSize of its final crafter's pace, which is
// the same as a player stopping short of a fully fed line. It grows with tier because the player
// gets faster at laying out lines and tiers 5+ bring power poles, tunnels and bridges.
export const BUDGET = [10, 10, 10, 12, 12, 14, 14, 16, 16, 18, 18, 20];

const KINDS = { furnace: 'furnaces', assembler: 'assemblers', fabricator: 'fabricators', foundry: 'foundries', refinery: 'refineries' };

// Demand-tree walk over RECIPES: how many whole machines of each stage keep ONE final crafter busy.
// Per-machine rates are the ones the sim measures (crafter rate from measureModule, miner rate
// from the same formula the sim uses). Powered stages add generators, each with its own coal miner.
export function chainOf(id, tier = RECIPES[id].tier) {
  const mods = modsFor(ASSUMED_RESEARCH[tier - 1]);
  const counts = { miners: 0, furnaces: 0, assemblers: 0, fabricators: 0, foundries: 0, refineries: 0, generators: 0 };
  // Demand per item is summed over the whole tree before sizing, because one line of plates feeds
  // every stage that wants plates; sizing each branch alone would round up once per branch.
  const need = { [id]: measureModule(id, tier).perMin / 60 };
  const crafted = [];
  const visit = (item) => { if (RECIPES[item] && !crafted.includes(item)) { crafted.push(item); Object.keys(RECIPES[item].in).forEach(visit); } };
  visit(id);
  let draw = 0;
  // Highest recipe tier first: an item's ingredients always come from lower tiers, so by the time
  // we reach an item all of its demand has been added.
  for (const item of crafted.sort((a, b) => RECIPES[b].tier - RECIPES[a].tier)) {
    const r = RECIPES[item], each = measureModule(item, Math.max(tier, r.tier)).perMin / 60;
    const n = Math.ceil(need[item] / each - 1e-9);
    counts[KINDS[r.machine]] += n; draw += n * BUILDINGS[r.machine].power;
    for (const [k, q] of Object.entries(r.in)) need[k] = (need[k] ?? 0) + need[item] / r.out * q;
  }
  for (const [k, perSec] of Object.entries(need)) if (!RECIPES[k]) counts.miners += Math.ceil(perSec / minerPerSec(mods) - 1e-9);
  counts.generators = Math.ceil(draw / (BAL.coalPower * mods.genMult) - 1e-9);
  counts.miners += counts.generators; // each generator is fed by its own coal miner
  const size = Object.values(counts).reduce((s, n) => s + n, 0);
  return { size, counts };
}

// Items per minute from one whole-chain module at tier t, after the player's building budget.
export function moduleRate(id, tier) {
  const c = chainOf(id, tier), m = measureModule(id, tier);
  return { perMin: m.perMin * Math.min(1, BUDGET[tier - 1] / c.size), full: m.perMin, chain: c };
}

// Minutes per tier: build allowance + haul + the tier's goals shared across its modules.
// config may be the config module itself or a what-if ({ tiers, research, modules, ... }); rates
// always come from the live sim, so recipe times are changed in config.js, not here.
export function estimate(config = {}) {
  const tiers = config.tiers ?? config.TIERS ?? TIERS, research = config.research ?? config.RESEARCH ?? RESEARCH;
  const modules = config.modules ?? MODULES, build = config.buildAllowance ?? BUILD_ALLOWANCE;
  const rate = config.rate ?? ((item, t) => moduleRate(item, t).perMin);
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
      // Share of the tier's goal work a 5-minute session finishes: the other way \u00a78.2's check-in can pay off.
      goalBar5: Math.min(1, 5 / production),
      research: avail[0] ?? null, researchMinutes: avail[0]?.minutes ?? Infinity, bought,
    };
  });
  return { tiers: rows, totalMinutes: rows.reduce((s, r) => s + r.minutes, 0) };
}

const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const names = (bag) => Object.entries(bag).map(([k, n]) => `${n.toLocaleString('en-US')} ${ITEMS[k].name.toLowerCase()}`).join(' + ');
const SPEC_START = [
  { iron_plate: 40, copper_plate: 30 }, { gear: 50, wire: 80 }, { circuit: 60, brick: 40 }, { steel: 60, motor: 30 },
  { silicon: 60, glass: 60 }, { processor: 50, frame: 40 }, { plastic: 120, cable: 100 }, { robot_arm: 40, processor: 100 },
  { titanium_plate: 150, robot_arm: 60 }, { turbine: 40, titanium_plate: 200 }, { fuel_cell: 40, turbine: 40 }, { fusion_core: 20 },
];
const PLURAL = { miners: 'miners', furnaces: 'furnaces', assemblers: 'assemblers', fabricators: 'fabricators', foundries: 'foundries', refineries: 'refineries', generators: 'generators' };
const SINGULAR = { miners: 'miner', furnaces: 'furnace', assemblers: 'assembler', fabricators: 'fabricator', foundries: 'foundry', refineries: 'refinery', generators: 'generator' };
const buildingsText = (c) => Object.keys(PLURAL).filter((k) => c[k]).map((k) => `${c[k]} ${c[k] === 1 ? SINGULAR[k] : PLURAL[k]}`).join(', ');

export function report(e = estimate()) {
  const total = Math.round(e.totalMinutes), h = Math.floor(total / 60), m = total % 60;
  const L = [];
  L.push('# Steelreach balance report', '');
  L.push('Generated by `node tools/balance.mjs`. Do not edit by hand: change `src/config.js` and re-run.', '');
  L.push(`**The model says a typical, well-practised player finishes tier 12 in about ${total} minutes (${h} h ${m} min).** That is a best-case-ish model, not a forecast: real play will most likely run longer (see the last section). The target is 5–8 hours.`, '');
  L.push('## What a "module" is', '');
  L.push('A module is one item\'s **whole chain from the ground up**: the crafter that makes the item, every crafter, furnace and miner upstream of it, and a coal generator (with its own coal miner) wherever a Foundry or Refinery needs power. Each stage is sized in whole machines so the final crafter never waits. Belts are not counted.', '');
  L.push('Example: a motor needs steel, gears and wire, which need iron plate and copper plate, which need furnaces and miners. The module is all of that, not just the motor fabricator.', '');
  L.push('Machine speeds come from the real simulation: each crafter is run for 6,000 ticks with the research the player owns at that tier. The chain sizes come from walking each recipe\'s ingredients back to ore.', '');
  L.push('### The building budget', '');
  L.push(`A phone player will not place a 40-building chain for every item. The model assumes they place at most this many buildings per module at each tier: **${BUDGET.join(', ')}** (tiers 1–12). If a chain is bigger, the module runs at budget ÷ chain size of full speed, as if the player stopped short of a fully fed line.`, '');
  L.push('Why these numbers: they start at 10 (a few furnaces, miners and an assembler) and grow to 20 as the player gets quicker at laying lines and gets tunnels, bridges and poles. They are a planning assumption, not a measurement. If real players build less, the late tiers take longer (see levers below).', '');
  L.push('| Tier | Item | Buildings in the full chain | Budget | Speed kept | Items/min per module |', '|---|---|---|---|---|---|');
  const seen = new Set();
  for (const t of e.tiers) for (const it of t.items) {
    const k = `${it.item}@${t.tier}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const mr = moduleRate(it.item, t.tier);
    L.push(`| ${t.tier} | ${ITEMS[it.item].name} | **${mr.chain.size}** (${buildingsText(mr.chain.counts)}) | ${BUDGET[t.tier - 1]} | ${Math.round(Math.min(1, BUDGET[t.tier - 1] / mr.chain.size) * 100)}% | ${n1(mr.perMin)} |`);
  }
  L.push('');
  L.push('## Minutes per tier', '');
  L.push(`Each tier's time is: time to build, plus time for the first item to travel in from a new ring, plus time for the tier's modules to make the goals. Modules per tier: ${MODULES.join(', ')}. Build allowance: ${BUILD_ALLOWANCE.join(', ')} minutes. A tier's modules share its goals, so the minutes for each goal item add up.`, '');
  L.push('| Tier | Name | Modules | Build | Haul | Making goals | **Total** |', '|---|---|---|---|---|---|---|');
  for (const t of e.tiers) L.push(`| ${t.tier} | ${t.name} | ${t.modules} | ${t.build} | ${t.haul ? n1(t.haul) : '–'} | ${n1(t.production)} | **${n1(t.minutes)}** |`);
  L.push(`| | **Total** | | | | | **${n1(e.totalMinutes)}** (${h} h ${m} min) |`, '');
  L.push('## Final goals next to the spec\'s starting numbers', '');
  L.push('The spec (section 8.1) gave small starting numbers and said the builder would tune them. Because every module is now a whole chain, the late tiers can\'t make anywhere near 900 of anything in 45 minutes, so the late goals are far smaller than in the first draft of this report but still well above the spec\'s starting numbers.', '');
  L.push('| Tier | Name | Final goals | Spec starting goals |', '|---|---|---|---|');
  e.tiers.forEach((t, i) => L.push(`| ${t.tier} | ${t.name} | ${names(Object.fromEntries(t.items.map((x) => [x.item, x.goal])))} | ${names(SPEC_START[i])} |`));
  L.push('');
  L.push('## Research', '');
  L.push('A 5-minute session should let the player buy a research node **or** see a goal bar move meaningfully. A tier passes if its cheapest node costs 5 minutes of that tier\'s production or less, **or** 5 minutes of play fills at least 15% of the tier\'s goals. Both numbers are below.', '');
  L.push('Tiers 5, 11 and 12 unlock no research. Tier 5 keeps Long Tunnels for later; by tiers 11 and 12 every node is owned, so those two tiers rely on the goal bar.', '');
  L.push('| Tier | Cheapest research you can buy | Cost | Minutes to afford | 5 minutes moves the goals by | Assumed bought during this tier (minutes) |', '|---|---|---|---|---|---|');
  for (const t of e.tiers) {
    const r = t.research;
    const b = t.bought.map((x) => `${x.name} (${n1(x.minutes)})`).join(', ') || 'nothing';
    L.push(`| ${t.tier} | ${r ? r.name : 'none left'} | ${r ? names(r.cost) : ''} | ${r ? n1(r.minutes) : '–'} | ${Math.round(t.goalBar5 * 100)}% | ${b} |`);
  }
  L.push('');
  L.push('Big Boxes is priced as a convenience (100 frames), not a gate. It only raises how much a storage box holds and nothing else needs it.', '');
  L.push('## What the estimate leaves out', '');
  L.push('- **Haul:** on tiers 5, 7, 9 and 11 the new ore\'s ring starts 28 / 48 / 66 / 84 tiles out. The first 10 tiles are free and the rest is travel time at that tier\'s belt speed. It comes to under a minute; building the long line is part of the build allowance.');
  L.push('- **Research effects:** Hot Furnaces and Quick Assembly speed up crafters and so shorten "Making goals". Faster Miners and Deep Drills mainly mean fewer miners in a chain, which the fixed building budget does not credit.');
  L.push('- **Crafter timing** is the sim\'s own: progress is zeroed when a craft finishes, so with speed upgrades a crafter runs slightly slower than its recipe time suggests.');
  L.push('- Not modelled: learning the controls, mistakes, rebuilding, jams, idle time away from the game, and longer hauls than the straight-line distance.', '');
  L.push('## Real play will likely run longer', '');
  L.push('This is a model of a player who knows what to build and places it in one go. A first-time player will spend more time learning, fixing mistakes and being away, so expect the real total to land above the number at the top. If it runs too long, these are the levers, biggest first:');
  L.push('- **Lower the late goals** in `TIERS` in `src/config.js`. "Making goals" scales directly: halve a goal, halve its minutes.');
  L.push('- **Raise the building budget** (what a player can fit per module) by shrinking the chains: the biggest are robot arm, turbine and fusion core. Cheaper recipe inputs make smaller chains.');
  L.push('- **Research feels slow or trivial:** change its `cost` in `RESEARCH`. Keep the cheapest node at each tier near 3–4 minutes.');
  L.push('- **One item is the bottleneck everywhere:** change its recipe `sec`. That moves every tier that uses it, so re-run this report.');
  L.push('- Re-run with `node tools/balance.mjs`. `npm test` fails if the total leaves 5–8 hours, tiers 1–3 leave 10–15 minutes, tiers 9–12 leave 40–50 minutes, or a tier fails both research checks.');
  L.push('');
  return L.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const e = estimate();
  const path = fileURLToPath(new URL('../docs/balance.md', import.meta.url));
  writeFileSync(path, report(e));
  for (const t of e.tiers) console.log(`T${t.tier} ${t.name.padEnd(12)} ${n1(t.minutes).padStart(5)} min  research ${t.research ? `${t.research.name} ${n1(t.researchMinutes)}` : 'none'}, 5 min moves goals ${Math.round(t.goalBar5 * 100)}%`);
  console.log(`Total ${n1(e.totalMinutes)} min -> ${path}`);
}
