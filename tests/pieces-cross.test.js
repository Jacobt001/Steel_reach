import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, drain } from './helpers.js'; import { place, placeTunnel, validTunnelExits, placeBeltPath, erase } from '../src/game/place.js';
import { tick } from '../src/sim/tick.js'; import { entAt } from '../src/game/state.js'; import { undo } from '../src/game/undo.js';
const row = (y, x0, x1, dir) => { const p = [], d = []; for (let x = x0; x <= x1; x++) { p.push([x, y]); d.push(dir); } return [p, d]; };
const col = (x, y0, y1, dir) => { const p = [], d = []; for (let y = y0; y <= y1; y++) { p.push([x, y]); d.push(dir); } return [p, d]; };
test('drawing across a belt auto-bridges; both flows cross without mixing', () => {
  const g = testGame(); placeBeltPath(g, ...col(15, 5, 15, 2));
  const r = placeBeltPath(g, ...row(10, 10, 20, 1)); assert.equal(r.bridges, 1); assert.equal(entAt(g, 15, 10).type, 'bridge');
  assert.ok(g.events.some(e => e.text === 'Bridge placed'));
  let H = [], V = [];
  for (let t = 0; t < 1500; t++) { feed(g, 10, 10, ['iron_plate']); feed(g, 15, 5, ['copper_plate']); tick(g); H.push(...drain(g, 20, 10)); V.push(...drain(g, 15, 15)); }
  assert.ok(H.length > 400 && V.length > 400); assert.ok(H.every(i => i === 'iron_plate')); assert.ok(V.every(i => i === 'copper_plate'));
});
test('tunnel passes items under a machine; range limits and exits', () => {
  const g = testGame(); place(g, 'assembler', 62, 59, {recipe:'gear'});
  assert.equal(placeTunnel(g, 60, 60, 1, 66, 60).reason, 'Too far for a tunnel');
  assert.equal(placeTunnel(g, 60, 60, 1, 64, 61).reason, 'Exit must be straight ahead');
  assert.deepEqual(validTunnelExits(g, 60, 60, 1), [[62,60],[63,60],[64,60],[65,60]].filter(([x,y]) => !entAt(g, x, y)));
  assert.equal(placeTunnel(g, 60, 60, 1, 65, 60).ok, true);
  placeBeltPath(g, ...row(60, 57, 59, 1)); placeBeltPath(g, ...row(60, 66, 70, 1));
  let out = []; for (let t = 0; t < 1000; t++) { feed(g, 57, 60, ['gear']); tick(g); out.push(...drain(g, 70, 60)); }
  assert.ok(out.length > 250);
});
test('Review Focus 3: erasing a tunnel end with items underground removes both ends, no crash', () => {
  const g = testGame(); placeTunnel(g, 60, 60, 1, 64, 60); placeBeltPath(g, ...row(60, 57, 59, 1));
  for (let t = 0; t < 60; t++) { feed(g, 57, 60, ['gear']); tick(g); }
  assert.ok(entAt(g, 60, 60).under.length > 0);
  erase(g, 64, 60); assert.equal(entAt(g, 60, 60), null); assert.equal(entAt(g, 64, 60), null);
  for (let t = 0; t < 100; t++) tick(g);
});
test('undo: tunnel placement removes both ends; tunnel erase restores both with valid pair links and items flow again', () => {
  const g = testGame(); placeTunnel(g, 60, 60, 1, 64, 60);
  assert.ok(undo(g)); assert.equal(entAt(g, 60, 60), null); assert.equal(entAt(g, 64, 60), null);
  assert.equal(place(g, 'tunnel', 60, 60, { dir: 1, exit: [64, 60] }).type, 'tunnel_in');
  placeBeltPath(g, ...row(60, 57, 59, 1)); placeBeltPath(g, ...row(60, 65, 68, 1));
  erase(g, 60, 60); assert.equal(entAt(g, 64, 60), null);
  assert.ok(undo(g));
  const a = entAt(g, 60, 60), b = entAt(g, 64, 60);
  assert.equal(a.pair, b.id); assert.equal(b.pair, a.id);
  let out = []; for (let t = 0; t < 400; t++) { feed(g, 57, 60, ['gear']); tick(g); out.push(...drain(g, 68, 60)); }
  assert.ok(out.length > 100);
});
test('tunnel_out takes only from its own entrance; entrance takes only from behind', () => {
  const g = testGame(); placeTunnel(g, 60, 60, 1, 63, 60); placeBeltPath(g, ...row(60, 58, 59, 1)); placeBeltPath(g, ...col(63, 57, 59, 2));
  const [ent, ex] = [entAt(g, 60, 60), entAt(g, 63, 60)];
  assert.equal(feed(g, 63, 59, ['gear'], 2), 0); for (let t = 0; t < 60; t++) tick(g);
  assert.equal(ex.items.length, 0); assert.equal(entAt(g, 63, 59).items.length, 1);
  assert.equal(feed(g, 60, 60, ['gear'], 2), 2); assert.equal(feed(g, 60, 60, ['gear'], 1), 0); assert.equal(ent.under.length, 1);
});
test('bridge refuses reverse entry; stalled lane does not block the other', () => {
  const g = testGame(); placeBeltPath(g, ...col(15, 5, 15, 2)); placeBeltPath(g, ...row(10, 10, 20, 1));
  const b = entAt(g, 15, 10); assert.equal(b.type, 'bridge');
  assert.equal(feed(g, 15, 10, ['gear'], 0), 2);
  for (let t = 0; t < 200; t++) { feed(g, 15, 5, ['gear']); tick(g); }
  assert.equal(b.laneV.length, 4); assert.equal(b.laneH.length, 0);
  for (let t = 0; t < 100; t++) { feed(g, 10, 10, ['wire']); tick(g); }
  assert.ok(b.laneH.length > 0 && b.laneH.every(i => i.item === 'wire') && b.laneV.every(i => i.item === 'gear'));
});
test('auto-bridge carries over items and honours the unlock tier', () => {
  const g = testGame(); placeBeltPath(g, ...col(15, 5, 15, 2));
  entAt(g, 15, 10).items.push({ item: 'gear', pos: 0.5 });
  placeBeltPath(g, ...row(10, 14, 16, 1));
  assert.deepEqual(entAt(g, 15, 10).laneV, [{ item: 'gear', pos: 0.5 }]);
  const l = testGame({ tier: 2 }); placeBeltPath(l, ...col(15, 5, 15, 2));
  const r = placeBeltPath(l, ...row(10, 14, 16, 1));
  assert.equal(r.bridges, 0); assert.equal(entAt(l, 15, 10).type, 'belt'); assert.equal(entAt(l, 15, 10).dir, 1);
  assert.equal(placeTunnel(l, 60, 60, 1, 64, 60).reason, 'Unlocks at Tier 3');
});
