import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createGestures } from '../src/input/gestures.js'; import { dragPath, lPath, pathDirs } from '../src/input/paths.js';
import { createTools } from '../src/input/tools.js'; import { createCamera, worldToScreen } from '../src/render/camera.js';
import { testGame } from './helpers.js';
const rec = () => { const log = []; return [log, new Proxy({}, { get: (_, k) => (...a) => log.push(k) })]; };
test('tap, double tap, drag', () => {
  const [log, h] = rec(); const g = createGestures(h);
  g.down({id:1,x:10,y:10,t:0}); g.up({id:1,x:10,y:10,t:50}); g.down({id:1,x:12,y:11,t:200}); g.up({id:1,x:12,y:11,t:250});
  g.down({id:1,x:0,y:0,t:1000}); g.move({id:1,x:30,y:0,t:1050}); g.up({id:1,x:30,y:0,t:1100});
  assert.deepEqual(log, ['tap', 'doubleTap', 'dragStart', 'dragMove', 'dragEnd']);
});
test('paths', () => {
  assert.deepEqual(dragPath([[0,0],[0,0],[1,1]]), [[0,0],[1,0],[1,1]]);
  assert.deepEqual(lPath([0,0],[2,1]), [[0,0],[1,0],[2,0],[2,1]]); assert.deepEqual(lPath([0,0],[2,1],true), [[0,0],[0,1],[1,1],[2,1]]);
  assert.deepEqual(pathDirs([[0,0],[1,0],[1,1]]), [1,2,2]);
});
test('Review Focus 2: second finger mid belt-drag cancels without placing belts', () => {
  const game = testGame(); const cam = createCamera(390, 700); const t = createTools({ game, cam, ui: { inspect(){}, toast(){} }, sfx: { play(){} } });
  t.setTool('belt'); const [ax, ay] = worldToScreen(cam, 79.5, 76.5), [bx] = worldToScreen(cam, 84.5, 76.5);
  t.gestures.down({id:1,x:ax,y:ay,t:0}); t.gestures.move({id:1,x:bx,y:ay,t:100});
  t.gestures.down({id:2,x:ax,y:ay+80,t:150}); t.gestures.move({id:2,x:ax,y:ay+140,t:200});
  t.gestures.up({id:2,x:ax,y:ay+140,t:250}); t.gestures.up({id:1,x:bx,y:ay,t:300});
  assert.equal([...game.ents.values()].filter(e => e.type === 'belt').length, 0);
});

// ---------------------------------------------------------------- coverage beyond the brief

import { extendPath } from '../src/input/paths.js';
import { entAt } from '../src/game/state.js'; import { place } from '../src/game/place.js'; import { undo } from '../src/game/undo.js';
import { setOre } from './helpers.js';

// Gesture recorder that keeps the arguments, for checking coordinates and pinch values.
const recArgs = () => { const log = []; return [log, new Proxy({}, { get: (_, k) => (...a) => log.push([k, ...a]) })]; };

test('gestures: a slow or distant second tap is a plain tap; dragStart reports where the finger went down', () => {
  const [log, h] = recArgs(); const g = createGestures(h);
  g.down({id:1,x:10,y:10,t:0}); g.up({id:1,x:10,y:10,t:40});
  g.down({id:1,x:10,y:10,t:500}); g.up({id:1,x:10,y:10,t:540});          // too slow
  g.down({id:1,x:60,y:10,t:700}); g.up({id:1,x:60,y:10,t:740});          // too far (50 px)
  g.down({id:1,x:100,y:100,t:2000}); g.move({id:1,x:105,y:100,t:2010});  // 5 px: still a press
  g.move({id:1,x:109,y:100,t:2020}); g.up({id:1,x:109,y:100,t:2030});
  assert.deepEqual(log.map(e => e[0]), ['tap', 'tap', 'tap', 'dragStart', 'dragMove', 'dragEnd']);
  assert.deepEqual(log[3].slice(1, 3), [100, 100]); assert.deepEqual(log[4].slice(1, 3), [109, 100]);
});

