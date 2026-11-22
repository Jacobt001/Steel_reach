import { test } from 'node:test'; import assert from 'node:assert/strict'; import { estimate } from '../tools/balance.mjs';
test('pacing hits the spec: 5–8 h total, early tiers 10–15 min, late 40–50, research within 5 min or goals move 15%', () => {
  const e = estimate(); assert.ok(e.totalMinutes >= 300 && e.totalMinutes <= 480, `total ${e.totalMinutes}`);
  for (const t of e.tiers.slice(0, 3)) assert.ok(t.minutes >= 10 && t.minutes <= 15, `T${t.tier} ${t.minutes}`);
  for (const t of e.tiers.slice(8)) assert.ok(t.minutes >= 40 && t.minutes <= 50, `T${t.tier} ${t.minutes}`);
  // 8.2 is either/or: finish a research node OR see a goal move meaningfully in a 5-minute session.
  for (const t of e.tiers) assert.ok(t.researchMinutes <= 5 || t.goalBar5 >= 0.15, `T${t.tier} research ${t.researchMinutes}, 5-min goal move ${t.goalBar5}`);
});
test('measureModules reports every recipe from a module that keeps its crafter busy', async () => {
  const { measureModules } = await import('../tools/balance.mjs'); const { RECIPES } = await import('../src/config.js');
  const m = measureModules(); // throws if any module starves its crafter or backs up its output
  assert.deepEqual(Object.keys(m).sort(), Object.keys(RECIPES).sort());
  for (const [id, r] of Object.entries(m)) assert.ok(r > 0, `${id} ${r}`);
});
test('a module is the whole chain from ore, so late chains are far bigger than one crafter', async () => {
  const { chainOf, moduleRate, BUDGET } = await import('../tools/balance.mjs');
  const c = (id) => chainOf(id);
  assert.equal(c('iron_plate').size, 2); // a miner and a furnace
  for (const id of ['motor', 'processor', 'frame', 'robot_arm', 'turbine', 'fusion_core']) assert.ok(c(id).size >= 8, `${id} ${c(id).size}`);
  assert.ok(c('fusion_core').size > c('turbine').size && c('turbine').size > c('motor').size);
  // A chain bigger than the player's budget is slowed in proportion, never sped up.
  const m = moduleRate('fusion_core', 12);
  assert.ok(m.chain.size > BUDGET[11] && m.perMin < m.full);
  assert.ok(Math.abs(m.perMin - m.full * BUDGET[11] / m.chain.size) < 1e-9);
});
