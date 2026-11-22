// Placeholder entry: proves the bundle runs. __TARGET__ is injected by build.mjs ('artifact' | 'home').
import { MAP } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.body);
  ctx.fillStyle = cs.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 32px system-ui, sans-serif';
  ctx.fillText('Steelreach', w / 2, h / 2);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`${MAP}x${MAP} map - ${__TARGET__} build`, w / 2, h / 2 + 30);
}
window.addEventListener('resize', draw);
draw();
