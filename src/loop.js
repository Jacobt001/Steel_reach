// Fixed-timestep loop: the sim always advances in whole 1/tps steps, whatever the screen's refresh
// rate, so a factory behaves the same on a 60 Hz and a 120 Hz phone. render() gets alpha, how far
// time has run toward the next step, so items can glide between ticks.
// DOM-free apart from the defaults, which are only touched once start() runs: tests inject
// raf/now/isHidden.
import { TPS } from './config.js';

// A stalled frame catches up at most 0.25 s; the rest is dropped. Running every owed step would
// make a slow phone slower each frame (the classic spiral), and the brief wants no catch-up.
const MAX_STEPS = 5;
// Three 1/60 s frames must make exactly one 1/20 s step, not 0.9999999 of one.
const EPS = 1e-9;
const FPS_WINDOW_MS = 1000;

export function createLoop({
  step, render, tps = TPS,
  // Wrapped: performance.now called detached throws "Illegal invocation" in browsers.
  raf = (f) => requestAnimationFrame(f), now = () => performance.now(), isHidden = () => document.hidden,
}) {
  let running = false;
  let gen = 0;  // bumps on every start/stop, so a frame requested by an earlier start is ignored
  let last = 0, acc = 0; // acc: owed time in ticks
  let frames = 0, fpsAt = 0, fps = 0, tickMs = 0;

  function frame(token) {
    if (token !== gen || !running) return;
    // Requested first, so one throwing render (or step) can't end the game's frames for good.
    raf(() => frame(token));
    const t = now();
    // Hidden: nothing advances and nothing is owed for the time away (brief §3 Pausing).
    if (isHidden()) { acc = 0; last = t; return; }
    const dt = t - last;
    last = t;
    if (dt > 0) acc += (dt * tps) / 1000;
    let n = Math.floor(acc + EPS);
    // Whole owed steps beyond MAX_STEPS are dropped with the rest; only the fraction carries on.
    acc = Math.max(0, acc - n);
    if (n > MAX_STEPS) n = MAX_STEPS;
    for (let i = 0; i < n; i++) {
      const s = now();
      step();
      const d = now() - s;
      tickMs = tickMs ? tickMs + (d - tickMs) * 0.1 : d; // smoothed: one slow tick shouldn't swing it
    }
    frames++;
    if (t - fpsAt >= FPS_WINDOW_MS) { fps = (frames * 1000) / (t - fpsAt); frames = 0; fpsAt = t; }
    render(acc);
  }

  return {
    start() {
      if (running) return; // a second start must not fork a second chain of frames
      running = true;
      const token = ++gen;
      // Time spent stopped (page hidden, app switched away) is never owed.
      last = fpsAt = now(); acc = 0; frames = 0;
      raf(() => frame(token));
    },
    stop() { running = false; gen++; },
    get running() { return running; },
    get fps() { return fps; },
    get tickMs() { return tickMs; },
  };
}
