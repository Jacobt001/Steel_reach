import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  bootLocal, createSession, hasProgress, randomSeed, freshGame, SAVE_KEY, BACKUP_KEY, BACKUP_KEY_2, ACCOUNT_BACKUP_KEY, ACCOUNT_BACKUP_KEY_2, RETRY_MS, listBackups,
} from '../src/session.js';
import { createGame, addEnt } from '../src/game/state.js';
import { doAction } from '../src/game/undo.js';
import { serialize, tryLoad } from '../src/save/serialize.js';
import { encodeSaveCode, decodeSaveCode } from '../src/save/code.js';
import { createLocalStore } from '../src/save/stores.js';

// One fake localStorage per test, read through the global the real local store uses. Each test
// file runs in its own process, so this never leaks into other files.
let ST = null;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => ST });
function fakeStorage({ failKeys = [] } = {}) {
  const m = new Map(), log = [];
  return ST = {
    m, log,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failKeys.includes(k)) throw new Error('QuotaExceededError'); log.push(k); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

const drain = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
function fakeTimers() {
  const q = [];
  return {
    q,
    setTimer: (fn, ms) => { q.push({ fn, ms }); return q.length; },
    async fire() { const t = q.shift(); t.fn(); await drain(); return t.ms; },
  };
}
// replies: what each load() call answers: a save object, null (no save) or 'timeout'.
function fakeAccount(replies) {
  const s = {
    name: 'claude', answered: false, writes: [], loads: 0,
    async load() {
      const r = replies[Math.min(s.loads++, replies.length - 1)];
      if (r === 'timeout') return null; // a timeout is not an answer: `answered` stays false
      s.answered = true;
      return r ?? null;
    },
    async save(o) { s.writes.push(o); },
  };
  return s;
}
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

// A small factory so a save has progress: tier 2, three belts carrying items.
function factory(seed = 7) {
  const g = createGame(seed);
  g.tier = 2;
  for (let i = 0; i < 3; i++) addEnt(g, 'belt', 20 + i, 30, { dir: 1 }).items.push({ item: 'iron_ore', pos: 0.5 });
  g.stock.iron_plate = 12;
  return g;
}
const saveOf = (g, savedAt) => ({ ...serialize(g), savedAt });

function hooks() {
  const h = { swaps: [], toasts: [], choices: [] };
  h.hooks = { swap: (g) => h.swaps.push(g), toast: (t) => h.toasts.push(t), choice: (c) => h.choices.push(c) };
  return h;
}
let clock = 1000;
const now = () => clock;

// Boot the way main.js does: the local half first, then a session over its result.
async function start({ account = null, timers = fakeTimers(), rand = Math.random, extra = {} } = {}) {
  const local = createLocalStore();
  const b = await bootLocal({ local, storage: ST, rand });
  const h = hooks();
  const s = createSession({
    game: b.game, savedAt: b.savedAt, local, localOk: b.localOk, account, storage: ST, hooks: h.hooks,
    setTimer: timers.setTimer, rand, now, ...extra,
  });
  await drain();
  return { b, s, h, local, timers };
}
const localSave = async () => decodeSaveCode(ST.getItem(SAVE_KEY));
// Compression runs off-thread, so how many turns a write takes varies; poll instead of guessing.
async function localSeedIs(seed) {
  for (let i = 0; i < 200; i++) {
    const code = ST.getItem(SAVE_KEY);
    if (code && (await decodeSaveCode(code).catch(() => null))?.seed === seed) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

test('seeds are safe integers that a save round-trips (ruling 6)', () => {
  for (const r of [0, 0.5, 0.999999999999]) {
    const s = randomSeed(() => r);
    assert.ok(Number.isSafeInteger(s) && s >= 0 && s < 2 ** 31, String(s));
  }
  const g = freshGame(() => 0.999999999999);
  assert.equal(tryLoad(serialize(g)).ok, true);
});

test('progress: a higher tier, any building, anything delivered, stored or researched', () => {
  const base = serialize(createGame(3));
  assert.equal(hasProgress(base), false);
  assert.equal(hasProgress({ ...base, tier: 2 }), true);
  assert.equal(hasProgress(serialize(factory())), true);
  assert.equal(hasProgress({ ...base, prog: { iron_plate: 3 } }), true);
  assert.equal(hasProgress({ ...base, stock: { iron_plate: 1 } }), true);
  assert.equal(hasProgress({ ...base, research: { belt1: true } }), true);
  assert.equal(hasProgress(null), false);
  assert.equal(hasProgress({ v: 99 }), false);
});

test('no save: a fresh game with the first-run hint, no Welcome', async () => {
  fakeStorage();
  const { b } = await start({ rand: () => 0.25 });
  assert.equal(b.welcome, false);
  assert.equal(b.notice, null);
  assert.equal(b.game.seed, randomSeed(() => 0.25));
  assert.equal(b.game.ents.size, 1); // only the Hub
  assert.equal(b.savedAt, -Infinity);
});

test('a save with progress opens on Welcome with that factory; the local load is awaited, never raced (R6)', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(), 500)));
  // A local store that answers late still wins: boot never races it against a timer.
  const real = createLocalStore();
  const slow = { name: 'local', get answered() { return real.answered; }, load: () => new Promise((r) => setTimeout(() => r(real.load()), 30)), save: real.save };
  const b = await bootLocal({ local: slow, storage: ST });
  assert.equal(b.welcome, true);
  assert.equal(b.savedAt, 500);
  assert.equal(b.game.seed, 7);
  assert.equal(b.game.ents.size, 4);
  assert.equal(b.game.tier, 2);
});

