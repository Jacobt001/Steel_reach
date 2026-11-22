import { test } from 'node:test'; import assert from 'node:assert/strict';
import { testGame, feed, setOre } from './helpers.js'; import { place } from '../src/game/place.js'; import { tick } from '../src/sim/tick.js';
import { serialize, deserialize, tryLoad } from '../src/save/serialize.js'; import { encodeSaveCode, decodeSaveCode } from '../src/save/code.js';
import { createClaudeStore, loadBest } from '../src/save/stores.js';
const strip = s => { const o = structuredClone(s); delete o.savedAt; return o; };
function busyGame() { const g = testGame(); setOre(g,10,10,2,2,'iron_ore'); place(g,'miner',10,10); place(g,'furnace',12,10);
  for (let x = 14; x < 30; x++) place(g,'belt',x,10,{dir:1}); place(g,'tunnel',30,10,{dir:1, exit:[33,10]});
  for (let t = 0; t < 500; t++) tick(g); return g; }
test('round trip is exact, and simulation continues identically', () => {
  const g = busyGame(); const s = serialize(g), h = deserialize(s);
  assert.deepEqual(strip(serialize(h)), strip(s));
  for (let t = 0; t < 300; t++) { tick(g); tick(h); } assert.deepEqual(strip(serialize(h)), strip(serialize(g)));
});
test('save codes round trip', async () => { const s = serialize(busyGame()); assert.deepEqual(await decodeSaveCode(' ' + await encodeSaveCode(s) + '\n'), s); });
test('Review Focus 1: garbage, foreign, damaged and newer saves never throw from tryLoad', async () => {
  for (const bad of ['hello', 'SR1.!!!', 'SR1.' + Buffer.from('{}').toString('base64url'), '']) await assert.rejects(decodeSaveCode(bad), /Not a Steelreach save code/);
  assert.deepEqual(tryLoad({v:99}), {ok:false, reason:'Save is from a newer version'});
  assert.deepEqual(tryLoad({v:1, seed:'x', ents:'nope'}), {ok:false, reason:'Save is damaged'});
  assert.equal(tryLoad(null).ok, false);
});
test('Review Focus 5: claude unavailable or slow never blocks loading', async () => {
  assert.equal(await createClaudeStore({ use: async () => null }), null);
  const never = { name:'claude', load: () => new Promise(() => {}) }, broken = { name:'x', load: async () => { throw new Error('offline'); } };
  const local = { name:'local', load: async () => ({ v:1, savedAt: 5 }) };
  const t0 = Date.now(); assert.equal((await loadBest([never, broken, local], 50)).savedAt, 5); assert.ok(Date.now() - t0 < 1000);
});

// ---- beyond the brief: the cases that would lose or corrupt progress ----
import { randomBytes } from 'node:crypto';
import { erase } from '../src/game/place.js'; import { undo } from '../src/game/undo.js'; import { entAt, createGame } from '../src/game/state.js';
import { createLocalStore, createSaver } from '../src/save/stores.js';
const viaJson = (s) => JSON.parse(JSON.stringify(s));
const sameRun = (g, h, ticks, every = 25) => { for (let t = 1; t <= ticks; t++) { tick(g); tick(h); if (t % every === 0) assert.deepEqual(strip(serialize(h)), strip(serialize(g)), `diverged by tick ${t}`); } };

test('undo re-adds under the old id at the end of the Map; both survive, so power-net choice reloads identically', () => {
  // Two nets 9 apart both cover the refinery; it joins the lowest-id net. After the undo G1 has the
  // lowest id but sits last in the Map, so renumbering in Map order would move the refinery to the dry net.
  const g = testGame(); place(g,'generator',10,10); place(g,'generator',19,10); const r = place(g,'refinery',14,10);
  erase(g,10,10); undo(g); entAt(g,10,10).fuel.coal = 10; r.buf.crude_oil = 6;
  const h = deserialize(viaJson(serialize(g)));
  assert.deepEqual([...h.ents.keys()], [...g.ents.keys()]);
  assert.deepEqual(h.machines.map(e => e.id), g.machines.map(e => e.id));
  tick(g); tick(h); assert.equal(entAt(g,14,10).pmult, 1); assert.equal(entAt(h,14,10).pmult, 1);
  sameRun(g, h, 150);
});

