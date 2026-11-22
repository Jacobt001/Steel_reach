// Placement rules. Check order is fixed by the brief so the player sees the most basic problem first.
import { BUILDINGS, RECIPES, ITEMS, ORE_TIER, MAP, DX, DY } from '../config.js';
import { idx } from '../world.js';
import { addEnt, removeEnt, entAt, sizeOf, CRAFTERS } from './state.js';
import { isUnlocked } from './progress.js';
import { doAction } from './undo.js';

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

// Exported so the placement ghost shows the same recipe art that place() will use.
export function defaultRecipe(game, type, opts = {}) {
  if (type === 'refinery') return 'plastic';
  if (opts.recipe) return opts.recipe;
  if (type === 'furnace') return null; // furnace picks its recipe from the first ore it is fed
  if (!CRAFTERS.includes(type)) return null;
  const last = game.settings.lastRecipe[type];
  if (last) return last;
  return Object.keys(RECIPES).find((id) => RECIPES[id].machine === type && isUnlocked(game, 'recipes', id)) ?? null;
}

export function place(game, type, x, y, opts = {}) {
  // A tunnel is two entities; going through placeTunnel is what lets undo record both ends.
  if (type === 'tunnel') return opts.exit ? (placeTunnel(game, x, y, opts.dir ?? 0, opts.exit[0], opts.exit[1]).ok ? entAt(game, x, y) : null) : null;
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
  // Either tunnel end takes its partner with it; items underground are dropped with the entrance.
  const partner = (ent.type === 'tunnel_in' || ent.type === 'tunnel_out') ? game.ents.get(ent.pair) : null;
  doAction(game, () => { removeEnt(game, ent); if (partner) removeEnt(game, partner); });
  return true;
}

// Tunnel exits sit straight ahead with 1..tunnelGap tiles between the two ends.
export function placeTunnel(game, x, y, dir, ex, ey) {
  const along = (ex - x) * DX[dir] + (ey - y) * DY[dir];
  const across = (ex - x) * DY[dir] + (ey - y) * DX[dir];
  if (across !== 0 || along <= 0) return no('Exit must be straight ahead');
  if (along < 2) return no('Too close for a tunnel');
  if (along - 1 > game.mods.tunnelGap) return no('Too far for a tunnel');
  for (const [t, tx, ty] of [['tunnel_in', x, y], ['tunnel_out', ex, ey]]) {
    const c = canPlace(game, t, tx, ty);
    if (!c.ok) return c;
  }
  doAction(game, () => {
    const a = addEnt(game, 'tunnel_in', x, y, { dir });
    const b = addEnt(game, 'tunnel_out', ex, ey, { dir, pair: a.id });
    a.pair = b.id;
  });
  return { ok: true };
}

export function validTunnelExits(game, x, y, dir) {
  const out = [];
  for (let gap = 1; gap <= game.mods.tunnelGap; gap++) {
    const ex = x + DX[dir] * (gap + 1), ey = y + DY[dir] * (gap + 1);
    if (canPlace(game, 'tunnel_out', ex, ey).ok) out.push([ex, ey]);
  }
  return out;
}

// Draws a belt along path tile by tile. A perpendicular belt crossed head-on becomes a bridge
// (the brief's auto-bridge) so the old line keeps flowing; everything else is re-pointed or skipped.
export function placeBeltPath(game, path, dirs) {
  const res = { placed: 0, bridges: 0, skipped: [] };
  doAction(game, () => {
    path.forEach(([x, y], i) => {
      const d = dirs[i];
      const ent = entAt(game, x, y);
      if (!ent) {
        if (place(game, 'belt', x, y, { dir: d })) res.placed++; else res.skipped.push([x, y]);
      } else if (ent.type === 'belt') {
        const through = i > 0 && dirs[i - 1] === d && ent.dir % 2 !== d % 2;
        if (through && isUnlocked(game, 'buildings', 'bridge')) {
          const old = ent;
          removeEnt(game, old);
          const horizontal = d % 2 === 1;
          const b = place(game, 'bridge', x, y, { dirH: horizontal ? d : old.dir, dirV: horizontal ? old.dir : d });
          // The old belt's items keep their lane so nothing on the crossed line is lost.
          (old.dir === b.dirH ? b.laneH : b.laneV).push(...old.items);
          res.bridges++; res.placed++;
        } else {
          // Re-pointing is an edit Undo must be able to take back, or it would remove some
          // unrelated earlier belt instead and leave the reversal in place.
          if (ent.dir !== d) game.cur?.push({ op: 'dir', id: ent.id, before: { dir: ent.dir } });
          ent.dir = d; game.topoDirty = true; res.placed++;
        }
      } else if (ent.type === 'bridge') {
        const f = d % 2 === 1 ? 'dirH' : 'dirV';
        if (ent[f] !== d) game.cur?.push({ op: 'dir', id: ent.id, before: { [f]: ent[f] } });
        ent[f] = d;
        game.topoDirty = true; res.placed++;
      } else res.skipped.push([x, y]);
    });
  });
  if (res.bridges) game.events.push({ type: 'toast', text: 'Bridge placed' });
  return res;
}
