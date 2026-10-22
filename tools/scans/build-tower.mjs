import { scanInput } from './inputs.mjs';
// Crop the aligned Tower scan to the Tower above the Main Building roof, remove floating
// fragments, re-pack only the used texture charts into one atlas, simplify near/far LODs,
// derive simplified collider proxies, and write GLBs + metadata to public/assets/scans/.
import { loadScan } from './scanlib.mjs';
import { Document, NodeIO, VertexLayout } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const LANE = new URL('../../', import.meta.url).pathname;
const SRC = scanInput('tower.glb');
const X = JSON.parse(readFileSync(process.argv[2] ?? LANE + 'tools/scans/tower-transform.json', 'utf8'));
const OUT = LANE + 'public/assets/scans/';
mkdirSync(OUT, { recursive: true });
const M = X.matrixColumnMajor_rawGltfToCampus;
const [cx, cz] = X.checks.shaftCentre, yaw = X.checks.shaftEdgeYawDeg_mod90 * Math.PI / 180;
const eu = [Math.cos(yaw), Math.sin(yaw)], ev = [-Math.sin(yaw), Math.cos(yaw)];
// Authored Main Building north-stack roof (main-building-envelope-plan.json zone "north-stack") is
// flat at Y 36.05; the scan shaft is kept from just below it so it penetrates that roof without a gap.
const CUT_Y = 35.9;
const halfAt = y => (y < 85 ? 9.45 : y < 89.5 ? 10.0 : y < 96.6 ? 8.6 : 5.6);
const log = (...a) => console.log(...a);

const scan = await loadScan(SRC);
const { pos, uv, idx, triMat, tex, nt, nv } = scan;
// campus + tower-local (u along an edge, v across) coordinates
const C = new Float64Array(nv * 3), U = new Float64Array(nv), V = new Float64Array(nv);
for (let i = 0; i < nv; i++) {
  const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
  const X0 = M[0] * x + M[4] * y + M[8] * z + M[12], Y0 = M[1] * x + M[5] * y + M[9] * z + M[13], Z0 = M[2] * x + M[6] * y + M[10] * z + M[14];
  C[3 * i] = X0; C[3 * i + 1] = Y0; C[3 * i + 2] = Z0;
  U[i] = (X0 - cx) * eu[0] + (Z0 - cz) * eu[1]; V[i] = (X0 - cx) * ev[0] + (Z0 - cz) * ev[1];
}
// ---- 1. crop ----
const keep = new Uint8Array(nt); let kept = 0;
for (let t = 0; t < nt; t++) {
  let ok = true;
  for (let k = 0; k < 3 && ok; k++) { const i = idx[3 * t + k], y = C[3 * i + 1], h = halfAt(y); if (y < CUT_Y || Math.abs(U[i]) > h || Math.abs(V[i]) > h) ok = false; }
  if (ok) {
    // Below Y 40 only the shaft's own (near-vertical) walls are kept: the scanned Main roof sits
    // ~1.5 m above the authored roof there and would read as blobs around the shaft base.
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    const cy = (C[3 * a + 1] + C[3 * b + 1] + C[3 * c + 1]) / 3;
    if (cy < 40) {
      const ux = C[3 * b] - C[3 * a], uy = C[3 * b + 1] - C[3 * a + 1], uz = C[3 * b + 2] - C[3 * a + 2], vx = C[3 * c] - C[3 * a], vy = C[3 * c + 1] - C[3 * a + 1], vz = C[3 * c + 2] - C[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      const r = Math.max(Math.abs((U[a] + U[b] + U[c]) / 3), Math.abs((V[a] + V[b] + V[c]) / 3));
      if (Math.abs(ny / l) > 0.5 || r < 8.4) ok = false;
    }
  }
  if (ok) { keep[t] = 1; kept++; }
}
log('crop: kept', kept, 'of', nt);
// ---- 2. floating fragments (connectivity by welded position, 1 mm) ----
const parent = new Int32Array(nt).map((_, i) => i);
const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const owner = new Map();
for (let t = 0; t < nt; t++) if (keep[t]) for (let k = 0; k < 3; k++) {
  const i = idx[3 * t + k], key = `${Math.round(C[3 * i] * 1000)},${Math.round(C[3 * i + 1] * 1000)},${Math.round(C[3 * i + 2] * 1000)}`;
  const o = owner.get(key); if (o === undefined) owner.set(key, t); else { const a = find(o), b = find(t); if (a !== b) parent[a] = b; }
}
const compSize = new Map(); for (let t = 0; t < nt; t++) if (keep[t]) { const r = find(t); compSize.set(r, (compSize.get(r) ?? 0) + 1); }
const sizes = [...compSize.values()].sort((a, b) => b - a);
const MIN_COMPONENT = 200;
let dropped = 0, droppedComps = 0;
for (let t = 0; t < nt; t++) if (keep[t] && compSize.get(find(t)) < MIN_COMPONENT) { keep[t] = 0; dropped++; }
for (const s of compSize.values()) if (s < MIN_COMPONENT) droppedComps++;
log('components', compSize.size, 'largest', sizes.slice(0, 5), 'dropped', droppedComps, 'components /', dropped, 'triangles');
const tris = []; for (let t = 0; t < nt; t++) if (keep[t]) tris.push(t);

// ---- 3. quality metrics on the crop (before simplification) ----
const triArea = t => { const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]); const ux = C[3 * b] - C[3 * a], uy = C[3 * b + 1] - C[3 * a + 1], uz = C[3 * b + 2] - C[3 * a + 2], vx = C[3 * c] - C[3 * a], vy = C[3 * c + 1] - C[3 * a + 1], vz = C[3 * c + 2] - C[3 * a + 2]; return { area: 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), n: [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] }; };
const uvArea = t => { const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]); return 0.5 * Math.abs((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1])); };
const faces = { '+u': [], '-u': [], '+v': [], '-v': [] };
let areaAll = 0, pixAll = 0;
for (const t of tris) {
  const { area, n } = triArea(t); const T = tex[triMat[t]]; const px = uvArea(t) * T.w * T.h; areaAll += area; pixAll += px;
  const l = Math.hypot(...n) || 1, nu = (n[0] * eu[0] + n[2] * eu[1]) / l, nvv = (n[0] * ev[0] + n[2] * ev[1]) / l;
  const cy = (C[3 * idx[3 * t] + 1] + C[3 * idx[3 * t + 1] + 1] + C[3 * idx[3 * t + 2] + 1]) / 3;
  if (cy < 41 || cy > 86) continue;
  const key = Math.abs(nu) > 0.8 ? (nu > 0 ? '+u' : '-u') : Math.abs(nvv) > 0.8 ? (nvv > 0 ? '+v' : '-v') : null;
  if (key) faces[key].push([t, area, px]);
}
// facade hole coverage: 0.5 m cells on each shaft face plane (y 41..86, along-face -8.5..8.5), filled if a vertex lies within 0.8 m of the plane
const coverage = {};
for (const [key, axis, sign] of [['+u', 'u', 1], ['-u', 'u', -1], ['+v', 'v', 1], ['-v', 'v', -1]]) {
  const grid = new Uint8Array(34 * 90);
  for (const t of tris) {
    const [a, b, c] = [0, 1, 2].map(kk => idx[3 * t + kk]);
    const span = Math.max(Math.hypot(C[3 * a] - C[3 * b], C[3 * a + 1] - C[3 * b + 1], C[3 * a + 2] - C[3 * b + 2]), Math.hypot(C[3 * c] - C[3 * b], C[3 * c + 1] - C[3 * b + 1], C[3 * c + 2] - C[3 * b + 2]), Math.hypot(C[3 * a] - C[3 * c], C[3 * a + 1] - C[3 * c + 1], C[3 * a + 2] - C[3 * c + 2]));
    const n = Math.max(1, Math.ceil(span / 0.2));
    for (let i1 = 0; i1 <= n; i1++) for (let j1 = 0; j1 <= n - i1; j1++) {
      const wa = i1 / n, wb = j1 / n, wc = 1 - wa - wb;
      const y = wa * C[3 * a + 1] + wb * C[3 * b + 1] + wc * C[3 * c + 1];
      const uu = wa * U[a] + wb * U[b] + wc * U[c], vv = wa * V[a] + wb * V[b] + wc * V[c];
      const d = (axis === 'u' ? uu : vv) * sign, along = axis === 'u' ? vv : uu;
      if (y < 41 || y >= 86 || Math.abs(d - 9.0) > 0.8 || Math.abs(along) >= 8.5) continue;
      grid[Math.floor((y - 41) / 0.5) * 34 + Math.floor((along + 8.5) / 0.5)] = 1;
    }
  }
  const filled = grid.reduce((a, b) => a + b, 0), list = faces[key];
  const fa = list.reduce((a, q) => a + q[1], 0), fp = list.reduce((a, q) => a + q[2], 0);
  // compass direction of the outward normal (x east, z south)
  const nx = sign * (axis === 'u' ? eu[0] : ev[0]), nz = sign * (axis === 'u' ? eu[1] : ev[1]);
  const dir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'east' : 'west') : (nz > 0 ? 'south' : 'north');
  coverage[dir] = { cellsFilled: filled / grid.length, triangles: list.length, areaM2: +fa.toFixed(0), texelsPerMetre: +Math.sqrt(fp / fa).toFixed(1) };
}
log('shaft face coverage/texel density', JSON.stringify(coverage));
log('crop area m2', areaAll.toFixed(0), 'mean texels/m', Math.sqrt(pixAll / areaAll).toFixed(2));

// ---- 4. collider proxies from measured tiers ----
const surf = (r0, r1, y0, y1) => { // heights of upward-facing triangle centroids with max(|u|,|v|) in [r0,r1]
  const hs = [];
  for (const t of tris) { const { n } = triArea(t); const l = Math.hypot(...n); if (n[1] / l < 0.85) continue;
    const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]); const y = (C[3 * a + 1] + C[3 * b + 1] + C[3 * c + 1]) / 3, r = Math.max(Math.abs((U[a] + U[b] + U[c]) / 3), Math.abs((V[a] + V[b] + V[c]) / 3));
    if (r >= r0 && r <= r1 && y >= y0 && y <= y1) hs.push(y); }
  return hs.sort((p, q) => p - q);
};
const q = (a, f) => a[Math.floor(f * (a.length - 1))];
const deck = surf(8.0, 8.9, 85, 90), upperTop = surf(4.9, 7.5, 93, 98), belfryTop = surf(3.0, 4.4, 104, 109), lanternTop = surf(0, 3.0, 106, 112);
const parapet = []; for (const t of tris) for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]; const r = Math.max(Math.abs(U[i]), Math.abs(V[i])); if (r > 8.7 && r < 9.6 && C[3 * i + 1] > 85 && C[3 * i + 1] < 91) parapet.push(C[3 * i + 1]); }
parapet.sort((p, q2) => p - q2);
const tiers = {
  deck: { p10: q(deck, .1), p50: q(deck, .5), p90: q(deck, .9), n: deck.length },
  upperTop: { p10: q(upperTop, .1), p50: q(upperTop, .5), p90: q(upperTop, .9), n: upperTop.length },
  belfryTop: { p10: q(belfryTop, .1), p50: q(belfryTop, .5), p90: q(belfryTop, .9), n: belfryTop.length },
  lanternTop: { p50: q(lanternTop, .5), max: lanternTop[lanternTop.length - 1], n: lanternTop.length },
  parapetTop: q(parapet, 0.97),
};
log('tiers', JSON.stringify(tiers));
// Collision: one tower-aligned cuboid for the shaft (up to the deck's p10 height, so it never
// pokes through the walkable deck) plus a heightfield cap (below) sampled from the visible
// scan surface, so landable tops agree with what is drawn. Tier medians are kept for reference.
const proxies = [
  { name: 'shaft', half: 9.0, y0: CUT_Y, y1: tiers.deck.p10 },
];
// No parapet is resolved above the deck (parapetTop - deck < 0.05 m), so no parapet proxies.

