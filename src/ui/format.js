// Pure display logic for the UI. Nothing here touches the DOM, so Node tests cover every number
// and label the player reads, and ui.js stays a thin layer of elements and event handlers.
import { BUILDINGS, RECIPES, ITEMS, TIERS, RESEARCH, BAL, TPS } from '../config.js';
import { isUnlocked, SANDBOX } from '../game/progress.js';

const itemName = (id) => ITEMS[id]?.name ?? id;

// Raw progress, not capped at the goal: the UI caps what it draws, but data stays honest.
export function goalLines(game) {
  const goals = TIERS[game.tier - 1]?.goals;
  if (!goals) return [];
  return Object.entries(goals).map(([item, need]) => ({ item, name: itemName(item), have: game.prog[item] ?? 0, need }));
}

export function tierLabel(game) {
  if (game.tier >= SANDBOX || !TIERS[game.tier - 1]) return 'Sandbox mode';
  return `Tier ${game.tier} · ${TIERS[game.tier - 1].name}`;
}

export function formatDuration(ticks) {
  const min = Math.floor(ticks / TPS / 60);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}

// Ties go to the first item made, which is stable because `made` keeps insertion order.
export function topMade(stats) {
  let best = null;
  for (const [item, count] of Object.entries(stats.made)) if (best === null || count > best.count) best = { item, name: itemName(item), count };
  return best;
}

export const itemsMade = (stats) => Object.values(stats.made).reduce((a, b) => a + b, 0);

// Hand-rolled rather than toLocaleString so the separator never changes with the phone's locale.
export const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// --- items per minute ------------------------------------------------------------------------
// The sim doesn't track rates, so the UI samples delivered counts. Game ticks are the clock, not
// wall time: the sim stops while the page is hidden, and a wall clock would read that as a slump.
const WINDOW_TICKS = 60 * TPS;
const MIN_TICKS = 10 * TPS;

export function createRateMeter() {
  let samples = [];
  return {
    sample(tick, counts) {
      // A tick that goes backwards means a different game was loaded; its history is meaningless.
      if (samples.length && tick < samples[samples.length - 1].tick) samples = [];
      samples.push({ tick, counts: { ...counts } });
      while (samples.length > 2 && samples[0].tick < tick - WINDOW_TICKS) samples.shift();
    },
    rate(item) {
      if (samples.length < 2) return 0;
      const a = samples[0], b = samples[samples.length - 1];
      const delta = (b.counts[item] ?? 0) - (a.counts[item] ?? 0);
      return Math.max(0, delta) * 60 * TPS / Math.max(b.tick - a.tick, MIN_TICKS);
    },
    reset() { samples = []; },
  };
}

// --- build bar -------------------------------------------------------------------------------
export const BUILD_TOOLS = ['pan', 'belt', 'bridge', 'tunnel', 'splitter', 'merger', 'storage', 'miner', 'furnace', 'assembler', 'fabricator', 'foundry', 'refinery', 'generator', 'pole', 'erase'];
// Short labels: the build bar is ~60 px per tool, so "Storage box" and "Power pole" are trimmed.
export const TOOL_LABELS = {
  pan: 'Pan', belt: 'Belt', bridge: 'Bridge', tunnel: 'Tunnel', splitter: 'Splitter', merger: 'Merger', storage: 'Storage',
  miner: 'Miner', furnace: 'Furnace', assembler: 'Assembler', fabricator: 'Fabricator', foundry: 'Foundry', refinery: 'Refinery',
  generator: 'Generator', pole: 'Pole', erase: 'Erase',
};
// Machines whose recipe is chosen before placing; the furnace auto-detects and the refinery has one.
export const RECIPE_MACHINES = ['assembler', 'fabricator', 'foundry'];

// seenTools lives in settings so it is saved; settings come back from saves loosely checked, so
// anything that isn't a plain object is treated as "nothing seen yet".
const seenMap = (game) => {
  const s = game.settings.seenTools;
  return s !== null && typeof s === 'object' && !Array.isArray(s) ? s : null;
};

// Tier-1 tools (and Pan/Erase, tier 0) are what a new game starts with, so they never get the dot.
export function toolState(game, id) {
  const tier = BUILDINGS[id]?.tier ?? 0;
  const locked = tier > 0 && !isUnlocked(game, 'buildings', id);
  return { locked, tier, fresh: !locked && tier > 1 && seenMap(game)?.[id] !== true };
}

