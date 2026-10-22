// Global 2D registration: scan roof mask (flat, elevated cells) vs GIS footprint raster, brute force over yaw/scale/translation.
import { loadScan, app3 } from './scanlib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const [file, alignFile, cxArg, czArg, outFile] = process.argv.slice(2);
const A = JSON.parse(readFileSync(alignFile, 'utf8'));
const scan = await loadScan(file, { textures: false });
const S0 = 37, { idx, nt } = scan;
const Q = new Float64Array(scan.pos.length);
for (let k = 0; k < Q.length; k += 3) { const q = app3(A.L, [scan.pos[k] * S0, scan.pos[k + 1] * S0, scan.pos[k + 2] * S0]); Q[k] = q[0]; Q[k + 1] = q[1]; Q[k + 2] = q[2]; }
// leveled-frame heightmap at 0.5 m
const mn = [1e9, 1e9], mx = [-1e9, -1e9];
for (let k = 0; k < Q.length; k += 3) { mn[0] = Math.min(mn[0], Q[k]); mn[1] = Math.min(mn[1], Q[k + 2]); mx[0] = Math.max(mx[0], Q[k]); mx[1] = Math.max(mx[1], Q[k + 2]); }
const C = 0.5, W = Math.ceil((mx[0] - mn[0]) / C) + 1, H = Math.ceil((mx[1] - mn[1]) / C) + 1;
const hm = new Float32Array(W * H).fill(-1e9);
for (let t = 0; t < nt; t++) {
  const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4 - i; j++) {
    const u = i / 4, v = j / 4, w = 1 - u - v;
    const x = Q[3 * a] * u + Q[3 * b] * v + Q[3 * c] * w, y = Q[3 * a + 1] * u + Q[3 * b + 1] * v + Q[3 * c + 1] * w, z = Q[3 * a + 2] * u + Q[3 * b + 2] * v + Q[3 * c + 2] * w;
    const o = Math.floor((z - mn[1]) / C) * W + Math.floor((x - mn[0]) / C); if (y > hm[o]) hm[o] = y;
  }
}
// ground estimate: 5th percentile of heights
const hs = [...hm].filter(v => v > -1e8).sort((a, b) => a - b), ground = hs[Math.floor(hs.length * 0.05)];
// roof cells: elevated >6 m and locally planar (max-min over 5x5 window < 0.6 m... allow pitched: use plane residual)
const roof = [];
for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) {
  const h0 = hm[j * W + i]; if (h0 < ground + 6) continue;
  // fit plane via central differences, check residual
  let ok = true; const gx = (hm[j * W + i + 2] - hm[j * W + i - 2]) / 4, gz = (hm[(j + 2) * W + i] - hm[(j - 2) * W + i]) / 4;
  if (Math.hypot(gx, gz) > 0.8) continue;
  for (let dj = -2; dj <= 2 && ok; dj++) for (let di = -2; di <= 2; di++) { const v = hm[(j + dj) * W + i + di]; if (v < -1e8 || Math.abs(v - (h0 + gx * di + gz * dj)) > 0.25) { ok = false; break; } }
  if (ok) roof.push([mn[0] + (i + 0.5) * C, mn[1] + (j + 0.5) * C]);
}
// all elevated cells (coverage of scan) for recall denominator
const covered = []; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (hm[j * W + i] > -1e8) covered.push([mn[0] + (i + 0.5) * C, mn[1] + (j + 0.5) * C]);
console.log('ground', ground.toFixed(2), 'roof cells', roof.length, 'covered', covered.length);
// GIS raster
const campus = JSON.parse(readFileSync(LANE + 'public/data/campus.json', 'utf8'));
const plan = JSON.parse(readFileSync(LANE + 'lib/campus/main-building-envelope-plan.json', 'utf8'));
const cx = Number(cxArg), cz = Number(czArg), half = 220, G = 0.5, GW = Math.ceil(2 * half / G);
const gis = new Uint8Array(GW * GW);
const polys = campus.buildings.filter(b => b.abbr !== 'MAI').map(b => b.rings).concat([plan.officialWorldRings]);
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
for (const rings of polys) {
  const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]);
  if (Math.max(...xs) < cx - half || Math.min(...xs) > cx + half || Math.max(...zs) < cz - half || Math.min(...zs) > cz + half) continue;
  for (let j = 0; j < GW; j++) { const z = cz - half + (j + 0.5) * G; if (z < Math.min(...zs) || z > Math.max(...zs)) continue;
    for (let i = 0; i < GW; i++) { const x = cx - half + (i + 0.5) * G; if (x < Math.min(...xs) || x > Math.max(...xs)) continue;
      if (inRing(x, z, rings[0]) && !rings.slice(1).some(r => inRing(x, z, r))) gis[j * GW + i] = 1; } }
}
const g = (x, z) => { const i = Math.floor((x - cx + half) / G), j = Math.floor((z - cz + half) / G); return i < 0 || j < 0 || i >= GW || j >= GW ? 0 : gis[j * GW + i]; };
const sc = A.shaft.center;
const results = [];
const roofS = roof.filter((_, i) => i % 3 === 0), covS = covered.filter((_, i) => i % 12 === 0);
function score(th, s, tx, tz) {
  const c = Math.cos(th), si = Math.sin(th);
  const f = p => [s * (c * (p[0] - sc[0]) - si * (p[1] - sc[1])) + tx, s * (si * (p[0] - sc[0]) + c * (p[1] - sc[1])) + tz];
  let tp = 0; for (const p of roofS) tp += g(...f(p));
  let gin = 0; for (const p of covS) gin += g(...f(p));
  const precision = tp / roofS.length;
  return { precision, tp, gin };
}
for (let k = 0; k < 4; k++) for (let dth = -3; dth <= 3; dth += 1.5) for (let s = 0.85; s <= 1.09; s += 0.04) {
  const th = A.fin.T.theta + k * Math.PI / 2 + dth * Math.PI / 180;
  let best = null;
  for (let dx = -44; dx <= 44; dx += 2) for (let dz = -44; dz <= 44; dz += 2) {
    const r = score(th, s, -215.27 + dx, 10.40 + dz); if (!best || r.tp > best.tp) best = { ...r, dx, dz };
  }
  results.push({ k, yawDeg: th * 180 / Math.PI, s, ...best });
}
results.sort((a, b) => b.tp - a.tp);
for (const r of results.slice(0, 12)) console.log(JSON.stringify(r));
for (let k = 0; k < 4; k++) { const r = results.find(q => q.k === k); console.log('best for k', k, JSON.stringify(r)); }
if (outFile) writeFileSync(outFile, JSON.stringify({ ground, roof, results: results.slice(0, 50) }));

// per-building breakdown for best of each k
for (let k = 0; k < 4; k++) {
  const r = results.find(q => q.k === k); const th = r.yawDeg * Math.PI / 180, c = Math.cos(th), si = Math.sin(th);
  const f = p => [r.s * (c * (p[0] - sc[0]) - si * (p[1] - sc[1])) - 215.27 + r.dx, r.s * (si * (p[0] - sc[0]) + c * (p[1] - sc[1])) + 10.40 + r.dz];
  const per = {};
  for (const p of roofS) { const [x, z] = f(p); for (const b of campus.buildings) { const xs = b.rings[0].map(q => q[0]), zs = b.rings[0].map(q => q[1]); if (x < Math.min(...xs) || x > Math.max(...xs) || z < Math.min(...zs) || z > Math.max(...zs)) continue; if (inRing(x, z, b.rings[0])) { per[b.abbr || b.id] = (per[b.abbr || b.id] || 0) + 1; break; } } }
  const tw = f(sc); console.log('k', k, 'tower at', tw.map(v => v.toFixed(1)).join(','), JSON.stringify(per));
}
