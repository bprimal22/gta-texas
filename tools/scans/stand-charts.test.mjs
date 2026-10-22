// Unit / fidelity tests for stand-charts.mjs. Run from the lane root:
//   node --preserve-symlinks --preserve-symlinks-main tools/scans/stand-charts.test.mjs
// Synthetic scans only (no source assets, no GPU). Exits non-zero on any failure.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';
import { packCharts, chartIslands, boxDownsample, bilinear } from './stand-charts.mjs';

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

// Texture helpers: RGBA, row 0 = top (as sharp/loadScan decode PNGs).
const texture = (w, h, colour) => { const data = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colour(x, y); data.set([c[0], c[1], c[2], 255], (y * w + x) * 4); } return { w, h, data }; };
const solid = (w, h, c) => texture(w, h, () => c);
// Synthetic scan builder: quads (2 triangles, own 4 vertices) with positions, UVs and a texture each.
function makeScan(quads) {
  const pos = [], uv = [], idx = [], triMat = [], tex = [];
  quads.forEach((q, m) => {
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...q.p[k]); uv.push(...q.uv[k]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3); triMat.push(m, m); tex.push(q.tex);
  });
  return { pos: Float32Array.from(pos), uv: Float32Array.from(uv), idx: Uint32Array.from(idx), triMat: Uint16Array.from(triMat), tex, nt: idx.length / 3 };
}
const atlasTexel = (r, x, y) => { const o = (y * r.width + x) * 3; return [r.atlas[o], r.atlas[o + 1], r.atlas[o + 2]]; };
const regionOf = (r, vertex) => r.regions[r.charts[r.chartOfVertex.get(vertex)].region];

// Fidelity criterion shared by both mappings: fraction of samples whose largest channel error > 20.
const over20 = pairs => pairs.filter(([a, b]) => Math.max(...[0, 1, 2].map(k => Math.abs(a[k] - b[k]))) > 20).length / pairs.length;

await test('glTF orientation and pixel centres: UV (0,0) is the top-left texel; k = 1 copies texels exactly', () => {
  const T = texture(4, 4, (x, y) => [x * 60, y * 60, 200]);
  const scan = makeScan([{ p: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], tex: T }]);
  const r = packCharts(scan, [0, 1], { width: 64, maxHeight: 64 });
  assert.equal(r.scale, 1);
  const reg = regionOf(r, 0), [ax, ay] = reg.atlasRect, [rx0, ry0] = reg.sourceRect;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepEqual(atlasTexel(r, ax + x - rx0, ay + y - ry0), [x * 60, y * 60, 200], `texel ${x},${y}`);
  // vertex UVs: (0,0) -> the top-left corner of the copied core; bilinear at the centre of source texel (0,0) returns it
  const [u0, v0] = r.uvOf(0); assert.equal(u0 * r.width, ax - rx0); assert.equal(v0 * r.height, ay - ry0);
  const c = bilinear(r.atlas, r.width, r.height, (ax - rx0 + 0.5) / r.width, (ay - ry0 + 0.5) / r.height);
  assert.deepEqual(c.map(Math.round), [0, 0, 200]);
  const [u2, v2] = r.uvOf(2); assert.equal(u2 * r.width - u0 * r.width, 4); assert.equal(v2 * r.height - v0 * r.height, 4);
});

await test('gutters hold the wrapped source continuation (REPEAT), rects are aligned and disjoint', () => {
  const T = texture(16, 16, (x, y) => [x * 15, y * 15, (x * 7 + y * 3) % 256]);
  const scan = makeScan([{ p: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [0.25, 0], [0.25, 0.25], [0, 0.25]], tex: T },
    { p: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], uv: [[0.5, 0.5], [0.75, 0.5], [0.75, 0.75], [0.5, 0.75]], tex: solid(8, 8, [9, 9, 9]) }]);
  const r = packCharts(scan, [0, 1, 2, 3], { width: 64, maxHeight: 64 });
  const reg = regionOf(r, 0), [ax, ay] = reg.atlasRect, [rx0, ry0] = reg.sourceRect;
  assert.ok(rx0 <= -r.pad && ry0 <= -r.pad, 'core grown by pad');
  // texel left of / above the core (source x = -1 -> wraps to 15)
  assert.deepEqual(atlasTexel(r, ax + (-1 - rx0), ay + (0 - ry0)), [15 * 15, 0, (15 * 7) % 256]);
  assert.deepEqual(atlasTexel(r, ax + (0 - rx0), ay + (-1 - ry0)), [0, 15 * 15, (15 * 3) % 256]);
  for (const g of r.regions) for (const v of g.atlasRect) assert.equal(v % r.align, 0, 'aligned');
  for (const a of r.regions) for (const b of r.regions) if (a !== b) {
    const [x1, y1, w1, h1] = a.atlasRect, [x2, y2, w2, h2] = b.atlasRect;
    assert.ok(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1, 'disjoint');
  }
});