test('gestures: second finger cancels the drag, pinches, and the lone finger waits for its lift', () => {
  const [log, h] = recArgs(); const g = createGestures(h);
  g.down({id:1,x:100,y:100,t:0}); g.move({id:1,x:130,y:100,t:10});
  g.down({id:2,x:200,y:100,t:20});                          // fingers 70 px apart, centre (165, 100)
  g.move({id:2,x:270,y:100,t:30});                          // 140 px apart, centre (200, 100)
  g.up({id:2,x:270,y:100,t:40});
  g.move({id:1,x:300,y:300,t:50}); g.move({id:1,x:10,y:10,t:60}); g.up({id:1,x:10,y:10,t:70});
  g.down({id:1,x:50,y:50,t:400}); g.up({id:1,x:50,y:50,t:420}); // a fresh tap works again
  assert.deepEqual(log.map(e => e[0]), ['dragStart', 'dragMove', 'dragCancel', 'pinch', 'tap']);
  const p = log[3][1];
  assert.equal(p.scale, 2); assert.equal(p.dx, 35); assert.equal(p.dy, 0); assert.equal(p.cx, 200); assert.equal(p.cy, 100);
});

test('gestures: pointercancel ends a drag with dragCancel, and a pinch never ends in a tap', () => {
  const [log, h] = rec(); const g = createGestures(h);
  g.down({id:1,x:0,y:0,t:0}); g.move({id:1,x:20,y:0,t:10}); g.cancel({id:1,x:20,y:0,t:20});
  g.down({id:3,x:0,y:0,t:100}); g.down({id:4,x:50,y:0,t:110}); g.up({id:4,x:50,y:0,t:120}); g.up({id:3,x:0,y:0,t:130});
  g.up({id:9,x:0,y:0,t:140}); // a lift we never saw go down (it started on the UI) is ignored
  assert.deepEqual(log, ['dragStart', 'dragMove', 'dragCancel']);
});

test('paths: fast jumps are filled, backing up retracts, single tile uses singleDir', () => {
  assert.deepEqual(dragPath([[0,0],[3,1]]), [[0,0],[1,0],[2,0],[3,0],[3,1]]);
  assert.deepEqual(dragPath([[0,0],[2,2]]), [[0,0],[1,0],[1,1],[2,1],[2,2]]);
  assert.deepEqual(lPath([4,4],[4,4]), [[4,4]]);
  assert.deepEqual(pathDirs([[5,5]], 3), [3]); assert.deepEqual(pathDirs([[1,1],[1,0]]), [0,0]);
  const p = [[0,0]];
  assert.equal(extendPath(p, [2,0]), 2); assert.deepEqual(p, [[0,0],[1,0],[2,0]]);
  assert.equal(extendPath(p, [1,0]), 0); assert.deepEqual(p, [[0,0],[1,0]]);
  assert.equal(extendPath(p, [1,0]), 0); assert.deepEqual(p, [[0,0],[1,0]]);
});

// Tools harness: a test game, a 390x700 phone camera, and logs of what the tools asked of ui and sfx.
function mk(at = [80, 80]) {
  const game = testGame(); const cam = createCamera(390, 700); cam.x = at[0]; cam.y = at[1];
  const log = { sfx: [], toast: [], inspect: [] };
  const t = createTools({ game, cam, ui: { inspect: (e) => log.inspect.push(e), toast: (s) => log.toast.push(s) }, sfx: { play: (n) => log.sfx.push(n) } });
  return { game, cam, t, log };
}
let clock = 0; // every gesture starts well after the last one, so double-tap windows never join them
const centre = (cam, x, y) => worldToScreen(cam, x + 0.5, y + 0.5);
// Drags must stay on screen (more than 32 px from an edge) or edge auto-pan joins in.
const look = (h, x, y) => { h.cam.x = x; h.cam.y = y; };
function tap(h, x, y) {
  const [sx, sy] = centre(h.cam, x, y); clock += 1000;
  h.t.gestures.down({id:1,x:sx,y:sy,t:clock}); h.t.gestures.up({id:1,x:sx,y:sy,t:clock+40});
}
function doubleTap(h, x, y) {
  const [sx, sy] = centre(h.cam, x, y); clock += 1000;
  h.t.gestures.down({id:1,x:sx,y:sy,t:clock}); h.t.gestures.up({id:1,x:sx,y:sy,t:clock+40});
  h.t.gestures.down({id:1,x:sx,y:sy,t:clock+150}); h.t.gestures.up({id:1,x:sx,y:sy,t:clock+190});
}
// Drags through tile centres; `lift: false` leaves the finger down.
function drag(h, tiles, { lift = true } = {}) {
  clock += 1000; const pts = tiles.map(([x, y]) => centre(h.cam, x, y));
  h.t.gestures.down({id:1,x:pts[0][0],y:pts[0][1],t:clock});
  pts.slice(1).forEach(([x, y], i) => h.t.gestures.move({id:1,x,y,t:clock+16*(i+1)}));
  const [lx, ly] = pts[pts.length - 1];
  if (lift) h.t.gestures.up({id:1,x:lx,y:ly,t:clock+16*pts.length});
}
const belts = (game) => [...game.ents.values()].filter(e => e.type === 'belt');

