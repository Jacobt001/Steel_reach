import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame } from './helpers.js'; import { acceptHub } from '../src/sim/hub.js';
import { buyResearch, researchState, isUnlocked } from '../src/game/progress.js'; import { TIERS, RESEARCH } from '../src/config.js';
test('delivering all goals advances the tier and resets progress', () => {
  const g = testGame({tier:1});
  for (const [k, n] of Object.entries(TIERS[0].goals)) for (let i = 0; i < n; i++) acceptHub(g, k);
  assert.equal(g.tier, 2); assert.deepEqual(g.prog, {}); assert.ok(g.events.some(e => e.type === 'tierUp' && e.tier === 2));
  assert.ok(isUnlocked(g, 'buildings', 'assembler'));
});
test('finishing tier 12 enters sandbox and reports completion', () => {
  const g = testGame({tier:12}); for (let i = 0; i < TIERS[11].goals.fusion_core; i++) acceptHub(g, 'fusion_core');
  assert.equal(g.tier, 13); assert.ok(g.events.some(e => e.type === 'complete')); assert.ok(isUnlocked(g, 'recipes', 'fusion_core'));
});
test('research gates, costs, and effects', () => {
  const g = testGame({tier:3});
  assert.equal(researchState(g, 'miner2').reason, 'Unlocks at Tier 4');
  assert.equal(researchState(g, 'miner1').reason, 'Not enough items');
  const c = RESEARCH.find(r => r.id === 'miner1').cost.iron_plate;
  g.stock.iron_plate = c + 1; assert.equal(buyResearch(g, 'miner1').ok, true); assert.equal(g.stock.iron_plate, 1);
  assert.ok(Math.abs(g.mods.minerMult - 1.4) < 1e-9); assert.equal(researchState(g, 'miner1').reason, 'Already researched');
  g.tier = 4; g.research = {}; g.stock = {steel:99, gear:99}; assert.equal(researchState(g, 'miner2').reason, 'Needs Faster Miners I');
});
test('a tier-up does not double-fire, and tier 13 unlocks everything', () => {
  const g = testGame({tier:1});
  for (const [k, n] of Object.entries(TIERS[0].goals)) for (let i = 0; i < n; i++) acceptHub(g, k);
  assert.equal(g.events.filter(e => e.type === 'tierUp').length, 1);
  const s = testGame({tier:13});
  assert.ok(isUnlocked(s, 'buildings', 'refinery')); assert.ok(isUnlocked(s, 'ores', 'uranium_ore'));
});
test('research recalculates mods: additive, replacing, dirty flags, events', () => {
  const g = testGame({tier:10});
  g.stock = { cable: 60, turbine: 10, iron_plate: 30 };
  g.powerDirty = g.topoDirty = false;
  assert.equal(buyResearch(g, 'widePoles').ok, true);
  assert.equal(g.mods.poleReach, 12); assert.equal(g.mods.coverHalf, 5);
  assert.ok(g.powerDirty && g.topoDirty);
  assert.equal(buyResearch(g, 'deepDrills').ok, true); assert.equal(g.mods.minerYield, 2);
  assert.deepEqual(g.events.filter(e => e.type === 'research').map(e => e.id), ['widePoles', 'deepDrills']);
  assert.equal(buyResearch(g, 'widePoles').ok, false);
});
