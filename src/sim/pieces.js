// Bridges and tunnels. Every lane reuses the belt lane code so queueing, capacity and credit
// rules can never drift apart from plain belts.
import { BAL, DX, DY } from '../config.js';
import { entAt } from '../game/state.js';
import { NEVER, OK, BUSY, offer } from './offer.js';
import { acceptItems, stepLane, markLane, LANE, LANE_H, LANE_V, beltSpeed, EPS } from './belts.js';

// A bridge is two independent one-tile belts sharing a footprint; a lane only takes items
// already travelling along it, so the crossing flows can never mix.
export function acceptBridge(game, e, item, moveDir, pos) {
  if (moveDir === e.dirH) return acceptItems(game, e.laneH, item, pos);
  if (moveDir === e.dirV) return acceptItems(game, e.laneV, item, pos);
  return NEVER;
}

export function stepBridge(game, e, v) {
  stepLane(game, e.x, e.y, e.laneH, e.dirH, v, e, LANE_H);
  stepLane(game, e.x, e.y, e.laneV, e.dirV, v, e, LANE_V);
  // One marker per tile; a lane that can never move outranks one that is only full.
  const h = e.blockedKindH === 'never' || (e.blockedKindH !== null && e.blockedKindV !== 'never');
  e.blocked = h ? e.blockedH : e.blockedV;
  e.blockedKind = h ? e.blockedKindH : e.blockedKindV;
}

// Tiles from entrance to exit, which is also the underground length in tiles.
const span = (a, b) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

export function acceptTunnelIn(game, e, item, moveDir) {
  if (moveDir !== e.dir) return NEVER;
  const out = game.ents.get(e.pair);
  if (!out) return NEVER;
  const d = span(e, out);
  if (e.under.length >= 4 * d) return BUSY;
  // Travel time is fixed at entry so a later belt-speed upgrade never reorders items underground.
  e.under.push({ item, left: Math.ceil(d / beltSpeed(game) - EPS) });
  return OK;
}

export function stepTunnelIn(game, e, v) {
  const out = game.ents.get(e.pair);
  const { under } = e;
  for (const u of under) u.left = Math.max(0, u.left - 1);
  // Only the front item may surface: everyone entered with the same travel time, so FIFO holds
  // and a blocked exit backs the queue up underground instead of reordering it.
  while (out && under.length && under[0].left <= 0) {
    if (offer(game, out, under[0].item, e.dir, 0, 'tunnel') !== OK) break;
    under.shift();
  }
}

// The exit is a belt tile that nothing but its own entrance may feed.
export function acceptTunnelOut(game, e, item, pos, mode) {
  if (mode !== 'tunnel') return NEVER;
  // Underground travel is whole ticks, so surfacing gets the same one-tick credit as a belt
  // insert; without it a saturated trunk through a tunnel would drop to 6.67 items/s.
  return acceptItems(game, e.items, item, pos, beltSpeed(game));
}

export function stepTunnelOut(game, e, v) {
  stepLane(game, e.x, e.y, e.items, e.dir, v, e, LANE);
}

// Splitters and mergers hold one item that crosses the tile. It enters near the far edge
// (1 - spacing) whatever pos was offered: crossing the whole tile would cap the piece at
// 2 items/s, while this lets it pass roughly one item per spacing of travel.
// The hold is marked with the same texts and rules as a belt lane.
function stepHold(game, e, v, targets) {
  const h = e.hold;
  const { waitPos } = BAL;
  const np = h.pos + v;
  // Same rule as a belt's front item: offer on arrival, and keep offering once waiting so a
  // blocked hold doesn't bounce between waitPos and the tile edge.
  if (np < 1 - EPS && h.pos < waitPos - EPS) { h.pos = np; markLane(e, LANE, OK); return; }
  let busy = false, by = null, r = BUSY;
  for (const t of targets) {
    const res = offer(game, t.ent, h.item, t.dir, Math.max(0, np - 1), 'deadEnd');
    if (res === OK) {
      e.hold = null;
      markLane(e, LANE, OK);
      return t.done?.();
    }
    if (res === BUSY) busy = true;
    // The front output's reason wins, otherwise the first output that refused.
    else if (by === null || t.dir === e.dir) { by = t.ent; r = res; }
  }
  h.pos = waitPos;
  // Marked only when every output refuses: an output that is merely busy will take it later.
  markLane(e, LANE, busy || by === null ? BUSY : r, by, h.item);
}