test('belt drag: live preview and magnifier, then one undo step along the path with ticks', () => {
  const h = mk([71, 71]); h.t.setTool('belt');
  drag(h, [[70,70],[71,70],[72,70],[72,71]], { lift: false });
  assert.deepEqual(h.t.view.beltPreview.map(p => [p.x, p.y, p.dir, p.bad]), [[70,70,1,false],[71,70,1,false],[72,70,2,false],[72,71,2,false]]);
  const [fx, fy] = centre(h.cam, 72, 71);
  assert.deepEqual(h.t.view.magnifier, { x: fx, y: fy, tile: [72, 71] });
  assert.equal(belts(h.game).length, 0, 'nothing is placed before the finger lifts');
  h.t.gestures.up({id:1,x:fx,y:fy,t:clock+100});
  assert.deepEqual(belts(h.game).map(e => [e.x, e.y, e.dir]).sort(), [[70,70,1],[71,70,1],[72,70,2],[72,71,2]]);
  assert.equal(h.game.undo.length, 1);
  assert.equal(h.log.sfx.filter(s => s === 'tick').length, 4); assert.equal(h.log.sfx.at(-1), 'place');
  assert.equal(h.t.view.beltPreview, null); assert.equal(h.t.view.magnifier, null);
});

test('belt drag: backing up retracts the path, so a mis-drawn tile is never placed', () => {
  const h = mk([71, 71]); h.t.setTool('belt');
  drag(h, [[70,70],[71,70],[72,70],[71,70]]);
  assert.deepEqual(belts(h.game).map(e => [e.x, e.y, e.dir]).sort(), [[70,70,1],[71,70,1]]);
});

test('belt drag: red where a machine is in the way, and the machine survives', () => {
  const h = mk([74, 71]); h.t.setTool('belt'); place(h.game, 'furnace', 74, 70);
  drag(h, [[72,70],[73,70],[74,70],[75,70],[76,70]], { lift: false });
  assert.deepEqual(h.t.view.beltPreview.map(p => p.bad), [false, false, true, true, false]);
  const [fx, fy] = centre(h.cam, 76, 70); h.t.gestures.up({id:1,x:fx,y:fy,t:clock+200});
  assert.equal(entAt(h.game, 74, 70).type, 'furnace');
  assert.deepEqual(belts(h.game).map(e => e.x).sort(), [72, 73, 76]);
});

test('belt drag fully blocked: warn and toast the reason, nothing recorded', () => {
  const h = mk([61, 61]); h.t.setTool('belt'); place(h.game, 'fabricator', 60, 60, { recipe: 'motor' });
  drag(h, [[60,60],[61,60],[62,60]]);
  assert.equal(h.log.sfx.at(-1), 'warn'); assert.deepEqual(h.log.toast, ['Tile is occupied']);
  assert.equal(h.game.undo.length, 0); // the refused drag left no empty undo step
});

test('Review Focus 2: the cancelled drag clears preview and magnifier; the lone finger draws nothing', () => {
  const h = mk([71, 71]); h.t.setTool('belt'); const g = h.t.gestures;
  const [ax, ay] = centre(h.cam, 70, 70), [bx] = centre(h.cam, 73, 70);
  g.down({id:1,x:ax,y:ay,t:0}); g.move({id:1,x:bx,y:ay,t:50});
  assert.ok(h.t.view.beltPreview && h.t.view.magnifier);
  g.down({id:2,x:ax,y:ay+100,t:100});
  assert.equal(h.t.view.beltPreview, null); assert.equal(h.t.view.magnifier, null);
  g.up({id:2,x:ax,y:ay+100,t:150});
  g.move({id:1,x:ax,y:ay+200,t:200}); g.move({id:1,x:ax+150,y:ay+200,t:250});
  assert.equal(h.t.view.beltPreview, null); assert.equal(h.t.view.magnifier, null);
  g.up({id:1,x:ax+150,y:ay+200,t:300});
  assert.equal(belts(h.game).length, 0); assert.equal(h.game.undo.length, 0);
  drag(h, [[70,70],[71,70]]); // the next one-finger drag draws normally
  assert.equal(belts(h.game).length, 2);
});

