// Which game is open, and where it is saved. Every rule here guards the brief's anti-goal "losing
// progress": a save that can't be loaded is copied aside before anything may write over it (R7),
// a store is only written once boot has read it (R21), and a newer account save never silently
// replaces what the player has built since opening, nor is it silently dropped.
// DOM-free: main.js passes in localStorage, the clipboard, timers and the UI hooks.
import { createGame } from './game/state.js';
import { serialize, tryLoad } from './save/serialize.js';
import { encodeSaveCode, decodeSaveCode } from './save/code.js';
import { createSaver } from './save/stores.js';
import { BAL } from './config.js';

export const SAVE_KEY = 'steelreach';           // createLocalStore's default key
export const BACKUP_KEY = 'steelreach-backup';
export const BACKUP_KEY_2 = 'steelreach-backup-2';
// Its own keys, so an account copy can never overwrite a backup of the phone's save.
export const ACCOUNT_BACKUP_KEY = 'steelreach-backup-account';
export const ACCOUNT_BACKUP_KEY_2 = 'steelreach-backup-account-2';
// Two slots per kind, newest first: a second backup never replaces a different code in place.
const SLOTS = { local: [BACKUP_KEY, BACKUP_KEY_2], account: [ACCOUNT_BACKUP_KEY, ACCOUNT_BACKUP_KEY_2] };
// Account load retries (R21): soon at first, then once a minute for as long as it takes.
export const RETRY_MS = [5000, 15000, 30000, 60000];
// Nothing saved for this long: the warning chip appears (I1).
export const STALE_MS = 30000;

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const stamp = (o) => (Number.isFinite(o?.savedAt) ? o.savedAt : -Infinity);
const anyPositive = (o) => isObj(o) && Object.values(o).some((n) => n > 0);

// deserialize() demands a safe integer seed (ruling 6); 31 bits also suits mulberry32.
export const randomSeed = (rand = Math.random) => (rand() * 2 ** 31) >>> 0;

// Worth a Continue / New game choice. Wider than "tier > 1 or any building": items already
// delivered, stored or spent on research also count, so a player who cleared the map to rebuild
// doesn't get a new world on the next open.
export function hasProgress(o) {
  return isObj(o) && (o.tier > 1 || (Array.isArray(o.ents) && o.ents.length > 0) || anyPositive(o.prog)
    || anyPositive(o.stock) || (isObj(o.research) && Object.values(o.research).some((v) => v === true)));
}

// Settings live per game (ruling 10): sound and the power overlay are the player's preferences
// and carry over; hints, seen tools and remembered recipes belong to the old factory.
export function freshGame(rand = Math.random, from = null) {
  const g = createGame(randomSeed(rand));
  if (from) {
    g.settings.sfx = from.settings.sfx;
    if (from.settings.powerOverlay !== undefined) g.settings.powerOverlay = from.settings.powerOverlay;
  }
  return g;
}

const readRaw = (storage, key) => { try { const v = storage?.getItem(key); return typeof v === 'string' && v ? v : null; } catch { return null; } };
// True only if the code is really stored. A different code already in slot 1 is moved to slot 2
// first; only when both slots are full is the older code rotated out. Without a stored copy, the
// original must not be saved over, hence the boolean.
function writeBackup(storage, kind, code) {
  if (!storage || typeof code !== 'string' || !code) return false;
  const [k1, k2] = SLOTS[kind];
  const a = readRaw(storage, k1), b = readRaw(storage, k2);
  if (a === code || b === code) return true;
  try {
    if (a === null) storage.setItem(k1, code);
    // Slot 1 is always the newest: its code moves to slot 2 (whose older code, if any, is the
    // one rotated out) before anything is written over it.
    else { storage.setItem(k2, a); storage.setItem(k1, code); }
    return true;
  } catch { return false; }
}

// Every stored backup, newest first, for the Menu's Recover backup.
export function listBackups(storage) {
  const out = [];
  for (const [kind, label] of [['local', 'Phone save backup'], ['account', 'Account save backup']]) {
    SLOTS[kind].forEach((k, i) => { const code = readRaw(storage, k); if (code) out.push({ key: k, label: `${label} ${i + 1}`, code }); });
  }
  return out;
}