test('a factory with every piece continues identically after a JSON round trip', () => {
  const g = testGame(); setOre(g,10,20,2,2,'iron_ore'); setOre(g,21,14,2,2,'copper_ore');
  const ok = (e) => assert.ok(e, 'placement failed');
  ok(place(g,'miner',10,20)); ok(place(g,'furnace',12,20));
  for (const x of [14,15]) ok(place(g,'belt',x,20,{dir:1}));
  ok(place(g,'splitter',16,20,{dir:1})); ok(place(g,'belt',17,20,{dir:1})); ok(place(g,'belt',18,20,{dir:1}));
  for (const [x,y,dir] of [[16,21,2],[16,22,1],[17,22,1],[18,22,1],[19,22,0],[19,21,0]]) ok(place(g,'belt',x,y,{dir}));
  ok(place(g,'merger',19,20,{dir:1})); ok(place(g,'belt',20,20,{dir:1})); ok(place(g,'belt',21,20,{dir:1}));
  ok(place(g,'miner',21,14)); ok(place(g,'furnace',21,16)); ok(place(g,'belt',22,18,{dir:2})); ok(place(g,'belt',22,19,{dir:2}));
  ok(place(g,'bridge',22,20,{dirH:1, dirV:2})); ok(place(g,'belt',22,21,{dir:2})); ok(place(g,'belt',22,22,{dir:2}));
  ok(place(g,'storage',22,23)); for (const x of [24,25,26]) ok(place(g,'belt',x,23,{dir:1}));
  ok(place(g,'belt',23,20,{dir:1})); ok(place(g,'assembler',24,20,{recipe:'gear'})); for (const x of [26,27,28]) ok(place(g,'belt',x,20,{dir:1}));
  const gen = place(g,'generator',40,10); ok(gen); gen.fuel.coal = 3; ok(place(g,'pole',48,10));
  const f = place(g,'foundry',44,10,{recipe:'silicon'}); ok(f); f.buf = { quartz: 4, coal: 2 };
  for (let t = 0; t < 600; t++) tick(g);
  const s = serialize(g), types = new Set(s.ents.map(e => e[0]));
  for (const t of ['miner','furnace','belt','splitter','merger','bridge','storage','assembler','generator','pole','foundry']) assert.ok(types.has(t), t);
  const h = deserialize(viaJson(s)); assert.deepEqual(strip(serialize(h)), strip(s));
  sameRun(g, h, 600);
});

