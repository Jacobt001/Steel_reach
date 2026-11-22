// One frame of the map, in the brief's draw order: terrain, lock badges, belts, items, machines,
// status icons, blocked markers, power overlay, previews; then the magnifier bubble on top.
// Works in CSS pixels (the caller owns the device-pixel-ratio transform) and never reads ctx
// properties back, only calls methods and sets properties.
// Performance (brief §10): only visible tiles are walked, items are batched into one fill per item
// type, and the hot loops allocate nothing: visible entities and item positions go into reused
// arrays, and per-entity renderer state lives in WeakMaps so it never reaches a save.
import { MAP, DX, DY, BAL, ORE_TIER, BUILDINGS, RECIPES } from '../config.js';
import { entAt, sizeOf } from '../game/state.js';
import { machineStatus } from '../sim/machines.js';
import { beltSpeed, EPS } from '../sim/belts.js';
import { visibleTiles } from './camera.js';
import { createTerrain } from './terrain.js';
import {
  TAU, COL, ITEM_INDEX, ITEM_COLOR, ITEM_SHAPE, RAIL_W, BODY_W, beltPoint, addStrip, addBeltLine, addChevron,
  addRRect, rrect, drawMachine, drawHub, drawPole, drawTunnelHood, drawSplitMerge, drawBridge, drawBeltTile,
  drawStatusIcon, drawBlockedMarker, drawPadlock,
} from './shapes.js';

export const OVERVIEW_Z = 20;
const ITEM_R = 0.12;    // item radius in tiles: queued items (0.25 apart) keep a sliver of gap
const STATUS_HOLD = 20; // ticks (1 s) a problem must last before its map icon shows
const PULSE_TICKS = 10;
// A side-loading belt reaches into the belt it feeds: its rail to that rail, its surface to that surface.
const EXT_RAIL = (1 - RAIL_W) / 2, EXT_BODY = (1 - BODY_W) / 2;
const NO_VIEW = {}, NO_DASH = [], DASH = [6, 4];
const BADGE_FONT = '700 11px -apple-system, system-ui, sans-serif';
const LABEL_FONT = '600 13px -apple-system, system-ui, sans-serif';
const TIER_LABEL = [];
for (let t = 0; t <= 13; t++) TIER_LABEL[t] = `T${t}`;

const CONVEYOR = { belt: 1, bridge: 1, tunnel_in: 1, tunnel_out: 1, splitter: 1, merger: 1 };
// A belt starting at one of these is fed from behind, so it is drawn straight, never as a corner.
const OUTPUTS = { miner: 1, furnace: 1, assembler: 1, fabricator: 1, foundry: 1, refinery: 1, storage: 1 };
const STATUS = { miner: 1, furnace: 1, assembler: 1, fabricator: 1, foundry: 1, refinery: 1 };
const BLOCK_TYPES = ['miner', 'furnace', 'assembler', 'fabricator', 'foundry', 'refinery', 'generator', 'storage', 'pole', 'hub'];
const FURNACE_IN = {};
for (const id in RECIPES) if (RECIPES[id].machine === 'furnace') for (const k in RECIPES[id].in) FURNACE_IN[k] = 1;

// ---------------------------------------------------------------- frame-wide state

// World tile (wx, wy) is drawn at (wx * Z + OX, wy * Z + OY).
let Z = 44, OX = 0, OY = 0, VW = 0, VH = 0;
function setCam(cam) { Z = cam.z; OX = cam.vw / 2 - cam.x * Z; OY = cam.vh / 2 - cam.y * Z; VW = cam.vw; VH = cam.vh; }

// Visible conveyors (with entry direction and side-load flag) and visible buildings.
const VT = { x0: 0, y0: 0, x1: -1, y1: -1 };
const VC = [], VM = [];
let nVC = 0, nVM = 0, VIN = new Int8Array(256), VEXT = new Uint8Array(256);
const PT = new Float64Array(4);

const terrains = new WeakMap();
function terrainFor(world) {
  let t = terrains.get(world);
  if (t === undefined) terrains.set(world, (t = createTerrain(world)));
  return t;
}

// ---------------------------------------------------------------- culling and belt shape

function gather(game, cam) {
  // One tile of margin so an item gliding in from an off-screen belt doesn't pop in late.
  visibleTiles(cam, 1, VT);
  nVC = nVM = 0;
  const grid = game.grid, ents = game.ents, x0 = VT.x0, y0 = VT.y0;
  for (let ty = y0; ty <= VT.y1; ty++) {
    const row = ty * MAP;
    for (let tx = x0; tx <= VT.x1; tx++) {
      const id = grid[row + tx];
      if (id === 0) continue;
      const e = ents.get(id);
      if (e === undefined) continue;
      // A multi-tile building is collected once, at its first visible tile.
      if ((e.w > 1 || e.h > 1) && (tx !== (e.x > x0 ? e.x : x0) || ty !== (e.y > y0 ? e.y : y0))) continue;
      if (CONVEYOR[e.type] !== 1) { VM[nVM++] = e; continue; }
      if (nVC === VIN.length) {
        const a = new Int8Array(nVC * 2); a.set(VIN); VIN = a;
        const b = new Uint8Array(nVC * 2); b.set(VEXT); VEXT = b;
      }
      VC[nVC] = e;
      if (e.type === 'belt') beltGeo(game, e, nVC);
      else { VIN[nVC] = e.dir; VEXT[nVC] = 0; }
      nVC++;
    }
  }
}

