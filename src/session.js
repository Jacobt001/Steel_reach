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
// Its own key, so an account copy can never overwrite a backup of the phone's save.
export const ACCOUNT_BACKUP_KEY = 'steelreach-backup-account';
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
// True only if the copy is really stored: without it, the original must not be saved over.
function writeBackup(storage, key, code) {
  if (!storage || typeof code !== 'string') return false;
  try { storage.setItem(key, code); return true; } catch { return false; }
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
    const kept = writeBackup(storage, BACKUP_KEY, raw);
    return fresh(`Save is damaged — ${kept ? 'kept a backup' : 'saving paused'}`, kept);
  }
  const r = tryLoad(obj);
  if (!r.ok) {
    const code = raw ?? await encodeSaveCode(obj).catch(() => null);
    const kept = writeBackup(storage, BACKUP_KEY, code);
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
    const newer = isObj(save) && (curSavedAt === -Infinity || stamp(save) > curSavedAt);
    // No save, or older than the open game's: the saver may now write the account.
    if (!newer) { accountOpen = true; return; }
    const r = tryLoad(save);
    if (!r.ok) {
      // R7: copied aside before the saver can write over it. Without a copy the account stays
      // unwritten this session; the phone keeps saving.
      const kept = writeBackup(storage, ACCOUNT_BACKUP_KEY, await encodeSaveCode(save).catch(() => null));
      if (kept) accountOpen = true;
      hooks.toast?.(`${r.reason.replace(/^Save/, 'Account save')} — ${kept ? 'kept a backup' : 'account saving paused'}`);
      return;
    }
    if (!touched) {
      swap(r.game, stamp(save));
      accountOpen = true;
      hooks.toast?.('Progress restored from your account');
      return;
    }
    // Both sides have progress the other lacks. Copied aside first in case the choice is never
    // made: the phone keeps saving meanwhile, and next time its save would look newer.
    writeBackup(storage, ACCOUNT_BACKUP_KEY, await encodeSaveCode(save).catch(() => null));
    hooks.choice?.({
      game: r.game,
      load() { swap(r.game, stamp(save)); accountOpen = true; flush(); },
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
