// Debug-only load test behind #debug: Task 18 runs stress(3000, 10000) to check the brief's
// target (60 fps with 3,000 buildings and 10,000 belt items). Fills the map away from the Hub with
// closed belt loops carrying items, plus idle machines, until the factory holds the asked counts.
import { addEnt } from './game/state.js';
import { idx } from './world.js';
import { MAP, CENTER } from './config.js';

const LOOP_W = 16, LOOP_H = 4;  // 36 belt tiles per loop, so corners are a small share
const NEAR = 24;                // "far": clear of the Hub and the starting ring, where the player builds
const MACHINE_SHARE = 0.1;      // roughly a real factory's mix: mostly belts
const ITEM_CYCLE = ['iron_ore', 'copper_ore', 'coal', 'stone', 'iron_plate', 'copper_plate', 'gear', 'wire'];

export function countItems(game) {
  let n = 0;
  for (const c of game.conveyors) {
    if (c.items) n += c.items.length;
    if (c.laneH) n += c.laneH.length + c.laneV.length;
    if (c.under) n += c.under.length;
    if (c.hold) n++;
  }
  return n;
}

// Free with a one-tile margin, so nothing placed here feeds, pulls from or touches anything else.
function free(game, x, y, w, h) {
  if (x < 1 || y < 1 || x + w > MAP - 1 || y + h > MAP - 1) return false;
  const nx = Math.max(x, Math.min(CENTER.x, x + w)), ny = Math.max(y, Math.min(CENTER.y, y + h));
  if (Math.hypot(nx - CENTER.x, ny - CENTER.y) <= NEAR) return false;
  for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (game.grid[idx(i, j)]) return false;
  return true;
}

// Clockwise perimeter; each tile points at the next, so the loop is closed and never feeds outward.
function loopCells(x, y, w, h) {
  const c = [];
  for (let i = 0; i < w; i++) c.push([x + i, y]);
  for (let j = 1; j < h; j++) c.push([x + w - 1, y + j]);
  for (let i = w - 2; i >= 0; i--) c.push([x + i, y + h - 1]);
  for (let j = h - 2; j > 0; j--) c.push([x, y + j]);
  return c;
}
const dirTo = ([x, y], [nx, ny]) => (nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0);

function findSpot(game, w, h) {
  for (let y = 1; y + h < MAP; y++) for (let x = 1; x + w < MAP; x++) if (free(game, x, y, w, h)) return [x, y];
  return null;
}

export function stress(game, nBuildings, nItems) {
  const wantB = Math.max(0, Math.floor(nBuildings) - (game.ents.size - 1));
  let wantI = Math.max(0, Math.floor(nItems) - countItems(game));
  let machines = Math.floor(wantB * MACHINE_SHARE);
  let belts = wantB - machines;
  // A closed loop on a grid has an even length of at least 4; any odd or tiny remainder becomes machines.
  if (belts % 2) { belts--; machines++; }
  if (belts < 4) { machines += belts; belts = 0; }

  const loops = [];
  let left = belts;
  while (left >= 4) {
    const [w, h] = left >= 2 * (LOOP_W + LOOP_H) - 4 ? [LOOP_W, LOOP_H] : [left / 2, 2];
    const at = findSpot(game, w, h);
    if (!at) break; // map full: stop with what fits
    const cells = loopCells(at[0], at[1], w, h);
    loops.push(cells.map((p, i) => addEnt(game, 'belt', p[0], p[1], { dir: dirTo(p, cells[(i + 1) % cells.length]) })));
    left -= cells.length;
  }

  // Items spread evenly; every loop keeps at least one free slot so it can circulate.
  let tilesLeft = loops.reduce((s, l) => s + l.length, 0), k = 0;
  for (const loop of loops) {
    const n = Math.min(4 * loop.length - 1, Math.round((wantI * loop.length) / tilesLeft));
    tilesLeft -= loop.length; wantI -= n;
    const base = Math.floor(n / loop.length), extra = n % loop.length;
    loop.forEach((b, i) => {
      // Front item first (index 0 holds the highest pos), a spacing apart.
      for (let q = 0, m = base + (i < extra ? 1 : 0); q < m; q++) b.items.push({ item: ITEM_CYCLE[k++ % ITEM_CYCLE.length], pos: 0.75 - 0.25 * q });
    });
  }

  for (let i = 0; i < machines; i++) {
    const at = findSpot(game, 2, 2);
    if (!at) break;
    addEnt(game, 'assembler', at[0], at[1], { recipe: 'gear' });
  }
  return { buildings: game.ents.size - 1, items: countItems(game) };
}
