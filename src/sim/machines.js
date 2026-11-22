// Machine-side item handling shared by every machine: output ports and the storage box.
import { edgeNeighbors, entAt } from '../game/state.js';
import { offer, OK, BUSY, NEVER } from './offer.js';
import { BAL, RECIPES, TPS } from '../config.js';
import { isUnlocked } from '../game/progress.js';

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

// Neighbours a machine hands finished items to by touching: crafters, generators and the Hub.
// Storage and belts are excluded here; belts go through outputPorts, and a box only takes belts.
const HANDOFF = new Set(['furnace', 'assembler', 'fabricator', 'foundry', 'refinery', 'generator', 'hub']);
const handoffCache = new WeakMap();

function handoffTargets(game, ent) {
  const live = !game.topoDirty;
  const hit = handoffCache.get(ent);
  if (live && hit && hit.ver === game.topoVer) return hit.list;
  const list = [];
  for (const n of edgeNeighbors(ent)) {
    const node = entAt(game, n.x, n.y);
    // A wide machine touches the same neighbour along several tiles; one target is enough.
    if (node && node !== ent && HANDOFF.has(node.type) && !list.some((t) => t.node === node)) list.push({ node, dir: n.dir });
  }
  if (live) handoffCache.set(ent, { ver: game.topoVer, list });
  return list;
}

// Furnaces pick their recipe from the first smeltable ore that arrives.
function furnaceRecipeFor(game, item) {
  for (const id in RECIPES) {
    const r = RECIPES[id];
    if (r.machine === 'furnace' && r.in[item] !== undefined && isUnlocked(game, 'recipes', id)) return id;
  }
  return null;
}

export function acceptMachine(game, m, item, moveDir, pos, mode) {
  if (m.type === 'generator') {
    if (item !== 'coal' && !(item === 'fuel_cell' && game.tier >= 11)) return NEVER;
    if (m.fuel.coal + m.fuel.fuel_cell >= BAL.genFuelMax) return BUSY;
    m.fuel[item]++;
    return OK;
  }
  if (m.type === 'furnace' && m.recipe === null) {
    const id = furnaceRecipeFor(game, item);
    if (id === null) return NEVER;
    m.recipe = id;
  } else {
    const r = m.recipe && RECIPES[m.recipe];
    if (!r || r.in[item] === undefined) {
      // A furnace locked onto one ore reports BUSY for another smeltable ore so no false
      // "can't use" marker shows; it will switch once it drains.
      return m.type === 'furnace' && furnaceRecipeFor(game, item) !== null ? BUSY : NEVER;
    }
  }
  const need = RECIPES[m.recipe].in[item];
  if ((m.buf[item] ?? 0) >= BAL.ingBatches * need) return BUSY;
  m.buf[item] = (m.buf[item] ?? 0) + 1;
  return OK;
}

function pushOutput(game, m) {
  const ports = outputPorts(game, m);
  const np = ports.length;
  const hand = handoffTargets(game, m);
  const total = np + hand.length;
  if (!total) return;
  const item = m.out[0];
  for (let k = 0; k < total; k++) {
    const i = (m.rr + k) % total;
    const r = i < np
      ? offer(game, ports[i].node, item, ports[i].dir, 0, 'deadEnd')
      : offer(game, hand[i - np].node, item, hand[i - np].dir, 0, 'handoff');
    if (r === OK) {
      m.out.shift();
      m.rr = (i + 1) % total;
      return;
    }
  }
}

function stepMiner(game, m) {
  if (m.out.length < BAL.outMax && m.tiles > 0) {
    const period = Math.round(BAL.minerSecFull * TPS * 4 / m.tiles / game.mods.minerMult);
    if (++m.timer >= period) {
      m.timer = 0;
      for (let k = 0; k < game.mods.minerYield; k++) m.out.push(m.ore);
    }
  }
  if (m.out.length) pushOutput(game, m);
}

function stepCrafter(game, m) {
  if (m.recipe !== null) {
    const r = RECIPES[m.recipe];
    if (m.out.length + r.out <= BAL.outMax) {
      let ready = true;
      for (const k in r.in) if ((m.buf[k] ?? 0) < r.in[k]) { ready = false; break; }
      if (ready) {
        const f = m.type === 'furnace' ? game.mods.furnaceMult : (m.type === 'assembler' || m.type === 'fabricator') ? game.mods.asmMult : 1;
        m.prog += f * m.pmult;
        if (m.prog >= r.sec * TPS) {
          for (const k in r.in) m.buf[k] -= r.in[k];
          for (let k = 0; k < r.out; k++) m.out.push(m.recipe);
          game.stats.made[m.recipe] = (game.stats.made[m.recipe] ?? 0) + r.out;
          // Zeroed, not carried: an idle furnace must read prog 0 to be allowed to retarget.
          m.prog = 0;
        }
      }
    }
  }
  if (m.out.length) pushOutput(game, m);
  if (m.type === 'furnace' && m.recipe !== null && m.prog === 0 && !m.out.length) {
    for (const k in m.buf) if (m.buf[k] > 0) return;
    m.recipe = null;
  }
}

export function stepMachine(game, m) {
  if (m.type === 'miner') stepMiner(game, m);
  else stepCrafter(game, m);
}
