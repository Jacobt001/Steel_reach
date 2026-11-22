// Generated sound effects (no files, no music). Everything is a silent no-op
// when Web Audio is missing (Node, old browsers) so callers never need guards.

const MASTER = 0.35;      // modest overall level; phone speakers are harsh when loud
const FLOOR = 0.0001;     // ramps start/end here, never at 0 or full, so there are no clicks
const TICK_GAP_MS = 40;   // belts can fire many ticks per frame; keep it a soft patter

// Each voice: [startOffsetSec, freqHz, durSec, peakGain, waveType, endFreqHz?]
const VOICES = {
  place:    [[0, 330, 0.07, 0.5, 'triangle', 260]],
  erase:    [[0, 240, 0.09, 0.45, 'triangle', 150]],
  undo:     [[0, 300, 0.06, 0.4, 'triangle'], [0.06, 220, 0.08, 0.4, 'triangle']],
  tick:     [[0, 1200, 0.018, 0.12, 'sine']],
  tierUp:   [[0, 523.25, 0.16, 0.45, 'sine'], [0.11, 659.25, 0.16, 0.45, 'sine'], [0.22, 783.99, 0.34, 0.5, 'sine']],
  research: [[0, 440, 0.12, 0.4, 'sine'], [0.1, 660, 0.22, 0.4, 'sine']],
  warn:     [[0, 180, 0.12, 0.45, 'square'], [0.16, 150, 0.16, 0.45, 'square']],
  tap:      [[0, 700, 0.03, 0.2, 'sine']],
};

export function createSfx({ enabled = true } = {}) {
  let ctx = null, master = null, on = !!enabled, lastTick = -Infinity;
  const Ctor = () => globalThis.AudioContext || globalThis.webkitAudioContext; // iOS Safari may only have the prefixed one

  function unlock() {
    // Must run inside a user gesture (iOS autoplay rules); safe to call on every pointerdown.
    try {
      if (!ctx) {
        const C = Ctor(); if (!C) return;
        // Assigned only once the graph is built: a throw halfway must not leave a ctx with no master.
        const c = new C();
        const m = c.createGain(); m.gain.value = MASTER; m.connect(c.destination);
        ctx = c; master = m;
      }
      // iOS reports 'interrupted' after an app switch or call, not 'suspended'; resume from both.
      if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    } catch { /* audio is optional; never break the game */ }
  }

  function voice(at, freq, dur, peak, type, endFreq) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.linearRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.008, dur / 3)); // quick attack
    g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);                // smooth decay to near zero
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function play(name) {
    if (!on || !ctx) return;
    const v = VOICES[name]; if (!v) return;
    if (name === 'tick') {
      const now = performance.now();
      if (now - lastTick < TICK_GAP_MS) return;
      lastTick = now;
    }
    try { for (const args of v) voice(...args); } catch { /* ignore audio failures */ }
  }

  return {
    play, unlock,
    setEnabled(v) { on = !!v; },
    get enabled() { return on; },
  };
}