await test('multi-layer faces keep their own photographs; an orthographic top projection fails the same check', () => {
  // Lower deck (red photo, y = 0), upper deck (blue photo, y = 5) over the same XZ, plus a
  // half-covered middle layer (green, y = 2). Distinct photo colours per layer.
  const quad = (y, x0, x1, colour) => ({ p: [[x0, y, 0], [x1, y, 0], [x1, y, 4], [x0, y, 4]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], tex: solid(8, 8, colour) });
  const layers = [quad(0, 0, 4, [200, 40, 30]), quad(5, 0, 4, [30, 60, 210]), quad(2, 2, 4, [40, 190, 60])];
  const scan = makeScan(layers);
  const tris = [0, 1, 2, 3, 4, 5];
  const r = packCharts(scan, tris, { width: 128, maxHeight: 128 });
  // deterministic points on every layer's triangles; source colour vs colour at the mapped atlas UV
  let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const charts = [], ortho = [];
  // orthographic reference (the old pipeline's top pane): highest layer colour per XZ texel
  const top = (x, z) => { let best = null; for (const L of layers) { const [x0, , z0] = L.p[0], [x1, , z1] = L.p[2]; if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && (!best || L.p[0][1] > best.p[0][1])) best = L; } return best.tex.data.slice(0, 3); };
  for (const t of tris) for (let n = 0; n < 50; n++) {
    let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const w = [1 - a - b, a, b], vs = [0, 1, 2].map(k => scan.idx[3 * t + k]);
    const P = [0, 2].map(k => w.reduce((acc, wi, j) => acc + wi * scan.pos[3 * vs[j] + k], 0));
    const src = Array.from(scan.tex[scan.triMat[t]].data.slice(0, 3));
    const muv = [0, 1].map(k => w.reduce((acc, wi, j) => acc + wi * r.uvOf(vs[j])[k], 0));
    charts.push([src, bilinear(r.atlas, r.width, r.height, muv[0], muv[1])]);
    ortho.push([src, [...top(P[0], P[1])]]);
  }
  assert.equal(over20(charts), 0, 'charts keep every layer photo');
  assert.ok(over20(ortho) > 0.5, `orthographic top mapping should fail (got ${over20(ortho)})`);
});

await test('k < 1 budget: box-averaged, constant charts stay exact, mapping stays inside the chart', () => {
  const quads = [];
  for (let n = 0; n < 6; n++) quads.push({ p: [[n, 0, 0], [n + 1, 0, 0], [n + 1, 0, 1], [n, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], tex: n % 2 ? solid(32, 32, [n * 30, 100, 50]) : texture(32, 32, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])) });
  const scan = makeScan(quads), tris = Array.from({ length: 12 }, (_, i) => i);
  const r = packCharts(scan, tris, { width: 64, maxHeight: 64 });
  assert.ok(r.scale < 1, `forced downsample (k=${r.scale})`);
  for (let n = 1; n < 6; n += 2) { const reg = regionOf(r, n * 4), [ax, ay, aw, ah] = reg.atlasRect; assert.deepEqual(atlasTexel(r, ax + (aw >> 1), ay + (ah >> 1)), [n * 30, 100, 50]); }
  const reg = regionOf(r, 0), [ax, ay, aw, ah] = reg.atlasRect, mid = atlasTexel(r, ax + (aw >> 1), ay + (ah >> 1));
  assert.ok(Math.abs(mid[0] - 128) < 40, `checker averages towards grey (${mid.join(',')})`);
  for (let i = 0; i < 24; i++) { const g = regionOf(r, i), [u, v] = r.uvOf(i); assert.ok(u * r.width >= g.atlasRect[0] && u * r.width <= g.atlasRect[0] + g.atlasRect[2] && v * r.height >= g.atlasRect[1] && v * r.height <= g.atlasRect[1] + g.atlasRect[3]); }
});

