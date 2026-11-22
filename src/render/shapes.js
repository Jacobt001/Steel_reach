// Flat vector art: item shapes, belt geometry, building art and small glyphs.
// Every path builder adds clockwise subpaths only, so any number of them can share one
// nonzero fill without an overlap punching a hole (queued items and side-loaded belts overlap).
import { ITEMS, DX, DY } from '../config.js';

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- colours

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16), to = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const ch = (v) => Math.round(v + (to - v) * p).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

// Mid-lightness like the item colours, so one palette reads on both theme grounds; each
// building family gets its own hue so a factory reads at a glance.
export const COL = {
  miner: '#b5824f', furnace: '#d9683b', assembler: '#3f88c9', fabricator: '#7e60c6',
  foundry: '#c84b7d', refinery: '#2e9f95', generator: '#dfb21f', pole: '#dfb21f',
  storage: '#6d7d8e', hub: '#34495e', splitter: '#4c9fe3', merger: '#9b7add',
  bridge: '#7d8c9c', tunnel_in: '#56636f', tunnel_out: '#56636f',
};
export const DARK = {}, LIGHT = {};
for (const k in COL) { DARK[k] = shade(COL[k], -0.32); LIGHT[k] = shade(COL[k], 0.45); }
const GLOW = { furnace: '#ffb04a', foundry: '#ff8fb8', refinery: '#7ff0e2', generator: '#fff1a0' };
const WHITE = '#ffffff', MOUTH = '#141a1e';

// Belt widths in tiles: an outer rail and the running surface inside it. Narrower than a tile
// so parallel belts stay readable as separate lines.
export const RAIL_W = 0.8, BODY_W = 0.62;

// ---------------------------------------------------------------- paths

export function addRRect(c, x, y, w, h, r) {
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
export function rrect(c, x, y, w, h, r) { c.beginPath(); addRRect(c, x, y, w, h, r); }
const disc = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); };

// Unit polygons, flattened [x0, y0, x1, y1, ...], turned clockwise (positive shoelace in
// screen space) so they union cleanly in a shared path.
function cw(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 2) { const j = (i + 2) % pts.length; a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1]; }
  if (a >= 0) return Float64Array.from(pts);
  const out = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return Float64Array.from(out);
}
function ring(n, radii, rot) {
  const p = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU, r = radii[i % radii.length]; p.push(Math.cos(a) * r, Math.sin(a) * r); }
  return cw(p);
}
function gearPts() {
  const p = [], deg = Math.PI / 180;
  for (let k = 0; k < 6; k++) {
    const b = k * 60 * deg;
    for (const [d, r] of [[-22, 0.8], [-11, 1.18], [11, 1.18], [22, 0.8]]) p.push(Math.cos(b + d * deg) * r, Math.sin(b + d * deg) * r);
  }
  return cw(p);
}
const A = 0.36, L = 1.1;
const P_CROSS = cw([-A, -L, A, -L, A, -A, L, -A, L, A, A, A, A, L, -A, L, -A, A, -L, A, -L, -A, -A, -A]);
const P_BOLT = cw([0.3, -1.2, -0.6, 0.15, -0.05, 0.15, -0.3, 1.2, 0.6, -0.15, 0.05, -0.15]);
const P_TRI = ring(3, [1.2], -Math.PI / 2);
const P_DIAMOND = ring(4, [1.22], -Math.PI / 2);
const P_HEX = ring(6, [1.08], 0);
const P_STAR = ring(10, [1.3, 0.58], -Math.PI / 2);
const P_GEAR = gearPts();

function addPoly(c, x, y, r, P) {
  c.moveTo(x + P[0] * r, y + P[1] * r);
  for (let i = 2; i < P.length; i += 2) c.lineTo(x + P[i] * r, y + P[i + 1] * r);
  c.closePath();
}