// Whether src pushes items travelling in direction s onto the tile beyond it.
function feeds(src, s) {
  switch (src.type) {
    case 'belt': case 'tunnel_out': case 'merger': return src.dir === s;
    case 'splitter': return s !== (src.dir + 2) % 4;
    case 'bridge': return src.dirH === s || src.dirV === s;
    default: return false;
  }
}

// Direction items travel as they enter belt b: straight when fed from behind (or nothing feeds it
// clearly), a corner when exactly one side feeds it.
function entryDir(game, b) {
  const d = b.dir, back = entAt(game, b.x - DX[d], b.y - DY[d]);
  if (back !== null && (feeds(back, d) || OUTPUTS[back.type] === 1)) return d;
  const s1 = (d + 1) % 4, s3 = (d + 3) % 4;
  const a = entAt(game, b.x - DX[s1], b.y - DY[s1]), c = entAt(game, b.x - DX[s3], b.y - DY[s3]);
  const fa = a !== null && feeds(a, s1), fc = c !== null && feeds(c, s3);
  return fa === fc ? d : fa ? s1 : s3;
}

// Belt shape only changes with the layout, so it is cached per topology version; while the
// layout is dirty (placed this frame, not yet ticked) it is recomputed every frame.
const geoCache = new WeakMap();
function beltGeo(game, b, i) {
  const ver = game.topoDirty || game.topoVer === undefined ? -1 : game.topoVer;
  let g = geoCache.get(b);
  if (g === undefined || g.ver !== ver || ver < 0) {
    const inDir = entryDir(game, b), f = entAt(game, b.x + DX[b.dir], b.y + DY[b.dir]);
    const ext = f !== null && f.type === 'belt' && (f.dir + b.dir) % 2 === 1 && entryDir(game, f) !== b.dir;
    if (g === undefined) geoCache.set(b, (g = { ver, inDir, ext }));
    else { g.ver = ver; g.inDir = inDir; g.ext = ext; }
  }
  VIN[i] = g.inDir;
  VEXT[i] = g.ext ? 1 : 0;
}

// ---------------------------------------------------------------- per-machine tracking

// machineStatus is instantaneous and a healthy machine flips between "Working" and "Waiting"
// every craft, so an icon only shows once a problem has held for STATUS_HOLD ticks. "Working"
// animation needs prog to have moved since the previous tick. Both are sampled once per tick.
const INPUT = 1, FULL = 2, POWER_OFF = 3, POWER_LOW = 4;
const tracks = new WeakMap();
function classify(s) {
  if (s === 'Working') return 0;
  if (s === 'Output full') return FULL;
  if (s.startsWith('No power')) return POWER_OFF;
  if (s.startsWith('Low power')) return POWER_LOW;
  return INPUT; // "Waiting for …", "40 Steel, waiting for …", idle furnace
}
const workOf = (m) => (m.type === 'miner' ? m.timer : m.type === 'generator' ? m.burn : m.prog);
function track(game, m) {
  const tick = game.tick;
  let s = tracks.get(m);
  if (s === undefined) {
    s = { tick, work: workOf(m), working: false, kind: STATUS[m.type] === 1 ? classify(machineStatus(game, m)) : 0, since: tick };
    tracks.set(m, s);
  } else if (s.tick !== tick) {
    const w = workOf(m);
    s.working = w !== s.work;
    s.work = w;
    s.tick = tick;
    if (STATUS[m.type] === 1) {
      const k = classify(machineStatus(game, m));
      if (k !== s.kind) { s.kind = k; s.since = tick; }
    }
  }
  return s;
}
const shownStatus = (s, tick) => (s.kind !== 0 && tick - s.since >= STATUS_HOLD ? s.kind : 0);

// ---------------------------------------------------------------- items

const NI = ITEM_COLOR.length, IB = [], IC = new Int32Array(NI);
for (let i = 0; i < NI; i++) IB.push(new Float64Array(64));
function pushItem(id, x, y) {
  const i = ITEM_INDEX[id];
  let b = IB[i];
  const n = IC[i] * 2;
  if (n + 2 > b.length) { const nb = new Float64Array(b.length * 2); nb.set(b); IB[i] = b = nb; }
  b[n] = x; b[n + 1] = y;
  IC[i]++;
}

// Front items and splitter/merger holds seen on the waiting spot, by the tick they were first
// seen there. A flowing item can land exactly on the spot and leaves on the next tick, but one
// still there a tick later was refused. Items never move back off the spot, so the same object
// still on it means the same wait.
const atWait = new WeakMap();
function refused(game, o) {
  if (Math.abs(o.pos - BAL.waitPos) > EPS) return false;
  const t = atWait.get(o);
  if (t === undefined) { atWait.set(o, game.tick); return false; }
  return t < game.tick;
}

// Whether a hold or a lane's front item is handed on during the coming tick (unless its own
// target refuses, which the renderer can't see until a tick later).
const leaves = (game, o, v) => !refused(game, o) && (o.pos + v >= 1 - EPS || o.pos >= BAL.waitPos - EPS);

