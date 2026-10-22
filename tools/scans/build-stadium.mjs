import { scanInput } from './inputs.mjs';
// Stadium: final transform from the yard-line scale + footprint registration, then crop ONLY the
// scanned field surface inside the generated field opening, flatten it onto the generated field
// plane (visual-only decal; the generated field collider stays), re-atlas and write a GLB.
import { loadScan, app3, mul3 } from './scanlib.mjs';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const LANE = new URL('../../', import.meta.url).pathname;
const OUT = LANE + 'public/assets/scans/';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const A = JSON.parse(readFileSync(process.argv[2] ?? LANE + 'tools/scans/stadium-align.json', 'utf8'));
const k = A.scaleRel, th = A.best.yawDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), fc = A.fieldCentreLevel, T = A.best.t;
// Generated bowl field frame (lib/campus/stadium-bowl.ts STADIUM_FIELD)
const F = { center: [444.3, 272.5], angle: Math.atan2(-0.068, 1), halfWidth: 35.5, halfLength: 63, cornerRadius: 10 };
const inOpening = (x, z, inset) => {
  const dx = x - F.center[0], dz = z - F.center[1];
  const u = dx * Math.cos(F.angle) - dz * Math.sin(F.angle), v = dx * Math.sin(F.angle) + dz * Math.cos(F.angle);
  const hu = F.halfWidth - inset, hv = F.halfLength - inset, r = Math.max(0, F.cornerRadius - inset);
  if (Math.abs(u) > hu || Math.abs(v) > hv) return false;
  const qu = Math.abs(u) - (hu - r), qv = Math.abs(v) - (hv - r);
  return !(qu > 0 && qv > 0 && Math.hypot(qu, qv) > r);
};
const scan = await loadScan(scanInput('stadium.glb'));
const { pos, uv, idx, triMat, tex, nt, nv } = scan;
// leveled (x37) -> campus xz; height above the scanned field plane (true metres)
const X = new Float64Array(nv), Z = new Float64Array(nv), H = new Float64Array(nv), ALONG = new Float64Array(nv);
const ca0 = Math.cos(A.axisAng), sa0 = Math.sin(A.axisAng);
for (let i = 0; i < nv; i++) {
  const q = app3(A.L, [pos[3 * i] * 37, pos[3 * i + 1] * 37, pos[3 * i + 2] * 37]);
  ALONG[i] = (q[0] - A.turfCentroid[0]) * ca0 + (q[2] - A.turfCentroid[1]) * sa0;
  X[i] = k * (c * (q[0] - fc[0]) - s * (q[2] - fc[1])) + T[0]; Z[i] = k * (s * (q[0] - fc[0]) + c * (q[2] - fc[1])) + T[1]; H[i] = k * (q[1] - A.fieldY);
}
// raw glTF -> campus matrix with the field plane at Y = 0 (runtime adds the generated fieldY)
const Rxz = [[c, 0, -s], [0, 1, 0], [s, 0, c]];
const lin = mul3(Rxz, A.L).map(r => r.map(v => v * k * 37));
const off = app3(Rxz, [fc[0], A.fieldY, fc[1]]).map(v => v * k);
const tr = [T[0] - off[0], -off[1], T[1] - off[2]];
const matrix = [lin[0][0], lin[1][0], lin[2][0], 0, lin[0][1], lin[1][1], lin[2][1], 0, lin[0][2], lin[1][2], lin[2][2], 0, tr[0], tr[1], tr[2], 1];
// sanity: matrix reproduces X/Z/H
{ const i = 1234, x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]; const mx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], my = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], mz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]; log('matrix check', (mx - X[i]).toFixed(5), (my - H[i]).toFixed(5), (mz - Z[i]).toFixed(5)); }
// ---- coverage evaluation of the whole scan (what is captured) ----
let standTris = 0, fieldTris = 0, otherTris = 0, standMaxH = 0; const standX = [], standZ = [];
for (let t = 0; t < nt; t++) { const a = idx[3 * t]; const h = (H[a] + H[idx[3 * t + 1]] + H[idx[3 * t + 2]]) / 3; if (Math.abs(h) < 0.6) fieldTris++; else if (h > 2) { standTris++; standMaxH = Math.max(standMaxH, h); if (t % 7 === 0) { standX.push(X[a]); standZ.push(Z[a]); } } else otherTris++; }
const sector = { west: 0, east: 0, north: 0, south: 0 };
for (let n = 0; n < standX.length; n++) { const dx = standX[n] - F.center[0], dz = standZ[n] - F.center[1]; const u = dx * Math.cos(F.angle) - dz * Math.sin(F.angle), v = dx * Math.sin(F.angle) + dz * Math.cos(F.angle); if (Math.abs(v) <= F.halfLength) sector[u < 0 ? 'west' : 'east']++; else sector[v < 0 ? 'north' : 'south']++; }
log('scan content: field-level tris', fieldTris, 'stand tris (>2 m)', standTris, 'other', otherTris, 'stand max height above field m', standMaxH.toFixed(1), 'stand samples by sector', JSON.stringify(sector));
// ---- crop: field-level triangles inside the generated opening (inset 0.75 m) ----
const tris = [];
for (let t = 0; t < nt; t++) {
  let ok = true;
  // South of the south 20-yard line the scan is in the stands' baked shadow with holes: not shipped.
  for (let q = 0; q < 3 && ok; q++) { const i = idx[3 * t + q]; if (Math.abs(H[i]) > 0.6 || !inOpening(X[i], Z[i], 0.75) || ALONG[i] < A.lines[16]) ok = false; }
  if (ok) tris.push(t);
}
let areaAll = 0, pixAll = 0; const flatDev = [];
for (const t of tris) {
  const [a, b, d] = [0, 1, 2].map(q => idx[3 * t + q]);
  const area = 0.5 * Math.abs((X[b] - X[a]) * (Z[d] - Z[a]) - (X[d] - X[a]) * (Z[b] - Z[a])); areaAll += area;
  const Tx = tex[triMat[t]]; pixAll += 0.5 * Math.abs((uv[2 * b] - uv[2 * a]) * (uv[2 * d + 1] - uv[2 * a + 1]) - (uv[2 * d] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1])) * Tx.w * Tx.h;
  flatDev.push(Math.abs(H[a]));
}
flatDev.sort((p, q) => p - q);
log('field crop tris', tris.length, 'area m2', areaAll.toFixed(0), 'texels/m', Math.sqrt(pixAll / areaAll).toFixed(1), 'flattening |dy| p50', flatDev[flatDev.length >> 1].toFixed(3), 'p95', flatDev[Math.floor(flatDev.length * .95)].toFixed(3), 'max', flatDev[flatDev.length - 1].toFixed(3));
// opening coverage: 1 m cells of the opening hit by the crop
const cov = new Set(); for (const t of tris) for (let q = 0; q < 3; q++) { const i = idx[3 * t + q]; cov.add(Math.floor(X[i]) + ',' + Math.floor(Z[i])); }
let openCells = 0, hit = 0; for (let x = 360; x < 530; x++) for (let z = 200; z < 345; z++) if (inOpening(x + 0.5, z + 0.5, 0.75)) { openCells++; if (cov.has(x + ',' + z)) hit++; }
log('opening cells covered by scanned field', hit, '/', openCells, (100 * hit / openCells).toFixed(1) + '%');
// ---- atlas ----
const islandParent = new Map();
const ifind = a => { let r = a; while (islandParent.get(r) !== r) r = islandParent.get(r); let b = a; while (islandParent.get(b) !== r) { const n = islandParent.get(b); islandParent.set(b, r); b = n; } return r; };
for (const t of tris) for (let q = 0; q < 3; q++) { const i = idx[3 * t + q]; if (!islandParent.has(i)) islandParent.set(i, i); }
for (const t of tris) { const a = ifind(idx[3 * t]), b = ifind(idx[3 * t + 1]), d = ifind(idx[3 * t + 2]); islandParent.set(a, d); if (ifind(b) !== d) islandParent.set(ifind(b), d); }
const islands = new Map();
for (const t of tris) for (let q = 0; q < 3; q++) { const i = idx[3 * t + q], r = ifind(i), Tx = tex[triMat[t]]; const px = uv[2 * i] * Tx.w, py = uv[2 * i + 1] * Tx.h; let isl = islands.get(r); if (!isl) islands.set(r, isl = { mat: triMat[t], x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }); isl.x0 = Math.min(isl.x0, px); isl.y0 = Math.min(isl.y0, py); isl.x1 = Math.max(isl.x1, px); isl.y1 = Math.max(isl.y1, py); }
const PAD = 2;
const rects = [...islands.entries()].map(([root, q]) => { const Tx = tex[q.mat]; const x0 = Math.max(0, Math.floor(q.x0) - PAD), y0 = Math.max(0, Math.floor(q.y0) - PAD), x1 = Math.min(Tx.w, Math.ceil(q.x1) + PAD), y1 = Math.min(Tx.h, Math.ceil(q.y1) + PAD); return { root, mat: q.mat, x0, y0, w: x1 - x0, h: y1 - y0 }; });
const pack = (W, kk) => { const order = [...rects].sort((a, b) => b.h - a.h); let x = 0, y = 0, rowH = 0; for (const r of order) { const w = Math.ceil(r.w * kk), h = Math.ceil(r.h * kk); if (x + w > W) { x = 0; y += rowH; rowH = 0; } r.ax = x; r.ay = y; r.aw = w; r.ah = h; x += w; rowH = Math.max(rowH, h); } return y + rowH; };
const ATLAS = 4096; let ks = 1; while (pack(ATLAS, ks) > ATLAS) ks *= 0.97;
const atlasH = Math.min(ATLAS, 1 << Math.ceil(Math.log2(pack(ATLAS, ks))));
const atlas = Buffer.alloc(ATLAS * atlasH * 3, 0);
for (const r of rects) { const Tx = tex[r.mat]; for (let y = 0; y < r.ah; y++) for (let x = 0; x < r.aw; x++) { const sx = Math.min(Tx.w - 1, Math.floor(r.x0 + (x + 0.5) / ks)), sy = Math.min(Tx.h - 1, Math.floor(r.y0 + (y + 0.5) / ks)); const so = (sy * Tx.w + sx) * 4, o = ((r.ay + y) * ATLAS + r.ax + x) * 3; atlas[o] = Tx.data[so]; atlas[o + 1] = Tx.data[so + 1]; atlas[o + 2] = Tx.data[so + 2]; } }
log('islands', rects.length, 'atlas', ATLAS, 'x', atlasH, 'scale', ks.toFixed(3));
// No colour edits: the shadowed south end is cropped instead of relit.
const rectOf = new Map(rects.map(r => [r.root, r]));
// ---- flattened local vertices (anchor = generated field centre, Y 0 = field plane) ----
const anchor = F.center;
const vmap = new Map(), P = [], UVs = [], I = [];
for (const t of tris) for (let q = 0; q < 3; q++) { const i = idx[3 * t + q]; let j = vmap.get(i); if (j === undefined) { j = vmap.size; vmap.set(i, j); const r = rectOf.get(ifind(i)), Tx = tex[r.mat]; P.push(X[i] - anchor[0], 0, Z[i] - anchor[1]); UVs.push((r.ax + (uv[2 * i] * Tx.w - r.x0) * ks) / ATLAS, (r.ay + (uv[2 * i + 1] * Tx.h - r.y0) * ks) / atlasH); } I.push(j); }
// winding: make every triangle face up (+Y)
for (let n = 0; n < I.length; n += 3) { const a = I[n], b = I[n + 1], d = I[n + 2]; const cr = (P[3 * b + 2] - P[3 * a + 2]) * (P[3 * d] - P[3 * a]) - (P[3 * b] - P[3 * a]) * (P[3 * d + 2] - P[3 * a + 2]); if (cr < 0) { I[n + 1] = d; I[n + 2] = b; } }
const positions = new Float32Array(P), uvs = new Float32Array(UVs), indices = new Uint32Array(I);
await MeshoptSimplifier.ready;
const [simp, err] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, uvs, 2, [1, 1], null, Math.min(indices.length, 40000 * 3), 0.01, ['ErrorAbsolute']);
const remap = new Int32Array(positions.length / 3).fill(-1), used = [];
for (const i of simp) if (remap[i] < 0) { remap[i] = used.length; used.push(i); }
const p2 = new Float32Array(used.length * 3), u2 = new Float32Array(used.length * 2);
used.forEach((o, n) => { p2.set(positions.subarray(3 * o, 3 * o + 3), 3 * n); u2.set(uvs.subarray(2 * o, 2 * o + 2), 2 * n); });
const i2 = Uint32Array.from(simp, i => remap[i]);
const jpeg = await sharp(atlas, { raw: { width: ATLAS, height: atlasH, channels: 3 } }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
const doc = new Document(); const buffer = doc.createBuffer(); const unlit = doc.createExtension(KHRMaterialsUnlit);
const texture = doc.createTexture('field atlas').setMimeType('image/jpeg').setImage(jpeg);
const material = doc.createMaterial('DKR field photogrammetry (baked colour)').setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setExtension('KHR_materials_unlit', unlit.createUnlit());
const prim = doc.createPrimitive().setMaterial(material)
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p2).setBuffer(buffer))
  .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(u2).setBuffer(buffer))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(p2.length / 3 > 65535 ? i2 : Uint16Array.from(i2)).setBuffer(buffer));
