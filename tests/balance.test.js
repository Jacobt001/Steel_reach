import { test } from 'node:test'; import assert from 'node:assert/strict'; import { estimate } from '../tools/balance.mjs';
test('pacing hits the spec: 5–8 h total, early tiers 10–15 min, late 40–50, research within 5 min', () => {
  const e = estimate(); assert.ok(e.totalMinutes >= 300 && e.totalMinutes <= 480, `total ${e.totalMinutes}`);
  for (const t of e.tiers.slice(0, 3)) assert.ok(t.minutes >= 10 && t.minutes <= 15, `T${t.tier} ${t.minutes}`);
  for (const t of e.tiers.slice(8)) assert.ok(t.minutes >= 40 && t.minutes <= 50, `T${t.tier} ${t.minutes}`);
  for (const t of e.tiers) assert.ok(t.researchMinutes <= 5, `T${t.tier} research ${t.researchMinutes}`);
});
test('measureModules reports every recipe from a module that keeps its crafter busy', async () => {
  const { measureModules } = await import('../tools/balance.mjs'); const { RECIPES } = await import('../src/config.js');
  const m = measureModules(); // throws if any module starves its crafter or backs up its output
  assert.deepEqual(Object.keys(m).sort(), Object.keys(RECIPES).sort());
  for (const [id, r] of Object.entries(m)) assert.ok(r > 0, `${id} ${r}`);
});