test('every building type keeps its saved state, and loaded entities match field for field', () => {
  const g = testGame(); setOre(g,60,60,2,2,'coal');
  const m = place(g,'miner',60,60); m.timer = 7; m.out = ['coal']; m.rr = 1;
  const b = place(g,'belt',70,60,{dir:2}); b.items = [{item:'gear', pos:0.875}, {item:'wire', pos:0.5004}]; b.side = 1;
  const br = place(g,'bridge',71,60,{dirH:3, dirV:0}); br.laneH = [{item:'coal', pos:0.1}]; br.laneV = [{item:'stone', pos:0.2}];
  place(g,'tunnel',72,62,{dir:2, exit:[72,66]}); const ti = entAt(g,72,62), to = entAt(g,72,66);
  ti.under = [{item:'brick', left:3}]; to.items = [{item:'steel', pos:0.3}];
  const sp = place(g,'splitter',74,60,{dir:1}); sp.hold = {item:'glass', pos:0.85}; sp.rr = 2;
  const mg = place(g,'merger',75,60,{dir:1}); mg.hold = null; mg.turn = 2;
  const st = place(g,'storage',76,62); st.queue = ['motor','motor','frame']; st.rr = 3;
  const gen = place(g,'generator',60,70); gen.fuel = { coal: 4, fuel_cell: 1 }; gen.burn = 33; gen.burnPower = 30;
  place(g,'pole',63,70);
  const crafters = [['furnace',[64,70],'brick'],['assembler',[64,74],'circuit'],['fabricator',[68,74],'motor'],['foundry',[60,74],'silicon'],['refinery',[72,74],'plastic']];
  for (const [type, [x,y], recipe] of crafters) { const c = place(g,type,x,y,{recipe}); c.buf = { [Object.keys({brick:{stone:1}, circuit:{wire:1}, motor:{gear:1}, silicon:{quartz:1}, plastic:{crude_oil:1}}[recipe])[0]]: 3 }; c.prog = 12.25; c.out = [recipe]; c.rr = 1; }
  const s = viaJson(serialize(g)); assert.equal(s.ents.find(e => e[0] === 'belt')[5][3], 0.5, 'positions rounded to 3 decimals');
  assert.equal(s.ents.some(e => e[0] === 'hub'), false, 'hub is not saved');
  const h = deserialize(s);
  const keep = ['id','type','x','y','w','h','dir','items','side','dirH','dirV','laneH','laneV','pair','under','hold','rr','turn','queue','ore','tiles','timer','out','fuel','burn','burnPower','recipe','buf','prog'];
  const pick = (e) => Object.fromEntries(keep.filter(k => k in e).map(k => [k, e[k]]));
  for (const e of g.ents.values()) { const want = pick(e); if (want.items) want.items = want.items.map(it => ({...it, pos: Math.round(it.pos*1000)/1000})); assert.deepEqual(pick(h.ents.get(e.id)), want, e.type); }
  assert.equal(h.ents.size, g.ents.size);
});

test('transient display state and caches never reach the save', () => {
  const g = busyGame(); const before = strip(serialize(g));
  for (const e of g.ents.values()) { e.blocked = 'Furnace is full of Iron ore'; e.blockedKind = 'stall'; e.stall = 99; e.stallH = 5; e.net = 7; e.pmult = 0.5; e[Symbol('cache')] = {}; }
  g.undo.push([{op:'add', id:5}]); g.events.push({type:'toast', text:'x'}); g.hubPulse = 3; g.topoVer = 99;
  assert.deepEqual(strip(serialize(g)), before);
  const h = deserialize(viaJson(serialize(g))); assert.deepEqual(h.undo, []); assert.deepEqual(h.events, []);
  assert.equal(entAt(h,14,10).blocked, null);
});

test('a snapshot shares nothing with the live game, so ticking during an async encode cannot change it', () => {
  const g = busyGame(); const s = serialize(g), json = JSON.stringify(s);
  for (let t = 0; t < 200; t++) tick(g); g.stock.iron_plate = 5; g.settings.lastRecipe.assembler = 'gear'; g.stats.made.gear = 1;
  assert.equal(JSON.stringify(s), json);
  const h = deserialize(s); entAt(h,29,10).items.length = 0; h.settings.sfx = false; assert.equal(JSON.stringify(s), json);
});

test('loading derives mods from research, marks topology and power dirty, regenerates the world and keeps ids growing', () => {
  const g = testGame(); g.research = { belt1: true, longTunnels: true, bogus: true }; g.completedAt = 1234; g.stock = { gear: 3 }; g.prog = { gear: 2 };
  place(g,'belt',50,50,{dir:1}); place(g,'belt',51,50,{dir:1});
  const h = deserialize(viaJson(serialize(g)));
  assert.equal(h.mods.beltLevel, 1); assert.equal(h.mods.tunnelGap, 8); assert.deepEqual(h.research, { belt1: true, longTunnels: true });
  assert.ok(h.topoDirty && h.powerDirty); assert.deepEqual(h.world.ore, createGame(1).world.ore);
  assert.equal(h.completedAt, 1234); assert.deepEqual(h.stock, { gear: 3 }); assert.deepEqual(h.prog, { gear: 2 });
  assert.equal(h.ents.get(1).type, 'hub'); assert.equal(place(h,'belt',52,50,{dir:1}).id, 4);
});

