// Boot and per-frame wiring for both builds. __TARGET__ is injected by build.mjs: 'artifact' (the
// Claude link, saving to the account with a phone mirror) or 'home' (the Home Screen app, phone
// only). Everything with rules worth testing lives in DOM-free modules (session.js for saves,
// loop.js for timing, the sim, the tools); this file only connects them to the page.
import { CENTER } from './config.js';
import { tick } from './sim/tick.js';
import { createLoop } from './loop.js';
import { bootLocal, createSession } from './session.js';
import { createLocalStore, createClaudeStore } from './save/stores.js';
import { createCamera, clampCam, zoomAt } from './render/camera.js';
import { drawFrame, readTheme, watchTheme } from './render/draw.js';
import { createTools } from './input/tools.js';
import { createUI } from './ui/ui.js';
import { tierLabel, formatDuration } from './ui/format.js';
import { createSfx } from './audio.js';
import { stress, countItems } from './stress.js';

// R25: past 2x the flat art looks the same, and a 3x backing store costs ~2.25x the fill work.
const DPR_MAX = 2;

// Even reading localStorage throws in some sandboxed frames and private modes.
const storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();

async function boot() {
  // Started first and never awaited here: use() can take ~10 s to give up, and the game must open
  // straight away on the phone's own save.
  const account = __TARGET__ === 'artifact' ? createClaudeStore().catch(() => null) : null;
  const local = createLocalStore();
  const start = await bootLocal({ local, storage });

  const canvas = document.getElementById('game');
  // Opaque: drawFrame paints every pixel, and the compositor can skip blending the canvas.
  const ctx = canvas.getContext('2d', { alpha: false });
  const cam = createCamera(canvas.clientWidth || 1, canvas.clientHeight || 1);
  const sfx = createSfx({ enabled: start.game.settings.sfx !== false });
  let theme = readTheme();
  watchTheme((t) => { theme = t; });

  // Tools need the UI (inspect, toasts) and the UI needs the tools, so tools get a forwarder.
  let ui = null, session = null, loop = null;
  const uiRef = { inspect: (e) => ui?.inspect(e), toast: (t) => ui?.toast(t) };
  const tools = createTools({ game: start.game, cam, ui: uiRef, sfx });

  // The sim waits while Welcome or the account choice is up: a tier-up from the old game would
  // otherwise queue behind the sheet and pop up over the game the player picks.
  let welcomeOpen = false, choiceOpen = false, errorShown = false;
  const paused = () => welcomeOpen || choiceOpen;
  function showWelcome() {
    welcomeOpen = true;
    ui.showWelcome(() => { welcomeOpen = false; }, () => { welcomeOpen = false; session.newGame(); });
  }

  const actions = {
    newGame: () => session.newGame(),
    copySaveCode: () => session.copyCode(),
    saveCodeText: () => session.codeText(),
    // Plain text copy for a backup's code (inside a tap); rejects so the UI leaves it to select by hand.
    copyText: (t) => (navigator.clipboard?.writeText ? navigator.clipboard.writeText(t) : Promise.reject(new Error('No clipboard'))),
    listBackups: () => session.backups(),
    loadSaveCode: (text) => session.loadCode(text),
    setSfx: (on) => sfx.setEnabled(on),
    perf: () => ({ fps: loop.fps, tickMs: loop.tickMs, buildings: session.game.ents.size - 1, items: countItems(session.game) }),
  };
  ui = createUI({ root: document, game: start.game, tools, sfx, actions });

  session = createSession({
    game: start.game, savedAt: start.savedAt, local, localOk: start.localOk, account, storage,
    hooks: {
      // R5: the UI, the tools and the loop (which reads session.game) all move to the new game.
      swap(g) {
        tools.setGame(g);
        ui.setGame(g);
        sfx.setEnabled(g.settings.sfx !== false);
        cam.x = CENTER.x; cam.y = CENTER.y; clampCam(cam);
        // Its "Tier · played" line describes the game it opened on.
        if (welcomeOpen) showWelcome();
      },
      toast: (t) => ui.toast(t),
      choice(c) {
        choiceOpen = true;
        ui.showChoice('Newer save in your account',
          `Your Claude account has a newer save (${tierLabel(c.game)} · ${formatDuration(c.game.stats.playTicks)} played) than the game on this screen. Keeping this game replaces the account save.`,
          [
            { label: 'Load account save', act: () => { choiceOpen = false; c.load(); } },
            { label: 'Keep this game', confirm: 'Tap again to replace the account save', act: () => { choiceOpen = false; c.keep(); } },
          ]);
      },
    },
  });

  if (start.welcome) showWelcome();
  if (start.notice) ui.toast(start.notice);

  // ---- canvas size, camera viewport and the auto-pan insets
  let dpr = 1, crect = canvas.getBoundingClientRect();
  const topBar = document.getElementById('top'), buildBar = document.getElementById('bar');
  // Layout is read only here (resize, bars changing size, focus mode), never per frame or per
  // pointer event: a read after the UI's writes would force a synchronous layout.
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    // Assigning width clears the canvas, so only when it really changed.
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    cam.vw = w; cam.vh = h; clampCam(cam);
    crect = canvas.getBoundingClientRect();
    // The edge auto-pan zone starts just inside the visible map, above the build bar and below
    // the top bar; in focus mode the bars are display:none, their rects empty, the insets 0.
    const t = topBar.getBoundingClientRect(), b = buildBar.getBoundingClientRect();
    tools.insets.top = t.height ? Math.max(0, t.bottom - crect.top) : 0;
    tools.insets.bottom = b.height ? Math.max(0, crect.bottom - b.top) : 0;
  }
  layout();
  addEventListener('resize', layout);
  globalThis.visualViewport?.addEventListener('resize', layout);
  // Also catches the bars changing height (goal rows, focus mode) and safe-area changes.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(layout);
    for (const el of [canvas, topBar, buildBar]) ro.observe(el);
  }

  // ---- input: canvas CSS px relative to the canvas, timeStamp on the rAF clock (Task 13 wiring)
  const toP = (e) => ({ id: e.pointerId, x: e.clientX - crect.left, y: e.clientY - crect.top, t: e.timeStamp });
  canvas.addEventListener('pointerdown', (e) => {
    // Capture keeps a drag's events on the canvas when the finger slides over a toolbar, so edge
    // auto-pan under the build bar keeps working.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    tools.gestures.down(toP(e));
  });
  canvas.addEventListener('pointermove', (e) => tools.gestures.move(toP(e)));
  canvas.addEventListener('pointerup', (e) => tools.gestures.up(toP(e)));
  canvas.addEventListener('pointercancel', (e) => tools.gestures.cancel(toP(e)));
  // Safety net if an up is ever lost; a no-op after a normal up (the id is already gone).
  canvas.addEventListener('lostpointercapture', (e) => tools.gestures.cancel(toP(e)));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // A mouse can't pinch: the wheel zooms around the pointer, like a pinch around the fingers.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(cam, Math.exp(-e.deltaY / 500), e.clientX - crect.left, e.clientY - crect.top);
  }, { passive: false });

  // Sound may only start inside a gesture (ruling 13). For touch, browsers count pointerup, not
  // pointerdown, as the gesture, so both unlock; unlock() is idempotent and cheap once running.
  const unlock = () => sfx.unlock();
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('pointerup', unlock, true);

  // ---- per frame
  function drainEvents(g) {
    if (!g.events.length) return;
    // Copied and cleared first: a handler that throws must not leave the event to repeat every frame.
    const ev = g.events.splice(0);
    for (const e of ev) {
      if (e.type === 'tierUp') ui.showTierUp(e.tier);
      else if (e.type === 'complete') ui.showComplete();
      else if (e.type === 'toast') ui.toast(e.text);
      // 'research': ui.js already played the sound and toasted when the player bought it (ruling 12).
    }
  }

  loop = createLoop({
    step: () => { if (!paused()) tick(session.game); },
    // M1: said once, however long a bug keeps throwing; frames and autosaves carry on.
    onError(err, kind) {
      console.error(`Steelreach ${kind} failed`, err);
      if (!errorShown) { errorShown = true; ui.toast('Something went wrong — your game is still saved'); }
    },
    render(alpha) {
      const g = session.game;
      // First, so a throwing draw or UI update can't stop the autosave clock.
      session.frame();
      drainEvents(g);
      tools.update(performance.now());
      ui.render();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // While paused no tick comes, so interpolating toward one would rock items back and forth.
      drawFrame(ctx, g, cam, paused() ? 0 : alpha, tools.view, theme);
    },
  });

  // Hidden: save now and stop. Restarting resets the loop's clock, so nothing is caught up.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { session.flush(); loop.stop(); } else loop.start();
  });
  addEventListener('pagehide', () => session.flush());
  if (!document.hidden) loop.start();

  if (location.hash === '#debug') {
    window.__steelreach = {
      get game() { return session.game; }, // a getter: New game and Load swap the game
      cam, tools, actions, session,
      stress: (nBuildings, nItems) => stress(session.game, nBuildings, nItems),
      fps: () => loop.fps,
      tickMs: () => loop.tickMs,
    };
  }
}

// A blank page tells the player nothing; saves are never written before boot has read them.
boot().catch((err) => {
  console.error('Steelreach failed to start', err);
  const p = document.createElement('p');
  p.textContent = 'Steelreach could not start. Close and reopen it; your saved game has not been touched.';
  p.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;text-align:center;font:18px system-ui,sans-serif;background:#111;color:#eee;z-index:99';
  document.body.append(p);
});