test('two-tap belt: double-tap marks the start, a tap previews the L, flip swaps the corner, confirm places one step', () => {
  const h = mk([61, 61]); h.t.setTool('belt');
  doubleTap(h, 60, 60);
  assert.deepEqual(h.t.view.beltPreview.map(p => [p.x, p.y]), [[60,60]]);
  assert.deepEqual([h.t.view.selected.x, h.t.view.selected.y, h.t.view.selected.w, h.t.view.selected.h], [60, 60, 1, 1]);
  tap(h, 63, 62);
  assert.deepEqual(h.t.view.beltPreview.map(p => [p.x, p.y, p.dir]), [[60,60,1],[61,60,1],[62,60,1],[63,60,2],[63,61,2],[63,62,2]]);
  h.t.flip();
  assert.deepEqual(h.t.view.beltPreview.map(p => [p.x, p.y, p.dir]), [[60,60,2],[60,61,2],[60,62,1],[61,62,1],[62,62,1],[63,62,1]]);
  assert.equal(belts(h.game).length, 0);
  h.t.confirm();
  assert.equal(belts(h.game).length, 6); assert.equal(h.game.undo.length, 1); assert.equal(h.log.sfx.at(-1), 'place');
  assert.equal(h.t.view.beltPreview, null); assert.equal(h.t.view.selected, null);
  undo(h.game); assert.equal(belts(h.game).length, 0);
});

test('two-tap belt: a new tap re-aims the end; a drag drops the pending preview', () => {
  const h = mk([61, 61]); h.t.setTool('belt');
  doubleTap(h, 60, 60); tap(h, 62, 60); tap(h, 60, 63);
  assert.deepEqual(h.t.view.beltPreview.map(p => [p.x, p.y]), [[60,60],[60,61],[60,62],[60,63]]);
  drag(h, [[58,58],[59,58]]);
  assert.equal(belts(h.game).length, 2); h.t.confirm(); assert.equal(belts(h.game).length, 2);
});

test('two-tap belt fully blocked: confirm warns and keeps the preview up to re-aim', () => {
  const h = mk([61, 61]); h.t.setTool('belt'); place(h.game, 'fabricator', 60, 60, { recipe: 'motor' });
  doubleTap(h, 60, 60); tap(h, 62, 60);
  assert.deepEqual(h.t.view.beltPreview.map(p => p.bad), [true, true, true]);
  h.t.confirm();
  assert.equal(h.log.sfx.at(-1), 'warn'); assert.deepEqual(h.log.toast, ['Tile is occupied']);
  assert.equal(h.t.view.beltPreview.length, 3); assert.equal(h.game.undo.length, 0);
  tap(h, 60, 63); h.t.confirm(); // re-aimed past the fabricator: the free tile is placed
  assert.deepEqual(belts(h.game).map(e => [e.x, e.y, e.dir]), [[60, 63, 2]]); assert.equal(h.log.sfx.at(-1), 'place');
  assert.equal(h.t.view.beltPreview, null); assert.equal(h.t.view.selected, null);
});

test('single belt tap: one-tile preview uses the last rotation; confirm places it', () => {
  const h = mk([42, 42]); h.t.setTool('belt');
  tap(h, 40, 40); assert.deepEqual(h.t.view.beltPreview.map(p => [p.x, p.y, p.dir]), [[40,40,1]]);
  h.t.rotate(); assert.equal(h.t.view.beltPreview[0].dir, 2);
  h.t.confirm(); assert.equal(entAt(h.game, 40, 40).dir, 2);
  // A drag that never leaves its tile is one belt in the last rotation.
  const [cx, cy] = centre(h.cam, 44, 44); clock += 1000;
  h.t.gestures.down({id:1,x:cx-15,y:cy,t:clock}); h.t.gestures.move({id:1,x:cx+15,y:cy,t:clock+16}); h.t.gestures.up({id:1,x:cx+15,y:cy,t:clock+32});
  assert.equal(entAt(h.game, 44, 44).dir, 2);
  tap(h, 41, 43); assert.equal(h.t.view.beltPreview[0].dir, 2, 'rotation is remembered');
});

