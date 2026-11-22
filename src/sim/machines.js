// Machine-side item handling shared by every machine: output ports and the storage box.
import { edgeNeighbors, entAt } from '../game/state.js';
import { offer, OK, BUSY, NEVER } from './offer.js';

// Cached per entity but only valid for one topology version, so erasing or placing a
// neighbour can never leave a port pointing at a removed entity. A WeakMap keeps the cache
// out of saved entity state.
const portCache = new WeakMap();

// Whether the tile node takes items travelling in direction dir (outward from the machine).
function takesFrom(node, dir) {
  switch (node.type) {
    case 'belt': case 'tunnel_in': return node.dir === dir;
    case 'splitter': return node.dir === dir;
    case 'merger': return node.dir !== (dir + 2) % 4;
    case 'bridge': return node.dirH === dir || node.dirV === dir;
    default: return false;
  }
}

export function outputPorts(game, ent) {
  const live = !game.topoDirty;
  const hit = portCache.get(ent);
  if (live && hit && hit.ver === game.topoVer) return hit.ports;
  const ports = [];
  for (const n of edgeNeighbors(ent)) {
    const node = entAt(game, n.x, n.y);
    if (node && takesFrom(node, n.dir)) ports.push({ node, dir: n.dir });
  }
  // While the topology is dirty the version number is stale, so don't remember the answer.
  if (live) portCache.set(ent, { ver: game.topoVer, ports });
  return ports;
}

export function acceptStorage(game, e, item, moveDir, mode) {
  // Only a belt pointing in may feed it; machine hand-offs and pass-by never apply here.
  if (mode !== 'deadEnd') return NEVER;
  if (e.queue.length >= game.mods.storageCap) return BUSY;
  e.queue.push(item);
  return OK;
}

export function stepStorage(game, e) {
  if (!e.queue.length) return;
  const ports = outputPorts(game, e);
  const n = ports.length;
  for (let k = 0; k < n; k++) {
    const i = (e.rr + k) % n;
    if (offer(game, ports[i].node, e.queue[0], ports[i].dir, 0, 'deadEnd') === OK) {
      e.queue.shift();
      e.rr = (i + 1) % n;
      return;
    }
  }
}
