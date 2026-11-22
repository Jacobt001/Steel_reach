// Downstream-first processing order so a full line frees up front-to-back in one tick.
import { DX, DY } from '../config.js';
import { entAt } from '../game/state.js';

// Entities a conveyor hands items to. Later tasks add bridge, tunnel, splitter and merger.
export function nextOf(game, node) {
  if (node.type === 'belt') {
    const t = entAt(game, node.x + DX[node.dir], node.y + DY[node.dir]);
    return t ? [t] : [];
  }
  return [];
}

// Kahn's algorithm on reversed edges, iterative so a 2000-tile belt can't blow the stack.
export function rebuildOrder(game) {
  const nodes = game.conveyors;
  const inSet = new Set(nodes);
  const outdeg = new Map(), preds = new Map();
  for (const n of nodes) { outdeg.set(n, 0); preds.set(n, []); }
  for (const n of nodes) {
    for (const s of nextOf(game, n)) {
      if (!inSet.has(s)) continue; // hub and machines aren't ordered here
      outdeg.set(n, outdeg.get(n) + 1);
      preds.get(s).push(n);
    }
  }
  const order = [];
  for (const n of nodes) if (outdeg.get(n) === 0) order.push(n);
  for (let h = 0; h < order.length; h++) {
    for (const p of preds.get(order[h])) {
      outdeg.set(p, outdeg.get(p) - 1);
      if (outdeg.get(p) === 0) order.push(p);
    }
  }
  // Whatever is left sits on or upstream of a cycle; id order keeps it deterministic.
  if (order.length < nodes.length) {
    const placed = new Set(order);
    order.push(...nodes.filter((n) => !placed.has(n)).sort((a, b) => a.id - b.id));
  }
  game.order = order;
  game.topoDirty = false;
}