await test('deterministic output; region merging never copies more source texels', () => {
  const T = texture(64, 64, (x, y) => [(x * 4) % 256, (y * 4) % 256, ((x ^ y) * 4) % 256]), quads = [];
  for (let n = 0; n < 20; n++) { const u0 = (n % 5) * 0.18, v0 = Math.floor(n / 5) * 0.2; quads.push({ p: [[n, 0, 0], [n + 1, 0, 0], [n + 1, 0, 1], [n, 0, 1]], uv: [[u0, v0], [u0 + 0.15, v0], [u0 + 0.15, v0 + 0.15], [u0, v0 + 0.15]], tex: T }); }
  const scan = makeScan(quads), tris = Array.from({ length: 40 }, (_, i) => i);
  const scanOne = { ...scan, tex: scan.tex.map(() => T), triMat: new Uint16Array(scan.triMat.length) };
  const a = packCharts(scanOne, tris, { width: 256, maxHeight: 256 }), b = packCharts(scanOne, tris, { width: 256, maxHeight: 256 }), c = packCharts(scanOne, tris, { width: 256, maxHeight: 256, merge: false });
  const h = r => createHash('sha256').update(r.atlas).update(JSON.stringify(r.regions)).digest('hex');
  assert.equal(h(a), h(b));
  assert.ok(a.regions.length < c.regions.length, 'adjacent charts merged');
  assert.ok(a.copiedSourceTexels <= c.copiedSourceTexels, `${a.copiedSourceTexels} <= ${c.copiedSourceTexels}`);
  for (let i = 0; i < 80; i++) { const [ua, va] = a.uvOf(i), [uc, vc] = c.uvOf(i); const pa = bilinear(a.atlas, 256, a.height, ua + 0.5 / 256, va + 0.5 / a.height), pc = bilinear(c.atlas, 256, c.height, uc + 0.5 / 256, vc + 0.5 / c.height); assert.deepEqual(pa, pc, 'same photo texels either way'); }
});

await test('box downsample is the exact f x f mean', () => {
  const img = Uint8Array.from({ length: 8 * 4 * 3 }, (_, i) => (i * 37) % 256), d = boxDownsample(img, 8, 4, 4);
  for (let y = 0; y < 1; y++) for (let x = 0; x < 2; x++) for (let ch = 0; ch < 3; ch++) { let s = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) s += img[((y * 4 + dy) * 8 + x * 4 + dx) * 3 + ch]; assert.equal(d.data[(y * 2 + x) * 3 + ch], Math.round(s / 16)); }
  assert.throws(() => boxDownsample(img, 8, 4, 3));
});

await test('charts never span primitives; islands split at UV seams (vertex splits)', () => {
  // two quads sharing an edge POSITION but with separate vertices (a UV seam) stay two charts
  const scan = makeScan([{ p: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], tex: solid(4, 4, [1, 2, 3]) },
    { p: [[1, 0, 0], [2, 0, 0], [2, 0, 1], [1, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], tex: solid(4, 4, [4, 5, 6]) }]);
  assert.equal(chartIslands(scan.idx, [0, 1, 2, 3]).charts.length, 2);
  const bad = { ...scan, idx: Uint32Array.from([0, 1, 2, 0, 2, 4]), triMat: Uint16Array.from([0, 1]) };
  assert.throws(() => packCharts(bad, [0, 1], { width: 32, maxHeight: 32 }), /spans source primitives/);
});

await test('UV-aware simplification keeps chart seams: no LOD triangle mixes charts; the seam survives on both sides', async () => {
  // 2 charts on one 12 x 6 grid plane, split down x = 6 with duplicated seam vertices (different UVs)
  await MeshoptSimplifier.ready;
  const P = [], U = [], I = [], chartOfV = [], N = 12, Hh = 6;
  const id = new Map(), vert = (x, z, c) => { const k = `${x},${z},${c}`; if (!id.has(k)) { id.set(k, P.length / 3); P.push(x, 0.01 * Math.sin(x * z), z); U.push(c ? 0.6 + x * 0.02 : x * 0.05, z * 0.1); chartOfV.push(c); } return id.get(k); };
  for (let x = 0; x < N; x++) for (let z = 0; z < Hh; z++) { const c = x < 6 ? 0 : 1, a = vert(x, z, c), b = vert(x + 1, z, c), d = vert(x + 1, z + 1, c), e = vert(x, z + 1, c); I.push(a, b, d, a, d, e); }
  const pos = Float32Array.from(P), uvs = Float32Array.from(U), idx = Uint32Array.from(I);
  const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uvs, 2, [100, 100], null, 12, 0.05, ['ErrorAbsolute']);
  assert.ok(out.length < idx.length, 'simplified');
  for (let n = 0; n < out.length; n += 3) assert.equal(new Set([0, 1, 2].map(k => chartOfV[out[n + k]])).size, 1, 'triangle within one chart');
  // the seam (x = 6) survives on both sides
  const seam = c => [...out].some(v => P[3 * v] === 6 && chartOfV[v] === c);
  assert.ok(seam(0) && seam(1));
});

for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
const failed = results.filter(r => r[0] !== 'ok').length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} stand-charts tests passed`);
process.exit(failed ? 1 : 0);