test('unknown building types are skipped, the rest loads', () => {
  const s = viaJson(serialize(busyGame())); const n = s.ents.length;
  s.ents.push(['laser', 60, 60, 0, 900], ['hub', 78, 78, 0, 1], ['constructor', 61, 61, 0, 901, 1], ['__proto__', 62, 62, 0, 902]);
  const r = tryLoad(s); assert.equal(r.ok, true); assert.equal(r.game.ents.size, n + 1); assert.equal(entAt(r.game, 60, 60), null);
});

test('damaged saves are refused whole, never half-loaded or crashing a later tick', () => {
  const base = viaJson(serialize(busyGame()));
  const tunnel = (c) => c.ents.find(e => e[0] === 'tunnel_in'), aBelt = (c) => c.ents.find(e => e[0] === 'belt');
  const cases = {
    'entity not an array': c => { c.ents[0] = 'x'; }, 'type not a string': c => { c.ents.push([42, 60, 60, 1, 900]); },
    'unknown item on a belt': c => { c.ents.push(['belt', 60, 60, 1, 900, ['unobtainium', 0.5], 0]); },
    'position out of range': c => { c.ents.push(['belt', 60, 60, 1, 900, ['iron_plate', 5], 0]); },
    'odd lane array': c => { c.ents.push(['belt', 60, 60, 1, 900, ['iron_plate'], 0]); },
    'missing state': c => { c.ents.push(['belt', 60, 60, 1, 900]); },
    'off the map': c => { c.ents.push(['miner', 159, 60, 0, 900, 'iron_ore', 4, 0, [], 0]); },
    'overlap': c => { c.ents.push(['belt', 14, 10, 1, 900, [], 0]); },
    'duplicate id': c => { c.ents.push(['belt', 60, 60, 1, aBelt(c)[4], [], 0]); },
    'hub id': c => { c.ents.push(['belt', 60, 60, 1, 1, [], 0]); },
    'bad dir': c => { c.ents.push(['belt', 60, 60, 4, 900, [], 0]); },
    'splitter rr out of range': c => { c.ents.push(['splitter', 60, 60, 1, 900, null, 3]); },
    'wrong machine recipe': c => { c.ents.push(['furnace', 60, 60, 0, 900, 'gear', {}, 0, [], 0]); },
    'negative buffer': c => { c.ents.push(['furnace', 60, 60, 0, 900, 'iron_plate', { iron_ore: -1 }, 0, [], 0]); },
    'fractional burn': c => { c.ents.push(['generator', 60, 60, 0, 900, 1, 0, 2.5, 20]); },
    'tunnel pair to a belt': c => { tunnel(c)[5] = aBelt(c)[4]; },
    'version 0': c => { c.v = 0; }, 'version string': c => { c.v = '1'; }, 'no seed': c => { delete c.seed; },
    'tier 0': c => { c.tier = 0; }, 'tier 14': c => { c.tier = 14; }, 'negative tick': c => { c.tick = -1; },
    'stock array': c => { c.stock = []; }, 'research null': c => { c.research = null; }, 'stats null': c => { c.stats = null; },
    'completedAt string': c => { c.completedAt = 'soon'; }, 'completedAt missing': c => { delete c.completedAt; },
  };
  for (const [name, mutate] of Object.entries(cases)) { const c = structuredClone(base); mutate(c); assert.deepEqual(tryLoad(c), { ok:false, reason:'Save is damaged' }, name); }
  for (const bad of [undefined, 42, 'SR1.x', [], {}]) assert.deepEqual(tryLoad(bad), { ok:false, reason:'Save is damaged' });
  assert.deepEqual(tryLoad({ ...base, v: 2 }), { ok:false, reason:'Save is from a newer version' });
});