// ---- 5. texture atlas from used charts only ----
const islandParent = new Map();
const ifind = a => { let r = a; while (islandParent.get(r) !== r) r = islandParent.get(r); let b = a; while (islandParent.get(b) !== r) { const n = islandParent.get(b); islandParent.set(b, r); b = n; } return r; };
for (const t of tris) for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]; if (!islandParent.has(i)) islandParent.set(i, i); }
for (const t of tris) { const a = ifind(idx[3 * t]), b = ifind(idx[3 * t + 1]), c = ifind(idx[3 * t + 2]); islandParent.set(a, c); if (ifind(b) !== c) islandParent.set(ifind(b), c); }
const islands = new Map(); // root -> {mat, x0,y0,x1,y1}
for (const t of tris) for (let k = 0; k < 3; k++) {
  const i = idx[3 * t + k], r = ifind(i), T = tex[triMat[t]];
  const px = uv[2 * i] * T.w, py = uv[2 * i + 1] * T.h;
  let isl = islands.get(r); if (!isl) islands.set(r, isl = { mat: triMat[t], x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  isl.x0 = Math.min(isl.x0, px); isl.y0 = Math.min(isl.y0, py); isl.x1 = Math.max(isl.x1, px); isl.y1 = Math.max(isl.y1, py);
}
const PAD = 2;
const rects = [...islands.entries()].map(([root, s]) => {
  const T = tex[s.mat];
  const x0 = Math.max(0, Math.floor(s.x0) - PAD), y0 = Math.max(0, Math.floor(s.y0) - PAD), x1 = Math.min(T.w, Math.ceil(s.x1) + PAD), y1 = Math.min(T.h, Math.ceil(s.y1) + PAD);
  return { root, mat: s.mat, x0, y0, w: x1 - x0, h: y1 - y0 };
});
const srcPixels = rects.reduce((a, r) => a + r.w * r.h, 0);
const pack = (W, k) => { // shelf pack scaled rects into width W; returns height
  const order = [...rects].sort((a, b) => b.h - a.h); let x = 0, y = 0, rowH = 0;
  for (const r of order) { const w = Math.ceil(r.w * k), h = Math.ceil(r.h * k); if (x + w > W) { x = 0; y += rowH; rowH = 0; } r.ax = x; r.ay = y; r.aw = w; r.ah = h; x += w; rowH = Math.max(rowH, h); }
  return y + rowH;
};
const ATLAS = 4096; let k = 1;
while (pack(ATLAS, k) > ATLAS) k *= 0.97;
const atlasH = Math.min(ATLAS, 1 << Math.ceil(Math.log2(pack(ATLAS, k))));
log('islands', rects.length, 'source chart pixels', srcPixels, 'atlas', ATLAS, 'x', atlasH, 'scale', k.toFixed(3));
const atlas = Buffer.alloc(ATLAS * atlasH * 3, 0);
for (const r of rects) {
  const T = tex[r.mat];
  for (let y = 0; y < r.ah; y++) for (let x = 0; x < r.aw; x++) {
    const sx = Math.min(T.w - 1, Math.floor(r.x0 + (x + 0.5) / k)), sy = Math.min(T.h - 1, Math.floor(r.y0 + (y + 0.5) / k));
    const so = (sy * T.w + sx) * 4, o = ((r.ay + y) * ATLAS + r.ax + x) * 3;
    atlas[o] = T.data[so]; atlas[o + 1] = T.data[so + 1]; atlas[o + 2] = T.data[so + 2];
  }
}
const rectOf = new Map(rects.map(r => [r.root, r]));
// Sky bleed: the open lantern rim carries sky-blue texels. Desaturate blue-dominant pixels only
// in charts whose triangles lie above Y 104 (luminance kept; recorded in metadata).
const islandY = new Map();
for (const t of tris) { const r = ifind(idx[3 * t]); const y = (C[3 * idx[3 * t] + 1] + C[3 * idx[3 * t + 1] + 1] + C[3 * idx[3 * t + 2] + 1]) / 3; const e = islandY.get(r) ?? [0, 0]; e[0] += y; e[1]++; islandY.set(r, e); }
let desaturated = 0;
for (const r of rects) {
  const e = islandY.get(r.root); if (!e || e[0] / e[1] < 104) continue;
  for (let y = 0; y < r.ah; y++) for (let x = 0; x < r.aw; x++) {
    const o = ((r.ay + y) * ATLAS + r.ax + x) * 3, R = atlas[o], G = atlas[o + 1], B = atlas[o + 2];
    if (B > R + 20 && B > G + 8) { const L = Math.round(0.3 * R + 0.59 * G + 0.11 * B); atlas[o] = Math.min(255, L + 6); atlas[o + 1] = Math.min(255, L + 3); atlas[o + 2] = L; desaturated++; }
  }
}
log('desaturated sky-bleed texels', desaturated);
// ---- 6. compact vertex buffers (tower-local metres; anchor = shaft centre at Y 0) ----
const anchor = [cx, 0, cz];
const vmap = new Map(); const P = [], UVs = [], I = [];
for (const t of tris) for (let kk = 0; kk < 3; kk++) {
  const i = idx[3 * t + kk]; let j = vmap.get(i);
  if (j === undefined) {
    j = vmap.size; vmap.set(i, j); const r = rectOf.get(ifind(i)), T = tex[r.mat];
    P.push(C[3 * i] - anchor[0], C[3 * i + 1], C[3 * i + 2] - anchor[2]);
    UVs.push((r.ax + (uv[2 * i] * T.w - r.x0) * k) / ATLAS, (r.ay + (uv[2 * i + 1] * T.h - r.y0) * k) / atlasH);
  }
  I.push(j);
}
const positions = new Float32Array(P), uvs = new Float32Array(UVs), indices = new Uint32Array(I);
// Open lantern top: find the largest open boundary loop above Y 107 (welded at 1 mm) and close it
// with a flat fan at its mean rim height. This lid is AUTHORED infill (the scan has no roof there).
const wkey = j => `${Math.round(positions[3 * j] * 1000)},${Math.round(positions[3 * j + 1] * 1000)},${Math.round(positions[3 * j + 2] * 1000)}`;
const weld = new Map(), wid = new Int32Array(positions.length / 3);
for (let j = 0; j < wid.length; j++) { const kk = wkey(j); if (!weld.has(kk)) weld.set(kk, j); wid[j] = weld.get(kk); }
const edgeCount = new Map();
for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { const a = wid[indices[t + e]], b = wid[indices[t + (e + 1) % 3]]; const kk = a < b ? a + '_' + b : b + '_' + a; edgeCount.set(kk, (edgeCount.get(kk) ?? 0) + 1); }
const next = new Map();
for (const [kk, n] of edgeCount) { if (n !== 1) continue; const [a, b] = kk.split('_').map(Number); if (positions[3 * a + 1] < 107 || positions[3 * b + 1] < 107) continue; (next.get(a) ?? next.set(a, []).get(a)).push(b); (next.get(b) ?? next.set(b, []).get(b)).push(a); }
const seen = new Set(); let bestLoop = [];
for (const start of next.keys()) { if (seen.has(start)) continue; const loop = [start]; seen.add(start); let cur = start, prev = -1;
  for (;;) { const nb = (next.get(cur) ?? []).find(v => v !== prev && !seen.has(v)); if (nb === undefined) break; loop.push(nb); seen.add(nb); prev = cur; cur = nb; }
  if (loop.length > bestLoop.length) bestLoop = loop; }
const lid = { loopVertices: bestLoop.length, y: 0, radius: 0 };
if (bestLoop.length >= 8) {
  const cxL = bestLoop.reduce((a, j) => a + positions[3 * j], 0) / bestLoop.length, czL = bestLoop.reduce((a, j) => a + positions[3 * j + 2], 0) / bestLoop.length;
  lid.y = bestLoop.reduce((a, j) => a + positions[3 * j + 1], 0) / bestLoop.length;
  lid.radius = bestLoop.reduce((a, j) => a + Math.hypot(positions[3 * j] - cxL, positions[3 * j + 2] - czL), 0) / bestLoop.length;
  lid.center = [cxL, czL];
  const lp = [cxL, lid.y, czL]; const li = [];
  const ring = bestLoop.map(j => [positions[3 * j], positions[3 * j + 1], positions[3 * j + 2]]);
  for (const q of ring) lp.push(...q);
  for (let i = 0; i < ring.length; i++) { const a = 1 + i, b = 1 + (i + 1) % ring.length; li.push(0, a, b); }
  // face up
  const [ax, , az] = ring[0], [bx, , bz] = ring[1]; if ((ax - cxL) * (bz - czL) - (az - czL) * (bx - cxL) > 0) for (let i = 0; i < li.length; i += 3) { const tmp = li[i + 1]; li[i + 1] = li[i + 2]; li[i + 2] = tmp; }
  lid.positions = new Float32Array(lp); lid.indices = new Uint16Array(li);
}
log('lid', JSON.stringify({ loopVertices: lid.loopVertices, y: lid.y, radius: lid.radius }));
// ---- heightfield cap: topmost visible surface at grid points over the shaft square ----
const HF = { half: 9.0, step: 0.25 }; HF.n = Math.round(2 * HF.half / HF.step); // cells per side
const capTris = []; // [ax,ay,az,bx,by,bz,cx,cy,cz] in local xz, absolute y
const pushTri = (P3, i0, i1, i2) => capTris.push([P3[3 * i0], P3[3 * i0 + 1], P3[3 * i0 + 2], P3[3 * i1], P3[3 * i1 + 1], P3[3 * i1 + 2], P3[3 * i2], P3[3 * i2 + 1], P3[3 * i2 + 2]]);
for (let t = 0; t < indices.length; t += 3) pushTri(positions, indices[t], indices[t + 1], indices[t + 2]);
if (lid.positions) for (let t = 0; t < lid.indices.length; t += 3) pushTri(lid.positions, lid.indices[t], lid.indices[t + 1], lid.indices[t + 2]);
const topAt = (x, z) => { let best = -Infinity; for (const q of capTris) {
  if (x < Math.min(q[0], q[3], q[6]) || x > Math.max(q[0], q[3], q[6]) || z < Math.min(q[2], q[5], q[8]) || z > Math.max(q[2], q[5], q[8])) continue;
  const den = (q[5] - q[8]) * (q[0] - q[6]) + (q[6] - q[3]) * (q[2] - q[8]); if (Math.abs(den) < 1e-12) continue;
  const w0 = ((q[5] - q[8]) * (x - q[6]) + (q[6] - q[3]) * (z - q[8])) / den, w1 = ((q[8] - q[2]) * (x - q[6]) + (q[0] - q[6]) * (z - q[8])) / den, w2 = 1 - w0 - w1;
  if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; best = Math.max(best, w0 * q[1] + w1 * q[4] + w2 * q[7]); } return best; };
// rows along v (local z of the collider), columns along u (local x); Rapier stores column-major
const hfHeights = [];
let hfMissing = 0;
for (let col = 0; col <= HF.n; col++) for (let row = 0; row <= HF.n; row++) {
  const a = -HF.half + col * HF.step, b = -HF.half + row * HF.step;
  const x = a * eu[0] + b * ev[0], z = a * eu[1] + b * ev[1];
  let h = topAt(x, z); if (!Number.isFinite(h) || h < tiers.deck.p10 - 0.5) { h = tiers.deck.p10; hfMissing++; }
  hfHeights.push(+h.toFixed(3));
}
const heightfield = { rowsAlong: 'v', colsAlong: 'u', nrows: HF.n, ncols: HF.n, size: 2 * HF.half, step: HF.step, heightsColumnMajor: hfHeights, missingFilledWithDeck: hfMissing };
log('heightfield', HF.n + 1, 'x', HF.n + 1, 'min', Math.min(...hfHeights).toFixed(2), 'max', Math.max(...hfHeights).toFixed(2), 'filled', hfMissing);
log('compact', positions.length / 3, 'vertices', indices.length / 3, 'triangles');

// ---- 6b. relight: rotate the photographed sun onto the game sun (once, per vertex) ----
// The capture was lit from the SSW (south/west faces sunlit, north/east in shade); the game sun
// is the calibrated preset (ESE). The atlas texels stay exactly as photographed; a per-vertex
// linear multiplier (COLOR_0, normalised uint16 / RELIGHT_SCALE) replaces the photographed
// direct-sun term of each wall orientation with the game's. Model, fitted to the shaft walls:
// sRGB colour(az) = ambient + sun * max(0, cos(az - sunAz)), per channel. Upward/downward
// surfaces keep the photographed light (weight fades to 0 as |normal.y| grows).
const GAME_SUN = { azimuthDeg: 121.2, elevationDeg: 41.9, source: 'lib/campus/render/lighting-presets.ts AUSTIN_LATE_MORNING (SHOT_SUN)' };
const RELIGHT_SCALE = 8;
const nv2 = positions.length / 3;
const atlasAt = (s, t) => { const x = Math.min(ATLAS - 1, Math.max(0, Math.floor(s * ATLAS))), y = Math.min(atlasH - 1, Math.max(0, Math.floor(t * atlasH))), o = (y * ATLAS + x) * 3; return [atlas[o], atlas[o + 1], atlas[o + 2]]; };
const srgbToLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
// smoothed vertex normals over welded positions (area weighted, 2 one-ring passes)
const vn = new Float64Array(nv2 * 3);
for (let t = 0; t < indices.length; t += 3) {
  const [a, b, c] = [wid[indices[t]], wid[indices[t + 1]], wid[indices[t + 2]]];
  const ux = positions[3 * b] - positions[3 * a], uy = positions[3 * b + 1] - positions[3 * a + 1], uz = positions[3 * b + 2] - positions[3 * a + 2];
  const vx = positions[3 * c] - positions[3 * a], vy = positions[3 * c + 1] - positions[3 * a + 1], vz = positions[3 * c + 2] - positions[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const j of [a, b, c]) { vn[3 * j] += nx; vn[3 * j + 1] += ny; vn[3 * j + 2] += nz; }
}
for (let pass = 0; pass < 2; pass++) {
  const acc = Float64Array.from(vn);
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = wid[indices[t + e]], b = wid[indices[t + (e + 1) % 3]];
    for (let k = 0; k < 3; k++) { acc[3 * a + k] += vn[3 * b + k] * 0.5; acc[3 * b + k] += vn[3 * a + k] * 0.5; }
  }
  vn.set(acc);
}
const normalAt = j => { const w = wid[j], l = Math.hypot(vn[3 * w], vn[3 * w + 1], vn[3 * w + 2]) || 1; return [vn[3 * w] / l, vn[3 * w + 1] / l, vn[3 * w + 2] / l]; };
const compassAz = (nx, nz) => (Math.atan2(nx, -nz) * 180 / Math.PI + 360) % 360; // 0 = north (-z), 90 = east (+x)
// fit the photographed wall lighting: 15-degree azimuth bins of the shaft walls (Y 41..86)
const azBins = Array.from({ length: 24 }, () => []);
for (let t = 0; t < indices.length; t += 3) {
  const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
  const y = (positions[3 * a + 1] + positions[3 * b + 1] + positions[3 * c + 1]) / 3; if (y < 41 || y > 86) continue;
  const ux = positions[3 * b] - positions[3 * a], uy = positions[3 * b + 1] - positions[3 * a + 1], uz = positions[3 * b + 2] - positions[3 * a + 2];
  const vx = positions[3 * c] - positions[3 * a], vy = positions[3 * c + 1] - positions[3 * a + 1], vz = positions[3 * c + 2] - positions[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (!l || Math.abs(ny / l) > 0.2) continue;
  azBins[Math.floor(compassAz(nx, nz) / 15) % 24].push(atlasAt((uvs[2 * a] + uvs[2 * b] + uvs[2 * c]) / 3, (uvs[2 * a + 1] + uvs[2 * b + 1] + uvs[2 * c + 1]) / 3));
}
const binStats = azBins.map((list, i) => ({ az: i * 15 + 7.5, n: list.length, rgb: [0, 1, 2].map(k => { const s = list.map(p => p[k]).sort((p, q2) => p - q2); return s.length ? s[Math.floor(s.length / 2)] : 0; }) })).filter(b => b.n >= 40);
let photoFit = null;
for (let phi = 0; phi < 360; phi += 0.5) {
  // weighted linear least squares per channel for ambient + sun * max(0, cos(az - phi))
  const fit = [0, 1, 2].map(k => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const b of binStats) { const x = Math.max(0, Math.cos((b.az - phi) * Math.PI / 180)), w = b.n; sw += w; sx += w * x; sy += w * b.rgb[k]; sxx += w * x * x; sxy += w * x * b.rgb[k]; }
    const sun = (sw * sxy - sx * sy) / (sw * sxx - sx * sx), amb = (sy - sun * sx) / sw;
    let err = 0; for (const b of binStats) err += b.n * (amb + sun * Math.max(0, Math.cos((b.az - phi) * Math.PI / 180)) - b.rgb[k]) ** 2;
    return { amb, sun, err };
  });
  const err = fit.reduce((s, f) => s + f.err, 0);
  if (!photoFit || err < photoFit.err) photoFit = { azimuthDeg: phi, ambient: fit.map(f => f.amb), sun: fit.map(f => f.sun), err };
}
const nTot = binStats.reduce((s, b) => s + b.n, 0);
photoFit.rmsSrgb = Math.sqrt(photoFit.err / nTot / 3); delete photoFit.err;
log('photographed wall light fit', JSON.stringify(photoFit), 'game sun', JSON.stringify(GAME_SUN));
const wallLight = (az, sunAz) => [0, 1, 2].map(k => photoFit.ambient[k] + photoFit.sun[k] * Math.max(0, Math.cos((az - sunAz) * Math.PI / 180)));
const relightAt = n => {
  const h = Math.hypot(n[0], n[2]); const w = Math.min(1, Math.max(0, (h - 0.35) / 0.45)), ws = w * w * (3 - 2 * w);
  if (ws <= 0) return [1, 1, 1];
  const az = compassAz(n[0], n[2]), from = wallLight(az, photoFit.azimuthDeg), to = wallLight(az, GAME_SUN.azimuthDeg);
  // sRGB-domain ratio -> linear multiplier (ratio of linearised values at the modelled wall colour)
  return [0, 1, 2].map(k => Math.min(RELIGHT_SCALE, Math.max(0.05, Math.exp(ws * Math.log(srgbToLin(Math.min(255, to[k])) / srgbToLin(from[k]))))));
};
// Local photographed colour per vertex (area-weighted triangle samples, 2 one-ring passes): where
// a wall was lit differently from the model (sun grazing round a corner, cast shadows), the
// multiplier is clamped so the local relit colour stays within RELIGHT_BAND of the modelled
// game-lit wall colour instead of blowing out or crushing.
const RELIGHT_BAND = [0.6, 1.15];
const localCol = new Float64Array(nv2 * 4);
for (let t = 0; t < indices.length; t += 3) {
  const ids = [indices[t], indices[t + 1], indices[t + 2]];
  const ux = positions[3 * ids[1]] - positions[3 * ids[0]], uy = positions[3 * ids[1] + 1] - positions[3 * ids[0] + 1], uz = positions[3 * ids[1] + 2] - positions[3 * ids[0] + 2];
  const vx = positions[3 * ids[2]] - positions[3 * ids[0]], vy = positions[3 * ids[2] + 1] - positions[3 * ids[0] + 1], vz = positions[3 * ids[2] + 2] - positions[3 * ids[0] + 2];
  const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) + 1e-6;
  const c = [0, 0, 0];
  for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) { const p = atlasAt(wa * uvs[2 * ids[0]] + wb * uvs[2 * ids[1]] + wc * uvs[2 * ids[2]], wa * uvs[2 * ids[0] + 1] + wb * uvs[2 * ids[1] + 1] + wc * uvs[2 * ids[2] + 1]); for (let k = 0; k < 3; k++) c[k] += srgbToLin(p[k]) / 4; }
  for (const i of ids) { const w = wid[i]; for (let k = 0; k < 3; k++) localCol[4 * w + k] += ar * c[k]; localCol[4 * w + 3] += ar; }
}
for (let pass = 0; pass < 2; pass++) {
  const acc = Float64Array.from(localCol);
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { const a = wid[indices[t + e]], b = wid[indices[t + (e + 1) % 3]]; for (let k = 0; k < 4; k++) { acc[4 * a + k] += localCol[4 * b + k] * 0.5; acc[4 * b + k] += localCol[4 * a + k] * 0.5; } }
  localCol.set(acc);
}
const relight = new Float32Array(nv2 * 3);
let clampedHi = 0, clampedLo = 0;
const lumLin = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
for (let j = 0; j < nv2; j++) {
  const n = normalAt(j), m = relightAt(n), h = Math.hypot(n[0], n[2]), w = wid[j];
  if (h > 0.35) {
    // luminance-only clamp (one scalar for all channels, so hue is never shifted); it only limits
    // brightening (m > 1) or darkening (m < 1) and never reverses or exceeds the modelled change
    const target = lumLin(wallLight(compassAz(n[0], n[2]), GAME_SUN.azimuthDeg).map(v => srgbToLin(Math.min(255, v))));
    const local = [0, 1, 2].map(k => localCol[4 * w + k] / localCol[4 * w + 3]), lumM = lumLin(local.map((v, k) => v * m[k])) / lumLin(local);
    const ws = Math.min(1, (h - 0.35) / 0.45);
    let want = lumM;
    if (lumM > 1) { want = Math.max(1, Math.min(lumM, RELIGHT_BAND[1] * target / lumLin(local))); if (want < lumM) clampedHi++; }
    else if (lumM < 1) { want = Math.min(1, Math.max(lumM, RELIGHT_BAND[0] * target / lumLin(local))); if (want > lumM) clampedLo++; }
    const scale = Math.exp(ws * Math.log(want / lumM));
    for (let k = 0; k < 3; k++) m[k] = Math.min(RELIGHT_SCALE, m[k] * scale);
  }
  relight.set(m, 3 * j);
}
log('relight clamp', JSON.stringify({ vertices: nv2, clampedHigh: clampedHi, clampedLow: clampedLo, band: RELIGHT_BAND }));
const faceRelight = {};
for (const [dir, az] of [['north', 0], ['east', 90], ['south', 180], ['west', 270]]) { const r = relightAt([Math.sin(az * Math.PI / 180), 0, -Math.cos(az * Math.PI / 180)]); faceRelight[dir] = { linear: r.map(x => +x.toFixed(3)), photoSrgb: wallLight(az, photoFit.azimuthDeg).map(x => +x.toFixed(1)), gameSrgb: wallLight(az, GAME_SUN.azimuthDeg).map(x => +x.toFixed(1)) }; }
log('face relight', JSON.stringify(faceRelight));