// Item silhouettes, all roughly radius r so mixed belts keep an even rhythm.
const SHAPES = {
  circle: (c, x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); },
  square: (c, x, y, r) => { const s = r * 0.86; c.rect(x - s, y - s, 2 * s, 2 * s); },
  diamond: (c, x, y, r) => addPoly(c, x, y, r, P_DIAMOND),
  gear: (c, x, y, r) => addPoly(c, x, y, r, P_GEAR),
  rect: (c, x, y, r) => c.rect(x - r * 1.05, y - r * 0.55, r * 2.1, r * 1.1),
  chip: (c, x, y, r) => {
    const s = r * 0.7, pw = r * 0.34, ph = r * 0.24, o = r * 0.4;
    c.rect(x - s, y - s, 2 * s, 2 * s);
    c.rect(x - s - pw, y - o - ph / 2, pw, ph); c.rect(x - s - pw, y + o - ph / 2, pw, ph);
    c.rect(x + s, y - o - ph / 2, pw, ph); c.rect(x + s, y + o - ph / 2, pw, ph);
  },
  hex: (c, x, y, r) => addPoly(c, x, y, r, P_HEX),
  ring: (c, x, y, r) => { c.moveTo(x + r * 1.05, y); c.arc(x, y, r * 1.05, 0, TAU); c.moveTo(x + r * 0.5, y); c.arc(x, y, r * 0.5, 0, TAU, true); },
  cross: (c, x, y, r) => addPoly(c, x, y, r, P_CROSS),
  bolt: (c, x, y, r) => addPoly(c, x, y, r, P_BOLT),
  star: (c, x, y, r) => addPoly(c, x, y, r, P_STAR),
  triangle: (c, x, y, r) => addPoly(c, x, y + r * 0.15, r, P_TRI),
};

// Items by index so the renderer can bucket them in typed arrays instead of per-frame objects.
export const ITEM_IDS = Object.keys(ITEMS);
export const ITEM_INDEX = {};
ITEM_IDS.forEach((k, i) => { ITEM_INDEX[k] = i; });
export const ITEM_COLOR = ITEM_IDS.map((k) => ITEMS[k].color);
export const ITEM_SHAPE = ITEM_IDS.map((k) => SHAPES[ITEMS[k].shape]);

export function drawItemIcon(c, id, x, y, r, edge) {
  c.beginPath();
  ITEM_SHAPE[ITEM_INDEX[id]](c, x, y, r);
  c.fillStyle = ITEMS[id].color; c.fill();
  c.strokeStyle = edge; c.lineWidth = Math.max(1, r * 0.16); c.stroke();
}

// ---------------------------------------------------------------- belt geometry

// A corner is a quarter circle of radius 0.5 around the tile corner shared by its entry and
// exit edges. Indexed by inDir * 4 + dir, where inDir is the direction items travel as they
// enter. o0/o1 trace the outer arc clockwise whichever way items turn (see header).
export const CURVE = new Array(16).fill(null);
for (let s = 0; s < 4; s++) for (let d = 0; d < 4; d++) {
  if (s === d || s === (d + 2) % 4) continue;
  const a0 = Math.atan2(-DY[d], -DX[d]), a1 = Math.atan2(DY[s], DX[s]);
  let delta = a1 - a0;
  while (delta <= -Math.PI) delta += TAU;
  while (delta > Math.PI) delta -= TAU;
  const ccw = delta < 0, o0 = ccw ? a1 : a0, o1 = ccw ? a0 : a1;
  CURVE[s * 4 + d] = {
    cx: 0.5 - DX[s] * 0.5 + DX[d] * 0.5, cy: 0.5 - DY[s] * 0.5 + DY[d] * 0.5, a0, a1, ccw,
    o0, o1, c0: Math.cos(o0), s0: Math.sin(o0), c1: Math.cos(o1), s1: Math.sin(o1),
  };
}
const isCurve = (inDir, dir) => inDir !== dir && inDir !== (dir + 2) % 4;

