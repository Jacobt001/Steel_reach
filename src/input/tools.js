// What a tap, drag or pinch means for the selected build tool. DOM-free: main.js feeds pointer
// events to `gestures`, the renderer draws `view`, and ui.js drives setTool/rotate/confirm/cancel/flip.
import { BUILDINGS, MAP, DX, DY } from '../config.js';
import { screenToTile, panBy, zoomAt } from '../render/camera.js';
import { canPlace, place, placeTunnel, validTunnelExits, placeBeltPath, erase, defaultRecipe } from '../game/place.js';
import { doAction, actionGroup } from '../game/undo.js';
import { entAt, sizeOf } from '../game/state.js';
import { idx } from '../world.js';
import { createGestures } from './gestures.js';
import { dragPath, extendPath, lPath, pathDirs } from './paths.js';

const EDGE_PX = 32;
// Auto-pan speed in screen px/s, from the zone's inner line to the very edge. Screen px rather
// than tiles, so zooming out for a long haul also makes the scroll cover more ground.
const EDGE_SLOW = 120, EDGE_FAST = 480;
// A drag that starts inside the edge zone (or an erase, never) must not scroll the map away at
// once; it waits this long, or until the finger has been out of the zone once.
const EDGE_DWELL_MS = 250;
const MAX_STEP_MS = 50; // a stalled frame or late event must not fling the map
// Clockwise quarter turns of a bridge: each turn moves the east/west lane onto north/south and back.
const BRIDGE_TURNS = [[1, 0], [1, 2], [3, 2], [3, 0]];

const kindOf = (id) => (id === 'pan' || id === 'erase' || id === 'belt' || id === 'tunnel' ? id : 'ghost');
const validTool = (id) => id === 'pan' || id === 'erase' || (id !== 'hub' && Object.hasOwn(BUILDINGS, id));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const speedAt = (depth) => EDGE_SLOW + (EDGE_FAST - EDGE_SLOW) * Math.min(1, depth);

// Signed auto-pan speed for one axis: negative near the low edge, positive near the high edge.
function edgeSpeed(p, lo, hi) {
  if (p < lo + EDGE_PX) return -speedAt((lo + EDGE_PX - p) / EDGE_PX);
  if (p > hi - EDGE_PX) return speedAt((p - (hi - EDGE_PX)) / EDGE_PX);
  return 0;
}