// Read-only guess at whether the next tile takes a lane's front item. The sim's accept functions
// change state, so they can't be asked; a wrong guess costs at most a small one-off hop, never a
// repeating stall (see lane()).
// When the item is offered this tick, enter is where it would land: downstream tiles step first,
// so a flowing lane has moved on by v, and may have handed its own front on, before ours arrives.
// When it is only offered next tick (soon), a lane that is flowing or has space counts as open.
// For an item refused last tick (again), only room behind the lane's last item counts, which is
// exactly what acceptItems checks, so a wrong yes can't repeat tick after tick.
function laneRoom(game, items, kind, v, enter, soon, again) {
  const n = items.length;
  if (n === 0) return true;
  const jammed = !!kind || refused(game, items[0]);
  if (soon) return !jammed || n < 4;
  const gone = !again && !jammed && leaves(game, items[0], v) ? 1 : 0;
  if (n - gone >= 4) return false;
  if (n - gone === 0) return true;
  return items[n - 1].pos + (jammed ? 0 : v) - BAL.spacing >= enter - EPS;
}
// Mirrors acceptMachine's dead-end rules: under the normal cap, or overstock while starved.
function crafterTakes(m, item) {
  if (m.recipe === null) return FURNACE_IN[item] === 1;
  const r = RECIPES[m.recipe], need = r.in[item];
  if (need === undefined) return false;
  const have = m.buf[item] ?? 0;
  if (have < BAL.ingBatches * need) return true;
  for (const k in r.in) if ((m.buf[k] ?? 0) < r.in[k]) return have < BAL.overstock;
  return false;
}
// A hold that is about to move on (or, soon, isn't stuck) leaves room behind it.
const holdClears = (game, t, v, soon) => t.hold === null || (!t.blockedKind && (soon ? !refused(game, t.hold) : leaves(game, t.hold, v)));
// again: the item was refused last tick. Only a belt or bridge lane is trusted to take it now;
// for pieces and machines the guess is rougher, so the item stays held until it really moves.
function frontTakes(game, x, y, dir, item, v, enter, soon, again) {
  const t = entAt(game, x + DX[dir], y + DY[dir]);
  if (t === null) return false;
  switch (t.type) {
    case 'belt': return dir !== (t.dir + 2) % 4 && laneRoom(game, t.items, t.blockedKind, v, enter, soon, again);
    case 'bridge':
      return dir === t.dirH ? laneRoom(game, t.laneH, t.blockedKindH, v, enter, soon, again)
        : dir === t.dirV ? laneRoom(game, t.laneV, t.blockedKindV, v, enter, soon, again) : false;
  }
  if (again) return false;
  switch (t.type) {
    case 'tunnel_in': {
      const p = game.ents.get(t.pair), u = t.under;
      // A full tunnel still takes one if its oldest item surfaces this tick.
      return dir === t.dir && p !== undefined && (soon || u.length < 4 * (Math.abs(p.x - t.x) + Math.abs(p.y - t.y)) || u[0].left <= 1);
    }
    case 'splitter': return dir === t.dir && holdClears(game, t, v, soon);
    case 'merger': return dir !== (t.dir + 2) % 4 && holdClears(game, t, v, soon);
    case 'storage': return t.queue.length < game.mods.storageCap;
    case 'hub': return true;
    case 'generator': return (item === 'coal' || (item === 'fuel_cell' && game.tier >= 11)) && t.fuel.coal + t.fuel.fuel_cell < BAL.genFuelMax;
    case 'furnace': case 'assembler': case 'fabricator': case 'foundry': case 'refinery': return crafterTakes(t, item);
    default: return false;
  }
}

// Interpolates one lane: pos + min(v * alpha, room ahead). The front item's room is the tile
// edge and beyond when the next tile will take it, otherwise the waiting spot.
function lane(game, items, x, y, inDir, dir, kind, va, v) {
  const n = items.length;
  if (n === 0) return;
  const f = items[0];
  // Like stepLane: the front item is offered once it reaches the tile edge or the waiting spot;
  // short of that it just moves on, and only has to be taken next tick.
  const soon = f.pos + v < 1 - EPS && f.pos < BAL.waitPos - EPS;
  // A refused front item stays put until taken; letting it creep forward and snap back every
  // tick would make every blocked belt wobble.
  const again = !kind && refused(game, f);
  const held = !!kind || !frontTakes(game, x, y, dir, f.item, v, Math.max(0, f.pos + v - 1), soon && !again, again);
  let lim = held ? BAL.waitPos : Infinity;
  for (let k = 0; k < n; k++) {
    const it = items[k];
    let p = it.pos + va;
    if (p > lim) p = lim;
    beltPoint(PT, x, y, inDir, dir, p);
    pushItem(it.item, PT[0] * Z + OX, PT[1] * Z + OY);
    lim = p - BAL.spacing;
  }
}