test('machine ghost: centred on the tap, a tap inside keeps it, a drag moves it, confirm places and the ghost stays', () => {
  const h = mk([51, 50]); h.t.setTool('furnace');
  tap(h, 50, 50);
  assert.deepEqual(h.t.view.ghost, { type: 'furnace', x: 49, y: 49, ok: true, reason: null, recipe: null });
  tap(h, 49, 49); assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [49, 49]);
  drag(h, [[49,49],[50,49],[52,50]]);  // grabbed by its top-left tile, so it keeps that offset
  assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [52, 50]);
  assert.equal(h.game.ents.size, 1, 'dragging never places');
  h.t.confirm();
  const f = entAt(h.game, 52, 50); assert.equal(f.type, 'furnace'); assert.equal([f.x, f.y].join(), '52,50');
  assert.equal(h.game.undo.length, 1); assert.equal(h.log.sfx.at(-1), 'place');
  assert.ok(h.t.view.ghost); assert.equal(h.t.view.ghost.ok, false); assert.equal(h.t.view.ghost.reason, 'Tile is occupied');
  h.t.confirm();
  assert.equal(h.log.sfx.at(-1), 'warn'); assert.deepEqual(h.log.toast, ['Tile is occupied']); assert.equal(h.game.undo.length, 1);
  look(h, 31, 30); drag(h, [[30,30],[31,30]]); // a drag that starts off the ghost brings it to the finger, centred
  assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [30, 29]);
  h.t.cancel(); assert.equal(h.t.view.ghost, null);
});

test('machine ghost: 3x3 centring, map-edge clamp, recipe and miner ore for the art', () => {
  const h = mk(); h.t.setTool('fabricator');
  tap(h, 50, 50); assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [49, 49]);
  assert.equal(h.t.view.ghost.recipe, 'motor');
  h.cam.x = 2; h.cam.y = 2; // look at the map corner
  tap(h, 0, 0); assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y, h.t.view.ghost.ok], [0, 0, true]);
  h.cam.x = 80; h.cam.y = 80;
  h.t.setTool('miner'); setOre(h.game, 40, 40, 2, 2, 'iron_ore');
  tap(h, 41, 41); assert.equal(h.t.view.ghost.ore, 'iron_ore'); assert.equal(h.t.view.ghost.ok, true);
  tap(h, 61, 61); assert.equal(h.t.view.ghost.ok, false); assert.equal(h.t.view.ghost.reason, 'Miners need an ore tile');
});

test('tunnel: entrance ghost plus highlighted exits; tapping an exit places the pair as one step', () => {
  const h = mk([43, 40]); h.t.setTool('tunnel');
  tap(h, 40, 40);
  assert.deepEqual(h.t.view.ghost, { type: 'tunnel', x: 40, y: 40, dir: 1, ok: true, reason: null });
  assert.deepEqual(h.t.view.tunnelExits, [[42,40],[43,40],[44,40],[45,40]]);
  tap(h, 40, 40); assert.ok(h.t.view.ghost, 'tapping the entrance again keeps it');
  tap(h, 46, 40);
  assert.equal(h.log.sfx.at(-1), 'warn'); assert.deepEqual(h.log.toast, ['Too far for a tunnel']); assert.ok(h.t.view.tunnelExits);
  tap(h, 43, 40);
  assert.equal(entAt(h.game, 40, 40).type, 'tunnel_in'); assert.equal(entAt(h.game, 43, 40).type, 'tunnel_out');
  assert.equal(entAt(h.game, 40, 40).dir, 1); assert.equal(h.game.undo.length, 1); assert.equal(h.log.sfx.at(-1), 'place');
  assert.equal(h.t.view.ghost, null); assert.equal(h.t.view.tunnelExits, null);
});