test('a save without progress starts a new seed but keeps the sound setting', async () => {
  fakeStorage();
  const old = createGame(3);
  old.settings.sfx = false; old.settings.powerOverlay = true; old.settings.hintDone = true;
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(old, 500)));
  const { b } = await start({ rand: () => 0.5 });
  assert.equal(b.welcome, false);
  assert.equal(b.game.seed, randomSeed(() => 0.5));
  assert.equal(b.game.settings.sfx, false);
  assert.equal(b.game.settings.powerOverlay, true);
  assert.equal(b.game.settings.hintDone, undefined);
});

test('R7: a newer-version save is copied to the backup key before any autosave, then a fresh game starts', async () => {
  fakeStorage();
  const raw = await encodeSaveCode({ ...saveOf(factory(), 500), v: 2 });
  ST.setItem(SAVE_KEY, raw);
  ST.log.length = 0;
  const { b, s } = await start();
  assert.equal(b.welcome, false);
  assert.equal(b.notice, 'Save is from a newer version — kept a backup');
  assert.equal(b.game.ents.size, 1);
  assert.deepEqual(ST.log, [BACKUP_KEY], 'only the backup is written during boot');
  assert.equal(ST.getItem(BACKUP_KEY), raw, 'the backup is the exact code');
  await s.flush();
  assert.deepEqual(ST.log, [BACKUP_KEY, SAVE_KEY], 'the autosave comes after the backup');
  assert.equal(ST.getItem(BACKUP_KEY), raw, 'and never touches it');
});

test('R7: a damaged save and an undecodable code are both backed up', async () => {
  fakeStorage();
  const raw = await encodeSaveCode({ ...saveOf(factory(), 500), seed: 1.5 });
  ST.setItem(SAVE_KEY, raw);
  let { b } = await start();
  assert.equal(b.notice, 'Save is damaged — kept a backup');
  assert.equal(ST.getItem(BACKUP_KEY), raw);
  fakeStorage();
  ST.setItem(SAVE_KEY, 'SR1.this-is-not-deflate');
  ({ b } = await start());
  assert.equal(b.notice, 'Save is damaged — kept a backup');
  assert.equal(ST.getItem(BACKUP_KEY), 'SR1.this-is-not-deflate');
});

test('R7: if the backup cannot be written, the save it protects is never autosaved over', async () => {
  fakeStorage({ failKeys: [BACKUP_KEY] });
  const raw = await encodeSaveCode({ ...saveOf(factory(), 500), v: 2 });
  ST.setItem(SAVE_KEY, raw);
  const { b, s } = await start();
  assert.equal(b.localOk, false);
  assert.match(b.notice, /^Save is from a newer version — /);
  assert.notEqual(b.notice, 'Save is from a newer version — kept a backup');
  await s.flush();
  s.newGame();
  await s.flush();
  assert.equal(ST.getItem(SAVE_KEY), raw, 'still the unloadable save');
});

