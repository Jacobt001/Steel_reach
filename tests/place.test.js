import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, setOre } from './helpers.js'; import { canPlace, place, erase } from '../src/game/place.js';
import { entAt } from '../src/game/state.js'; import { doAction, undo } from '../src/game/undo.js';
test('multi-tile footprint occupies every tile and blocks overlap', () => {
  const g = testGame(); const f = place(g, 'fabricator', 40, 40, {recipe:'motor'});
  assert.equal(entAt(g, 42, 42), f); assert.equal(entAt(g, 43, 42), null);
  assert.deepEqual(canPlace(g, 'assembler', 41, 39), {ok:false, reason:'Tile is occupied'});
  assert.deepEqual(canPlace(g, 'assembler', 159, 10), {ok:false, reason:'Off the map'});
});
test('miner rules: needs ore, one type, locked ores refused, tiles counted', () => {
  const g = testGame({tier:4});
  assert.equal(canPlace(g, 'miner', 10, 10).reason, 'Miners need an ore tile');
  setOre(g, 10, 10, 1, 1, 'iron_ore'); setOre(g, 11, 10, 1, 1, 'coal');
  assert.equal(canPlace(g, 'miner', 10, 10).reason, 'Miner covers two ore types');
  setOre(g, 20, 20, 2, 1, 'quartz'); assert.equal(canPlace(g, 'miner', 20, 20).reason, 'Quartz unlocks at Tier 5');
  setOre(g, 30, 30, 2, 2, 'iron_ore'); setOre(g, 30, 31, 1, 1, null); assert.equal(place(g, 'miner', 30, 30).tiles, 3);
});
test('locked buildings refused with tier', () => {
  const g = testGame({tier:1}); assert.equal(canPlace(g, 'assembler', 5, 5).reason, 'Unlocks at Tier 2');
});
test('hub cannot be erased; erase removes', () => {
  const g = testGame(); assert.equal(erase(g, 79, 79), false);
  place(g, 'belt', 5, 5, {dir:1}); assert.equal(erase(g, 5, 5), true); assert.equal(entAt(g, 5, 5), null);
});
test('undo reverts a whole action and is capped at 20', () => {
  const g = testGame();
  doAction(g, () => { for (let x = 0; x < 5; x++) place(g, 'belt', x, 0, {dir:1}); });
  assert.ok(undo(g)); for (let x = 0; x < 5; x++) assert.equal(entAt(g, x, 0), null);
  place(g, 'assembler', 50, 50, {recipe:'gear'}); doAction(g, () => erase(g, 50, 50));
  assert.ok(undo(g)); assert.equal(entAt(g, 50, 50).recipe, 'gear');
  for (let i = 0; i < 25; i++) doAction(g, () => place(g, 'belt', i, 5, {dir:1}));
  let n = 0; while (undo(g)) n++; assert.equal(n, 20);
});
