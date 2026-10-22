// Shared helpers: flatten a scan GLB into triangle soup + decoded textures; tiny software rasterizer.
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

export async function loadScan(file, { textures = true } = {}) {
  const doc = await new NodeIO().read(file);
  const prims = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) prims.push(p);
  let nv = 0, nt = 0;
  for (const p of prims) { nv += p.getAttribute('POSITION').getCount(); nt += p.getIndices().getCount() / 3; }
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(nt * 3), triMat = new Uint16Array(nt);
  const tex = [];
  let vo = 0, to = 0;
  for (let m = 0; m < prims.length; m++) {
    const p = prims[m];
    pos.set(p.getAttribute('POSITION').getArray(), vo * 3);
    if (p.getAttribute('TEXCOORD_0')) uv.set(p.getAttribute('TEXCOORD_0').getArray(), vo * 2);
    const ii = p.getIndices().getArray();
    for (let i = 0; i < ii.length; i++) idx[to * 3 + i] = ii[i] + vo;
    triMat.fill(m, to, to + ii.length / 3);
    vo += p.getAttribute('POSITION').getCount(); to += ii.length / 3;
    const t = p.getMaterial()?.getBaseColorTexture();
    if (textures && t) {
      const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      tex.push({ w: info.width, h: info.height, data });
    } else { const f = p.getMaterial()?.getBaseColorFactor() ?? [0.8, 0, 0.8, 1]; tex.push({ solid: f.slice(0, 3).map(v => Math.round(255 * Math.pow(v, 1 / 2.2))) }); }
  }
  return { doc, prims, pos, uv, idx, triMat, tex, nv, nt };
}

export function sampleTex(t, u, v) {
  if (!t) return [200, 0, 200];
  if (t.solid) return t.solid;
  let x = Math.floor((u - Math.floor(u)) * t.w), y = Math.floor((v - Math.floor(v)) * t.h);
  x = Math.min(t.w - 1, Math.max(0, x)); y = Math.min(t.h - 1, Math.max(0, y));
  const o = (y * t.w + x) * 4; return [t.data[o], t.data[o + 1], t.data[o + 2]];
}

// Orthographic textured raster. project(x,y,z) -> [px, py, depth(larger = nearer)].
export function render(scan, P, W, H, project, file, { keep = null, shade = true, xform = null, overlay = null, shadeFn = null, background = 255 } = {}) {
  const img = new Uint8Array(W * H * 3).fill(background), zb = new Float32Array(W * H).fill(-Infinity);
  const { idx, uv, triMat, tex, nt } = scan;
  const q = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let t = 0; t < nt; t++) {
    if (keep && !keep[t]) continue;
    let behind = false;
    for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]; const r = project(P[3 * i], P[3 * i + 1], P[3 * i + 2]); if (!r) { behind = true; break; } q[k][0] = r[0]; q[k][1] = r[1]; q[k][2] = r[2]; }
    if (behind) continue;
    const [a, b, c] = q;
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const ia = idx[3 * t], ib = idx[3 * t + 1], ic = idx[3 * t + 2];
    // shading from world normal
    let s = 1;
    if (shade) {
      const ux = P[3 * ib] - P[3 * ia], uy = P[3 * ib + 1] - P[3 * ia + 1], uz = P[3 * ib + 2] - P[3 * ia + 2];
      const vx = P[3 * ic] - P[3 * ia], vy = P[3 * ic + 1] - P[3 * ia + 1], vz = P[3 * ic + 2] - P[3 * ia + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      s = shadeFn ? shadeFn(nx / l, ny / l, nz / l, triMat[t]) : 0.55 + 0.45 * Math.abs((nx * 0.3 + ny * 0.8 + nz * 0.5) / l / 0.99);
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
      const w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2], o = y * W + x;
      if (z <= zb[o]) continue;
      zb[o] = z;
      const u = w0 * uv[2 * ia] + w1 * uv[2 * ib] + w2 * uv[2 * ic], v = w0 * uv[2 * ia + 1] + w1 * uv[2 * ib + 1] + w2 * uv[2 * ic + 1];
      const col = xform ? xform(t) : sampleTex(tex[triMat[t]], u, v);
      img[3 * o] = Math.min(255, col[0] * s); img[3 * o + 1] = Math.min(255, col[1] * s); img[3 * o + 2] = Math.min(255, col[2] * s);
    }
  }
  if (overlay) overlay(img, W, H);
  return sharp(Buffer.from(img), { raw: { width: W, height: H, channels: 3 } }).png().toFile(file).then(() => zb);
}

// ---- math helpers ----
export function jacobiEigen(A) { // symmetric 3x3 -> {values, vectors(columns)}
  const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}