test('home target (no account): the local store saves; frame() never throws or awaits a hung save', async () => {
  fakeStorage();
  const { s } = await start();
  await s.flush();
  assert.equal((await localSave()).seed, s.game.seed);
  // A snapshot that throws only rejects the save; frame() returns normally.
  const bad = createSession({ game: { ...s.game, ents: null }, savedAt: -Infinity, local: createLocalStore(), storage: ST, hooks: hooks().hooks, now: () => (clock += 20000) });
  assert.doesNotThrow(() => bad.frame());
  await drain();
});

test('account answers with an older save: nothing changes, and the account is written from then on', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const acct = fakeAccount([saveOf(factory(8), 400)]);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone;
  assert.equal(h.swaps.length, 0);
  assert.equal(s.game.seed, 7);
  await s.flush();
  assert.equal(acct.writes.length, 1);
  assert.equal(acct.writes[0].seed, 7);
});

test('account newer and nothing built since opening: load it and say so', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const acct = fakeAccount([saveOf(factory(8), 900)]);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone;
  assert.equal(h.swaps.length, 1);
  assert.equal(s.game.seed, 8);
  assert.equal(h.swaps[0], s.game);
  assert.deepEqual(h.toasts, ['Progress restored from your account']);
  await s.flush();
  assert.equal(acct.writes.at(-1).seed, 8);
  assert.equal((await localSave()).seed, 8);
});

test('account newer but the player has built: ask; the account is not written until they choose', async () => {
  for (const pick of ['load', 'keep']) {
    fakeStorage();
    ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
    let answer;
    const acct = fakeAccount([saveOf(factory(8), 900)]);
    acct.load = () => new Promise((r) => { answer = () => { acct.answered = true; r(saveOf(factory(8), 900)); }; });
    const { s, h } = await start({ account: Promise.resolve(acct) });
    doAction(s.game, () => addEnt(s.game, 'belt', 40, 40, { dir: 1 }));
    s.frame();
    answer();
    await s.accountDone;
    assert.equal(h.swaps.length, 0, 'nothing dropped silently');
    assert.equal(h.choices.length, 1);
    assert.equal(h.choices[0].game.seed, 8);
    await s.flush();
    assert.equal(acct.writes.length, 0, 'account untouched while the choice is open');
    assert.equal((await localSave()).seed, 7, 'the phone keeps saving the current game');
    assert.equal((await decodeSaveCode(ST.getItem(ACCOUNT_BACKUP_KEY))).seed, 8, 'insurance copy if they never answer');
    await h.choices[0][pick]();
    await s.flush();
    assert.equal(s.game.seed, pick === 'load' ? 8 : 7, pick);
    assert.equal(acct.writes.at(-1).seed, s.game.seed, pick);
  }
});

test('account newer but unloadable: kept as a backup before the account can be written (R7)', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const acct = fakeAccount([{ ...saveOf(factory(8), 900), v: 2 }]);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone;
  assert.equal(h.swaps.length, 0);
  assert.deepEqual(h.toasts, ['Account save is from a newer version — kept a backup']);
  const kept = await decodeSaveCode(ST.getItem(ACCOUNT_BACKUP_KEY));
  assert.equal(kept.v, 2);
  await s.flush();
  assert.equal(acct.writes.length, 1);
});

test('the local save is unloadable: fall back to the account save, even an older one (ruling 3)', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode({ ...saveOf(factory(7), 900), v: 2 }));
  const acct = fakeAccount([saveOf(factory(8), 400)]);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone;
  assert.equal(s.game.seed, 8);
  assert.deepEqual(h.toasts, ['Progress restored from your account']);
});