// Boot's local half: picks the game the page opens with. The local load is awaited directly, never
// raced against a timer (R6): localStorage answers at once, and a lost race would drop the save.
export async function bootLocal({ local, storage, rand = Math.random, key = SAVE_KEY }) {
  let obj = null;
  try { obj = await local.load(); } catch { obj = null; }
  const raw = readRaw(storage, key);
  const fresh = (notice = null, localOk = true) => ({ game: freshGame(rand), savedAt: -Infinity, welcome: false, notice, localOk });
  if (!isObj(obj)) {
    if (!raw) return fresh();
    // Something is stored but won't decode: the local store reports that as "no save", and the
    // first autosave would overwrite it, so it is copied aside first (R7).
    const kept = writeBackup(storage, 'local', raw);
    return fresh(`Save is damaged — ${kept ? 'kept a backup' : 'saving paused'}`, kept);
  }
  const r = tryLoad(obj);
  if (!r.ok) {
    const code = raw ?? await encodeSaveCode(obj).catch(() => null);
    const kept = writeBackup(storage, 'local', code);
    return fresh(`${r.reason} — ${kept ? 'kept a backup' : 'saving paused'}`, kept);
  }
  if (!hasProgress(obj)) return { game: freshGame(rand, r.game), savedAt: -Infinity, welcome: false, notice: null, localOk: true };
  return { game: r.game, savedAt: stamp(obj), welcome: true, notice: null, localOk: true };
}

