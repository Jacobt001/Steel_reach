// Single-lane belts: items hold a position 0..1 along the tile, front item is index 0.
import { BAL, TPS, DX, DY, ITEMS, BUILDINGS } from '../config.js';
import { entAt } from '../game/state.js';
import { offer, OK, BUSY, NEVER, STALL } from './offer.js';
import { pullPassBy, isPuller } from './machines.js';

// Saved positions are rounded to 3 decimals (Task 11), so float noise must never flip an
// outcome: every position comparison carries this tolerance.
export const EPS = 1e-6;

export const beltSpeed = (game) => BAL.beltTilesPerSec[game.mods.beltLevel] / TPS;

// Inserts made outside the conveyor step (feed helper, machine outputs) happen between ticks,
// so they get one tick of travel credit: without it an every-tick feed would only land every
// third tick (spacing 0.3, ~6.67 items/s) instead of the full 8/s. Hand-offs during the step
// are already positioned exactly and get no credit. Items never enter at a negative pos, so the
// 4-per-tile cap is a plain length test and a stopped tile can never hold a stranded 5th item.
// The lane logic works on a bare items array so belt tiles, both bridge lanes and tunnel_out
// share one algorithm; the caller does the direction check for its own lane.
// credit defaults to the between-tick rule; a caller that hands over mid-step but whose item was
// genuinely travelling that tick (tunnel exit) passes beltSpeed to keep full 8/s throughput.
export function acceptItems(game, items, item, pos, credit = game.stepping ? 0 : beltSpeed(game)) {
  if (items.length === 0) { items.push({ item, pos: Math.min(pos, BAL.waitPos) }); return OK; }
  if (items.length >= 4) return BUSY;
  const p = pos + credit;
  const room = items[items.length - 1].pos - BAL.spacing;
  if (room >= p - credit - EPS) { items.push({ item, pos: Math.min(p, room) }); return OK; }
  return BUSY;
}

export function acceptBelt(game, b, item, moveDir, pos) {
  if (moveDir === (b.dir + 2) % 4) return NEVER;
  return acceptItems(game, b.items, item, pos);
}

const nameOf = (t) => BUILDINGS[t.type === 'tunnel_in' || t.type === 'tunnel_out' ? 'tunnel' : t.type]?.name ?? t.type;

// Moves one lane whose tile is (x, y) and whose items travel along dir. Returns the blocked
// text: a reason only while the front item waits on a target that refuses it, else null (an
// empty lane included), so a marker can never outlive its cause.
export function stepLane(game, x, y, items, dir, v) {
  const { spacing, waitPos } = BAL;
  let limit = Infinity, blocked = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let np = Math.min(it.pos + v, limit);
    if (i === 0) {
      // A front item that already sat at the wait spot keeps offering every tick, otherwise
      // a blocked queue would bounce between 0.875 and 0.975 and wobble visibly.
      if (np >= 1 - EPS || it.pos >= waitPos - EPS) {
        const t = entAt(game, x + DX[dir], y + DY[dir]);
        const r = t ? offer(game, t, it.item, dir, Math.max(0, np - 1), 'deadEnd') : BUSY;
        if (r === OK) {
          items.shift(); blocked = null;
          i = -1; limit = Infinity; // the next item is the new front
          continue;
        }
        np = waitPos;
        blocked = r === NEVER ? `${nameOf(t)} can't use ${ITEMS[it.item].name}`
          : r === STALL ? `${nameOf(t)} is full of ${ITEMS[it.item].name}` : null;
      } else blocked = null;
    }
    it.pos = np;
    limit = np - spacing;
  }
  return blocked;
}

// A belt's left and right neighbours that pull from it, cached per topology version like machine
// output ports so the per-tick path makes no grid lookups. This runs for every loaded belt every
// tick, so it is a symbol-keyed property rather than a WeakMap (measured ~40% cheaper on 10,000
// items); JSON, structuredClone and for...in all skip symbol keys, so it never reaches a save.
const SIDES = Symbol('sides');

function sidePullers(game, b) {
  const live = !game.topoDirty;
  const hit = b[SIDES];
  if (live && hit !== undefined && hit.ver === game.topoVer) return hit;
  const l = (b.dir + 3) % 4, r = (b.dir + 1) % 4;
  const L = entAt(game, b.x + DX[l], b.y + DY[l]), R = entAt(game, b.x + DX[r], b.y + DY[r]);
  const c = { ver: game.topoVer, l: L && isPuller(L) ? L : null, r: R && isPuller(R) ? R : null };
  if (live) b[SIDES] = c;
  return c;
}

// Gives one side machine the front-most item it can use from this tile.
function pullOne(game, b, m) {
  const items = b.items;
  for (let i = 0; i < items.length; i++) {
    if (!pullPassBy(game, m, items[i].item)) continue;
    items.splice(i, 1);
    // The next item trails by a full spacing, so nothing is left waiting at the tile end.
    if (i === 0) b.blocked = null;
    return true;
  }
  return false;
}

export function stepBelt(game, b, v) {
  b.blocked = stepLane(game, b.x, b.y, b.items, b.dir, v);
  // Pulls come after movement so the belt's own target always gets first refusal of the front item.
  if (!b.items.length) return;
  const s = sidePullers(game, b);
  if (s.l === null && s.r === null) return;
  // b.side says which side picks first; a side that uses its turn hands it over, so two
  // machines wanting the same item from one belt share it instead of one starving the other.
  const first = b.side === 0 ? s.l : s.r, second = b.side === 0 ? s.r : s.l;
  if (first !== null && pullOne(game, b, first)) b.side ^= 1;
  if (second !== null && b.items.length) pullOne(game, b, second);
}
