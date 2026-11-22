import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createCamera, worldToScreen, screenToWorld, screenToTile, zoomAt, visibleTiles } from '../src/render/camera.js';
import { drawFrame } from '../src/render/draw.js'; import { testGame } from './helpers.js'; import { place } from '../src/game/place.js';
const mockCtx = () => { const calls = { n: 0 }; return [new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'measureText' ? () => ({width:10}) : () => { calls.n++; }), set: (t, k, v) => (t[k] = v, true) }), calls]; };
test('camera round-trips and zooms around the finger', () => {
  const c = createCamera(390, 700); const [sx, sy] = worldToScreen(c, 80, 80); const [wx, wy] = screenToWorld(c, sx, sy);
  assert.ok(Math.abs(wx - 80) < 1e-9 && Math.abs(wy - 80) < 1e-9); assert.equal(c.z, 44);
  const before = screenToWorld(c, 100, 200); zoomAt(c, 1.5, 100, 200); const after = screenToWorld(c, 100, 200);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  zoomAt(c, 100, 0, 0); assert.equal(c.z, 72); zoomAt(c, 0.001, 0, 0); assert.equal(c.z, 16);
  assert.deepEqual(screenToTile(c, ...worldToScreen(c, 10.5, 20.5)), [10, 20]);
});
test('drawFrame culls off-screen work', () => {
  const g = testGame(); for (let x = 0; x < 40; x++) place(g, 'belt', x, 5, {dir:1});
  const c = createCamera(390, 700); const theme = new Proxy({}, { get: () => '#888' });
  const [ctx1, near] = mockCtx(); c.x = 20; c.y = 5; drawFrame(ctx1, g, c, 0, {}, theme);
  const [ctx2, far] = mockCtx(); c.x = 140; c.y = 140; drawFrame(ctx2, g, c, 0, {}, theme);
  assert.ok(near.n > far.n + 20);
});

// ---- Recording context: logs every method call and property set, and flags property reads.
import { panBy, clampCam } from '../src/render/camera.js';
import { setOre } from './helpers.js'; import { tick } from '../src/sim/tick.js';
const PROPS = new Set(['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign',
  'textBaseline', 'canvas', 'globalCompositeOperation', 'imageSmoothingEnabled', 'lineDashOffset', 'shadowBlur', 'shadowColor']);
function rec() {
  const log = [], reads = [];
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (PROPS.has(k)) { reads.push(k); return t[k]; }
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return (...a) => { log.push([k, ...a]); };
    },
    set: (t, k, v) => { t[k] = v; log.push(['=' + k, v]); return true; },
  });
  return { ctx, log, reads };
}
// Every key reads back as its own name, so a test can tell which theme colour was used.
const THEME = new Proxy({}, { get: (t, k) => `c:${String(k)}` });
// fillStyle in force at each fill() call.
const fills = (log) => { let cur = null; const out = []; for (const [k, v] of log) { if (k === '=fillStyle') cur = v; else if (k === 'fill') out.push(cur); } return out; };
const at = (c, wx, wy) => worldToScreen(c, wx, wy);
const near = (a, b) => Math.abs(a - b) < 1e-6;
const arcsAt = (log, x, y) => log.filter((l) => l[0] === 'arc' && near(l[1], x) && near(l[2], y));
// A round item is an edge disc plus its fill, both centred on the item.
const drawnAt = (log, x, y) => arcsAt(log, x, y).length > 0;
function cam(x, y, z = 44) { const c = createCamera(390, 700); c.x = x; c.y = y; c.z = z; return c; }