test('R21: an account load that times out is retried with backoff, and the account is never written until it answers', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const acct = fakeAccount(['timeout', 'timeout', 'timeout', 'timeout', 'timeout', 'timeout', saveOf(factory(8), 400)]);
  const timers = fakeTimers();
  const { s } = await start({ account: Promise.resolve(acct), timers });
  const delays = [];
  for (let i = 0; i < 6; i++) {
    await s.flush();
    assert.equal(acct.writes.length, 0, `no account write before it answers (retry ${i})`);
    assert.equal(timers.q.length, 1);
    delays.push(await timers.fire());
  }
  assert.deepEqual(delays, [5000, 15000, 30000, 60000, 60000, 60000]);
  assert.deepEqual(RETRY_MS, [5000, 15000, 30000, 60000]);
  await s.accountDone;
  assert.equal(timers.q.length, 0, 'retries stop once it answers');
  await s.flush();
  assert.equal(acct.writes.length, 1);
  assert.equal(acct.writes[0].seed, 7);
});

test('no account runtime (Home Screen, signed out): only the phone saves', async () => {
  fakeStorage();
  const { s, h } = await start({ account: Promise.resolve(null) });
  await s.accountDone;
  await s.flush();
  assert.equal(h.swaps.length + h.toasts.length + h.choices.length, 0);
  assert.equal((await localSave()).seed, s.game.seed);
});

test('New game keeps sound and power overlay, drops per-game hints and recipes (ruling 10), and saves at once', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const { s, h } = await start({ rand: seq(0.1, 0.2, 0.3) });
  const old = s.game;
  Object.assign(old.settings, { sfx: false, powerOverlay: true, hintDone: true, seenTools: { belt: true }, lastRecipe: { assembler: 'gear' } });
  s.newGame();
  assert.notEqual(s.game, old);
  assert.equal(h.swaps.at(-1), s.game);
  assert.ok(Number.isSafeInteger(s.game.seed));
  assert.equal(s.game.ents.size, 1);
  assert.deepEqual(s.game.settings, { sfx: false, lastRecipe: {}, powerOverlay: true });
  assert.ok(await localSeedIs(s.game.seed), 'saved at once');
});

test('Load save code: a bad paste or a newer save keeps the current game; a good one replaces it (ruling 11)', async () => {
  fakeStorage();
  const { s, h } = await start();
  const cur = s.game;
  await assert.rejects(s.loadCode('hello'), { message: 'Not a Steelreach save code' });
  const newer = await encodeSaveCode({ ...saveOf(factory(9), 1), v: 2 });
  assert.deepEqual(await s.loadCode(newer), { ok: false, reason: 'Save is from a newer version' });
  assert.equal(s.game, cur);
  assert.equal(h.swaps.length, 0);
  const good = await encodeSaveCode(saveOf(factory(9), 1));
  assert.deepEqual(await s.loadCode(`  ${good.slice(0, 20)}\n${good.slice(20)}  `), { ok: true });
  assert.equal(s.game.seed, 9);
  assert.equal(s.game.ents.size, 4);
  assert.equal(h.swaps.at(-1), s.game);
  assert.ok(await localSeedIs(9), 'saved at once');
});

test('copy: ClipboardItem write starts inside the tap, with a promise of the code (ruling 17)', async () => {
  fakeStorage();
  let items = null;
  const clipboard = { write: (x) => { items = x; return Promise.resolve(); }, writeText: () => assert.fail('write is preferred') };
  class Item { constructor(o) { this.o = o; } }
  const { s } = await start({ extra: { clipboard, ClipboardItem: Item, Blob } });
  const p = s.copyCode();
  assert.ok(items, 'clipboard.write was called synchronously');
  await p;
  const blob = await items[0].o['text/plain'];
  assert.equal(blob.type, 'text/plain');
  const obj = await decodeSaveCode(await blob.text());
  assert.equal(obj.seed, s.game.seed);
});

