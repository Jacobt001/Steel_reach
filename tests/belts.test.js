import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, drain, snake } from './helpers.js'; import { place } from '../src/game/place.js';
import { tick } from '../src/sim/tick.js'; import { offer, OK, NEVER } from '../src/sim/offer.js';
const line = (g, x, y, n, dir=1) => { for (let i = 0; i < n; i++) place(g, 'belt', x + i, y, {dir}); };
test('an item crosses 10 tiles in ~100 ticks at 2 tiles/s', () => {
  const g = testGame(); line(g, 10, 10, 10); offer(g, g.ents.get(g.grid[10*160+10]), 'gear', 1, 0);
  let t = 0, got = []; while (!got.length && t < 200) { tick(g); t++; got = drain(g, 19, 10); }
  assert.ok(t >= 85 && t <= 100, `t=${t}`);
});
test('throughput is 8 items/s and spacing holds', () => {
  const g = testGame(); line(g, 10, 10, 20); let n = 0;
  for (let t = 0; t < 1200; t++) { feed(g, 10, 10, ['gear']); tick(g); const d = drain(g, 29, 10); if (t >= 200) n += d.length; }
  assert.ok(Math.abs(n - 400) <= 8, `n=${n}`);
});
test('a stopped belt holds exactly 4 per tile', () => {
  const g = testGame(); line(g, 10, 10, 5);
  for (let t = 0; t < 600; t++) { feed(g, 10, 10, ['wire']); tick(g); }
  for (let x = 10; x < 15; x++) assert.equal(g.ents.get(g.grid[10*160+x]).items.length, 4);
});
test('no entry from the front; side entry works', () => {
  const g = testGame(); line(g, 10, 10, 3);
  const b = g.ents.get(g.grid[10*160+11]); assert.equal(offer(g, b, 'gear', 3, 0), NEVER); assert.equal(offer(g, b, 'gear', 2, 0), OK);
});
test('2000-tile belt: no stack overflow, item arrives', () => {
  const g = testGame(); const { start, end } = snake(g, 2000);
  offer(g, g.ents.get(g.grid[start[1]*160+start[0]]), 'gear', g.ents.get(g.grid[start[1]*160+start[0]]).dir, 0);
  let got = []; for (let t = 0; t < 21000 && !got.length; t++) { tick(g); got = drain(g, end[0], end[1]); }
  assert.deepEqual(got, ['gear']);
});
test('Review Focus 4: closed loop conserves items and terminates', () => {
  const g = testGame(); place(g,'belt',10,10,{dir:1}); place(g,'belt',11,10,{dir:2}); place(g,'belt',11,11,{dir:3}); place(g,'belt',10,11,{dir:0});
  let fed = 0; for (let t = 0; t < 60 && fed < 6; t++) { if (feed(g, 10, 10, ['gear']) === OK) fed++; tick(g); }
  assert.equal(fed, 6);
  for (let t = 0; t < 1000; t++) tick(g);
  const n = [...g.ents.values()].filter(e => e.type === 'belt').reduce((s, e) => s + e.items.length, 0); assert.equal(n, 6);
});
test('belt into the Hub counts toward goals', () => {
  const g = testGame({tier:1}); line(g, 70, 79, 8); // last tile (77,79) points E into hub tile (78,79)
  for (let t = 0; t < 400; t++) { feed(g, 70, 79, ['iron_plate']); tick(g); }
  assert.ok(g.stock.iron_plate > 0); assert.equal(g.prog.iron_plate, g.stock.iron_plate);
});
test('side feeder into a backed-up line never exceeds 4 per tile or goes negative', () => {
  const g = testGame();
  for (let y = 6; y <= 9; y++) place(g, 'belt', 14, y, { dir: 2 }); // side feeder placed first
  line(g, 10, 10, 6);
  for (let t = 0; t < 600; t++) {
    feed(g, 14, 6, ['gear']); feed(g, 10, 10, ['wire']); tick(g);
    for (const e of g.ents.values()) if (e.type === 'belt') {
      assert.ok(e.items.length <= 4, `t=${t} (${e.x},${e.y}) holds ${e.items.length}`);
      for (const it of e.items) assert.ok(it.pos >= -1e-6, `t=${t} (${e.x},${e.y}) pos ${it.pos}`);
    }
  }
});
test('a line feeding a loop moves items as fast as the same line alone', () => {
  const travel = (withLoop) => {
    const g = testGame(); line(g, 10, 10, 19);
    if (withLoop) { place(g,'belt',29,10,{dir:1}); place(g,'belt',30,10,{dir:2}); place(g,'belt',30,11,{dir:3}); place(g,'belt',29,11,{dir:0}); }
    offer(g, g.ents.get(g.grid[10*160+10]), 'gear', 1, 0);
    let t = 0; // measure on a line tile both layouts share
    while (t < 400) { tick(g); t++; if (drain(g, 27, 10).length) break; }
    return t;
  };
  assert.ok(Math.abs(travel(true) - travel(false)) <= 2, `${travel(true)} vs ${travel(false)}`);
});