test('panBy and clampCam stop 3 tiles past the map edge; visibleTiles covers the screen', () => {
  const c = createCamera(390, 700); panBy(c, 1e6, 1e6);
  const [wx, wy] = screenToWorld(c, 0, 0); assert.ok(near(wx, -3) && near(wy, -3), `${wx},${wy}`);
  panBy(c, -1e7, -1e7); const [ex, ey] = screenToWorld(c, 390, 700); assert.ok(near(ex, 163) && near(ey, 163), `${ex},${ey}`);
  c.x = 80; c.y = 80; c.z = 44; clampCam(c); assert.equal(c.x, 80);
  const v = visibleTiles(c); assert.ok(v.x0 <= 76 && v.x1 >= 84 && v.y0 <= 73 && v.y1 >= 87, JSON.stringify(v));
  c.x = 0; c.y = 0; const e = visibleTiles(c); assert.equal(e.x0, 0); assert.equal(e.y0, 0);
});

test('items interpolate, but never past the tile edge when the next tile cannot take them', () => {
  const g = testGame(); const b = place(g, 'belt', 10, 10, { dir: 1 }); b.items.push({ item: 'iron_ore', pos: 0.8 });
  const c = cam(10.5, 10.5);
  let r = rec(); drawFrame(r.ctx, g, c, 0.9, {}, THEME);
  // Dead end: the waiting spot (0.875) is as far as it may be drawn, not 0.8 + 0.1 * 0.9.
  assert.ok(drawnAt(r.log, ...at(c, 10.875, 10.5))); assert.ok(!drawnAt(r.log, ...at(c, 10.89, 10.5)));
  place(g, 'belt', 11, 10, { dir: 1 });
  r = rec(); drawFrame(r.ctx, g, c, 0.9, {}, THEME);
  assert.ok(drawnAt(r.log, ...at(c, 10.89, 10.5)));
  // A front item already waiting stays still even if the peek thinks the next tile has room.
  b.items[0].pos = 0.875; r = rec(); drawFrame(r.ctx, g, c, 0.9, {}, THEME);
  assert.ok(drawnAt(r.log, ...at(c, 10.875, 10.5)));
  // Followers keep a full spacing behind the drawn front item.
  b.items[0].pos = 0.8; b.items.push({ item: 'iron_ore', pos: 0.55 }); place(g, 'belt', 11, 10, { dir: 1 });
  r = rec(); drawFrame(r.ctx, g, c, 0.5, {}, THEME);
  assert.ok(drawnAt(r.log, ...at(c, 10.85, 10.5))); assert.ok(drawnAt(r.log, ...at(c, 10.6, 10.5)));
  // Behind a waiting front item the follower stops a spacing short instead of gliding into it.
  const d = place(g, 'belt', 20, 10, { dir: 1 }); d.items.push({ item: 'iron_ore', pos: 0.875 }, { item: 'iron_ore', pos: 0.6 });
  const c2 = cam(20.5, 10.5); r = rec(); drawFrame(r.ctx, g, c2, 0.9, {}, THEME);
  assert.ok(drawnAt(r.log, ...at(c2, 20.625, 10.5))); assert.ok(!drawnAt(r.log, ...at(c2, 20.69, 10.5)));
  assert.deepEqual(r.reads, [], 'drawFrame must not read ctx properties');
});

test('curved corner: an item halfway round is drawn on the arc, not the straight line', () => {
  const g = testGame(); place(g, 'belt', 9, 10, { dir: 1 }); const b = place(g, 'belt', 10, 10, { dir: 0 });
  b.items.push({ item: 'iron_ore', pos: 0.5 });
  const c = cam(10.5, 10.5); const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME);
  // Entered heading east from the west edge, leaving north: the arc is centred on the tile's top-left corner.
  const a = Math.PI / 4; assert.ok(drawnAt(r.log, ...at(c, 10 + 0.5 * Math.sin(a), 10 + 0.5 * Math.cos(a))));
});

