import { test } from 'node:test'; import assert from 'node:assert/strict';
import { generateWorld, ringOf, idx } from '../src/world.js'; import { MAP, RINGS } from '../src/config.js';
const BASIC = ['iron_ore','copper_ore','stone','coal'];
function patches(w, type, maxDist) { // count 4-connected patches with any tile within maxDist of center
  const seen = new Set(); let n = 0;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = idx(x,y); if (w.ore[i] !== type || seen.has(i)) continue;
    let near = false; const st = [[x,y]]; seen.add(i);
    while (st.length) { const [a,b] = st.pop(); if (Math.hypot(a+.5-80, b+.5-80) <= maxDist) near = true;
      for (const [c,d] of [[a+1,b],[a-1,b],[a,b+1],[a,b-1]]) { const j = idx(c,d);
        if (c>=0&&d>=0&&c<MAP&&d<MAP&&!seen.has(j)&&w.ore[j]===type) { seen.add(j); st.push([c,d]); } } }
    if (near) n++;
  }
  return n;
}
test('deterministic per seed, different across seeds', () => {
  assert.deepEqual(generateWorld(7).ore, generateWorld(7).ore);
  assert.notDeepEqual(generateWorld(7).ore, generateWorld(8).ore);
});
test('hub tiles have no ore', () => { const w = generateWorld(3);
  for (let y = 78; y < 82; y++) for (let x = 78; x < 82; x++) assert.equal(w.ore[idx(x,y)], null); });
test('ring 0 has >=2 patches of each basic ore within 15 tiles, for 20 seeds', () => {
  for (let s = 1; s <= 20; s++) { const w = generateWorld(s); for (const t of BASIC) assert.ok(patches(w, t, 15) >= 2, `seed ${s} ${t}`); }
});
test('special ores appear only in their ring, and every special ore exists', () => {
  const w = generateWorld(5); const found = {};
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) { const o = w.ore[idx(x,y)]; if (!o || BASIC.includes(o)) continue;
    found[o] = true; assert.equal(RINGS[ringOf(x,y)].ore, o, `${o} at ${x},${y}`); }
  for (const r of RINGS.slice(1)) assert.ok(found[r.ore], r.ore);
});
test('outer basic patches are bigger on average than ring 0 patches', () => {
  const w = generateWorld(9); let inner = 0, outer = 0, ni = 0, no = 0;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) { const o = w.ore[idx(x,y)]; if (!BASIC.includes(o)) continue;
    if (ringOf(x,y) === 0) inner++; else outer++; }
  assert.ok(outer / inner > 2);
});
