// Ground grid, ore patches and ring lines pre-rendered into 32x32-tile chunk images, so a frame
// draws a handful of images instead of thousands of ore tiles (brief §10). Lock badges depend on
// the tier and are drawn live by draw.js, never cached.
import { MAP, ITEMS, CENTER, RINGS } from '../config.js';
import { idx } from '../world.js';
import { visibleTiles } from './camera.js';
import { shade, TAU } from './shapes.js';

const CH = 32, NCH = MAP / CH;
const LO = 16, HI = 48, HI_FROM = 28; // px per tile in the cache; HI once tiles are drawn >= 28 px
// A HI chunk is 1536 px square (~9 MB). iPhone Safari caps total canvas memory, so only a few
// stay alive, and at most two are built per frame (the LO chunk stands in meanwhile) so a zoom
// across the threshold never stalls a frame.
const HI_KEEP = 6, HI_PER_FRAME = 2;

const ORE_DARK = {};
for (const k in ITEMS) ORE_DARK[k] = shade(ITEMS[k].color, -0.3);

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Cheap integer hash so decoration is stable per tile across rebuilds and resolutions.
function hash(x, y, k) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(k, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Rounded rectangle with a radius per corner (tl, tr, br, bl) so ore tiles merge into blobs:
// only corners on the outside of a patch get rounded.
function cornerRect(g, x, y, w, h, tl, tr, br, bl) {
  g.moveTo(x + tl, y);
  g.lineTo(x + w - tr, y); if (tr) g.arcTo(x + w, y, x + w, y + tr, tr);
  g.lineTo(x + w, y + h - br); if (br) g.arcTo(x + w, y + h, x + w - br, y + h, br);
  g.lineTo(x + bl, y + h); if (bl) g.arcTo(x, y + h, x, y + h - bl, bl);
  g.lineTo(x, y + tl); if (tl) g.arcTo(x, y, x + tl, y, tl);
  g.closePath();
}

function buildChunk(world, cx, cy, res, grid) {
  const size = CH * res, canvas = makeCanvas(size), g = canvas.getContext('2d');
  const x0 = cx * CH, y0 = cy * CH, ore = world.ore;
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP || y >= MAP ? null : ore[idx(x, y)]);

  // Grid: each chunk draws only its own left/top lines so seams never double up.
  g.fillStyle = grid;
  for (let i = 0; i < CH; i++) { g.fillRect(i * res, 0, 1, size); g.fillRect(0, i * res, size, 1); }

  // Faint specks: a light texture so a big empty map doesn't feel like a spreadsheet.
  g.beginPath();
  for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
    if (hash(x0 + i, y0 + j, 7) > 0.1) continue;
    const px = (i + 0.2 + hash(x0 + i, y0 + j, 8) * 0.6) * res, py = (j + 0.2 + hash(x0 + i, y0 + j, 9) * 0.6) * res;
    const r = res * (0.035 + hash(x0 + i, y0 + j, 10) * 0.035);
    g.moveTo(px + r, py); g.arc(px, py, r, 0, TAU);
  }
  g.fill();

  const rad = res * 0.32;
  for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
    const x = x0 + i, y = y0 + j, o = ore[idx(x, y)];
    if (!o) continue;
    const n = at(x, y - 1) === o, e = at(x + 1, y) === o, s = at(x, y + 1) === o, w = at(x - 1, y) === o;
    const px = i * res, py = j * res;
    g.globalAlpha = 0.32; g.fillStyle = ITEMS[o].color; g.beginPath();
    cornerRect(g, px, py, res, res, !n && !w ? rad : 0, !n && !e ? rad : 0, !s && !e ? rad : 0, !s && !w ? rad : 0);
    g.fill();
    g.globalAlpha = 1;
    // Two or three nuggets per tile in the ore's own colour and item shape.
    const count = 2 + (hash(x, y, 1) > 0.55 ? 1 : 0);
    g.beginPath();
    for (let k = 0; k < count; k++) {
      const nx = px + (0.22 + hash(x, y, 2 + k) * 0.56) * res, ny = py + (0.22 + hash(x, y, 5 + k) * 0.56) * res;
      const r = res * (0.08 + hash(x, y, 11 + k) * 0.06);
      if (o === 'crude_oil') { g.moveTo(nx + r * 1.6, ny); g.ellipse(nx, ny, r * 1.6, r, 0, 0, TAU); }
      else if (o === 'quartz') { g.moveTo(nx, ny - r * 1.4); g.lineTo(nx + r, ny); g.lineTo(nx, ny + r * 1.4); g.lineTo(nx - r, ny); g.closePath(); }
      else { g.moveTo(nx + r, ny); g.arc(nx, ny, r, 0, TAU); }
    }
    g.fillStyle = ITEMS[o].color; g.fill();
    g.strokeStyle = ORE_DARK[o]; g.lineWidth = Math.max(1, res / 32); g.stroke();
  }

  // Ring boundaries, dashed: the outer rings are where the late-game ores live.
  g.strokeStyle = grid; g.lineWidth = Math.max(1.5, res / 16); g.setLineDash([res * 0.5, res * 0.4]);
  g.beginPath();
  for (let r = 1; r < RINGS.length; r++) {
    const ccx = (CENTER.x - x0) * res, ccy = (CENTER.y - y0) * res, rr = RINGS[r].r0 * res;
    g.moveTo(ccx + rr, ccy); g.arc(ccx, ccy, rr, 0, TAU);
  }
  g.stroke();
  return canvas;
}

