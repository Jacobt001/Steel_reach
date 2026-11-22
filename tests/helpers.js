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
