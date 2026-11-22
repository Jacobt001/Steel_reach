// Home Screen icons are generated, not shipped as binaries: no image tooling needed and the repo stays text-only.
import { deflateSync } from 'node:zlib';

const BG = [18, 24, 21], FG = [126, 200, 140], HOLE = BG;

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

// A gear: disc with 8 teeth (radius modulated by angle) and a hole, all decided per pixel.
// The mark stays inside ~70% of the canvas so iOS's rounded-corner mask never clips a tooth.
export function makeIcon(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2, body = size * 0.26, tooth = size * 0.34, hole = size * 0.11;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
      const toothOn = Math.cos(Math.atan2(dy, dx) * 8) > 0.35;
      const edge = toothOn ? tooth : body;
      const px = d < hole ? HOLE : d < edge ? FG : BG;
      raw.set(px, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
