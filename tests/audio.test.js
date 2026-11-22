import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createSfx } from '../src/audio.js';
const NAMES = ['place','erase','undo','tick','tierUp','research','warn','tap'];
test('silent no-op without Web Audio', () => { const s = createSfx(); s.unlock(); for (const n of NAMES) s.play(n);
  s.setEnabled(false); assert.equal(s.enabled, false); });

// Minimal fake Web Audio so the synth paths run under Node.
function fakeCtx() {
  const log = { created: 0, resumed: 0, oscs: 0, started: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  class Ctx {
    constructor() { log.created++; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); }
    createGain() { return { gain: param(), connect() {} }; }
    createOscillator() { log.oscs++; return { type: '', frequency: param(), connect() {}, start() { log.started++; }, stop() {} }; }
  }
  return { Ctx, log };
}

test('with Web Audio: lazy create, safe repeat unlock, play synthesizes, mute silences', () => {
  const { Ctx, log } = fakeCtx(); globalThis.AudioContext = Ctx;
  try {
    const s = createSfx();
    assert.equal(log.created, 0);
    s.play('place'); assert.equal(log.oscs, 0); // not unlocked yet: no sound, no throw
    s.unlock(); s.unlock(); s.unlock();
    assert.equal(log.created, 1); assert.equal(log.resumed, 1);
    for (const n of NAMES) s.play(n);
    assert.ok(log.started >= NAMES.length);
    s.play('nonsense'); // unknown names are ignored
    const before = log.oscs; s.setEnabled(false); s.play('tierUp'); assert.equal(log.oscs, before);
    assert.equal(s.enabled, false);
  } finally { delete globalThis.AudioContext; }
});

test('webkitAudioContext fallback and tick rate limit', () => {
  const { Ctx, log } = fakeCtx(); globalThis.webkitAudioContext = Ctx;
  const realNow = performance.now; let t = 1000; performance.now = () => t;
  try {
    const s = createSfx(); s.unlock(); assert.equal(log.created, 1);
    s.play('tick'); const one = log.oscs; s.play('tick'); assert.equal(log.oscs, one); // within 40 ms
    t += 41; s.play('tick'); assert.ok(log.oscs > one);
  } finally { delete globalThis.webkitAudioContext; performance.now = realNow; }
});
