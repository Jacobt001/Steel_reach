import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, drain } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
import { outputPorts } from '../src/sim/machines.js'; import { erase } from '../src/game/place.js';
test('splitter divides evenly across 3 outputs, and all to the open ones', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'splitter',10,10,{dir:1});
  place(g,'belt',10,9,{dir:0}); place(g,'belt',11,10,{dir:1}); place(g,'belt',10,11,{dir:2});
  const c = {u:0,f:0,d:0};
  for (let t = 0; t < 2000; t++) { feed(g,9,10,['gear']); tick(g); c.u += drain(g,10,9).length; c.f += drain(g,11,10).length; c.d += drain(g,10,11).length; }
  const tot = c.u + c.f + c.d; assert.ok(tot > 500, `only ${tot} items moved`); for (const k in c) assert.ok(Math.abs(c[k] - tot/3) <= 2, JSON.stringify(c));
});
test('merger alternates two full inputs', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'belt',10,9,{dir:2}); place(g,'merger',10,10,{dir:1}); place(g,'belt',11,10,{dir:1});
  const out = []; for (let t = 0; t < 800; t++) { feed(g,9,10,['iron_plate']); feed(g,10,9,['copper_plate']); tick(g); out.push(...drain(g,11,10)); }
  const a = out.filter(i => i === 'iron_plate').length, b = out.length - a; assert.ok(out.length > 100 && Math.abs(a - b) <= 2, `${a}/${b}`);
});
test('storage buffers mixed items FIFO up to cap, then outputs', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); const s = place(g,'storage',10,10);
  for (let t = 0; t < 3000; t++) { feed(g,9,10,['gear','wire']); tick(g); }
  assert.equal(s.queue.length, 200); assert.deepEqual(s.queue.slice(0,2), ['gear','wire']);
  place(g,'belt',12,10,{dir:1}); const out = []; for (let t = 0; t < 40; t++) { tick(g); out.push(...drain(g,12,10)); }
  assert.deepEqual(out.slice(0,2), ['gear','wire']);
});
test('splitter only takes from its back; merger refuses its front', () => {
  const g = testGame(); place(g,'splitter',10,10,{dir:1}); place(g,'merger',20,10,{dir:1});
  assert.equal(feed(g,10,10,['gear'],3), 2); assert.equal(feed(g,10,10,['gear'],1), 0); assert.equal(feed(g,10,10,['gear'],1), 1);
  assert.equal(feed(g,20,10,['gear'],3), 2); assert.equal(feed(g,20,10,['gear'],0), 0);
});
test('storage refuses handoff and passBy, outputPorts drops erased neighbours', async () => {
  const { offer } = await import('../src/sim/offer.js');
  const g = testGame(); const s = place(g,'storage',10,10); place(g,'belt',12,10,{dir:1}); place(g,'belt',12,11,{dir:3});
  assert.equal(offer(g,s,'gear',1,0,'handoff'), 2); assert.equal(offer(g,s,'gear',1,0,'passBy'), 2);
  tick(g); assert.equal(outputPorts(g,s).length, 1);
  const bt = outputPorts(g,s)[0].node; erase(g, bt.x, bt.y);
  assert.equal(outputPorts(g,s).length, 0); tick(g); assert.equal(outputPorts(g,s).length, 0);
});
test('I7: a trunk splitter leaks nothing into a parallel belt; side outputs into belts pointing away still work', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'splitter',10,10,{dir:1}); place(g,'belt',11,10,{dir:1});
  place(g,'belt',10,9,{dir:1}); // parallel trunk beside the splitter: faces east, not away
  place(g,'belt',10,11,{dir:2}); // points away (south): a real side output
  let par = 0, front = 0, down = 0;
  for (let t = 0; t < 1500; t++) { feed(g,9,10,['gear']); tick(g); par += drain(g,10,9).length; front += drain(g,11,10).length; down += drain(g,10,11).length; }
  assert.equal(par, 0); assert.ok(front > 100 && Math.abs(front - down) <= 2, `${front} ${down}`);
});
