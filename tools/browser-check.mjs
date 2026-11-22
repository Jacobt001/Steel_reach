// Real-browser check: Google Chrome with iPhone 13 emulation (WebKit can't be downloaded here, so
// Jacob's own phone is the true WebKit check). Drives both builds with real touch input through
// CDP, takes screenshots into docs/screens/, and measures fps and tick cost under the brief's
// load (3,000 buildings, 10,000 belt items). Exits non-zero on the first failed check.
import { chromium, devices } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'docs', 'screens');
const MIME = { '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

// The brief's targets. Headless Chrome rasterises on the CPU, so these are the pessimistic case.
const FPS_MIN = 55, TICK_MS_MAX = 8, SAVE_KB_MAX = 300;

const failures = [];
const log = (ok, name, info = '') => {
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}${info === '' ? '' : ' :: ' + (typeof info === 'string' ? info : JSON.stringify(info))}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = path.endsWith('/') ? path + 'index.html' : path;
    const body = await readFile(join(DIST, file));
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

async function open(scheme, target) {
  const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location().url)) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto(`${ORIGIN}/${target}/index.html#debug`);
  await page.waitForFunction(() => window.__steelreach?.game);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors, external };
}

// ---- touch helpers: real touch events through CDP, so the pointer path matches a finger
async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
}
async function drag(cdp, pts, stepMs = 16) {
  await touch(cdp, 'touchStart', [pts[0]]);
  for (const p of pts.slice(1)) { await sleep(stepMs); await touch(cdp, 'touchMove', [p]); }
  await sleep(stepMs);
  await touch(cdp, 'touchEnd', []);
}
// Viewport coordinates of a tile's centre, from the live camera and canvas rect.
const tileXY = (page, tx, ty) => page.evaluate(([tx, ty]) => {
  const { cam } = window.__steelreach, r = document.getElementById('game').getBoundingClientRect();
  return [r.left + cam.vw / 2 + (tx + 0.5 - cam.x) * cam.z, r.top + cam.vh / 2 + (ty + 0.5 - cam.y) * cam.z];
}, [tx, ty]);
const count = (page, type) => page.evaluate((t) => [...window.__steelreach.game.ents.values()].filter((e) => e.type === t).length, type);
const tool = (page, name) => page.locator(`#tools button[aria-label^="${name}"]`).tap();

// Rendering never lets a visible button shrink under Apple's 44 px target.
async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('button, textarea')]
    .filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed')
    .map((b) => [b, b.getBoundingClientRect()])
    .filter(([b, r]) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
    .map(([b, r]) => `${b.id || b.getAttribute('aria-label') || b.textContent.slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`));
}

// fps counted from the page's own rAF over `ms`, plus the loop's tick cost sampled each 250 ms.
async function measure(page, ms = 5000) {
  await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
  const ticks = [];
  for (let t = 0; t < ms; t += 250) { await sleep(250); ticks.push(await page.evaluate(() => window.__steelreach.tickMs())); }
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames; });
  return { fps: frames / (ms / 1000), tickMs: ticks.reduce((a, b) => a + b, 0) / ticks.length };
}

const shot = (page, scheme, name) => page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });

