// Bridges and tunnels. Every lane reuses the belt lane code so queueing, capacity and credit
// rules can never drift apart from plain belts.
import { NEVER, OK, BUSY, offer } from './offer.js';
import { acceptItems, stepLane, beltSpeed, EPS } from './belts.js';

// A bridge is two independent one-tile belts sharing a footprint; a lane only takes items
// already travelling along it, so the crossing flows can never mix.
export function acceptBridge(game, e, item, moveDir, pos) {
  if (moveDir === e.dirH) return acceptItems(game, e.laneH, item, pos);
  if (moveDir === e.dirV) return acceptItems(game, e.laneV, item, pos);
  return NEVER;
}

export function stepBridge(game, e, v) {
  const h = stepLane(game, e.x, e.y, e.laneH, e.dirH, v);
  const w = stepLane(game, e.x, e.y, e.laneV, e.dirV, v);
  if (h !== undefined) e.blockedH = h;
  if (w !== undefined) e.blockedV = w;
  e.blocked = e.blockedH ?? e.blockedV ?? null;
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
  const r = stepLane(game, e.x, e.y, e.items, e.dir, v);
  if (r !== undefined) e.blocked = r;
}