// Point at fraction t along tile (tx, ty), entered travelling inDir and left travelling dir.
// Writes world x, y and the unit travel direction into o. Past either end it runs straight on,
// which is where the next or previous tile's path starts anyway.
export function beltPoint(o, tx, ty, inDir, dir, t) {
  if (!isCurve(inDir, dir) || t > 1 || t < 0) {
    const d = t < 0 && isCurve(inDir, dir) ? inDir : dir;
    if (d === dir) { o[0] = tx + 0.5 + DX[d] * (t - 0.5); o[1] = ty + 0.5 + DY[d] * (t - 0.5); }
    else { o[0] = tx + 0.5 - DX[d] * (0.5 - t); o[1] = ty + 0.5 - DY[d] * (0.5 - t); }
    o[2] = DX[d]; o[3] = DY[d];
    return;
  }
  const k = CURVE[inDir * 4 + dir], th = t * Math.PI / 2, co = Math.cos(th), si = Math.sin(th);
  o[0] = tx + k.cx + 0.5 * (-DX[dir] * co + DX[inDir] * si);
  o[1] = ty + k.cy + 0.5 * (-DY[dir] * co + DY[inDir] * si);
  o[2] = DX[dir] * si + DX[inDir] * co;
  o[3] = DY[dir] * si + DY[inDir] * co;
}

// One belt strip of width W (tiles) on the tile whose top-left screen corner is (ox, oy).
// ext lengthens the exit end into the next tile so a side-loading belt meets the belt it feeds.
export function addStrip(c, ox, oy, z, inDir, dir, W, ext) {
  const hw = (W * z) / 2, e = ext * z;
  if (!isCurve(inDir, dir)) {
    if (dir === 0) c.rect(ox + z / 2 - hw, oy - e, 2 * hw, z + e);
    else if (dir === 1) c.rect(ox, oy + z / 2 - hw, z + e, 2 * hw);
    else if (dir === 2) c.rect(ox + z / 2 - hw, oy, 2 * hw, z + e);
    else c.rect(ox - e, oy + z / 2 - hw, z + e, 2 * hw);
    return;
  }
  const k = CURVE[inDir * 4 + dir], cx = ox + k.cx * z, cy = oy + k.cy * z, ro = z / 2 + hw, ri = z / 2 - hw;
  c.moveTo(cx + k.c0 * ro, cy + k.s0 * ro);
  c.arc(cx, cy, ro, k.o0, k.o1, false);
  c.lineTo(cx + k.c1 * ri, cy + k.s1 * ri);
  c.arc(cx, cy, ri, k.o1, k.o0, true);
  c.closePath();
  if (e > 0) {
    const ex = ox + z / 2 + (DX[dir] * z) / 2, ey = oy + z / 2 + (DY[dir] * z) / 2;
    if (dir === 0) c.rect(ex - hw, ey - e, 2 * hw, e);
    else if (dir === 1) c.rect(ex, ey - hw, e, 2 * hw);
    else if (dir === 2) c.rect(ex - hw, ey, 2 * hw, e);
    else c.rect(ex - e, ey - hw, e, 2 * hw);
  }
}

// Overview line: entry edge to exit edge through the middle (curves stay curved).
export function addBeltLine(c, ox, oy, z, inDir, dir) {
  if (!isCurve(inDir, dir)) {
    c.moveTo(ox + z / 2 - (DX[dir] * z) / 2, oy + z / 2 - (DY[dir] * z) / 2);
    c.lineTo(ox + z / 2 + (DX[dir] * z) / 2, oy + z / 2 + (DY[dir] * z) / 2);
    return;
  }
  const k = CURVE[inDir * 4 + dir], cx = ox + k.cx * z, cy = oy + k.cy * z;
  c.moveTo(cx + Math.cos(k.a0) * z / 2, cy + Math.sin(k.a0) * z / 2);
  c.arc(cx, cy, z / 2, k.a0, k.a1, k.ccw);
}

// Open "V" pointing along unit (tx, ty), centred on (x, y), half-size s.
export function addChevron(c, x, y, tx, ty, s) {
  const bx = x - tx * s * 0.45, by = y - ty * s * 0.45;
  c.moveTo(bx - ty * s - tx * s * 0.55, by + tx * s - ty * s * 0.55);
  c.lineTo(x + tx * s * 0.45, y + ty * s * 0.45);
  c.lineTo(bx + ty * s - tx * s * 0.55, by - tx * s - ty * s * 0.55);
}

