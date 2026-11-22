// The view onto the map. World units are tiles; z is CSS pixels per tile; (x, y) is the world
// point at the centre of the screen, so zooming and resizing never need a separate offset.
import { TILE, ZOOM_MIN_PX, ZOOM_MAX_PX, MAP, CENTER } from '../config.js';

// Panning may show this many tiles past the map edge, so an edge tile is never stuck under
// the screen border or a toolbar.
const EDGE = 3;

export function createCamera(vw, vh) {
  return { x: CENTER.x, y: CENTER.y, z: TILE, vw, vh };
}

export function worldToScreen(cam, wx, wy) {
  return [(wx - cam.x) * cam.z + cam.vw / 2, (wy - cam.y) * cam.z + cam.vh / 2];
}

export function screenToWorld(cam, sx, sy) {
  return [(sx - cam.vw / 2) / cam.z + cam.x, (sy - cam.vh / 2) / cam.z + cam.y];
}

export function screenToTile(cam, sx, sy) {
  const [wx, wy] = screenToWorld(cam, sx, sy);
  return [Math.floor(wx), Math.floor(wy)];
}

// Pinch zoom: the world point under the fingers stays put, so the map never slides away from them.
export function zoomAt(cam, factor, sx, sy) {
  const [wx, wy] = screenToWorld(cam, sx, sy);
  cam.z = Math.min(ZOOM_MAX_PX, Math.max(ZOOM_MIN_PX, cam.z * factor));
  cam.x = wx - (sx - cam.vw / 2) / cam.z;
  cam.y = wy - (sy - cam.vh / 2) / cam.z;
  clampCam(cam);
}

// dx, dy are the finger's movement in screen pixels; the map follows the finger.
export function panBy(cam, dx, dy) {
  cam.x -= dx / cam.z;
  cam.y -= dy / cam.z;
  clampCam(cam);
}

// A view wider than the map plus both margins just centres; otherwise each screen edge stays
// within EDGE tiles of the map.
function clampAxis(c, half) {
  const lo = half - EDGE, hi = MAP + EDGE - half;
  return lo > hi ? MAP / 2 : Math.min(hi, Math.max(lo, c));
}

export function clampCam(cam) {
  cam.x = clampAxis(cam.x, cam.vw / 2 / cam.z);
  cam.y = clampAxis(cam.y, cam.vh / 2 / cam.z);
}

// Inclusive tile range on screen, widened by margin and clipped to the map (empty when x0 > x1).
// The renderer passes its own out object so the per-frame call allocates nothing.
export function visibleTiles(cam, margin = 0, out = {}) {
  const hw = cam.vw / 2 / cam.z, hh = cam.vh / 2 / cam.z;
  out.x0 = Math.max(0, Math.floor(cam.x - hw) - margin);
  out.y0 = Math.max(0, Math.floor(cam.y - hh) - margin);
  out.x1 = Math.min(MAP - 1, Math.floor(cam.x + hw) + margin);
  out.y1 = Math.min(MAP - 1, Math.floor(cam.y + hh) + margin);
  return out;
}
