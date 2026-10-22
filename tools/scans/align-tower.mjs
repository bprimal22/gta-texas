import { scanInput } from './inputs.mjs';
// Robust alignment of the Tower scan to the official MAI GIS footprint.
// 1) leveling from facade normals, 2) 2D similarity (Umeyama) from footprint corners
// found as intersections of scan wall lines (iterated), 3) vertical offset from open ground
// vs baked terrain; tower top height is an independent check.
import { loadScan, jacobiEigen, rotateOnto, app3, umeyama2 } from './scanlib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const SRC = scanInput('tower.glb');
const scan = await loadScan(SRC, { textures: false });
const S0 = 37; const { idx, nt } = scan; const P = scan.pos.map(v => v * S0);
const plan = JSON.parse(readFileSync(LANE + 'lib/campus/main-building-envelope-plan.json', 'utf8'));
const log = (...a) => console.log(...a);

// ---------- 1. leveling ----------
const tri = (t) => { const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2]; return [a, b, c]; };
function normalOf(Q, t) {
  const [a, b, c] = tri(t);
  const ux = Q[3 * b] - Q[3 * a], uy = Q[3 * b + 1] - Q[3 * a + 1], uz = Q[3 * b + 2] - Q[3 * a + 2];
  const vx = Q[3 * c] - Q[3 * a], vy = Q[3 * c + 1] - Q[3 * a + 1], vz = Q[3 * c + 2] - Q[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
  return l < 1e-12 ? null : { n: [nx / l, ny / l, nz / l], area: l / 2, c: [(Q[3 * a] + Q[3 * b] + Q[3 * c]) / 3, (Q[3 * a + 1] + Q[3 * b + 1] + Q[3 * c + 1]) / 3, (Q[3 * a + 2] + Q[3 * b + 2] + Q[3 * c + 2]) / 3] };
}
let up = [0, 1, 0];
for (let it = 0; it < 5; it++) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let t = 0; t < nt; t++) {
    const r = normalOf(P, t); if (!r) continue;
    if (r.c[1] < -40 || Math.abs(r.c[0]) > 70 || Math.abs(r.c[2]) > 70) continue;
    const d = r.n[0] * up[0] + r.n[1] * up[1] + r.n[2] * up[2]; if (Math.abs(d) > (it ? 0.15 : 0.3)) continue;
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) M[i][k] += r.area * r.n[i] * r.n[k];
  }
  const e = jacobiEigen(M), j = [0, 1, 2].sort((x, y) => e.values[x] - e.values[y])[0];
  up = [e.vectors[0][j], e.vectors[1][j], e.vectors[2][j]]; if (up[1] < 0) up = up.map(v => -v);
}
const L = rotateOnto(up, [0, 1, 0]);
const tiltDeg = Math.acos(up[1]) * 180 / Math.PI;
log('leveling: up', up.map(v => v.toFixed(5)), 'tilt', tiltDeg.toFixed(3), 'deg');
const Q = new Float64Array(P.length);
for (let k = 0; k < P.length; k += 3) { const q = app3(L, [P[k], P[k + 1], P[k + 2]]); Q[k] = q[0]; Q[k + 1] = q[1]; Q[k + 2] = q[2]; }

// ---------- shaft ----------
function squareFit(y0, y1, c0, r = 15) {
  const pts = []; for (let k = 0; k < Q.length; k += 3) if (Q[k + 1] > y0 && Q[k + 1] <= y1 && Math.hypot(Q[k] - c0[0], Q[k + 2] - c0[1]) < r) pts.push([Q[k], Q[k + 2]]);
  let best = null;
  const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
  for (let a = 0; a < 90; a += 0.05) {
    const rr = a * Math.PI / 180, c = Math.cos(rr), s = Math.sin(rr);
    const us = pts.map(p => p[0] * c + p[1] * s).sort((x, y) => x - y), vs = pts.map(p => -p[0] * s + p[1] * c).sort((x, y) => x - y);
    const w = q(us, 0.995) - q(us, 0.005), h = q(vs, 0.995) - q(vs, 0.005);
    if (!best || w * h < best.area) best = { a, area: w * h, w, h, cu: (q(us, 0.995) + q(us, 0.005)) / 2, cv: (q(vs, 0.995) + q(vs, 0.005)) / 2 };
  }
  const rr = best.a * Math.PI / 180;
  return { n: pts.length, angleDeg: best.a, w: best.w, h: best.h, center: [best.cu * Math.cos(rr) - best.cv * Math.sin(rr), best.cu * Math.sin(rr) + best.cv * Math.cos(rr)] };
}
const shaft = squareFit(-26, 8, [17.7, 30.1]);
log('shaft (leveled scan, x37):', JSON.stringify(shaft));
let topY = -1e9, topXZ = null;
for (let k = 0; k < Q.length; k += 3) if (Math.hypot(Q[k] - shaft.center[0], Q[k + 2] - shaft.center[1]) < 9 && Q[k + 1] > topY) { topY = Q[k + 1]; topXZ = [Q[k], Q[k + 2]]; }
log('scan top y (leveled, x37):', topY.toFixed(2), 'at', topXZ.map(v => v.toFixed(2)));