test('R30: Copy writes text synchronously once the Menu has prepared the code; ClipboardItem when not ready; none rejects', async () => {
  fakeStorage();
  const texts = []; let items = null;
  const clipboard = { writeText: (t) => { texts.push(t); return Promise.resolve(); }, write: (x) => { items = x; return Promise.resolve(); } };
  class Item { constructor(o) { this.o = o; } }
  const { s } = await start({ extra: { clipboard, ClipboardItem: Item, Blob } });
  await s.copyCode(); // nothing prepared yet: the ClipboardItem path
  assert.ok(items && texts.length === 0);
  await drain(); // the encode that copyCode started has finished
  s.prepareCode(); // (the Menu does this when it opens)
  await drain();
  const p = s.copyCode();
  assert.equal(texts.length, 1, 'writeText was called synchronously inside the tap');
  await p;
  assert.equal((await decodeSaveCode(texts[0])).seed, s.game.seed);
  // Without ClipboardItem and nothing ready: it encodes, then writes; with no clipboard it rejects.
  const { s: s2 } = await start({ extra: { clipboard: { writeText: clipboard.writeText }, ClipboardItem: undefined } });
  texts.length = 0; await s2.copyCode(); assert.equal(texts.length, 1);
  const none = createSession({ game: s.game, savedAt: -Infinity, local: createLocalStore(), storage: ST, hooks: hooks().hooks, clipboard: undefined });
  await assert.rejects(none.copyCode());
});

test('an older account save that cannot be loaded is backed up and never overwritten (v2, damaged)', async () => {
  for (const bad of [{ v: 2 }, { tier: 'x', ents: 'nope' }]) {
    fakeStorage();
    ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
    const acct = fakeAccount([{ ...saveOf(factory(8), 100), ...bad }]); // older than the phone save
    const { s, h } = await start({ account: Promise.resolve(acct) });
    await s.accountDone;
    assert.equal(h.swaps.length, 0);
    assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0], /^Account save .* — kept a backup$/);
    const kept = await decodeSaveCode(ST.getItem(ACCOUNT_BACKUP_KEY));
    assert.equal(kept.seed, 8);
    await s.flush();
    assert.equal(acct.writes.length, 1, 'written only after the backup stuck');
  }
});

test('an unloadable account save with no backup possible is never overwritten', async () => {
  fakeStorage({ failKeys: [ACCOUNT_BACKUP_KEY, ACCOUNT_BACKUP_KEY_2] });
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const acct = fakeAccount([{ ...saveOf(factory(8), 100), v: 2 }]);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone;
  await s.flush();
  assert.equal(acct.writes.length, 0);
  assert.match(h.toasts[0], /account saving paused/);
});

test('Load account save backs up the replaced game first; Keep does not touch the backups', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  let answer;
  const acct = fakeAccount([saveOf(factory(8), 900)]);
  acct.load = () => new Promise((r) => { answer = () => { acct.answered = true; r(saveOf(factory(8), 900)); }; });
  const { s, h } = await start({ account: Promise.resolve(acct) });
  doAction(s.game, () => addEnt(s.game, 'belt', 40, 40, { dir: 1 }));
  s.frame();
  answer();
  await s.accountDone;
  assert.equal(ST.getItem(BACKUP_KEY), null);
  await h.choices[0].load();
  const kept = await decodeSaveCode(ST.getItem(BACKUP_KEY));
  assert.equal(kept.seed, 7);
  assert.ok(kept.ents.some((e) => e[1] === 40 && e[2] === 40), 'includes the belt built since opening');
  assert.equal(s.game.seed, 8);
});

test('backups keep two slots, never overwrite a different code, never rewrite an identical one', async () => {
  fakeStorage();
  const codes = [];
  for (const seed of [1, 2, 3]) codes.push(await encodeSaveCode(saveOf(factory(seed), 100 + seed)));
  // Three newer-version phone saves in a row, each found at boot.
  for (const [i, code] of codes.entries()) {
    ST.setItem(SAVE_KEY, await encodeSaveCode({ ...saveOf(factory(i + 1), 100 + i), v: 2 }));
    ST.log.length = 0;
    await bootLocal({ local: createLocalStore(), storage: ST });
    if (i === 0) assert.deepEqual(ST.log, [BACKUP_KEY]);
    if (i === 1) assert.deepEqual(ST.log, [BACKUP_KEY_2, BACKUP_KEY], 'the first code moves to slot 2 before slot 1 is reused');
    if (i === 2) assert.deepEqual(ST.log, [BACKUP_KEY_2, BACKUP_KEY], 'full: the older is rotated out, the newest leads');
  }
  assert.equal((await decodeSaveCode(ST.getItem(BACKUP_KEY))).seed, 3);
  assert.equal((await decodeSaveCode(ST.getItem(BACKUP_KEY_2))).seed, 2, 'seed 1 is rotated out');
  ST.log.length = 0;
  await bootLocal({ local: createLocalStore(), storage: ST }); // same seed-3 code again
  assert.deepEqual(ST.log, [], 'an identical code is never written twice');
  assert.deepEqual(listBackups(ST).map((b) => b.key), [BACKUP_KEY, BACKUP_KEY_2]);
});

