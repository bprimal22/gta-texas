import { scanInput } from './inputs.mjs';
// Crop the aligned Tower scan to the Tower above the Main Building roof, remove floating
// fragments, re-pack only the used texture charts into one atlas, simplify near/far LODs,
// derive simplified collider proxies, and write GLBs + metadata to public/assets/scans/.
import { loadScan } from './scanlib.mjs';
import { Document, NodeIO } from '@gltf-transform/core';
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
await MeshoptSimplifier.ready;
const simplify = (target, error) => {
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, uvs, 2, [0.5, 0.5], null, target * 3, error, ['ErrorAbsolute']);
  return { indices: out, error: err };
};
const lods = [];
const near = indices.length / 3 > 300000 ? simplify(300000, 0.02) : { indices, error: 0 };
const far = simplify(14000, 0.5);
lods.push({ name: 'near', ...near, texture: ATLAS }, { name: 'far', ...far, texture: 1024 });
// ---- 7. write GLBs ----
const atlasImg = sharp(atlas, { raw: { width: ATLAS, height: atlasH, channels: 3 } });
const jpegNear = await atlasImg.clone().jpeg({ quality: 86, mozjpeg: true }).toBuffer();
const jpegFar = await atlasImg.clone().resize(1024, Math.round(1024 * atlasH / ATLAS)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
const files = [];
for (const lod of lods) {
  const [compactIdx, count] = MeshoptSimplifier.compactMesh(lod.indices.slice());
  // compactMesh remaps indices in place to a dense vertex range; rebuild attribute buffers accordingly
  const remap = new Int32Array(positions.length / 3).fill(-1); // old -> new
  const used = []; for (const i of lod.indices) if (remap[i] < 0) { remap[i] = used.length; used.push(i); }
  const p2 = new Float32Array(used.length * 3), u2 = new Float32Array(used.length * 2);
  used.forEach((o, n) => { p2.set(positions.subarray(3 * o, 3 * o + 3), 3 * n); u2.set(uvs.subarray(2 * o, 2 * o + 2), 2 * n); });
  const i2 = Uint32Array.from(lod.indices, i => remap[i]);
  void compactIdx; void count;
  const doc = new Document(); const buffer = doc.createBuffer();
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  const texture = doc.createTexture('tower atlas').setMimeType('image/jpeg').setImage(lod.name === 'near' ? jpegNear : jpegFar);
  const material = doc.createMaterial('UT Tower photogrammetry (baked colour)').setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setExtension('KHR_materials_unlit', unlit.createUnlit());
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p2).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(u2).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(p2.length / 3 > 65535 ? i2 : Uint16Array.from(i2)).setBuffer(buffer));
  const mesh = doc.createMesh(`UT Tower scan ${lod.name}`).addPrimitive(prim);
  if (lid.positions) {
    const lidMat = doc.createMaterial('UT Tower lantern lid (authored infill)').setBaseColorFactor([0.42, 0.41, 0.38, 1]).setMetallicFactor(0).setRoughnessFactor(1).setExtension('KHR_materials_unlit', unlit.createUnlit());
    mesh.addPrimitive(doc.createPrimitive().setMaterial(lidMat).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(lid.positions).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(lid.indices).setBuffer(buffer)));
  }
  const node = doc.createNode(`UT Tower scan ${lod.name}`).setMesh(mesh);
  doc.createScene('tower').addChild(node);
  doc.getRoot().getAsset().copyright = 'Copyright (c) 2025 Sean Hardesty Lewis, MIT License (seanhlewis/utimagery@13f08efe). Cropped/aligned/re-atlased derivative.';
  const glb = await new NodeIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc);
  const name = `ut-tower-${lod.name}.glb`;
  writeFileSync(OUT + name, glb);
  files.push({ name, bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'), triangles: i2.length / 3, vertices: p2.length / 3, simplifyErrorM: lod.error, textureWidth: lod.name === 'near' ? ATLAS : 1024 });
  log('wrote', name, glb.length, 'bytes', i2.length / 3, 'tris');
}
const meta = {
  asset: 'ut-tower', anchor, cutY: CUT_Y, cropRule: 'all vertices Y >= cutY and |u|,|v| <= halfAt(Y) in shaft axes; halfAt: <85:9.45, <89.5:10.0, <96.6:8.6, else 5.6 m',
  yawRad: yaw, axes: { u: eu, v: ev }, transform: X, files, tiers, proxies, heightfield, lid: { loopVertices: lid.loopVertices, y: lid.y, radius: lid.radius, center: lid.center, note: 'authored flat infill closing the open scanned lantern top' }, skyBleedTexelsDesaturated: desaturated,
  crop: { sourceTriangles: nt, keptAfterCrop: kept, droppedFragments: dropped, droppedComponents: droppedComps, finalTriangles: tris.length, areaM2: areaAll, meanTexelsPerMetre: Math.sqrt(pixAll / areaAll), islands: rects.length, atlas: [ATLAS, atlasH], atlasScale: k },
  shaftFaces: coverage,
};
writeFileSync(OUT + 'ut-tower.json', JSON.stringify(meta, null, 1));
log('meta written');
