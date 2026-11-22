// One fixed 1/20 s simulation step.
import { rebuildOrder } from './order.js';
import { stepBelt, beltSpeed } from './belts.js';
import { stepBridge, stepTunnelIn, stepTunnelOut, stepSplitter, stepMerger } from './pieces.js';
import { rebuildPower, stepPower } from './power.js';
import { stepStorage, stepMachine } from './machines.js';

const STEPPERS = { belt: stepBelt, bridge: stepBridge, tunnel_in: stepTunnelIn, tunnel_out: stepTunnelOut, splitter: stepSplitter, merger: stepMerger };
const MACHINE_STEPPERS = { storage: stepStorage, miner: stepMachine, furnace: stepMachine, assembler: stepMachine, fabricator: stepMachine, foundry: stepMachine, refinery: stepMachine };

export function tick(game) {
  if (game.topoDirty) rebuildOrder(game);
  if (game.powerDirty) rebuildPower(game);
  stepPower(game);
  const v = beltSpeed(game);
  // Machines run first and outside the conveyor step, so what they push onto a belt gets the
  // between-tick travel credit like any other outside insert.
  for (const m of game.machines) MACHINE_STEPPERS[m.type]?.(game, m, v);
  // acceptBelt gives between-tick inserts a travel credit; hand-offs inside this loop get none.
  game.stepping = true;
  for (const node of game.order) STEPPERS[node.type]?.(game, node, v);
  game.stepping = false;
  game.tick++;
  game.stats.playTicks++;
}