export function createTools({ game, cam, ui, sfx }) {
  let tool = 'pan';
  let rot = 1;         // last direction chosen; shared by belts, splitters, mergers and tunnels
  let bridgeTurn = 0;
  let drag = null;     // the drag in progress; null once it ended, was cancelled or was dropped
  let pending = null;  // belt tap preview: {start: [x, y] | null, end: [x, y], flip}
  let marker = null;   // outline on the two-tap start, drawn through view.selected
  let tunnelIn = null; // [x, y] of the pending tunnel entrance
  let clock = 0;       // last time autoPan saw (pointer timeStamp and rAF time share a base)
  // Canvas CSS px hidden under the UI (top bar, build bar, safe areas): the edge zone sits just
  // inside what the player can see, not under a toolbar.
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  const view = {
    ghost: null, beltPreview: null, tunnelExits: null, selected: null, magnifier: null,
    // A getter, so the Menu toggle (game.settings) shows without telling the tools (R22).
    get powerOverlay() { return tool === 'pole' || tool === 'generator' || !!game.settings.powerOverlay; },
  };

  const play = (name) => sfx?.play?.(name);
  function refuse(reason) { play('warn'); ui?.toast?.(reason); }

  // ------------------------------------------------------------ machine ghost

  function setGhost(x, y) {
    const { w, h } = sizeOf(tool);
    // An edge tap slides the footprint inward rather than hanging it off the map.
    x = clamp(x, 0, MAP - w); y = clamp(y, 0, MAP - h);
    const c = canPlace(game, tool, x, y);
    const g = { type: tool, x, y, ok: c.ok, reason: c.ok ? null : c.reason, recipe: defaultRecipe(game, tool) };
    if (tool === 'bridge') [g.dirH, g.dirV] = BRIDGE_TURNS[bridgeTurn];
    else if (BUILDINGS[tool].dir) g.dir = rot;
    if (tool === 'miner') g.ore = oreUnder(x, y, w, h);
    view.ghost = g;
  }

  // Only picks the art; canPlace already decided whether this ore mix is allowed.
  function oreUnder(x, y, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const o = game.world.ore[idx(x + i, y + j)];
      if (o) return o;
    }
    return null;
  }

  function inGhost(tx, ty) {
    const g = view.ghost;
    if (!g) return false;
    const { w, h } = sizeOf(g.type);
    return tx >= g.x && ty >= g.y && tx < g.x + w && ty < g.y + h;
  }

  function placeGhost() {
    const g = view.ghost;
    const opts = g.type === 'bridge' ? { dirH: g.dirH, dirV: g.dirV } : { dir: g.dir };
    if (doAction(game, () => place(game, g.type, g.x, g.y, opts))) play('place');
    else refuse(canPlace(game, g.type, g.x, g.y).reason ?? "Can't build here");
    // The ghost stays put so a row of machines is tap, ✓, tap, ✓; it now shows red until moved.
    setGhost(g.x, g.y);
  }

  // ------------------------------------------------------------ belts

  // Mirrors placeBeltPath: belts and bridges get re-pointed or bridged; anything else is skipped.
  function beltBlocked(x, y) {
    const e = entAt(game, x, y);
    if (e) return e.type !== 'belt' && e.type !== 'bridge';
    return !canPlace(game, 'belt', x, y).ok;
  }

  function showBelt(path) {
    const dirs = pathDirs(path, rot);
    view.beltPreview = path.map(([x, y], i) => ({ x, y, dir: dirs[i], bad: beltBlocked(x, y) }));
  }

  // Returns whether anything was placed.
  function placePath(path) {
    const res = doAction(game, () => placeBeltPath(game, path, pathDirs(path, rot)));
    if (res.placed) { play('place'); return true; }
    refuse(canPlace(game, 'belt', res.skipped[0][0], res.skipped[0][1]).reason ?? "Can't build here");
    return false;
  }

  const pendingPath = () => (pending.start ? lPath(pending.start, pending.end, pending.flip) : [pending.end]);

  function setPending(p) {
    pending = p;
    if (marker && view.selected === marker) view.selected = null;
    marker = null;
    if (!p) { view.beltPreview = null; return; }
    // A plain tap also previews one tile, so the start gets an outline to show the double tap took.
    if (p.start) view.selected = marker = { x: p.start[0], y: p.start[1], w: 1, h: 1 };
    showBelt(pendingPath());
  }

  // A double tap arrives as a tap and then a doubleTap on the same tile, so by then the end is
  // already there: what matters is where the end was before the pair began. Double-tapping the
  // existing end point (a fumbled confirm) must not collapse the line to one tile at that spot.
  let endBeforeTap = null;
  function beltTap(tx, ty, double) {
    if (double && !(pending?.start && endBeforeTap && endBeforeTap[0] === tx && endBeforeTap[1] === ty)) {
      setPending({ start: [tx, ty], end: [tx, ty], flip: false });
      return;
    }
    if (!double) endBeforeTap = pending ? pending.end : null;
    if (pending && pending.start) setPending({ ...pending, end: [tx, ty] });
    else setPending({ start: null, end: [tx, ty], flip: false });
  }

  // ------------------------------------------------------------ tunnels

  function setEntrance(x, y) {
    const c = canPlace(game, 'tunnel_in', x, y);
    view.ghost = { type: 'tunnel', x, y, dir: rot, ok: c.ok, reason: c.ok ? null : c.reason };
    tunnelIn = c.ok ? [x, y] : null;
    view.tunnelExits = c.ok ? validTunnelExits(game, x, y, rot) : null;
  }

  function tunnelTap(tx, ty) {
    if (tunnelIn) {
      const [x, y] = tunnelIn, dx = tx - x, dy = ty - y;
      if (dx === 0 && dy === 0) return; // a re-tap or the second half of a double tap
      // In line ahead means the player aimed at an exit: place it or say why not (too far,
      // occupied). Anywhere else moves the entrance.
      if (dx * DY[rot] + dy * DX[rot] === 0 && dx * DX[rot] + dy * DY[rot] > 0) {
        const r = doAction(game, () => placeTunnel(game, x, y, rot, tx, ty));
        if (r.ok) { play('place'); tunnelIn = null; view.ghost = null; view.tunnelExits = null; }
        else refuse(r.reason);
        return;
      }
    }
    setEntrance(tx, ty);
  }

  // ------------------------------------------------------------ gestures

  function onTap(x, y, double) {
    const [tx, ty] = screenToTile(cam, x, y);
    switch (kindOf(tool)) {
      case 'pan': {
        const ent = entAt(game, tx, ty);
        ui?.inspect?.(ent); // null on bare ground lets the UI close its inspector
        view.selected = ent;
        break;
      }
      case 'erase': if (erase(game, tx, ty)) play('erase'); break;
      case 'belt': beltTap(tx, ty, double); break;
      case 'tunnel': tunnelTap(tx, ty); break;
      default: {
        // A tap on the ghost itself (or the second half of a double tap) must not nudge it.
        if (inGhost(tx, ty)) break;
        const { w, h } = sizeOf(tool);
        setGhost(tx - (w >> 1), ty - (h >> 1));
      }
    }
  }

  // Erases during a drag record into the drag's group, so the whole gesture undoes as one step.
  const eraseTile = (x, y) => drag.group.run(() => erase(game, x, y));

  function dragStart(x, y, t) {
    endDrag();
    if (typeof t === 'number') clock = t;
    const k = kindOf(tool);
    if (k === 'pan') { drag = { kind: k, x, y }; return; }
    const [tx, ty] = screenToTile(cam, x, y);
    // Saved before anything changes: if a second finger turns this into a pinch, the drag never
    // happened (cancelDrag puts these back). A pending two-tap start must survive a pan/zoom
    // between its two taps, and fingers that land tens of ms apart often start a drag first.
    const saved = { pending, ghost: view.ghost, tunnelIn, tunnelExits: view.tunnelExits };
    drag = { kind: k, fx: x, fy: y, tx, ty, saved, armed: !edgeVel(x, y), edgeAt: null };
    view.magnifier = { x, y, tile: [tx, ty] };
    if (k === 'belt') {
      setPending(null); // drawing by hand replaces any tap preview
      drag.path = [[tx, ty]];
      play('tick');
      showBelt(drag.path);
    } else if (k === 'erase') {
      drag.group = actionGroup(game);
      if (eraseTile(tx, ty)) play('erase');
    } else if (k === 'ghost') {
      const g = view.ghost, { w, h } = sizeOf(tool);
      // Grabbing the ghost keeps the grabbed tile under the finger; starting elsewhere fetches it.
      drag.off = inGhost(tx, ty) ? [g.x - tx, g.y - ty] : [-(w >> 1), -(h >> 1)];
      setGhost(tx + drag.off[0], ty + drag.off[1]);
    }
    // Tunnel: nothing until the lift, which acts as a tap there (aim with the magnifier).
  }

  // Follows the finger in a building-tool drag.
  function dragTo(x, y) {
    const d = drag;
    d.fx = x; d.fy = y;
    const [tx, ty] = screenToTile(cam, x, y);
    view.magnifier = { x, y, tile: [tx, ty] };
    if (tx === d.tx && ty === d.ty) return;
    const from = [d.tx, d.ty];
    d.tx = tx; d.ty = ty;
    if (d.kind === 'belt') {
      const n = extendPath(d.path, [tx, ty]);
      for (let i = 0; i < n; i++) play('tick');
      showBelt(d.path);
    } else if (d.kind === 'erase') {
      // Filled in, so a fast swipe can't hop over a belt; one sound per event, not per tile.
      let any = false;
      for (const [cx, cy] of dragPath([from, [tx, ty]]).slice(1)) any = eraseTile(cx, cy) || any;
      if (any) play('erase');
    } else if (d.kind === 'ghost') setGhost(tx + d.off[0], ty + d.off[1]);
  }

  function dragMove(x, y, t) {
    if (!drag) return; // dropped by setTool/cancel/setGame while the finger stayed down
    if (drag.kind === 'pan') { panBy(cam, x - drag.x, y - drag.y); drag.x = x; drag.y = y; return; }
    dragTo(x, y);
    autoPan(t);
  }

  function dragEnd(x, y) {
    if (!drag) return;
    const d = drag;
    if (d.kind === 'pan') { panBy(cam, x - d.x, y - d.y); drag = null; return; }
    dragTo(x, y);
    drag = null;
    view.magnifier = null;
    if (d.kind === 'belt') { view.beltPreview = null; placePath(d.path); }
    else if (d.kind === 'erase') d.group.commit();
    else if (d.kind === 'tunnel') tunnelTap(d.tx, d.ty);
    // Ghost: stays where it was dropped, waiting for ✓.
  }

  // A second finger (or pointercancel) turned the drag into something else: undo everything it
  // did, including what dragStart changed, so a pinch never edits the map or loses a pending
  // ghost, two-tap start or tunnel entrance.
  function cancelDrag() {
    const d = drag;
    if (!d) return;
    drag = null;
    if (d.kind === 'pan') return; // the pinch carries on panning from here
    view.magnifier = null;
    if (d.kind === 'erase') d.group.revert();
    const s = d.saved;
    setPending(s.pending); // also clears the drag's belt preview when nothing was pending
    view.ghost = s.ghost; tunnelIn = s.tunnelIn; view.tunnelExits = s.tunnelExits;
  }

  // Ends a drag on purpose (✕, setTool, setGame) without finishing it, so nothing new is placed.
  // Erases already happened as the finger passed; they are committed so Undo can still bring
  // them back. A dragged ghost stays where it is.
  function endDrag() {
    const d = drag;
    if (!d) return;
    drag = null;
    if (d.kind === 'pan') return;
    view.magnifier = null;
    if (d.kind === 'belt') view.beltPreview = null;
    else if (d.kind === 'erase') d.group.commit();
  }

  // Shared by pointer moves and update(): one clock, so a frame and an event in the same
  // instant never both scroll for the same time.
  const edgeVel = (x, y) => [edgeSpeed(x, insets.left, cam.vw - insets.right), edgeSpeed(y, insets.top, cam.vh - insets.bottom)];

  function autoPan(t) {
    if (typeof t !== 'number') return;
    const dt = clamp(t - clock, 0, MAX_STEP_MS) / 1000;
    clock = t;
    // Erase never scrolls: sweeping a belt near the screen edge must not run away over the map.
    if (!drag || drag.kind === 'pan' || drag.kind === 'erase') return;
    const [vx, vy] = edgeVel(drag.fx, drag.fy);
    if (!vx && !vy) { drag.armed = true; drag.edgeAt = null; return; }
    if (!drag.armed) {
      // Started in the zone (a tap meant for the toolbar's neighbour tile): wait out a dwell.
      drag.edgeAt ??= t;
      if (t - drag.edgeAt < EDGE_DWELL_MS) return;
      drag.armed = true;
    }
    if (dt === 0) return;
    panBy(cam, -vx * dt, -vy * dt);
    dragTo(drag.fx, drag.fy); // the map slid under a still finger, so it may be over a new tile
  }

  // Two fingers pan and zoom in every tool; pending ghosts and previews are left alone.
  function onPinch({ cx, cy, scale, dx, dy }) {
    panBy(cam, dx, dy);
    zoomAt(cam, scale, cx, cy);
  }

  const gestures = createGestures({
    tap: (x, y) => onTap(x, y, false),
    doubleTap: (x, y) => onTap(x, y, true),
    dragStart, dragMove, dragEnd, dragCancel: cancelDrag, pinch: onPinch,
  });

  // Drops everything pending; view.selected is the UI's except for the two-tap marker.
  function clearAll() {
    endDrag();
    setPending(null);
    tunnelIn = null;
    view.ghost = null; view.tunnelExits = null; view.magnifier = null;
  }

  // Undo, the sim or another tap can change the map under a pending ghost or preview; re-check
  // so red and green stay true. Cheap: a ghost is at most 9 tiles, a preview a few hundred.
  function refresh() {
    const k = kindOf(tool);
    if (k === 'ghost' && view.ghost) setGhost(view.ghost.x, view.ghost.y);
    else if (k === 'tunnel' && tunnelIn) setEntrance(tunnelIn[0], tunnelIn[1]);
    if (view.beltPreview) for (const p of view.beltPreview) p.bad = beltBlocked(p.x, p.y);
  }

  return {
    get tool() { return tool; },
    gestures, view, insets,

    setTool(id) {
      clearAll();
      tool = validTool(id) ? id : 'pan';
    },

    rotate() {
      if (tool === 'bridge') bridgeTurn = (bridgeTurn + 1) % 4;
      else if (BUILDINGS[tool]?.dir) rot = (rot + 1) % 4;
      else return; // machines don't rotate
      const k = kindOf(tool);
      if (k === 'ghost' && view.ghost) setGhost(view.ghost.x, view.ghost.y);
      else if (k === 'tunnel' && view.ghost) setEntrance(view.ghost.x, view.ghost.y);
      else if (k === 'belt') { if (pending) setPending(pending); else if (drag?.path) showBelt(drag.path); }
    },

    confirm() {
      const k = kindOf(tool);
      if (k === 'belt' && pending) {
        // A fully blocked preview stays up so the player can re-aim it.
        if (placePath(pendingPath())) setPending(null);
      } else if (k === 'ghost' && view.ghost) placeGhost();
      else if (k === 'tunnel' && view.ghost) {
        if (!tunnelIn) refuse(view.ghost.reason);
        else refuse(view.tunnelExits.length ? 'Tap a highlighted exit' : 'No room for an exit');
      }
    },

    cancel() { clearAll(); },

    flip() { if (pending && pending.start) setPending({ ...pending, flip: !pending.flip }); },

    // New game / loaded save (R5): nothing pending may land in the new game; the tool stays.
    setGame(g) {
      clearAll();
      game = g;
      view.selected = null;
    },

    // Once per animation frame with the rAF time: keeps a finger held still at the edge
    // scrolling (phones send no pointer events for a still finger) and keeps previews honest.
    update(now) {
      autoPan(now);
      refresh();
    },
  };
}
