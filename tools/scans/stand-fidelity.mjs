// Photo fidelity of the DKR west-stand derivative against the ORIGINAL source photographs.
// Usage: node --preserve-symlinks --preserve-symlinks-main tools/scans/stand-fidelity.mjs [assetsDir] [label]
// (assetsDir defaults to public/assets/scans; pass .work/baseline-run/public/assets/scans for the
// frozen orthographic build). Reads the raw scan, the retained source triangles written by
// build-stand.mjs (.work/scans/stand-provenance.json; the crop is identical in both builds, checked
// below against each asset's metadata) and the shipped GLBs. No GPU.
//
// Samples: deterministic (seeded), area-weighted points on retained captured source faces, plus a
// subset of upward faces with another retained surface > 1 m above at the same XZ (the layers a
// top orthographic projection overwrites). Source colour = bilinear source texel at the source UV
// (REPEAT). Errors are per-sample |source - shown| in 0..255 sRGB: `mean` = mean over R,G,B,
// `max` = largest channel. Stages:
//   A/B/C (chart builds only): source UV mapped through the chart table into the lossless atlas
//     (A), the decoded near JPEG (B) and the decoded far-GLB texture (C): packing and encoding
//     losses, separately. The far texture must be the same full-resolution JPEG bytes as the near.
//   D (any build): end to end through the shipped LOD geometry: the nearest LOD triangle facing the
//     same way (<= 0.3 m near, <= 1 m far), its interpolated UV, the decoded LOD texture.
// All-face coherence (chart builds): every captured LOD triangle checked for one chart / packed
// region / source image; every LOD vertex UV checked against its source vertex mapping. Exits 1 on
// any violation or on a captured/infill material layout error.
// LOD texture displacement (chart builds): points on LOD triangles, their UV mapped back to source
// texels, the source triangle of that chart holding that texel, and the 3D distance between where
// the LOD shows the texel and where the photo captured it.
import { loadScan } from './scanlib.mjs';
import { scanInput } from './inputs.mjs';
import { chartIslands, bilinear, bilinearRepeat } from './stand-charts.mjs';
import { NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const LANE = new URL('../../', import.meta.url).pathname;
const assets = resolve(process.argv[2] ?? LANE + 'public/assets/scans'), label = process.argv[3] ?? 'build';
const meta = JSON.parse(readFileSync(resolve(assets, 'dkr-west-stand.json'), 'utf8'));
const field = JSON.parse(readFileSync(resolve(assets, 'dkr-field.json'), 'utf8'));
const prov = JSON.parse(readFileSync(LANE + '.work/scans/stand-provenance.json', 'utf8'));
const chartsFile = LANE + '.work/scans/stand-charts.json';
const isCharts = /source photo charts/.test(meta.atlas.method ?? '');
const M = field.matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0, C = meta.anchor;
const out = { label, assets, atlasMethod: meta.atlas.method ?? meta.atlas.bake };
if (meta.crop.kept !== prov.keptSourceTriangles.length) throw new Error(`crop differs: asset meta keeps ${meta.crop.kept}, provenance ${prov.keptSourceTriangles.length}`);
out.crop = { kept: meta.crop.kept, cropped: meta.crop.cropped, droppedComponents: meta.crop.droppedComponents };

const scan = await loadScan(scanInput('stadium.glb'));
const { pos, idx, uv, tex, triMat } = scan, tris = prov.keptSourceTriangles;
const L = new Float64Array(scan.nv * 3);
for (let i = 0; i < scan.nv; i++) { const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]; L[3 * i] = M[0] * x + M[4] * y + M[8] * z + M[12] - C[0]; L[3 * i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; L[3 * i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14] - C[2]; }
const vtx = i => [L[3 * i], L[3 * i + 1], L[3 * i + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const faceOf = t => { const [a, b, c] = [0, 1, 2].map(k => vtx(idx[3 * t + k])), n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n); return { a, b, c, n: n.map(x => x / (l || 1)), area: l / 2 }; };

// ---- deterministic samples ----
let seed = 0x5eed1234; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cum = new Float64Array(tris.length); let total = 0;
tris.forEach((t, n) => { total += faceOf(t).area; cum[n] = total; });
const pick = () => { const r = rnd() * total; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; } return tris[lo]; };
const sampleOn = t => { let r1 = rnd(), r2 = rnd(); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; } const w = [1 - r1 - r2, r1, r2], f = faceOf(t), vs = [0, 1, 2].map(k => idx[3 * t + k]);
  const p = [0, 1, 2].map(k => w[0] * f.a[k] + w[1] * f.b[k] + w[2] * f.c[k]), u = w.reduce((s, wi, k) => s + wi * uv[2 * vs[k]], 0), v = w.reduce((s, wi, k) => s + wi * uv[2 * vs[k] + 1], 0);
  return { t, p, n: f.n, u, v, src: bilinearRepeat(tex[triMat[t]], u, v) }; };
