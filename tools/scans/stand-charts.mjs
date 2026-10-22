// Re-pack the source photo charts used by a set of scan triangles into one local RGB atlas,
// keeping every triangle's ORIGINAL photograph (no reprojection). Pure JS (no sharp/meshopt) so
// it can be unit-tested on synthetic scans (stand-charts.test.mjs).
//
// Conventions (glTF 2.0, verified in the test): UV (0,0) is the top-left corner of the image's
// first pixel row; texel (x, y) covers [x, x+1) x [y, y+1) in continuous pixel coordinates
// s = u * width, t = v * height, with its centre at (x + 0.5, y + 0.5). Source samplers are
// REPEAT (10497) in stadium.glb, so out-of-range UVs and gutters wrap.
//
// Chart = connected component of triangles sharing source vertex indices. A glTF vertex has one
// UV, so a UV seam is always a vertex split: charts never merge photographs across a seam, and
// all of a chart's triangles come from one primitive / texture.
//
// Regions: each chart's integer source core rect [cx0, cx1) x [cy0, cy1), grown by `pad` source
// texels, is a source region. Regions of one texture whose rects overlap are merged when the merged
// box is no larger than the two copied separately (so merging never adds atlas texels); the merged
// interior then carries the real neighbouring source texels as gutters. Atlas mapping for a region
// with source origin (rx0, ry0), atlas origin (ax, ay) and global scale k:
//   atlas continuous x = ax + (s - rx0) * k   (same for y)
// At k = 1 every atlas texel centre lands on a source texel centre: an exact copy. At k < 1 each
// atlas texel is the area (box) average of its source footprint. Gutters (>= pad texels around
// every chart core) hold the wrapped source continuation, which is what bilinear filtering of the
// source would see. Atlas rect origins/sizes are multiples of `align`, so an `align`x box
// downsample keeps every gutter >= 1 far texel at k = 1. Remaining empty texels are filled by
// bounded dilation.

export const ATLAS_PAD = 4, ATLAS_ALIGN = 4;

const wrap = (x, n) => ((x % n) + n) % n;
const roundUp = (x, a) => Math.ceil(x / a) * a;

/** Charts of `tris` (source triangle ids) by shared source vertex index; ids in first-appearance order. */
export function chartIslands(idx, tris) {
  const parent = new Map();
  const find = a => { let r = a; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(a) !== r) { const n = parent.get(a); parent.set(a, r); a = n; } return r; };
  for (const t of tris) for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]; if (!parent.has(i)) parent.set(i, i); }
  for (const t of tris) { const a = find(idx[3 * t]), b = find(idx[3 * t + 1]), c = find(idx[3 * t + 2]); if (a !== c) parent.set(a, c); const b2 = find(b); if (b2 !== c) parent.set(b2, c); }
  const idOfRoot = new Map(), chartOfVertex = new Map(), charts = [];
  for (const t of tris) {
    const r = find(idx[3 * t]);
    let id = idOfRoot.get(r);
    if (id === undefined) { id = charts.length; idOfRoot.set(r, id); charts.push({ id, tris: [], vertices: [] }); }
    charts[id].tris.push(t);
    for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]; if (!chartOfVertex.has(i)) { chartOfVertex.set(i, id); charts[id].vertices.push(i); } }
  }
  return { charts, chartOfVertex };
}

/** Source texel (wrapped), RGB. Texture data is RGBA (scanlib.loadScan) unless `channels` says otherwise. */
const texel = (T, x, y) => { const o = (wrap(y, T.h) * T.w + wrap(x, T.w)) * (T.channels ?? 4); return [T.data[o], T.data[o + 1], T.data[o + 2]]; };

/** Area average of source pixels over the continuous footprint [s0, s1) x [t0, t1) (wrapped). */
function boxSample(T, s0, s1, t0, t1) {
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let y = Math.floor(t0); y < t1; y++) {
    const wy = Math.min(t1, y + 1) - Math.max(t0, y); if (wy <= 0) continue;
    for (let x = Math.floor(s0); x < s1; x++) {
      const wx = Math.min(s1, x + 1) - Math.max(s0, x); if (wx <= 0) continue;
      const c = texel(T, x, y), w = wx * wy; r += c[0] * w; g += c[1] * w; b += c[2] * w; wsum += w;
    }
  }
  return [Math.round(r / wsum), Math.round(g / wsum), Math.round(b / wsum)];
}

/**
 * scan: { idx, uv, tex: [{w, h, data, channels?} | {solid}], triMat }.
 * Returns the atlas (RGB, width x height), the chart table (provenance) and uvOf(sourceVertex).
 */
