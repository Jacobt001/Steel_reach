import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed } from './helpers.js'; import { place, erase } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
import { machineStatus, clearMachine } from '../src/sim/machines.js'; import { entAt } from '../src/game/state.js';
import { drain, setOre } from './helpers.js'; import { placeBeltPath } from '../src/game/place.js';
import { offer, OK, BUSY, NEVER, STALL } from '../src/sim/offer.js'; import { pullPassBy } from '../src/sim/machines.js';
test('mixed pass-by belt feeds a 4-ingredient Fabricator for 10,000 ticks, junk passes to the Hub', () => {
  const g = testGame(); const f = place(g,'fabricator',75,78,{recipe:'robot_arm'}); // touches hub at x=78
  for (let x = 70; x <= 77; x++) place(g,'belt',x,77,{dir:1}); place(g,'belt',78,77,{dir:2}); // along top edge, then into hub
  for (let t = 0; t < 10000; t++) { feed(g,70,77,['motor','processor','plastic','plastic','steel','coal']); tick(g); }
  assert.ok(g.stock.robot_arm >= 70, `made ${g.stock.robot_arm}`); assert.ok(g.stock.coal > 100);
  assert.ok(!machineStatus(g, f).includes('waiting for'));
});
test('dead-end merged belt into a Fabricator overstocks instead of stalling (Ironline bug)', () => {
  const g = testGame(); place(g,'belt',39,41,{dir:1}); const f = place(g,'fabricator',40,40,{recipe:'motor'}); place(g,'belt',43,41,{dir:1});
  const seq = [...Array(10).fill('steel'), ...Array(40).fill(0).map((_, i) => i % 2 ? 'gear' : 'wire')];
  for (let t = 0; t < 3000; t++) { feed(g,39,41,seq); tick(g); }
  assert.ok(g.stats.made.motor >= 3); assert.equal(entAt(g,39,41).blocked, null);
});
test('true stall at 99 is named on the belt and in the status; Clear frees it', () => {
  const g = testGame(); place(g,'belt',39,41,{dir:1}); const f = place(g,'fabricator',40,40,{recipe:'motor'});
  for (let t = 0; t < 2000; t++) { feed(g,39,41,['steel']); tick(g); }
  assert.equal(f.buf.steel, 99); assert.equal(entAt(g,39,41).blocked, 'Fabricator is full of Steel');
  assert.equal(machineStatus(g, f), '99 Steel, waiting for Gear');
  clearMachine(g, f); tick(g); tick(g); assert.ok(f.buf.steel >= 1 && f.buf.steel < 99);
});
test('wrong item on a dead-end belt is blocked with a reason', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'furnace',10,10);
  for (let t = 0; t < 100; t++) { feed(g,9,10,['coal']); tick(g); }
  assert.equal(entAt(g,9,10).blocked, "Furnace can't use Coal");
});
test('Review Focus 3: erasing the machine a belt is blocked on clears the block, no crash', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'furnace',10,10);
  for (let t = 0; t < 100; t++) { feed(g,9,10,['coal']); tick(g); }
  erase(g,10,10); for (let t = 0; t < 10; t++) tick(g); assert.equal(entAt(g,9,10).blocked, null);
});