test('overview (z < 20) draws belts as 2 px lines and no items', () => {
  const g = testGame(); const b = place(g, 'belt', 10, 10, { dir: 1 }); b.items.push({ item: 'iron_ore', pos: 0.5 });
  place(g, 'assembler', 12, 10, { recipe: 'gear' });
  const detail = rec(); drawFrame(detail.ctx, g, cam(11, 11, 20), 0, {}, THEME);
  assert.ok(fills(detail.log).includes('#8a6a5a'), 'iron ore drawn at z 20');
  const ov = rec(); drawFrame(ov.ctx, g, cam(11, 11, 19), 0, {}, THEME);
  assert.ok(!fills(ov.log).includes('#8a6a5a'), 'no items in overview');
  assert.ok(ov.log.some((l) => l[0] === '=lineWidth' && l[1] === 2), 'belts become 2 px lines');
  assert.ok(fills(ov.log).length < fills(detail.log).length);
  assert.deepEqual(ov.reads, []);
});

test('blocked markers: never is drawn in the bad colour, stall in the warn colour', () => {
  for (const [type, extra] of [['belt', {}], ['tunnel_out', {}], ['splitter', {}], ['merger', {}]]) {
    const g = testGame(); const e = type === 'tunnel_out' ? place(g, 'tunnel', 10, 10, { dir: 1, exit: [12, 10] }) && g.ents.get(g.grid[10 * 160 + 12]) : place(g, type, 10, 10, { dir: 1, ...extra });
    const c = cam(e.x + 0.5, e.y + 0.5);
    let r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); assert.ok(!fills(r.log).includes('c:bad'), type);
    e.blockedKind = 'never'; r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); assert.ok(fills(r.log).includes('c:bad'), `${type} never`);
    e.blockedKind = 'stall'; r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME);
    assert.ok(fills(r.log).includes('c:warn') && !fills(r.log).includes('c:bad'), `${type} stall`);
  }
  const g = testGame(); const br = place(g, 'bridge', 10, 10, { dirH: 1, dirV: 2 }); const c = cam(10.5, 10.5);
  br.blockedKindV = 'never'; br.blockedKind = 'never'; const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); assert.ok(fills(r.log).includes('c:bad'), 'bridge');
});

test('a real dead end into the wrong machine shows a red marker', async () => {
  const g = testGame(); place(g, 'belt', 9, 10, { dir: 1 }); place(g, 'furnace', 10, 10);
  g.ents.get(g.grid[10 * 160 + 9]).items.push({ item: 'coal', pos: 0.875 });
  tick(g); const r = rec(); drawFrame(r.ctx, g, cam(10, 10.5), 0, {}, THEME); assert.ok(fills(r.log).includes('c:bad'));
});

test('status icons wait out a second of trouble, hide when it clears, and never flicker', () => {
  const g = testGame(); const m = place(g, 'assembler', 20, 20, { recipe: 'gear' }); const c = cam(21, 21);
  const warnAt = (t) => { g.tick = t; const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); return fills(r.log).includes('c:warn'); };
  assert.equal(warnAt(100), false); assert.equal(warnAt(110), false); assert.equal(warnAt(121), true);
  m.buf = { iron_plate: 4 }; assert.equal(warnAt(122), false, 'hidden once it clears');
  // A healthy machine whose status blinks every other tick never shows an icon.
  for (let t = 123; t < 200; t++) { m.buf = t % 2 ? {} : { iron_plate: 4 }; assert.equal(warnAt(t), false, `tick ${t}`); }
  m.out = ['gear', 'gear', 'gear', 'gear']; warnAt(300); assert.equal(warnAt(325), true, 'output full');
});

test('no-power icon uses the bad colour', () => {
  const g = testGame(); const f = place(g, 'foundry', 20, 20, { recipe: 'silicon' }); f.buf = { quartz: 4, coal: 2 }; tick(g);
  const c = cam(21, 21); const draw = (t) => { g.tick = t; const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); return fills(r.log); };
  draw(50); assert.ok(draw(80).includes('c:bad'));
});

