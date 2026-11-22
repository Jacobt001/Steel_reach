// One fixed 1/20 s simulation step.
import { rebuildOrder } from './order.js';
import { stepBelt, beltSpeed } from './belts.js';

export function tick(game) {
  if (game.topoDirty) rebuildOrder(game);
  // Task 9 adds power and Task 7 adds machines here, before conveyors move.
  const v = beltSpeed(game);
  for (const node of game.order) if (node.type === 'belt') stepBelt(game, node, v);
  game.tick++;
  game.stats.playTicks++;
}