function addArrow(c, x, y, d, s) {
  const tx = DX[d], ty = DY[d];
  c.moveTo(x + tx * s, y + ty * s);
  c.lineTo(x - tx * s * 0.6 - ty * s * 0.85, y - ty * s * 0.6 + tx * s * 0.85);
  c.lineTo(x - tx * s * 0.6 + ty * s * 0.85, y - ty * s * 0.6 - tx * s * 0.85);
  c.closePath();
}

// ---------------------------------------------------------------- building art

// Body with a darker lip along the bottom edge and a soft shadow: flat, but it still reads
// as something standing on the ground.
function block(c, type, x, y, w, h, r, z, th) {
  const lip = 0.07 * z;
  c.fillStyle = th.shadow; rrect(c, x, y + 0.05 * z, w, h, r); c.fill();
  c.fillStyle = DARK[type]; rrect(c, x, y, w, h, r); c.fill();
  c.fillStyle = COL[type]; rrect(c, x, y, w, h - lip, r); c.fill();
}

function flame(c, x, y, r, color) {
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x + r * 0.95, y + r * 0.05, x, y + r);
  c.quadraticCurveTo(x - r * 0.95, y + r * 0.05, x, y - r);
  c.fillStyle = color; c.fill();
}

function bolt(c, x, y, r, color) {
  c.beginPath(); addPoly(c, x, y, r, P_BOLT); c.fillStyle = color; c.fill();
}

// Crafters, miners, generators and storage. t is sim time in ticks (tick + alpha) so the
// animation pauses with the game; fill is a 0..1 gauge (storage, fuel) or -1 for none.
export function drawMachine(c, m, x, y, z, th, working, t, fill) {
  const type = m.type, ins = 0.07 * z;
  const bx = x + ins, by = y + ins, bw = m.w * z - 2 * ins, bh = m.h * z - 2 * ins;
  block(c, type, bx, by, bw, bh, 0.2 * z, z, th);
  const cx = bx + bw / 2, cy = by + (bh - 0.07 * z) / 2;

  if (type === 'storage') {
    // Crate planks, and a fill gauge so a filling box is visible from across the map.
    c.strokeStyle = DARK[type]; c.lineWidth = 0.06 * z; c.beginPath();
    c.moveTo(bx + 0.25 * z, by + bh * 0.33); c.lineTo(bx + bw - 0.25 * z, by + bh * 0.33);
    c.moveTo(bx + 0.25 * z, by + bh * 0.6); c.lineTo(bx + bw - 0.25 * z, by + bh * 0.6); c.stroke();
    gauge(c, bx, by, bw, bh, z, fill, th, LIGHT[type]);
    return;
  }

  // Inset panel showing what the machine makes; miners get a round drill head.
  const ps = Math.min(bw, bh) * (m.w === 3 ? 0.5 : 0.6), pr = ps / 2;
  const round = type === 'miner' || type === 'refinery';
  c.fillStyle = th.panel;
  if (round) disc(c, cx, cy, pr); else rrect(c, cx - pr, cy - pr, ps, ps, 0.14 * z);
  c.fill();

  if (type === 'fabricator' || type === 'refinery') {
    // Corner details give the big 3x3 bodies structure: refinery tanks, fabricator bolts.
    const ref = type === 'refinery', k = 0.42 * z, q = ref ? 0.3 * z : 0.16 * z;
    const x0 = bx + k, x1 = bx + bw - k, y0 = by + k, y1 = by + bh - k - 0.07 * z;
    c.fillStyle = ref ? LIGHT[type] : DARK[type]; c.beginPath();
    c.moveTo(x0 + q, y0); c.arc(x0, y0, q, 0, TAU);
    c.moveTo(x1 + q, y1); c.arc(x1, y1, q, 0, TAU);
    if (!ref) { c.moveTo(x1 + q, y0); c.arc(x1, y0, q, 0, TAU); c.moveTo(x0 + q, y1); c.arc(x0, y1, q, 0, TAU); }
    c.fill();
  }

  if (working) {
    if (GLOW[type]) {
      // Glow: a soft warm pulse behind the icon.
      c.globalAlpha = 0.35 + 0.25 * Math.sin(t * 0.45);
      c.fillStyle = GLOW[type]; disc(c, cx, cy, pr * 0.82); c.fill();
      c.globalAlpha = 1;
    } else {
      // Spin: three arcs turning around the icon.
      const a = t * 0.22;
      c.strokeStyle = COL[type]; c.lineWidth = 0.07 * z; c.lineCap = 'round'; c.beginPath();
      for (let k = 0; k < 3; k++) { const s = a + (k * TAU) / 3; c.moveTo(cx + Math.cos(s) * pr * 0.78, cy + Math.sin(s) * pr * 0.78); c.arc(cx, cy, pr * 0.78, s, s + 0.9); }
      c.stroke();
    }
  }

  const ir = pr * 0.46;
  if (type === 'generator') { bolt(c, cx, cy, ir * 1.05, working ? COL.generator : DARK.generator); gauge(c, bx, by, bw, bh, z, fill, th, DARK[type]); }
  else if (type === 'miner') { if (m.ore) drawItemIcon(c, m.ore, cx, cy, ir, th.itemEdge); }
  else if (m.recipe) drawItemIcon(c, m.recipe, cx, cy, ir, th.itemEdge);
  else if (type === 'furnace') flame(c, cx, cy, ir * 1.1, COL.furnace);
}