test('settings are preferences: bad values fall back instead of refusing the save', () => {
  const s = viaJson(serialize(busyGame()));
  s.settings = { sfx: 'yes', lastRecipe: { assembler: 'iron_plate', fabricator: 'motor', furnace: 'nope' }, focus: true };
  const r = tryLoad(s); assert.equal(r.ok, true);
  assert.deepEqual(r.game.settings, { sfx: true, lastRecipe: { fabricator: 'motor' }, focus: true });
  delete s.settings; assert.deepEqual(tryLoad(s).game.settings, { sfx: true, lastRecipe: {} });
});

test('save codes: pasted line breaks are fine, anything else invalid is refused', async () => {
  const s = serialize(busyGame()), code = await encodeSaveCode(s);
  assert.match(code, /^SR1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeSaveCode(code.slice(0, 40) + '\r\n  ' + code.slice(40)), s);
  const deflated = async (text) => 'SR1.' + Buffer.from(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url');
  for (const bad of [null, 42, code.slice(0, -8), code.replace('SR1.', 'SR2.'), await deflated('[1,2]'), await deflated('"str"'), await deflated('{"a":1}'), await deflated('{not json')])
    await assert.rejects(decodeSaveCode(bad), /Not a Steelreach save code/);
});

const bigSave = () => ({ v: 1, savedAt: 7, junk: randomBytes(400000).toString('hex') });
test('a large save encodes without blowing the stack and round trips', async () => {
  const s = bigSave(), code = await encodeSaveCode(s); assert.ok(code.length > 400000, `code length ${code.length}`);
  assert.deepEqual(await decodeSaveCode(code), s);
});

async function withLocalStorage(desc, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...desc });
  try { return await fn(); } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; }
}
const memStorage = () => ({ m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); } });

test('local store keeps a save code and survives missing, throwing or full storage', async () => {
  const mem = memStorage(), s = { v: 1, savedAt: 9, x: [1, 2] };
  await withLocalStorage({ value: mem }, async () => {
    const st = createLocalStore(); assert.equal(st.name, 'local'); assert.equal(await st.load(), null);
    await st.save(s); assert.match(mem.getItem('steelreach'), /^SR1\./); assert.deepEqual(await st.load(), s);
    mem.setItem('steelreach', 'garbage'); assert.equal(await st.load(), null);
  });
  const st = createLocalStore('k');
  assert.equal(await st.load(), null); await st.save(s); // Node has no localStorage at all
  await withLocalStorage({ get() { throw new Error('SecurityError'); } }, async () => { assert.equal(await st.load(), null); await st.save(s); });
  await withLocalStorage({ value: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('QuotaExceededError'); } } }, async () => {
    assert.equal(await st.load(), null); await st.save(s);
  });
});

// In-memory stand-in for the artifact runtime: path checks, frozen snapshots, and write logging.
function fakeClaude({ id = 'u1', db = true, user = true, get, set } = {}) {
  const docs = new Map(), log = []; let active = 0, maxActive = 0;
  const check = (p) => { for (const seg of p.split('/')) if (!/^[A-Za-z0-9_\-.~:@+]+$/.test(seg)) throw new TypeError('bad path'); };
  const doc = (path) => ({
    get: get ? () => get(path) : async () => { const d = docs.get(path); return { id: path, exists: d !== undefined, data: () => d && Object.freeze(structuredClone(d)) }; },
    set: async (data) => { active++; maxActive = Math.max(maxActive, active); log.push({ path, data }); try { if (set) await set(path, data, log.length); docs.set(path, structuredClone(data)); } finally { active--; } },
  });
  const ns = { collection: (p) => { check(p); return { doc: (n) => { check(n); return doc(`${p}/${n}`); } }; } };
  const claude = { use: async (name) => (name === 'db' ? (db ? ns : null) : name === 'user' ? (user ? { id: async () => id } : null) : null) };
  return { claude, docs, log, max: () => maxActive };
}
const waitFor = async (cond) => { for (let i = 0; i < 400 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), 'timed out waiting'); };