export function packCharts(scan, tris, { width = 4096, maxHeight = 4096, pad = ATLAS_PAD, align = ATLAS_ALIGN, dilate = 2 * ATLAS_PAD, merge = true } = {}) {
  const { idx, uv, tex, triMat } = scan;
  const { charts, chartOfVertex } = chartIslands(idx, tris);
  for (const c of charts) {
    c.mat = triMat[c.tris[0]];
    for (const t of c.tris) if (triMat[t] !== c.mat) throw new Error(`chart ${c.id} spans source primitives ${c.mat} and ${triMat[t]}`);
    const T = tex[c.mat];
    if (!T || T.solid) throw new Error(`chart ${c.id}: source primitive ${c.mat} has no texture`);
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const i of c.vertices) { const s = uv[2 * i] * T.w, t = uv[2 * i + 1] * T.h; if (!Number.isFinite(s) || !Number.isFinite(t)) throw new Error(`non-finite source UV at vertex ${String(i)}`); s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    c.core = [Math.floor(s0), Math.floor(t0), Math.max(Math.floor(s0) + 1, Math.ceil(s1)), Math.max(Math.floor(t0) + 1, Math.ceil(t1))];
  }
  // Source regions (deterministic merge, per texture, in chart id order).
  const area = r => (r[2] - r[0]) * (r[3] - r[1]), overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  let regions = charts.map(c => ({ mat: c.mat, src: [c.core[0] - pad, c.core[1] - pad, c.core[2] + pad, c.core[3] + pad], charts: [c.id] }));
  for (let changed = merge; changed;) {
    changed = false;
    const byMat = new Map(); for (const r of regions) { const l = byMat.get(r.mat) ?? []; l.push(r); byMat.set(r.mat, l); }
    const next = [];
    for (const list of byMat.values()) {
      const CELL = 64, grid = new Map(), alive = new Set(list);
      const cells = r => { const out = []; for (let i = Math.floor(r.src[0] / CELL); i <= Math.floor((r.src[2] - 1) / CELL); i++) for (let j = Math.floor(r.src[1] / CELL); j <= Math.floor((r.src[3] - 1) / CELL); j++) out.push(`${i},${j}`); return out; };
      const add = r => { for (const k of cells(r)) { const l = grid.get(k) ?? []; l.push(r); grid.set(k, l); } };
      list.forEach(add);
      for (const r of list) {
        if (!alive.has(r)) continue;
        for (let again = true; again;) {
          again = false;
          const cand = new Set(); for (const k of cells(r)) for (const o of grid.get(k) ?? []) if (o !== r && alive.has(o) && overlaps(r.src, o.src)) cand.add(o);
          for (const o of [...cand].sort((a, b) => a.charts[0] - b.charts[0])) {
            const u = [Math.min(r.src[0], o.src[0]), Math.min(r.src[1], o.src[1]), Math.max(r.src[2], o.src[2]), Math.max(r.src[3], o.src[3])];
            if (area(u) > area(r.src) + area(o.src)) continue;
            r.src = u; r.charts.push(...o.charts); alive.delete(o); add(r); again = changed = true; break;
          }
        }
      }
      for (const r of list) if (alive.has(r)) next.push(r);
    }
    regions = next;
  }
  regions.sort((a, b) => Math.min(...a.charts) - Math.min(...b.charts));
  regions.forEach((r, n) => { r.id = n; r.charts.sort((a, b) => a - b); for (const c of r.charts) charts[c].region = n; });
  // Deterministic shelf pack at scale k; returns the used height (Infinity if a rect is too wide).
  const size = (r, k) => [roundUp(Math.ceil((r.src[2] - r.src[0]) * k), align), roundUp(Math.ceil((r.src[3] - r.src[1]) * k), align)];
  const pack = k => {
    const order = regions.map(c => ({ c, wh: size(c, k) })).sort((a, b) => b.wh[1] - a.wh[1] || b.wh[0] - a.wh[0] || a.c.id - b.c.id);
    let x = 0, y = 0, rowH = 0;
    for (const { c, wh: [w, h] } of order) {
      if (w > width) return Infinity;
      if (x + w > width) { x = 0; y += rowH; rowH = 0; }
      c.rect = [x, y, w, h]; x += w; rowH = Math.max(rowH, h);
    }
    return y + rowH;
  };
  let k = 1;
  while (pack(k) > maxHeight) { k *= 0.97; if (k < 1e-3) throw new Error('charts do not fit the atlas budget'); }
  const used = pack(k), height = Math.min(maxHeight, Math.max(align, 1 << Math.ceil(Math.log2(used))));
  const atlas = new Uint8Array(width * height * 3), filled = new Uint8Array(width * height);
  for (const c of regions) {
    const T = tex[c.mat], [ax, ay, aw, ah] = c.rect, [cx0, cy0] = c.src;
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const s = cx0 + (x + 0.5) / k, t = cy0 + (y + 0.5) / k;
      const col = k === 1 ? texel(T, Math.floor(s), Math.floor(t)) : boxSample(T, s - 0.5 / k, s + 0.5 / k, t - 0.5 / k, t + 0.5 / k);
      const o = (ay + y) * width + ax + x;
      atlas[3 * o] = col[0]; atlas[3 * o + 1] = col[1]; atlas[3 * o + 2] = col[2]; filled[o] = 1;
    }
  }
  // Bounded dilation into shelf gaps (deterministic 8-neighbour mean), so mips never pull black.
  let dilated = 0;
  for (let pass = 0; pass < dilate; pass++) {
    const next = filled.slice(); let changed = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = y * width + x; if (filled[o]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x2 = x + dx, y2 = y + dy; if ((!dx && !dy) || x2 < 0 || y2 < 0 || x2 >= width || y2 >= height) continue;
        const o2 = y2 * width + x2; if (!filled[o2]) continue; r += atlas[3 * o2]; g += atlas[3 * o2 + 1]; b += atlas[3 * o2 + 2]; n++;
      }
      if (n) { atlas[3 * o] = Math.round(r / n); atlas[3 * o + 1] = Math.round(g / n); atlas[3 * o + 2] = Math.round(b / n); next[o] = 1; changed++; }
    }
    filled.set(next); dilated += changed; if (!changed) break;
  }
  const uvOf = i => {
    const c = charts[chartOfVertex.get(i)], r = regions[c.region], T = tex[c.mat], [ax, ay] = r.rect, [rx0, ry0] = r.src;
    return [(ax + (uv[2 * i] * T.w - rx0) * k) / width, (ay + (uv[2 * i + 1] * T.h - ry0) * k) / height];
  };
  const sourcePixels = charts.reduce((a, c) => a + (c.core[2] - c.core[0]) * (c.core[3] - c.core[1]), 0);
  const table = charts.map(c => ({ id: c.id, region: c.region, sourcePrimitive: c.mat, sourceTexture: [tex[c.mat].w, tex[c.mat].h], sourceCore: c.core, triangles: c.tris.length, vertices: c.vertices.length }));
  const regionTable = regions.map(r => ({ id: r.id, sourcePrimitive: r.mat, sourceRect: r.src, atlasRect: r.rect, charts: r.charts.length }));
  return { atlas, width, height, scale: k, pad, align, usedHeight: used, dilatedTexels: dilated, sourcePixels, copiedSourceTexels: regions.reduce((a, r) => a + area(r.src), 0), charts: table, regions: regionTable, chartOfVertex, uvOf };
}

