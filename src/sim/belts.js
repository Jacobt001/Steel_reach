// Single-lane belts: items hold a position 0..1 along the tile, front item is index 0.
import { BAL, TPS, DX, DY, ITEMS, BUILDINGS } from '../config.js';
import { entAt } from '../game/state.js';
import { offer, OK, BUSY, NEVER, STALL } from './offer.js';

// Saved positions are rounded to 3 decimals (Task 11), so float noise must never flip an
// outcome: every position comparison carries this tolerance.
export const EPS = 1e-6;

export const beltSpeed = (game) => BAL.beltTilesPerSec[game.mods.beltLevel] / TPS;

// A 5th item (still at negative pos) is only safe if the front of the tile leaves this tick;
// if the front is refused instead, the whole queue compresses and the extra item stays stranded
// behind the tile edge. Refusals ripple down saturated belts within one tick, so the answer
// is found by following saturated tiles ahead until something can take an item. Anything that
// isn't a belt or the Hub counts as closed. The result is cached per tick, so a saturated line
// costs O(length) per tick rather than O(length^2).
const openMemo = new WeakMap();
function frontCanLeave(game, b, v) {
  let memo = openMemo.get(game);
  if (!memo || memo.tick !== game.tick) openMemo.set(game, memo = { tick: game.tick, open: new Map() });
  const path = [];
  let cur = b, res;
  for (;;) {
    if (memo.open.has(cur)) { res = memo.open.get(cur); break; }
    if (path.includes(cur)) { res = false; break; } // a saturated ring never frees itself
    path.push(cur);
    const f = cur.items[0];
    if (f.pos + v < 1 - EPS && f.pos < BAL.waitPos - EPS) { res = true; break; } // not offering yet: moving freely
    const t = entAt(game, cur.x + DX[cur.dir], cur.y + DY[cur.dir]);
    if (!t) { res = false; break; }
    if (t.type === 'hub') { res = true; break; }
    if (t.type !== 'belt' || cur.dir === (t.dir + 2) % 4) { res = false; break; }
    if (t.items.length < 4) {
      const entry = Math.max(0, f.pos + v - 1);
      res = t.items.length === 0 || t.items[t.items.length - 1].pos - BAL.spacing >= entry - v - EPS;
      break;
    }
    cur = t; // saturated: it only takes our item if its own front leaves
  }
  for (const n of path) memo.open.set(n, res);
  return res;
}

// Items may enter between ticks, so the entry check allows for one tick of travel: a feed
// offering every tick still reaches the full 8 items/s instead of every third tick.
export function acceptBelt(game, b, item, moveDir, pos) {
  if (moveDir === (b.dir + 2) % 4) return NEVER;
  const { items } = b;
  if (items.length === 0) { items.push({ item, pos: Math.min(pos, BAL.waitPos) }); return OK; }
  const v = beltSpeed(game);
  // The 4-per-tile cap mostly falls out of spacing (a blocked front waits at 0.875, so the 4th
  // item sits at 0.125 and fails the room check). The exception is a saturated 0.25-spaced
  // stream, which needs a 5th item still at negative pos while its front is leaving; allow that
  // only when the front can really leave, or the extra item would be stranded in a stopped tile.
  if (items.length >= 5 || (items.length === 4 && !frontCanLeave(game, b, v))) return BUSY;
  const room = items[items.length - 1].pos - BAL.spacing;
  if (room >= pos - v - EPS) { items.push({ item, pos: Math.min(pos, room) }); return OK; }
  return BUSY;
}

const nameOf = (t) => BUILDINGS[t.type === 'tunnel_in' || t.type === 'tunnel_out' ? 'tunnel' : t.type]?.name ?? t.type;

export function stepBelt(game, b, v) {
  const items = b.items;
  const { spacing, waitPos } = BAL;
  let limit = Infinity;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let np = Math.min(it.pos + v, limit);
    if (i === 0) {
      // A front item that already sat at the wait spot keeps offering every tick, otherwise
      // a blocked queue would bounce between 0.875 and 0.975 and wobble visibly.
      if (np >= 1 - EPS || it.pos >= waitPos - EPS) {
        const t = entAt(game, b.x + DX[b.dir], b.y + DY[b.dir]);
        const r = t ? offer(game, t, it.item, b.dir, Math.max(0, np - 1), 'deadEnd') : BUSY;
        if (r === OK) {
          items.shift(); b.blocked = null;
          i = -1; limit = Infinity; // the next item is the new front
          continue;
        }
        np = waitPos;
        b.blocked = r === NEVER ? `${nameOf(t)} can't use ${ITEMS[it.item].name}`
          : r === STALL ? `${nameOf(t)} is full of ${ITEMS[it.item].name}` : null;
      } else b.blocked = null;
    }
    it.pos = np;
    limit = np - spacing;
  }
}