async function screens(s, scheme) {
  const { page } = s;
  const closeSheet = () => page.locator('#sheet-close').tap().then(() => sleep(250));
  // Welcome only appears over a save with progress; the first run has the hint card instead.
  await sleep(500);
  await shot(page, scheme, '1-first-run');
  log((await smallTargets(page)).length === 0, `${scheme}: first run tap targets are 44 px or bigger`, await smallTargets(page));

  // Build bar scrolls sideways: a real swipe moves scrollLeft.
  const bar = await page.evaluate(() => { const t = document.getElementById('tools'); const r = t.getBoundingClientRect(); return { sw: t.scrollWidth, cw: t.clientWidth, y: r.top + r.height / 2, w: r.width, l: r.left }; });
  log(bar.sw > bar.cw, `${scheme}: build bar is wider than the screen`, bar);
  await drag(s.cdp, [[bar.l + bar.w - 20, bar.y], [bar.l + bar.w - 120, bar.y], [bar.l + bar.w - 240, bar.y], [bar.l + 20, bar.y]]);
  await sleep(600);
  const sl = await page.evaluate(() => document.getElementById('tools').scrollLeft);
  log(sl > 40, `${scheme}: swiping the build bar scrolls it sideways`, sl);
  await shot(page, scheme, '2-build-bar-scrolled');
  await page.evaluate(() => { document.getElementById('tools').scrollLeft = 0; });

  await page.locator('#research').tap(); await sleep(400);
  await shot(page, scheme, '3-research');
  const scroll = await page.evaluate(() => { const b = document.querySelector('.sheet-body'); b.scrollTop = 99999; return { st: b.scrollTop, sh: b.scrollHeight, ch: b.clientHeight }; });
  log(scroll.sh <= scroll.ch || scroll.st > 0, `${scheme}: research sheet scrolls`, scroll);
  log((await smallTargets(page)).length === 0, `${scheme}: research sheet tap targets are 44 px or bigger`, await smallTargets(page));
  await closeSheet();

  await page.locator('#menu').tap(); await sleep(400);
  const ta = page.locator('textarea[aria-label="Save code"]');
  await ta.tap();
  await page.keyboard.type('hello code');
  log((await ta.inputValue()) === 'hello code', `${scheme}: save-code textarea accepts typing`);
  await ta.fill('');
  await page.evaluate(() => { document.querySelector('.sheet-body').scrollTop = 0; });
  await shot(page, scheme, '4-menu');
  const mscroll = await page.evaluate(() => { const b = document.querySelector('.sheet-body'); b.scrollTop = 99999; return { st: b.scrollTop, sh: b.scrollHeight, ch: b.clientHeight }; });
  log(mscroll.sh <= mscroll.ch || mscroll.st > 0, `${scheme}: menu sheet scrolls`, mscroll);
  await shot(page, scheme, '4b-menu-scrolled');
  log((await smallTargets(page)).length === 0, `${scheme}: menu tap targets are 44 px or bigger`, await smallTargets(page));
  await page.evaluate(() => { document.querySelector('.sheet-body').scrollTop = 0; });

  await page.getByRole('button', { name: 'Focus mode' }).tap(); await sleep(400);
  await shot(page, scheme, '5-focus');
  const ins = await page.evaluate(() => window.__steelreach.tools.insets);
  log(ins.top === 0 && ins.bottom === 0, `${scheme}: focus mode frees the map edges`, ins);
  await page.locator('#unfocus').tap(); await sleep(300);

  // Overview: a busy map at the zoom-out limit, centred on the loop nearest the Hub.
  await page.evaluate(() => { const sr = window.__steelreach; sr.stress(600, 2000); const c = [...sr.game.conveyors].sort((u, v) => Math.hypot(u.x - 80, u.y - 80) - Math.hypot(v.x - 80, v.y - 80))[0]; sr.cam.x = c.x; sr.cam.y = c.y; sr.cam.z = 16; });
  await sleep(700);
  await shot(page, scheme, '6-overview');
}

// ============================================================ artifact build, light then dark
const light = await open('light', 'artifact');
log(true, 'opened artifact build (light)');
await screens(light, 'light');
await light.context.close();

const dark = await open('dark', 'artifact');
await screens(dark, 'dark');
log(dark.errors.length === 0, 'dark: no console errors', dark.errors);
log(dark.external.length === 0, 'dark: no external requests', dark.external);
await dark.context.close();

// ============================================================ logic checks, fresh game
const a = await open('light', 'artifact');
const { page, cdp } = a;
await sleep(500);
log(a.errors.length === 0, '1. no console errors on load', a.errors);

