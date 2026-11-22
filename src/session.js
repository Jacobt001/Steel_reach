// Which game is open, and where it is saved. Every rule here guards the brief's anti-goal "losing
// progress": a save that can't be loaded is copied aside before anything may write over it (R7),
// a store is only written once boot has read it (R21), and a newer account save never silently
// replaces what the player has built since opening, nor is it silently dropped.
// DOM-free: main.js passes in localStorage, the clipboard, timers and the UI hooks.
import { createGame } from './game/state.js';
import { serialize, tryLoad } from './save/serialize.js';
import { encodeSaveCode, decodeSaveCode } from './save/code.js';
import { createSaver } from './save/stores.js';

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

  // Gates in front of the stores: the saver skips a store until its gate reports answered.
  const localGate = { name: 'local', get answered() { return localOk && local?.answered === true; }, save: (o) => local.save(o) };
  const accountGate = { name: 'claude', get answered() { return accountOpen && acct?.answered === true; }, save: (o) => acct.save(o) };

  // Copy needs a code ready to hand when ClipboardItem is missing: writeText must run inside the
  // tap, before an encode could finish. Elsewhere this store does nothing and costs nothing.
  const canItem = !!clipboard && typeof clipboard.write === 'function' && typeof Item === 'function' && typeof B === 'function';
  let lastCode = null;
  const keeper = { name: 'code', answered: true, save: async (o) => { if (!canItem) lastCode = await encodeSaveCode(o); } };

  const saver = createSaver({ stores: [localGate, accountGate, keeper], snapshot: () => serialize(cur), now });
  const flush = () => saver.flush().catch(() => {});

  function swap(g, at) {
    cur = g; curSavedAt = at;
    hooks.swap?.(g);
  }

  const wait = (ms) => new Promise((res) => setTimer(res, ms));

  async function settle(save) {
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
    // Older than the open game's: nothing to restore, the saver may now write the account.
    if (!(curSavedAt === -Infinity || stamp(save) > curSavedAt)) { accountOpen = true; return; }
    if (!touched) {
      swap(r.game, stamp(save));
      accountOpen = true;
      hooks.toast?.('Progress restored from your account');
      return;
    }
    // Both sides have progress the other lacks. Copied aside first in case the choice is never
    // made: the phone keeps saving meanwhile, and next time its save would look newer.
    writeBackup(storage, 'account', await encodeSaveCode(save).catch(() => null));
    hooks.choice?.({
      game: r.game,
      // The game being replaced goes to the phone's backup slots first, so "Load account save"
      // can't lose what was built here. Swaps even if no copy could be stored: the player chose.
      async load() {
        const kept = hasProgress(serialize(cur)) ? writeBackup(storage, 'local', await encodeSaveCode(serialize(cur)).catch(() => null)) : true;
        swap(r.game, stamp(save)); accountOpen = true; flush();
        if (!kept) hooks.toast?.("Couldn't keep a backup of the replaced game");
      },
      keep() { accountOpen = true; flush(); },
    });
  }

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
      if (store.answered === true) return settle(save);
      await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
    }
  }
  const accountDone = account ? syncAccount(account).catch(() => {}) : Promise.resolve();

  return {
    get game() { return cur; },
    get touched() { return touched; },
    accountDone,

    // Every frame. Never awaited (ruling 7): a hung store must not stall the frame loop.
    frame() {
      if (cur.undo.length) touched = true;
      saver.maybeSave().catch(() => {});
    },
    flush,

    newGame() {
      touched = true;
      swap(freshGame(rand, cur), -Infinity);
      flush(); // the player confirmed twice; the old factory shouldn't come back on the next open
    },

    // Rejects with decodeSaveCode's player-facing message for a bad paste; the game stays.
    async loadCode(text) {
      const obj = await decodeSaveCode(text);
      const r = tryLoad(obj);
      if (!r.ok) return { ok: false, reason: r.reason };
      touched = true;
      swap(r.game, stamp(obj));
      flush();
      return { ok: true };
    },

    // The current save code as text, for the select-and-copy sheet when the clipboard refuses.
    codeText: () => encodeSaveCode(serialize(cur)),
    backups: () => listBackups(storage),

    // Synchronous up to the clipboard call (ruling 17): iOS only allows the write inside the tap.
    copyCode() {
      const code = encodeSaveCode(serialize(cur));
      code.then((c) => { lastCode = c; }, () => {});
      if (canItem) return clipboard.write([new Item({ 'text/plain': code.then((c) => new B([c], { type: 'text/plain' })) })]);
      if (clipboard && typeof clipboard.writeText === 'function') {
        return lastCode !== null ? clipboard.writeText(lastCode) : code.then((c) => clipboard.writeText(c));
      }
      return Promise.reject(new Error('No clipboard'));
    },
  };
}