function gauge(c, bx, by, bw, bh, z, fill, th, color) {
  if (!(fill >= 0)) return;
  const gx = bx + 0.22 * z, gw = bw - 0.44 * z, gy = by + bh - 0.32 * z, gh = 0.1 * z;
  c.fillStyle = th.panel; rrect(c, gx, gy, gw, gh, gh / 2); c.fill();
  if (fill > 0) { c.fillStyle = color; rrect(c, gx, gy, Math.max(gh, gw * Math.min(1, fill)), gh, gh / 2); c.fill(); }
}

export function drawPole(c, x, y, z, th) {
  const cx = x + z / 2, cy = y + z / 2;
  c.fillStyle = th.shadow; disc(c, cx, cy + 0.05 * z, 0.24 * z); c.fill();
  c.fillStyle = DARK.pole; disc(c, cx, cy, 0.24 * z); c.fill();
  c.fillStyle = COL.pole; disc(c, cx, cy - 0.03 * z, 0.14 * z); c.fill();
}

// pulse is 1 right after a delivery and fades to 0; a busy Hub simply stays lit.
export function drawHub(c, x, y, z, th, pulse) {
  const ins = 0.08 * z, w = 4 * z - 2 * ins, bx = x + ins, by = y + ins;
  if (pulse > 0) {
    c.globalAlpha = 0.55 * pulse; c.strokeStyle = th.accent; c.lineWidth = 0.14 * z;
    rrect(c, bx - 0.12 * z, by - 0.12 * z, w + 0.24 * z, w + 0.24 * z, 0.5 * z); c.stroke();
    c.globalAlpha = 1;
  }
  block(c, 'hub', bx, by, w, w, 0.42 * z, z, th);
  const cx = bx + w / 2, cy = by + (w - 0.07 * z) / 2;
  c.fillStyle = th.panel; disc(c, cx, cy, 1.18 * z); c.fill();
  c.strokeStyle = th.accent; c.lineWidth = 0.13 * z; disc(c, cx, cy, 0.95 * z); c.stroke();
  // Four intake arrows: the Hub takes from every side.
  c.fillStyle = LIGHT.hub; c.beginPath();
  for (let d = 0; d < 4; d++) addArrow(c, cx - DX[d] * 1.55 * z, cy - DY[d] * 1.55 * z, d, 0.17 * z);
  c.fill();
  c.fillStyle = th.accent; disc(c, cx, cy, 0.42 * z * (1 + 0.18 * pulse)); c.fill();
  if (pulse > 0) { c.globalAlpha = 0.5 * pulse; c.fillStyle = WHITE; disc(c, cx, cy, 0.28 * z); c.fill(); c.globalAlpha = 1; }
}

