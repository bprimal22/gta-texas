// Render a debug top-down map: node tools/ground/map.mjs x0 x1 z0 z1 out.png [--tie-ins]
import '../../scripts/harness/stubs.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { encodePng } from './png.mjs';
const mod = await import(pathToFileURL(resolve('.work/harness-dist/ground-check.mjs')).href);
const [x0, x1, z0, z1] = process.argv.slice(2, 6).map(Number), out = process.argv[6];
const s = await mod.buildGroundScene();
const tie = process.argv.includes('--tie-ins') ? mod.addGroundTieIns(s) : null;
const m = mod.topDown(s, [x0, x1, z0, z1], +(process.env.RES ?? .25));
const colour = (full) => {
  if (full === '') return [255, 0, 255];
  const name = full.replace(/ \[.*\]$/, ''), mat = (full.match(/\[(.*)\]$/) ?? [])[1] ?? '';
  if (name.startsWith('East and West Mall')) return /paving/.test(mat) ? [220, 120, 60] : mat === '' ? [140, 190, 90] : [255, 230, 210];
  if (name === 'Offline local contour terrain') return [96, 140, 70];
  if (name.startsWith('Local mapped')) return [150, 150, 150];
  if (/tie-in/.test(name)) return [230, 200, 60];
  if (name.startsWith('West 24th and Tower north')) return [70, 120, 220];
  if (/^(Inner Campus|Flawn approach)/.test(name)) return [60, 200, 200];
  if (/MAI east doorway/.test(name)) return [200, 60, 200];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [80 + h % 120, 60 + (h >> 8) % 80, 140 + (h >> 16) % 110];
};
const rgb = Buffer.alloc(m.w * m.h * 3);
for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
  const k = j * m.w + i, y = m.y[k];
  let c = colour(m.names[m.cls[k]]);
  // Hillshade from the north-west.
  const yl = m.y[k - 1] ?? y, yu = m.y[k - m.w] ?? y;
  const shade = Number.isFinite(y) ? Math.max(.35, Math.min(1.3, 1 + ((Number.isFinite(yl) ? y - yl : 0) + (Number.isFinite(yu) ? y - yu : 0)) * 4)) : 1;
  c = c.map(v => Math.min(255, v * shade));
  // Height steps > 0.15 m between neighbouring pixels: black (exposed vertical edge).
  const step = Math.max(Math.abs(y - yl) || 0, Math.abs(y - yu) || 0);
  if (step > .15) c = step > .6 ? [0, 0, 0] : [60, 0, 0];
  rgb.set(c.map(Math.round), k * 3);
}
// Building outlines (red), 2 m grid ticks every 10 m (white).
const plot = (x, z, c) => { const i = Math.floor((x - x0) / m.res), j = Math.floor((z - z0) / m.res); if (i >= 0 && j >= 0 && i < m.w && j < m.h) rgb.set(c, (j * m.w + i) * 3); };
for (const rings of m.footprints) for (const r of rings) for (let a = 0; a < r.length; a++) { const p = r[a], q = r[(a + 1) % r.length], n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (m.res / 2)); for (let t = 0; t <= n; t++) plot(p[0] + (q[0] - p[0]) * t / n, p[1] + (q[1] - p[1]) * t / n, [255, 30, 30]); }
for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) for (let z = Math.ceil(z0 / 10) * 10; z <= z1; z += 10) for (let d = -2; d <= 2; d++) { plot(x + d * m.res, z, [255, 255, 255]); plot(x, z + d * m.res, [255, 255, 255]); }
if (tie) for (const seg of tie.segments) {
  const c = { 'no-room': [255, 0, 0], 'overlay-step': [255, 0, 255], 'authored-step': [0, 255, 255], graded: null }[seg.status];
  if (!c || seg.drop <= .15) continue;
  const n = Math.ceil(Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0) / (m.res / 2)) || 1;
  for (let t = 0; t <= n; t++) { const x = seg.x0 + (seg.x1 - seg.x0) * t / n, z = seg.z0 + (seg.z1 - seg.z0) * t / n; plot(x, z, c); plot(x + m.res, z, c); plot(x, z + m.res, c); }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(m.w, m.h, rgb));
console.log('wrote', out, m.w, 'x', m.h);
const area = new Map(); for (const c of m.cls) area.set(c, (area.get(c) ?? 0) + 1);
for (const [k, n] of [...area].sort((a, b) => b[1] - a[1])) console.log(' ', (n * m.res * m.res).toFixed(0).padStart(6), 'm2', JSON.stringify(colour(m.names[k])), m.names[k]);