// vertical "other surface above" test over retained faces (2 m XZ grid, exact barycentric)
const grid = new Map(), gk = (x, z) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
for (const t of tris) { const f = faceOf(t); const xs = [f.a[0], f.b[0], f.c[0]], zs = [f.a[2], f.b[2], f.c[2]]; for (let i = Math.floor(Math.min(...xs) / 2); i <= Math.floor(Math.max(...xs) / 2); i++) for (let j = Math.floor(Math.min(...zs) / 2); j <= Math.floor(Math.max(...zs) / 2); j++) { const k = `${i},${j}`; const l = grid.get(k) ?? []; l.push(t); grid.set(k, l); } }
const highestAbove = (p, self) => { let best = -Infinity; for (const t of grid.get(gk(p[0], p[2])) ?? []) { if (t === self) continue; const f = faceOf(t); const d = (f.b[2] - f.c[2]) * (f.a[0] - f.c[0]) + (f.c[0] - f.b[0]) * (f.a[2] - f.c[2]); if (Math.abs(d) < 1e-12) continue; const w0 = ((f.b[2] - f.c[2]) * (p[0] - f.c[0]) + (f.c[0] - f.b[0]) * (p[2] - f.c[2])) / d, w1 = ((f.c[2] - f.a[2]) * (p[0] - f.c[0]) + (f.a[0] - f.c[0]) * (p[2] - f.c[2])) / d, w2 = 1 - w0 - w1; if (w0 < 0 || w1 < 0 || w2 < 0) continue; best = Math.max(best, w0 * f.a[1] + w1 * f.b[1] + w2 * f.c[1]); } return best; };
const N_ALL = 4000, N_OCC = 1500;
const all = Array.from({ length: N_ALL }, () => sampleOn(pick()));
const occluded = []; let tries = 0;
while (occluded.length < N_OCC && tries < 200000) { tries++; const s = sampleOn(pick()); if (s.n[1] < 0.45) continue; const h = highestAbove(s.p, s.t); if (h > s.p[1] + 1) { s.above = h - s.p[1]; occluded.push(s); } }
out.samples = { all: all.length, occludedUpward: occluded.length, occludedTries: tries, seed: '0x5eed1234' };