// ---- 6c. shaft window strips: measured registration for authored detail ----
// Each shaft face carries three recessed window strips (glazed two-light windows over gilded
// two-panel spandrels, one per floor). The scan resolves them only as soft dark/gold bands
// (~19 texels/m, ~0.1 m recess), so the near LOD adds an authored strip surface registered to
// the measured bands: strip centres, width, floor pitch/phase and extent from the scan
// texture, plane from the scan surface. Average colour is matched to the relit captured strip
// so the authored detail and the far LOD agree at distance.
const FACES = { south: [ev, eu], north: [[-ev[0], -ev[1]], [-eu[0], -eu[1]]], east: [eu, [-ev[0], -ev[1]]], west: [[-eu[0], -eu[1]], ev] }; // [outward, along (left->right seen from outside)]
const NOMINAL = [-3.4, 0, 3.35];
// deterministic samples over the compact mesh: barycentric lattice per triangle (~0.1 m)
const surfaceSamples = (fn, yMin = 38, yMax = 88) => {
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const ya = positions[3 * a + 1], yb = positions[3 * b + 1], yc = positions[3 * c + 1]; if (Math.max(ya, yb, yc) < yMin || Math.min(ya, yb, yc) > yMax) continue;
    const span = Math.max(Math.hypot(positions[3 * a] - positions[3 * b], ya - yb, positions[3 * a + 2] - positions[3 * b + 2]), Math.hypot(positions[3 * c] - positions[3 * b], yc - yb, positions[3 * c + 2] - positions[3 * b + 2]), Math.hypot(positions[3 * a] - positions[3 * c], ya - yc, positions[3 * a + 2] - positions[3 * c + 2]));
    const n = Math.max(1, Math.ceil(span / 0.1));
    for (let i1 = 0; i1 <= n; i1++) for (let j1 = 0; j1 <= n - i1; j1++) {
      const wa = (i1 + 1 / 3) / (n + 1), wb = (j1 + 1 / 3) / (n + 1), wc = 1 - wa - wb; if (wc < 0) continue;
      const p = [0, 1, 2].map(k => wa * positions[3 * a + k] + wb * positions[3 * b + k] + wc * positions[3 * c + k]);
      fn(p, wa * uvs[2 * a] + wb * uvs[2 * b] + wc * uvs[2 * c], wa * uvs[2 * a + 1] + wb * uvs[2 * b + 1] + wc * uvs[2 * c + 1], [a, b, c], [wa, wb, wc]);
    }
  }
};
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const median = a => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const faceSamples = Object.fromEntries(Object.keys(FACES).map(f => [f, []]));
surfaceSamples((p, s, t, ids, w) => {
  for (const [f, [o, al]] of Object.entries(FACES)) {
    const d = p[0] * o[0] + p[2] * o[1]; if (d < 8.3 || d > 9.4) continue;
    const along = p[0] * al[0] + p[2] * al[1]; if (Math.abs(along) > 8.6) continue;
    const col = atlasAt(s, t), rl = [0, 1, 2].map(k => ids.reduce((acc, j, q2) => acc + w[q2] * relight[3 * j + k], 0));
    faceSamples[f].push({ y: p[1], d, along, col, rl });
  }
});
const BIN = 0.1;
const stripFaces = {};
for (const [f, list] of Object.entries(faceSamples)) {
  const band = list.filter(q2 => q2.y > 46 && q2.y < 82);
  const prof = Array.from({ length: 172 }, () => []);
  for (const q2 of band) { const i = Math.floor((q2.along + 8.6) / BIN); if (i >= 0 && i < 172) prof[i].push(luma(q2.col)); }
  const L = prof.map(median), stone = median(L.filter((_, i) => { const a = -8.6 + (i + 0.5) * BIN; return NOMINAL.every(c => Math.abs(a - c) > 1.0) && Math.abs(a) < 8; }));
  const strips = NOMINAL.map(c => {
    let wsum = 0, asum = 0, lo = Infinity, hi = -Infinity, dark = Infinity;
    for (let i = 0; i < 172; i++) { const a = -8.6 + (i + 0.5) * BIN; if (Math.abs(a - c) <= 0.8 && Number.isFinite(L[i])) dark = Math.min(dark, L[i]); }
    for (let i = 0; i < 172; i++) { const a = -8.6 + (i + 0.5) * BIN; if (Math.abs(a - c) > 0.9 || !Number.isFinite(L[i])) continue; const k2 = Math.max(0, stone - L[i]); wsum += k2; asum += k2 * a; if (L[i] < stone - 0.5 * (stone - dark)) { lo = Math.min(lo, a - BIN / 2); hi = Math.max(hi, a + BIN / 2); } }
    return { centre: asum / wsum, halfWidthMeasured: (hi - lo) / 2, contrast: stone - dark };
  });
  stripFaces[f] = { stoneLuma: stone, strips };
}
const STRIP_W = +(2 * median(Object.values(stripFaces).flatMap(sf => sf.strips.map(s => s.halfWidthMeasured)))).toFixed(2);
// floor pitch + phase: gilded spandrels peak in (R - B) along every strip of every face
const goldRows = new Map();
for (const [f, list] of Object.entries(faceSamples)) for (const q2 of list) {
  const s = stripFaces[f].strips.find(st => Math.abs(q2.along - st.centre) < STRIP_W * 0.35); if (!s || q2.y < 44 || q2.y > 82) continue;
  const key = `${f}:${stripFaces[f].strips.indexOf(s)}:${Math.floor(q2.y / 0.05)}`; const e = goldRows.get(key) ?? goldRows.set(key, [0, 0]).get(key); e[0] += q2.col[0] - q2.col[2]; e[1]++;
}
const goldByStrip = new Map();
for (const [key, [sum, n]] of goldRows) { const [f, si, yi] = key.split(':'); const id = f + si; (goldByStrip.get(id) ?? goldByStrip.set(id, []).get(id)).push([(+yi + 0.5) * 0.05, sum / n]); }
const goldSeries = [...goldByStrip.values()].map(rows => { const m = rows.reduce((s, r) => s + r[1], 0) / rows.length, sd = Math.sqrt(rows.reduce((s, r) => s + (r[1] - m) ** 2, 0) / rows.length) || 1; return rows.map(([y, g]) => [y, (g - m) / sd]); });
let floors = null;
for (let pitch = 2.4; pitch <= 2.75; pitch += 0.0025) for (let phase = 0; phase < pitch; phase += 0.01) {
  let score = 0, n = 0; for (const rows of goldSeries) for (const [y, g] of rows) { score += g * Math.cos(2 * Math.PI * (y - phase) / pitch); n++; }
  score /= n; if (!floors || score > floors.score) floors = { pitch, phase, score };
}
// strip extent: rows (0.25 m) where the strip is darker than the adjacent stone on most faces
const extentRows = [];
for (let y = 38; y < 88; y += 0.25) {
  let darker = 0, total = 0;
  for (const [f, list] of Object.entries(faceSamples)) {
    const rowS = list.filter(q2 => q2.y >= y && q2.y < y + 0.25);
    const stoneRow = median(rowS.filter(q2 => stripFaces[f].strips.every(s => Math.abs(q2.along - s.centre) > STRIP_W)).map(q2 => luma(q2.col)));
    for (const s of stripFaces[f].strips) { const inS = median(rowS.filter(q2 => Math.abs(q2.along - s.centre) < STRIP_W * 0.35).map(q2 => luma(q2.col))); if (Number.isFinite(inS) && Number.isFinite(stoneRow)) { total++; if (inS < 0.9 * stoneRow) darker++; } }
  }
  extentRows.push([y, total ? darker / total : 0]);
}
// longest run of strip rows (gaps <= 0.5 m tolerated); the darker band under Y ~41 is the shaft base, not glazing
let best = null, cur = null;
for (const [y, frac] of extentRows) {
  if (frac >= 0.5) { if (cur && y - cur[1] <= 0.75) cur[1] = y; else cur = [y, y]; if (!best || cur[1] - cur[0] > best[1] - best[0]) best = [...cur]; }
}
const run = [best[0], best[1] + 0.25];
// Snap to the fitted floor grid. One floor tile, bottom -> top: bar, gilded spandrel, bar, window
// (0.51..1.0). Measured: the strips start with a window under the lowest spandrel and end with the
// topmost spandrel + bar, so both ends sit at a window's lower edge (tile 0.51).
const SPANDREL_CENTRE = 0.255, WINDOW_BASE = 0.51; // tile fractions (pattern below)
const floorBase = k => floors.phase - SPANDREL_CENTRE * floors.pitch + k * floors.pitch;
const snapEnd = y => { const k = Math.round((y - WINDOW_BASE * floors.pitch - floorBase(0)) / floors.pitch); return { k, y: floorBase(k) + WINDOW_BASE * floors.pitch }; };
const lo = snapEnd(run[0]), hi = snapEnd(run[1]);
const stripY0 = lo.y, stripY1 = hi.y;
log('window strips', JSON.stringify({ width: STRIP_W, floors, measuredExtent: run, snapped: [stripY0, stripY1], spandrels: hi.k - lo.k, faces: Object.fromEntries(Object.entries(stripFaces).map(([f, sf]) => [f, sf.strips.map(s => +s.centre.toFixed(3))])) }));
// Per strip: wall plane beside the strip (depth linear in Y, 1 m row medians), the relit captured
// mean colour inside the strip (to calibrate the authored panel), and the stone beside it.
// The near LOD drops the scan surface inside each strip and shows an authored recessed channel
// instead (panel RECESS behind the wall plane, stone reveals, sill and head).
const RECESS = 0.18; // estimate: the scan smooths the recess to ~0.1 m; photographs show a deep channel with bronze-framed glazing
const linFit = (pts) => { const my = pts.reduce((a, r) => a + r[0], 0) / pts.length, md = pts.reduce((a, r) => a + r[1], 0) / pts.length; const sl = pts.reduce((a, r) => a + (r[0] - my) * (r[1] - md), 0) / pts.reduce((a, r) => a + (r[0] - my) ** 2, 0); return y => md + sl * (y - my); };
const strips = [];
for (const [f, [o, al]] of Object.entries(FACES)) for (const s of stripFaces[f].strips) {
  const inStrip = q2 => Math.abs(q2.along - s.centre) < STRIP_W / 2 - 0.08 && q2.y >= stripY0 && q2.y <= stripY1;
  const beside = q2 => { const dA = Math.abs(q2.along - s.centre); return dA > STRIP_W / 2 + 0.15 && dA < STRIP_W / 2 + 0.6 && q2.y >= stripY0 && q2.y <= stripY1; };
  const inside = faceSamples[f].filter(inStrip), wall = faceSamples[f].filter(beside);
  const rows = []; for (let y = stripY0; y < stripY1; y += 1) { const r = wall.filter(q2 => q2.y >= y && q2.y < y + 1); if (r.length > 10) rows.push([y + 0.5, median(r.map(q2 => q2.d))]); }
  const wallAt = linFit(rows);
  const wallExcess = wall.map(q2 => q2.d - wallAt(q2.y)).sort((p, q3) => p - q3);
  const meanLin = list => [0, 1, 2].map(k => list.reduce((a, q2) => a + srgbToLin(q2.col[k]) * q2.rl[k], 0) / list.length);
  strips.push({ face: f, centre: s.centre, outward: o, along: al, wallAt, wall0: wallAt(stripY0), wall1: wallAt(stripY1), wallP95: wallExcess[Math.floor(0.95 * wallExcess.length)], capturedMeanLinear: meanLin(inside), stoneMeanLinear: meanLin(wall) });
}
log('strip walls', JSON.stringify(strips.map(s => ({ f: s.face, c: +s.centre.toFixed(2), d0: +s.wall0.toFixed(3), d1: +s.wall1.toFixed(3), p95: +s.wallP95.toFixed(3) }))));
// Authored detail atlas (512 x 512, RGB). Upper half drawn here (no photographic texels):
//   x 0..127   one shaft-window floor tile (bronze reveals and bars, two-light window with a central
//              mullion over a gilded spandrel with two stepped panels), from reference proportions;
//   x 128..255 bronze fill (mip padding);
//   x 256..511 one clock dial (gold bezel, pale blue-green field, dark red radial Roman numerals,
//              gold hands at 10:45, the time of the game's fixed sun), from reference photographs.
const AW = 512, AH = 512, TW = 128;
const authoredAtlas = Buffer.alloc(AW * AH * 3);
// sRGB, relative tones only (each strip's average is calibrated to the captured strip): glass reads dark
// from the ground except when it mirrors the sky; the spandrels are dull gilding, not bright gold.
const PAL = { bronze: [52, 40, 28], bronzeLit: [92, 74, 50], gold: [164, 140, 96], goldShade: [106, 86, 56], goldLit: [196, 178, 134], glassTop: [74, 80, 88], glassBottom: [46, 50, 56] };
const paintStrip = (x, y) => { // x,y in [0,1], y up
  if (x < 0.035 || x > 0.965) return PAL.bronze;
  if (y < 0.045 || (y >= 0.465 && y < 0.51)) return (y > 0.035 && y < 0.045) || (y > 0.5 && y < 0.51) ? PAL.bronzeLit : PAL.bronze;
  if (y < 0.465) { // spandrel: two panels, three-step moulding (shadowed left/bottom, lit top/right)
    if (x > 0.49 && x < 0.51) return PAL.bronze;
    const px0 = x < 0.5 ? 0.06 : 0.53, px1 = x < 0.5 ? 0.47 : 0.94, py0 = 0.07, py1 = 0.44;
    if (x < px0 || x > px1 || y < py0 || y > py1) return PAL.goldShade;
    for (let st = 0; st < 3; st++) { const ix = 0.025 * st, iy = 0.022 * st, e = 0.008;
      if (x >= px0 + ix && x < px0 + ix + e && y > py0 + iy && y < py1 - iy) return PAL.goldShade;
      if (y >= py0 + iy && y < py0 + iy + e && x > px0 + ix && x < px1 - ix) return PAL.goldShade;
      if (x <= px1 - ix && x > px1 - ix - e && y > py0 + iy && y < py1 - iy) return PAL.goldLit;
      if (y <= py1 - iy && y > py1 - iy - e && x > px0 + ix && x < px1 - ix) return PAL.goldLit; }
    return PAL.gold;
  }
  // window: bronze frame, two lights, central mullion
  if (y > 0.985 || (x > 0.485 && x < 0.515) || x < 0.06 || x > 0.94 || y < 0.53) return PAL.bronze;
  const g = (y - 0.53) / 0.455; return [0, 1, 2].map(k => PAL.glassBottom[k] + (PAL.glassTop[k] - PAL.glassBottom[k]) * g);
};
// Clock dial, drawn in sunlit tones (vertex colour shades it per face). Coordinates x,y in [-1,1], y up.
const DIAL = { bezel: [206, 168, 72], bezelShade: [150, 116, 44], field: [170, 198, 190], numeral: [128, 42, 34], hand: [212, 172, 70] };
const NUMERALS = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const glyphW = { I: 0.045, V: 0.1, X: 0.1 }, GAP = 0.018, GH = 0.17, SW = 0.024, RN = 0.71;
const numeralHit = (t, r, s) => { // t tangential, r radial (outward = glyph up)
  const total = [...s].reduce((a, ch) => a + glyphW[ch], 0) + GAP * (s.length - 1);
  let x0 = -total / 2; const top = RN + GH / 2, bot = RN - GH / 2;
  for (const ch of s) { const w = glyphW[ch], xc = x0 + w / 2;
    if (ch === 'I' && Math.abs(t - xc) < SW / 2 && r > bot && r < top) return true;
    if (ch === 'V' && (segDist(t, r, x0, top, xc, bot) < SW / 2 || segDist(t, r, x0 + w, top, xc, bot) < SW / 2)) return true;
    if (ch === 'X' && (segDist(t, r, x0, top, x0 + w, bot) < SW / 2 || segDist(t, r, x0 + w, top, x0, bot) < SW / 2)) return true;
    x0 += w + GAP; }
  return false;
};
const HAND_TIME = { h: 10, m: 45 };
const paintDial = (x, y) => {
  const rho = Math.hypot(x, y);
  if (rho > 1) return DIAL.bezel;
  if (rho > 0.88) return rho > 0.975 || rho < 0.9 ? DIAL.bezelShade : DIAL.bezel;
  // hands (angle clockwise from 12)
  const handAt = (deg, len, wid) => { const a = deg * Math.PI / 180; return segDist(x, y, -0.12 * Math.sin(a), -0.12 * Math.cos(a), len * Math.sin(a), len * Math.cos(a)) < wid; };
  if (rho < 0.06 || handAt((HAND_TIME.h % 12 + HAND_TIME.m / 60) * 30, 0.5, 0.035) || handAt(HAND_TIME.m * 6, 0.8, 0.022)) return DIAL.hand;
  if (Math.abs(rho - 0.86) < 0.012 || Math.abs(rho - 0.58) < 0.008) return DIAL.bezel; // gilded chapter rings
  if (rho > 0.82 && rho < 0.86) { const th = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; if (Math.abs(((th + 3) % 6) - 3) < 0.6) return DIAL.numeral; } // minute track
  const th = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360, k = Math.round(th / 30) % 12, d = (th - k * 30) * Math.PI / 180;
  if (numeralHit(rho * Math.sin(d), rho * Math.cos(d), NUMERALS[k])) return DIAL.numeral;
  return DIAL.field;
};
const toSrgb8 = l => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
for (let py = 0; py < 256; py++) for (let px = 0; px < AW; px++) {
  const acc = [0, 0, 0];
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const fx = px + (sx + 0.5) / 4, fy = py + (sy + 0.5) / 4;
    const c = fx < TW ? paintStrip(fx / TW, 1 - fy / 256) : fx < 256 ? PAL.bronze : paintDial((fx - 384) / 128, (128 - fy) / 128);
    for (let k = 0; k < 3; k++) acc[k] += srgbToLin(c[k]) / 16;
  }
  for (let k = 0; k < 3; k++) authoredAtlas[(py * AW + px) * 3 + k] = toSrgb8(acc[k]);
}
// Lower half: captured limestone for the authored crown. Orthographic resamples (24 px/m) of plain
// shaft wall between the window strips on the north and east faces, which were photographed in
// shade (diffuse sky light only, so the texels carry stone tone variation rather than sun and cast
// shadows). Each band is divided by its own mean (relative variation, mean 1) and stored at
// STONE_MID; the crown's vertex colour supplies tone and game light. Course joints (0.5 m, estimated
// from the CC0 shaft close-up) and staggered head joints (1.2 m) are drawn at world heights so the
// coursing lines up across every crown face. The column band has no joints.
const STONE_RES = 24, STONE_MID = 0.55, COURSE = 0.5, HEAD = 1.2, BAND_W = 4.0, BAND_H = 10;
const BANDS = [
  { face: 'north', a0: 4.35, y0: 48, x: 4 }, { face: 'north', a0: -8.35, y0: 60, x: 112 },
  { face: 'east', a0: 4.35, y0: 52, x: 220 }, { face: 'east', a0: -8.35, y0: 66, x: 328 },
  { face: 'north', a0: 5.6, y0: 70, x: 446, w: 1.17, h: 5, joints: false }, // columns (mirrored round the shaft)
];
const STONE_TOP = 264;
const stoneFill = toSrgb8(STONE_MID);
for (let py = 256; py < AH; py++) for (let px = 0; px < AW; px++) for (let k = 0; k < 3; k++) authoredAtlas[(py * AW + px) * 3 + k] = stoneFill;
const bandStats = [];
for (const B of BANDS) {
  const [o, al] = FACES[B.face], w = B.w ?? BAND_W, h = B.h ?? BAND_H, W2 = Math.round(w * STONE_RES), H2 = Math.round(h * STONE_RES);
  const depth = new Float32Array(W2 * H2).fill(-Infinity), su = new Float32Array(W2 * H2), sv = new Float32Array(W2 * H2);
  for (let t = 0; t < indices.length; t += 3) { // front-most scan surface per pixel (orthographic, along the outward normal)
    const ids = [indices[t], indices[t + 1], indices[t + 2]];
    const q = ids.map(i => { const x = positions[3 * i], z = positions[3 * i + 2]; return [((x * al[0] + z * al[1]) - B.a0) * STONE_RES, (B.y0 + h - positions[3 * i + 1]) * STONE_RES, x * o[0] + z * o[1]]; });
    if (q.some(p => p[2] < 8.3)) continue;
    const [A, Bq, Cq] = q, den = (Bq[1] - Cq[1]) * (A[0] - Cq[0]) + (Cq[0] - Bq[0]) * (A[1] - Cq[1]); if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(A[0], Bq[0], Cq[0]))), x1 = Math.min(W2 - 1, Math.ceil(Math.max(A[0], Bq[0], Cq[0]))), y0 = Math.max(0, Math.floor(Math.min(A[1], Bq[1], Cq[1]))), y1 = Math.min(H2 - 1, Math.ceil(Math.max(A[1], Bq[1], Cq[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w0 = ((Bq[1] - Cq[1]) * (x + 0.5 - Cq[0]) + (Cq[0] - Bq[0]) * (y + 0.5 - Cq[1])) / den, w1 = ((Cq[1] - A[1]) * (x + 0.5 - Cq[0]) + (A[0] - Cq[0]) * (y + 0.5 - Cq[1])) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const d = w0 * A[2] + w1 * Bq[2] + w2 * Cq[2], o2 = y * W2 + x; if (d <= depth[o2]) continue; depth[o2] = d;
      su[o2] = w0 * uvs[2 * ids[0]] + w1 * uvs[2 * ids[1]] + w2 * uvs[2 * ids[2]]; sv[o2] = w0 * uvs[2 * ids[0] + 1] + w1 * uvs[2 * ids[1] + 1] + w2 * uvs[2 * ids[2] + 1];
    }
  }
  const lin = new Float64Array(W2 * H2 * 3), mean = [0, 0, 0]; let n = 0;
  for (let i = 0; i < W2 * H2; i++) if (depth[i] > -Infinity) { const c = atlasAt(su[i], sv[i]); for (let k = 0; k < 3; k++) { lin[3 * i + k] = srgbToLin(c[k]); mean[k] += lin[3 * i + k]; } n++; }
  for (let k = 0; k < 3; k++) mean[k] /= n;
  const joint = (dist, wd) => Math.min(1, Math.max(0, dist / wd)); // 0 on the joint line, 1 beyond wd
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = y * W2 + x, wy = B.y0 + h - (y + 0.5) / STONE_RES, wa = B.a0 + (x + 0.5) / STONE_RES;
    let f = 1;
    if (B.joints !== false) {
      const dc = Math.abs(wy / COURSE - Math.round(wy / COURSE)) * COURSE, course = Math.floor(wy / COURSE), off = (course % 2) * HEAD / 2;
      const dh = Math.abs((wa - off) / HEAD - Math.round((wa - off) / HEAD)) * HEAD;
      f = Math.min(0.84 + 0.16 * joint(dc, 0.03), 0.89 + 0.11 * joint(dh, 0.025));
    }
    for (let k = 0; k < 3; k++) {
      const ratio = depth[i] > -Infinity ? Math.min(1.3, Math.max(0.75, lin[3 * i + k] / mean[k])) : 1;
      authoredAtlas[((STONE_TOP + y) * AW + B.x + x) * 3 + k] = toSrgb8(STONE_MID * ratio * f);
    }
  }
  bandStats.push({ ...B, px: [W2, H2], coverage: +(n / (W2 * H2)).toFixed(3), meanSrgb: mean.map(toSrgb8) });
}
log('stone bands', JSON.stringify(bandStats.map(b => ({ face: b.face, a0: b.a0, y0: b.y0, px: b.px, coverage: b.coverage, meanSrgb: b.meanSrgb }))));
const regionMeanLinear = (x0, x1) => [0, 1, 2].map(k => { let s = 0; for (let py = 0; py < 256; py++) for (let px = x0; px < x1; px++) s += srgbToLin(authoredAtlas[(py * AW + px) * 3 + k]); return s / ((x1 - x0) * 256); });
const tileMeanLinear = regionMeanLinear(0, TW);
const authoredTexture = await sharp(authoredAtlas, { raw: { width: AW, height: AH, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const authoredTextureFar = await sharp(authoredAtlas, { raw: { width: AW, height: AH, channels: 3 } }).resize(128, 128).png({ compressionLevel: 9 }).toBuffer(); // fallback only: the loader reuses the near atlas
if (process.env.TOWER_PREVIEW_DIR) writeFileSync(process.env.TOWER_PREVIEW_DIR + '/authored-atlas.png', authoredTexture);

// Authored geometry buffers. Textured (atlas above): strip panels + clock dials/bezels. Untextured:
// strip reveals and the crown. Vertex colours are linear multipliers / RELIGHT_SCALE.
const SP = [], SUV = [], SCOL = [], SI = []; // textured, near LOD
const RP = [], RCOL = [], RI = []; // untextured, near LOD only (strip reveals)
const q16 = x => Math.round(Math.min(1, Math.max(0, x / RELIGHT_SCALE)) * 65535);
const wallLinAt = az => wallLight(az, GAME_SUN.azimuthDeg).map(srgbToLin);
const SIN_EL = Math.sin(GAME_SUN.elevationDeg * Math.PI / 180);
const upLin = [0, 1, 2].map(k => srgbToLin(Math.min(255, photoFit.ambient[k] + photoFit.sun[k] * SIN_EL)));
const downLin = photoFit.ambient.map(v => 0.85 * srgbToLin(v));
const sunLin = wallLinAt(GAME_SUN.azimuthDeg); // a wall facing the sun azimuth: the "sunlit" reference tone
// game light for a world normal (same model as the relight): walls by azimuth, tops/undersides by ny
const lightOf = n => {
  const h = Math.hypot(n[0], n[2]);
  if (h < 1e-6) return n[1] > 0 ? upLin : downLin;
  const wall = wallLinAt(compassAz(n[0], n[2])), t = Math.abs(n[1]);
  return [0, 1, 2].map(k => wall[k] * (1 - t) + (n[1] > 0 ? upLin[k] : downLin[k]) * t);
};
const FACE_AZ = { north: 0, east: 90, south: 180, west: 270 };
// glTF front faces are counter-clockwise seen from outside and the game culls back faces: every
// authored triangle is ordered against its intended outward normal n (world) instead of by hand.
const facing = (a, b, c, n) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; return (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2]; };
const oriented = (ids, pts, n) => (facing(pts[0], pts[1], pts[2], n) >= 0 ? ids : [ids[0], ids[2], ids[1]]);
const quad = (corners, col, n) => { const b = RP.length / 3; for (const c of corners) { RP.push(...c); RCOL.push(...col.map(q16)); } RI.push(...oriented([b, b + 1, b + 2], corners.slice(0, 3), n), ...oriented([b, b + 2, b + 3], [corners[0], corners[2], corners[3]], n)); };
// strip panels: one quad per floor (the atlas cannot repeat), tile fraction -> atlas UV
const tileY = y => (y - floorBase(0)) / floors.pitch - Math.floor((y - floorBase(0)) / floors.pitch + 1e-9);
for (const s of strips) {
  const P3 = (along, y, d) => [s.outward[0] * d + s.along[0] * along, y, s.outward[1] * d + s.along[1] * along];
  const xl = s.centre - STRIP_W / 2, xr = s.centre + STRIP_W / 2;
  const back = y => s.wallAt(y) - RECESS, front = y => s.wallAt(y) + Math.max(0.03, s.wallP95); // reveals reach past the scanned wall bumps
  // luminance-only calibration: the authored hue stays, the brightness follows the relit capture
  const tint = Math.min(RELIGHT_SCALE, lumLin(s.capturedMeanLinear) / lumLin(tileMeanLinear));
  const cuts = [stripY0]; for (let k2 = lo.k + 1; k2 <= hi.k; k2++) cuts.push(floorBase(k2)); cuts.push(stripY1);
  for (let c = 0; c + 1 < cuts.length; c++) {
    const ya = cuts[c], yb = cuts[c + 1]; if (yb - ya < 1e-3) continue;
    const ta = tileY(ya + 1e-6), tb = ta + (yb - ya) / floors.pitch, base = SP.length / 3;
    for (const [yy, tt] of [[ya, ta], [yb, tb]]) for (const x of [xl, xr]) { SP.push(...P3(x, yy, back(yy))); SUV.push((x === xl ? 0.5 : TW - 0.5) / AW, (1 - Math.min(1, tt)) * 256 / AH); SCOL.push(q16(tint), q16(tint), q16(tint)); }
    const pp = i => SP.slice(3 * (base + i), 3 * (base + i) + 3), on = [s.outward[0], 0, s.outward[1]];
    SI.push(...oriented([base, base + 1, base + 3], [pp(0), pp(1), pp(3)], on), ...oriented([base, base + 3, base + 2], [pp(0), pp(3), pp(2)], on));
  }
  // stone albedo ~ beside-strip relit stone / modelled face light; re-shade per reveal orientation
  const faceLin = wallLinAt(FACE_AZ[s.face]);
  const shade = (az, up = 0) => { const l = up > 0 ? upLin : up < 0 ? downLin : wallLinAt(az); return [0, 1, 2].map(k => s.stoneMeanLinear[k] * l[k] / faceLin[k]); };
  // left reveal faces +along (toward the strip centre), right reveal faces -along; sill faces up, head faces down
  const azAlong = (FACE_AZ[s.face] + 90) % 360, alN = [s.along[0], 0, s.along[1]];
  quad([P3(xl, stripY0, back(stripY0)), P3(xl, stripY1, back(stripY1)), P3(xl, stripY1, front(stripY1)), P3(xl, stripY0, front(stripY0))], shade(azAlong), alN);
  quad([P3(xr, stripY0, back(stripY0)), P3(xr, stripY0, front(stripY0)), P3(xr, stripY1, front(stripY1)), P3(xr, stripY1, back(stripY1))], shade((azAlong + 180) % 360), alN.map(v => -v));
  quad([P3(xl, stripY0, back(stripY0)), P3(xl, stripY0, front(stripY0)), P3(xr, stripY0, front(stripY0)), P3(xr, stripY0, back(stripY0))], shade(0, 1), [0, 1, 0]);
  quad([P3(xl, stripY1, back(stripY1)), P3(xr, stripY1, back(stripY1)), P3(xr, stripY1, front(stripY1)), P3(xl, stripY1, front(stripY1))], shade(0, -1), [0, -1, 0]);
}

// ---- 6d. crown: authored belfry stage and clock dials (both LODs) ----
// The scanned belfry (columns, piers, cornice) and the clock rings are photogrammetric melt: the
// columns are fused blobs, the silhouette wobbles and the open lantern top had to be lidded. Above
// the clock-block roof the scan is replaced by a fitted, four-fold symmetric belfry; the clock stage
// below (block, aedicules, corner ornaments, deck) stays scanned, with only the dials replaced.
// Heights/half-widths: the scan half-extent profile (tools: crown profile in .work/claude-tower)
// cross-checked against photo proportions (Daderot 2015 CC0 DSC08585; 2025 CC BY 4.0 Commons
// 54984938073): per face four plain columns on square pedestals between square corner piers,
// entablature, projecting cornice, attic, flat roof. Not survey-exact; documented as authored.
const crownPts = []; for (let j = 0; j < positions.length / 3; j++) { const y = positions[3 * j + 1]; if (y > 99.5 && y < 104.5) { const x = positions[3 * j], z = positions[3 * j + 2]; crownPts.push([x * eu[0] + z * eu[1], x * ev[0] + z * ev[1]]); } }
const qq = (a, f) => { const s2 = Float64Array.from(a).sort(); return s2[Math.floor(f * (s2.length - 1))]; };
const CC = [(qq(crownPts.map(p => p[0]), 0.97) - qq(crownPts.map(p => -p[0]), 0.97)) / 2, (qq(crownPts.map(p => p[1]), 0.97) - qq(crownPts.map(p => -p[1]), 0.97)) / 2];
const CROWN = {
  centreUV: CC, cutY: 94.9, cutHalf: 5.35, // scan removed above the clock-block roof (tier upperTop p50 94.55) inside this square
  plinth: [94.3, 94.95, 4.8], podium: [94.3, 97.0, 4.72], podiumCap: [96.78, 97.0, 4.77], ledge: [97.0, 97.55, 4.88], pedestal: [97.55, 99.1, 0.5], pedestalCap: [98.85, 99.1, 0.58],
  columnLine: 3.93, columnAlong: [-2.19, -0.73, 0.73, 2.19], columnR: 0.37, columnBase: [99.1, 99.35, 0.47], shaft: [99.35, 104.2], capital: [104.2, 104.55, 0.48], necking: [104.05, 104.2, 0.42],
  pier: [97.55, 104.55, 2.95, 4.3], chamberHalf: 2.55, architrave: [104.55, 105.0, 4.42], frieze: [105.0, 105.65, 4.37], bedMould: [105.65, 105.8, 4.52], cornice: [[105.8, 106.35, 4.65], [106.35, 107.1, 4.95]],
  // Attic: photographs (2015 CC0, 2025 CC BY GPS-tagged) show a low attic (~1-1.5 m) above the cornice with the
  // guard rail on top; the scan's open rim at lid.y (110.02) matches the rail top (melted rail/antennas), so the
  // roof is set one rail height below it rather than at the rim.
  attic: [107.1, 108.6, 3.88], coping: [108.6, 108.85, 4.0],
};
// stone tone: the beside-strip shaft stone, de-lit per face and averaged, as a sunlit-facing albedo
const stoneSunlit = [0, 1, 2].map(k => strips.reduce((a, s) => a + s.stoneMeanLinear[k] / wallLinAt(FACE_AZ[s.face])[k], 0) / strips.length * sunLin[k]);
const CHAMBER = [0.05, 0.035, 0.03]; // dark bell chamber (sunlit-facing linear tone; photographs show it in deep shade)
// Crown stone is textured from the captured-stone bands (atlas lower half): vertex colour = tone x
// game light / STONE_MID, so the band's relative variation and joints ride on the measured tone.
const crownGeo = { P: [], UV: [], C: [], I: [] };
const metalGeo = { P: [], C: [], I: [] }; // untextured: roof guard rail, lattice mast, whip antennas (near LOD)
const toXZ = (u2, v2) => [u2 * eu[0] + v2 * ev[0], u2 * eu[1] + v2 * ev[1]];
const nWorld = (nu, ny, nv3) => { const [x, z] = toXZ(nu, nv3); return [x, ny, z]; };
const tone = (albedo, n) => { const l = lightOf(n); return [0, 1, 2].map(k => albedo[k] * l[k] / sunLin[k]); };
const PC = (u2, y, v2) => { const [x, z] = toXZ(CC[0] + u2, CC[1] + v2); return [x, y, z]; };
const bandUV = (bi, s, t) => { const B = BANDS[bi], h = B.h ?? BAND_H; return [(B.x + s * STONE_RES) / AW, (STONE_TOP + (h - t) * STONE_RES) / AH]; };
const addQuadT = (pts, uvq, cols, n) => { // textured quad, oriented against n
  const b = crownGeo.P.length / 3;
  pts.forEach((p, i) => { crownGeo.P.push(...p); crownGeo.UV.push(...uvq[i]); crownGeo.C.push(...cols[i].map(x => q16(x / STONE_MID))); });
  crownGeo.I.push(...oriented([b, b + 1, b + 2], [pts[0], pts[1], pts[2]], n), ...oriented([b, b + 2, b + 3], [pts[0], pts[2], pts[3]], n));
};
let bandPick = 0;
// One planar rectangle in shaft axes: origin o (u,y,v), unit axes A (horizontal on walls) and B (up
// on walls), lengths la, lb. Walls keep world-height coursing (t = y shifted by whole courses);
// cells wider than the band are split and mirrored so the texture stays continuous.
const rect = (o, A, la, B, lb, nLocal, albedo, wall) => {
  const bi = bandPick++ % 4, na = Math.max(1, Math.ceil(la / (BAND_W - 0.2))), nb = wall ? 1 : Math.max(1, Math.ceil(lb / (BAND_H - 0.5)));
  const n = nWorld(...nLocal), col = tone(albedo, n);
  const tBase = wall ? (o[1] - BANDS[bi].y0) - COURSE * Math.floor((o[1] - BANDS[bi].y0) / COURSE) : 0.2;
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const a0 = la * i / na, a1 = la * (i + 1) / na, b0 = lb * j / nb, b1 = lb * (j + 1) / nb;
    const sOf = a => 0.1 + (i % 2 ? (a1 - a) : (a - a0)), tOf = b => tBase + (wall ? b : (j % 2 ? (b1 - b) : (b - b0)));
    const corner = (a, b) => PC(o[0] + A[0] * a + B[0] * b, o[1] + A[1] * a + B[1] * b, o[2] + A[2] * a + B[2] * b);
    const cs = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
    addQuadT(cs.map(([a, b]) => corner(a, b)), cs.map(([a, b]) => bandUV(bi, sOf(a), tOf(b))), [col, col, col, col], n);
  }
};
// axis-aligned (shaft axes) box; skip: faces to omit where hidden
const box = (u0, u1, v0, v1, y0, y1, albedo, skip = new Set(['bottom'])) => {
  const H = y1 - y0;
  if (!skip.has('+u')) rect([u1, y0, v1], [0, 0, -1], v1 - v0, [0, 1, 0], H, [1, 0, 0], albedo, true);
  if (!skip.has('-u')) rect([u0, y0, v0], [0, 0, 1], v1 - v0, [0, 1, 0], H, [-1, 0, 0], albedo, true);
  if (!skip.has('+v')) rect([u0, y0, v1], [1, 0, 0], u1 - u0, [0, 1, 0], H, [0, 0, 1], albedo, true);
  if (!skip.has('-v')) rect([u1, y0, v0], [-1, 0, 0], u1 - u0, [0, 1, 0], H, [0, 0, -1], albedo, true);
  if (!skip.has('top')) rect([u0, y1, v0], [1, 0, 0], u1 - u0, [0, 0, 1], v1 - v0, [0, 1, 0], albedo, false);
  if (!skip.has('bottom')) rect([u0, y0, v0], [1, 0, 0], u1 - u0, [0, 0, 1], v1 - v0, [0, -1, 0], albedo, false);
};
const sq = (h, y0, y1, albedo, skip) => box(-h, h, -h, h, y0, y1, albedo, skip);
const cylinder = (cu, cv, r, y0, y1, albedo, seg = 12) => { // column band, mirrored round the shaft
  const CB = BANDS.length - 1, halfC = BANDS[CB].w;
  for (let i = 0; i < seg; i++) {
    const a0 = 2 * Math.PI * i / seg, a1 = 2 * Math.PI * (i + 1) / seg, s = a => halfC * (a <= Math.PI ? a / Math.PI : 2 - a / Math.PI) * 0.98 + 0.01;
    const n0 = nWorld(Math.cos(a0), 0, Math.sin(a0)), n1 = nWorld(Math.cos(a1), 0, Math.sin(a1)), c0 = tone(albedo, n0), c1 = tone(albedo, n1);
    const pt = (a, y) => PC(cu + r * Math.cos(a), y, cv + r * Math.sin(a)), t0 = 0.1, t1 = 0.1 + (y1 - y0);
    addQuadT([pt(a0, y0), pt(a1, y0), pt(a1, y1), pt(a0, y1)], [bandUV(CB, s(a0), t0), bandUV(CB, s(a1), t0), bandUV(CB, s(a1), t1), bandUV(CB, s(a0), t1)], [c0, c1, c1, c0], nWorld(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)));
  }
};
// thin metal member between two world points (square section w), four sides
const METAL = [0.2, 0.2, 0.19]; // galvanised steel, sunlit-facing linear tone
const beam = (p, q, w) => {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(...d), f = d.map(x => x / L);
  const ref = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const s1 = [f[1] * ref[2] - f[2] * ref[1], f[2] * ref[0] - f[0] * ref[2], f[0] * ref[1] - f[1] * ref[0]], l1 = Math.hypot(...s1); s1.forEach((x, i) => s1[i] = x / l1);
  const s2 = [f[1] * s1[2] - f[2] * s1[1], f[2] * s1[0] - f[0] * s1[2], f[0] * s1[1] - f[1] * s1[0]];
  const off = (c, a, b) => c.map((x, i) => x + (a * s1[i] + b * s2[i]) * w / 2);
  for (const [a, b, nn] of [[1, 0, s1], [0, 1, s2], [-1, 0, s1.map(x => -x)], [0, -1, s2.map(x => -x)]]) {
    const side = [a === 0 ? -1 : a, b === 0 ? -1 : b], side2 = [a === 0 ? 1 : a, b === 0 ? 1 : b];
    const pts = [off(p, ...side), off(q, ...side), off(q, ...side2), off(p, ...side2)], col = tone(METAL, nn), base = metalGeo.P.length / 3;
    pts.forEach(pt => { metalGeo.P.push(...pt); metalGeo.C.push(...col.map(q16)); });
    metalGeo.I.push(...oriented([base, base + 1, base + 2], pts.slice(0, 3), nn), ...oriented([base, base + 2, base + 3], [pts[0], pts[2], pts[3]], nn));
  }
};
const S3 = stoneSunlit, C4 = CROWN;
sq(C4.plinth[2], C4.plinth[0], C4.plinth[1], S3);
sq(C4.podium[2], C4.plinth[1], C4.podiumCap[0], S3);
sq(C4.podiumCap[2], C4.podiumCap[0], C4.podiumCap[1], S3);
sq(C4.ledge[2], C4.ledge[0], C4.ledge[1], S3, new Set([]));
box(-C4.chamberHalf, C4.chamberHalf, -C4.chamberHalf, C4.chamberHalf, C4.pier[0], C4.pier[1], CHAMBER, new Set(['bottom', 'top']));
for (const su of [-1, 1]) for (const sv of [-1, 1]) { // corner piers
  const [a0, a1] = [C4.pier[2], C4.pier[3]];
  box(su > 0 ? a0 : -a1, su > 0 ? a1 : -a0, sv > 0 ? a0 : -a1, sv > 0 ? a1 : -a0, C4.pier[0], C4.pier[1], S3, new Set(['bottom', 'top']));
}
const columnSites = [];
for (const [ou, ov, tu, tv] of [[0, 1, 1, 0], [0, -1, 1, 0], [1, 0, 0, 1], [-1, 0, 0, 1]]) for (const al of C4.columnAlong) columnSites.push([ou * C4.columnLine + tu * al, ov * C4.columnLine + tv * al]);
for (const [cu, cv] of columnSites) {
  const bx = (h, y0, y1, sk = new Set(['bottom'])) => box(cu - h, cu + h, cv - h, cv + h, y0, y1, S3, sk);
  bx(C4.pedestal[2], C4.pedestal[0], C4.pedestalCap[0]); bx(C4.pedestalCap[2], C4.pedestalCap[0], C4.pedestalCap[1], new Set([]));
  bx(C4.columnBase[2], C4.columnBase[0], C4.columnBase[1]);
  cylinder(cu, cv, C4.columnR, C4.shaft[0], C4.shaft[1], S3);
  cylinder(cu, cv, C4.necking[2], C4.necking[0], C4.necking[1], S3, 12);
  bx(C4.capital[2], C4.capital[0], C4.capital[1], new Set(['top']));
}
for (const [y0, y1, h] of [C4.architrave, C4.frieze, C4.bedMould, ...C4.cornice]) sq(h, y0, y1, S3, new Set([]));
sq(C4.attic[2], C4.attic[0], C4.attic[1], S3);
sq(C4.coping[2], C4.coping[0], C4.coping[1], S3, new Set([]));
// Roof guard rail (photos 2015 + 2025: thin metal rail round the roof edge) and the lattice mast with
// whip antennas. Mast position triangulated from two GPS-tagged Commons photographs (camera bearings
// 321 and 124 deg from the Tower; see .work/claude-tower/result.md): ~2.5 m east, ~1.9 m north of the
// crown centre, +-0.7 m. Heights estimated from the same photographs. No colliders (thin).
const ROOF = C4.coping[1], RAIL = { half: C4.coping[2] - 0.18, height: 1.07, post: 0.06, rail: 0.05, spacing: 1.6 };
const MAST = { east: 2.5, north: 1.9, top: ROOF + 4.6, legR: 0.22, leg: 0.045, braceStep: 0.75, whips: [[0.35, ROOF + 6.2], [-0.3, ROOF + 5.5]] };
{
  const R = RAIL.half, corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
  for (let s2 = 0; s2 < 4; s2++) {
    const [a, b] = [corners[s2], corners[(s2 + 1) % 4]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nPost = Math.ceil(L / RAIL.spacing);
    for (let i = 0; i < nPost; i++) { const t = i / nPost, u2 = a[0] + (b[0] - a[0]) * t, v2 = a[1] + (b[1] - a[1]) * t; beam(PC(u2, ROOF, v2), PC(u2, ROOF + RAIL.height, v2), RAIL.post); }
    for (const hh of [RAIL.height - RAIL.rail / 2, RAIL.height * 0.5]) beam(PC(a[0], ROOF + hh, a[1]), PC(b[0], ROOF + hh, b[1]), RAIL.rail);
  }
  // mast: compass east/north -> local x/z (x east, z south) -> shaft axes relative to the crown centre
  const mx = MAST.east, mz = -MAST.north, mu = mx * eu[0] + mz * eu[1] - CC[0], mv = mx * ev[0] + mz * ev[1] - CC[1];
  const legs = [0, 1, 2].map(i => [mu + MAST.legR * Math.cos(2 * Math.PI * i / 3), mv + MAST.legR * Math.sin(2 * Math.PI * i / 3)]);
  for (const [lu, lv] of legs) beam(PC(lu, ROOF, lv), PC(lu, MAST.top, lv), MAST.leg);
  for (let y = ROOF + 0.4, k2 = 0; y + MAST.braceStep <= MAST.top; y += MAST.braceStep, k2++) for (let i = 0; i < 3; i++) {
    const [a, b] = [legs[i], legs[(i + 1) % 3]]; beam(PC(a[0], y, a[1]), PC(b[0], y + MAST.braceStep, b[1]), 0.025);
  }
  for (const [off, top] of MAST.whips) beam(PC(mu + off, MAST.top - 0.5, mv - off), PC(mu + off, top, mv - off), 0.035);
}

// Clock dials: measured from 40 px/m orthographic crops of the scan (renders/clock-orthos.png in
// .work/claude-tower): on all four faces the gold ring is centred on the face (along ~0, i.e. the
// measured crown centre), centre Y 91.15, outer radius 2.05 m. Plane: per face, the median scan depth
// of the clock stage around the ring. The scan inside the dial is cut and replaced by an authored
// disc 0.06 m proud of that plane with a gilded bezel band reaching back into the wall.
const CLOCK = { y: 91.15, r: 2.05, cutR: 1.98, proud: 0.06, bandBack: 0.3, segments: 40 };
const clockFaces = [];
for (const [f, [o, al]] of Object.entries(FACES)) {
  const centreAlong = CC[0] * al[0] * eu[0] + CC[0] * al[1] * eu[1] + CC[1] * al[0] * ev[0] + CC[1] * al[1] * ev[1]; // crown centre projected on the face axis
  const ring = [];
  surfaceSamples((p) => { const d = p[0] * o[0] + p[2] * o[1], a = p[0] * al[0] + p[2] * al[1], rr = Math.hypot(a - centreAlong, p[1] - CLOCK.y); if (d > 6.8 && d < 8.8 && rr > CLOCK.r + 0.1 && rr < CLOCK.r + 0.7) ring.push(d); }, 86, 96);
  clockFaces.push({ face: f, outward: o, along: al, centreAlong, plane: median(ring), samples: ring.length });
}
const CG = { P: [], UV: [], C: [], I: [] }; // textured clock geometry (appended to the textured authored primitive in both LODs)
for (const c of clockFaces) {
  const tint = lumLin(wallLinAt(FACE_AZ[c.face])) / lumLin(sunLin), bandTint = tint * 0.8, front = c.plane + CLOCK.proud, back = c.plane - CLOCK.bandBack;
  const P3 = (a, y, d) => [c.outward[0] * d + c.along[0] * a, y, c.outward[1] * d + c.along[1] * a];
  const add = (p, uv, t) => { CG.P.push(...p); CG.UV.push(...uv); CG.C.push(q16(t), q16(t), q16(t)); return CG.P.length / 3 - 1; };
  const dialUV = (x, y) => [(384 + 127 * x) / AW, (128 - 127 * y) / AH]; // upper half
  const centre = add(P3(c.centreAlong, CLOCK.y, front), dialUV(0, 0), tint);
  const rim = [];
  for (let i = 0; i <= CLOCK.segments; i++) { const a = 2 * Math.PI * i / CLOCK.segments, x = Math.cos(a), y = Math.sin(a); rim.push(add(P3(c.centreAlong + CLOCK.r * x, CLOCK.y + CLOCK.r * y, front), dialUV(x, y), tint)); }
  const cp = i => CG.P.slice(3 * i, 3 * i + 3), on = [c.outward[0], 0, c.outward[1]];
  for (let i = 0; i < CLOCK.segments; i++) CG.I.push(...oriented([centre, rim[i], rim[i + 1]], [cp(centre), cp(rim[i]), cp(rim[i + 1])], on));
  for (let i = 0; i < CLOCK.segments; i++) { // bezel band: outward-facing cylinder from the dial back into the wall
    const a0 = 2 * Math.PI * i / CLOCK.segments, a1 = 2 * Math.PI * (i + 1) / CLOCK.segments, g = dialUV(0.94, 0);
    const p = [[a0, front], [a1, front], [a1, back], [a0, back]].map(([a, d]) => add(P3(c.centreAlong + CLOCK.r * Math.cos(a), CLOCK.y + CLOCK.r * Math.sin(a), d), g, bandTint));
    const am = (a0 + a1) / 2, rn = [c.along[0] * Math.cos(am), Math.sin(am), c.along[1] * Math.cos(am)]; // radial outward
    CG.I.push(...oriented([p[0], p[3], p[2]], [cp(p[0]), cp(p[3]), cp(p[2])], rn), ...oriented([p[0], p[2], p[1]], [cp(p[0]), cp(p[2]), cp(p[1])], rn));
  }
}
log('crown', JSON.stringify({ centreUV: CC.map(v => +v.toFixed(3)), crownTriangles: crownGeo.I.length / 3, clockTriangles: CG.I.length / 3, clocks: clockFaces.map(c => ({ f: c.face, along: +c.centreAlong.toFixed(2), plane: +c.plane.toFixed(3), n: c.samples })), stoneSunlitSrgb: stoneSunlit.map(toSrgb8) }));

// ---- 6e. cuts: strips (near), crown + clock dials (both LODs) ----
// Each region clips scan triangles by its planes and drops the piece inside (pieces outside are kept).
const regions = [];
for (const s of strips) regions.push({ lods: ['near'], near: p => { const d = p[0] * s.outward[0] + p[2] * s.outward[1], a = p[0] * s.along[0] + p[2] * s.along[1]; return d > 8.3 && p[1] > stripY0 - 0.5 && p[1] < stripY1 + 0.5 && a > s.centre - STRIP_W / 2 - 0.5 && a < s.centre + STRIP_W / 2 + 0.5; },
  planes: [v => (v[0] * s.along[0] + v[2] * s.along[1]) - (s.centre - STRIP_W / 2), v => (s.centre + STRIP_W / 2) - (v[0] * s.along[0] + v[2] * s.along[1]), v => v[1] - stripY0, v => stripY1 - v[1]],
  drop: v => v[0] * s.outward[0] + v[2] * s.outward[1] > 8.3, what: 'strip' });
const uvOf = v => [v[0] * eu[0] + v[2] * eu[1] - CC[0], v[0] * ev[0] + v[2] * ev[1] - CC[1]];
regions.push({ lods: ['near', 'far'], near: p => { const [a, b] = uvOf(p); return p[1] > CROWN.cutY - 0.5 && Math.abs(a) < CROWN.cutHalf + 0.5 && Math.abs(b) < CROWN.cutHalf + 0.5; },
  planes: [v => v[1] - CROWN.cutY, v => CROWN.cutHalf - uvOf(v)[0], v => CROWN.cutHalf + uvOf(v)[0], v => CROWN.cutHalf - uvOf(v)[1], v => CROWN.cutHalf + uvOf(v)[1]], drop: () => true, what: 'crown' });
for (const c of clockFaces) {
  const N = 32, planes = [];
  for (let i = 0; i < N; i++) { const a = 2 * Math.PI * (i + 0.5) / N, nx = Math.cos(a), ny = Math.sin(a); planes.push(v => CLOCK.cutR * Math.cos(Math.PI / N) - ((v[0] * c.along[0] + v[2] * c.along[1] - c.centreAlong) * nx + (v[1] - CLOCK.y) * ny)); }
  regions.push({ lods: ['near', 'far'], near: p => { const d = p[0] * c.outward[0] + p[2] * c.outward[1], a = p[0] * c.along[0] + p[2] * c.along[1]; return d > 6.8 && Math.hypot(a - c.centreAlong, p[1] - CLOCK.y) < CLOCK.r + 0.5; },
    planes, drop: v => v[0] * c.outward[0] + v[2] * c.outward[1] > 6.8, what: 'clock' });
}
const clipScan = (srcIdx, lodName) => {
  const outP = Array.from(positions), outU = Array.from(uvs), outC = Array.from(relight), outI = [];
  const removed = {};
  // original corners keep their index (v.src); cut points are shared between neighbouring pieces by value
  const vert = i => Object.assign([outP[3 * i], outP[3 * i + 1], outP[3 * i + 2], outU[2 * i], outU[2 * i + 1], outC[3 * i], outC[3 * i + 1], outC[3 * i + 2]], { src: i });
  const cutIds = new Map();
  const emit = poly => { const ids = poly.map(v => { if (v.src !== undefined) return v.src; const key = v.map(x => Math.round(x * 1e5)).join(','); let j = cutIds.get(key); if (j === undefined) { j = outP.length / 3; cutIds.set(key, j); outP.push(v[0], v[1], v[2]); outU.push(v[3], v[4]); outC.push(v[5], v[6], v[7]); } return j; }); for (let k2 = 1; k2 + 1 < ids.length; k2++) outI.push(ids[0], ids[k2], ids[k2 + 1]); };
  const split = (poly, fn) => { // fn(v) >= 0 = inside; returns [inside, outside]
    const ins = [], outs = [];
    for (let k2 = 0; k2 < poly.length; k2++) {
      const A = poly[k2], B = poly[(k2 + 1) % poly.length], fa = fn(A), fb = fn(B);
      if (fa >= 0) ins.push(A); else outs.push(A);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb), Pm = A.map((x, m) => x + (B[m] - x) * t); ins.push(Pm); outs.push(Pm); }
    }
    return [ins.length >= 3 ? ins : null, outs.length >= 3 ? outs : null];
  };
  const area = poly => { let s2 = 0; for (let k2 = 1; k2 + 1 < poly.length; k2++) { const [a, b, c] = [poly[0], poly[k2], poly[k2 + 1]]; const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; s2 += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); } return s2; };
  const active = regions.filter(r => r.lods.includes(lodName));
  for (let t = 0; t < srcIdx.length; t += 3) {
    const tri = [srcIdx[t], srcIdx[t + 1], srcIdx[t + 2]];
    const hits = active.filter(r => tri.some(i => r.near([positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]])));
    if (!hits.length) { outI.push(...tri); continue; }
    let pieces = [tri.map(vert)], touched = false;
    for (const r of hits) { // regions are disjoint: clip what is left by each in turn
      const next = [];
      for (const poly of pieces) {
        let inner = poly; const kept = [];
        for (const fn of r.planes) { if (!inner) break; const [ins, outs] = split(inner, fn); if (outs) kept.push(outs); inner = ins; }
        if (inner && inner.every(r.drop)) { removed[r.what] = (removed[r.what] ?? 0) + area(inner); touched = true; next.push(...kept); }
        else { if (inner) kept.push(inner); if (kept.length > 1 || (kept[0] && kept[0].length !== 3)) touched = true; next.push(...(kept.length ? kept : [])); }
      }
      pieces = next;
    }
    if (!touched) { outI.push(...tri); continue; }
    for (const poly of pieces) emit(poly);
  }
  return { positions: new Float32Array(outP), uvs: new Float32Array(outU), relight: new Float32Array(outC), indices: Uint32Array.from(outI), removedM2: Object.fromEntries(Object.entries(removed).map(([k2, v]) => [k2, +v.toFixed(2)])) };
};
const nearCut = clipScan(indices, 'near');
log('near cut', JSON.stringify({ triangles: nearCut.indices.length / 3, vertices: nearCut.positions.length / 3, removedM2: nearCut.removedM2, stripExpectedM2: +(strips.length * STRIP_W * (stripY1 - stripY0)).toFixed(2) }));
const windowStrips = { width: STRIP_W, floorPitch: floors.pitch, spandrelPhaseY: floors.phase, fitScore: floors.score, measuredExtent: run, y0: stripY0, y1: stripY1, spandrels: hi.k - lo.k, recess: RECESS, atlas: [AW, AH], tileMeanLinear,
  strips: strips.map(s => ({ face: s.face, centre: s.centre, wallDepth: [s.wall0, s.wall1], wallBumpP95: s.wallP95, capturedMeanLinear: s.capturedMeanLinear, stoneMeanLinear: s.stoneMeanLinear })), nearCutRemovedM2: nearCut.removedM2.strip };

