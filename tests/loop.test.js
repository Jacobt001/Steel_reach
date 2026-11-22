import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createLoop } from '../src/loop.js';
test('fixed 20 tps, max 5 steps per frame, nothing while hidden', () => {
  let now = 0, cb, hidden = false, steps = 0, frames = 0;
  const l = createLoop({ step: () => steps++, render: () => frames++, raf: f => (cb = f), now: () => now, isHidden: () => hidden });
  l.start(); for (let i = 0; i < 60; i++) { now += 1000 / 60; cb(now); }
  assert.ok(Math.abs(steps - 20) <= 1, `steps=${steps}`);
  now += 5000; cb(now); assert.ok(steps <= 26);
  hidden = true; const s0 = steps; for (let i = 0; i < 60; i++) { now += 1000 / 60; cb(now); } assert.equal(steps, s0);
});

// A fake clock and rAF shared by the tests below; frame(ms) advances time and runs one frame.
function rig(opts = {}) {
  const r = { now: 0, hidden: false, cbs: [], steps: 0, alphas: [], stepCost: 0 };
  r.loop = createLoop({
    step: () => { r.steps++; r.now += r.stepCost; }, render: (a) => r.alphas.push(a),
    raf: (f) => { r.cbs.push(f); }, now: () => r.now, isHidden: () => r.hidden, ...opts,
  });
  r.frame = (ms) => { r.now += ms; const f = r.cbs.shift(); if (f) f(r.now); return !!f; };
  return r;
}

test('render gets alpha in [0, 1): how far the sim is toward its next tick', () => {
  const r = rig();
  r.loop.start();
  r.frame(25); // 0.5 tick in: no step yet
  assert.equal(r.steps, 0);
  assert.ok(Math.abs(r.alphas.at(-1) - 0.5) < 1e-9, `alpha=${r.alphas.at(-1)}`);
  r.frame(50); // 1.5 ticks in
  assert.equal(r.steps, 1);
  assert.ok(Math.abs(r.alphas.at(-1) - 0.5) < 1e-9);
  for (let i = 0; i < 200; i++) r.frame(7 + (i % 5) * 3);
  for (const a of r.alphas) assert.ok(a >= 0 && a < 1, `alpha=${a}`);
});

test('a long stall runs 5 steps and drops the rest; no catch-up spills into later frames', () => {
  const r = rig();
  r.loop.start();
  r.frame(2000); // 40 ticks owed
  assert.equal(r.steps, 5);
  r.frame(50); // the excess was discarded, so the next frame is back to one tick
  assert.equal(r.steps, 6);
});

test('hidden: no steps, no render, and the accumulator restarts from zero', () => {
  const r = rig();
  r.loop.start();
  r.frame(40); // 0.8 tick owed
  const frames = r.alphas.length;
  r.hidden = true;
  r.frame(30); r.frame(5000);
  assert.equal(r.steps, 0);
  assert.equal(r.alphas.length, frames);
  r.hidden = false;
  r.frame(10); // 0.2 tick: the 0.8 from before hiding is gone, so still no step
  assert.equal(r.steps, 0);
  assert.ok(Math.abs(r.alphas.at(-1) - 0.2) < 1e-9);
});

test('stop ends the frame chain; start again resets the clock (no catch-up after a pause)', () => {
  const r = rig();
  r.loop.start();
  r.frame(50);
  assert.equal(r.steps, 1);
  r.loop.stop();
  assert.equal(r.frame(16), true); // the frame already requested still arrives...
  assert.equal(r.steps, 1);        // ...but does nothing
  assert.equal(r.cbs.length, 0);   // and requests no more
  r.now += 60000;                  // a minute away
  r.loop.start();
  r.frame(50);
  assert.equal(r.steps, 2, 'only the 50 ms since start counts');
  r.loop.start(); // a second start must not fork a second chain
  assert.equal(r.cbs.length, 1);
});

test('start/stop/start quickly: the stale frame from the first start is ignored', () => {
  const r = rig();
  r.loop.start(); r.loop.stop(); r.loop.start();
  assert.equal(r.cbs.length, 2);
  r.frame(50); // the stale one: ignored, requests nothing
  assert.equal(r.steps, 0);
  r.frame(0);  // the live one: 50 ms since the last start
  assert.equal(r.steps, 1);
  assert.equal(r.cbs.length, 1);
});

test('a render that throws does not kill the loop', () => {
  let n = 0;
  const r = rig({ render: () => { n++; if (n === 2) throw new Error('boom'); } });
  r.loop.start();
  r.frame(50);
  assert.throws(() => r.frame(50), /boom/);
  r.frame(50);
  assert.equal(n, 3);
  assert.equal(r.steps, 3);
});

test('fps and tickMs are measured for the debug hook and the Performance panel', () => {
  const r = rig();
  r.loop.start();
  for (let i = 0; i < 120; i++) r.frame(1000 / 60);
  assert.ok(Math.abs(r.loop.fps - 60) <= 1, `fps=${r.loop.fps}`);
  const s = rig();
  s.stepCost = 2; // each step takes 2 ms of the fake clock
  s.loop.start();
  for (let i = 0; i < 120; i++) s.frame(1000 / 60);
  assert.ok(Math.abs(s.loop.tickMs - 2) < 0.01, `tickMs=${s.loop.tickMs}`);
});

test('tps is configurable', () => {
  const r = rig({ tps: 10 });
  r.loop.start();
  for (let i = 0; i < 60; i++) r.frame(1000 / 60);
  assert.ok(Math.abs(r.steps - 10) <= 1, `steps=${r.steps}`);
});

test('the defaults do not touch the DOM until start() (Node can import and build a loop)', () => {
  assert.doesNotThrow(() => createLoop({ step() {}, render() {} }));
});
