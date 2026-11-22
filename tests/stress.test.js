import { test } from 'node:test'; import assert from 'node:assert/strict';
import { stress, countItems } from '../src/stress.js';
import { createGame } from '../src/game/state.js';
import { tick } from '../src/sim/tick.js';
import { CENTER, HUB } from '../src/config.js';

test('stress fills a far area up to the asked counts, and the factory keeps running', () => {
  const g = createGame(5);
  const r = stress(g, 3000, 10000);
  assert.equal(g.ents.size - 1, 3000, 'buildings, not counting the Hub');
  assert.equal(countItems(g), 10000);
  assert.deepEqual([r.buildings, r.items], [3000, 10000]);
  assert.equal(g.undo.length, 0, 'not an undoable player action');
  // Far from the Hub: nothing within the first ring's reach of the centre.
  for (const e of g.ents.values()) {
    if (e.type === 'hub') continue;
    assert.ok(Math.hypot(e.x - CENTER.x, e.y - CENTER.y) > 20, `${e.type} at ${e.x},${e.y}`);
    assert.ok(e.x + e.w <= HUB.x || e.x >= HUB.x + HUB.w || e.y + e.h <= HUB.y || e.y >= HUB.y + HUB.h);
  }
  // Closed loops and isolated machines: items circulate and none are created or lost.
  const before = g.conveyors.filter((c) => c.items.length).map((c) => c.items.map((i) => i.pos).join());
  for (let i = 0; i < 40; i++) tick(g);
  assert.equal(countItems(g), 10000);
  const after = g.conveyors.filter((c) => c.items.length).map((c) => c.items.map((i) => i.pos).join());
  assert.notDeepEqual(after, before, 'items move');
});

test('stress only tops up: a second call adds nothing, and counts beyond the map stop cleanly', () => {
  const g = createGame(5);
  stress(g, 500, 1000);
  const n = g.ents.size;
  const r = stress(g, 500, 1000);
  assert.equal(g.ents.size, n);
  assert.deepEqual([r.buildings, r.items], [500, 1000]);
  const big = createGame(6);
  const rb = stress(big, 1e6, 1e7);
  assert.ok(rb.buildings > 3000 && rb.buildings < 1e6, String(rb.buildings));
  for (let i = 0; i < 3; i++) tick(big);
});
