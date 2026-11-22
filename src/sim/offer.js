// Single entry point for handing an item to whatever stands on a tile.
// Later tasks add cases (bridges, tunnels, splitters, machines); unknown types refuse forever.
import { acceptBelt } from './belts.js';
import { acceptHub } from './hub.js';

// OK: taken. BUSY: try again later. NEVER: this target can't ever take it from here.
// STALL: target is full of this item (status text names it).
export const OK = 0, BUSY = 1, NEVER = 2, STALL = 3;

// moveDir is the direction the item travels as it enters ent. mode is reserved for the
// bridge/splitter/machine cases that behave differently for hand-offs and pass-by.
export function offer(game, ent, item, moveDir, pos = 0, mode = 'deadEnd') {
  switch (ent.type) {
    case 'belt': return acceptBelt(game, ent, item, moveDir, pos);
    case 'hub': return acceptHub(game, item);
    default: return NEVER;
  }
}
