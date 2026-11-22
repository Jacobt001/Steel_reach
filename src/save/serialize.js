// Save format v1. Entities are positional arrays so a big factory stays small. Each type has a
// whitelist of the fields the simulation reads to decide outcomes; display markers, stall
// counters, power-net ids and caches are left out by construction, so fields other code adds
// later can never leak into a save or make two saves of the same factory differ.
import { MAP, ITEMS, RECIPES, RESEARCH } from '../config.js';
import { createGame, addEnt, sizeOf, CRAFTERS } from '../game/state.js';
import { recalcMods, SANDBOX } from '../game/progress.js';
import { idx } from '../world.js';

export const SAVE_VERSION = 1;
const DAMAGED = 'Save is damaged', NEWER = 'Save is from a newer version';

// The sim compares positions with a 1e-6 tolerance, so 3 decimals can't change an outcome.
// `|| 0` turns -0 (a tiny negative rounded) into 0, so a reloaded save compares equal.
const r3 = (p) => Math.round(p * 1000) / 1000 || 0;

// Every writer returns fresh arrays and objects: the saver encodes asynchronously while the
// game keeps ticking, so a snapshot must never share anything the sim mutates.
const lane = (list) => { const out = []; for (const it of list) out.push(it.item, r3(it.pos)); return out; };
const hold = (h) => (h ? [h.item, r3(h.pos)] : null);
const crafter = (e) => [e.recipe, { ...e.buf }, e.prog, [...e.out], e.rr];
const WRITE = {
  belt: (e) => [lane(e.items), e.side],
  bridge: (e) => [e.dirH, e.dirV, lane(e.laneH), lane(e.laneV)],
  tunnel_in: (e) => [e.pair, e.under.flatMap((u) => [u.item, u.left])],
  tunnel_out: (e) => [e.pair, lane(e.items)],
  splitter: (e) => [hold(e.hold), e.rr],
  merger: (e) => [hold(e.hold), e.turn],
  storage: (e) => [[...e.queue], e.rr],
  miner: (e) => [e.ore, e.tiles, e.timer, [...e.out], e.rr],
  generator: (e) => [e.fuel.coal, e.fuel.fuel_cell, e.burn, e.burnPower],
  pole: () => [],
};
for (const t of CRAFTERS) WRITE[t] = crafter;

const json = (o) => JSON.parse(JSON.stringify(o));

export function serialize(game) {
  const ents = [];
  // Map order is kept because it is the machine stepping order and the conveyor seeding order.
  // The id rides along after dir: undo re-adds a building under its old id at the end of the
  // Map, so order and id can disagree, and power-net choice and belt-loop order read ids.
  // The Hub has no writer: createGame always makes it.
  for (const e of game.ents.values()) {
    const write = WRITE[e.type];
    if (write) ents.push([e.type, e.x, e.y, e.dir, e.id, ...write(e)]);
  }
  return {
    v: SAVE_VERSION, savedAt: Date.now(), seed: game.seed, tier: game.tier, prog: { ...game.prog }, stock: { ...game.stock },
    research: { ...game.research }, tick: game.tick, stats: json(game.stats), settings: json(game.settings),
    completedAt: game.completedAt, ents,
  };
}

// --- loading ---------------------------------------------------------------------------------
// Validation is about not crashing the sim later: an unknown item or recipe id would throw deep
// inside a tick, long after the load "worked". Anything off is reported as damaged instead.

const damaged = () => new Error(DAMAGED);
const need = (ok) => { if (!ok) throw damaged(); };
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const int = (v, lo = 0, hi = Number.MAX_SAFE_INTEGER) => { need(Number.isInteger(v) && v >= lo && v <= hi); return v; };
const num = (v) => { need(Number.isFinite(v) && v >= 0); return v; };
// hasOwn, not `in` or a plain lookup, so ids like "constructor" don't match Object.prototype.
const has = (table, k) => typeof k === 'string' && Object.hasOwn(table, k);
const item = (v) => { need(has(ITEMS, v)); return v; };
const itemList = (a) => { need(Array.isArray(a)); return a.map(item); };

function readLane(a) {
  need(Array.isArray(a) && a.length % 2 === 0);
  const out = [];
  for (let i = 0; i < a.length; i += 2) {
    const pos = a[i + 1];
    need(Number.isFinite(pos) && pos >= 0 && pos <= 1);
    out.push({ item: item(a[i]), pos });
  }
  return out;
}

function readHold(h) {
  if (h === null) return null;
  const l = readLane(h);
  need(l.length === 1);
  return l[0];
}

function readUnder(a) {
  need(Array.isArray(a) && a.length % 2 === 0);
  const out = [];
  for (let i = 0; i < a.length; i += 2) out.push({ item: item(a[i]), left: int(a[i + 1]) });
  return out;
}

// Item counts keyed by item id; values are whole numbers. Dropping keys we don't know (rather
// than failing) is safe because nothing reads them, and it keeps "__proto__" out of the game.
function counts(o, table = ITEMS) {
  need(isObj(o));
  const out = {};
  for (const k of Object.keys(o)) if (has(table, k)) out[k] = int(o[k]);
  return out;
}

function readBuf(o) {
  need(isObj(o));
  const out = {};
  for (const k of Object.keys(o)) out[item(k)] = int(o[k]);
  return out;
}

