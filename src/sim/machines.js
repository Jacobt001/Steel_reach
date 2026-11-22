// Machine-side item handling shared by every machine: intake (dead end, pass-by, overstock),
// output ports, the status line, and the storage box.
import { edgeNeighbors, entAt, CRAFTERS } from '../game/state.js';
import { offer, OK, BUSY, NEVER, STALL } from './offer.js';
import { BAL, RECIPES, TPS, ITEMS, BUILDINGS } from '../config.js';
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

// Starved: some ingredient is short of one batch, so the machine can't run until it arrives.
function starved(m, r) {
  for (const k in r.in) if ((m.buf[k] ?? 0) < r.in[k]) return true;
  return false;
}

// Holding some of an ingredient but not a whole batch of it (1 of 2 stone).
function partBatch(m, r) {
  for (const k in r.in) { const have = m.buf[k] ?? 0; if (have > 0 && have < r.in[k]) return true; }
  return false;
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
      if (m.type !== 'furnace' || furnaceRecipeFor(game, item) === null) return NEVER;
      // A furnace locked onto one ore reports BUSY for another smeltable ore so no false
      // "can't use" marker shows; it will switch once it drains. A part batch (1 of 2 stone)
      // never drains by itself, so then the belt must show why it is stuck.
      return r && partBatch(m, r) ? NEVER : BUSY;
    }
  }
  const r = RECIPES[m.recipe];
  const have = m.buf[item] ?? 0;
  if (have >= BAL.ingBatches * r.in[item]) {
    // Ironline's stall: a dead-end belt's front item is full while the ingredient the machine
    // is waiting for sits behind it. Taking surplus while starved keeps that belt moving, so
    // only 99 surplus can block it, and STALL names the item on the belt.
    if (mode !== 'deadEnd' || !starved(m, r)) return BUSY;
    if (have >= BAL.overstock) return STALL;
  }
  m.buf[item] = have + 1;
  return OK;
}

// Machines that grab what they need from a belt running past them. The Hub and storage never
// do: the Hub only takes belts pointing in, and a box has no recipe to choose by.
const PULLERS = new Set([...CRAFTERS, 'generator']);
export const isPuller = (ent) => PULLERS.has(ent.type);

// Pass-by uses the normal cap only: overstock exists to unblock dead ends, and a pass-by belt
// never blocks, so anything the machine is full of just rolls on to whoever needs it.
export function pullPassBy(game, m, item) {
  return PULLERS.has(m.type) && acceptMachine(game, m, item, 0, 0, 'passBy') === OK;
}

const itemName = (id) => ITEMS[id].name;

// Plain status line for the inspector and map icons; the first matching problem wins.
export function machineStatus(game, m) {
  if (m.type === 'miner') return m.out.length >= BAL.outMax ? 'Output full' : 'Working';
  if (!CRAFTERS.includes(m.type)) return 'Working'; // generator fuel and box contents show separately
  // An idle furnace has no recipe yet, so it can't name an item; any ore starts it.
  if (m.recipe === null) return 'Waiting for ore';
  const r = RECIPES[m.recipe];
  if (m.out.length + r.out > BAL.outMax) return 'Output full';
  let missing = null, over = null;
  for (const k in r.in) {
    const have = m.buf[k] ?? 0;
    if (missing === null && have < r.in[k]) missing = k;
    // The biggest pile is the one clogging the belt, and it reaches 99 first.
    if (have > BAL.ingBatches * r.in[k] && (over === null || have > m.buf[over])) over = k;
  }
  if (missing !== null) {
    return over !== null ? `${m.buf[over]} ${itemName(over)}, waiting for ${itemName(missing)}` : `Waiting for ${itemName(missing)}`;
  }
  if (BUILDINGS[m.type].power > 0) {
    if (m.net < 0) return `No power: ${Math.round(BAL.unpowered * 100)}% speed`;
    if (m.pmult < 1) return `Low power: ${Math.round(m.pmult * 100)}% speed`;
  }
  return 'Working';
}

// The inspector's Clear: the way out of a true stall without deleting the machine.
export function clearMachine(game, m) {
  if (m.buf) m.buf = {};
  if (m.out) m.out.length = 0;
  if (m.prog !== undefined) m.prog = 0;
  // Emptied, a furnace should take the next ore of any kind straight away, not one tick later.
  if (m.type === 'furnace') m.recipe = null;
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