test('claude store resolves null whenever the account save is unavailable', async () => {
  assert.equal(globalThis.claude, undefined); assert.equal(await createClaudeStore(), null);
  assert.equal(await createClaudeStore(fakeClaude({ user: false }).claude), null);
  assert.equal(await createClaudeStore(fakeClaude({ id: null }).claude), null);
  assert.equal(await createClaudeStore(fakeClaude({ id: 'bad id' }).claude), null, 'collection() TypeError is caught');
  assert.equal(await createClaudeStore({ use: () => { throw new Error('sync'); } }), null);
  const t0 = Date.now(); assert.equal(await createClaudeStore({ use: () => new Promise(() => {}) }, 'steelreach', 30), null); assert.ok(Date.now() - t0 < 1000);
});

test('claude store saves {code, savedAt} to data/users/<id>/steelreach and loads it back', async () => {
  const f = fakeClaude(), st = await createClaudeStore(f.claude); assert.equal(st.name, 'claude');
  assert.equal(await st.load(), null, 'exists:false is no save');
  const s = viaJson(serialize(busyGame())); await st.save(s);
  const d = f.docs.get('data/users/u1/steelreach'); assert.deepEqual(Object.keys(d), ['code', 'savedAt']); assert.equal(d.savedAt, s.savedAt);
  assert.deepEqual(await st.load(), s);
  f.docs.set('data/users/u1/steelreach', { code: 'SR1.junk', savedAt: 1 }); assert.equal(await st.load(), null);
  const slow = await createClaudeStore(fakeClaude({ get: () => new Promise(() => {}) }).claude, 'steelreach', 30);
  const t0 = Date.now(); assert.equal(await slow.load(), null); assert.ok(Date.now() - t0 < 1000);
  const broken = await createClaudeStore(fakeClaude({ get: async () => { throw { code: 'not_granted', message: 'no' }; } }).claude);
  assert.equal(await broken.load(), null);
});

test('claude store writes one at a time and queues only the latest', async () => {
  const releases = [], f = fakeClaude({ set: () => new Promise(r => releases.push(r)) }), st = await createClaudeStore(f.claude);
  const ps = [1, 2, 3].map(n => st.save({ v: 1, savedAt: n }));
  await waitFor(() => releases.length === 1); releases.shift()();
  await waitFor(() => releases.length === 1); releases.shift()();
  await Promise.all(ps);
  assert.deepEqual(f.log.map(e => e.data.savedAt), [1, 3]); assert.equal(f.max(), 1);
});

test('claude store retries once on unavailable, gives up quietly otherwise, and never throws', async () => {
  let fails = 1; const f = fakeClaude({ set: async () => { if (fails-- > 0) throw { code: 'unavailable', message: 'busy' }; } });
  const st = await createClaudeStore(f.claude); await st.save({ v: 1, savedAt: 4 });
  assert.equal(f.log.length, 2); assert.equal((await st.load()).savedAt, 4);
  const always = fakeClaude({ set: async () => { throw { code: 'unavailable' }; } }), st2 = await createClaudeStore(always.claude);
  await st2.save({ v: 1, savedAt: 5 }); assert.equal(always.log.length, 2);
  const quota = fakeClaude({ set: async () => { throw { code: 'quota_exceeded' }; } }), st3 = await createClaudeStore(quota.claude);
  await st3.save({ v: 1, savedAt: 6 }); assert.equal(quota.log.length, 1);
});

