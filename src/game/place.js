// Placement rules. Check order is fixed by the brief so the player sees the most basic problem first.
import { BUILDINGS, RECIPES, ITEMS, ORE_TIER, MAP } from '../config.js';
import { idx } from '../world.js';
import { addEnt, removeEnt, entAt, sizeOf, CRAFTERS } from './state.js';
import { isUnlocked } from './progress.js';

const no = (reason) => ({ ok: false, reason });
const unlockTier = (type) => BUILDINGS[type === 'tunnel_in' || type === 'tunnel_out' ? 'tunnel' : type].tier;

// Ore under a miner footprint: returns {ore, tiles} or a failure result.
function minerOre(game, x, y, w, h) {
  const found = new Set();
  let tiles = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = game.world.ore[idx(x + i, y + j)];
    if (o) { found.add(o); tiles++; }
  }
  if (found.size === 0) return no('Miners need an ore tile');
  if (found.size > 1) return no('Miner covers two ore types');
  const ore = [...found][0];
  if (!isUnlocked(game, 'ores', ore)) return no(`${ITEMS[ore].name} unlocks at Tier ${ORE_TIER[ore]}`);
  return { ok: true, ore, tiles };
}

export function canPlace(game, type, x, y, opts = {}) {
  const { w, h } = sizeOf(type);
  if (x < 0 || y < 0 || x + w > MAP || y + h > MAP) return no('Off the map');
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (game.grid[idx(x + i, y + j)]) return no('Tile is occupied');
  if (!isUnlocked(game, 'buildings', type === 'tunnel_in' || type === 'tunnel_out' ? 'tunnel' : type)) return no(`Unlocks at Tier ${unlockTier(type)}`);
  if (type === 'miner') { const m = minerOre(game, x, y, w, h); if (!m.ok) return m; }
  if (opts.recipe && !isUnlocked(game, 'recipes', opts.recipe)) return no('Recipe not unlocked');
  return { ok: true };
}

function defaultRecipe(game, type, opts) {
  if (type === 'refinery') return 'plastic';
  if (opts.recipe) return opts.recipe;
  if (type === 'furnace') return null; // furnace picks its recipe from the first ore it is fed
  if (!CRAFTERS.includes(type)) return null;
  const last = game.settings.lastRecipe[type];
  if (last) return last;
  return Object.keys(RECIPES).find((id) => RECIPES[id].machine === type && isUnlocked(game, 'recipes', id)) ?? null;
}

export function place(game, type, x, y, opts = {}) {
  const recipe = defaultRecipe(game, type, opts);
  // Check the explicit recipe, not a remembered one, so a stale lastRecipe never blocks placing.
  if (!canPlace(game, type, x, y, { ...opts, recipe: opts.recipe }).ok) return null;
  const props = { dir: opts.dir ?? 0, dirH: opts.dirH, dirV: opts.dirV, pair: opts.pair, recipe };
  if (type === 'miner') {
    const { w, h } = sizeOf(type);
    const m = minerOre(game, x, y, w, h);
    props.ore = m.ore; props.tiles = m.tiles;
  }
  return addEnt(game, type, x, y, props);
}

export function erase(game, x, y) {
  const ent = entAt(game, x, y);
  if (!ent || ent.type === 'hub') return false;
  removeEnt(game, ent);
  return true;
}