export function createTerrain(world) {
  // Node has no canvas; the renderer still runs there (tests), just without terrain images.
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return { draw() {} };
  const lo = new Array(NCH * NCH).fill(null);
  const hi = new Map(); // chunk index -> { canvas, used }
  const vt = { x0: 0, y0: 0, x1: -1, y1: -1 };
  let grid = null, frame = 0;

  return {
    draw(ctx, cam, theme) {
      // The chunks bake in the grid colour, so a theme switch rebuilds them.
      if (theme.grid !== grid) { lo.fill(null); hi.clear(); grid = theme.grid; }
      frame++;
      visibleTiles(cam, 0, vt);
      if (vt.x0 > vt.x1 || vt.y0 > vt.y1) return;
      const z = cam.z, ox = cam.vw / 2 - cam.x * z, oy = cam.vh / 2 - cam.y * z, size = CH * z;
      const wantHi = z >= HI_FROM;
      let built = 0, shown = 0;
      for (let cy = Math.floor(vt.y0 / CH); cy <= Math.floor(vt.y1 / CH); cy++) {
        for (let cx = Math.floor(vt.x0 / CH); cx <= Math.floor(vt.x1 / CH); cx++) {
          const k = cy * NCH + cx;
          let img = null;
          if (wantHi) {
            let e = hi.get(k);
            if (!e && built < HI_PER_FRAME) { e = { canvas: buildChunk(world, cx, cy, HI, grid), used: 0 }; hi.set(k, e); built++; }
            if (e) { e.used = frame; img = e.canvas; shown++; }
          }
          if (!img) img = lo[k] ?? (lo[k] = buildChunk(world, cx, cy, LO, grid));
          ctx.drawImage(img, cx * size + ox, cy * size + oy, size, size);
        }
      }
      // Evict least recently used HI chunks. The magnifier draws between main frames, so anything
      // used by either of the last two draws counts as on screen.
      const keep = Math.max(HI_KEEP, shown);
      while (hi.size > keep) {
        let oldK = -1, oldU = Infinity;
        for (const [key, e] of hi) if (e.used < oldU) { oldU = e.used; oldK = key; }
        if (oldU >= frame - 1) break;
        hi.delete(oldK);
      }
    },
  };
}
