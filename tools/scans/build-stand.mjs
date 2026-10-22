import { scanInput } from './inputs.mjs';
// DKR west stand: crop the aligned stadium scan to the generated bowl's west straight
// (field-frame v in [-53, 53], outward depth t in [0, reach-0.5] per section), drop field-level
// clutter and fragments, re-pack the used source photo charts (original UVs, no reprojection),
// build UV-aware near/far LODs, a reduced collider surface sampled from the visible scan, and the
// seam profiles the generated bowl needs to close around it.
// Inputs: the aligned field transform (public/assets/scans/dkr-field.json) and the bowl section
// reach probed from the real authored scene (tools/scans/stand-probe.mjs -> .work/scans/stand-probe.json).
import { loadScan } from './scanlib.mjs';
import { packCharts } from './stand-charts.mjs';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const LANE = new URL('../../', import.meta.url).pathname;
const OUT = LANE + 'public/assets/scans/';
const log = (...a) => console.log(...a);
const fieldMeta = JSON.parse(readFileSync(OUT + 'dkr-field.json', 'utf8'));
const probe = JSON.parse(readFileSync(LANE + '.work/scans/stand-probe.json', 'utf8'));
const M = fieldMeta.matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0;
const F = { center: [444.3, 272.5], angle: Math.atan2(-0.068, 1), hw: 35.5 };
const V_MIN = -53, V_MAX = 53, STEP = 0.5, CROP_MARGIN = 0.5;
// west straight sections (stadium-bowl.ts samples with outward normal -u), reach by v
const west = probe.sectionInfo.filter(s => s.nu < -0.99).sort((a, b) => a.v - b.v);
const reachAt = v => { if (v <= west[0].v) return west[0].reach; for (let i = 1; i < west.length; i++) if (v <= west[i].v) { const a = west[i - 1], b = west[i], f = (v - a.v) / (b.v - a.v); return a.reach + (b.reach - a.reach) * f; } return west[west.length - 1].reach; };
// crop depth: the bowl's own stand edge (linear between its sections, as its quads are) minus a margin
const depthAt = v => reachAt(v) - CROP_MARGIN;
const scan = await loadScan(scanInput('stadium.glb'));
const { pos, idx, nt, nv } = scan;
const X = new Float64Array(nv), Y = new Float64Array(nv), Z = new Float64Array(nv), T = new Float64Array(nv), V = new Float64Array(nv);
for (let i = 0; i < nv; i++) {
  const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
  X[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; Y[i] = M[1] * x + M[5] * y + M[9] * z + M[13]; Z[i] = M[2] * x + M[6] * y + M[10] * z + M[14];
  const dx = X[i] - F.center[0], dz = Z[i] - F.center[1];
  const u = dx * Math.cos(F.angle) - dz * Math.sin(F.angle); V[i] = dx * Math.sin(F.angle) + dz * Math.cos(F.angle); T[i] = -F.hw - u;
}
// ---- crop ----
let tris = [];
for (let t = 0; t < nt; t++) {
  const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
  let ok = true;
  for (const i of [a, b, c]) if (V[i] < V_MIN || V[i] > V_MAX || T[i] < 0 || T[i] > depthAt(V[i]) || Y[i] < -1) { ok = false; break; }
  if (!ok) continue;
  // t >= 0 already excludes the generated turf, so the scanned apron between the field edge and the
  // front row is kept (it closes the view into the bowl hollow).
  tris.push(t);
}
const cropped = tris.length;
// floating fragments: connectivity by welded position
const parent = new Int32Array(nt).map((_, i) => i), find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const owner = new Map();
for (const t of tris) for (let k = 0; k < 3; k++) { const i = idx[3 * t + k], key = `${Math.round(X[i] * 1000)},${Math.round(Y[i] * 1000)},${Math.round(Z[i] * 1000)}`; const o = owner.get(key); if (o === undefined) owner.set(key, t); else { const r1 = find(o), r2 = find(t); if (r1 !== r2) parent[r1] = r2; } }
const size = new Map(); for (const t of tris) { const r = find(t); size.set(r, (size.get(r) ?? 0) + 1); }
const MIN_COMPONENT = 300;
const droppedComponents = [...size.values()].filter(n => n < MIN_COMPONENT).length;
tris = tris.filter(t => size.get(find(t)) >= MIN_COMPONENT);
log('crop', cropped, 'triangles; after fragment removal', tris.length, '; dropped components', droppedComponents, '; largest', [...size.values()].sort((a, b) => b - a).slice(0, 3));
// ---- follow-up 3: clean capture boundary (rim line), press-box massing, streak curtains ----
// Top surface of the full-resolution crop on the 0.5 m (t, v) grid.
const GT = Math.ceil(Math.max(...west.map(s => s.reach)) / STEP) + 1, GV = Math.round((V_MAX - V_MIN) / STEP) + 1;
const topGrid = list => {
  const g = new Float32Array(GT * GV).fill(NaN);
  for (const t of list) {
    const q = [0, 1, 2].map(k => { const i = idx[3 * t + k]; return [T[i], V[i], Y[i]]; });
    const a0 = Math.max(0, Math.floor(Math.min(...q.map(r => r[0])) / STEP)), a1 = Math.min(GT - 1, Math.ceil(Math.max(...q.map(r => r[0])) / STEP));
    const b0 = Math.max(0, Math.floor((Math.min(...q.map(r => r[1])) - V_MIN) / STEP)), b1 = Math.min(GV - 1, Math.ceil((Math.max(...q.map(r => r[1])) - V_MIN) / STEP));
    const den = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]); if (Math.abs(den) < 1e-12) continue;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const tt = a * STEP, vv = V_MIN + b * STEP;
      const w0 = ((q[1][1] - q[2][1]) * (tt - q[2][0]) + (q[2][0] - q[1][0]) * (vv - q[2][1])) / den, w1 = ((q[2][1] - q[0][1]) * (tt - q[2][0]) + (q[0][0] - q[2][0]) * (vv - q[2][1])) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], o = b * GT + a; if (!(g[o] >= y)) g[o] = y;
    }
  }
  return g;
};
const g0 = topGrid(tris);
// Per row: walk the upper deck outward from t = 45 m while it rises like a seating deck
// (step per 0.5 m between -1 and +3 m, at most one empty cell); the press-box slab (+10..15 m),
// torn edges (drops) and holes stop the walk.
const rawRim = [], rawRimH = [];
for (let b = 0; b < GV; b++) {
  let a = Math.round(45 / STEP); while (a < GT - 1 && Number.isNaN(g0[b * GT + a])) a++;
  let last = a;
  for (;;) {
    let next = -1; for (const k of [1, 2]) if (a + k < GT && !Number.isNaN(g0[b * GT + a + k])) { next = a + k; break; }
    if (next < 0) break;
    const dy = g0[b * GT + next] - g0[b * GT + a]; if (dy < -1 || dy > 3) break;
    a = next; last = a;
  }
  rawRim.push(last * STEP); rawRimH.push(g0[b * GT + last]);
}
// Robust clean line: 85th percentile over +-4 m (ignores early stops at single noisy rows), then a
// +-3 m moving average; never beyond the crop depth.
const pct = (arr, f) => { const s2 = [...arr].sort((x, y) => x - y); return s2[Math.min(s2.length - 1, Math.floor(f * s2.length))]; };
const rimP = rawRim.map((_, b) => pct(rawRim.slice(Math.max(0, b - 8), b + 9), 0.85));
const rimT = rimP.map((_, b) => { const w = rimP.slice(Math.max(0, b - 12), b + 13); return Math.min(depthAt(V_MIN + b * STEP), w.reduce((x, y) => x + y, 0) / w.length); });
const rimAt = v => { const f = (v - V_MIN) / STEP, b = Math.max(0, Math.min(GV - 2, Math.floor(f))), w = Math.min(1, Math.max(0, f - b)); return rimT[b] * (1 - w) + rimT[b + 1] * w; };
// Rim height: the deck height where each row's walk ended, 85th percentile over +-4 m then +-3 m mean
// (deck heights only: the walk never steps onto the press-box slab).
const rimHp = rawRimH.map((_, b) => pct(rawRimH.slice(Math.max(0, b - 8), b + 9).filter(x => Number.isFinite(x)), 0.85));
const rimH = rimHp.map((_, b) => { const w = rimHp.slice(Math.max(0, b - 12), b + 13).filter(x => Number.isFinite(x)); return w.reduce((x, y) => x + y, 0) / w.length; });
const rimHAt = v => { const f = (v - V_MIN) / STEP, b = Math.max(0, Math.min(GV - 2, Math.floor(f))), w = Math.min(1, Math.max(0, f - b)); return rimH[b] * (1 - w) + rimH[b + 1] * w; };
// Press-box remnant: cells beyond the rim line standing > 6 m above the rim (slab + columns).
const pb = [];
for (let b = 0; b < GV; b++) for (let a = 0; a < GT; a++) { const h2 = g0[b * GT + a]; if (!Number.isNaN(h2) && a * STEP > rimT[b] - 3 && h2 > rimH[b] + 6) pb.push([a * STEP, V_MIN + b * STEP, h2]); }
const pressBox = pb.length > 50 ? { vMin: Math.max(V_MIN + 1, pct(pb.map(p => p[1]), 0.03)), vMax: Math.min(V_MAX - 1, pct(pb.map(p => p[1]), 0.97)), t0: pct(pb.map(p => p[0]), 0.05), t1: pct(pb.map(p => p[0]), 0.95), top: pct(pb.map(p => p[2]), 0.5), cells: pb.length } : null;
if (pressBox) { pressBox.t0 = Math.max(pressBox.t0, Math.min(...rimT.filter((_, b) => { const v = V_MIN + b * STEP; return v >= pressBox.vMin && v <= pressBox.vMax; }))); }
log('rim line t', Math.min(...rimT).toFixed(1), '..', Math.max(...rimT).toFixed(1), 'h', Math.min(...rimH).toFixed(1), '..', Math.max(...rimH).toFixed(1), 'press box', JSON.stringify(pressBox));
// Trim: everything beyond the rim line, plus streak curtains (long, thin, steep stretched triangles).
const triArea = t => { const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]); const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a], vx = X[c] - X[a], vy = Y[c] - Y[a], vz = Z[c] - Z[a]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; return { area: 0.5 * Math.hypot(nx, ny, nz), ny: ny / (Math.hypot(nx, ny, nz) || 1) }; };
let areaBefore = 0; for (const t of tris) areaBefore += triArea(t).area;
let trimmedRim = 0, trimmedRimArea = 0, curtains = 0, curtainArea = 0;
tris = tris.filter(t => {
  const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]);
  // beyond the rim line, or standing above the parapet top within 6 m of it (press-box slab, columns, torn rim)
  if ([a, b, c].some(i => T[i] > rimAt(V[i]) + 0.05 || (T[i] > rimAt(V[i]) - 6 && Y[i] > rimHAt(V[i]) + 1.0))) { trimmedRim++; trimmedRimArea += triArea(t).area; return false; }
  const e = [[a, b], [b, c], [c, a]].map(([p, q]) => Math.hypot(X[p] - X[q], Y[p] - Y[q], Z[p] - Z[q])), { area: ar, ny } = triArea(t), longest = Math.max(...e);
  if (longest > 2.0 && 2 * ar / longest < 0.12 && Math.abs(ny) < 0.35) { curtains++; curtainArea += ar; return false; }
  return true;
});
log('trimmed beyond rim', trimmedRim, 'tris /', trimmedRimArea.toFixed(0), 'm2; streak curtains', curtains, '/', curtainArea.toFixed(0), 'm2; kept', tris.length);
// quality: area, texel density, coverage of the sector (1 m cells)
let area = 0, pix = 0;
const cover = new Set();
for (const t of tris) {
  const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]);
  const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a], vx = X[c] - X[a], vy = Y[c] - Y[a], vz = Z[c] - Z[a];
  area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  const Tx = scan.tex[scan.triMat[t]], uv = scan.uv;
  pix += 0.5 * Math.abs((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1])) * Tx.w * Tx.h;
  for (const i of [a, b, c]) cover.add(`${Math.floor(T[i])},${Math.floor(V[i])}`);
}
let cells = 0, covered = 0;
for (let v = V_MIN; v < V_MAX; v++) for (let t = 0; t < rimAt(v + 0.5); t++) { cells++; if (cover.has(`${t},${v}`)) covered++; }
log('area m2', area.toFixed(0), 'texels/m', Math.sqrt(pix / area).toFixed(1), 'plan coverage (vertex-in-1m-cell)', (covered / cells).toFixed(3));
// ---- geometry + texture: keep the source photographs (no reprojection) ----
// Every retained source vertex keeps its own UV: photogrammetry UV seams are split vertices, so
// no position weld is done (it would erase UV differences). Only the source charts used by the
// retained triangles are re-packed into a local atlas at an explicit budget (stand-charts.mjs);
// meshopt's attribute-aware simplifier keeps same-position/different-UV seams.
// Local coords: anchor = field centre, Y relative to the field plane.
const ATLAS_W = 4096, ATLAS_MAX_H = 2048, JPEG_NEAR = 90, JPEG_CHROMA = '4:4:4';
const charts = packCharts(scan, tris, { width: ATLAS_W, maxHeight: ATLAS_MAX_H });
log('charts', charts.charts.length, 'regions', charts.regions.length, 'source chart texels', charts.sourcePixels, 'copied', charts.copiedSourceTexels, 'atlas', charts.width, 'x', charts.height, 'used height', charts.usedHeight, 'scale', charts.scale.toFixed(4), 'dilated', charts.dilatedTexels);
const vmap = new Map(), P = [], UVS = [], I = [], vSource = [];
for (const t of tris) for (let k = 0; k < 3; k++) {
  const i = idx[3 * t + k];
  let j = vmap.get(i); if (j === undefined) { j = vmap.size; vmap.set(i, j); vSource.push(i); P.push(X[i] - F.center[0], Y[i], Z[i] - F.center[1]); UVS.push(...charts.uvOf(i)); }
  I.push(j);
}
const positions = new Float32Array(P), uvs = new Float32Array(UVS), indices = new Uint32Array(I);
// UV weight: one atlas texel of UV drift costs about one texel footprint in metres.
const atlasTexelsPerMetre = Math.sqrt(pix / area) * charts.scale, UV_WEIGHT = [charts.width / atlasTexelsPerMetre, charts.height / atlasTexelsPerMetre];
await MeshoptSimplifier.ready;
// Both LODs keep every chart seam (strict: no 'Permissive'), so no captured triangle ever
// interpolates between different source photographs or packed regions. The source charts are tiny
// (median ~6 triangles), so neither LOD can reach the old 90k/20k targets; the counts are reported.
const NEAR_FLAGS = ['ErrorAbsolute'], FAR_FLAGS = ['ErrorAbsolute'];
const simplify = (target, error, flags) => MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, uvs, 2, UV_WEIGHT, null, Math.min(indices.length, target * 3), error, flags);
const [nearIdx, nearErr] = simplify(90000, 0.05, NEAR_FLAGS), [farIdx, farErr] = simplify(20000, 0.3, FAR_FLAGS);
log('vertices', positions.length / 3, 'near', nearIdx.length / 3, 'err', nearErr.toFixed(3), 'far', farIdx.length / 3, 'err', farErr.toFixed(3), 'uv weight', UV_WEIGHT.map(w => w.toFixed(1)).join(','));
// compact each LOD to its used vertices (positions/UVs are copied unchanged from the source vertices)
const compact = list => {
  const remap = new Int32Array(positions.length / 3).fill(-1), used = [];
  for (const i of list) if (remap[i] < 0) { remap[i] = used.length; used.push(i); }
  const p = new Float32Array(used.length * 3), u = new Float32Array(used.length * 2);
  used.forEach((o, n) => { p.set(positions.subarray(3 * o, 3 * o + 3), 3 * n); u.set(uvs.subarray(2 * o, 2 * o + 2), 2 * n); });
  return { p, u, i: Uint32Array.from(list, i => remap[i]), source: Uint32Array.from(used, o => vSource[o]) };
};
const near = compact(nearIdx), far = compact(farIdx);
const chartsIn = lod => new Set(Array.from(lod.source, i => charts.chartOfVertex.get(i))).size;
log('near vertices', near.p.length / 3, 'charts', chartsIn(near), 'far vertices', far.p.length / 3, 'charts', chartsIn(far));
// ---- collider surface: topmost visible near-LOD surface on a 0.5 m (t, v) grid ----
const nT = Math.ceil(Math.max(...west.map(s => s.reach)) / STEP) + 1, nV = Math.round((V_MAX - V_MIN) / STEP) + 1;
const hgrid = new Float32Array(nT * nV).fill(NaN);
const toXZ = (t, v) => { const u = -F.hw - t; return [u * Math.cos(F.angle) + v * Math.sin(F.angle), -u * Math.sin(F.angle) + v * Math.cos(F.angle)]; }; // local (anchor) xz
const toTV = (x, z) => { const u = x * Math.cos(F.angle) - z * Math.sin(F.angle), v = x * Math.sin(F.angle) + z * Math.cos(F.angle); return [-F.hw - u, v]; };
for (let n = 0; n < near.i.length; n += 3) {
  const q = [0, 1, 2].map(k => { const o = near.i[n + k]; const [t, v] = toTV(near.p[3 * o], near.p[3 * o + 2]); return [t, v, near.p[3 * o + 1]]; });
  const t0 = Math.max(0, Math.floor(Math.min(...q.map(r => r[0])) / STEP)), t1 = Math.min(nT - 1, Math.ceil(Math.max(...q.map(r => r[0])) / STEP));
  const v0 = Math.max(0, Math.floor((Math.min(...q.map(r => r[1])) - V_MIN) / STEP)), v1 = Math.min(nV - 1, Math.ceil((Math.max(...q.map(r => r[1])) - V_MIN) / STEP));
  const den = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]); if (Math.abs(den) < 1e-12) continue;
  for (let a = t0; a <= t1; a++) for (let b = v0; b <= v1; b++) {
    const t = a * STEP, v = V_MIN + b * STEP;
    const w0 = ((q[1][1] - q[2][1]) * (t - q[2][0]) + (q[2][0] - q[1][0]) * (v - q[2][1])) / den, w1 = ((q[2][1] - q[0][1]) * (t - q[2][0]) + (q[0][0] - q[2][0]) * (v - q[2][1])) / den, w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const y = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], o = b * nT + a;
    if (!(hgrid[o] >= y)) hgrid[o] = y;
  }
}
const inside = (a, b) => a * STEP <= rimAt(V_MIN + b * STEP) + 1e-6;
let holes = 0; for (let b = 0; b < nV; b++) for (let a = 0; a < nT; a++) if (inside(a, b) && Number.isNaN(hgrid[b * nT + a])) holes++;
const wasHole = Uint8Array.from(hgrid, h => (Number.isNaN(h) ? 1 : 0));
writeFileSync(LANE + '.work/scans/stand-grid.json', JSON.stringify({ nT, nV, STEP, V_MIN, h: Array.from(hgrid, x => (Number.isNaN(x) ? null : +x.toFixed(2))), reach: west.map(s => [s.v, s.reach]) }));
// fill holes from neighbours (iterative), never below the field plane
for (let pass = 0; pass < 200; pass++) {
  let left = 0; const next = hgrid.slice();
  for (let b = 0; b < nV; b++) for (let a = 0; a < nT; a++) { const o = b * nT + a; if (!inside(a, b) || !Number.isNaN(hgrid[o])) continue; let s = 0, c = 0; for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a2 = a + da, b2 = b + db; if (a2 < 0 || b2 < 0 || a2 >= nT || b2 >= nV) continue; const h = hgrid[b2 * nT + a2]; if (!Number.isNaN(h)) { s += h; c++; } } if (c) next[o] = s / c; else left++; }
  hgrid.set(next); if (!left) break;
}
for (let o = 0; o < hgrid.length; o++) if (!Number.isNaN(hgrid[o])) hgrid[o] = Math.max(0, hgrid[o]);
log('collider grid', nT, 'x', nV, 'holes filled', holes);
// Visual infill (AUTHORED): grid cells the scan does not cover from above (holes, mostly the ragged
// north-west upper rim) get a surface at the hole-filled collider height - 3 cm. It is a separate
// primitive with its own flat, unlit material (no photo UVs): one tone, the median source texel of
// the retained captured faces within 2 m of the infill cells, so the stand never shows see-through
// gaps but the repair is never presented as photographed surface.
let infillCells = 0;
const infill = { p: [], i: [] };
for (let b = 0; b + 1 < nV; b++) for (let a = 0; a + 1 < nT; a++) {
  const q = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]];
  if (q.some(([x, y]) => !inside(x, y) || Number.isNaN(hgrid[y * nT + x])) || !q.some(([x, y]) => wasHole[y * nT + x])) continue;
  infillCells++;
  const base = infill.p.length / 3;
  for (const [x, y] of q) { const [lx, lz] = toXZ(x * STEP, V_MIN + y * STEP); infill.p.push(lx, hgrid[y * nT + x] - 0.03, lz); }
  const [x0, , z0] = infill.p.slice(3 * base, 3 * base + 3), [x1, , z1] = infill.p.slice(3 * base + 3, 3 * base + 6), [x2, , z2] = infill.p.slice(3 * base + 6, 3 * base + 9);
  const up = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0) > 0; // wind upward
  if (up) infill.i.push(base, base + 1, base + 2, base, base + 2, base + 3); else infill.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