test('tunnel: rotate re-aims the exits, an off-line tap moves the entrance, confirm explains what to do', () => {
  const h = mk([45, 45]); h.t.setTool('tunnel');
  tap(h, 40, 40); h.t.rotate();
  assert.equal(h.t.view.ghost.dir, 2); assert.deepEqual(h.t.view.tunnelExits, [[40,42],[40,43],[40,44],[40,45]]);
  tap(h, 50, 50); assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [50, 50]);
  h.t.confirm(); assert.equal(h.log.sfx.at(-1), 'warn'); assert.deepEqual(h.log.toast, ['Tap a highlighted exit']);
  // A drag works like a tap at the lift point, so the exit can be picked with the magnifier.
  look(h, 50, 52); drag(h, [[50,51],[50,52],[50,53]]);
  assert.equal(entAt(h.game, 50, 53).type, 'tunnel_out');
  place(h.game, 'furnace', 20, 20); tap(h, 20, 20);
  assert.equal(h.t.view.ghost.ok, false); assert.equal(h.t.view.ghost.reason, 'Tile is occupied'); assert.equal(h.t.view.tunnelExits, null);
});

test('erase: a tap is one step; a drag erases live and undoes as one step', () => {
  const h = mk([32, 32]);
  for (let x = 30; x < 34; x++) place(h.game, 'belt', x, 30, { dir: 1 });
  place(h.game, 'belt', 30, 36, { dir: 1 });
  h.game.undo.length = 0;
  h.t.setTool('erase');
  tap(h, 30, 36); assert.equal(entAt(h.game, 30, 36), null); assert.equal(h.game.undo.length, 1); assert.equal(h.log.sfx.at(-1), 'erase');
  drag(h, [[30,30],[31,30]], { lift: false });
  assert.equal(entAt(h.game, 30, 30), null, 'erased as the finger passes');
  const [fx, fy] = centre(h.cam, 33, 30); h.t.gestures.move({id:1,x:fx,y:fy,t:clock+100}); // skips 32: filled in
  h.t.gestures.up({id:1,x:fx,y:fy,t:clock+120});
  assert.equal(belts(h.game).length, 0); assert.equal(h.game.undo.length, 2);
  undo(h.game); assert.equal(belts(h.game).length, 4);
  look(h, 80, 80); tap(h, 79, 79); assert.equal(entAt(h.game, 79, 79).type, 'hub');
});

test('erase drag cut short by a second finger puts back what it erased; ✕ mid-drag keeps it, undoable', () => {
  const h = mk([32, 31]); for (let x = 30; x < 34; x++) place(h.game, 'belt', x, 30, { dir: 1 });
  h.game.undo.length = 0; h.t.setTool('erase');
  drag(h, [[30,30],[31,30]], { lift: false });
  assert.equal(belts(h.game).length, 2);
  h.t.gestures.down({id:2,x:10,y:10,t:clock+100}); // the second finger meant pan/zoom, not erase
  assert.equal(belts(h.game).length, 4); assert.equal(h.game.undo.length, 0);
  h.t.gestures.up({id:2,x:10,y:10,t:clock+110}); h.t.gestures.up({id:1,x:10,y:10,t:clock+120});
  drag(h, [[30,30],[31,30]], { lift: false });
  h.t.cancel(); // ✕ (or setTool) ends the drag but keeps what it erased, as one undo step
  assert.equal(belts(h.game).length, 2); assert.equal(h.game.undo.length, 1);
  undo(h.game); assert.equal(belts(h.game).length, 4);
});

test('rotate: bridge cycles the four lane pairs, splitter turns through four directions', () => {
  const h = mk(); h.t.setTool('bridge'); tap(h, 20, 20);
  const pairs = [];
  for (let i = 0; i < 5; i++) { pairs.push([h.t.view.ghost.dirH, h.t.view.ghost.dirV]); h.t.rotate(); }
  assert.deepEqual(pairs, [[1,0],[1,2],[3,2],[3,0],[1,0]]);
  h.t.confirm(); const b = entAt(h.game, 20, 20); assert.deepEqual([b.dirH, b.dirV], [1, 2]);
  h.t.setTool('splitter'); tap(h, 25, 25);
  const dirs = []; for (let i = 0; i < 4; i++) { dirs.push(h.t.view.ghost.dir); h.t.rotate(); }
  assert.deepEqual(dirs, [1, 2, 3, 0]); h.t.rotate();
  h.t.setTool('merger'); tap(h, 26, 26); assert.equal(h.t.view.ghost.dir, 2, 'last chosen direction carries over');
  h.t.confirm(); assert.equal(entAt(h.game, 26, 26).dir, 2);
  h.t.setTool('furnace'); tap(h, 30, 30); h.t.rotate(); assert.equal(h.t.view.ghost.dir, undefined);
});