// ---- 6f. collider heightfield from the visible tops (scan with crown cut + authored crown) ----
// Same 0.25 m grid and rule as section 4, re-sampled because the crown above Y 94.9 is now authored.
{
  capTris.length = 0;
  for (let t = 0; t < nearCut.indices.length; t += 3) pushTri(nearCut.positions, nearCut.indices[t], nearCut.indices[t + 1], nearCut.indices[t + 2]);
  for (let t = 0; t < crownGeo.I.length; t += 3) pushTri(crownGeo.P, crownGeo.I[t], crownGeo.I[t + 1], crownGeo.I[t + 2]); // stone only: rail and mast are not landable
  hfHeights.length = 0; hfMissing = 0;
  for (let col = 0; col <= HF.n; col++) for (let row = 0; row <= HF.n; row++) {
    const a = -HF.half + col * HF.step, b = -HF.half + row * HF.step;
    const x = a * eu[0] + b * ev[0], z = a * eu[1] + b * ev[1];
    let h = topAt(x, z); if (!Number.isFinite(h) || h < tiers.deck.p10 - 0.5) { h = tiers.deck.p10; hfMissing++; }
    hfHeights.push(+h.toFixed(3));
  }
  heightfield.missingFilledWithDeck = hfMissing;
  log('heightfield (crown)', 'min', Math.min(...hfHeights).toFixed(2), 'max', Math.max(...hfHeights).toFixed(2), 'filled', hfMissing);
}
await MeshoptSimplifier.ready;
const simplify = (target, error) => {
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, uvs, 2, [0.5, 0.5], null, target * 3, error, ['ErrorAbsolute']);
  return { indices: out, error: err };
};
const lods = [];
const near = indices.length / 3 > 300000 ? simplify(300000, 0.02) : { indices, error: 0 };
const far = simplify(14000, 0.5);
if (near.indices !== indices) throw new Error('near LOD simplification would drop the strip cut; rebuild the cut from the simplified near mesh');
// near: the full-resolution crop with strip, crown and dial cuts; far: simplified from the uncut crop, then crown and dial cuts
const farCut = clipScan(far.indices, 'far');
log('far cut', JSON.stringify({ triangles: farCut.indices.length / 3, removedM2: farCut.removedM2 }));
lods.push({ name: 'near', indices: nearCut.indices, src: nearCut, error: 0, texture: ATLAS }, { name: 'far', indices: farCut.indices, src: farCut, error: far.error, texture: 1024 });
// ---- 7. write GLBs ----
const atlasImg = sharp(atlas, { raw: { width: ATLAS, height: atlasH, channels: 3 } });
const jpegNear = await atlasImg.clone().jpeg({ quality: 86, mozjpeg: true }).toBuffer();
const jpegFar = await atlasImg.clone().resize(1024, Math.round(1024 * atlasH / ATLAS)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
const files = [];
for (const lod of lods) {
  const src = lod.src ?? { positions, uvs, relight };
  // dense vertex range for this LOD's indices
  const remap = new Int32Array(src.positions.length / 3).fill(-1); // old -> new
  const used = []; for (const i of lod.indices) if (remap[i] < 0) { remap[i] = used.length; used.push(i); }
  const p2 = new Float32Array(used.length * 3), u2 = new Float32Array(used.length * 2), c2 = new Uint16Array(used.length * 3);
  used.forEach((o, n) => { p2.set(src.positions.subarray(3 * o, 3 * o + 3), 3 * n); u2.set(src.uvs.subarray(2 * o, 2 * o + 2), 2 * n); for (let k2 = 0; k2 < 3; k2++) c2[3 * n + k2] = q16(src.relight[3 * o + k2]); });
  const i2 = Uint32Array.from(lod.indices, i => remap[i]);
  const doc = new Document(); const buffer = doc.createBuffer();
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  const texture = doc.createTexture('tower atlas').setMimeType('image/jpeg').setImage(lod.name === 'near' ? jpegNear : jpegFar);
  // COLOR_0 = relight multiplier / RELIGHT_SCALE (section 6b); the loader multiplies the material colour by vertexColorScale.
  // Far textures are the near ones downsampled (same UV layout): textureKey/textureOfNear let the loader
  // reuse the near texture for the far LOD, so each atlas reaches the GPU once.
  const material = doc.createMaterial('UT Tower photogrammetry (baked colour)').setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setExtension('KHR_materials_unlit', unlit.createUnlit())
    .setExtras({ vertexColorScale: RELIGHT_SCALE, relight: 'photographed wall sun -> game sun, per vertex (tools/scans/build-tower.mjs 6b)', ...(lod.name === 'far' ? { textureOfNear: 'scan-atlas' } : { textureKey: 'scan-atlas' }) });
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p2).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(u2).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(c2).setNormalized(true).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(p2.length / 3 > 65535 ? i2 : Uint16Array.from(i2)).setBuffer(buffer));
  const mesh = doc.createMesh(`UT Tower scan ${lod.name}`).addPrimitive(prim);
  // Untextured authored material, near LOD only: strip reveals + roof rail, mast and antennas.
  const IP = [], IC = [], II = [];
  if (lod.name === 'near') for (const g of [{ P: RP, C: RCOL, I: RI }, metalGeo]) { const b = IP.length / 3; IP.push(...g.P); IC.push(...g.C); II.push(...g.I.map(i => i + b)); }
  if (II.length) {
    const infillMat = doc.createMaterial('UT Tower window-strip reveals + roof rail and mast (authored)').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1)
      .setExtension('KHR_materials_unlit', unlit.createUnlit()).setExtras({ authoredInfill: true, vertexColorScale: RELIGHT_SCALE });
    mesh.addPrimitive(doc.createPrimitive().setMaterial(infillMat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(IP)).setBuffer(buffer))
      .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(Uint16Array.from(IC)).setNormalized(true).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from(II)).setBuffer(buffer)));
  }
  // Textured authored material, both LODs (atlas: strip tile, clock dial, captured-stone bands): crown stone + clock dials and bezels, plus strip panels (near).
  const TP = [], TUV = [], TC = [], TI = [];
  for (const g of [crownGeo, CG, ...(lod.name === 'near' ? [{ P: SP, UV: SUV, C: SCOL, I: SI }] : [])]) { const b = TP.length / 3; TP.push(...g.P); TUV.push(...g.UV); TC.push(...g.C); TI.push(...g.I.map(i => i + b)); }
  const detailTex = doc.createTexture('tower authored detail atlas (strip tile, clock dial, captured stone bands)').setMimeType('image/png').setImage(lod.name === 'near' ? authoredTexture : authoredTextureFar);
  const detailMat = doc.createMaterial(lod.name === 'near' ? 'UT Tower belfry, clock dials + window strips (authored detail)' : 'UT Tower belfry + clock dials (authored detail)').setBaseColorTexture(detailTex).setMetallicFactor(0).setRoughnessFactor(1)
    .setExtension('KHR_materials_unlit', unlit.createUnlit()).setExtras({ authoredInfill: true, vertexColorScale: RELIGHT_SCALE, ...(lod.name === 'far' ? { textureOfNear: 'detail-atlas' } : { textureKey: 'detail-atlas' }) });
  detailMat.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071); // atlas regions: clamp
  mesh.addPrimitive(doc.createPrimitive().setMaterial(detailMat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(TP)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(TUV)).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(Uint16Array.from(TC)).setNormalized(true).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(TP.length / 3 > 65535 ? Uint32Array.from(TI) : Uint16Array.from(TI)).setBuffer(buffer)));
  const node = doc.createNode(`UT Tower scan ${lod.name}`).setMesh(mesh);
  doc.createScene('tower').addChild(node);
  doc.getRoot().getAsset().copyright = 'Copyright (c) 2025 Sean Hardesty Lewis, MIT License (seanhlewis/utimagery@13f08efe). Cropped/aligned/re-atlased/relit derivative; belfry above the clock-block roof, clock dials, window-strip panels and reveals are authored.';
  // separate (non-interleaved) attributes: COLOR_0 is uint16, positions stay a plain Float32Array for the loader checks
  const glb = await new NodeIO().registerExtensions([KHRMaterialsUnlit]).setVertexLayout(VertexLayout.SEPARATE).writeBinary(doc);
  const name = `ut-tower-${lod.name}.glb`;
  writeFileSync(OUT + name, glb);
  const allTris = (i2.length + II.length + TI.length) / 3;
  files.push({ name, bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'), triangles: i2.length / 3, vertices: p2.length / 3, authoredTriangles: allTris - i2.length / 3, simplifyErrorM: lod.error, textureWidth: lod.name === 'near' ? ATLAS : 1024 });
  log('wrote', name, glb.length, 'bytes', i2.length / 3, 'scan tris +', allTris - i2.length / 3, 'authored');
}
const meta = {
  asset: 'ut-tower', anchor, cutY: CUT_Y, cropRule: 'all vertices Y >= cutY and |u|,|v| <= halfAt(Y) in shaft axes; halfAt: <85:9.45, <89.5:10.0, <96.6:8.6, else 5.6 m',
  yawRad: yaw, axes: { u: eu, v: ev }, transform: X, files, tiers, proxies, heightfield, lid: { loopVertices: lid.loopVertices, y: lid.y, radius: lid.radius, center: lid.center, note: 'measured rim of the open scanned lantern top (matches the authored roof rail top, crown.railTopY); the flat lid is superseded by the authored belfry (roof at crown.roofY)' }, skyBleedTexelsDesaturated: desaturated,
  crop: { sourceTriangles: nt, keptAfterCrop: kept, droppedFragments: dropped, droppedComponents: droppedComps, finalTriangles: tris.length, areaM2: areaAll, meanTexelsPerMetre: Math.sqrt(pixAll / areaAll), islands: rects.length, atlas: [ATLAS, atlasH], atlasScale: k },
  shaftFaces: coverage,
  relight: { gameSun: GAME_SUN, photographedWallFit: photoFit, vertexColorScale: RELIGHT_SCALE, faces: faceRelight, note: 'atlas texels unchanged; per-vertex linear multiplier (COLOR_0) swaps the fitted photographed wall sun for the game sun; |normal.y| > 0.8 keeps photographed light' },
  crown: { ...CROWN, roofY: CROWN.coping[1], railTopY: CROWN.coping[1] + RAIL.height, triangles: crownGeo.I.length / 3, stoneSunlitLinear: stoneSunlit, chamberLinear: CHAMBER,
    stoneBands: { resolutionPxPerM: STONE_RES, mid: STONE_MID, courseM: COURSE, headJointM: HEAD, bands: bandStats, note: 'captured texels: orthographic resample of plain shaft wall (north/east faces, photographed in shade), divided by band mean; joints drawn at world heights' },
    rail: RAIL, mast: { ...MAST, triangles: metalGeo.I.length / 3, note: 'position triangulated from GPS-tagged Commons photos 54984938073 (bearing 321 deg) and 54984752616 (bearing 124 deg), +-0.7 m; lattice drawn as three legs with zig-zag braces; heights estimated' }, nearCutRemovedM2: nearCut.removedM2.crown, farCutRemovedM2: farCut.removedM2.crown,
    note: 'authored belfry replacing the scan above cutY inside cutHalf (shaft axes about centreUV); dimensions from the scan half-extent profile cross-checked with photographs; four-fold symmetric (corner piers, 4 columns per face) as seen on all photographed faces; modern roof railing and antenna mast omitted' },
  clocks: { ...CLOCK, handTime: HAND_TIME, faces: clockFaces.map(c => ({ face: c.face, centreAlong: c.centreAlong, plane: c.plane, planeSamples: c.samples })), triangles: CG.I.length / 3,
    note: 'authored dial discs + gilded bezel bands over the cut scan rings; centre/radius measured from orthographic scan crops; dial drawn from reference photographs (gold bezel, pale blue-green field, dark red radial Roman numerals); hands set to the fixed game-sun time' },
  windowStrips: { ...windowStrips, note: 'authored detail (near LOD only), registered to the scanned strips; pattern drawn from reference proportions, not photographs' },
};
writeFileSync(OUT + 'ut-tower.json', JSON.stringify(meta, null, 1));
log('meta written');