export function markSeen(game, id) {
  if (!seenMap(game)) game.settings.seenTools = {};
  game.settings.seenTools[id] = true;
}

// Must match place.js defaultRecipe, or the chip would name a recipe the ghost doesn't place.
export function chipRecipe(game, type) {
  const last = game.settings.lastRecipe?.[type];
  if (last) return last;
  return Object.keys(RECIPES).find((id) => RECIPES[id].machine === type && isUnlocked(game, 'recipes', id)) ?? null;
}

export function recipesFor(game, machine) {
  const out = [];
  for (const id in RECIPES) {
    const r = RECIPES[id];
    if (r.machine === machine) out.push({ id, name: itemName(id), unlocked: isUnlocked(game, 'recipes', id), tier: r.tier });
  }
  return out;
}

// "2 Iron plate + 1 Coal → 1 Steel", for recipe pickers and the inspector.
export function recipeText(id) {
  const r = RECIPES[id];
  const ins = Object.entries(r.in).map(([k, n]) => `${n} ${itemName(k)}`).join(' + ');
  return `${ins} → ${r.out} ${itemName(id)}`;
}

// --- sheets ----------------------------------------------------------------------------------
export function unlocksAt(tier) {
  const u = TIERS[tier - 1]?.unlocks ?? { buildings: [], recipes: [], ores: [] };
  return {
    buildings: u.buildings.map((b) => BUILDINGS[b].name),
    recipes: u.recipes.map(itemName),
    ores: u.ores.map(itemName),
    research: RESEARCH.filter((r) => r.tier === tier).map((r) => r.name),
    // The generator rule lives in the sim (acceptMachine), not in TIERS, so it is named here.
    extra: tier === 11 ? ['Generators accept fuel cells'] : [],
  };
}

export function ingredientRows(m) {
  const r = m.recipe && RECIPES[m.recipe];
  if (!r) return [];
  return Object.entries(r.in).map(([item, need]) => {
    const have = m.buf[item] ?? 0, cap = BAL.ingBatches * need;
    return { item, name: itemName(item), have, need, cap, over: have > cap };
  });
}

// Same period formula as stepMiner, rounding included, so the inspector agrees with the sim.
export function minerRate(game, m) {
  if (!(m.tiles > 0)) return 0;
  const period = Math.round(BAL.minerSecFull * TPS * 4 / m.tiles / game.mods.minerMult);
  return game.mods.minerYield * 60 * TPS / period;
}

// Generators' own `net` field isn't maintained by the power rebuild; membership in gens is.
export function netOf(game, gen) {
  for (const n of game.nets ?? []) if (n.gens.includes(gen)) return n;
  return null;
}

// What the network is getting this tick: only a generator that is burning supplies power.
export function netSupply(net) {
  let s = 0;
  for (const g of net.gens) if (g.burn > 0) s += g.burnPower;
  return s;
}

const ids = (lane) => lane.map((it) => it.item);

// Items are listed front (next out) to back, which is the order the sim keeps them in.
export function conveyorInfo(e) {
  let lanes;
  switch (e.type) {
    case 'bridge': lanes = [{ label: 'Horizontal', items: ids(e.laneH) }, { label: 'Vertical', items: ids(e.laneV) }]; break;
    case 'tunnel_in': lanes = [{ label: 'Underground', items: ids(e.under) }]; break;
    case 'splitter': case 'merger': lanes = [{ label: null, items: e.hold ? [e.hold.item] : [] }]; break;
    default: lanes = [{ label: null, items: ids(e.items) }];
  }
  // kind ('never' | 'stall') picks the colour, the same split the map markers use.
  return { lanes, blocked: e.blocked ?? null, kind: e.blocked ? e.blockedKind ?? null : null };
}

// Fixed item order, not by count, so inspector rows don't jump around while a box fills.
export function storageCounts(queue) {
  const counts = {};
  for (const it of queue) counts[it] = (counts[it] ?? 0) + 1;
  return Object.keys(ITEMS).filter((k) => counts[k]).map((item) => ({ item, name: itemName(item), count: counts[item] }));
}

export const costLines = (game, cost) => Object.entries(cost).map(([item, need]) => {
  const have = game.stock[item] ?? 0;
  return { item, name: itemName(item), have, need, ok: have >= need };
});

// "New game only": a factory with anything built in it is a game in progress, even if the
// player never dismissed the card, so an old save never greets them with beginner advice.
export const showsHint = (game) => game.settings.hintDone !== true && game.tier === 1 && game.ents.size <= 1;