/** Exact f x f box average of an RGB image whose sides are multiples of f. */
export function boxDownsample(rgb, w, h, f) {
  if (w % f || h % f) throw new Error(`downsample ${w}x${h} by ${f}: sides must be multiples`);
  const W = w / f, H = h / f, out = new Uint8Array(W * H * 3), n = f * f;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += rgb[((y * f + dy) * w + x * f + dx) * 3 + ch];
    out[(y * W + x) * 3 + ch] = Math.round(s / n);
  }
  return { data: out, width: W, height: H };
}

/** Bilinear RGB sample at UV (glTF convention; pixel centres at +0.5), clamp-to-edge. */
export function bilinear(img, w, h, u, v, channels = 3) {
  const fx = u * w - 0.5, fy = v * h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const at = (x, y) => { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); const o = (y * w + x) * channels; return [img[o], img[o + 1], img[o + 2]]; };
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return [0, 1, 2].map(k => (a[k] * (1 - ax) + b[k] * ax) * (1 - ay) + (c[k] * (1 - ax) + d[k] * ax) * ay);
}

/** Bilinear sample of a source texture with REPEAT wrapping (the stadium.glb sampler). */
export function bilinearRepeat(T, u, v) {
  const fx = u * T.w - 0.5, fy = v * T.h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const a = texel(T, x0, y0), b = texel(T, x0 + 1, y0), c = texel(T, x0, y0 + 1), d = texel(T, x0 + 1, y0 + 1);
  return [0, 1, 2].map(k => (a[k] * (1 - ax) + b[k] * ax) * (1 - ay) + (c[k] * (1 - ax) + d[k] * ax) * ay);
}