// Strip pair (rail then surface) used by the pieces drawn one at a time.
function strip(c, ox, oy, z, inDir, dir, th) {
  c.beginPath(); addStrip(c, ox, oy, z, inDir, dir, RAIL_W, 0); c.fillStyle = th.beltEdge; c.fill();
  c.beginPath(); addStrip(c, ox, oy, z, inDir, dir, BODY_W, 0); c.fillStyle = th.belt; c.fill();
}

// Belts or tunnel arms one at a time (ghosts), with a centred chevron.
export function drawBeltTile(c, ox, oy, z, inDir, dir, th) {
  strip(c, ox, oy, z, inDir, dir, th);
  const o = SCRATCH; beltPoint(o, 0, 0, inDir, dir, 0.5);
  c.beginPath(); addChevron(c, ox + o[0] * z, oy + o[1] * z, o[2], o[3], 0.1 * z);
  c.strokeStyle = th.chevron; c.lineWidth = Math.max(1, 0.05 * z); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
const SCRATCH = new Float64Array(4);

// Splitter and merger: a crossing of belt arms with a coloured block in the middle. White
// arrows say which way items leave: three outward for a splitter, one forward for a merger.
export function drawSplitMerge(c, e, ox, oy, z, th) {
  c.beginPath(); addStrip(c, ox, oy, z, 0, 0, RAIL_W, 0); addStrip(c, ox, oy, z, 1, 1, RAIL_W, 0); c.fillStyle = th.beltEdge; c.fill();
  c.beginPath(); addStrip(c, ox, oy, z, 0, 0, BODY_W, 0); addStrip(c, ox, oy, z, 1, 1, BODY_W, 0); c.fillStyle = th.belt; c.fill();
  const s = 0.58 * z, bx = ox + (z - s) / 2, by = oy + (z - s) / 2;
  block(c, e.type, bx, by, s, s, 0.13 * z, z, th);
  const cx = ox + z / 2, cy = by + (s - 0.07 * z) / 2;
  c.fillStyle = WHITE; c.beginPath();
  if (e.type === 'splitter') for (let k = 3; k <= 5; k++) { const d = (e.dir + k) % 4; addArrow(c, cx + DX[d] * 0.13 * z, cy + DY[d] * 0.13 * z, d, 0.085 * z); }
  else addArrow(c, cx, cy, e.dir, 0.13 * z);
  c.fill();
}

// Bridge: the vertical lane runs underneath, the horizontal lane on a raised deck.
export function drawBridge(c, e, ox, oy, z, th) {
  strip(c, ox, oy, z, e.dirV, e.dirV, th);
  c.beginPath(); addStrip(c, ox, oy + 0.06 * z, z, e.dirH, e.dirH, 0.92, 0); c.fillStyle = th.shadow; c.fill();
  c.beginPath(); addStrip(c, ox, oy, z, e.dirH, e.dirH, 0.92, 0); c.fillStyle = COL.bridge; c.fill();
  c.beginPath(); addStrip(c, ox, oy, z, e.dirH, e.dirH, BODY_W, 0); c.fillStyle = th.belt; c.fill();
  // Only the deck gets an arrow: the lower lane shows only at the deck's edges, and the belts
  // feeding it already say which way it runs.
  c.beginPath();
  addChevron(c, ox + z / 2, oy + z / 2, DX[e.dirH], DY[e.dirH], 0.1 * z);
  c.strokeStyle = th.chevron; c.lineWidth = Math.max(1, 0.05 * z); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}

// Tunnel portal, drawn above the items so they slip into and out of the mouth.
export function drawTunnelHood(c, e, ox, oy, z, th) {
  const d = e.dir, isIn = e.type === 'tunnel_in';
  const a = isIn ? 0.28 : 0, b = isIn ? 1 : 0.72, w = 0.9, m = 0.17;
  const r = along(HOOD, ox, oy, z, d, a, b, w), mo = along(MOUTH_R, ox, oy, z, d, isIn ? a : b - m, isIn ? a + m : b, 0.62);
  block(c, e.type, r[0], r[1], r[2], r[3], 0.16 * z, z, th);
  c.fillStyle = MOUTH; rrect(c, mo[0], mo[1], mo[2], mo[3], 0.08 * z); c.fill();
  const mid = (a + b) / 2 + (isIn ? m : -m) / 2;
  c.beginPath(); addChevron(c, ox + z / 2 + DX[d] * (mid - 0.5) * z, oy + z / 2 + DY[d] * (mid - 0.5) * z - 0.03 * z, DX[d], DY[d], 0.1 * z);
  c.strokeStyle = LIGHT[e.type]; c.lineWidth = Math.max(1, 0.055 * z); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}

// Rectangle covering fraction a..b of the tile along d, w tiles wide: [x, y, w, h] in px.
const HOOD = new Float64Array(4), MOUTH_R = new Float64Array(4);
function along(o, ox, oy, z, d, a, b, w) {
  const s = (1 - w) / 2;
  if (d === 1) { o[0] = ox + a * z; o[1] = oy + s * z; o[2] = (b - a) * z; o[3] = w * z; }
  else if (d === 3) { o[0] = ox + (1 - b) * z; o[1] = oy + s * z; o[2] = (b - a) * z; o[3] = w * z; }
  else if (d === 2) { o[0] = ox + s * z; o[1] = oy + a * z; o[2] = w * z; o[3] = (b - a) * z; }
  else { o[0] = ox + s * z; o[1] = oy + (1 - b) * z; o[2] = w * z; o[3] = (b - a) * z; }
  return o;
}

// ---------------------------------------------------------------- glyphs

// Map status icon kinds (see draw.js): 1 missing input, 2 output full, 3/4 no or low power.
export function drawStatusIcon(c, kind, x, y, r, color, th) {
  c.fillStyle = th.panel; disc(c, x, y, r * 1.18); c.fill();
  c.fillStyle = color; disc(c, x, y, r); c.fill();
  c.fillStyle = WHITE; c.beginPath();
  if (kind === 1) {
    // Down arrow into an open tray: "waiting for input".
    c.rect(x - r * 0.12, y - r * 0.6, r * 0.24, r * 0.45);
    c.moveTo(x - r * 0.36, y - r * 0.18); c.lineTo(x + r * 0.36, y - r * 0.18); c.lineTo(x, y + r * 0.2); c.closePath();
    c.rect(x - r * 0.5, y + r * 0.34, r, r * 0.18);
  } else if (kind === 2) {
    // A full stack.
    for (let k = -1; k <= 1; k++) c.rect(x - r * 0.48, y + k * r * 0.36 - r * 0.1, r * 0.96, r * 0.2);
  } else addPoly(c, x, y, r * 0.55, P_BOLT);
  c.fill();
}

// Belt can't hand on its front item: a "!" badge. Overview shrinks it to a dot.
export function drawBlockedMarker(c, x, y, r, color, th, dot) {
  if (!dot) { c.fillStyle = th.panel; disc(c, x, y, r * 1.2); c.fill(); }
  c.fillStyle = color; disc(c, x, y, r); c.fill();
  if (dot) return;
  c.fillStyle = WHITE; c.beginPath();
  c.rect(x - r * 0.13, y - r * 0.58, r * 0.26, r * 0.7);
  c.moveTo(x + r * 0.15, y + r * 0.42); c.arc(x, y + r * 0.42, r * 0.15, 0, TAU);
  c.fill();
}

export function drawPadlock(c, x, y, s, color) {
  c.strokeStyle = color; c.lineWidth = s * 0.17; c.lineCap = 'butt';
  c.beginPath(); c.arc(x, y - s * 0.12, s * 0.27, Math.PI, 0); c.lineTo(x + s * 0.27, y + s * 0.05); c.moveTo(x - s * 0.27, y - s * 0.12); c.lineTo(x - s * 0.27, y + s * 0.05); c.stroke();
  c.fillStyle = color; rrect(c, x - s * 0.42, y, s * 0.84, s * 0.6, s * 0.12); c.fill();
}