// Extra stall cases beyond the brief. In every one the fix is a re-route or Clear, never a delete.
// Merger (left coal, back iron, optional right iron) -> belt -> steel Assembler dead end; output drained.
function mergedSteel(withRight) {
  const g = testGame(); place(g,'merger',20,21,{dir:1}); place(g,'belt',19,21,{dir:1}); place(g,'belt',20,20,{dir:2});
  if (withRight) place(g,'belt',20,22,{dir:0});
  place(g,'belt',21,21,{dir:1}); const a = place(g,'assembler',22,20,{recipe:'steel'}); place(g,'belt',24,20,{dir:1});
  const step = () => { feed(g,19,21,['iron_plate']); feed(g,20,20,['coal']); if (withRight) feed(g,20,22,['iron_plate']); tick(g); drain(g,24,20); };
  return { g, a, step };
}
test('merged dead-end belt into a 2-ingredient Assembler at the right ratio never blocks', () => {
  const { g, a, step } = mergedSteel(true); let blocks = 0;
  for (let t = 0; t < 20000; t++) { step(); if (entAt(g,21,21).blocked !== null) blocks++; }
  assert.equal(blocks, 0); assert.ok(g.stats.made.steel >= 390, `made ${g.stats.made.steel}`); assert.ok(a.buf.coal <= 2);
});
test('merged dead-end belt at the wrong ratio needs 99 surplus to stall, names it, and Clear frees it', () => {
  const { g, a, step } = mergedSteel(false); let t = 0;
  while (entAt(g,21,21).blocked === null && t < 20000) { step(); t++; }
  assert.ok(g.stats.made.steel >= 95, `stalled after only ${g.stats.made.steel}`);
  assert.equal(entAt(g,21,21).blocked, 'Assembler is full of Coal'); assert.equal(a.buf.coal, 99);
  assert.equal(machineStatus(g, a), '99 Coal, waiting for Iron plate');
  const before = g.stats.made.steel; clearMachine(g, a); step();
  assert.equal(entAt(g,21,21).blocked, null);
  for (let k = 0; k < 400; k++) step(); assert.ok(g.stats.made.steel > before);
});
test('furnace on a dead end fed alternating iron and copper ore switches with no false marker', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'furnace',10,10); place(g,'belt',12,10,{dir:1});
  const out = []; let blocks = 0;
  for (let t = 0; t < 2000; t++) { feed(g,9,10,['iron_ore','copper_ore']); tick(g); out.push(...drain(g,12,10)); if (entAt(g,9,10).blocked !== null) blocks++; }
  assert.equal(blocks, 0); assert.ok(out.includes('iron_plate') && out.includes('copper_plate'));
});
test('furnace on a dead end holding half a brick batch names the stuck ore; Clear or a re-route frees it', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); const f = place(g,'furnace',10,10); place(g,'belt',12,10,{dir:1});
  const run = (n) => { for (let t = 0; t < n; t++) { feed(g,9,10,['stone','iron_ore']); tick(g); drain(g,12,10); } };
  run(300);
  assert.equal(f.recipe, 'brick'); assert.equal(f.buf.stone, 1);
  assert.equal(entAt(g,9,10).blocked, "Furnace can't use Iron ore"); assert.equal(machineStatus(g, f), 'Waiting for Stone');
  clearMachine(g, f); assert.equal(f.recipe, null); run(1);
  assert.equal(f.recipe, 'iron_plate'); assert.equal(entAt(g,9,10).blocked, null);
  run(300); assert.equal(entAt(g,9,10).blocked, "Furnace can't use Iron ore"); // same layout jams the same way
  // The lasting fix is the spec's: re-route the belt to run past the furnace instead of into it.
  placeBeltPath(g, [[9,10],[9,11],[9,12]], [2,2,2]);
  const passed = []; for (let t = 0; t < 1200; t++) { feed(g,9,10,['stone','iron_ore']); tick(g); drain(g,12,10); passed.push(...drain(g,9,12)); }
  assert.equal(entAt(g,9,10).blocked, null); assert.ok(passed.length > 100, `passed ${passed.length}`);
  assert.ok(g.stats.made.brick >= 1);
});
test('pass-by belt beside a machine whose output is full keeps flowing to the Hub; pass-by never overstocks', () => {
  const g = testGame(); const a = place(g,'assembler',65,77,{recipe:'gear'}); // bottom edge runs along y=79, no output anywhere
  for (let x = 60; x <= 77; x++) place(g,'belt',x,79,{dir:1}); // into the Hub at x=78
  let fed = 0; for (let t = 0; t < 4000; t++) { if (feed(g,60,79,['iron_plate']) === OK) fed++; tick(g); }
  assert.equal(machineStatus(g, a), 'Output full'); assert.equal(g.stats.made.gear, 4); assert.equal(a.buf.iron_plate, 4);
  let onBelt = 0; for (let x = 60; x <= 77; x++) { const b = entAt(g,x,79); onBelt += b.items.length; assert.equal(b.blocked, null); }
  assert.equal(g.stock.iron_plate + 8 + 4 + onBelt, fed); // nothing lost: 8 became gears, 4 buffered
  assert.ok(g.stock.iron_plate > 1400, `hub got ${g.stock.iron_plate}`);
});
test('two machines either side of one pass-by belt share a scarce item evenly', () => {
  const g = testGame(); place(g,'assembler',65,77,{recipe:'gear'}); place(g,'assembler',65,80,{recipe:'gear'});
  place(g,'belt',64,77,{dir:3}); place(g,'belt',64,81,{dir:3}); // each machine's own output
  for (let x = 60; x <= 77; x++) place(g,'belt',x,79,{dir:1});
  let a = 0, b = 0; // 2.5 plates/s against 4/s of demand
  for (let t = 0; t < 8000; t++) { if (t % 8 === 0) feed(g,60,79,['iron_plate']); tick(g); a += drain(g,64,77).length; b += drain(g,64,81).length; }
  assert.ok(a > 200 && b > 200, `${a} ${b}`); assert.ok(Math.abs(a - b) <= 0.05 * (a + b), `${a} ${b}`); // without turn-taking: 396 vs 98
  assert.ok((g.stock.iron_plate ?? 0) <= 2, `wasted ${g.stock.iron_plate}`);
});
test('a side machine pulling a refused front item clears the dead-end marker at once; an empty tile is never blocked', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'furnace',10,10); const a = place(g,'assembler',8,8,{recipe:'gear'}); // (9,9) is its corner
  for (let t = 0; t < 400; t++) { feed(g,9,10,['iron_plate']); tick(g); }
  const b = entAt(g,9,10);
  assert.equal(machineStatus(g, a), 'Output full'); assert.equal(b.blocked, "Furnace can't use Iron plate"); assert.equal(b.items.length, 4);
  clearMachine(g, a); tick(g); assert.equal(b.blocked, null); assert.equal(b.items.length, 3);
  for (let t = 0; t < 10; t++) tick(g); assert.equal(b.items.length, 0); assert.equal(b.blocked, null);
});
test('overstock is dead-end only, only while starved, and STALL at 99; Hub, storage and miners never pull', () => {
  const g = testGame(); const f = place(g,'fabricator',40,40,{recipe:'motor'});
  assert.equal(offer(g,f,'steel',1,0,'passBy'), OK); assert.equal(offer(g,f,'steel',1,0,'passBy'), OK);
  assert.equal(offer(g,f,'steel',1,0,'passBy'), BUSY); assert.equal(offer(g,f,'steel',1,0,'handoff'), BUSY);
  for (let k = 2; k < 99; k++) assert.equal(offer(g,f,'steel',1,0,'deadEnd'), OK);
  assert.equal(f.buf.steel, 99); assert.equal(offer(g,f,'steel',1,0,'deadEnd'), STALL);
  f.buf.gear = 2; f.buf.wire = 2; assert.equal(offer(g,f,'steel',1,0,'deadEnd'), BUSY); // fed, so it will use them up
  assert.equal(offer(g,f,'coal',1,0,'deadEnd'), NEVER);
  const s = place(g,'storage',30,30); setOre(g,50,50,2,2,'iron_ore'); const m = place(g,'miner',50,50);
  assert.equal(pullPassBy(g,g.ents.get(1),'gear'), false); assert.equal(pullPassBy(g,s,'gear'), false); assert.equal(pullPassBy(g,m,'iron_ore'), false);
  assert.equal(g.stock.gear, undefined); assert.equal(s.queue.length, 0);
});
test('machineStatus priority and clearMachine', () => {
  const g = testGame(); const a = place(g,'assembler',10,10,{recipe:'circuit'});
  assert.equal(machineStatus(g, a), 'Waiting for Iron plate');
  a.buf = { iron_plate: 1, wire: 2 }; assert.equal(machineStatus(g, a), 'Waiting for Wire');
  a.buf = { iron_plate: 1, wire: 3 }; assert.equal(machineStatus(g, a), 'Working');
  a.out = ['circuit','circuit','circuit','circuit']; a.buf = {}; assert.equal(machineStatus(g, a), 'Output full');
  const f = place(g,'fabricator',20,20,{recipe:'robot_arm'}); f.buf = { motor: 1, plastic: 50, steel: 60 };
  assert.equal(machineStatus(g, f), '60 Steel, waiting for Processor');
  const fo = place(g,'foundry',30,30,{recipe:'silicon'}); fo.buf = { quartz: 2, coal: 1 };
  assert.equal(machineStatus(g, fo), 'No power: 25% speed');
  fo.net = 0; fo.pmult = 0.6; assert.equal(machineStatus(g, fo), 'Low power: 60% speed');
  fo.pmult = 1; assert.equal(machineStatus(g, fo), 'Working');
  fo.buf = {}; fo.pmult = 0.6; assert.equal(machineStatus(g, fo), 'Waiting for Quartz'); // missing input outranks power
  setOre(g,50,50,2,2,'iron_ore'); const m = place(g,'miner',50,50); assert.equal(machineStatus(g, m), 'Working');
  m.out = ['iron_ore','iron_ore','iron_ore','iron_ore']; assert.equal(machineStatus(g, m), 'Output full');
  assert.equal(machineStatus(g, place(g,'generator',60,60)), 'Working'); assert.equal(machineStatus(g, place(g,'storage',64,60)), 'Working');
  const fu = place(g,'furnace',70,60); assert.equal(machineStatus(g, fu), 'Waiting for ore');
  fu.recipe = 'brick'; fu.buf = { stone: 1 }; fu.out = ['brick']; fu.prog = 5;
  clearMachine(g, fu); assert.deepEqual([fu.buf, fu.out, fu.prog, fu.recipe], [{}, [], 0, null]);
  f.prog = 7; clearMachine(g, f); assert.deepEqual([f.buf, f.out, f.prog, f.recipe], [{}, [], 0, 'robot_arm']);
});
