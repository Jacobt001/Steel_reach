import { test } from 'node:test'; import assert from 'node:assert/strict';
import { ITEMS, RECIPES, BUILDINGS, TIERS, RESEARCH, ORE_TIER } from '../src/config.js';
const SIZE = {furnace:[1,1], assembler:[1,2], fabricator:[3,4], foundry:[2,2], refinery:[1,1]};
const tierOf = (kind, id) => TIERS.findIndex(t => t.unlocks[kind].includes(id)) + 1; // 0 = never
test('27 items, every recipe input/output is a known item', () => {
  assert.equal(Object.keys(ITEMS).length, 27);
  for (const [out, r] of Object.entries(RECIPES)) { assert.ok(ITEMS[out], out); for (const k in r.in) assert.ok(ITEMS[k], k); }
});
test('ingredient counts fit the machine', () => {
  for (const [out, r] of Object.entries(RECIPES)) { const n = Object.keys(r.in).length, [lo, hi] = SIZE[r.machine]; assert.ok(n >= lo && n <= hi, out); }
});
test('12 tiers; each recipe unlocks at its stated tier; goals use unlocked items', () => {
  assert.equal(TIERS.length, 12);
  for (const [out, r] of Object.entries(RECIPES)) assert.equal(tierOf('recipes', out), r.tier, out);
  TIERS.forEach((t, i) => { for (const g in t.goals) { const tt = RECIPES[g].tier; assert.ok(tt <= i + 1, `${g} in tier ${i+1}`); } });
});
test('every ore and placeable building unlocks somewhere', () => {
  for (const o in ORE_TIER) assert.equal(tierOf('ores', o), ORE_TIER[o], o);
  for (const b in BUILDINGS) if (b !== 'hub') assert.equal(tierOf('buildings', b), BUILDINGS[b].tier, b);
});
test('research costs only use items unlocked by the research tier', () => {
  for (const r of RESEARCH) for (const k in r.cost) assert.ok(RECIPES[k].tier <= r.tier, `${r.id}:${k}`);
  for (const r of RESEARCH) if (r.req) assert.ok(RESEARCH.find(x => x.id === r.req));
});