test('R17: codes over 200,000 chars are split across docs, parts first, and reassembled only when every part matches', async () => {
  const f = fakeClaude(), st = await createClaudeStore(f.claude), s = bigSave(); await st.save(s);
  const main = f.docs.get('data/users/u1/steelreach'), n = main.parts;
  assert.ok(n >= 2, `parts ${n}`); assert.equal(main.savedAt, 7); assert.equal(main.code.length, 200000);
  assert.deepEqual(f.log.map(e => e.path.split('/').pop()), [...Array.from({ length: n - 1 }, (_, i) => `steelreach-p${i + 1}`), 'steelreach']);
  for (const e of f.log) assert.ok(JSON.stringify(e.data).length <= 256 * 1024);
  assert.deepEqual(await st.load(), s);
  f.docs.set('data/users/u1/steelreach-p1', { ...f.docs.get('data/users/u1/steelreach-p1'), savedAt: 8 }); assert.equal(await st.load(), null, 'part from another save');
  f.docs.delete('data/users/u1/steelreach-p1'); assert.equal(await st.load(), null, 'missing part');
  const small = { v: 1, savedAt: 9 }; await st.save(small); assert.deepEqual(await st.load(), small, 'a small save after a split one');
});

test('loadBest takes the newest save, ignores broken answers, and treats timeoutMs <= 0 as no limit', async () => {
  const at = (savedAt, ms = 0) => ({ load: () => new Promise(r => setTimeout(r, ms, { v: 1, savedAt })) });
  assert.equal((await loadBest([at(3), at(9), at(5)])).savedAt, 9);
  assert.equal((await loadBest([at(1), at(4, 40)], 0)).savedAt, 4, 'a 0 ms limit must not drop a slower store');
  assert.equal((await loadBest([at(1), at(4, 40)], -1)).savedAt, 4);
  const weird = [{ load: () => { throw new Error('sync'); } }, { load: async () => 'SR1.x' }, { load: async () => [1] }, null, at(2)];
  assert.equal((await loadBest(weird, 100)).savedAt, 2);
  assert.equal(await loadBest([]), null); assert.equal(await loadBest([{ load: async () => null }]), null);
});

test('saver: due-based autosave, immediate flush, savedAt from now()', async () => {
  const saved = [], store = { save: async (o) => { saved.push(o); } }; let t = 1000;
  const saver = createSaver({ stores: [store], snapshot: () => ({ v: 1 }), now: () => t });
  assert.equal(saver.maybeSave(), saver.maybeSave(), 'not-due path allocates nothing');
  t = 10999; await saver.maybeSave(); assert.equal(saved.length, 0);
  t = 11000; await saver.maybeSave(); assert.equal(saved.length, 1); assert.equal(saved[0].savedAt, 11000);
  t = 12000; await saver.maybeSave(); assert.equal(saved.length, 1);
  await saver.flush(); assert.equal(saved.length, 2); assert.equal(saved[1].savedAt, 12000);
  t = 21999; await saver.maybeSave(); assert.equal(saved.length, 2, 'flush restarts the interval');
  t = 22000; await saver.maybeSave(); assert.equal(saved.length, 3);
});

test('saver: writes to a store never overlap, only the latest waits, and a hung store does not block the others', async () => {
  let k = 0, active = 0, max = 0; const local = [], hung = [];
  const slow = { save: async (o) => { active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 20)); local.push(o.n); active--; } };
  const stuck = { save: (o) => { hung.push(o.n); return new Promise(() => {}); } };
  const saver = createSaver({ stores: [stuck, slow], snapshot: () => ({ v: 1, n: k++ }), intervalMs: 10, now: () => 0 });
  saver.flush(); saver.flush(); saver.flush();
  await waitFor(() => local.length === 2);
  assert.deepEqual(local, [0, 2]); assert.equal(max, 1); assert.deepEqual(hung, [0]);
  saver.flush(); await waitFor(() => local.length === 3); assert.deepEqual(local, [0, 2, 3]);
});

test('saver: a snapshot that throws rejects the promise, never the frame loop, and saving carries on', async () => {
  const saved = []; let fail = true, t = 0;
  const saver = createSaver({ stores: [{ save: async (o) => { saved.push(o); } }], snapshot: () => { if (fail) throw new Error('boom'); return { v: 1 }; }, intervalMs: 10, now: () => t });
  t = 10; const p = saver.maybeSave(); assert.ok(p instanceof Promise); await assert.rejects(p, /boom/);
  fail = false; t = 20; await saver.maybeSave(); assert.equal(saved.length, 1);
});