test('R22: power overlay follows the pole/generator tools or the menu setting', () => {
  const h = mk();
  const at = (id) => { h.t.setTool(id); return h.t.view.powerOverlay; };
  assert.deepEqual(['pan', 'pole', 'generator', 'foundry', 'belt'].map(at), [false, true, true, false, false]);
  h.game.settings.powerOverlay = true; assert.equal(at('pan'), true);
});

test('pan tool: drag pans, tap inspects and selects, empty ground closes the inspector', () => {
  const h = mk(); const f = place(h.game, 'furnace', 70, 70);
  const x0 = h.cam.x; drag(h, [[78,75],[80,75]]);
  assert.ok(Math.abs(h.cam.x - (x0 - 2)) < 1e-9, 'the map follows the finger');
  h.cam.x = 80; h.cam.y = 80;
  tap(h, 71, 71); assert.equal(h.log.inspect.at(-1), f); assert.equal(h.t.view.selected, f);
  tap(h, 60, 60); assert.equal(h.log.inspect.at(-1), null); assert.equal(h.t.view.selected, null);
});

test('two-finger pinch zooms and pans in any tool, without touching a pending ghost', () => {
  const h = mk([50, 50]); h.t.setTool('furnace'); tap(h, 50, 50); const g = h.t.gestures; const c = (clock += 1000);
  g.down({id:1,x:150,y:350,t:c}); g.down({id:2,x:240,y:350,t:c+10});
  g.move({id:2,x:330,y:350,t:c+20}); g.up({id:2,x:330,y:350,t:c+30}); g.up({id:1,x:150,y:350,t:c+40});
  assert.equal(h.cam.z, 72); // doubled spread, capped at the 72 px zoom limit
  assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [49, 49]); assert.equal(h.game.ents.size, 1);
});

test('edge auto-pan: a finger held near the edge scrolls the map and keeps drawing', () => {
  const h = mk(); h.t.setTool('belt'); const g = h.t.gestures;
  const [ax, ay] = centre(h.cam, 80, 76);
  g.down({id:1,x:ax,y:ay,t:0}); g.move({id:1,x:380,y:ay,t:16}); // 10 px from the right edge
  const x0 = h.cam.x; const n0 = h.t.view.beltPreview.length;
  for (let t = 32; t <= 1000; t += 16) h.t.update(t);
  assert.ok(h.cam.x > x0 + 3, `camera scrolled right (${h.cam.x - x0} tiles)`);
  assert.ok(h.t.view.beltPreview.length > n0 + 3, 'the path grew under the still finger');
  g.move({id:1,x:200,y:ay,t:1016}); const x1 = h.cam.x; h.t.update(1100); assert.equal(h.cam.x, x1, 'stops away from the edge');
  h.t.insets.bottom = 120; g.move({id:1,x:200,y:700 - 130,t:1200}); const y1 = h.cam.y; h.t.update(1250);
  assert.ok(h.cam.y > y1, 'insets move the edge zone above the UI bar');
  g.up({id:1,x:200,y:570,t:1300});
  assert.equal(belts(h.game)[0].dir, 1);
});

test('R5: setGame drops pending state and view, keeps the tool, and builds into the new game', () => {
  const h = mk(); h.t.setTool('tunnel'); tap(h, 40, 40); h.t.view.selected = { id: 5 };
  const g2 = testGame(); h.t.setGame(g2);
  assert.equal(h.t.tool, 'tunnel');
  assert.deepEqual([h.t.view.ghost, h.t.view.tunnelExits, h.t.view.beltPreview, h.t.view.magnifier, h.t.view.selected], [null, null, null, null, null]);
  tap(h, 40, 40); tap(h, 43, 40);
  assert.equal(entAt(g2, 40, 40).type, 'tunnel_in'); assert.equal(entAt(h.game, 40, 40), null);
  g2.settings.powerOverlay = true; assert.equal(h.t.view.powerOverlay, true);
});

test('switching tools mid-drag drops the drag without placing; unknown ids fall back to pan', () => {
  const h = mk([71, 71]); h.t.setTool('belt');
  drag(h, [[70,70],[72,70]], { lift: false });
  h.t.setTool('pan'); assert.equal(h.t.view.beltPreview, null);
  h.t.gestures.up({id:1,x:0,y:0,t:clock+500});
  assert.equal(belts(h.game).length, 0);
  h.t.setTool('hub'); assert.equal(h.t.tool, 'pan'); h.t.setTool('nope'); assert.equal(h.t.tool, 'pan');
});

