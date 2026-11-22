// Power networks: generators and poles link by reach, consumers attach by coverage.
import { BAL, BUILDINGS, TPS } from '../config.js';

const find = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };

// Runs only when the layout (or a research mod) changed, so allocation here is fine.
export function rebuildPower(game) {
  const reach = game.mods.poleReach, half = game.mods.coverHalf;
  const nodes = [];
  for (const e of game.ents.values()) if (e.type === 'generator' || e.type === 'pole') nodes.push(e);
  // Sorted by centre x so the pair scan can stop as soon as dx exceeds reach.
  const cx = (e) => e.x + e.w / 2, cy = (e) => e.y + e.h / 2;
  nodes.sort((a, b) => cx(a) - cx(b));
  const parent = nodes.map((_, i) => i);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (cx(nodes[j]) - cx(nodes[i]) > reach) break;
      if (Math.abs(cy(nodes[j]) - cy(nodes[i])) <= reach) parent[find(parent, i)] = find(parent, j);
    }
  }
  // A network's id is the lowest entity id among its members, so ids are stable under rebuilds.
  const byRoot = new Map();
  nodes.forEach((e, i) => {
    const r = find(parent, i);
    let n = byRoot.get(r);
    if (!n) byRoot.set(r, n = { id: e.id, gens: [], consumers: [], demand: 0, members: [] });
    n.id = Math.min(n.id, e.id);
    n.members.push(e);
    if (e.type === 'generator') n.gens.push(e);
  });
  const nets = [...byRoot.values()].sort((a, b) => a.id - b.id);
  const unpowered = [];
  for (const e of game.ents.values()) {
    const draw = BUILDINGS[e.type]?.power ?? 0; // tunnel halves have no BUILDINGS entry
    if (!(draw > 0)) continue;
    let hit = null;
    for (const n of nets) {
      for (const m of n.members) {
        if (e.x < m.x + m.w + half && e.x + e.w > m.x - half && e.y < m.y + m.h + half && e.y + e.h > m.y - half) { hit = n; break; }
      }
      if (hit) break; // nets are sorted by id, so the first hit is the lowest
    }
    if (hit) { e.net = hit.id; hit.consumers.push(e); hit.demand += draw; }
    else { e.net = -1; unpowered.push(e); }
  }
  for (const n of nets) delete n.members;
  game.nets = nets;
  game.unpoweredCons = unpowered;
  game.powerDirty = false;
}

export function stepPower(game) {
  const u = BAL.unpowered;
  const lone = game.unpoweredCons;
  if (lone) for (let i = 0; i < lone.length; i++) lone[i].pmult = u;
  const nets = game.nets;
  for (let k = 0; k < nets.length; k++) {
    const n = nets[k], gens = n.gens;
    let supply = 0;
    for (let i = 0; i < gens.length; i++) {
      const g = gens[i];
      if (g.burn === 0 && n.demand > 0) {
        if (g.fuel.fuel_cell > 0) { g.fuel.fuel_cell--; g.burn = BAL.cellSec * TPS; g.burnPower = BAL.cellPower; }
        else if (g.fuel.coal > 0) { g.fuel.coal--; g.burn = BAL.coalSec * TPS; g.burnPower = BAL.coalPower * game.mods.genMult; }
      }
      if (g.burn > 0) { supply += g.burnPower; g.burn--; }
    }
    const sat = n.demand > 0 ? Math.min(1, supply / n.demand) : 0;
    const pm = u + (1 - u) * sat;
    for (let i = 0; i < n.consumers.length; i++) n.consumers[i].pmult = pm;
  }
}