// hooks: swap(game) after the open game changes; toast(text); choice({game, load(), keep()}) when
// the account holds a newer save than one the player has already built on.
export function createSession({
  game, savedAt = -Infinity, local, localOk = true, account = null, storage = null, hooks = {},
  setTimer = setTimeout, rand = Math.random, now = Date.now,
  clipboard = globalThis.navigator?.clipboard, ClipboardItem: Item = globalThis.ClipboardItem, Blob: B = globalThis.Blob,
}) {
  let cur = game;
  let curSavedAt = savedAt; // savedAt of the save the open game came from; -Infinity for a new world
  let touched = false;      // placed, erased, started over or loaded a code since opening
  let acct = null, accountOpen = false;
  // savedAt of the newest account save this page has loaded or written. A later read that shows
  // something newer was written by another page or device (C1).
  let acctKnown = -Infinity;
  let bootSettled = false;  // the first account read has been settled; resume() waits for it
  let resumeGen = 0, resumeMark = null, resumeLen = 0, resumeTouched = false;
  let hold = 0;             // while a backup of a game about to be replaced is being written, nothing saves
  const startedAt = now();

  // Gates in front of the stores: the saver skips a store until its gate reports answered.
  const localGate = { name: 'local', get answered() { return !hold && localOk && local?.answered === true; }, save: (o) => local.save(o) };
  const accountGate = {
    name: 'claude',
    get answered() { return !hold && accountOpen && acct?.answered === true; },
    async save(o) {
      await acct.save(o);
      if (Number.isFinite(acct.writtenAt)) acctKnown = Math.max(acctKnown, acct.writtenAt);
    },
  };

  const canItem = !!clipboard && typeof clipboard.write === 'function' && typeof Item === 'function' && typeof B === 'function';

  // R30: Copy has to call writeText inside the tap, which only works if the code already exists.
  // So the Menu starts encoding when it opens (and keeps it fresh), and Copy uses it if ready.
  let ready = null, readyAt = -Infinity, encoding = false;
  function prepareCode() {
    if (encoding || (ready !== null && now() - readyAt < BAL.autosaveMs)) return;
    encoding = true;
    const at = now();
    encodeSaveCode(serialize(cur)).then((c) => { ready = c; readyAt = at; }, () => {}).finally(() => { encoding = false; });
  }

  const saver = createSaver({ stores: [localGate, accountGate], snapshot: () => serialize(cur), now });
  const flush = () => saver.flush().catch(() => {});

  // The open game goes to the phone's backup slots before anything replaces it; true when stored
  // (or when there is nothing worth keeping).
  async function backupCurrent() {
    const o = serialize(cur);
    if (!hasProgress(o)) return true;
    return writeBackup(storage, 'local', await encodeSaveCode(o).catch(() => null));
  }

  function swap(g, at) {
    cur = g; curSavedAt = at;
    hooks.swap?.(g);
  }

  const wait = (ms) => new Promise((res) => setTimer(res, ms));

  // ctx says how to judge this read: at boot against the open game's own save, on resume against
  // what this page last wrote or loaded. isTouched: has the player changed the game since then.
  async function settle(save, ctx = bootCtx) {
    // No save at all: the saver may now write the account.
    if (!isObj(save)) { accountOpen = true; return; }
    // An unloadable save is backed up whatever its age: an older savedAt must not let the saver
    // overwrite a newer-version or damaged-but-decodable save with nothing kept.
    const r = tryLoad(save);
    if (!r.ok) {
      // R7: copied aside before the saver can write over it. Without a copy the account stays
      // unwritten this session; the phone keeps saving.
      const kept = writeBackup(storage, 'account', await encodeSaveCode(save).catch(() => null));
      if (kept) accountOpen = true;
      hooks.toast?.(`${r.reason.replace(/^Save/, 'Account save')} — ${kept ? 'kept a backup' : 'account saving paused'}`);
      return;
    }
    // Not newer than what this page already has: nothing to restore, the saver may write.
    if (!ctx.newer(save)) { acctKnown = Math.max(acctKnown, stamp(save)); accountOpen = true; return; }
    if (!ctx.isTouched()) {
      // The game being left may hold progress the account lacks (a stale page, or a phone save
      // the account never saw); it is kept before the swap, never dropped silently.
      hold++;
      let kept;
      try { kept = await backupCurrent(); } finally { hold--; }
      // The player may have acted while the copy was being written; then it is their call.
      if (!ctx.isTouched()) {
        swap(r.game, stamp(save));
        acctKnown = Math.max(acctKnown, stamp(save));
        accountOpen = true;
        hooks.toast?.('Progress restored from your account');
        if (!kept) hooks.toast?.("Couldn't keep a backup of the replaced game");
        flush();
        return;
      }
    }
    // Both sides have progress the other lacks. Copied aside first in case the choice is never
    // made: the phone keeps saving meanwhile, and next time its save would look newer.
    writeBackup(storage, 'account', await encodeSaveCode(save).catch(() => null));
    hooks.choice?.({
      game: r.game,
      // The game being replaced goes to the phone's backup slots first, so "Load account save"
      // can't lose what was built here. Swaps even if no copy could be stored: the player chose.
      async load() {
        const kept = await backupCurrent();
        swap(r.game, stamp(save)); acctKnown = Math.max(acctKnown, stamp(save)); accountOpen = true; flush();
        if (!kept) hooks.toast?.("Couldn't keep a backup of the replaced game");
      },
      keep() { acctKnown = Math.max(acctKnown, stamp(save)); accountOpen = true; flush(); },
    });
  }
  const bootCtx = {
    newer: (save) => curSavedAt === -Infinity || stamp(save) > curSavedAt,
    isTouched: () => touched,
  };
  const resumeCtx = {
    newer: (save) => stamp(save) > acctKnown,
    isTouched: () => resumeTouched,
  };

  // R21: account.load() directly, so `answered` is exactly what boot saw; until it answers, the
  // account doc is never written.
  async function syncAccount(p) {
    let store = null;
    try { store = await p; } catch { store = null; }
    if (!store) return;
    acct = store;
    for (let attempt = 0; ; attempt++) {
      let save = null;
      try { save = await store.load(); } catch { save = null; }
      if (store.answered === true) { await settle(save); bootSettled = true; return; }
      await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
    }
  }
  const accountDone = account ? syncAccount(account).catch(() => {}) : Promise.resolve();

  // C1: a page that was in the background may hold an old game while another page or device has
  // moved the account on. On coming back, the account gate closes (so the first autosave can't
  // write the old game over the newer save) and the account is read again before any write.
  async function resume() {
    if (!acct || !bootSettled) return; // no account, or boot's own read is still deciding
    const mine = ++resumeGen;
    accountOpen = false;
    resumeMark = cur.undo.at(-1) ?? null; resumeLen = cur.undo.length; resumeTouched = false;
    for (let attempt = 0; ; attempt++) {
      let save = null;
      try { save = await acct.load(); } catch { save = null; }
      if (mine !== resumeGen) return; // a newer resume took over
      if (acct.answered === true) return settle(save, resumeCtx);
      await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
      if (mine !== resumeGen) return;
    }
  }

  return {
    get game() { return cur; },
    get touched() { return touched; },
    accountDone,
    resume,

    // Every frame. Never awaited (ruling 7): a hung store must not stall the frame loop.
    frame() {
      if (cur.undo.length) touched = true;
      // Any change to the undo stack since coming back (a new step, or Undo popping one) is the player acting.
      if (cur.undo.length !== resumeLen || (cur.undo.at(-1) ?? null) !== resumeMark) resumeTouched = true;
      saver.maybeSave().catch(() => {});
    },
    flush,

    // I1: what the Menu shows and when the warning chip appears. okAt/error come from the stores'
    // own write results; the chip counts a save to either store as saved.
    health() {
      const t = now();
      const stores = [{
        key: 'phone', okAt: local?.health?.okAt ?? null,
        error: localOk === false ? 'Saving paused' : local?.health?.error ?? null,
      }];
      if (account) {
        stores.push({
          key: 'account', okAt: acct?.health?.okAt ?? null,
          error: !acct ? 'Not connected yet' : !accountOpen ? 'Paused until your account is checked' : acct.health?.error ?? null,
        });
      }
      const newest = Math.max(startedAt, ...stores.map((x) => x.okAt ?? -Infinity));
      return { now: t, stores, stale: t - newest >= STALE_MS };
    },

    // R30: the Menu calls this when it opens and as it stays open.
    prepareCode,

    // I4: the game being replaced is backed up first (nothing saves meanwhile); the swap itself
    // is immediate. Resolves once the new game has been saved.
    async newGame() {
      const outgoing = hasProgress(serialize(cur)) ? encodeSaveCode(serialize(cur)).catch(() => null) : null;
      touched = true; resumeTouched = true;
      hold++;
      swap(freshGame(rand, cur), -Infinity);
      let kept = true;
      try { if (outgoing) kept = writeBackup(storage, 'local', await outgoing); } finally { hold--; }
      if (!kept) hooks.toast?.("Couldn't keep a backup of the replaced game");
      return flush(); // the player confirmed twice; the old factory shouldn't come back on the next open
    },

    // Rejects with decodeSaveCode's player-facing message for a bad paste; the game stays.
    async loadCode(text) {
      const obj = await decodeSaveCode(text);
      const r = tryLoad(obj);
      if (!r.ok) return { ok: false, reason: r.reason };
      hold++;
      let kept;
      try { kept = await backupCurrent(); } finally { hold--; }
      touched = true; resumeTouched = true;
      swap(r.game, stamp(obj));
      if (!kept) hooks.toast?.("Couldn't keep a backup of the replaced game");
      await flush();
      return { ok: true };
    },

    // The current save code as text, for the select-and-copy sheet when the clipboard refuses.
    codeText: () => encodeSaveCode(serialize(cur)),
    backups: () => listBackups(storage),

    // Synchronous up to the clipboard call (ruling 17): iOS only allows the write inside the tap.
    // Preference order (R30): writeText with the code the Menu already prepared, else a
    // ClipboardItem holding a promise of the code, else the UI's select-by-hand sheet.
    copyCode() {
      prepareCode();
      if (ready !== null && clipboard && typeof clipboard.writeText === 'function') return clipboard.writeText(ready);
      const code = encodeSaveCode(serialize(cur));
      if (canItem) return clipboard.write([new Item({ 'text/plain': code.then((c) => new B([c], { type: 'text/plain' })) })]);
      if (clipboard && typeof clipboard.writeText === 'function') return code.then((c) => clipboard.writeText(c));
      return Promise.reject(new Error('No clipboard'));
    },
  };
}
