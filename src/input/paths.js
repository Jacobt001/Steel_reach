// Belt paths as tile lists. Pure functions, so drag and two-tap drawing are testable without a screen.

// Steps one tile at a time from `from` to `to`, calling visit(x, y) for every tile after `from`.
// The longer axis goes first and a tie goes horizontal, so a diagonal step becomes
// horizontal-then-vertical and a fast swipe that skipped tiles becomes a staircase along the
// finger's line rather than one big corner.
function walk(from, to, visit) {
  let x = from[0], y = from[1];
  const tx = to[0], ty = to[1];
  while (x !== tx || y !== ty) {
    const dx = tx - x, dy = ty - y;
    if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
    visit(x, y);
  }
}

// Finger samples (one tile per pointer event) to a 4-connected path.
export function dragPath(cells) {
  const out = [];
  for (const c of cells) {
    if (!out.length) out.push([c[0], c[1]]);
    else walk(out[out.length - 1], c, (x, y) => out.push([x, y]));
  }
  return out;
}

// Live version of dragPath for a drag in progress: appends the tiles between the path's end and
// `cell`, except that stepping back onto the previous tile retracts the last one, so backing the
// finger up un-draws a mistake instead of laying a belt that doubles back. Returns how many
// tiles were added (for the per-tile tick sound).
export function extendPath(path, cell) {
  if (!path.length) { path.push([cell[0], cell[1]]); return 1; }
  let added = 0;
  walk(path[path.length - 1], cell, (x, y) => {
    const prev = path[path.length - 2];
    if (prev && prev[0] === x && prev[1] === y) path.pop();
    else { path.push([x, y]); added++; }
  });
  return added;
}

// Two-tap belt: one straight run, one corner, both ends included.
export function lPath(a, b, flip = false) {
  const corner = flip ? [a[0], b[1]] : [b[0], a[1]];
  const out = [[a[0], a[1]]];
  const push = (x, y) => out.push([x, y]);
  walk(a, corner, push);
  walk(corner, b, push);
  return out;
}

function dirTo(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

// Each tile points at the next one. The last tile keeps going the same way (a belt that just
// ended should carry on, not turn), and a lone tile has nothing to point at, so it takes the
// direction the player last rotated to.
export function pathDirs(path, singleDir = 1) {
  if (path.length === 0) return [];
  if (path.length === 1) return [singleDir];
  const dirs = [];
  for (let i = 0; i < path.length - 1; i++) dirs.push(dirTo(path[i], path[i + 1]));
  dirs.push(dirs[dirs.length - 1]);
  return dirs;
}