// ---- shipped assets ----
const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
const decode = async buf => { const { data, info } = await sharp(Buffer.from(buf)).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const lodOf = async name => {
  const doc = await io.read(resolve(assets, name)), tri = [], uvs = [];
  let img = null, srcVertex = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh || /collider|infill/i.test(node.getName())) continue;
    for (const p of mesh.listPrimitives()) {
      const t = p.getMaterial()?.getBaseColorTexture(); if (!t || !p.getAttribute('TEXCOORD_0')) continue;
      img = await decode(t.getImage()); img.sha256 = createHash('sha256').update(t.getImage()).digest('hex');
      const P = p.getAttribute('POSITION').getArray(), U = p.getAttribute('TEXCOORD_0').getArray(), I = p.getIndices().getArray();
      for (let n = 0; n < I.length; n += 3) { tri.push([0, 1, 2].map(k => [P[3 * I[n + k]], P[3 * I[n + k] + 1], P[3 * I[n + k] + 2]])); uvs.push([0, 1, 2].map(k => [U[2 * I[n + k]], U[2 * I[n + k] + 1], I[n + k]])); }
    }
  }
  if (/near/.test(name)) srcVertex = prov.nearSourceVertex; else srcVertex = prov.farSourceVertex;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const q of tri) for (const v of q) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const materials = doc.getRoot().listMaterials().map(m => ({ name: m.getName(), unlit: !!m.getExtension('KHR_materials_unlit'), textured: !!m.getBaseColorTexture(), extras: m.getExtras() }));
  const g = new Map(), CELL = 1;
  tri.forEach((q, n) => { const lo = [0, 1, 2].map(k => Math.floor(Math.min(q[0][k], q[1][k], q[2][k]) / CELL)), hi = [0, 1, 2].map(k => Math.floor(Math.max(q[0][k], q[1][k], q[2][k]) / CELL)); for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const key = `${i},${j},${k}`; const l = g.get(key) ?? []; l.push(n); g.set(key, l); } });
  return { tri, uvs, img, grid: g, srcVertex, bounds: [lo.map(x => +x.toFixed(3)), hi.map(x => +x.toFixed(3))], materials };
};
// closest point on triangle (Ericson), returns barycentrics
const closest = (p, a, b, c) => {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); return [0, 1 - w, w]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return [1 - v - w, v, w];
};
const shownBy = (lod, s, maxDist) => {
  let best = null; const r = Math.ceil(maxDist);
  const cand = new Set(); for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) for (const n of lod.grid.get(`${Math.floor(s.p[0]) + i},${Math.floor(s.p[1]) + j},${Math.floor(s.p[2]) + k}`) ?? []) cand.add(n);
  for (const n of cand) {
    const [a, b, c] = lod.tri[n], nn = cross(sub(b, a), sub(c, a)), l = Math.hypot(...nn); if (l < 1e-12 || dot(nn, s.n) / l < 0.5) continue;
    const w = closest(s.p, a, b, c), q = [0, 1, 2].map(k => w[0] * a[k] + w[1] * b[k] + w[2] * c[k]), d = Math.hypot(...sub(q, s.p));
    if (d <= maxDist && (!best || d < best.d)) best = { d, n, w };
  }
  if (!best) return null;
  const U = lod.uvs[best.n], u = best.w.reduce((x, wi, k) => x + wi * U[k][0], 0), v = best.w.reduce((x, wi, k) => x + wi * U[k][1], 0);
  return { d: best.d, n: best.n, rgb: bilinear(lod.img.data, lod.img.w, lod.img.h, u, v) };
};
const stats = (rows, f) => {
  const e = rows.map(f).filter(x => x !== null), q = (arr, p) => { const s2 = [...arr].sort((a, b) => a - b); return s2.length ? +s2[Math.min(s2.length - 1, Math.floor(p * s2.length))].toFixed(2) : null; };
  const mean = e.map(x => x.mean), max = e.map(x => x.max);
  return { n: e.length, missing: rows.length - e.length, meanChannel: { median: q(mean, 0.5), p90: q(mean, 0.9) }, maxChannel: { median: q(max, 0.5), p90: q(max, 0.9) }, fractionMaxOver20: e.length ? +(max.filter(x => x > 20).length / e.length).toFixed(4) : null };
};
const err = (a, b) => { const d = [0, 1, 2].map(k => Math.abs(a[k] - b[k])); return { mean: (d[0] + d[1] + d[2]) / 3, max: Math.max(...d) }; };
const near = await lodOf('dkr-west-stand-near.glb'), far = await lodOf('dkr-west-stand-far.glb');
const failures = [];
out.farTexture = { nearImageSha256: near.img.sha256, farImageSha256: far.img.sha256, sameBytes: near.img.sha256 === far.img.sha256, nearSize: [near.img.w, near.img.h], farSize: [far.img.w, far.img.h] };
if (isCharts && !out.farTexture.sameBytes) failures.push('far texture is not the full-resolution near JPEG');
// Materials: captured = unlit + textured, not authored; infill = separate unlit, untextured, authoredInfill.
for (const { name, lod } of [{ name: 'near', lod: near }, { name: 'far', lod: far }]) {
  const shown = lod.materials.filter(m => !/collider/.test(m.name));
  const captured = shown.filter(m => m.textured), infill = shown.filter(m => !m.textured);
  if (isCharts && !(captured.length === 1 && captured[0].unlit && !captured[0].extras?.authoredInfill)) failures.push(`${name}: captured material must be one unlit textured material`);
  if (isCharts && !(infill.length === 1 && infill[0].unlit && infill[0].extras?.authoredInfill === true)) failures.push(`${name}: authored infill must be one separate unlit untextured material`);
}
out.lods = { near: { triangles: near.tri.length, texture: [near.img.w, near.img.h], capturedBounds: near.bounds, materials: near.materials }, far: { triangles: far.tri.length, texture: [far.img.w, far.img.h], capturedBounds: far.bounds, materials: far.materials } };

