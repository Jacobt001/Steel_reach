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
  const placed = new Set();
  const place = (n) => { order.push(n); placed.add(n); };
  let h = 0;
  const drain = () => {
    for (; h < order.length; h++) {
      for (const p of preds.get(order[h])) {
        outdeg.set(p, outdeg.get(p) - 1);
        if (outdeg.get(p) === 0 && !placed.has(p)) place(p);
      }
    }
  };
  for (const n of nodes) if (outdeg.get(n) === 0) place(n);
  drain();
  // Kahn stalls on cycles. Break one by placing a node that sits on it, then resume, so lines
  // feeding a loop still process downstream-first (the loop's own order is arbitrary but fixed).
  // Leftovers are scanned in id order and the cycle is found by walking successors until a repeat.
  if (order.length < nodes.length) {
    const left = nodes.filter((n) => !placed.has(n)).sort((a, b) => a.id - b.id);
    for (const start of left) {
      if (placed.has(start)) continue;
      const seen = new Set();
      let cur = start;
      while (!seen.has(cur)) {
        seen.add(cur);
        cur = nextOf(game, cur).find((s) => inSet.has(s) && !placed.has(s));
      }
      place(cur);
      drain();
    }
  }
  game.order = order;
  game.topoDirty = false;
}
