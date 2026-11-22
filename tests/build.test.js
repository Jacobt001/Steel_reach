import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execSync } from 'node:child_process'; import { readFileSync, existsSync } from 'node:fs';
test('build emits both targets with no external requests', () => {
  execSync('node build.mjs', { stdio: 'pipe' });
  const a = readFileSync('dist/artifact/index.html', 'utf8'), h = readFileSync('dist/home/index.html', 'utf8');
  for (const s of [a, h]) {
    assert.match(s, /^<!DOCTYPE html>/); assert.match(s, /<title>Steelreach<\/title>/);
    assert.match(s, /viewport-fit=cover/); assert.doesNotMatch(s, /(src|href)=["']https?:/);
  }
  assert.doesNotMatch(a, /manifest\.webmanifest/);
  assert.match(h, /rel="manifest" href="manifest\.webmanifest"/); assert.match(h, /apple-mobile-web-app-capable/);
  for (const f of ['manifest.webmanifest', 'icon-180.png', 'icon-512.png']) assert.ok(existsSync('dist/home/' + f), f);
  const m = JSON.parse(readFileSync('dist/home/manifest.webmanifest', 'utf8'));
  assert.equal(m.display, 'standalone'); assert.equal(m.name, 'Steelreach');
});