// ---------- 2. wall samples ----------
const walls = []; // [x, z, nx, nz, y, area]
for (let t = 0; t < nt; t++) {
  const r = normalOf(Q, t); if (!r || Math.abs(r.n[1]) > 0.2) continue;
  const hl = Math.hypot(r.n[0], r.n[2]);
  walls.push([r.c[0], r.c[2], r.n[0] / hl, r.n[2] / hl, r.c[1], r.area]);
}
log('wall triangles', walls.length);
const { east } = plan.frame;
const campusData = JSON.parse(readFileSync(LANE + 'public/data/campus.json', 'utf8'));
const extra = (process.env.EXTRA ?? '').split(',').filter(Boolean).map(a => campusData.buildings.find(b => b.abbr === a).rings[0]);
const rings = [...plan.officialWorldRings, ...extra]; // MAI outer, court W, court E, then neighbour outer rings (campus x,z)
const ringIsHole = ri => ri === 1 || ri === 2;
// signed-area orientation; outward normal of each edge (outer ring: away from inside, holes: into the hole = away from material)
const area2 = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const edges = [];
rings.forEach((ring, ri) => {
  const ccw = area2(ring) > 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    // for a ccw (x,z) ring the outward normal is (dz, -dx)/len; holes are reversed (material is outside)
    let n = [dz / len, -dx / len]; if (!ccw) n = [-n[0], -n[1]]; if (ringIsHole(ri)) n = [-n[0], -n[1]];
    edges.push({ ring: ri, i, a, b, len, d: [dx / len, dz / len], n });
  }
});
const ringEdge = (ri, i) => edges.find(e => e.ring === ri && e.i === i);

