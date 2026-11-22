import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
test('one generator fully powers a foundry through a pole; six are 87.5%', () => {
  const g = testGame(); const gen = place(g,'generator',10,10); gen.fuel.coal = 10; place(g,'pole',18,10);
  const f = place(g,'foundry',20,12,{recipe:'silicon'}); tick(g); tick(g); assert.equal(f.pmult, 1);
  const more = [[20,8],[16,12],[18,12],[16,8],[14,10]].map(([x,y]) => place(g,'foundry',x,y,{recipe:'silicon'}));
  tick(g); tick(g); assert.ok(Math.abs(f.pmult - (0.25 + 0.75*20/24)) < 1e-9);
});
test('uncovered foundry runs at 25%; fuel runs out → 25%', () => {
  const g = testGame(); const lone = place(g,'foundry',100,100,{recipe:'silicon'}); tick(g); assert.equal(lone.pmult, 0.25);
  const gen = place(g,'generator',10,10); gen.fuel.coal = 2; const f = place(g,'foundry',12,10,{recipe:'silicon'});
  for (let t = 0; t < 170; t++) tick(g); assert.equal(gen.fuel.coal, 0); assert.equal(f.pmult, 0.25);
});
test('generators do not burn with no demand', () => {
  const g = testGame(); const gen = place(g,'generator',10,10); gen.fuel.coal = 5; for (let t = 0; t < 400; t++) tick(g); assert.equal(gen.fuel.coal, 5);
});
