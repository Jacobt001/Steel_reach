// Game state container plus the only two functions allowed to add or remove entities.
import { MAP, HUB, BUILDINGS } from '../config.js';
import { generateWorld, idx } from '../world.js';
import { defaultMods } from './progress.js';

export const CRAFTERS = ['furnace', 'assembler', 'fabricator', 'foundry', 'refinery'];
const MACHINE_TYPES = new Set(['miner', 'generator', 'storage', ...CRAFTERS]);
const CONVEYOR_TYPES = new Set(['belt', 'bridge', 'tunnel_in', 'tunnel_out', 'splitter', 'merger']);

// Tunnel halves are entity types only; they share the one-tile tunnel building's size.
export const sizeOf = (type) => BUILDINGS[type === 'tunnel_in' || type === 'tunnel_out' ? 'tunnel' : type];

// Fresh per-type contents; undo reuses this so a restored building starts empty.
function initialState(type, props) {
  switch (type) {
    case 'belt': return { items: [], blocked: null, side: 0 };
    case 'bridge': return { dirH: props.dirH ?? 1, dirV: props.dirV ?? 0, h: [], v: [] };
    case 'tunnel_in': return { pair: props.pair ?? 0, under: [] };
    case 'tunnel_out': return { pair: props.pair ?? 0, items: [] };
    case 'splitter': return { hold: null, rr: 0 };
    case 'merger': return { hold: null, turn: 0 };
    case 'storage': return { queue: [], rr: 0 };
    case 'miner': return { ore: props.ore ?? null, tiles: props.tiles ?? 0, timer: 0, out: [], rr: 0 };
    case 'generator': return { fuel: { coal: 0, fuel_cell: 0 }, burn: 0, burnPower: 0, net: -1 };
    case 'pole': return { net: -1 };
    case 'hub': return {};
    default:
      if (CRAFTERS.includes(type)) return { recipe: props.recipe ?? null, buf: {}, prog: 0, out: [], rr: 0, net: -1, pmult: 1 };
      throw new Error(`Unknown entity type: ${type}`);
  }
}

export function createGame(seed) {
  const game = {
    seed, world: generateWorld(seed), tier: 1, prog: {}, stock: {}, research: {}, mods: defaultMods(), tick: 0,
    grid: new Int32Array(MAP * MAP), ents: new Map(), nextId: 2, machines: [], conveyors: [], order: [],
    topoDirty: true, powerDirty: true, nets: [], undo: [], cur: null, events: [],
    stats: { playTicks: 0, made: {} }, settings: { sfx: true, lastRecipe: {} }, completedAt: null,
  };
  addEnt(game, 'hub', HUB.x, HUB.y, { id: 1 });
  return game;
}

export function addEnt(game, type, x, y, props = {}) {
  const { w, h } = sizeOf(type);
  // An explicit id is how undo brings a building back under its old identity.
  const id = props.id ?? game.nextId;
  game.nextId = Math.max(game.nextId, id + 1);
  const ent = { id, type, x, y, w, h, dir: props.dir ?? 0, ...initialState(type, props) };
  game.ents.set(id, ent);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) game.grid[idx(x + i, y + j)] = id;
  if (MACHINE_TYPES.has(type)) game.machines.push(ent);
  if (CONVEYOR_TYPES.has(type)) game.conveyors.push(ent);
  game.topoDirty = game.powerDirty = true;
  game.cur?.push({ op: 'add', id });
  return ent;
}

const drop = (list, ent) => { const i = list.indexOf(ent); if (i >= 0) list.splice(i, 1); };

export function removeEnt(game, ent) {
  if (game.cur) {
    // Contents are deliberately not saved: undo gives back the building, not its items.
    const snap = { id: ent.id, type: ent.type, x: ent.x, y: ent.y, dir: ent.dir };
    for (const k of ['recipe', 'dirH', 'dirV', 'pair', 'ore', 'tiles']) if (k in ent) snap[k] = ent[k];
    game.cur.push({ op: 'rem', snap });
  }
  game.ents.delete(ent.id);
  for (let j = 0; j < ent.h; j++) for (let i = 0; i < ent.w; i++) game.grid[idx(ent.x + i, ent.y + j)] = 0;
  drop(game.machines, ent); drop(game.conveyors, ent); drop(game.order, ent);
  game.topoDirty = game.powerDirty = true;
}

export function entAt(game, x, y) {
  if (x < 0 || y < 0 || x >= MAP || y >= MAP) return null;
  return game.ents.get(game.grid[idx(x, y)]) ?? null;
}

// Tiles just outside each edge tile; dir points away from the entity. Order: N, E, S, W.
export function edgeNeighbors(ent) {
  const out = [];
  for (let i = 0; i < ent.w; i++) out.push({ x: ent.x + i, y: ent.y - 1, dir: 0 });
  for (let j = 0; j < ent.h; j++) out.push({ x: ent.x + ent.w, y: ent.y + j, dir: 1 });
  for (let i = 0; i < ent.w; i++) out.push({ x: ent.x + i, y: ent.y + ent.h, dir: 2 });
  for (let j = 0; j < ent.h; j++) out.push({ x: ent.x - 1, y: ent.y + j, dir: 3 });
  return out;
}
