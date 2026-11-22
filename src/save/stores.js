// Where saves live: the phone's localStorage, and inside Claude the account's per-user doc.
// Every store answers null or does nothing rather than throw: a store that is missing, slow or
// refusing must never block loading or stop the other store from saving.
// load() alone can't tell "no save there" from "couldn't read it" (both are null), so each store
// also keeps `answered` (ruling R21): true once a load got a real reply from the backing store,
// "no save" included, never for a timeout or an error. The saver only writes answered stores, so
// a newer account save that boot couldn't read is never overwritten by an older phone mirror.
import { encodeSaveCode, decodeSaveCode } from './code.js';
import { BAL } from '../config.js';

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

// setTimeout fires at once for delays past 2^31-1 ms, which would drop every answer.
const MAX_TIMER = 0x7fffffff;

// Resolves like p, or null once ms pass. ms <= 0 (or anything unusable) means no limit: a 0 ms
// timer would beat even an instant local load, and boot would drop the save (controller ruling).
function withTimeout(p, ms) {
  if (!(ms > 0 && ms <= MAX_TIMER)) return p;
  let timer;
  const late = new Promise((res) => { timer = setTimeout(res, ms, null); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

// Runs fn one call at a time and keeps only the newest waiting argument, so a slow write is never
// overlapped by a newer one (which could land first and then be overwritten by the older) and a
// backlog never builds. The promise settles once this argument or a newer one has been handled.
// Errors are swallowed: callers rely on saving never throwing.
function latestOnly(fn) {
  let busy = false, has = false, next, done;
  return (arg) => {
    next = arg; has = true;
    // A flag, not the promise, marks busy: if fn finished synchronously the finally would run
    // before `done` was assigned, and a promise-as-flag would then stay set forever.
    if (!busy) {
      busy = true;
      done = (async () => {
        try {
          while (has) {
            const a = next; has = false; next = undefined;
            try { await fn(a); } catch { /* reported by the store itself, if at all */ }
          }
        } finally { busy = false; }
      })();
    }
    return done;
  };
}

export function createLocalStore(key = 'steelreach') {
  // Even reading window.localStorage throws in some sandboxed frames and private modes.
  const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
  const write = latestOnly(async (obj) => { storage()?.setItem(key, await encodeSaveCode(obj)); });
  const store = {
    name: 'local',
    answered: false,
    async load() {
      let code = null;
      // localStorage replies synchronously. Missing or throwing counts as an empty store that has
      // answered: there is nothing in it a save could overwrite, and the mirror must keep saving.
      try { code = storage()?.getItem(key) ?? null; } catch { /* unavailable: empty */ }
      store.answered = true;
      if (!code) return null;
      try { return await decodeSaveCode(code); } catch { return null; }
    },
    save: (obj) => write(obj),
  };
  return store;
}

// Ruling R17: a doc may hold 256 KiB, so codes past 200,000 chars are split across docs.
const PART = 200000;
const MAX_PARTS = 64;

// The runtime asks for exactly one retry, after a short random delay, on 'unavailable' only.
async function setDoc(doc, data) {
  try { await doc.set(data); } catch (err) {
    if (err?.code !== 'unavailable') throw err;
    await new Promise((res) => setTimeout(res, 200 + Math.random() * 400));
    await doc.set(data);
  }
}

export async function createClaudeStore(claude = globalThis.claude, docName = 'steelreach', timeoutMs = 10000) {
  let col, main;
  try {
    // use() takes ~10 s to give up when no viewer answers, so setup shares the load time limit.
    const ready = await withTimeout((async () => {
      if (!claude || typeof claude.use !== 'function') return null; // Home Screen build, plain browsers
      const db = await claude.use('db');
      if (!db) return null;
      const user = await claude.use('user');
      if (!user) return null;
      const id = await user.id();
      if (id === null || id === undefined || id === '') return null;
      // collection() and doc() throw a TypeError synchronously on a bad path segment.
      const c = db.collection('data/users/' + id);
      return { c, d: c.doc(docName) };
    })(), timeoutMs);
    if (!ready) return null;
    col = ready.c; main = ready.d;
  } catch { return null; }

  const partDoc = (i) => col.doc(`${docName}-p${i}`);

  // The doc's code, or null when it holds no usable save. A get() that fails rejects instead, so
  // load() can tell a reply from "not read". A doc that exists but is unusable (bad shape, a
  // cut-off split save) is still a reply: the next save may overwrite it, which repairs it.
  async function readCode() {
    const snap = await main.get();
    if (!snap?.exists) return null;
    const d = snap.data();
    if (!isObj(d) || typeof d.code !== 'string') return null;
    const n = d.parts ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return null;
    let code = d.code;
    if (n > 1) {
      const snaps = await Promise.all(Array.from({ length: n - 1 }, (_, k) => partDoc(k + 1).get()));
      for (const s of snaps) {
        const p = s?.exists ? s.data() : null;
        // A part from a different save means a write was cut off between the parts and the
        // main doc; splicing them would decode to garbage, so the whole set is discarded.
        if (!isObj(p) || typeof p.code !== 'string' || p.savedAt !== d.savedAt) return null;
        code += p.code;
      }
    }
    return code;
  }

  const write = latestOnly(async (obj) => {
    const code = await encodeSaveCode(obj);
    const savedAt = Number.isFinite(obj?.savedAt) ? obj.savedAt : Date.now();
    if (code.length <= PART) return setDoc(main, { code, savedAt });
    const parts = [];
    for (let i = 0; i < code.length; i += PART) parts.push(code.slice(i, i + PART));
    // Parts first and the main doc last, one write at a time: until the main doc lands, a load
    // still reads the old part count and savedAt, so a cut-off save is rejected, not spliced.
    for (let i = 1; i < parts.length; i++) await setDoc(partDoc(i), { code: parts[i], savedAt });
    await setDoc(main, { savedAt, parts: parts.length, code: parts[0] });
  });

  const store = {
    name: 'claude',
    answered: false,
    async load() {
      try {
        // Boxed so a timeout (null) can't be mistaken for a reply of "no save".
        const got = await withTimeout(readCode().then((code) => ({ code })), timeoutMs);
        if (!got) return null;
        // Set only here: a reply that lands after the timeout was never seen by the caller, so
        // it must not let the saver write over a save the caller didn't load.
        store.answered = true;
        return got.code === null ? null : await decodeSaveCode(got.code).catch(() => null);
      } catch { return null; } // refused (permission prompt, offline): not a reply
    },
    save: (obj) => write(obj),
  };
  return store;
}

const stamp = (o) => (Number.isFinite(o.savedAt) ? o.savedAt : -Infinity);

export async function loadBest(stores, timeoutMs = 10000) {
  const list = Array.isArray(stores) ? stores.filter(Boolean) : [];
  // Promise.resolve().then() turns a load() that throws synchronously into a rejection.
  const got = await Promise.all(list.map((s) => withTimeout(Promise.resolve().then(() => s.load()), timeoutMs).catch(() => null)));
  let best = null;
  // On a tie the earlier store wins; both hold the same save then.
  for (const o of got) if (isObj(o) && (best === null || stamp(o) > stamp(best))) best = o;
  return best;
}

const IDLE = Promise.resolve();

export function createSaver({ stores, snapshot, intervalMs = BAL.autosaveMs, now = Date.now }) {
  // One write queue per store, made on first use. A store is written only once one of its loads
  // has answered (R21), checked on every save, so a store whose load timed out or was refused is
  // skipped until a later load (a retry by boot) answers; never written blind over a save nobody
  // read. A store whose write hangs only holds up itself; the phone mirror keeps saving.
  const queues = new Map();
  const queueOf = (s) => {
    let q = queues.get(s);
    if (!q) queues.set(s, q = latestOnly((obj) => s.save(obj)));
    return q;
  };
  let last = now();
  // async so a snapshot that throws rejects instead of throwing into the caller's frame loop.
  const save = async () => {
    last = now();
    const obj = snapshot();
    obj.savedAt = last;
    await Promise.all(stores.filter((s) => s?.answered === true).map((s) => queueOf(s)(obj)));
  };
  return {
    // Called every frame, so the not-due path is one clock read and a shared resolved promise.
    maybeSave: () => (now() - last < intervalMs ? IDLE : save()),
    flush: save,
  };
}