function drawItems(ctx, game, alpha, theme) {
  IC.fill(0);
  const v = beltSpeed(game), va = v * alpha;
  for (let i = 0; i < nVC; i++) {
    const e = VC[i];
    switch (e.type) {
      case 'belt': lane(game, e.items, e.x, e.y, VIN[i], e.dir, e.blockedKind, va, v); break;
      case 'tunnel_out': lane(game, e.items, e.x, e.y, e.dir, e.dir, e.blockedKind, va, v); break;
      case 'bridge':
        lane(game, e.laneH, e.x, e.y, e.dirH, e.dirH, e.blockedKindH, va, v);
        lane(game, e.laneV, e.x, e.y, e.dirV, e.dirV, e.blockedKindV, va, v);
        break;
      // A held item is drawn at the centre; its sim pos starts near the far edge by design.
      case 'splitter': case 'merger':
        if (e.hold) pushItem(e.hold.item, (e.x + 0.5) * Z + OX, (e.y + 0.5) * Z + OY);
        break;
    }
  }
  // Contrasting edge: every item's silhouette, slightly enlarged, in one fill of a theme colour
  // that stands out from the background (coal reads on dark, plastic on light). One fill is far
  // cheaper than stroking each type, and touching items merge like stickers instead of crossing.
  let total = 0;
  for (let i = 0; i < NI; i++) total += IC[i];
  if (total === 0) return;
  const r = ITEM_R * Z, re = r + Math.max(0.9, Z * 0.03);
  ctx.beginPath();
  for (let i = 0; i < NI; i++) {
    const n = IC[i], b = IB[i], shape = ITEM_SHAPE[i];
    for (let k = 0; k < 2 * n; k += 2) shape(ctx, b[k], b[k + 1], re);
  }
  ctx.fillStyle = theme.itemEdge; ctx.fill();
  for (let i = 0; i < NI; i++) {
    const n = IC[i];
    if (n === 0) continue;
    const b = IB[i], shape = ITEM_SHAPE[i];
    ctx.beginPath();
    for (let k = 0; k < 2 * n; k += 2) shape(ctx, b[k], b[k + 1], r);
    ctx.fillStyle = ITEM_COLOR[i]; ctx.fill();
  }
}

// ---------------------------------------------------------------- belts, machines, markers

function drawBelts(ctx, game, alpha, theme) {
  // Rails, then running surfaces, of every belt and tunnel arm: two fills for the whole screen.
  for (let pass = 0; pass < 2; pass++) {
    const W = pass === 0 ? RAIL_W : BODY_W, ext = pass === 0 ? EXT_RAIL : EXT_BODY;
    ctx.beginPath();
    for (let i = 0; i < nVC; i++) {
      const e = VC[i];
      if (e.type === 'belt') addStrip(ctx, e.x * Z + OX, e.y * Z + OY, Z, VIN[i], e.dir, W, VEXT[i] === 1 ? ext : 0);
      else if (e.type === 'tunnel_in' || e.type === 'tunnel_out') addStrip(ctx, e.x * Z + OX, e.y * Z + OY, Z, e.dir, e.dir, W, 0);
    }
    ctx.fillStyle = pass === 0 ? theme.beltEdge : theme.belt; ctx.fill();
  }
  // Chevrons glide at item speed in sim time, so belts look alive and freeze when the game pauses.
  const v = beltSpeed(game), phase = ((game.tick + alpha) * v) % 1, per = Z >= 36 ? 2 : 1, s = 0.1 * Z;
  ctx.beginPath();
  for (let i = 0; i < nVC; i++) {
    const e = VC[i];
    if (e.type !== 'belt') continue;
    for (let k = 0; k < per; k++) {
      let t = phase + k / per;
      if (t >= 1) t -= 1;
      beltPoint(PT, e.x, e.y, VIN[i], e.dir, t);
      addChevron(ctx, PT[0] * Z + OX, PT[1] * Z + OY, PT[2], PT[3], s);
    }
  }
  ctx.strokeStyle = theme.chevron; ctx.lineWidth = Math.max(1, 0.05 * Z); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  for (let i = 0; i < nVC; i++) {
    const e = VC[i];
    if (e.type === 'bridge') drawBridge(ctx, e, e.x * Z + OX, e.y * Z + OY, Z, theme);
    else if (e.type === 'splitter' || e.type === 'merger') drawSplitMerge(ctx, e, e.x * Z + OX, e.y * Z + OY, Z, theme);
  }
}

const gaugeOf = (game, m) => (m.type === 'storage' ? m.queue.length / game.mods.storageCap
  : m.type === 'generator' ? (m.fuel.coal + m.fuel.fuel_cell) / BAL.genFuelMax : -1);

function drawMachines(ctx, game, alpha, theme) {
  const t = game.tick + alpha;
  for (let i = 0; i < nVM; i++) {
    const m = VM[i], x = m.x * Z + OX, y = m.y * Z + OY;
    if (m.type === 'hub') {
      const age = game.tick - game.hubPulse;
      drawHub(ctx, x, y, Z, theme, age >= 0 && age < PULSE_TICKS ? 1 - (age + alpha) / PULSE_TICKS : 0);
    } else if (m.type === 'pole') drawPole(ctx, x, y, Z, theme);
    else drawMachine(ctx, m, x, y, Z, theme, m.type !== 'storage' && track(game, m).working, t, gaugeOf(game, m));
  }
  // Tunnel portals go over the items so they slide into and out of the mouth.
  for (let i = 0; i < nVC; i++) {
    const e = VC[i];
    if (e.type === 'tunnel_in' || e.type === 'tunnel_out') drawTunnelHood(ctx, e, e.x * Z + OX, e.y * Z + OY, Z, theme);
  }
}

function drawStatus(ctx, game, theme, ov) {
  for (let i = 0; i < nVM; i++) {
    const m = VM[i];
    if (STATUS[m.type] !== 1) continue;
    const k = shownStatus(track(game, m), game.tick);
    if (k === 0) continue;
    const col = k === POWER_OFF ? theme.bad : theme.warn, rx = (m.x + m.w) * Z + OX, ty = m.y * Z + OY;
    if (ov) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(rx - 4, ty + 4, 3, 0, TAU); ctx.fill(); continue; }
    const r = Math.min(11, Math.max(6, 0.19 * Z));
    drawStatusIcon(ctx, k, rx - r * 0.95, ty + r * 0.95, r, col, theme);
  }
}