// Fingers land tens of ms apart, so the first one often moves past 8 px (and into a new tile)
// before the second arrives: a drag starts, then the second finger cancels it into a pinch.
function staggeredPinch(h, x, y) {
  const [sx, sy] = centre(h.cam, x, y), g = h.t.gestures, c = (clock += 1000);
  g.down({id:1,x:sx,y:sy,t:c}); g.move({id:1,x:sx+50,y:sy+10,t:c+16});
  g.down({id:2,x:sx+50,y:sy+90,t:c+30});
  g.move({id:2,x:sx+50,y:sy+150,t:c+46}); g.move({id:1,x:sx+50,y:sy-20,t:c+62});
  g.up({id:2,x:sx+50,y:sy+150,t:c+80}); g.move({id:1,x:sx+90,y:sy-20,t:c+96}); g.up({id:1,x:sx+90,y:sy-20,t:c+110});
}
const preview = (t) => t.view.beltPreview && t.view.beltPreview.map(p => [p.x, p.y, p.dir, p.bad]);

test('Fix 1: a staggered pinch keeps the two-tap start, its L preview and marker', () => {
  const h = mk([61, 61]); h.t.setTool('belt');
  doubleTap(h, 60, 60);
  staggeredPinch(h, 61, 63);
  assert.deepEqual(preview(h.t), [[60,60,1,false]]);
  assert.deepEqual([h.t.view.selected.x, h.t.view.selected.y], [60, 60]); assert.equal(h.t.view.magnifier, null);
  look(h, 61, 61); tap(h, 63, 62); const l = preview(h.t);
  look(h, 61, 61); staggeredPinch(h, 59, 64);
  assert.deepEqual(preview(h.t), l, 'the L preview survives the pinch');
  assert.deepEqual([h.t.view.selected.x, h.t.view.selected.y], [60, 60]);
  assert.ok(h.cam.z > 44, 'the pinch still zoomed');
  h.t.confirm();
  assert.equal(belts(h.game).length, 6); assert.equal(h.game.undo.length, 1);
});

test('Fix 1: a staggered pinch leaves a machine ghost where it was, even one grabbed and moved', () => {
  const h = mk([60, 61]); h.t.setTool('furnace');
  tap(h, 60, 60); assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [59, 59]);
  staggeredPinch(h, 58, 64);
  assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y, h.t.view.ghost.ok], [59, 59, true]);
  look(h, 60, 61); staggeredPinch(h, 59, 59); // grabbed by its own tile, dragged a tile, then pinched
  assert.deepEqual([h.t.view.ghost.x, h.t.view.ghost.y], [59, 59]);
  h.t.setTool('assembler'); look(h, 60, 61); staggeredPinch(h, 60, 60);
  assert.equal(h.t.view.ghost, null, 'no ghost before, none after');
  assert.equal(h.game.ents.size, 1);
});

test('Fix 1: a staggered pinch keeps a pending tunnel entrance and its exits', () => {
  const h = mk([42, 42]); h.t.setTool('tunnel');
  tap(h, 40, 40); const exits = h.t.view.tunnelExits;
  staggeredPinch(h, 41, 43);
  assert.deepEqual(h.t.view.ghost, { type: 'tunnel', x: 40, y: 40, dir: 1, ok: true, reason: null });
  assert.deepEqual(h.t.view.tunnelExits, exits); assert.equal(h.game.ents.size, 1);
  look(h, 42, 42); tap(h, 43, 40);
  assert.equal(entAt(h.game, 43, 40).type, 'tunnel_out');
});

test('Fix 1: a staggered pinch with no pending state places, erases and previews nothing', () => {
  const h = mk([61, 61]); place(h.game, 'belt', 61, 61, { dir: 1 }); place(h.game, 'belt', 62, 61, { dir: 1 });
  h.t.setTool('belt'); staggeredPinch(h, 60, 60);
  assert.equal(h.t.view.beltPreview, null); assert.equal(belts(h.game).length, 2); assert.equal(h.game.undo.length, 0);
  h.t.setTool('erase'); look(h, 61, 61); staggeredPinch(h, 61, 61);
  assert.equal(belts(h.game).length, 2); assert.equal(h.game.undo.length, 0);
  assert.equal(entAt(h.game, 61, 61).dir, 1);
});
