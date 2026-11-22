// Save codes: 'SR1.' + base64url(deflate-raw(JSON)). Text-only so it survives the clipboard and a
// paste box; base64url so it has no '+', '/' or '=' that chat apps or URL handling might mangle.
const PREFIX = 'SR1.';
const notACode = () => new Error('Not a Steelreach save code');

// Blob.stream().pipeThrough() rather than a hand-held writer: a writer's write/close promises
// reject separately on bad input and would surface as unhandled rejections.
async function transform(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Chunked: fromCharCode(...bytes) on a big save overflows the call stack (and engines cap the
// argument count), so the binary string is built a slice at a time.
function toBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  // atob is lenient about some malformed input, so the alphabet and length are checked first.
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw notACode();
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeSaveCode(obj) {
  const packed = await transform(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64url(packed);
}

export async function decodeSaveCode(str) {
  try {
    if (typeof str !== 'string') throw notACode();
    // All whitespace, not just the ends: a pasted code can pick up line breaks in the middle,
    // and the base64url alphabet has none of its own.
    const s = str.replace(/\s+/g, '');
    if (!s.startsWith(PREFIX)) throw notACode();
    const bytes = await transform(fromBase64url(s.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    const obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // Only the outer shape is checked here; tryLoad judges the contents (and newer versions).
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.v !== 'number') throw notACode();
    return obj;
  } catch {
    // One message for every failure: the player only needs to know the paste wasn't a save.
    throw notACode();
  }
}
