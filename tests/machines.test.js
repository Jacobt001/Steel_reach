import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, setOre, feed, drain, run } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
test('full-coverage miner makes 1 ore/s; 2 tiles makes half', () => {
  const g = testGame(); setOre(g,10,10,2,2,'iron_ore'); setOre(g,20,10,2,1,'iron_ore');
  place(g,'miner',10,10); place(g,'belt',12,10,{dir:1}); place(g,'miner',20,10); place(g,'belt',22,10,{dir:1});
  let a = 0, b = 0; for (let t = 0; t < 1200; t++) { tick(g); a += drain(g,12,10).length; b += drain(g,22,10).length; }
  assert.ok(Math.abs(a - 60) <= 2 && Math.abs(b - 30) <= 2, `${a} ${b}`);
});
test('miner touching furnace hands off; furnace output reaches a belt', () => {
  const g = testGame(); setOre(g,10,10,2,2,'copper_ore'); place(g,'miner',10,10); place(g,'furnace',12,10); place(g,'belt',14,10,{dir:1});
  const out = []; for (let t = 0; t < 1200; t++) { tick(g); out.push(...drain(g,14,10)); }
  assert.ok(out.length >= 30 && out.every(i => i === 'copper_plate'));
});
test('furnace auto-detects, switches ore types, refuses non-smeltables', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); const f = place(g,'furnace',10,10); place(g,'belt',12,10,{dir:1});
  const out = []; for (let t = 0; t < 2000; t++) { feed(g,9,10,['iron_ore','copper_ore']); tick(g); out.push(...drain(g,12,10)); }
  assert.ok(out.includes('iron_plate') && out.includes('copper_plate'));
});
test('assembler crafts gears from a dead-end belt; stats.made counts', () => {
  const g = testGame(); place(g,'belt',9,10,{dir:1}); place(g,'assembler',10,10,{recipe:'gear'}); place(g,'belt',12,10,{dir:1});
  const out = []; for (let t = 0; t < 400; t++) { feed(g,9,10,['iron_plate']); tick(g); out.push(...drain(g,12,10)); }
  assert.ok(out.length >= 15 && out.every(i => i === 'gear')); assert.ok(g.stats.made.gear >= out.length);
});
test('machine touching the hub delivers straight in', () => {
  const g = testGame(); place(g,'belt',75,79,{dir:1}); place(g,'assembler',76,78,{recipe:'gear'}); // tiles 76-77, touches hub at x=78
  for (let t = 0; t < 600; t++) { feed(g,75,79,['iron_plate']); tick(g); }
  assert.ok(g.stock.gear > 10);
});
test('acceptMachine: furnace BUSY for other ore, NEVER for non-smeltable, hub refuses passBy', async () => {
  const { offer, OK, BUSY, NEVER } = await import('../src/sim/offer.js');
  const g = testGame(); const f = place(g,'furnace',10,10);
  assert.equal(offer(g,f,'iron_ore',1,0,'handoff'), OK);
  assert.equal(offer(g,f,'copper_ore',1,0,'handoff'), BUSY);
  assert.equal(offer(g,f,'gear',1,0,'handoff'), NEVER);
  assert.equal(offer(g,g.ents.get(1),'gear',1,0,'passBy'), NEVER);
});
test('machine with two output belts alternates', () => {
  const g = testGame(); setOre(g,10,10,2,2,'iron_ore'); place(g,'miner',10,10); place(g,'belt',12,10,{dir:1}); place(g,'belt',12,11,{dir:1});
  let a = 0, b = 0; for (let t = 0; t < 400; t++) { tick(g); a += drain(g,12,10).length; b += drain(g,12,11).length; }
  assert.ok(a > 5 && Math.abs(a - b) <= 1, `${a} ${b}`);
});
