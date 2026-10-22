import { scanInput } from './inputs.mjs';
// Stadium scan: level by the field plane, measure the yard-line period from the texture
// (scale constraint: 5 yd = 4.572 m), find the field axis/centre, render a leveled top view.
import { loadScan, render, rotateOnto, app3, jacobiEigen, sampleTex } from './scanlib.mjs';
import { writeFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const scan = await loadScan(scanInput('stadium.glb'));
const S0 = 37, P = scan.pos.map(v => v * S0), { idx, nt, uv, tex, triMat } = scan;
const log = (...a) => console.log(...a);
const cen = t => [0, 1, 2].map(k => (P[3 * idx[3 * t] + k] + P[3 * idx[3 * t + 1] + k] + P[3 * idx[3 * t + 2] + k]) / 3);
const nrm = t => { const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]); const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2]; const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n); return l ? { n: n.map(v => v / l), area: l / 2 } : null; };
// turf triangles: green texture at centroid
const green = new Uint8Array(nt);
for (let t = 0; t < nt; t++) {
  const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]);
  const col = sampleTex(tex[triMat[t]], (uv[2 * a] + uv[2 * b] + uv[2 * c]) / 3, (uv[2 * a + 1] + uv[2 * b + 1] + uv[2 * c + 1]) / 3);
  if (col[1] > col[0] + 12 && col[1] > col[2] + 5) green[t] = 1;
}
// plane fit (PCA) on green, upward-ish triangles, iterated with residual trimming
let pts = []; for (let t = 0; t < nt; t++) if (green[t]) { const r = nrm(t); if (r && Math.abs(r.n[1]) > 0.9) pts.push(cen(t)); }
log('turf triangles', pts.length);
let normal = [0, 1, 0], d0 = 0;
for (let it = 0; it < 4; it++) {
  const m = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  const Cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Cv[i][j] += (p[i] - m[i]) * (p[j] - m[j]);
  const e = jacobiEigen(Cv), j = [0, 1, 2].sort((x, y) => e.values[x] - e.values[y])[0];
  normal = [e.vectors[0][j], e.vectors[1][j], e.vectors[2][j]]; if (normal[1] < 0) normal = normal.map(v => -v);
  d0 = normal[0] * m[0] + normal[1] * m[1] + normal[2] * m[2];
  const res = pts.map(p => normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - d0);
  const sorted = res.map(Math.abs).sort((a, b) => a - b), lim = Math.max(0.15, 2.5 * sorted[Math.floor(sorted.length / 2)]);
  log('plane iter', it, 'n', normal.map(v => v.toFixed(5)), 'tilt', (Math.acos(normal[1]) * 180 / Math.PI).toFixed(3), 'median|res|', sorted[Math.floor(sorted.length / 2)].toFixed(3), 'p90', sorted[Math.floor(sorted.length * .9)].toFixed(3));
  pts = pts.filter((_, i) => Math.abs(res[i]) < lim);
}
const L = rotateOnto(normal, [0, 1, 0]);
const Q = new Float64Array(P.length); for (let k = 0; k < P.length; k += 3) { const q = app3(L, [P[k], P[k + 1], P[k + 2]]); Q[k] = q[0]; Q[k + 1] = q[1]; Q[k + 2] = q[2]; }
const fieldY = d0; // leveled field height (plane offset preserved by rotation about origin)
// field axis: PCA of turf centroids in leveled xz
const tp = []; for (let t = 0; t < nt; t++) if (green[t]) { const c = [0, 1, 2].map(k => (Q[3 * idx[3 * t] + k] + Q[3 * idx[3 * t + 1] + k] + Q[3 * idx[3 * t + 2] + k]) / 3); if (Math.abs(c[1] - fieldY) < 0.3) tp.push([c[0], c[2]]); }
const mx = tp.reduce((s, p) => s + p[0], 0) / tp.length, mz = tp.reduce((s, p) => s + p[1], 0) / tp.length;
let sxx = 0, sxz = 0, szz = 0; for (const [x, z] of tp) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
const axisAng = 0.5 * Math.atan2(2 * sxz, sxx - szz); // major axis angle in (x,z)
log('turf centroid', mx.toFixed(2), mz.toFixed(2), 'major axis deg', (axisAng * 180 / Math.PI).toFixed(2));
// render a leveled top view, aligned with the field axis (long axis vertical), 10 px/m
const R = 10, half = 76, W = 2 * half * R;
const ca = Math.cos(axisAng), sa = Math.sin(axisAng);
const toImg = (x, z) => { const dx = x - mx, dz = z - mz; const along = dx * ca + dz * sa, across = -dx * sa + dz * ca; return [(across + half) * R, (along + half) * R]; };
const zb = await render(scan, Q, W, W, (x, y, z) => [...toImg(x, z), y], LANE + '.work/scans/stadium-level-top.png', { shade: false });
// whiteness profile along the axis inside the turf band: count bright low-saturation pixels per row
const img = await (await import('sharp')).default(LANE + '.work/scans/stadium-level-top.png').raw().toBuffer({ resolveWithObject: true });
const prof = new Float64Array(W);
for (let y = 0; y < W; y++) { let n = 0; for (let x = 0; x < W; x++) { const o = (y * W + x) * img.info.channels, r = img.data[o], g = img.data[o + 1], b = img.data[o + 2]; if (r > 150 && g > 150 && b > 140 && Math.max(r, g, b) - Math.min(r, g, b) < 45 && Math.abs(zb[y * W + x] - fieldY) < 0.4) n++; } prof[y] = n; }
writeFileSync(LANE + '.work/scans/stadium-profile.json', JSON.stringify({ normal, L, fieldY, mx, mz, axisAng, R, half, prof: [...prof] }));
// White line texels on the turf plane: dense barycentric samples of field-level triangles.
const white = [], orange = [];
for (let t = 0; t < nt; t++) {
  const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]);
  const ys = [Q[3 * a + 1], Q[3 * b + 1], Q[3 * c + 1]]; if (Math.max(...ys.map(y => Math.abs(y - fieldY))) > 0.35) continue;
  const span = Math.max(Math.hypot(Q[3 * a] - Q[3 * b], Q[3 * a + 2] - Q[3 * b + 2]), Math.hypot(Q[3 * c] - Q[3 * b], Q[3 * c + 2] - Q[3 * b + 2]), Math.hypot(Q[3 * a] - Q[3 * c], Q[3 * a + 2] - Q[3 * c + 2]));
  const n = Math.max(1, Math.ceil(span / 0.05));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const wa = i / n, wb = j / n, wc = 1 - wa - wb;
    const col = sampleTex(tex[triMat[t]], wa * uv[2 * a] + wb * uv[2 * b] + wc * uv[2 * c], wa * uv[2 * a + 1] + wb * uv[2 * b + 1] + wc * uv[2 * c + 1]);
    if (col[0] > col[1] + 30 && col[0] > col[2] + 30) orange.push([wa * Q[3 * a] + wb * Q[3 * b] + wc * Q[3 * c], wa * Q[3 * a + 2] + wb * Q[3 * b + 2] + wc * Q[3 * c + 2]]);
    if (col[0] > 150 && col[1] > 150 && col[2] > 140 && Math.max(...col) - Math.min(...col) < 45) white.push([wa * Q[3 * a] + wb * Q[3 * b] + wc * Q[3 * c], wa * Q[3 * a + 2] + wb * Q[3 * b + 2] + wc * Q[3 * c + 2]]);
  }
}
log('white turf samples', white.length);
// For each candidate axis angle, profile of white samples along the axis restricted to the central
// band (|across| < 18 m, inside the hash marks/numbers region is fine). Comb of 21 lines (goal line to goal line).
const BIN = 0.05;
function profileAt(ang) {
  const ca = Math.cos(ang), sa = Math.sin(ang), prof = new Float64Array(Math.ceil(200 / BIN));
  for (const [x, z] of white) { const dx = x - mx, dz = z - mz, along = dx * ca + dz * sa, across = -dx * sa + dz * ca; if (Math.abs(across) > 18) continue; const k = Math.floor((along + 100) / BIN); if (k >= 0 && k < prof.length) prof[k]++; }
  return prof;
}
let best = null;
for (let dA = -12; dA <= 12; dA += 0.05) {
  const ang = axisAng + dA * Math.PI / 180, prof = profileAt(ang);
  // sharpness: sum of squares (lines aligned with the bins give peaky profile)
  let ss = 0; for (const v of prof) ss += v * v;
  if (!best || ss > best.ss) best = { ang, ss, prof };
}
log('yard-line axis deg', (best.ang * 180 / Math.PI).toFixed(3), '(PCA', (axisAng * 180 / Math.PI).toFixed(3), ')');
const sm = best.prof.map((_, i, a) => (a[i - 2] ?? 0) * 0.1 + (a[i - 1] ?? 0) * 0.2 + a[i] * 0.4 + (a[i + 1] ?? 0) * 0.2 + (a[i + 2] ?? 0) * 0.1);
const at = m => { const f = (m + 100) / BIN, i0 = Math.floor(f), w = f - i0; return (sm[i0] ?? 0) * (1 - w) + (sm[i0 + 1] ?? 0) * w; };
// Goal-line anchored comb. The far half of the field is in the stands' baked shadow, where white
// detection fails, so the comb is anchored on the sunlit end zone: the orange end-zone block's
// inner edge is the goal line; spacing is fitted on the sunlit yard lines.
const orangeProf = new Float64Array(best.prof.length);
{ const ca2 = Math.cos(best.ang), sa2 = Math.sin(best.ang); for (const [x, z] of orange) { const dx = x - mx, dz = z - mz, along = dx * ca2 + dz * sa2, across = -dx * sa2 + dz * ca2; if (Math.abs(across) > 20) continue; const kk = Math.floor((along + 100) / BIN); if (kk >= 0 && kk < orangeProf.length) orangeProf[kk]++; } }
// orange block: contiguous region (smoothed over 1 m) above 30% of its max
const osm = orangeProf.map((_, i, a) => { let s2 = 0; for (let d = -10; d <= 10; d++) s2 += a[i + d] ?? 0; return s2; });
const omax = Math.max(...osm); const oIdx = []; osm.forEach((v, i) => { if (v > omax * 0.3) oIdx.push(i); });
const oA = oIdx[0] * BIN - 100, oB = oIdx[oIdx.length - 1] * BIN - 100;
log('orange end-zone block along', oA.toFixed(2), oB.toFixed(2), 'depth s37', (oB - oA).toFixed(2));
// the field of play lies on the side with more white; goal line = edge facing it
let wNeg = 0, wPos = 0; for (let i = 0; i < sm.length; i++) { const m = i * BIN - 100; if (m < oA - 2 && m > oA - 50) wNeg += sm[i]; if (m > oB + 2 && m < oB + 50) wPos += sm[i]; }
const dir = (oA + oB) / 2 > 0 ? -1 : 1, goal0 = dir < 0 ? oA : oB; void wNeg; void wPos; // field of play lies toward the turf centroid (along 0)
// refine the goal line on the white profile within ±1 m of the orange edge
let gBest = null; for (let m = goal0 - 1.2; m <= goal0 + 1.2; m += BIN) { const v = at(m); if (!gBest || v > gBest.v) gBest = { m, v }; }
let comb = null;
for (let p = 4.4; p <= 5.6; p += 0.001) { let s2 = 0; for (let kk = 1; kk <= 10; kk++) s2 += at(gBest.m + dir * kk * p); if (!comb || s2 > comb.s) comb = { p, s: s2 }; }
const lines = []; for (let kk = 0; kk <= 20; kk++) { const c0 = gBest.m + dir * kk * comb.p; let sw = 0, sx = 0; for (let m = c0 - 0.35; m <= c0 + 0.35; m += BIN) { const v = at(m); sw += v; sx += v * m; } lines.push(kk <= 10 && sw ? sx / sw : c0); }
// LS on the 11 sunlit lines only
let num = 0, den = 0; const kb = 5, lb = lines.slice(0, 11).reduce((a, b) => a + b, 0) / 11; lines.slice(0, 11).forEach((l, kk) => { num += (kk - kb) * (l - lb); den += (kk - kb) ** 2; });
const period = Math.abs(num / den), res = lines.slice(0, 11).map((l, kk) => l - (lb + (kk - kb) * dir * period)), rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / 11);
const lbar = lines[0] + dir * 10 * period;
log('goal line along', gBest.m.toFixed(2), 'dir', dir, 'period', period.toFixed(4), 'line rms (s37 m)', rms.toFixed(3), 'fifty along', lbar.toFixed(2));
const scaleRel = 4.572 / period;
log('scale relative to author 37:', scaleRel.toFixed(4), '=> m per glTF unit', (37 * scaleRel).toFixed(3), '| end-zone depth true m', ((oB - oA) * scaleRel).toFixed(2), '(regulation 9.14)');
const fifty = lbar; // along-axis coordinate of the 50-yard line
// sidelines: white samples' across distribution far from centre (|across| 20..30)
const cb = Math.cos(best.ang), sb = Math.sin(best.ang), acr = [];
for (const [x, z] of white) { const dx = x - mx, dz = z - mz, along = dx * cb + dz * sb, across = -dx * sb + dz * cb; if (Math.abs(along - fifty) < 40) acr.push(across); }
const hist = new Map(); for (const a of acr) { const k = Math.round(a / 0.1); hist.set(k, (hist.get(k) ?? 0) + 1); }
const peaks = [...hist.entries()].filter(([k]) => Math.abs(k * 0.1) > 18).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => [+(k * 0.1).toFixed(1), n]);
log('across peaks (|across|>18, s37 m):', JSON.stringify(peaks));
writeFileSync(LANE + '.work/scans/stadium-level.json', JSON.stringify({ normal, L, fieldY, turfCentroid: [mx, mz], axisAng: best.ang, period, lineRms: rms, lines, fifty, scaleRel, peaks }, null, 1));
// Sideline-to-sideline extent: across bins (0.5 m) where most of the 21 yard lines are white.
const hitsBy = new Map();
for (const [x, z] of white) { const dx = x - mx, dz = z - mz, along = dx * cb + dz * sb, across = -dx * sb + dz * cb; const li = lines.findIndex(l => Math.abs(along - l) < 0.15); if (li < 0) continue; const k = Math.floor(across / 0.5); if (!hitsBy.has(k)) hitsBy.set(k, new Set()); hitsBy.get(k).add(li); }
log('hits', JSON.stringify([...hitsBy.entries()].sort((a, b) => a[0] - b[0]).filter(([k]) => k % 2 === 0).map(([k, s]) => [k * 0.5, s.size])));
const good = [...hitsBy.entries()].filter(([, set]) => set.size >= 10).map(([k]) => k).sort((a, b) => a - b);
// largest contiguous run
let run = [], cur = []; for (const k of good) { if (cur.length && k !== cur[cur.length - 1] + 1) { if (cur.length > run.length) run = cur; cur = []; } cur.push(k); } if (cur.length > run.length) run = cur;
const a0 = run[0] * 0.5, a1 = (run[run.length - 1] + 1) * 0.5;
log('yard lines continuous across', a0.toFixed(1), a1.toFixed(1), 'width s37', (a1 - a0).toFixed(2), '=> true m', ((a1 - a0) * scaleRel).toFixed(2), '(regulation 48.77 incl. lines)');
// sideline marks: weighted centres of the white hit bands in 20..30 m on either side
const band = (lo, hi) => { let w = 0, sx = 0; for (const [k, set] of hitsBy) { const a = (k + 0.5) * 0.5; if (a >= lo && a <= hi && set.size >= 6) { w += set.size; sx += set.size * a; } } return sx / w; };
const sideNeg = band(-30, -20), sidePos = band(20, 30);
log('sideline bands (s37)', sideNeg.toFixed(2), sidePos.toFixed(2), 'width true m', ((sidePos - sideNeg) * scaleRel).toFixed(2), '(regulation 48.77 between sideline centres incl. 6 ft border ~ 50.6)');
const acrossCentre = (sideNeg + sidePos) / 2;
const prev = JSON.parse((await import('node:fs')).readFileSync(LANE + '.work/scans/stadium-level.json', 'utf8'));
prev.acrossCentre = acrossCentre; prev.fieldWidthTrue = (sidePos - sideNeg) * scaleRel; prev.sidelines = [sideNeg, sidePos]; prev.fieldCentreLevel = [mx + fifty * cb - acrossCentre * sb, mz + fifty * sb + acrossCentre * cb];
writeFileSync(LANE + '.work/scans/stadium-level.json', JSON.stringify(prev, null, 1));
log('field centre (leveled scan xz, s37)', prev.fieldCentreLevel.map(v => v.toFixed(2)));
