// Single entry point for handing an item to whatever stands on a tile.
// Later tasks add cases (splitters, machines); unknown types refuse forever.
import { acceptBelt } from './belts.js';
import { acceptHub } from './hub.js';
import { acceptBridge, acceptTunnelIn, acceptTunnelOut, acceptSplitter, acceptMerger } from './pieces.js';
import { acceptStorage, acceptMachine } from './machines.js';

// OK: taken. BUSY: try again later. NEVER: this target can't ever take it from here.
// STALL: target is full of this item (status text names it).
export const OK = 0, BUSY = 1, NEVER = 2, STALL = 3;

// moveDir is the direction the item travels as it enters ent. mode 'tunnel' marks the
// hand-off from a tunnel entrance to its exit; later splitter/machine cases use it for pass-by.
export function offer(game, ent, item, moveDir, pos = 0, mode = 'deadEnd') {
  switch (ent.type) {
    case 'belt': return acceptBelt(game, ent, item, moveDir, pos);
    case 'bridge': return acceptBridge(game, ent, item, moveDir, pos);
    case 'tunnel_in': return acceptTunnelIn(game, ent, item, moveDir);
    case 'tunnel_out': return acceptTunnelOut(game, ent, item, pos, mode);
    case 'splitter': return acceptSplitter(game, ent, item, moveDir);
    case 'merger': return acceptMerger(game, ent, item, moveDir);
    case 'storage': return acceptStorage(game, ent, item, moveDir, mode);
    case 'furnace': case 'assembler': case 'fabricator': case 'foundry': case 'refinery': case 'generator':
      return acceptMachine(game, ent, item, moveDir, pos, mode);
    case 'hub': return acceptHub(game, item, mode);
    default: return NEVER;
  }
}