test('working animation only while prog advanced this tick', () => {
  const g = testGame(); const m = place(g, 'assembler', 20, 20, { recipe: 'gear' }); m.buf = { iron_plate: 4 };
  const c = cam(21, 21); const n = (t, prog) => { g.tick = t; m.prog = prog; const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); return r.log.length; };
  n(10, 5); const moving = n(11, 6); const still = n(12, 6); const again = n(13, 7);
  assert.ok(moving > still, `${moving} vs ${still}`); assert.equal(moving, again);
});

test('lock badges show on locked-ore patches until the tier unlocks them', () => {
  const g = testGame({ tier: 3 }); setOre(g, 40, 40, 4, 4, 'quartz'); setOre(g, 50, 40, 3, 3, 'iron_ore');
  const c = cam(45, 42, 30); const texts = () => { const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); return r.log.filter((l) => l[0] === 'fillText').map((l) => l[1]); };
  assert.deepEqual(texts(), ['T5']);
  g.tier = 5; assert.deepEqual(texts(), []);
});

test('hub pulses for 10 ticks after a delivery', () => {
  const g = testGame(); const c = cam(80, 80); const n = () => { const r = rec(); drawFrame(r.ctx, g, c, 0, {}, THEME); return r.log.length; };
  g.tick = 100; const idle = n(); g.hubPulse = 95; const pulsing = n(); g.hubPulse = 90; assert.equal(n(), idle); assert.ok(pulsing > idle);
});

test('previews: ghost with reason, belt preview, tunnel exits, selection, power overlay', () => {
  const g = testGame(); const gen = place(g, 'generator', 10, 10); gen.fuel.coal = 5; place(g, 'pole', 14, 10);
  const f = place(g, 'foundry', 16, 10, { recipe: 'silicon' }); tick(g);
  const c = cam(14, 11);
  const view = { ghost: { type: 'assembler', x: 12, y: 13, ok: false, reason: 'Tile is occupied' },
    beltPreview: [{ x: 10, y: 14, dir: 1 }, { x: 11, y: 14, dir: 1, bad: true }], tunnelExits: [[15, 14], [16, 14]], selected: f, powerOverlay: true };
  const r = rec(); drawFrame(r.ctx, g, c, 0, view, THEME); const fs = fills(r.log);
  assert.ok(r.log.some((l) => l[0] === 'fillText' && l[1] === 'Tile is occupied'));
  assert.ok(fs.includes('c:power') && fs.includes('c:bad') && fs.includes('c:accent'));
  assert.deepEqual(r.reads, []);
  const plain = rec(); drawFrame(plain.ctx, g, c, 0, {}, THEME); assert.ok(r.log.length > plain.log.length + 20);
});

test('magnifier draws a clipped bubble above the finger', () => {
  const g = testGame(); place(g, 'belt', 80, 70, { dir: 1 }); const c = cam(80, 70);
  const r = rec(); drawFrame(r.ctx, g, c, 0, { magnifier: { x: 195, y: 400, tile: [80, 70] } }, THEME);
  const names = r.log.map((l) => l[0]);
  assert.ok(names.includes('clip')); assert.equal(names.filter((n) => n === 'save').length, names.filter((n) => n === 'restore').length);
  assert.deepEqual(r.reads, []);
  // Bubble sits ~80 px above the finger.
  assert.ok(r.log.some((l) => l[0] === 'arc' && near(l[1], 195) && l[2] < 400 - 60 && l[2] > 400 - 100));
});

test('readTheme reads the CSS custom properties', async () => {
  const { readTheme } = await import('../src/render/draw.js');
  const vars = { '--bg': ' #121815 ', '--belt': '#2a332e', '--bad': '#ff5a4e' };
  globalThis.document = { documentElement: {} }; globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => vars[n] ?? '' });
  try { const t = readTheme(); assert.equal(t.bg, '#121815'); assert.equal(t.belt, '#2a332e'); assert.equal(t.bad, '#ff5a4e'); assert.equal(typeof t.itemEdge, 'string'); }
  finally { delete globalThis.document; delete globalThis.getComputedStyle; }
});