// ---- final review fixes

// One account doc shared by every page: what a store loads is whatever the last save wrote.
function sharedAccount(doc) {
  const s = {
    name: 'claude', answered: false, writtenAt: -Infinity, writes: [], health: { okAt: null, error: null }, hold: null,
    async load() {
      s.answered = false;
      if (s.hold) await new Promise((r) => { s.release = r; });
      s.answered = true;
      return doc.save;
    },
    async save(o) { doc.save = o; s.writes.push(o); s.writtenAt = o.savedAt; },
  };
  return s;
}
const tierOf = (g) => g.tier;

test('C1: A saves tier 2 and is backgrounded, B reaches tier 5; A resuming must not overwrite the account, and loads tier 5 (backing up its own game)', async () => {
  fakeStorage();
  const doc = { save: null };
  const gA = factory(7); gA.tier = 2;
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(gA, 500)));
  const acct = sharedAccount(doc);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone;
  clock = 1000; await s.flush(); // A: account now holds tier 2 at 1000
  assert.equal(doc.save.tier, 2);
  // B (another surface) restores, plays on and saves tier 5.
  const gB = factory(7); gB.tier = 5; doc.save = saveOf(gB, 5000);
  const writesBefore = acct.writes.length;
  // A comes back; its account is re-read before anything may be written.
  acct.hold = true;
  const p = s.resume();
  clock = 20000; s.frame(); await s.flush(); await drain();
  assert.equal(acct.writes.length, writesBefore, 'no account write while the re-read is pending');
  acct.hold = false; acct.release(); await p; await drain();
  assert.equal(tierOf(s.game), 5, 'the newer save was loaded');
  assert.ok(h.toasts.includes('Progress restored from your account'));
  assert.equal(tierOf(await decodeSaveCode(ST.getItem(BACKUP_KEY))), 2, "A's own game was kept before the swap");
  await s.flush();
  assert.equal(doc.save.tier, 5, 'the account was never taken back to tier 2');
  // B reopens: still tier 5.
  assert.equal(acct.writes.at(-1).tier, 5);
});

test('C1: a page that built something since resuming is asked, not overwritten; an unchanged account just reopens the gate', async () => {
  fakeStorage();
  const doc = { save: null };
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const acct = sharedAccount(doc);
  const { s, h } = await start({ account: Promise.resolve(acct) });
  await s.accountDone; clock = 1000; await s.flush();
  // Nothing new elsewhere: resume reads the account, finds nothing newer, and saving carries on.
  await s.resume(); await s.flush();
  assert.equal(h.swaps.length, 0); assert.equal(h.choices.length, 0);
  assert.equal(acct.writes.at(-1).seed, 7);
  // Newer elsewhere, and the player acts right after coming back.
  const gB = factory(7); gB.tier = 6; doc.save = saveOf(gB, 9000);
  acct.hold = true; const p = s.resume();
  doAction(s.game, () => addEnt(s.game, 'belt', 50, 50, { dir: 1 })); s.frame();
  acct.hold = false; acct.release(); await p; await drain();
  assert.equal(h.choices.length, 1); assert.equal(h.choices[0].game.tier, 6);
  assert.equal(s.game.tier, 2);
  const n = acct.writes.length; await s.flush(); assert.equal(acct.writes.length, n, 'account untouched until they choose');
});

