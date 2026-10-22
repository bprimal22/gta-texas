import { scanInput } from './inputs.mjs';
// Stadium: register the leveled scan (scale fixed by the yard-line comb) to the GIS stadium
// footprints (NEZ 655373 horseshoe + SEZ 504014): elevated stand cells should fall inside the
// footprints, turf cells inside the field opening. Brute force over yaw (two field-axis
// candidates ±4°) and translation; then report the field centre in campus coordinates.
import { loadScan, app3 } from './scanlib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const S = JSON.parse(readFileSync(LANE + '.work/scans/stadium-level.json', 'utf8'));
const scan = await loadScan(scanInput('stadium.glb'), { textures: false });
const campus = JSON.parse(readFileSync(LANE + 'public/data/campus.json', 'utf8'));
const rings = campus.buildings.filter(b => b.id === 655373 || b.id === 504014).map(b => b.rings[0]);
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const S0 = 37, k = S.scaleRel, { idx, nt } = scan;
const Q = new Float64Array(scan.pos.length);
for (let i = 0; i < Q.length; i += 3) { const q = app3(S.L, [scan.pos[i] * S0, scan.pos[i + 1] * S0, scan.pos[i + 2] * S0]); Q[i] = q[0]; Q[i + 1] = q[1]; Q[i + 2] = q[2]; }
// 1 m heightmap (max) in leveled frame
const C = 1, cells = new Map();
for (let t = 0; t < nt; t++) for (let a = 0; a < 3; a++) { const i = idx[3 * t + a]; const key = Math.floor(Q[3 * i] / C) + ',' + Math.floor(Q[3 * i + 2] / C); const y = Q[3 * i + 1]; if (!(cells.get(key) >= y)) cells.set(key, y); }
const stand = [], turf = [], cls = new Map();
for (const [key, y] of cells) { const [i, j] = key.split(',').map(Number); const p = [(i + 0.5) * C, (j + 0.5) * C]; const h = (y - S.fieldY) * k; if (h > 4) { stand.push(p); cls.set(key, 2); } else if (Math.abs(h) < 0.4) { turf.push(p); cls.set(key, 1); } else cls.set(key, 3); }
const gisCells = []; for (let z = 82; z < 458; z += 2) for (let x = 282; x < 618; x += 2) if (rings.some(r => inRing(x, z, r))) gisCells.push([x, z]);
console.log('stand cells', stand.length, 'turf cells', turf.length);
// GIS raster 1 m
const x0 = 280, z0 = 80, GW = 340, GH = 380, gis = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (rings.some(r => inRing(x0 + i + 0.5, z0 + j + 0.5, r))) gis[j * GW + i] = 1;
const g = (x, z) => { const i = Math.floor(x - x0), j = Math.floor(z - z0); return i < 0 || j < 0 || i >= GW || j >= GH ? 0 : gis[j * GW + i]; };
const fc = S.fieldCentreLevel, campusAxis = Math.atan2(Math.cos(Math.atan2(-0.068, 1)), Math.sin(Math.atan2(-0.068, 1)));
const results = [];
const FINE = process.env.FINE ? JSON.parse(process.env.FINE) : null;
for (const base of FINE ? [FINE.yaw * Math.PI / 180] : [campusAxis - S.axisAng, campusAxis - S.axisAng + Math.PI]) for (let d = FINE ? -1 : -4; d <= (FINE ? 1 : 4); d += FINE ? 0.25 : 0.5) {
  const th = base + d * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const f = (p, t) => [k * (c * (p[0] - fc[0]) - s * (p[1] - fc[1])) + t[0], k * (s * (p[0] - fc[0]) + c * (p[1] - fc[1])) + t[1]];
  let best = null;
  const grid = FINE ? { c: FINE.t, r: 6, st: 0.5 } : { c: [444.3, 272.5], r: 30, st: 2 };
  const surface = [];
  for (let dx = -grid.r; dx <= grid.r; dx += grid.st) for (let dz = -grid.r; dz <= grid.r; dz += grid.st) {
    const t = [grid.c[0] + dx, grid.c[1] + dz]; let a = 0, b = 0;
    for (let n = 0; n < stand.length; n += 3) a += g(...f(stand[n], t));
    for (let n = 0; n < turf.length; n += 3) b += 1 - g(...f(turf[n], t));
    // recall: GIS footprint cells that land on scanned data should be stands (not turf)
    let cov = 0, hit = 0;
    for (const [x, z] of gisCells) { const u = (x - t[0]) / k, v = (z - t[1]) / k; const lx = c * u + s * v + fc[0], lz = -s * u + c * v + fc[1]; const q = cls.get(Math.floor(lx / C) + ',' + Math.floor(lz / C)); if (q === undefined) continue; cov++; if (q === 2) hit++; }
    const recall = cov ? hit / cov : 0;
    const score = a / Math.ceil(stand.length / 3) + b / Math.ceil(turf.length / 3) + recall;
    surface.push([t, score]);
    if (!best || score > best.score) best = { score, standIn: a / Math.ceil(stand.length / 3), turfOut: b / Math.ceil(turf.length / 3), recall, t };
  }
  const near = surface.filter(q => q[1] > best.score - 0.005); best.within0005 = { n: near.length, xs: [Math.min(...near.map(q => q[0][0])), Math.max(...near.map(q => q[0][0]))], zs: [Math.min(...near.map(q => q[0][1])), Math.max(...near.map(q => q[0][1]))] };
  results.push({ yawDeg: th * 180 / Math.PI, ...best });
}
results.sort((a, b) => b.score - a.score);
for (const r of results.slice(0, 5)) console.log(JSON.stringify(r));
const other = results.find(r => Math.abs(((r.yawDeg - results[0].yawDeg + 540) % 360) - 180) > 170);
console.log('best of opposite orientation', JSON.stringify(other));
writeFileSync(LANE + (FINE ? '.work/scans/stadium-align-fine.json' : '.work/scans/stadium-align.json'), JSON.stringify({ ...S, best: results[0], opposite: other }, null, 1));