// ---------- 3. initial guesses + iterated corner Umeyama ----------
const campusTower = (process.env.SEED_TOWER ?? '-215.27,10.40').split(',').map(Number);
const sceneEdgeAngle = Math.atan2(east[1], east[0]); // campus edge direction (x,z) angle
const scanEdgeAngle = shaft.angleDeg * Math.PI / 180;
function run(theta0, verbose = false) {
  let T = { s: Number(process.env.SEED_S ?? 0.95), theta: theta0, t: [0, 0] };
  const c = Math.cos(theta0), s = Math.sin(theta0);
  T.t = [campusTower[0] - T.s * (c * shaft.center[0] - s * shaft.center[1]), campusTower[1] - T.s * (s * shaft.center[0] + c * shaft.center[1])];
  const fwd = (T, p) => { const c = Math.cos(T.theta), s = Math.sin(T.theta); return [T.s * (c * p[0] - s * p[1]) + T.t[0], T.s * (s * p[0] + c * p[1]) + T.t[1]]; };
  const inv = (T, p) => { const c = Math.cos(T.theta), s = Math.sin(T.theta), x = (p[0] - T.t[0]) / T.s, z = (p[1] - T.t[1]) / T.s; return [c * x + s * z, -s * x + c * z]; };
  let result = null;
  for (let iter = 0; iter < 12; iter++) {
    const band = iter < 2 ? 5 : iter < 4 ? 2.5 : 1.5;
    const c = Math.cos(T.theta), s = Math.sin(T.theta);
    const fits = new Map();
    for (const e of edges) {
      if (e.len < 4) continue;
      const pts = [];
      for (const w of walls) {
        const p = fwd(T, [w[0], w[1]]);
        const n = [c * w[2] - s * w[3], s * w[2] + c * w[3]];
        if (n[0] * e.n[0] + n[1] * e.n[1] < 0.85) continue;
        const rx = p[0] - e.a[0], rz = p[1] - e.a[1], along = rx * e.d[0] + rz * e.d[1], off = rx * e.n[0] + rz * e.n[1];
        if (along < 1 || along > e.len - 1 || Math.abs(off) > band) continue;
        pts.push([along, off, w[5]]);
      }
      if (pts.length < 30) continue;
      // robust (weighted median) offset + slope by least squares on inliers
      const offs = pts.map(p => p[1]).sort((a, b) => a - b), med = offs[Math.floor(offs.length / 2)];
      const inl = pts.filter(p => Math.abs(p[1] - med) < 0.6);
      if (inl.length < 20) continue;
      let sw = 0, sa = 0, so = 0, saa = 0, sao = 0;
      for (const [a, o, w] of inl) { sw += w; sa += w * a; so += w * o; saa += w * a * a; sao += w * a * o; }
      const ma = sa / sw, mo = so / sw, varA = saa / sw - ma * ma;
      const slope = e.len > 12 && varA > 4 ? (sao / sw - ma * mo) / varA : 0;
      const spread = Math.sqrt(inl.reduce((x, p) => x + (p[1] - (mo + slope * (p[0] - ma))) ** 2, 0) / inl.length);
      fits.set(e, { mo, ma, slope, n: inl.length, spread, coverage: (Math.max(...inl.map(p => p[0])) - Math.min(...inl.map(p => p[0]))) / e.len });
    }
    // corners from adjacent fitted lines
    const src = [], dst = [], names = [];
    for (const e of edges) {
      const ring = rings[e.ring], next = ringEdge(e.ring, (e.i + 1) % ring.length);
      const f1 = fits.get(e), f2 = fits.get(next); if (!f1 || !f2) continue;
      if (Math.abs(e.d[0] * next.d[0] + e.d[1] * next.d[1]) > 0.5) continue; // need a real corner
      const line = (e, f) => { const p0 = [e.a[0] + e.d[0] * f.ma + e.n[0] * f.mo, e.a[1] + e.d[1] * f.ma + e.n[1] * f.mo]; const dir = [e.d[0] + e.n[0] * f.slope, e.d[1] + e.n[1] * f.slope]; const l = Math.hypot(...dir); return [p0, [dir[0] / l, dir[1] / l]]; };
      const [p1, d1] = line(e, f1), [p2, d2] = line(next, f2);
      const den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 0.3) continue;
      const tt = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
      const X = [p1[0] + d1[0] * tt, p1[1] + d1[1] * tt];
      src.push(inv(T, X)); dst.push(next.a); names.push(`r${e.ring}c${next.i}`);
    }
    if (verbose) log('iter', iter, 'fitted edges', [...fits.keys()].map(e => `r${e.ring}e${e.i}`).join(' '), 'corners', names.join(' '));
    if (src.length < 4) { result = { fail: true, cornerCount: src.length }; break; }
    // robust: drop corners with residual > 2.5x median after first fit
    const fit = umeyama2(src, dst);
    const med = [...fit.residuals].sort((a, b) => a - b)[Math.floor(fit.residuals.length / 2)];
    const keep = fit.residuals.map(r => r <= Math.max(1.0, 3 * med));
    const fit2 = umeyama2(src.filter((_, i) => keep[i]), dst.filter((_, i) => keep[i]));
    T = { s: fit2.s, theta: fit2.theta, t: fit2.t };
    const all = src.map((p, i) => ({ name: names[i], used: keep[i], residual: Math.hypot(fwd(T, p)[0] - dst[i][0], fwd(T, p)[1] - dst[i][1]), scan: p, gis: dst[i] }));
    result = { T, rms: fit2.rms, corners: all, edgesFitted: fits.size, fits: [...fits.entries()].map(([e, f]) => ({ ring: e.ring, i: e.i, len: e.len, ...f })) };
    if (verbose) log(`iter ${iter} band ${band} corners ${src.length} kept ${keep.filter(Boolean).length} rms ${fit2.rms.toFixed(3)} s ${fit2.s.toFixed(5)} theta ${(fit2.theta * 180 / Math.PI).toFixed(3)}`);
  }
  return result;
}
const cands = [0, 1, 2, 3].map(k => sceneEdgeAngle - scanEdgeAngle + k * Math.PI / 2);
let best = null;
for (const th of cands) {
  const r = run(th);
  log('candidate yaw', (th * 180 / Math.PI).toFixed(2), r.fail ? `FAIL ${String(r.cornerCount)}` : `rms ${r.rms.toFixed(3)} corners ${r.corners.filter(c => c.used).length}/${r.corners.length} edges ${r.edgesFitted} s ${r.T.s.toFixed(4)}`);
  if (!r.fail && (!best || r.corners.filter(c => c.used).length * 10 - r.rms > best.corners.filter(c => c.used).length * 10 - best.rms)) best = { ...r, theta0: th };
}
log('--- best candidate, verbose ---');
const forced = process.argv[2] ? Number(process.argv[2]) * Math.PI / 180 : null;
const fin = run(forced ?? best.theta0, true);
for (const c of fin.corners) log(c.name, c.used ? 'used' : 'REJECTED', 'residual', c.residual.toFixed(3), 'gis', c.gis.map(v => v.toFixed(2)).join(','));
for (const f of fin.fits) log('edge', f.ring, f.i, 'len', f.len.toFixed(1), 'pts', f.n, 'spread', f.spread.toFixed(3), 'cov', f.coverage.toFixed(2), 'slope', f.slope.toFixed(4));
writeFileSync(process.env.OUT ?? (LANE + '.work/scans/tower-align-2d.json'), JSON.stringify({ up, L, tiltDeg, shaft, topY, fin }, null, 1));