doc.createScene('field').addChild(doc.createNode('DKR scanned field decal').setMesh(doc.createMesh('DKR scanned field decal').addPrimitive(prim)));
doc.getRoot().getAsset().copyright = 'Copyright (c) 2025 Sean Hardesty Lewis, MIT License (seanhlewis/utimagery@13f08efe). Cropped/aligned/flattened/re-atlased derivative.';
const glb = await new NodeIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc);
writeFileSync(OUT + 'dkr-field.glb', glb);
log('wrote dkr-field.glb', glb.length, 'bytes', i2.length / 3, 'tris', 'simplify error', err);
const meta = {
  asset: 'dkr-field', anchor: [anchor[0], 0, anchor[1]], yOffsetAboveGeneratedField: 0.03,
  matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0: matrix,
  method: 'Leveled by a trimmed PCA plane through green turf triangles; scale from 11 sunlit yard lines (5 yd = 4.572 m) anchored on the TEXAS goal line (orange end-zone edge); yaw/translation by brute-force registration of stand/turf cells against GIS footprints NEZ 655373 + SEZ 504014. Author Cesium placement NOT used.',
  scale: { metresPerGltfUnit: 37 * k, relativeToAuthor37: k, yardLinePeriodS37: A.period, yardLineRmsS37: A.lineRms, sidelineWidthTrue: A.fieldWidthTrue },
  registration: { yawDeg: A.best.yawDeg, fieldCentreCampus: T, score: A.best, opposite: A.opposite },
  levelTiltDeg: Math.acos(A.normal[1]) * 180 / Math.PI,
  crop: { rule: 'triangles with all vertices within 0.6 m of the scanned field plane, inside the generated STADIUM_FIELD opening inset 0.75 m, and north of the south 20-yard line; flattened to the plane', triangles: tris.length, areaM2: areaAll, texelsPerMetre: Math.sqrt(pixAll / areaAll), openingCoverage: hit / openCells, flatteningAbsDy: { p50: flatDev[flatDev.length >> 1], p95: flatDev[Math.floor(flatDev.length * .95)], max: flatDev[flatDev.length - 1] } },
  colour: 'photographed texels unchanged (no relighting); the shadowed south end (south of the south 20-yard line) is cropped', southCutAlongS37: A.lines[16], cutYardLine: 'south 20-yard line',
  scanContent: { fieldTris, standTris, otherTris, standMaxHeightAboveField: standMaxH, standSamplesBySector: sector },
  file: { name: 'dkr-field.glb', bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'), triangles: i2.length / 3, vertices: p2.length / 3, atlas: [ATLAS, atlasH] },
};
writeFileSync(OUT + 'dkr-field.json', JSON.stringify(meta, null, 1));
writeFileSync(LANE + '.work/scans/dkr-field-atlas.jpg', jpeg);