// rotation matrix (row-major 3x3) taking unit vector a onto unit vector b
export function rotateOnto(a, b) {
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k = 1 / (1 + c), [x, y, z] = v;
  return [[x * x * k + c, x * y * k - z, x * z * k + y], [y * x * k + z, y * y * k + c, y * z * k - x], [z * x * k - y, z * y * k + x, z * z * k + c]];
}
export const mul3 = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const app3 = (A, p) => [A[0][0] * p[0] + A[0][1] * p[1] + A[0][2] * p[2], A[1][0] * p[0] + A[1][1] * p[1] + A[1][2] * p[2], A[2][0] * p[0] + A[2][1] * p[1] + A[2][2] * p[2]];
export const rotY = t => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];

// 2D Umeyama similarity: dst ≈ s R src + t. Returns {s, theta, t, rms, residuals}
export function umeyama2(src, dst, w = null) {
  const n = src.length; let W = 0; const ms = [0, 0], md = [0, 0];
  for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; W += wi; ms[0] += wi * src[i][0]; ms[1] += wi * src[i][1]; md[0] += wi * dst[i][0]; md[1] += wi * dst[i][1]; }
  ms[0] /= W; ms[1] /= W; md[0] /= W; md[1] /= W;
  let a = 0, b = 0, vs = 0;
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1, sx = src[i][0] - ms[0], sy = src[i][1] - ms[1], dx = dst[i][0] - md[0], dy = dst[i][1] - md[1];
    a += wi * (sx * dx + sy * dy); b += wi * (sx * dy - sy * dx); vs += wi * (sx * sx + sy * sy);
  }
  const theta = Math.atan2(b, a), s = Math.hypot(a, b) / vs, c = Math.cos(theta), si = Math.sin(theta);
  const t = [md[0] - s * (c * ms[0] - si * ms[1]), md[1] - s * (si * ms[0] + c * ms[1])];
  const apply = p => [s * (c * p[0] - si * p[1]) + t[0], s * (si * p[0] + c * p[1]) + t[1]];
  const residuals = src.map((p, i) => { const q = apply(p); return Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]); });
  return { s, theta, t, apply, residuals, rms: Math.sqrt(residuals.reduce((x, r) => x + r * r, 0) / n) };
}
// 3D Umeyama similarity: dst ≈ s R src + t
export function umeyama3(src, dst) {
  const n = src.length, ms = [0, 0, 0], md = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ms[k] += src[i][k] / n; md[k] += dst[i][k] / n; }
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let vs = 0;
  for (let i = 0; i < n; i++) { const a = src[i].map((v, k) => v - ms[k]), b = dst[i].map((v, k) => v - md[k]); vs += a[0] ** 2 + a[1] ** 2 + a[2] ** 2; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += b[r] * a[c] / n; }
  vs /= n;
  // SVD of C via eigen of CᵀC
  const CtC = [0, 1, 2].map(i => [0, 1, 2].map(j => C[0][i] * C[0][j] + C[1][i] * C[1][j] + C[2][i] * C[2][j]));
  const { values, vectors: V } = jacobiEigen(CtC);
  const order = [0, 1, 2].sort((x, y) => values[y] - values[x]);
  const Vs = [0, 1, 2].map(r => order.map(c => V[r][c])), sig = order.map(i => Math.sqrt(Math.max(0, values[i])));
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let c = 0; c < 2; c++) { const col = app3(C, [Vs[0][c], Vs[1][c], Vs[2][c]]); const l = Math.hypot(...col); for (let r = 0; r < 3; r++) U[r][c] = col[r] / l; }
  const u3 = [U[1][0] * U[2][1] - U[2][0] * U[1][1], U[2][0] * U[0][1] - U[0][0] * U[2][1], U[0][0] * U[1][1] - U[1][0] * U[0][1]];
  for (let r = 0; r < 3; r++) U[r][2] = u3[r];
  const col3 = app3(C, [Vs[0][2], Vs[1][2], Vs[2][2]]); const d = Math.sign(col3[0] * u3[0] + col3[1] * u3[1] + col3[2] * u3[2]) || 1;
  const vdet = Vs[0][0] * (Vs[1][1] * Vs[2][2] - Vs[1][2] * Vs[2][1]) - Vs[0][1] * (Vs[1][0] * Vs[2][2] - Vs[1][2] * Vs[2][0]) + Vs[0][2] * (Vs[1][0] * Vs[2][1] - Vs[1][1] * Vs[2][0]);
  const S = [1, 1, Math.sign(vdet) || 1];
  const R = [0, 1, 2].map(r => [0, 1, 2].map(c => U[r][0] * S[0] * Vs[c][0] + U[r][1] * S[1] * Vs[c][1] + U[r][2] * S[2] * Vs[c][2]));
  const s = (sig[0] + sig[1] + d * sig[2] * S[2]) / vs;
  const sm = app3(R, ms), t = md.map((v, k) => v - s * sm[k]);
  const apply = p => app3(R, p).map((v, k) => s * v + t[k]);
  const residuals = src.map((p, i) => { const q = apply(p); return Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1], q[2] - dst[i][2]); });
  return { s, R, t, apply, residuals, rms: Math.sqrt(residuals.reduce((x, r) => x + r * r, 0) / n) };
}

