// Single-lane belts: items hold a position 0..1 along the tile, front item is index 0.
import { BAL, TPS, DX, DY, ITEMS, BUILDINGS } from '../config.js';
import { entAt } from '../game/state.js';
import { offer, OK, BUSY, NEVER, STALL } from './offer.js';

// Saved positions are rounded to 3 decimals (Task 11), so float noise must never flip an
// outcome: every position comparison carries this tolerance.
export const EPS = 1e-6;

export const beltSpeed = (game) => BAL.beltTilesPerSec[game.mods.beltLevel] / TPS;

// Inserts made outside the conveyor step (feed helper, machine outputs) happen between ticks,
// so they get one tick of travel credit: without it an every-tick feed would only land every
// third tick (spacing 0.3, ~6.67 items/s) instead of the full 8/s. Hand-offs during the step
// are already positioned exactly and get no credit. Items never enter at a negative pos, so the
// 4-per-tile cap is a plain length test and a stopped tile can never hold a stranded 5th item.
export function acceptBelt(game, b, item, moveDir, pos) {
  if (moveDir === (b.dir + 2) % 4) return NEVER;
  const { items } = b;
  if (items.length === 0) { items.push({ item, pos: Math.min(pos, BAL.waitPos) }); return OK; }
  if (items.length >= 4) return BUSY;
  const v = beltSpeed(game);
  const credit = game.stepping ? 0 : v;
  const p = pos + credit;
  const room = items[items.length - 1].pos - BAL.spacing;
  if (room >= p - credit - EPS) { items.push({ item, pos: Math.min(p, room) }); return OK; }
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
