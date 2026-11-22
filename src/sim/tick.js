// One fixed 1/20 s simulation step.
import { rebuildOrder } from './order.js';
import { stepBelt, beltSpeed } from './belts.js';
import { stepBridge, stepTunnelIn, stepTunnelOut } from './pieces.js';

const STEPPERS = { belt: stepBelt, bridge: stepBridge, tunnel_in: stepTunnelIn, tunnel_out: stepTunnelOut };

export function tick(game) {
  if (game.topoDirty) rebuildOrder(game);
  // Task 9 adds power and Task 7 adds machines here, before conveyors move.
  const v = beltSpeed(game);
  // acceptBelt gives between-tick inserts a travel credit; hand-offs inside this loop get none.
  game.stepping = true;
  for (const node of game.order) STEPPERS[node.type]?.(game, node, v);
  game.stepping = false;
  game.tick++;
  game.stats.playTicks++;
}
