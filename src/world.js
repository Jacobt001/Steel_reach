// Seeded world generation: ore patches laid out by ring (brief §4).
import { MAP, CENTER, HUB, RINGS } from './config.js';

export const idx = (x, y) => y * MAP + x;
export const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP && y < MAP;

// Small, fast, good-enough PRNG; the same seed must always give the same map.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Measured from the tile's middle so the ring edges are symmetric around the Hub.
export function ringOf(x, y) {
  const d = Math.hypot(x + 0.5 - CENTER.x, y + 0.5 - CENTER.y);
  for (let i = 0; i < RINGS.length; i++) if (d < RINGS[i].r1) return i;
  return RINGS.length - 1;
}

const BASIC = ['iron_ore', 'copper_ore', 'stone', 'coal'];
const range = (rng, a, b) => a + rng() * (b - a);
const inHubZone = (x, y) => x >= HUB.x - 1 && x < HUB.x + HUB.w + 1 && y >= HUB.y - 1 && y < HUB.y + HUB.h + 1;

// Noisy-edged disc: per-tile jitter on the radius keeps patches from looking like circles.
// `keep` lets the caller clip to a ring band or refuse to touch existing ore.
function stamp(ore, rng, type, cx, cy, radius, keep) {
  const reach = Math.ceil(radius + 1);
  for (let y = Math.floor(cy) - reach; y <= Math.floor(cy) + reach; y++) {
    for (let x = Math.floor(cx) - reach; x <= Math.floor(cx) + reach; x++) {
      if (!inMap(x, y) || inHubZone(x, y)) continue;
      const jitter = (rng() - 0.5) * 1.6;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) >= radius + jitter) continue;
      if (keep && !keep(x, y)) continue;
      ore[idx(x, y)] = type;
    }
  }
}

export function generateWorld(seed) {
  const rng = mulberry32(seed);
  const ore = new Array(MAP * MAP).fill(null);

  // Ring 0 first, so nothing can overwrite it; crowded candidates are rejected and re-rolled.
  const placed = [];
  const tryPlace = (type, attempts) => {
    for (let n = 0; n < attempts; n++) {
      const ang = rng() * Math.PI * 2, dist = range(rng, 8, 14), radius = range(rng, 2.5, 3.5);
      const cx = CENTER.x + Math.cos(ang) * dist, cy = CENTER.y + Math.sin(ang) * dist;
      // Same ore needs a full 1-tile gap beyond the worst-case edge jitter (0.8 each side) or the
      // patches merge; different ores may sit close because stamp() never overwrites.
      const gap = (p) => (p.type === type ? 2.7 : 0.5);
      if (placed.some(p => Math.hypot(p.cx - cx, p.cy - cy) < p.radius + radius + gap(p))) continue;
      placed.push({ cx, cy, radius, type });
      stamp(ore, rng, type, cx, cy, radius, (x, y) => ore[idx(x, y)] === null);
      return true;
    }
    return false;
  };
  for (let round = 0; round < 2; round++) for (const t of BASIC) tryPlace(t, 500); // the guaranteed pair of each
  for (const t of BASIC) if (rng() < 0.5) tryPlace(t, 60); // optional third, only if there is room

  // Rings 1-4: big basic patches plus the ring's special ore, all clipped to the ring band.
  for (let r = 1; r < RINGS.length; r++) {
    const inBand = (x, y) => ringOf(x, y) === r;
    const scatter = (type, radius, overwrite) => {
      for (let n = 0; n < 400; n++) {
        const cx = range(rng, 0, MAP), cy = range(rng, 0, MAP);
        if (ringOf(Math.floor(cx), Math.floor(cy)) !== r) continue;
        stamp(ore, rng, type, cx, cy, radius, (x, y) => inBand(x, y) && (overwrite || ore[idx(x, y)] === null));
        return;
      }
    };
    for (const t of BASIC) {
      const count = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < count; k++) scatter(t, range(rng, 4, 7), false);
    }
    const specials = 6 + Math.floor(rng() * 5);
    for (let k = 0; k < specials; k++) scatter(RINGS[r].ore, range(rng, 2.5, 4.5), true);
  }

  return { seed, ore };
}