function marker(ctx, e, kind, d, theme, ov) {
  if (kind !== 'never' && kind !== 'stall') return;
  // At the exit corner on the right-hand side, so the stuck front item itself stays visible.
  const rd = (d + 1) % 4, f = ov ? 0 : 0.27;
  const x = (e.x + 0.5 + (DX[d] + DX[rd]) * f) * Z + OX, y = (e.y + 0.5 + (DY[d] + DY[rd]) * f) * Z + OY;
  drawBlockedMarker(ctx, x, y, ov ? 3 : Math.min(10, Math.max(5, 0.17 * Z)), kind === 'never' ? theme.bad : theme.warn, theme, ov);
}

function drawBlocked(ctx, theme, ov) {
  for (let i = 0; i < nVC; i++) {
    const e = VC[i];
    if (e.type === 'bridge') { marker(ctx, e, e.blockedKindH, e.dirH, theme, ov); marker(ctx, e, e.blockedKindV, e.dirV, theme, ov); }
    else if (e.type !== 'tunnel_in') marker(ctx, e, e.blockedKind, e.dir, theme, ov);
  }
}

// Overview: coloured blocks and 2 px belt lines, so a whole factory reads at a glance.
function drawOverview(ctx, theme) {
  ctx.beginPath();
  for (let i = 0; i < nVC; i++) {
    const e = VC[i], ox = e.x * Z + OX, oy = e.y * Z + OY;
    switch (e.type) {
      case 'belt': addBeltLine(ctx, ox, oy, Z, VIN[i], e.dir); break;
      case 'bridge': addBeltLine(ctx, ox, oy, Z, e.dirH, e.dirH); addBeltLine(ctx, ox, oy, Z, e.dirV, e.dirV); break;
      case 'splitter': case 'merger': addBeltLine(ctx, ox, oy, Z, 0, 0); addBeltLine(ctx, ox, oy, Z, 1, 1); break;
      default: addBeltLine(ctx, ox, oy, Z, e.dir, e.dir);
    }
  }
  ctx.strokeStyle = theme.beltLine; ctx.lineWidth = 2; ctx.lineCap = 'butt'; ctx.stroke();
  // Pieces as small blocks on the lines.
  for (let p = 0; p < 3; p++) {
    const want = p === 0 ? 'splitter' : p === 1 ? 'merger' : 'tunnel_in';
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < nVC; i++) {
      const e = VC[i];
      if (e.type !== want && !(p === 2 && e.type === 'tunnel_out')) continue;
      ctx.rect((e.x + 0.22) * Z + OX, (e.y + 0.22) * Z + OY, 0.56 * Z, 0.56 * Z);
      any = true;
    }
    if (any) { ctx.fillStyle = COL[want]; ctx.fill(); }
  }
  for (let k = 0; k < BLOCK_TYPES.length; k++) {
    const type = BLOCK_TYPES[k], small = type === 'pole' ? 0.25 : 0;
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < nVM; i++) {
      const m = VM[i];
      if (m.type !== type) continue;
      ctx.rect((m.x + small) * Z + OX + 1, (m.y + small) * Z + OY + 1, (m.w - 2 * small) * Z - 2, (m.h - 2 * small) * Z - 2);
      any = true;
    }
    if (any) { ctx.fillStyle = COL[type]; ctx.fill(); }
    if (any && type === 'hub') { ctx.strokeStyle = theme.accent; ctx.lineWidth = 2; ctx.stroke(); }
  }
}

// ---------------------------------------------------------------- lock badges

// Connected patches of not-yet-mineable ore, found once per world. The badge sits on the patch
// tile nearest its centroid, so a crescent clipped by a ring edge still gets it on ore.
const lockCache = new WeakMap();
function lockPatches(world) {
  let ps = lockCache.get(world);
  if (ps !== undefined) return ps;
  ps = [];
  const ore = world.ore, seen = new Uint8Array(MAP * MAP), stack = new Int32Array(MAP * MAP);
  for (let i = 0; i < ore.length; i++) {
    const o = ore[i];
    if (!o || seen[i] || !(ORE_TIER[o] > 1)) continue;
    let top = 0, n = 0, sx = 0, sy = 0;
    stack[top++] = i; seen[i] = 1;
    const members = [];
    while (top > 0) {
      const c = stack[--top], x = c % MAP, y = (c - x) / MAP;
      members.push(c); sx += x; sy += y; n++;
      if (x > 0 && !seen[c - 1] && ore[c - 1] === o) { seen[c - 1] = 1; stack[top++] = c - 1; }
      if (x < MAP - 1 && !seen[c + 1] && ore[c + 1] === o) { seen[c + 1] = 1; stack[top++] = c + 1; }
      if (y > 0 && !seen[c - MAP] && ore[c - MAP] === o) { seen[c - MAP] = 1; stack[top++] = c - MAP; }
      if (y < MAP - 1 && !seen[c + MAP] && ore[c + MAP] === o) { seen[c + MAP] = 1; stack[top++] = c + MAP; }
    }
    if (n < 3) continue; // slivers clipped by a ring edge would only add clutter
    const cx = sx / n, cy = sy / n;
    let best = members[0], bd = Infinity;
    for (const c of members) { const x = c % MAP, y = (c - x) / MAP, d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = c; } }
    ps.push({ x: (best % MAP) + 0.5, y: Math.floor(best / MAP) + 0.5, tier: ORE_TIER[o] });
  }
  lockCache.set(world, ps);
  return ps;
}