function readCrafter([recipe, buf, prog, out, rr], type) {
  need(recipe === null || (has(RECIPES, recipe) && RECIPES[recipe].machine === type));
  return { recipe, buf: readBuf(buf), prog: num(prog), out: itemList(out), rr: int(rr) };
}

// Each reader returns the fields to put on the entity addEnt made. Ranges are checked where a
// bad value would index past a fixed list (splitter outputs, merger sides, belt sides).
const READ = {
  belt: ([items, side]) => ({ items: readLane(items), side: int(side, 0, 1) }),
  bridge: ([dirH, dirV, laneH, laneV]) => ({ dirH: int(dirH, 0, 3), dirV: int(dirV, 0, 3), laneH: readLane(laneH), laneV: readLane(laneV) }),
  tunnel_in: ([pair, under]) => ({ pair: int(pair, 2), under: readUnder(under) }),
  tunnel_out: ([pair, items]) => ({ pair: int(pair, 2), items: readLane(items) }),
  splitter: ([h, rr]) => ({ hold: readHold(h), rr: int(rr, 0, 2) }),
  merger: ([h, turn]) => ({ hold: readHold(h), turn: int(turn, 0, 2) }),
  storage: ([queue, rr]) => ({ queue: itemList(queue), rr: int(rr) }),
  miner: ([ore, tiles, timer, out, rr]) => ({ ore: item(ore), tiles: int(tiles, 0, 4), timer: int(timer), out: itemList(out), rr: int(rr) }),
  generator: ([coal, cell, burn, burnPower]) => ({ fuel: { coal: int(coal), fuel_cell: int(cell) }, burn: int(burn), burnPower: num(burnPower) }),
  pole: () => ({}),
};
for (const t of CRAFTERS) READ[t] = readCrafter;

function readEnt(game, a) {
  need(Array.isArray(a) && a.length >= 5);
  const [type, x, y, dir, id] = a;
  need(typeof type === 'string');
  // Unknown types are skipped so a save with a building this build lacks still loads. The Hub is
  // one of them: createGame already made it.
  if (!has(READ, type)) return;
  const { w, h } = sizeOf(type);
  int(x, 0, MAP - w); int(y, 0, MAP - h); int(dir, 0, 3); int(id, 2);
  need(!game.ents.has(id));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) need(game.grid[idx(x + i, y + j)] === 0);
  const state = READ[type](a.slice(5), type);
  Object.assign(addEnt(game, type, x, y, { id, dir }), state);
}

function readStats(s, base) {
  need(isObj(s));
  return { ...base, ...json(s), playTicks: int(s.playTicks), made: counts(s.made, RECIPES) };
}

// Settings are preferences, never worth refusing a save over: bad values fall back to defaults.
// A remembered recipe that no longer fits its machine would be used by the next placement.
function readSettings(s, base) {
  if (!isObj(s)) return base;
  const out = { ...base, ...json(s), sfx: typeof s.sfx === 'boolean' ? s.sfx : base.sfx, lastRecipe: {} };
  if (isObj(s.lastRecipe)) {
    for (const [k, v] of Object.entries(s.lastRecipe)) if (CRAFTERS.includes(k) && has(RECIPES, v) && RECIPES[v].machine === k) out.lastRecipe[k] = v;
  }
  return out;
}

export function deserialize(obj) {
  need(isObj(obj));
  if (typeof obj.v === 'number' && obj.v > SAVE_VERSION) throw new Error(NEWER);
  need(obj.v === SAVE_VERSION && Number.isSafeInteger(obj.seed) && Array.isArray(obj.ents));
  // The world is regenerated from the seed rather than saved: it never changes during play.
  const game = createGame(obj.seed);
  game.tier = int(obj.tier, 1, SANDBOX);
  game.prog = counts(obj.prog);
  game.stock = counts(obj.stock);
  need(isObj(obj.research));
  game.research = {};
  for (const r of RESEARCH) if (obj.research[r.id] === true) game.research[r.id] = true;
  game.tick = int(obj.tick);
  game.stats = readStats(obj.stats, game.stats);
  game.settings = readSettings(obj.settings, game.settings);
  need(obj.completedAt === null || Number.isInteger(obj.completedAt) && obj.completedAt >= 0);
  game.completedAt = obj.completedAt;
  // Rebuilt in saved order under saved ids, so every list addEnt appends to (machines,
  // conveyors, the Map) comes back in the same order and pair links need no remapping.
  for (const a of obj.ents) readEnt(game, a);
  // A tunnel end pointing anywhere but its partner would let erase() remove an unrelated building.
  for (const e of game.ents.values()) {
    if (e.type !== 'tunnel_in' && e.type !== 'tunnel_out') continue;
    const p = game.ents.get(e.pair);
    need(p !== undefined && p.type === (e.type === 'tunnel_in' ? 'tunnel_out' : 'tunnel_in') && p.pair === e.id);
  }
  // Mods are derived from research and not saved; recalcMods also marks topology and power
  // dirty, so order, ports and nets are rebuilt on the first tick.
  recalcMods(game);
  game.topoDirty = game.powerDirty = true;
  return game;
}

export function tryLoad(obj) {
  try { return { ok: true, game: deserialize(obj) }; }
  catch (err) { return { ok: false, reason: err?.message === NEWER ? NEWER : DAMAGED }; }
}