// 3. Belt tool, touch-drag across 5 tiles
await tool(page, 'Belt');
const p0 = await tileXY(page, 77, 83), p1 = await tileXY(page, 81, 83);
const pts = []; for (let i = 0; i <= 20; i++) pts.push([p0[0] + (p1[0] - p0[0]) * i / 20, p0[1]]);
await drag(cdp, pts);
await sleep(300);
log((await count(page, 'belt')) === 5, '3. touch-drag across 5 tiles leaves 5 belts', await count(page, 'belt'));

// 4. two-finger pinch changes cam.z
await tool(page, 'Pan');
const z0 = await page.evaluate(() => window.__steelreach.cam.z);
const cx = 195, cy = 420;
await touch(cdp, 'touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let i = 1; i <= 10; i++) { await sleep(16); await touch(cdp, 'touchMove', [[cx - 40 - i * 10, cy], [cx + 40 + i * 10, cy]]); }
await touch(cdp, 'touchEnd', []);
await sleep(200);
const z1 = await page.evaluate(() => window.__steelreach.cam.z);
log(z1 > z0 + 2, '4. pinch changes cam.z', { before: z0, after: z1 });
await page.evaluate(() => { const c = window.__steelreach.cam; c.x = 80; c.y = 80; c.z = 44; });
await sleep(200);

// 5. assembler: ghost, then ✓ places it (tier 2 unlock set through the debug hook)
await page.evaluate(() => { window.__steelreach.game.tier = 2; });
await sleep(300);
await tool(page, 'Assembler');
const ap = await tileXY(page, 76, 80);
await page.touchscreen.tap(ap[0], ap[1]);
await sleep(200);
const ghost = await page.evaluate(() => { const g = window.__steelreach.tools.view.ghost; return g && { type: g.type, ok: g.ok }; });
log(ghost?.type === 'assembler' && ghost.ok, '5. placing an assembler shows a ghost', ghost);
await page.locator('#ok').tap();
await sleep(200);
log((await count(page, 'assembler')) === 1, '5. check mark places the assembler', await count(page, 'assembler'));
await tool(page, 'Pan');

// 6. idle fps
const idle = await measure(page);
log(idle.fps >= FPS_MIN, '6. idle fps over 5 s', idle);

// 7. stress fps and tick cost. stress() fills from the map's top-left corner, so the camera is put
// over the densest window of belts at each zoom (through the real wheel path, which runs clampCam)
// and the view must hold a floor of entities and belt items before fps means anything.
const counts = await page.evaluate(() => { const sr = window.__steelreach; sr.stress(3000, 10000); return sr.actions.perf(); });
log(counts.buildings === 3000 && counts.items === 10000, 'stress reached the counts', counts);
// Densest window for zoom z: prefix sums over a per-tile entity count, then the best centre.
async function aimAtFactory(z) {
  return page.evaluate((z) => {
    const sr = window.__steelreach, { cam, game } = sr, N = 160;
    cam.z = z;
    const hw = cam.vw / 2 / z, hh = cam.vh / 2 / z;
    const ps = new Float64Array((N + 1) * (N + 1));
    const at = (x, y) => y * (N + 1) + x;
    const cnt = new Uint8Array(N * N);
    for (const e of game.ents.values()) if (e.type !== 'hub') cnt[e.y * N + e.x] = 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ps[at(x + 1, y + 1)] = cnt[y * N + x] + ps[at(x, y + 1)] + ps[at(x + 1, y)] - ps[at(x, y)];
    const w = Math.min(N, Math.ceil(hw * 2)), h = Math.min(N, Math.ceil(hh * 2));
    let best = -1, bx = 0, by = 0;
    for (let y = 0; y + h <= N; y++) for (let x = 0; x + w <= N; x++) {
      const v = ps[at(x + w, y + h)] - ps[at(x, y + h)] - ps[at(x + w, y)] + ps[at(x, y)];
      if (v > best) { best = v; bx = x; by = y; }
    }
    cam.x = bx + w / 2; cam.y = by + h / 2;
    // A zero-delta wheel is zoomAt(factor 1): the camera API's own clamp.
    document.getElementById('game').dispatchEvent(new WheelEvent('wheel', { deltaY: 0, clientX: 195, clientY: 300, cancelable: true }));
    // What the renderer will draw: entities and belt items whose tiles fall inside visibleTiles(cam).
    const x0 = Math.max(0, Math.floor(cam.x - hw)), x1 = Math.min(N - 1, Math.floor(cam.x + hw));
    const y0 = Math.max(0, Math.floor(cam.y - hh)), y1 = Math.min(N - 1, Math.floor(cam.y + hh));
    let ents = 0, items = 0;
    for (const e of game.ents.values()) {
      if (e.type === 'hub' || e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      ents++;
      if (e.items) items += e.items.length;
    }
    return { cam: [+cam.x.toFixed(1), +cam.y.toFixed(1), cam.z], ents, items, tiles: [x0, y0, x1, y1] };
  }, z);
}
// Floors are about half of what the densest window holds at each zoom, so an emptier view fails.
const VIEW_MIN = { 44: { ents: 60, items: 150 }, 20: { ents: 250, items: 900 }, 16: { ents: 350, items: 1300 } };
const stressRes = {}, views = {};
for (const z of [44, 20, 16]) {
  views[z] = await aimAtFactory(z);
  log(views[z].ents >= VIEW_MIN[z].ents && views[z].items >= VIEW_MIN[z].items, `7. view at zoom ${z} is over the factory`, views[z]);
  await sleep(1500);
  stressRes[z] = await measure(page);
  // After measuring: a screenshot stalls frames and would pollute the fps.
  if (z === 20) await page.screenshot({ path: join(SHOTS, '7-stress-zoom20-light.png') });
  log(stressRes[z].fps >= FPS_MIN && stressRes[z].tickMs <= TICK_MS_MAX, `7. stress fps and tick ms at zoom ${z}`, stressRes[z]);
}
log(a.errors.length === 0, '7. stress runs without errors', a.errors);

// 8. save code size for the stress factory
const saveKB = await page.evaluate(async () => {
  localStorage.removeItem('steelreach');
  // codeText() is encodeSaveCode(serialize(game)), the string Menu > Copy save code puts on the clipboard.
  const code = await window.__steelreach.session.codeText();
  // Reload check below needs the phone save written too.
  await window.__steelreach.session.flush();
  return code.length / 1024;
});
log(saveKB > 0 && saveKB < SAVE_KB_MAX, '8. stress save code is under 300 KB', saveKB);

// 9. reload restores the factory
const before = await page.evaluate(() => window.__steelreach.game.ents.size);
await page.reload();
await page.waitForFunction(() => window.__steelreach?.game);
const after = await page.evaluate(() => window.__steelreach.game.ents.size);
log(before === after && before > 3000, '9. reload restores the factory (same entity count)', { before, after });
await a.context.close();

// 10. home build: manifest loads, no external requests
const home = await open('light', 'home');
await sleep(500);
const manifest = await home.page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.href;
  const r = await fetch(href); const j = await r.json();
  return { href: href && new URL(href).pathname, ok: r.ok, name: j.name, icons: j.icons.length };
});
log(manifest.ok && manifest.name === 'Steelreach', '10. home manifest.webmanifest loads', manifest);
log(home.external.length === 0, '10. home build makes no external requests', home.external);
log(home.errors.length === 0, '10. home build has no console errors', home.errors);
await home.context.close();

await browser.close();
server.close();

const summary = {
  fpsIdle: +idle.fps.toFixed(1),
  fpsStress: +stressRes[44].fps.toFixed(1),
  tickMsStress: +stressRes[44].tickMs.toFixed(2),
  saveCodeKB: +saveKB.toFixed(1),
  extra: { views, stressByZoom: Object.fromEntries(Object.entries(stressRes).map(([z, r]) => [z, { fps: +r.fps.toFixed(1), tickMs: +r.tickMs.toFixed(2) }])) },
};
console.log(JSON.stringify(summary));
if (failures.length) { console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