function drawBadges(ctx, game, theme) {
  const ps = lockPatches(game.world);
  let fontSet = false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.tier <= game.tier) continue;
    const sx = p.x * Z + OX, sy = p.y * Z + OY;
    if (sx < -30 || sy < -20 || sx > VW + 30 || sy > VH + 20) continue;
    // Constant screen size, so badges stay readable in overview.
    const w = p.tier >= 10 ? 46 : 40, h = 20, x = sx - w / 2, y = sy - h / 2;
    ctx.globalAlpha = 0.88; ctx.fillStyle = theme.text; rrect(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.globalAlpha = 1;
    drawPadlock(ctx, x + 12, sy - 2, 12, theme.bg);
    if (!fontSet) { ctx.font = BADGE_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; fontSet = true; }
    ctx.fillStyle = theme.bg; ctx.fillText(TIER_LABEL[p.tier], x + 21, sy + 0.5);
  }
}

// ---------------------------------------------------------------- power overlay

// Network links as a spanning tree over generators and poles within reach, so a dense pole
// grid draws as a clean tree instead of a mesh. Rebuilt only when power.js rebuilds its nets.
const powerCache = new WeakMap();
function powerInfo(game) {
  const pc = powerCache.get(game);
  if (pc !== undefined && pc.nets === game.nets && pc.mods === game.mods) return pc;
  const nodes = [];
  for (const e of game.ents.values()) if (e.type === 'generator' || e.type === 'pole') nodes.push(e);
  const n = nodes.length, reach = game.mods.poleReach, pairs = [];
  const cx = nodes.map((e) => e.x + e.w / 2), cy = nodes.map((e) => e.y + e.h / 2);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = cx[j] - cx[i], dy = cy[j] - cy[i];
    if (Math.abs(dx) <= reach && Math.abs(dy) <= reach) pairs.push([dx * dx + dy * dy, i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const parent = nodes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const links = [];
  for (const [, i, j] of pairs) { const a = find(i), b = find(j); if (a !== b) { parent[a] = b; links.push(i, j); } }
  // A network's id is its lowest member id (power.js), which is how a node finds its network.
  const minId = new Map();
  nodes.forEach((e, i) => { const r = find(i); minId.set(r, Math.min(minId.get(r) ?? Infinity, e.id)); });
  const byId = new Map(game.nets.map((nt) => [nt.id, nt]));
  const info = { nets: game.nets, mods: game.mods, nodes, links, cx, cy, net: nodes.map((e, i) => byId.get(minId.get(find(i))) ?? null) };
  powerCache.set(game, info);
  return info;
}

// 0 nothing to power, 1 fully powered, 2 low power, 3 no supply.
function netState(net) {
  if (!net || net.consumers.length === 0) return 0;
  const pm = net.consumers[0].pmult;
  return pm >= 1 - 1e-9 ? 1 : pm > BAL.unpowered + 1e-9 ? 2 : 3;
}
const stateColor = (s, theme) => (s === 0 ? theme.power : s === 1 ? theme.accent : s === 2 ? theme.warn : theme.bad);

function drawPower(ctx, game, theme) {
  const pi = powerInfo(game), half = game.mods.coverHalf, nodes = pi.nodes;
  // Coverage squares as one path: the union fills once, so overlaps don't darken.
  ctx.beginPath();
  for (let i = 0; i < nodes.length; i++) {
    const e = nodes[i], x = (e.x - half) * Z + OX, y = (e.y - half) * Z + OY, w = (e.w + 2 * half) * Z, h = (e.h + 2 * half) * Z;
    if (x > VW || y > VH || x + w < 0 || y + h < 0) continue;
    ctx.rect(x, y, w, h);
  }
  ctx.globalAlpha = 0.16; ctx.fillStyle = theme.power; ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (let s = 0; s < 4; s++) {
    let any = false;
    ctx.beginPath();
    for (let k = 0; k < pi.links.length; k += 2) {
      const i = pi.links[k], j = pi.links[k + 1];
      if (netState(pi.net[i]) !== s) continue;
      ctx.moveTo(pi.cx[i] * Z + OX, pi.cy[i] * Z + OY); ctx.lineTo(pi.cx[j] * Z + OX, pi.cy[j] * Z + OY);
      any = true;
    }
    for (let i = 0; i < nodes.length; i++) {
      if (netState(pi.net[i]) !== s) continue;
      const x = pi.cx[i] * Z + OX, y = pi.cy[i] * Z + OY;
      ctx.moveTo(x + 4, y); ctx.arc(x, y, 4, 0, TAU);
      any = true;
    }
    if (any) { ctx.strokeStyle = stateColor(s, theme); ctx.stroke(); ctx.fillStyle = stateColor(s, theme); ctx.fill(); }
  }
  // Machines that need power, outlined in their network's state; red when no pole reaches them.
  ctx.lineWidth = 2;
  for (let i = 0; i < nVM; i++) {
    const m = VM[i];
    if (!(BUILDINGS[m.type]?.power > 0)) continue;
    let net = null;
    for (let k = 0; k < game.nets.length; k++) if (game.nets[k].id === m.net) net = game.nets[k];
    ctx.strokeStyle = net === null ? theme.bad : stateColor(netState(net), theme);
    rrect(ctx, m.x * Z + OX + 2, m.y * Z + OY + 2, m.w * Z - 4, m.h * Z - 4, 0.2 * Z); ctx.stroke();
  }
}

// ---------------------------------------------------------------- previews

// One reusable stand-in entity for ghosts, so dragging a ghost allocates nothing per frame.
const GHOST = { id: 0, type: 'belt', x: 0, y: 0, w: 1, h: 1, dir: 0, dirH: 1, dirV: 0, recipe: null, ore: null };

function drawSingle(ctx, e, theme, t) {
  const x = e.x * Z + OX, y = e.y * Z + OY;
  switch (e.type) {
    case 'belt': drawBeltTile(ctx, x, y, Z, e.dir, e.dir, theme); break;
    case 'tunnel_in': case 'tunnel_out': drawBeltTile(ctx, x, y, Z, e.dir, e.dir, theme); drawTunnelHood(ctx, e, x, y, Z, theme); break;
    case 'bridge': drawBridge(ctx, e, x, y, Z, theme); break;
    case 'splitter': case 'merger': drawSplitMerge(ctx, e, x, y, Z, theme); break;
    case 'hub': drawHub(ctx, x, y, Z, theme, 0); break;
    case 'pole': drawPole(ctx, x, y, Z, theme); break;
    default: drawMachine(ctx, e, x, y, Z, theme, false, t, -1);
  }
}

function label(ctx, text, cx, bottom, theme) {
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 18, h = 24;
  const x = Math.min(VW - w - 4, Math.max(4, cx - w / 2)), y = Math.max(4, bottom - h);
  ctx.globalAlpha = 0.92; ctx.fillStyle = theme.text; rrect(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
}

// view.ghost: {type, x, y, ok, reason?, dir?, dirH?, dirV?, recipe?, ore?}; red with its reason when !ok.
function drawGhost(ctx, g, theme, t, mag) {
  const type = g.type === 'tunnel' ? 'tunnel_in' : g.type, size = sizeOf(type);
  if (!size) return;
  const e = GHOST;
  e.type = type; e.x = g.x; e.y = g.y; e.w = size.w; e.h = size.h; e.dir = g.dir ?? 0;
  e.dirH = g.dirH ?? 1; e.dirV = g.dirV ?? 0; e.recipe = g.recipe ?? null; e.ore = g.ore ?? null;
  const x = g.x * Z + OX, y = g.y * Z + OY, w = size.w * Z, h = size.h * Z, ok = g.ok !== false;
  ctx.globalAlpha = 0.62; drawSingle(ctx, e, theme, t); ctx.globalAlpha = 1;
  if (!ok) { ctx.globalAlpha = 0.3; ctx.fillStyle = theme.bad; rrect(ctx, x, y, w, h, 0.2 * Z); ctx.fill(); ctx.globalAlpha = 1; }
  ctx.strokeStyle = ok ? theme.accent : theme.bad; ctx.lineWidth = 2; ctx.setLineDash(DASH);
  rrect(ctx, x + 1, y + 1, w - 2, h - 2, 0.2 * Z); ctx.stroke(); ctx.setLineDash(NO_DASH);
  // The bubble is too small for the reason; the full-size ghost already shows it.
  if (!ok && g.reason && !mag) label(ctx, g.reason, x + w / 2, y - 6, theme);
}

// Entry direction of preview tile i: the previous tile's direction when it leads into this one.
function previewIn(bp, i) {
  const t = bp[i];
  if (i === 0) return t.dir;
  const p = bp[i - 1];
  return p.x + DX[p.dir] === t.x && p.y + DY[p.dir] === t.y ? p.dir : t.dir;
}

// view.beltPreview: [{x, y, dir, bad?}], drawn as belts with an accent rail, red where blocked.
function drawBeltPreview(ctx, bp, theme) {
  ctx.globalAlpha = 0.8;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < bp.length; i++) {
      const t = bp[i];
      if ((pass === 0 && t.bad) || (pass === 1 && !t.bad)) continue;
      addStrip(ctx, t.x * Z + OX, t.y * Z + OY, Z, previewIn(bp, i), t.dir, pass < 2 ? RAIL_W : BODY_W, 0);
      any = true;
    }
    if (any) { ctx.fillStyle = pass === 0 ? theme.accent : pass === 1 ? theme.bad : theme.belt; ctx.fill(); }
  }
  ctx.beginPath();
  for (let i = 0; i < bp.length; i++) {
    const t = bp[i];
    beltPoint(PT, t.x, t.y, previewIn(bp, i), t.dir, 0.5);
    addChevron(ctx, PT[0] * Z + OX, PT[1] * Z + OY, PT[2], PT[3], 0.1 * Z);
  }
  ctx.strokeStyle = theme.chevron; ctx.lineWidth = Math.max(1, 0.05 * Z); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPreviews(ctx, game, alpha, view, theme, mag) {
  const t = game.tick + alpha;
  const sel = typeof view.selected === 'number' ? game.ents.get(view.selected) : view.selected;
  if (sel) {
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 2.5;
    rrect(ctx, (sel.x - 0.04) * Z + OX, (sel.y - 0.04) * Z + OY, (sel.w + 0.08) * Z, (sel.h + 0.08) * Z, 0.24 * Z); ctx.stroke();
  }
  // view.tunnelExits: [[x, y], ...] as returned by validTunnelExits; a slow pulse invites the tap.
  const ex = view.tunnelExits;
  if (ex && ex.length) {
    ctx.beginPath();
    for (let i = 0; i < ex.length; i++) addRRect(ctx, (ex[i][0] + 0.08) * Z + OX, (ex[i][1] + 0.08) * Z + OY, 0.84 * Z, 0.84 * Z, 0.18 * Z);
    ctx.globalAlpha = 0.22 + 0.14 * Math.sin(t * 0.3); ctx.fillStyle = theme.accent; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 2; ctx.stroke();
  }
  if (view.beltPreview && view.beltPreview.length) drawBeltPreview(ctx, view.beltPreview, theme);
  if (view.ghost) drawGhost(ctx, view.ghost, theme, t, mag);
}

// ---------------------------------------------------------------- frame

function drawWorld(ctx, game, cam, alpha, view, theme, mag) {
  setCam(cam);
  gather(game, cam);
  const mx = Math.max(0, OX), my = Math.max(0, OY);
  const mw = Math.min(VW, MAP * Z + OX) - mx, mh = Math.min(VH, MAP * Z + OY) - my;
  if (mw > 0 && mh > 0) { ctx.fillStyle = theme.ground; ctx.fillRect(mx, my, mw, mh); }
  terrainFor(game.world).draw(ctx, cam, theme);
  if (!mag) drawBadges(ctx, game, theme);
  const ov = Z < OVERVIEW_Z;
  if (ov) drawOverview(ctx, theme);
  else {
    drawBelts(ctx, game, alpha, theme);
    drawItems(ctx, game, alpha, theme);
    drawMachines(ctx, game, alpha, theme);
  }
  drawStatus(ctx, game, theme, ov);
  drawBlocked(ctx, theme, ov);
  if (!mag && view.powerOverlay) drawPower(ctx, game, theme);
  drawPreviews(ctx, game, alpha, view, theme, mag);
}

// view.magnifier: {x, y, tile: [tx, ty]} with x, y the finger in screen px. The bubble floats
// ~80 px above the finger at a closer zoom and outlines the tile the finger is on.
const MAG_R = 62, MAG_LIFT = 80;
const magCam = { x: 0, y: 0, z: 44, vw: 0, vh: 0 };
function drawMagnifier(ctx, game, cam, alpha, view, theme) {
  const m = view.magnifier, tile = m.tile;
  const tx = tile ? tile[0] : Math.floor((m.x - cam.vw / 2) / cam.z + cam.x);
  const ty = tile ? tile[1] : Math.floor((m.y - cam.vh / 2) / cam.z + cam.y);
  let bx = m.x, by = m.y - MAG_LIFT;
  // Near the top edge the bubble moves beside the finger rather than off screen.
  if (by - MAG_R < 4) {
    by = Math.min(cam.vh - MAG_R - 4, Math.max(MAG_R + 4, m.y));
    bx = m.x + (m.x < cam.vw / 2 ? 1 : -1) * (MAG_R + 48);
  }
  bx = Math.min(cam.vw - MAG_R - 4, Math.max(MAG_R + 4, bx));
  magCam.z = Math.min(96, Math.max(36, cam.z * 1.35));
  magCam.x = tx + 0.5; magCam.y = ty + 0.5; magCam.vw = magCam.vh = 2 * MAG_R;
  ctx.fillStyle = theme.shadow; ctx.beginPath(); ctx.arc(bx, by + 3, MAG_R + 2, 0, TAU); ctx.fill();
  ctx.save();
  ctx.translate(bx - MAG_R, by - MAG_R);
  ctx.beginPath(); ctx.arc(MAG_R, MAG_R, MAG_R, 0, TAU); ctx.clip();
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, 2 * MAG_R, 2 * MAG_R);
  drawWorld(ctx, game, magCam, alpha, view, theme, true);
  const s = magCam.z;
  ctx.strokeStyle = theme.accent; ctx.lineWidth = 2.5; rrect(ctx, MAG_R - s / 2, MAG_R - s / 2, s, s, 0.16 * s); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = theme.panel; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(bx, by, MAG_R, 0, TAU); ctx.stroke();
  ctx.strokeStyle = theme.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(bx, by, MAG_R + 2.5, 0, TAU); ctx.stroke();
}

// alpha in [0, 1) is how far the sim is toward its next tick; view may be omitted.
export function drawFrame(ctx, game, cam, alpha, view, theme) {
  view = view || NO_VIEW;
  ctx.globalAlpha = 1; ctx.setLineDash(NO_DASH);
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, cam.vw, cam.vh);
  drawWorld(ctx, game, cam, alpha, view, theme, false);
  if (view.magnifier) drawMagnifier(ctx, game, cam, alpha, view, theme);
}

// ---------------------------------------------------------------- theme

const THEME_VARS = ['bg', 'ground', 'grid', 'belt', 'belt-edge', 'belt-line', 'chevron', 'panel', 'text', 'warn', 'bad', 'accent', 'power', 'item-edge', 'shadow'];
const THEME_KEYS = THEME_VARS.map((v) => v.replace(/-(\w)/g, (_, c) => c.toUpperCase()));

// Colours come from the CSS custom properties in styles.css, so both themes live in one place.
// Keep the returned object between frames: the terrain cache rebuilds when its colours change.
export function readTheme() {
  const cs = getComputedStyle(document.documentElement), t = {};
  for (let i = 0; i < THEME_VARS.length; i++) t[THEME_KEYS[i]] = cs.getPropertyValue(`--${THEME_VARS[i]}`).trim() || '#808080';
  return t;
}

// Calls onChange(readTheme()) whenever the phone switches light/dark; returns an unsubscribe.
export function watchTheme(onChange) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)'), fn = () => onChange(readTheme());
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
