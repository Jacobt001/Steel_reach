// Pointer events in, intent out (tap, double tap, drag, pinch). No DOM here: main.js feeds it
// {id, x, y, t} in canvas CSS px, so the whole thing runs in Node tests.

const DRAG_PX = 8;        // finger wobble under this is still a tap
const DOUBLE_MS = 300;    // gap from the first lift to the second press
const DOUBLE_PX = 24;     // the two presses may land this far apart and still be one double tap

const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export function createGestures(h) {
  const pts = new Map();  // id -> {x, y, sx, sy, t0}; insertion order picks the two pinch fingers
  // idle | press (one finger, not yet moved 8 px) | drag | pinch |
  // wait (fingers left over from a pinch or cancelled drag: ignored until they all lift, so a
  // lone finger can't start a stray belt drag)
  let mode = 'idle';
  let lastTap = null;     // {x, y, t} of the last plain tap (t = its lift), for double-tap detection
  let pinch = null;       // previous {cx, cy, d} of the pinch pair

  function pair() {
    const it = pts.values();
    const a = it.next().value, b = it.next().value;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: dist(a.x, a.y, b.x, b.y) };
  }

  function startPinch() {
    if (mode === 'drag') h.dragCancel();
    mode = 'pinch';
    lastTap = null; // taps either side of a pinch are not a double tap
    pinch = pair();
  }

  // Fingers lifted or cancelled: settle what's left.
  function released() {
    if (pts.size >= 2) { if (mode === 'pinch') pinch = pair(); return; }
    mode = pts.size === 0 ? 'idle' : 'wait';
    pinch = null;
  }

  return {
    down(p) {
      pts.set(p.id, { x: p.x, y: p.y, sx: p.x, sy: p.y, t0: p.t });
      if (pts.size === 1) { if (mode === 'idle') mode = 'press'; }
      else if (mode === 'pinch') pinch = pair(); // a third finger re-bases on the first two
      else startPinch();
    },

    move(p) {
      const q = pts.get(p.id);
      if (!q) return;
      q.x = p.x; q.y = p.y;
      if (mode === 'press') {
        if (dist(q.sx, q.sy, p.x, p.y) < DRAG_PX) return;
        mode = 'drag';
        lastTap = null;
        // Start where the finger went down, so the 8 px of slop never shifts the first tile.
        h.dragStart(q.sx, q.sy, p.t);
        h.dragMove(p.x, p.y, p.t);
      } else if (mode === 'drag') {
        h.dragMove(p.x, p.y, p.t);
      } else if (mode === 'pinch') {
        const now = pair(), prev = pinch;
        pinch = now;
        // Incremental values, so the camera applies each event as-is (panBy then zoomAt).
        h.pinch({ cx: now.cx, cy: now.cy, scale: prev.d > 0 ? now.d / prev.d : 1, dx: now.cx - prev.cx, dy: now.cy - prev.cy });
      }
    },

    up(p) {
      const q = pts.get(p.id);
      if (!q) return; // a lift we never saw go down (it started on the UI)
      pts.delete(p.id);
      if (mode === 'press') {
        mode = 'idle';
        // The press point, not the lift point: fingers roll a little as they lift.
        const x = q.sx, y = q.sy;
        if (lastTap && q.t0 - lastTap.t <= DOUBLE_MS && dist(lastTap.x, lastTap.y, x, y) <= DOUBLE_PX) {
          lastTap = null; // a third quick tap starts a new pair rather than another double
          h.doubleTap(x, y);
        } else {
          lastTap = { x, y, t: p.t };
          h.tap(x, y);
        }
        return;
      }
      if (mode === 'drag') { mode = 'idle'; h.dragEnd(p.x, p.y, p.t); return; }
      released();
    },

    // pointercancel: the OS took the touch (system gesture, alert), so nothing it started may land.
    cancel(p) {
      if (!pts.has(p.id)) return;
      pts.delete(p.id);
      lastTap = null;
      if (mode === 'drag') h.dragCancel();
      if (mode === 'press' || mode === 'drag') mode = pts.size ? 'wait' : 'idle';
      else released();
    },
  };
}