const infillTone = (() => {
  const cells = new Set();
  for (let b = 0; b < nV; b++) for (let a = 0; a < nT; a++) if (wasHole[b * nT + a] && inside(a, b)) cells.add(`${Math.floor(a * STEP / 2)},${Math.floor(b * STEP / 2)}`);
  const rgb = [[], [], []];
  for (const t of tris) {
    const [a, b2, c] = [0, 1, 2].map(k => idx[3 * t + k]), tc = (T[a] + T[b2] + T[c]) / 3, vc = (V[a] + V[b2] + V[c]) / 3 - V_MIN;
    let near2 = false; for (let di = -1; di <= 1 && !near2; di++) for (let dj = -1; dj <= 1; dj++) if (cells.has(`${Math.floor(tc / 2) + di},${Math.floor(vc / 2) + dj}`)) { near2 = true; break; }
    if (!near2) continue;
    const Tx = scan.tex[scan.triMat[t]], u0 = (scan.uv[2 * a] + scan.uv[2 * b2] + scan.uv[2 * c]) / 3, v0 = (scan.uv[2 * a + 1] + scan.uv[2 * b2 + 1] + scan.uv[2 * c + 1]) / 3;
    const x = ((Math.floor(u0 * Tx.w) % Tx.w) + Tx.w) % Tx.w, y = ((Math.floor(v0 * Tx.h) % Tx.h) + Tx.h) % Tx.h, o = (y * Tx.w + x) * 4;
    for (let k = 0; k < 3; k++) rgb[k].push(Tx.data[o + k]);
  }
  return { srgb: rgb.map(ch => pct(ch, 0.5)), samples: rgb[0].length };
})();
log('visual infill cells (authored)', infillCells, 'tone sRGB', infillTone.srgb.join(','), 'from', infillTone.samples, 'captured faces');
// trimesh over cells inside the crop (all 4 corners inside); vertices in local coords
const vid = new Int32Array(nT * nV).fill(-1), cp = [], ci = [];
for (let b = 0; b < nV; b++) for (let a = 0; a < nT; a++) { const o = b * nT + a; if (!inside(a, b) || Number.isNaN(hgrid[o])) continue; vid[o] = cp.length / 3; const [x, z] = toXZ(a * STEP, V_MIN + b * STEP); cp.push(x, hgrid[o], z); }
for (let b = 0; b + 1 < nV; b++) for (let a = 0; a + 1 < nT; a++) { const q = [vid[b * nT + a], vid[b * nT + a + 1], vid[(b + 1) * nT + a + 1], vid[(b + 1) * nT + a]]; if (q.some(x => x < 0)) continue; ci.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
const colPos = new Float32Array(cp);
const [colSimp, colErr] = MeshoptSimplifier.simplify(new Uint32Array(ci), colPos, 3, Math.floor(ci.length / 24) * 3, 0.04, ['ErrorAbsolute', 'LockBorder']);
const col = (() => { const remap = new Int32Array(colPos.length / 3).fill(-1), used = []; for (const i of colSimp) if (remap[i] < 0) { remap[i] = used.length; used.push(i); } const p = new Float32Array(used.length * 3); used.forEach((o, n) => p.set(colPos.subarray(3 * o, 3 * o + 3), 3 * n)); return { p, i: Uint32Array.from(colSimp, i => remap[i]) }; })();
log('collider triangles', ci.length / 3, '->', col.i.length / 3, 'simplify error', colErr.toFixed(3));
// ---- seam profiles for the generated bowl (heights above field) ----
const rowAt = vIdx => Array.from({ length: nT }, (_, a) => (inside(a, vIdx) && !Number.isNaN(hgrid[vIdx * nT + a]) ? +hgrid[vIdx * nT + a].toFixed(3) : null));
// Seam profiles: scanned surface up to the rim line, then the authored roof cap at rim height.
const capRow = (row, v) => row.map((h2, a) => (h2 !== null ? h2 : a * STEP > rimAt(v) - 1e-6 ? +rimHAt(v).toFixed(3) : null));
const seamMin = capRow(rowAt(0), V_MIN), seamMax = capRow(rowAt(nV - 1), V_MAX);
const front = [], outer = [];
for (let b = 0; b < nV; b += 2) front.push([V_MIN + b * STEP, +hgrid[b * nT].toFixed(3)]);
// outer edge at exactly the bowl section samples (the bowl interpolates linearly between them)
// outer rows = clean rim line at each bowl section: [v, t of the rim, rim height] (the bowl caps from here)
for (const s of west) outer.push([+s.v.toFixed(3), +Math.min(rimAt(Math.max(V_MIN, Math.min(V_MAX, s.v))), s.reach - CROP_MARGIN).toFixed(3), +rimHAt(Math.max(V_MIN, Math.min(V_MAX, s.v))).toFixed(3)]);
// ---- GLBs ----
// Both LODs embed the SAME full-resolution JPEG bytes of the packed source-chart atlas: no
// downsampling (a 4x box far texture averaged tiny source charts into visibly wrong colours).
// Photo texels are copied unchanged: no exposure/colour edits.
const raw = (data, w, h) => sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: w, height: h, channels: 3 } });
const jpegNear = await raw(charts.atlas, charts.width, charts.height).jpeg({ quality: JPEG_NEAR, mozjpeg: true, chromaSubsampling: JPEG_CHROMA }).toBuffer();
await raw(charts.atlas, charts.width, charts.height).png().toFile(LANE + '.work/scans/stand-atlas.png');
const jpegFar = jpegNear, jpegSha256 = createHash('sha256').update(jpegNear).digest('hex');
const srgbToLinear = c => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const infillP = new Float32Array(infill.p), infillI = Uint32Array.from(infill.i);
const files = [];
for (const { name, lod, jpeg, size, withCollider } of [{ name: 'dkr-west-stand-near.glb', lod: near, jpeg: jpegNear, size: [charts.width, charts.height], withCollider: true }, { name: 'dkr-west-stand-far.glb', lod: far, jpeg: jpegFar, size: [charts.width, charts.height], withCollider: false }]) {
  const doc = new Document(); const buffer = doc.createBuffer(); const unlit = doc.createExtension(KHRMaterialsUnlit);
  const material = doc.createMaterial('DKR west stand photogrammetry (source photo charts)').setBaseColorTexture(doc.createTexture('west stand source-chart atlas').setMimeType('image/jpeg').setImage(jpeg)).setMetallicFactor(0).setRoughnessFactor(1).setExtension('KHR_materials_unlit', unlit.createUnlit());
  const idxArr = lod.p.length / 3 > 65535 ? lod.i : Uint16Array.from(lod.i);
  const prim = doc.createPrimitive().setMaterial(material).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(lod.p).setBuffer(buffer)).setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(lod.u).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(idxArr).setBuffer(buffer));
  const scene = doc.createScene('stand');
  scene.addChild(doc.createNode('DKR west stand scan').setMesh(doc.createMesh('DKR west stand scan').addPrimitive(prim)));
  if (infillI.length) {
    // Authored (not captured): flat measured tone, no texture, no UVs.
    const imat = doc.createMaterial('DKR west stand authored infill (flat approximate capture tone)').setBaseColorFactor([...infillTone.srgb.map(srgbToLinear), 1]).setMetallicFactor(0).setRoughnessFactor(1).setExtension('KHR_materials_unlit', unlit.createUnlit()).setExtras({ authoredInfill: true, toneSRGB: infillTone.srgb });
    const iprim = doc.createPrimitive().setMaterial(imat).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(infillP).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(infillP.length / 3 > 65535 ? infillI : Uint16Array.from(infillI)).setBuffer(buffer));
    scene.addChild(doc.createNode('DKR west stand authored infill').setMesh(doc.createMesh('DKR west stand authored infill').addPrimitive(iprim)));
  }
  if (withCollider) {
    // Reduced static collider surface (not rendered; the runtime extracts it).
    const cmat = doc.createMaterial('collider (not rendered)').setExtension('KHR_materials_unlit', unlit.createUnlit());
    const cprim = doc.createPrimitive().setMaterial(cmat).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(col.p).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(col.p.length / 3 > 65535 ? col.i : Uint16Array.from(col.i)).setBuffer(buffer));
    scene.addChild(doc.createNode('DKR west stand collider').setMesh(doc.createMesh('DKR west stand collider').addPrimitive(cprim)));
  }
  doc.getRoot().getAsset().copyright = 'Copyright (c) 2025 Sean Hardesty Lewis, MIT License (seanhlewis/utimagery@13f08efe). Cropped/aligned derivative; source photo charts re-packed (original UVs).';
  const glb = await new NodeIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc);
  writeFileSync(OUT + name, glb);
  files.push({ name, bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'), triangles: lod.i.length / 3 + infillI.length / 3, capturedTriangles: lod.i.length / 3, infillTriangles: infillI.length / 3, vertices: lod.p.length / 3, colliderTriangles: withCollider ? col.i.length / 3 : 0, texture: size });
  log('wrote', name, glb.length);
}
// Chart provenance (not shipped): source primitive, source texel core rect and atlas rect per chart,
// plus the source vertex of every LOD vertex, for the fidelity check (stand-fidelity.mjs).
writeFileSync(LANE + '.work/scans/stand-charts.json', JSON.stringify({ scale: charts.scale, pad: charts.pad, align: charts.align, atlas: [charts.width, charts.height], far: [charts.width, charts.height], farTexture: 'same full-resolution near atlas JPEG (no downsampling)', jpegSha256, charts: charts.charts, regions: charts.regions }));
const meta = {
  asset: 'dkr-west-stand', anchor: [F.center[0], 0, F.center[1]], yRelativeTo: 'generated stadium field plane (localContext.stats.stadium.fieldY)',
  transform: 'same as dkr-field.json (matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0); vertices baked to campus metres relative to anchor',
  sector: { side: 'west', vMin: V_MIN, vMax: V_MAX, step: STEP, cropMargin: CROP_MARGIN, seamMin, seamMax, front, outer, pressBox, parapet: 1.1,
    reach: west.map(s => [+s.v.toFixed(3), +s.reach.toFixed(3)]), fieldFrame: F },
  cleanup: { rawRimRows: rawRim.length, rimT: [Math.min(...rimT), Math.max(...rimT)], rimH: [Math.min(...rimH), Math.max(...rimH)], trimmedBeyondRim: { triangles: trimmedRim, areaM2: trimmedRimArea }, streakCurtains: { triangles: curtains, areaM2: curtainArea }, capturedAreaBeforeM2: areaBefore, rule: 'upper deck walked outward while it rises like a seating deck (step -1..+3 m per 0.5 m); 85th percentile over +-4 m, +-6 m mean; trimmed above rim+1 m within 6 m of it; scan trimmed beyond; streak = longest edge > 2 m, height < 0.12 m, |ny| < 0.35' },
  crop: { rule: 'west straight v in [-53,53], 0 <= t <= reach-0.5 (reach of the generated bowl section; stops before authored DKR frontage), Y >= field-1, components < 300 tris dropped', cropped, kept: tris.length, droppedComponents, areaM2: area, texelsPerMetre: Math.sqrt(pix / area), planCoverage: covered / cells },
  collider: { grid: [nT, nV], step: STEP, holesFilled: holes, visualInfillCells: infillCells, visualInfillNote: 'authored, separate unlit material (not photographed): hole cells surfaced at the filled collider height - 0.03 m in one flat tone, the median source texel of retained captured faces within 2 m', visualInfillToneSRGB: infillTone.srgb, visualInfillToneSamples: infillTone.samples, triangles: col.i.length / 3, simplifyErrorM: colErr, note: 'topmost visible surface (max) of the near LOD; overhang undersides are closed' },
  lods: { nearTriangles: near.i.length / 3, nearErrorM: nearErr, nearVertices: near.p.length / 3, nearCharts: chartsIn(near), farTriangles: far.i.length / 3, farErrorM: farErr, farVertices: far.p.length / 3, farCharts: chartsIn(far), sourceVertices: positions.length / 3,
    simplifier: 'meshoptimizer simplifyWithAttributes (UV weight = atlas size / atlas texels per metre), ErrorAbsolute; no position weld, so same-position different-UV source vertices stay chart seams', nearFlags: NEAR_FLAGS, farFlags: FAR_FLAGS, uvWeight: UV_WEIGHT },
  atlas: { size: [charts.width, charts.height], method: 'source photo charts used by the retained triangles, re-packed with their original UVs (no reprojection, no colour edits)', charts: charts.charts.length, regions: charts.regions.length, scale: charts.scale, sourceChartTexels: charts.sourcePixels, copiedSourceTexels: charts.copiedSourceTexels, padTexels: charts.pad, alignTexels: charts.align, dilatedTexels: charts.dilatedTexels,
    far: { size: [charts.width, charts.height], mode: 'full-resolution: byte-identical copy of the near atlas JPEG, no downsampling', jpegSha256 }, jpegQuality: { near: JPEG_NEAR, far: JPEG_NEAR, chroma: JPEG_CHROMA }, atlasTexelsPerMetre, budget: `near = far texture <= ${ATLAS_W}x${ATLAS_MAX_H}, scale 1 (no source texel loss)` },
  files,
};
writeFileSync(OUT + 'dkr-west-stand.json', JSON.stringify(meta));
// Unshipped provenance for independent review (diagnostic only, not a runtime input). Output vertex n
// of a LOD's captured primitive is source vertex nearSourceVertex[n] / farSourceVertex[n] of
// stadium.glb (global index over its primitives in file order); retained source vertex k has chart
// chartOfSourceVertex[k], source primitive/texture primitiveOfSourceVertex[k] and original UV
// sourceUV[2k..2k+1]. Simplification removes triangles, so there is no 1:1 source-face -> LOD-face map.
const retained = [...vmap.keys()];
writeFileSync(LANE + '.work/scans/stand-provenance.json', JSON.stringify({
  note: 'diagnostic provenance for dkr-west-stand-{near,far}.glb; captured primitive only (node "DKR west stand scan"); the authored infill node/material and the collider node are not captured and have no source mapping',
  source: { file: 'stadium.glb', sha256: createHash('sha256').update(readFileSync(scanInput('stadium.glb'))).digest('hex'), vertexIndexing: 'global over mesh primitives in file order (scanlib.loadScan)' },
  files: Object.fromEntries([...files.map(f => [f.name, f.sha256]), ['dkr-west-stand.json', createHash('sha256').update(JSON.stringify(meta)).digest('hex')]]),
  keptSourceTriangles: tris, retainedSourceVertices: retained,
  chartOfSourceVertex: retained.map(i => charts.chartOfVertex.get(i)), primitiveOfSourceVertex: retained.map(i => charts.charts[charts.chartOfVertex.get(i)].sourcePrimitive),
  sourceUV: retained.flatMap(i => [scan.uv[2 * i], scan.uv[2 * i + 1]]),
  nearSourceVertex: Array.from(near.source), farSourceVertex: Array.from(far.source),
  textures: { mode: 'full-resolution far: both LODs embed the same atlas JPEG bytes, no downsampling', jpegSha256, size: [charts.width, charts.height] },
  infill: { node: 'DKR west stand authored infill', vertices: infillP.length / 3, triangles: infillI.length / 3, toneSRGB: infillTone.srgb },
  atlasMapping: 'atlasU = (region.atlasRect[0] + (sourceU * textureWidth - region.sourceRect[0]) * scale) / atlasWidth; V likewise with height (stand-charts.json; region = charts[chart].region)',
}));
log('meta', JSON.stringify(meta.crop), JSON.stringify(meta.collider));