// chart builds: stages A-C and identity/displacement checks
let chartOf = null, charts = null;
if (isCharts) {
  charts = JSON.parse(readFileSync(chartsFile, 'utf8'));
  const isl = chartIslands(idx, tris); chartOf = isl.chartOfVertex;
  if (isl.charts.length !== charts.charts.length) throw new Error('chart table does not match the retained triangles');
  const rawAtlas = await sharp(LANE + '.work/scans/stand-atlas.png').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mapUV = s => { const c = charts.charts[chartOf.get(idx[3 * s.t])], r = charts.regions[c.region], T = tex[c.sourcePrimitive]; return [(r.atlasRect[0] + (s.u * T.w - r.sourceRect[0]) * charts.scale) / charts.atlas[0], (r.atlasRect[1] + (s.v * T.h - r.sourceRect[1]) * charts.scale) / charts.atlas[1]]; };
  for (const { name, rows } of [{ name: 'all', rows: all }, { name: 'occludedUpward', rows: occluded }]) {
    out[`stageA_rawAtlas_${name}`] = stats(rows, s => { const [u, v] = mapUV(s); return err(s.src, bilinear(rawAtlas.data, rawAtlas.info.width, rawAtlas.info.height, u, v)); });
    out[`stageB_nearJpeg_${name}`] = stats(rows, s => { const [u, v] = mapUV(s); return err(s.src, bilinear(near.img.data, near.img.w, near.img.h, u, v)); });
    out[`stageC_farJpeg_${name}`] = stats(rows, s => { const [u, v] = mapUV(s); return err(s.src, bilinear(far.img.data, far.img.w, far.img.h, u, v)); });
  }
  // every shipped LOD vertex is a source vertex with UV = chart mapping of its source UV
  for (const { name, lod } of [{ name: 'near', lod: near }, { name: 'far', lod: far }]) {
    let checked = 0, bad = 0, maxDuv = 0;
    for (const U of lod.uvs) for (const [u, v, i] of U) { const sv = lod.srcVertex[i], c = charts.charts[chartOf.get(sv)], r = charts.regions[c.region], T = tex[c.sourcePrimitive]; const mu = (r.atlasRect[0] + (uv[2 * sv] * T.w - r.sourceRect[0]) * charts.scale) / charts.atlas[0], mv = (r.atlasRect[1] + (uv[2 * sv + 1] * T.h - r.sourceRect[1]) * charts.scale) / charts.atlas[1]; const d = Math.max(Math.abs(mu - u), Math.abs(mv - v)) * charts.atlas[0]; maxDuv = Math.max(maxDuv, d); checked++; if (d > 0.01) bad++; }
    out[`${name}VertexUvProvenance`] = { vertexRefs: checked, mismatchedOver0_01Texel: bad, maxDiffAtlasTexels: +maxDuv.toExponential(2) };
  }
  // ALL captured triangles (not a sample): the three vertices of every LOD triangle must come from
  // one source chart, hence one packed atlas region and one source photograph.
  for (const { name, lod } of [{ name: 'near', lod: near }, { name: 'far', lod: far }]) {
    let mixedChart = 0, mixedRegion = 0, mixedImage = 0;
    for (const U of lod.uvs) {
      const cs = U.map(([, , i]) => chartOf.get(lod.srcVertex[i]));
      if (new Set(cs).size > 1) mixedChart++;
      if (new Set(cs.map(c => charts.charts[c].region)).size > 1) mixedRegion++;
      if (new Set(cs.map(c => charts.charts[c].sourcePrimitive)).size > 1) mixedImage++;
    }
    out[`${name}AllFaceCoherence`] = { triangles: lod.uvs.length, mixedChart, mixedPackedRegion: mixedRegion, mixedSourceImage: mixedImage };
    if (mixedChart || mixedRegion || mixedImage) failures.push(`${name}: ${mixedChart} mixed-chart / ${mixedRegion} mixed-region / ${mixedImage} mixed-image triangles`);
    if (out[`${name}VertexUvProvenance`].mismatchedOver0_01Texel) failures.push(`${name}: LOD vertex UV does not match its source vertex mapping`);
  }
}
for (const { lname, lod, maxD } of [{ lname: 'near', lod: near, maxD: 0.3 }, { lname: 'far', lod: far, maxD: 1.0 }]) for (const { name, rows } of [{ name: 'all', rows: all }, { name: 'occludedUpward', rows: occluded }]) {
  const shown = rows.map(s => shownBy(lod, s, maxD));
  out[`stageD_${lname}Lod_${name}`] = stats(rows.map((s, k) => ({ s, h: shown[k] })), ({ s, h }) => h ? err(s.src, h.rgb) : null);
  if (isCharts) {
    // chart identity: does the LOD triangle that shows this point carry the sample's own chart?
    let same = 0, n = 0; rows.forEach((s, k) => { const h = shown[k]; if (!h) return; n++; const own = chartOf.get(idx[3 * s.t]); if (lod.uvs[h.n].some(([, , i]) => chartOf.get(lod.srcVertex[i]) === own)) same++; });
    out[`stageD_${lname}Lod_${name}`].ownChartFraction = n ? +(same / n).toFixed(4) : null;
  }
}
// LOD texture displacement: where each displayed texel was captured vs where the LOD shows it.
if (isCharts) {
  const byChart = new Map(); for (const t of tris) { const c = chartOf.get(idx[3 * t]); const l = byChart.get(c) ?? []; l.push(t); byChart.set(c, l); }
  const regionOfAtlas = (x, y) => charts.regions.find(r => x >= r.atlasRect[0] && x < r.atlasRect[0] + r.atlasRect[2] && y >= r.atlasRect[1] && y < r.atlasRect[1] + r.atlasRect[3]);
  for (const { lname, lod } of [{ lname: 'near', lod: near }, { lname: 'far', lod: far }]) {
    const cumL = []; let tot = 0; lod.tri.forEach(([a, b, c]) => { tot += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2; cumL.push(tot); });
    const d = []; let crossChart = 0, unmapped = 0; const N = 3000;
    for (let s = 0; s < N; s++) {
      const r = rnd() * tot; let lo = 0, hi = cumL.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cumL[m] < r) lo = m + 1; else hi = m; }
      let r1 = rnd(), r2 = rnd(); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; } const w = [1 - r1 - r2, r1, r2];
      const [a, b, c] = lod.tri[lo], U = lod.uvs[lo], q = [0, 1, 2].map(k => w[0] * a[k] + w[1] * b[k] + w[2] * c[k]);
      const cs = new Set(U.map(([, , i]) => chartOf.get(lod.srcVertex[i]))); if (cs.size > 1) crossChart++;
      const u = w.reduce((x, wi, k) => x + wi * U[k][0], 0), v = w.reduce((x, wi, k) => x + wi * U[k][1], 0), ax = u * charts.atlas[0], ay = v * charts.atlas[1];
      const reg = regionOfAtlas(ax, ay); if (!reg) { unmapped++; continue; }
      const T = tex[reg.sourcePrimitive], su = (reg.sourceRect[0] + (ax - reg.atlasRect[0]) / charts.scale) / T.w, sv = (reg.sourceRect[1] + (ay - reg.atlasRect[1]) / charts.scale) / T.h;
      let bestD = Infinity;
      for (const c2 of cs) for (const t of byChart.get(c2) ?? []) {
        const vs = [0, 1, 2].map(k => idx[3 * t + k]), A = [uv[2 * vs[0]], uv[2 * vs[0] + 1]], B = [uv[2 * vs[1]], uv[2 * vs[1] + 1]], Cc = [uv[2 * vs[2]], uv[2 * vs[2] + 1]];
        const den = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1]); if (Math.abs(den) < 1e-18) continue;
        const w0 = ((B[1] - Cc[1]) * (su - Cc[0]) + (Cc[0] - B[0]) * (sv - Cc[1])) / den, w1 = ((Cc[1] - A[1]) * (su - Cc[0]) + (A[0] - Cc[0]) * (sv - Cc[1])) / den, w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const f = faceOf(t), ps = [0, 1, 2].map(k => w0 * f.a[k] + w1 * f.b[k] + w2 * f.c[k]); bestD = Math.min(bestD, Math.hypot(...sub(ps, q)));
      }
      if (bestD === Infinity) { unmapped++; continue; }
      d.push(bestD);
    }
    d.sort((x, y) => x - y); const q = p => +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(4);
    out[`${lname}TextureDisplacementM`] = { samples: N, mapped: d.length, outsideAnySourceChartTexel: unmapped, crossChartTriangles: +(crossChart / N).toFixed(4), median: q(0.5), p90: q(0.9), p99: q(0.99), max: +d[d.length - 1].toFixed(3) };
  }
}
out.failures = failures;
console.log(JSON.stringify(out, null, 1));
if (failures.length) { for (const f of failures) console.error('FAIL', f); process.exit(1); }