// Baked offline terrain (same buffer the game renders and collides with).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
export function loadBakedTerrain(file) {
  const b = gunzipSync(readFileSync(file)); const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const count = new DataView(buf).getUint32(8, true), pos = new Float32Array(buf, 20, count * 3);
  const cell = 8, grid = new Map();
  for (let t = 0; t < count / 3; t++) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < 3; k++) { const x = pos[9 * t + 3 * k], z = pos[9 * t + 3 * k + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  }
  const height = (x, z) => {
    let best = -Infinity;
    for (const t of grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) ?? []) {
      const ax = pos[9 * t], az = pos[9 * t + 2], bx = pos[9 * t + 3], bz = pos[9 * t + 5], cx = pos[9 * t + 6], cz = pos[9 * t + 8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-12) continue;
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      best = Math.max(best, w0 * pos[9 * t + 1] + w1 * pos[9 * t + 4] + w2 * pos[9 * t + 7]);
    }
    return best;
  };
  return { pos, count, height };
}

export function drawLine(img, W, H, x0, y0, x1, y1, col, thick = 1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    for (let dx = -thick + 1; dx < thick; dx++) for (let dy = -thick + 1; dy < thick; dy++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy; if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const o = (py * W + px) * 3; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
    }
  }
}

/** Re-pack only the UV charts used by `tris` into one RGB atlas (width `size`), returning
 * the atlas buffer and a per-source-vertex UV remap. Islands = triangle components sharing
 * source vertex indices. */
export function buildAtlas(scan, tris, size = 4096, pad = 2) {
  const { idx, uv, tex, triMat } = scan;
  const parent = new Map();
  const find = a => { let r = a; while (parent.get(r) !== r) r = parent.get(r); let b = a; while (parent.get(b) !== r) { const n = parent.get(b); parent.set(b, r); b = n; } return r; };
  for (const t of tris) for (let k = 0; k < 3; k++) { const i = idx[3 * t + k]; if (!parent.has(i)) parent.set(i, i); }
  for (const t of tris) { const a = find(idx[3 * t]), b = find(idx[3 * t + 1]), c = find(idx[3 * t + 2]); if (a !== c) parent.set(a, c); const b2 = find(b); if (b2 !== c) parent.set(b2, c); }
  const islands = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const i = idx[3 * t + k], r = find(i), T = tex[triMat[t]], px = uv[2 * i] * T.w, py = uv[2 * i + 1] * T.h;
    let s = islands.get(r); if (!s) islands.set(r, s = { mat: triMat[t], x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    s.x0 = Math.min(s.x0, px); s.y0 = Math.min(s.y0, py); s.x1 = Math.max(s.x1, px); s.y1 = Math.max(s.y1, py);
  }
  const rects = [...islands.entries()].map(([root, s]) => { const T = tex[s.mat]; const x0 = Math.max(0, Math.floor(s.x0) - pad), y0 = Math.max(0, Math.floor(s.y0) - pad), x1 = Math.min(T.w, Math.ceil(s.x1) + pad), y1 = Math.min(T.h, Math.ceil(s.y1) + pad); return { root, mat: s.mat, x0, y0, w: x1 - x0, h: y1 - y0 }; });
  const pack = (W, k) => { const order = [...rects].sort((a, b) => b.h - a.h); let x = 0, y = 0, rowH = 0; for (const r of order) { const w = Math.ceil(r.w * k), h = Math.ceil(r.h * k); if (x + w > W) { x = 0; y += rowH; rowH = 0; } r.ax = x; r.ay = y; r.aw = w; r.ah = h; x += w; rowH = Math.max(rowH, h); } return y + rowH; };
  let k = 1; while (pack(size, k) > size) k *= 0.97;
  const height = Math.min(size, 1 << Math.ceil(Math.log2(pack(size, k))));
  const atlas = Buffer.alloc(size * height * 3, 0);
  for (const r of rects) { const T = tex[r.mat]; for (let y = 0; y < r.ah; y++) for (let x = 0; x < r.aw; x++) { const sx = Math.min(T.w - 1, Math.floor(r.x0 + (x + 0.5) / k)), sy = Math.min(T.h - 1, Math.floor(r.y0 + (y + 0.5) / k)); const so = (sy * T.w + sx) * 4, o = ((r.ay + y) * size + r.ax + x) * 3; atlas[o] = T.data[so]; atlas[o + 1] = T.data[so + 1]; atlas[o + 2] = T.data[so + 2]; } }
  const rectOf = new Map(rects.map(r => [r.root, r]));
  const uvOf = (i, t) => { const r = rectOf.get(find(i)), T = tex[triMat[t]]; return [(r.ax + (uv[2 * i] * T.w - r.x0) * k) / size, (r.ay + (uv[2 * i + 1] * T.h - r.y0) * k) / height]; };
  const srcPixels = rects.reduce((a, r) => a + r.w * r.h, 0);
  return { atlas, width: size, height, scale: k, islands: rects.length, srcPixels, uvOf };
}
