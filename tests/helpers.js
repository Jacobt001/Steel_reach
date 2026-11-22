import { place } from '../src/game/place.js';
import { createGame } from '../src/game/state.js';
import { defaultMods } from '../src/game/progress.js';
import { idx } from '../src/world.js';

// Ore cleared everywhere so each test lays out exactly the ore it needs.
export function testGame({ tier = 12 } = {}) {
  const g = createGame(1);
  g.world.ore.fill(null);
  g.tier = tier;
  g.mods = defaultMods();
  g.research = {};
  return g;
}

export function setOre(game, x, y, w, h, type) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) game.world.ore[idx(x + i, y + j)] = type;
}

// tick.js arrives in a later task, so it is imported on demand.
export async function run(game, n) {
  const { tick } = await import('../src/sim/tick.js');
  for (let i = 0; i < n; i++) tick(game);
}

import { offer, OK } from '../src/sim/offer.js';
import { entAt } from '../src/game/state.js';

// Per-game, per-tile cycle position so a multi-item feed repeats its list in order.
const feedState = new WeakMap();

// Offers the next item of the cycle at pos 0. The cycle only advances on OK, so a refused
// offer is retried with the same item and recipe ratios stay exact. Returns the offer code.
export function feed(game, x, y, items, dir) {
  const ent = entAt(game, x, y);
  const key = `${x},${y}`;
  if (!feedState.has(game)) feedState.set(game, new Map());
  const cycle = feedState.get(game);
  const i = cycle.get(key) ?? 0;
  const r = offer(game, ent, items[i % items.length], dir ?? ent.dir, 0);
  if (r === OK) cycle.set(key, i + 1);
  return r;
}

// Takes every item that has reached the end of the tile, like a consumer would.
export function drain(game, x, y) {
  const ent = entAt(game, x, y);
  const out = [];
  ent.items = ent.items.filter((it) => {
    if (it.pos < 0.875 - 1e-6) return true;
    out.push(it.item);
    return false;
  });
  return out;
}

// Serpentine of n belts: 100-wide rows two apart, joined by a one-tile connector. Stays in
// the top band (y < 60, x 20..119) so it can never touch the Hub or the map edge.
export function snake(game, n) {
  const X0 = 20, X1 = 119, tiles = [];
  for (let r = 0; tiles.length < n; r++) {
    const y = 2 + 2 * r, east = r % 2 === 0;
    for (let k = 0; k <= X1 - X0; k++) {
      const last = k === X1 - X0;
      tiles.push({ x: east ? X0 + k : X1 - k, y, dir: last ? 2 : east ? 1 : 3 });
    }
    // The connector drops from the row's last tile into the next row's first tile.
    tiles.push({ x: east ? X1 : X0, y: y + 1, dir: 2 });
  }
  const placed = tiles.slice(0, n);
  for (const t of placed) if (!place(game, 'belt', t.x, t.y, { dir: t.dir })) throw new Error(`snake: cannot place at ${t.x},${t.y}`);
  const a = placed[0], z = placed[n - 1];
  return { start: [a.x, a.y], end: [z.x, z.y] };
}