export function acceptSplitter(game, e, item, moveDir) {
  if (moveDir !== e.dir) return NEVER;
  if (e.hold) return BUSY;
  e.hold = { item, pos: 1 - BAL.spacing };
  return OK;
}

// Ruling R29: a splitter output counts only where the neighbour takes items travelling in
// direction d. Offering to every non-facing belt would leak a trunk's items into a parallel
// belt beside it (belts accept side entry). Machines and the Hub refuse what they can't use.
export function takesMoving(ent, d) {
  switch (ent.type) {
    case 'belt': case 'tunnel_in': case 'splitter': return ent.dir === d;
    case 'merger': return d !== (ent.dir + 2) % 4;
    case 'bridge': return ent.dirH === d || ent.dirV === d;
    default: return true;
  }
}

export function stepSplitter(game, e, v) {
  if (!e.hold) return markLane(e, LANE, OK);
  // Left, front, right, rotated to start at rr so refusals just fall through to the next output.
  const outs = [(e.dir + 3) % 4, e.dir, (e.dir + 1) % 4];
  const targets = [];
  for (let k = 0; k < 3; k++) {
    const i = (e.rr + k) % 3, d = outs[i];
    const ent = entAt(game, e.x + DX[d], e.y + DY[d]);
    if (ent && takesMoving(ent, d)) targets.push({ ent, dir: d, done: () => { e.rr = (i + 1) % 3; } });
  }
  stepHold(game, e, v, targets);
}

// Input sides in the order the merger serves them: 0 left, 1 back, 2 right.
const sideDir = (e, s) => [(e.dir + 1) % 4, e.dir, (e.dir + 3) % 4][s];
const sideOf = (e, moveDir) => [1, 0, -1, 2][(moveDir - e.dir + 4) % 4];

// The items queued on whatever feeds side s, or null when nothing can feed from there.
function feeder(game, e, s) {
  const m = sideDir(e, s);
  const t = entAt(game, e.x - DX[m], e.y - DY[m]);
  if (!t) return null;
  switch (t.type) {
    case 'belt': case 'tunnel_out': return t.dir === m ? t.items : null;
    case 'bridge': return t.dirH === m ? t.laneH : t.dirV === m ? t.laneV : null;
    case 'splitter': case 'merger': return t.dir === m ? (t.hold ? [t.hold] : []) : null;
    default: return null;
  }
}

export function acceptMerger(game, e, item, moveDir) {
  if (moveDir === (e.dir + 2) % 4) return NEVER;
  if (e.hold) return BUSY;
  const s = sideOf(e, moveDir);
  if (s !== e.turn) {
    // Another input is next in line: yield only if its front item is about to be offered.
    const q = feeder(game, e, e.turn);
    if (q && q.length && q[0].pos >= BAL.waitPos - beltSpeed(game) - EPS) return BUSY;
  }
  e.hold = { item, pos: 1 - BAL.spacing };
  // Skip sides nothing feeds, otherwise the turn would park on an empty side and the first
  // belt in processing order would win every contest.
  e.turn = (s + 1) % 3;
  for (let k = 1; k <= 3; k++) { const c = (s + k) % 3; if (feeder(game, e, c)) { e.turn = c; break; } }
  return OK;
}

export function stepMerger(game, e, v) {
  if (!e.hold) return markLane(e, LANE, OK);
  const ent = entAt(game, e.x + DX[e.dir], e.y + DY[e.dir]);
  stepHold(game, e, v, ent ? [{ ent, dir: e.dir }] : []);
}