test('I4: New game, Load save code and Load this backup keep the game they replace', async () => {
  fakeStorage();
  ST.setItem(SAVE_KEY, await encodeSaveCode(saveOf(factory(7), 500)));
  const { s } = await start({ rand: seq(0.1, 0.2, 0.3) });
  await s.newGame();
  assert.equal((await decodeSaveCode(ST.getItem(BACKUP_KEY))).seed, 7, 'New game backs up the old factory');
  // The new world has no progress: loading a code over it keeps nothing worth a slot.
  const code9 = await encodeSaveCode(saveOf(factory(9), 1));
  await s.loadCode(code9);
  assert.equal(s.game.seed, 9);
  const code11 = await encodeSaveCode(saveOf(factory(11), 2));
  await s.loadCode(code11);
  assert.equal((await decodeSaveCode(ST.getItem(BACKUP_KEY))).seed, 9, 'Load code backs up the factory it replaces');
  assert.equal((await decodeSaveCode(ST.getItem(BACKUP_KEY_2))).seed, 7);
  assert.equal(s.game.seed, 11);
});

test('I1: stores record lastOk and the last error; a hung account write times out and frees the queue', async () => {
  const { createClaudeStore, connectClaudeStore } = await import('../src/save/stores.js');
  // local: a throwing setItem and missing storage both show up as errors, then recover.
  fakeStorage({ failKeys: ['k'] });
  let t = 100; const local = createLocalStore('k', () => t);
  await local.save(saveOf(factory(1), 1));
  assert.equal(local.health.okAt, null); assert.equal(local.health.error, 'Phone storage is full');
  ST.setItem = (k, v) => ST.m.set(k, String(v)); t = 200;
  await local.save(saveOf(factory(1), 2));
  assert.deepEqual({ ...local.health }, { okAt: 200, error: null });
  const real = ST; ST = null; await local.save(saveOf(factory(1), 3)); ST = real;
  assert.equal(local.health.error, 'Phone storage is unavailable');
  // account: set() that never resolves.
  let calls = 0, hang = true; const sets = [];
  const doc = { async set(d) { calls++; sets.push(d); if (hang) await new Promise(() => {}); }, async get() { return { exists: false }; } };
  const claude = { use: async (n) => (n === 'db' ? { collection: () => ({ doc: () => doc }) } : { id: async () => 'u1' }) };
  const store = await createClaudeStore(claude, 'steelreach', 1000, { now: () => t, writeTimeoutMs: 30 });
  await store.save(saveOf(factory(1), 5));
  assert.match(store.health.error, /timed out/);
  hang = false; t = 300;
  await store.save(saveOf(factory(1), 6)); // the queue is free again
  assert.equal(calls, 2); assert.equal(store.health.okAt, 300); assert.equal(store.health.error, null);
  assert.equal(store.writtenAt, 6);
  // connect retries with backoff until the runtime answers, and gives up at once with no runtime.
  let tries = 0; const waits = [];
  const flaky = { use: async (n) => { if (n === 'db' && ++tries < 3) return null; return n === 'db' ? { collection: () => ({ doc: () => doc }) } : { id: async () => 'u1' }; } };
  const got = await connectClaudeStore(flaky, { wait: async (ms) => { waits.push(ms); }, timeoutMs: 1000 });
  assert.ok(got); assert.deepEqual(waits, [5000, 15000]);
  assert.equal(await connectClaudeStore(undefined, { wait: async () => assert.fail('no retry') }), null);
});

test('I1: session.health() reports each store and goes stale after 30 s with no save (the chip)', async () => {
  fakeStorage();
  let t = 1000; const clk = () => t;
  const local = createLocalStore('steelreach', clk);
  const acct = sharedAccount({ save: null });
  const b = await bootLocal({ local, storage: ST });
  const s = createSession({ game: b.game, savedAt: b.savedAt, local, localOk: b.localOk, account: Promise.resolve(acct), storage: ST, hooks: hooks().hooks, now: clk });
  await s.accountDone;
  let hl = s.health();
  assert.deepEqual(hl.stores.map((x) => x.key), ['phone', 'account']); assert.equal(hl.stale, false);
  t = 2000; await s.flush();
  hl = s.health();
  assert.equal(hl.stores[0].okAt, 2000); assert.equal(hl.stores[0].error, null);
  t = 2000 + 29000; assert.equal(s.health().stale, false);
  t = 2000 + 30000; assert.equal(s.health().stale, true);
  // an error is surfaced as text
  ST.setItem = () => { throw new Error('QuotaExceededError'); };
  await s.flush(); assert.equal(s.health().stores[0].error, 'Phone storage is full');
});
